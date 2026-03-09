/**
 * schema-converter.ts — SchemaConverter（schema-dsl DSL → JSON Schema 转换器）
 *
 * 将 vext 路由 options 中的 schema-dsl DSL 字符串转换为标准 JSON Schema 格式，
 * 供 OpenAPIGenerator 嵌入 OpenAPI 3.0 文档的 parameters / requestBody / responses。
 *
 * ⚡ v2.1 重构：使用 schema-dsl v1.2.5 的 toJsonSchema() 替代 toSchema() + 手动清理，
 * schema-dsl 现在直接输出纯净 JSON Schema（无 _required / _customMessages 等内部标记），
 * vext 无需再维护 cleanInternalMarkers() 和 SCHEMA_DSL_INTERNAL_KEYS。
 * 仅保留 OpenAPI 特有的 description / example 富化作为后处理步骤。
 *
 * 支持的 DSL 格式：
 *   - 基础类型：string / number / integer / boolean / email / url / date / objectId / array / object / any
 *   - 范围约束：string:1-50 / number:1-100 / integer:1- / string:8-!
 *   - 必填标记：string:1-50! / email! / objectId!（后缀 `!`）
 *   - 可选标记：url? / string:0-500?（后缀 `?`，映射为 nullable: true）
 *   - 枚举类型：enum:a,b,c / enum:admin,user,guest!
 *   - 嵌套对象：{ avatar: 'url?', bio: 'string:0-500?' }
 *   - 嵌套数组：[{ productId: 'objectId!', name: 'string!' }]
 *   - 引用字符串：'#/components/schemas/User'（$ref）
 *
 * 转换规则详见设计文档 14-openapi.md §4.1。
 *
 * @module lib/openapi/schema-converter
 * @see 14-openapi.md §4（SchemaConverter — schema-dsl → JSON Schema）
 */

import { schemaAdapter } from "../schema-adapter.js";
import type { JSONSchema as SchemaDslJSONSchema } from "../schema-adapter.js";
import type { JsonSchema, ConvertResult } from "./types.js";

// 注意：schema-dsl v1.2.5+ 的 DslBuilder.toJsonSchema() 已内置内部标记清理，
// vext 不再需要维护 SCHEMA_DSL_INTERNAL_KEYS 或 cleanInternalMarkers()。

/**
 * SchemaConverter — schema-dsl DSL → JSON Schema 转换器（v2.1 toJsonSchema 模式）
 *
 * 核心转换委托给 schemaAdapter（schema-dsl 防腐层），
 * 本类仅负责：
 *   1. 处理 schema-dsl 不支持的数组 DSL 语法（[{...}]）
 *   2. 为 OpenAPI 文档添加 description / example 富化
 *
 * 无状态转换器，所有方法均为纯函数（无副作用）。
 *
 * @example
 * ```typescript
 * const converter = new SchemaConverter()
 *
 * // 转换 validate 对象
 * const result = converter.convertValidateObject({
 *   name: 'string:1-50!',
 *   email: 'email!',
 *   age: 'integer:0-150?',
 * })
 * // result.schema = { type: 'object', properties: { name: ..., email: ..., age: ... }, required: ['name', 'email'] }
 * // result.required = ['name', 'email']
 *
 * // 转换单个 DSL 字符串
 * const { schema, isRequired } = converter.convertDSLString('string:1-50!')
 * // schema = { type: 'string', minLength: 1, maxLength: 50, description: '...', example: '...' }
 * // isRequired = true
 * ```
 */
export class SchemaConverter {
  /**
   * 将 schema-dsl 的 validate 对象转换为 JSON Schema
   *
   * 输入：schema-dsl 格式的对象（路由 options.validate.body / query / params 等）
   * 输出：JSON Schema 对象 + 必填字段列表
   *
   * 支持三种值类型：
   *   1. 字符串 DSL：'string:1-50!' / 'email!' / 'number:1-100'
   *   2. 数组类型：[{ productId: 'objectId!', name: 'string!' }]（嵌套对象数组）
   *   3. 嵌套对象：{ avatar: 'url?', bio: 'string:0-500?' }
   *
   * 实现策略：
   *   - 字符串 DSL → 委托 schemaAdapter.compileField().toSchema() + 富化
   *   - 嵌套对象 → 委托 schemaAdapter.compile() 获取完整 schema + 逐字段富化
   *   - 数组 DSL → 自行处理（schema-dsl DslDefinition 不支持数组语法）
   *
   * @param dslObj schema-dsl 格式的对象
   * @returns ConvertResult { schema, required }
   */
  convertValidateObject(dslObj: Record<string, unknown>): ConvertResult {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(dslObj)) {
      if (typeof value === "string") {
        // ── 字符串 DSL：'string:1-50!' / 'email!' / 'number:1-100' ──
        const { schema, isRequired } = this.convertDSLString(value);
        properties[key] = schema;
        if (isRequired) required.push(key);
      } else if (Array.isArray(value)) {
        // ── 数组类型：[{ productId: 'objectId!', name: 'string!' }] ──
        // schema-dsl 的 DslDefinition 不支持数组语法，自行处理
        if (
          value.length > 0 &&
          typeof value[0] === "object" &&
          value[0] !== null
        ) {
          const itemResult = this.convertValidateObject(
            value[0] as Record<string, unknown>,
          );
          properties[key] = {
            type: "array",
            items: {
              type: "object",
              properties: itemResult.schema.properties,
              ...(itemResult.required.length > 0
                ? { required: itemResult.required }
                : {}),
            },
          };
        } else {
          // 空数组或非对象元素 → 纯 array 类型
          properties[key] = { type: "array" };
        }
      } else if (typeof value === "object" && value !== null) {
        // ── 嵌套对象：{ avatar: 'url?', bio: 'string:0-500?' } ──
        const nested = this.convertValidateObject(
          value as Record<string, unknown>,
        );
        properties[key] = {
          type: "object",
          properties: nested.schema.properties,
          ...(nested.required.length > 0 ? { required: nested.required } : {}),
        };
      }
      // 其他类型（number / boolean / function 等）跳过
    }

    return {
      schema: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
      required,
    };
  }

  /**
   * 转换单个 DSL 字符串
   *
   * 委托 schemaAdapter.compileField() 获取 DslBuilder，
   * 调用 .toSchema() 获取基础 JSON Schema，
   * 然后叠加 OpenAPI 特有的 description / example 富化。
   *
   * @param dsl schema-dsl 字符串（如 'string:1-50!' / 'email?' / 'enum:a,b,c'）
   * @returns { schema: JsonSchema, isRequired: boolean }
   */
  convertDSLString(dsl: string): { schema: JsonSchema; isRequired: boolean } {
    const trimmed = dsl.trim();

    // ── 检测必填 / 可选后缀 ──────────────────────────────────
    const isRequired = trimmed.endsWith("!");
    const isNullable = trimmed.endsWith("?") && !isRequired;

    // ── 委托 schema-dsl 进行核心转换 ────────────────────────
    // compileField 接收完整 DSL 字符串（含 ! / ? 后缀），
    // 内部会正确解析类型、约束、required 标记。
    // toJsonSchema()（v1.2.5+）直接返回纯净 JSON Schema，
    // 已自动清理 _required / _customMessages 等内部标记。
    const builder = schemaAdapter.compileField(trimmed);
    const schema: JsonSchema = builder.toJsonSchema() as JsonSchema;

    // ── 应用 nullable 标记 ──────────────────────────────────
    if (isNullable) {
      schema.nullable = true;
    }

    // ── 获取不含后缀的 DSL（用于 description 生成） ──────────
    let cleanDsl = trimmed;
    if (isRequired || isNullable) {
      cleanDsl = trimmed.slice(0, -1);
    }

    // ── OpenAPI 富化：description + example ─────────────────
    if (!schema.description) {
      schema.description = this.buildDescription(
        cleanDsl,
        isRequired,
        isNullable,
      );
    }

    if (schema.example === undefined) {
      schema.example = this.inferExample(schema, cleanDsl);
    }

    return { schema, isRequired };
  }

  /**
   * 将 docs.responses 中的 schema 进行转换
   *
   * response schema 支持两种格式：
   *   1. 引用字符串：'#/components/schemas/User' → { $ref: '...' }
   *   2. schema-dsl 对象（与 validate 格式一致）→ 递归转换
   *
   * @param schema 响应 schema（字符串引用或 DSL 对象）
   * @returns JsonSchema 对象
   */
  convertResponseSchema(schema: Record<string, unknown> | string): JsonSchema {
    if (typeof schema === "string") {
      // 引用字符串：'#/components/schemas/User'
      return { $ref: schema };
    }

    // schema-dsl 对象 → 递归转换
    const result = this.convertValidateObject(schema);
    return result.schema;
  }

  // ── 私有方法：OpenAPI 描述生成 ────────────────────────────

  /**
   * 根据 DSL 字符串自动生成人类可读的 description
   *
   * 示例：
   *   'string:1-50'  + required  → "Required. String, 1-50 chars."
   *   'email'        + optional  → "Optional (nullable). Email address."
   *   'enum:a,b,c'              → "Optional. Enum: a, b, c."
   *   'integer:0-150' + optional → "Optional (nullable). Integer, range 0-150."
   *
   * @param dsl      不含后缀标记的 DSL 字符串
   * @param required 是否必填
   * @param nullable 是否可空
   * @returns 描述字符串
   */
  private buildDescription(
    dsl: string,
    required: boolean,
    nullable: boolean,
  ): string {
    const parts: string[] = [];

    // ── 必填 / 可选标记 ─────────────────────────────────────
    if (required) {
      parts.push("Required.");
    } else if (nullable) {
      parts.push("Optional (nullable).");
    } else {
      parts.push("Optional.");
    }

    // ── 枚举类型描述 ────────────────────────────────────────
    if (dsl.startsWith("enum:")) {
      const enumBody = dsl.slice(5);
      // 检查是否有类型前缀：enum:number:1,2,3
      const colonIdx = enumBody.indexOf(":");
      let valuesStr: string;
      if (colonIdx !== -1) {
        valuesStr = enumBody.slice(colonIdx + 1);
      } else {
        valuesStr = enumBody;
      }
      const separator = valuesStr.includes("|") ? "|" : ",";
      const values = valuesStr.split(separator).map((v) => v.trim());
      parts.push(`Enum: ${values.join(", ")}.`);
      return parts.join(" ");
    }

    // ── 带范围的类型描述 ────────────────────────────────────
    const colonIndex = dsl.indexOf(":");
    if (colonIndex !== -1) {
      const baseType = dsl.slice(0, colonIndex);
      const range = dsl.slice(colonIndex + 1);
      const typeName = this.humanTypeName(baseType);
      const rangeParts = range.split("-");

      if (rangeParts.length === 2) {
        const [minStr, maxStr] = rangeParts;
        const hasMin = minStr !== "";
        const hasMax = maxStr !== "" && maxStr !== "!";

        if (baseType === "string") {
          if (hasMin && hasMax) {
            parts.push(`${typeName}, ${minStr}-${maxStr} chars.`);
          } else if (hasMin) {
            parts.push(`${typeName}, min ${minStr} chars.`);
          } else if (hasMax) {
            parts.push(`${typeName}, max ${maxStr} chars.`);
          } else {
            parts.push(`${typeName}.`);
          }
        } else {
          if (hasMin && hasMax) {
            parts.push(`${typeName}, range ${minStr}-${maxStr}.`);
          } else if (hasMin) {
            parts.push(`${typeName}, min ${minStr}.`);
          } else if (hasMax) {
            parts.push(`${typeName}, max ${maxStr}.`);
          } else {
            parts.push(`${typeName}.`);
          }
        }
      } else {
        parts.push(`${typeName}.`);
      }
    } else {
      // ── 纯类型名描述 ──────────────────────────────────────
      parts.push(`${this.humanTypeName(dsl)}.`);
    }

    return parts.join(" ");
  }

  /**
   * 将 DSL 类型名映射为人类可读名称
   */
  private humanTypeName(type: string): string {
    const names: Record<string, string> = {
      string: "String",
      number: "Number",
      integer: "Integer",
      boolean: "Boolean",
      email: "Email address",
      url: "URL",
      date: "Date-time (ISO 8601)",
      datetime: "Date-time (ISO 8601)",
      objectId: "MongoDB ObjectId (24-char hex)",
      uuid: "UUID",
      array: "Array",
      object: "Object",
      any: "Any type",
      ipv4: "IPv4 address",
      ipv6: "IPv6 address",
      hexColor: "Hex color",
      slug: "URL slug",
      phone: "Phone number",
    };
    return names[type] ?? type;
  }

  // ── 私有方法：OpenAPI 示例值推断 ─────────────────────────

  /**
   * 根据 schema 类型和 DSL 推断合理的 example 值
   *
   * @param schema 已转换的 JSON Schema
   * @param dsl    不含后缀的 DSL 字符串
   * @returns 示例值
   */
  private inferExample(schema: JsonSchema, dsl: string): unknown {
    // 如果有 enum，使用第一个值作为示例
    if (schema.enum && schema.enum.length > 0) {
      return schema.enum[0];
    }

    // 根据 format 推断
    if (schema.format) {
      return EXAMPLE_BY_FORMAT[schema.format] ?? "string";
    }

    // 根据 pattern 推断（objectId 等）
    if (schema.pattern === "^[0-9a-fA-F]{24}$") {
      return "507f1f77bcf86cd799439011";
    }

    // 根据 type 推断
    switch (schema.type) {
      case "string": {
        // 带范围的 string → 生成更有意义的 example
        if (schema.minLength !== undefined && schema.minLength > 0) {
          return "example";
        }
        return "string";
      }
      case "number": {
        return schema.minimum ?? 0;
      }
      case "integer": {
        return schema.minimum ?? 0;
      }
      case "boolean":
        return true;
      case "array":
        return undefined; // 数组不设置默认 example
      case "object":
        return undefined; // 对象不设置默认 example
      default:
        return undefined;
    }
  }
}

// ── 模块级常量 ──────────────────────────────────────────────

// 注意：SCHEMA_DSL_INTERNAL_KEYS 已移除（v2.1）。
// schema-dsl v1.2.5 的 DslBuilder.toJsonSchema() 内置了内部标记清理，
// vext 不再需要维护清理列表。如果 schema-dsl 新增自定义关键字，
// 只需在 schema-dsl 侧更新 DslBuilder._internalKeys 即可。

/**
 * JSON Schema format → OpenAPI example 映射
 */
const EXAMPLE_BY_FORMAT: Record<string, unknown> = {
  email: "user@example.com",
  uri: "https://example.com",
  uuid: "550e8400-e29b-41d4-a716-446655440000",
  date: "2026-01-01",
  "date-time": "2026-01-01T00:00:00Z",
  time: "12:00:00",
  ipv4: "192.168.1.1",
  ipv6: "2001:0db8:85a3::8a2e:0370:7334",
};

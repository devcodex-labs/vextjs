/**
 * schema-converter.ts — SchemaConverter（schema-dsl DSL → JSON Schema 转换器）
 *
 * 将 vext 路由 options 中的 schema-dsl DSL 字符串转换为标准 JSON Schema 格式，
 * 供 OpenAPIGenerator 嵌入 OpenAPI 3.0 文档的 parameters / requestBody / responses。
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

import type { JsonSchema, ConvertResult } from "./types.js";

/**
 * SchemaConverter — schema-dsl DSL → JSON Schema 转换器
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
 * // schema = { type: 'string', minLength: 1, maxLength: 50 }
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
   * @param dslObj schema-dsl 格式的对象
   * @returns ConvertResult { schema, required }
   *
   * @example
   * ```typescript
   * converter.convertValidateObject({
   *   name: 'string:1-50!',
   *   email: 'email!',
   *   role: 'enum:admin,user?',
   *   profile: {
   *     avatar: 'url?',
   *     bio: 'string:0-500?',
   *   },
   *   items: [{ productId: 'objectId!', qty: 'integer:1-!' }],
   * })
   * ```
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
        if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
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
          ...(nested.required.length > 0
            ? { required: nested.required }
            : {}),
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
   * 解析后缀标记（`!` 必填 / `?` 可选/nullable），
   * 然后委托给 parseDSLCore() 解析核心部分。
   *
   * @param dsl schema-dsl 字符串（如 'string:1-50!' / 'email?' / 'enum:a,b,c'）
   * @returns { schema: JsonSchema, isRequired: boolean }
   *
   * @example
   * ```typescript
   * converter.convertDSLString('string:1-50!')
   * // → { schema: { type: 'string', minLength: 1, maxLength: 50 }, isRequired: true }
   *
   * converter.convertDSLString('email?')
   * // → { schema: { type: 'string', format: 'email', nullable: true }, isRequired: false }
   *
   * converter.convertDSLString('enum:a,b,c')
   * // → { schema: { type: 'string', enum: ['a', 'b', 'c'] }, isRequired: false }
   * ```
   */
  convertDSLString(dsl: string): { schema: JsonSchema; isRequired: boolean } {
    let isRequired = false;
    let isNullable = false;
    let cleanDsl = dsl.trim();

    // ── 解析后缀标记 ────────────────────────────────────────
    if (cleanDsl.endsWith("!")) {
      isRequired = true;
      cleanDsl = cleanDsl.slice(0, -1);
    } else if (cleanDsl.endsWith("?")) {
      isNullable = true;
      cleanDsl = cleanDsl.slice(0, -1);
    }

    // ── 解析核心 DSL ────────────────────────────────────────
    const schema = this.parseDSLCore(cleanDsl);

    // ── 应用 nullable 标记 ──────────────────────────────────
    if (isNullable) {
      schema.nullable = true;
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

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * 解析 DSL 核心部分（不含 ! / ? 后缀）
   *
   * 处理三种格式：
   *   1. enum:a,b,c     → { type: 'string', enum: ['a', 'b', 'c'] }
   *   2. string:1-50    → { type: 'string', minLength: 1, maxLength: 50 }
   *   3. string         → { type: 'string' }
   *
   * @param dsl 不含后缀标记的 DSL 字符串
   * @returns JsonSchema 对象
   */
  private parseDSLCore(dsl: string): JsonSchema {
    // ── enum:a,b,c ──────────────────────────────────────────
    if (dsl.startsWith("enum:")) {
      const values = dsl
        .slice(5)
        .split(",")
        .map((v) => v.trim());
      return { type: "string", enum: values };
    }

    // ── 带范围的类型：string:1-50 / number:1-100 ────────────
    const colonIndex = dsl.indexOf(":");
    if (colonIndex !== -1) {
      const baseType = dsl.slice(0, colonIndex);
      const range = dsl.slice(colonIndex + 1);
      return this.parseTypeWithRange(baseType, range);
    }

    // ── 纯类型名 ────────────────────────────────────────────
    return this.parseBaseType(dsl);
  }

  /**
   * 解析基础类型名
   *
   * 将 schema-dsl 的类型名映射为 JSON Schema 类型 + format。
   *
   * @param type 类型名（如 string / number / email / objectId 等）
   * @returns JsonSchema 对象
   */
  private parseBaseType(type: string): JsonSchema {
    switch (type) {
      case "string":
        return { type: "string" };
      case "number":
        return { type: "number" };
      case "integer":
        return { type: "integer" };
      case "boolean":
        return { type: "boolean" };
      case "email":
        return { type: "string", format: "email" };
      case "url":
        return { type: "string", format: "uri" };
      case "date":
        return { type: "string", format: "date-time" };
      case "objectId":
        return { type: "string", pattern: "^[0-9a-fA-F]{24}$" };
      case "array":
        return { type: "array" };
      case "object":
        return { type: "object" };
      case "any":
        return {};
      default:
        return { type: "string", description: `Unknown DSL type: ${type}` };
    }
  }

  /**
   * 解析带范围的类型
   *
   * 根据基础类型决定范围映射：
   *   - string: minLength / maxLength
   *   - number / integer: minimum / maximum
   *
   * 范围格式：
   *   - '1-50'  → min=1, max=50
   *   - '1-'    → min=1, 无上限
   *   - '8-!'   → min=8, 无上限（! 作为范围上限时表示无限）
   *   - '-100'  → 无下限, max=100
   *
   * @param baseType 基础类型名（如 string / number / integer）
   * @param range    范围字符串（如 '1-50' / '1-' / '8-!'）
   * @returns JsonSchema 对象
   */
  private parseTypeWithRange(baseType: string, range: string): JsonSchema {
    const schema = this.parseBaseType(baseType);
    const parts = range.split("-");

    if (parts.length !== 2) return schema;

    const [minStr, maxStr] = parts;
    const min = minStr ? Number(minStr) : undefined;
    const max =
      maxStr && maxStr !== "!" && maxStr !== ""
        ? Number(maxStr)
        : undefined;

    if (baseType === "string") {
      if (min !== undefined && !isNaN(min)) schema.minLength = min;
      if (max !== undefined && !isNaN(max)) schema.maxLength = max;
    } else if (baseType === "number" || baseType === "integer") {
      if (min !== undefined && !isNaN(min)) schema.minimum = min;
      if (max !== undefined && !isNaN(max)) schema.maximum = max;
    }

    return schema;
  }
}

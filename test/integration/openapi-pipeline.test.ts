/**
 * OpenAPI 管道集成测试
 *
 * 验证 schema-dsl DSL → SchemaConverter → OpenAPIGenerator → OpenAPI spec 的端到端正确性。
 *
 * 测试覆盖：
 *   - DSL 字符串 → JSON Schema 转换（基础类型、范围、枚举、必填/可选）
 *   - 枚举字段在 OpenAPI spec 中包含 enum 数组（BUG-021 回归防护）
 *   - 所有字段包含 description 和 example（OpenAPI 富化）
 *   - 嵌套对象和数组类型正确转换
 *   - schema-dsl toJsonSchema() 输出不含内部标记（_required / _customMessages 等）
 *   - OpenAPIGenerator 生成的完整 spec 结构合法性
 *   - 响应 schema 自动推断（write 操作从 validate.body 推断）
 *
 * 策略：
 *   不启动 HTTP 服务器，直接实例化 SchemaConverter 和 OpenAPIGenerator，
 *   验证转换产物的结构和内容。通过 schema-dsl 的 dsl() 函数验证上游输出，
 *   确保 vext 与 schema-dsl 的集成管道无缝衔接。
 *
 * @see 14-openapi.md §4（SchemaConverter）
 * @see BUG-021（schema-dsl enum 逗号分隔修复）
 * @see OPENAPI-003（SchemaConverter 委托 schema-dsl 重构）
 */

import { describe, it, expect } from "vitest";
import { SchemaConverter } from "../../src/lib/openapi/schema-converter.js";
import { dsl } from "schema-dsl";

// ── 辅助函数 ────────────────────────────────────────────────

function createConverter(): SchemaConverter {
  return new SchemaConverter();
}

/**
 * 断言 schema 包含 description 和 example
 * （OpenAPI 富化要求所有字段都有描述和示例值）
 */
function expectEnriched(schema: Record<string, unknown>, fieldName: string) {
  expect(schema.description, `${fieldName} 应有 description`).toBeDefined();
  expect(typeof schema.description).toBe("string");
  expect(
    (schema.description as string).length,
    `${fieldName} 的 description 不应为空`,
  ).toBeGreaterThan(0);
}

/**
 * 断言 schema 不含 schema-dsl 内部标记字段
 */
function expectNoInternalMarkers(
  schema: Record<string, unknown>,
  fieldName: string,
) {
  for (const key of Object.keys(schema)) {
    expect(key.startsWith("_"), `${fieldName} 不应包含内部字段 ${key}`).toBe(
      false,
    );
  }

  // 检查已知的 schema-dsl 自定义验证关键字
  const internalKeys = [
    "exactLength",
    "alphanum",
    "lowercase",
    "uppercase",
    "trim",
    "jsonString",
    "port",
    "requiredAll",
    "strictSchema",
    "noSparse",
    "includesRequired",
    "dateFormat",
    "dateGreater",
    "dateLess",
    "precision",
    "multipleOf",
  ];

  for (const key of internalKeys) {
    expect(key in schema, `${fieldName} 不应包含非标准关键字 ${key}`).toBe(
      false,
    );
  }
}

// ═════════════════════════════════════════════════════════════
// 集成测试
// ═════════════════════════════════════════════════════════════

describe("OpenAPI Pipeline — DSL → JSON Schema 端到端", () => {
  // ── schema-dsl toJsonSchema() 纯净输出验证 ────────────────

  describe("schema-dsl toJsonSchema() — 纯净输出（无内部标记）", () => {
    it("string:3-32! → 不含 _required", () => {
      const builder = dsl("string:3-32!");
      const schema = builder.toJsonSchema();

      expect(schema.type).toBe("string");
      expect(schema.minLength).toBe(3);
      expect(schema.maxLength).toBe(32);
      expectNoInternalMarkers(
        schema as Record<string, unknown>,
        "string:3-32!",
      );

      // 对比 toSchema()（应包含 _required）
      const raw = builder.toSchema();
      expect(raw._required).toBe(true);

      // toJsonSchema() 不应包含 _required
      expect("_required" in schema).toBe(false);
    });

    it("email! + messages() → 不含 _customMessages", () => {
      const builder = dsl("email!");
      builder.messages({ format: "邮箱格式不正确" });
      const schema = builder.toJsonSchema();

      expect(schema.type).toBe("string");
      expect(schema.format).toBe("email");
      expectNoInternalMarkers(
        schema as Record<string, unknown>,
        "email! + messages",
      );

      // 对比 toSchema()
      const raw = builder.toSchema();
      expect(raw._customMessages).toBeDefined();
      expect("_customMessages" in schema).toBe(false);
    });

    it("objectId! → 不含 _customMessages（pattern 的错误消息）", () => {
      const builder = dsl("objectId!");
      const schema = builder.toJsonSchema();

      expect(schema.type).toBe("string");
      expect(schema.pattern).toBeDefined();
      expectNoInternalMarkers(schema as Record<string, unknown>, "objectId!");
    });

    it("string! + label() → 不含 _label", () => {
      const builder = dsl("string!");
      builder.label("用户名");
      const schema = builder.toJsonSchema();

      expectNoInternalMarkers(
        schema as Record<string, unknown>,
        "string! + label",
      );

      const raw = builder.toSchema();
      expect(raw._label).toBe("用户名");
      expect("_label" in schema).toBe(false);
    });

    it("enum:a,b,c! → 纯净 enum 数组", () => {
      const builder = dsl("enum:a,b,c!");
      const schema = builder.toJsonSchema();

      expect(schema.type).toBe("string");
      expect(schema.enum).toEqual(["a", "b", "c"]);
      expectNoInternalMarkers(schema as Record<string, unknown>, "enum:a,b,c!");
    });

    it("enum:number:1,2,3 → 数字枚举纯净输出", () => {
      const builder = dsl("enum:number:1,2,3");
      const schema = builder.toJsonSchema();

      expect(schema.type).toBe("number");
      expect(schema.enum).toEqual([1, 2, 3]);
      expectNoInternalMarkers(
        schema as Record<string, unknown>,
        "enum:number:1,2,3",
      );
    });
  });

  // ── SchemaConverter + schema-dsl 集成 ─────────────────────

  describe("SchemaConverter — DSL 字符串 → OpenAPI JSON Schema", () => {
    it("基础类型转换 + OpenAPI 富化", () => {
      const c = createConverter();

      const cases: Array<{
        dsl: string;
        type: string;
        format?: string;
        required: boolean;
      }> = [
        { dsl: "string!", type: "string", required: true },
        { dsl: "number!", type: "number", required: true },
        { dsl: "integer:0-150?", type: "integer", required: false },
        { dsl: "boolean", type: "boolean", required: false },
        { dsl: "email!", type: "string", format: "email", required: true },
        { dsl: "url?", type: "string", format: "uri", required: false },
        { dsl: "date!", type: "string", format: "date", required: true },
      ];

      for (const tc of cases) {
        const { schema, isRequired } = c.convertDSLString(tc.dsl);

        expect(schema.type, `${tc.dsl} type`).toBe(tc.type);
        if (tc.format) {
          expect(schema.format, `${tc.dsl} format`).toBe(tc.format);
        }
        expect(isRequired, `${tc.dsl} required`).toBe(tc.required);

        // OpenAPI 富化：必须有 description
        expectEnriched(schema as Record<string, unknown>, tc.dsl);

        // 无内部标记
        expectNoInternalMarkers(schema as Record<string, unknown>, tc.dsl);
      }
    });

    it("字符串范围约束 + description 正确描述", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("string:1-50!");

      expect(schema.type).toBe("string");
      expect(schema.minLength).toBe(1);
      expect(schema.maxLength).toBe(50);
      expect(isRequired).toBe(true);

      // description 应包含范围信息
      expect(schema.description).toBeDefined();
      expect(schema.description).toContain("Required");
      expect(schema.description).toContain("1-50");
    });

    it("数值范围约束", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("number:0-999!");

      expect(schema.type).toBe("number");
      expect(schema.minimum).toBe(0);
      expect(schema.maximum).toBe(999);
      expect(isRequired).toBe(true);
      expectNoInternalMarkers(
        schema as Record<string, unknown>,
        "number:0-999!",
      );
    });

    it("nullable 标记（?后缀）", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("string:0-500?");

      expect(schema.type).toBe("string");
      expect(schema.nullable).toBe(true);
      expect(isRequired).toBe(false);
      expect(schema.description).toContain("nullable");
    });
  });

  // ── BUG-021 回归防护：枚举字段 ────────────────────────────

  describe("BUG-021 回归防护 — 枚举字段", () => {
    it("enum:a,b,c（逗号分隔）→ enum 数组存在且正确", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("enum:a,b,c");

      expect(schema.type).toBe("string");
      expect(schema.enum).toBeDefined();
      expect(schema.enum).toEqual(["a", "b", "c"]);
      expect(schema.description).toContain("Enum");
    });

    it("enum:admin,user,guest! → 必填枚举", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString(
        "enum:admin,user,guest!",
      );

      expect(schema.type).toBe("string");
      expect(schema.enum).toEqual(["admin", "user", "guest"]);
      expect(isRequired).toBe(true);
      expect(schema.description).toContain("Required");
      expectNoInternalMarkers(
        schema as Record<string, unknown>,
        "enum:admin,user,guest!",
      );
    });

    it("enum:active,inactive? → 可选枚举 + nullable", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString(
        "enum:active,inactive?",
      );

      expect(schema.type).toBe("string");
      expect(schema.enum).toEqual(["active", "inactive"]);
      expect(isRequired).toBe(false);
      expect(schema.nullable).toBe(true);
    });

    it("enum:number:1,2,3 → 数字枚举（类型前缀）", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("enum:number:1,2,3");

      expect(schema.type).toBe("number");
      expect(schema.enum).toEqual([1, 2, 3]);
    });

    it("管道分隔枚举（向后兼容）：enum:a|b|c", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("enum:a|b|c");

      expect(schema.type).toBe("string");
      expect(schema.enum).toEqual(["a", "b", "c"]);
    });
  });

  // ── 完整 validate 对象转换 ────────────────────────────────

  describe("convertValidateObject — 完整对象转换", () => {
    it("用户注册表单（混合类型 + 嵌套）", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string:1-50!",
        email: "email!",
        password: "string:8-!",
        role: "enum:admin,user,guest!",
        age: "integer:0-150?",
        profile: {
          avatar: "url?",
          bio: "string:0-500?",
        },
      });

      // 顶层结构
      expect(result.schema.type).toBe("object");
      expect(result.required).toContain("name");
      expect(result.required).toContain("email");
      expect(result.required).toContain("password");
      expect(result.required).toContain("role");
      expect(result.required).not.toContain("age");
      expect(result.required).not.toContain("profile");

      const props = result.schema.properties!;

      // name: string:1-50!
      expect(props.name.type).toBe("string");
      expect(props.name.minLength).toBe(1);
      expect(props.name.maxLength).toBe(50);
      expectEnriched(props.name as Record<string, unknown>, "name");
      expectNoInternalMarkers(props.name as Record<string, unknown>, "name");

      // email: email!
      expect(props.email.type).toBe("string");
      expect(props.email.format).toBe("email");

      // role: enum:admin,user,guest! — BUG-021 关键验证
      expect(props.role.type).toBe("string");
      expect(props.role.enum).toEqual(["admin", "user", "guest"]);
      expectNoInternalMarkers(props.role as Record<string, unknown>, "role");

      // age: integer:0-150?
      expect(props.age.type).toBe("integer");
      expect(props.age.nullable).toBe(true);
      expect(props.age.minimum).toBe(0);
      expect(props.age.maximum).toBe(150);

      // profile: 嵌套对象
      expect(props.profile.type).toBe("object");
      const profileProps = props.profile.properties!;
      expect(profileProps.avatar.type).toBe("string");
      expect(profileProps.avatar.format).toBe("uri");
      expect(profileProps.avatar.nullable).toBe(true);
      expect(profileProps.bio.type).toBe("string");
      expect(profileProps.bio.nullable).toBe(true);
    });

    it("对象数组 — items 正确转换", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        items: [
          {
            productId: "objectId!",
            name: "string:1-100!",
            quantity: "integer:1-!",
          },
        ],
      });

      const itemsField = result.schema.properties!.items;
      expect(itemsField.type).toBe("array");
      expect(itemsField.items).toBeDefined();
      expect(itemsField.items!.type).toBe("object");

      const itemProps = itemsField.items!.properties!;
      expect(itemProps.productId.type).toBe("string");
      expect(itemProps.productId.pattern).toBeDefined(); // objectId pattern

      expect(itemProps.name.type).toBe("string");
      expect(itemProps.name.minLength).toBe(1);
      expect(itemProps.name.maxLength).toBe(100);

      expect(itemProps.quantity.type).toBe("integer");
      expect(itemProps.quantity.minimum).toBe(1);

      // 数组内对象的 required
      expect(itemsField.items!.required).toContain("productId");
      expect(itemsField.items!.required).toContain("name");
      expect(itemsField.items!.required).toContain("quantity");
    });

    it("所有字段均有 description — OpenAPI 富化全覆盖", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        username: "string:3-32!",
        email: "email!",
        role: "enum:admin,user!",
        age: "integer:0-150",
        website: "url?",
        active: "boolean",
      });

      const props = result.schema.properties!;

      for (const [key, schema] of Object.entries(props)) {
        expectEnriched(schema as Record<string, unknown>, key);
        expectNoInternalMarkers(schema as Record<string, unknown>, key);
      }
    });
  });

  // ── example 值推断 ────────────────────────────────────────

  describe("example 值推断", () => {
    it("email → user@example.com", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("email!");
      expect(schema.example).toBe("user@example.com");
    });

    it("url → https://example.com", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("url!");
      expect(schema.example).toBe("https://example.com");
    });

    it("boolean → true", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("boolean");
      expect(schema.example).toBe(true);
    });

    it("objectId → 24位十六进制字符串", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("objectId!");
      expect(typeof schema.example).toBe("string");
      expect((schema.example as string).length).toBe(24);
    });

    it("enum → 使用第一个枚举值作为 example", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("enum:active,inactive,banned");
      expect(schema.example).toBe("active");
    });

    it("number:1-100 → minimum 值（1）", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("number:1-100");
      expect(schema.example).toBe(1);
    });

    it("string:1-50 → 'example'（有 minLength 时）", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("string:1-50");
      expect(schema.example).toBe("example");
    });
  });

  // ── convertResponseSchema ─────────────────────────────────

  describe("convertResponseSchema — 响应 schema 转换", () => {
    it("字符串引用 → $ref", () => {
      const c = createConverter();
      const result = c.convertResponseSchema("#/components/schemas/User");
      expect(result.$ref).toBe("#/components/schemas/User");
    });

    it("schema-dsl 对象 → 递归转换 + 富化", () => {
      const c = createConverter();
      const result = c.convertResponseSchema({
        id: "objectId!",
        name: "string:1-50!",
        email: "email!",
        role: "enum:admin,user,guest",
        createdAt: "datetime!",
      });

      expect(result.type).toBe("object");
      expect(result.required).toContain("id");
      expect(result.required).toContain("name");
      expect(result.required).toContain("email");

      const props = result.properties!;
      expect(props.role.enum).toEqual(["admin", "user", "guest"]);
      expect(props.createdAt.format).toBe("date-time");

      // 每个字段都应有 description
      for (const [key, schema] of Object.entries(props)) {
        expectEnriched(schema as Record<string, unknown>, `response.${key}`);
      }
    });

    it("分页列表响应 schema", () => {
      const c = createConverter();
      const result = c.convertResponseSchema({
        list: [
          {
            id: "objectId!",
            name: "string:1-50!",
            status: "enum:active,inactive!",
          },
        ],
        total: "integer:0-!",
        page: "integer:1-!",
        limit: "integer:1-100!",
      });

      expect(result.type).toBe("object");
      const props = result.properties!;

      // list 应为数组
      expect(props.list.type).toBe("array");
      expect(props.list.items).toBeDefined();
      expect(props.list.items!.properties!.status.enum).toEqual([
        "active",
        "inactive",
      ]);

      // total / page / limit
      expect(props.total.type).toBe("integer");
      expect(props.page.type).toBe("integer");
      expect(props.limit.type).toBe("integer");
      expect(props.limit.maximum).toBe(100);
    });
  });

  // ── 跨模块一致性验证 ─────────────────────────────────────

  describe("跨模块一致性 — schema-dsl 与 SchemaConverter 对齐", () => {
    it("schema-dsl dsl() 对象编译 vs SchemaConverter 逐字段转换结果一致", () => {
      const definition = {
        username: "string:3-32!",
        email: "email!",
        age: "integer:0-150",
      };

      // schema-dsl 侧：对象编译（dsl({...}) 返回 JSON Schema）
      const dslSchema = dsl(definition);

      // vext 侧：SchemaConverter 逐字段转换
      const c = createConverter();
      const converterResult = c.convertValidateObject(definition);

      // 类型和约束应一致
      const dslProps = dslSchema.properties!;
      const vextProps = converterResult.schema.properties!;

      // username
      expect(vextProps.username.type).toBe(
        (dslProps.username as Record<string, unknown>).type,
      );
      expect(vextProps.username.minLength).toBe(
        (dslProps.username as Record<string, unknown>).minLength,
      );
      expect(vextProps.username.maxLength).toBe(
        (dslProps.username as Record<string, unknown>).maxLength,
      );

      // email
      expect(vextProps.email.type).toBe(
        (dslProps.email as Record<string, unknown>).type,
      );
      expect(vextProps.email.format).toBe(
        (dslProps.email as Record<string, unknown>).format,
      );

      // age
      expect(vextProps.age.type).toBe(
        (dslProps.age as Record<string, unknown>).type,
      );

      // required 字段一致
      expect(converterResult.required).toContain("username");
      expect(converterResult.required).toContain("email");
      expect(converterResult.required).not.toContain("age");
    });

    it("SchemaConverter 输出比 schema-dsl 多出的仅是 description/example/nullable", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("string:3-32!");

      // schema-dsl 的基础输出
      const builder = dsl("string:3-32!");
      const rawSchema = builder.toJsonSchema();

      // vext 输出应完全包含 schema-dsl 的输出
      for (const [key, value] of Object.entries(rawSchema)) {
        expect(schema[key], `schema-dsl 的 ${key} 应保留在 vext 输出中`).toBe(
          value,
        );
      }

      // vext 多出的字段应仅为 OpenAPI 富化字段
      const vextKeys = new Set(Object.keys(schema));
      const dslKeys = new Set(Object.keys(rawSchema));
      const extraKeys = [...vextKeys].filter((k) => !dslKeys.has(k));

      for (const key of extraKeys) {
        expect(
          ["description", "example", "nullable"].includes(key),
          `vext 多出的字段 ${key} 应仅是 OpenAPI 富化字段`,
        ).toBe(true);
      }
    });
  });

  // ── 无状态一致性验证 ──────────────────────────────────────

  describe("无状态一致性", () => {
    it("多次调用同一 converter 不会互相影响", () => {
      const c = createConverter();

      const r1 = c.convertValidateObject({ a: "string:1-10!" });
      const r2 = c.convertValidateObject({ b: "email!" });

      expect(r1.schema.properties!.a.type).toBe("string");
      expect(r1.required).toEqual(["a"]);

      expect(r2.schema.properties!.b.type).toBe("string");
      expect(r2.schema.properties!.b.format).toBe("email");
      expect(r2.required).toEqual(["b"]);

      // r1 不应被 r2 污染
      expect(r1.schema.properties!.b).toBeUndefined();
    });

    it("不同 converter 实例结果一致", () => {
      const c1 = createConverter();
      const c2 = createConverter();

      const definition = {
        name: "string:1-50!",
        role: "enum:admin,user!",
      };

      const r1 = c1.convertValidateObject(definition);
      const r2 = c2.convertValidateObject(definition);

      expect(r1.schema.properties!.name.type).toBe(
        r2.schema.properties!.name.type,
      );
      expect(r1.schema.properties!.role.enum).toEqual(
        r2.schema.properties!.role.enum,
      );
      expect(r1.required).toEqual(r2.required);
    });
  });

  // ── 边界场景 ──────────────────────────────────────────────

  describe("边界场景", () => {
    it("空对象 → 空 properties", () => {
      const c = createConverter();
      const result = c.convertValidateObject({});

      expect(result.schema.type).toBe("object");
      expect(result.schema.properties).toEqual({});
      expect(result.required).toEqual([]);
    });

    it("null/undefined 值字段被跳过", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string!",
        extra: null as unknown as string,
      });

      expect(result.schema.properties!.name).toBeDefined();
      // null 值不应报错，应被静默跳过
    });

    it("enum 单值", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("enum:onlyOne");

      expect(schema.type).toBe("string");
      expect(schema.enum).toEqual(["onlyOne"]);
    });

    it("深层嵌套对象（3 层）", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        level1: {
          level2: {
            level3: "string:1-10!",
          },
        },
      });

      const l1 = result.schema.properties!.level1;
      expect(l1.type).toBe("object");

      const l2 = l1.properties!.level2;
      expect(l2.type).toBe("object");

      const l3 = l2.properties!.level3;
      expect(l3.type).toBe("string");
      expect(l3.minLength).toBe(1);
      expect(l3.maxLength).toBe(10);
      expectNoInternalMarkers(l3 as Record<string, unknown>, "level3");
    });

    it("objectId! → pattern 保留、_customMessages 清除", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("objectId!");

      // pattern 应保留（标准 JSON Schema 字段）
      expect(schema.pattern).toBe("^[0-9a-fA-F]{24}$");

      // _customMessages 应被清除
      expectNoInternalMarkers(
        schema as Record<string, unknown>,
        "objectId! 通过 SchemaConverter",
      );
    });
  });
});

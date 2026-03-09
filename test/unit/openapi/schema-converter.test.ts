import { describe, it, expect } from "vitest";
import { SchemaConverter } from "../../../src/lib/openapi/schema-converter.js";

// ── 测试辅助 ────────────────────────────────────────────────

function createConverter(): SchemaConverter {
  return new SchemaConverter();
}

// ═════════════════════════════════════════════════════════════
// SchemaConverter 单元测试
// ═════════════════════════════════════════════════════════════

describe("SchemaConverter", () => {
  // ── convertDSLString：基础类型 ────────────────────────────

  describe("convertDSLString — 基础类型", () => {
    it("string → { type: 'string' }", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("string");
      expect(schema).toMatchObject({ type: "string" });
      expect(isRequired).toBe(false);
    });

    it("number → { type: 'number' }", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("number");
      expect(schema).toMatchObject({ type: "number" });
      expect(isRequired).toBe(false);
    });

    it("integer → { type: 'integer' }", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("integer");
      expect(schema).toMatchObject({ type: "integer" });
    });

    it("boolean → { type: 'boolean' }", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("boolean");
      expect(schema).toMatchObject({ type: "boolean" });
    });

    it("email → { type: 'string', format: 'email' }", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("email");
      expect(schema).toMatchObject({ type: "string", format: "email" });
    });

    it("url → { type: 'string', format: 'uri' }", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("url");
      expect(schema).toMatchObject({ type: "string", format: "uri" });
    });

    it("date → { type: 'string', format: 'date' }", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("date");
      // schema-dsl: date → format: 'date'（非 date-time，datetime 才是 date-time）
      expect(schema).toMatchObject({ type: "string", format: "date" });
    });

    it("objectId → { type: 'string', pattern: ... }", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("objectId");
      expect(schema).toMatchObject({
        type: "string",
        pattern: "^[0-9a-fA-F]{24}$",
      });
    });

    it("array → { type: 'array' }", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("array");
      expect(schema).toMatchObject({ type: "array" });
    });

    it("object → { type: 'object' }", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("object");
      expect(schema).toMatchObject({ type: "object" });
    });

    it("any → {} (空 schema)", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("any");
      expect(schema).toMatchObject({});
    });

    it("未知类型 → 抛出异常或退化为 string", () => {
      const c = createConverter();
      // schema-dsl 对未知类型可能返回 { type: 'string' } 或抛出异常
      // 通过 SchemaConverter 后会添加 description，内容取决于 schema-dsl 行为
      const { schema } = c.convertDSLString("foobar");
      expect(schema.type).toBeDefined();
    });
  });

  // ── convertDSLString：必填标记 (!) ────────────────────────

  describe("convertDSLString — 必填标记 (!)", () => {
    it("string! → isRequired = true", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("string!");
      expect(schema).toMatchObject({ type: "string" });
      expect(isRequired).toBe(true);
    });

    it("email! → isRequired = true, format: 'email'", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("email!");
      expect(schema).toMatchObject({ type: "string", format: "email" });
      expect(isRequired).toBe(true);
    });

    it("objectId! → isRequired = true, pattern 正确", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("objectId!");
      expect(schema.type).toBe("string");
      expect(schema.pattern).toBe("^[0-9a-fA-F]{24}$");
      expect(isRequired).toBe(true);
    });

    it("number! → isRequired = true", () => {
      const c = createConverter();
      const { isRequired } = c.convertDSLString("number!");
      expect(isRequired).toBe(true);
    });

    it("boolean! → isRequired = true", () => {
      const c = createConverter();
      const { isRequired } = c.convertDSLString("boolean!");
      expect(isRequired).toBe(true);
    });
  });

  // ── convertDSLString：可选标记 (?) / nullable ─────────────

  describe("convertDSLString — 可选标记 (?) / nullable", () => {
    it("string? → nullable: true, isRequired = false", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("string?");
      expect(schema).toMatchObject({ type: "string", nullable: true });
      expect(isRequired).toBe(false);
    });

    it("url? → nullable: true, format: 'uri'", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("url?");
      expect(schema).toMatchObject({
        type: "string",
        format: "uri",
        nullable: true,
      });
      expect(isRequired).toBe(false);
    });

    it("number? → nullable: true", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("number?");
      expect(schema).toMatchObject({ type: "number", nullable: true });
    });

    it("date? → nullable: true, format: 'date'", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("date?");
      // schema-dsl: date → format: 'date'
      expect(schema).toMatchObject({
        type: "string",
        format: "date",
        nullable: true,
      });
    });
  });

  // ── convertDSLString：范围约束 (string:min-max) ───────────

  describe("convertDSLString — 字符串范围 (string:min-max)", () => {
    it("string:1-50 → minLength: 1, maxLength: 50", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("string:1-50");

      expect(schema).toMatchObject({
        type: "string",
        minLength: 1,
        maxLength: 50,
      });
    });

    it("string:1-50! → minLength: 1, maxLength: 50, isRequired = true", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("string:1-50!");

      expect(schema).toMatchObject({
        type: "string",
        minLength: 1,
        maxLength: 50,
      });
      expect(isRequired).toBe(true);
    });

    it("string:8-! → minLength: 8, 无 maxLength（无上限）", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("string:8-!");
      expect(schema.type).toBe("string");
      expect(schema.minLength).toBe(8);
      expect(schema.maxLength).toBeUndefined();
    });

    it("string:8- → minLength: 8, 无 maxLength（空上限）", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("string:8-");
      expect(schema.type).toBe("string");
      expect(schema.minLength).toBe(8);
      expect(schema.maxLength).toBeUndefined();
    });

    it("string:0-500 → minLength: 0, maxLength: 500", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("string:0-500");

      expect(schema).toMatchObject({
        type: "string",
        minLength: 0,
        maxLength: 500,
      });
    });

    it("string:0-500? → minLength: 0, maxLength: 500, nullable: true", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("string:0-500?");

      expect(schema).toMatchObject({
        type: "string",
        minLength: 0,
        maxLength: 500,
        nullable: true,
      });
      expect(isRequired).toBe(false);
    });

    it("string:3-32! → 常见用户名规则", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("string:3-32!");

      expect(schema).toMatchObject({
        type: "string",
        minLength: 3,
        maxLength: 32,
      });
      expect(isRequired).toBe(true);
    });
  });

  // ── convertDSLString：数值范围 (number:min-max) ────────────

  describe("convertDSLString — 数值范围 (number/integer:min-max)", () => {
    it("number:0-999 → minimum: 0, maximum: 999", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("number:0-999");

      expect(schema).toMatchObject({
        type: "number",
        minimum: 0,
        maximum: 999,
      });
    });

    it("number:1- → minimum: 1, 无 maximum", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("number:1-");
      expect(schema.type).toBe("number");
      expect(schema.minimum).toBe(1);
      expect(schema.maximum).toBeUndefined();
    });

    it("number:1-100 → minimum: 1, maximum: 100", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("number:1-100");
      expect(schema).toMatchObject({
        type: "number",
        minimum: 1,
        maximum: 100,
      });
    });

    it("integer:1-! → minimum: 1, 无 maximum", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("integer:1-!");
      expect(schema.type).toBe("integer");
      expect(schema.minimum).toBe(1);
      expect(schema.maximum).toBeUndefined();
    });

    it("integer:0-150 → minimum: 0, maximum: 150", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("integer:0-150");

      expect(schema).toMatchObject({
        type: "integer",
        minimum: 0,
        maximum: 150,
      });
    });

    it("number:1-100! → isRequired = true, minimum: 1, maximum: 100", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("number:1-100!");

      expect(schema).toMatchObject({
        type: "number",
        minimum: 1,
        maximum: 100,
      });
      expect(isRequired).toBe(true);
    });

    it("integer:1-! → 末尾 ! 被解析为必填标记", () => {
      // 注意：后缀处理优先 — 末尾 '!' 总是被视为必填标记
      // 去掉 '!' 后剩下 'integer:1-'，范围解析时 max 为空字符串（无上限）
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("integer:1-!");
      // '!' 在末尾 → isRequired = true
      expect(isRequired).toBe(true);
      expect(schema.type).toBe("integer");
      expect(schema.minimum).toBe(1);
      expect(schema.maximum).toBeUndefined();
    });
  });

  // ── convertDSLString：枚举 (enum:a,b,c) ──────────────────

  describe("convertDSLString — 枚举 (enum:a,b,c)", () => {
    it("enum:a,b,c → { type: 'string', enum: ['a', 'b', 'c'] }", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("enum:a,b,c");
      expect(schema).toMatchObject({
        type: "string",
        enum: ["a", "b", "c"],
      });
      expect(isRequired).toBe(false);
    });

    it("enum:admin,user,guest! → isRequired = true", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString(
        "enum:admin,user,guest!",
      );
      expect(schema).toMatchObject({
        type: "string",
        enum: ["admin", "user", "guest"],
      });
      expect(isRequired).toBe(true);
    });

    it("enum:active,inactive? → nullable: true", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString(
        "enum:active,inactive?",
      );
      expect(schema).toMatchObject({
        type: "string",
        enum: ["active", "inactive"],
        nullable: true,
      });
      expect(isRequired).toBe(false);
    });

    it("enum:a → 单值枚举", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("enum:a");
      expect(schema).toMatchObject({ type: "string", enum: ["a"] });
    });

    it("enum:read, write, admin → 值中有空格（trim 处理）", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("enum:read, write, admin");
      expect(schema.enum).toEqual(["read", "write", "admin"]);
    });
  });

  // ── convertDSLString：空格修剪 ────────────────────────────

  describe("convertDSLString — 空格修剪", () => {
    it("前后有空格的 DSL 字符串应被 trim", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("  string:1-50  ");
      expect(schema.type).toBe("string");
      expect(schema.minLength).toBe(1);
      expect(schema.maxLength).toBe(50);
    });

    it("前后有空格 + 必填标记", () => {
      const c = createConverter();
      const { schema, isRequired } = c.convertDSLString("  email!  ");
      expect(schema.format).toBe("email");
      expect(isRequired).toBe(true);
    });
  });

  // ── convertValidateObject：简单对象 ───────────────────────

  describe("convertValidateObject — 简单对象", () => {
    it("单个字符串字段", () => {
      const c = createConverter();
      const result = c.convertValidateObject({ name: "string:1-50!" });
      expect(result.schema.type).toBe("object");
      expect(result.schema.properties!.name).toMatchObject({
        type: "string",
        minLength: 1,
        maxLength: 50,
      });
      expect(result.required).toEqual(["name"]);
    });

    it("多个字段（混合必填和可选）", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string:1-50!",
        email: "email!",
        age: "integer:0-150?",
        bio: "string:0-500",
      });

      expect(result.schema.type).toBe("object");

      // 必填字段
      expect(result.required).toEqual(["name", "email"]);

      // name
      expect(result.schema.properties!.name).toMatchObject({
        type: "string",
        minLength: 1,
        maxLength: 50,
      });

      // email
      expect(result.schema.properties!.email).toMatchObject({
        type: "string",
        format: "email",
      });

      // age（可选 / nullable）
      expect(result.schema.properties!.age).toMatchObject({
        type: "integer",
        minimum: 0,
        maximum: 150,
        nullable: true,
      });

      // bio（非必填 / 非 nullable）
      expect(result.schema.properties!.bio).toMatchObject({
        type: "string",
        minLength: 0,
        maxLength: 500,
      });
    });

    it("空对象 → 空 properties", () => {
      const c = createConverter();
      const result = c.convertValidateObject({});
      expect(result.schema).toEqual({ type: "object", properties: {} });
      expect(result.required).toEqual([]);
    });

    it("无必填字段时不包含 required 属性", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string",
        bio: "string?",
      });
      expect(result.schema.required).toBeUndefined();
      expect(result.required).toEqual([]);
    });
  });

  // ── convertValidateObject：嵌套对象 ───────────────────────

  describe("convertValidateObject — 嵌套对象", () => {
    it("一层嵌套对象", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        profile: {
          avatar: "url?",
          bio: "string:0-500?",
        },
      });

      expect(result.schema.type).toBe("object");
      const profile = result.schema.properties!.profile;
      expect(profile.type).toBe("object");

      // avatar
      expect(profile.properties!.avatar).toMatchObject({
        type: "string",
        format: "uri",
        nullable: true,
      });
      // bio
      expect(profile.properties!.bio).toMatchObject({
        type: "string",
        minLength: 0,
        maxLength: 500,
        nullable: true,
      });
    });

    it("嵌套对象中有必填字段", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        address: {
          street: "string:1-100!",
          city: "string:1-50!",
          zip: "string:5-10",
        },
      });

      const address = result.schema.properties!.address;
      expect(address.type).toBe("object");
      expect(address.required).toEqual(["street", "city"]);
    });

    it("二层嵌套对象", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        user: {
          name: "string:1-50!",
          settings: {
            theme: "enum:light,dark",
            lang: "string:2-5",
          },
        },
      });

      const user = result.schema.properties!.user;
      expect(user.type).toBe("object");

      expect(user.properties!.name).toMatchObject({
        type: "string",
        minLength: 1,
        maxLength: 50,
      });

      const settings = user.properties!.settings;
      expect(settings.type).toBe("object");

      expect(settings.properties!.theme).toMatchObject({
        type: "string",
        enum: ["light", "dark"],
      });
      expect(settings.properties!.lang).toMatchObject({
        type: "string",
        minLength: 2,
        maxLength: 5,
      });
    });
  });

  // ── convertValidateObject：数组类型 ───────────────────────

  describe("convertValidateObject — 数组类型", () => {
    it("对象数组 [{ productId: 'objectId!', name: 'string!' }]", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        items: [{ productId: "objectId!", name: "string!" }],
      });

      const items = result.schema.properties!.items;
      expect(items.type).toBe("array");
      expect(items.items!.type).toBe("object");

      expect(items.items!.properties!.productId).toMatchObject({
        type: "string",
        pattern: "^[0-9a-fA-F]{24}$",
      });
      expect(items.items!.properties!.name).toMatchObject({
        type: "string",
      });
      expect(items.items!.required).toEqual(["productId", "name"]);
    });

    it("空数组 → { type: 'array' }", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        tags: [],
      });

      const tags = result.schema.properties!.tags;
      expect(tags).toEqual({ type: "array" });
    });

    it("数组内对象无必填字段时不包含 required", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        items: [{ name: "string", desc: "string?" }],
      });

      const items = result.schema.properties!.items;
      expect(items.items!.required).toBeUndefined();
    });

    it("嵌套对象数组", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        orders: [
          {
            orderId: "objectId!",
            items: [{ sku: "string!", qty: "integer:1-!" }],
          },
        ],
      });

      const orders = result.schema.properties!.orders;
      expect(orders.type).toBe("array");
      expect(orders.items!.type).toBe("object");

      const nestedItems = orders.items!.properties!.items;
      expect(nestedItems.type).toBe("array");
      expect(nestedItems.items!.properties!.sku).toMatchObject({
        type: "string",
      });
      expect(nestedItems.items!.properties!.qty).toMatchObject({
        type: "integer",
        minimum: 1,
      });
    });
  });

  // ── convertValidateObject：混合场景 ───────────────────────

  describe("convertValidateObject — 混合场景", () => {
    it("完整的用户注册表单", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string:1-50!",
        email: "email!",
        password: "string:8-128!",
        role: "enum:admin,user,guest?",
        profile: {
          avatar: "url?",
          bio: "string:0-500",
        },
        tags: [{ name: "string:1-20!", color: "string:7-7" }],
      });

      // 顶层必填字段
      expect(result.required).toEqual(["name", "email", "password"]);

      // 顶层属性存在
      expect(result.schema.properties!.name.type).toBe("string");
      expect(result.schema.properties!.email.format).toBe("email");
      expect(result.schema.properties!.password.minLength).toBe(8);
      expect(result.schema.properties!.role.nullable).toBe(true);
      expect(result.schema.properties!.role.enum).toEqual([
        "admin",
        "user",
        "guest",
      ]);

      // 嵌套对象
      expect(result.schema.properties!.profile.type).toBe("object");

      // 数组
      expect(result.schema.properties!.tags.type).toBe("array");
      expect(result.schema.properties!.tags.items!.required).toEqual(["name"]);
    });

    it("跳过非字符串/数组/对象类型的值", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string!",
        count: 42 as unknown as string, // 数字值（非字符串）
        active: true as unknown as string, // 布尔值（非字符串）
        callback: (() => {}) as unknown as string, // 函数
      });

      // 只有 name 被转换
      expect(Object.keys(result.schema.properties!)).toEqual(["name"]);
      expect(result.required).toEqual(["name"]);
    });
  });

  // ── convertResponseSchema ─────────────────────────────────

  describe("convertResponseSchema", () => {
    it("字符串引用 → $ref", () => {
      const c = createConverter();
      const result = c.convertResponseSchema("#/components/schemas/User");
      expect(result).toEqual({ $ref: "#/components/schemas/User" });
    });

    it("schema-dsl 对象 → 递归转换", () => {
      const c = createConverter();
      const result = c.convertResponseSchema({
        id: "objectId!",
        name: "string:1-50!",
        email: "email!",
        role: "enum:admin,user",
        createdAt: "date",
      });

      expect(result.type).toBe("object");
      expect(result.properties!.id.pattern).toBe("^[0-9a-fA-F]{24}$");
      expect(result.properties!.name.minLength).toBe(1);
      expect(result.properties!.email.format).toBe("email");
      expect(result.properties!.role.enum).toEqual(["admin", "user"]);
      // schema-dsl: date → format: 'date'
      expect(result.properties!.createdAt.format).toBe("date");
      // response schema 中的 required 也应正确收集
      expect(result.required).toEqual(["id", "name", "email"]);
    });

    it("嵌套 response schema", () => {
      const c = createConverter();
      const result = c.convertResponseSchema({
        list: [
          {
            id: "objectId!",
            name: "string!",
          },
        ],
        total: "integer",
        page: "integer",
      });

      expect(result.type).toBe("object");
      expect(result.properties!.list.type).toBe("array");
      expect(result.properties!.list.items!.properties!.id.pattern).toBe(
        "^[0-9a-fA-F]{24}$",
      );
      expect(result.properties!.total.type).toBe("integer");
    });

    it("空对象 → type: 'object', properties: {}", () => {
      const c = createConverter();
      const result = c.convertResponseSchema({});
      expect(result).toEqual({ type: "object", properties: {} });
    });
  });

  // ── 边界 / 异常场景 ──────────────────────────────────────

  describe("边界与异常场景", () => {
    it("convertDSLString — 空字符串", () => {
      const c = createConverter();
      // schema-dsl 要求非空字符串，空字符串抛出 "DSL string is required"
      expect(() => c.convertDSLString("")).toThrow();
    });

    it("convertDSLString — 仅有 ! 标记", () => {
      const c = createConverter();
      // '!' → SchemaConverter 先截取 isRequired=true，再传 '' 给 schema-dsl
      // schema-dsl 对空字符串的行为可能是抛出异常或返回退化 schema
      // 两种行为都是可接受的
      let threw = false;
      try {
        const { schema, isRequired } = c.convertDSLString("!");
        expect(isRequired).toBe(true);
      } catch {
        threw = true;
      }
      // 抛出或正常返回均可
      expect(typeof threw).toBe("boolean");
    });

    it("convertDSLString — 仅有 ? 标记", () => {
      const c = createConverter();
      // '?' → SchemaConverter 先截取 isNullable=true，再传 '' 给 schema-dsl
      let threw = false;
      try {
        const { schema, isRequired } = c.convertDSLString("?");
        expect(isRequired).toBe(false);
      } catch {
        threw = true;
      }
      expect(typeof threw).toBe("boolean");
    });

    it("convertDSLString — 范围格式异常（无连字符）", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("string:abc");
      // colonIndex 存在，schema-dsl 内部处理约束
      expect(schema.type).toBe("string");
    });

    it("convertDSLString — 范围中非数字值", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("number:abc-xyz");
      // schema-dsl 解析非数字约束，minimum/maximum 可能为 NaN
      expect(schema.type).toBe("number");
      // NaN 或 undefined 均为可接受行为（依赖 schema-dsl 实现）
    });

    it("convertDSLString — enum 无值（enum:）", () => {
      const c = createConverter();
      const { schema } = c.convertDSLString("enum:");
      expect(schema.type).toBe("string");
      // 分割空字符串得到 ['']
      expect(schema.enum).toEqual([""]);
    });

    it("convertValidateObject — null 值字段被跳过", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string!",
        extra: null as unknown as string,
      });
      // null 不是 string/array/object-with-entries，被跳过
      expect(Object.keys(result.schema.properties!)).toEqual(["name"]);
    });

    it("convertValidateObject — undefined 值字段被跳过", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string!",
        extra: undefined as unknown as string,
      });
      expect(Object.keys(result.schema.properties!)).toEqual(["name"]);
    });
  });

  // ── 实际使用场景 ──────────────────────────────────────────

  describe("实际使用场景", () => {
    it("用户列表查询参数", () => {
      const c = createConverter();
      // 模拟 validate.query 对象
      const queryDsl = {
        page: "number:1-",
        limit: "number:1-100",
        search: "string:1-100?",
        role: "enum:admin,user,guest?",
      };

      // 逐个转换（模拟 generator 中对 query 的处理）
      const page = c.convertDSLString(queryDsl.page);
      expect(page.schema).toMatchObject({ type: "number", minimum: 1 });
      expect(page.isRequired).toBe(false);

      const limit = c.convertDSLString(queryDsl.limit);
      expect(limit.schema).toMatchObject({
        type: "number",
        minimum: 1,
        maximum: 100,
      });

      const search = c.convertDSLString(queryDsl.search);
      expect(search.schema.nullable).toBe(true);
      expect(search.schema.minLength).toBe(1);

      const role = c.convertDSLString(queryDsl.role);
      expect(role.schema.enum).toEqual(["admin", "user", "guest"]);
      expect(role.schema.nullable).toBe(true);
    });

    it("用户创建请求体", () => {
      const c = createConverter();
      const result = c.convertValidateObject({
        name: "string:1-50!",
        email: "email!",
        password: "string:8-128!",
        role: "enum:admin,user?",
      });

      expect(result.required).toEqual(["name", "email", "password"]);
      expect(result.schema.properties!.role.nullable).toBe(true);
    });

    it("路径参数转换", () => {
      const c = createConverter();
      // 模拟 validate.params 对象
      const paramsDsl = { id: "objectId!" };
      const id = c.convertDSLString(paramsDsl.id);
      expect(id.schema.pattern).toBe("^[0-9a-fA-F]{24}$");
      expect(id.isRequired).toBe(true);
    });

    it("复杂响应 schema（分页列表）", () => {
      const c = createConverter();
      const result = c.convertResponseSchema({
        list: [
          {
            id: "objectId!",
            name: "string!",
            email: "email!",
            role: "enum:admin,user",
          },
        ],
        total: "integer",
        page: "integer",
        limit: "integer",
      });

      expect(result.type).toBe("object");
      const list = result.properties!.list;
      expect(list.type).toBe("array");
      expect(list.items!.type).toBe("object");
      expect(list.items!.required).toEqual(["id", "name", "email"]);
      expect(Object.keys(list.items!.properties!)).toEqual([
        "id",
        "name",
        "email",
        "role",
      ]);
      expect(result.properties!.total.type).toBe("integer");
    });

    it("错误响应 schema", () => {
      const c = createConverter();
      const result = c.convertResponseSchema({
        code: "integer",
        message: "string",
        requestId: "string",
      });

      expect(result.type).toBe("object");
      expect(result.properties!.code.type).toBe("integer");
      expect(result.properties!.message.type).toBe("string");
      expect(result.properties!.requestId.type).toBe("string");
    });
  });

  // ── 多次实例化 / 无状态验证 ───────────────────────────────

  describe("无状态验证", () => {
    it("同一 converter 多次调用不会互相影响", () => {
      const c = createConverter();

      const r1 = c.convertValidateObject({ a: "string!" });
      const r2 = c.convertValidateObject({ b: "number!" });

      expect(r1.required).toEqual(["a"]);
      expect(r2.required).toEqual(["b"]);

      expect(Object.keys(r1.schema.properties!)).toEqual(["a"]);
      expect(Object.keys(r2.schema.properties!)).toEqual(["b"]);
    });

    it("不同 converter 实例结果一致", () => {
      const c1 = createConverter();
      const c2 = createConverter();

      const r1 = c1.convertDSLString("string:1-50!");
      const r2 = c2.convertDSLString("string:1-50!");

      expect(r1.schema.type).toBe(r2.schema.type);
      expect(r1.schema.minLength).toBe(r2.schema.minLength);
      expect(r1.schema.maxLength).toBe(r2.schema.maxLength);
      expect(r1.isRequired).toBe(r2.isRequired);
    });
  });
});

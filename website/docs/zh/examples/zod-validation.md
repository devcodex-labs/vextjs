# Zod 校验集成

本示例展示如何使用 [Zod](https://zod.dev) 替换 VextJS 内置的 schema-dsl 校验引擎。通过编写一个 Zod 校验插件，你可以在路由的 `validate` 配置中直接使用 Zod schema，获得更强大的类型推断和校验能力。

## 为什么选择 Zod？

| 特性                | 内置 schema-dsl         | Zod                                  |
| ------------------- | ----------------------- | ------------------------------------ |
| 学习曲线            | 低（DSL 字符串语法）    | 中（链式 API）                       |
| TypeScript 类型推断 | ❌ 无（需手动声明泛型） | ✅ 自动推断 `z.infer<T>`             |
| 复杂校验            | 基础类型 + 范围 + 枚举  | 联合类型、递归、transform、refine 等 |
| 生态                | VextJS 专属             | 广泛使用，社区生态丰富               |
| 包体积              | 0（框架内置）           | ~14KB (min+gzip)                     |

:::tip
如果你的项目只需要简单的参数校验（字符串/数字/枚举/邮箱等），内置的 schema-dsl 已经足够。Zod 更适合需要复杂校验逻辑、深度类型推断或已在项目中使用 Zod 的场景。
:::

## 项目结构

```
zod-validation/
  ├── src/
  │   ├── config/
  │   │   └── default.ts
  │   ├── plugins/
  │   │   └── zod-validator.ts     ← Zod 校验插件
  │   ├── routes/
  │   │   ├── index.ts
  │   │   └── users.ts
  │   ├── services/
  │   │   └── user.ts
  │   ├── schemas/                  ← Zod schema 定义
  │   │   └── user.ts
  │   └── index.ts
  ├── package.json
  └── tsconfig.json
```

## 1. 安装依赖

```bash
npx vextjs create zod-validation
cd zod-validation
pnpm add zod
```

## 2. Zod 校验插件

核心思路：通过 `app.setValidator()` 替换内置的 schema-dsl 校验引擎。`VextValidator` 接口要求实现 `compile(schema)` 方法，返回一个校验函数。

```typescript
// src/plugins/zod-validator.ts
import { definePlugin } from "vextjs";
import { z, ZodType } from "zod";

/**
 * Zod 校验插件
 *
 * 替换内置 schema-dsl 校验引擎，使路由 validate 配置支持字段级 Zod schema。
 *
 * 使用方式：
 *   validate: {
 *     body: userCreateSchema.shape,   // 字段级 Zod schema 对象
 *     query: paginationSchema.shape,
 *   }
 *
 * 校验流程：
 *   1. compile(schema) 接收原始 schema 对象
 *   2. 检查 schema 的每个字段是否为 ZodType 实例
 *   3. 如果是 Zod schema，使用 safeParse 进行校验
 *   4. 如果不是（普通对象），回退到原始校验器（兼容 schema-dsl）
 */
export default definePlugin({
  name: "zod-validator",
  setup(app) {
    // 保存原始校验器，用于回退
    const originalValidator = app.getValidator();

    app.setValidator({
      compile(schema: Record<string, unknown>) {
        // ── 判断 schema 是否为 Zod schema ──────────────────
        //
        // 路由 validate 的每个位置（query/body/param/header）都是一个独立的 schema。
        // 如果传入的是 ZodType 实例，使用 Zod 校验。
        // 否则回退到原始 schema-dsl 校验器（保持向后兼容）。

        if (schema instanceof ZodType) {
          // ── Zod 校验路径 ─────────────────────────────────
          const zodSchema = schema;

          return (data: unknown) => {
            const result = zodSchema.safeParse(data);

            if (result.success) {
              return {
                valid: true,
                data: result.data,
              };
            }

            // 转换 Zod 错误格式为 VextJS 标准格式
            return {
              valid: false,
              errors: result.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
              })),
            };
          };
        }

        // ── 检查 schema 对象的字段是否包含 Zod 实例 ─────────
        //
        // 支持 validate: { body: { name: z.string(), age: z.number() } }
        // 这种「对象字段为 Zod」的混合模式。
        // 这种写法与 RouteOptions.validate 的公开类型保持一致。

        const hasZodFields = Object.values(schema).some(
          (v) => v instanceof ZodType,
        );

        if (hasZodFields) {
          // 将散落的 Zod 字段收集为 z.object
          const shape: Record<string, ZodType> = {};

          for (const [key, value] of Object.entries(schema)) {
            if (value instanceof ZodType) {
              shape[key] = value;
            } else {
              // 非 Zod 字段，包装为 z.any()
              shape[key] = z.any();
            }
          }

          const objectSchema = z.object(shape);

          return (data: unknown) => {
            const result = objectSchema.safeParse(data);

            if (result.success) {
              return {
                valid: true,
                data: result.data,
              };
            }

            return {
              valid: false,
              errors: result.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
              })),
            };
          };
        }

        // ── 回退到原始 schema-dsl 校验器 ───────────────────
        return originalValidator.compile(schema);
      },
    });

    app.logger.info("[zod-validator] Zod 校验插件已注册");
  },
});
```

:::tip
这个插件**向后兼容** schema-dsl。你可以在同一个项目中混合使用 Zod schema 和 schema-dsl DSL 字符串。对于非 Zod 的 schema（如 `{ name: 'string:1-50' }`），插件会自动回退到内置校验引擎。
:::

## 3. 定义 Zod Schema

将 Zod schema 集中管理在 `src/schemas/` 目录下，方便复用和维护。

```typescript
// src/schemas/user.ts
import { z } from "zod";

// ── 基础字段 schema ──────────────────────────────────────

/** 用户 ID（路径参数） */
export const userIdParam = z.object({
  id: z.string().min(1, "ID 不能为空"),
});

/** 分页查询参数 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1, "页码最小值为 1").default(1),
  limit: z.coerce.number().int().min(1).max(100, "每页最多 100 条").default(10),
  keyword: z.string().optional(),
});

// ── 用户 CRUD schema ────────────────────────────────────

/** 创建用户 */
export const createUserBody = z.object({
  name: z.string().min(1, "姓名不能为空").max(50, "姓名最长 50 个字符").trim(),
  email: z.string().email("邮箱格式无效").toLowerCase(),
  age: z
    .number()
    .int("年龄必须为整数")
    .min(0, "年龄不能为负数")
    .max(200, "年龄不能超过 200")
    .optional(),
  role: z
    .enum(["admin", "user", "editor"], {
      errorMap: () => ({ message: "角色必须为 admin、user 或 editor" }),
    })
    .default("user"),
  tags: z.array(z.string().min(1).max(20)).max(10, "最多 10 个标签").optional(),
  profile: z
    .object({
      bio: z.string().max(500, "简介最长 500 个字符").optional(),
      avatar: z.string().url("头像必须为有效 URL").optional(),
      website: z.string().url("网站必须为有效 URL").optional(),
    })
    .optional(),
});

/** 更新用户（所有字段可选） */
export const updateUserBody = createUserBody
  .partial() // 所有字段变为可选
  .omit({ role: true }) // 不允许通过更新接口修改角色
  .refine((data) => Object.keys(data).length > 0, {
    message: "至少需要提供一个要更新的字段",
  });

/** 批量操作 */
export const batchDeleteBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "至少选择一个用户")
    .max(50, "单次最多删除 50 个"),
});

// ── 导出推断类型 ─────────────────────────────────────────

/** 从 Zod schema 推断 TypeScript 类型 */
export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type PaginationInput = z.infer<typeof paginationQuery>;
export type BatchDeleteInput = z.infer<typeof batchDeleteBody>;
```

:::tip
**`z.coerce.number()`** 是 Zod 的类型强制转换，会自动将字符串 `'10'` 转换为数字 `10`。这对于查询参数（始终为字符串）特别有用，与 schema-dsl 的自动类型转换行为一致。
:::

## 4. 配置

```typescript
// src/config/default.ts
export default {
  port: 3000,
  adapter: "native",
  logger: {
    level: "debug",
    pretty: true,
  },
  cors: {
    enabled: true,
    origins: ["*"],
  },
  response: {
    wrap: true,
    hideInternalErrors: false,
  },
  openapi: {
    enabled: true,
    title: "Zod Validation 示例",
    version: "1.0.0",
    description: "使用 Zod 进行参数校验的 VextJS 示例",
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    guardSecurityMap: {
      auth: "bearerAuth",
    },
  },
  middlewares: [{ name: "auth" }],
};
```

## 5. 路由（使用 Zod Schema）

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";
import {
  userIdParam,
  paginationQuery,
  createUserBody,
  updateUserBody,
  batchDeleteBody,
} from "../schemas/user.js";
import type { CreateUserInput, UpdateUserInput } from "../schemas/user.js";

export default defineRoutes((app) => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GET /users/list — 分页查询
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get(
    "/list",
    {
      validate: {
        query: paginationQuery, // ← Zod schema
      },
      docs: {
        summary: "用户列表",
        description: "分页查询用户列表，支持按姓名或邮箱模糊搜索。",
        tags: ["用户"],
      },
    },
    async (req, res) => {
      // req.valid() 返回的数据已经过 Zod 校验和 transform
      // page/limit 已从字符串自动转换为数字（z.coerce.number()）
      // keyword 为 string | undefined
      const { page, limit, keyword } = req.valid("query");

      const result = await app.services.user.findAll({ page, limit, keyword });
      res.json(result);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GET /users/:id — 查询详情
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get(
    "/:id",
    {
      validate: {
        param: userIdParam, // ← Zod schema
      },
      docs: {
        summary: "获取用户详情",
        tags: ["用户"],
        responses: {
          200: { description: "查询成功" },
          404: { description: "用户不存在" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);

      if (!user) {
        app.throw(404, "用户不存在");
      }

      res.json(user);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // POST /users — 创建用户
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.post(
    "/",
    {
      validate: {
        body: createUserBody, // ← Zod schema
      },
      middlewares: ["auth"],
      docs: {
        summary: "创建用户",
        description: "创建新用户。支持标签和个人资料等复杂嵌套结构。",
        tags: ["用户"],
        responses: {
          201: {
            description: "创建成功",
            example: {
              id: "4",
              name: "Diana",
              email: "diana@example.com",
              role: "user",
              tags: ["developer"],
              profile: { bio: "Hello!" },
            },
          },
          422: { description: "参数校验失败" },
          401: { description: "未认证" },
          409: { description: "邮箱已注册" },
        },
      },
    },
    async (req, res) => {
      // Zod 已自动：
      //   - trim() 了 name
      //   - toLowerCase() 了 email
      //   - 设置了 role 默认值 'user'
      //   - 校验了 tags 数组长度和元素格式
      //   - 校验了 profile 嵌套对象的 URL 格式
      const body = req.valid<CreateUserInput>("body");

      const user = await app.services.user.create(body);
      res.json(user, 201);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUT /users/:id — 更新用户
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.put(
    "/:id",
    {
      validate: {
        param: userIdParam,
        body: updateUserBody, // ← partial() + refine()
      },
      middlewares: ["auth"],
      docs: {
        summary: "更新用户",
        description:
          "更新用户信息。所有字段可选，但至少需要提供一个字段。不允许修改角色。",
        tags: ["用户"],
        responses: {
          200: { description: "更新成功" },
          422: { description: "参数校验失败（或未提供任何字段）" },
          401: { description: "未认证" },
          404: { description: "用户不存在" },
          409: { description: "邮箱已被其他用户使用" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      // updateUserBody 使用了 .partial().omit({ role: true }).refine(...)
      // Zod 确保了至少有一个字段，且不包含 role
      const body = req.valid<UpdateUserInput>("body");

      const user = await app.services.user.update(id, body);
      res.json(user);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DELETE /users/:id — 删除用户
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.delete(
    "/:id",
    {
      validate: {
        param: userIdParam,
      },
      middlewares: ["auth"],
      docs: {
        summary: "删除用户",
        tags: ["用户"],
        responses: {
          204: { description: "删除成功" },
          401: { description: "未认证" },
          404: { description: "用户不存在" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      await app.services.user.delete(id);
      res.status(204).json(null);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // POST /users/batch-delete — 批量删除
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.post(
    "/batch-delete",
    {
      validate: {
        body: batchDeleteBody, // ← 数组校验
      },
      middlewares: ["auth"],
      docs: {
        summary: "批量删除用户",
        description: "批量删除多个用户。单次最多 50 个。",
        tags: ["用户"],
        responses: {
          200: { description: "批量删除结果" },
          422: { description: "参数校验失败" },
          401: { description: "未认证" },
        },
      },
    },
    async (req, res) => {
      const { ids } = req.valid("body");

      const results = {
        deleted: [] as string[],
        notFound: [] as string[],
      };

      for (const id of ids) {
        try {
          await app.services.user.delete(id);
          results.deleted.push(id);
        } catch {
          results.notFound.push(id);
        }
      }

      res.json(results);
    },
  );
});
```

## 6. 服务层

```typescript
// src/services/user.ts
import type { VextApp, VextLogger } from "vextjs";
import type { CreateUserInput, UpdateUserInput } from "../schemas/user.js";

interface User {
  id: string;
  name: string;
  email: string;
  age?: number;
  role: string;
  tags?: string[];
  profile?: {
    bio?: string;
    avatar?: string;
    website?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export default class UserService {
  private logger: VextLogger;
  private users: Map<string, User> = new Map();
  private nextId = 1;

  constructor(private app: VextApp) {
    this.logger = app.logger.child({ service: "UserService" });
    this.seed();
  }

  private seed(): void {
    const seedUsers: Partial<User>[] = [
      {
        name: "Alice",
        email: "alice@example.com",
        age: 28,
        role: "admin",
        tags: ["管理员"],
      },
      { name: "Bob", email: "bob@example.com", age: 32, role: "user" },
      {
        name: "Charlie",
        email: "charlie@example.com",
        role: "editor",
        profile: { bio: "编辑" },
      },
    ];

    for (const u of seedUsers) {
      const id = String(this.nextId++);
      const now = new Date().toISOString();
      this.users.set(id, { id, ...u, createdAt: now, updatedAt: now } as User);
    }
  }

  async findAll(options: { page: number; limit: number; keyword?: string }) {
    let allUsers = Array.from(this.users.values());

    if (options.keyword) {
      const kw = options.keyword.toLowerCase();
      allUsers = allUsers.filter(
        (u) =>
          u.name.toLowerCase().includes(kw) ||
          u.email.toLowerCase().includes(kw),
      );
    }

    const total = allUsers.length;
    const start = (options.page - 1) * options.limit;
    const items = allUsers.slice(start, start + options.limit);

    return {
      items,
      total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(total / options.limit),
    };
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async create(data: CreateUserInput): Promise<User> {
    // 邮箱唯一性检查
    for (const user of this.users.values()) {
      if (user.email === data.email) {
        this.app.throw(409, "邮箱已注册", 10001);
      }
    }

    const id = String(this.nextId++);
    const now = new Date().toISOString();

    const user: User = {
      id,
      name: data.name,
      email: data.email,
      age: data.age,
      role: data.role,
      tags: data.tags,
      profile: data.profile,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(id, user);
    this.logger.info({ userId: id, email: data.email }, "用户创建成功");
    return user;
  }

  async update(id: string, data: UpdateUserInput): Promise<User> {
    const user = this.users.get(id);
    if (!user) {
      this.app.throw(404, "用户不存在");
    }

    if (data.email && data.email !== user.email) {
      for (const u of this.users.values()) {
        if (u.email === data.email) {
          this.app.throw(409, "邮箱已被其他用户使用", 10002);
        }
      }
    }

    const updated: User = {
      ...user,
      ...data,
      // 深度合并 profile
      profile: data.profile
        ? { ...user.profile, ...data.profile }
        : user.profile,
      updatedAt: new Date().toISOString(),
    };

    this.users.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.users.has(id)) {
      this.app.throw(404, "用户不存在");
    }
    this.users.delete(id);
  }
}
```

## 7. 入口文件

```typescript
// src/index.ts
import { bootstrap } from "vextjs";

bootstrap().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
```

## 8. 运行与验证

```bash
# 启动开发服务器
pnpm dev
```

### 测试校验

```bash
# ✅ 正常创建（Zod 自动 trim name + toLowerCase email）
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{
    "name": "  Diana  ",
    "email": "Diana@EXAMPLE.COM",
    "age": 25,
    "tags": ["developer", "designer"],
    "profile": { "bio": "全栈开发者", "website": "https://diana.dev" }
  }'
# → 201
# name 被 trim 为 "Diana"
# email 被 toLowerCase 为 "diana@example.com"
# role 默认设为 "user"

# ❌ 嵌套对象校验 — profile.avatar 非 URL
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{
    "name": "Eve",
    "email": "eve@example.com",
    "profile": { "avatar": "not-a-url" }
  }'
# → 422 {"errors":[{"field":"profile.avatar","message":"头像必须为有效 URL"}]}

# ❌ 数组长度校验 — 超过 10 个标签
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{
    "name": "Eve",
    "email": "eve@example.com",
    "tags": ["1","2","3","4","5","6","7","8","9","10","11"]
  }'
# → 422 {"errors":[{"field":"tags","message":"最多 10 个标签"}]}

# ❌ refine 校验 — 更新时未提供任何字段
curl -X PUT http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{}'
# → 422 {"errors":[{"field":"","message":"至少需要提供一个要更新的字段"}]}

# ❌ omit 校验 — 更新时尝试修改角色（被 omit 移除）
curl -X PUT http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"role": "admin", "name": "Alice Updated"}'
# → 200 但 role 字段被忽略（Zod strip 未知字段），只有 name 被更新

# ❌ 枚举校验 — 无效的角色值
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"name":"Frank","email":"frank@example.com","role":"superadmin"}'
# → 422 {"errors":[{"field":"role","message":"角色必须为 admin、user 或 editor"}]}

# ✅ 查询参数自动类型转换（z.coerce.number）
curl "http://localhost:3000/users/list?page=2&limit=5"
# → page 自动从字符串 "2" 转为数字 2

# ✅ 批量删除
curl -X POST http://localhost:3000/users/batch-delete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"ids": ["1", "2", "999"]}'
# → {"code":0,"data":{"deleted":["1","2"],"notFound":["999"]},...}
```

## Zod 高级技巧

### Transform（数据转换）

```typescript
import { z } from "zod";

// 查询参数：逗号分隔字符串 → 数组
const searchQuery = z.object({
  ids: z
    .string()
    .transform((val) => val.split(",").filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(1))
    .optional(),
  sort: z
    .string()
    .regex(/^[a-zA-Z]+:(asc|desc)$/, "排序格式：field:asc 或 field:desc")
    .transform((val) => {
      const [field, order] = val.split(":");
      return { field, order: order as "asc" | "desc" };
    })
    .optional(),
});

// 使用
app.get("/search", { validate: { query: searchQuery } }, async (req, res) => {
  const { ids, sort } = req.valid("query");
  // ids: string[] | undefined
  // sort: { field: string, order: 'asc' | 'desc' } | undefined
});
```

### Discriminated Union（区分联合类型）

```typescript
import { z } from "zod";

// 根据 type 字段使用不同的校验规则
const notificationBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("email"),
    to: z.string().email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1),
  }),
  z.object({
    type: z.literal("sms"),
    phone: z.string().regex(/^\+?[\d\s-]{10,15}$/),
    message: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal("push"),
    deviceToken: z.string().min(1),
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(500),
  }),
]);

app.post("/notify", { validate: { body: notificationBody } }, handler);
```

### Preprocess（预处理）

```typescript
import { z } from "zod";

// 处理 "true" / "false" 字符串到布尔值的转换（常见于查询参数）
const filterQuery = z
  .object({
    active: z.preprocess((val) => {
      if (val === "true") return true;
      if (val === "false") return false;
      return val;
    }, z.boolean().optional()),
    minAge: z.coerce.number().int().min(0).optional(),
    maxAge: z.coerce.number().int().max(200).optional(),
  })
  .refine(
    (data) => {
      if (data.minAge !== undefined && data.maxAge !== undefined) {
        return data.minAge <= data.maxAge;
      }
      return true;
    },
    { message: "minAge 必须小于等于 maxAge", path: ["minAge"] },
  );
```

### 复用与组合

```typescript
import { z } from "zod";

// 基础 schema
const addressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(50),
  state: z.string().min(1).max(50),
  zip: z.string().regex(/^\d{6}$/, "邮编必须为 6 位数字"),
  country: z.string().min(1).max(50).default("中国"),
});

// 组合使用
const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
        price: z.number().positive(),
      }),
    )
    .min(1, "至少需要一个商品"),
  shippingAddress: addressSchema,
  billingAddress: addressSchema.optional(), // 可选，复用同一个 schema
  note: z.string().max(500).optional(),
});

// 从已有 schema 推断类型
type Order = z.infer<typeof orderSchema>;
type Address = z.infer<typeof addressSchema>;
```

## 与 schema-dsl 混合使用

Zod 插件支持在同一个项目中同时使用 Zod 和 schema-dsl：

```typescript
// 这个路由使用 Zod
app.post(
  "/users",
  {
    validate: {
      body: createUserBody.shape, // ← 字段级 Zod schema
      query: paginationQuery.shape, // ← 字段级 Zod schema
    },
  },
  handler,
);

// 这个路由使用 schema-dsl（自动回退）
app.get(
  "/health",
  {
    validate: {
      query: {
        verbose: "boolean?", // ← schema-dsl 字符串
      },
    },
  },
  handler,
);
```

插件内部会自动检测 schema 类型：字段值为 Zod 实例时走 Zod 校验路径，普通 schema-dsl 对象走默认校验路径。

## 关键对比

| 场景         | schema-dsl                | Zod                                            |
| ------------ | ------------------------- | ---------------------------------------------- |
| 简单字段校验 | `name: 'string:1-50'`     | `z.string().min(1).max(50)`                    |
| 可选字段     | `age: 'number?'`          | `z.number().optional()`                        |
| 枚举         | `role: 'enum:admin,user'` | `z.enum(['admin', 'user'])`                    |
| 邮箱         | `email: 'email'`          | `z.string().email()`                           |
| 嵌套对象     | ❌ 不支持                 | `z.object({ profile: z.object({...}) })`       |
| 数组校验     | `tags: 'array'`           | `z.array(z.string()).max(10)`                  |
| 联合类型     | ❌ 不支持                 | `z.union([...])` / `z.discriminatedUnion(...)` |
| 自定义校验   | ❌ 不支持                 | `.refine()` / `.superRefine()`                 |
| 数据转换     | 仅类型转换                | `.transform()` / `.preprocess()`               |
| 默认值       | ❌ 不支持                 | `.default()`                                   |
| 类型推断     | ❌ 需手动声明             | ✅ `z.infer<typeof schema>`                    |

## 下一步

- 📖 [Drizzle ORM 集成](/examples/drizzle-orm) — 接入类型安全的 ORM
- 📖 [Prisma ORM 集成](/examples/prisma-orm) — 接入 Prisma 数据库工具
- 📖 [参数校验](/guide/validation) — 深入了解内置 schema-dsl 校验
- 📖 [插件](/guide/plugins) — 了解插件开发的更多细节
- 📖 [测试](/guide/testing) — 使用 createTestApp 测试 Zod 校验

# 路由定义

本页详细介绍 VextJS 的路由定义 API，包括 `defineRoutes`、路由选项、参数校验、中间件引用和文档配置。

## defineRoutes

`defineRoutes` 是创建路由文件的核心函数。它接收一个工厂回调，在回调中通过 `app` 对象注册路由。

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/hello", async (req, res) => {
    res.json({ message: "Hello World" });
  });
});
```

### 函数签名

```typescript
function defineRoutes(factory: RouteFactory): RouteDefinition;

type RouteFactory = (app: VextApp) => void;
```

### 工作原理

1. `defineRoutes(factory)` 被调用时，内部创建一个 **collector**（路由收集器）
2. `factory(collector)` 被执行，用户代码中的 `app.get/post/...` 实际调用 collector 的方法
3. 每条路由被推入内部的 `routes` 数组
4. 返回 `RouteDefinition` 对象
5. `router-loader` 扫描 `src/routes/` 目录，对每个文件的 `default export` 调用 `register()` 注册到底层适配器

:::tip
在 factory 回调中，`app` 不仅有 HTTP 方法（`get/post/put/...`），还可以访问 `app.services`、`app.config`、`app.throw`、`app.logger` 等完整能力。这些属性由 `router-loader` 在执行 factory 前注入。
:::

---

## 路由注册语法

VextJS 支持**三段式**和**两段式**两种路由注册语法。

### 三段式（推荐）

```typescript
app.method(path, options, handler);
```

带有 `options` 配置的完整语法，支持参数校验、中间件引用、文档配置等：

```typescript
export default defineRoutes((app) => {
  app.post(
    "/users",
    {
      validate: {
        body: { name: "string:1-50", email: "email" },
      },
      middlewares: ["auth"],
      docs: {
        summary: "创建用户",
        tags: ["用户"],
      },
    },
    async (req, res) => {
      const data = req.valid("body");
      const user = await app.services.user.create(data);
      res.json(user, 201);
    },
  );
});
```

### 两段式

```typescript
app.method(path, handler);
```

无 `options` 的简化语法，适用于不需要校验、中间件或文档配置的简单路由：

```typescript
export default defineRoutes((app) => {
  app.get("/health", async (_req, res) => {
    res.json({ status: "ok" });
  });
});
```

### 支持的 HTTP 方法

| 方法                     | 说明         |
| ------------------------ | ------------ |
| `app.get(path, ...)`     | GET 请求     |
| `app.post(path, ...)`    | POST 请求    |
| `app.put(path, ...)`     | PUT 请求     |
| `app.patch(path, ...)`   | PATCH 请求   |
| `app.delete(path, ...)`  | DELETE 请求  |
| `app.head(path, ...)`    | HEAD 请求    |
| `app.options(path, ...)` | OPTIONS 请求 |

---

## 路由路径

### 静态路径

```typescript
app.get("/users", handler);
app.get("/users/profile", handler);
```

### 动态参数

使用 `:paramName` 定义动态路径参数，通过 `req.params` 或 `req.valid('param')` 访问：

```typescript
app.get(
  "/users/:id",
  {
    validate: {
      param: { id: "string:1-" },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const user = await app.services.user.findById(id);
    res.json(user);
  },
);
```

### 通配符

```typescript
app.get("/files/*", async (req, res) => {
  // req.params['*'] 包含通配符匹配的部分
  res.json({ path: req.params["*"] });
});
```

### 文件路由映射

路由文件的目录路径自动映射为 URL 前缀：

| 文件路径                   | URL 前缀      | 示例                                   |
| -------------------------- | ------------- | -------------------------------------- |
| `src/routes/users.ts`      | `/users`      | `app.get('/list')` → `GET /users/list` |
| `src/routes/api/orders.ts` | `/api/orders` | `app.post('/')` → `POST /api/orders`   |
| `src/routes/index.ts`      | `/`           | `app.get('/health')` → `GET /health`   |

:::tip
路由文件中注册的 `path` 是**相对子路径**，框架自动拼接文件路径前缀。例如 `src/routes/users.ts` 中的 `app.get('/:id')` 最终注册为 `GET /users/:id`。
:::

---

## RouteOptions

路由三段式语法的第二个参数，声明式配置对象。

```typescript
interface RouteOptions {
  validate?: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    param?: Record<string, unknown>;
    header?: Record<string, unknown>;
  };
  middlewares?: VextMiddlewareRef[];
  docs?: RouteDocsConfig;
  multipart?: {
    files?: Record<string, string | { description?: string; required?: boolean }>;
  };
  override?: {
    rateLimit?: { max?: number; window?: number; keyBy?: string } | false;
    timeout?: number;
    maxBodySize?: string | number;
    cors?: VextCorsConfig;
  };
}
```

### 完整示例

```typescript
app.put(
  "/users/:id",
  {
    validate: {
      param: { id: "string:1-" },
      body: {
        name: "string:1-50",
        email: "email",
        age: "number:0-200?",
      },
    },
    middlewares: ["auth", { name: "cache", options: { ttl: 0 } }],
    docs: {
      summary: "更新用户",
      tags: ["用户"],
      responses: {
        200: { description: "更新成功" },
        404: { description: "用户不存在" },
      },
    },
    override: {
      rateLimit: { max: 10, window: 60 },
      maxBodySize: "5mb",
    },
  },
  handler,
);
```

---

## validate

声明式参数校验，基于 `schema-dsl` DSL 语法。框架自动在 handler 执行前进行校验，校验失败返回 `400` 错误。

### 校验位置

| 位置     | 数据源        | 说明                      |
| -------- | ------------- | ------------------------- |
| `param`  | `req.params`  | 路径动态参数（如 `/:id`） |
| `query`  | `req.query`   | URL 查询参数              |
| `header` | `req.headers` | 请求头                    |
| `body`   | `req.body`    | 请求体                    |

**校验执行顺序**：`param` → `query` → `header` → `body`

### 基本用法

```typescript
app.get(
  "/users",
  {
    validate: {
      query: {
        page: "number:1-", // 大于等于 1 的数字
        limit: "number:1-100", // 1 到 100 之间的数字
        keyword: "string?", // 可选字符串
      },
    },
  },
  async (req, res) => {
    const { page, limit, keyword } = req.valid("query");
    // page: number, limit: number, keyword: string | undefined
  },
);
```

### DSL 语法速查

| DSL              | 说明                | 示例                             |
| ---------------- | ------------------- | -------------------------------- |
| `'string'`       | 必填字符串          | `name: 'string'`                 |
| `'string:1-50'`  | 长度 1-50 的字符串  | `name: 'string:1-50'`            |
| `'string?'`      | 可选字符串          | `nickname: 'string?'`            |
| `'number'`       | 必填数字            | `age: 'number'`                  |
| `'number:0-'`    | 大于等于 0 的数字   | `page: 'number:0-'`              |
| `'number:1-100'` | 1 到 100 之间的数字 | `limit: 'number:1-100'`          |
| `'boolean'`      | 必填布尔值          | `active: 'boolean'`              |
| `'email'`        | 邮箱格式            | `email: 'email'`                 |
| `'url'`          | URL 格式            | `website: 'url'`                 |
| `'date'`         | 日期格式            | `birthday: 'date'`               |
| `'uuid'`         | UUID 格式           | `id: 'uuid'`                     |
| `'enum:a,b,c'`   | 枚举值              | `status: 'enum:active,inactive'` |
| `'array'`        | 数组                | `tags: 'array'`                  |
| `'object'`       | 对象                | `metadata: 'object'`             |

:::tip
`schema-dsl` 会自动做**类型转换**。例如查询参数 `?page=2` 中的 `'2'`（字符串）会被自动转换为 `2`（数字），前提是 schema 声明为 `'number'` 类型。
:::

### 获取校验后数据

使用 `req.valid(location)` 获取校验并类型转换后的数据：

```typescript
app.post(
  "/users",
  {
    validate: {
      body: { name: "string:1-50", email: "email" },
      query: { notify: "boolean?" },
    },
  },
  async (req, res) => {
    const body = req.valid("body"); // { name: string, email: string }
    const query = req.valid("query"); // { notify?: boolean }
    // ...
  },
);
```

可以通过泛型获得更精确的类型提示：

```typescript
interface CreateUserBody {
  name: string;
  email: string;
}

const body = req.valid<CreateUserBody>("body");
// body.name  → IDE 知道是 string
// body.email → IDE 知道是 string
```

### 校验失败响应

校验失败时框架自动返回 `400` 状态码：

```json
{
  "code": -1,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "must be a valid email address" },
    { "field": "name", "message": "length must be between 1 and 50" }
  ],
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## middlewares

路由级中间件引用。引用的中间件必须先在 `config.middlewares` 白名单中声明。

### 字符串引用

```typescript
app.get(
  "/profile",
  {
    middlewares: ["auth"],
  },
  handler,
);
```

### 对象引用（带配置覆盖）

```typescript
app.get(
  "/admin/users",
  {
    middlewares: ["auth", { name: "role", options: { required: "admin" } }],
  },
  handler,
);
```

### VextMiddlewareRef 类型

```typescript
type VextMiddlewareRef = string | { name: string; options?: unknown };
```

### 执行顺序

路由级中间件在**全局中间件之后**、**handler 之前**执行：

```
请求 → [全局中间件链] → [路由级中间件] → [validate 中间件] → handler → 响应
```

### 配置白名单

路由中引用的中间件必须在配置文件中声明：

```typescript
// src/config/default.ts
export default {
  middlewares: [
    { name: "auth" },
    { name: "role", options: { required: "user" } },
    { name: "cache", options: { ttl: 300 } },
  ],
};
```

```typescript
// src/middlewares/auth.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    req.app.throw(401, "未提供认证令牌");
  }
  // 验证 token...
  req.user = decoded;
  await next();
});
```

:::warning
引用未在白名单中声明的中间件会在启动时抛出错误：

```
[vextjs] Route GET "/profile" references middleware "auth" which is not
registered in config.middlewares whitelist.
```

:::

---

## docs

OpenAPI 文档配置，控制路由在自动生成的 API 文档中的展示方式。

### RouteDocsConfig

```typescript
interface RouteDocsConfig {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  hidden?: boolean;
  deprecated?: boolean;
  security?: Array<Record<string, string[]>>;
  extensions?: Record<string, unknown>;
  responses?: Record<string | number, ResponseConfig>;
}
```

### 字段说明

| 字段          | 类型       | 默认值              | 说明                          |
| ------------- | ---------- | ------------------- | ----------------------------- |
| `summary`     | `string`   | —                   | 接口一句话摘要                |
| `description` | `string`   | —                   | 接口详细描述（支持 Markdown） |
| `tags`        | `string[]` | 从路由文件路径推断  | 标签分组                      |
| `operationId` | `string`   | 自动推断            | 操作标识（全局唯一）          |
| `hidden`      | `boolean`  | `false`             | 是否从文档中隐藏              |
| `deprecated`  | `boolean`  | `false`             | 是否标记为已废弃              |
| `security`    | `array`    | 从 middlewares 推断 | 安全方案覆盖                  |
| `extensions`  | `object`   | —                   | 自定义 `x-*` 扩展字段         |
| `responses`   | `object`   | —                   | 响应定义                      |

### 完整示例

```typescript
app.post(
  "/users",
  {
    validate: {
      body: {
        name: "string:1-50",
        email: "email",
        role: "enum:admin,user?",
      },
    },
    middlewares: ["auth"],
    docs: {
      summary: "创建用户",
      description: "创建一个新用户账号。需要管理员权限。",
      tags: ["用户管理"],
      operationId: "createUser",
      responses: {
        201: {
          description: "用户创建成功",
          schema: {
            id: "string",
            name: "string",
            email: "email",
            createdAt: "date",
          },
          example: {
            id: "usr_abc123",
            name: "Alice",
            email: "alice@example.com",
            createdAt: "2026-01-01T00:00:00Z",
          },
        },
        400: { description: "请求参数校验失败" },
        401: { description: "未认证" },
        409: { description: "邮箱已注册" },
      },
    },
  },
  handler,
);
```

### operationId 自动推断

未指定 `operationId` 时，框架根据 HTTP 方法和路径自动生成：

| 方法 + 路径         | 推断的 operationId |
| ------------------- | ------------------ |
| `GET /users`        | `getUsers`         |
| `POST /users`       | `createUsers`      |
| `GET /users/:id`    | `getUsersById`     |
| `PUT /users/:id`    | `updateUsersById`  |
| `DELETE /users/:id` | `deleteUsersById`  |

### 隐藏路由

```typescript
app.get(
  "/internal/debug",
  {
    docs: { hidden: true },
  },
  handler,
);
```

### 标记废弃

```typescript
app.get(
  "/v1/users",
  {
    docs: {
      deprecated: true,
      description: "已废弃，请使用 /v2/users",
    },
  },
  handler,
);
```

### 安全方案覆盖

默认情况下，安全方案从 `middlewares` 自动推断（通过 `config.openapi.guardSecurityMap` 映射）。可手动覆盖：

```typescript
// 显式声明需要 bearerAuth
app.get(
  "/secure",
  {
    docs: {
      security: [{ bearerAuth: [] }],
    },
  },
  handler,
);

// 声明无需认证（即使有全局安全要求）
app.get(
  "/public",
  {
    docs: {
      security: [],
    },
  },
  handler,
);
```

### 响应定义

```typescript
interface ResponseConfig {
  description?: string;
  schema?: Record<string, unknown> | string;
  contentType?: string;
  example?: unknown;
  examples?: Record<
    string,
    {
      summary?: string;
      description?: string;
      value: unknown;
    }
  >;
  headers?: Record<
    string,
    {
      description?: string;
      schema?: { type: string };
    }
  >;
}
```

**多示例响应**：

```typescript
docs: {
  responses: {
    200: {
      description: '查询成功',
      examples: {
        admin: {
          summary: '管理员用户',
          value: { id: '1', name: 'Admin', role: 'admin' },
        },
        normal: {
          summary: '普通用户',
          value: { id: '2', name: 'User', role: 'user' },
        },
      },
    },
  },
}
```

**自定义响应头**：

```typescript
docs: {
  responses: {
    200: {
      description: '成功',
      headers: {
        'X-RateLimit-Remaining': {
          description: '剩余请求次数',
          schema: { type: 'integer' },
        },
      },
    },
  },
}
```

---

## multipart

路由级文件上传配置。配置后 OpenAPI 生成器自动输出 `multipart/form-data` requestBody，无需手动编写 `docs.requestBody`。

```typescript
app.post(
  '/upload/avatar',
  {
    middlewares: ['upload'],
    multipart: {
      files: {
        avatar: { description: '头像图片（JPEG/PNG）', required: true },
        thumbnail: '可选缩略图',
      },
    },
    docs: { summary: '上传头像', tags: ['用户'] },
  },
  async (req, res) => {
    const file = req.files?.find(f => f.fieldname === 'avatar');
    res.json({ filename: file?.filename, size: file?.size });
  },
);
```

| 子字段        | 类型                               | 说明                                         |
| ------------- | ---------------------------------- | -------------------------------------------- |
| `files`       | `Record<string, string \| object>` | 文件字段映射；字符串值为说明，对象可配置更多 |
| `files[].description` | `string`                 | 字段说明（用于 OpenAPI 文档）                |
| `files[].required`    | `boolean`                | 是否必传（默认 `false`）                     |

:::warning 注意
`multipart.files` 与 `validate.body` 互斥，同时配置时 `multipart.files` 优先生效于 OpenAPI 文档生成。
:::

---

## override

路由级配置覆盖，覆盖 `src/config/default.ts` 中的全局配置。

```typescript
app.post(
  "/upload",
  {
    override: {
      maxBodySize: "50mb", // 覆盖全局 body 大小限制
      rateLimit: { max: 5, window: 60 }, // 收紧限流
      timeout: 30000, // 超时 30 秒
    },
  },
  handler,
);

app.get(
  "/public/data",
  {
    override: {
      rateLimit: false, // 完全禁用限流
      cors: {
        origins: ["*"],
        credentials: false,
      },
    },
  },
  handler,
);
```

| 字段          | 类型               | 说明                         |
| ------------- | ------------------ | ---------------------------- |
| `rateLimit`   | `object \| false`  | 路由级限流配置，`false` 禁用 |
| `timeout`     | `number`           | 请求超时（毫秒）             |
| `maxBodySize` | `string \| number` | 最大请求体大小               |
| `cors`        | `VextCorsConfig`   | 路由级 CORS 配置             |

---

## RouteDefinition

`defineRoutes()` 返回的路由定义对象（内部数据结构，通常不需要直接操作）。

```typescript
interface RouteDefinition {
  readonly routes: RouteRecord[];
  sourceFile: string;
  register(
    adapter: VextAdapter,
    prefix: string,
    middlewareDefs: Map<string, VextMiddleware>,
    globalMiddlewares: VextMiddleware[],
  ): void;
}
```

| 字段         | 类型            | 说明                                  |
| ------------ | --------------- | ------------------------------------- |
| `routes`     | `RouteRecord[]` | 收集到的路由记录列表                  |
| `sourceFile` | `string`        | 来源文件路径（由 router-loader 注入） |
| `register()` | `Function`      | 将路由注册到底层适配器                |

### RouteRecord

单条路由的内部数据结构：

```typescript
interface RouteRecord {
  method: string; // HTTP 方法（大写）
  path: string; // 相对子路径
  options: RouteOptions; // 路由配置
  handler: VextHandler; // 路由处理函数
}
```

---

## VextHandler

路由处理函数的类型定义：

```typescript
type VextHandler = (
  req: VextRequest,
  res: VextResponse,
) => Promise<void> | void;
```

Handler 是中间件链的最后一环，不调用 `next()`。

### 基本示例

```typescript
const handler: VextHandler = async (req, res) => {
  const users = await app.services.user.findAll();
  res.json(users);
};
```

### 访问 App 能力

在 `defineRoutes` 的 factory 回调中，通过闭包访问 `app`：

```typescript
export default defineRoutes((app) => {
  app.get("/users/:id", async (req, res) => {
    const { id } = req.params;
    const user = await app.services.user.findById(id);

    if (!user) {
      app.throw(404, "用户不存在");
    }

    app.logger.info({ userId: id }, "查询用户成功");
    res.json(user);
  });
});
```

---

## 多路由注册

一个路由文件中可以注册多条路由：

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /users/list
  app.get(
    "/list",
    {
      validate: {
        query: { page: "number:1-", limit: "number:1-100" },
      },
      docs: { summary: "用户列表" },
    },
    async (req, res) => {
      const { page, limit } = req.valid("query");
      const result = await app.services.user.findAll({ page, limit });
      res.json(result);
    },
  );

  // GET /users/:id
  app.get(
    "/:id",
    {
      validate: {
        param: { id: "string:1-" },
      },
      docs: { summary: "获取用户详情" },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);
      if (!user) app.throw(404, "用户不存在");
      res.json(user);
    },
  );

  // POST /users
  app.post(
    "/",
    {
      validate: {
        body: { name: "string:1-50", email: "email" },
      },
      middlewares: ["auth"],
      docs: { summary: "创建用户" },
    },
    async (req, res) => {
      const data = req.valid("body");
      const user = await app.services.user.create(data);
      res.json(user, 201);
    },
  );

  // PUT /users/:id
  app.put(
    "/:id",
    {
      validate: {
        param: { id: "string:1-" },
        body: { name: "string:1-50?", email: "email?" },
      },
      middlewares: ["auth"],
      docs: { summary: "更新用户" },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const data = req.valid("body");
      const user = await app.services.user.update(id, data);
      res.json(user);
    },
  );

  // DELETE /users/:id
  app.delete(
    "/:id",
    {
      validate: {
        param: { id: "string:1-" },
      },
      middlewares: ["auth"],
      docs: { summary: "删除用户" },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      await app.services.user.delete(id);
      res.status(204).json(null);
    },
  );
});
```

---

## 注意事项

### 不要直接在 app 上调用 HTTP 方法

`defineRoutes` 返回的 `app` 是一个收集器，不是真正的应用实例。直接在应用实例上调用 HTTP 方法会抛出错误：

```typescript
// ❌ 错误用法
import { createApp } from "vextjs";
const { app } = createApp(config);
app.get("/hello", handler); // 抛出错误！

// ✅ 正确用法
import { defineRoutes } from "vextjs";
export default defineRoutes((app) => {
  app.get("/hello", handler); // OK
});
```

### 路由文件必须 default export

```typescript
// ✅ 正确
export default defineRoutes((app) => { ... });

// ❌ 错误 — router-loader 无法识别
export const routes = defineRoutes((app) => { ... });
```

### 路由路径规范化

框架自动处理以下路径边界情况：

| 前缀         | 子路径    | 最终路径      |
| ------------ | --------- | ------------- |
| `/users`     | `/list`   | `/users/list` |
| `/users`     | `/`       | `/users`      |
| `/users`     | `/:id`    | `/users/:id`  |
| `/`          | `/`       | `/`           |
| `/`          | `/health` | `/health`     |
| `/api/users` | ``        | `/api/users`  |

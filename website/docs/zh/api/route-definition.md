# 路由定义

本页详细介绍 VextJS 的路由定义 API，包括 `defineRoutes`、路由选项、参数校验、中间件引用和文档配置。

本页用于查询接口与边界，完整步骤见 [路由指南](/zh/guide/routing)。片段中的 handler、业务 service 和中间件须由项目提供；HTTP 调用均位于 factory 内。路由模块的规范级约束见 [HTTP 与路由规范](/zh/specification/http-and-routing)。

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
function defineRoutes<TFactory extends RouteFactory>(
  factory: TFactory &
    (ReturnType<TFactory> extends PromiseLike<unknown> ? never : unknown),
): RouteDefinition;

type RouteFactory = (app: VextApp) => void;
```

路由 `factory` 必须同步：不要声明为 `async`，也不要返回 `Promise`。单条路由的
handler 仍然可以是 `async`。该约束保证运行时注册、构建索引、Doctor 与 typegen
看到同一组可静态投影路由。

### 工作原理

1. 模块求值时调用 `defineRoutes(factory)`：检查同步函数与注册语法，创建并返回 `RouteDefinition`；此时尚未执行 factory，`routes` 为空。
2. loader 读取默认导出并注入来源信息，用真实应用的 facade 执行 factory。
3. factory 的 HTTP 方法收集路由；services/config/logger 等能力转发到真实应用。factory 结束后 HTTP 收集入口关闭，失败时清空本次收集。
4. loader 检查路由身份、中间件引用和配置，准备请求链，再调用 adapter 注册路由。业务代码不需要调用 `register()`。

`defineRoutes` 返回路由定义对象，不是 app。factory 参数是应用 facade，不是应用属性快照。支持内联同步箭头函数或 function expression，也支持可静态解析到同类函数的绑定。

### 参数、返回值与失败边界

| 项目           | 合同                                                                  |
| -------------- | --------------------------------------------------------------------- |
| factory        | 一个普通标识符参数、块体、同步且非 generator；HTTP 注册是直接顶层语句 |
| factory 返回值 | 必须为 undefined；Promise、thenable 和其他返回值被拒绝                |
| 返回对象       | RouteDefinition，由 loader 管理收集和注册                             |
| handler        | 可同步或异步，与 factory 的同步要求独立                               |
| 失败           | 非函数、非法注册形态、晚到注册、重复路由或非法配置在对应阶段报错      |

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
      middlewares: ["audit-log"],
      docs: {
        summary: "创建用户",
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

如果动态路径只通过 `req.params` 读取而没有声明 `validate.param`，OpenAPI 会自动为 `:paramName` 或 `*paramName` 补一个 `required: true` 的 string path parameter，避免生成非法路径模板。需要约束格式时仍建议声明 `validate.param`。

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
    query?: Record<string, VextSchemaField>;
    body?: Record<string, VextSchemaField>;
    param?: Record<string, VextSchemaField>;
    header?: Record<string, VextSchemaField>;
    cookie?: Record<string, VextSchemaField>;
  };
  responses?: Record<
    string | number,
    { schema: Record<string, unknown> | string }
  >;
  cache?: false | number | RouteCacheOptions;
  frontend?: VextRouteFrontendOptions;
  middlewares?: VextMiddlewareRef[];
  docs?: RouteDocsConfig;
  auth?: false | true | VextAuthRequirement;
  csrf?: false;
  securityHeaders?: false;
  session?:
    | boolean
    | {
        enabled?: boolean;
        rolling?: boolean;
        autoCommit?: boolean;
      };
  timeout?: number | false;
  bodyParser?: VextBodyParserConfig;
  multipart?: {
    enabled?: boolean;
    maxFileSize?: number;
    maxFiles?: number;
    allowedMimeTypes?: string[];
    files?: Record<
      string,
      string | { description?: string; required?: boolean }
    >;
  };
  override?: {
    rateLimit?: { max?: number; window?: number; keyBy?: string } | false;
    /** @deprecated 请使用顶层 timeout。 */
    timeout?: number;
    maxBodySize?: string | number;
    cors?: VextCorsConfig;
  };
}
```

### 字段与省略行为

| 字段              | 省略时的行为                            | 查询入口                          |
| ----------------- | --------------------------------------- | --------------------------------- |
| `validate`        | 不创建路由自动输入校验                  | [validate](#validate)             |
| `responses`       | 不启用声明式业务 JSON 序列化器          | [响应 Schema](#运行时响应-schema) |
| `middlewares`     | 无自定义路由中间件引用                  | [middlewares](#middlewares)       |
| `docs`            | 使用框架推导的文档元数据                | [docs](#docs)                     |
| `cache`           | 该路由不启用响应缓存                    | [cache](#cache)                   |
| `frontend`        | 默认动态页面策略                        | [前端 freshness](#前端-freshness) |
| `auth`            | 不安装路由 auth guard；已有中间件仍生效 | [auth](#auth)                     |
| `csrf`            | 跟随全局 CSRF；`false` 跳过             | [CSRF](#csrf)                     |
| `securityHeaders` | 跟随全局响应头策略；`false` 跳过        | [override](#override)             |
| `session`         | 跟随全局 Session 配置                   | [session](#session)               |
| `timeout`         | 无路由期限；兼容读取 `override.timeout` | [override](#override)             |
| `bodyParser`      | 跟随全局 body parser                    | [bodyParser](#bodyparser)         |
| `multipart`       | 跟随全局 multipart 配置                 | [multipart](#multipart)           |
| `override`        | 沿用各项全局配置                        | [override](#override)             |

### 前端 freshness

`RouteOptions.frontend` 把页面 freshness 保留在既有路由声明中：

```ts
interface VextRouteFrontendOptions {
  mode?: "dynamic" | "static" | "revalidate";
  revalidate?: number; // 秒；revalidate mode 必填
  staticParams?: ReadonlyArray<Record<string, string | number | boolean>>;
  clientOnly?: boolean;
  hydration?: "full" | "none";
  seo?: {
    title?: string;
    description?: string;
    canonical?: string;
    originKey?: string;
    index?: boolean;
  };
  tags?: ReadonlyArray<string>;
  page?: string;
  staticBudget?: {
    maxParams?: number;
    maxDurationMs?: number;
    maxBytes?: number;
  };
}
```

`staticParams` 只允许用于 `"static"`。`revalidate` 只允许用于
`"revalidate"`，且是正数秒级间隔。`clientOnly` 保留 route
document/data/assets，同时有意跳过服务端 page body；它不是 PPR，也不是第二套路由。

静态生成建议显式声明 `frontend.page`。构建器按 `staticParams` 直接给页面传 `{ params }`，不会执行路由处理器、认证或 service 查询；它不是完整业务请求的预执行。需要处理器准备数据的页面应保留动态 SSR。完整示例见[渲染模式](/zh/frontend/rendering-modes)。

`hydration: "none"` 与 `clientOnly` 的方向相反：它要求并保留 SSR page body，但移除 Vext/React browser runtime、hydration data 与路由 JS preload。它不能与 `clientOnly` 或关闭 SSR 组合。`seo` 是静态、JSON-safe 的路由元数据，会在单次 render SEO 前合并。

### 静态投影边界

以下限制适用于所有参与构建索引的路由声明。路径与路由元数据使用有限静态语法，避免构建索引与运行时产生分歧。索引接受字面量、同文件 `const` 及可解析源码模块的导入绑定，以及 TypeScript 的 `as const` / 简单 `as Type` / `satisfies` 包装。route options helper 调用会被拒绝：索引不会执行 helper 函数体，无法确认它是否新增、删除或覆盖合同字段。请内联 helper 的最终对象，或把该最终对象保存为同文件 `const` 后直接传入。注释、字符串、模板文本与正则表达式不会参与结构匹配。

每个 `app.get(...)` / `app.post(...)` 注册都必须是 `defineRoutes` 回调内的直接顶层语句。条件式或嵌套注册会阻断静态投影，因为构建索引无法保证运行时控制流是否执行该注册。

索引沿可解析源码的导入/重导出读取静态声明，不执行用户 helper 或任意模块运行时代码；计算表达式、带插值模板和不透明导入值不保证能投影。路由 path、任一 `validate` 位置或 response schema 无法静态投影时，build/doctor/typegen 会携带文件、HTTP method 与 route 上下文失败，而不是静默漏掉路由或生成空合同。依赖请求数据的元数据应放在 `res.render(..., { seo })`。详见 [SEO、Sitemap 与 Robots](/zh/frontend/seo-sitemap)。

### 组合配置片段 {#完整示例}

以下片段展示选项之间的组合；需放入 `defineRoutes` 工厂，并提供 `auth` 中间件、白名单与业务 `handler`。

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
    responses: {
      200: { schema: { id: "string!", name: "string!", email: "email!" } },
      404: { schema: { code: "integer!", message: "string!" } },
    },
    cache: false,
    middlewares: ["auth"],
    auth: { required: true, security: "bearerAuth" },
    docs: {
      summary: "更新用户",
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

声明式参数校验基于 `schema-dsl` DSL 语法，并在 handler 执行前完成。`param`（路径参数）非法时返回 HTTP `400`；`query`、`header`、`cookie` 或 `body` 非法时返回 HTTP `422`。

字段类型为 `VextSchemaField`，可表达 schema-dsl 字符串、字段级 DslBuilder、嵌套对象和数组合同；实际使用还须同时满足运行编译与静态投影。当前数组采用显式 `{ type: "array", items: ... }` 或受支持的数组DSL；不要使用 `["string"]`、`[{ code: "string!" }]` 简写，即使类型层能推导，当前静态编译仍会拒绝。完整数组示例见[参数校验](/zh/guide/validation#与-openapi-文档的联动)。字段级 DslBuilder 常用于给 OpenAPI 文档补充业务描述：

```typescript
import { schemaAdapter } from "vextjs";

app.post(
  "/translate",
  {
    validate: {
      body: {
        content: schemaAdapter
          .compileField("string:1-20000!")
          .description("待翻译文本，长度 1-20000 个字符"),
        format: schemaAdapter
          .compileField("enum:plain_text,preserve_line_breaks")
          .description("输出格式"),
      },
    },
  },
  handler,
);
```

这些 description 会进入 OpenAPI schema，同时保留必填、枚举和长度等约束。

静态投影器只识别从 `vextjs` named import 的 `schemaAdapter`（允许 alias）、
`compileField(<静态字符串>)` 与最多一次 `.description(<静态字符串>)`。完整 builder
可保存为同文件无歧义 `const`，也可沿可分析源码绑定解析。动态参数、其他 call chain 和不透明 Zod/Yup 对象会阻断投影；导入本身并不等于不受支持。

### 校验位置

| 位置     | 数据源        | 说明                      |
| -------- | ------------- | ------------------------- |
| `param`  | `req.params`  | 路径动态参数（如 `/:id`） |
| `query`  | `req.query`   | URL 查询参数              |
| `header` | `req.headers` | 请求头                    |
| `cookie` | `req.cookies` | 已解析的 Cookie 值        |
| `body`   | `req.body`    | 请求体                    |

**校验执行顺序**：`param` → `query` → `header` → `cookie` → `body`

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
    // page/limit: number | undefined；keyword: string | undefined
  },
);
```

### DSL 语法速查

对象字段必填使用 `!`（如 `string!`），可选使用 `?` 或省略必填标记。裸 string/number 不等于必填；raw JSON Schema 通过对象的 required 数组声明。

| DSL              | 说明                     | 示例                             |
| ---------------- | ------------------------ | -------------------------------- |
| `'string'`       | 字符串（不单独声明必填） | `name: 'string'`                 |
| `'string:1-50'`  | 长度 1-50 的字符串       | `name: 'string:1-50'`            |
| `'string?'`      | 可选字符串               | `nickname: 'string?'`            |
| `'number'`       | 数字（不单独声明必填）   | `age: 'number'`                  |
| `'number:0-'`    | 大于等于 0 的数字        | `page: 'number:0-'`              |
| `'number:1-100'` | 1 到 100 之间的数字      | `limit: 'number:1-100'`          |
| `'boolean'`      | 布尔值（不单独声明必填） | `active: 'boolean'`              |
| `'email'`        | 邮箱格式                 | `email: 'email'`                 |
| `'url'`          | URL 格式                 | `website: 'url'`                 |
| `'date'`         | 日期格式                 | `birthday: 'date'`               |
| `'uuid'`         | UUID 格式                | `id: 'uuid'`                     |
| `'enum:a,b,c'`   | 枚举值                   | `status: 'enum:active,inactive'` |
| `'array'`        | 数组                     | `tags: 'array'`                  |
| `'object'`       | 对象                     | `metadata: 'object'`             |

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
      body: { name: "string:1-50!", email: "email!" },
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

handler 会直接从路由 Schema 推导类型，无需再声明一份重复接口：

```typescript
const body = req.valid("body");
// body.name  → IDE 知道是 string
// body.email → IDE 知道是 string
```

显式泛型覆盖自动推导结果，但不会增加运行时校验。自动 validate 位于路由中间件之后；前置中间件不能假定 req.valid 已有校验结果。

### 校验失败响应

`query`、`header`、`cookie` 或 `body` 校验失败时返回 HTTP `422`，结构如下。`validate.param` 失败使用相同错误结构，但 HTTP status 与 `code` 为 `400`，因为 URL 路径本身无效：

```json
{
  "code": 422,
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
    middlewares: ["audit-log"],
  },
  handler,
);
```

### 对象引用（带配置覆盖）

以下为 factory 内的配置片段，`handler` 是业务处理器；先按 [中间件指南](/zh/guide/middleware#定义中间件) 创建并声明 `audit-log` 和 `response-label`。`response-label` 的 `value` 由该工厂定义，路由 options 整体替换其配置默认值。内置限流使用全局 `rateLimit` 与 [override.rateLimit](#override)，其 `window` 单位为秒。

```typescript
app.get(
  "/admin/users",
  {
    middlewares: [
      "audit-log",
      { name: "response-label", options: { value: "admin" } },
    ],
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
全局中间件 → 路由内置包装/multipart → 自定义中间件 → auth guard → 缓存/freshness → validate → handler
```

路由引用中的 options 整体替换工厂的配置默认 options，不逐字段合并；普通中间件不接受 options。已启用的包装、短路和缓存命中会影响后续步骤。

### 配置白名单

路由中引用的中间件必须在配置文件中声明：

```typescript
// src/config/default.ts
export default {
  middlewares: [
    { name: "auth" },
    { name: "role", options: { required: "user" } },
    { name: "client-cache", options: { maxAge: 300 } },
  ],
};
```

对应中间件文件必须存在并导出普通中间件或工厂。完整定义、白名单和引用见 [中间件指南](/zh/guide/middleware#注册与使用)。

:::warning
引用未在白名单中声明的中间件会在启动时抛出错误：

```
[vextjs] Route GET "/profile" references middleware "auth" which is not
registered in config.middlewares whitelist.
```

:::

---

## auth

`RouteOptions.auth` 是路由保护契约，和身份解析分离：

- `auth()` 中间件读取请求凭据并填充 `req.auth`。
- `auth: true` 要求请求已经认证。
- 对象形式可以要求 roles、scopes、permissions 或自定义 `check`。
- `auth: { required: false }` 表示身份可选；没有 roles、scopes、permissions、`check` 且未显式设置 `auth.security` 时，Auth 合同投影的 OpenAPI security 为 `[]`。显式 `docs.security` 仍具有更高的文档优先级。
- `auth: false` 表示路由显式公开，并禁用从 `middlewares` 回退推断 OpenAPI security 的旧逻辑。

### VextAuthRequirement

对象形式的公开字段如下：

```typescript
interface VextAuthRequirement {
  required?: boolean;
  roles?: string[];
  scopes?: string[];
  permissions?: VextPermissionRequirement[];
  mode?: "any" | "all";
  security?: string | string[] | Array<Record<string, string[]>>;
  check?: (
    req: VextRequest,
    auth: VextAuthContext,
  ) => boolean | Promise<boolean>;
}

type VextPermissionRequirement =
  | string
  | {
      action: string;
      resource?: string | ((req: VextRequest) => string | undefined);
      context?:
        | Record<string, unknown>
        | ((req: VextRequest) => Record<string, unknown> | undefined);
    };
```

`required` 默认 `true`。`roles`、`scopes`、`permissions` 省略或为空时不增加该组检查；`mode` 默认 `"any"`，控制每一组内部匹配任一项还是全部项，不会把不同组变成“任一组通过即可”。例如同时声明 roles 和 scopes 时，两组都必须通过；随后执行 `check(req, auth)`，返回 false 拒绝，抛错按 provider 错误处理。permission 字符串表示 action，对象形式可补充资源与上下文。

`required: false` 且没有额外授权规则时允许匿名请求；若认证中间件已经记录 `req.auth.error`，guard 仍会拒绝该请求。guard 位于路由自动校验之前，`check` 不能假定 `req.valid()` 已有结果。`security` 的文档含义及默认方案见下文，不改变这些运行时检查。

以下固定 demo-token 只演示认证合同；真实项目须接入凭据校验。这些组合片段需声明白名单并在 factory 中注册路由。

```typescript
// src/middlewares/auth.ts
import { auth, defineMiddleware } from "vextjs";

export default defineMiddleware(
  auth({
    provider: "app",
    async verify(token) {
      if (token !== "demo-token") return false;
      return {
        subject: "user:1",
        userId: "1",
        roles: ["admin"],
        scopes: ["posts:write"],
        can(action, resource) {
          return action === "post:update" && resource === "POST:/posts/:id";
        },
      };
    },
  }),
);
```

```typescript
// src/routes/posts.ts
import type { RouteOptions } from "vextjs";

const updatePostOptions = {
  middlewares: ["auth"],
  auth: {
    roles: ["admin"],
    scopes: ["posts:write"],
    permissions: [{ action: "post:update", resource: "POST:/posts/:id" }],
    mode: "all",
    security: "bearerAuth",
  },
  docs: { summary: "更新文章" },
} satisfies RouteOptions;

app.post("/:id", updatePostOptions, handler);
```

构建索引接受最终内联对象，或 `updatePostOptions` 这种同文件 `const`。它不会执行 helper 函数体，因此会拒绝 route-options helper 调用。每条路由的完整保护合同应保持在这些可静态投影的形态中；可复用的运行时授权逻辑仍应放在 middleware 或 permission provider。

这里的路由语句放在 `src/routes/posts.ts` 的 `defineRoutes` 回调内：文件前缀 `/posts` 与子路径 `/:id` 组成 `POST /posts/:id`。示例权限 resource 是业务双方约定的字符串，不由框架从 URL 自动生成；若修改该字符串，认证 provider 与路由声明应一起调整。

### 运行时 auth、OpenAPI security 与 Docs access

三者相关但彼此独立：

- `auth.roles`、`auth.scopes`、`auth.permissions` 与 `auth.check` 是运行时路由保护，决定当前请求能否进入 handler。
- `auth.security` 是 OpenAPI metadata，用于选择文档中的安全方案；对象数组可声明 OAuth scope，例如 `[{ oauth2: ["posts:write"] }]`，但它不会授予或执行该 scope。
- `docs.security` 只覆盖生成出的 OpenAPI security metadata，不会取消运行时的 `auth` 要求。
- `docs.access` 是传给 `openapi.docs.access.resolver` 的 Vext Docs 可见性/Try it out metadata，不会保护 route；API 访问控制仍应使用 `auth`。

运行时 scope 与 OAuth scope 可以使用相同字符串，但仍是两份独立声明；两者都需要时请分别显式配置。

Guard 失败会使用稳定错误码：

| 错误码                | HTTP 状态 | 含义                                                  |
| --------------------- | --------- | ----------------------------------------------------- |
| `AUTH_REQUIRED`       | `401`     | 当前请求没有已认证身份                                |
| `AUTH_INVALID`        | `401`     | 请求携带了凭据，但凭据无效                            |
| `AUTH_FORBIDDEN`      | `403`     | 已认证身份未通过 role、scope、permission 或自定义检查 |
| `AUTH_CONFIG_ERROR`   | `500`     | auth 中间件或 permission provider 配置错误            |
| `AUTH_PROVIDER_ERROR` | `500`     | auth provider 或自定义检查异常抛错                    |

`requestContext.getStore()?.auth` 只保存安全身份快照，不包含原始凭据和 `claims`。需要读取 provider claims 时，请在路由内使用完整的 `req.auth`。

---

## cache

路由级响应缓存发生在服务端，配置位于 `RouteOptions.cache`，与浏览器 Cache-Control 不同。

```typescript
// src/routes/cache-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    { cache: { ttl: 30_000, vary: ["accept-language"] } },
    (_req, res) => {
      res.json({ generatedAt: Date.now() });
    },
  );
});
```

启用响应缓存后，重复 GET `/cache-demo` 会在 TTL 内复用响应；query、vary 或分区不同会形成不同缓存项。

| 配置                    | 类型/单位                          | 行为                                               |
| ----------------------- | ---------------------------------- | -------------------------------------------------- |
| cache                   | false / number / RouteCacheOptions | 不声明则不启用该路由缓存；number 为 TTL 毫秒       |
| ttl                     | number，毫秒                       | 公开类型中必填，使用正数；运行时兜底见下文         |
| key                     | 字符串或请求函数                   | 自定义 key；默认包含方法、路径、query 和 vary      |
| condition               | 请求函数返回 boolean               | false 时跳过缓存                                   |
| vary                    | string[] / "\*"                    | 参与 key 的请求头，例如 `["accept-language"]`      |
| partitionKey            | 字符串或请求函数                   | 用户/租户隔离；应使用已验证身份                    |
| allowAuthorizationCache | boolean，默认 false                | 允许带 Authorization 且未分区的请求缓存            |
| allowCookieCache        | boolean，默认 false                | 控制带 Cookie 回源结果写入；已有缓存读取限制见指南 |
| cacheControl            | boolean，默认 true                 | 是否输出 Cache-Control                             |
| tags                    | string[]                           | 用于 `app.cache.invalidate(tag)` 的标签            |

对象中的 `ttl` 缺失或为 `0` 时，运行时会尝试使用正数的全局默认 TTL；负数会禁用该路由缓存。因此不要用 `{ ttl: 0 }` 表达禁用，请使用 `cache: false` 或数字形式 `cache: 0`。类型化配置仍应显式填写正数 `ttl`。

`config.cache.enabled: false` 会禁用路由响应缓存。认证路由先进行身份与权限检查，再考虑分区缓存；Authorization 请求默认绕过，除非有非空分区或显式允许。当前 Cookie 默认策略只阻止回源结果写入，已有公开缓存仍可能被读取；要完全排除 Cookie 请求，请用 `condition: (req) => req.headers.cookie === undefined` 或禁用缓存。详见 [响应缓存指南](/zh/guide/cache)。

---

## responses — 运行时响应 Schema {#运行时响应-schema}

```typescript
interface RuntimeResponseConfig {
  schema: Record<string, unknown> | string;
}

type RuntimeResponses = Record<string | number, RuntimeResponseConfig>;
```

该映射声明在顶层 `RouteOptions.responses`。selector 支持精确状态（`201`）、
状态族（`2xx`）与 `default`；`response:before` 完成后按最终状态以“精确 →
状态族 → default”选择。Vext 在路由注册时编译每个 JSON schema，并在后续请求
中复用。同一份闭合 schema 会投影到 OpenAPI、路由 manifest、静态 build 索引
和生成客户端类型。

schema 描述传给 `res.json()` 的业务数据，不需要手写重复的响应包裹。未声明
字段会递归移除，缺失 required 值会在提交字节前失败。HEAD、精确 204、raw
JSON、text、redirect、file/download、stream 与 render/SSR 响应会绕过该序列化器。
生命周期和 raw JSON Schema 细节见
[OpenAPI 响应契约](/zh/guide/openapi#responses--运行时响应契约与文档元数据)。

---

## docs

OpenAPI 文档配置，控制路由在自动生成的 API 文档中的展示方式。

### RouteDocsConfig

```typescript
interface RouteDocsConfig {
  summary?: string;
  description?: string;
  /** @deprecated 已忽略；operation tags 会自动推断 */
  tags?: string[];
  operationId?: string;
  hidden?: boolean;
  access?: VextRouteDocsAccessConfig | string;
  deprecated?: boolean;
  security?: Array<Record<string, string[]>>;
  extensions?: Record<string, unknown>;
  responses?: Record<string | number, ResponseConfig>;
}
```

### 字段说明

| 字段          | 类型               | 默认值                       | 说明                                                                                                                       |
| ------------- | ------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `summary`     | `string`           | —                            | 接口一句话摘要                                                                                                             |
| `description` | `string`           | —                            | 接口详细描述（支持 Markdown）                                                                                              |
| `tags`        | `string[]`         | 已忽略                       | 已废弃。operation tags 会从路由 path/source 自动推断                                                                       |
| `operationId` | `string`           | 自动推断                     | 操作标识（全局唯一；冲突时生成报错）                                                                                       |
| `hidden`      | `boolean`          | `false`                      | 是否从文档中隐藏                                                                                                           |
| `access`      | `object \| string` | —                            | 文档访问 metadata，会传给 `openapi.docs.access.resolver`；`visible: false` 会直接隐藏，`tryItOut: false` 会禁用 Try it out |
| `deprecated`  | `boolean`          | `false`                      | 是否标记为已废弃                                                                                                           |
| `security`    | `array`            | 从 `auth` / middlewares 推断 | 安全方案覆盖                                                                                                               |
| `extensions`  | `object`           | —                            | 自定义 `x-*` 扩展字段                                                                                                      |
| `responses`   | `object`           | —                            | 响应定义                                                                                                                   |

`docs.access` 会写入 OpenAPI operation 的 `x-vext-docs-access` vendor extension，并在 Vext Docs 过滤阶段作为 `kind: "operation"` descriptor 的 `access` 字段传给 `openapi.docs.access.resolver`。字符串值通常用于角色、租户或分组标识；对象值可以携带 `roles`、`permissions`、`group`、`visible` 和 `tryItOut` metadata。这只是文档访问 metadata：隐藏 operation 或关闭 Try it out 不会为 route 增加认证或授权。

### 文档配置片段 {#完整示例-1}

以下片段需放入工厂并接入项目的用户 service；`docs` 描述接口，实际输入校验由 `validate` 执行。

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
    middlewares: ["audit-log"],
    responses: {
      201: {
        schema: {
          id: "string",
          name: "string",
          email: "email",
          createdAt: "date",
        },
      },
    },
    docs: {
      summary: "创建用户",
      description: "创建一个新用户账号，并记录操作审计日志。",
      operationId: "createUser",
      responses: {
        201: {
          description: "用户创建成功",
          example: {
            id: "usr_abc123",
            name: "Alice",
            email: "alice@example.com",
            createdAt: "2026-01-01T00:00:00Z",
          },
        },
        422: { description: "请求参数校验失败" },
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

显式 `docs.operationId` 和自动推断出的 `operationId` 共用同一个全局唯一约束。若重复，OpenAPI 生成会直接报错；请为冲突路由设置唯一的 `docs.operationId`，或调整路由 method/path 让自动推断结果不同。

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

默认情况下，安全方案按以下顺序推断：

1. 显式设置的 `docs.security`，包括 `[]`。
2. `RouteOptions.auth` 为 `true` 或对象时；优先使用显式 `auth.security`。未指定该字段且 `required: false`、没有 roles/scopes/permissions/check 时输出 `[]`，其余情况默认使用 `bearerAuth`。
3. 旧的 `middlewares` 推断，通过 `config.openapi.guardSecurityMap` 映射。

`auth:false` 会禁用该路由的旧 `middlewares` 回退推断。`auth: { required: false }` 如果同时声明 roles、scopes、permissions 或 `check`，运行时仍会要求认证；文档结果仍按上述显式方案优先级生成，即使显式声明空 security，也不会取消运行时保护。

也可以手动覆盖：

```typescript
// 仅在 OpenAPI 文档中声明需要 bearerAuth
app.get(
  "/secure",
  {
    docs: {
      security: [{ bearerAuth: [] }],
    },
  },
  handler,
);

// 仅在 OpenAPI 文档中声明无需认证（覆盖文档的全局安全要求）
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

### 响应文档元数据

以下 `ResponseConfig` 是便于查阅的结构摘录；公开声明位于
`RouteDocsConfig.responses`，并未单独导出这个名称。

```typescript
interface ResponseConfig {
  description?: string;
  /** 仅文档兼容入口；优先使用 RouteOptions.responses。 */
  schema?: Record<string, VextSchemaField> | string;
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

描述、示例、响应头与 content type 保留在 `docs.responses`。如果同一规范化
selector 已在顶层 `responses` 中声明，不得在这里重复 `schema`；双重声明会
让路由注册失败。

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

路由级文件上传配置。`multipart.files` 会自动输出 OpenAPI `multipart/form-data` requestBody，无需手动编写 `docs.requestBody`。全局 `config.multipart.enabled` 关闭时，可通过 `multipart.enabled: true` 让单个路由启用内置解析；全局开启时，也可通过 `multipart.enabled: false` 让单个路由跳过内置解析。内置解析是纯内存路径：不会创建框架管理的临时文件，因此没有 tmp 目录、文件 TTL 或定时清理配置。大文件或持久化存储应由流式上传插件接管。

```typescript
app.post(
  "/upload/avatar",
  {
    multipart: {
      enabled: true,
      files: {
        avatar: { description: "头像图片（JPEG/PNG）", required: true },
        thumbnail: "可选缩略图",
      },
    },
    docs: { summary: "上传头像" },
  },
  async (req, res) => {
    const file = req.files?.find((f) => f.fieldname === "avatar");
    res.json({ filename: file?.filename, size: file?.size });
  },
);
```

| 子字段                | 类型                               | 说明                                                                      |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `enabled`             | `boolean`                          | 路由级解析开关。`true` 单路由启用；`false` 单路由跳过；省略则跟随全局配置 |
| `maxFileSize`         | `number`                           | 此路由单文件字节上限，覆盖全局 `multipart.maxFileSize`                    |
| `maxFiles`            | `number`                           | 此路由最多文件数，覆盖全局 `multipart.maxFiles`                           |
| `allowedMimeTypes`    | `string[]`                         | 此路由 MIME 白名单，覆盖全局 `multipart.allowedMimeTypes`                 |
| `files`               | `Record<string, string \| object>` | 文件字段映射；字符串值为说明，对象可配置更多                              |
| `files[].description` | `string`                           | 字段说明（用于 OpenAPI 文档）                                             |
| `files[].required`    | `boolean`                          | 运行时是否要求至少上传一个同名文件（默认 `false`）                        |

对启用内置 multipart 解析的 multipart 请求，缺少 required 文件字段时，Vext 返回 `400`，响应中包含缺失字段名。optional 字段和未声明上传字段仍允许上传；它们继续受 `maxFiles`、`maxFileSize` 和 `allowedMimeTypes` 限制。非 multipart 请求会跳过这些文件检查；接口若必须接收文件，还需在 handler 中检查 `req.files`。

:::warning 注意
内置 multipart 解析只将文件放入 `req.files`，不会把普通文本字段写入 `req.body`。同时声明 `multipart.files` 和 `validate.body` 时，OpenAPI 优先生成 multipart 描述，但这不代表普通字段已被解析。运行时仍对当前 `req.body` 执行校验；只使用内置解析且 body schema 有必填字段时，即使表单提交了同名文本字段，body 校验仍会失败并返回 `422`。

需要文件与普通字段混传时，应接入会显式填充 `req.body` 的自定义解析器，并协调好请求体读取；也可将普通字段改为独立 JSON 请求。字段边界见 [req.files 与表单字段](/zh/guide/uploads#reqfiles-与表单字段)，接管方式见 [内存、adapter 与自定义上传](/zh/guide/uploads#内存adapter-与自定义上传)。
:::

---

## session

控制单个路由的 Session。`false` 跳过已全局启用的 Session；`true` 在全局关闭时单路由启用。对象形式还可覆盖 `rolling` 与 `autoCommit`；Store、cookie name 和 session id 长度仍保持应用级配置。

```typescript
app.get("/health", { session: false }, healthHandler);

app.post(
  "/preview",
  { session: { enabled: true, rolling: true } },
  previewHandler,
);
```

---

## bodyParser

`bodyParser?: VextBodyParserConfig` 为路由级请求体解析配置，优先级高于全局 `bodyParser`。它由已安装的 body parser 消费，不会自行安装一个被全局关闭的解析器。

```typescript
// 在路由 options 中关闭该路由的内置 body 解析
const rawRouteOptions = { bodyParser: { enabled: false } };
```

只要声明了 `bodyParser` 对象，就优先使用该对象，不再读取兼容字段 `override.maxBodySize`；对象中未指定的大小上限回退全局值。没有 `bodyParser` 对象时才读取 `override.maxBodySize`。关闭内置解析后，handler 不应再假定 `req.body` 已解析；需要自行处理时参阅 [配置说明](/zh/guide/configuration)。

## csrf

`csrf?: false` 只提供跳过开关。省略时遵守全局 CSRF 配置；它不会自行开启防护，也不负责建立认证身份。使用 Cookie/Session 的路由是否跳过，应按实际调用方式决定；详细配置见 [Cookie 与 Session](/zh/guide/cookies-session)。

## override

路由级配置覆盖。override.rateLimit 调整已启用的全局 limiter，不会自行开启限流；window 单位为秒，timeout 为毫秒。

```typescript
app.post(
  "/upload",
  {
    timeout: 30000, // 超时 30 秒
    override: {
      maxBodySize: "50mb", // 覆盖全局 body 大小限制
      rateLimit: { max: 5, window: 60 }, // 收紧限流
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

| 字段          | 类型               | 说明                                 |
| ------------- | ------------------ | ------------------------------------ |
| `rateLimit`   | `object \| false`  | 路由级限流配置，`false` 禁用         |
| `timeout`     | `number`           | 兼容保留字段；优先使用顶层 `timeout` |
| `maxBodySize` | `string \| number` | 最大请求体大小                       |
| `cors`        | `VextCorsConfig`   | 路由级 CORS 配置                     |

路由可以设置顶层 `{ timeout: number }`，用正整数毫秒值启用请求期限，超时返回 HTTP 504。顶层 `{ timeout: false }` 表示显式不启用路由超时中间件，并优先于兼容保留的 `override.timeout`。

当可嵌入页面、第三方回调或完全自定义响应头栈需要跳过全局 Security Headers 预设时，路由也可以设置顶层 `{ securityHeaders: false }`。

---

## RouteDefinition

`defineRoutes()` 返回的路由定义对象（内部数据结构，通常不需要直接操作）。
factory 与 collector 内部状态不属于公共对象形状，应只通过 `defineRoutes()` 与 router-loader 生命周期驱动。

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

| 字段         | 类型            | 说明                                            |
| ------------ | --------------- | ----------------------------------------------- |
| `routes`     | `RouteRecord[]` | 创建时为空，loader 执行 factory 后填充          |
| `sourceFile` | `string`        | 来源文件路径（由 router-loader 注入）           |
| `register()` | `Function`      | 内部兼容入口，不等同于 loader 完整准备/校验流程 |

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
type VextHandler<
  TValidated extends VextValidatedData = VextDefaultValidatedData,
> = (req: VextRequest<TValidated>, res: VextResponse) => Promise<void> | void;
```

Handler 是中间件链的最后一环，不调用 `next()`。三段式路由从
`options.validate` 自动推导校验结果类型；显式提供泛型只改变 TypeScript 类型，
不增加运行时校验。

### 基本示例

```typescript
const handler: VextHandler = async (req, res) => {
  const users = await req.app.services.user.findAll();
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

这里如果要主动返回 `404`、`401`、`409` 等明确的 HTTP 错误，应优先使用 `app.throw(...)`。普通 `throw new Error("...")` 也会被框架捕获，但它表示未知运行时异常，最终会进入 500 错误路径；字段级校验失败则应使用 `VextValidationError`。

---

## 多路由注册

同一个 factory 可以声明多个 HTTP 方法与子路径，每条声明都是块体内的直接顶层语句。同路径的不同方法可共存，规范化后的相同方法与路径不可重复。完整业务组合见 [路由指南](/zh/guide/routing#完整示例)，首次使用可先运行该指南开头的无业务依赖示例。

---

## 注意事项

### 不要直接在 app 上调用 HTTP 方法

`defineRoutes` 返回 RouteDefinition；factory 参数是带有可关闭 HTTP 收集入口的应用 facade。根应用上的 HTTP 方法是占位入口，直接调用会抛错：

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

构建期需把默认导出解析到来自 `vextjs` named import 的 `defineRoutes` 调用（允许 alias）。只有 named export 不构成路由入口；property/namespace 调用或不透明 helper 也不满足该身份要求。

推荐直接默认导出。需要提取 factory 时，可使用带块体的同步函数绑定：

```typescript
// src/routes/binding-demo.ts
import { defineRoutes, type VextApp } from "vextjs";

const register = (app: VextApp) => {
  app.get("/", (_req, res) => {
    res.json({ ok: true });
  });
};

export default defineRoutes(register);
```

支持先创建定义再 `export { routeDefinition as default }`。可完整解析的默认重导出同样受支持，例如 `src/routes/account.ts` 写 `export { default } from "../features/account.js"`；前缀仍为 `/account`，定义在被引用模块解析。目标必须存在于可分析的源码范围，导出和绑定都可解析，不能推导成任意动态导入都受支持。

表达式体 `(app) => app.get(...)`、异步 factory、条件/循环/嵌套 helper 中注册、方括号或提取 HTTP 方法均不受支持。factory 返回非 undefined 值也会失败。

### 路由路径规范化

框架自动处理以下路径边界情况：

| 前缀         | 子路径    | 最终路径      |
| ------------ | --------- | ------------- |
| `/users`     | `/list`   | `/users/list` |
| `/users`     | `/`       | `/users`      |
| `/users`     | `/:id`    | `/users/:id`  |
| `/`          | `/`       | `/`           |
| `/`          | `/health` | `/health`     |
| `/api/users` | _（空）_  | `/api/users`  |

入口文件前缀也受静态索引唯一性检查：users.ts 与 users/index.ts 不能同时作为路由入口。规范化后的同方法/路径不可重复，包含大小写和尾斜杠变体。

## 相关规范

- [HTTP 与路由规范](/zh/specification/http-and-routing)：路由模块、工厂回调、校验和中间件的 Rule ID。

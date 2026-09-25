# 路由

VextJS 采用 **约定式文件路由** + **三段式路由定义**，将文件路径自动映射为 URL 前缀，在文件内部通过 `defineRoutes()` 声明具体路由。

本文从一个可运行路由开始，说明文件映射、请求校验和业务接入。完整字段与默认值见 [路由定义 API](/zh/api/route-definition)，必须遵守的边界见 [HTTP 与路由规范](/zh/specification/http-and-routing)。

示例约定：`route-demo.ts` 是可直接加入现有 VextJS 项目的独立完整例；其余展示 `app`、`req`、`res`、`handler` 的代码是对应 factory 或 handler 内的说明片段。业务组合另列服务和认证前提。

## 先跑通一个路由

### 1. 创建路由文件

前置条件：已有按 [快速开始](/zh/guide/quick-start) 创建、安装依赖且能通过 `npm run dev` 启动的 VextJS 项目。新建下面的文件；它不依赖数据库、自定义 service 或认证中间件。

```typescript
// src/routes/route-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/:id",
    { validate: { param: { id: "integer:1-!" } } },
    (req, res) => {
      const { id } = req.valid("param");
      res.json({ id, valueType: typeof id });
    },
  );

  app.post(
    "/",
    { validate: { body: { name: "string:1-50!" } } },
    (req, res) => {
      const { name } = req.valid("body");
      res.json({ name }, 201);
    },
  );
});
```

### 2. 验证路径和校验

在项目根目录运行 `npm run dev`，另开终端发送请求；端口替换为启动输出中的实际值。先在项目根目录保存两个请求文件，避免不同终端对 JSON 引号的处理差异：

`route-valid.json`：

```json
{ "name": "Alice" }
```

`route-invalid.json`：

```json
{}
```

在同一目录执行下面的命令。Windows PowerShell 将命令名 `curl` 换为 `curl.exe`：

```bash
curl -i http://localhost:3000/route-demo/42
curl -i http://localhost:3000/route-demo/not-a-number
curl -i -X POST http://localhost:3000/route-demo -H "Content-Type: application/json" --data-binary @route-valid.json
curl -i -X POST http://localhost:3000/route-demo -H "Content-Type: application/json" --data-binary @route-invalid.json
```

| 请求                           | 预期结果                                                        |
| ------------------------------ | --------------------------------------------------------------- |
| GET `/route-demo/42`           | 200；默认包装下 `data` 为 `{ "id": 42, "valueType": "number" }` |
| GET `/route-demo/not-a-number` | 400；路径参数校验失败，handler 不执行                           |
| POST 有效 name                 | 201；默认包装下 `data.name` 为 `Alice`                          |
| POST 空对象                    | 422；必填 body 字段缺失，handler 不执行                         |

文件前缀是 `/route-demo`，所以文件内写 `"/"` 或 `"/:id"`，不要再次添加 `/route-demo`。响应外层是否包装由应用配置决定，校验失败的具体消息可能随 validator 和语言配置变化。

### 3. 接入业务逻辑

最小路由验证成功后，再把业务操作交给 [service](/zh/guide/services)，按需增加校验、中间件、认证和响应声明。

以下章节中的 `app.get(...)` 等局部片段均位于 `defineRoutes((app) => { ... })` 内。`handler`、`user`、`data` 等示意变量和 `app.services.*` 由项目提供，不是框架自动生成的业务能力。

factory 必须同步，handler 可以异步。路由注册使用 factory 块体内的直接顶层语句，不放进循环、条件分支或异步回调。支持可静态解析的函数绑定与默认重导出，详细边界见 [工厂规则](/zh/specification/http-and-routing#vext-http-002)。

## 基本概念

### 文件路由映射

`src/routes/` 中符合加载规则的路由文件映射为 URL 前缀。下表是分别说明的布局选择，`users.ts` 与 `users/index.ts` 不能同时存在：

| 文件路径                   | URL 前缀          |
| -------------------------- | ----------------- |
| `routes/index.ts`          | `/`               |
| `routes/users.ts`          | `/users`          |
| `routes/users/index.ts`    | `/users`          |
| `routes/users/[id].ts`     | `/users/:id`      |
| `routes/admin/settings.ts` | `/admin/settings` |
| `routes/api/v1/index.ts`   | `/api/v1`         |

### 三段式定义

VextJS 路由使用 **三段式** `(path, options, handler)` 或 **两段式** `(path, handler)` 定义：

```typescript
// 三段式：path + options + handler
app.get(
  "/list",
  {
    validate: { query: { page: "number:1-", limit: "number:1-100" } },
    middlewares: ["audit-log"],
    docs: { summary: "用户列表" },
  },
  async (req, res) => {
    const { page, limit } = req.valid("query");
    res.json(await app.services.user.findAll({ page, limit }));
  },
);

// 两段式：path + handler（无 options）
app.get("/health", async (_req, res) => {
  res.json({ status: "ok" });
});
```

三段式中第二个参数 `options` 是一个声明式配置对象，常用字段如下；完整字段（含响应、缓存、上传等）见 [RouteOptions](/zh/api/route-definition#routeoptions)：

| 字段          | 说明                                                   |
| ------------- | ------------------------------------------------------ |
| `validate`    | 参数校验规则（query / body / param / header / cookie） |
| `middlewares` | 路由级中间件引用                                       |
| `auth`        | 路由保护契约；内联或使用同文件最终 `const`             |
| `session`     | 路由级 Session 启用、关闭或行为覆盖                    |
| `csrf`        | 路由级 CSRF 跳过                                       |
| `docs`        | OpenAPI 文档配置                                       |
| `override`    | 路由级运行时覆盖（限流、超时、CORS）                   |

## 路由文件写法

每个路由文件默认导出一个 `defineRoutes()` 结果。先用上面的独立示例确认路径和校验，再把业务操作移入 service。不要把数据库连接、认证实现或一整套 CRUD 同时塞入第一个路由。

两段式适合健康检查等简单接口；需要校验、中间件、访问保护或响应声明时使用三段式。一个 factory 可以声明多个方法，但每次注册都必须是它块体中的直接语句。文件加载规则见本文后面的“路由加载优先级”和“排除规则”，精确签名见 [defineRoutes API](/zh/api/route-definition#defineroutes)。

需要创建、查询、修改和删除资源时，继续阅读 [业务路由组合片段](#完整示例)。该段明确列出 service 和认证前提，不将项目业务实现当作框架内置能力。

## 路由加载优先级

当存在可能冲突的路由时，`router-loader` 按以下规则处理：

1. **静态路由优先于动态路由**：`/users/list` 优先于 `/users/:id`
2. **文件按字母序排序**：确保加载顺序确定性
3. **同时检查文件前缀和最终路由身份**：静态索引会拒绝 `routes/users.ts` 与 `routes/users/index.ts` 这类同前缀入口；运行时还检查规范化后的 HTTP 方法与完整路径重复，路径大小写及尾斜杠变体也参与检测。不要用“最终路径不同”绕过文件前缀限制。
4. **同路径 HEAD 优先于 GET，具体路径优先于通配路径**：不要依赖文件名顺序覆盖已有路由。

## 排除规则

路由源支持 `.ts`、`.js`、`.mjs`。`.cjs` 会使加载失败，不能当作受支持或静默排除的路由源。以下文件会被跳过：

- 测试文件：`*.test.ts`、`*.spec.ts`
- 类型声明文件：`*.d.ts`
- 以 `_` 或 `.` 开头的文件或目录
- `node_modules` 目录
- 包含 `.__vext_compiled__` 的生成临时文件

这些文件会被跳过，不会作为启动错误处理。运行时路由加载、路由诊断和 manifest 生成共用同一套排除策略。

可以利用 `_` 前缀创建路由共享的工具模块：

```
src/routes/
├── _utils.ts          # 不会被当作路由加载
├── _types.ts          # 共享类型定义
├── users.ts
└── orders.ts
```

## HTTP 方法

`defineRoutes()` 回调中的 `app` 对象支持以下 HTTP 方法：

| 方法            | 用法       | 常见场景                        |
| --------------- | ---------- | ------------------------------- |
| `app.get()`     | 查询资源   | 列表查询、详情获取              |
| `app.post()`    | 创建资源   | 表单提交、资源创建              |
| `app.put()`     | 全量更新   | 资源替换                        |
| `app.patch()`   | 部分更新   | 字段级更新                      |
| `app.delete()`  | 删除资源   | 资源删除                        |
| `app.head()`    | 获取头信息 | 资源存在性检查                  |
| `app.options()` | 预检请求   | CORS 预检（通常由框架自动处理） |

## 动态路由参数

### 文件级动态参数

使用 `[paramName]` 作为文件名或目录名，自动转换为路由动态参数：

```
src/routes/users/[id].ts         → /users/:id
src/routes/posts/[slug].ts       → /posts/:slug
src/routes/[category]/[id].ts    → /:category/:id
```

```typescript
// src/routes/users/[id].ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /users/:id — 文件级参数 :id 已包含在前缀中
  app.get(
    "/",
    {
      validate: { param: { id: "string!" } },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);
      res.json(user);
    },
  );

  // GET /users/:id/orders — 文件级参数 + 子路径
  app.get(
    "/orders",
    {
      validate: { param: { id: "string!" } },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const orders = await app.services.order.findByUserId(id);
      res.json(orders);
    },
  );
});
```

### 路由内动态参数

在文件内部的路由路径中也可以使用 `:paramName` 语法：

```typescript
// src/routes/users.ts
export default defineRoutes((app) => {
  // GET /users/:id/posts/:postId
  app.get(
    "/:id/posts/:postId",
    {
      validate: {
        param: { id: "string!", postId: "string!" },
      },
    },
    async (req, res) => {
      const { id, postId } = req.valid("param");
      // ...
      res.json({ userId: id, postId });
    },
  );
});
```

## 请求对象 (req)

handler 通过 `req` 读取 HTTP 输入。处理业务数据时优先使用已声明 Schema 的 `req.valid()`：它包含校验和类型转换后的值；原始 `req.params/query/body/headers/cookies` 仍可读取。

<a id="常用属性"></a>
<a id="reqvalid--获取校验后数据"></a>

| 要读取的数据 | 校验声明          | handler 中的读取      |
| ------------ | ----------------- | --------------------- |
| 路径参数     | `validate.param`  | `req.valid("param")`  |
| 查询参数     | `validate.query`  | `req.valid("query")`  |
| 请求头       | `validate.header` | `req.valid("header")` |
| Cookie       | `validate.cookie` | `req.valid("cookie")` |
| 请求体       | `validate.body`   | `req.valid("body")`   |

只有声明的校验位置才会产生结果；未声明的位置返回 `undefined`。字段是否可选取决于 Schema，不能用 TypeScript 泛型代替运行时校验。上面的 `id` 示例将字符串转换为数字；分页等可选字段可以在 handler 中设置业务默认值：

```typescript
// 已声明 validate.query 的 handler 内
const { page = 1, limit = 20 } = req.valid("query");
```

方法、URL、原始输入、请求 ID、IP、协议、Cookie、Session 和应用实例等属性集中列在 [请求公开成员](/zh/api/context#公开成员一览)；精确签名与类型推导见 [req.valid()](/zh/api/context#validlocation)。Session 需要先启用，上传文件读取及普通字段限制见 [上传指南](/zh/guide/uploads)。

<a id="reqonclose--请求结束钩子"></a>

长连接或流式响应需要释放定时器等资源时，使用 [req.onClose()](/zh/api/context#onclosehandler)。它在正常响应完成或连接提前断开时调用，每个回调至多一次；结束后注册会立即执行。回调触发不代表客户端异常断连，正常完成也不会中止 `req.signal`。需要取消下游操作时另按 [signal](/zh/api/context#signal) 的状态处理。

## 响应对象 (res)

普通 JSON 接口在 handler 内调用 `res.json(data)` 发送业务数据；创建资源时传入201，删除后无内容时使用204。仅 `return data` 不会自动发送响应：

<a id="resjson--json-响应"></a>
<a id="链式调用"></a>

```typescript
res.json({ name: "Alice" }); // 默认200
res.status(201).setHeader("X-Custom-Header", "value").json(data);
// 删除资源成功时：res.status(204).json(null);
```

上述各行是不同请求的响应选择，不要在同一请求中依次发送。默认 `config.response.wrap: true` 将 JSON 包装为 `{ code: 0, data, requestId }`；204不发送消息体。字段、默认值及关闭包装的行为见 [JSON响应](/zh/api/context#jsondata-status)。

<a id="restext--纯文本响应"></a>
<a id="resstream--流式响应"></a>
<a id="resdownload--文件下载"></a>
<a id="resredirect--重定向"></a>
<a id="resstatuscode--读取状态码"></a>

其他响应方式按任务选择，精确参数和示例由请求与响应API承载：

| 任务             | 选择与注意点                                                     | 参考                                                                                   |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 返回文本         | `res.text(content, status?)`                                     | [纯文本响应](/zh/api/context#textcontent-status)                                       |
| 发送文件流或SSE  | `res.stream()` 接收Node.js可读流，按需指定Content-Type并清理资源 | [流式响应](/zh/api/context#streamreadable-contenttype)                                 |
| 提供附件下载     | `res.download()` 设置安全的Content-Disposition，支持UTF-8文件名  | [文件下载](/zh/api/context#downloadreadable-filename-contenttype)                      |
| 跳转页面         | `res.redirect()` 默认302，按语义选择其他支持的状态码             | [重定向](/zh/api/context#redirecturl-status)                                           |
| 设置状态和响应头 | 在提交响应前调用，可链式连接                                     | [status](/zh/api/context#statuscode)、[setHeader](/zh/api/context#setheadername-value) |
| 记录处理结果     | 中间件 `await next()` 后读取只读 `res.statusCode`                | [状态码](/zh/api/context#statuscode只读)                                               |

需要约束JSON输出字段时继续看下文“OpenAPI文档配置”中的顶层 `responses`；需要返回错误时使用 `app.throw()`，不要把错误响应当成成功数据传给 `res.json()`。

## 参数校验

VextJS 集成 [schema-dsl](https://github.com/devcodex-labs/schema-dsl)，在路由 `options.validate` 中声明校验规则，框架自动执行校验并生成 OpenAPI 文档。

### DSL 语法速查

本页入门示例使用 `integer:1-!` 和 `string:1-50!`：`!` 表示必填，范围约束限制值或长度；可选字段使用 `?` 或不加必填标记。规则写在路由选项中，handler 读取转换后的结果。

字符串、数字、email、url、boolean、日期和枚举等语法集中见 [DSL语法详解](/zh/guide/validation#dsl-语法详解) 与 [路由校验速查](/zh/api/route-definition#dsl-语法速查)。校验描述不了“邮箱未注册”“用户拥有资源”等业务条件，这些仍由服务层和权限检查处理。

### 校验位置

```typescript
app.post(
  "/users/:id/settings",
  {
    validate: {
      param: {
        id: "string!",
      },
      query: {
        format: "json|xml",
      },
      header: {
        "x-api-key": "string!",
      },
      body: {
        nickname: "string:1-30!",
        avatar: "url?",
        notifications: "boolean!",
      },
    },
  },
  handler,
);
```

校验顺序为 `param` → `query` → `header` → `cookie` → `body`。路径 `param` 非法时立即返回 HTTP `400`，其他位置失败时立即返回 HTTP `422`。

### 校验错误响应

校验失败时框架自动返回结构化的错误信息：

```json
{
  "code": 422,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "must be a valid email address" },
    { "field": "name", "message": "length must be between 1 and 50" }
  ],
  "requestId": "xxx"
}
```

## 路由级中间件

通过 `options.middlewares` 为路由指定中间件。以下是组合片段，先创建 [中间件指南](/zh/guide/middleware#定义中间件) 中的 `audit-log` 和 `response-label` 文件，再加入配置白名单；`handler` 代表你的业务处理器：

```typescript
// src/config/default.ts
export default {
  middlewares: [
    "audit-log",
    { name: "response-label", options: { value: "configured" } },
  ],
};
```

```typescript
// src/routes/admin.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // 字符串引用
  app.get(
    "/dashboard",
    {
      middlewares: ["audit-log"],
    },
    handler,
  );

  // 对象引用（覆盖默认参数）
  app.delete(
    "/users/:id",
    {
      middlewares: [
        "audit-log",
        { name: "response-label", options: { value: "admin" } },
      ],
    },
    handler,
  );
});
```

自定义路由中间件按声明顺序执行，并位于路由自动校验之前；在 `next()` 前读取 `req.valid()` 不能假定已经取得校验结果。认证中间件建立 `req.auth` 后，路由 `auth` guard 才能进行保护检查。

这里的工厂参数来自 `response-label` 定义，路由 options 整体替换配置默认 options。内置限流通过全局 `rateLimit.enabled` 与路由 `override.rateLimit` 配置，`window` 单位为秒，详见 [覆盖配置](/zh/api/route-definition#override)。

## OpenAPI 文档配置

通过 `options.docs` 配置路由的 OpenAPI 文档信息：

```typescript
app.post(
  "/users",
  {
    validate: {
      body: { name: "string:1-50!", email: "email!" },
    },
    responses: {
      201: {
        schema: { id: "string", name: "string", email: "email" },
      },
    },
    docs: {
      summary: "创建用户",
      description: "创建一个新用户，邮箱必须唯一。",
      operationId: "createUser",
      deprecated: false,
      responses: {
        201: {
          description: "创建成功",
        },
        409: {
          description: "邮箱已存在",
        },
      },
    },
  },
  handler,
);
```

顶层 `responses` 是编译 JSON 序列化、OpenAPI 与生成客户端类型共用的运行时
契约。描述和示例保留在 `docs.responses`；同一状态 selector 不要在其中重复
声明 schema。

### 隐藏路由

不希望出现在 OpenAPI 文档中的路由，设置 `docs.hidden: true`。这不会阻止HTTP访问，访问保护仍需认证和授权：

```typescript
app.get(
  "/internal/metrics",
  {
    docs: { hidden: true },
  },
  handler,
);
```

## 访问 `app` 对象

`defineRoutes()` 的回调参数 `app` 可用于访问服务、日志、错误处理和配置：

```typescript
export default defineRoutes((app) => {
  app.get("/example", async (req, res) => {
    // 访问 service
    const data = await app.services.user.findAll();

    // 使用 logger
    app.logger.info("Fetching users");

    // 抛出 HTTP 错误
    if (!data) app.throw(404, "not_found");

    // 读取配置
    const port = app.config.port;

    res.json(data);
  });
});
```

:::tip req.app 与闭包 app
路由 handler 中可以通过两种方式访问 `app`：

- **闭包 `app`**：`defineRoutes((app) => ...)` 中的 `app` 参数
- **`req.app`**：请求对象上的真实运行期 `app` 引用

factory 的 `app` 是以真实应用为能力来源的 Proxy facade。`app.config`、`app.services` 及扩展属性的读取会转发到真实应用；它们不是复制到 collector 的属性快照。`req.app` 指向真实应用。

需要使用 `fetch.get()`、`fetch.create()` 等挂载方法时，在 handler 中使用 `req.app.fetch`，具体边界见 [HTTP 客户端](/zh/guide/fetch)。

如果把 `const config = app.remoteConfig` 放在请求处理之外，变量仍会保留当时读取的值；需要最新值时，在 handler 内读取 `app.remoteConfig` 或 `req.app.remoteConfig`。这属于 JavaScript 引用捕获，与选择哪种 app 入口无关。

factory 收集结束后，其 HTTP 注册入口关闭；在 handler 中继续调用 `app.get()` 等方法会失败。
:::

## 错误处理

### `app.throw()` — 抛出 HTTP 错误

在路由或服务中使用 `app.throw()` 抛出错误，框架会统一处理并返回结构化响应：

```typescript
// 基本用法
app.throw(404, "用户不存在");
// → { "code": 404, "message": "用户不存在", "requestId": "..." }

// 使用 i18n key（配合 locales/ 语言包）
app.throw(404, "user.not_found");
// → 自动翻译为当前请求语言的消息

// 带业务错误码
app.throw(400, "邮箱已注册", 10001);
// → { "code": 10001, "message": "邮箱已注册", "requestId": "..." }

// 带插值参数
app.throw(400, "balance.insufficient", { balance: 50 });
// → code 优先取语言包业务码，否则为 400；message 由翻译与插值决定

// 带插值参数 + 业务错误码
app.throw(400, "balance.insufficient", { balance: 50 }, 20001);
```

`app.throw()` 会终止当前请求处理流程（函数签名返回 `never`），无需在其后添加 `return`。

如果这里抛出的是未预期异常，也可以直接：

```typescript
throw new Error("Database connection lost");
```

框架同样会捕获它，但这条路径表示“未知运行时错误”，最终会返回 `500 Internal Server Error`。开发环境下，当 `response.hideInternalErrors = false` 时，JSON 500 响应会附带 `stack`；若你的目标是主动返回一个明确的 `4xx/5xx` HTTP 结果，仍应优先使用 `app.throw(...)`。

<a id="完整示例"></a>

## 业务路由组合片段

以下以文章创建为例，连接“HTTP输入 → 业务操作 → HTTP响应”。运行前须实现 `post` service，并提供、在配置白名单声明负责建立 `req.auth.userId` 的 `auth` 中间件。它是业务接线片段；不具备这些前提时，先使用上面的 `route-demo.ts`。

```typescript
// src/routes/posts.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      validate: {
        body: {
          title: "string:1-200!",
          content: "string:1-50000!",
          tags: "string?",
        },
      },
      middlewares: ["auth"],
      auth: { required: true, security: "bearerAuth" },
      docs: { summary: "创建文章" },
    },
    async (req, res) => {
      const post = await app.services.post.create({
        ...req.valid("body"),
        authorId: req.auth.userId,
      });
      res.json(post, 201);
    },
  );
});
```

扩展为CRUD时，沿用同一职责划分：

| 操作     | 路由与输入                                                                | handler和service的职责                                                           |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 分页列表 | `GET /`；query声明page、limit和status枚举                                 | `req.valid("query")` 后设置page=1、limit=20等业务默认值，再调用 `post.findAll()` |
| 读取详情 | `GET /:id`；param声明必填id                                               | 调用 `post.findById()`；不存在时 `app.throw(404, "post.not_found")`              |
| 创建     | 上面的 `POST /`；body与认证上下文分开取值                                 | `post.create()` 检查业务约束，返回201                                            |
| 修改     | `PATCH /:id` 或按项目语义使用PUT；param必填，允许修改的body字段声明为可选 | `post.update()` 检查资源权限与状态，不允许客户端任意覆盖所有字段                 |
| 删除     | `DELETE /:id`；param与认证                                                | `post.delete()` 检查权限后删除，`res.status(204).json(null)` 返回无消息体        |

文章status可以使用 `draft|published|archived` 枚举。校验只约束声明输入；`auth.required` 也不会自动检查文章所有权、状态或数据库唯一性。service与认证的实现分别见 [服务层](/zh/guide/services)、[安全指南](/zh/guide/security)，包括真实项目依赖的完整操作示例见 [CRUD API](/zh/examples/crud-api)。

## 下一步

- 了解 [服务层](/zh/guide/services) 如何组织业务逻辑
- 学习 [中间件](/zh/guide/middleware) 的洋葱模型
- 探索 [参数校验](/zh/guide/validation) 的高级用法
- 查看 [OpenAPI 文档](/zh/guide/openapi) 自动生成
- 核对 [HTTP 与路由规范](/zh/specification/http-and-routing) 中的稳定 Rule ID

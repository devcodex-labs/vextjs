# 请求与响应

本页详细介绍 VextJS 的请求对象 `VextRequest` 和响应对象 `VextResponse` 的完整 API。

初次编写接口可先阅读[路由指南](/zh/guide/routing)；本页按成员查阅。未标注文件路径的 `app.get/post/...` 示例均放在 `defineRoutes((app) => { ... })` 内，`req`/`res` 片段放在相应 handler 或中间件中；它们不是独立入口文件。下方[标准 CRUD 响应](#标准-crud-响应)提供完整路由与配置，用于验证组合用法。

## VextRequest

`VextRequest` 是框架统一的请求对象接口，由各 Adapter 将底层请求转换而来。公共成员便于复用业务代码；依赖底层 TLS、原始请求或扩展字段时，仍需核对对应 Adapter 的行为。

### 公开成员一览

| 属性          | 类型                                    | 说明                                                                                                  |
| ------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `method`      | `string`                                | HTTP 方法（大写，如 `'GET'`、`'POST'`）                                                               |
| `url`         | `string`                                | 请求路径与查询字符串，不保证包含协议和主机                                                            |
| `path`        | `string`                                | 路径部分（不含 query string）                                                                         |
| `route`       | `string`                                | 当前请求匹配的路由模板（如 `/users/:id`）；静态路由与 `path` 相同；未匹配路由（404）时为空字符串 `''` |
| `params`      | `Record<string, string>`                | 路径动态参数                                                                                          |
| `query`       | `Record<string, string>`                | URL 查询参数（已解析）                                                                                |
| `body`        | `unknown`                               | 请求体（由 body-parser 中间件填充）                                                                   |
| `headers`     | `Record<string, string \| undefined>`   | 请求头（全部小写 key）                                                                                |
| `app`         | `VextApp`                               | 当前请求所属的应用实例                                                                                |
| `signal`      | `AbortSignal`                           | 客户端连接关闭或路由期限到达时中止；应传给支持取消的下游操作                                          |
| `requestId`   | `string`                                | 请求唯一标识                                                                                          |
| `ip`          | `string`                                | 客户端 IP                                                                                             |
| `protocol`    | `'http' \| 'https'`                     | 请求协议                                                                                              |
| `cookies`     | `VextCookieJar`                         | 已解析的请求 Cookie                                                                                   |
| `cookie()`    | `(name: string) => string \| undefined` | 读取一个请求 Cookie                                                                                   |
| `csrfToken()` | `() => string`                          | 返回当前 CSRF token；需要启用 CSRF 中间件                                                             |
| `auth`        | `VextAuthContext`                       | 认证上下文；由 auth 中间件填充前为匿名上下文                                                          |
| `session`     | `VextSession \| undefined`              | 启用 session 中间件后的 Session 状态                                                                  |
| `t`           | `Function \| undefined`                 | i18n 翻译函数（插件注入）                                                                             |
| `files`       | `ParsedFile[] \| undefined`             | 文件上传列表（由内置 multipart 解析或自定义上传插件填充）                                             |
| `valid()`     | 按位置/Schema推导                       | 读取已执行校验的位置；未声明或未执行时为undefined                                                     |
| `onClose()`   | `(handler: () => void) => void`         | 响应完成或连接提前断开时清理资源                                                                      |

---

### `method`

HTTP 请求方法，始终为大写字符串。

```typescript
app.get("/info", async (req, res) => {
  console.log(req.method); // 'GET'
});
```

---

### `url`

请求路径与查询字符串，例如 `/users?page=1`；不要将它当作带协议、主机名的绝对 URL。

```typescript
// 请求: GET /users?page=1&limit=10
console.log(req.url); // '/users?page=1&limit=10'
```

---

### `path`

URL 的路径部分，不包含查询字符串。

```typescript
// 请求: GET /users?page=1
console.log(req.path); // '/users'
```

---

### `route`

当前请求所匹配的路由注册模板，由各 Adapter 在路由匹配后自动注入。与 `path` 的区别在于：`path` 是实际请求路径（高基数），`route` 是路由模板（低基数）。

这是解决 Prometheus 等指标系统**高基数问题**的关键属性——指标应按路由模板聚合，而非实际路径。

```typescript
// 路由注册: app.get('/users/:id', ...)
// 请求: GET /users/abc-123

console.log(req.path); // '/users/abc-123'（实际路径，高基数）
console.log(req.route); // '/users/:id'（路由模板，低基数）✅

// 在 OpenTelemetry / Prometheus 中使用 req.route 作为 http.route 标签
```

| 场景                                     | `req.path`      | `req.route`      |
| ---------------------------------------- | --------------- | ---------------- |
| 参数路由 `/users/:id`，请求 `/users/123` | `/users/123`    | `/users/:id`     |
| 静态路由 `/health`，请求 `/health`       | `/health`       | `/health`        |
| 未匹配路由（404）                        | `/unknown/path` | `''`（空字符串） |

---

### `params`

路径动态参数。由路由匹配引擎自动解析。

```typescript
// 路由: /users/:id/posts/:postId
// 请求: GET /users/42/posts/7

app.get("/users/:id/posts/:postId", async (req, res) => {
  console.log(req.params.id); // '42'
  console.log(req.params.postId); // '7'
});
```

:::tip
`params` 的值始终是字符串类型。如果需要数字类型，使用 `validate` + `req.valid('param')` 获取自动类型转换后的值。
:::

---

### `query`

URL 查询参数，已解析为键值对。重复键取第一个值，例如 `?tag=a&tag=b` 得到 `{ tag: "a" }`，不会自动得到数组；需要重复值时可基于 `req.url` 的查询部分显式解析。

```typescript
// 请求: GET /search?keyword=hello&page=2
app.get("/search", async (req, res) => {
  console.log(req.query.keyword); // 'hello'
  console.log(req.query.page); // '2'（字符串）
});
```

:::tip
`query` 的值始终是字符串类型。使用 `validate` 配置 `query` 校验后，通过 `req.valid('query')` 可获取自动类型转换后的值（如字符串 `'2'` → 数字 `2`）。
:::

---

### `body`

请求体数据，由内置 `body-parser` 中间件负责解析和填充。

- `body-parser` 中间件执行前，`body` 为 `undefined`
- 支持 `application/json` 和 `application/x-www-form-urlencoded` 格式
- 可通过 `config.bodyParser.maxBodySize` 限制请求体大小

JSON 解析成功不代表字段已通过 Schema 校验，业务处理应声明 `validate.body` 并读取 `req.valid("body")`。multipart 的文件通过 `req.files` 读取，启用条件及限制见下方[`files`](#files)和[上传指南](/zh/guide/uploads)。

```typescript
app.post("/users", async (req, res) => {
  console.log(req.body); // { name: 'Alice', email: 'alice@example.com' }
});
```

---

### `headers`

请求头对象，所有 key 均为**小写**。

```typescript
app.get("/info", async (req, res) => {
  const auth = req.headers.authorization; // 'Bearer eyJ...'
  const ct = req.headers["content-type"]; // 'application/json'
  const custom = req.headers["x-custom"]; // 自定义请求头
});
```

---

### `app`

当前请求所属的 `VextApp` 应用实例。

路由 handler 通常通过 `defineRoutes` 的闭包直接访问 `app`。独立定义的中间件可以通过 `req.app` 访问当前应用的框架能力：

```typescript
// 在中间件中通过 req.app 访问
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  req.app.logger.info("中间件执行中");

  if (!req.headers.authorization) {
    req.app.throw(401, "未提供认证令牌");
  }

  await next();
});
```

通过 `req.app` 可以访问的能力：

| 属性/方法          | 说明             |
| ------------------ | ---------------- |
| `req.app.logger`   | 结构化日志       |
| `req.app.throw()`  | 抛出 HTTP 错误   |
| `req.app.config`   | 运行时配置       |
| `req.app.services` | 已注入的服务实例 |
| `req.app.fetch`    | 内置 HTTP 客户端 |

---

### `signal`

与请求生命周期绑定的 `AbortSignal`。请求处理尚未完成时客户端断开连接会使它中止；正常读取完请求体或正常完成响应不会中止该信号。启用路由超时中间件后，期限信号会与连接信号合并，因此下游操作可以感知任一取消来源。

应将该信号传给支持取消的 API，并在信号中止后停止修改应用或响应状态：

```typescript
app.get("/report", async (req, res) => {
  const upstream = await fetch("https://example.com/report", {
    signal: req.signal,
  });
  res.json(await upstream.json());
});
```

---

### `requestId`

请求唯一标识，用于日志关联和分布式链路追踪。

生成规则：

1. 默认启用；优先读取 `config.requestId.header` 指定的请求头（默认 `x-request-id`）。非空入站值优先于自定义生成器。
2. 无入站值时，依次使用 `app.setRequestIdGenerator()` 设置的生成器、`config.requestId.generate`、默认 UUID v4。
3. 最终值必须为1–512字符且不含控制字符，否则抛错；禁用 `requestId.enabled` 时为 `""`，不写入请求ID响应头。

默认响应头也是 `x-request-id`，可用 `requestId.responseHeader` 调整。入站ID是关联标记，框架不保证客户端提供的值全局唯一。

```typescript
app.get("/info", async (req, res) => {
  console.log(req.requestId); // '550e8400-e29b-41d4-a716-446655440000'

  // 日志自动携带 requestId（通过 AsyncLocalStorage）
  req.app.logger.info("处理请求");
  // → { requestId: '550e8400-...', msg: '处理请求' }
});
```

---

### `ip`

客户端 IP 地址。

| `config.trustProxy` | 行为                                     |
| ------------------- | ---------------------------------------- |
| `false`（默认）     | 从底层 socket 的 `remoteAddress` 读取    |
| `true`              | 从 `X-Forwarded-For` 请求头读取第一个 IP |

```typescript
app.get("/info", async (req, res) => {
  console.log(req.ip); // '192.168.1.100'
});
```

:::warning
只有入口代理可信并正确覆盖转发头时才启用 `trustProxy: true`；否则客户端可影响这些值。关闭时读取直接连接端的地址。Hono 在无法取得 Node socket 地址时回退到 `127.0.0.1`；其他 Node Adapter 也对缺失地址使用该回退值。
:::

---

### `protocol`

请求协议。

| `config.trustProxy` | 行为                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `false`（默认）     | Native/Express/Fastify/Koa 检查 socket TLS 状态；加密连接为 `https`，否则为 `http`。当前 Hono 返回 `http` |
| `true`              | `X-Forwarded-Proto` 的值恰为 `https` 时返回 `https`，否则为 `http`                                        |

```typescript
app.get("/info", async (req, res) => {
  console.log(req.protocol); // 'https'
});
```

---

### `valid(location)`

获取经过 `validate` 校验并类型转换后的数据。

```typescript
type VextValidationLocation = "query" | "body" | "param" | "header" | "cookie";

interface VextRequest<
  TValidated extends Record<VextValidationLocation, unknown>,
> {
  valid<
    TOverride = never,
    TLocation extends VextValidationLocation = VextValidationLocation,
  >(
    location: TLocation,
  ): [TOverride] extends [never] ? TValidated[TLocation] : TOverride;
}
```

`TValidated` 由当前路由的 `validate` 对象自动生成。公共 API 仍保留显式泛型覆盖，供动态或外部 Schema 使用；普通路由代码应优先依赖自动推导契约。

**参数**：

| 参数       | 类型                                                   | 说明         |
| ---------- | ------------------------------------------------------ | ------------ |
| `location` | `'query' \| 'body' \| 'param' \| 'header' \| 'cookie'` | 校验数据位置 |

**`location` 与数据源映射**：

| location   | 数据源        | 说明             |
| ---------- | ------------- | ---------------- |
| `'query'`  | `req.query`   | URL 查询参数     |
| `'body'`   | `req.body`    | 请求体           |
| `'param'`  | `req.params`  | 路径动态参数     |
| `'header'` | `req.headers` | 请求头           |
| `'cookie'` | `req.cookies` | 已解析 Cookie 值 |

:::tip
注意 `location` 使用**单数** `'param'`（与 `validate` 配置的 key 一致），但底层数据源是**复数** `req.params`。框架内部已正确映射。
:::

**基本用法**：

```typescript
app.get(
  "/users",
  {
    validate: {
      query: { page: "number:1-!", limit: "number:1-100!" },
    },
  },
  async (req, res) => {
    const { page, limit } = req.valid("query");
    // page: number（已从字符串 '1' 自动转换为数字 1）
    // limit: number
  },
);
```

**自动推导**：

```typescript
const query = req.valid("query");
// query.page  → number
// query.limit → number
```

如果路由没有声明所请求的位置，推导结果是 `undefined`。链式字段 builder 会推导为 `unknown`；只有应用确实拥有该动态契约时，才使用运行时类型守卫或显式泛型覆盖。

**多位置校验**：

```typescript
app.put(
  "/users/:id",
  {
    validate: {
      param: { id: "string:1-" },
      body: { name: "string:1-50", email: "email" },
      query: { notify: "boolean?" },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const body = req.valid("body");
    const { notify } = req.valid("query");
  },
);
```

:::warning
只有在 `options.validate` 中配置并已执行校验的位置才有结果；未配置或前置路由中间件尚未经过校验时返回 `undefined`。显式泛型只覆盖类型提示，不增加运行时校验。`header` 结果仅保留声明字段并使用小写键，其他位置的转换和额外字段行为取决于引擎。详见[参数校验](/zh/guide/validation)。
:::

---

### `onClose(handler)`

注册请求关闭钩子，在响应完成或客户端提前断开时执行一次。请求已经结束后注册的钩子会立即执行；正常响应结束时，钩子执行不代表 `req.signal` 已中止。

```typescript
function onClose(handler: () => void): void;
```

主要用于 SSE 等流式响应场景，在响应完成或连接断开时清理资源：

```typescript
import { Readable } from "node:stream";

app.get("/sse", async (req, res) => {
  const stream = new Readable({ read() {} });
  const timer = setInterval(() => stream.push("data: ping\n\n"), 1000);

  req.onClose(() => {
    clearInterval(timer);
    stream.destroy();
    console.log("请求结束，已清理流资源");
  });

  res.stream(stream, "text/event-stream");
});
```

:::tip
回调类型是同步 `() => void`，框架不等待异步清理。框架在执行后释放已注册回调的引用；业务仍须在回调中清除自己创建的定时器、监听器等资源。
:::

---

### `t(key, params?)`

可选的请求翻译函数扩展。当前内置语言包加载及请求语言协商不会自动给 `req` 注入 `t`；只有应用插件明确设置后才能使用。不要仅凭配置了 `locale` 或存在 `src/locales` 就假定它可用，内置国际化流程见[国际化](/zh/guide/i18n)。

```typescript
function t(key: string, params?: Record<string, unknown>): string;
```

**用法**：

```typescript
app.get("/greeting", async (req, res) => {
  const message = req.t?.("welcome", { name: "Alice" }) ?? "Welcome, Alice";
  res.json({ message });
});
```

---

### `files`

文件上传列表，初始状态为 `undefined`。全局 `config.multipart.enabled` 开启后，内置 body-parser 会自动解析 `multipart/form-data` 并填充此字段；单个路由也可以通过 `multipart.enabled: true` 单独启用，或通过 `multipart.enabled: false` 跳过全局解析。内置解析会在内存中保留请求体与每个 `buffer`，不会创建框架管理的临时文件、临时目录、TTL 或定时清理任务。需要流式落盘、持久化存储或第三方解析器时，自定义上传插件也可以填充此字段。

```typescript
interface ParsedFile {
  fieldname: string; // 表单字段名称
  filename: string; // 上传文件名
  mimetype: string; // MIME 类型，如 'image/png'
  buffer: Buffer; // 文件原始内容
  size: number; // 文件字节数
}
```

```typescript
app.post(
  "/upload",
  {
    multipart: {
      enabled: true,
      maxFileSize: 10 * 1024 * 1024,
      files: {
        file: { description: "文档文件", required: true },
      },
    },
  },
  async (req, res) => {
    const file = req.files?.find((item) => item.fieldname === "file");
    res.json({ filename: file?.filename, size: file?.size });
  },
);
```

`multipart.files` 同时用于生成 OpenAPI `multipart/form-data` requestBody，并在运行时校验 required 文件字段。上传仍受 `maxFiles`、`maxFileSize` 和 `allowedMimeTypes` 限制。

单文件上限不扩大整个请求体上限；例如允许10MB文件时，还须合理设置 `bodyParser.maxBodySize`，并考虑 multipart 边界的额外字节。

---

### `cookies` 与 `cookie(name)`

`cookies` 是只读的 `Readonly<Record<string, string>>`，来自请求 Cookie 头，不需要启用 Session。重复名称取第一个值；值默认使用 `decodeURIComponent` 解码，解码失败保留原值；保留名称 `__proto__`、`constructor`、`prototype` 被丢弃。`cookie(name)` 返回单个值，缺失时为 `undefined`。

```typescript
app.get("/preferences", async (req, res) => {
  res.json({ theme: req.cookie("theme") ?? "system" });
});
```

这是输入读取，不执行身份认证。写入或清除浏览器Cookie使用响应侧的 `res.cookie()` / `res.clearCookie()`；完整流程见[Cookies与Session](/zh/guide/cookies-session)。

### `csrfToken()`

返回当前请求的CSRF token。只有启用 `config.csrf.enabled` 或已执行手动注册的 `csrf()` 中间件时可用，否则调用抛错。当前请求中重复读取使用同一token；生成时会设置 `Cache-Control: no-store`。自动模式会根据是否存在Session选择存储方式，签名Cookie模式需要配置secret；仅调用此函数不替代受保护请求的token提交与校验。

```typescript
// 已完成CSRF中间件及其存储/secret配置的路由片段
app.get("/csrf-token", async (req, res) => {
  res.json({ token: req.csrfToken() });
});
```

启用、提交头和失败语义见[认证与安全](/zh/guide/security)。

### `auth`

每个请求默认具有匿名 `VextAuthContext`：`isAuthenticated: false`、空 `roles` / `scopes` / `claims`。认证中间件调用应用提供的验证函数后填充身份，路由 `auth` Guard 再执行访问限制；声明 `docs.security` 不会建立身份。

| 字段                  | 类型/含义                                                    |
| --------------------- | ------------------------------------------------------------ |
| `isAuthenticated`     | `boolean`，是否已建立认证身份                                |
| `subject` / `userId`  | 可选字符串，由认证结果提供                                   |
| `roles` / `scopes`    | `string[]`                                                   |
| `claims`              | `Record<string, unknown>`                                    |
| `scheme` / `provider` | 可选来源 `bearer / apiKey / session / custom` 与provider名称 |
| `can` / `assert`      | 可选同步或异步权限函数；调用时需检查存在并 `await`           |
| `error`               | 可选 `VextAuthErrorCode`，身份处理的错误码                   |

完整认证与Guard组合见[认证与安全](/zh/guide/security)。`req.auth` 的存在不等于请求已登录。

### `session`

Session中间件生效后提供 `VextSession`，否则为 `undefined`。除业务字段外，公开只读 `id`、`isNew`、`isDestroyed`；`save()`、`regenerate()`、`destroy()` 都返回 `Promise<void>`。

```typescript
// 已启用Session的路由片段
app.post("/visit", async (req, res) => {
  const session = req.session;
  if (!session) return app.throw(500, "Session未启用");
  session.visits = typeof session.visits === "number" ? session.visits + 1 : 1;
  await session.save();
  res.json({ visits: session.visits });
});
```

自动提交及存储配置见[Cookies与Session](/zh/guide/cookies-session)。修改Session后发送流或下载前，应先 `await session.save()`，使持久化及Cookie提交满足响应时序要求；不能等流已开始发送再补存储。

---

### 扩展字段

中间件和插件可在 `req` 上挂载自定义字段。通过 `declare module` 扩展接口可获得类型提示：

```typescript
// types/vext.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextRequest {
    user?: {
      id: string;
      role: "admin" | "user";
    };
  }
}
```

该声明文件须被项目TypeScript配置包含；手动配置可参考[项目结构](/zh/guide/project-structure)。类型声明不负责运行时赋值。下面的 `verifyToken` 是应用自己的认证函数，须导入其实现；`load-user` 还须进入中间件白名单。

```typescript
// 中间件中设置
export default defineMiddleware(async (req, _res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  req.user = await verifyToken(token);
  await next();
});

// handler 中使用
app.get("/profile", { middlewares: ["load-user"] }, async (req, res) => {
  res.json(req.user ?? null); // 类型为已声明的用户对象或undefined，运行时仍须处理匿名情况
});
```

---

## VextResponse

`VextResponse` 是框架统一的响应对象接口。提供 JSON 响应、文本响应、流式响应、重定向等能力。

### 方法一览

| 方法                                         | 返回值    | 说明                           |
| -------------------------------------------- | --------- | ------------------------------ |
| `json(data, status?)`                        | `void`    | 返回 JSON 响应（经过出口包装） |
| `render(page, props?, options?)`             | `void`    | 渲染内置前端页面               |
| `renderError(error?, page?, options?)`       | `void`    | 渲染已配置的前端错误页面       |
| `text(content, status?)`                     | `void`    | 返回纯文本响应                 |
| `stream(readable, contentType?)`             | `void`    | 流式响应                       |
| `download(readable, filename, contentType?)` | `void`    | 文件下载                       |
| `redirect(url, status?)`                     | `void`    | 重定向                         |
| `status(code)`                               | `this`    | 设置状态码（链式调用）         |
| `setHeader(name, value)`                     | `this`    | 设置响应头（链式调用）         |
| `cookie(name, value, options?)`              | `this`    | 追加 `Set-Cookie` 响应头       |
| `clearCookie(name, options?)`                | `this`    | 让一个响应 Cookie 过期         |
| `statusCode`                                 | `number`  | 当前状态码（只读）             |
| `headersSent`                                | `boolean` | 是否已进入终态响应流程（只读） |
| `sse()`                                      | `unknown` | 可选 SSE 插件扩展              |
| `upgrade()`                                  | `unknown` | 可选 WebSocket/upgrade 扩展    |

`render()` 与 `renderError()` 由内置前端 renderer 绑定。`sse()` 与 `upgrade()` 是可选扩展点，仅在对应插件安装后可用。Cookie 方法会分别追加 `Set-Cookie` 响应头，不会错误合并多个 Cookie。

---

### `json(data, status?)`

返回 JSON 响应。这是最常用的响应方法。

```typescript
function json(data: unknown, status?: number): void;
```

**参数**：

| 参数     | 类型      | 默认值                            | 说明                |
| -------- | --------- | --------------------------------- | ------------------- |
| `data`   | `unknown` | —                                 | 业务数据            |
| `status` | `number`  | 当前 `res.statusCode`，初始 `200` | HTTP 状态码（可选） |

**出口包装**：

当 `config.response.wrap` 为 `true`（默认）时，`res.json(data)` 自动包装：

```typescript
res.json({ id: 1, name: "Alice" });
// 实际响应:
// {
//   "code": 0,
//   "data": { "id": 1, "name": "Alice" },
//   "requestId": "550e8400-e29b-41d4-a716-446655440000"
// }
```

当 `config.response.wrap` 为 `false` 时，直接发送原始数据：

```typescript
res.json({ id: 1, name: "Alice" });
// 实际响应:
// { "id": 1, "name": "Alice" }
```

**指定状态码**：

```typescript
// 201 Created
res.json(newUser, 201);

// 也可以用链式调用
res.status(201).json(newUser);
```

**204 No Content**：

无论包装是否开启，`204` 状态码均不发送消息体（符合 RFC 9110 §15.3.5）：

```typescript
res.status(204).json(null);
// 响应: 204 No Content（无 body）
```

HEAD也不发送消息体。若路由配置了 `responses`，JSON序列化按精确状态码→状态码族→`default`选择Schema；Schema描述业务数据，出口包装由框架处理。未匹配Schema时保留普通JSON序列化行为，`docs.responses`只提供文档信息；详见[响应合同](/zh/api/route-definition#运行时响应-schema)。

**错误响应**（通常由框架 error-handler 自动处理）：

```json
{
  "code": 10001,
  "message": "用户不存在",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### `text(content, status?)`

返回纯文本响应，**不经过出口包装**。

```typescript
function text(content: string, status?: number): void;
```

```typescript
app.get("/health", async (_req, res) => {
  res.text("OK");
});

app.get("/version", async (_req, res) => {
  res.text("v1.0.0", 200);
});
```

自动设置 `Content-Type: text/plain; charset=utf-8`。

省略status时沿用 `res.statusCode`，初始为200。

---

### `render(page, props?, options?)`

渲染内置前端页面，需要启用 `config.frontend.enabled` 并具备对应前端页面与构建/开发产物。`page` 是 `src/frontend/pages` 下的page id，例如 `dashboard`，不是URL或绝对文件路径；URL仍由路由文件定义。关闭前端时调用会抛错。

```typescript
import type { VextRenderOptions } from "vextjs";
// 签名
// render(page: string, props?: Record<string, unknown>, options?: VextRenderOptions): void

// 已创建dashboard页面的路由片段
app.get("/dashboard", async (_req, res) => {
  res.render(
    "dashboard",
    { greeting: "Hello" },
    { head: { title: "Dashboard" } },
  );
});
```

`VextRenderOptions` 包含 `status`、`headers`、`head`、`seo`、`nonce`、`locale`、`messages`、`ssr`、`layout` 和 `layoutData`。状态默认沿用当前响应状态；props、layoutData、messages必须可安全转换为JSON。页面结构、渲染模式与完整流程见[页面与渲染](/zh/frontend/pages-and-rendering)，head/seo选项见[SEO、Sitemap与Robots](/zh/frontend/seo-sitemap)。该出口不使用JSON的 `{ code, data, requestId }` 包装。

### `renderError(errorOrStatus?, pageOrOptions?, options?)`

通过前端renderer生成错误页面。第一个参数可为 `Error`、HTTP状态码或错误码字符串；第二个参数可为page id或 `VextRenderErrorOptions`，第三个参数用于补充选项。没有匹配的自定义错误页时使用内置错误文档；同样需要前端已启用。

```typescript
// 已启用前端的路由片段
app.get("/missing-page", async (_req, res) => {
  res.renderError(404, { message: "页面不存在" });
});
```

`VextRenderErrorOptions` 在渲染选项上增加 `page`、`props`、`code`、`message`、`details`、`expose`。兼容签名也接受普通对象或数组作为第二参数；没有渲染选项键的对象及数组被作为错误details，避免把普通业务对象误作props。错误页选择与信息暴露规则见[错误页与Document](/zh/frontend/errors-and-document)。

---

### `stream(readable, contentType?)`

流式响应，用于大文件传输或实时数据流。

流和下载会立即进入发送流程；应先设置状态、响应头并完成必须先于发送的Session保存。异步读取失败发生在发送开始后时，不能假设还能改写为普通JSON错误。`await next()`返回也不表示整个流已传输完毕，清理使用 `req.onClose()`。

```typescript
function stream(readable: NodeJS.ReadableStream, contentType?: string): void;
```

**参数**：

| 参数          | 类型                    | 默认值                       | 说明           |
| ------------- | ----------------------- | ---------------------------- | -------------- |
| `readable`    | `NodeJS.ReadableStream` | —                            | Node.js 可读流 |
| `contentType` | `string`                | `'application/octet-stream'` | MIME 类型      |

```typescript
import { createReadStream } from "node:fs";

app.get("/large-file", async (_req, res) => {
  const stream = createReadStream("/path/to/large-file.csv");
  res.stream(stream, "text/csv");
});
```

**SSE（Server-Sent Events）**：

```typescript
import { Readable } from "node:stream";

app.get("/events", async (req, res) => {
  const stream = new Readable({ read() {} });
  const interval = setInterval(() => {
    stream.push(`data: ${JSON.stringify({ time: Date.now() })}\n\n`);
  }, 1000);

  req.onClose(() => {
    clearInterval(interval);
    stream.destroy();
  });

  res.stream(stream, "text/event-stream");
});
```

---

### `download(readable, filename, contentType?)`

文件下载响应，自动设置 `Content-Disposition: attachment` 头。ASCII 安全文件名保持 `filename` 输出；包含非 ASCII、引号、路径分隔符或控制字符的文件名会生成安全 fallback，并通过 `filename*` 提供 UTF-8 文件名。

```typescript
function download(
  readable: NodeJS.ReadableStream,
  filename: string,
  contentType?: string,
): void;
```

**参数**：

| 参数          | 类型                    | 默认值                       | 说明                                           |
| ------------- | ----------------------- | ---------------------------- | ---------------------------------------------- |
| `readable`    | `NodeJS.ReadableStream` | —                            | 文件流                                         |
| `filename`    | `string`                | —                            | 下载文件名（浏览器显示，会进行响应头安全编码） |
| `contentType` | `string`                | `'application/octet-stream'` | MIME 类型                                      |

```typescript
import { createReadStream } from "node:fs";

app.get("/export", async (_req, res) => {
  const stream = createReadStream("/path/to/report.xlsx");
  res.download(
    stream,
    "report-2026.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});
```

浏览器按自身下载设置处理该响应，不保证一定弹出对话框。

---

### `redirect(url, status?)`

HTTP 重定向。

```typescript
function redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): void;
```

**参数**：

| 参数     | 类型                              | 默认值 | 说明         |
| -------- | --------------------------------- | ------ | ------------ |
| `url`    | `string`                          | —      | 目标 URL     |
| `status` | `301 \| 302 \| 303 \| 307 \| 308` | `302`  | 重定向状态码 |

```typescript
// 临时重定向（302）
res.redirect("/new-page");

// 永久重定向（301）
res.redirect("/new-permanent-page", 301);

// 提交后跳转到查询页面（303）
res.redirect("/result", 303);

// 临时重定向保持方法（307）
res.redirect("/api/v2/users", 307);

// 永久重定向保持方法（308）
res.redirect("/api/v2/users", 308);
```

**重定向状态码说明**：

| 状态码 | 说明                    | 是否保持 HTTP 方法                  |
| ------ | ----------------------- | ----------------------------------- |
| `301`  | 永久重定向              | 否（可能变为 GET）                  |
| `302`  | 临时重定向（默认）      | 否（可能变为 GET）                  |
| `303`  | See Other，转向查询页面 | 否，通常使用GET（HEAD仍可使用HEAD） |
| `307`  | 临时重定向              | 是                                  |
| `308`  | 永久重定向              | 是                                  |

Location中的非ASCII字节会编码；CR/LF/NUL被拒绝。JavaScript绕过类型传入其他状态值时会回退为302。

---

### `status(code)`

设置 HTTP 状态码，支持链式调用。

```typescript
function status(code: number): this;
```

```typescript
// 链式调用
res.status(201).json(newUser);
res.status(204).json(null);
res.status(404).json({ message: "未找到" });
```

如果不调用 `status()`，默认状态码为 `200`。也可以通过 `json(data, status)` 的第二个参数直接设置。

---

### `setHeader(name, value)`

设置响应头，支持链式调用。

```typescript
function setHeader(name: string, value: string | string[]): this;
```

```typescript
res
  .setHeader("X-Custom-Header", "custom-value")
  .setHeader("Cache-Control", "no-cache")
  .json(data);
```

**常用响应头**：

```typescript
// 缓存控制
res.setHeader("Cache-Control", "public, max-age=3600");

// 内容处理
res.setHeader("Content-Disposition", 'inline; filename="preview.pdf"');

// 路由专属响应元数据
res.setHeader("X-Request-Scope", "public");

// 标准浏览器安全响应头请使用 config.securityHeaders。

// 自定义业务头
res.setHeader("X-RateLimit-Remaining", "95");
```

数组值可用于多个 `Set-Cookie`，不能将它们用逗号拼成一个Cookie值；常规Cookie操作优先使用下方专用方法。

### `cookie(name, value, options?)` 与 `clearCookie(name, options?)`

均返回 `this`，分别追加有效或过期的 `Set-Cookie`。多个调用保留为多个响应头；它们不会直接修改本次请求的 `req.cookies`。

```typescript
res.cookie("theme", "dark", { path: "/", maxAge: 3600, sameSite: "lax" });
res.clearCookie("old-theme", { path: "/" });
res.json({ saved: true });
```

`CookieSerializeOptions` 包含 `domain`、`path`、`expires: Date`、`maxAge`（秒）、`httpOnly`、`secure`、`sameSite`（boolean或lax/strict/none）、`priority`、`partitioned`、`encode`。不传options时不会自动设置path或安全属性；默认值编码为 `encodeURIComponent`。清除时指定与原Cookie一致的path/domain，方法会将expires设为Unix起点、maxAge设为0。更完整的浏览器往返示例见[Cookies与Session](/zh/guide/cookies-session)。

### `headersSent`（只读）

表示框架响应对象已进入终态发送，适合避免重复选择响应出口。JSON、文本等缓冲响应可能尚未写入socket就已为true；流式响应立即发送。它不等价于“客户端已接收完毕”。

缓冲响应在洋葱链退栈后统一提交，after中间件仍能通过 `setHeader()`补充头；流已开始发送后不能依赖这种行为。应在调用响应出口前确定状态码及业务内容。`statusCode`用于读取框架当前状态，完成事件使用 `req.onClose()`。

### `sse()` 与 `upgrade()`

两者是可选扩展点，签名分别为 `sse?(): unknown` 与 `upgrade?(): unknown`；核心不默认提供实现或额外返回类型。使用前确认插件已安装并完成注入，连接和返回值合同由该插件定义。基础SSE可直接使用上文 `stream()` 示例，无需假定存在扩展方法。

---

### `statusCode`（只读）

获取当前 HTTP 状态码。

```typescript
readonly statusCode: number;
```

主要用于**洋葱模型 after-middleware**，在 `await next()` 之后读取响应状态码：

```typescript
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  const start = Date.now();

  await next(); // handler 执行完毕

  const duration = Date.now() - start;
  console.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  // GET /users → 200 (12ms)
});
```

---

## VextPublicResponse

用户可见的响应类型，通过 `Omit` 排除 `rawJson()` 和所有 `_` 前缀的内部方法：

```typescript
type VextPublicResponse = Omit<
  VextResponse,
  "rawJson" | Extract<keyof VextResponse, `_${string}`>
>;
```

在路由 handler 的类型签名中，`res` 参数实际使用 `VextResponse`（包含内部方法），但用户代码通常不需要调用这些内部 API；`VextPublicResponse` 适合只希望暴露稳定公共响应面的封装和扩展类型。

---

## 内部方法（不建议直接使用）

<a id="_getrawbodybuffer"></a>

### `_getRawBodyBuffer()` 与 `_getRawBody()`

内部请求读取接口，供框架与解析插件使用。公开签名包含可选的字节上限：

```typescript
_getRawBodyBuffer(maxBytes?: number): Promise<Buffer>;
_getRawBody(maxBytes?: number): Promise<string>;
```

读取结果带缓存，原始流只消费一次；GET/HEAD/OPTIONS返回空结果。传入 `maxBytes` 会检查上限，超过时产生413错误；重复读取缓存时也检查本次上限。Buffer方法保留原始字节，字符串方法按UTF-8解码。

```typescript
// 插件工具片段：读取原始字节；此函数不负责解析multipart
import type { VextRequest } from "vextjs";

async function readUploadBytes(req: VextRequest): Promise<Buffer> {
  return req._getRawBodyBuffer(1024 * 1024);
}
```

需要自定义multipart解析器时，应用须实现解析、文件/字段限制和持久化，并明确与内置解析的先后关系；该Buffer接口本身会将数据读入内存，不是流式落盘方案。标准上传优先使用[`files`](#files)对应的内置能力。

### `rawJson(data, status?)`

返回原始 JSON，不经过出口包装。供框架内部的错误处理、限流和其他响应流程使用。

```typescript
function rawJson(data: unknown, status?: number): void;
```

```typescript
// 框架内部 error-handler 使用
res.rawJson(
  {
    code: -1,
    message: "Internal Server Error",
    requestId: req.requestId,
  },
  500,
);
```

:::warning
用户代码不应直接调用 `rawJson()`。如需绕过出口包装，请设置 `config.response.wrap: false`，然后使用标准的 `res.json()`。
:::

### `_enableWrap()`

开启出口包装标志。仅由内置 `response-wrapper` 中间件调用。

```typescript
function _enableWrap(): void;
```

调用后，后续的 `json()` 调用会自动将响应体包装为 `{ code: 0, data, requestId }` 格式。

---

## 使用模式

### 标准 CRUD 响应

以下是两文件完整示例，沿用[快速开始](/zh/guide/quick-start)的 `package.json`、TypeScript配置以及dev/build/start脚本。数据保存在进程内存，重启后重置，用于观察响应与校验。

```typescript
// src/config/default.ts
export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: "native",
  frontend: { enabled: false },
};
```

```typescript
// src/routes/items.ts
import { randomUUID } from "node:crypto";
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  const items = new Map<string, { id: string; name: string }>();

  app.get("/", async (_req, res) => {
    res.json([...items.values()]);
  });

  app.post(
    "/",
    { validate: { body: { name: "string:1-50!" } } },
    async (req, res) => {
      const item = { id: randomUUID(), name: req.valid("body").name };
      items.set(item.id, item);
      res.setHeader("Location", `/items/${item.id}`).json(item, 201);
    },
  );

  app.get(
    "/:id",
    { validate: { param: { id: "uuid!" } } },
    async (req, res) => {
      const item = items.get(req.valid("param").id);
      if (!item) return app.throw(404, "条目不存在");
      res.json(item);
    },
  );

  app.put(
    "/:id",
    { validate: { param: { id: "uuid!" }, body: { name: "string:1-50!" } } },
    async (req, res) => {
      const { id } = req.valid("param");
      if (!items.has(id)) return app.throw(404, "条目不存在");
      const item = { id, name: req.valid("body").name };
      items.set(id, item);
      res.json(item);
    },
  );

  app.delete(
    "/:id",
    { validate: { param: { id: "uuid!" } } },
    async (req, res) => {
      if (!items.delete(req.valid("param").id)) {
        return app.throw(404, "条目不存在");
      }
      res.status(204).json(null);
    },
  );
});
```

运行 `npm run dev`，按顺序验证：

```powershell
$createdItem = Invoke-RestMethod http://127.0.0.1:3000/items -Method Post -ContentType 'application/json' -Body '{"name":"First"}'
$itemId = $createdItem.data.id
Invoke-RestMethod "http://127.0.0.1:3000/items/$itemId"
Invoke-RestMethod "http://127.0.0.1:3000/items/$itemId" -Method Put -ContentType 'application/json' -Body '{"name":"Updated"}'
Invoke-WebRequest "http://127.0.0.1:3000/items/$itemId" -Method Delete
```

预期创建201且有Location，读取/更新200，删除204且无body；随后读取同一id应404。缺失name应422，非UUID路径参数应400。基础配置默认启用JSON包装，所以从 `data.id` 读取id。停止dev后执行 `npm run build -- --typecheck`、`npm start`，从创建开始复验一次。持久化及服务层拆分见[服务](/zh/guide/services)和[数据库](/zh/guide/database)。

### 错误处理

下列是已有 `user` 服务时的路由片段，服务需实现 `findById`；完整内存404流程已包含在上例中。

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", async (req, res) => {
    const user = await app.services.user.findById(req.params.id);

    if (!user) {
      // 框架自动捕获，转换为标准错误响应
      app.throw(404, "用户不存在");
    }

    res.json(user);
  });
});
```

`app.throw()` 抛出的错误由框架 `error-handler` 中间件统一捕获，转换为标准错误响应：

```json
{
  "code": 404,
  "message": "用户不存在",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

如果你需要主动返回一个明确的 HTTP 错误，请使用 `app.throw(...)`。如果是未预期的运行时失败，也可以直接 `throw new Error("...")`，框架会把它捕获为 500；当 `response.hideInternalErrors = false` 时，开发环境下的 JSON 500 响应会额外附带 `stack`。

### 自定义响应头 + 状态码

```typescript
app.post(
  "/inspect-upload",
  { multipart: { enabled: true, files: { file: { required: true } } } },
  async (req, res) => {
    const file = req.files?.find((entry) => entry.fieldname === "file");
    if (!file) return app.throw(422, "缺少文件");
    res.setHeader("X-File-Size", String(file.size)).json({ size: file.size });
  },
);
```

这个片段只检查上传文件，不持久化，因此返回200；创建资源后返回201与Location的方式见完整CRUD示例。

### 流式文件下载

```typescript
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

// 应用准备好的允许下载目录；文件需存在且对运行进程可读。
const downloads = new Map([["report", resolve("public/report.csv")]]);

app.get("/download/:key", async (req, res) => {
  const filepath = downloads.get(req.params.key ?? "");
  if (!filepath) return app.throw(404, "文件不存在");
  let file: FileHandle;
  try {
    file = await open(filepath, "r");
  } catch {
    return app.throw(404, "文件不存在或不可读");
  }
  const stream = file.createReadStream();
  req.onClose(() => stream.destroy());
  res.download(stream, "report.csv", "text/csv");
});
```

通过应用控制的key到文件映射选择资源，不把用户路径直接拼入目录。FileHandle创建的流在结束/销毁时关闭文件；流开始后的磁盘错误由响应出口处理，不能由已完成的open捕获逻辑改成404。

### 条件响应

下面的片段可放进前述CRUD的 `defineRoutes` 回调，复用其中的 `items`。这里演示精确匹配 `Accept: text/plain`，没有实现完整HTTP内容协商。

```typescript
app.get(
  "/:id/summary",
  { validate: { param: { id: "uuid!" } } },
  async (req, res) => {
    const item = items.get(req.valid("param").id);
    if (!item) return app.throw(404, "条目不存在");
    res.setHeader("Vary", "Accept");
    if (req.headers.accept === "text/plain") {
      res.text(`Item: ${item.name}`);
    } else {
      res.json(item);
    }
  },
);
```

---

## 中间件中的请求与响应

### 洋葱模型

中间件通过 `await next()` 实现洋葱模型，可以在 handler 执行前后分别处理请求和响应：

下游抛错会中断常规after代码，需要无论成功失败都执行的逻辑应放进 `finally`；耗时到退栈为止，不等于流式传输完成时间。注册、白名单和完整组合见[中间件](/zh/guide/middleware)。

```typescript
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  // ── before handler ──
  const start = Date.now();
  req.app.logger.info({ method: req.method, path: req.path }, "请求开始");

  await next(); // 执行 handler（及后续中间件）

  // ── after handler ──
  const duration = Date.now() - start;
  req.app.logger.info(
    {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
    },
    "请求完成",
  );
});
```

### 修改请求

中间件可以在 `next()` 之前修改请求对象：

下例中的 `verifyJWT` 需由应用实现并导入，`req.user` 类型沿用上方声明合并示例；真正的身份与Guard组合见[认证与安全](/zh/guide/security)。

```typescript
export default defineMiddleware(async (req, _res, next) => {
  // 解析 JWT，注入用户信息
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    req.user = await verifyJWT(token);
  }
  await next();
});
```

### 短路响应

中间件可以不调用 `next()`，直接返回响应（短路）：

```typescript
import { defineMiddleware } from "vextjs";

const blockedIps = new Set(["192.0.2.10"]); // 替换为应用自己的名单
export default defineMiddleware(async (req, res, next) => {
  if (blockedIps.has(req.ip)) return req.app.throw(403, "访问被拒绝");
  await next();
});
```

也可发送响应后立即return来结束请求。标准错误体使用 `app.throw()`；`res.status(403).json(...)` 仍经过普通业务JSON包装，设置状态码不会自动把它转换为错误合同。

---

## 类型导入

```typescript
import type { VextRequest, VextResponse, VextPublicResponse } from "vextjs";
```

这些类型通常不需要显式导入 —— 在 `defineRoutes` 和 `defineMiddleware` 的回调中，`req` 和 `res` 的类型由 TypeScript 自动推断。只有在编写独立的工具函数时才需要显式导入类型：

```typescript
import type { VextRequest } from "vextjs";

function extractUser(req: VextRequest) {
  return req.user;
}
```

# 请求与响应

本页详细介绍 VextJS 的请求对象 `VextRequest` 和响应对象 `VextResponse` 的完整 API。

## VextRequest

`VextRequest` 是框架统一的请求对象接口。由各 Adapter 负责将底层框架的原始请求转换为此接口，确保切换 Adapter 时业务代码无需改动。

### 属性一览

| 属性        | 类型                                  | 说明                                                                                                  |
| ----------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `method`    | `string`                              | HTTP 方法（大写，如 `'GET'`、`'POST'`）                                                               |
| `url`       | `string`                              | 完整请求 URL                                                                                          |
| `path`      | `string`                              | 路径部分（不含 query string）                                                                         |
| `route`     | `string`                              | 当前请求匹配的路由模板（如 `/users/:id`）；静态路由与 `path` 相同；未匹配路由（404）时为空字符串 `''` |
| `params`    | `Record<string, string>`              | 路径动态参数                                                                                          |
| `query`     | `Record<string, string>`              | URL 查询参数（已解析）                                                                                |
| `body`      | `unknown`                             | 请求体（由 body-parser 中间件填充）                                                                   |
| `headers`   | `Record<string, string \| undefined>` | 请求头（全部小写 key）                                                                                |
| `app`       | `VextApp`                             | 当前请求所属的应用实例                                                                                |
| `requestId` | `string`                              | 请求唯一标识                                                                                          |
| `ip`        | `string`                              | 客户端 IP                                                                                             |
| `protocol`  | `'http' \| 'https'`                   | 请求协议                                                                                              |
| `t`         | `Function \| undefined`               | i18n 翻译函数（插件注入）                                                                             |
| `files`     | `ParsedFile[] \| undefined`           | 文件上传列表（multipart 插件解析后填充）                                                 |

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

完整的请求 URL，包含路径和查询字符串。

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

URL 查询参数，已解析为键值对。

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

路由 handler 通常通过 `defineRoutes` 的闭包直接访问 `app`。但**路由级中间件**没有闭包，必须通过 `req.app` 访问框架能力：

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

### `requestId`

请求唯一标识，用于日志关联和分布式链路追踪。

生成规则：

1. 优先从请求头 `x-request-id`（可配置）透传（适用于网关/代理已生成 ID 的场景）
2. 请求头不存在时，框架自动生成 UUID v4
3. 可通过 `config.requestId.generate` 或 `app.setRequestIdGenerator()` 自定义生成算法

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
部署在反向代理（Nginx / 云负载均衡器）之后时，必须设置 `trustProxy: true`，否则 `req.ip` 始终是代理服务器的 IP。
:::

---

### `protocol`

请求协议。

| `config.trustProxy` | 行为                              |
| ------------------- | --------------------------------- |
| `false`（默认）     | 始终返回 `'http'`                 |
| `true`              | 从 `X-Forwarded-Proto` 请求头读取 |

```typescript
app.get("/info", async (req, res) => {
  console.log(req.protocol); // 'https'
});
```

---

### `valid(location)`

获取经过 `validate` 校验并类型转换后的数据。

```typescript
function valid<T = Record<string, any>>(
  location: "query" | "body" | "param" | "header",
): T;
```

**参数**：

| 参数       | 类型                                       | 说明         |
| ---------- | ------------------------------------------ | ------------ |
| `location` | `'query' \| 'body' \| 'param' \| 'header'` | 校验数据位置 |

**`location` 与数据源映射**：

| location   | 数据源        | 说明         |
| ---------- | ------------- | ------------ |
| `'query'`  | `req.query`   | URL 查询参数 |
| `'body'`   | `req.body`    | 请求体       |
| `'param'`  | `req.params`  | 路径动态参数 |
| `'header'` | `req.headers` | 请求头       |

:::tip
注意 `location` 使用**单数** `'param'`（与 `validate` 配置的 key 一致），但底层数据源是**复数** `req.params`。框架内部已正确映射。
:::

**基本用法**：

```typescript
app.get(
  "/users",
  {
    validate: {
      query: { page: "number:1-", limit: "number:1-100" },
    },
  },
  async (req, res) => {
    const { page, limit } = req.valid("query");
    // page: number（已从字符串 '1' 自动转换为数字 1）
    // limit: number
  },
);
```

**泛型用法**：

```typescript
interface UserQuery {
  page: number;
  limit: number;
  keyword?: string;
}

const query = req.valid<UserQuery>("query");
// query.page   → IDE 提示 number
// query.limit  → IDE 提示 number
// query.keyword → IDE 提示 string | undefined
```

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
必须在 `options.validate` 中配置了对应位置后才能调用 `req.valid()`。未配置的位置调用 `req.valid()` 返回 `undefined`。
:::

---

### `onClose(handler)`

注册请求关闭钩子，在客户端断开连接时触发。

```typescript
function onClose(handler: () => void): void;
```

主要用于 SSE / WebSocket 等长连接场景，客户端断开时清理资源：

```typescript
app.get("/sse", async (req, res) => {
  const stream = createSSEStream();

  req.onClose(() => {
    stream.close();
    console.log("客户端断开");
  });

  res.stream(stream, "text/event-stream");
});
```

:::tip
框架在 hooks 执行完毕后会自动清空 hooks 数组，无需手动移除，不会因闭包引用造成内存泄漏。
:::

---

### `t(key, params?)`

i18n 翻译函数，由 i18n 插件注入。未启用 i18n 时为 `undefined`。

```typescript
function t(key: string, params?: Record<string, unknown>): string;
```

**用法**：

```typescript
app.get("/greeting", async (req, res) => {
  if (req.t) {
    const message = req.t("welcome", { name: "Alice" });
    // → '欢迎, Alice'（中文）或 'Welcome, Alice'（英文）
    res.json({ message });
  }
});
```

---

### `files`

文件上传列表，初始状态为 `undefined`。需配合文件上传插件（如 busboy 插件）设置。每个元素符合 `ParsedFile` 接口：

```typescript
interface ParsedFile {
  fieldname: string;  // 表单字段名称
  filename: string;   // 上传文件名
  mimetype: string;   // MIME 类型，如 'image/png'
  buffer: Buffer;     // 文件原始内容
  size: number;       // 文件字节数
}
```

```typescript
app.post("/upload", { middlewares: ["upload"] }, async (req, res) => {
  const file = req.files?.[0];
  if (!file) {
    res.json({ code: 400, message: "未上传文件" }, 400);
    return;
  }
  // file.buffer 包含文件内容的完整 Buffer
  res.json({ filename: file.filename, size: file.size });
});
```

---

### `_getRawBodyBuffer()`

> ℹ️ 此为框架内部方法，主要供插件开发者使用。

```typescript
_getRawBodyBuffer(): Promise<Buffer>
```

返回原始请求体的 `Buffer`。每个 adapter 保证只消费一次数据流，结果内部缓存。阿这是实现文件上传插件的基础方法：

```typescript
// 插件示例（使用 busboy 解析 multipart/form-data）
import { createBusboy } from 'busboy';
import type { ParsedFile } from 'vextjs';

export default definePlugin(async (app) => {
  app.use(async (req, _res, next) => {
    const ct = req.headers['content-type'] ?? '';
    if (!ct.startsWith('multipart/form-data')) { await next(); return; }

    const rawBuffer = await req._getRawBodyBuffer();
    const files: ParsedFile[] = await parseMultipart(rawBuffer, ct);
    req.files = files;
    await next();
  });
});
```

---

### 扩展字段

中间件和插件可在 `req` 上挂载自定义字段。通过 `declare module` 扩展接口可获得类型提示：

```typescript
// types/vext.d.ts
declare module "vextjs" {
  interface VextRequest {
    user?: {
      id: string;
      role: "admin" | "user";
    };
  }
}
```

```typescript
// 中间件中设置
export default defineMiddleware(async (req, _res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  req.user = await verifyToken(token);
  await next();
});

// handler 中使用
app.get("/profile", { middlewares: ["auth"] }, async (req, res) => {
  res.json(req.user); // IDE 知道类型是 { id: string; role: 'admin' | 'user' }
});
```

---

## VextResponse

`VextResponse` 是框架统一的响应对象接口。提供 JSON 响应、文本响应、流式响应、重定向等能力。

### 方法一览

| 方法                                         | 返回值   | 说明                           |
| -------------------------------------------- | -------- | ------------------------------ |
| `json(data, status?)`                        | `void`   | 返回 JSON 响应（经过出口包装） |
| `text(content, status?)`                     | `void`   | 返回纯文本响应                 |
| `stream(readable, contentType?)`             | `void`   | 流式响应                       |
| `download(readable, filename, contentType?)` | `void`   | 文件下载                       |
| `redirect(url, status?)`                     | `void`   | 重定向                         |
| `status(code)`                               | `this`   | 设置状态码（链式调用）         |
| `setHeader(name, value)`                     | `this`   | 设置响应头（链式调用）         |
| `statusCode`                                 | `number` | 当前状态码（只读）             |

---

### `json(data, status?)`

返回 JSON 响应。这是最常用的响应方法。

```typescript
function json(data: unknown, status?: number): void;
```

**参数**：

| 参数     | 类型      | 默认值 | 说明                |
| -------- | --------- | ------ | ------------------- |
| `data`   | `unknown` | —      | 业务数据            |
| `status` | `number`  | `200`  | HTTP 状态码（可选） |

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

---

### `stream(readable, contentType?)`

流式响应，用于大文件传输或实时数据流。

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
app.get("/events", async (req, res) => {
  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        controller.enqueue(`data: ${JSON.stringify({ time: Date.now() })}\n\n`);
      }, 1000);

      req.onClose(() => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  res.stream(stream, "text/event-stream");
});
```

---

### `download(readable, filename, contentType?)`

文件下载响应，自动设置 `Content-Disposition: attachment` 头。

```typescript
function download(
  readable: NodeJS.ReadableStream,
  filename: string,
  contentType?: string,
): void;
```

**参数**：

| 参数          | 类型                    | 默认值                       | 说明                     |
| ------------- | ----------------------- | ---------------------------- | ------------------------ |
| `readable`    | `NodeJS.ReadableStream` | —                            | 文件流                   |
| `filename`    | `string`                | —                            | 下载文件名（浏览器显示） |
| `contentType` | `string`                | `'application/octet-stream'` | MIME 类型                |

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

浏览器收到响应后会弹出文件下载对话框。

---

### `redirect(url, status?)`

HTTP 重定向。

```typescript
function redirect(url: string, status?: 301 | 302 | 307 | 308): void;
```

**参数**：

| 参数     | 类型                       | 默认值 | 说明         |
| -------- | -------------------------- | ------ | ------------ |
| `url`    | `string`                   | —      | 目标 URL     |
| `status` | `301 \| 302 \| 307 \| 308` | `302`  | 重定向状态码 |

```typescript
// 临时重定向（302）
res.redirect("/new-page");

// 永久重定向（301）
res.redirect("/new-permanent-page", 301);

// 临时重定向保持方法（307）
res.redirect("/api/v2/users", 307);

// 永久重定向保持方法（308）
res.redirect("/api/v2/users", 308);
```

**重定向状态码说明**：

| 状态码 | 说明               | 是否保持 HTTP 方法 |
| ------ | ------------------ | ------------------ |
| `301`  | 永久重定向         | 否（可能变为 GET） |
| `302`  | 临时重定向（默认） | 否（可能变为 GET） |
| `307`  | 临时重定向         | 是                 |
| `308`  | 永久重定向         | 是                 |

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
function setHeader(name: string, value: string): this;
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

// 安全相关
res.setHeader("X-Content-Type-Options", "nosniff");
res.setHeader("X-Frame-Options", "DENY");

// 自定义业务头
res.setHeader("X-RateLimit-Remaining", "95");
```

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

用户可见的响应类型，通过 `Omit` 排除了内部方法：

```typescript
type VextPublicResponse = Omit<VextResponse, "_enableWrap" | "rawJson">;
```

在路由 handler 的类型签名中，`res` 参数实际使用 `VextResponse`（包含内部方法），但用户代码通常不需要调用 `_enableWrap()` 和 `rawJson()` —— 这些由框架内部的 `response-wrapper` 和 `error-handler` 中间件使用。

---

## 内部方法（不建议直接使用）

### `rawJson(data, status?)`

返回原始 JSON，不经过出口包装。仅供框架内部 `error-handler` 使用。

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

```typescript
export default defineRoutes((app) => {
  // 列表查询
  app.get("/list", async (req, res) => {
    const items = await app.services.item.findAll();
    res.json(items);
    // → { code: 0, data: [...], requestId: '...' }
  });

  // 创建
  app.post("/", async (req, res) => {
    const item = await app.services.item.create(req.valid("body"));
    res.json(item, 201);
    // → 201 { code: 0, data: { id: '...' }, requestId: '...' }
  });

  // 更新
  app.put("/:id", async (req, res) => {
    const item = await app.services.item.update(
      req.valid("param").id,
      req.valid("body"),
    );
    res.json(item);
  });

  // 删除
  app.delete("/:id", async (req, res) => {
    await app.services.item.delete(req.valid("param").id);
    res.status(204).json(null);
    // → 204 No Content
  });
});
```

### 错误处理

```typescript
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
  "code": -1,
  "message": "用户不存在",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 自定义响应头 + 状态码

```typescript
app.post("/upload", async (req, res) => {
  const result = await processUpload(req.body);

  res
    .status(201)
    .setHeader("Location", `/files/${result.id}`)
    .setHeader("X-File-Size", String(result.size))
    .json(result);
});
```

### 流式文件下载

```typescript
import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";

app.get("/download/:filename", async (req, res) => {
  const filepath = join("/data/files", req.params.filename);

  try {
    const stat = statSync(filepath);
    const stream = createReadStream(filepath);

    res
      .setHeader("Content-Length", String(stat.size))
      .download(stream, req.params.filename);
  } catch {
    app.throw(404, "文件不存在");
  }
});
```

### 条件响应

```typescript
app.get("/users/:id", async (req, res) => {
  const user = await app.services.user.findById(req.valid("param").id);

  if (!user) {
    app.throw(404, "用户不存在");
  }

  // 根据请求头决定响应格式
  if (req.headers.accept === "text/plain") {
    res.text(`User: ${user.name} <${user.email}>`);
  } else {
    res.json(user);
  }
});
```

---

## 中间件中的请求与响应

### 洋葱模型

中间件通过 `await next()` 实现洋葱模型，可以在 handler 执行前后分别处理请求和响应：

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
export default defineMiddleware(async (req, res, next) => {
  if (isBlacklisted(req.ip)) {
    res.status(403).json({ message: "访问被拒绝" });
    return; // 不调用 next()，handler 不会执行
  }
  await next();
});
```

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

# Fetch API

本页提供 `app.fetch` 内置 HTTP 客户端的精简 API 参考。完整的使用指南、示例和最佳实践请参阅 [内置 HTTP 客户端指南](/guide/fetch)。

## app.fetch(input, init?)

发送 HTTP 请求。签名与原生 `fetch` 兼容，额外支持超时、重试和 requestId 传播。

```typescript
const response: Promise<Response> = app.fetch(
  input: string | URL | Request,
  init?: VextFetchInit,
);
```

**参数**

| 参数    | 类型                       | 说明                             |
| ------- | -------------------------- | -------------------------------- |
| `input` | `string \| URL \| Request` | 请求 URL 或 Request 对象         |
| `init`  | `VextFetchInit`            | 可选，请求配置（见下方类型定义） |

**返回值**: `Promise<Response>` — 标准 Fetch API Response 对象

`app.fetch` 会触发 `fetch:before`、`fetch:after`、`fetch:error` hook；`app.fetch.proxy` 会触发 `proxy:before`、`proxy:after`、`proxy:error` hook。完整 payload 和执行策略见 [应用实例 hooks](/api/app#apphooks)。

---

## 快捷方法

### app.fetch.get(url, init?)

```typescript
app.fetch.get(url: string, init?: VextFetchInit): Promise<Response>
```

发送 GET 请求。

### app.fetch.post(url, body?, init?)

```typescript
app.fetch.post(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

发送 POST 请求。当 `body` 不为 `null`/`undefined` 时，会自动 `JSON.stringify` 并设置 `Content-Type: application/json`；当 `body` 为空时，不设置 `Content-Type`，也不发送请求体。

### app.fetch.put(url, body?, init?)

```typescript
app.fetch.put(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

发送 PUT 请求。`body` 处理行为与 `post` 相同（仅在 `body != null` 时设置 `Content-Type`）。

### app.fetch.patch(url, body?, init?)

```typescript
app.fetch.patch(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

发送 PATCH 请求。`body` 处理行为与 `post` 相同（仅在 `body != null` 时设置 `Content-Type`）。

### app.fetch.delete(url, init?)

```typescript
app.fetch.delete(url: string, init?: VextFetchInit): Promise<Response>
```

发送 DELETE 请求。

---

## app.fetch.create(options)

创建预配置的子客户端实例。子客户端拥有独立的 `baseURL`、默认 headers、超时和重试配置。

```typescript
app.fetch.create(options: VextFetchClientOptions): VextFetchClient
```

子客户端上也挂载了完整的快捷方法（`get` / `post` / `put` / `patch` / `delete`）和 `create()`，但**不会暴露 `proxy`**。代理能力只挂在根 `app.fetch.proxy` 上，避免 `app.fetch.create().proxy` 带来额外心智负担。

```typescript
const client = app.fetch.create({
  baseURL: "http://user-service:3001/api/v1",
  headers: { "x-service-name": "order-service" },
  timeout: 5000,
  retry: 2,
});

// 自动拼接 baseURL
const response = await client.get("/users/123");
// 实际请求: GET http://user-service:3001/api/v1/users/123
```

---

## app.fetch.proxy

`app.fetch.proxy` 用于在路由 handler 中将当前请求代理到上游服务，并把上游响应直接透传给客户端。它不把 2xx / 3xx / 4xx / 5xx 上游响应包装为 `{ code, data, requestId }`；只有本地参数错误、目标不存在、上游网络错误或超时等代理本地错误才返回 vext 风格错误响应。

### 命名目标代理

命名目标来自 `config.fetch.proxy[]`：

```typescript
// src/config/default.ts
export default {
  fetch: {
    proxy: [
      {
        name: "userService",
        baseURL: "http://user-service:3001/api",
        forwardHeaders: ["x-tenant-id", "traceparent"],
        headers: { "x-source": "gateway" },
        timeout: 5000,
        retry: 1,
      },
    ],
  },
};
```

`name` 会映射到 `app.fetch.proxy.<name>`，不能使用保留名 `then`。

调用时使用 `app.fetch.proxy.<name>(req, res, options)`：

```typescript
app.get("/users/:id", async (req, res) => {
  await app.fetch.proxy.userService(req, res, {
    path: `/users/${req.params.id}`,
    query: { includeProfile: true },
    injectHeaders: { "x-route": "users-proxy" },
  });
});
```

### 直接 URL 代理

不使用命名目标时，可直接调用 `app.fetch.proxy(req, res, { url })`：

```typescript
app.get("/health/upstream", async (req, res) => {
  await app.fetch.proxy(req, res, {
    url: "https://api.example.com/health",
  });
});
```

### header 优先级

代理请求头按以下顺序合并，后者覆盖前者：

```text
target.headers
  < forwardHeaders（从当前 req.headers 白名单透传）
  < target.defaultInjectHeaders
  < options.headers
  < options.injectHeaders
```

`Authorization` 不会默认从当前请求透传。只有当目标配置或本次调用设置 `allowAuthorizationForward: true`，并且 `forwardHeaders` 明确包含 `authorization` 时，才允许透传原始 Authorization。

### retry 合同

代理重试配置优先级：

```text
options.retry > target.retry > config.fetch.retry > 0
options.retryDelay > target.retryDelay > config.fetch.retryDelay > 1000
```

`retry` 表示额外尝试次数，因此总尝试次数为 `retry + 1`。仅 `GET` / `HEAD` / `OPTIONS` / `PUT` / `DELETE` 这些幂等方法会自动重试；`POST` / `PATCH` 默认不重试。可重试条件为上游 5xx 或 DNS / 连接等网络错误；2xx / 3xx / 4xx 不重试，超时不重试并返回本地 504，客户端断开时不再写响应。

---

## 类型定义

### VextFetchInit

继承自标准 `RequestInit`，扩展以下字段：

```typescript
interface VextFetchInit extends RequestInit {
  /** 请求超时（毫秒），默认使用全局 config.fetch.timeout */
  timeout?: number;

  /**
   * 重试次数（仅对幂等方法 GET/HEAD/OPTIONS/PUT/DELETE 生效）
   * @default 0
   */
  retry?: number;

  /**
   * 重试间隔（毫秒）或指数退避函数
   * @default 1000
   */
  retryDelay?: number | ((attempt: number) => number);

  /**
   * 是否自动注入 x-request-id 头
   * @default true
   */
  propagateRequestId?: boolean;

  /**
   * 本次请求额外需要透传到出站请求的头名称列表
   *
   * 这些头的值会从 requestContext.store.propagatedHeaders 中读取（由 requestId 中间件
   * 在入站阶段根据 config.fetch.propagateHeaders 列表捕获写入）。
   *
   * 如需透传未在全局 config.fetch.propagateHeaders 中声明的头，
   * 请直接在 init.headers 中手动设置。
   *
   * @example ['traceparent', 'tracestate']
   */
  propagateHeaders?: string[];
}
```

| 字段                 | 类型                                    | 默认值                           | 说明                                                                                     |
| -------------------- | --------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `timeout`            | `number`                                | `config.fetch.timeout` (10000)   | 请求超时（毫秒）                                                                         |
| `retry`              | `number`                                | `config.fetch.retry` (0)         | 重试次数（仅幂等方法）                                                                   |
| `retryDelay`         | `number \| (attempt: number) => number` | `config.fetch.retryDelay` (1000) | 重试间隔，支持指数退避函数                                                               |
| `propagateRequestId` | `boolean`                               | `true`                           | 是否自动注入 `x-request-id` 头（禁用时 `propagatedHeaders` 仍然透传）                    |
| `propagateHeaders`   | `string[]`                              | —                                | 本次请求额外透传的头（需已在 `config.fetch.propagateHeaders` 中声明才能从 store 读到值） |

### VextFetchClientOptions

`create()` 工厂方法的配置选项。

```typescript
interface VextFetchClientOptions {
  /** 基础 URL，所有请求路径自动拼接 */
  baseURL: string;

  /** 默认请求头（与单次请求 headers 合并） */
  headers?: Record<string, string>;

  /** 子客户端默认超时（毫秒） */
  timeout?: number;

  /** 子客户端默认重试次数 */
  retry?: number;

  /** 子客户端默认重试间隔（毫秒）或指数退避函数 */
  retryDelay?: number | ((attempt: number) => number);
}
```

| 字段         | 类型                                    | 必填 | 说明                                  |
| ------------ | --------------------------------------- | :--: | ------------------------------------- |
| `baseURL`    | `string`                                |  ✅  | 基础 URL，请求路径自动拼接到此 URL 后 |
| `headers`    | `Record<string, string>`                |  ❌  | 默认请求头                            |
| `timeout`    | `number`                                |  ❌  | 覆盖全局超时                          |
| `retry`      | `number`                                |  ❌  | 覆盖全局重试                          |
| `retryDelay` | `number \| (attempt: number) => number` |  ❌  | 覆盖全局重试间隔                      |

### VextFetch

根 `app.fetch` 的类型定义。既是可调用函数，又挂载了快捷方法、`create()` 和 `proxy`。

```typescript
interface VextFetchClient {
  (input: string | URL | Request, init?: VextFetchInit): Promise<Response>;
  get(url: string, init?: VextFetchInit): Promise<Response>;
  post(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  put(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  patch(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  delete(url: string, init?: VextFetchInit): Promise<Response>;
  create(options: VextFetchClientOptions): VextFetchClient;
}

interface VextFetch extends VextFetchClient {
  proxy: VextFetchProxy;
  create(options: VextFetchClientOptions): VextFetchClient;
}
```

### VextFetchProxyOptions

```typescript
interface VextFetchProxyOptions {
  path?: string;
  url?: string;
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: RequestInit["body"] | Buffer | Uint8Array;
  maxBodySize?: number;
  headers?: Record<string, string>;
  forwardHeaders?: string[];
  injectHeaders?: Record<string, string> | ((ctx) => Record<string, string>);
  allowAuthorizationForward?: boolean;
  timeout?: number;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
}
```

命名目标模式使用 `path`；直接 URL 模式使用 `url`。未传 `method` 时默认使用当前 `req.method`。未传 `body` 时，非 GET / HEAD 请求会读取当前 `req` 的原始 body Buffer 并转发。

---

## 全局配置

在 `vext.config.ts` 中通过 `fetch` 字段配置全局默认值：

```typescript
// src/config/default.ts
export default {
  fetch: {
    timeout: 10000,
    retry: 0,
    retryDelay: 1000,
    propagateHeaders: [],
    proxy: [],
  },
};
```

| 配置项             | 类型                                    | 默认值  | 说明                                                                                      |
| ------------------ | --------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `timeout`          | `number`                                | `10000` | 全局默认超时（毫秒）                                                                      |
| `retry`            | `number`                                | `0`     | 全局默认重试次数                                                                          |
| `retryDelay`       | `number \| (attempt: number) => number` | `1000`  | 全局默认重试间隔（毫秒），支持指数退避函数                                                |
| `propagateHeaders` | `string[]`                              | `[]`    | 声明需要从入站请求自动捕获并透传到出站请求的头名称列表（如 `traceparent`、`x-tenant-id`） |
| `proxy`            | `VextFetchProxyTargetConfig[]`          | `[]`    | `app.fetch.proxy.<name>()` 的配置化上游目标列表                                           |

:::tip propagateHeaders 工作原理
配置后，框架在每个请求的 `requestId` 中间件阶段，从入站请求头中读取列表中指定的头，
写入 `requestContext.store.propagatedHeaders`。`app.fetch` 出站时自动从 store 中读取并注入，
**无需在每次调用时手动传递**。

- 全局配置 `config.fetch.propagateHeaders`：声明哪些头需要被捕获和透传
- 未在全局配置中声明的头：在 `init.headers` 中手动设置即可
- 详见 [请求上下文 → 与分布式追踪的关系](/guide/request-context#与分布式追踪traceid的关系)
  :::

### 优先级

```
普通出站请求：单次请求 init > create() options > 全局 config.fetch

代理请求：options > target（config.fetch.proxy[] 单项）> 全局 config.fetch
```

---

## 行为说明

### 超时

- 使用 `AbortController` + `setTimeout` 实现
- 超时后抛出 `Error`，消息格式：`[app.fetch] GET https://... timed out after 10000ms`
- 如果同时传入了 `init.signal`，会与超时 signal 合并——任一触发都中止请求

### 重试

- **仅幂等方法**重试：`GET` / `HEAD` / `OPTIONS` / `PUT` / `DELETE`
- **POST / PATCH 不重试**（避免副作用重复执行）
- 触发条件：HTTP 5xx 响应 或 网络错误
- 不触发：超时（直接抛错）、4xx 响应
- `retryDelay` 支持函数形式实现指数退避：`(attempt) => Math.min(1000 * 2 ** attempt, 10000)`

### requestId 传播

- 自动从 `requestContext`（AsyncLocalStorage）读取当前请求的 `requestId`
- 注入到出站请求的 `x-request-id` 头
- 设置 `propagateRequestId: false` 可禁用

### 结构化日志

每个出站请求自动记录结构化日志：

| 条件            | 日志级别 |
| --------------- | -------- |
| 2xx / 3xx 响应  | `debug`  |
| 4xx 响应        | `warn`   |
| 5xx 响应        | `error`  |
| 网络错误 / 超时 | `error`  |

日志字段：`type: "outbound"` / `method` / `url` / `status` / `duration` / `requestId`

---

## 替换实现

当前版本未暴露 `app.setFetch()` 公共 API，因此这里不支持直接替换内置实现。

如果你需要不同的 HTTP 客户端策略，推荐保留 `app.fetch` 作为框架默认实现，再通过插件额外挂载自定义客户端：

```typescript
app.extend(
  "customFetch",
  app.fetch.create({
    baseURL: "https://api.example.com",
    timeout: 5000,
  }),
);
```

:::warning
如果完全绕过 `app.fetch`，requestId 传播、超时、重试和结构化日志能力都需要自行补齐。
:::

---

## 类型导入

```typescript
import type {
  VextFetch,
  VextFetchClient,
  VextFetchConfig,
  VextFetchInit,
  VextFetchClientOptions,
  VextFetchProxyOptions,
  VextFetchProxyTargetConfig,
} from "vextjs";
```

## 下一步

- 阅读 [内置 HTTP 客户端指南](/guide/fetch) 了解完整用法和最佳实践
- 查看 [应用实例](/api/app) 中 `app.fetch` 的挂载位置
- 了解 [配置项](/api/config) 中 `fetch` 相关的全局配置

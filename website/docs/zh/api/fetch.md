# Fetch API

本页提供 `app.fetch` 内置 HTTP 客户端的API 参考。完整的使用指南、示例和最佳实践请参阅 [内置 HTTP 客户端指南](/zh/guide/fetch)。

本文 `app` 指插件 setup、Service 或 `req.app` 提供的真实应用实例。当前 `defineRoutes` 的工厂参数会绑定函数，未保留 fetch 上的快捷方法、create 和 proxy；handler 内应使用 `req.app.fetch`，直接调用工厂参数的 `app.fetch(url, init)` 仍可用。实际运行例子与边界见[指南](/zh/guide/fetch#基本用法)。

## app.fetch(input, init?)

发送 HTTP 请求。签名与原生 `fetch` 兼容，额外支持超时、重试和 requestId 传播。

```typescript
type FetchCall = (
  input: string | URL | Request,
  init?: VextFetchInit,
) => Promise<Response>;
```

**参数**

| 参数    | 类型                       | 说明                             |
| ------- | -------------------------- | -------------------------------- |
| `input` | `string \| URL \| Request` | 请求 URL 或 Request 对象         |
| `init`  | `VextFetchInit`            | 可选，请求配置（见下方类型定义） |

**返回值**: `Promise<Response>` — 标准 Fetch API Response 对象。HTTP 4xx/5xx 返回 Response，由调用方检查 `ok/status`；网络异常、内部超时或取消会拒绝 Promise，正文消费由调用方负责。

出站生命周期包括 `fetch:before/after/error` 和代理的 `proxy:before/after/error`。before 每次操作一次；after 对最终收到的 Response 派发，包括 HTTP 5xx；error 不覆盖所有前置解析、before 或正文读取失败。普通 before 异常直接拒绝请求，proxy before 异常进入代理本地错误处理。具体 payload、attempt 及错误边界见[Hooks指南](/zh/guide/hooks)。

---

## 快捷方法

### app.fetch.get(url, init?)

```text
app.fetch.get(url: string, init?: VextFetchInit): Promise<Response>
```

发送 GET 请求。

### app.fetch.post(url, body?, init?)

```text
app.fetch.post(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

发送 POST 请求。当 `body` 不为 `null`/`undefined` 时，会自动 `JSON.stringify`，仅在没有显式 Content-Type 时补 `application/json`；当 body 为 null/undefined 时不生成请求体或默认 Content-Type，但会保留调用方显式提供的头。FormData、二进制或流应使用通用调用。

### app.fetch.put(url, body?, init?)

```text
app.fetch.put(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

发送 PUT 请求。`body` 处理行为与 `post` 相同（非空 body 序列化为 JSON，保留显式 Content-Type）。

### app.fetch.patch(url, body?, init?)

```text
app.fetch.patch(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

发送 PATCH 请求。`body` 处理行为与 `post` 相同（非空 body 序列化为 JSON，保留显式 Content-Type）。

### app.fetch.delete(url, init?)

```text
app.fetch.delete(url: string, init?: VextFetchInit): Promise<Response>
```

发送 DELETE 请求。

---

## app.fetch.create(options)

创建预配置的子客户端实例。子客户端可指定 `baseURL`、默认 headers、超时、重试次数和间隔。未显式指定的 timeout/retry/retryDelay 继承创建工厂的配置。

```text
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

字符串 input 总是拼接到去掉尾部斜杠的 baseURL 后，开头的 `/` 不会丢弃 `/api/v1`；完整 URL 字符串也会被拼接，绕过 baseURL 请用根客户端，或以 URL/Request 对象调用子客户端。单次 headers 优先于子客户端默认 headers，两者又优先于 ALS 自动补入的传播头。

子客户端的 `create()` 当前复用创建它的父级工厂，不会逐层累加该子客户端的 headers/baseURL/超时覆盖。嵌套调用时显式传入要保留的配置。

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

下面注册片段放在 `defineRoutes((app) => { ... })` 内。调用时通过 handler 的真实实例使用 `req.app.fetch.proxy.<name>(req, res, options)`：

```typescript
app.get("/users/:id", async (req, res) => {
  await req.app.fetch.proxy.userService(req, res, {
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
  await req.app.fetch.proxy(req, res, {
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

白名单为目标和调用两级的并集，空数组不会清除目标白名单。动态注入支持同步/异步函数，其上下文为 `{ req, target, options }`；null/undefined 的注入值被忽略，不删除已有头。

proxy 不走普通 fetch 的 ALS 传播逻辑，需要 requestId 时显式转发入站头，或通过 `injectHeaders: ({ req }) => ({ "x-request-id": req.requestId })` 注入。启用 Authorization 的许可按两级任一为 true 判断，调用级 false 不能撤销目标级 true。

### retry 合同

代理重试配置优先级：

```text
options.retry > target.retry > config.fetch.retry > 0
options.retryDelay > target.retryDelay > config.fetch.retryDelay > 1000
```

`retry` 表示额外尝试次数，因此总尝试次数为 `retry + 1`。仅 `GET` / `HEAD` / `OPTIONS` / `PUT` / `DELETE` 这些幂等方法会自动重试；`POST` / `PATCH` 默认不重试。可重试条件为上游 5xx 或 DNS / 连接等网络错误；2xx / 3xx / 4xx 不重试，超时和客户端取消不重试；代理只在响应尚未开始时返回本地 504，正文阶段超时会中断传输，不能再替换为完整 JSON 错误。请求体还必须可重放；流式 body 不会因幂等方法而自动获得重试能力。

---

### 参数与响应边界

- 命名目标要求非空 path；直接代理要求绝对 url。方法默认 req.method，GET/HEAD 忽略 body，其他方法未提供 body 时读取原始请求体，maxBodySize 约束该次读取。
- query 按 URL 中已有值 → req.query → options.query 合并；options 的 null/undefined 删除同名键。
- 使用 manual redirect 保留上游 3xx；透传时过滤 hop-by-hop、Content-Length、Content-Encoding，并保留多条 Set-Cookie。HEAD、204、304 等无正文语义由响应层执行。
- 代理本地错误的 JSON 形状是 `{ code, message, requestId }`；参数错误通常为 400，未配置目标为 500，网络失败为 502，响应头前的超时为 504。开始流式响应后只能按流生命周期处理失败。

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

  /** 类型保留字段；当前实现不读取此单次选项，不用于新增或过滤传播头 */
  propagateHeaders?: string[];
}
```

| 字段                 | 类型                                    | 默认值                           | 说明                                                                  |
| -------------------- | --------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `timeout`            | `number`                                | `config.fetch.timeout` (10000)   | 请求超时（毫秒）                                                      |
| `retry`              | `number`                                | `config.fetch.retry` (0)         | 重试次数（仅幂等方法）                                                |
| `retryDelay`         | `number \| (attempt: number) => number` | `config.fetch.retryDelay` (1000) | 重试间隔，支持指数退避函数                                            |
| `propagateRequestId` | `boolean`                               | `true`                           | 是否自动注入 `x-request-id` 头（禁用时 `propagatedHeaders` 仍然透传） |
| `propagateHeaders`   | `string[]`                              | —                                | 当前运行时不读取此单次选项；传播集合来自请求元数据中间件捕获的 store  |

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
  body?: Exclude<RequestInit["body"], null | undefined> | Buffer | Uint8Array;
  maxBodySize?: number;
  headers?: Record<string, string>;
  forwardHeaders?: string[];
  injectHeaders?: VextFetchProxyHeaders;
  allowAuthorizationForward?: boolean;
  timeout?: number;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
}
```

命名目标模式使用 `path`；直接 URL 模式使用 `url`。上述字段的合并和正文规则见[参数与响应边界](#参数与响应边界)。

### VextFetchProxyTargetConfig

```typescript
interface VextFetchProxyTargetConfig {
  name: string;
  baseURL: string;
  headers?: Record<string, string>;
  forwardHeaders?: string[];
  defaultInjectHeaders?: VextFetchProxyHeaders;
  allowAuthorizationForward?: boolean;
  timeout?: number;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
}
```

### VextFetchProxyHeaders / HeaderContext

```typescript
interface VextFetchProxyHeaderContext {
  req: VextRequest;
  target?: VextFetchProxyTargetConfig;
  options: VextFetchProxyOptions;
}

type VextFetchProxyHeaders =
  | Record<string, string | number | boolean | null | undefined>
  | ((
      ctx: VextFetchProxyHeaderContext,
    ) =>
      | Record<string, string | number | boolean | null | undefined>
      | Promise<Record<string, string | number | boolean | null | undefined>>);
```

### VextFetchProxy / Handler

```typescript
type VextFetchProxyHandler = (
  req: VextRequest,
  res: VextResponse,
  options: VextFetchProxyOptions,
) => Promise<void>;

type VextFetchProxy = ((
  req: VextRequest,
  res: VextResponse,
  options: VextFetchProxyOptions,
) => Promise<void>) &
  Record<string, VextFetchProxyHandler>;
```

---

## 全局配置

在 `src/config/default.ts` 中通过 `fetch` 字段配置全局默认值：

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
配置后，框架在每个请求的请求元数据中间件阶段，从入站请求头中读取列表中指定的头，
写入 `requestContext.store.propagatedHeaders`。`app.fetch` 出站时自动从 store 中读取并注入，
**无需在每次调用时手动传递**。捕获依赖请求上下文，不依赖 requestId 开关；显式出站头优先，不被覆盖。此规则仅针对普通 fetch，proxy 使用独立白名单。

- 全局配置 `config.fetch.propagateHeaders`：声明哪些头需要被捕获和透传
- 未在全局配置中声明的头：在 `init.headers` 中手动设置即可
- 详见 [请求上下文 → 与分布式追踪的关系](/zh/guide/request-context#与分布式追踪traceid的关系)

:::

### 优先级

```
普通出站请求：单次请求 init > create() options > 全局 config.fetch

代理请求：options > target（config.fetch.proxy[] 单项）> 全局 config.fetch
```

---

## 行为说明

timeout 必须是 `(0, 2147483647]` 内的有限数字；retry 为非负整数；retryDelay 及其每次函数返回值必须是 `[0, 2147483647]` 内的有限数字。delay 回调的 attempt 从 1 开始。

### 超时

普通 `app.fetch` 的 `timeout` 在收到响应头后结束，慢正文不会因此被中止；调用方的 `init.signal` 或 `Request.signal` 仍持续控制正文读取。重试会使用新的单次计时。`app.fetch.proxy` 的超时则覆盖上游正文转发，客户端断开会取消上游请求。

- 使用 `AbortController` + `setTimeout` 实现
- 普通 fetch 内部超时后抛出 `name: "TimeoutError"` 的 Error，消息格式：`[app.fetch] GET https://... timed out after 10000ms`
- 如果同时传入了 `init.signal`，会与超时 signal 合并——任一触发都中止请求

### 重试

- **仅幂等方法且 body 可重放**重试：`GET` / `HEAD` / `OPTIONS` / `PUT` / `DELETE`
- **POST / PATCH 不重试**（避免副作用重复执行）
- 触发条件：HTTP 5xx 响应 或 网络错误
- 不触发：内部超时、调用方取消、4xx；原始 Request body 未由 init 提供可重放替代值或流式 body 不重试
- 5xx 耗尽次数后返回 Response，网络错误耗尽次数后抛错；取消会中断重试等待并保留 reason
- 普通 fetch 不自动读取 req.signal，handler 需显式传 `{ signal: req.signal }`
- `retryDelay` 支持函数形式实现指数退避：`(attempt) => Math.min(1000 * 2 ** attempt, 10000)`

### requestId 传播

- 自动从 `requestContext`（AsyncLocalStorage）读取当前请求的 `requestId`
- store 有值且出站头未显式设置时才补入；头名跟随 config.requestId.header，默认 x-request-id
- `propagateRequestId: false` 只关闭自动补入 requestId，不删除已显式提供的头，也不禁用其他传播头

### 结构化日志

每次实际尝试会记录出站日志；前置参数错误或 before 失败不保证有此日志。表中级别还受 logger 阈值控制：

| 条件                 | 日志级别 |
| -------------------- | -------- |
| 2xx（response.ok）   | `debug`  |
| 实际返回的 3xx / 4xx | `warn`   |
| 5xx 响应             | `error`  |
| 网络错误 / 内部超时  | `error`  |
| 请求中的调用方取消   | `debug`  |

日志字段：`type: "outbound"` / `method` / `url` / `status` / `duration` / `requestId`；失败时有 error，重试日志含 attempt/maxRetries。duration 为该次尝试到响应头的耗时，不包括等待和正文。代理日志使用 type: "proxy"。

---

## 替换实现

当前版本未暴露 `app.setFetch()` 公共 API，因此这里不支持直接替换内置实现。

如果你需要不同的 HTTP 客户端策略，推荐保留 `app.fetch` 作为框架默认实现，再通过插件额外挂载自定义客户端：

```typescript
// 插件 setup(app) 中
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
  VextFetchProxyHeaders,
  VextFetchProxyHeaderContext,
  VextFetchProxyHandler,
  VextFetchProxy,
} from "vextjs";
```

## 下一步

- 阅读 [内置 HTTP 客户端指南](/zh/guide/fetch) 了解完整用法和最佳实践
- 查看 [应用实例](/zh/api/app) 中 `app.fetch` 的挂载位置
- 了解 [配置项](/zh/api/config) 中 `fetch` 相关的全局配置

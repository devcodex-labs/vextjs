# 内置 HTTP 客户端 (app.fetch)

VextJS 内置了增强版 HTTP 客户端 `app.fetch`，基于 Node.js 原生 `fetch` 封装，提供 **requestId 自动传播**、**超时控制**、**自动重试**、**结构化日志**、**create() 工厂** 和 **config 驱动代理** 等能力。无需安装任何第三方 HTTP 库即可进行服务间调用。

先按[基本用法](#基本用法)运行本地出站请求，再查阅配置、代理与重试。下文单独的调用片段放在已有 `app` 的路由、Service 或插件中；示例域名需要替换成实际服务地址。

## 功能概览

生产启动与开发启动都会在用户插件 `setup()`、服务构造函数和路由工厂执行前初始化 `app.fetch`。插件 `setup()`、服务构造函数及通过真实应用实例注册的 `onReady` 回调可以使用 `app.fetch.create()`；路由工厂参数存在下方说明的附加方法绑定限制，handler 内应使用 `req.app.fetch`。插件通过 `app.setLogger()` 设置的日志包装也会用于后续出站调用。

`req.signal` 在请求中断、连接提前关闭或路由超时时取消。完整接收 POST 请求体、正常发送响应不会取消此信号；`req.onClose()` 仍在响应结束或断连时执行清理。普通 `app.fetch()` 的 `timeout` 覆盖取得响应头的阶段，不表示随后的 `response.text()` / `response.json()` 也必须在该时限内完成；代理和流式调用需按各自的取消与超时约定使用。

| 能力               | 说明                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **requestId 传播** | 自动从 `requestContext` 读取 `requestId`，注入到出站请求的 `x-request-id` 头，实现跨服务请求追踪               |
| **超时控制**       | 基于 `AbortController` + `setTimeout`，支持全局默认 + 单次请求覆盖                                             |
| **自动重试**       | 仅对幂等方法（GET/HEAD/OPTIONS/PUT/DELETE）在 5xx 或网络错误时自动重试                                         |
| **结构化日志**     | 出站请求自动记录 method/url/status/duration/requestId，与 `app.logger` 统一                                    |
| **快捷方法**       | `get` / `post` / `put` / `patch` / `delete` 快捷调用                                                           |
| **create() 工厂**  | 创建预配置的子客户端（固定 baseURL + 默认 headers），适合对接多个微服务                                        |
| **proxy 代理**     | 通过 `config.fetch.proxy[]` 配置上游目标，路由中 `app.fetch.proxy.userService(req, res, options)` 直接透传响应 |

## 基本用法

前置：已有[快速开始](/zh/guide/quick-start)的 TypeScript API-only 项目。保留 package.json、tsconfig.json 和脚本，合并以下配置并新增路由。这里用同一进程的独立路由模拟上游，避免依赖外部测试 API；实际部署时把 `fetchDemoBaseURL` 换成内部服务地址。

```typescript
// src/config/default.ts
export default {
  host: "127.0.0.1",
  port: 3000,
  frontend: { enabled: false },
  logger: { level: "debug", pretty: false },
  fetchDemoBaseURL: "http://127.0.0.1:3000",
  fetch: { timeout: 3000, retry: 0, propagateHeaders: ["x-tenant-id"] },
};
```

```typescript
// src/routes/fetch-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/upstream/:id", async (req, res) => {
    if (req.params.id === "missing") {
      res.json({ message: "user not found" }, 404);
      return;
    }
    res.json({
      id: req.params.id,
      requestId: req.requestId,
      tenant: req.headers["x-tenant-id"] ?? null,
    });
  });

  app.get("/users/:id", async (req, res) => {
    const response = await req.app.fetch.get(
      `${app.config.fetchDemoBaseURL}/fetch-demo/upstream/${encodeURIComponent(req.params.id!)}`,
      { signal: req.signal },
    );
    if (!response.ok) {
      await response.body?.cancel();
      app.throw(response.status === 404 ? 404 : 502, "上游用户查询失败");
    }
    const payload = (await response.json()) as {
      data: { id: string; requestId: string; tenant: string | null };
    };
    res.json({ user: payload.data });
  });
});
```

运行 `npm run dev`，在另一个终端请求（PowerShell 使用 `curl.exe`）：

```bash
curl -H "x-request-id: fetch-demo-1" -H "x-tenant-id: tenant-a" http://127.0.0.1:3000/fetch-demo/users/u-1
curl -i http://127.0.0.1:3000/fetch-demo/users/missing
```

第一项返回 200，`data.user` 中的 `id` 为 `u-1`、`requestId` 为 `fetch-demo-1`、`tenant` 为 `tenant-a`；终端出现 `type: "outbound"` 的 GET 日志。第二项返回 404，说明调用方检查了 HTTP 错误，而非把错误响应当作成功数据。

停止 dev，执行 `npm run build`、`npm start`，重复两项请求；结束后 Ctrl+C 停止服务。若修改端口，同步修改 `fetchDemoBaseURL`，否则出站调用仍会访问原端口。这里的 tenant 仅演示头传播，不作为租户认证。

通用调用接受 `string | URL | Request` 与扩展的 `RequestInit`，但默认超时、重试策略和日志等行为有别于原生 fetch。它返回标准 `Response`：HTTP 4xx/5xx 不自动抛错，读取正文和检查 `response.ok` 由调用方完成。

:::warning 当前路由工厂的调用边界
`defineRoutes((app) => ...)` 的工厂参数会绑定函数，当前实现没有保留 fetch 函数上的 `get/create/proxy` 等附加方法。handler 内使用 `req.app.fetch` 取得完整客户端；单纯调用 `app.fetch(url, init)` 仍可用。插件 setup 和 Service 构造函数收到的真实应用实例不受此问题影响。下文快捷方法片段中的 `app` 指真实应用实例，在 handler 中应使用 `req.app`。
:::

## Fetch Hooks

`app.fetch` 和 `app.fetch.proxy` 会触发出站生命周期 hook，适合统一注入 header、记录第三方调用耗时或上报失败：

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "fetch-observer",
  setup(app) {
    app.hooks.on("fetch:before", ({ headers }) => {
      headers.set("x-client", "billing-service");
    });

    app.hooks.on("fetch:error", ({ url, error }) => {
      app.logger.error({ url, err: error }, "outbound request failed");
    });

    app.hooks.on("proxy:after", ({ target, status, requestId }) => {
      app.logger.info({ target, status, requestId }, "proxy response");
    });
  },
});
```

`fetch:before` 和 `proxy:before` 可修改出站 headers；抛错会阻止本次出站请求。普通 `fetch:before` 在请求循环之外，其异常直接传出，不会再触发 `fetch:error`；代理的 before 异常进入代理错误处理，通常返回本地 502。

`fetch:after/error` 与 `proxy:after/error` 使用 safe 派发，监听器异常被记录而不替换主流程结果。before 每次调用一次，after 在最终取得 Response 后派发，包含最终 attempt；HTTP 5xx 仍属于 after，正文之后读取失败不补发 fetch:error。参数解析和 retryDelay 求值阶段也不能假设必有 error hook，完整边界见[Hooks](/zh/guide/hooks)。

## 快捷方法

除了直接调用 `app.fetch(url, init)` 外，还提供了常用 HTTP 方法的快捷方式：

### GET

```typescript
const response = await app.fetch.get("https://api.example.com/users");
const users = await response.json();
```

### POST

`post` / `put` / `patch` 的非 null/undefined 第二参数会被 `JSON.stringify`；未显式设置 Content-Type 时补上 `application/json`。发送 FormData、二进制或流时使用通用调用并自行设置 body，不使用 JSON 快捷方法：

```typescript
const response = await app.fetch.post("https://api.example.com/users", {
  name: "张三",
  email: "zhangsan@example.com",
});
const newUser = await response.json();
```

### PUT

```typescript
const response = await app.fetch.put(`https://api.example.com/users/${id}`, {
  name: "李四",
  email: "lisi@example.com",
});
```

### PATCH

```typescript
const response = await app.fetch.patch(`https://api.example.com/users/${id}`, {
  name: "王五",
});
```

### DELETE

```typescript
const response = await app.fetch.delete(`https://api.example.com/users/${id}`);
```

### 方法签名一览

| 方法                                      | 签名                                                                           | 说明                          |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| `app.fetch(input, init?)`                 | `(input: string \| URL \| Request, init?: VextFetchInit) => Promise<Response>` | 通用调用（与原生 fetch 兼容） |
| `app.fetch.get(url, init?)`               | `(url: string, init?: VextFetchInit) => Promise<Response>`                     | GET 请求                      |
| `app.fetch.post(url, body?, init?)`       | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>`     | POST 请求，body 自动序列化    |
| `app.fetch.put(url, body?, init?)`        | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>`     | PUT 请求，body 自动序列化     |
| `app.fetch.patch(url, body?, init?)`      | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>`     | PATCH 请求，body 自动序列化   |
| `app.fetch.delete(url, init?)`            | `(url: string, init?: VextFetchInit) => Promise<Response>`                     | DELETE 请求                   |
| `app.fetch.create(options)`               | `(options: VextFetchClientOptions) => VextFetchClient`                         | 创建子客户端（无 proxy）      |
| `app.fetch.proxy.<name>(req,res,options)` | `(req, res, options) => Promise<void>`                                         | 配置化请求代理并透传响应      |

## 配置

### 全局配置（config.fetch）

在 `src/config/default.ts` 中通过 `fetch` 字段配置全局默认值：

```typescript
// src/config/default.ts
export default {
  port: 3000,
  fetch: {
    timeout: 10000, // 全局默认超时（毫秒），默认 10000
    retry: 2, // 默认重试次数（仅幂等方法），默认 0
    retryDelay: 1000, // 默认重试间隔（毫秒），默认 1000
    propagateHeaders: [
      // 除 x-request-id 外自动从入站请求透传到出站请求的头
      "traceparent", // W3C Trace Context（APM 分布式追踪）
      "tracestate", // W3C Trace Context 附加状态
      // 或 'x-trace-id', 'x-tenant-id' 等自定义头
    ],
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

| 配置项             | 类型                            | 默认值  | 说明                                         |
| ------------------ | ------------------------------- | ------- | -------------------------------------------- |
| `timeout`          | `number`                        | `10000` | 全局默认请求超时（毫秒）                     |
| `retry`            | `number`                        | `0`     | 默认重试次数（仅幂等方法生效）               |
| `retryDelay`       | `number \| (attempt) => number` | `1000`  | 默认重试间隔（毫秒），支持函数形式           |
| `propagateHeaders` | `string[]`                      | `[]`    | 需要从入站请求自动透传到出站请求的头名称列表 |
| `proxy`            | `VextFetchProxyTargetConfig[]`  | `[]`    | `app.fetch.proxy.<name>()` 的上游目标列表    |

:::warning 计时器边界
`retry` 必须是非负整数，表示额外尝试次数；`timeout` 必须是大于 0 且不超过 `2147483647` 毫秒的有限数字；`retryDelay` 必须是 0 或正数且不超过 `2147483647` 毫秒。函数形式的 `retryDelay` 每次返回值也必须满足这个范围，否则框架会在进入原生 timer 前 fail fast。
:::

:::tip propagateHeaders 工作原理
配置后，独立的请求元数据中间件会在每个请求进入时，从入站请求头中读取列表中指定的头值，
写入 `requestContext.store.propagatedHeaders`。`app.fetch` 出站请求时自动从 store 中读取并注入。

**无需在每次 `app.fetch` 调用时手动传递这些头**——框架自动完成整个链路。
:::

### 单次请求配置（VextFetchInit）

每个请求可通过 `init` 参数覆盖全局配置：

```typescript
// 单次请求设置 5 秒超时 + 3 次重试
const response = await app.fetch.get("https://api.example.com/data", {
  timeout: 5000,
  retry: 3,
  retryDelay: 500,
});
```

#### VextFetchInit 完整字段

`VextFetchInit` 继承自标准 `RequestInit`，额外扩展了以下字段：

| 字段                 | 类型                                    | 默认值                         | 说明                                                                 |
| -------------------- | --------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `timeout`            | `number`                                | 全局 `config.fetch.timeout`    | 请求超时（毫秒）                                                     |
| `retry`              | `number`                                | 全局 `config.fetch.retry`      | 重试次数（仅幂等方法）                                               |
| `retryDelay`         | `number \| (attempt: number) => number` | 全局 `config.fetch.retryDelay` | 重试间隔，支持函数形式实现指数退避                                   |
| `propagateRequestId` | `boolean`                               | `true`                         | 是否自动注入 `x-request-id` 头（禁用时仍会透传 `propagatedHeaders`） |
| `propagateHeaders`   | `string[]`                              | —                              | 类型保留字段；当前实现不读取此单次选项，不能用它增加或过滤传播头     |

:::tip 优先级
单次请求 `init.timeout` > `create()` 的 `options.timeout` > 全局 `config.fetch.timeout`
:::

## create() 工厂

当你需要频繁调用同一个下游服务时，使用 `create()` 创建预配置的子客户端，避免重复传入 `baseURL` 和公共 headers：

```typescript
import { definePlugin, type VextFetchClient } from "vextjs";

declare module "vextjs" {
  interface VextApp {
    clients: {
      userService: VextFetchClient;
      payment: VextFetchClient;
    };
  }
}

export default definePlugin({
  name: "api-clients",

  setup(app) {
    // 创建用户服务客户端
    const userServiceClient = app.fetch.create({
      baseURL: "http://user-service:3001/api/v1",
      headers: {
        "x-service-name": "order-service",
        Authorization: `Bearer ${app.config.serviceToken}`,
      },
      timeout: 5000,
      retry: 2,
    });

    // 创建支付服务客户端
    const paymentClient = app.fetch.create({
      baseURL: "http://payment-service:3002/api/v1",
      headers: {
        "x-service-name": "order-service",
      },
      timeout: 15000, // 支付服务超时设长一些
    });

    // 挂载到 app 上供全局使用
    app.extend("clients", {
      userService: userServiceClient,
      payment: paymentClient,
    });
  },
});
```

下面为订单路由片段，需已有上方插件以及用户、支付两个上游；`userId` 在此来自经过校验的请求体，仅演示调用组织，实际系统应由认证上下文决定：

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/orders",
    {
      validate: {
        body: {
          userId: "string!",
          productId: "string!",
          quantity: "number:1-99!",
        },
      },
    },
    async (req, res) => {
      const body = req.valid("body");

      // 使用预配置的子客户端 — 自动拼接 baseURL + 合并 headers
      const userResp = await app.clients.userService.get(
        `/users/${encodeURIComponent(body.userId)}`,
        { signal: req.signal },
      );
      if (!userResp.ok) {
        await userResp.body?.cancel();
        app.throw(502, "用户服务调用失败");
      }
      const user = (await userResp.json()) as { id: string };

      const payResp = await app.clients.payment.post("/charges", {
        userId: user.id,
        amount: body.quantity * 100,
      });
      if (!payResp.ok) {
        await payResp.body?.cancel();
        app.throw(502, "支付服务调用失败");
      }
      const charge = (await payResp.json()) as { orderId: string };

      res.json({ orderId: charge.orderId }, 201);
    },
  );
});
```

这些上游示例按未包装的 JSON（如 `{ id }`）读取；若上游启用 VextJS 响应包装，应读取其 `data`。插件中的 `serviceToken` 需由你的配置提供；`app.extend()` 扩展的类型声明方式见[插件指南](/zh/guide/plugins)。

### VextFetchClientOptions

| 字段         | 类型                                    | 必填 | 说明                                  |
| ------------ | --------------------------------------- | ---- | ------------------------------------- |
| `baseURL`    | `string`                                | ✅   | 基础 URL，所有请求路径自动拼接        |
| `headers`    | `Record<string, string>`                | ❌   | 默认请求头（与单次请求 headers 合并） |
| `timeout`    | `number`                                | ❌   | 子客户端默认超时                      |
| `retry`      | `number`                                | ❌   | 子客户端默认重试次数                  |
| `retryDelay` | `number \| (attempt: number) => number` | ❌   | 子客户端默认重试间隔                  |

:::info 嵌套 create
子客户端也支持再次调用 `create()`，但当前实现会复用创建它的父级工厂，不能假设自动继承该子客户端的 headers、timeout、retry 或 baseURL。需要保留的配置应显式再传入：

```typescript
const apiClient = app.fetch.create({ baseURL: "https://api.example.com" });
const v2Client = apiClient.create({ baseURL: "https://api.example.com/v2" });
```

:::

字符串路径按 `baseURL + / + path` 拼接，`/users` 会保留 baseURL 中的 `/api/v1`；字符串形式的完整 URL 也会被拼接。需要绕过 baseURL 时使用根 `app.fetch`，或给可调用子客户端传 `URL` / `Request` 对象。

## app.fetch.proxy 请求代理

`app.fetch.proxy` 适合网关、BFF 或“当前请求转发到内部服务”的场景。它与 `app.fetch.create()` 的定位不同：`create()` 返回标准 `Response` 供业务代码自行处理；`proxy` 接收当前 `req/res`，并把上游响应直接写回客户端。

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/users/:id", async (req, res) => {
    await req.app.fetch.proxy.userService(req, res, {
      path: `/users/${req.params.id}`,
      query: { includeProfile: true },
    });
  });
});
```

上游响应会直接透传：2xx / 3xx / 4xx / 5xx 都不会被包装成 `{ code, data, requestId }`。只有代理本地错误会使用 vext 风格错误响应，例如缺少 `path/url`、目标不存在、禁止透传 Authorization、上游网络错误 502 或超时 504。

### header 合并与 Authorization

请求头优先级为：

```text
target.headers
  < forwardHeaders
  < target.defaultInjectHeaders
  < options.headers
  < options.injectHeaders
```

目标级与调用级 `forwardHeaders` 合并为白名单，从当前 `req.headers` 读取；调用级空数组不会清空目标白名单。代理不复用普通 fetch 的 ALS 自动传播流程，需要传播 requestId 时显式将相应头加入白名单，或用 injectHeaders 从 `req.requestId` 注入。默认不会透传原始 `Authorization`；只有目标配置或单次调用显式设置 `allowAuthorizationForward: true`，且白名单包含 `authorization`，才会透传。

```typescript
await app.fetch.proxy.userService(req, res, {
  path: "/profile",
  forwardHeaders: ["authorization"],
  allowAuthorizationForward: true,
});
```

### 直接 URL 模式

如果只是临时代理到一个完整 URL，可以不配置目标：

```typescript
await app.fetch.proxy(req, res, {
  url: "https://partner.example.com/status",
});
```

### proxy 重试规则

代理的 retry 表示“额外尝试次数”，总尝试次数为 `retry + 1`。优先级为 `options.retry > target.retry > config.fetch.retry > 0`，`retryDelay` 同理。只有 GET / HEAD / OPTIONS / PUT / DELETE 这些幂等方法会在上游 5xx 或网络错误时自动重试；POST / PATCH 默认不重试。请求体还必须可重放；流式 body 不自动重试。超时不重试：响应头发出前可返回本地 504；已经开始透传正文后发生超时会中断流，不能把已发送的响应改成完整 JSON 504。代理计时覆盖上游响应流结束，客户端断开也会取消上游。

代理默认沿用入站方法、合并入站 query（`options.query` 优先，null/undefined 删除键），非 GET/HEAD 在没有 `options.body` 时读取原始请求体。响应使用 manual redirect 保留 3xx，并移除 hop-by-hop、Content-Length 和 Content-Encoding，保留多条 Set-Cookie；不是逐字节复制原始 HTTP 报文。完整选项见[Fetch API](/zh/api/fetch)。

## requestId 自动传播

在请求上下文启用且 store 中有 ID 时，普通 `app.fetch` 可自动传播请求 ID。当一个 HTTP 请求进入 VextJS 时，`requestId` 中间件会接收有效请求头或生成 ID 并写入 `requestContext`（基于 `AsyncLocalStorage`）。当你使用 `app.fetch` 调用下游服务时，框架自动：

1. 从 `requestContext.getStore()` 读取当前 `requestId`
2. 若出站请求尚未显式设置该头，补入 ID。头名跟随 `config.requestId.header`，默认 `x-request-id`

```
Client → [VextJS A: requestId=abc123] → app.fetch → [VextJS B: x-request-id=abc123]
                                                        ↓
                                                   requestId 中间件读取并沿用 abc123
```

### 禁用 requestId 传播

某些外部 API 不支持自定义头，可以禁用传播：

```typescript
const response = await app.fetch.get("https://third-party-api.com/data", {
  propagateRequestId: false, // 不注入 x-request-id
  // 注意：propagatedHeaders（如 x-trace-id）仍会透传
});
```

## 自定义头透传（propagateHeaders）

除 `requestId` 之外，`app.fetch` 还支持自动透传其他入站请求头到下游——典型用途是分布式链路追踪头（`traceparent`）和多租户标识（`x-tenant-id`）。

### 配置方式

在 `config.fetch.propagateHeaders` 中声明需要透传的头名称：

```typescript
// src/config/default.ts
export default {
  fetch: {
    propagateHeaders: [
      "traceparent", // W3C Trace Context（OpenTelemetry / Jaeger / Zipkin）
      "tracestate", // W3C Trace Context 附加状态
      "x-tenant-id", // 多租户标识
    ],
  },
};
```

### 工作原理

框架在处理每个入站请求时自动完成透传链路，**无需任何手动操作**：

```
① 入站请求携带 traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
         ↓
② 请求元数据中间件读取并写入 store.propagatedHeaders（不依赖 requestId 开关）
         ↓
③ app.fetch 出站请求时从 store 读取并注入到请求头
         ↓
④ 下游服务收到 traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
         ↓
⑤ 下游可读取该头；建立 span 仍需 APM 插桩
```

普通 fetch 会补入 store 中已捕获的传播头，显式 `init.headers` 和子客户端默认 headers 优先。捕获依赖请求上下文，关闭 `requestContext` 或在作用域外调用时不会自动补入；`init.propagateHeaders` 当前没有运行时过滤或新增效果。前面的本地例子已经通过 `x-tenant-id` 展示这条链路。

### 手动透传（临时方案）

如果某个头未在全局 `propagateHeaders` 中声明，但本次请求需要透传，直接在 `init.headers` 中手动设置：

```typescript
const token = req.headers["x-partner-token"];
await app.fetch.get("https://partner-api.com/data", {
  headers: token ? { "x-partner-token": token } : {},
  signal: req.signal,
});
```

:::tip requestId vs traceId

- **requestId**（vext 内置）：自动生成，用于日志关联和内部服务间追踪
- **traceId**（APM 系统）：由 OpenTelemetry / Jaeger 等生成，通过 `propagateHeaders` 透传

详见 [请求上下文 → 与分布式追踪的关系](/zh/guide/request-context#与分布式追踪traceid的关系) 获取完整说明。
:::

## 超时控制

`app.fetch` 使用 `AbortController` 实现超时控制。超时后抛出带有明确信息的 `Error`：

```typescript
try {
  const response = await app.fetch.get("https://slow-api.example.com/data", {
    timeout: 3000, // 3 秒超时
  });
  const data = await response.json();
  res.json(data);
} catch (err) {
  if (err instanceof Error && err.name === "TimeoutError") {
    app.throw(504, "下游服务超时");
  }
  throw err; // 网络错误、正文解析错误等保留原错误
}
```

可显式传入 `{ signal: req.signal }` 将入站取消传给出站请求；普通 fetch 不会自动读取当前 req.signal。调用方信号与内部超时信号组合，调用方取消会保留 reason，停止当前请求或重试等待。普通 timeout 按每次尝试计时，只覆盖响应头；读取正文期间仍响应调用方 signal。总耗时还包括多次尝试、重试等待和正文消费。

`init.timeout`、`create({ timeout })`、`config.fetch.timeout` 和 proxy 的 `timeout` 都遵循同一边界：必须是大于 0 且不超过 `2147483647` 毫秒的有限数字。`retryDelay` 可以为 0，但也必须是有限数字且不超过 `2147483647` 毫秒；函数返回值会在每次重试前校验。

## 自动重试

重试需同时满足幂等方法（GET / HEAD / OPTIONS / PUT / DELETE）、请求体可重放且仍有次数。POST / PATCH 不重试；带原始 Request body 而未由 init 提供可重放 body，或使用流式 body 时也不重试。业务是否幂等仍由上游约定决定。

### 幂等方法清单

以下方法被视为幂等方法，允许自动重试：

| 方法    | 幂等 | 可重试 |
| ------- | :--: | :----: |
| GET     |  ✅  |   ✅   |
| HEAD    |  ✅  |   ✅   |
| OPTIONS |  ✅  |   ✅   |
| PUT     |  ✅  |   ✅   |
| DELETE  |  ✅  |   ✅   |
| POST    |  ❌  |   ❌   |
| PATCH   |  ❌  |   ❌   |

### 触发条件

| 条件                                 | 是否重试 | 说明                             |
| ------------------------------------ | :------: | -------------------------------- |
| HTTP 5xx 响应                        |    ✅    | 服务端错误，重试可能恢复         |
| 网络错误（连接失败、DNS 解析失败等） |    ✅    | 瞬时网络问题，重试可能成功       |
| HTTP 4xx 响应                        |    ❌    | 客户端错误，重试无意义           |
| 内部超时（TimeoutError）             |    ❌    | 直接抛出 `Error`，不重试         |
| 非幂等方法（POST / PATCH）           |    ❌    | 任何错误都不重试，避免副作用重复 |

### 重试决策流程

```
请求发出
  │
  ├── 收到非 5xx 响应（2xx/3xx/4xx）
  │     └── 直接返回 Response ✅
  │
  ├── 5xx 响应
  │     ├── 是幂等方法？
  │     │     ├── YES + 还有重试次数 → 等待 retryDelay → 重试
  │     │     ├── YES + 最后一次重试 → 返回原始 Response ⚠️（不抛出错误）
  │     │     └── NO → 直接返回 Response
  │     └──
  │
  ├── 网络错误（连接失败、DNS 等）
  │     ├── 是幂等方法 + 还有重试次数 → 等待 retryDelay → 重试
  │     └── 最后一次 或 非幂等 → 抛出 Error ❌
  │
  └── 内部超时（TimeoutError）
        └── 直接抛出 Error ❌（不重试）
```

### 最终重试失败时的行为

**HTTP 错误响应与请求执行异常需要分别处理**：

| 场景                    | 最终行为          | 说明                                                         |
| ----------------------- | ----------------- | ------------------------------------------------------------ |
| 5xx + 重试全部耗尽      | **返回 Response** | 调用方需自行检查 `response.ok` 或 `response.status` 处理错误 |
| 网络错误 + 重试全部耗尽 | **抛出 Error**    | 调用方需 try/catch 捕获                                      |
| 超时                    | **抛出 Error**    | `[app.fetch] GET /api/xxx timed out after 10000ms`           |

```typescript
// 5xx 最终失败 → 返回 Response（不抛出）
const response = await app.fetch.get("https://api.example.com/data", {
  retry: 2,
});
if (!response.ok) {
  // 3 次尝试（1 + 2 retry）都返回 5xx
  app.logger.error(
    { status: response.status },
    "API request failed after retries",
  );
}

// 网络错误最终失败 → 抛出 Error
try {
  await app.fetch.get("https://unreachable.example.com/data", { retry: 2 });
} catch (err) {
  // 3 次尝试都连接失败
  app.logger.error({ err }, "API unreachable after retries");
}
```

### 重试日志

每次重试会记录 `debug` 级别日志，包含当前重试次数和最大重试次数：

```json
{"level":20,"type":"outbound","method":"GET","url":"https://api.example.com/data","attempt":1,"maxRetries":3,"msg":"→ GET https://api.example.com/data RETRY attempt 1/3"}
{"level":20,"type":"outbound","method":"GET","url":"https://api.example.com/data","attempt":2,"maxRetries":3,"msg":"→ GET https://api.example.com/data RETRY attempt 2/3"}
```

首次请求不记录重试日志，只有 `attempt >= 1` 时才输出。生产环境 `logger.level: 'info'` 时重试日志不会输出（debug 级别被静默）。

### 指数退避

`retryDelay` 支持函数形式，实现指数退避策略：

```typescript
const response = await app.fetch.get("https://api.example.com/data", {
  retry: 3,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  // attempt 1: 2000ms
  // attempt 2: 4000ms
  // attempt 3: 8000ms
});
```

默认 `retryDelay` 为固定 `1000ms`（1 秒）。

## 结构化日志

实际发出的每次尝试会记录出站日志，重试等待另有 debug 日志；参数校验或 before hook 提前失败时不保证有此日志。字段如下：

| 字段        | 说明                   |
| ----------- | ---------------------- |
| `type`      | 固定为 `"outbound"`    |
| `method`    | HTTP 方法              |
| `url`       | 请求 URL               |
| `status`    | 响应状态码（成功时）   |
| `duration`  | 耗时（毫秒）           |
| `requestId` | 当前请求的 requestId   |
| `error`     | 错误信息（失败时）     |
| `attempt`   | 当前重试次数（重试时） |

日志级别根据响应状态自动调整：

| 条件                 | 日志级别 |
| -------------------- | -------- |
| 2xx（response.ok）   | `debug`  |
| 3xx / 4xx            | `warn`   |
| 5xx                  | `error`  |
| 网络错误 / 内部超时  | `error`  |
| 调用方取消（请求中） | `debug`  |

日志输出示例：

```
[14:23:05.123] DEBUG → GET https://api.example.com/users 200 45ms
[14:23:06.456] WARN  → POST https://api.example.com/login 401 12ms
[14:23:07.789] ERROR → GET https://api.example.com/data TIMEOUT 10003ms (limit: 10000ms)
[14:23:08.012] DEBUG → GET https://api.example.com/data RETRY attempt 1/3
```

`duration` 是单次尝试取得响应头的耗时，不包含重试等待或正文消费。普通 fetch 默认跟随重定向，只有实际返回的 3xx 才按 warn 记录；日志仍受 logger 阈值控制。

## 替换 fetch 实现

当前版本未暴露 `app.setFetch()` 公共 API，因此不支持在插件里直接替换框架内置 `app.fetch`。

如果已有其他 HTTP SDK，可通过插件 `app.extend()` 挂载独立客户端；安装和配置按该 SDK 文档执行。保留内置 `app.fetch`，避免让依赖它的框架行为失效。

:::warning
如果你绕过内置 `app.fetch`，requestId 传播、超时、重试与结构化日志都需要自行实现。大多数场景下推荐直接使用内置 `app.fetch`，或基于 `app.fetch.create()` 挂载专用客户端。
:::

<a id="完整示例微服务间调用"></a>

## 进阶示例：组织微服务客户端

前面的两文件示例可直接验证出站调用。本节给出拆成插件和 Service 的业务组织示例；运行它还需你提供用户与库存服务、调用该 Service 的订单路由及持久化逻辑。约定三个上游接口：GET `/api/users/:id` 返回 `{ id }`，GET `/api/stock/:id` 返回 `{ available }`，POST `/api/stock/:id/deduct` 接收 `{ quantity, orderId }` 并以 2xx 表示成功；若上游包装响应则相应读取 `data`。

```typescript
// src/plugins/service-clients.ts
import { definePlugin, type VextFetchClient } from "vextjs";

declare module "vextjs" {
  interface VextApp {
    userClient: VextFetchClient;
    inventoryClient: VextFetchClient;
  }
}

export default definePlugin({
  name: "service-clients",

  setup(app) {
    app.extend(
      "userClient",
      app.fetch.create({
        baseURL: process.env.USER_SERVICE_URL ?? "http://user-service:3001",
        timeout: 5000,
        retry: 2,
      }),
    );

    app.extend(
      "inventoryClient",
      app.fetch.create({
        baseURL:
          process.env.INVENTORY_SERVICE_URL ?? "http://inventory-service:3002",
        timeout: 8000,
        retry: 1,
      }),
    );
  },
});
```

```typescript
// src/services/order.ts
import { randomUUID } from "node:crypto";
import type { VextApp } from "vextjs";

export default class OrderService {
  constructor(private app: VextApp) {}

  async createOrder(userId: string, productId: string, quantity: number) {
    // 1. 查询用户信息
    const userResp = await this.app.userClient.get(
      `/api/users/${encodeURIComponent(userId)}`,
    );
    if (!userResp.ok) {
      await userResp.body?.cancel();
      this.app.throw(userResp.status === 404 ? 404 : 502, "用户服务查询失败");
    }
    const user = (await userResp.json()) as { id: string };

    // 2. 检查库存
    const stockResp = await this.app.inventoryClient.get(
      `/api/stock/${encodeURIComponent(productId)}`,
    );
    if (!stockResp.ok) {
      await stockResp.body?.cancel();
      this.app.throw(502, "库存服务不可用");
    }
    const stock = (await stockResp.json()) as { available: number };

    if (stock.available < quantity) {
      this.app.throw(400, "库存不足");
    }

    // 3. 扣减库存
    const orderId = randomUUID();
    const deducted = await this.app.inventoryClient.post(
      `/api/stock/${encodeURIComponent(productId)}/deduct`,
      { quantity, orderId },
    );
    if (!deducted.ok) {
      await deducted.body?.cancel();
      this.app.throw(502, "库存扣减失败");
    }
    await deducted.arrayBuffer();

    // 4. 创建订单记录
    return {
      orderId,
      userId: user.id,
      productId,
      quantity,
      status: "created",
    };
  }
}
```

调用侧应校验 userId/productId/quantity 并从认证上下文确定用户身份；库存服务应提供原子扣减和基于 orderId 的幂等处理，创建订单失败后的补偿也需业务实现。requestId 在上下文存在时关联出站请求，但不会自动提供事务、补偿或完整分布式 Trace。

## 下一步

- 了解 [requestId 与请求上下文](/zh/guide/request-context)如何生成和管理 requestId
- 查看 [插件](/zh/guide/plugins) 如何通过 `app.extend()` 挂载自定义客户端
- 探索 [配置](/zh/guide/configuration) 中 `fetch` 相关的全局配置项
- 学习 [测试](/zh/guide/testing) 中如何 mock `app.fetch` 进行单元测试

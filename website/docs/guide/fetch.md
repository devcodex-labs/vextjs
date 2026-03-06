# 内置 HTTP 客户端 (app.fetch)

VextJS 内置了增强版 HTTP 客户端 `app.fetch`，基于 Node.js 18+ 原生 `fetch` 封装，提供 **requestId 自动传播**、**超时控制**、**自动重试**、**结构化日志** 和 **create() 工厂** 等企业级能力。无需安装任何第三方 HTTP 库即可进行服务间调用。

## 功能概览

| 能力 | 说明 |
|------|------|
| **requestId 传播** | 自动从 `requestContext` 读取 `requestId`，注入到出站请求的 `x-request-id` 头，实现跨服务请求追踪 |
| **超时控制** | 基于 `AbortController` + `setTimeout`，支持全局默认 + 单次请求覆盖 |
| **自动重试** | 仅对幂等方法（GET/HEAD/OPTIONS/PUT/DELETE）在 5xx 或网络错误时自动重试 |
| **结构化日志** | 出站请求自动记录 method/url/status/duration/requestId，与 `app.logger` 统一 |
| **快捷方法** | `get` / `post` / `put` / `patch` / `delete` 快捷调用 |
| **create() 工厂** | 创建预配置的子客户端（固定 baseURL + 默认 headers），适合对接多个微服务 |

## 基本用法

`app.fetch` 的签名与原生 `fetch` 完全兼容，可以无缝替换：

```typescript
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  app.get('/users/:id/posts', {
    validate: { param: { id: 'string!' } },
  }, async (req, res) => {
    const { id } = req.valid('param');

    // 使用 app.fetch 调用下游服务
    const response = await app.fetch(`https://api.example.com/users/${id}/posts`);
    const posts = await response.json();

    res.json(posts);
  });
});
```

:::tip
`app.fetch` 会自动将当前请求的 `requestId` 注入到出站请求的 `x-request-id` 头中。下游服务如果也使用 VextJS，将自动接收并延续这个追踪 ID，实现分布式链路追踪。
:::

## 快捷方法

除了直接调用 `app.fetch(url, init)` 外，还提供了常用 HTTP 方法的快捷方式：

### GET

```typescript
const response = await app.fetch.get('https://api.example.com/users');
const users = await response.json();
```

### POST

`post` / `put` / `patch` 方法的第二个参数为请求体对象，会自动 `JSON.stringify` 并设置 `Content-Type: application/json`：

```typescript
const response = await app.fetch.post('https://api.example.com/users', {
  name: '张三',
  email: 'zhangsan@example.com',
});
const newUser = await response.json();
```

### PUT

```typescript
const response = await app.fetch.put(`https://api.example.com/users/${id}`, {
  name: '李四',
  email: 'lisi@example.com',
});
```

### PATCH

```typescript
const response = await app.fetch.patch(`https://api.example.com/users/${id}`, {
  name: '王五',
});
```

### DELETE

```typescript
const response = await app.fetch.delete(`https://api.example.com/users/${id}`);
```

### 方法签名一览

| 方法 | 签名 | 说明 |
|------|------|------|
| `app.fetch(input, init?)` | `(input: string \| URL \| Request, init?: VextFetchInit) => Promise<Response>` | 通用调用（与原生 fetch 兼容） |
| `app.fetch.get(url, init?)` | `(url: string, init?: VextFetchInit) => Promise<Response>` | GET 请求 |
| `app.fetch.post(url, body?, init?)` | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>` | POST 请求，body 自动序列化 |
| `app.fetch.put(url, body?, init?)` | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>` | PUT 请求，body 自动序列化 |
| `app.fetch.patch(url, body?, init?)` | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>` | PATCH 请求，body 自动序列化 |
| `app.fetch.delete(url, init?)` | `(url: string, init?: VextFetchInit) => Promise<Response>` | DELETE 请求 |
| `app.fetch.create(options)` | `(options: VextFetchClientOptions) => VextFetch` | 创建子客户端 |

## 配置

### 全局配置（config.fetch）

在 `vext.config.ts` 中通过 `fetch` 字段配置全局默认值：

```typescript
// vext.config.ts
export default {
  port: 3000,
  fetch: {
    timeout: 10000,          // 全局默认超时（毫秒），默认 10000
    retry: 2,                // 默认重试次数（仅幂等方法），默认 0
    retryDelay: 1000,        // 默认重试间隔（毫秒），默认 1000
    propagateHeaders: [      // 除 x-request-id 外自动从入站请求透传到出站请求的头
      'traceparent',         // W3C Trace Context（APM 分布式追踪）
      'tracestate',          // W3C Trace Context 附加状态
      // 或 'x-trace-id', 'x-tenant-id' 等自定义头
    ],
  },
};
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `timeout` | `number` | `10000` | 全局默认请求超时（毫秒） |
| `retry` | `number` | `0` | 默认重试次数（仅幂等方法生效） |
| `retryDelay` | `number \| (attempt) => number` | `1000` | 默认重试间隔（毫秒），支持函数形式 |
| `propagateHeaders` | `string[]` | `[]` | 需要从入站请求自动透传到出站请求的头名称列表 |

:::tip propagateHeaders 工作原理
配置后，`requestId` 中间件会在每个请求进入时，从入站请求头中读取列表中指定的头值，
写入 `requestContext.store.propagatedHeaders`。`app.fetch` 出站请求时自动从 store 中读取并注入。

**无需在每次 `app.fetch` 调用时手动传递这些头**——框架自动完成整个链路。
:::

### 单次请求配置（VextFetchInit）

每个请求可通过 `init` 参数覆盖全局配置：

```typescript
// 单次请求设置 5 秒超时 + 3 次重试
const response = await app.fetch.get('https://api.example.com/data', {
  timeout: 5000,
  retry: 3,
  retryDelay: 500,
});
```

#### VextFetchInit 完整字段

`VextFetchInit` 继承自标准 `RequestInit`，额外扩展了以下字段：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `timeout` | `number` | 全局 `config.fetch.timeout` | 请求超时（毫秒） |
| `retry` | `number` | 全局 `config.fetch.retry` | 重试次数（仅幂等方法） |
| `retryDelay` | `number \| (attempt: number) => number` | 全局 `config.fetch.retryDelay` | 重试间隔，支持函数形式实现指数退避 |
| `propagateRequestId` | `boolean` | `true` | 是否自动注入 `x-request-id` 头（禁用时仍会透传 `propagatedHeaders`） |
| `propagateHeaders` | `string[]` | — | 本次请求额外需要透传的头（需已在 `config.fetch.propagateHeaders` 中声明才会有值） |

:::tip 优先级
单次请求 `init.timeout` > `create()` 的 `options.timeout` > 全局 `config.fetch.timeout`
:::

## create() 工厂

当你需要频繁调用同一个下游服务时，使用 `create()` 创建预配置的子客户端，避免重复传入 `baseURL` 和公共 headers：

```typescript
import { definePlugin } from 'vextjs';

export default definePlugin({
  name: 'api-clients',

  setup(app) {
    // 创建用户服务客户端
    const userServiceClient = app.fetch.create({
      baseURL: 'http://user-service:3001/api/v1',
      headers: {
        'x-service-name': 'order-service',
        'Authorization': `Bearer ${app.config.serviceToken}`,
      },
      timeout: 5000,
      retry: 2,
    });

    // 创建支付服务客户端
    const paymentClient = app.fetch.create({
      baseURL: 'http://payment-service:3002/api/v1',
      headers: {
        'x-service-name': 'order-service',
      },
      timeout: 15000,  // 支付服务超时设长一些
    });

    // 挂载到 app 上供全局使用
    app.extend('clients', {
      userService: userServiceClient,
      payment: paymentClient,
    });
  },
});
```

在路由或服务中使用：

```typescript
export default defineRoutes((app) => {
  app.post('/orders', {
    validate: {
      body: {
        productId: 'string!',
        quantity: 'number:1-99!',
      },
    },
  }, async (req, res) => {
    const body = req.valid('body');

    // 使用预配置的子客户端 — 自动拼接 baseURL + 合并 headers
    const userResp = await app.clients.userService.get(`/users/${req.userId}`);
    const user = await userResp.json();

    const payResp = await app.clients.payment.post('/charges', {
      userId: user.id,
      amount: body.quantity * 100,
    });
    const charge = await payResp.json();

    res.json({ orderId: charge.orderId }, 201);
  });
});
```

### VextFetchClientOptions

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `baseURL` | `string` | ✅ | 基础 URL，所有请求路径自动拼接 |
| `headers` | `Record<string, string>` | ❌ | 默认请求头（与单次请求 headers 合并） |
| `timeout` | `number` | ❌ | 子客户端默认超时 |
| `retry` | `number` | ❌ | 子客户端默认重试次数 |

:::info 嵌套 create
子客户端也支持再次调用 `create()`，创建更细粒度的客户端：

```typescript
const apiClient = app.fetch.create({ baseURL: 'https://api.example.com' });
const v2Client = apiClient.create({ baseURL: 'https://api.example.com/v2' });
```
:::

## requestId 自动传播

这是 `app.fetch` 最核心的能力之一。当一个 HTTP 请求进入 VextJS 时，`requestId` 中间件会为其生成唯一 ID 并写入 `requestContext`（基于 `AsyncLocalStorage`）。当你使用 `app.fetch` 调用下游服务时，框架自动：

1. 从 `requestContext.getStore()` 读取当前 `requestId`
2. 注入到出站请求的 `x-request-id` 头

```
Client → [VextJS A: requestId=abc123] → app.fetch → [VextJS B: x-request-id=abc123]
                                                        ↓
                                                   requestId 中间件读取并沿用 abc123
```

### 禁用 requestId 传播

某些外部 API 不支持自定义头，可以禁用传播：

```typescript
const response = await app.fetch.get('https://third-party-api.com/data', {
  propagateRequestId: false,  // 不注入 x-request-id
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
      'traceparent',   // W3C Trace Context（OpenTelemetry / Jaeger / Zipkin）
      'tracestate',    // W3C Trace Context 附加状态
      'x-tenant-id',  // 多租户标识
    ],
  },
};
```

### 工作原理

框架在处理每个入站请求时自动完成透传链路，**无需任何手动操作**：

```
① 入站请求携带 traceparent: 00-abc123-def456-01
         ↓
② requestId 中间件读取并写入 store.propagatedHeaders
         ↓
③ app.fetch 出站请求时从 store 读取并注入到请求头
         ↓
④ 下游服务收到 traceparent: 00-abc123-def456-01
         ↓
⑤ APM 系统识别为同一 trace，建立 span 关联
```

```typescript
// 路由中不需要任何额外代码，框架自动处理透传
export default defineRoutes('/orders', [
  {
    method: 'POST',
    handler: async (req, res) => {
      // traceparent 已自动从入站请求透传到 inventory-service
      const stock = await app.fetch.get('http://inventory-service/check');
      // 同样自动透传到 payment-service
      const payment = await app.fetch.post('http://payment-service/charge', req.body);

      res.json({ orderId: 'new-id' });
    },
  },
]);
```

### 手动透传（临时方案）

如果某个头未在全局 `propagateHeaders` 中声明，但本次请求需要透传，直接在 `init.headers` 中手动设置：

```typescript
await app.fetch.get('https://partner-api.com/data', {
  headers: {
    'x-partner-token': req.headers['x-partner-token'] as string,
  },
});
```

:::tip requestId vs traceId
- **requestId**（vext 内置）：自动生成，用于日志关联和内部服务间追踪
- **traceId**（APM 系统）：由 OpenTelemetry / Jaeger 等生成，通过 `propagateHeaders` 透传

详见 [请求上下文 → 与分布式追踪的关系](/guide/request-context#与分布式追踪traceId的关系) 获取完整说明。
:::

## 超时控制

`app.fetch` 使用 `AbortController` 实现超时控制。超时后抛出带有明确信息的 `Error`：

```typescript
try {
  const response = await app.fetch.get('https://slow-api.example.com/data', {
    timeout: 3000,  // 3 秒超时
  });
  const data = await response.json();
  res.json(data);
} catch (err) {
  // err.message: "[app.fetch] GET https://slow-api.example.com/data timed out after 3000ms"
  app.throw(504, '下游服务超时');
}
```

如果请求同时传入了 `signal`（如用户手动取消），`app.fetch` 会合并两个 signal——任一触发都会中止请求。

## 自动重试

重试仅对**幂等方法**（GET / HEAD / OPTIONS / PUT / DELETE）生效，POST / PATCH 不会重试（避免副作用重复执行）。

### 幂等方法清单

以下方法被视为幂等方法，允许自动重试：

| 方法 | 幂等 | 可重试 |
|------|:----:|:------:|
| GET | ✅ | ✅ |
| HEAD | ✅ | ✅ |
| OPTIONS | ✅ | ✅ |
| PUT | ✅ | ✅ |
| DELETE | ✅ | ✅ |
| POST | ❌ | ❌ |
| PATCH | ❌ | ❌ |

### 触发条件

| 条件 | 是否重试 | 说明 |
|------|:--------:|------|
| HTTP 5xx 响应 | ✅ | 服务端错误，重试可能恢复 |
| 网络错误（连接失败、DNS 解析失败等） | ✅ | 瞬时网络问题，重试可能成功 |
| HTTP 4xx 响应 | ❌ | 客户端错误，重试无意义 |
| 超时（AbortError） | ❌ | 直接抛出 `Error`，不重试 |
| 非幂等方法（POST / PATCH） | ❌ | 任何错误都不重试，避免副作用重复 |

### 重试决策流程

```
请求发出
  │
  ├── 成功（2xx/3xx/4xx）
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
  └── 超时（AbortError）
        └── 直接抛出 Error ❌（不重试）
```

### 最终重试失败时的行为

这是最重要的细节——**5xx 和网络错误的最终行为不同**：

| 场景 | 最终行为 | 说明 |
|------|---------|------|
| 5xx + 重试全部耗尽 | **返回 Response** | 调用方需自行检查 `response.ok` 或 `response.status` 处理错误 |
| 网络错误 + 重试全部耗尽 | **抛出 Error** | 调用方需 try/catch 捕获 |
| 超时 | **抛出 Error** | `[app.fetch] GET /api/xxx timed out after 10000ms` |

```typescript
// 5xx 最终失败 → 返回 Response（不抛出）
const response = await app.fetch.get('https://api.example.com/data', { retry: 2 });
if (!response.ok) {
  // 3 次尝试（1 + 2 retry）都返回 5xx
  app.logger.error({ status: response.status }, 'API request failed after retries');
}

// 网络错误最终失败 → 抛出 Error
try {
  await app.fetch.get('https://unreachable.example.com/data', { retry: 2 });
} catch (err) {
  // 3 次尝试都连接失败
  app.logger.error({ err }, 'API unreachable after retries');
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
const response = await app.fetch.get('https://api.example.com/data', {
  retry: 3,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  // attempt 1: 2000ms
  // attempt 2: 4000ms
  // attempt 3: 8000ms
});
```

默认 `retryDelay` 为固定 `1000ms`（1 秒）。

## 结构化日志

每个出站请求自动记录结构化日志，包含以下字段：

| 字段 | 说明 |
|------|------|
| `type` | 固定为 `"outbound"` |
| `method` | HTTP 方法 |
| `url` | 请求 URL |
| `status` | 响应状态码（成功时） |
| `duration` | 耗时（毫秒） |
| `requestId` | 当前请求的 requestId |
| `error` | 错误信息（失败时） |
| `attempt` | 当前重试次数（重试时） |

日志级别根据响应状态自动调整：

| 条件 | 日志级别 |
|------|---------|
| 2xx / 3xx | `debug` |
| 4xx | `warn` |
| 5xx | `error` |
| 网络错误 / 超时 | `error` |

日志输出示例：

```
[14:23:05.123] DEBUG → GET https://api.example.com/users 200 45ms
[14:23:06.456] WARN  → POST https://api.example.com/login 401 12ms
[14:23:07.789] ERROR → GET https://api.example.com/data TIMEOUT 10003ms (limit: 10000ms)
[14:23:08.012] DEBUG → GET https://api.example.com/data RETRY attempt 1/3
```

## 替换 fetch 实现

如果你需要使用 axios 或其他 HTTP 客户端替代内置 `app.fetch`，可以通过 `app.setFetch()` 替换：

```typescript
import { definePlugin } from 'vextjs';
import axios from 'axios';

export default definePlugin({
  name: 'axios-fetch',

  setup(app) {
    // 自定义 fetch 实现需符合 VextFetch 接口
    app.setFetch(customFetchImplementation);
  },
});
```

:::warning
替换后将失去内置的 requestId 传播、超时、重试等能力，需要自行实现。大多数场景下推荐直接使用内置 `app.fetch`。
:::

## 完整示例：微服务间调用

以下是一个订单服务调用用户服务和库存服务的完整示例：

```typescript
// src/plugins/service-clients.ts
import { definePlugin } from 'vextjs';

export default definePlugin({
  name: 'service-clients',

  setup(app) {
    app.extend('userClient', app.fetch.create({
      baseURL: process.env.USER_SERVICE_URL ?? 'http://user-service:3001',
      timeout: 5000,
      retry: 2,
    }));

    app.extend('inventoryClient', app.fetch.create({
      baseURL: process.env.INVENTORY_SERVICE_URL ?? 'http://inventory-service:3002',
      timeout: 8000,
      retry: 1,
    }));
  },
});
```

```typescript
// src/services/order.ts
export class OrderService {
  constructor(private app: VextApp) {}

  async createOrder(userId: string, productId: string, quantity: number) {
    // 1. 查询用户信息
    const userResp = await this.app.userClient.get(`/api/users/${userId}`);
    if (!userResp.ok) {
      this.app.throw(400, '用户不存在');
    }
    const user = await userResp.json();

    // 2. 检查库存
    const stockResp = await this.app.inventoryClient.get(`/api/stock/${productId}`);
    if (!stockResp.ok) {
      this.app.throw(500, '库存服务不可用');
    }
    const stock = await stockResp.json();

    if (stock.available < quantity) {
      this.app.throw(400, '库存不足', 'INSUFFICIENT_STOCK');
    }

    // 3. 扣减库存
    await this.app.inventoryClient.post(`/api/stock/${productId}/deduct`, {
      quantity,
      orderId: `order-${Date.now()}`,
    });

    // 4. 创建订单记录
    return {
      orderId: `order-${Date.now()}`,
      userId: user.id,
      productId,
      quantity,
      status: 'created',
    };
  }
}
```

在整个调用链中，`requestId` 会自动从入站请求传播到所有出站请求，实现完整的分布式追踪。

## 下一步

- 了解 [requestId 与请求上下文](/guide/middleware) 中间件如何生成和管理 requestId
- 查看 [插件](/guide/plugins) 如何通过 `app.extend()` 挂载自定义客户端
- 探索 [配置](/guide/configuration) 中 `fetch` 相关的全局配置项
- 学习 [测试](/guide/testing) 中如何 mock `app.fetch` 进行单元测试
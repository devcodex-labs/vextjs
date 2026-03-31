# 请求上下文 (Request Context)

VextJS 基于 Node.js `AsyncLocalStorage` 实现了请求级上下文存储 `requestContext`，为每个请求维护独立的上下文数据。无需手动传参，在路由、中间件、服务、插件的任意深层代码中都能访问当前请求的上下文信息。

## 核心概念

### 什么是 AsyncLocalStorage？

Node.js 是单线程事件循环，但同时处理多个并发请求。传统的全局变量方式（如 `global.currentRequestId`）会被后到的请求覆盖，导致竞态问题。

`AsyncLocalStorage` 为每个异步执行上下文维护独立的存储空间，即使在并发场景下也能安全隔离数据：

```
请求 A（requestId: "aaa"）─┐
                           ├─ 并发执行，互不干扰
请求 B（requestId: "bbb"）─┘

请求 A 中调用 requestContext.getStore() → { requestId: "aaa" }
请求 B 中调用 requestContext.getStore() → { requestId: "bbb" }
```

### 生命周期

```
Adapter 收到请求
  → requestContext.run(store, callback)   ← 创建请求作用域
  → requestId 中间件写入 store.requestId
  → 中间件链执行
  → handler 执行
  → 请求结束，store 自动 GC（无需手动清理）
```

## 基本用法

### 读取 requestId

最常见的用法是在任意位置获取当前请求的 `requestId`：

```typescript
import { requestContext } from 'vextjs';

export class OrderService {
  constructor(private app: any) {}

  async createOrder(data: any) {
    const store = requestContext.getStore();
    const requestId = store?.requestId;

    this.app.logger.info({ requestId, orderId: data.id }, '开始创建订单');

    // ... 业务逻辑
  }
}
```

:::tip
大多数情况下你不需要手动读取 `requestId`——`app.logger` 和 `app.fetch` 已经自动从 `requestContext` 读取并注入。只有在需要将 `requestId` 传递给外部系统时才需要手动读取。
:::

### 读取 locale

`requestContext` 也存储了当前请求的语言环境，由 i18n 中间件写入：

```typescript
import { requestContext } from 'vextjs';

function getCurrentLocale(): string {
  const store = requestContext.getStore();
  return store?.locale ?? 'zh-CN';
}
```

`app.throw()` 内部的 `I18nError.create()` 就是通过 `requestContext` 获取 locale，确保每个请求独立翻译。

## RequestContextStore 类型

```typescript
interface RequestContextStore {
  /** 当前请求的唯一标识（由 requestId 中间件生成/透传） */
  requestId?: string;

  /**
   * 当前请求的语言环境
   * 由中间件从 Accept-Language 请求头或自定义逻辑中解析写入
   */
  locale?: string;

  /**
   * 需要透传到下游服务的入站请求头快照
   *
   * 由 requestId 中间件根据 config.fetch.propagateHeaders 列表，
   * 从当前入站请求中提取对应头的值后写入。
   * app.fetch 在构建出站请求时从此字段自动读取并注入。
   *
   * 键名统一为小写（如 `x-trace-id`、`x-tenant-id`）。
   */
  propagatedHeaders?: Record<string, string>;

  /**
   * OpenTelemetry 链路追踪 ID（遵循 OTEL 语义约定字段名 `trace_id`）
   *
   * 由用户的 tracing 中间件在请求开始时写入。
   * logger 内置 mixin 在此字段存在时自动将 `trace_id` 注入到每条日志输出，
   * 实现日志与链路追踪系统的关联。框架自身不负责写入此字段。
   */
  traceId?: string;

  /**
   * OpenTelemetry Span ID（遵循 OTEL 语义约定字段名 `span_id`）
   *
   * 由用户的 tracing 中间件在请求开始时写入。
   * logger 内置 mixin 在此字段存在时自动将 `span_id` 注入到每条日志输出。
   * 框架自身不负责写入此字段。
   */
  spanId?: string;
}
```

| 字段 | 写入时机 | 写入者 | 用途 |
|------|---------|--------|------|
| `requestId` | 请求进入时 | requestId 中间件 | 日志追踪、出站请求传播 |
| `locale` | 请求进入时 | i18n 中间件 | 错误消息国际化 |
| `propagatedHeaders` | 请求进入时 | requestId 中间件 | 分布式追踪头、多租户头等自动透传到下游 |
| `traceId` | 请求进入时 | 用户 tracing 中间件 | logger 内置 mixin 自动读取并注入 `trace_id` 到日志（OTEL 语义约定） |
| `spanId` | 请求进入时 | 用户 tracing 中间件 | logger 内置 mixin 自动读取并注入 `span_id` 到日志（OTEL 语义约定） |

## 高级用法

### 在中间件中写入自定义数据

你可以在自定义中间件中向 `requestContext` store 写入额外数据：

```typescript
import { defineMiddleware } from 'vextjs';
import { requestContext } from 'vextjs';

export default defineMiddleware(async (req, res, next) => {
  const store = requestContext.getStore();

  if (store) {
    // 从 JWT token 中提取用户信息写入上下文
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const decoded = verifyToken(token);
      (store as any).userId = decoded.userId;
      (store as any).tenantId = decoded.tenantId;
    }
  }

  await next();
});
```

在后续的 handler 或 service 中读取：

```typescript
import { requestContext } from 'vextjs';

export class AuditService {
  async log(action: string, resource: string) {
    const store = requestContext.getStore() as any;

    await this.app.db.collection('audit_logs').insertOne({
      action,
      resource,
      userId: store?.userId,
      tenantId: store?.tenantId,
      requestId: store?.requestId,
      timestamp: new Date(),
    });
  }
}
```

### 扩展 Store 类型

为自定义字段提供类型安全，创建类型声明文件：

```typescript
// src/types/request-context.d.ts
declare module 'vextjs' {
  interface RequestContextStore {
    /** JWT 解码后的用户 ID */
    userId?: string;

    /** 多租户 ID */
    tenantId?: string;

    /** 用户角色列表 */
    roles?: string[];

    /** 请求开始时间（性能追踪） */
    startTime?: number;
  }
}
```

扩展后，`requestContext.getStore()` 的返回值将包含自定义字段的类型提示：

```typescript
const store = requestContext.getStore();
store?.userId;    // string | undefined — IDE 有类型提示
store?.tenantId;  // string | undefined
```

### 多租户数据隔离

利用 `requestContext` 实现多租户自动数据隔离：

```typescript
// src/middlewares/tenant.ts
import { defineMiddleware } from 'vextjs';
import { requestContext } from 'vextjs';

export default defineMiddleware(async (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    req.app.throw(400, 'Missing X-Tenant-ID header');
  }

  const store = requestContext.getStore();
  if (store) {
    (store as any).tenantId = tenantId;
  }

  await next();
});
```

```typescript
// src/services/base.ts — 所有 Service 的基类
import { requestContext } from 'vextjs';

export class TenantAwareService {
  constructor(protected app: any) {}

  /** 获取当前租户 ID（从 requestContext 自动读取） */
  protected getTenantId(): string {
    const store = requestContext.getStore() as any;
    const tenantId = store?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID not found in request context');
    }
    return tenantId;
  }

  /** 为查询自动注入租户过滤条件 */
  protected tenantFilter(filter: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...filter, tenantId: this.getTenantId() };
  }
}
```

```typescript
// src/services/order.ts — 使用租户感知基类
export class OrderService extends TenantAwareService {
  async findAll(options: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = options;

    // 自动注入 tenantId 过滤 — 不同租户只能看到自己的数据
    return this.app.db.collection('orders').find(
      this.tenantFilter(),
      { skip: (page - 1) * limit, limit },
    );
  }

  async create(data: any) {
    return this.app.db.collection('orders').insertOne({
      ...data,
      tenantId: this.getTenantId(),
      createdAt: new Date(),
    });
  }
}
```

### 性能追踪

在 requestContext 中记录请求开始时间，用于性能监控：

```typescript
// src/middlewares/performance.ts
import { defineMiddleware } from 'vextjs';
import { requestContext } from 'vextjs';

export default defineMiddleware(async (req, res, next) => {
  const store = requestContext.getStore();
  if (store) {
    (store as any).startTime = performance.now();
  }

  await next();

  // 请求完成后计算耗时
  const startTime = (store as any)?.startTime;
  if (startTime) {
    const duration = Math.round(performance.now() - startTime);

    // 慢请求告警
    if (duration > 1000) {
      req.app.logger.warn({
        url: req.url,
        method: req.method,
        duration,
      }, `慢请求: ${req.method} ${req.url} ${duration}ms`);
    }
  }
});
```

### 在异步任务中保持上下文

`AsyncLocalStorage` 的 store 会自动传播到所有异步操作（`Promise`、`setTimeout`、`setImmediate` 等）。只要异步操作是在请求处理链中发起的，就能正确读取 store：

```typescript
export class NotificationService {
  constructor(private app: any) {}

  async sendWelcomeEmail(userId: string) {
    const store = requestContext.getStore();

    // ✅ setTimeout 中也能读取 requestContext
    setTimeout(() => {
      const currentStore = requestContext.getStore();
      console.log(currentStore?.requestId);  // 正确：仍然是原始请求的 requestId
    }, 1000);

    // ✅ Promise.all 中也能读取
    await Promise.all([
      this.sendEmail(userId),
      this.createNotification(userId),
    ]);
  }
}
```

:::warning 注意
如果你使用 `worker_threads` 或在请求处理链之外手动创建异步上下文（如定时任务），`requestContext.getStore()` 将返回 `undefined`。这是预期行为——这些操作不属于任何请求。
:::

### 手动创建请求上下文

在某些特殊场景中（如定时任务、消息队列消费者），你可能需要手动创建请求上下文：

```typescript
import { requestContext } from 'vextjs';
import { randomUUID } from 'node:crypto';

// 定时任务中手动创建上下文
async function scheduledTask(app: any) {
  const store = {
    requestId: `scheduled-${randomUUID()}`,
    locale: 'zh-CN',
  };

  await requestContext.run(store, async () => {
    // 在这个回调内部，所有代码都能读取到 store
    app.logger.info('定时任务开始执行');
    // requestId 会自动注入到日志中

    await app.services.report.generateDaily();

    // app.fetch 也会自动传播 requestId
    await app.fetch.post('https://webhook.example.com/notify', {
      type: 'daily-report',
    });
  });
}
```

## 与框架内置功能的关系

| 功能 | 读取的字段 | 说明 |
|------|-----------|------|
| `app.logger` | `requestId` | 通过 pino mixin 自动注入到每条日志 |
| `app.fetch` | `requestId` | 自动注入到出站请求的 `x-request-id` 头 |
| `app.throw()` | `locale` | I18nError 根据 locale 翻译错误消息 |
| 访问日志中间件 | `requestId` | 记录入站请求的 requestId |

## requestContext API

### requestContext.getStore()

获取当前异步执行上下文的 store。在请求处理链中返回 `RequestContextStore` 对象，在请求外部返回 `undefined`。

```typescript
const store = requestContext.getStore();
// RequestContextStore | undefined
```

### requestContext.run(store, callback)

创建新的请求作用域并执行回调。回调内部和所有后续异步操作都能通过 `getStore()` 访问到 store。

```typescript
requestContext.run({ requestId: 'abc-123', locale: 'en-US' }, async () => {
  // 这里和所有后续异步操作都能读取到 store
  const store = requestContext.getStore();
  console.log(store?.requestId);  // 'abc-123'
});
```

:::info
通常你不需要手动调用 `run()`——框架的 Adapter 层在收到每个请求时自动调用。
:::

## 与分布式追踪（traceId）的关系

### requestId vs traceId：概念区分

VextJS 内置了 `requestId`，但你可能也听说过 `traceId`。两者解决不同层次的问题：

```
requestId（vext 内置）
  ├─ 由框架自动生成（crypto.randomUUID 或自定义）
  ├─ 每个 HTTP 请求独立，可从入站头透传（默认 x-request-id）
  ├─ 自动注入到 app.logger 每条日志
  ├─ 自动传播到 app.fetch 出站请求
  └─ 适合：日志关联、内部服务间请求链路追踪

traceId（APM / 链路追踪系统生成，vext 不内置）
  ├─ 由 Jaeger / Zipkin / OpenTelemetry / Datadog 等 APM 系统生成
  ├─ 遵循 W3C Trace Context 标准（traceparent / tracestate 头）
  │   或 B3 标准（x-b3-traceid 头）
  └─ 适合：跨系统全链路追踪、APM 系统集成
```

### 模式一：requestId 充当 traceId（简单场景）

如果你的系统不使用专业 APM 工具，可以直接将 `requestId` 的请求头名改为 `x-trace-id`，用 `requestId` 充当链路追踪 ID：

```typescript
// src/config/default.ts
export default {
  requestId: {
    header: 'x-trace-id',          // 从 x-trace-id 读取（网关注入）
    responseHeader: 'x-trace-id',  // 写回响应头
    generate: () => nanoid(),       // 可替换为更短的 ID 生成器
  },
};
```

这样，所有日志、出站请求都会自动携带 `x-trace-id`，服务间调用形成完整追踪链。

**适合场景**：内部微服务系统、不依赖外部 APM 工具、只需简单请求链路追踪。

### 模式二：requestId + APM traceId 并存（企业级场景）

如果你接入了 OpenTelemetry / Jaeger 等 APM 系统，需要同时保留 `requestId`（日志关联）和 APM 的 `traceparent`（分布式链路追踪）：

**第一步**：配置 `config.fetch.propagateHeaders`，声明需要自动透传的追踪头：

```typescript
// src/config/default.ts
export default {
  // requestId 保留（用于日志关联）
  requestId: {
    header: 'x-request-id',
    responseHeader: 'x-request-id',
  },
  // 声明需要透传到下游的 APM 追踪头
  fetch: {
    propagateHeaders: [
      'traceparent',   // W3C Trace Context 主头（含 traceId + spanId）
      'tracestate',    // W3C Trace Context 附加状态
      // 或 B3 格式：'x-b3-traceid', 'x-b3-spanid', 'x-b3-sampled'
    ],
  },
};
```

**第二步**：配置生效后，当入站请求携带 `traceparent` 头时，`app.fetch` 会自动将该头注入到所有出站请求，无需手动处理：

```
Client → [Service A: traceparent=00-abc123-...] → app.fetch → [Service B: traceparent=00-abc123-...]
                                                                        ↓
                                                              APM 系统识别同一 trace
```

**第三步**（可选）：通过 OpenTelemetry SDK 将 `traceId` 注入到日志，实现日志与 APM 链路的关联：

```typescript
// src/plugins/otel-log-correlation.ts
// 参见 examples/opentelemetry 完整示例
export default definePlugin({
  name: 'otel-log-correlation',
  setup(app) {
    // OpenTelemetry SDK 自动注入 trace_id 到 pino logger
    // 日志输出：{ requestId: '...', trace_id: 'abc123', msg: '...' }
  },
});
```

**适合场景**：接入 OpenTelemetry / Jaeger / Zipkin / Datadog、需要 APM 系统全链路可观测性。

### propagateHeaders 工作原理

`config.fetch.propagateHeaders` 的完整工作链路：

```
1. 入站请求携带 traceparent 头
        ↓
2. requestId 中间件从入站请求读取该头，写入 store.propagatedHeaders
        ↓
3. app.fetch 出站请求时，从 store.propagatedHeaders 读取并注入到请求头
        ↓
4. 下游服务收到 traceparent 头，APM 系统建立 span 关联
```

:::tip
`propagatedHeaders` 仅捕获 `config.fetch.propagateHeaders` 中声明的头。
如需临时透传未声明的头，直接在 `app.fetch` 调用时手动设置 `headers` 即可：

```typescript
await app.fetch.get(downstreamUrl, {
  headers: { 'x-custom-header': req.headers['x-custom-header'] as string },
});
```
:::

## 最佳实践

### 1. 优先使用框架内置能力

大多数场景下，`app.logger`（自动注入 requestId）和 `app.fetch`（自动传播 requestId）已经覆盖了常见需求，无需手动操作 `requestContext`。

### 2. 只存储请求级数据

`requestContext` 适合存储请求级别的数据（如 userId、tenantId、traceId）。不要存储大量数据或长生命周期的对象。

```typescript
// ✅ 好 — 轻量级请求级数据
(store as any).userId = 'user-123';
(store as any).tenantId = 'tenant-456';

// ❌ 不好 — 大对象，浪费内存
(store as any).fullUserProfile = { /* 大量字段 */ };
(store as any).queryResults = [ /* 大量数据 */ ];
```

### 3. 处理 store 为 undefined 的情况

在非请求上下文（启动阶段、定时任务、worker 线程）中，`getStore()` 返回 `undefined`。始终做安全检查：

```typescript
const store = requestContext.getStore();

// ✅ 安全访问
const requestId = store?.requestId ?? 'unknown';
const locale = store?.locale ?? 'zh-CN';

// ❌ 可能抛错
const requestId = store!.requestId;  // 非请求上下文时报错
```

### 4. 使用类型声明扩展 Store

如果你需要在 store 中添加自定义字段，使用 `declare module` 扩展类型而不是 `as any`：

```typescript
// src/types/request-context.d.ts
declare module 'vextjs' {
  interface RequestContextStore {
    userId?: string;
    tenantId?: string;
  }
}

// 使用时无需 as any
const store = requestContext.getStore();
store?.userId;  // 有类型提示
```

### 5. 不要在 store 中存储可变共享对象

```typescript
// ❌ 危险 — 如果 sharedCache 在其他地方被修改，会影响当前请求
(store as any).cache = sharedCache;

// ✅ 安全 — 复制一份
(store as any).cache = { ...sharedCache };
```

## 下一步

- 了解 [中间件](/guide/middleware) 如何在请求生命周期中写入上下文
- 查看 [日志](/guide/logger) 中 requestId 自动注入的实现原理
- 学习 [app.fetch 内置 HTTP 客户端](/guide/fetch) 如何自动传播 requestId 和 propagatedHeaders
- 探索 [国际化](/guide/i18n) 中 locale 与 requestContext 的关系
- 查看 [OpenTelemetry 集成示例](/examples/opentelemetry) 了解 APM traceId 与日志关联的完整方案
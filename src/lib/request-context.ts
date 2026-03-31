import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 请求上下文存储（Request-scoped Store）
 *
 * 基于 Node.js AsyncLocalStorage 实现，每个请求拥有独立的上下文数据，
 * 线程安全，不存在并发请求间的竞态问题。
 *
 * 主要用途：
 *   - locale：当前请求的语言环境（由中间件写入，app.throw 的 I18nError 读取）
 *   - requestId：当前请求的唯一标识（由 requestId 中间件写入）
 *
 * 设计说明：
 *   为什么不用全局变量（如 Locale.currentLocale）？
 *   Node.js 是单线程事件循环，但并发处理多个请求。
 *   全局变量会被后到的请求覆盖，导致先到的请求读到错误的 locale——这是竞态 Bug。
 *   AsyncLocalStorage 为每个异步执行上下文维护独立的 store，完美解决此问题。
 *
 * 使用示例：
 *   // 中间件中写入
 *   requestContext.run({ locale: 'zh-CN', requestId: 'abc-123' }, async () => {
 *     await next()
 *   })
 *
 *   // 任意深层代码中读取（无需参数传递）
 *   const store = requestContext.getStore()
 *   const locale = store?.locale  // 'zh-CN'
 *
 * ESM/CJS 双包单例保证：
 *   当框架同时通过 ESM（dist/index.js）和 CJS（dist/index.cjs）加载时，
 *   Node.js 会将它们视为独立模块，各自执行模块顶层代码。
 *   如果直接 `new AsyncLocalStorage()`，ESM 和 CJS 会创建两个不同的实例，
 *   导致 adapter 在实例 A 上 `.run()` 而用户路由代码在实例 B 上 `.getStore()` 返回 null。
 *
 *   解决方案：通过 globalThis 缓存单例，确保无论模块系统如何加载，
 *   整个进程中只存在一个 AsyncLocalStorage 实例。
 *   Symbol.for() 保证跨模块系统的 key 唯一性（比字符串 key 更安全，避免意外碰撞）。
 */

/**
 * 请求上下文存储的数据结构
 *
 * 各字段由不同的中间件在请求生命周期中写入：
 *   - requestId:          requestId 中间件（步骤①）
 *   - locale:             i18n 中间件或 Accept-Language 解析（步骤①+）
 *   - propagatedHeaders:  requestId 中间件从入站请求捕获，供 app.fetch 透传到下游
 */
export interface RequestContextStore {
  /** 当前请求的唯一标识（由 requestId 中间件生成/透传） */
  requestId?: string;

  /**
   * 当前请求的语言环境
   *
   * 由中间件从 Accept-Language 请求头或自定义逻辑中解析写入。
   * app.throw 内部的 I18nError.create() 通过此字段获取 locale，
   * 确保每个请求独立翻译，不受并发请求干扰。
   */
  locale?: string;

  /**
   * 需要透传到下游服务的入站请求头快照
   *
   * 由 requestId 中间件根据 config.fetch.propagateHeaders 列表，
   * 从当前入站请求中提取对应头的值后写入。
   *
   * app.fetch 在构建出站请求时从此字段读取，自动注入到下游请求头。
   * 这样实现了"入站头 → requestContext → 出站头"的完整透传链路，
   * 无需用户在每次 app.fetch 调用时手动传递头信息。
   *
   * 典型用途：
   *   - 分布式链路追踪头（如 `x-trace-id`、`traceparent`、`tracestate`）
   *   - 多租户标识（如 `x-tenant-id`）
   *   - 自定义业务头（如 `x-user-id`、`x-region`）
   *
   * 键名已统一转换为小写（与 HTTP 规范一致），例如：
   *   `X-Trace-Id` → `x-trace-id`
   *
   * @example
   * // config/default.ts
   * export default {
   *   fetch: { propagateHeaders: ['x-trace-id', 'x-tenant-id'] }
   * }
   *
   * // 入站请求携带 x-trace-id: abc123
   * // app.fetch 出站请求自动携带 x-trace-id: abc123
   */
  propagatedHeaders?: Record<string, string>;

  // ── F-03：OpenTelemetry trace context（可观测性扩展点）──────────

  /**
   * 当前请求的 OpenTelemetry Trace ID
   *
   * 由用户 tracing 中间件在请求开始时写入，框架不负责填充：
   * ```typescript
   * // src/middlewares/tracing.ts
   * import { trace } from '@opentelemetry/api'
   * import { requestContext } from 'vextjs'
   *
   * export default defineMiddleware(async (req, res, next) => {
   *   const span = trace.getActiveSpan()
   *   if (span?.isRecording()) {
   *     const store = requestContext.getStore()
   *     if (store) {
   *       store.traceId = span.spanContext().traceId
   *       store.spanId  = span.spanContext().spanId
   *     }
   *   }
   *   await next()
   * })
   * ```
   *
   * 写入后，`src/lib/logger.ts` 的内置 mixin 会自动将其注入每条日志的
   * `trace_id` 字段（字段名遵循 OTEL 语义约定，使用下划线格式）。
   *
   * 与 `VextLoggerConfig.mixin`（F-02）互补：
   *   - F-03（此字段）：零配置自动注入，适合"写一次、处处生效"的场景
   *   - F-02（mixin 回调）：更灵活，可实时读取 OTEL active span，无需写入 ALS
   */
  traceId?: string;

  /**
   * 当前请求的 OpenTelemetry Span ID
   *
   * 由用户 tracing 中间件在请求开始时写入（与 `traceId` 用法完全对称）。
   * 写入后，logger 内置 mixin 自动将其注入每条日志的 `span_id` 字段。
   *
   * @see traceId 字段注释（用法与 traceId 完全相同）
   */
  spanId?: string;
}

// ── globalThis 单例 key ─────────────────────────────────────
//
// 使用 Symbol.for() 而非普通字符串 key：
//   - Symbol.for() 在整个 V8 isolate（进程）中全局唯一
//   - 即使多个 npm 包版本共存，只要 key 字符串相同就返回同一个 Symbol
//   - 避免与用户代码或其他库的 globalThis 属性意外碰撞
//
const GLOBAL_KEY = Symbol.for("vextjs.requestContext");

/**
 * 获取或创建全局唯一的 requestContext 实例
 *
 * 首次调用时创建 AsyncLocalStorage 实例并挂载到 globalThis[GLOBAL_KEY]，
 * 后续调用（无论来自 ESM 还是 CJS）直接返回已缓存的实例。
 */
function getOrCreateRequestContext(): AsyncLocalStorage<RequestContextStore> {
  const existing = (globalThis as any)[GLOBAL_KEY];
  if (existing instanceof AsyncLocalStorage) {
    return existing;
  }

  const instance = new AsyncLocalStorage<RequestContextStore>();
  (globalThis as any)[GLOBAL_KEY] = instance;
  return instance;
}

/**
 * 请求上下文（AsyncLocalStorage 实例）
 *
 * 框架核心基础设施，在中间件链执行前通过 requestContext.run() 创建请求作用域。
 * 后续所有同步/异步代码通过 requestContext.getStore() 访问当前请求的上下文数据。
 *
 * 生命周期：
 *   1. adapter 收到请求，调用 requestContext.run(store, callback)
 *   2. callback 内执行中间件链（requestId 中间件写入 store.requestId）
 *   3. handler 执行，app.throw / app.logger 等读取 store
 *   4. 请求结束，store 自动 GC（无需手动清理）
 *
 * 单例保证：
 *   通过 globalThis + Symbol.for() 缓存，确保 ESM（dist/index.js）和
 *   CJS（dist/index.cjs）加载到同一个 AsyncLocalStorage 实例。
 *   解决了 adapter 在实例 A 上 .run() 而用户路由代码在实例 B 上
 *   .getStore() 返回 null 的双包问题。
 */
export const requestContext: AsyncLocalStorage<RequestContextStore> =
  getOrCreateRequestContext();

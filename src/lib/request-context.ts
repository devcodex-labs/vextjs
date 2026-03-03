import { AsyncLocalStorage } from 'node:async_hooks'

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
 */

/**
 * 请求上下文存储的数据结构
 *
 * 各字段由不同的中间件在请求生命周期中写入：
 *   - requestId: requestId 中间件（步骤①）
 *   - locale: i18n 中间件或 Accept-Language 解析（步骤①+）
 */
export interface RequestContextStore {
  /** 当前请求的唯一标识（由 requestId 中间件生成/透传） */
  requestId?: string

  /**
   * 当前请求的语言环境
   *
   * 由中间件从 Accept-Language 请求头或自定义逻辑中解析写入。
   * app.throw 内部的 I18nError.create() 通过此字段获取 locale，
   * 确保每个请求独立翻译，不受并发请求干扰。
   */
  locale?: string
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
 */
export const requestContext = new AsyncLocalStorage<RequestContextStore>()

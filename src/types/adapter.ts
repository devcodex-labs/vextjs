import type { VextMiddleware, VextErrorMiddleware } from './middleware.js'

/**
 * VextAdapter — 框架底层适配器接口
 *
 * vext 的核心抽象层，将框架逻辑与底层 HTTP 框架解耦。
 * 当前内置实现：Hono Adapter（见 adapters/hono/）。
 * 第三方可实现此接口以支持 Fastify、Express 等底层框架。
 *
 * 职责：
 *   - 路由注册（registerRoute）
 *   - 全局中间件注册（registerMiddleware）
 *   - 错误处理注册（registerErrorHandler）
 *   - 404 兜底注册（registerNotFound）
 *   - HTTP 服务器启动（listen）
 *   - 构建请求处理函数（buildHandler，用于 dev 模式热重载）
 *
 * 生命周期：
 *   1. bootstrap 调用 registerMiddleware() 注册全局中间件
 *   2. router-loader 调用 registerRoute() 注册每条路由
 *   3. bootstrap 调用 registerErrorHandler() + registerNotFound()
 *   4. bootstrap 调用 listen() 启动 HTTP 服务
 *
 * adapter 不负责的事项：
 *   - 配置加载（config-loader 职责）
 *   - 插件/服务/中间件 加载（各 loader 职责）
 *   - 出口包装逻辑（内建于 createVextResponse）
 *   - 优雅关闭编排（bootstrap/shutdown 职责）
 */
export interface VextAdapter {
  /** adapter 名称标识（用于日志和错误信息） */
  readonly name: string

  /**
   * 注册单条路由
   *
   * router-loader 为每条路由调用此方法。
   * chain 是已组装完毕的中间件执行链（含路由级中间件 + validate + handler）。
   * adapter 在执行时将全局中间件拼接在 chain 之前。
   *
   * @param method HTTP 方法（大写：GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS）
   * @param path   完整路径（含前缀，如 /api/v1/users/:id）
   * @param chain  中间件执行链（已组装完毕）
   */
  registerRoute(
    method: string,
    path: string,
    chain: VextMiddleware[],
  ): void

  /**
   * 注册全局中间件（在所有路由之前执行）
   *
   * 用于框架内置中间件（requestId / cors / body-parser / rate-limit / response-wrapper）
   * 和插件通过 app.use() 注册的中间件。
   *
   * @param middleware 标准 VextMiddleware
   */
  registerMiddleware(middleware: VextMiddleware): void

  /**
   * 注册全局错误处理
   *
   * 框架在所有路由注册完成后调用。
   * 错误处理函数捕获中间件链执行过程中抛出的所有错误，
   * 格式化为统一的 JSON 错误响应。
   *
   * @param handler 错误处理函数
   */
  registerErrorHandler(handler: VextErrorMiddleware): void

  /**
   * 注册 404 兜底
   *
   * 框架在错误处理注册后调用。
   * 当没有任何路由匹配时执行此处理函数。
   *
   * @param handler 兜底处理函数
   */
  registerNotFound(handler: VextMiddleware): void

  /**
   * 启动 HTTP 服务器
   *
   * 内部调用 buildHandler() 获取请求处理函数，
   * 然后创建 Node.js HTTP server 并开始监听。
   *
   * @param port 监听端口
   * @param host 监听地址（默认 '0.0.0.0'）
   * @returns 包含 close() 的服务器句柄
   */
  listen(port: number, host?: string): Promise<VextServerHandle>

  /**
   * 构建完整的请求处理函数（不启动 server）
   *
   * 在所有路由 / 中间件注册完成后调用。
   * 返回的 handler 接受原始 Node.js req/res，内部完成：
   *   - 请求/响应对象转换（如 HonoContext → VextRequest/VextResponse）
   *   - 路由匹配
   *   - 中间件链执行
   *   - 错误处理 + 404 兜底
   *
   * 用途：dev 模式下 Hot Reload 每次创建 fresh adapter 后调用
   * buildHandler() 获取新 handler，由 HotSwappableHandler 原子替换。
   * listen() 内部也调用此方法。
   *
   * @returns Node.js HTTP 请求处理函数
   */
  buildHandler(): (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void
}

/**
 * VextServerHandle — 服务器句柄
 *
 * listen() 返回的服务器句柄，用于优雅关闭和获取实际监听信息。
 * shutdown 流程通过 close() 停止接受新连接并等待飞行中请求完成。
 */
export interface VextServerHandle {
  /**
   * 停止接受新连接，等待飞行中请求完成后关闭
   *
   * 返回的 Promise 在所有飞行中请求处理完毕后 resolve。
   * shutdown 模块会用 Promise.race 加超时保护。
   */
  close(): Promise<void>

  /** 实际监听的端口（当传入 port=0 时可获取系统分配的端口） */
  readonly port: number

  /** 实际监听的地址 */
  readonly host: string
}

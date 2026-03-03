import type { VextApp } from './app.js'

/**
 * VextRequest — 框架统一请求对象接口
 *
 * 由各 Adapter 负责将底层框架的请求对象转换为此接口。
 * 路由 handler 和中间件通过此接口访问请求数据，
 * 与底层框架解耦，确保切换 Adapter 时用户代码无需改动。
 */
export interface VextRequest {
  // ── 原始数据 ──────────────────────────────────────────────

  /** URL 查询参数（已解析为键值对） */
  query: Record<string, string>

  /**
   * 请求体（由 body-parser 中间件负责填充）
   * 中间件执行前为 undefined，执行后为解析后的对象
   */
  body: unknown

  /** 路径动态参数（如 /users/:id 中的 { id: '123' }） */
  params: Record<string, string>

  /** 请求头（全部小写 key） */
  headers: Record<string, string | undefined>

  /** HTTP 方法（大写，如 'GET'、'POST'） */
  method: string

  /** 完整请求 URL */
  url: string

  /** 路径部分（不含 query string） */
  path: string

  // ── 请求元信息 ────────────────────────────────────────────

  /**
   * 当前请求所属的 app 实例
   *
   * 设计说明：路由 handler 通过 defineRoutes(app => ...) 闭包访问 app，
   * 不需要 req.app。但路由级中间件没有闭包，必须通过 req.app 访问
   * throw/logger 等能力。选择挂在 req.app 而非 req.throw/req.logger，
   * 是为了保持 VextRequest 接口职责清晰——业务扩展字段（req.user 等）
   * 和框架核心能力（app）通过命名空间隔离。
   */
  app: VextApp

  /**
   * 请求唯一标识
   *
   * - 默认：从 x-request-id 请求头透传，不存在则框架自动生成 UUID v4
   * - 可选：插件通过覆盖 config.requestId.generate 替换生成算法
   *
   * 由 requestId 中间件负责填充，创建时为空字符串。
   */
  requestId: string

  /**
   * 客户端 IP
   *
   * 当 config.trustProxy = true 时从 X-Forwarded-For 请求头读取第一个 IP，
   * 否则从底层 socket 的 remoteAddress 读取。
   */
  ip: string

  /**
   * 请求协议
   *
   * 当 config.trustProxy = true 时从 X-Forwarded-Proto 请求头读取，
   * 否则默认为 'http'。
   */
  protocol: 'http' | 'https'

  // ── 生命周期 ──────────────────────────────────────────────

  /**
   * 注册请求关闭钩子（连接断开时触发）
   *
   * 主要用于 SSE / WebSocket：客户端断开时清理资源。
   * 内存安全：框架在 hooks 执行完毕后自动清空 hooks 数组，
   * 无需手动移除，不会因闭包引用造成内存泄漏。
   *
   * @param handler 关闭时执行的回调
   * @example req.onClose(() => sseStream.close())
   */
  onClose(handler: () => void): void

  // ── 校验后数据 ────────────────────────────────────────────

  /**
   * 获取经过 validate 校验并类型转换后的数据
   *
   * 必须在 options.validate 配置了对应位置后调用，
   * 未配置对应位置时返回 undefined。
   * schema-dsl 会自动做类型转换（如 query 中的数字字符串 → number）。
   *
   * location 与数据源映射：
   *   'query'  → req.query   （URL 查询参数）
   *   'body'   → req.body    （请求体）
   *   'param'  → req.params  （路径动态参数，如 /:id）
   *   'header' → req.headers （请求头）
   *
   * 注意：location 使用单数 'param'（与 validate 配置的 key 一致），
   * 但底层数据源是复数 req.params。框架内部已正确映射。
   *
   * @param location 校验数据位置
   * @returns 校验后的数据对象；默认返回 Record<string, any>
   *
   * @example
   * // 直接使用（推荐，validator 已保证数据正确性）
   * const { page, limit } = req.valid('query')
   *
   * @example
   * // 加泛型获取更精确的 IDE 提示（可选）
   * const param = req.valid<{ id: string }>('param')
   * param.id  // IDE 知道是 string
   */
  valid<T = Record<string, any>>(location: 'query' | 'body' | 'param' | 'header'): T

  // ── 国际化（插件注入，可选）────────────────────────────

  /**
   * 翻译函数（i18n 插件注入）
   * @example req.t('user.not_found')        → '用户不存在'
   * @example req.t('welcome', { name: 'Alice' })  → '欢迎, Alice'
   */
  t?: (key: string, params?: Record<string, unknown>) => string

  // ── 中间件 / 插件扩展字段 ────────────────────────────────

  /**
   * 允许中间件或插件在 req 上挂载自定义字段。
   *
   * 通过 declare module 'vextjs' 扩展 VextRequest 接口可获得类型提示：
   * @example
   * declare module 'vextjs' {
   *   interface VextRequest {
   *     user?: { id: string; role: string }
   *   }
   * }
   */
  [key: string]: unknown
}

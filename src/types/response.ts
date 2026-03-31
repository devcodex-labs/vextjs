/**
 * VextResponse — 框架统一响应对象接口
 *
 * 由各 Adapter 负责将底层框架的响应能力转换为此接口。
 * 路由 handler 和中间件通过此接口发送响应，
 * 与底层框架解耦，确保切换 Adapter 时用户代码无需改动。
 *
 * 出口包装机制：
 *   response-wrapper 中间件调用 _enableWrap() 开启包装标志后，
 *   json() 自动将响应体包装为 { code: 0, data, requestId } 格式。
 *   rawJson() 始终绕过包装，仅供框架内部错误处理使用。
 */

/**
 * 用户可见的 VextResponse 接口
 *
 * 通过 Omit 排除内部方法 _enableWrap 和 rawJson，
 * 用户代码中只能访问公开的响应方法。
 */
export type VextPublicResponse = Omit<
  VextResponse,
  "_enableWrap" | "rawJson" | "_onSend"
>;

export interface VextResponse {
  /**
   * 返回 JSON 响应
   *
   * 当出口包装开启时（response-wrapper 中间件已执行 _enableWrap()），
   * 自动包装为：{ code: 0, data, requestId }
   * 当包装未开启时，直接发送原始 data。
   *
   * 204 特殊处理：无论包装是否开启，204 均不发送消息体（RFC 9110 §15.3.5）。
   *
   * @param data   业务数据，直接传，框架自动包装
   * @param status HTTP 状态码（可选，默认使用 .status() 设置的值或 200）
   *
   * @example
   * // 成功响应 → { code: 0, data: { id: 1, name: '...' }, requestId: '...' }
   * res.json({ id: 1, name: 'Alice' })
   *
   * @example
   * // 201 Created
   * res.json(data, 201)
   *
   * @example
   * // 204 No Content（删除等操作）
   * res.status(204).json(null)
   */
  json(data: unknown, status?: number): void;

  /**
   * 返回原始 JSON（不经过出口包装）
   *
   * 仅框架内部错误处理使用，用户代码不应直接调用。
   * 通过 VextPublicResponse 类型从用户可见接口中排除。
   *
   * @internal
   * @param data   原始 JSON 数据
   * @param status HTTP 状态码
   */
  rawJson(data: unknown, status?: number): void;

  /**
   * 返回纯文本响应（不经过出口包装）
   *
   * @param content 文本内容
   * @param status  HTTP 状态码（可选，默认使用 .status() 设置的值或 200）
   */
  text(content: string, status?: number): void;

  /**
   * 流式响应（大文件传输、实时数据流）
   *
   * @param readable    Node.js Readable stream
   * @param contentType MIME 类型，默认 'application/octet-stream'
   */
  stream(readable: NodeJS.ReadableStream, contentType?: string): void;

  /**
   * 文件下载（触发浏览器下载行为）
   *
   * 自动设置 Content-Disposition: attachment 头，
   * 触发浏览器的文件下载对话框。
   *
   * @param readable    文件流
   * @param filename    下载文件名（浏览器显示）
   * @param contentType MIME 类型，默认 'application/octet-stream'
   */
  download(
    readable: NodeJS.ReadableStream,
    filename: string,
    contentType?: string,
  ): void;

  /**
   * 重定向
   *
   * @param url    目标 URL
   * @param status 重定向状态码（默认 302）
   */
  redirect(url: string, status?: 301 | 302 | 307 | 308): void;

  /**
   * 设置 HTTP 状态码（链式调用）
   *
   * @param code HTTP 状态码
   * @returns this，支持链式调用
   *
   * @example
   * res.status(201).json(data)
   * res.status(204).json(null)
   */
  status(code: number): this;

  /**
   * 设置响应头（链式调用）
   *
   * @param name  响应头名称
   * @param value 响应头值
   * @returns this，支持链式调用
   *
   * @example
   * res.setHeader('X-Custom', 'value').json(data)
   */
  setHeader(name: string, value: string): this;

  // ── 状态码（只读）─────────────────────────────────────

  /**
   * 当前 HTTP 状态码（只读）
   *
   * 返回通过 .status() 设置的值，或 json/rawJson/text 等方法
   * 传入的 status 参数所确定的最终状态码。默认 200。
   *
   * 主要用途：洋葱模型 after-middleware 在 `await next()` 后
   * 读取响应状态码（如 access-log 中间件记录请求耗时与状态码）。
   *
   * @example
   * const accessLog: VextMiddleware = async (req, res, next) => {
   *   await next()
   *   console.log(`${req.method} ${req.path} → ${res.statusCode}`)
   * }
   */
  readonly statusCode: number;

  // ── 内部方法（用户不可见）──────────────────────────────

  /**
   * 开启出口包装标志（内部方法）
   *
   * 仅由 response-wrapper 中间件调用，用户代码不应直接调用。
   * 调用后 json() 将自动包装响应为 { code: 0, data, requestId }。
   * 通过 VextPublicResponse 类型从用户可见接口中排除。
   *
   * @internal
   */
  _enableWrap(): void;

  /**
   * 发送前拦截钩子（内部方法）
   *
   * cache MISS 时由缓存中间件注册，json() 发送前回调以捕获原始 data。
   * 在包装逻辑（_wrapEnabled）之前调用，缓存的是原始 data 而非包装后的响应体。
   * 当前单钩子设计（覆盖赋值）。
   *
   * @internal
   * @see 15-route-cache.md §4.3（_onSend 钩子设计）
   */
  _onSend?: (data: unknown, statusCode: number) => void;

  // ── 实时通信（插件注入，可选）────────────────────────

  /**
   * 将当前请求升级为 SSE 连接（Server-Sent Events）
   * 需安装 vextjs-plugin-sse 插件
   */
  sse?(): unknown;

  /**
   * 将当前请求升级为 WebSocket 连接
   * 需安装 vextjs-plugin-ws 插件
   */
  upgrade?(): unknown;
}

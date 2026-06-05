import type { ServerResponse } from "node:http";
import type { VextRequest } from "../../types/request.js";
import type { VextResponse } from "../../types/response.js";
import {
  beginResponseSend,
  finishResponseSend,
} from "../../lib/response-hooks.js";

type RequestIdSource = Pick<VextRequest, "requestId"> | (() => string);

/**
 * Native ServerResponse → VextResponse 转换（F5 优化：class 实例化）
 *
 * 直接操作 Node.js ServerResponse，零第三方框架中间层开销。
 * 这是 Native Adapter 的核心性能优势之一：跳过 Fastify reply / Koa ctx.response /
 * Express res 等框架的响应对象包装层，直接调用原生 API。
 *
 * F5 优化说明：
 *   从闭包工厂函数 createVextResponse() 改为 class NativeVextResponse。
 *   方法通过原型链共享定义，避免每请求都创建新的闭包对象。
 *   V8 对 class 实例的 Hidden Class 优化比闭包对象更好，
 *   减少每请求的内存分配和 GC 压力。
 *
 *   接口完全兼容：NativeVextResponse implements VextResponse，
 *   外部代码无需任何改动。
 *
 * 核心设计（与其他 Adapter 的 response.ts 逻辑对齐）：
 *
 *   1. 延迟绑定 requestId（request 对象引用或 getRequestId getter）
 *      requestId 在 createVextResponse 调用时尚未生成（requestId 中间件还没执行），
 *      通过 request 对象引用确保 json() 实际调用时才取值（此时 requestId 必然已由中间件生成）。
 *
 *   2. 内建出口包装（_wrapEnabled 标志）
 *      response-wrapper 中间件通过 _enableWrap() 开启包装标志。
 *      json() 根据标志决定是否将响应体包装为 { code: 0, data, requestId }。
 *      rawJson() 始终绕过包装——仅供框架内部错误处理使用。
 *
 *   3. 重复发送保护（_sent 标志）
 *      防止 handler 中误调用多次 res.json()，dev 模式打印警告，生产模式静默忽略。
 *
 *   4. 链式调用（status / setHeader 返回 this）
 *      res.status(201).json(data) 正确设置 HTTP 201。
 *
 *   5. 204 No Content 合规（RFC 9110 §15.3.5）
 *      无论包装是否开启，204 均发送无消息体的响应。
 *
 *   6. 直接 JSON 序列化
 *      使用 serverResponse.end(JSON.stringify(...))，
 *      没有任何中间层（Fastify 的 reply.send / Express 的 res.json 都有额外逻辑）。
 *      这是 Native Adapter 性能优势的关键来源。
 *
 * 与其他 Adapter 的差异：
 *   - Fastify: reply.status().header().send(JSON.stringify(...))
 *   - Express: res.status().set().json(data) 或 res.send()
 *   - Koa: ctx.status = N; ctx.body = data
 *   - Hono: ResponseBox 容器捕获 c.json() 返回的 Web Response
 *   - Native: serverResponse.writeHead(status, headers); serverResponse.end(body)
 *     零中间层，最短调用路径
 *
 * 时序保证：
 *   createVextResponse(serverResponse, req)
 *     ↓ executeChain 开始
 *   [requestIdMiddleware]        → req.requestId = 'a1b2c3d4...'
 *   [responseWrapperMiddleware]  → res._enableWrap()
 *     ↓
 *   [handler] res.status(201).json(data)
 *     → _wrapEnabled = true
 *     → req.requestId → 'a1b2c3d4...'（已设置）
 *     → serverResponse.end(JSON.stringify({ code: 0, data, requestId }))
 *     → HTTP 201 ✅
 *
 * @see adapters/fastify/response.ts（Fastify Adapter 对应实现）
 * @see adapters/express/response.ts（Express Adapter 对应实现）
 * @see adapters/koa/response.ts（Koa Adapter 对应实现）
 * @see adapters/hono/response.ts（Hono Adapter 对应实现）
 */

/**
 * 是否为生产环境（模块级缓存，避免每次 checkSent 都读取 process.env）
 */
const _isProduction = process.env.NODE_ENV === "production";

/**
 * NativeVextResponse — class 实现的 VextResponse
 *
 * F5 优化核心：方法定义在原型上，所有实例共享，
 * 避免闭包工厂模式下每请求创建 N 个函数对象。
 *
 * V8 Hidden Class：class 实例的属性形状在构造时确定，
 * V8 可保持快速属性模式（vs 闭包对象的动态形状）。
 */
class NativeVextResponse implements VextResponse {
  /** Node.js 原始 ServerResponse */
  private _serverResponse: ServerResponse;

  /** 延迟获取 requestId 的来源；Native adapter 传入 request 对象，避免每请求 getter 闭包 */
  private _requestIdSource: RequestIdSource;

  /** 当前 HTTP 状态码（默认 200，可通过 status() 修改） */
  private _status: number = 200;

  /** 响应头缓冲区（通过 setHeader() 累积，在发送时一次性设置） */
  private _headers: Record<string, string> = {};

  /** 出口包装开关（由 response-wrapper 中间件通过 _enableWrap() 开启） */
  private _wrapEnabled: boolean = false;

  /** 重复发送保护标志（防止 handler 中多次调用 json/rawJson/text） */
  private _sent: boolean = false;

  /** 发送前拦截钩子（缓存中间件在 MISS 时注册） @internal */
  _onSend?: (
    data: unknown,
    statusCode: number,
    headers?: Record<string, string>,
  ) => void;

  constructor(
    serverResponse: ServerResponse,
    requestIdSource: RequestIdSource,
  ) {
    this._serverResponse = serverResponse;
    this._requestIdSource = requestIdSource;
  }

  // ── 内部辅助方法（原型上共享）──────────────────────────

  /**
   * 延迟读取 requestId。
   *
   * Native adapter 热路径传入 VextRequest 对象，避免每请求创建 `() => req.requestId`
   * 闭包；保留函数来源兼容内部测试或未来调用方。
   */
  private _resolveRequestId(): string {
    const source = this._requestIdSource;
    return typeof source === "function" ? source() : source.requestId;
  }

  /**
   * 将累积的响应头设置到 ServerResponse 上
   *
   * 在每个发送方法中调用，将通过 setHeader() 累积的头信息
   * 一次性设置到 serverResponse 对象上。
   *
   * 使用原生 serverResponse.setHeader() 而非 writeHead()，
   * 因为 writeHead() 会立即发送 header，而 setHeader() 允许后续修改。
   * 最终的 statusCode 和 header 在 end() 调用时统一发送。
   */
  private _applyHeaders(): void {
    const headers = this._headers;
    const sr = this._serverResponse;
    for (const key in headers) {
      sr.setHeader(key, headers[key]!);
    }
  }

  /**
   * 检查是否已发送响应（重复发送保护）
   *
   * 第一次调用返回 false 并设置 _sent = true。
   * 后续调用返回 true（表示已发送，调用方应终止当前方法）。
   * dev 模式下打印警告，帮助开发者发现 handler 中的重复发送 bug。
   *
   * @param methodName 调用的方法名（用于警告消息）
   * @returns true 表示已发送（应终止当前方法），false 表示可以发送
   */
  private _checkSent(methodName: string): boolean {
    if (this._sent) {
      if (!_isProduction) {
        console.warn(
          `[vextjs] ⚠️ res.${methodName}() called after response already sent. ` +
            "This is a no-op. Check your handler for duplicate sends.",
        );
      }
      return true;
    }
    this._sent = true;
    return false;
  }

  /**
   * 发送 JSON 字符串响应（内部共用方法）
   *
   * 所有 JSON 发送路径（json / rawJson）最终都走此方法，
   * 减少代码重复，确保 statusCode / header / end 调用路径统一。
   *
   * @param body   已序列化的 JSON 字符串
   * @param status HTTP 状态码
   */
  private _sendJsonString(body: string, status: number): void {
    const sr = this._serverResponse;
    sr.statusCode = status;
    sr.setHeader("Content-Type", "application/json; charset=utf-8");
    sr.setHeader("Content-Length", Buffer.byteLength(body));
    this._applyHeaders();
    sr.end(body);
  }

  /**
   * 发送 204 No Content（无消息体）
   *
   * RFC 9110 §15.3.5 要求 204 不能有消息体。
   * 移除 Content-Type 避免混淆。
   */
  private _send204(): void {
    const sr = this._serverResponse;
    sr.statusCode = 204;
    sr.removeHeader("Content-Type");
    this._applyHeaders();
    sr.end();
  }

  // ── VextResponse 接口实现（原型方法，所有实例共享）──────

  /**
   * 返回 JSON 响应
   *
   * 当出口包装开启时（response-wrapper 中间件已执行 _enableWrap()），
   * 自动包装为：{ code: 0, data, requestId }
   * 当包装未开启时，直接发送原始 data。
   *
   * 204 特殊处理：无论包装是否开启，204 均不发送消息体（RFC 9110 §15.3.5）。
   *
   * Native 特殊处理：
   *   直接调用 serverResponse.end(JSON.stringify(...))，
   *   没有任何框架中间层（Fastify 有 reply.send、Express 有 res.json、
   *   Koa 有 ctx.body 赋值），这是 Native Adapter 性能优势的关键来源。
   */
  json(data: unknown, status?: number): void {
    if (this._checkSent("json")) return;

    let finalStatus = status ?? this._status;
    this._status = finalStatus;

    // route-cache 捕获必须早于 response:before 用户 patch，缓存的是 handler 原始 data。
    if (this._onSend) {
      this._onSend(data, finalStatus, { ...this._headers });
    }

    const sendState = beginResponseSend(this, {
      kind: "json",
      data,
      status: finalStatus,
      headers: { ...this._headers },
      wrapped: this._wrapEnabled,
      requestId: this._resolveRequestId(),
    });
    data = sendState.data;
    finalStatus = sendState.status;
    this._status = finalStatus;
    Object.assign(this._headers, sendState.headers);

    if (this._wrapEnabled) {
      // 204 No Content 不能有消息体（RFC 9110 §15.3.5）
      if (finalStatus === 204) {
        this._send204();
        finishResponseSend(this, sendState);
        return;
      }

      // 出口包装：{ code: 0, data, requestId }
      this._sendJsonString(
        JSON.stringify({
          code: 0,
          data,
          requestId: this._resolveRequestId(),
        }),
        finalStatus,
      );
      finishResponseSend(this, sendState);
      return;
    }

    // 未包装模式
    if (finalStatus === 204) {
      this._send204();
      finishResponseSend(this, sendState);
      return;
    }

    this._sendJsonString(JSON.stringify(data), finalStatus);
    finishResponseSend(this, sendState);
  }

  /**
   * 返回原始 JSON（不经过出口包装）
   *
   * 仅框架内部错误处理使用，用户代码不应直接调用。
   * 通过 VextPublicResponse 类型从用户可见接口中排除。
   *
   * @internal
   */
  rawJson(data: unknown, status?: number): void {
    if (this._checkSent("rawJson")) return;

    let finalStatus = status ?? this._status;
    this._status = finalStatus;
    const sendState = beginResponseSend(this, {
      kind: "rawJson",
      data,
      status: finalStatus,
      headers: { ...this._headers },
      wrapped: false,
      requestId: this._resolveRequestId(),
    });
    data = sendState.data;
    finalStatus = sendState.status;
    this._status = finalStatus;
    Object.assign(this._headers, sendState.headers);

    this._sendJsonString(JSON.stringify(data), finalStatus);
    finishResponseSend(this, sendState);
  }

  /**
   * 返回纯文本响应（不经过出口包装）
   */
  text(content: string, status?: number): void {
    if (this._checkSent("text")) return;

    let finalStatus = status ?? this._status;
    this._status = finalStatus;
    const sendState = beginResponseSend(this, {
      kind: "text",
      data: content,
      status: finalStatus,
      headers: { ...this._headers },
      wrapped: false,
      requestId: this._resolveRequestId(),
    });
    content =
      typeof sendState.data === "string" ? sendState.data : String(content);
    finalStatus = sendState.status;
    this._status = finalStatus;
    Object.assign(this._headers, sendState.headers);

    const sr = this._serverResponse;
    sr.statusCode = finalStatus;
    // 先设默认 Content-Type: text/plain，再调 _applyHeaders()
    // 让外部通过 setHeader("Content-Type", "text/html") 的设置能够覆盖默认值。
    sr.setHeader("Content-Type", "text/plain; charset=utf-8");
    this._applyHeaders();
    sr.setHeader("Content-Length", Buffer.byteLength(content));
    sr.end(content);
    finishResponseSend(this, sendState);
  }

  /**
   * 流式响应（大文件传输、实时数据流）
   *
   * 直接将 ReadableStream pipe 到 ServerResponse。
   * Node.js 原生 pipe 机制，零框架开销。
   */
  stream(
    readable: NodeJS.ReadableStream,
    contentType: string = "application/octet-stream",
  ): void {
    if (this._checkSent("stream")) return;

    const sendState = beginResponseSend(this, {
      kind: "stream",
      status: this._status,
      headers: { ...this._headers },
      wrapped: false,
      requestId: this._resolveRequestId(),
    });
    this._status = sendState.status;
    Object.assign(this._headers, sendState.headers);

    const sr = this._serverResponse;
    sr.statusCode = this._status;
    sr.setHeader("Content-Type", contentType);
    this._applyHeaders();

    // 使用 pipe 自动处理背压（backpressure）
    (readable as NodeJS.ReadableStream).pipe(sr);
    finishResponseSend(this, sendState);
  }

  /**
   * 文件下载（触发浏览器下载行为）
   *
   * 自动设置 Content-Disposition: attachment 头，
   * 触发浏览器的文件下载对话框。
   */
  download(
    readable: NodeJS.ReadableStream,
    filename: string,
    contentType?: string,
  ): void {
    if (this._checkSent("download")) return;

    const ct = contentType ?? "application/octet-stream";
    const sr = this._serverResponse;

    sr.statusCode = this._status;
    sr.setHeader("Content-Type", ct);
    sr.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    this._applyHeaders();

    (readable as NodeJS.ReadableStream).pipe(sr);
  }

  /**
   * 重定向
   *
   * 直接设置 Location 响应头和状态码，然后 end()。
   * 不依赖任何框架的 redirect 方法。
   */
  redirect(url: string, status: 301 | 302 | 307 | 308 = 302): void {
    if (this._checkSent("redirect")) return;

    const sr = this._serverResponse;
    sr.statusCode = status;
    sr.setHeader("Location", url);
    this._applyHeaders();
    sr.end();
  }

  /**
   * 设置 HTTP 状态码（链式调用）
   */
  status(code: number): this {
    this._status = code;
    return this;
  }

  /**
   * 设置响应头（链式调用）
   */
  setHeader(name: string, value: string): this {
    this._headers[name] = value;
    return this;
  }

  /**
   * 当前 HTTP 状态码（只读）
   *
   * 返回通过 .status() 设置的值，或 json/rawJson/text 等方法
   * 传入的 status 参数所确定的最终状态码。默认 200。
   *
   * 主要用途：洋葱模型 after-middleware 在 `await next()` 后
   * 读取响应状态码（如 access-log 中间件记录请求耗时与状态码）。
   */
  get statusCode(): number {
    return this._status;
  }

  /**
   * 开启出口包装标志（内部方法）
   *
   * 仅由 response-wrapper 中间件调用，用户代码不应直接调用。
   * 调用后 json() 将自动包装响应为 { code: 0, data, requestId }。
   *
   * @internal
   */
  _enableWrap(): void {
    this._wrapEnabled = true;
  }
}

/**
 * 创建 VextResponse 实例（工厂函数 — 保持与其他 Adapter 的调用接口一致）
 *
 * F5 优化：内部使用 NativeVextResponse class 实例化，
 * 方法通过原型链共享，避免闭包工厂模式下每请求创建 N 个函数对象。
 *
 * @param serverResponse   Node.js ServerResponse 原始响应对象
 * @param requestIdSource  延迟获取 requestId 的来源；优先传入 VextRequest 对象以减少闭包分配
 * @returns VextResponse 实例（含内部方法 _enableWrap）
 */
export function createVextResponse(
  serverResponse: ServerResponse,
  requestIdSource: RequestIdSource,
): VextResponse {
  return new NativeVextResponse(serverResponse, requestIdSource);
}

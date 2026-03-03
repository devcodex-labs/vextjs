import type { FastifyReply } from "fastify";
import type { VextResponse } from "../../types/response.js";

/**
 * Fastify Reply → VextResponse 转换
 *
 * 核心设计（与 Hono Adapter 的 response.ts 逻辑对齐）：
 *
 *   1. 延迟绑定 requestId（getRequestId getter）
 *      requestId 在 createVextResponse 调用时尚未生成（requestId 中间件还没执行），
 *      传入 getter 函数确保 json() 实际调用时才取值（此时 requestId 必然已由中间件生成）。
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
 *   6. 手动 JSON 序列化
 *      使用 reply.send(JSON.stringify(...)) 而非 reply.send(object)，
 *      避免 Fastify 内置的 fast-json-stringify 自动序列化，
 *      保证与 Hono Adapter 行为一致（跨 Adapter 行为一致性 > 单 Adapter 极限性能）。
 *
 * 与 Hono Adapter 的差异：
 *   - Hono: 通过 ResponseBox 容器捕获 c.json() 返回的 Web Response 对象
 *   - Fastify: 直接调用 reply.status().header().send() 发送响应（Node.js 原生模型）
 *   - Fastify 无需 ResponseBox 机制，因为 Fastify 的 route handler 不需要返回 Response 对象
 *
 * 时序保证：
 *   createVextResponse(reply, () => req.requestId)
 *     ↓ executeChain 开始
 *   [requestIdMiddleware]        → req.requestId = 'a1b2c3d4...'
 *   [responseWrapperMiddleware]  → res._enableWrap()
 *     ↓
 *   [handler] res.status(201).json(data)
 *     → _wrapEnabled = true
 *     → getRequestId() → 'a1b2c3d4...'（已设置）
 *     → reply.send(JSON.stringify({ code: 0, data, requestId }))
 *     → HTTP 201 ✅
 *
 * @param reply          Fastify Reply 对象
 * @param getRequestId   延迟获取 requestId 的 getter 函数
 * @returns VextResponse 实例（含内部方法 _enableWrap）
 *
 * @see 08a-fastify-adapter.md §5（响应转换）
 * @see adapters/hono/response.ts（Hono Adapter 对应实现）
 */
export function createVextResponse(
  reply: FastifyReply,
  getRequestId: () => string,
): VextResponse {
  /** 当前 HTTP 状态码（默认 200，可通过 status() 修改） */
  let _status = 200;

  /** 响应头缓冲区（通过 setHeader() 累积，在发送时一次性设置） */
  const _headers: Record<string, string> = {};

  /** 出口包装开关（由 response-wrapper 中间件通过 _enableWrap() 开启） */
  let _wrapEnabled = false;

  /** 重复发送保护标志（防止 handler 中多次调用 json/rawJson/text） */
  let _sent = false;

  /**
   * 将累积的响应头设置到 Fastify Reply 上
   *
   * 在每个发送方法中调用，将通过 setHeader() 累积的头信息
   * 一次性设置到 reply 对象上。
   */
  function applyHeaders(): void {
    for (const [k, v] of Object.entries(_headers)) {
      reply.header(k, v);
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
  function checkSent(methodName: string): boolean {
    if (_sent) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[vextjs] ⚠️ res.${methodName}() called after response already sent. ` +
            "This is a no-op. Check your handler for duplicate sends.",
        );
      }
      return true;
    }
    _sent = true;
    return false;
  }

  const res: VextResponse = {
    /**
     * 返回 JSON 响应
     *
     * 当出口包装开启时（response-wrapper 中间件已执行 _enableWrap()），
     * 自动包装为：{ code: 0, data, requestId }
     * 当包装未开启时，直接发送原始 data。
     *
     * 204 特殊处理：无论包装是否开启，204 均不发送消息体（RFC 9110 §15.3.5）。
     *
     * Fastify 特殊处理：
     *   使用 reply.send(JSON.stringify(...)) 手动序列化，
     *   而非 reply.send(object)（会触发 Fastify 自动序列化），
     *   确保与 Hono Adapter 行为一致。
     */
    json(data: unknown, status?: number): void {
      if (checkSent("json")) return;

      const finalStatus = status ?? _status;
      _status = finalStatus;

      reply.status(finalStatus);
      applyHeaders();

      if (_wrapEnabled) {
        // P1-7: 204 No Content 不能有消息体（RFC 9110 §15.3.5）
        if (finalStatus === 204) {
          reply.removeHeader("Content-Type");
          reply.send(undefined);
          return;
        }

        // 出口包装：{ code: 0, data, requestId }
        reply.header("Content-Type", "application/json; charset=utf-8");
        reply.send(
          JSON.stringify({
            code: 0,
            data,
            requestId: getRequestId(),
          }),
        );
        return;
      }

      // 未包装模式
      if (finalStatus === 204) {
        reply.removeHeader("Content-Type");
        reply.send(undefined);
        return;
      }

      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.send(JSON.stringify(data));
    },

    /**
     * 返回原始 JSON（不经过出口包装）
     *
     * 仅框架内部错误处理使用，用户代码不应直接调用。
     * 通过 VextPublicResponse 类型从用户可见接口中排除。
     *
     * @internal
     */
    rawJson(data: unknown, status?: number): void {
      if (checkSent("rawJson")) return;

      const finalStatus = status ?? _status;
      _status = finalStatus;

      reply.status(finalStatus);
      applyHeaders();

      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.send(JSON.stringify(data));
    },

    /**
     * 返回纯文本响应（不经过出口包装）
     */
    text(content: string, status?: number): void {
      if (checkSent("text")) return;

      const finalStatus = status ?? _status;
      _status = finalStatus;

      reply.status(finalStatus);
      applyHeaders();

      reply.header("Content-Type", "text/plain; charset=utf-8");
      reply.send(content);
    },

    /**
     * 流式响应（大文件传输、实时数据流）
     *
     * Fastify 支持直接将 ReadableStream 传给 reply.send()，
     * 内部使用 pump 管道传输数据。
     */
    stream(
      readable: NodeJS.ReadableStream,
      contentType: string = "application/octet-stream",
    ): void {
      if (checkSent("stream")) return;

      reply.status(_status);
      reply.header("Content-Type", contentType);
      applyHeaders();

      reply.send(readable);
    },

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
      if (checkSent("download")) return;

      const ct = contentType ?? "application/octet-stream";

      reply.status(_status);
      reply.header("Content-Type", ct);
      reply.header(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      applyHeaders();

      reply.send(readable);
    },

    /**
     * 重定向
     *
     * Fastify v5 的 reply.redirect() 参数顺序与标准不同：
     *   - Fastify v4: reply.redirect(url, statusCode?)
     *   - Fastify v5: reply.redirect(url, statusCode?) — 同 v4
     *
     * 注意：Fastify 的 redirect 内部会自动发送响应，
     * 不需要额外调用 reply.send()。
     */
    redirect(url: string, status: 301 | 302 | 307 | 308 = 302): void {
      if (checkSent("redirect")) return;

      applyHeaders();
      reply.redirect(url, status);
    },

    /**
     * 设置 HTTP 状态码（链式调用）
     */
    status(code: number): VextResponse {
      _status = code;
      return res;
    },

    /**
     * 设置响应头（链式调用）
     */
    setHeader(name: string, value: string): VextResponse {
      _headers[name] = value;
      return res;
    },

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
      return _status;
    },

    /**
     * 开启出口包装标志（内部方法）
     *
     * 仅由 response-wrapper 中间件调用，用户代码不应直接调用。
     * 调用后 json() 将自动包装响应为 { code: 0, data, requestId }。
     *
     * @internal
     */
    _enableWrap(): void {
      _wrapEnabled = true;
    },
  };

  return res;
}

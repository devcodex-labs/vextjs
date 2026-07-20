import type { Context } from "hono";
import type { VextResponse } from "../../types/response.js";
import type { VextHeaderValue, VextHeaders } from "../../types/headers.js";
import {
  beginResponseSend,
  finishResponseSend,
  finishResponseSendAfterStreamSettlement,
} from "../../lib/response-hooks.js";
import {
  cloneHeaders,
  isSetCookieHeader,
  mergeHeaders,
  replaceHeaders,
  setHeader as setBufferedHeader,
} from "../../lib/headers.js";
import {
  appendSetCookie,
  serializeClearCookie,
  serializeCookie,
} from "../../lib/cookies.js";
import {
  renderErrorUnavailable,
  renderUnavailable,
} from "../../lib/response-render-placeholder.js";

/**
 * 共享 Response 容器
 *
 * Hono 的 route handler 必须返回 Response 对象。
 * 但 vext 的中间件链通过 VextResponse 的方法（json/text/...）间接调用 Hono 的 API。
 * 这些 API（c.json / c.body / c.text / c.redirect）都返回 Response 对象。
 *
 * 通过 ResponseBox 容器，VextResponse 的每个发送方法将 Hono 返回的 Response
 * 存储到 box.value 中，adapter 的 route handler 随后通过 box.value 获取最终 Response
 * 返回给 Hono。
 *
 * 如果中间件链执行完毕后 box.value 仍为 null，说明 handler 没有调用任何发送方法，
 * adapter 将返回一个空的 204 Response 作为兜底。
 */
export interface ResponseBox {
  value: Response | null;
}

/**
 * 创建 ResponseBox 容器
 *
 * 由 adapter 的 registerRoute / registerNotFound 中调用，
 * 传给 createVextResponse，并在 handler 返回后读取 box.value。
 */
export function createResponseBox(): ResponseBox {
  return { value: null };
}

/**
 * HonoContext → VextResponse 转换
 *
 * 核心设计（P0-1 修复）：
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
 *   6. Response 捕获（ResponseBox）
 *      每个发送方法将 Hono 返回的 Response 存储到 box.value 中，
 *      adapter handler 通过 box.value 将 Response 返回给 Hono。
 *
 * 时序保证：
 *   createVextResponse(c, () => req.requestId, box)
 *     ↓ executeChain 开始
 *   [requestIdMiddleware]        → req.requestId = 'a1b2c3d4...'
 *   [responseWrapperMiddleware]  → res._enableWrap()
 *     ↓
 *   [handler] res.status(201).json(data)
 *     → _wrapEnabled = true
 *     → getRequestId() → 'a1b2c3d4...'（已设置）
 *     → c.json(...) 返回 Response，存入 box.value
 *     → HTTP 201 ✅
 *
 * @param c              Hono Context 对象
 * @param getRequestId   延迟获取 requestId 的 getter 函数
 * @param box            Response 捕获容器
 * @returns VextResponse 实例（含内部方法 _enableWrap）
 */
export function createVextResponse(
  c: Context,
  getRequestId: () => string,
  box: ResponseBox,
): VextResponse {
  /** 当前 HTTP 状态码（默认 200，可通过 status() 修改） */
  let _status = 200;

  /** 响应头缓冲区（通过 setHeader() 累积，在发送时一次性设置） */
  const _headers: VextHeaders = {};

  /** 出口包装开关（由 response-wrapper 中间件通过 _enableWrap() 开启） */
  let _wrapEnabled = false;

  /** 重复发送保护标志（P2-2：防止 handler 中多次调用 json/rawJson/text） */
  let _sent = false;

  /**
   * 将累积的响应头设置到 Hono Context 上
   */
  function applyHeaders(): void {
    for (const [k, v] of Object.entries(_headers)) {
      if (Array.isArray(v)) {
        if (!isSetCookieHeader(k)) {
          c.header(k, v.join(", "));
          continue;
        }
        for (const value of v) {
          c.header(k, value, { append: true });
        }
        continue;
      }
      c.header(k, v);
    }
  }

  /**
   * 检查是否已发送响应（重复发送保护）
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

  /**
   * 将 Hono 返回的 Response/TypedResponse 存入 box
   *
   * Hono 的 c.json() / c.text() / c.body() / c.redirect() 返回值类型为
   * Response & TypedResponse<...>，需要将其存入 box.value 供 adapter handler 返回。
   *
   * @param response Hono API 返回的 Response 对象
   */
  function captureResponse(response: Response): void {
    box.value = response;
  }

  const res: VextResponse = {
    json(data: unknown, status?: number): void {
      if (checkSent("json")) return;

      let finalStatus = status ?? _status;
      _status = finalStatus;

      // route-cache 捕获必须早于 response:before 用户 patch，缓存的是 handler 原始 data。
      if (res._onSend) {
        res._onSend(data, finalStatus, cloneHeaders(_headers));
      }

      const sendState = beginResponseSend(res, {
        kind: "json",
        data,
        status: finalStatus,
        headers: cloneHeaders(_headers),
        wrapped: _wrapEnabled,
        requestId: getRequestId(),
      });
      data = sendState.data;
      finalStatus = sendState.status;
      _status = finalStatus;
      replaceHeaders(_headers, sendState.headers);

      // 设置 HTTP 状态码和响应头
      c.status(finalStatus as any);
      applyHeaders();

      if (_wrapEnabled) {
        // P1-7: 204 No Content 不能有消息体（RFC 9110 §15.3.5）
        if (finalStatus === 204) {
          captureResponse(c.body(null));
          finishResponseSend(res, sendState);
          return;
        }

        // 出口包装：{ code: 0, data, requestId }
        captureResponse(
          c.json({
            code: 0,
            data,
            requestId: getRequestId(),
          }),
        );
        finishResponseSend(res, sendState);
        return;
      }

      // 未包装模式（_enableWrap 未调用时的降级行为）
      if (finalStatus === 204) {
        captureResponse(c.body(null));
        finishResponseSend(res, sendState);
        return;
      }

      captureResponse(c.json(data as object));
      finishResponseSend(res, sendState);
    },

    rawJson(data: unknown, status?: number): void {
      if (checkSent("rawJson")) return;

      let finalStatus = status ?? _status;
      _status = finalStatus;
      const sendState = beginResponseSend(res, {
        kind: "rawJson",
        data,
        status: finalStatus,
        headers: cloneHeaders(_headers),
        wrapped: false,
        requestId: getRequestId(),
      });
      data = sendState.data;
      finalStatus = sendState.status;
      _status = finalStatus;
      replaceHeaders(_headers, sendState.headers);
      c.status(finalStatus as any);
      applyHeaders();
      captureResponse(c.json(data as object));
      finishResponseSend(res, sendState);
    },

    text(content: string, status?: number): void {
      if (checkSent("text")) return;

      let finalStatus = status ?? _status;
      _status = finalStatus;
      const sendState = beginResponseSend(res, {
        kind: "text",
        data: content,
        status: finalStatus,
        headers: cloneHeaders(_headers),
        wrapped: false,
        requestId: getRequestId(),
      });
      content =
        typeof sendState.data === "string" ? sendState.data : String(content);
      finalStatus = sendState.status;
      _status = finalStatus;
      replaceHeaders(_headers, sendState.headers);
      c.status(finalStatus as any);
      // 先设默认 Content-Type: text/plain，再调 applyHeaders()
      // 让外部通过 setHeader("Content-Type", "text/html") 的设置能够覆盖默认值。
      // 最后用 c.body() 而非 c.text()：
      //   c.text() 会在内部强制重写 Content-Type: text/plain，
      //   导致 setHeader 设置的 text/html 被覆盖（/docs 页面显示为源码的根因）。
      //   c.body() 不干预 Content-Type，完全尊重已设置的头信息。
      c.header("Content-Type", "text/plain; charset=utf-8");
      applyHeaders();
      captureResponse(c.body(content));
      finishResponseSend(res, sendState);
    },

    _sendHtml(html, status, headers, kind, data): void {
      if (checkSent(kind)) return;

      let finalStatus = status ?? _status;
      _status = finalStatus;
      mergeHeaders(_headers, headers);
      const sendState = beginResponseSend(res, {
        kind,
        data: data ?? html,
        status: finalStatus,
        headers: cloneHeaders(_headers),
        wrapped: false,
        requestId: getRequestId(),
      });
      html = typeof sendState.data === "string" ? sendState.data : html;
      finalStatus = sendState.status;
      _status = finalStatus;
      replaceHeaders(_headers, sendState.headers);

      c.status(finalStatus as any);
      c.header("Content-Type", "text/html; charset=utf-8");
      applyHeaders();
      captureResponse(c.body(html));
      finishResponseSend(res, sendState);
    },

    render: renderUnavailable,

    renderError: renderErrorUnavailable,

    stream(
      readable: NodeJS.ReadableStream,
      contentType: string = "application/octet-stream",
    ): void {
      if (checkSent("stream")) return;

      const sendState = beginResponseSend(res, {
        kind: "stream",
        status: _status,
        headers: cloneHeaders(_headers),
        wrapped: false,
        requestId: getRequestId(),
      });
      _status = sendState.status;
      replaceHeaders(_headers, sendState.headers);

      c.status(_status as any);
      c.header("Content-Type", contentType);
      applyHeaders();
      finishResponseSendAfterStreamSettlement(res, sendState, readable);
      captureResponse(c.body(readable as any));
    },

    download(
      readable: NodeJS.ReadableStream,
      filename: string,
      contentType?: string,
    ): void {
      if (checkSent("download")) return;

      const ct = contentType ?? "application/octet-stream";
      const headers = cloneHeaders(_headers);
      setBufferedHeader(headers, "Content-Type", ct);
      setBufferedHeader(
        headers,
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      const sendState = beginResponseSend(res, {
        kind: "download",
        status: _status,
        headers,
        wrapped: false,
        requestId: getRequestId(),
      });
      _status = sendState.status;
      replaceHeaders(_headers, sendState.headers);
      c.status(_status as any);
      applyHeaders();
      finishResponseSendAfterStreamSettlement(res, sendState, readable);
      captureResponse(c.body(readable as any));
    },

    redirect(url: string, status: 301 | 302 | 307 | 308 = 302): void {
      if (checkSent("redirect")) return;

      const headers = cloneHeaders(_headers);
      setBufferedHeader(headers, "Location", url);
      const sendState = beginResponseSend(res, {
        kind: "redirect",
        data: url,
        status,
        headers,
        wrapped: false,
        requestId: getRequestId(),
      });
      _status = sendState.status;
      replaceHeaders(_headers, sendState.headers);
      c.status(_status as any);
      applyHeaders();
      captureResponse(c.body(null));
      finishResponseSend(res, sendState);
    },

    status(code: number): VextResponse {
      _status = code;
      return res;
    },

    setHeader(name: string, value: VextHeaderValue): VextResponse {
      setBufferedHeader(_headers, name, value);
      return res;
    },

    cookie(name, value, options): VextResponse {
      appendSetCookie(_headers, serializeCookie(name, value, options));
      return res;
    },

    clearCookie(name, options): VextResponse {
      appendSetCookie(_headers, serializeClearCookie(name, options));
      return res;
    },

    get statusCode(): number {
      return _status;
    },

    _enableWrap(): void {
      _wrapEnabled = true;
    },

    _isSent(): boolean {
      return _sent;
    },
  };

  return res;
}

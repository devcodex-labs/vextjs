import path from "node:path";
import type { VextErrorMiddleware } from "../../types/middleware.js";
import type { VextResponseConfig, VextLogger } from "../../types/app.js";
import type { VextInternalHooks } from "../../types/hooks.js";
import { normalizeErrorForResponse } from "../error-response.js";
import { isInternalHooks } from "../hooks.js";
import { VEXT_PAGE_MEDIA_TYPE } from "../../frontend/contract/page-envelope.js";

/**
 * DevOverlayFn — Dev 错误覆盖层渲染函数
 *
 * 接受原始错误，返回 HTML 字符串。
 * 由 dev-bootstrap 在注入时通过闭包绑定 projectRoot 和 overlayOptions。
 * error-handler.ts 不直接依赖 error-overlay.ts（避免生产 bundle 引入 dev 代码）。
 */
export type DevOverlayFn = (err: unknown) => string;

/**
 * createErrorHandler — 全局错误处理中间件工厂
 *
 * 内置中间件 #6（通过 adapter.registerErrorHandler() 注册），职责：
 *   捕获中间件链中抛出的所有错误，按类型格式化为统一的 JSON 错误响应。
 *
 * 三层错误匹配规则（按优先级）：
 *
 *   1. VextValidationError（422 Validation Failed）
 *      由 validate 中间件在 schema 校验失败时抛出。
 *      响应：{ code: 422, message: 'Validation failed', errors: [...], requestId }
 *      errors 数组包含每个字段的错误描述：[{ field: 'email', message: '...' }]
 *
 *   2. HttpError（4xx / 5xx 业务错误）
 *      由 app.throw() 或用户代码 throw new HttpError(...) 抛出。
 *      响应：{ code, message, requestId }
 *      code 取值优先级：err.code（业务错误码）> err.status（HTTP 状态码）
 *      这意味着如果用户传入了业务码（如 10001），响应的 code 就是 10001；
 *      否则 code 等于 HTTP 状态码（如 404）。
 *
 *   3. 未知错误（500 Internal Server Error）
 *      所有不属于上述两类的错误（运行时异常、第三方库异常等）。
 *      响应：{ code: 500, message: 'Internal Server Error', requestId }
 *      生产环境（hideInternalErrors = true）隐藏 stack trace，
 *      开发环境（hideInternalErrors = false）附带 stack 供调试。
 *
 * Dev 错误覆盖层（可选 devOverlay 参数）：
 *   当 devOverlay 已注入且请求 Accept 包含 'text/html' 时，
 *   返回 HTML 错误覆盖层而非 JSON。适用于浏览器直接访问出错路由的场景。
 *   devOverlay 渲染失败时，自动降级到 JSON 处理。
 *
 * 工厂函数设计（Q21）：
 *   使用工厂模式 createErrorHandler(config) 而非直接引用 app.config，
 *   原因是错误处理器需要持有 config 引用但不应直接依赖 app 对象。
 *   工厂函数在 bootstrap 时调用一次，返回的闭包通过闭包变量持有 config，
 *   解决了作用域和生命周期问题。
 *
 * 注册方式（在 bootstrap 中）：
 *   app.adapter.registerErrorHandler(
 *     createErrorHandler(config.response ?? {}, undefined, app.logger)
 *   )
 *
 * 与 rawJson 的关系：
 *   错误响应始终使用 res.rawJson()，绕过出口包装（response-wrapper）。
 *   这确保错误响应格式为 { code, message, requestId } 而非被二次包装为
 *   { code: 0, data: { code, message, ... }, requestId }。
 *
 * 日志记录（可选 logger 参数）：
 *   当 logger 传入时，error-handler 负责在响应格式决策之前记录日志：
 *     - 未知错误（500）：logger.error({ err }, '[uncaught] ...')（含 stack trace）
 *     - HttpError 5xx：logger.error('[http-error] status message')
 *     - HttpError 4xx：logger.warn(...)（需 logErrors.http4xx = true 开启）
 *     - VextValidationError：不记录（客户端输入问题）
 *   日志记录先于 devOverlay 判断，确保无论响应格式如何日志都可见。
 *   不传 logger 时行为与原来完全一致（向后兼容）。
 *
 * @param responseConfig 响应配置（从 VextConfig.response 提取）
 * @param devOverlay     可选：dev 模式错误覆盖层渲染函数（生产模式不传）
 * @param logger         可选：VextLogger 实例，传入后自动记录错误日志
 * @returns VextErrorMiddleware
 */
export function createErrorHandler(
  responseConfig: VextResponseConfig,
  devOverlay?: DevOverlayFn,
  logger?: VextLogger,
  hooks?: VextInternalHooks,
): VextErrorMiddleware {
  // 是否隐藏内部错误详情（生产环境默认 true）
  // 当 hideInternalErrors = true 时，500 错误不暴露 stack trace，
  // 防止敏感信息泄漏（如文件路径、依赖版本、SQL 语句等）
  const hideInternalErrors = responseConfig.hideInternalErrors ?? true;
  const logErrors = responseConfig.logErrors;

  return (err: unknown, req, res) => {
    const activeHooks = isInternalHooks(hooks) ? hooks : undefined;
    // ── Step 0: 错误归一化（统一为 Error 对象，消除后续重复转换）──
    //
    // 非 Error 对象（如 throw "string" / throw null）统一包装为 Error。
    // 后续所有步骤直接使用 errObj，避免重复 `err instanceof Error ? err : new Error(...)`.
    //
    const errObj = err instanceof Error ? err : new Error(String(err));

    // ── Step 1: 日志记录（先于响应格式决策，确保任何路径都能记录）──
    //
    // 关键设计：日志前置于 devOverlay 判断。
    // 原因：devOverlay 触发时会提前 return，若日志在其后则 browser 访问场景日志丢失。
    // 日志记录（side effect）与响应格式（HTML/JSON）正交，互不影响。
    //
    // try-catch 保护：logger 可能是用户通过 setLogger() 注入的自定义实现，
    // 若 logger 自身抛出异常，不能让 error-handler（最后防线）崩溃，否则请求会挂起。
    //
    // 使用 .name 字符串检测替代 instanceof：
    // 防止 CJS/ESM 双包场景下 instanceof 失败（与 Step 2 devOverlay 保持一致）。
    //
    if (logger) {
      try {
        if (errObj.name === "VextValidationError") {
          // 校验错误属于客户端输入问题，不记录日志
        } else if (
          errObj.name === "HttpError" &&
          typeof (errObj as unknown as Record<string, unknown>).status ===
            "number"
        ) {
          const status = (errObj as unknown as Record<string, unknown>)
            .status as number;
          if (status >= 500 && logErrors?.http5xx !== false) {
            logger.error(`[http-error] ${status} ${errObj.message}`);
          } else if (status < 500 && logErrors?.http4xx === true) {
            logger.warn(`[http-error] ${status} ${errObj.message}`);
          }
        } else {
          // 未知错误（运行时异常、第三方库异常等）
          if (logErrors?.unknownErrors !== false) {
            logger.error({ err: errObj }, `[uncaught] ${errObj.message}`);
          }
        }
      } catch {
        // logger 自身异常，静默忽略（error-handler 是最后防线，不能崩溃）
      }
    }

    // ── Step 2: Dev 错误覆盖层：浏览器请求 + dev overlay 已注入 ────
    //
    // 触发条件：
    //   1. devOverlay 函数已注入（仅 dev 模式）
    //   2. 请求 Accept 包含 'text/html'（浏览器特征）
    // API 客户端（curl/axios/fetch）的 Accept 不含 text/html，不受影响。
    //
    if (devOverlay) {
      const accept = (req.headers["accept"] as string | undefined) ?? "";
      if (accept.includes("text/html")) {
        // 计算正确的 HTTP 状态码
        // 使用 error.name 字符串检测替代 instanceof，防止 CJS/ESM 双包 instanceof 失败
        let statusCode = 500;
        if (errObj.name === "VextValidationError") {
          statusCode = 422;
        } else if (
          errObj.name === "HttpError" &&
          typeof (errObj as unknown as Record<string, unknown>).status ===
            "number"
        ) {
          statusCode = (errObj as unknown as Record<string, unknown>)
            .status as number;
        }

        try {
          const html = devOverlay(err);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.text(html, statusCode);
          return;
        } catch {
          // overlay 渲染失败 → fallback 到 JSON（继续执行下方逻辑）
        }
      }
    }

    const requestId = req.requestId;
    if (shouldRenderHtmlError(req) && typeof res.renderError === "function") {
      try {
        res.renderError(errObj, {
          expose: hideInternalErrors === false,
        });
        return;
      } catch {
        // renderError 不可用或前端产物缺失时，继续降级到 JSON 错误响应。
      }
    }

    const normalized = normalizeErrorForResponse(err, {
      requestId,
      hideInternalErrors,
    });
    const prepared = prepareErrorResponse(
      activeHooks,
      normalized.error,
      requestId,
      normalized.status,
      normalized.body,
    );
    res.rawJson(prepared.body, prepared.status);
    emitErrorAfterResponse(
      activeHooks,
      normalized.error,
      prepared.status,
      requestId,
    );
  };
}

function shouldRenderHtmlError(
  req: Parameters<VextErrorMiddleware>[1],
): boolean {
  if (!acceptsRenderedPage(req.headers.accept)) return false;
  const pathname = safePathname(req.path || req.url || "/");
  if (path.extname(pathname)) return false;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  return true;
}

function acceptsRenderedPage(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) return false;
  return acceptHeader
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\s+/gu, ""))
    .some(
      (type) =>
        type.split(";")[0] === "text/html" || type === VEXT_PAGE_MEDIA_TYPE,
    );
}

function safePathname(value: string): string {
  const raw = value.split("?")[0] || "/";
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
  } catch {
    return "/";
  }
}

function prepareErrorResponse(
  hooks: VextInternalHooks | undefined,
  error: Error,
  requestId: string,
  status: number,
  body: Record<string, unknown>,
): { status: number; body: Record<string, unknown> } {
  const patch = hooks?.emitSafeSync("error:beforeResponse", {
    error,
    status,
    body,
    requestId,
  });

  return {
    status: patch?.status ?? status,
    body: patch?.body ?? body,
  };
}

function emitErrorAfterResponse(
  hooks: VextInternalHooks | undefined,
  error: Error,
  status: number,
  requestId: string,
): void {
  hooks?.emitSafeSync("error:afterResponse", {
    error,
    status,
    requestId,
  });
}

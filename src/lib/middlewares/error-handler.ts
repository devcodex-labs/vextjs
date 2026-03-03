import type { VextErrorMiddleware } from "../../types/middleware.js";
import type { VextResponseConfig } from "../../types/app.js";
import { HttpError, VextValidationError } from "../../types/errors.js";

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
 * 工厂函数设计（Q21）：
 *   使用工厂模式 createErrorHandler(config) 而非直接引用 app.config，
 *   原因是错误处理器需要持有 config 引用但不应直接依赖 app 对象。
 *   工厂函数在 bootstrap 时调用一次，返回的闭包通过闭包变量持有 config，
 *   解决了作用域和生命周期问题。
 *
 * 注册方式（在 bootstrap 中）：
 *   app.adapter.registerErrorHandler(createErrorHandler(config.response))
 *
 * 与 rawJson 的关系：
 *   错误响应始终使用 res.rawJson()，绕过出口包装（response-wrapper）。
 *   这确保错误响应格式为 { code, message, requestId } 而非被二次包装为
 *   { code: 0, data: { code, message, ... }, requestId }。
 *
 * 日志记录：
 *   本中间件仅负责格式化错误响应，不负责日志记录。
 *   日志由调用方（adapter 的 try-catch）或上层中间件负责。
 *   这遵循单一职责原则——错误格式化与错误日志分离。
 *
 * @param responseConfig 响应配置（从 VextConfig.response 提取）
 * @returns VextErrorMiddleware
 */
export function createErrorHandler(
  responseConfig: VextResponseConfig,
): VextErrorMiddleware {
  // 是否隐藏内部错误详情（生产环境默认 true）
  // 当 hideInternalErrors = true 时，500 错误不暴露 stack trace，
  // 防止敏感信息泄漏（如文件路径、依赖版本、SQL 语句等）
  const hideInternalErrors = responseConfig.hideInternalErrors ?? true;

  return (err: unknown, req, res) => {
    const requestId = req.requestId;

    // ── 层 1：校验错误（422）────────────────────────────
    //
    // VextValidationError 由 validate 中间件在 schema 校验失败时抛出。
    // 携带 errors 数组，每个元素描述一个字段的校验错误。
    // HTTP 状态码固定为 422 Unprocessable Entity。
    //
    if (err instanceof VextValidationError) {
      res.rawJson(
        {
          code: 422,
          message: err.message,
          errors: err.errors, // [{ field: 'email', message: '邮箱格式不正确' }]
          requestId,
        },
        422,
      );
      return;
    }

    // ── 层 2：HTTP 业务错误（app.throw 抛出）─────────────
    //
    // HttpError 由 app.throw() 或 createDefaultThrow() 创建。
    // status: HTTP 状态码（4xx / 5xx）
    // message: 错误描述（可能是 i18n 翻译后的文本）
    // code: 业务错误码（可选，不传则 code = status）
    //
    // 响应的 code 字段优先使用业务错误码（err.code），
    // 没有业务码时降级使用 HTTP 状态码（err.status）。
    // 这样 API 消费方可以通过 code 区分具体的业务错误类型。
    //
    if (err instanceof HttpError) {
      res.rawJson(
        {
          code: err.code ?? err.status, // 有业务码用业务码，否则用 HTTP 状态码
          message: err.message,
          requestId,
        },
        err.status,
      );
      return;
    }

    // ── 层 3：未知错误（500）─────────────────────────────
    //
    // 所有非 VextValidationError / HttpError 的错误走此分支。
    // 包括：运行时 TypeError / ReferenceError、第三方库异常、
    // 数据库连接失败等。
    //
    // 生产环境隐藏内部细节（安全性）：
    //   - message 固定为 'Internal Server Error'
    //   - 不暴露 stack trace、错误详情、文件路径等
    //
    // 开发环境显示 stack（调试便利性）：
    //   - 附带 stack 字段，开发者可快速定位错误位置
    //
    const errorObj = err instanceof Error ? err : new Error(String(err));

    const body: Record<string, unknown> = {
      code: 500,
      message: "Internal Server Error",
      requestId,
    };

    // 开发环境：附带 stack trace 供调试
    if (!hideInternalErrors) {
      body.stack = errorObj.stack;
    }

    res.rawJson(body, 500);
  };
}

/**
 * HttpError — 框架 HTTP 错误类
 *
 * 所有通过 app.throw() 抛出的错误最终都会被包装为 HttpError。
 * 全局错误处理中间件捕获后格式化为统一错误响应：
 *   { code, message, requestId }
 *
 * 设计说明：
 *   - status: HTTP 状态码（400/401/403/404/409/500…）
 *   - message: 错误描述（可能是 i18n 翻译后的文本）
 *   - code: 业务错误码（可选；不传则响应 code = status；传入则响应 code = bizCode）
 *
 * 业务错误码优先级：
 *   用户显式传入 code > locale 配置中的 code > 默认使用 status
 *
 * @example
 * throw new HttpError(404, 'User not found')
 * // → { code: 404, message: 'User not found', requestId: '...' }
 *
 * @example
 * throw new HttpError(400, '邮箱已注册', 10001)
 * // → { code: 10001, message: '邮箱已注册', requestId: '...' }
 */
export class HttpError extends Error {
  public override readonly name = "HttpError" as const;

  constructor(
    /** HTTP 状态码 */
    public readonly status: number,
    /** 错误描述 */
    message: string,
    /** 业务错误码（可选；不传则 code = status；支持 number 或 string） */
    public readonly code?: number | string,
  ) {
    super(message);

    // 确保 instanceof 检查在继承链中正常工作
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 校验错误中的单个字段错误描述
 */
export interface VextValidationFieldError {
  /** 字段名称 */
  field: string;

  /** 错误描述 */
  message: string;
}

/**
 * VextValidationError — 参数校验失败错误
 *
 * 当 validate 中间件校验请求参数失败时抛出此错误。
 * 全局错误处理中间件捕获后格式化为 422 响应：
 *   { code: 422, message: 'Validation failed', errors: [...], requestId: '...' }
 *
 * @example
 * throw new VextValidationError([
 *   { field: 'email', message: '邮箱格式不正确' },
 *   { field: 'age', message: '年龄必须大于 0' },
 * ])
 */
export class VextValidationError extends Error {
  public override readonly name = "VextValidationError" as const;
  public readonly status = 422;

  constructor(
    /** 校验失败的字段错误列表 */
    public readonly errors: VextValidationFieldError[],
    /** 错误消息（默认 'Validation failed'） */
    message: string = "Validation failed",
  ) {
    super(message);

    // 确保 instanceof 检查在继承链中正常工作
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

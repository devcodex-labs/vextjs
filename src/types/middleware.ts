import type { VextRequest } from "./request.js";
import type { VextResponse } from "./response.js";
import type {
  VextDefaultValidatedData,
  VextValidatedData,
} from "./validation.js";

/**
 * 标准中间件函数
 *
 * 洋葱模型：调用 await next() 执行下一个中间件，
 * next() 返回后可执行 after-middleware 逻辑。
 *
 * @example
 * const timing: VextMiddleware = async (req, res, next) => {
 *   const start = Date.now()
 *   await next()
 *   const ms = Date.now() - start
 *   res.setHeader('X-Response-Time', `${ms}ms`)
 * }
 */
export type VextMiddleware = (
  req: VextRequest,
  res: VextResponse,
  next: () => Promise<void>,
) => Promise<void> | void;

/**
 * 错误处理中间件
 *
 * 全局错误处理器，由 adapter.registerErrorHandler() 注册。
 * 捕获中间件链中抛出的所有错误，格式化为统一错误响应。
 *
 * @example
 * const errorHandler: VextErrorMiddleware = (err, req, res) => {
 *   if (err instanceof HttpError) {
 *     res.rawJson({ code: err.status, message: err.message, requestId: req.requestId }, err.status)
 *   }
 * }
 */
export type VextErrorMiddleware = (
  err: unknown,
  req: VextRequest,
  res: VextResponse,
) => void;

/**
 * 路由处理函数
 *
 * 路由三段式的第三个参数，接收封装后的 req/res 对象。
 * handler 中通过闭包访问 app（defineRoutes(app => ...)），
 * 业务逻辑委托给 service 层。
 *
 * @example
 * const handler: VextHandler = async (req, res) => {
 *   const users = await req.app.services.user.findAll()
 *   res.json(users)
 * }
 */
export type VextHandler<
  TValidated extends VextValidatedData = VextDefaultValidatedData,
> = (req: VextRequest<TValidated>, res: VextResponse) => Promise<void> | void;

/**
 * Symbol 标记，用于 defineMiddleware/defineMiddlewareFactory 标识
 * middleware-loader 通过此标记进行类型检测
 */
export const MIDDLEWARE_SYMBOL = Symbol.for("vext.middleware");
export const MIDDLEWARE_FACTORY_SYMBOL = Symbol.for("vext.middleware.factory");

/**
 * 经过 defineMiddleware 标记的中间件对象
 */
export interface VextDefinedMiddleware {
  readonly [MIDDLEWARE_SYMBOL]: true;
  readonly handler: VextMiddleware;
}

/**
 * 经过 defineMiddlewareFactory 标记的中间件工厂
 *
 * 工厂函数接收配置参数，返回 VextMiddleware 实例。
 * 用于需要运行时配置的中间件（如 auth({ role: 'admin' })）。
 */
export interface VextMiddlewareFactory<TOptions = unknown> {
  readonly [MIDDLEWARE_FACTORY_SYMBOL]: true;
  (options?: TOptions): VextMiddleware;
}

/**
 * 中间件模块导出类型
 * middleware-loader 扫描 src/middlewares/ 时期望的 default export 类型
 */
export type VextMiddlewareExport =
  | VextDefinedMiddleware
  | VextMiddlewareFactory;

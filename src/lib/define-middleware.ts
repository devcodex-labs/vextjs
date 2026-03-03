import type {
  VextMiddleware,
  VextMiddlewareFactory,
} from "../types/middleware.js";

/**
 * define-middleware.ts — 中间件定义辅助函数 + 类型检测
 *
 * 提供 defineMiddleware / defineMiddlewareFactory 两个辅助函数，
 * 用于显式标记中间件类型（普通中间件 vs 工厂中间件）。
 *
 * 为什么需要显式标记？
 *   之前的设计靠 `finalOptions !== undefined` 判断是工厂还是普通中间件，
 *   当工厂以字符串声明（无 options）时会误判为普通中间件，
 *   导致将工厂函数本身当作中间件执行（运行时报错或行为异常）。
 *   defineMiddleware / defineMiddlewareFactory 通过 Symbol 标记让作者意图显式化，
 *   middleware-loader 检测零歧义。
 *
 * Symbol 标记方案：
 *   使用 Symbol.for() 而非 Symbol()，确保跨模块边界时标记一致。
 *   types/middleware.ts 中已定义 MIDDLEWARE_SYMBOL / MIDDLEWARE_FACTORY_SYMBOL，
 *   这里导入并使用它们作为标记值。
 *
 * 用户使用方式：
 *   ```typescript
 *   // 普通中间件（无配置参数）
 *   import { defineMiddleware } from 'vextjs'
 *   export default defineMiddleware(async (req, res, next) => {
 *     const token = req.headers['authorization']
 *     if (!token) req.app.throw(401, 'Unauthorized')
 *     await next()
 *   })
 *
 *   // 工厂中间件（接收配置参数）
 *   import { defineMiddlewareFactory } from 'vextjs'
 *   export default defineMiddlewareFactory<{ roles: string[] }>((options) => {
 *     return async (req, res, next) => {
 *       if (!options.roles.includes(req.user?.role)) {
 *         req.app.throw(403, 'Forbidden')
 *       }
 *       await next()
 *     }
 *   })
 *   ```
 *
 * 框架内部使用（middleware-loader）：
 *   ```typescript
 *   import { isMiddleware, isMiddlewareFactory } from './define-middleware.js'
 *
 *   if (isMiddlewareFactory(handler)) {
 *     // 是工厂，需要传入 options 调用
 *     const middleware = handler(options)
 *   } else if (isMiddleware(handler)) {
 *     // 是普通中间件，直接使用
 *   }
 *   ```
 *
 * @module lib/define-middleware
 * @see IMPLEMENTATION-PLAN.md 任务 1.11
 * @see 01b-middlewares.md §4.3（defineMiddleware / defineMiddlewareFactory 实现）
 */

import {
  MIDDLEWARE_SYMBOL,
  MIDDLEWARE_FACTORY_SYMBOL,
} from "../types/middleware.js";

// ── 标记后的类型定义 ────────────────────────────────────────

/**
 * 经过 defineMiddleware 标记的中间件函数
 *
 * 在原始 VextMiddleware 基础上附加 __tag Symbol 标记，
 * middleware-loader 通过 isMiddleware() 检测此标记。
 */
export type TaggedMiddleware = VextMiddleware & {
  readonly __tag: typeof MIDDLEWARE_SYMBOL;
};

/**
 * 经过 defineMiddlewareFactory 标记的中间件工厂函数
 *
 * 在原始工厂函数基础上附加 __tag Symbol 标记，
 * middleware-loader 通过 isMiddlewareFactory() 检测此标记。
 */
export type TaggedMiddlewareFactory<TOptions = unknown> = ((
  options?: TOptions,
) => VextMiddleware) & {
  readonly __tag: typeof MIDDLEWARE_FACTORY_SYMBOL;
};

// ── 定义函数 ────────────────────────────────────────────────

/**
 * defineMiddleware — 标记一个函数为普通中间件
 *
 * 普通中间件不接受配置参数，直接作为 VextMiddleware 使用。
 * 在 config/default.ts 的 middlewares 白名单中以字符串声明：
 *   middlewares: ['auth']
 *
 * @param fn 中间件函数（VextMiddleware 签名）
 * @returns 带 __tag 标记的中间件函数
 *
 * @example
 * ```typescript
 * import { defineMiddleware } from 'vextjs'
 *
 * export default defineMiddleware(async (req, res, next) => {
 *   const token = req.headers['authorization']
 *   if (!token) req.app.throw(401, 'Unauthorized')
 *   req.user = verifyToken(token)
 *   await next()
 * })
 * ```
 */
export function defineMiddleware(fn: VextMiddleware): TaggedMiddleware {
  const tagged = fn as TaggedMiddleware;
  (tagged as { __tag: symbol }).__tag = MIDDLEWARE_SYMBOL;
  return tagged;
}

/**
 * defineMiddlewareFactory — 标记一个函数为中间件工厂
 *
 * 工厂中间件接受配置参数，调用后返回 VextMiddleware 实例。
 * 参数优先级：路由 options 覆盖值 > config/default.ts 默认值。
 *
 * 在 config/default.ts 的 middlewares 白名单中以对象声明（带默认参数）：
 *   middlewares: [{ name: 'check-role', options: { roles: ['admin'] } }]
 *
 * 路由引用时可覆盖参数：
 *   middlewares: [{ name: 'check-role', options: { roles: ['user'] } }]
 *
 * @param factory 中间件工厂函数，接收 options 返回 VextMiddleware
 * @returns 带 __tag 标记的工厂函数
 *
 * @example
 * ```typescript
 * import { defineMiddlewareFactory } from 'vextjs'
 *
 * export default defineMiddlewareFactory<{ roles: string[] }>((options) => {
 *   return async (req, res, next) => {
 *     const userRole = (req as any).user?.role
 *     if (!options?.roles?.includes(userRole)) {
 *       req.app.throw(403, 'Forbidden')
 *     }
 *     await next()
 *   }
 * })
 * ```
 */
export function defineMiddlewareFactory<TOptions = unknown>(
  factory: (options?: TOptions) => VextMiddleware,
): TaggedMiddlewareFactory<TOptions> {
  const tagged = factory as TaggedMiddlewareFactory<TOptions>;
  (tagged as { __tag: symbol }).__tag = MIDDLEWARE_FACTORY_SYMBOL;
  return tagged;
}

// ── 类型检测函数（框架内部使用）────────────────────────────

/**
 * isMiddleware — 检测一个值是否为经过 defineMiddleware 标记的中间件
 *
 * middleware-loader 在加载用户中间件文件后调用此函数，
 * 判断 default export 的类型。
 *
 * @param fn 待检测的值
 * @returns true 表示是普通中间件
 */
export function isMiddleware(fn: unknown): fn is TaggedMiddleware {
  return (
    typeof fn === "function" &&
    (fn as unknown as Record<string, unknown>).__tag === MIDDLEWARE_SYMBOL
  );
}

/**
 * isMiddlewareFactory — 检测一个值是否为经过 defineMiddlewareFactory 标记的工厂
 *
 * middleware-loader 在加载用户中间件文件后调用此函数，
 * 判断 default export 的类型。
 *
 * @param fn 待检测的值
 * @returns true 表示是中间件工厂
 */
export function isMiddlewareFactory(
  fn: unknown,
): fn is TaggedMiddlewareFactory {
  return (
    typeof fn === "function" &&
    (fn as unknown as Record<string, unknown>).__tag ===
      MIDDLEWARE_FACTORY_SYMBOL
  );
}

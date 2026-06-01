import { createNativeAdapter } from "./adapter.js";
import type { NativeAdapterOptions } from "./adapter.js";
import type { VextAdapter } from "../../types/adapter.js";
import type { VextApp } from "../../types/app.js";

/**
 * Native Adapter 导出入口
 *
 * 提供 nativeAdapter() 工厂函数，用户通过此函数创建 Native 适配器实例。
 * 是 VextAdapter 接口的第五个实现（Hono → Fastify → Express → Koa → Native），
 * 也是唯一不依赖第三方 HTTP 框架的实现。
 *
 * 基于 Node.js 原生 http.createServer + route-core（轻量路由核心），
 * 跳过所有第三方框架的初始化、对象包装、中间件管道等开销，
 * 是 vext 的最高性能适配器选项。
 *
 * 使用方式（在用户项目的 src/config/default.ts 中）：
 *
 *   ```typescript
 *   // 方式 1: 零配置（推荐）
 *   import { nativeAdapter } from 'vextjs/adapters/native'
 *   export default {
 *     adapter: nativeAdapter(),
 *   }
 *
 *   // 方式 2: 自定义选项
 *   import { nativeAdapter } from 'vextjs/adapters/native'
 *   export default {
 *     adapter: nativeAdapter({ maxParamLength: 1000 }),
 *   }
 *
 *   // 方式 3: 字符串标识（零 import，最简）
 *   export default {
 *     adapter: 'native',
 *   }
 *   ```
 *
 * 内置注册方式（adapter-resolver.ts 中）：
 *   adapter-resolver 将 'native' 字符串映射到此工厂函数，
 *   用户可在配置中使用 adapter: 'native'（零 import）。
 *
 * @module adapters/native
 * @see adapters/fastify/index.ts（Fastify Adapter 导出入口）
 * @see adapters/express/index.ts（Express Adapter 导出入口）
 * @see adapters/koa/index.ts（Koa Adapter 导出入口）
 * @see adapters/hono/index.ts（Hono Adapter 导出入口）
 */

// ── 类型导出 ────────────────────────────────────────────────

export type { NativeAdapterOptions } from "./adapter.js";

// ── 工厂函数 ────────────────────────────────────────────────

/**
 * nativeAdapter — 创建 Native 适配器工厂函数
 *
 * 返回一个「延迟工厂」函数，该函数在 adapter-resolver 调用时
 * 接收 VextApp 实例并创建完整的 VextAdapter。
 *
 * 这种两阶段初始化设计与 adapter-resolver 的工作方式对齐：
 *   1. 用户调用 nativeAdapter(options) → 返回工厂函数（捕获 options）
 *   2. adapter-resolver 调用 factory(app) → 返回 VextAdapter 实例
 *
 * @param options Native 适配器选项（可选）
 * @returns 适配器工厂函数 (app: VextApp) => VextAdapter
 *
 * @example
 * // 内置方式（config.adapter = 'native'，零 import）
 * export default { adapter: 'native' }
 *
 * @example
 * // 工厂方式（自定义选项）
 * import { nativeAdapter } from 'vextjs/adapters/native'
 * export default { adapter: nativeAdapter({ maxParamLength: 1000 }) }
 *
 * @example
 * // 零配置工厂（等价于 'native' 字符串，但可后续添加选项）
 * import { nativeAdapter } from 'vextjs/adapters/native'
 * export default { adapter: nativeAdapter() }
 */
export function nativeAdapter(
  options?: NativeAdapterOptions,
): (app: VextApp) => VextAdapter {
  const opts = options ?? {};

  return (app: VextApp): VextAdapter => {
    return createNativeAdapter(opts, app);
  };
}

/**
 * createNativeAdapterDirect — 直接创建 Native Adapter（内部使用）
 *
 * 供 adapter-resolver 的 BUILT_IN_ADAPTERS 映射表使用。
 * 不暴露给用户（用户应使用 nativeAdapter() 工厂函数）。
 *
 * @internal
 */
export { createNativeAdapter } from "./adapter.js";

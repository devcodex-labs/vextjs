import { createKoaAdapter } from "./adapter.js";
import type { KoaAdapterOptions } from "./adapter.js";
import type { VextAdapter } from "../../types/adapter.js";
import type { VextApp } from "../../types/app.js";

/**
 * Koa Adapter 导出入口
 *
 * 提供 koaAdapter() 工厂函数，用户通过此函数创建 Koa 适配器实例。
 * 是 VextAdapter 接口的第四个实现（Hono → Fastify → Express → Koa），
 * 用于验证 Adapter 抽象层的完备性和通用性。
 *
 * 使用方式（在用户项目的 src/config/default.ts 中）：
 *
 *   ```typescript
 *   // 方式 1: 零配置（推荐）
 *   import { koaAdapter } from 'vextjs/adapters/koa'
 *   export default {
 *     adapter: koaAdapter(),
 *   }
 *
 *   // 方式 2: 自定义选项
 *   import { koaAdapter } from 'vextjs/adapters/koa'
 *   export default {
 *     adapter: koaAdapter({ bodyLimit: '5mb' }),
 *   }
 *   ```
 *
 * 内置注册方式（adapter-resolver.ts 中）：
 *   adapter-resolver 将 'koa' 字符串映射到此工厂函数，
 *   用户可在配置中使用 adapter: 'koa'（零 import）。
 *
 * @module adapters/koa
 * @see adapters/hono/index.ts（Hono Adapter 导出入口）
 * @see adapters/fastify/index.ts（Fastify Adapter 导出入口）
 * @see adapters/express/index.ts（Express Adapter 导出入口）
 */

// ── 类型导出 ────────────────────────────────────────────────

export type { KoaAdapterOptions } from "./adapter.js";

// ── 工厂函数 ────────────────────────────────────────────────

/**
 * koaAdapter — 创建 Koa 适配器工厂函数
 *
 * 返回一个「延迟工厂」函数，该函数在 adapter-resolver 调用时
 * 接收 VextApp 实例并创建完整的 VextAdapter。
 *
 * 这种两阶段初始化设计与 adapter-resolver 的工作方式对齐：
 *   1. 用户调用 koaAdapter(options) → 返回工厂函数（捕获 options）
 *   2. adapter-resolver 调用 factory(app) → 返回 VextAdapter 实例
 *
 * @param options Koa 适配器选项（可选）
 * @returns 适配器工厂函数 (app: VextApp) => VextAdapter
 *
 * @example
 * // 内置方式（config.adapter = 'koa'，零 import）
 * export default { adapter: 'koa' }
 *
 * @example
 * // 工厂方式（自定义选项）
 * import { koaAdapter } from 'vextjs/adapters/koa'
 * export default { adapter: koaAdapter({ bodyLimit: '5mb' }) }
 */
export function koaAdapter(
  options?: KoaAdapterOptions,
): (app: VextApp) => VextAdapter {
  const opts = options ?? {};

  return (app: VextApp): VextAdapter => {
    return createKoaAdapter(opts, app);
  };
}

/**
 * createKoaAdapterDirect — 直接创建 Koa Adapter（内部使用）
 *
 * 供 adapter-resolver 的 BUILT_IN_ADAPTERS 映射表使用。
 * 不暴露给用户（用户应使用 koaAdapter() 工厂函数）。
 *
 * @internal
 */
export { createKoaAdapter } from "./adapter.js";

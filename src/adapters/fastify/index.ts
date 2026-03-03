import { createFastifyAdapter } from "./adapter.js";
import type { FastifyAdapterOptions } from "./adapter.js";
import type { VextAdapter } from "../../types/adapter.js";
import type { VextApp } from "../../types/app.js";

/**
 * Fastify Adapter 导出入口
 *
 * 提供 fastifyAdapter() 工厂函数，用户通过此函数创建 Fastify 适配器实例。
 * 是 VextAdapter 接口的第二个实现（第一个是内置的 Hono Adapter），
 * 用于验证 Adapter 抽象层的完备性。
 *
 * 使用方式（在用户项目的 src/config/default.ts 中）：
 *
 *   ```typescript
 *   // 方式 1: 零配置（推荐）
 *   import { fastifyAdapter } from 'vextjs/adapters/fastify'
 *   export default {
 *     adapter: fastifyAdapter(),
 *   }
 *
 *   // 方式 2: 自定义选项
 *   import { fastifyAdapter } from 'vextjs/adapters/fastify'
 *   export default {
 *     adapter: fastifyAdapter({ bodyLimit: 5 * 1024 * 1024 }),
 *   }
 *   ```
 *
 * 内置注册方式（adapter-resolver.ts 中）：
 *   adapter-resolver 将 'fastify' 字符串映射到此工厂函数，
 *   用户可在配置中使用 adapter: 'fastify'（零 import）。
 *
 * @module adapters/fastify
 * @see 08a-fastify-adapter.md（Fastify Adapter 详细设计文档）
 * @see IMPLEMENTATION-PLAN.md 任务 3.4
 */

// ── 类型导出 ────────────────────────────────────────────────

export type { FastifyAdapterOptions } from "./adapter.js";

// ── 工厂函数 ────────────────────────────────────────────────

/**
 * fastifyAdapter — 创建 Fastify 适配器工厂函数
 *
 * 返回一个「延迟工厂」函数，该函数在 adapter-resolver 调用时
 * 接收 VextApp 实例并创建完整的 VextAdapter。
 *
 * 这种两阶段初始化设计与 adapter-resolver 的工作方式对齐：
 *   1. 用户调用 fastifyAdapter(options) → 返回工厂函数（捕获 options）
 *   2. adapter-resolver 调用 factory(app) → 返回 VextAdapter 实例
 *
 * 但由于 adapter-resolver 对第三方 adapter 的处理方式是
 * 直接将 config.adapter 作为 VextAdapter 对象使用（validateAdapterInterface），
 * 而内置 adapter 通过 BUILT_IN_ADAPTERS 映射表（factory(app) 模式），
 *
 * 为同时支持两种使用方式：
 *   - 内置注册：adapter-resolver 中 BUILT_IN_ADAPTERS['fastify'] = (app) => createFastifyAdapter({}, app)
 *   - 用户直接传对象：config.adapter = fastifyAdapter() → 需要返回 VextAdapter
 *
 * 当用户调用 fastifyAdapter() 时，返回的不是最终的 VextAdapter，
 * 而是一个「带选项的工厂标记对象」。adapter-resolver 检测到此标记后，
 * 调用内部的 create(app) 方法完成初始化。
 *
 * 简化方案：直接返回一个 (app: VextApp) => VextAdapter 的工厂函数，
 * 由 adapter-resolver 统一处理。
 *
 * 实际上，为了最大兼容性，我们让 fastifyAdapter() 返回一个
 * 带 _vextAdapterFactory 标记的对象，adapter-resolver 检测到此标记
 * 后调用工厂函数创建 adapter。如果直接作为对象使用（旧版兼容），
 * 则通过 Proxy 延迟报错提示用户升级。
 *
 * 最终决策（简洁优先）：
 *   fastifyAdapter(options?) 返回一个工厂函数 (app: VextApp) => VextAdapter。
 *   adapter-resolver 中内置注册为 BUILT_IN_ADAPTERS['fastify']。
 *   用户也可以直接 config.adapter = fastifyAdapter() 方式使用，
 *   此时 adapter-resolver 会检测到它是函数类型并调用 fn(app)。
 *
 * @param options Fastify 适配器选项（可选）
 * @returns 适配器工厂函数 (app: VextApp) => VextAdapter
 *
 * @example
 * // 内置方式（config.adapter = 'fastify'，零 import）
 * export default { adapter: 'fastify' }
 *
 * @example
 * // 工厂方式（自定义选项）
 * import { fastifyAdapter } from 'vextjs/adapters/fastify'
 * export default { adapter: fastifyAdapter({ bodyLimit: 5 * 1024 * 1024 }) }
 */
export function fastifyAdapter(
  options?: FastifyAdapterOptions,
): (app: VextApp) => VextAdapter {
  const opts = options ?? {};

  return (app: VextApp): VextAdapter => {
    return createFastifyAdapter(opts, app);
  };
}

/**
 * createFastifyAdapterDirect — 直接创建 Fastify Adapter（内部使用）
 *
 * 供 adapter-resolver 的 BUILT_IN_ADAPTERS 映射表使用。
 * 不暴露给用户（用户应使用 fastifyAdapter() 工厂函数）。
 *
 * @internal
 */
export { createFastifyAdapter } from "./adapter.js";

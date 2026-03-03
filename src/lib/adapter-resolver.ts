import { createHonoAdapter } from '../adapters/hono/index.js'
import type { VextAdapter } from '../types/adapter.js'
import type { VextApp, VextConfig } from '../types/app.js'

/**
 * 内置 adapter 工厂映射表
 *
 * key: config.adapter 字符串标识
 * value: 工厂函数，接收 VextApp 返回 VextAdapter 实例
 *
 * 当前仅内置 Hono Adapter，后续可扩展其他内置 adapter。
 */
const BUILT_IN_ADAPTERS: Record<string, (app: VextApp) => VextAdapter> = {
  hono: createHonoAdapter,
}

/**
 * 解析 config.adapter 配置为 VextAdapter 实例
 *
 * 支持两种配置方式：
 *   1. 字符串标识 → 内置 adapter（如 'hono'）
 *   2. 对象实例 → 第三方 adapter（必须实现 VextAdapter 接口）
 *
 * 默认值：当 config.adapter 未配置时，使用 'hono'。
 *
 * @param config 框架运行时配置
 * @param app    应用实例（传给 adapter 工厂函数）
 * @returns VextAdapter 实例
 * @throws 配置值不合法或第三方 adapter 缺少必要方法时抛出错误
 *
 * @example
 * // 内置 adapter（字符串标识，零 import）
 * // config: { adapter: 'hono' }
 * const adapter = resolveAdapter(config, app)
 *
 * @example
 * // 第三方 adapter（需 import）
 * // config: { adapter: fastifyAdapter({ logger: true }) }
 * const adapter = resolveAdapter(config, app)
 */
export function resolveAdapter(config: VextConfig, app: VextApp): VextAdapter {
  const adapterConfig = config.adapter ?? 'hono'

  // 字符串 → 内置 adapter
  if (typeof adapterConfig === 'string') {
    const factory = BUILT_IN_ADAPTERS[adapterConfig]
    if (!factory) {
      throw new Error(
        `[vextjs] config.adapter "${adapterConfig}" is not a built-in adapter. ` +
        `Did you mean 'hono'?\n` +
        `         Built-in adapters: ${Object.keys(BUILT_IN_ADAPTERS).join(', ')}\n` +
        `         For third-party adapters, pass an adapter object instead of a string.`,
      )
    }
    return factory(app)
  }

  // 对象 → 第三方 adapter（必须满足 VextAdapter 接口）
  if (typeof adapterConfig === 'object' && adapterConfig !== null) {
    validateAdapterInterface(adapterConfig as VextAdapter)
    return adapterConfig as VextAdapter
  }

  throw new Error(
    `[vextjs] config.adapter must be a string (built-in) or an adapter object (third-party). ` +
    `Received: ${typeof adapterConfig}`,
  )
}

/**
 * 验证第三方 adapter 是否实现了 VextAdapter 接口的所有必要成员
 *
 * Fail Fast：启动时立即检查，避免运行时调用缺失方法导致难以排查的错误。
 *
 * @param adapter 待验证的 adapter 对象
 * @throws 缺少必要方法或属性时抛出描述性错误
 */
function validateAdapterInterface(adapter: unknown): asserts adapter is VextAdapter {
  const requiredMethods = [
    'registerRoute',
    'registerMiddleware',
    'registerErrorHandler',
    'registerNotFound',
    'listen',
    'buildHandler',
  ] as const

  const obj = adapter as Record<string, unknown>

  // 验证 name 属性（string 类型）
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    throw new Error(
      `[vextjs] Custom adapter is missing required property: "name" (must be a non-empty string).\n` +
      `         Adapter must implement the VextAdapter interface (see 08-adapter.md).`,
    )
  }

  // 验证所有必要方法
  for (const method of requiredMethods) {
    if (typeof obj[method] !== 'function') {
      throw new Error(
        `[vextjs] Custom adapter "${obj['name'] ?? 'unknown'}" is missing required method: "${method}".\n` +
        `         Expected: function, received: ${typeof obj[method]}.\n` +
        `         Adapter must implement the VextAdapter interface (see 08-adapter.md).`,
      )
    }
  }
}

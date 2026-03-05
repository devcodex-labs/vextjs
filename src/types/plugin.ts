import type { VextApp } from "./app.js";

/**
 * VextPlugin — 框架插件接口
 *
 * 插件是 vext 框架的唯一扩展入口。
 * 通过 plugin-loader 在启动时自动扫描 src/plugins/ 目录加载。
 *
 * 插件可以：
 *   - 向 app 挂载自定义属性（app.extend()）
 *   - 注册全局中间件（app.use()）
 *   - 注册优雅关闭钩子（app.onClose()）
 *   - 注册就绪钩子（app.onReady()）
 *   - 替换内置实现（app.setValidator() / app.setThrow() / app.setRateLimiter()）
 *
 * 生命周期：
 *   plugin-loader 按拓扑排序（基于 dependencies）依次执行 setup()。
 *   setup() 支持异步操作（如连接数据库），超时由 plugin-loader 控制。
 *
 * @example
 * // src/plugins/redis.ts
 * import { definePlugin } from 'vextjs'
 * import Redis from 'ioredis'
 *
 * export default definePlugin({
 *   name: 'redis',
 *   async setup(app) {
 *     const redis = new Redis(app.config.redis)
 *     app.extend('cache', redis)
 *     app.onClose(() => redis.quit())
 *   },
 * })
 */
export interface VextPlugin {
  /**
   * 插件名称（唯一标识）
   *
   * 用于日志、错误信息和依赖声明。
   * 同名插件后加载的会覆盖先加载的（用于替换内置实现）。
   */
  readonly name: string;

  /**
   * 依赖的其他插件名称列表
   *
   * plugin-loader 根据此字段进行拓扑排序，
   * 确保依赖的插件先于当前插件执行 setup()。
   * 存在循环依赖时 Fail Fast 报错。
   *
   * @example
   * dependencies: ['database']  // 确保 database 插件先初始化
   */
  readonly dependencies?: string[];

  /**
   * 插件初始化函数
   *
   * 在 bootstrap 的步骤② 被 plugin-loader 调用。
   * 可以是异步函数（如连接数据库、初始化缓存）。
   * plugin-loader 会为每个 setup() 设置超时保护（默认 30s），
   * 超时后自动 clearTimeout 并抛出错误。
   *
   * @param app 应用实例（此时 app.use() 可用，app.services 尚未注入）
   */
  setup(app: VextApp): Promise<void> | void;

  /**
   * 就绪钩子（可选）— HTTP 监听后执行
   *
   * 在所有插件加载完成、HTTP 开始监听之后触发。
   * plugin-loader 在 setup() 完成后自动将此钩子注册到 app.onReady()。
   * 适合：预热缓存、检查外部依赖、打印启动信息。
   *
   * 等价于在 setup() 中调用 app.onReady(() => ...)，
   * 但语义更清晰，与 setup/onClose 形成完整的生命周期三件套。
   *
   * @param app 应用实例
   *
   * @example
   * export default definePlugin({
   *   name: 'my-plugin',
   *   async setup(app) { ... },
   *   async onReady(app) {
   *     app.logger.info('Plugin is ready!')
   *   },
   * })
   */
  onReady?(app: VextApp): Promise<void> | void;

  /**
   * 关闭钩子（可选）— 优雅关闭时执行（LIFO 顺序）
   *
   * SIGTERM/SIGINT 信号触发时，按注册的逆序执行。
   * plugin-loader 在 setup() 完成后自动将此钩子注册到 app.onClose()。
   * 适合：关闭数据库连接、刷新日志缓冲区、取消定时任务。
   *
   * 等价于在 setup() 中调用 app.onClose(() => ...)，
   * 但语义更清晰，生命周期意图更明确。
   *
   * @param app 应用实例
   *
   * @example
   * export default definePlugin({
   *   name: 'my-plugin',
   *   async setup(app) { ... },
   *   async onClose(app) {
   *     await app.db.disconnect()
   *   },
   * })
   */
  onClose?(app: VextApp): Promise<void> | void;
}

/**
 * definePlugin — 插件定义辅助函数
 *
 * 提供类型推断和 IDE 自动补全支持，
 * 是创建 VextPlugin 的推荐方式。
 *
 * @param plugin 插件定义对象
 * @returns 原样返回插件对象（类型标注）
 *
 * @example
 * import { definePlugin } from 'vextjs'
 *
 * export default definePlugin({
 *   name: 'my-plugin',
 *   dependencies: ['database'],
 *   async setup(app) {
 *     app.extend('myUtil', () => 'hello')
 *     app.onClose(() => cleanup())
 *   },
 * })
 */
export function definePlugin(plugin: VextPlugin): VextPlugin {
  return plugin;
}

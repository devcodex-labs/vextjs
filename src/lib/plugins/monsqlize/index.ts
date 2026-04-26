/**
 * MonSQLize 内置默认插件入口
 *
 * vext 框架的内置 ORM 插件，基于 monSQLize（轻量级 MongoDB ORM）。
 * 开箱即用：用户只需在 config 中配置 database 字段即可自动启用。
 *
 * 条件加载策略：
 *   - 仅当 app.config.database 存在时才执行 setup（无配置则跳过，零开销）
 *   - 由 bootstrap.ts 在用户插件加载之前注册（内置插件优先）
 *   - 用户插件可安全依赖 app.db / app.monsqlize
 *
 * 生命周期：
 *   1. bootstrap 检测到 config.database → 注册内置 monsqlize 插件
 *   2. plugin-loader 执行 setup() → 连接数据库 + 加载 Model + 挂载 app.db
 *   3. 用户插件 setup() → 可使用 app.db / app.monsqlize
 *   4. app.onClose() → 自动关闭数据库连接
 *
 * @module lib/plugins/monsqlize/index
 * @see 13-monsqlize-plugin.md（设计文档）
 */

import { definePlugin } from "../../../types/plugin.js";
import { setupMonSQLize } from "./plugin.js";

// Re-export 类型供外部使用
export type { MonSQLizeConnection, MonSQLizeDatabaseConfig, VextModelDefinition } from "./types.js";

// 导入类型扩展（确保 declare module 生效）
import "./types.js";

/**
 * 创建 MonSQLize 内置插件实例
 *
 * 工厂函数模式：接收 srcDir 参数（由 bootstrap 传入），
 * 返回配置好的 VextPlugin 实例。
 *
 * @param srcDir  src/ 目录的绝对路径（用于定位 models/ 目录）
 *                在 VEXT_BUILT=1 时为 dist/ 目录
 * @returns VextPlugin 实例
 *
 * @example
 * ```typescript
 * // bootstrap.ts 内部
 * import { createMonSQLizePlugin } from './plugins/monsqlize/index.js'
 *
 * // 在用户插件加载之前注册
 * if (config.database) {
 *   const monsqlizePlugin = createMonSQLizePlugin(srcDir)
 *   await executeSetupWithTimeout(monsqlizePlugin, app, setupTimeout, '<built-in>')
 * }
 * ```
 */
export function createMonSQLizePlugin(srcDir: string) {
  return definePlugin({
    name: "monsqlize",

    async setup(app) {
      await setupMonSQLize(app, srcDir);
    },
  });
}

/**
 * 检查配置中是否包含 database 字段（条件加载判断）
 *
 * 由 bootstrap.ts 调用，决定是否注册内置 monsqlize 插件。
 * 仅检查字段存在性，不做深度校验（校验由 setupMonSQLize 负责）。
 *
 * @param config  VextConfig（已合并默认值）
 * @returns true 表示应该加载 monsqlize 插件
 */
export function shouldLoadMonSQLize(config: Record<string, unknown>): boolean {
  return (
    config.database != null &&
    typeof config.database === "object" &&
    Object.keys(config.database as object).length > 0
  );
}

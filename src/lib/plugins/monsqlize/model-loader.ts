/**
 * MonSQLize Model 自动加载器
 *
 * 支持两种 Model 来源（可同时使用）：
 *   1. 共享 Model 包（@project/models）— 微服务场景下多服务共享 Model 定义
 *   2. 本地 models/ 目录（src/models/*.ts）— 项目本地 Model 定义
 *
 * 加载顺序：先 shared 包 → 再本地目录（本地可覆盖 shared）。
 *
 * 文件名推断 Model 名称规则（deriveModelName）：
 *   - user.ts           → 'User'
 *   - order-item.ts     → 'OrderItem'
 *   - admin/role.ts     → 'AdminRole'
 *   - billing/invoice.ts → 'BillingInvoice'
 *
 * 排除规则：
 *   - 以 _ 开头的文件（如 _base.ts）
 *   - .d.ts 声明文件
 *   - .test. / .spec. 测试文件
 *
 * @module lib/plugins/monsqlize/model-loader
 * @see 13-monsqlize-plugin.md §2.5（Model 自动加载）
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import type { MonSQLize } from "monsqlize";
import type { VextApp } from "../../../types/app.js";
import type { MonSQLizeDatabaseConfig } from "./types.js";

/**
 * 加载 Model 定义
 *
 * 支持两种来源（可同时使用）：
 *   1. 共享 Model 包（config.sharedPackage）
 *   2. 本地 models/ 目录（config.dir，默认 'models'）
 *
 * @param monsqlize    MonSQLize 实例（已连接）
 * @param modelsConfig Model 配置（来自 app.config.database.models）
 * @param app          VextApp 实例（用于日志）
 * @param srcDir       src/ 目录的绝对路径（用于定位 models/ 目录）
 */
export async function loadModels(
  monsqlize: MonSQLize,
  modelsConfig: MonSQLizeDatabaseConfig["models"] | undefined,
  app: VextApp,
  srcDir: string,
): Promise<void> {
  const config = {
    dir: modelsConfig?.dir ?? "models",
    autoRegister: modelsConfig?.autoRegister ?? true,
    sharedPackage: modelsConfig?.sharedPackage,
  };

  if (!config.autoRegister) {
    app.logger.debug("[monsqlize] model auto-register disabled");
    return;
  }

  let modelCount = 0;

  // ── 1. 加载共享 Model 包 ──────────────────────────────────
  if (config.sharedPackage) {
    modelCount += await loadSharedModels(monsqlize, config.sharedPackage, app);
  }

  // ── 2. 加载本地 models/ 目录 ──────────────────────────────
  const modelsDir = join(srcDir, config.dir);

  if (!existsSync(modelsDir)) {
    if (!config.sharedPackage) {
      app.logger.debug(
        "[monsqlize] no models/ directory found — skipping model loading",
      );
    }
    if (modelCount > 0) {
      app.logger.info(
        `[monsqlize] ${modelCount} model(s) loaded (shared only)`,
      );
    }
    return;
  }

  modelCount += await loadLocalModels(monsqlize, modelsDir, app);

  if (modelCount > 0) {
    app.logger.info(`[monsqlize] ${modelCount} model(s) loaded`);
  }
}

/**
 * 加载共享 Model 包
 *
 * 支持两种导出格式：
 *   - export default { User: { ... }, Order: { ... } }
 *   - export function registerModels(monsqlize) { ... }
 *
 * @param monsqlize     MonSQLize 实例
 * @param packageName   共享包名（如 '@project/models'）
 * @param app           VextApp 实例
 * @returns 加载的 Model 数量
 */
async function loadSharedModels(
  monsqlize: MonSQLize,
  packageName: string,
  app: VextApp,
): Promise<number> {
  let count = 0;

  try {
    const sharedModels = await import(packageName);

    if (
      sharedModels.default &&
      typeof sharedModels.default === "object" &&
      !Array.isArray(sharedModels.default)
    ) {
      // 格式 1：export default { User: { ... }, Order: { ... } }
      for (const [name, definition] of Object.entries(sharedModels.default)) {
        if (definition && typeof definition === "object") {
          monsqlize.model(name, definition as any);
          count++;
          app.logger.debug(`[monsqlize] model loaded from shared: ${name}`);
        }
      }
    } else if (
      sharedModels.registerModels &&
      typeof sharedModels.registerModels === "function"
    ) {
      // 格式 2：export function registerModels(monsqlize) { ... }
      await sharedModels.registerModels(monsqlize);
      app.logger.debug("[monsqlize] models loaded via registerModels()");
      // registerModels 内部注册，无法精确计数，标记为 1
      count++;
    } else {
      app.logger.warn(
        `[monsqlize] shared package "${packageName}" has no valid export ` +
          "(expected default object or registerModels function)",
      );
    }

    app.logger.info(
      `[monsqlize] shared models loaded from "${packageName}"`,
    );
  } catch (err) {
    throw new Error(
      `[monsqlize] Failed to load shared model package "${packageName}":\n` +
        `  ${(err as Error).message}\n` +
        `  Make sure the package is installed: npm install ${packageName}`,
    );
  }

  return count;
}

/**
 * 加载本地 models/ 目录下的 Model 定义文件
 *
 * 递归扫描目录，按文件名字母排序加载。
 * 每个文件应 export default 一个 Model 定义对象。
 *
 * @param monsqlize  MonSQLize 实例
 * @param modelsDir  models/ 目录绝对路径
 * @param app        VextApp 实例
 * @returns 加载的 Model 数量
 */
async function loadLocalModels(
  monsqlize: MonSQLize,
  modelsDir: string,
  app: VextApp,
): Promise<number> {
  let count = 0;

  // 使用 fast-glob 扫描（vext 已有此依赖）
  const { default: fg } = await import("fast-glob");
  const files = await fg("**/*.{ts,js,mjs,cjs}", {
    cwd: modelsDir,
    ignore: [
      "**/_*.{ts,js,mjs,cjs}",
      "**/*.d.ts",
      "**/*.test.{ts,js,mjs,cjs}",
      "**/*.spec.{ts,js,mjs,cjs}",
    ],
  });

  // 按字母序排列，确保加载顺序可预测
  for (const file of files.sort()) {
    const filePath = join(modelsDir, file);

    let mod: Record<string, unknown>;
    try {
      mod = await importModelFile(filePath);
    } catch (err) {
      app.logger.warn(
        `[monsqlize] models/${file} — failed to import: ${(err as Error).message}`,
      );
      continue;
    }

    const definition = mod.default;

    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      app.logger.warn(
        `[monsqlize] models/${file} — invalid export (expected default object), skipped`,
      );
      continue;
    }

    // Model 名称：定义对象中的 name 字段优先，否则从文件名推断
    const modelName =
      (definition as Record<string, unknown>).name as string | undefined ??
      deriveModelName(file);

    monsqlize.model(modelName, definition as any);
    count++;
    app.logger.debug(`[monsqlize] model loaded: ${modelName} (from ${file})`);
  }

  return count;
}

/**
 * 导入 Model 文件
 *
 * 处理 Windows ESM 路径问题（ERR_UNSUPPORTED_ESM_URL_SCHEME），
 * 使用 pathToFileURL 转换为 file:// URL。
 *
 * @param filePath Model 文件绝对路径
 * @returns 模块导出对象
 */
async function importModelFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  const { pathToFileURL } = await import("node:url");
  const fileUrl = pathToFileURL(filePath).href;
  return import(fileUrl);
}

/**
 * 从文件路径推断 Model 名称
 *
 * 规则：
 *   - 去除扩展名
 *   - 按目录分隔符拆分
 *   - 每段按 - 或 _ 拆分，首字母大写后拼接
 *   - 所有段拼接（PascalCase）
 *
 * @example
 * deriveModelName('user.ts')             → 'User'
 * deriveModelName('order-item.ts')       → 'OrderItem'
 * deriveModelName('admin/role.ts')       → 'AdminRole'
 * deriveModelName('billing/invoice.ts')  → 'BillingInvoice'
 * deriveModelName('user_profile.ts')     → 'UserProfile'
 */
export function deriveModelName(filePath: string): string {
  // 去除扩展名
  const withoutExt = filePath.replace(/\.\w+$/, "");
  // 按目录分隔符拆分（支持 / 和 \）
  const parts = withoutExt.split(/[/\\]/);

  return parts
    .map((part) =>
      part
        .split(/[-_]/)
        .map(
          (segment) =>
            segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase(),
        )
        .join(""),
    )
    .join("");
}

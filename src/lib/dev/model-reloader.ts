import path from "node:path";
import { existsSync } from "node:fs";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { deriveModelName, resolveModelEntry } from "../plugins/monsqlize/model-loader.js";

// 在 ESM 环境中通过 createRequire 获取 CJS 的 require 函数。
// model-reloader 需要 require() 加载 .vext/dev/models/ 下的 CJS 编译产物，
// 以及 require.resolve 来解析模块路径。
const esmRequire = createRequire(import.meta.url);

/**
 * model-reloader.ts — 选择性 Model 定义重载（monSQLize 热重载集成）
 *
 * Soft Reload 时只重新加载 invalidation set 中包含的 model 定义文件，
 * 其他 model 定义保持不变。使用 monSQLize v1.1.8 原生 Model.redefine() API。
 *
 * 核心流程：
 *
 *   1. 扫描 outDir/models/ 下所有 .js 文件
 *   2. 筛选出在 invalidation set 中的文件（需要重载的）
 *   3. 保存受影响 model 的旧定义（用于回滚）
 *   4. 逐个 require() 新编译产物，调用 Model.redefine() 更新定义
 *   5. 如果任何步骤失败，回滚所有受影响的 model 到旧定义
 *
 * 安全保证：
 *
 *   | 场景                          | 行为                                              |
 *   |-------------------------------|---------------------------------------------------|
 *   | model 文件不在失效集合中       | 完全不触碰，定义保持不变                            |
 *   | require() 新模块失败           | 回滚所有受影响 model 到旧定义，向上抛出错误          |
 *   | Model.redefine() 失败          | 回滚所有受影响 model 到旧定义，向上抛出错误          |
 *   | 嵌套目录（admin/role）         | 正确映射为 AdminRole（复用 deriveModelName）         |
 *   | 无 models/ 目录                | 静默跳过，返回空结果                                |
 *
 * @module lib/dev/model-reloader
 * @see model-loader.ts（初始加载逻辑，deriveModelName 复用）
 * @see service-reloader.ts（设计模式参考）
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 最小化的 VextApp 接口（仅包含 model-reloader 需要的字段）
 *
 * 使用局部接口避免对完整 VextApp 类型的直接依赖，
 * 便于单元测试中构造 mock 对象。
 */
export interface ModelReloaderApp {
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

/**
 * Model 重载结果
 */
export interface ModelReloadResult {
  /** 受影响（重载）的 model 数量 */
  reloaded: number;

  /** 未受影响（保持不变）的 model 数量 */
  unchanged: number;

  /** 重载的 model collection name 列表 */
  reloadedNames: string[];
}

/**
 * 保存的旧 model 定义（用于回滚）
 */
interface SavedModelEntry {
  /** collection name（如 "User"、"OrderItem"） */
  name: string;

  /**
   * 旧的 model 定义对象
   *
   * undefined 表示该 model 在重载前不存在（新增的 model 文件），
   * 回滚时应调用 Model.undefine() 移除。
   */
  definition: unknown | undefined;
}

// ── Model 静态类获取 ────────────────────────────────────────

/**
 * ModelClassAPI — model-reloader 所需的 Model 静态方法接口
 *
 * 全部使用 monSQLize v1.1.8 原生 API：
 *   - define(name, definition)    — 注册新 model
 *   - redefine(name, definition)  — 更新已有 model 定义（v1.1.7+）
 *   - undefine(name)              — 移除 model 定义（v1.1.7+）
 *   - has(name)                   — 检查 model 是否已注册
 *   - getDefinition(name)         — 获取 model 定义对象（从 registry entry 中提取 .definition）
 */
interface ModelClassAPI {
  define: (name: string, definition: unknown) => void;
  redefine: (name: string, definition: unknown) => void;
  undefine: (name: string) => boolean;
  has: (name: string) => boolean;
  getDefinition: (name: string) => unknown | undefined;
}

/**
 * getModelClass — 获取 monSQLize 的 Model 静态类并包装为统一接口
 *
 * monSQLize v1.1.8 原生提供 define / has / get / redefine / undefine。
 * get 返回 { collectionName, definition } 包装对象，
 * 本函数额外提供 getDefinition() 便捷方法提取纯 definition。
 *
 * @returns 统一的 Model 操作接口
 */
async function getModelClass(): Promise<ModelClassAPI> {
  const mod: Record<string, unknown> = await import("monsqlize");
  const MonSQLizeClass =
    (mod.default as Record<string, unknown>) ??
    (mod.MonSQLize as Record<string, unknown>) ??
    mod;

  const ModelStatic = MonSQLizeClass.Model as {
    define: (name: string, definition: unknown) => void;
    redefine: (name: string, definition: unknown) => void;
    undefine: (name: string) => boolean;
    has: (name: string) => boolean;
    get: (
      name: string,
    ) => { collectionName: string; definition: unknown } | undefined;
  };

  return {
    define: ModelStatic.define.bind(ModelStatic),
    redefine: ModelStatic.redefine.bind(ModelStatic),
    undefine: ModelStatic.undefine.bind(ModelStatic),
    has: ModelStatic.has.bind(ModelStatic),

    /**
     * getDefinition — 获取 model 的 definition 对象
     *
     * Model.get() 返回 { collectionName, definition }，
     * 此方法提取并返回 .definition 部分（回滚时需要原始定义）。
     */
    getDefinition(name: string): unknown | undefined {
      const entry = ModelStatic.get(name);
      return entry?.definition;
    },
  };
}

// ── 扫描 models 目录 ───────────────────────────────────────

/**
 * scanModelDirectory — 递归扫描 models/ 目录下的所有 .js 文件
 *
 * 只扫描编译产物（.js），忽略 .map / .d.ts 等辅助文件。
 * 跳过以 _ 或 . 开头的文件/目录。
 *
 * @param dir 当前扫描的目录路径
 * @returns 所有 model .js 文件的绝对路径数组
 */
async function scanModelDirectory(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // 跳过 _ 或 . 开头的目录
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const subFiles = await scanModelDirectory(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      // 只扫描 .js 文件（编译产物）
      if (!entry.name.endsWith(".js")) continue;
      // 跳过 source map 和类型声明
      if (entry.name.endsWith(".js.map") || entry.name.endsWith(".d.ts"))
        continue;
      // 跳过 _ 开头的文件
      if (entry.name.startsWith("_")) continue;
      files.push(fullPath);
    }
  }

  return files;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * reloadModels — 选择性重载 model 定义
 *
 * 只重新加载变更的 model 定义文件，其他 model 保持不变。
 * 使用 monSQLize v1.1.8 的 Model.redefine() API 原子更新定义。
 *
 * 流程：
 *   1. 扫描 outDir/models/ 下所有 .js 文件
 *   2. 筛选出在 invalidation set 中的文件
 *   3. 保存受影响 model 的旧定义
 *   4. 逐个 require() 新模块 + Model.redefine() 更新
 *   5. 失败时回滚所有受影响 model
 *
 * @param app VextApp 实例（需要 app.logger）
 * @param outDir 编译产物目录（.vext/dev/ 的绝对路径）
 * @param invalidated require.cache 失效集合（绝对路径集合）
 * @returns 重载结果（重载数 / 未变更数 / 重载的 name 列表）
 * @throws 重载失败时抛出错误（已回滚受影响 model）
 */
export async function reloadModels(
  app: ModelReloaderApp,
  outDir: string,
  invalidated: Set<string>,
): Promise<ModelReloadResult> {
  const modelsDir = path.join(outDir, "models");

  // ── 1. 扫描所有 model 文件 ────────────────────────────
  const allModelFiles = await scanModelDirectory(modelsDir);

  if (allModelFiles.length === 0) {
    app.logger.debug("[hot-reload] no models found, skipping model reload");
    return { reloaded: 0, unchanged: 0, reloadedNames: [] };
  }

  // ── 2. 筛选出需要重载的 model 文件 ────────────────────
  //
  // 一个 model 文件需要重载，当且仅当它（或它的编译产物）
  // 出现在 invalidation set 中。
  //
  // 检查逻辑：
  //   a. 直接检查 invalidated 集合中是否包含该文件的绝对路径
  //   b. 尝试 require.resolve 后再检查（处理扩展名补全场景）
  //
  const affectedFiles: string[] = [];
  for (const file of allModelFiles) {
    // 直接匹配
    if (invalidated.has(file)) {
      affectedFiles.push(file);
      continue;
    }

    // 尝试 resolve 后匹配（处理路径规范化差异）
    try {
      const resolved = esmRequire.resolve(file);
      if (invalidated.has(resolved)) {
        affectedFiles.push(file);
      }
    } catch {
      // require.resolve 失败（文件可能已被删除），跳过
    }
  }

  // 如果没有 model 被影响，直接跳过
  if (affectedFiles.length === 0) {
    app.logger.debug("[hot-reload] no models affected, skipping model reload");
    return {
      reloaded: 0,
      unchanged: allModelFiles.length,
      reloadedNames: [],
    };
  }

  // ── 3. 获取 Model 静态类 ──────────────────────────────
  const ModelClass = await getModelClass();

  // ── 4. 保存受影响 model 的旧定义（用于回滚）──────────
  const previousModels: SavedModelEntry[] = [];
  for (const file of affectedFiles) {
    const relativePath = path.relative(modelsDir, file);

    // 先加载当前文件获取 collectionName（需要用当前缓存版本）
    // 但 cache 已被 invalidator 清除，所以用 derive 推断名称
    // 并检查 Model.has() 确认是否已注册
    const inferredName = deriveModelName(relativePath);

    // 尝试获取旧定义（getDefinition 返回纯 definition 对象，非 registry entry）
    const oldDefinition = ModelClass.has(inferredName)
      ? ModelClass.getDefinition(inferredName)
      : undefined;

    previousModels.push({ name: inferredName, definition: oldDefinition });
  }

  // ── 5. 逐个重载受影响的 model ─────────────────────────
  const reloadedNames: string[] = [];

  try {
    for (let i = 0; i < affectedFiles.length; i++) {
      const file = affectedFiles[i]!;
      const relativePath = path.relative(modelsDir, file);

      // 5.1 require() 新编译产物
      //
      // require.cache 已在前面被清除（cache-invalidator），
      // 这里 require() 会从 .vext/dev/models/ 读取新编译的 .js。
      //
      const mod = esmRequire(file);

      // 5.2 ESM/CJS interop 双层解包
      //
      // esbuild 将 ESM 编译为 CJS 时输出 { __esModule: true, default: { ... } }。
      // Node.js require() 返回 module.exports 整体。
      // 需要解包到真正的 definition 对象。
      //
      // 与 model-loader.ts loadLocalModels 保持一致。
      //
      // null / undefined 守卫（module.exports = null 时 mod 为 null）
      if (mod == null) {
        app.logger.warn(
          `[hot-reload] models/${relativePath} — invalid export (expected default object), skipped`,
        );
        continue;
      }

      let definition = mod.default !== undefined ? mod.default : mod;
      if (
        definition &&
        typeof definition === "object" &&
        (definition as Record<string, unknown>).__esModule &&
        (definition as Record<string, unknown>).default
      ) {
        definition = (definition as Record<string, unknown>).default;
      }

      if (
        !definition ||
        typeof definition !== "object" ||
        Array.isArray(definition)
      ) {
        app.logger.warn(
          `[hot-reload] models/${relativePath} — invalid export (expected default object), skipped`,
        );
        continue;
      }

      // 5.3 确定 registry key 和最终定义（N4 目录路由）
      //
      // 使用 resolveModelEntry 与 model-loader 保持完全一致的逻辑：
      //   - 0-depth：registry key = def.collection ?? def.name ?? PascalCase(file)
      //   - 1-depth：registry key = PascalCase(all), 自动注入 name + connection
      //   - 2-depth：同上 + pool 路由
      //   - >= 3 depth：跳过
      //
      const def = definition as Record<string, unknown>;
      const entry = resolveModelEntry(relativePath, def);
      if (!entry) {
        const depthCount =
          relativePath.replace(/\.\w+$/, "").split(/[/\\]/).length - 1;
        app.logger.warn(
          `[hot-reload] models/${relativePath} — directory depth ${depthCount} exceeds maximum (2), skipped`,
        );
        continue;
      }
      const { registryKey, finalDef } = entry;

      // 5.4 更新保存的旧定义的 name（可能与 inferred 不同）
      //
      // inferredName（步骤 4 预先推断的）可能与 registryKey 不同，
      // 仅在 0-depth 且定义有 collection/name 字段时会出现此差异。
      // 此时需要重新获取旧定义，确保回滚使用正确的 name。
      //
      const savedEntry = previousModels[i]!;
      if (savedEntry.name !== registryKey) {
        savedEntry.name = registryKey;
        savedEntry.definition = ModelClass.has(registryKey)
          ? ModelClass.getDefinition(registryKey)
          : undefined;
      }

      // 5.5 调用 Model.redefine() 更新定义
      //
      // redefine() 是 v1.1.8 新增 API，原子更新已注册的 model 定义。
      // 如果 model 尚未注册（新文件），则使用 define() 注册。
      //
      if (ModelClass.has(registryKey)) {
        ModelClass.redefine(registryKey, finalDef);
      } else {
        ModelClass.define(registryKey, finalDef);
      }

      reloadedNames.push(registryKey);
      app.logger.debug(`[hot-reload] model "${registryKey}" reloaded`);

      // R5：若配了 key 且与推断名不同，额外注册/更新别名
      const aliasKey = def.key as string | undefined;
      if (aliasKey && aliasKey !== registryKey) {
        if (ModelClass.has(aliasKey)) {
          ModelClass.redefine(aliasKey, finalDef);
        } else {
          ModelClass.define(aliasKey, finalDef);
        }
        app.logger.debug(`[hot-reload] model alias "${aliasKey}" reloaded`);
      }
    }

    app.logger.info(
      `[hot-reload] models reloaded: ${reloadedNames.length} changed` +
        ` (${allModelFiles.length - reloadedNames.length} unchanged, kept)`,
    );

    return {
      reloaded: reloadedNames.length,
      unchanged: allModelFiles.length - reloadedNames.length,
      reloadedNames,
    };
  } catch (err) {
    // ── 6. 回滚：恢复受影响的 model 到旧定义 ────────────
    //
    // 任何步骤失败时，将所有受影响的 model 恢复为旧定义。
    // 这保证 Model 注册表的一致性：要么全部更新，要么全部回滚。
    //
    app.logger.error(
      `[hot-reload] model reload failed, rolling back ${previousModels.length} model(s): ${(err as Error).message}`,
    );

    for (const { name, definition } of previousModels) {
      try {
        if (definition !== undefined) {
          // 旧定义存在 → 恢复为旧定义
          ModelClass.redefine(name, definition);
        } else {
          // 旧定义不存在（新增的 model）→ 移除
          ModelClass.undefine(name);
        }
      } catch (rollbackErr) {
        // 回滚本身失败（极端情况），只记录日志
        app.logger.error(
          `[hot-reload] model rollback failed for "${name}": ${(rollbackErr as Error).message}`,
        );
      }
    }

    // 向上抛出，由 soft reload 总流程处理
    throw err;
  }
}

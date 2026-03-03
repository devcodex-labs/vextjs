import path from "node:path";
import { existsSync } from "node:fs";
import { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";

// 在 ESM 环境中通过 createRequire 获取 CJS 的 require 函数。
// service-reloader 需要 require() 加载 .vext/dev/services/ 下的 CJS 编译产物，
// 以及 require.resolve 来解析模块路径。
const esmRequire = createRequire(import.meta.url);

/**
 * service-reloader.ts — 选择性 Service 实例重载（Phase 2B）
 *
 * Soft Reload 时只重新实例化 invalidation set 中包含的 service，
 * 其他 service 实例保持不变。正确处理嵌套目录结构。
 *
 * 核心流程：
 *
 *   1. 扫描 outDir/services/ 下所有 .js 文件
 *   2. 筛选出在 invalidation set 中的文件（需要重载的）
 *   3. 保存受影响 service 的旧引用（用于回退）
 *   4. 逐个调用旧实例的 dispose()（如果存在）
 *   5. require() 新编译产物，实例化并挂载到 app.services
 *   6. 如果任何步骤失败，回滚受影响的 service 到旧实例
 *
 * 安全保证：
 *
 *   | 场景                       | 行为                                           |
 *   |----------------------------|------------------------------------------------|
 *   | service 文件不在失效集合中  | 完全不触碰，实例保持不变                        |
 *   | dispose() 抛出异常          | 打印警告，继续重载（不中断流程）                |
 *   | require() 或 new 失败       | 回滚所有受影响 service 到旧实例，向上抛出错误    |
 *   | 嵌套目录（payment/stripe）  | 正确映射为 app.services.payment.stripe           |
 *
 * @module lib/dev/service-reloader
 * @see 11b-soft-reload.md §4（服务实例重载）
 * @see 11e-edge-cases.md §1（Reload 失败回退）
 * @see 11e-edge-cases.md §6（Service 副作用安全）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2b
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 最小化的 VextApp 接口（仅包含 service-reloader 需要的字段）
 *
 * 使用局部接口避免对完整 VextApp 类型的直接依赖，
 * 便于单元测试中构造 mock 对象。
 */
export interface ServiceReloaderApp {
  services: Record<string, unknown>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

/**
 * Service 重载结果
 */
export interface ServiceReloadResult {
  /** 受影响（重载）的 service 数量 */
  reloaded: number;

  /** 未受影响（保持不变）的 service 数量 */
  unchanged: number;

  /** 重载的 service key 列表（点分格式，如 "payment.stripe"） */
  reloadedKeys: string[];
}

/**
 * 保存的旧 service 引用（用于回退）
 */
interface SavedServiceEntry {
  /** 嵌套 key 数组（如 ["payment", "stripe"]） */
  keys: string[];

  /** 旧的 service 实例 */
  instance: unknown;
}

// ── 路径 → Service Key 映射 ─────────────────────────────────

/**
 * filePathToServiceKeys — 将 service 文件路径转为嵌套 key 数组
 *
 * 复用 service-loader 的路径转换逻辑（详见 02-services.md）：
 *   - 取相对路径（相对于 servicesDir）
 *   - 去掉扩展名
 *   - 按 / 拆分为段
 *   - 每段做 kebab-case → camelCase 转换
 *
 * 示例：
 *   "user.js"             → ["user"]
 *   "user-profile.js"     → ["userProfile"]
 *   "payment/stripe.js"   → ["payment", "stripe"]
 *   "payment/ali-pay.js"  → ["payment", "aliPay"]
 *
 * v2.2 修复：v2.1 使用 path.basename() 只取文件名，
 * 无法处理嵌套目录结构，导致 payment/stripe.js 被错误地
 * 映射为 app.services["stripe"] 而非 app.services.payment.stripe。
 *
 * @param relativePath 相对于 servicesDir 的文件路径（如 "payment/stripe.js"）
 * @returns 嵌套 key 数组（如 ["payment", "stripe"]）
 */
export function filePathToServiceKeys(relativePath: string): string[] {
  return relativePath
    .replace(/\.[^.]+$/, "") // 去掉扩展名（.js / .cjs / .mjs）
    .split(/[/\\]/) // 按路径分隔符拆分
    .filter((seg) => seg.length > 0) // 过滤空段
    .map((seg) => seg.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
}

// ── 嵌套对象操作 ────────────────────────────────────────────

/**
 * getNestedValue — 从嵌套对象中读取值
 *
 * getNestedValue(obj, ["payment", "stripe"]) → obj.payment.stripe
 *
 * @param obj  根对象
 * @param keys 嵌套 key 数组
 * @returns 目标值，路径不存在时返回 undefined
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  keys: string[],
): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur === undefined || cur === null || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * setNestedValue — 向嵌套对象中设置值
 *
 * setNestedValue(obj, ["payment", "stripe"], value)
 *   → obj.payment.stripe = value
 *
 * 自动创建中间层级对象（如果不存在）。
 *
 * @param obj   根对象
 * @param keys  嵌套 key 数组
 * @param value 要设置的值
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  keys: string[],
  value: unknown,
): void {
  if (keys.length === 0) return;

  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (
      cur[key] === undefined ||
      cur[key] === null ||
      typeof cur[key] !== "object"
    ) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

// ── 扫描 services 目录 ─────────────────────────────────────

/**
 * scanServiceDirectory — 递归扫描 services/ 目录下的所有 .js 文件
 *
 * 只扫描编译产物（.js），忽略 .map / .d.ts 等辅助文件。
 * 跳过以 _ 或 . 开头的文件/目录。
 *
 * @param dir 当前扫描的目录路径
 * @returns 所有 service .js 文件的绝对路径数组
 */
export async function scanServiceDirectory(dir: string): Promise<string[]> {
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
      const subFiles = await scanServiceDirectory(fullPath);
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
 * reloadServices — 选择性重载 service（v2.2）
 *
 * 只重新实例化变更的 service，其他 service 实例保持不变。
 * 正确处理嵌套目录结构（如 payment/stripe → app.services.payment.stripe）。
 *
 * 流程：
 *   1. 扫描 outDir/services/ 下所有 .js 文件
 *   2. 筛选出在 invalidation set 中的文件
 *   3. 保存受影响 service 的旧引用
 *   4. 逐个 dispose + 重新 require + 实例化
 *   5. 失败时回滚所有受影响 service
 *
 * @param app VextApp 实例（需要 app.services 和 app.logger）
 * @param outDir 编译产物目录（.vext/dev/ 的绝对路径）
 * @param invalidated require.cache 失效集合（绝对路径集合）
 * @returns 重载结果（重载数 / 未变更数 / 重载的 key 列表）
 * @throws 重载失败时抛出错误（已回滚受影响 service）
 */
export async function reloadServices(
  app: ServiceReloaderApp,
  outDir: string,
  invalidated: Set<string>,
): Promise<ServiceReloadResult> {
  const servicesDir = path.join(outDir, "services");

  // ── 1. 扫描所有 service 文件 ──────────────────────────
  const allServiceFiles = await scanServiceDirectory(servicesDir);

  if (allServiceFiles.length === 0) {
    app.logger.debug("[hot-reload] no services found, skipping service reload");
    return { reloaded: 0, unchanged: 0, reloadedKeys: [] };
  }

  // ── 2. 筛选出需要重载的 service 文件 ──────────────────
  //
  // 一个 service 文件需要重载，当且仅当它（或它的编译产物）
  // 出现在 invalidation set 中。
  //
  // 检查逻辑：
  //   a. 直接检查 invalidated 集合中是否包含该文件的绝对路径
  //   b. 尝试 require.resolve 后再检查（处理扩展名补全场景）
  //
  const affectedFiles: string[] = [];
  for (const file of allServiceFiles) {
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

  // 如果没有 service 被影响，直接跳过
  if (affectedFiles.length === 0) {
    app.logger.debug(
      "[hot-reload] no services affected, skipping service reload",
    );
    return {
      reloaded: 0,
      unchanged: allServiceFiles.length,
      reloadedKeys: [],
    };
  }

  // ── 3. 保存受影响 service 的旧引用（用于回退）──────────
  //
  // v2.2: 使用 filePathToServiceKeys 正确处理嵌套路径
  //
  const previousServices: SavedServiceEntry[] = [];
  for (const file of affectedFiles) {
    const relativePath = path.relative(servicesDir, file);
    const keys = filePathToServiceKeys(relativePath);
    const oldInstance = getNestedValue(
      app.services as Record<string, unknown>,
      keys,
    );
    // 即使 oldInstance 是 undefined，也保存（因为回滚时需要恢复为 undefined）
    previousServices.push({ keys, instance: oldInstance });
  }

  // ── 4. 逐个重载受影响的 service ───────────────────────
  const reloadedKeys: string[] = [];

  try {
    for (const file of affectedFiles) {
      const relativePath = path.relative(servicesDir, file);
      const keys = filePathToServiceKeys(relativePath);
      const dotPath = keys.join(".");

      // 4.1 调用旧实例的清理方法（如果存在）
      //
      // dispose() 是可选的约定方法。
      // Service 可实现 dispose() 来清理副作用（定时器、连接池等）。
      // dispose() 失败不中断重载流程，只打印警告。
      //
      const oldInstance = getNestedValue(
        app.services as Record<string, unknown>,
        keys,
      );
      if (
        oldInstance !== null &&
        oldInstance !== undefined &&
        typeof oldInstance === "object" &&
        "dispose" in oldInstance &&
        typeof (oldInstance as Record<string, unknown>).dispose === "function"
      ) {
        try {
          await (
            oldInstance as { dispose: () => void | Promise<void> }
          ).dispose();
          app.logger.debug(
            `[hot-reload] service "${dotPath}" dispose() completed`,
          );
        } catch (e) {
          app.logger.warn(
            `[hot-reload] service "${dotPath}" dispose() failed: ${(e as Error).message}`,
          );
        }
      }

      // 4.2 重新 require 并实例化
      //
      // require.cache 已在前面被清除（cache-invalidator），
      // 这里 require() 会从 .vext/dev/services/ 读取新编译的 .js。
      //
      const ServiceModule = esmRequire(file);
      const Cls =
        ServiceModule.default !== undefined
          ? ServiceModule.default
          : ServiceModule;

      // 4.3 判断是 class 还是普通对象/函数
      //
      // 如果是 class → new Cls(app) 实例化
      // 如果是普通对象或函数 → 直接赋值
      //
      let newInstance: unknown;
      if (typeof Cls === "function") {
        // 检测是否为 class（ES6 class 的 toString() 以 "class " 开头）
        // 注意：transpiled class 可能不以 "class " 开头，
        // 但 esbuild 保留 class 关键字，所以这个检测在此场景下有效
        const isClass = /^\s*class\s/.test(Cls.toString());
        if (isClass) {
          newInstance = new Cls(app);
        } else {
          // 普通函数：可能是工厂函数，也可能是直接导出的函数
          // 与 service-loader 保持一致：对函数不自动调用
          newInstance = Cls;
        }
      } else {
        // 普通对象、数字、字符串等 → 直接赋值
        newInstance = Cls;
      }

      // 4.4 挂载到 app.services
      //
      // v2.2: 使用 setNestedValue 正确设置嵌套路径
      //
      setNestedValue(
        app.services as Record<string, unknown>,
        keys,
        newInstance,
      );

      reloadedKeys.push(dotPath);
      app.logger.debug(`[hot-reload] service "${dotPath}" reloaded`);
    }

    app.logger.info(
      `[hot-reload] services reloaded: ${affectedFiles.length} changed` +
        ` (${allServiceFiles.length - affectedFiles.length} unchanged, kept)`,
    );

    return {
      reloaded: affectedFiles.length,
      unchanged: allServiceFiles.length - affectedFiles.length,
      reloadedKeys,
    };
  } catch (err) {
    // ── 5. 回滚：恢复受影响的 service 到旧实例 ──────────
    //
    // 任何步骤失败时，将所有受影响的 service 恢复为旧实例。
    // 这保证 app.services 的一致性：要么全部更新，要么全部回滚。
    //
    app.logger.error(
      `[hot-reload] service reload failed, rolling back ${previousServices.length} service(s): ${(err as Error).message}`,
    );

    for (const { keys, instance } of previousServices) {
      try {
        setNestedValue(app.services as Record<string, unknown>, keys, instance);
      } catch (rollbackErr) {
        // 回滚本身失败（极端情况），只记录日志
        app.logger.error(
          `[hot-reload] service rollback failed for "${keys.join(".")}": ${(rollbackErr as Error).message}`,
        );
      }
    }

    // 向上抛出，由 soft reload 总流程处理
    throw err;
  }
}

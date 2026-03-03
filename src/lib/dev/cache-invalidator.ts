import path from "node:path";
import { createRequire } from "node:module";

// 在 ESM 环境中通过 createRequire 获取 CJS 的 require 函数。
// cache-invalidator 需要访问 require.cache 和 require.resolve
// 来管理 esbuild CJS 编译产物的模块缓存。
// 框架本身是 ESM（"type": "module"），但 .vext/dev/ 下的编译产物是 CJS，
// 因此需要通过 createRequire 桥接两个模块系统。
const esmRequire = createRequire(import.meta.url);

/**
 * cache-invalidator.ts — require.cache 精确清除（Phase 2B）
 *
 * 当源码变更时，不能清除所有 require.cache（那等于重启），
 * 必须只清除变更文件及其"上游依赖链"（依赖该文件的所有模块）。
 *
 * 所有 require.cache 操作的对象都是 `.vext/dev/` 下的编译产物（纯 CJS .js），
 * 不涉及 TS 文件或 ESM 模块。CJS 的 `require.cache` 和 `Module.children`
 * 完整可用，是精确清除的基础。
 *
 * 核心流程：
 *
 *   1. buildReverseDependencyGraph()
 *      — 遍历 require.cache，利用 Module.children 构建反向依赖图
 *        key=被依赖模块, value=依赖它的模块集合
 *
 *   2. computeInvalidationSet(compiledFiles, outDir)
 *      — 从变更文件出发，BFS 沿反向依赖图向上传播
 *        收集所有需要失效的模块路径
 *        安全边界：不越过 node_modules 和 config 目录
 *
 *   3. evictModules(modulePaths)
 *      — 从 require.cache 中删除失效集合中的所有模块
 *
 *   4. detectCircularInvalidation(invalidated)
 *      — 检测失效集合是否过大（>80% 缓存），
 *        过大说明存在循环依赖级联，建议 cold restart
 *
 * 安全边界设计：
 *
 *   | 边界                | 原因                                          |
 *   |---------------------|-----------------------------------------------|
 *   | node_modules        | 第三方包不应被失效（它们不会被用户修改）        |
 *   | config 目录         | 配置变更走 cold restart（Tier 3），不走 soft    |
 *   | 级联 > 80%          | 可能存在循环依赖导致爆炸性传播，降级 cold      |
 *
 * @module lib/dev/cache-invalidator
 * @see 11b-soft-reload.md §2（require.cache 精确清除）
 * @see 11e-edge-cases.md §1（Reload 失败回退）
 * @see 11e-edge-cases.md §2（循环依赖处理）
 * @see 11e-edge-cases.md §4（内存泄漏防护）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2a
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 缓存失效结果
 *
 * computeInvalidationSet 的返回结果，包含失效集合和元数据。
 */
export interface InvalidationResult {
  /**
   * 需要从 require.cache 中驱逐的模块绝对路径集合
   */
  invalidated: Set<string>;

  /**
   * 是否检测到级联爆炸（失效集合 > 80% 缓存）
   *
   * 为 true 时调用方应降级到 cold restart。
   */
  cascadeDetected: boolean;
}

/**
 * 缓存驱逐结果
 *
 * evictModules 的返回结果。
 */
export interface EvictionResult {
  /**
   * 实际从 require.cache 中删除的模块数量
   *
   * 可能小于 invalidated.size（某些模块可能已经不在缓存中）。
   */
  evicted: number;

  /**
   * 失效集合中但不在 require.cache 中的模块数量（跳过的）
   */
  skipped: number;
}

// ── 反向依赖图 ──────────────────────────────────────────────

/**
 * buildReverseDependencyGraph — 构建模块反向依赖图
 *
 * 遍历 require.cache 中所有已加载的模块，
 * 利用 Module.children 关系构建反向图：
 *
 *   正向: A requires B  →  A.children 包含 B
 *   反向: B 被 A 依赖  →  reverseGraph.get(B) 包含 A
 *
 * 反向图的用途：当 B 变更时，需要失效 B 以及所有依赖 B 的模块（A），
 * 因为 A 的模块导出可能缓存了对 B 导出值的引用。
 *
 * 注意：
 *   - 只处理 CJS 模块（require.cache 中的条目）
 *   - ESM 模块不在 require.cache 中，不受影响
 *   - 由于所有编译产物都是 CJS（esbuild 输出），这是完备的
 *
 * @returns 反向依赖图：key=被依赖模块路径, value=依赖它的模块路径集合
 */
export function buildReverseDependencyGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const [modulePath, mod] of Object.entries(esmRequire.cache)) {
    if (!mod || !mod.children) continue;

    for (const child of mod.children) {
      if (!child.filename) continue;

      let dependents = graph.get(child.filename);
      if (!dependents) {
        dependents = new Set<string>();
        graph.set(child.filename, dependents);
      }
      dependents.add(modulePath);
    }
  }

  return graph;
}

// ── 失效集合计算 ────────────────────────────────────────────

/**
 * computeInvalidationSet — 计算需要失效的所有模块路径
 *
 * 给定变更文件列表（编译产物路径），使用 BFS 沿反向依赖图向上传播，
 * 收集所有直接或间接依赖变更文件的模块。
 *
 * BFS 传播示例：
 *
 * ```
 *   变更: routes/user.js
 *
 *   反向图:
 *     routes/user.js ← router-loader.js ← bootstrap.js
 *                    ← routes/index.js
 *
 *   失效集合: {routes/user.js, router-loader.js, bootstrap.js, routes/index.js}
 * ```
 *
 * 安全边界：
 *   - **node_modules**: 第三方包不应被失效。用户代码不会修改 node_modules，
 *     且第三方包的模块导出通常是不可变的。
 *   - **config 目录**: 配置变更走 cold restart（Tier 3），在 soft reload 路径中
 *     不应传播到 config 相关模块。
 *
 * @param compiledFiles 变更的编译产物绝对路径（.vext/dev/ 下的 .js 文件）
 * @param outDir 编译产物根目录（.vext/dev/ 的绝对路径）
 * @returns 失效结果（包含失效集合和级联检测标志）
 */
export function computeInvalidationSet(
  compiledFiles: string[],
  outDir: string,
): InvalidationResult {
  const reverseGraph = buildReverseDependencyGraph();
  const invalidated = new Set<string>();

  // 将编译产物路径解析为 require.cache 中使用的绝对路径
  //
  // 优先检查 require.cache 是否已有该路径的条目（直接匹配），
  // 如果没有再尝试 require.resolve（补全扩展名并验证文件存在）。
  //
  // 这样做的原因：
  //   1. require.cache 的 key 就是模块的绝对路径，直接匹配最高效
  //   2. require.resolve 需要文件实际存在于磁盘，对于已加载但被删除的文件会失败
  //   3. 在测试中注入的虚拟路径不存在于磁盘，但存在于 require.cache 中
  //
  const queue: string[] = compiledFiles
    .map((f) => {
      // 优先：直接检查 require.cache 中是否存在
      if (esmRequire.cache[f]) {
        return f;
      }
      // 兜底：尝试 require.resolve（补全扩展名等）
      try {
        return esmRequire.resolve(f);
      } catch {
        // 文件可能已被删除（delete 场景），跳过
        return null;
      }
    })
    .filter((f): f is string => f !== null);

  // 规范化 config 目录路径（用于安全边界检查）
  const configBoundary = path.join(outDir, "config") + path.sep;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (invalidated.has(current)) continue;

    // ── 安全边界：不失效 node_modules ──────────────────
    //
    // node_modules 中的模块不应被失效：
    //   1. 用户不会修改 node_modules 中的代码
    //   2. 第三方包的导出通常是不可变的
    //   3. 失效 node_modules 模块可能导致不必要的级联
    //
    if (current.includes(`${path.sep}node_modules${path.sep}`)) continue;

    // ── 安全边界：不失效 config 目录 ──────────────────
    //
    // config/ 下的模块变更走 cold restart（Tier 3）。
    // 在 soft reload 路径中，即使有模块间接依赖 config，
    // 也不应该将失效传播到 config 模块。
    //
    if (current.startsWith(configBoundary)) continue;

    invalidated.add(current);

    // 向上传播到依赖它的模块
    const dependents = reverseGraph.get(current);
    if (dependents) {
      for (const dep of dependents) {
        if (!invalidated.has(dep)) {
          queue.push(dep);
        }
      }
    }
  }

  // 级联检测
  const cascadeDetected = detectCircularInvalidation(invalidated);

  return { invalidated, cascadeDetected };
}

// ── 缓存驱逐 ────────────────────────────────────────────────

/**
 * evictModules — 从 require.cache 中删除指定模块集合
 *
 * 在失效集合计算完成后调用。删除 require.cache 中的条目后，
 * 下次 require() 同一路径时会重新从磁盘加载（加载最新编译产物）。
 *
 * 注意：
 *   - 删除 require.cache 条目不会影响已加载模块的导出对象。
 *     已经通过 `const x = require('...')` 获取的引用仍然有效。
 *   - 旧 handler 闭包中持有的模块引用独立于 require.cache，
 *     GC 前一直有效（这是失败回退机制的基础）。
 *
 * 清除操作还需要处理 Module.children 中的引用。当从 require.cache
 * 中删除一个模块后，如果父模块的 children 数组仍引用它，
 * 可能导致反向依赖图不准确。因此在驱逐时也清理父模块的 children 引用。
 *
 * @param modulePaths 需要驱逐的模块绝对路径集合
 * @returns 驱逐结果（实际删除数 + 跳过数）
 */
export function evictModules(modulePaths: Set<string>): EvictionResult {
  let evicted = 0;
  let skipped = 0;

  for (const modulePath of modulePaths) {
    const cachedModule = esmRequire.cache[modulePath];
    if (cachedModule) {
      // 清理父模块的 children 引用
      // 这确保下次构建反向依赖图时不会包含已驱逐的模块
      if (cachedModule.parent && cachedModule.parent.children) {
        const idx = cachedModule.parent.children.indexOf(cachedModule);
        if (idx !== -1) {
          cachedModule.parent.children.splice(idx, 1);
        }
      }

      delete esmRequire.cache[modulePath];
      evicted++;
    } else {
      skipped++;
    }
  }

  return { evicted, skipped };
}

// ── 循环依赖级联检测 ────────────────────────────────────────

/**
 * detectCircularInvalidation — 检测失效集合是否过大
 *
 * 如果失效集合超过 require.cache 总条目数的 80%，
 * 说明可能存在循环依赖导致的级联爆炸，此时 soft reload
 * 几乎等于全量重启，性能上不如直接 cold restart。
 *
 * 触发级联爆炸的典型场景：
 *   - 所有模块都 import 了某个"上帝模块"（如 app 实例）
 *   - 循环依赖链导致整个依赖图互相关联
 *   - 入口文件（bootstrap.js）被修改
 *
 * @param invalidated 失效的模块路径集合
 * @returns 是否检测到级联爆炸（true = 建议 cold restart）
 */
export function detectCircularInvalidation(invalidated: Set<string>): boolean {
  const totalCached = Object.keys(esmRequire.cache).length;

  // 特殊情况：如果缓存为空或极少（如首次启动），不触发级联检测
  if (totalCached < 10) return false;

  if (invalidated.size > totalCached * 0.8) {
    return true;
  }

  return false;
}

// ── 便捷组合函数 ────────────────────────────────────────────

/**
 * invalidateAndEvict — 一站式失效 + 驱逐
 *
 * 组合 computeInvalidationSet + evictModules 的便捷方法。
 * 在 soft reload 流程中作为单一调用点使用。
 *
 * 流程：
 *   1. 计算失效集合（BFS 传播）
 *   2. 检查级联爆炸
 *   3. 如果未检测到级联 → 执行驱逐
 *   4. 如果检测到级联 → 不执行驱逐，返回级联标志
 *
 * 调用方根据 cascadeDetected 决定是否降级到 cold restart：
 *
 * ```ts
 * const result = invalidateAndEvict(compiledFiles, outDir);
 * if (result.cascadeDetected) {
 *   process.send?.({ type: 'request-cold-restart', reason: 'cascade too large' });
 *   return;
 * }
 * // 继续 soft reload...
 * ```
 *
 * @param compiledFiles 变更的编译产物绝对路径列表
 * @param outDir 编译产物根目录（.vext/dev/ 的绝对路径）
 * @returns 组合结果
 */
export function invalidateAndEvict(
  compiledFiles: string[],
  outDir: string,
): InvalidationResult & EvictionResult {
  const invalidationResult = computeInvalidationSet(compiledFiles, outDir);

  // 如果检测到级联爆炸，不执行驱逐（保持 require.cache 完整）
  // 调用方应降级到 cold restart
  if (invalidationResult.cascadeDetected) {
    return {
      ...invalidationResult,
      evicted: 0,
      skipped: invalidationResult.invalidated.size,
    };
  }

  const evictionResult = evictModules(invalidationResult.invalidated);

  return {
    ...invalidationResult,
    ...evictionResult,
  };
}

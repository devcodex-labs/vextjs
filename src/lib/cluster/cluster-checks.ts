import type { VextApp } from "../../types/app.js";

const RATE_LIMITER_OVERRIDDEN_KEY = Symbol.for("vextjs.rateLimiterOverridden");

/**
 * cluster-checks.ts — Cluster 模式兼容性检测模块
 *
 * 在 cluster 模式下，每个 Worker 是独立的 V8 实例，内存不共享。
 * 这导致某些基于内存的功能（如 rate limiter）在多 Worker 环境下行为不一致。
 *
 * 本模块在每个 Worker 的 bootstrap 完成后执行检测（步骤⑨ onReady 之前），
 * 对潜在问题打印 WARN 日志。仅警告，不阻止启动——用户可能故意使用内存 store
 * （如测试环境或单 Worker cluster）。
 *
 * 检测项：
 *   1. 内存型 rate limiter 警告（每个 Worker 独立计数，实际限流 = N × max）
 *   2. 后续可扩展：session store、缓存一致性等
 *
 * 触发条件：
 *   - cluster.workers > 1 且框架内置 rate limiter 未被 app.setRateLimiter() 替换
 *   - cluster.workers = 1 或 cluster 未启用 → 不打印
 *   - rateLimit.enabled !== true → 不打印
 *   - 已调用 app.setRateLimiter() → 不打印（假设用户已处理）
 *
 * @module lib/cluster/cluster-checks
 * @see 12-cluster.md §4.1（Cluster 模式启动检测与警告）
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * Cluster 兼容性检测结果
 *
 * 每个检测项返回一个 CheckResult。
 * 主要用于测试验证检测逻辑是否正确触发。
 */
export interface ClusterCheckResult {
  /** 检测项名称 */
  name: string;
  /** 是否触发了警告 */
  warned: boolean;
  /** 警告消息（仅 warned=true 时存在） */
  message?: string;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * checkClusterCompatibility — 检测 cluster 模式下的潜在兼容性问题
 *
 * 在 Worker bootstrap 完成后调用（步骤⑨ onReady 之前）。
 * 检查当前配置是否存在多 Worker 下的已知问题，并输出 WARN 日志。
 *
 * 设计要点：
 *   - 仅打印 WARN，不抛出异常，不阻止启动
 *   - 使用 app.logger（结构化日志），而非 console.warn
 *   - 返回检测结果数组，便于测试验证
 *
 * @param app VextApp 实例（从中读取 config 和检测 rate limiter 状态）
 * @param workerCount 实际 Worker 数量（由 Master 传入或从 config 推算）
 * @returns 检测结果数组
 *
 * @example
 * ```typescript
 * // 在 Worker bootstrap 完成后调用
 * const results = checkClusterCompatibility(app, workerCount)
 * // results: [{ name: 'rate-limit-memory-store', warned: true, message: '...' }]
 * ```
 */
export function checkClusterCompatibility(
  app: VextApp,
  workerCount: number,
): ClusterCheckResult[] {
  const results: ClusterCheckResult[] = [];

  // 单 Worker 或无 cluster → 无需检测
  if (workerCount <= 1) {
    return results;
  }

  // ── 检测 1: 内存型 rate limiter ────────────────────────
  results.push(checkRateLimitMemoryStore(app, workerCount));

  return results;
}

// ── 检测项实现 ──────────────────────────────────────────────

/**
 * checkRateLimitMemoryStore — 检测 rate limiter 是否使用内存 store
 *
 * cluster 模式下每个 Worker 的内存独立，内置的 flex-rate-limit 使用内存 store
 * 意味着每个 Worker 独立计数。实际全局限流值 = workerCount × config.rateLimit.max。
 *
 * 检测逻辑：
 *   1. rateLimit.enabled !== true → 不警告（默认关闭或用户已禁用）
 *   2. 用户通过 app.setRateLimiter() 设置了自定义 limiter → 不警告
 *      （假设用户使用了 Redis store 或其他分布式方案）
 *   3. 其余情况 → 输出 WARN
 *
 * 注意：
 *   这里无法直接检测 limiter 是否真的使用了 Redis store。
 *   只能通过 "是否调用了 setRateLimiter()" 间接判断。
 *   如果用户调用了 setRateLimiter() 但传入的仍然是内存 store，
 *   框架不再额外警告（尊重用户的显式选择）。
 *
 * @internal
 */
function checkRateLimitMemoryStore(
  app: VextApp,
  workerCount: number,
): ClusterCheckResult {
  const name = "rate-limit-memory-store";
  const config = app.config;

  // rate limit 默认关闭，只有显式 true 才进入内存 store 检查。
  const rateLimitConfig = config.rateLimit;
  if (rateLimitConfig?.enabled !== true) {
    return { name, warned: false };
  }

  // 检查用户是否通过 app.setRateLimiter() 替换了默认 limiter。
  // checkClusterCompatibility 接收的是 VextApp（不含 internals），
  // 因此通过 createApp 写入的非枚举 Symbol 标记判断；旧字符串标记仅保留
  // 兼容历史 Worker 快照与外部 mock。
  //
  // 注意：如果无法访问内部标记，降级为"只要配置了 rateLimit 就警告"。
  // Worker 端可以通过环境变量 VEXT_RATE_LIMITER_OVERRIDDEN 传递此信息。
  //
  const appWithFlags = app as unknown as Record<string | symbol, unknown>;
  const rateLimiterOverridden =
    appWithFlags[RATE_LIMITER_OVERRIDDEN_KEY] === true ||
    appWithFlags._rateLimiterOverridden === true;

  if (rateLimiterOverridden) {
    return { name, warned: false };
  }

  // ── 输出警告 ──────────────────────────────────────────
  const max = rateLimitConfig?.max ?? "N/A";
  const message =
    `[vextjs] ⚠️ Cluster mode with ${workerCount} workers detected, ` +
    `but rate limiter is using in-memory store.\n` +
    `  Each worker has independent counters — actual rate = ${workerCount} × ${max} = ${workerCount * (typeof max === "number" ? max : 0)} req/window.\n` +
    `  Recommendation: use Redis store via app.setRateLimiter() or disable rate limit.\n` +
    `  Docs: https://vextjs.dev/guide/cluster#rate-limit`;

  app.logger.warn(message);

  return { name, warned: true, message };
}

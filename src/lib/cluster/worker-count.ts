import * as os from "node:os";
import { readFileSync, existsSync } from "node:fs";

/**
 * worker-count.ts — Worker 数量计算模块
 *
 * 根据配置值和运行环境计算实际应 fork 的 Worker 数量。
 *
 * 策略：
 *   1. 显式数字 → 直接使用（clamp 到 [1, 64]）
 *   2. 'auto'   → CPU 核心数（感知 Docker cgroups）
 *   3. 'auto-1' → CPU 核心数 - 1（为 Master 预留一个核心）
 *
 * CPU 检测优先级：
 *   1. os.availableParallelism()（Node.js 19.4+，感知 Docker cgroups v2）
 *   2. cgroup v1 检测（/sys/fs/cgroup/cpu/cpu.cfs_quota_us + cpu.cfs_period_us）
 *   3. os.cpus().length（降级）
 *
 * 硬上限：64 个 Worker（防止误配置导致资源耗尽）
 *
 * @module lib/cluster/worker-count
 * @see 12a-master.md §2（Worker 数量计算）
 */

// ── 常量 ────────────────────────────────────────────────────

/** Worker 数量硬上限，防止误配置导致系统资源耗尽 */
const MAX_WORKERS = 64;

/** cgroup v1 CPU 配额路径（Docker 旧版本 / 部分云平台） */
const CGROUP_V1_QUOTA_PATH = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const CGROUP_V1_PERIOD_PATH = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

interface CpuCountSources {
  availableParallelism?: () => number;
  cpus: () => ReturnType<typeof os.cpus>;
  platform: NodeJS.Platform;
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: BufferEncoding) => string;
}

function getDefaultCpuCountSources(): CpuCountSources {
  return {
    availableParallelism: os.availableParallelism,
    cpus: os.cpus,
    platform: process.platform,
    existsSync,
    readFileSync,
  };
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * resolveWorkerCount — 根据配置计算实际 Worker 数量
 *
 * @param config Worker 数量配置
 *   - number:   显式指定（clamp 到 [1, 64]）
 *   - 'auto':   等于检测到的 CPU 核心数
 *   - 'auto-1': 等于 CPU 核心数 - 1（至少 1）
 * @returns 实际 Worker 数量（保证 >= 1 且 <= 64）
 *
 * @example
 * ```typescript
 * resolveWorkerCount(4)        // → 4
 * resolveWorkerCount('auto')   // → CPU 核心数（如 8）
 * resolveWorkerCount('auto-1') // → CPU 核心数 - 1（如 7）
 * resolveWorkerCount(0)        // → 1（最小值保护）
 * resolveWorkerCount(100)      // → 64（硬上限保护）
 * ```
 */
export function resolveWorkerCount(config: "auto" | "auto-1" | number): number {
  // ── 显式数字 ────────────────────────────────────────────
  if (typeof config === "number") {
    return Math.max(1, Math.min(config, MAX_WORKERS));
  }

  // ── 自动检测 CPU 核心数 ──────────────────────────────────
  const cpuCount = detectCpuCount();

  if (config === "auto-1") {
    return Math.max(1, cpuCount - 1);
  }

  // config === 'auto'
  return Math.max(1, cpuCount);
}

// ── CPU 检测 ────────────────────────────────────────────────

/**
 * detectCpuCount — 检测可用 CPU 核心数
 *
 * 优先级：
 *   1. os.availableParallelism()（Node.js 19.4+）
 *      - 原生感知 cgroups v2（Docker / K8s 资源限制）
 *      - 无需手动读取 cgroup 文件
 *   2. cgroup v1 降级检测
 *      - 读取 /sys/fs/cgroup/cpu/cpu.cfs_quota_us 和 cpu.cfs_period_us
 *      - 计算 Math.ceil(quota / period) 作为核心数上限
 *      - 取 min(os.cpus().length, cgroup 限制)
 *   3. os.cpus().length
 *      - 最终降级，物理/逻辑核心数
 *
 * @returns 可用 CPU 核心数（至少 1）
 */
function detectCpuCount(
  sources: CpuCountSources = getDefaultCpuCountSources(),
): number {
  // ── 策略 1: os.availableParallelism() ──────────────────
  //
  // Node.js 19.4+ / 20.x+ 提供此 API，
  // 原生感知 Docker cgroups v2 的 CPU 限制。
  //
  try {
    if (typeof sources.availableParallelism === "function") {
      const count = sources.availableParallelism();
      if (Number.isFinite(count) && count > 0) {
        return Math.min(Math.floor(count), MAX_WORKERS);
      }
    }
  } catch {
    // availableParallelism 不可用，继续降级
  }

  // ── 策略 2 + 3: os.cpus() + cgroup v1 降级 ────────────
  const osCpuCount = sources.cpus().length || 1;
  const adjusted = adjustForCgroupV1(osCpuCount, sources);

  return Math.min(adjusted, MAX_WORKERS);
}

/**
 * adjustForCgroupV1 — cgroup v1 CPU 配额检测（Docker 旧版本降级）
 *
 * Docker 使用 cgroups 限制容器 CPU 配额：
 *   - cpu.cfs_quota_us:  容器可使用的 CPU 时间（微秒/周期）
 *   - cpu.cfs_period_us: 一个调度周期的长度（微秒，通常 100000 = 100ms）
 *   - 有效核心数 = ceil(quota / period)
 *
 * 例如：
 *   quota = 200000, period = 100000 → 2 核
 *   quota = 150000, period = 100000 → 2 核（ceil）
 *   quota = -1 → 无限制，使用 fallback
 *
 * @param fallback os.cpus().length 的值（当 cgroup 不适用时使用）
 * @returns 调整后的 CPU 核心数
 */
function adjustForCgroupV1(
  fallback: number,
  sources: CpuCountSources = getDefaultCpuCountSources(),
): number {
  try {
    // 仅 Linux 支持 cgroup 文件系统
    if (sources.platform !== "linux") {
      return fallback;
    }

    if (
      !sources.existsSync(CGROUP_V1_QUOTA_PATH) ||
      !sources.existsSync(CGROUP_V1_PERIOD_PATH)
    ) {
      return fallback;
    }

    const quota = parseInt(
      sources.readFileSync(CGROUP_V1_QUOTA_PATH, "utf-8").trim(),
      10,
    );
    const period = parseInt(
      sources.readFileSync(CGROUP_V1_PERIOD_PATH, "utf-8").trim(),
      10,
    );

    // quota = -1 表示无限制
    if (quota > 0 && period > 0) {
      const cgroupCpus = Math.ceil(quota / period);
      // 取 cgroup 限制和 os.cpus() 的较小值
      return Math.min(fallback, cgroupCpus);
    }
  } catch {
    // 非 Linux、无权限、文件读取失败 → 使用 fallback
  }

  return fallback;
}

// ── 导出（仅供测试使用的内部函数） ──────────────────────────

/**
 * @internal 仅供单元测试直接访问内部函数
 */
export const _internals = {
  detectCpuCount,
  adjustForCgroupV1,
  MAX_WORKERS,
} as const;

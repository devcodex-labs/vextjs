/**
 * memory-monitor.ts — 热重载后的内存使用监控与泄漏预警（Phase 2B）
 *
 * 反复 soft reload 可能累积旧模块的副作用（如未清理的定时器、
 * 未关闭的连接、事件监听器等），导致内存泄漏。
 *
 * 本模块在每次 soft reload 后调用，定期报告内存使用情况，
 * 并在检测到异常内存增长时发出警告。
 *
 * esbuild 方案相比 tsx 有天然优势：
 *   - 编译产物在磁盘上
 *   - require.cache 中有明确的条目可以精确清除
 *   - 但仍需防护 Service 层的资源泄漏（定时器、连接、监听器等）
 *
 * 泄漏来源与防护：
 *
 *   | 泄漏来源                | 防护措施                          |
 *   |-------------------------|-----------------------------------|
 *   | Service 未清理的定时器   | dispose() 约定                    |
 *   | Service 未关闭的连接     | dispose() 约定                    |
 *   | 事件监听器累积           | dispose() 中 removeListener       |
 *   | 旧 handler 闭包         | 请求完成后 GC 自动回收            |
 *   | 旧 adapter 实例         | 无引用后 GC 回收                  |
 *
 * @module lib/dev/memory-monitor
 * @see 11e-edge-cases.md §4（内存泄漏防护）
 * @see 11b-soft-reload.md §7 Step 8（reload 后调用 reportMemoryIfNeeded）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2a
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 内存快照
 *
 * 记录某一时刻的内存使用情况，用于趋势分析。
 */
export interface MemorySnapshot {
  /** 采样时间戳（毫秒） */
  timestamp: number;

  /** V8 堆已用内存（字节） */
  heapUsed: number;

  /** 进程常驻内存（字节） */
  rss: number;

  /** V8 堆总大小（字节） */
  heapTotal: number;

  /** 累计 reload 次数（采样时的值） */
  reloadCount: number;
}

/**
 * 内存报告结果
 *
 * reportMemoryIfNeeded 的返回值，用于日志和测试。
 */
export interface MemoryReport {
  /** 是否实际输出了报告（受 interval 节流控制） */
  reported: boolean;

  /** heap 使用量（MB） */
  heapMB: number;

  /** RSS 使用量（MB） */
  rssMB: number;

  /** 是否触发了高内存警告 */
  warning: boolean;

  /** 是否检测到持续增长趋势 */
  growthTrend: boolean;
}

/**
 * MemoryMonitor 配置选项
 */
export interface MemoryMonitorOptions {
  /**
   * 报告间隔（毫秒），默认 60000（1 分钟）
   *
   * 在此间隔内多次调用 reportMemoryIfNeeded 只会输出一次报告。
   * 设为 0 则每次调用都输出（适用于测试）。
   */
  reportInterval?: number;

  /**
   * 高内存警告阈值（MB），默认 512
   *
   * 当 heapUsed 超过此值时输出警告信息。
   */
  warningThresholdMB?: number;

  /**
   * 历史快照保留数量，默认 10
   *
   * 用于趋势检测。保留最近 N 次快照，
   * 如果连续增长则判定为内存泄漏趋势。
   */
  maxSnapshots?: number;

  /**
   * 连续增长判定次数，默认 5
   *
   * 当连续 N 次快照的 heapUsed 都在增长时，
   * 判定为持续增长趋势，输出泄漏警告。
   */
  growthThreshold?: number;

  /**
   * 日志输出函数（默认 console.log / console.warn）
   *
   * 允许注入自定义 logger，便于测试和与框架 logger 集成。
   */
  log?: (message: string) => void;

  /**
   * 警告输出函数（默认 console.warn）
   */
  warn?: (message: string) => void;
}

// ── MemoryMonitor 类 ────────────────────────────────────────

/**
 * MemoryMonitor — 热重载内存监控器
 *
 * 在每次 soft reload 完成后调用 report()，
 * 定期输出内存使用报告并检测异常增长趋势。
 *
 * 使用方式：
 *
 * ```ts
 * const monitor = new MemoryMonitor({ warningThresholdMB: 512 });
 *
 * // 每次 soft reload 完成后调用
 * monitor.report(hotHandler.getReloadCount());
 * ```
 */
export class MemoryMonitor {
  /**
   * 上次报告的时间戳
   */
  private lastReportTime = 0;

  /**
   * 历史内存快照（用于趋势检测）
   */
  private snapshots: MemorySnapshot[] = [];

  // ── 配置项（只读）──────────────────────────────────────

  private readonly reportInterval: number;
  private readonly warningThresholdMB: number;
  private readonly maxSnapshots: number;
  private readonly growthThreshold: number;
  private readonly log: (message: string) => void;
  private readonly warn: (message: string) => void;

  constructor(options: MemoryMonitorOptions = {}) {
    this.reportInterval = options.reportInterval ?? 60_000;
    this.warningThresholdMB = options.warningThresholdMB ?? 512;
    this.maxSnapshots = options.maxSnapshots ?? 10;
    this.growthThreshold = options.growthThreshold ?? 5;
    this.log = options.log ?? console.log.bind(console);
    this.warn = options.warn ?? console.warn.bind(console);
  }

  /**
   * report — 在 soft reload 完成后调用
   *
   * 受 reportInterval 节流控制：在间隔时间内多次调用只输出一次。
   * 每次调用都会记录快照（不受节流影响），确保趋势检测的准确性。
   *
   * 输出内容：
   *   - 正常：`[hot-reload] 📊 memory: heap 128MB, rss 256MB`
   *   - 高内存：`[hot-reload] ⚠️ high memory usage: heap 600MB, rss 800MB`
   *   - 增长趋势：`[hot-reload] ⚠️ memory growth trend detected...`
   *
   * @param reloadCount 当前累计 reload 次数（来自 HotSwappableHandler）
   * @returns 报告结果（用于测试断言）
   */
  report(reloadCount: number): MemoryReport {
    const now = Date.now();
    const usage = process.memoryUsage();
    const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
    const rssMB = Math.round(usage.rss / 1024 / 1024);

    // 始终记录快照（不受节流影响）
    this.addSnapshot({
      timestamp: now,
      heapUsed: usage.heapUsed,
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      reloadCount,
    });

    // 检测增长趋势
    const growthTrend = this.detectGrowthTrend();
    const warning = heapMB > this.warningThresholdMB;

    // 节流检查：是否需要输出报告
    const shouldReport =
      this.reportInterval === 0 ||
      now - this.lastReportTime >= this.reportInterval;

    if (!shouldReport) {
      return { reported: false, heapMB, rssMB, warning, growthTrend };
    }

    this.lastReportTime = now;

    // 输出报告
    if (warning) {
      this.warn(
        `[hot-reload] ⚠️ high memory usage: heap ${heapMB}MB, rss ${rssMB}MB\n` +
          "  This may indicate resource leaks from hot-reloaded services.\n" +
          "  Consider:\n" +
          "    - Adding dispose() to services with timers/connections\n" +
          '    - Pressing "r" for a cold restart to reclaim memory',
      );
    } else {
      this.log(`[hot-reload] 📊 memory: heap ${heapMB}MB, rss ${rssMB}MB`);
    }

    if (growthTrend) {
      const oldestSnapshot =
        this.snapshots[this.snapshots.length - this.growthThreshold];
      const latestSnapshot = this.snapshots[this.snapshots.length - 1];

      if (oldestSnapshot && latestSnapshot) {
        const oldHeapMB = Math.round(oldestSnapshot.heapUsed / 1024 / 1024);
        const growthMB = heapMB - oldHeapMB;
        const reloads = latestSnapshot.reloadCount - oldestSnapshot.reloadCount;

        this.warn(
          `[hot-reload] ⚠️ memory growth trend detected: ` +
            `+${growthMB}MB over ${reloads} reloads ` +
            `(${oldHeapMB}MB → ${heapMB}MB)\n` +
            "  Possible memory leak from services without dispose().\n" +
            '  Consider a cold restart ("r" key) to reclaim memory.',
        );
      }
    }

    return { reported: true, heapMB, rssMB, warning, growthTrend };
  }

  /**
   * 获取历史快照（用于测试和调试）
   *
   * @returns 快照数组的副本
   */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * 清除历史快照和计时器状态
   *
   * 主要用于测试中重置状态。
   */
  reset(): void {
    this.snapshots = [];
    this.lastReportTime = 0;
  }

  // ── 内部方法 ──────────────────────────────────────────────

  /**
   * addSnapshot — 记录内存快照
   *
   * 维护固定大小的滑动窗口（maxSnapshots），
   * 超出时移除最旧的快照。
   */
  private addSnapshot(snapshot: MemorySnapshot): void {
    this.snapshots.push(snapshot);

    // 保持滑动窗口大小
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /**
   * detectGrowthTrend — 检测内存持续增长趋势
   *
   * 检查最近 N 次快照的 heapUsed 是否**连续**单调递增。
   * 如果是，说明可能存在内存泄漏（每次 reload 都在累积未释放的资源）。
   *
   * 使用 heapUsed（而非 rss）是因为：
   *   - heapUsed 更精确地反映 JS 对象的内存占用
   *   - rss 包含共享库映射等非 JS 内存，波动更大
   *
   * @returns 是否检测到连续增长趋势
   */
  private detectGrowthTrend(): boolean {
    if (this.snapshots.length < this.growthThreshold) {
      return false;
    }

    // 检查最近 growthThreshold 个快照是否连续增长
    const start = this.snapshots.length - this.growthThreshold;
    for (let i = start + 1; i < this.snapshots.length; i++) {
      const current = this.snapshots[i];
      const previous = this.snapshots[i - 1];
      if (!current || !previous || current.heapUsed <= previous.heapUsed) {
        return false;
      }
    }

    return true;
  }
}

// ── 模块级便捷函数（向后兼容设计文档中的函数式 API）─────────

/**
 * 默认 MemoryMonitor 实例
 *
 * 供不需要自定义配置的场景直接使用。
 * soft reload 流程中可直接调用 reportMemoryIfNeeded()。
 */
let defaultMonitor: MemoryMonitor | null = null;

/**
 * reportMemoryIfNeeded — 模块级便捷函数
 *
 * 使用默认配置的 MemoryMonitor 实例。
 * 与设计文档 11e §4.2 中的函数签名保持一致。
 *
 * @param reloadCount 当前累计 reload 次数
 * @returns 报告结果
 */
export function reportMemoryIfNeeded(reloadCount: number = 0): MemoryReport {
  if (!defaultMonitor) {
    defaultMonitor = new MemoryMonitor();
  }
  return defaultMonitor.report(reloadCount);
}

/**
 * resetDefaultMonitor — 重置默认监控实例（测试用）
 */
export function resetDefaultMonitor(): void {
  if (defaultMonitor) {
    defaultMonitor.reset();
  }
  defaultMonitor = null;
}

import cluster, { type Worker as ClusterWorker } from "node:cluster";
import { EventEmitter } from "node:events";
import { resolveWorkerCount } from "./worker-count.js";
import { writePidFile, removePidFile } from "./pid-file.js";
import type {
  WorkerMeta,
  WorkerToMasterMessage,
  WorkerMetrics,
} from "./ipc-types.js";

function isEnvFlagEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function shouldLogStartupLifecycle(): boolean {
  return (
    !isEnvFlagEnabled(process.env.VEXT_START_PARENT_READY_LOG) ||
    process.env.VEXT_LIFECYCLE_LEVEL === "verbose" ||
    isEnvFlagEnabled(process.env.VEXT_VERBOSE_LIFECYCLE)
  );
}

/**
 * master.ts — Cluster Master 进程主类
 *
 * Master 进程是纯管理者角色，**不处理任何 HTTP 请求**：
 *
 *   1. 计算 Worker 数量（resolveWorkerCount）
 *   2. Fork Worker 进程（逐个启动，非并行，首个失败 Fail Fast）
 *   3. 写入 PID 文件
 *   4. 监听 Worker 退出事件并决定是否重启（频率保护 + 指数退避）
 *   5. 处理 OS 信号（SIGTERM / SIGINT / SIGHUP / SIGUSR2）
 *   6. 执行零停机重启（Rolling Restart）
 *   7. 运行健康检查（heartbeat monitor）
 *   8. 所有 Worker 退出后清理 PID 文件并退出
 *
 * 设计要点：
 *   - Worker 逐个启动（避免 DB 连接风暴，首个失败可立即中止）
 *   - 频率保护：窗口内重启次数超限 → 暂停自动重启
 *   - 指数退避：重启间隔随连续失败次数翻倍（上限 30s）
 *   - Rolling Restart：逐个替换 Worker，始终保持至少 N-1 个 Worker 服务
 *   - 健康检查：定期检测 Worker 心跳，超时则标记死亡并触发替换
 *
 * @module lib/cluster/master
 * @see 12a-master.md §3（Master 主类）
 * @see 12c-lifecycle.md（进程生命周期管理）
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * ClusterMaster 配置
 *
 * 从 VextClusterConfig 中提取 Master 需要的字段。
 * 通过 constructor 传入，运行时不可变。
 */
export interface ClusterMasterConfig {
  /** Worker 数量配置 */
  workers: "auto" | "auto-1" | number;
  /** Worker 崩溃后是否自动重启 */
  autoRestart: boolean;
  /** 窗口内允许的最大重启次数 */
  maxRestarts: number;
  /** 快速重启检测窗口（毫秒） */
  restartWindow: number;
  /** 重启间隔退避基数（毫秒） */
  restartBaseDelay: number;
  /** 重启间隔上限（毫秒） */
  restartMaxDelay: number;
  /** 健康检查配置 */
  healthCheck: {
    enabled: boolean;
    /** Master 检查间隔（毫秒） */
    interval: number;
    /** 心跳超时（毫秒） */
    timeout: number;
  };
  /** 零停机重启配置 */
  reload: {
    /** 替换下一个 Worker 前的等待时间（毫秒） */
    workerDelay: number;
    /** Worker 就绪超时（毫秒） */
    readyTimeout: number;
    /** Worker 关闭超时（毫秒） */
    shutdownTimeout: number;
  };
  /** PID 文件路径 */
  pidFile: string;
  /** 进程标题前缀 */
  titlePrefix: string;
  /** 粘性会话模式 */
  sticky: "none" | "ip";
}

/**
 * ClusterMaster 构造函数输入类型（深层 Partial）
 *
 * 与 ClusterMasterConfig 相同，但所有字段（包括嵌套对象内部字段）都是可选的。
 * constructor 内部会与 DEFAULT_CLUSTER_CONFIG 深合并后生成完整的 ClusterMasterConfig。
 */
export type ClusterMasterInput = Partial<
  Omit<ClusterMasterConfig, "healthCheck" | "reload"> & {
    healthCheck: Partial<ClusterMasterConfig["healthCheck"]>;
    reload: Partial<ClusterMasterConfig["reload"]>;
  }
>;

/**
 * ClusterMaster 事件
 */
export interface ClusterMasterEvents {
  /** Worker 就绪 */
  "worker-ready": { workerId: number; pid: number };
  /** Worker 退出 */
  "worker-exit": {
    workerId: number;
    code: number | null;
    signal: string | null;
  };
  /** 重启被限流 */
  "restart-throttled": {
    workerId: number;
    code: number | null;
    signal: string | null;
  };
  /** Rolling restart 开始 */
  "reload-start": { trigger: string; workerCount: number };
  /** Rolling restart 完成 */
  "reload-complete": { replaced: number; total: number };
  /** 健康检查：Worker 心跳超时 */
  "heartbeat-timeout": { workerId: number; lastHeartbeat: number };
  /** 所有 Worker 已退出 */
  "all-workers-dead": undefined;
}

// ── 默认配置 ────────────────────────────────────────────────

export const DEFAULT_CLUSTER_CONFIG: ClusterMasterConfig = {
  workers: "auto",
  autoRestart: true,
  maxRestarts: 5,
  restartWindow: 60_000,
  restartBaseDelay: 1_000,
  restartMaxDelay: 30_000,
  healthCheck: {
    enabled: true,
    interval: 15_000,
    timeout: 30_000,
  },
  reload: {
    workerDelay: 2_000,
    readyTimeout: 30_000,
    shutdownTimeout: 10_000,
  },
  pidFile: ".vext.pid",
  titlePrefix: "vext",
  sticky: "none",
};

// ── 主类 ────────────────────────────────────────────────────

export class ClusterMaster extends EventEmitter {
  /** Worker 元数据表（key = cluster.Worker.id） */
  private workers = new Map<number, WorkerMeta>();
  private nextWorkerId = 1;

  /** 窗口内的重启时间戳（用于频率保护） */
  private restartTimestamps: number[] = [];

  /** 是否正在优雅关闭 */
  private isShuttingDown = false;

  /** 是否正在执行 Rolling Restart */
  private isReloading = false;

  /**
   * 尚未 ready 且由当前调用方负责处置的候选 Worker。
   *
   * 初始启动和零停机替换都必须由调用方决定失败后的去向；只有运行期
   * auto-restart 自己创建的候选才应在 early exit 后继续进入退避重试。
   */
  private ownedStartupWorkerIds = new Set<number>();

  /** 首个 Worker 启动失败后，等待最后一个候选退出再解绑全局监听器。 */
  private startupFailed = false;

  /** 是否已注册 cluster 全局 Worker exit 监听器 */
  private workerExitListenerRegistered = false;

  /** 保留稳定引用，确保终止生命周期可以精确移除 cluster 全局监听器。 */
  private readonly onClusterWorkerExit = (
    worker: ClusterWorker,
    code: number | null,
    signal: string | null,
  ): void => {
    this.handleWorkerExit(worker, code, signal);
  };

  /** 健康检查定时器 */
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  /** 已注册的信号处理器引用（用于 cleanup 时移除） */
  private signalHandlers: Array<{
    signal: string;
    handler: () => void;
  }> = [];

  /** 最新一次收到的 Worker 指标快照 */
  private workerMetrics = new Map<number, WorkerMetrics>();

  /** 运行时配置（只读） */
  readonly config: ClusterMasterConfig;

  /** 实际计算出的 Worker 数量 */
  private workerCount = 0;

  constructor(config: ClusterMasterInput = {}) {
    super();

    // 深合并嵌套对象（healthCheck / reload），其余字段浅合并
    const healthCheck = {
      ...DEFAULT_CLUSTER_CONFIG.healthCheck,
      ...(config.healthCheck as Partial<ClusterMasterConfig["healthCheck"]>),
    };
    const reload = {
      ...DEFAULT_CLUSTER_CONFIG.reload,
      ...(config.reload as Partial<ClusterMasterConfig["reload"]>),
    };

    this.config = {
      ...DEFAULT_CLUSTER_CONFIG,
      ...config,
      healthCheck,
      reload,
    };
  }

  // ════════════════════════════════════════════════════════
  //  公共 API
  // ════════════════════════════════════════════════════════

  /**
   * start — 启动 Cluster Master
   *
   * 完整启动流程：
   *   1. 计算 Worker 数量
   *   2. 设置进程标题
   *   3. 写入 PID 文件
   *   4. 配置 cluster 调度策略
   *   5. 串行 fork Worker（首个失败 Fail Fast）
   *   6. 注册 Worker exit 事件
   *   7. 注册 OS 信号处理
   *   8. 启动健康检查（如果启用）
   *
   * @throws 首个 Worker 启动失败时抛出错误
   */
  async start(): Promise<void> {
    this.workerCount = resolveWorkerCount(this.config.workers);

    // ── 设置进程标题 ──────────────────────────────────────
    process.title = `${this.config.titlePrefix}:master`;

    // ── 写入 PID 文件 ────────────────────────────────────
    const pidResult = writePidFile(this.config.pidFile);
    if (!pidResult.ok) {
      throw new Error(`[cluster] ${pidResult.error}`);
    }

    // ── 配置 cluster 调度策略 ─────────────────────────────
    //
    // Linux + 非 sticky: SCHED_NONE
    //   → 内核 SO_REUSEPORT，由内核分配连接，性能最优
    //
    // 其他情况: SCHED_RR (Round-Robin)
    //   → Node.js 内置负载均衡
    //
    if (process.platform === "linux" && this.config.sticky === "none") {
      cluster.schedulingPolicy = cluster.SCHED_NONE;
    } else {
      cluster.schedulingPolicy = cluster.SCHED_RR;
    }

    if (shouldLogStartupLifecycle()) {
      console.log(
        `[cluster] master ${process.pid} starting ${this.workerCount} workers`,
      );
    }

    // ── 注册 Worker exit 全局监听 ─────────────────────────
    //
    // 必须在首次 fork 前注册：否则启动期间 readyTimeout 后被终止的
    // Worker 无法从 this.workers 中移除。每个未 ready 候选都带有显式
    // 所有权，避免误判为运行期崩溃，同时不屏蔽已 ready Worker 的退出。
    this.startupFailed = false;
    this.registerWorkerExitListener();

    // ── 串行 fork Worker ──────────────────────────────────
    //
    // 逐个启动，好处：
    //   - 避免启动时 DB 连接风暴
    //   - 首个 Worker 失败可立即中止
    //   - 首个 Worker 可执行一次性操作（如 DB 迁移）
    //
    for (let i = 0; i < this.workerCount; i++) {
      try {
        await this.forkWorker();
      } catch (err) {
        if (i === 0) {
          // 首个 Worker 失败 → Fail Fast
          console.error(
            `[cluster] ❌ first worker failed: ${(err as Error).message}`,
          );
          this.startupFailed = true;
          this.cleanup();
          throw err;
        }
        // 后续 Worker 失败 → 警告但继续
        console.warn(
          `[cluster] worker ${i + 1} failed to start: ${(err as Error).message}`,
        );
      }
    }

    // ── 注册 OS 信号处理 ──────────────────────────────────
    this.registerSignals();

    // ── 启动健康检查 ──────────────────────────────────────
    if (this.config.healthCheck.enabled) {
      this.startHealthCheck();
    }

    const readyCount = this.getReadyWorkerCount();
    if (shouldLogStartupLifecycle()) {
      console.log(
        `[cluster] ✅ ${readyCount}/${this.workerCount} workers ready`,
      );
    }
  }

  /**
   * gracefulShutdown — 优雅关闭所有 Worker
   *
   * 流程：
   *   1. 标记 isShuttingDown（阻止 auto-restart 和 rolling restart）
   *   2. 停止健康检查定时器
   *   3. 向所有存活 Worker 发送 shutdown 消息
   *   4. 等待所有 Worker 退出（超时则 SIGKILL）
   *   5. 清理 PID 文件
   *   6. Master 退出
   *
   * @param trigger 触发源（如 'SIGTERM'、'SIGINT'，用于日志输出）
   */
  async gracefulShutdown(trigger: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log(`[cluster] graceful shutdown triggered by ${trigger}`);

    // 停止健康检查
    this.stopHealthCheck();

    // 移除信号处理器
    this.removeSignalHandlers();

    // 通知所有 Worker 关闭
    const promises: Promise<void>[] = [];
    for (const [id] of this.workers) {
      const worker = cluster.workers?.[id];
      if (worker && !worker.isDead()) {
        const meta = this.workers.get(id);
        if (meta) meta.state = "draining";
        worker.send({
          type: "shutdown",
          timeout: this.config.reload.shutdownTimeout,
        });
        promises.push(
          this.waitForWorkerExit(worker, this.config.reload.shutdownTimeout),
        );
      }
    }

    await Promise.allSettled(promises);

    this.cleanup();

    console.log("[cluster] all workers stopped, master exiting");
    process.exit(0);
  }

  /**
   * rollingRestart — 零停机滚动重启所有 Worker
   *
   * 流程（对每个旧 Worker 串行执行）：
   *   1. Fork 新 Worker（加载最新代码）
   *   2. 等待新 Worker ready（超时 → 杀新 Worker，跳过本轮）
   *   3. 新 Worker 就绪 → 通知旧 Worker shutdown
   *   4. 等待旧 Worker 退出（超时 → SIGKILL）
   *   5. 等待 workerDelay 再处理下一个
   *
   * 关键保证：
   *   - 在替换过程中始终保持至少 N-1 个 Worker 服务
   *   - 替换失败时旧 Worker 保持运行（不会减少可用 Worker）
   *   - 如果在重启过程中收到 SIGTERM，立即停止替换并转入 gracefulShutdown
   *
   * @param trigger 触发源（如 'SIGHUP'、'SIGUSR2'，用于日志输出）
   */
  async rollingRestart(trigger: string): Promise<void> {
    if (this.isReloading) {
      console.log("[cluster] rolling restart already in progress, skipping");
      return;
    }
    if (this.isShuttingDown) return;

    this.isReloading = true;

    const oldWorkerIds = [...this.workers.keys()];
    console.log(
      `[cluster] rolling restart triggered by ${trigger}, replacing ${oldWorkerIds.length} workers`,
    );

    this.emit("reload-start", {
      trigger,
      workerCount: oldWorkerIds.length,
    } satisfies ClusterMasterEvents["reload-start"]);

    let replaced = 0;

    for (const oldId of oldWorkerIds) {
      if (this.isShuttingDown) {
        console.log(
          "[cluster] shutdown requested during rolling restart, aborting",
        );
        break;
      }

      try {
        // Fork 新 Worker
        const _newWorker = await this.forkWorker();

        // 新 Worker ready → 通知旧 Worker shutdown
        const oldWorker = cluster.workers?.[oldId];
        if (oldWorker && !oldWorker.isDead()) {
          const oldMeta = this.workers.get(oldId);
          if (oldMeta) oldMeta.state = "draining";

          oldWorker.send({
            type: "shutdown",
            timeout: this.config.reload.shutdownTimeout,
          });
          await this.waitForWorkerExit(
            oldWorker,
            this.config.reload.shutdownTimeout,
          );
        }

        replaced++;

        // 替换间隔（防止连续 fork 压力过大）
        if (replaced < oldWorkerIds.length) {
          await sleep(this.config.reload.workerDelay);
        }
      } catch (err) {
        console.error(
          `[cluster] failed to replace worker ${oldId}: ${(err as Error).message}`,
        );
        // 替换失败 → 旧 Worker 保持运行，继续处理下一个
      }
    }

    this.isReloading = false;

    console.log(
      `[cluster] rolling restart complete, ${replaced}/${oldWorkerIds.length} replaced`,
    );

    this.emit("reload-complete", {
      replaced,
      total: oldWorkerIds.length,
    } satisfies ClusterMasterEvents["reload-complete"]);
  }

  /**
   * broadcast — 向所有存活 Worker 广播消息
   *
   * @param payload 广播内容（必须可 JSON 序列化）
   */
  broadcast(payload: unknown): void {
    for (const [id] of this.workers) {
      const worker = cluster.workers?.[id];
      if (worker && !worker.isDead()) {
        worker.send({ type: "broadcast", payload });
      }
    }
  }

  /**
   * getWorkerCount — 获取当前 Worker 总数
   */
  getWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * getReadyWorkerCount — 获取当前处于 ready 状态的 Worker 数量
   */
  getReadyWorkerCount(): number {
    let count = 0;
    for (const meta of this.workers.values()) {
      if (meta.state === "ready") count++;
    }
    return count;
  }

  /**
   * getWorkerMetas — 获取所有 Worker 的元数据快照（只读）
   */
  getWorkerMetas(): ReadonlyMap<number, Readonly<WorkerMeta>> {
    return this.workers;
  }

  /**
   * getWorkerMetrics — 获取最近一次上报的 Worker 指标
   */
  getLatestMetrics(): ReadonlyMap<number, Readonly<WorkerMetrics>> {
    return this.workerMetrics;
  }

  /**
   * isRunning — Master 是否正在运行（未处于关闭/重载状态）
   */
  isRunning(): boolean {
    return !this.isShuttingDown;
  }

  /**
   * getTargetWorkerCount — 获取配置计算出的目标 Worker 数量
   */
  getTargetWorkerCount(): number {
    return this.workerCount;
  }

  // ════════════════════════════════════════════════════════
  //  内部方法
  // ════════════════════════════════════════════════════════

  /**
   * forkWorker — Fork 单个 Worker 并等待就绪
   *
   * 流程：
   *   1. cluster.fork() 创建新 Worker 进程
   *   2. 设置 WorkerMeta（state = 'starting'）
   *   3. 发送 set-title 消息
   *   4. 注册 IPC 消息监听
   *   5. 等待 Worker 发送 'ready' 消息（超时则终止并拒绝）
   *
   * 环境变量传递：
   *   - VEXT_WORKER_ID: Worker 编号（从 1 开始递增）
   *   - VEXT_MODE: 'start'（触发 bootstrap 自执行入口）
   *
   * @param options.retryOnEarlyExit 为 auto-restart 候选保留 early-exit 退避重试；
   * 其他调用方自行决定未 ready 候选的失败语义。
   * @returns fork 出的 cluster.Worker 实例
   * @throws Worker 在 readyTimeout 内未就绪或在就绪前退出
   */
  private async forkWorker(
    options: { retryOnEarlyExit?: boolean } = {},
  ): Promise<ClusterWorker> {
    const nextId = this.nextWorkerId++;

    const worker = cluster.fork({
      VEXT_WORKER_ID: String(nextId),
      VEXT_MODE: "start",
    });

    const meta: WorkerMeta = {
      id: worker.id,
      startTime: Date.now(),
      restartCount: 0,
      lastHeartbeat: Date.now(),
      state: "starting",
    };
    this.workers.set(worker.id, meta);
    if (!options.retryOnEarlyExit) {
      this.ownedStartupWorkerIds.add(worker.id);
    }

    // 设置 Worker 进程标题
    try {
      worker.send({
        type: "set-title",
        title: `${this.config.titlePrefix}:worker:${nextId}`,
      });
    } catch {
      // Worker 可能在 send 之前就退出了
    }

    // 注册 IPC 消息监听
    worker.on("message", (msg: unknown) =>
      this.handleWorkerMessage(worker, msg),
    );

    // 等待 Worker 就绪
    await this.waitForWorkerReady(worker);
    this.ownedStartupWorkerIds.delete(worker.id);

    this.emit("worker-ready", {
      workerId: worker.id,
      pid: worker.process.pid!,
    } satisfies ClusterMasterEvents["worker-ready"]);

    return worker;
  }

  /**
   * waitForWorkerReady — 等待 Worker 发送 'ready' 消息
   *
   * 使用 Promise 封装事件驱动的等待逻辑：
   *   - 收到 'ready' → resolve
   *   - 超时 → 终止该 Worker 并 reject
   *   - Worker 提前退出 → reject
   *
   * @param worker 目标 Worker
   * @throws 超时或 Worker 提前退出
   */
  private waitForWorkerReady(worker: ClusterWorker): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.terminateUnreadyWorker(worker);
        cleanup();
        reject(
          new Error(
            `worker ${worker.id} ready timeout (${this.config.reload.readyTimeout}ms)`,
          ),
        );
      }, this.config.reload.readyTimeout);

      const onMessage = (msg: unknown) => {
        if (
          settled ||
          typeof msg !== "object" ||
          msg === null ||
          (msg as Record<string, unknown>).type !== "ready"
        ) {
          return;
        }
        settled = true;
        cleanup();
        const meta = this.workers.get(worker.id);
        if (meta) meta.state = "ready";
        resolve();
      };

      const onExit = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`worker ${worker.id} exited before ready`));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeListener("message", onMessage);
        worker.removeListener("exit", onExit);
      };

      worker.on("message", onMessage);
      worker.once("exit", onExit);
    });
  }

  /**
   * terminateUnreadyWorker — 终止 readyTimeout 内未就绪的 Worker
   *
   * 该 Worker 是本次 fork 的候选实例，不能让它在超时后继续存活：
   *   - rolling restart 中会造成 N+1 Worker；
   *   - ready 监听器已移除，迟到的 ready 也不会更新 metadata；
   *   - health check 会跳过 starting 状态，无法再回收它。
   *
   * 先标记为 draining，再强制终止。handleWorkerExit 会删除 metadata，
   * 并识别 draining 状态以避免把这次有意终止误触发为 auto-restart。
   */
  private terminateUnreadyWorker(worker: ClusterWorker): void {
    const meta = this.workers.get(worker.id);
    if (meta) meta.state = "draining";

    if (worker.isDead()) return;

    console.warn(
      `[cluster] worker ${worker.id} failed to become ready, terminating`,
    );

    try {
      worker.process.kill("SIGKILL");
    } catch {
      try {
        worker.kill("SIGKILL");
      } catch (err) {
        console.error(
          `[cluster] failed to terminate unready worker ${worker.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /** 注册一次 cluster 全局 Worker exit 监听器。 */
  private registerWorkerExitListener(): void {
    if (this.workerExitListenerRegistered) return;

    cluster.on("exit", this.onClusterWorkerExit);
    this.workerExitListenerRegistered = true;
  }

  /**
   * 在终止生命周期中移除全局 exit 监听器。
   *
   * 启动失败和 graceful shutdown 时，最后一个 Worker 的 exit 仍需由本
   * 实例处理，因而仅在 workers Map 清空后解绑。正常运行的 Master 即使
   * 暂时没有 Worker，也保留监听器以支持既有 auto-restart 语义。
   */
  private removeWorkerExitListenerIfTerminated(): void {
    if (
      !this.workerExitListenerRegistered ||
      this.workers.size > 0 ||
      (!this.startupFailed && !this.isShuttingDown)
    ) {
      return;
    }

    cluster.off("exit", this.onClusterWorkerExit);
    this.workerExitListenerRegistered = false;
  }

  /**
   * handleWorkerMessage — 处理 Worker → Master 的 IPC 消息
   *
   * 消息类型：
   *   - ready:           Worker 就绪（由 waitForWorkerReady 处理）
   *   - heartbeat:       更新 lastHeartbeat 时间戳
   *   - metrics:         存储最新指标快照
   *   - request-restart: Worker 主动请求重启（如内存超阈值）
   */
  private handleWorkerMessage(worker: ClusterWorker, msg: unknown): void {
    if (typeof msg !== "object" || msg === null) return;

    const message = msg as WorkerToMasterMessage;

    switch (message.type) {
      case "heartbeat": {
        const meta = this.workers.get(worker.id);
        if (meta) {
          meta.lastHeartbeat = Date.now();
        }
        break;
      }

      case "metrics": {
        this.workerMetrics.set(worker.id, message.data);
        break;
      }

      case "request-restart": {
        console.log(
          `[cluster] worker ${worker.id} requested restart: ${message.reason}`,
        );
        // 异步替换：fork 新 Worker → 关闭旧 Worker
        this.replaceWorker(worker).catch((err) => {
          console.error(
            `[cluster] failed to replace worker ${worker.id}: ${(err as Error).message}`,
          );
        });
        break;
      }

      // 'ready' 在 waitForWorkerReady 中处理，此处忽略
      case "ready":
        break;
    }
  }

  /**
   * replaceWorker — 替换单个 Worker（用于 request-restart 场景）
   *
   * 流程：
   *   1. Fork 新 Worker
   *   2. 等待新 Worker ready
   *   3. 通知旧 Worker shutdown
   *   4. 等待旧 Worker 退出
   */
  private async replaceWorker(oldWorker: ClusterWorker): Promise<void> {
    if (this.isShuttingDown || this.isReloading) return;

    try {
      await this.forkWorker();

      if (!oldWorker.isDead()) {
        const meta = this.workers.get(oldWorker.id);
        if (meta) meta.state = "draining";
        oldWorker.send({
          type: "shutdown",
          timeout: this.config.reload.shutdownTimeout,
        });
        await this.waitForWorkerExit(
          oldWorker,
          this.config.reload.shutdownTimeout,
        );
      }
    } catch (err) {
      console.error(
        `[cluster] worker replacement failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * handleWorkerExit — Worker 退出事件处理
   *
   * 决策树：
   *   1. 调用方拥有的未 ready 候选 → 跳过（调用方决定失败语义）
   *   2. 正在关闭 → 跳过（gracefulShutdown 已处理）
   *   3. 状态为 draining → 跳过（正常替换或 readyTimeout 回收）
   *   4. autoRestart=false → 检查是否所有 Worker 都已退出
   *   5. 频率保护命中 → 暂停自动重启 + 发射事件
   *   6. 正常场景 → 指数退避后重启
   */
  private handleWorkerExit(
    worker: ClusterWorker,
    code: number | null,
    signal: string | null,
  ): void {
    const meta = this.workers.get(worker.id);
    const wasOwnedStartupCandidate = this.ownedStartupWorkerIds.delete(
      worker.id,
    );
    this.workers.delete(worker.id);
    this.workerMetrics.delete(worker.id);

    const exitInfo = signal ? `signal ${signal}` : `code ${code}`;
    console.log(
      `[cluster] worker ${worker.id} (pid: ${worker.process.pid}) exited: ${exitInfo}`,
    );

    this.emit("worker-exit", {
      workerId: worker.id,
      code,
      signal,
    } satisfies ClusterMasterEvents["worker-exit"]);

    // 正在关闭 → 不重启
    if (this.isShuttingDown) {
      this.removeWorkerExitListenerIfTerminated();
      return;
    }

    // 初始启动、rolling restart 和 request-restart 的未 ready 候选由各自
    // 调用方处理。已经 ready 的 Worker 不在该集合中，因此即使后续启动
    // 尚未完成，异常退出也会走正常 auto-restart，维持目标容量。
    if (wasOwnedStartupCandidate) {
      this.removeWorkerExitListenerIfTerminated();
      return;
    }

    // 正常替换流程中的旧 Worker 退出 → 不重启
    if (meta?.state === "draining") {
      this.removeWorkerExitListenerIfTerminated();
      return;
    }

    // 自动重启禁用 → 检查是否所有 Worker 已退出
    if (!this.config.autoRestart) {
      this.checkAllDead();
      return;
    }

    // 频率保护
    if (this.isRestartThrottled()) {
      console.error(
        `[cluster] ❌ restart rate exceeded (${this.config.maxRestarts} in ${this.config.restartWindow}ms), pausing auto-restart`,
      );
      this.emit("restart-throttled", {
        workerId: worker.id,
        code,
        signal,
      } satisfies ClusterMasterEvents["restart-throttled"]);
      this.checkAllDead();
      return;
    }

    // 指数退避重启
    const delay = this.calculateRestartDelay();
    console.log(`[cluster] restarting worker in ${delay}ms...`);

    setTimeout(async () => {
      if (this.isShuttingDown) return;
      try {
        await this.forkWorker({ retryOnEarlyExit: true });
      } catch (err) {
        console.error(
          `[cluster] failed to spawn replacement: ${(err as Error).message}`,
        );
        this.checkAllDead();
      }
    }, delay);
  }

  // ── 频率保护 + 指数退避 ──────────────────────────────────

  /**
   * isRestartThrottled — 检测是否超过重启频率限制
   *
   * 在 restartWindow 毫秒窗口内，重启次数是否超过 maxRestarts。
   * 每次调用时记录当前时间戳并清理过期记录。
   */
  private isRestartThrottled(): boolean {
    const now = Date.now();
    this.restartTimestamps.push(now);

    // 清理窗口外的记录
    this.restartTimestamps = this.restartTimestamps.filter(
      (t) => t > now - this.config.restartWindow,
    );

    return this.restartTimestamps.length > this.config.maxRestarts;
  }

  /**
   * calculateRestartDelay — 计算指数退避延迟
   *
   * delay = baseDelay × 2^(consecutiveRestarts - 1)
   * 上限 = maxDelay（默认 30s）
   *
   * 避免崩溃循环时频繁 fork 消耗系统资源。
   */
  private calculateRestartDelay(): number {
    const exponent = Math.max(0, this.restartTimestamps.length - 1);
    return Math.min(
      this.config.restartBaseDelay * 2 ** exponent,
      this.config.restartMaxDelay,
    );
  }

  // ── 信号处理 ──────────────────────────────────────────────

  /**
   * registerSignals — 注册 OS 信号处理器
   *
   * | 信号     | 行为           |
   * |---------|---------------|
   * | SIGTERM | 优雅关闭       |
   * | SIGINT  | 同 SIGTERM     |
   * | SIGHUP  | Rolling Restart |
   * | SIGUSR2 | 同 SIGHUP      |
   *
   * Windows 不支持 SIGHUP / SIGUSR2，仅注册 SIGTERM / SIGINT。
   */
  private registerSignals(): void {
    const registerHandler = (signal: string, handler: () => void) => {
      process.on(signal, handler);
      this.signalHandlers.push({ signal, handler });
    };

    registerHandler("SIGTERM", () => {
      this.gracefulShutdown("SIGTERM").catch((err) => {
        console.error(`[cluster] shutdown error: ${(err as Error).message}`);
        process.exit(1);
      });
    });

    registerHandler("SIGINT", () => {
      this.gracefulShutdown("SIGINT").catch((err) => {
        console.error(`[cluster] shutdown error: ${(err as Error).message}`);
        process.exit(1);
      });
    });

    // Windows 不支持 SIGHUP / SIGUSR2
    if (process.platform !== "win32") {
      registerHandler("SIGHUP", () => {
        this.rollingRestart("SIGHUP").catch((err) => {
          console.error(
            `[cluster] rolling restart error: ${(err as Error).message}`,
          );
        });
      });

      registerHandler("SIGUSR2", () => {
        this.rollingRestart("SIGUSR2").catch((err) => {
          console.error(
            `[cluster] rolling restart error: ${(err as Error).message}`,
          );
        });
      });
    }
  }

  /**
   * removeSignalHandlers — 移除所有已注册的信号处理器
   */
  private removeSignalHandlers(): void {
    for (const { signal, handler } of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers = [];
  }

  // ── 健康检查 ──────────────────────────────────────────────

  /**
   * startHealthCheck — 启动定期健康检查
   *
   * 检查逻辑（每 interval 毫秒执行一次）：
   *   1. 遍历所有 ready 状态的 Worker
   *   2. 检查 lastHeartbeat 是否超过 timeout
   *   3. 超时 → 标记 Worker 为死亡，SIGKILL 终止
   *      （handleWorkerExit 会触发自动重启）
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      if (this.isShuttingDown) return;

      const now = Date.now();

      for (const [id, meta] of this.workers) {
        // 只检查已就绪的 Worker（starting 状态的由 readyTimeout 覆盖）
        if (meta.state !== "ready") continue;

        const elapsed = now - meta.lastHeartbeat;

        if (elapsed > this.config.healthCheck.timeout) {
          console.warn(
            `[cluster] worker ${id} heartbeat timeout (${Math.round(elapsed / 1000)}s > ${Math.round(this.config.healthCheck.timeout / 1000)}s), killing`,
          );

          this.emit("heartbeat-timeout", {
            workerId: id,
            lastHeartbeat: meta.lastHeartbeat,
          } satisfies ClusterMasterEvents["heartbeat-timeout"]);

          const worker = cluster.workers?.[id];
          if (worker && !worker.isDead()) {
            meta.state = "dead";
            worker.process.kill("SIGKILL");
          }
        }
      }
    }, this.config.healthCheck.interval);

    // 不阻止 Master 进程退出
    this.healthCheckTimer.unref();
  }

  /**
   * stopHealthCheck — 停止健康检查定时器
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ── Worker 退出等待 ──────────────────────────────────────

  /**
   * waitForWorkerExit — 等待 Worker 退出（带超时保护）
   *
   * 超时后对 Worker 发送 SIGKILL 强制终止。
   */
  private waitForWorkerExit(
    worker: ClusterWorker,
    timeout: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      worker.once("exit", () => {
        clearTimeout(timer);
        done();
      });

      const timer = setTimeout(() => {
        if (!worker.isDead()) {
          console.warn(
            `[cluster] worker ${worker.id} shutdown timeout (${timeout}ms), SIGKILL`,
          );
          try {
            worker.process.kill("SIGKILL");
          } catch {
            // 进程可能已经退出
          }
        }
        done();
      }, timeout);

      // 不阻止进程退出
      timer.unref();
    });
  }

  // ── 清理 ──────────────────────────────────────────────────

  /**
   * checkAllDead — 检查是否所有 Worker 已退出
   *
   * 当所有 Worker 都已退出且不在关闭/重载流程中时，
   * 发射 'all-workers-dead' 事件。
   */
  private checkAllDead(): void {
    if (this.workers.size === 0) {
      this.emit("all-workers-dead");
    }
  }

  /**
   * cleanup — 清理资源
   *
   * 关闭定时器 + 移除信号处理器 + 删除 PID 文件。
   */
  private cleanup(): void {
    this.stopHealthCheck();
    this.removeSignalHandlers();
    this.removeWorkerExitListenerIfTerminated();

    const pidResult = removePidFile(this.config.pidFile);
    if (!pidResult.ok && pidResult.error) {
      console.warn(`[cluster] ${pidResult.error}`);
    }
  }
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * sleep — 延迟指定毫秒
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

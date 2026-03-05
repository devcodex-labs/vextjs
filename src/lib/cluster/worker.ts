import type { VextApp } from "../../types/app.js";
import type { AppInternals } from "../app.js";
import type { VextServerHandle } from "../../types/adapter.js";
import type {
  WorkerHeartbeatMessage,
  WorkerMetricsMessage,
  WorkerReadyMessage,
  WorkerRequestRestartMessage,
  MasterToWorkerMessage,
} from "./ipc-types.js";
import { checkClusterCompatibility } from "./cluster-checks.js";

/**
 * worker.ts — Cluster Worker 进程入口
 *
 * Worker 进程运行实际的 Vext 应用：
 *
 *   1. 执行完整的 bootstrap 流程
 *   2. 监听 HTTP 端口（通过 node:cluster 共享）
 *   3. 响应 Master 的管理指令（shutdown / set-title / health-check / broadcast）
 *   4. 定期发送心跳给 Master（证明存活）
 *   5. 定期上报运行指标（内存、请求计数等）
 *   6. 监控堆内存，超阈值时主动请求重启
 *
 * 调用方式：
 *   Worker 进程由 ClusterMaster.forkWorker() 通过 cluster.fork() 创建。
 *   fork 时设置环境变量 VEXT_WORKER_ID 和 VEXT_MODE='start'。
 *   bootstrap.ts 的自执行入口检测到 cluster.isWorker 时调用 workerMain()。
 *
 * @module lib/cluster/worker
 * @see 12b-worker.md §2（Worker 入口）
 * @see 12b-worker.md §4（心跳机制）
 * @see 12b-worker.md §5（指标上报）
 * @see 12b-worker.md §6（内存阈值自动重启）
 */

// ── 常量 ────────────────────────────────────────────────────

/** 心跳发送间隔（毫秒） */
const HEARTBEAT_INTERVAL = 10_000;

/** 指标上报间隔（毫秒） */
const METRICS_INTERVAL = 30_000;

/** 默认内存阈值（字节）— 1GB */
const DEFAULT_MEMORY_THRESHOLD = 1024 * 1024 * 1024;

/** 内存检测间隔（毫秒）— 1 分钟 */
const MEMORY_CHECK_INTERVAL = 60_000;

// ── Worker 配置 ────────────────────────────────────────────

/**
 * Worker 运行时配置
 *
 * 从环境变量和 VextConfig 中提取。
 */
export interface WorkerConfig {
  /** Worker 编号（来自 VEXT_WORKER_ID 环境变量） */
  workerId: string;

  /**
   * 内存阈值（字节）
   *
   * 堆内存超过此值时 Worker 主动请求 Master 重启。
   * 可通过 config.cluster.memoryThreshold 配置。
   *
   * @default 1073741824 (1GB)
   */
  memoryThreshold: number;

  /**
   * Worker 数量（用于 cluster 兼容性检测）
   *
   * 由 Master 通过 VEXT_WORKER_COUNT 环境变量传入。
   */
  workerCount: number;
}

// ── Worker 上下文 ──────────────────────────────────────────

/**
 * WorkerContext — Worker 运行时上下文
 *
 * 持有所有定时器和资源引用，便于统一清理。
 */
interface WorkerContext {
  /** 心跳定时器 */
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  /** 指标上报定时器 */
  metricsTimer: ReturnType<typeof setInterval> | null;
  /** 内存检测定时器 */
  memoryCheckTimer: ReturnType<typeof setInterval> | null;
  /** bootstrap 返回的资源引用 */
  app: VextApp | null;
  internals: AppInternals | null;
  serverHandle: VextServerHandle | null;
  /** 是否已触发关闭 */
  isShuttingDown: boolean;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * workerMain — Worker 进程主入口
 *
 * 由 bootstrap.ts 在 cluster.isWorker 且 VEXT_MODE='start' 时调用。
 *
 * 完整流程：
 *   1. 读取环境变量，确定 Worker 编号和配置
 *   2. 执行标准 bootstrap()（完整启动流程）
 *   3. 注册 IPC 消息处理器（响应 Master 指令）
 *   4. 通知 Master 已就绪（发送 'ready' 消息）
 *   5. 启动心跳定时器
 *   6. 启动指标上报定时器
 *   7. 启动内存检测定时器
 *   8. 执行 cluster 兼容性检测（打印 WARN）
 *
 * 错误处理：
 *   bootstrap 失败 → 打印错误 → process.exit(1)
 *   Master 连接断开（disconnect）→ 触发优雅关闭
 *
 * @param rootDir 用户项目根目录（与 bootstrap 共用）
 * @param bootstrapFn bootstrap 函数引用（避免循环依赖，由调用方传入）
 *
 * @example
 * ```typescript
 * // 在 bootstrap.ts 的 cluster.isWorker 分支中调用
 * import { workerMain } from './cluster/worker.js'
 * import { bootstrap } from './bootstrap.js'
 *
 * await workerMain(rootDir, bootstrap)
 * ```
 */
export async function workerMain(
  rootDir: string,
  bootstrapFn: (rootDir: string) => Promise<{
    app: VextApp;
    serverHandle: VextServerHandle;
    internals: AppInternals;
  }>,
): Promise<void> {
  const workerId = process.env.VEXT_WORKER_ID || "?";
  const workerCount = parseInt(process.env.VEXT_WORKER_COUNT || "1", 10);
  const memoryThreshold = parseInt(
    process.env.VEXT_MEMORY_THRESHOLD || String(DEFAULT_MEMORY_THRESHOLD),
    10,
  );

  const config: WorkerConfig = {
    workerId,
    memoryThreshold: Number.isNaN(memoryThreshold)
      ? DEFAULT_MEMORY_THRESHOLD
      : memoryThreshold,
    workerCount: Number.isNaN(workerCount) ? 1 : workerCount,
  };

  // ── 初始化上下文 ──────────────────────────────────────
  const ctx: WorkerContext = {
    heartbeatTimer: null,
    metricsTimer: null,
    memoryCheckTimer: null,
    app: null,
    internals: null,
    serverHandle: null,
    isShuttingDown: false,
  };

  try {
    // ── 1. 执行标准 bootstrap ────────────────────────────
    const result = await bootstrapFn(rootDir);
    ctx.app = result.app;
    ctx.internals = result.internals;
    ctx.serverHandle = result.serverHandle;

    // ── 2. 注册 IPC 消息处理器 ──────────────────────────
    registerIPCHandlers(ctx, config);

    // ── 3. 注册 disconnect 处理器 ──────────────────────
    //
    // Master 崩溃或被 SIGKILL 时，IPC channel 断开。
    // Worker 检测到后自行优雅关闭，避免成为孤儿进程。
    //
    process.on("disconnect", () => {
      console.log(
        `[worker:${config.workerId}] master disconnected, shutting down`,
      );
      shutdownWorker(ctx, config);
    });

    // ── 4. 通知 Master 已就绪 ────────────────────────────
    sendToMaster({
      type: "ready",
      pid: process.pid,
      workerId: config.workerId,
    });

    // ── 5. 启动心跳 ──────────────────────────────────────
    ctx.heartbeatTimer = startHeartbeat();

    // ── 6. 启动指标上报 ──────────────────────────────────
    ctx.metricsTimer = startMetricsReporter(ctx.app);

    // ── 7. 启动内存检测 ──────────────────────────────────
    ctx.memoryCheckTimer = startMemoryMonitor(config);

    // ── 8. Cluster 兼容性检测 ────────────────────────────
    checkClusterCompatibility(ctx.app, config.workerCount);

    console.log(
      `[worker:${config.workerId}] ready (pid: ${process.pid})`,
    );
  } catch (err) {
    console.error(
      `[worker:${config.workerId}] bootstrap failed:`,
      err,
    );
    cleanupTimers(ctx);
    process.exit(1);
  }
}

// ── IPC 消息处理 ────────────────────────────────────────────

/**
 * registerIPCHandlers — 注册 Master → Worker IPC 消息处理器
 *
 * 处理的消息类型：
 *   - set-title:    设置 process.title
 *   - shutdown:     触发优雅关闭
 *   - health-check: 立即回复心跳
 *   - broadcast:    转发给 app 事件系统（后续扩展用）
 */
function registerIPCHandlers(
  ctx: WorkerContext,
  config: WorkerConfig,
): void {
  process.on("message", (msg: unknown) => {
    if (typeof msg !== "object" || msg === null) return;

    const message = msg as MasterToWorkerMessage;

    switch (message.type) {
      case "set-title": {
        process.title = message.title;
        break;
      }

      case "shutdown": {
        shutdownWorker(ctx, config);
        break;
      }

      case "health-check": {
        // 立即回复心跳（主动探测模式）
        sendToMaster({
          type: "heartbeat",
          pid: process.pid,
          uptime: process.uptime(),
          memory: process.memoryUsage().heapUsed,
        });
        break;
      }

      case "broadcast": {
        // 广播消息可由插件通过 app.on('cluster:broadcast', ...) 监听
        // 当前版本仅打印日志，后续可扩展
        if (ctx.app) {
          ctx.app.logger.debug(
            { payload: message.payload },
            `[worker:${config.workerId}] received broadcast`,
          );
        }
        break;
      }
    }
  });
}

/**
 * shutdownWorker — 触发 Worker 优雅关闭
 *
 * 调用 internals.shutdown(serverHandle) 执行完整的关闭流程：
 *   1. 停止接受新请求
 *   2. 等待飞行中请求完成
 *   3. 执行 onClose 钩子
 *   4. process.exit(0)
 *
 * 同时清理 Worker 自己的定时器（心跳 / 指标 / 内存检测）。
 */
function shutdownWorker(
  ctx: WorkerContext,
  config: WorkerConfig,
): void {
  if (ctx.isShuttingDown) return;
  ctx.isShuttingDown = true;

  console.log(`[worker:${config.workerId}] shutting down...`);

  // 先清理定时器
  cleanupTimers(ctx);

  if (ctx.internals && ctx.serverHandle) {
    ctx.internals
      .shutdown(ctx.serverHandle)
      .catch((err) => {
        console.error(
          `[worker:${config.workerId}] shutdown error:`,
          (err as Error).message,
        );
        process.exit(1);
      });
  } else {
    // internals 不可用（bootstrap 可能未完成），直接退出
    process.exit(0);
  }
}

// ── 心跳 ────────────────────────────────────────────────────

/**
 * startHeartbeat — 启动心跳定时器
 *
 * 每 HEARTBEAT_INTERVAL 毫秒向 Master 发送心跳消息。
 * Master 通过 lastHeartbeat 时间戳检测 Worker 是否存活。
 *
 * 定时器使用 .unref() 不阻止进程退出。
 *
 * @returns 定时器引用（用于清理）
 */
function startHeartbeat(): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    sendToMaster({
      type: "heartbeat",
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage().heapUsed,
    });
  }, HEARTBEAT_INTERVAL);

  timer.unref();
  return timer;
}

// ── 指标上报 ────────────────────────────────────────────────

/**
 * startMetricsReporter — 启动指标上报定时器
 *
 * 每 METRICS_INTERVAL 毫秒向 Master 上报运行指标。
 * 包含内存使用详情、活跃请求数、累计请求数、平均响应时间。
 *
 * 当前版本指标来源：
 *   - 内存：process.memoryUsage()
 *   - 请求计数：固定为 0（后续由 response-wrapper 累加器提供）
 *
 * 定时器使用 .unref() 不阻止进程退出。
 *
 * @param app VextApp 实例
 * @returns 定时器引用（用于清理）
 */
function startMetricsReporter(
  app: VextApp,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    // 尝试从 app 内部获取请求级指标
    // 当前版本使用固定值，后续由 response-wrapper 计数器实现
    const metrics = (app as Record<string, unknown>)._internals as
      | { getMetrics?: () => { activeRequests: number; totalRequests: number; avgResponseTime: number } }
      | undefined;

    const requestMetrics = metrics?.getMetrics?.() ?? {
      activeRequests: 0,
      totalRequests: 0,
      avgResponseTime: 0,
    };

    sendToMaster({
      type: "metrics",
      data: {
        pid: process.pid,
        memory: process.memoryUsage(),
        ...requestMetrics,
      },
    });
  }, METRICS_INTERVAL);

  timer.unref();
  return timer;
}

// ── 内存阈值检测 ────────────────────────────────────────────

/**
 * startMemoryMonitor — 启动内存阈值检测定时器
 *
 * 每 MEMORY_CHECK_INTERVAL 毫秒检查堆内存使用量。
 * 超过阈值时向 Master 发送 'request-restart' 消息，
 * Master 会 fork 新 Worker 替换当前 Worker。
 *
 * 注意：
 *   - 仅发送一次请求（通过 requested 标志防止重复）
 *   - 不立即退出，等待 Master 发送 shutdown 指令
 *   - Worker 继续处理请求直到被替换
 *
 * @param config Worker 配置
 * @returns 定时器引用（用于清理）
 */
function startMemoryMonitor(
  config: WorkerConfig,
): ReturnType<typeof setInterval> {
  let requested = false;

  const timer = setInterval(() => {
    if (requested) return;

    const { heapUsed } = process.memoryUsage();

    if (heapUsed > config.memoryThreshold) {
      requested = true;

      const heapMB = Math.round(heapUsed / 1024 / 1024);
      const thresholdMB = Math.round(config.memoryThreshold / 1024 / 1024);

      console.warn(
        `[worker:${config.workerId}] heap ${heapMB}MB > threshold ${thresholdMB}MB, requesting restart`,
      );

      sendToMaster({
        type: "request-restart",
        reason: `heap ${heapMB}MB > ${thresholdMB}MB`,
      });
    }
  }, MEMORY_CHECK_INTERVAL);

  timer.unref();
  return timer;
}

// ── 工具函数 ────────────────────────────────────────────────

/**
 * sendToMaster — 向 Master 发送 IPC 消息
 *
 * 封装 process.send()，添加 null 检查和错误捕获。
 *
 * process.send 不存在的场景：
 *   - 进程不是通过 fork() 创建的
 *   - IPC channel 已断开
 */
function sendToMaster(
  msg:
    | WorkerReadyMessage
    | WorkerHeartbeatMessage
    | WorkerMetricsMessage
    | WorkerRequestRestartMessage,
): void {
  try {
    process.send?.(msg);
  } catch {
    // IPC channel 已关闭或其他通信错误
    // 不抛出 — 避免影响 Worker 正常运行
  }
}

/**
 * cleanupTimers — 清理所有 Worker 定时器
 *
 * 在 Worker 关闭或 bootstrap 失败时调用。
 */
function cleanupTimers(ctx: WorkerContext): void {
  if (ctx.heartbeatTimer) {
    clearInterval(ctx.heartbeatTimer);
    ctx.heartbeatTimer = null;
  }
  if (ctx.metricsTimer) {
    clearInterval(ctx.metricsTimer);
    ctx.metricsTimer = null;
  }
  if (ctx.memoryCheckTimer) {
    clearInterval(ctx.memoryCheckTimer);
    ctx.memoryCheckTimer = null;
  }
}

// ── 导出（仅供测试使用的内部常量和函数） ──────────────────

/**
 * @internal 仅供单元测试直接访问
 */
export const _internals = {
  HEARTBEAT_INTERVAL,
  METRICS_INTERVAL,
  DEFAULT_MEMORY_THRESHOLD,
  MEMORY_CHECK_INTERVAL,
  sendToMaster,
  cleanupTimers,
  registerIPCHandlers,
  shutdownWorker,
  startHeartbeat,
  startMetricsReporter,
  startMemoryMonitor,
} as const;

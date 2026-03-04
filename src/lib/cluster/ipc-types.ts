/**
 * ipc-types.ts — Cluster IPC 通信消息类型定义
 *
 * 所有 Master ↔ Worker 通信使用 process.send() / process.on('message')。
 * 此文件定义双向消息的类型联合，确保 IPC 消息的类型安全。
 *
 * 消息方向：
 *   - WorkerToMasterMessage: Worker → Master（ready / heartbeat / metrics / request-restart）
 *   - MasterToWorkerMessage: Master → Worker（set-title / shutdown / health-check / broadcast）
 *
 * 设计原则：
 *   - 每个消息必须包含 `type` 字段（字符串字面量），用于 discriminated union
 *   - 尽量保持消息体轻量（序列化开销通过 IPC channel 传输）
 *   - 不传递函数、Symbol 或不可序列化的对象
 *
 * @module lib/cluster/ipc-types
 * @see 12b-worker.md §3（IPC 通信协议）
 */

// ── Worker → Master 消息 ────────────────────────────────────

/**
 * Worker 就绪通知
 *
 * Worker 完成 bootstrap 后发送给 Master。
 * Master 收到后将 worker 状态从 'starting' 改为 'ready'，
 * 并继续 fork 下一个 Worker（串行启动）。
 */
export interface WorkerReadyMessage {
  type: "ready";
  /** Worker 进程 PID */
  pid: number;
  /** Worker 编号（来自 VEXT_WORKER_ID 环境变量） */
  workerId: string;
}

/**
 * Worker 心跳消息
 *
 * 定期发送给 Master，证明 Worker 仍然存活。
 * Master 通过 lastHeartbeat 时间戳检测心跳超时。
 *
 * 发送间隔：10s（HEARTBEAT_INTERVAL）
 * 超时阈值：30s（config.cluster.healthCheck.timeout）
 */
export interface WorkerHeartbeatMessage {
  type: "heartbeat";
  /** Worker 进程 PID */
  pid: number;
  /** Worker 运行时长（秒） */
  uptime: number;
  /** 堆内存使用量（字节） */
  memory: number;
}

/**
 * Worker 指标上报消息
 *
 * 定期发送给 Master，用于监控面板/日志。
 * 发送间隔：30s（METRICS_INTERVAL）
 */
export interface WorkerMetricsMessage {
  type: "metrics";
  data: WorkerMetrics;
}

/**
 * Worker 主动请求重启
 *
 * 当 Worker 检测到异常状态（如内存超阈值），
 * 主动请求 Master 对自己执行替换重启（fork 新 Worker → 关闭自己）。
 */
export interface WorkerRequestRestartMessage {
  type: "request-restart";
  /** 请求重启的原因（日志输出用） */
  reason: string;
}

/**
 * Worker → Master 消息联合类型
 */
export type WorkerToMasterMessage =
  | WorkerReadyMessage
  | WorkerHeartbeatMessage
  | WorkerMetricsMessage
  | WorkerRequestRestartMessage;

// ── Master → Worker 消息 ────────────────────────────────────

/**
 * 设置进程标题
 *
 * Master fork Worker 后立即发送，
 * Worker 收到后执行 process.title = title。
 *
 * 标题格式：`${titlePrefix}:worker:${id}`
 * 便于 ps / top 中区分 Master 和各 Worker。
 */
export interface MasterSetTitleMessage {
  type: "set-title";
  /** 进程标题（如 'vext:worker:1'） */
  title: string;
}

/**
 * 通知 Worker 关闭
 *
 * 优雅关闭或 Rolling Restart 时，Master 发送给 Worker。
 * Worker 收到后执行 internals.shutdown(serverHandle)。
 *
 * timeout 告知 Worker 最长等待时间，
 * 超时后 Master 会对 Worker 发送 SIGKILL。
 */
export interface MasterShutdownMessage {
  type: "shutdown";
  /** 关闭超时（毫秒），超时后 Master 强制 SIGKILL */
  timeout: number;
}

/**
 * 健康检查探测
 *
 * Master 定期发送给 Worker，Worker 收到后应立即回复 heartbeat。
 * 用于主动探测（而非依赖 Worker 自发心跳）。
 */
export interface MasterHealthCheckMessage {
  type: "health-check";
}

/**
 * 广播消息
 *
 * Master 向所有 Worker 广播任意 payload。
 * 用途：缓存清除、配置更新通知等。
 *
 * payload 必须是可 JSON 序列化的值。
 */
export interface MasterBroadcastMessage {
  type: "broadcast";
  /** 广播内容（必须可 JSON 序列化） */
  payload: unknown;
}

/**
 * Master → Worker 消息联合类型
 */
export type MasterToWorkerMessage =
  | MasterSetTitleMessage
  | MasterShutdownMessage
  | MasterHealthCheckMessage
  | MasterBroadcastMessage;

// ── 共享数据结构 ────────────────────────────────────────────

/**
 * Worker 运行时指标
 *
 * 由 Worker 定期收集并上报给 Master。
 * Master 可将这些指标聚合后用于日志、健康检查面板等。
 */
export interface WorkerMetrics {
  /** Worker 进程 PID */
  pid: number;
  /** 内存使用详情 */
  memory: NodeJS.MemoryUsage;
  /** 当前活跃请求数 */
  activeRequests: number;
  /** 累计处理请求数 */
  totalRequests: number;
  /** 平均响应时间（毫秒） */
  avgResponseTime: number;
}

/**
 * Worker 元数据（Master 端维护）
 *
 * 每个 Worker 在 Master 端对应一个 WorkerMeta 实例，
 * 存储在 ClusterMaster.workers Map 中。
 */
export interface WorkerMeta {
  /** cluster.Worker.id */
  id: number;
  /** Worker 启动时间戳（Date.now()） */
  startTime: number;
  /** 累计重启次数 */
  restartCount: number;
  /** 最后收到心跳的时间戳（Date.now()） */
  lastHeartbeat: number;
  /** Worker 当前状态 */
  state: WorkerState;
}

/**
 * Worker 状态枚举
 *
 * 状态机流转：
 *   starting → ready → draining → dead
 *                ↑                  │
 *                └── auto-restart ──┘
 *
 * @see 12c-lifecycle.md §1（状态机）
 */
export type WorkerState = "starting" | "ready" | "draining" | "dead";

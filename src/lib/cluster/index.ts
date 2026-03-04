/**
 * cluster/index.ts — Cluster 模块公共导出入口
 *
 * 集中导出 cluster 子模块的公共 API，
 * 外部通过 import { ... } from './cluster/index.js' 访问。
 *
 * 导出内容：
 *   - ClusterMaster:    Master 进程主类
 *   - workerMain:       Worker 进程入口函数
 *   - resolveWorkerCount: Worker 数量计算
 *   - PID 文件操作:     writePidFile / readPidFile / removePidFile / isProcessAlive
 *   - IPC 类型:         消息类型定义 + WorkerMeta + WorkerMetrics
 *   - Cluster 检测:     checkClusterCompatibility
 *   - 配置类型/默认值:  ClusterMasterConfig / DEFAULT_CLUSTER_CONFIG
 *
 * @module lib/cluster
 * @see 12-cluster.md（多进程 Cluster 设计方案总览）
 */

// ── Master ──────────────────────────────────────────────────

export { ClusterMaster, DEFAULT_CLUSTER_CONFIG } from "./master.js";
export type {
  ClusterMasterConfig,
  ClusterMasterEvents,
} from "./master.js";

// ── Worker ──────────────────────────────────────────────────

export { workerMain } from "./worker.js";
export type { WorkerConfig } from "./worker.js";

// ── Worker 数量计算 ─────────────────────────────────────────

export { resolveWorkerCount } from "./worker-count.js";

// ── PID 文件 ────────────────────────────────────────────────

export {
  writePidFile,
  readPidFile,
  removePidFile,
  isProcessAlive,
  DEFAULT_PID_FILE,
} from "./pid-file.js";
export type { PidFileResult } from "./pid-file.js";

// ── Cluster 兼容性检测 ──────────────────────────────────────

export { checkClusterCompatibility } from "./cluster-checks.js";
export type { ClusterCheckResult } from "./cluster-checks.js";

// ── IPC 消息类型 ────────────────────────────────────────────

export type {
  // Worker → Master
  WorkerToMasterMessage,
  WorkerReadyMessage,
  WorkerHeartbeatMessage,
  WorkerMetricsMessage,
  WorkerRequestRestartMessage,

  // Master → Worker
  MasterToWorkerMessage,
  MasterSetTitleMessage,
  MasterShutdownMessage,
  MasterHealthCheckMessage,
  MasterBroadcastMessage,

  // 共享数据结构
  WorkerMeta,
  WorkerMetrics,
  WorkerState,
} from "./ipc-types.js";

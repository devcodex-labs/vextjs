/**
 * stub-worker.mjs — 极简 Cluster Worker Stub
 *
 * 模拟完整的 Worker IPC 协议，但不启动 HTTP 服务。
 * 用于集成测试中快速验证 Master 的 fork/IPC/健康检查/信号行为。
 *
 * 支持的 IPC 消息（Worker → Master）：
 *   - ready:          启动后立即发送
 *   - heartbeat:      定期发送（间隔可通过环境变量控制）
 *   - metrics:        定期发送
 *   - request-restart: 通过环境变量触发
 *
 * 支持的 IPC 消息（Master → Worker）：
 *   - set-title:      设置 process.title
 *   - shutdown:       触发优雅关闭
 *   - health-check:   立即回复心跳
 *   - broadcast:      打印日志
 *
 * 环境变量控制行为：
 *   VEXT_WORKER_ID          — Worker 编号（由 Master 设置）
 *   STUB_HEARTBEAT_INTERVAL — 心跳间隔（毫秒），默认 1000
 *   STUB_METRICS_INTERVAL   — 指标上报间隔（毫秒），默认 2000
 *   STUB_STARTUP_DELAY      — 启动延迟（毫秒），默认 0（立即 ready）
 *   STUB_STARTUP_DELAY_AFTER_WORKER_ID — 只对编号更大的 Worker 应用启动延迟
 *   STUB_FAIL_ON_START      — 设为 "1" 时启动失败（process.exit(1)）
 *   STUB_STOP_HEARTBEAT     — 设为 "1" 时不发送心跳（模拟心跳超时）
 *   STUB_REQUEST_RESTART    — 设为 "1" 时启动后请求重启（模拟内存超阈值）
 *   STUB_REQUEST_RESTART_DELAY — 请求重启延迟（毫秒），默认 500
 *   STUB_EXIT_AFTER         — 设置后 Worker 在指定毫秒后自行崩溃退出（模拟崩溃）
 *   STUB_EXIT_AFTER_WORKER_ID — 只让指定编号的 Worker 自行崩溃
 *   STUB_EXIT_CODE          — 崩溃退出码，默认 1
 *   STUB_SHUTDOWN_DELAY     — 收到 shutdown 后延迟退出（毫秒），默认 100
 *
 * @module test/integration/cluster/stub-worker
 */

const workerId = process.env.VEXT_WORKER_ID || "?";

// ── 配置 ──────────────────────────────────────────────────

const HEARTBEAT_INTERVAL = parseInt(
  process.env.STUB_HEARTBEAT_INTERVAL || "1000",
  10,
);
const METRICS_INTERVAL = parseInt(
  process.env.STUB_METRICS_INTERVAL || "2000",
  10,
);
const configuredStartupDelay = parseInt(
  process.env.STUB_STARTUP_DELAY || "0",
  10,
);
const startupDelayAfterWorkerId = process.env.STUB_STARTUP_DELAY_AFTER_WORKER_ID
  ? parseInt(process.env.STUB_STARTUP_DELAY_AFTER_WORKER_ID, 10)
  : null;
const STARTUP_DELAY =
  startupDelayAfterWorkerId === null ||
  Number(workerId) > startupDelayAfterWorkerId
    ? configuredStartupDelay
    : 0;
const FAIL_ON_START = process.env.STUB_FAIL_ON_START === "1";
const STOP_HEARTBEAT = process.env.STUB_STOP_HEARTBEAT === "1";
const REQUEST_RESTART = process.env.STUB_REQUEST_RESTART === "1";
const REQUEST_RESTART_DELAY = parseInt(
  process.env.STUB_REQUEST_RESTART_DELAY || "500",
  10,
);
const exitAfterWorkerId = process.env.STUB_EXIT_AFTER_WORKER_ID
  ? parseInt(process.env.STUB_EXIT_AFTER_WORKER_ID, 10)
  : null;
const EXIT_AFTER =
  process.env.STUB_EXIT_AFTER &&
  (exitAfterWorkerId === null || Number(workerId) === exitAfterWorkerId)
    ? parseInt(process.env.STUB_EXIT_AFTER, 10)
    : null;
const EXIT_CODE = parseInt(process.env.STUB_EXIT_CODE || "1", 10);
const SHUTDOWN_DELAY = parseInt(process.env.STUB_SHUTDOWN_DELAY || "100", 10);

// ── 状态 ──────────────────────────────────────────────────

let isShuttingDown = false;
let heartbeatTimer = null;
let metricsTimer = null;
const receivedMessages = [];

// ── 辅助函数 ──────────────────────────────────────────────

function sendToMaster(msg) {
  try {
    if (process.send) {
      process.send(msg);
    }
  } catch {
    // IPC channel 已关闭
  }
}

function log(message) {
  console.log(`[stub-worker:${workerId}] ${message}`);
}

function cleanup() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}

// ── IPC 消息处理（Master → Worker）──────────────────────

process.on("message", (msg) => {
  if (typeof msg !== "object" || msg === null) return;

  receivedMessages.push(msg);

  switch (msg.type) {
    case "set-title": {
      process.title = msg.title;
      log(`title set to: ${msg.title}`);
      break;
    }

    case "shutdown": {
      log(`shutdown received (timeout: ${msg.timeout}ms)`);
      if (isShuttingDown) return;
      isShuttingDown = true;

      cleanup();

      // 模拟优雅关闭延迟
      setTimeout(() => {
        log("exiting gracefully");
        process.exit(0);
      }, SHUTDOWN_DELAY);
      break;
    }

    case "health-check": {
      log("health-check received, replying heartbeat");
      sendToMaster({
        type: "heartbeat",
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed,
      });
      break;
    }

    case "broadcast": {
      log(`broadcast received: ${JSON.stringify(msg.payload)}`);
      break;
    }

    default: {
      log(`unknown message type: ${msg.type}`);
    }
  }
});

// ── Master 断开处理 ──────────────────────────────────────

process.on("disconnect", () => {
  log("master disconnected, exiting");
  cleanup();
  process.exit(0);
});

// ── 启动流程 ────────────────────────────────────────────

async function start() {
  log(`starting (pid: ${process.pid})`);

  // 模拟启动失败
  if (FAIL_ON_START) {
    log("simulated startup failure");
    process.exit(1);
  }

  // 模拟启动延迟
  if (STARTUP_DELAY > 0) {
    log(`waiting ${STARTUP_DELAY}ms before ready`);
    await new Promise((resolve) => setTimeout(resolve, STARTUP_DELAY));
  }

  // 发送 ready
  sendToMaster({
    type: "ready",
    pid: process.pid,
    workerId,
  });
  log(`ready`);

  // 启动心跳
  if (!STOP_HEARTBEAT) {
    heartbeatTimer = setInterval(() => {
      if (isShuttingDown) return;
      sendToMaster({
        type: "heartbeat",
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed,
      });
    }, HEARTBEAT_INTERVAL);
    heartbeatTimer.unref();
  } else {
    log("heartbeat disabled (STUB_STOP_HEARTBEAT=1)");
  }

  // 启动指标上报
  metricsTimer = setInterval(() => {
    if (isShuttingDown) return;
    sendToMaster({
      type: "metrics",
      data: {
        pid: process.pid,
        memory: process.memoryUsage(),
        activeRequests: 0,
        totalRequests: 0,
        avgResponseTime: 0,
      },
    });
  }, METRICS_INTERVAL);
  metricsTimer.unref();

  // 模拟请求重启（内存超阈值场景）
  if (REQUEST_RESTART) {
    setTimeout(() => {
      if (isShuttingDown) return;
      log("requesting restart (simulated memory threshold)");
      sendToMaster({
        type: "request-restart",
        reason: "simulated memory threshold exceeded",
      });
    }, REQUEST_RESTART_DELAY);
  }

  // 模拟延迟崩溃
  if (EXIT_AFTER !== null) {
    setTimeout(() => {
      log(`simulated crash after ${EXIT_AFTER}ms`);
      cleanup();
      process.exit(EXIT_CODE);
    }, EXIT_AFTER);
  }
}

start().catch((err) => {
  console.error(`[stub-worker:${workerId}] startup error:`, err);
  process.exit(1);
});

/**
 * stub-master.mjs — 集成测试用 Cluster Master 启动脚本
 *
 * 使用真实的 ClusterMaster 类，但配置 stub-worker.mjs 作为 Worker 入口。
 * 通过环境变量控制所有配置项，便于集成测试灵活调整行为。
 *
 * 环境变量：
 *   STUB_WORKERS              — Worker 数量，默认 2
 *   STUB_AUTO_RESTART          — 是否自动重启，默认 "1"（启用）
 *   STUB_MAX_RESTARTS          — 窗口内最大重启次数，默认 5
 *   STUB_RESTART_WINDOW        — 重启检测窗口（毫秒），默认 60000
 *   STUB_RESTART_BASE_DELAY    — 重启基础延迟（毫秒），默认 200（测试用较短值）
 *   STUB_RESTART_MAX_DELAY     — 重启最大延迟（毫秒），默认 2000
 *   STUB_HEALTH_CHECK_ENABLED  — 是否启用健康检查，默认 "1"
 *   STUB_HEALTH_CHECK_INTERVAL — 健康检查间隔（毫秒），默认 1000（测试用较短值）
 *   STUB_HEALTH_CHECK_TIMEOUT  — 心跳超时（毫秒），默认 3000（测试用较短值）
 *   STUB_RELOAD_WORKER_DELAY   — Rolling Restart Worker 间隔（毫秒），默认 200
 *   STUB_RELOAD_READY_TIMEOUT  — Worker 就绪超时（毫秒），默认 5000
 *   STUB_RELOAD_SHUTDOWN_TIMEOUT — Worker 关闭超时（毫秒），默认 3000
 *   STUB_PID_FILE              — PID 文件路径，默认 ".vext-test.pid"
 *   STUB_TITLE_PREFIX          — 进程标题前缀，默认 "vext-test"
 *   STUB_STICKY                — 粘性会话模式，默认 "none"
 *
 *   以下环境变量会透传给 stub-worker.mjs（Master fork Worker 时继承）：
 *   STUB_HEARTBEAT_INTERVAL    — Worker 心跳间隔
 *   STUB_METRICS_INTERVAL      — Worker 指标上报间隔
 *   STUB_STARTUP_DELAY         — Worker 启动延迟
 *   STUB_FAIL_ON_START         — Worker 启动失败
 *   STUB_STOP_HEARTBEAT        — Worker 停止心跳
 *   STUB_REQUEST_RESTART       — Worker 请求重启
 *   STUB_REQUEST_RESTART_DELAY — Worker 请求重启延迟
 *   STUB_EXIT_AFTER            — Worker 延迟崩溃
 *   STUB_EXIT_CODE             — Worker 崩溃退出码
 *   STUB_SHUTDOWN_DELAY        — Worker 关闭延迟
 *
 * 用法（由集成测试通过 child_process.fork 启动）：
 *   node test/integration/cluster/stub-master.mjs
 *
 * @module test/integration/cluster/stub-master
 */

import cluster from "node:cluster";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

// ── 解析环境变量配置 ──────────────────────────────────────

function envInt(name, defaultValue) {
  const val = process.env[name];
  if (val === undefined || val === "") return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envBool(name, defaultValue) {
  const val = process.env[name];
  if (val === undefined || val === "") return defaultValue;
  return val === "1" || val === "true";
}

function envString(name, defaultValue) {
  const val = process.env[name];
  return val !== undefined && val !== "" ? val : defaultValue;
}

const config = {
  workers: envInt("STUB_WORKERS", 2),
  autoRestart: envBool("STUB_AUTO_RESTART", true),
  maxRestarts: envInt("STUB_MAX_RESTARTS", 5),
  restartWindow: envInt("STUB_RESTART_WINDOW", 60_000),
  restartBaseDelay: envInt("STUB_RESTART_BASE_DELAY", 200),
  restartMaxDelay: envInt("STUB_RESTART_MAX_DELAY", 2000),
  healthCheck: {
    enabled: envBool("STUB_HEALTH_CHECK_ENABLED", true),
    interval: envInt("STUB_HEALTH_CHECK_INTERVAL", 1000),
    timeout: envInt("STUB_HEALTH_CHECK_TIMEOUT", 3000),
  },
  reload: {
    workerDelay: envInt("STUB_RELOAD_WORKER_DELAY", 200),
    readyTimeout: envInt("STUB_RELOAD_READY_TIMEOUT", 5000),
    shutdownTimeout: envInt("STUB_RELOAD_SHUTDOWN_TIMEOUT", 3000),
  },
  pidFile: envString("STUB_PID_FILE", join(PROJECT_ROOT, ".vext-test.pid")),
  titlePrefix: envString("STUB_TITLE_PREFIX", "vext-test"),
  sticky: envString("STUB_STICKY", "none"),
};

// ── 配置 cluster.setupPrimary ─────────────────────────────
//
// 让 cluster.fork() 创建的 Worker 执行 stub-worker.mjs
// 而不是默认的当前脚本

const stubWorkerPath = join(__dirname, "stub-worker.mjs");

cluster.setupPrimary({
  exec: stubWorkerPath,
  // 不需要额外的 execArgv（stub-worker 是纯 .mjs，Node.js 原生支持）
  execArgv: [],
});

// ── 动态导入 ClusterMaster ────────────────────────────────

async function main() {
  try {
    const clusterModulePath = pathToFileURL(
      join(PROJECT_ROOT, "dist", "lib", "cluster", "index.js"),
    ).href;
    const { ClusterMaster } = await import(clusterModulePath);

    const master = new ClusterMaster(config);

    // ── 注册事件（输出日志供集成测试检测）──────────────

    master.on("worker-ready", ({ workerId, pid }) => {
      console.log(
        `[test-master] event:worker-ready workerId=${workerId} pid=${pid}`,
      );
    });

    master.on("worker-exit", ({ workerId, code, signal }) => {
      console.log(
        `[test-master] event:worker-exit workerId=${workerId} code=${code} signal=${signal}`,
      );
    });

    master.on("restart-throttled", ({ workerId, code, signal }) => {
      console.log(
        `[test-master] event:restart-throttled workerId=${workerId} code=${code} signal=${signal}`,
      );
    });

    master.on("reload-start", ({ trigger, workerCount }) => {
      console.log(
        `[test-master] event:reload-start trigger=${trigger} workerCount=${workerCount}`,
      );
    });

    master.on("reload-complete", ({ replaced, total }) => {
      console.log(
        `[test-master] event:reload-complete replaced=${replaced} total=${total}`,
      );
    });

    master.on("heartbeat-timeout", ({ workerId, lastHeartbeat }) => {
      console.log(
        `[test-master] event:heartbeat-timeout workerId=${workerId} lastHeartbeat=${lastHeartbeat}`,
      );
    });

    master.on("all-workers-dead", () => {
      console.log("[test-master] event:all-workers-dead");
    });

    // ── 启动 Master ──────────────────────────────────────

    console.log(
      `[test-master] starting with config: workers=${config.workers} ` +
        `autoRestart=${config.autoRestart} maxRestarts=${config.maxRestarts} ` +
        `healthCheck.enabled=${config.healthCheck.enabled} ` +
        `healthCheck.interval=${config.healthCheck.interval} ` +
        `healthCheck.timeout=${config.healthCheck.timeout}`,
    );

    await master.start();

    console.log("[test-master] master started successfully");

    // ── 通知父进程（集成测试）Master 已就绪 ──────────────
    //
    // 如果是通过 fork() 启动的，向父进程发送 IPC 消息
    if (process.send) {
      process.send({
        type: "master-ready",
        pid: process.pid,
        workerCount: master.getWorkerCount(),
        readyWorkerCount: master.getReadyWorkerCount(),
      });
    }

    // ── 监听父进程（测试框架）的控制消息 ─────────────────

    process.on("message", async (msg) => {
      if (typeof msg !== "object" || msg === null) return;

      switch (msg.type) {
        case "get-status": {
          // 返回当前状态
          if (process.send) {
            const metas = {};
            for (const [id, meta] of master.getWorkerMetas()) {
              metas[id] = { ...meta };
            }
            const metrics = {};
            for (const [id, m] of master.getLatestMetrics()) {
              metrics[id] = { ...m };
            }
            process.send({
              type: "status",
              workerCount: master.getWorkerCount(),
              readyWorkerCount: master.getReadyWorkerCount(),
              targetWorkerCount: master.getTargetWorkerCount(),
              isRunning: master.isRunning(),
              workers: metas,
              metrics,
            });
          }
          break;
        }

        case "broadcast": {
          master.broadcast(msg.payload);
          break;
        }

        case "rolling-restart": {
          try {
            await master.rollingRestart(msg.trigger || "test");
            if (process.send) {
              process.send({ type: "rolling-restart-done" });
            }
          } catch (err) {
            if (process.send) {
              process.send({
                type: "rolling-restart-error",
                error: err.message,
              });
            }
          }
          break;
        }

        case "graceful-shutdown": {
          try {
            await master.gracefulShutdown(msg.trigger || "test");
          } catch (err) {
            console.error(
              `[test-master] graceful shutdown error: ${err.message}`,
            );
          }
          break;
        }
      }
    });
  } catch (err) {
    console.error(`[test-master] startup failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();

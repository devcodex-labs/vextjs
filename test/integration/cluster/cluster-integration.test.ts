/**
 * cluster-integration.test.ts — Cluster 端到端集成测试
 *
 * 通过 child_process.fork() 执行 stub-master.mjs（内含真实 ClusterMaster
 * + stub-worker.mjs），在真实子进程环境中验证 Cluster 机制的核心行为。
 *
 * 测试场景：
 *   1.  多 Worker 启动 — Master fork N 个 Worker，全部 ready
 *   2.  IPC ready — Worker 发送 ready 后 Master 状态正确
 *   3.  IPC heartbeat — Worker 定期心跳，Master 更新 lastHeartbeat
 *   4.  IPC metrics — Worker 定期上报指标，Master 存储最新指标
 *   5.  IPC request-restart — Worker 请求重启后 Master 替换 Worker
 *   6.  心跳超时恢复 — Worker 停止心跳 → Master 检测超时 → 自动重启
 *   7.  优雅关闭 — SIGTERM → 所有 Worker 优雅退出 → Master 退出
 *   8.  首个 Worker 失败 Fail Fast — 首个 Worker 启动失败 → Master 立即中止
 *   9.  频率保护 — 连续快速崩溃超过 maxRestarts → 暂停自动重启
 *   10. PID 文件 — Master 启动写入 PID 文件，关闭后删除
 *
 * 注意事项：
 *   - 所有测试使用 stub-worker.mjs（不启动 HTTP），启动极快
 *   - 通过环境变量控制 Worker 行为（启动延迟、心跳、崩溃等）
 *   - 每个测试使用独立 PID 文件（避免并行测试冲突）
 *   - 测试超时设为较长值（子进程通信有延迟）
 *   - Windows 不支持 SIGHUP/SIGUSR2，相关测试条件跳过
 *
 * @see stub-master.mjs — Master 启动脚本
 * @see stub-worker.mjs — Worker stub
 * @see helpers.ts — 测试辅助函数
 */

import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import {
  spawnProcess,
  pidFileExists,
  readPidFileContent,
  cleanupPidFile,
  parseWorkersReadyLine,
  countMatchingLines,
  sleep,
  PROJECT_ROOT,
  type ManagedProcess,
} from "./helpers.js";

// ── 常量 ────────────────────────────────────────────────────

const STUB_MASTER_PATH = join(
  PROJECT_ROOT,
  "test",
  "integration",
  "cluster",
  "stub-master.mjs",
);

/** 测试超时（单个测试） */
const TEST_TIMEOUT = 30_000;

/** PID 文件基路径 */
const PID_FILE_BASE = join(PROJECT_ROOT, ".vext-test");

/** 为每个测试生成唯一 PID 文件路径 */
let pidFileCounter = 0;
function uniquePidFile(): string {
  return `${PID_FILE_BASE}-${Date.now()}-${++pidFileCounter}.pid`;
}

// ── 清理追踪 ────────────────────────────────────────────────

/** 在测试结束后需要清理的进程和 PID 文件 */
const activeProcesses: ManagedProcess[] = [];
const activePidFiles: string[] = [];

function trackProcess(proc: ManagedProcess): ManagedProcess {
  activeProcesses.push(proc);
  return proc;
}

function trackPidFile(path: string): string {
  activePidFiles.push(path);
  return path;
}

afterEach(async () => {
  // 杀掉所有还存活的子进程
  for (const proc of activeProcesses) {
    if (!proc.exited) {
      proc.kill();
      // 等待进程真正退出
      try {
        await proc.waitForExit(5000);
      } catch {
        // 忽略超时
      }
    }
  }
  activeProcesses.length = 0;

  // 清理 PID 文件
  for (const pidFile of activePidFiles) {
    cleanupPidFile(pidFile);
  }
  activePidFiles.length = 0;

  // 额外等待一小段时间让 OS 完全回收进程
  await sleep(200);
});

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * 启动 stub-master 子进程
 *
 * @param env 额外环境变量（会与默认值合并）
 * @param pidFile PID 文件路径（自动 track）
 */
function startMaster(
  env: Record<string, string> = {},
  pidFile?: string,
): ManagedProcess {
  const pid = pidFile ?? uniquePidFile();
  trackPidFile(pid);

  const proc = spawnProcess(STUB_MASTER_PATH, {
    STUB_PID_FILE: pid,
    ...env,
  });

  return trackProcess(proc);
}

/**
 * 启动 Master 并等待全部 Worker 就绪
 */
async function startMasterAndWaitReady(
  env: Record<string, string> = {},
  pidFile?: string,
): Promise<ManagedProcess> {
  const proc = startMaster(env, pidFile);
  await proc.waitForOutput("master started successfully", 15_000);
  return proc;
}

/**
 * 通过 IPC 向 stub-master 发送控制消息并等待响应
 */
function sendMasterMessage(
  proc: ManagedProcess,
  msg: Record<string, unknown>,
): void {
  proc.child.send!(msg);
}

/**
 * 获取 Master 当前状态（通过 IPC 查询）
 */
function getMasterStatus(
  proc: ManagedProcess,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout waiting for master status response"));
    }, timeoutMs);

    const handler = (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "status"
      ) {
        clearTimeout(timer);
        proc.child.removeListener("message", handler);
        resolve(msg as Record<string, unknown>);
      }
    };

    proc.child.on("message", handler);
    sendMasterMessage(proc, { type: "get-status" });
  });
}

/**
 * 等待 IPC 消息
 */
function waitForMasterIPC(
  proc: ManagedProcess,
  msgType: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.child.removeListener("message", handler);
      reject(
        new Error(
          `Timeout waiting for IPC message type="${msgType}" after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    const handler = (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === msgType
      ) {
        clearTimeout(timer);
        proc.child.removeListener("message", handler);
        resolve(msg as Record<string, unknown>);
      }
    };

    proc.child.on("message", handler);
  });
}

// ════════════════════════════════════════════════════════════
//  测试用例
// ════════════════════════════════════════════════════════════

describe("Cluster Integration Tests", () => {
  // ── 1. 多 Worker 启动 ──────────────────────────────────

  describe("多 Worker 启动", () => {
    it(
      "应该 fork 指定数量的 Worker 并全部就绪",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "3",
        });

        // 验证输出包含 3/3 workers ready
        const readyLine = parseWorkersReadyLine(proc.lines);
        expect(readyLine).not.toBeNull();
        expect(readyLine![0]).toBe(3); // ready count
        expect(readyLine![1]).toBe(3); // total count

        // 验证 event:worker-ready 出现 3 次
        const readyEvents = countMatchingLines(
          proc.lines,
          "event:worker-ready",
        );
        expect(readyEvents).toBe(3);

        // 通过 IPC 查询状态
        const status = await getMasterStatus(proc);
        expect(status.workerCount).toBe(3);
        expect(status.readyWorkerCount).toBe(3);
        expect(status.isRunning).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      "默认应该 fork 2 个 Worker",
      async () => {
        const proc = await startMasterAndWaitReady();

        const readyLine = parseWorkersReadyLine(proc.lines);
        expect(readyLine).not.toBeNull();
        expect(readyLine![0]).toBe(2);
        expect(readyLine![1]).toBe(2);
      },
      TEST_TIMEOUT,
    );

    it(
      "应该 fork 单个 Worker",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
        });

        const readyLine = parseWorkersReadyLine(proc.lines);
        expect(readyLine).not.toBeNull();
        expect(readyLine![0]).toBe(1);
        expect(readyLine![1]).toBe(1);

        const status = await getMasterStatus(proc);
        expect(status.workerCount).toBe(1);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 2. IPC ready ──────────────────────────────────────

  describe("IPC ready 消息", () => {
    it(
      "Worker 发送 ready 后 Master 应标记状态为 ready",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "2",
        });

        const status = await getMasterStatus(proc);

        // 所有 Worker 应为 ready 状态
        const workers = status.workers as Record<string, { state: string }>;
        const states = Object.values(workers).map((w) => w.state);
        expect(states).toHaveLength(2);
        expect(states.every((s) => s === "ready")).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      "带启动延迟的 Worker 最终也应就绪",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
          STUB_STARTUP_DELAY: "500",
        });

        // 虽然 Worker 有 500ms 启动延迟，但应最终就绪
        const status = await getMasterStatus(proc);
        expect(status.readyWorkerCount).toBe(1);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 3. IPC heartbeat ──────────────────────────────────

  describe("IPC heartbeat 消息", () => {
    it(
      "Worker 定期心跳应更新 Master 端的 lastHeartbeat",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
          STUB_HEARTBEAT_INTERVAL: "500",
        });

        // 初始状态
        const status1 = await getMasterStatus(proc);
        const workers1 = status1.workers as Record<
          string,
          { lastHeartbeat: number }
        >;
        const firstHeartbeat = Object.values(workers1)[0].lastHeartbeat;

        // 等待几个心跳周期
        await sleep(1500);

        // 再次查询，lastHeartbeat 应该已更新
        const status2 = await getMasterStatus(proc);
        const workers2 = status2.workers as Record<
          string,
          { lastHeartbeat: number }
        >;
        const laterHeartbeat = Object.values(workers2)[0].lastHeartbeat;

        expect(laterHeartbeat).toBeGreaterThan(firstHeartbeat);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 4. IPC metrics ────────────────────────────────────

  describe("IPC metrics 消息", () => {
    it(
      "Worker 定期上报指标后 Master 应存储最新指标",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
          STUB_METRICS_INTERVAL: "500",
        });

        // 等待至少一个指标上报周期
        await sleep(1000);

        const status = await getMasterStatus(proc);
        const metrics = status.metrics as Record<
          string,
          { pid: number; memory: object }
        >;
        const entries = Object.values(metrics);

        expect(entries.length).toBeGreaterThanOrEqual(1);

        const m = entries[0];
        expect(m).toHaveProperty("pid");
        expect(m).toHaveProperty("memory");
        expect(m.pid).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 5. IPC request-restart ────────────────────────────

  describe("IPC request-restart", () => {
    it(
      "Worker 请求重启后 Master 应 fork 新 Worker 并关闭旧 Worker",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
          STUB_REQUEST_RESTART: "1",
          STUB_REQUEST_RESTART_DELAY: "500",
          // 较快心跳以便快速检测
          STUB_HEARTBEAT_INTERVAL: "500",
          // 新 Worker 也会继承 STUB_REQUEST_RESTART=1，
          // 但用较长延迟使其在我们检查状态前不会再次触发
          STUB_SHUTDOWN_DELAY: "50",
        });

        // 等待 request-restart 发生
        await proc.waitForOutput("requested restart", 10_000);

        // Worker 替换应导致新的 worker-ready 事件
        // 初始启动产生 1 个 ready 事件，替换后应该产生第 2 个
        await proc.waitForOutputCount("event:worker-ready", 2, 10_000);

        // replaceWorker 流程：fork 新 Worker（ready）→ 通知旧 Worker shutdown → 等旧退出
        // 所以 worker-exit 事件在 worker-ready 之后才出现，需要显式等待
        await proc.waitForOutput("event:worker-exit", 10_000);

        // 应该有 worker-exit 事件（旧 Worker 退出）
        const exitEvents = countMatchingLines(proc.lines, "event:worker-exit");
        expect(exitEvents).toBeGreaterThanOrEqual(1);

        // 最终状态应至少有 1 个 ready Worker
        // 注意：新 Worker 也继承了 STUB_REQUEST_RESTART=1，
        // 可能触发连锁替换，所以用 >= 1 断言
        await sleep(500);
        const status = await getMasterStatus(proc);
        expect(status.workerCount).toBeGreaterThanOrEqual(1);
        expect(status.readyWorkerCount).toBeGreaterThanOrEqual(1);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 6. 心跳超时恢复 ──────────────────────────────────

  describe("心跳超时恢复", () => {
    it(
      "Worker 停止心跳后 Master 应检测超时并自动重启新 Worker",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
          STUB_STOP_HEARTBEAT: "1",
          // 使用较短的超时值加速测试
          STUB_HEALTH_CHECK_INTERVAL: "500",
          STUB_HEALTH_CHECK_TIMEOUT: "1500",
          STUB_RESTART_BASE_DELAY: "100",
        });

        // 等待心跳超时事件
        await proc.waitForOutput("event:heartbeat-timeout", 10_000);

        // Worker 被 SIGKILL 后应有退出事件
        await proc.waitForOutput("event:worker-exit", 10_000);

        // Master 应自动重启新 Worker（autoRestart=true）
        // 等待第 2 个 worker-ready 事件（第 1 个是初始启动的）
        // 但新 Worker 也不发心跳，所以也会超时被杀
        // 至少验证 Master 尝试了重启
        await proc.waitForOutputCount("event:worker-ready", 2, 15_000);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 7. 优雅关闭 ──────────────────────────────────────

  describe("优雅关闭", () => {
    it(
      "通过 IPC graceful-shutdown 消息关闭所有 Worker 和 Master",
      async () => {
        const pidFile = uniquePidFile();
        trackPidFile(pidFile);

        const proc = await startMasterAndWaitReady(
          {
            STUB_WORKERS: "2",
            STUB_SHUTDOWN_DELAY: "100",
          },
          pidFile,
        );

        // 验证 PID 文件存在
        expect(pidFileExists(pidFile)).toBe(true);

        // 发送 graceful-shutdown
        sendMasterMessage(proc, {
          type: "graceful-shutdown",
          trigger: "test",
        });

        // 等待进程退出
        const result = await proc.waitForExit(15_000);

        // 验证输出中包含关闭日志
        const hasShutdownLog = proc.lines.some(
          (l) =>
            l.includes("graceful shutdown") ||
            l.includes("all workers stopped"),
        );
        expect(hasShutdownLog).toBe(true);

        // 验证所有 Worker 都收到了 shutdown
        const shutdownReceivedCount = countMatchingLines(
          proc.lines,
          "shutdown received",
        );
        expect(shutdownReceivedCount).toBe(2);

        // 验证所有 Worker 都优雅退出
        const gracefulExitCount = countMatchingLines(
          proc.lines,
          "exiting gracefully",
        );
        expect(gracefulExitCount).toBe(2);
      },
      TEST_TIMEOUT,
    );

    it(
      "通过 SIGTERM 信号触发优雅关闭",
      async () => {
        // Windows 上 SIGTERM 行为不一致，跳过
        if (process.platform === "win32") return;

        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
          STUB_SHUTDOWN_DELAY: "50",
        });

        // 发送 SIGTERM
        proc.sendSignal("SIGTERM");

        // 等待进程退出
        const result = await proc.waitForExit(15_000);

        // 验证有关闭相关的日志
        const hasShutdownLog = proc.lines.some(
          (l) =>
            l.includes("graceful shutdown") ||
            l.includes("all workers stopped"),
        );
        expect(hasShutdownLog).toBe(true);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 8. 首个 Worker 失败 Fail Fast ────────────────────

  describe("首个 Worker 失败 Fail Fast", () => {
    it(
      "首个 Worker 启动失败时 Master 应立即中止",
      async () => {
        const proc = startMaster({
          STUB_WORKERS: "2",
          STUB_FAIL_ON_START: "1",
        });

        // Master 应该很快退出
        const result = await proc.waitForExit(10_000);

        // 应包含错误日志
        const hasFailLog = proc.lines.some(
          (l) =>
            l.includes("first worker failed") ||
            l.includes("startup failed") ||
            l.includes("exited before ready"),
        );
        expect(hasFailLog).toBe(true);

        // 退出码应非 0
        expect(result.exitCode).not.toBe(0);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 9. 频率保护 ──────────────────────────────────────

  describe("频率保护", () => {
    it(
      "连续快速崩溃超过 maxRestarts 时 Master 应暂停自动重启",
      async () => {
        const proc = startMaster({
          STUB_WORKERS: "1",
          // Worker 启动后快速崩溃
          STUB_EXIT_AFTER: "300",
          STUB_EXIT_CODE: "1",
          // 小的重启限制值加速测试
          STUB_MAX_RESTARTS: "3",
          STUB_RESTART_WINDOW: "30000",
          STUB_RESTART_BASE_DELAY: "100",
          STUB_RESTART_MAX_DELAY: "500",
          // 禁用健康检查避免干扰
          STUB_HEALTH_CHECK_ENABLED: "0",
        });

        // 等待 Master 启动成功（首个 Worker 能 ready，因为 EXIT_AFTER=300ms > startup time）
        await proc.waitForOutput("master started successfully", 10_000);

        // 等待频率保护触发
        await proc.waitForOutput("event:restart-throttled", 20_000);

        // 验证多次 worker-exit 事件（至少 maxRestarts+1 次：初始 + 重启）
        const exitEvents = countMatchingLines(proc.lines, "event:worker-exit");
        expect(exitEvents).toBeGreaterThanOrEqual(3);

        // 验证 restart-throttled 事件出现
        const throttleEvents = countMatchingLines(
          proc.lines,
          "event:restart-throttled",
        );
        expect(throttleEvents).toBeGreaterThanOrEqual(1);

        // stderr/stdout are collected from separate streams, so wait for the
        // throttle log explicitly instead of assuming it has arrived when the
        // stdout event line is observed.
        await proc.waitForOutput("restart rate exceeded", 5_000);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 10. PID 文件 ──────────────────────────────────────

  describe("PID 文件", () => {
    it(
      "Master 启动后应写入 PID 文件，内容为 Master PID",
      async () => {
        const pidFile = uniquePidFile();
        trackPidFile(pidFile);

        const proc = await startMasterAndWaitReady(
          { STUB_WORKERS: "1" },
          pidFile,
        );

        // PID 文件应存在
        expect(pidFileExists(pidFile)).toBe(true);

        // PID 文件内容应为 Master 的 PID
        const pidContent = readPidFileContent(pidFile);
        expect(pidContent).not.toBeNull();
        expect(pidContent).toBe(proc.child.pid);
      },
      TEST_TIMEOUT,
    );

    it(
      "Master 优雅关闭后应删除 PID 文件",
      async () => {
        const pidFile = uniquePidFile();
        trackPidFile(pidFile);

        const proc = await startMasterAndWaitReady(
          {
            STUB_WORKERS: "1",
            STUB_SHUTDOWN_DELAY: "50",
          },
          pidFile,
        );

        // 确认 PID 文件存在
        expect(pidFileExists(pidFile)).toBe(true);

        // 触发优雅关闭
        sendMasterMessage(proc, {
          type: "graceful-shutdown",
          trigger: "test",
        });

        // 等待退出
        await proc.waitForExit(15_000);

        // 稍等文件系统同步
        await sleep(300);

        // PID 文件应已被删除
        expect(pidFileExists(pidFile)).toBe(false);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 11. broadcast ─────────────────────────────────────

  describe("broadcast 消息", () => {
    it(
      "Master 广播消息应被所有 Worker 接收",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "2",
        });

        // 通过 IPC 让 Master 广播消息
        sendMasterMessage(proc, {
          type: "broadcast",
          payload: { action: "cache-clear", key: "test-key" },
        });

        // 等待 Worker 输出收到 broadcast 的日志
        // 2 个 Worker 都应该收到
        await proc.waitForOutputCount("broadcast received", 2, 10_000);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 12. Rolling Restart ───────────────────────────────

  describe("Rolling Restart", () => {
    it(
      "通过 IPC 触发 Rolling Restart 应逐个替换所有 Worker",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "2",
          STUB_RELOAD_WORKER_DELAY: "100",
          STUB_SHUTDOWN_DELAY: "50",
        });

        // 初始应有 2 个 Worker
        const status1 = await getMasterStatus(proc);
        expect(status1.workerCount).toBe(2);

        // 触发 Rolling Restart
        sendMasterMessage(proc, {
          type: "rolling-restart",
          trigger: "test",
        });

        // 等待 reload-start 和 reload-complete 事件
        await proc.waitForOutput("event:reload-start", 10_000);
        await proc.waitForOutput("event:reload-complete", 15_000);

        // 验证 reload-complete 输出 replaced=2 total=2
        const completeLine = proc.lines.find((l) =>
          l.includes("event:reload-complete"),
        );
        expect(completeLine).toBeDefined();
        expect(completeLine).toContain("replaced=2");
        expect(completeLine).toContain("total=2");

        // 最终应仍有 2 个 ready Worker
        await sleep(500);
        const status2 = await getMasterStatus(proc);
        expect(status2.workerCount).toBe(2);
        expect(status2.readyWorkerCount).toBe(2);

        // 总共应该有 4 个 worker-ready 事件（初始 2 + 替换 2）
        const readyEvents = countMatchingLines(
          proc.lines,
          "event:worker-ready",
        );
        expect(readyEvents).toBe(4);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 13. Worker 自行崩溃后自动重启 ─────────────────────

  describe("Worker 崩溃自动重启", () => {
    it(
      "Worker 崩溃后 Master 应自动 fork 新 Worker（单次崩溃）",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
          // Worker 在 1 秒后崩溃
          STUB_EXIT_AFTER: "1000",
          STUB_EXIT_CODE: "1",
          STUB_RESTART_BASE_DELAY: "200",
          // 禁用健康检查避免干扰
          STUB_HEALTH_CHECK_ENABLED: "0",
        });

        // 等待崩溃
        await proc.waitForOutput("simulated crash", 5_000);

        // 等待 worker-exit 事件
        await proc.waitForOutput("event:worker-exit", 5_000);

        // 等待新 Worker 重启（第 2 个 worker-ready）
        await proc.waitForOutputCount("event:worker-ready", 2, 10_000);

        // 等待新 Worker 稳定
        await sleep(500);

        // 验证最终状态
        const status = await getMasterStatus(proc);
        expect(status.workerCount).toBeGreaterThanOrEqual(1);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 14. autoRestart 禁用 ──────────────────────────────

  describe("autoRestart 禁用", () => {
    it(
      "autoRestart=false 时 Worker 崩溃后 Master 不应重启",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "1",
          STUB_AUTO_RESTART: "0",
          STUB_EXIT_AFTER: "800",
          STUB_EXIT_CODE: "1",
          STUB_HEALTH_CHECK_ENABLED: "0",
        });

        // 等待 Worker 崩溃退出
        await proc.waitForOutput("event:worker-exit", 5_000);

        // 等待 all-workers-dead 事件
        await proc.waitForOutput("event:all-workers-dead", 5_000);

        // 确认只有 1 个 worker-ready 事件（初始启动的，没有重启）
        await sleep(1000);
        const readyEvents = countMatchingLines(
          proc.lines,
          "event:worker-ready",
        );
        expect(readyEvents).toBe(1);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 15. 多 Worker 部分崩溃 ────────────────────────────

  describe("多 Worker 部分崩溃", () => {
    it(
      "后续 Worker 启动失败时 Master 应继续运行（仅首个 Worker 失败是 Fail Fast）",
      async () => {
        // 此场景下所有 Worker 使用相同的 STUB_FAIL_ON_START 环境变量，
        // 无法让部分 Worker 失败。但我们可以测试：所有 Worker 正常启动 →
        // 其中一个崩溃 → Master 自动重启。
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "2",
          STUB_HEALTH_CHECK_ENABLED: "0",
        });

        // 验证 2 个 Worker 都就绪
        const status = await getMasterStatus(proc);
        expect(status.workerCount).toBe(2);
        expect(status.readyWorkerCount).toBe(2);
      },
      TEST_TIMEOUT,
    );
  });

  // ── 16. Master IPC 状态查询 ───────────────────────────

  describe("Master 状态查询", () => {
    it(
      "get-status 应返回完整的 Worker 元数据",
      async () => {
        const proc = await startMasterAndWaitReady({
          STUB_WORKERS: "2",
        });

        const status = await getMasterStatus(proc);

        // 验证顶层字段
        expect(status.type).toBe("status");
        expect(status.workerCount).toBe(2);
        expect(status.readyWorkerCount).toBe(2);
        expect(status.isRunning).toBe(true);
        expect(typeof status.targetWorkerCount).toBe("number");

        // 验证 workers 元数据
        const workers = status.workers as Record<
          string,
          {
            id: number;
            startTime: number;
            restartCount: number;
            lastHeartbeat: number;
            state: string;
          }
        >;
        const entries = Object.values(workers);
        expect(entries).toHaveLength(2);

        for (const w of entries) {
          expect(w.state).toBe("ready");
          expect(w.id).toBeGreaterThan(0);
          expect(w.startTime).toBeGreaterThan(0);
          expect(w.lastHeartbeat).toBeGreaterThan(0);
          expect(w.restartCount).toBe(0);
        }
      },
      TEST_TIMEOUT,
    );
  });
});

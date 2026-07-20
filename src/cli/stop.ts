import {
  readPidFile,
  isProcessAlive,
  removePidFile,
  DEFAULT_PID_FILE,
} from "../lib/cluster/pid-file.js";
import {
  failUnknownCliArgument,
  readRequiredOptionValueOrExit,
} from "./utils/command-args.js";

/**
 * stop.ts — vext stop CLI 命令
 *
 * 读取 PID 文件，向 Master 进程发送 SIGTERM 触发优雅关闭，
 * 然后轮询等待 Master 进程退出（最长 30s）。
 *
 * 流程：
 *   1. 解析 --pid-file 参数（可选，默认 .vext.pid）
 *   2. readPidFile() 读取 PID 并验证进程存活
 *   3. process.kill(pid, 'SIGTERM') 发送关闭信号
 *   4. 轮询 isProcessAlive() 等待进程退出
 *   5. 进程退出后清理残留 PID 文件（如有）
 *
 * 退出码：
 *   0 — 成功关闭
 *   1 — PID 文件不存在 / 进程不存在 / 超时未退出
 *
 * @module cli/stop
 * @see 09-cli.md §10.1（vext stop）
 * @see 12c-lifecycle.md §7（优雅关闭）
 */

// ── 常量 ────────────────────────────────────────────────────

/** 等待进程退出的最大时间（毫秒） */
const SHUTDOWN_TIMEOUT = 30_000;

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 500;

// ── 类型定义 ────────────────────────────────────────────────

interface StopOptions {
  /** PID 文件路径（覆盖默认值） */
  pidFile: string;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * stopCommand — vext stop CLI 命令入口
 *
 * 解析命令行参数，读取 PID 文件，发送 SIGTERM，等待进程退出。
 *
 * @param args 命令行参数（如 ['--pid-file', '/tmp/app.pid']）
 */
export async function stopCommand(args: string[] = []): Promise<void> {
  // ── 解析命令行参数 ────────────────────────────────────────
  const options = parseStopArgs(args);

  // ── 读取 PID 文件 ─────────────────────────────────────────
  const result = readPidFile(options.pidFile, false);

  if (!result.ok || result.pid === undefined) {
    console.error(
      `[vextjs] ${result.error ?? "PID file not found. Is the server running?"}`,
    );
    process.exit(1);
  }

  const pid = result.pid;

  // ── 验证进程存活 ──────────────────────────────────────────
  if (!isProcessAlive(pid)) {
    console.error(
      `[vextjs] Master process ${pid} is not running (stale PID file).`,
    );
    // 清理残留 PID 文件
    removePidFile(options.pidFile, pid);
    console.log(`[vextjs] Stale PID file removed: ${result.path}`);
    process.exit(1);
  }

  // ── 发送 SIGTERM ──────────────────────────────────────────
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EPERM") {
      console.error(
        `[vextjs] Permission denied: cannot send signal to process ${pid}.`,
      );
      process.exit(1);
    }
    console.error(
      `[vextjs] Failed to send SIGTERM to process ${pid}: ${error.message}`,
    );
    process.exit(1);
  }

  console.log(`[vextjs] SIGTERM sent to master (pid: ${pid})`);

  // ── 轮询等待进程退出 ──────────────────────────────────────
  const exited = await waitForExit(pid, SHUTDOWN_TIMEOUT);

  if (exited) {
    // 清理 PID 文件（Master 正常退出时会自行删除，但以防万一）
    removePidFile(options.pidFile, pid);
    console.log("[vextjs] ✅ Server stopped successfully.");
  } else {
    console.error(
      `[vextjs] ⚠️ Master process ${pid} did not exit within ${SHUTDOWN_TIMEOUT / 1000}s.\n` +
        `         The process may still be draining connections.\n` +
        `         Use "kill -9 ${pid}" to force kill if necessary.`,
    );
    process.exit(1);
  }
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * waitForExit — 轮询等待进程退出
 *
 * 每隔 POLL_INTERVAL 毫秒检查进程是否仍然存活，
 * 直到进程退出或超时。
 *
 * @param pid 要等待的进程 PID
 * @param timeout 最大等待时间（毫秒）
 * @returns 进程是否已退出
 */
async function waitForExit(pid: number, timeout: number): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(POLL_INTERVAL);
  }

  // 最后检查一次
  return !isProcessAlive(pid);
}

/**
 * sleep — Promise 延迟
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 参数解析 ────────────────────────────────────────────────

/**
 * parseStopArgs — 解析 vext stop 的命令行参数
 *
 * 支持的参数：
 *   --pid-file <path>   覆盖 PID 文件路径（默认 .vext.pid）
 *   -h, --help          显示帮助
 *
 * @param args process.argv.slice(2) 的子集（已去除 'stop' 命令本身）
 * @returns 解析后的选项
 */
function parseStopArgs(args: string[]): StopOptions {
  const options: StopOptions = {
    pidFile: DEFAULT_PID_FILE,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--pid-file") {
      const parsed = readRequiredOptionValueOrExit(args, i, arg, "<path>");
      options.pidFile = parsed.value;
      i = parsed.nextIndex;
    } else if (arg === "--help" || arg === "-h") {
      printStopHelp();
      process.exit(0);
    } else {
      failUnknownCliArgument(arg, printStopHelp);
    }
  }

  return options;
}

/**
 * 打印 vext stop 的帮助信息
 */
function printStopHelp(): void {
  console.log(`
  Usage: vext stop [options]

  Stop the running vext server (cluster mode).
  Positional arguments are not supported.
  Options that take values require a non-option value.

  Sends SIGTERM to the master process and waits for graceful shutdown.
  The master will notify all workers to drain connections before exiting.

  Options:
    --pid-file <path>   Path to the PID file (default: .vext.pid)
    -h, --help          Show this help message

  Examples:
    $ vext stop
    $ vext stop --pid-file /var/run/myapp.pid

  Notes:
    This command is only applicable in cluster mode.
    In single-process mode, use Ctrl+C or "kill <pid>" directly.
`);
}

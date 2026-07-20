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
 * reload.ts — vext reload CLI 命令
 *
 * 读取 PID 文件，向 Master 进程发送 SIGHUP 触发零停机滚动重启（Rolling Restart）。
 * Master 收到 SIGHUP 后会逐个替换 Worker（保证至少 N-1 个可用 Worker 持续服务请求）。
 *
 * 流程：
 *   1. 解析 --pid-file 参数（可选，默认 .vext.pid）
 *   2. readPidFile() 读取 PID 并验证进程存活
 *   3. 平台检测：Windows 上 SIGHUP 不可用，提示用户重启服务
 *   4. process.kill(pid, 'SIGHUP') 发送重载信号
 *
 * 退出码：
 *   0 — 信号发送成功
 *   1 — PID 文件不存在 / 进程不存在 / Windows 不支持 / 发送失败
 *
 * Windows 兼容性：
 *   Windows 不支持 SIGHUP / SIGUSR2 信号。在 Windows 上 `vext reload` 会退化为
 *   提示用户执行 `vext stop && vext start` 手动重启服务。
 *   未来可通过 named pipe / TCP 控制通道实现 Windows 上的热重载。
 *
 * @module cli/reload
 * @see 09-cli.md §10.2（vext reload）
 * @see 12c-lifecycle.md §6（零停机重启 Rolling Restart）
 */

// ── 类型定义 ────────────────────────────────────────────────

interface ReloadOptions {
  /** PID 文件路径（覆盖默认值） */
  pidFile: string;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * reloadCommand — vext reload CLI 命令入口
 *
 * 解析命令行参数，读取 PID 文件，发送 SIGHUP 触发 Rolling Restart。
 *
 * @param args 命令行参数（如 ['--pid-file', '/tmp/app.pid']）
 */
export async function reloadCommand(args: string[] = []): Promise<void> {
  // ── 解析命令行参数 ────────────────────────────────────────
  const options = parseReloadArgs(args);

  // ── Windows 平台检测 ──────────────────────────────────────
  //
  // Windows 不支持 POSIX 信号 SIGHUP / SIGUSR2。
  // Node.js 在 Windows 上 process.kill(pid, 'SIGHUP') 会直接终止进程，
  // 而非触发信号处理器，这与预期行为完全不同。
  //
  if (process.platform === "win32") {
    console.error(
      `[vextjs] ⚠️ "vext reload" is not supported on Windows.\n` +
        `         Windows does not support SIGHUP signals for rolling restart.\n` +
        `\n` +
        `         To restart the server, use:\n` +
        `           $ vext stop\n` +
        `           $ vext start\n` +
        `\n` +
        `         A future version may support hot reload on Windows via IPC.`,
    );
    process.exit(1);
  }

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

  // ── 发送 SIGHUP ───────────────────────────────────────────
  //
  // Master 进程中 registerSignals() 注册了 SIGHUP → rollingRestart('SIGHUP')，
  // 收到信号后会自动逐个替换 Worker。
  //
  try {
    process.kill(pid, "SIGHUP");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EPERM") {
      console.error(
        `[vextjs] Permission denied: cannot send signal to process ${pid}.`,
      );
      process.exit(1);
    }
    console.error(
      `[vextjs] Failed to send SIGHUP to process ${pid}: ${error.message}`,
    );
    process.exit(1);
  }

  console.log(
    `[vextjs] ✅ Reload signal (SIGHUP) sent to master (pid: ${pid}).`,
  );
  console.log(
    `[vextjs] Rolling restart in progress - workers will be replaced one by one.`,
  );
}

// ── 参数解析 ────────────────────────────────────────────────

/**
 * parseReloadArgs — 解析 vext reload 的命令行参数
 *
 * 支持的参数：
 *   --pid-file <path>   覆盖 PID 文件路径（默认 .vext.pid）
 *   -h, --help          显示帮助
 *
 * @param args process.argv.slice(2) 的子集（已去除 'reload' 命令本身）
 * @returns 解析后的选项
 */
function parseReloadArgs(args: string[]): ReloadOptions {
  const options: ReloadOptions = {
    pidFile: DEFAULT_PID_FILE,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--pid-file") {
      const parsed = readRequiredOptionValueOrExit(args, i, arg, "<path>");
      options.pidFile = parsed.value;
      i = parsed.nextIndex;
    } else if (arg === "--help" || arg === "-h") {
      printReloadHelp();
      process.exit(0);
    } else {
      failUnknownCliArgument(arg, printReloadHelp);
    }
  }

  return options;
}

/**
 * 打印 vext reload 的帮助信息
 */
function printReloadHelp(): void {
  console.log(`
  Usage: vext reload [options]

  Trigger a zero-downtime rolling restart (cluster mode).
  Positional arguments are not supported.
  Options that take values require a non-option value.

  Sends SIGHUP to the master process, which replaces workers one by one.
  At least N-1 workers remain available during the restart process.

  Options:
    --pid-file <path>   Path to the PID file (default: .vext.pid)
    -h, --help          Show this help message

  Examples:
    $ vext reload
    $ vext reload --pid-file /var/run/myapp.pid

  Notes:
    This command is only applicable in cluster mode on Unix/macOS.
    Windows does not support SIGHUP — use "vext stop && vext start" instead.
`);
}

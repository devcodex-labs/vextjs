import { fork } from "node:child_process";
import { resolve } from "node:path";
import {
  detectProject,
  hasDistBuild,
  resolveEntryFile,
} from "./utils/detect-project.js";

/**
 * vext start — 生产模式启动命令（Phase 1）
 *
 * 启动流程：
 *   1. 解析用户项目根目录（默认 process.cwd()）
 *   2. detectProject() 检测项目结构（src/ / config/ / tsconfig.json）
 *   3. 检测 dist/ 编译产物是否存在
 *   4. 解析实际入口文件路径（dist/ 优先，否则 node_modules/vextjs/dist/）
 *   5. fork 子进程运行 bootstrap.ts/bootstrap.js
 *   6. 转发 SIGTERM / SIGINT 给子进程（触发优雅关闭）
 *
 * dist/ 检测逻辑：
 *   - dist/ 存在 → 使用 node 直接运行编译后的 JS（无需 tsx）
 *   - dist/ 不存在 + TS 项目 → 使用 --import tsx/esm 运行
 *   - dist/ 不存在 + JS 项目 → 使用 node 直接运行
 *
 * 环境变量：
 *   - VEXT_MODE=start — 告知 bootstrap.ts 是被 CLI fork 的（触发自执行入口）
 *   - VEXT_ROOT=<rootDir> — 传递项目根目录给 bootstrap
 *   - VEXT_BUILT=1 — 当使用 dist/ 编译产物时设置
 *   - NODE_ENV — 默认 'production'（如未显式设置）
 *
 * 命令行参数（Phase 1 基础版）：
 *   --port <number>   覆盖配置中的端口
 *   --host <string>   覆盖配置中的监听地址
 *
 * @module cli/start
 * @see 09-cli.md §3（vext start 生产模式）
 * @see IMPLEMENTATION-PLAN.md 任务 1.18
 */

// ── 类型定义 ────────────────────────────────────────────────

interface StartOptions {
  /** 覆盖端口号 */
  port?: number;
  /** 覆盖监听地址 */
  host?: string;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * startCommand — vext start CLI 命令入口
 *
 * 解析命令行参数，检测项目结构，fork 子进程运行 bootstrap。
 *
 * @param args 命令行参数（如 ['--port', '8080']）
 */
export async function startCommand(args: string[] = []): Promise<void> {
  // ── 解析命令行参数 ────────────────────────────────────────
  const options = parseStartArgs(args);

  // ── 检测项目结构 ──────────────────────────────────────────
  const rootDir = resolve(process.cwd());
  const project = detectProject(rootDir);

  // ── 检测 dist/ 编译产物 ──────────────────────────────────
  const hasDist = hasDistBuild(project.rootDir);
  const entryFile = resolveEntryFile(project);

  // ── 打印启动信息 ──────────────────────────────────────────
  if (hasDist) {
    console.log("[vextjs] start mode - built (node, from dist/)");
  } else if (project.language === "ts") {
    console.log("[vextjs] start mode - TypeScript (tsx)");
  } else {
    console.log("[vextjs] start mode - JavaScript (node)");
  }

  // ── 构建子进程 execArgv ──────────────────────────────────
  //
  // execArgv 控制 Node.js 运行时参数（不是应用参数）：
  //   - dist/ 已编译 → 无需额外参数
  //   - TypeScript 项目 → --import tsx/esm（让 Node.js 能加载 .ts 文件）
  //   - JavaScript 项目 → 无需额外参数
  //
  const execArgv: string[] = [];

  if (!hasDist && project.language === "ts") {
    execArgv.push("--import", "tsx/esm");
  }

  // ── 构建环境变量 ──────────────────────────────────────────
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: process.env.NODE_ENV || "production",
    VEXT_MODE: "start",
    VEXT_ROOT: project.rootDir,
  };

  // dist/ 标记（bootstrap 可据此切换 srcDir）
  if (hasDist) {
    env.VEXT_BUILT = "1";
  }

  // 命令行参数覆盖（通过环境变量传递给 bootstrap）
  if (options.port !== undefined) {
    env.VEXT_PORT = String(options.port);
  }
  if (options.host !== undefined) {
    env.VEXT_HOST = options.host;
  }

  // ── fork 子进程 ──────────────────────────────────────────
  //
  // 使用 child_process.fork 而非 exec/spawn：
  //   - fork 创建新的 V8 实例，与 CLI 进程隔离
  //   - 支持 IPC 通信（未来 cluster 模式使用）
  //   - stdio: 'inherit' 共享 stdin/stdout/stderr
  //
  const child = fork(entryFile, [], {
    cwd: project.rootDir,
    execArgv,
    stdio: "inherit",
    env,
  });

  // ── 子进程退出处理 ────────────────────────────────────────
  child.on("exit", (code, signal) => {
    if (signal) {
      // 被信号终止（如 SIGTERM）→ 正常退出
      process.exit(0);
    }
    // 使用子进程的退出码
    process.exit(code ?? 0);
  });

  // ── 子进程错误处理 ────────────────────────────────────────
  child.on("error", (err) => {
    console.error(`[vextjs] Failed to start child process: ${err.message}`);
    process.exit(1);
  });

  // ── 信号转发 ──────────────────────────────────────────────
  //
  // 将 CLI 进程收到的信号转发给子进程，
  // 触发子进程内 bootstrap 注册的优雅关闭流程。
  //
  // 使用 process.once（CLI 进程只需转发一次，
  // 后续由子进程的 exit 事件触发 CLI 进程退出）。
  //
  // 🐛 修复 BUG-014：Windows 上 child.kill('SIGTERM') 不会触发子进程的
  // process.on('SIGTERM') 处理器，而是直接通过 TerminateProcess API 杀死进程，
  // 导致 onClose hooks 不执行、DB 连接池不清理。
  //
  // 解决方案：Windows 上通过 IPC 消息 { type: 'shutdown' } 通知子进程
  // 执行优雅关闭流程。fork() 创建的子进程自带 IPC 通道，无需额外配置。
  // IPC 通道不可用时（child.connected === false）降级为 child.kill()。
  //
  const sendShutdown = () => {
    if (process.platform === "win32" && child.connected) {
      // Windows: 通过 IPC 通知子进程优雅关闭
      child.send({ type: "shutdown" });
      // 超时保护：如果子进程 15s 内未退出，强制终止
      setTimeout(() => {
        if (!child.killed) {
          child.kill();
        }
      }, 15_000).unref();
    } else {
      // Unix: 标准 SIGTERM 信号（触发子进程 process.on('SIGTERM') 处理器）
      child.kill("SIGTERM");
    }
  };

  process.once("SIGTERM", sendShutdown);

  process.once("SIGINT", sendShutdown);
}

// ── 参数解析 ────────────────────────────────────────────────

/**
 * parseStartArgs — 解析 vext start 的命令行参数
 *
 * 支持的参数：
 *   --port <number>   覆盖监听端口
 *   --host <string>   覆盖监听地址
 *
 * 使用手动解析（不引入第三方 CLI 库），保持零依赖。
 *
 * @param args process.argv.slice(2) 的子集（已去除 'start' 命令本身）
 * @returns 解析后的选项
 */
function parseStartArgs(args: string[]): StartOptions {
  const options: StartOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--port" && i + 1 < args.length) {
      const portStr = args[++i]!;
      const port = parseInt(portStr, 10);
      if (Number.isNaN(port) || port < 0 || port > 65535) {
        console.error(`[vextjs] Invalid port number: "${portStr}"`);
        process.exit(1);
      }
      options.port = port;
    } else if (arg === "--host" && i + 1 < args.length) {
      options.host = args[++i]!;
    } else if (arg === "--help" || arg === "-h") {
      printStartHelp();
      process.exit(0);
    } else if (arg?.startsWith("--")) {
      console.error(`[vextjs] Unknown option: "${arg}"\n`);
      printStartHelp();
      process.exit(1);
    }
  }

  return options;
}

/**
 * 打印 vext start 的帮助信息
 */
function printStartHelp(): void {
  console.log(`
  Usage: vext start [options]

  Start the application in production mode.

  Options:
    --port <number>   Override the listening port
    --host <string>   Override the listening host
    -h, --help        Show this help message

  Examples:
    $ vext start
    $ vext start --port 8080
    $ vext start --host 127.0.0.1 --port 3000

  Environment variables:
    NODE_ENV          Set the environment (default: production)
    VEXT_CLUSTER=1    Enable cluster mode
`);
}

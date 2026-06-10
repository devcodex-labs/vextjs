import { fork } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  detectProject,
  inspectDistBuild,
  resolveEntryFile,
} from "./utils/detect-project.js";
import { resolvePreloads } from "./utils/preload.js";
import {
  formatStartupDuration,
  formatStartupProfile,
  formatStartupSummary,
  writeStartupProfileJson,
  type StartupProfileSnapshot,
} from "../lib/startup-profiler.js";
import { printReadyLog } from "../lib/utils/network.js";

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
 *   - TS 项目 + 有效 dist/ → 使用 node 运行编译后的 JS
 *   - TS 项目 + 缺失/无效 dist/ → fail-fast，提示先 vext build
 *   - JS 项目 → 使用 node 直接运行
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
  /** 生命周期日志增强 */
  verboseLifecycle?: boolean;
  /** 端口冲突策略 */
  portConflict?: "error" | "prompt" | "kill" | "next";
  /** 输出启动阶段耗时 */
  startupProfile?: boolean;
  /** 将启动阶段耗时写入 JSON 文件 */
  startupProfileJson?: string;
}

interface StartReadyMessage {
  type: "ready";
  server?: {
    host: string;
    port: number;
  };
  startupProfile?: StartupProfileSnapshot;
  detail?: {
    cluster?: boolean;
    workers?: number;
    totalWorkers?: number;
  };
}

async function promptPortConflictDecision(
  host: string | undefined,
  port: number,
  details?: { pid?: number; command?: string; source?: string },
): Promise<"retry" | "kill" | "next" | "abort"> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "abort";
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const owner = details?.pid
      ? ` pid=${details.pid}${details.command ? ` (${details.command})` : ""}`
      : "";
    const target = `${host ?? "0.0.0.0"}:${port}`;
    const answer = await rl.question(
      `[vextjs] Port ${target} is in use${owner}. Choose: [r]etry / [k]ill / [n]ext / [a]bort: `,
    );

    switch (answer.trim().toLowerCase()) {
      case "r":
      case "retry":
        return "retry";
      case "k":
      case "kill":
        return "kill";
      case "n":
      case "next":
        return "next";
      default:
        return "abort";
    }
  } finally {
    rl.close();
  }
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
  const commandStartedAt = performance.now();
  const readyLogger = {
    info(message: string) {
      console.log(message);
    },
  };

  // ── 检测项目结构 ──────────────────────────────────────────
  const rootDir = resolve(process.cwd());
  const project = detectProject(rootDir);

  // ── 检测 dist/ 编译产物 ──────────────────────────────────
  const dist = inspectDistBuild(project.rootDir);
  const hasDist = project.language === "ts" ? dist.valid : false;
  const entryFile = resolveEntryFile(project);

  if (project.language === "ts" && !dist.valid) {
    printBuildRequiredError(dist);
    process.exit(1);
  }

  // ── 打印启动信息 ──────────────────────────────────────────
  if (hasDist) {
    console.log("[vextjs] start mode - built (node, from dist/)");
  } else {
    console.log("[vextjs] start mode - JavaScript (node)");
  }

  // ── 构建子进程 execArgv ──────────────────────────────────
  //
  // execArgv 控制 Node.js 运行时参数（不是应用参数）：
  //   - dist/ 已编译 → 无需额外参数
  //   - JavaScript 项目 → 无需额外参数
  //
  const execArgv: string[] = [];

  // ── 注入预加载模块 ────────────────────────────────────
  //
  // 扫描直接依赖的 vext.preload 字段，将每个预加载文件以
  // --import <file:///...> 形式追加到 execArgv。
  // 无预加载包时返回 []，不追加任何参数，行为与旧版完全一致。
  //
  const preloads = await resolvePreloads(project.rootDir);
  for (const fileUrl of preloads) {
    execArgv.push("--import", fileUrl);
  }

  // ── 构建环境变量 ──────────────────────────────────────────
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: process.env.NODE_ENV || "production",
    VEXT_MODE: "start",
    VEXT_ROOT: project.rootDir,
    VEXT_START_PARENT_READY_LOG: "1",
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
  if (options.portConflict) {
    env.VEXT_PORT_CONFLICT = options.portConflict;
  }
  if (options.verboseLifecycle) {
    env.VEXT_LIFECYCLE_LEVEL = "verbose";
  }
  if (options.startupProfile || options.startupProfileJson) {
    env.VEXT_START_STARTUP_PROFILE = "1";
  }
  if (options.startupProfile) {
    env.VEXT_START_STARTUP_PROFILE_HUMAN = "1";
  }
  if (options.startupProfileJson) {
    env.VEXT_STARTUP_PROFILE_JSON = options.startupProfileJson;
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
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env,
  });

  child.on("message", async (msg: unknown) => {
    if (typeof msg !== "object" || msg === null) {
      return;
    }

    const payload = msg as Record<string, unknown>;
    if (payload.type === "ready") {
      const readyMessage = payload as unknown as StartReadyMessage;
      if (readyMessage.server) {
        const totalMs = performance.now() - commandStartedAt;
        const workerSuffix =
          readyMessage.detail?.cluster &&
          readyMessage.detail.workers !== undefined &&
          readyMessage.detail.totalWorkers !== undefined
            ? `, workers=${readyMessage.detail.workers}/${readyMessage.detail.totalWorkers}`
            : "";
        printReadyLog(
          readyLogger,
          readyMessage.server.host,
          readyMessage.server.port,
          {
            prefix: "[vextjs]",
            suffix: `(total=${formatStartupDuration(totalMs)}${workerSuffix})`,
          },
        );
      }

      const startupProfile = readyMessage.startupProfile;
      if (startupProfile?.enabled) {
        if (options.startupProfile) {
          console.log(
            formatStartupSummary(startupProfile, { prefix: "[vextjs]" }),
          );
          console.log(
            formatStartupProfile(startupProfile, { prefix: "[vextjs]" }),
          );
        }
        if (options.startupProfileJson) {
          writeStartupProfileJson(options.startupProfileJson, startupProfile);
          console.log(
            `[vextjs] startup profile json: ${options.startupProfileJson}`,
          );
        }
      }
      return;
    }

    if (payload.type === "port-conflict") {
      const action = await promptPortConflictDecision(
        payload.host as string | undefined,
        payload.port as number,
        payload.details as { pid?: number; command?: string; source?: string },
      );
      child.send({ type: "port-conflict-decision", action });
    }
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
    } else if (arg === "--port-conflict" && i + 1 < args.length) {
      const strategy = args[++i]!;
      if (
        strategy !== "error" &&
        strategy !== "prompt" &&
        strategy !== "kill" &&
        strategy !== "next"
      ) {
        console.error(`[vextjs] Invalid --port-conflict value: "${strategy}"`);
        process.exit(1);
      }
      options.portConflict = strategy;
    } else if (arg === "--startup-profile") {
      options.startupProfile = true;
    } else if (arg === "--startup-profile-json" && i + 1 < args.length) {
      options.startupProfileJson = args[++i]!;
    } else if (arg === "--verbose-lifecycle") {
      options.verboseLifecycle = true;
    } else if (arg === "--help" || arg === "-h") {
      printStartHelp();
      process.exit(0);
    } else if (arg?.startsWith("--")) {
      console.error(`[vextjs] Unknown option: "${arg}"\n`);
      printStartHelp();
      process.exit(1);
    }
  }

  if (
    options.portConflict === undefined &&
    process.env.VEXT_PORT_CONFLICT &&
    ["error", "prompt", "kill", "next"].includes(process.env.VEXT_PORT_CONFLICT)
  ) {
    options.portConflict = process.env.VEXT_PORT_CONFLICT as
      | "error"
      | "prompt"
      | "kill"
      | "next";
  }

  if (
    options.verboseLifecycle === undefined &&
    process.env.VEXT_VERBOSE_LIFECYCLE === "1"
  ) {
    options.verboseLifecycle = true;
  }

  if (
    options.startupProfileJson === undefined &&
    process.env.VEXT_STARTUP_PROFILE_JSON
  ) {
    options.startupProfileJson = process.env.VEXT_STARTUP_PROFILE_JSON;
  }

  return options;
}

function printBuildRequiredError(dist: {
  hasDistDir: boolean;
  missing: string[];
}): void {
  const reason = dist.hasDistDir
    ? `invalid dist/ build, missing: ${dist.missing.join(", ")}`
    : "dist/ build not found";

  console.error(
    `[vextjs] Cannot run TypeScript project with vext start: ${reason}.`,
  );
  console.error(
    '[vextjs] Run "vext build" first, or use "vext dev" during development.',
  );
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
    --port-conflict <error|prompt|kill|next>
                       Configure how port conflicts are handled
    --startup-profile  Print startup phase timings
    --startup-profile-json <path>
                       Write startup phase timings to a JSON file
    --verbose-lifecycle
                       Show verbose lifecycle logs
    -h, --help        Show this help message

  Examples:
    $ vext start
    $ vext start --port 8080
    $ vext start --host 127.0.0.1 --port 3000
    $ vext start --port-conflict prompt
    $ vext start --startup-profile

  Environment variables:
    NODE_ENV          Set the environment (default: production)
    VEXT_CLUSTER=1    Enable cluster mode
    VEXT_STARTUP_PROFILE_JSON=<path>
                      Write startup phase timings to a JSON file
    VEXT_PORT_CONFLICT=next
    VEXT_VERBOSE_LIFECYCLE=1
`);
}

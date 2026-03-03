import { resolve, join } from "node:path";
import { detectProject } from "./utils/detect-project.js";
import { ColdRestarter } from "../lib/dev/cold-restarter.js";
import type { ColdRestarterOptions } from "../lib/dev/cold-restarter.js";
import { VextFileWatcher } from "../lib/dev/file-watcher.js";
import type { FileChangeEvent } from "../lib/dev/file-watcher.js";
import { classifyChange } from "../lib/dev/change-classifier.js";
import { shouldUsePolling } from "../lib/dev/detect-polling.js";

/**
 * cli/dev.ts — vext dev 命令实现（Phase 2B）
 *
 * 启动开发模式服务器，集成：
 *   - ColdRestarter：子进程管理（fork / kill / restart）
 *   - FileWatcher：文件变更监听（fs.watch / polling）
 *   - change-classifier：变更分类（cold / soft / ignore）
 *   - Soft Reload（Tier 1/2）：通过 IPC 通知子进程执行热重载
 *   - Cold Restart（Tier 3）：配置/插件变更时完整重启子进程
 *   - 键盘交互：r=restart, h=reload, c=clear, Ctrl+C=quit
 *
 * 三层重载策略：
 *
 *   | Tier | 触发条件              | 动作                                  |
 *   |------|-----------------------|---------------------------------------|
 *   | T1   | 代码修改（modify）     | IPC → 子进程 soft reload（transform） |
 *   | T2   | 文件新增/删除          | IPC → 子进程 soft reload（rebuild）   |
 *   | T3   | 配置/插件/.env 变更    | Cold Restart（kill + fork）           |
 *
 * 降级策略：
 *   - `--no-hot` 选项：所有变更都走 Cold Restart
 *   - 子进程 `request-cold-restart`：级联爆炸时自动降级
 *   - Soft Reload 失败：旧 handler 通过闭包继续服务，等待用户修复
 *
 * 进程架构：
 *   vext dev (主进程)
 *     ├─ FileWatcher（监听 src/ + 根配置文件）
 *     ├─ ColdRestarter（管理子进程生命周期）
 *     └─ stdin（键盘交互）
 *           │
 *           ▼ fork()
 *     Worker 子进程（dev-entry.js → devBootstrap）
 *       ├─ DevCompiler（esbuild 预编译）
 *       ├─ HotSwappableHandler（原子替换 handler）
 *       ├─ SoftReloader（编排 Soft Reload 流程）
 *       ├─ HTTP Server（socket 保持不变）
 *       └─ 框架实例（app + services + routes）
 *
 * @module cli/dev
 * @see 11d-bootstrap-cli.md §5（CLI 集成）
 * @see 11-hot-reload.md §2（三层重载架构）
 * @see 09-cli.md §2（vext dev 开发模式）
 * @see IMPLEMENTATION-PLAN.md 任务 2.4 / 2.8
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * vext dev 命令选项
 */
export interface DevCommandOptions {
  /** 项目根目录（默认: cwd） */
  root?: string;

  /** 强制使用 polling 模式（适用于 Docker / 网络文件系统） */
  poll?: boolean;

  /** Polling 间隔毫秒数（默认: 1000） */
  pollInterval?: number;

  /** 防抖间隔毫秒数（默认: 100） */
  debounce?: number;

  /**
   * 禁用 soft reload，所有变更都走 cold restart
   *
   * 当设置为 true 时，即使 change-classifier 判定为 soft 的变更
   * 也会走 Cold Restart 路径。适用于调试 Soft Reload 问题时。
   */
  noHot?: boolean;

  /** 每次 reload 后清空控制台 */
  clear?: boolean;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * devCommand — vext dev CLI 命令入口
 *
 * 解析命令行参数，启动 ColdRestarter + FileWatcher，
 * 监听文件变更并触发 Cold Restart。
 *
 * @param args 命令行参数（如 ['--poll', '--debounce', '200']）
 */
export async function devCommand(args: string[] = []): Promise<void> {
  const options = parseDevArgs(args);

  // ── 1. 检测项目结构 ────────────────────────────────────
  const projectRoot = resolve(options.root || process.cwd());
  const project = detectProject(projectRoot);

  // ── 2. 打印欢迎信息 ────────────────────────────────────
  printBanner(options);

  // ── 3. 解析 dev-entry 入口路径 ─────────────────────────
  //
  // dev-entry.js 是 vextjs 框架内部的 dev 子进程入口，
  // 由 tsc 编译到 dist/lib/dev/dev-entry.js。
  //
  // ColdRestarter fork 此文件时，通过 VEXT_ROOT 环境变量
  // 传递用户项目根目录给 devBootstrap。
  //
  const entryScript = join(
    project.rootDir,
    "node_modules",
    "vextjs",
    "dist",
    "lib",
    "dev",
    "dev-entry.js",
  );

  // ── 4. 创建 ColdRestarter ─────────────────────────────
  const restarterOptions: ColdRestarterOptions = {
    entryScript,
    env: {
      VEXT_ROOT: project.rootDir,
      VEXT_DEV_MODE: "1",
      NODE_ENV: process.env.NODE_ENV || "development",
    },
    cwd: project.rootDir,
  };

  const restarter = new ColdRestarter(restarterOptions);

  // 监听子进程事件
  restarter.setEvents({
    onChildMessage: (msg: unknown) => {
      // 子进程可能请求 cold restart（级联检测过大）
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "request-cold-restart"
      ) {
        const reason =
          ((msg as Record<string, unknown>).reason as string) ||
          "child request";
        console.log(`\n[vext dev] child requested cold restart: ${reason}`);
        restarter.restart(reason).catch((err: unknown) => {
          console.error(
            "[vext dev] restart failed:",
            err instanceof Error ? err.message : err,
          );
        });
      }
    },

    onChildExit: (code: number | null, signal: string | null) => {
      // 子进程异常退出（非 restart 触发的 kill）
      if (signal) {
        console.error(`\n[vext dev] worker terminated by signal ${signal}`);
      } else if (code !== null && code !== 0) {
        console.error(`\n[vext dev] worker exited with code ${code}`);
        console.error("[vext dev] fix the error and save to trigger restart");
      }
    },
  });

  // ── 5. 首次启动 ────────────────────────────────────────
  console.log("[vext dev] starting initial compilation + server...");

  try {
    await restarter.restart("initial start");
    console.log("[vext dev] server ready\n");
  } catch (err) {
    console.error(
      "[vext dev] initial start failed:",
      err instanceof Error ? err.message : err,
    );
    console.error("[vext dev] fix the error and save a file to retry\n");
    // 不退出 — 等待用户修复后 FileWatcher 触发 restart
  }

  // ── 6. 创建并启动 FileWatcher ──────────────────────────
  const usePolling = options.poll ?? shouldUsePolling();

  const watcher = new VextFileWatcher({
    root: project.rootDir,
    debounce: options.debounce ?? 100,
    usePolling,
    pollInterval: options.pollInterval ?? 1000,
  });

  watcher.on("change", async (event: FileChangeEvent) => {
    // ── 打印变更详情 ──────────────────────────────────
    console.log(`\n[vext dev] ${event.files.length} file(s) changed:`);
    for (const f of event.files) {
      const cls = classifyChange(f.path);
      const icon =
        cls.action === "cold"
          ? "\u{1F534}" // 🔴
          : cls.action === "soft"
            ? "\u{1F7E2}" // 🟢
            : "\u26AA"; // ⚪
      console.log(`  ${icon} ${f.path} (${f.type})`);
    }

    if (options.clear) {
      console.clear();
    }

    // ── Tier 3: 配置/插件变更 → Cold Restart ─────────
    //
    // 配置文件、插件、.env、package.json、tsconfig.json
    // 的变更影响全局初始化阶段，无法在进程内安全热替换，
    // 必须执行完整的 kill + fork。
    //
    if (event.action === "cold") {
      console.log(
        "[vext dev] config/plugin change detected \u2192 cold restart (Tier 3)...",
      );
      try {
        await restarter.restart(event.files.map((f) => f.path).join(", "));
        console.log("[vext dev] cold restart complete\n");
      } catch (err) {
        console.error(
          "[vext dev] restart failed:",
          err instanceof Error ? err.message : err,
        );
        console.error("[vext dev] fix the error and save to retry\n");
      }
      return;
    }

    // ── --no-hot 降级：soft 变更也走 Cold Restart ────
    //
    // 用户通过 --no-hot 或 VEXT_DEV_NO_HOT=1 禁用 soft reload，
    // 所有变更都走 Cold Restart 路径。
    //
    if (options.noHot) {
      const hasStructural = event.files.some(
        (f) => f.type === "add" || f.type === "delete",
      );
      console.log(
        `[vext dev] source change detected \u2192 cold restart (--no-hot) ` +
          `[${hasStructural ? "structural" : "code"}]...`,
      );
      try {
        await restarter.restart(event.files.map((f) => f.path).join(", "));
        console.log("[vext dev] cold restart complete\n");
      } catch (err) {
        console.error(
          "[vext dev] restart failed:",
          err instanceof Error ? err.message : err,
        );
        console.error("[vext dev] fix the error and save to retry\n");
      }
      return;
    }

    // ── Tier 1/2: 业务代码变更 → IPC Soft Reload ────
    //
    // Tier 1 (modify): esbuild.transform() 单文件编译 (~3ms, O(1))
    // Tier 2 (add/delete): ctx.rebuild() 全量增量编译 (~80ms)
    //
    // 通过 IPC 发送 { type: 'reload', files: [...] } 消息
    // 到子进程，由 SoftReloader 执行完整的热重载流程。
    //
    const hasStructural = event.files.some(
      (f) => f.type === "add" || f.type === "delete",
    );
    const tier = hasStructural ? "T2:structural" : "T1:code";
    console.log(
      `[vext dev] source change detected \u2192 soft reload [${tier}]...`,
    );
    restarter.sendToChild({
      type: "reload",
      files: event.files,
    });
  });

  await watcher.start();

  if (usePolling) {
    console.log(
      "[vext dev] using polling mode " +
        `(interval: ${options.pollInterval ?? 1000}ms)`,
    );
  }

  // ── 7. 优雅退出 ────────────────────────────────────────
  let isCleaningUp = false;

  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    console.log("\n[vext dev] shutting down...");

    watcher.stop();

    try {
      await restarter.kill();
    } catch {
      // 静默忽略 kill 错误
    }

    process.exit(0);
  };

  process.on("SIGINT", () => {
    cleanup().catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    cleanup().catch(() => process.exit(1));
  });

  // ── 8. 键盘交互 ────────────────────────────────────────
  //
  // 仅在 TTY 环境下（交互式终端）启用：
  //   r — 手动触发 cold restart
  //   c — 清空控制台
  //   h — 打印帮助
  //   Ctrl+C (0x03) — 退出
  //
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    process.stdin.on("data", (key: string) => {
      switch (key) {
        case "r":
          console.log("\n[vext dev] manual cold restart...");
          restarter.restart("manual").catch((err: unknown) => {
            console.error(
              "[vext dev] restart failed:",
              err instanceof Error ? err.message : err,
            );
          });
          break;

        case "c":
          console.clear();
          break;

        case "h":
          // 手动触发 soft reload（全文件）
          console.log("\n[vext dev] manual soft reload (all sources)...");
          restarter.sendToChild({
            type: "reload",
            files: [{ path: "src/", type: "modify" as const }],
          });
          break;

        case "?":
          printKeyboardHelp();
          break;

        case "\x03": // Ctrl+C
          cleanup().catch(() => process.exit(1));
          break;

        default:
          // 忽略其他按键
          break;
      }
    });
  }
}

// ── 参数解析 ────────────────────────────────────────────────

/**
 * parseDevArgs — 解析 vext dev 的命令行参数
 *
 * 支持的参数：
 *   --root <path>         项目根目录
 *   --poll                强制使用 polling 模式
 *   --poll-interval <ms>  Polling 间隔
 *   --debounce <ms>       防抖间隔
 *   --no-hot              禁用 soft reload（Phase 2B 有效）
 *   --clear               每次 reload 后清空控制台
 *
 * 使用手动解析（不引入第三方 CLI 库），保持零依赖。
 *
 * @param args 命令行参数
 * @returns 解析后的选项
 */
function parseDevArgs(args: string[]): DevCommandOptions {
  const options: DevCommandOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--root":
        if (i + 1 < args.length) {
          options.root = args[++i];
        }
        break;

      case "--poll":
        options.poll = true;
        break;

      case "--poll-interval":
        if (i + 1 < args.length) {
          const val = parseInt(args[++i]!, 10);
          if (!isNaN(val) && val > 0) {
            options.pollInterval = val;
          } else {
            console.error(
              `[vextjs] Invalid --poll-interval value: "${args[i]}"`,
            );
            process.exit(1);
          }
        }
        break;

      case "--debounce":
        if (i + 1 < args.length) {
          const val = parseInt(args[++i]!, 10);
          if (!isNaN(val) && val >= 0) {
            options.debounce = val;
          } else {
            console.error(`[vextjs] Invalid --debounce value: "${args[i]}"`);
            process.exit(1);
          }
        }
        break;

      case "--no-hot":
        options.noHot = true;
        break;

      case "--clear":
        options.clear = true;
        break;

      case "--help":
      case "-h":
        printDevHelp();
        process.exit(0);
        break;

      default:
        if (arg && arg.startsWith("--")) {
          console.error(`[vextjs] Unknown option: "${arg}"\n`);
          printDevHelp();
          process.exit(1);
        }
        break;
    }
  }

  // 环境变量覆盖（优先级低于 CLI 参数）
  if (options.poll === undefined && process.env.VEXT_DEV_POLL === "1") {
    options.poll = true;
  }
  if (options.poll === undefined && process.env.VEXT_DEV_POLL === "0") {
    options.poll = false;
  }
  if (options.noHot === undefined && process.env.VEXT_DEV_NO_HOT === "1") {
    options.noHot = true;
  }
  if (options.debounce === undefined && process.env.VEXT_DEV_DEBOUNCE) {
    const val = parseInt(process.env.VEXT_DEV_DEBOUNCE, 10);
    if (!isNaN(val) && val >= 0) {
      options.debounce = val;
    }
  }

  return options;
}

// ── 输出函数 ────────────────────────────────────────────────

/**
 * 打印启动横幅
 */
function printBanner(options: DevCommandOptions): void {
  const polling = options.poll ? "polling" : "fs.watch";
  const debounce = options.debounce ?? 100;
  const mode = options.noHot
    ? "Cold Restart (--no-hot)"
    : "Soft Reload + Cold Restart";

  console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551           Vext Dev Server (Phase 2B)         \u2551
\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563
\u2551  Mode: ${mode.padEnd(39)}\u2551
\u2551  Watch: ${polling.padEnd(38)}\u2551
\u2551  Debounce: ${String(debounce + "ms").padEnd(35)}\u2551
\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563
\u2551  \u{1F7E2} T1 (code):   soft reload (transform)    \u2551
\u2551  \u{1F7E1} T2 (struct): soft reload (rebuild)      \u2551
\u2551  \u{1F534} T3 (cold):   cold restart               \u2551
\u2551  \u26AA ignored:     skip                        \u2551
\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563
\u2551  r=restart  h=reload  c=clear  ?=help  ^C=quit\u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
}

/**
 * 打印键盘快捷键帮助
 */
function printKeyboardHelp(): void {
  console.log(`
  Keyboard shortcuts:
    r       Manual cold restart (kill + fork)
    h       Manual soft reload (all sources)
    c       Clear console
    ?       Show this help
    Ctrl+C  Quit dev server
`);
}

/**
 * 打印 vext dev 的帮助信息
 */
function printDevHelp(): void {
  console.log(`
  Usage: vext dev [options]

  Start the application in development mode with hot reload.

  Reload strategy (Tier 1/2/3):
    T1  Code changes (modify)    → soft reload via esbuild.transform()
    T2  Structural (add/delete)  → soft reload via ctx.rebuild()
    T3  Config/plugin/.env       → cold restart (kill + fork)

  Options:
    --root <path>         Project root directory (default: cwd)
    --poll                Force polling mode (for Docker / NFS)
    --poll-interval <ms>  Polling interval in ms (default: 1000)
    --debounce <ms>       Debounce interval in ms (default: 100)
    --no-hot              Disable soft reload, always cold restart
    --clear               Clear console on each reload
    -h, --help            Show this help message

  Examples:
    $ vext dev
    $ vext dev --poll --poll-interval 2000
    $ vext dev --debounce 200
    $ vext dev --no-hot

  Environment variables:
    VEXT_DEV_POLL=1       Force polling mode
    VEXT_DEV_POLL=0       Force disable polling
    VEXT_DEV_NO_HOT=1     Disable soft reload
    VEXT_DEV_DEBOUNCE=200 Set debounce interval
`);
}

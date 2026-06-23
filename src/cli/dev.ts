import { resolve, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectProject } from "./utils/detect-project.js";
import { runDevPreflight } from "./utils/dev-preflight.js";
import type { TsDiagnosticsMode } from "./utils/dev-preflight.js";
import { resolvePreloads } from "./utils/preload.js";
import { ColdRestarter } from "../lib/dev/cold-restarter.js";
import type { ColdRestarterOptions } from "../lib/dev/cold-restarter.js";
import { VextFileWatcher } from "../lib/dev/file-watcher.js";
import type { FileChangeEvent } from "../lib/dev/file-watcher.js";
import { classifyChange } from "../lib/dev/change-classifier.js";
import { shouldUsePolling } from "../lib/dev/detect-polling.js";
import {
  createStartupProfiler,
  formatStartupDuration,
  formatStartupSummary,
  formatStartupProfile,
  mergeStartupProfiles,
  writeStartupProfileJson,
  type StartupProfileSnapshot,
} from "../lib/startup-profiler.js";
import { printReadyLog } from "../lib/utils/network.js";
import {
  printConfigProfileWarning,
  resolveConfigProfile,
} from "../lib/config-profile.js";

/**
 * cli/dev.ts — vext dev 命令实现
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

  /** 覆盖监听端口（通过 VEXT_PORT 环境变量传递给子进程） */
  port?: number;

  /** 覆盖监听地址（通过 VEXT_HOST 环境变量传递给子进程） */
  host?: string;

  /** 配置 profile 名称 */
  configProfile?: string;

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

  /** 生命周期日志增强 */
  verboseLifecycle?: boolean;

  /** 端口冲突策略 */
  portConflict?: "error" | "prompt" | "kill" | "next";

  /** 让 TypeScript 诊断重新阻塞启动 / reload */
  strictPreflight?: boolean;

  /** 输出启动阶段耗时 */
  startupProfile?: boolean;

  /** 将启动阶段耗时写入 JSON 文件 */
  startupProfileJson?: string;
}

interface DevReadyMessage {
  type: "ready";
  server?: {
    host: string;
    port: number;
  };
  startupProfile?: StartupProfileSnapshot;
}

async function promptPortConflictDecision(
  host: string | undefined,
  port: number,
  details?: { pid?: number; command?: string; source?: string },
  restoreRawMode?: () => void,
): Promise<"retry" | "kill" | "next" | "abort"> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "abort";
  }

  process.stdin.setRawMode?.(false);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const owner = details?.pid
      ? ` pid=${details.pid}${details.command ? ` (${details.command})` : ""}`
      : "";
    const answer = await rl.question(
      `[vext dev] Port ${host ?? "0.0.0.0"}:${port} is in use${owner}. Choose: [r]etry / [k]ill / [n]ext / [a]bort: `,
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
    restoreRawMode?.();
  }
}

function printFileChanges(
  files: FileChangeEvent["files"],
  lifecycleLevel: "concise" | "verbose",
): void {
  if (lifecycleLevel === "verbose") {
    console.log(`\n[vext dev] ${files.length} file(s) changed:`);
    for (const f of files) {
      const cls = classifyChange(f.path);
      const icon =
        cls.action === "cold"
          ? "\u{1F534}"
          : cls.action === "soft"
            ? "\u{1F7E2}"
            : "\u26AA";
      console.log(`  ${icon} ${f.path} (${f.type})`);
    }
    return;
  }

  const preview = files
    .slice(0, 3)
    .map((item) => item.path)
    .join(", ");
  const suffix = files.length > 3 ? `, +${files.length - 3} more` : "";
  console.log(
    `\n[vext dev] ${files.length} file(s) changed${preview ? `: ${preview}${suffix}` : ""}`,
  );
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
  const resolvedConfigProfile = resolveCliConfigProfile(options);
  printConfigProfileWarning(resolvedConfigProfile);
  const hasLifecycleOverride =
    options.verboseLifecycle === true ||
    process.env.VEXT_LIFECYCLE_LEVEL === "verbose";
  let lifecycleLevel: "concise" | "verbose" = hasLifecycleOverride
    ? "verbose"
    : "concise";
  let promptActive = false;
  let pendingTsDiagnostics: Promise<unknown> | null = null;
  const startupProfiler = createStartupProfiler({
    enabled:
      options.startupProfile === true || Boolean(options.startupProfileJson),
  });
  const commandStartedAt = performance.now();
  let pendingReadyStartedAt = commandStartedAt;
  const readyLogger = {
    info(message: string) {
      console.log(message);
    },
  };

  // ── 1. 检测项目结构 ────────────────────────────────────
  const projectRoot = resolve(options.root || process.cwd());
  const project = detectProject(projectRoot);

  // ── 2. 打印欢迎信息 ────────────────────────────────────
  if (options.startupProfile || options.verboseLifecycle) {
    printBanner(options);
  }

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
  const restarterEnv: Record<string, string> = {
    VEXT_ROOT: project.rootDir,
    VEXT_DEV_MODE: "1",
    VEXT_DEV_PARENT_READY_LOG: "1",
    NODE_ENV: "development",
    VEXT_CONFIG: resolvedConfigProfile.profile,
  };

  // --port / --host → VEXT_PORT / VEXT_HOST 环境变量传递给子进程
  // loadConfig() 内部读取这些环境变量作为最高优先级覆盖
  if (options.port !== undefined) {
    restarterEnv.VEXT_PORT = String(options.port);
  }
  if (options.host !== undefined) {
    restarterEnv.VEXT_HOST = options.host;
  }
  if (options.portConflict) {
    restarterEnv.VEXT_PORT_CONFLICT = options.portConflict;
  }
  if (options.verboseLifecycle) {
    restarterEnv.VEXT_LIFECYCLE_LEVEL = "verbose";
  }
  if (startupProfiler.enabled) {
    restarterEnv.VEXT_DEV_STARTUP_PROFILE = "1";
  }
  if (options.startupProfile) {
    restarterEnv.VEXT_DEV_STARTUP_PROFILE_HUMAN = "1";
  }
  if (options.startupProfileJson) {
    restarterEnv.VEXT_STARTUP_PROFILE_JSON = options.startupProfileJson;
  }

  // ── 解析预加载模块（vext.preload 字段）──────────────
  //
  // 扫描直接依赖的 package.json vext.preload 字段，
  // 生成 ["--import", "file:///..."] 格式的 execArgv 追加列表。
  // Cold Restart 时 extraExecArgv 自动复用，无需重新计算。
  //
  const preloads = await startupProfiler.time(
    "main.preloads.resolve.initial",
    () => resolvePreloads(project.rootDir),
    { phase: "main/preload" },
  );
  startupProfiler.mark("main.preloads.resolved.initial", 0, {
    phase: "main/preload",
    detail: { preloads },
  });
  const preloadExecArgv = preloads.flatMap((p) => ["--import", p]);

  const restarterOptions: ColdRestarterOptions = {
    entryScript,
    env: restarterEnv,
    cwd: project.rootDir,
    extraExecArgv: preloadExecArgv,
  };

  const restarter = new ColdRestarter(restarterOptions);

  const refreshPreloads = async (): Promise<void> => {
    const latestPreloads = await startupProfiler.time(
      "main.preloads.resolve.refresh",
      () => resolvePreloads(project.rootDir),
      { phase: "main/preload" },
    );
    startupProfiler.mark("main.preloads.resolved.refresh", 0, {
      phase: "main/preload",
      detail: { preloads: latestPreloads },
    });
    restarter.setExtraExecArgv(latestPreloads.flatMap((p) => ["--import", p]));
  };

  const runPreflight = async (reason: string): Promise<boolean> => {
    const tsDiagnosticsMode: TsDiagnosticsMode = options.strictPreflight
      ? "blocking"
      : pendingTsDiagnostics
        ? "skip"
        : "async";
    const result = await runDevPreflight({
      rootDir: project.rootDir,
      language: project.language,
      reason,
      tsDiagnosticsMode,
      logTypegenDetails: Boolean(
        options.startupProfile || options.verboseLifecycle,
      ),
    });

    if (result.tsDiagnosticsTask) {
      const task = result.tsDiagnosticsTask.finally(() => {
        if (pendingTsDiagnostics === task) {
          pendingTsDiagnostics = null;
        }
      });
      pendingTsDiagnostics = task;
    }

    if (result.ok) {
      return true;
    }

    console.error(`[vext dev] blocking diagnostics found during ${reason}.`);
    console.error("[vext dev] fix the reported issues and save again\n");
    return false;
  };

  // 监听子进程事件
  restarter.setEvents({
    onChildMessage: (msg: unknown) => {
      // 子进程可能请求 cold restart（级联检测过大）
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "ready"
      ) {
        const readyMessage = msg as DevReadyMessage;
        if (readyMessage.server) {
          const totalMs = performance.now() - pendingReadyStartedAt;
          printReadyLog(
            readyLogger,
            readyMessage.server.host,
            readyMessage.server.port,
            {
              prefix: "[vext dev]",
              suffix:
                `(total=${formatStartupDuration(totalMs)}, ` +
                "soft reload enabled)",
            },
          );
          console.log("");
        }

        const startupProfile = readyMessage.startupProfile;
        if (startupProfile?.enabled) {
          const mergedProfile = mergeStartupProfiles(
            startupProfiler.toJSON(),
            startupProfile,
          );
          if (options.startupProfile) {
            console.log(formatStartupSummary(mergedProfile));
            console.log(formatStartupProfile(mergedProfile));
          }
          if (options.startupProfileJson) {
            writeStartupProfileJson(options.startupProfileJson, mergedProfile);
            console.log(
              `[vext dev] startup profile json: ${options.startupProfileJson}`,
            );
          }
        }
        return;
      }

      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "request-cold-restart"
      ) {
        const reason =
          ((msg as Record<string, unknown>).reason as string) ||
          "child request";
        console.log(`\n[vext dev] child requested cold restart: ${reason}`);
        runPreflight(`child requested cold restart: ${reason}`)
          .then((ok) => {
            if (!ok) {
              return;
            }
            return refreshPreloads().then(() => {
              pendingReadyStartedAt = performance.now();
              return restarter.restart(reason);
            });
          })
          .catch((err: unknown) => {
            console.error(
              "[vext dev] restart failed:",
              err instanceof Error ? err.message : err,
            );
          });
        return;
      }

      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "lifecycle-config" &&
        !hasLifecycleOverride
      ) {
        lifecycleLevel =
          (msg as Record<string, unknown>).level === "verbose"
            ? "verbose"
            : "concise";
        return;
      }

      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "port-conflict"
      ) {
        promptActive = true;
        promptPortConflictDecision(
          (msg as Record<string, unknown>).host as string | undefined,
          (msg as Record<string, unknown>).port as number,
          (msg as Record<string, unknown>).details as {
            pid?: number;
            command?: string;
            source?: string;
          },
          () => {
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(true);
            }
          },
        )
          .then((action) => {
            restarter.sendToChild({ type: "port-conflict-decision", action });
          })
          .finally(() => {
            promptActive = false;
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
  if (options.startupProfile || options.verboseLifecycle) {
    console.log("[vext dev] starting initial compilation + server...");
  }

  try {
    if (
      !(await startupProfiler.time("main.preflight.initial", () =>
        runPreflight("initial start"),
      ))
    ) {
      console.error(
        "[vext dev] initial checks failed. Waiting for changes...\n",
      );
    } else {
      await refreshPreloads();
      pendingReadyStartedAt = performance.now();
      await startupProfiler.time("main.worker.ready", () =>
        restarter.restart("initial start"),
      );
    }
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
    debounce: options.debounce ?? 0,
    usePolling,
    pollInterval: options.pollInterval ?? 1000,
  });

  watcher.on("change", async (event: FileChangeEvent) => {
    try {
      // ── 打印变更详情 ──────────────────────────────────
      printFileChanges(event.files, lifecycleLevel);

      if (options.clear) {
        console.clear();
      }

      const preflightReason =
        event.action === "cold"
          ? "cold restart preflight"
          : event.action === "client"
            ? "client rebuild preflight"
            : "soft reload preflight";
      if (!(await runPreflight(preflightReason))) {
        return;
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
          await refreshPreloads();
          pendingReadyStartedAt = performance.now();
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

      const clientFiles = event.files.filter((file) =>
        isFrontendClientFile(file.path),
      );
      if (clientFiles.length > 0) {
        console.log("[vext dev] frontend client change detected -> rebuild...");
        restarter.sendToChild({
          type: "frontend-rebuild",
          files: clientFiles,
        });
        if (event.action === "client") {
          return;
        }
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
          await refreshPreloads();
          pendingReadyStartedAt = performance.now();
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
    } catch (err) {
      console.error(
        "[vext dev] unexpected error in file watcher handler:",
        err instanceof Error ? err.message : err,
      );
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      console.error("[vext dev] fix the error and save again to retry\n");
    }
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
          if (promptActive) break;
          console.log("\n[vext dev] manual cold restart...");
          runPreflight("manual cold restart")
            .then((ok) => {
              if (!ok) {
                return;
              }
              return refreshPreloads().then(() => {
                pendingReadyStartedAt = performance.now();
                return restarter.restart("manual");
              });
            })
            .catch((err: unknown) => {
              console.error(
                "[vext dev] restart failed:",
                err instanceof Error ? err.message : err,
              );
            });
          break;

        case "c":
          if (promptActive) break;
          console.clear();
          break;

        case "h":
          if (promptActive) break;
          // 手动触发 soft reload（全文件）
          console.log("\n[vext dev] manual soft reload (all sources)...");
          runPreflight("manual soft reload")
            .then((ok) => {
              if (!ok) {
                return;
              }
              restarter.sendToChild({
                type: "reload",
                files: [{ path: "src/", type: "modify" as const }],
              });
            })
            .catch((err: unknown) => {
              console.error(
                "[vext dev] reload failed:",
                err instanceof Error ? err.message : err,
              );
            });
          break;

        case "?":
          if (promptActive) break;
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

function isFrontendClientFile(filePath: string): boolean {
  return filePath.startsWith("src/frontend/") || filePath.startsWith("public/");
}

// ── 参数解析 ────────────────────────────────────────────────

function resolveCliConfigProfile(
  options: DevCommandOptions,
): ReturnType<typeof resolveConfigProfile> {
  try {
    return resolveConfigProfile({
      cliProfile: options.configProfile,
      env: process.env,
      command: "dev",
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * parseDevArgs — 解析 vext dev 的命令行参数
 *
 * 支持的参数：
 *   --root <path>         项目根目录
 *   --poll                强制使用 polling 模式
 *   --poll-interval <ms>  Polling 间隔
 *   --debounce <ms>       防抖间隔
 *   --no-hot              禁用 soft reload
 *   --clear               每次 reload 后清空控制台
 *
 * 使用手动解析（不引入第三方 CLI 库），保持零依赖。
 *
 * @param args 命令行参数
 * @returns 解析后的选项
 */
export function parseDevArgs(args: string[]): DevCommandOptions {
  const options: DevCommandOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--root":
        if (i + 1 < args.length) {
          options.root = args[++i];
        }
        break;

      case "--port":
        if (i + 1 < args.length) {
          const portStr = args[++i]!;
          const port = parseInt(portStr, 10);
          if (Number.isNaN(port) || port < 1 || port > 65535) {
            console.error(`[vextjs] Invalid port number: "${portStr}"`);
            process.exit(1);
          }
          options.port = port;
        }
        break;

      case "--host":
        if (i + 1 < args.length) {
          options.host = args[++i]!;
        }
        break;

      case "--config":
        if (i + 1 >= args.length) {
          console.error("[vextjs] --config requires a value");
          process.exit(1);
        }
        options.configProfile = args[++i]!;
        break;

      case "--poll":
        options.poll = true;
        break;

      case "--poll-interval":
        if (i + 1 < args.length) {
          i++;
          const val = parseInt(args[i] ?? "", 10);
          if (!Number.isNaN(val) && val > 0) {
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
          i++;
          const val = parseInt(args[i] ?? "", 10);
          if (!Number.isNaN(val) && val >= 0) {
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

      case "--strict-preflight":
        options.strictPreflight = true;
        break;

      case "--startup-profile":
        options.startupProfile = true;
        break;

      case "--startup-profile-json":
        if (i + 1 < args.length) {
          options.startupProfileJson = args[++i]!;
        }
        break;

      case "--verbose-lifecycle":
        options.verboseLifecycle = true;
        break;

      case "--port-conflict":
        if (i + 1 < args.length) {
          const strategy = args[++i]!;
          if (
            strategy !== "error" &&
            strategy !== "prompt" &&
            strategy !== "kill" &&
            strategy !== "next"
          ) {
            console.error(
              `[vextjs] Invalid --port-conflict value: "${strategy}"`,
            );
            process.exit(1);
          }
          options.portConflict = strategy;
        }
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
        if (arg?.startsWith("--")) {
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
  if (
    options.strictPreflight === undefined &&
    process.env.VEXT_DEV_STRICT_PREFLIGHT === "1"
  ) {
    options.strictPreflight = true;
  }
  if (options.debounce === undefined && process.env.VEXT_DEV_DEBOUNCE) {
    const val = parseInt(process.env.VEXT_DEV_DEBOUNCE, 10);
    if (!Number.isNaN(val) && val >= 0) {
      options.debounce = val;
    }
  }
  if (
    options.verboseLifecycle === undefined &&
    process.env.VEXT_VERBOSE_LIFECYCLE === "1"
  ) {
    options.verboseLifecycle = true;
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
    options.startupProfileJson === undefined &&
    process.env.VEXT_STARTUP_PROFILE_JSON
  ) {
    options.startupProfileJson = process.env.VEXT_STARTUP_PROFILE_JSON;
  }

  return options;
}

// ── 输出函数 ────────────────────────────────────────────────

/**
 * 打印启动横幅
 */
function printBanner(options: DevCommandOptions): void {
  const polling = options.poll ? "polling" : "fs.watch";
  const debounce = options.debounce ?? 0;
  const mode = options.noHot
    ? "Cold Restart (--no-hot)"
    : "Soft Reload + Cold Restart";
  const preflight = options.strictPreflight ? "strict" : "async TS";

  console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551               Vext Dev Server                \u2551
\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563
\u2551  Mode: ${mode.padEnd(39)}\u2551
\u2551  Watch: ${polling.padEnd(38)}\u2551
\u2551  Debounce: ${String(`${debounce}ms`).padEnd(35)}\u2551
\u2551  Preflight: ${preflight.padEnd(34)}\u2551
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
    --port <number>       Override the listening port
    --host <string>       Override the listening host
    --config <name>       Load src/config/<name> instead of the default profile
    --root <path>         Project root directory (default: cwd)
    --poll                Force polling mode (for Docker / NFS)
    --poll-interval <ms>  Polling interval in ms (default: 1000)
    --debounce <ms>       Debounce interval in ms (default: 0, disabled)
    --no-hot              Disable soft reload, always cold restart
    --strict-preflight    Block start/reload on TypeScript diagnostics
    --startup-profile     Print startup phase timings
    --startup-profile-json <path>
                           Write startup phase timings to a JSON file
    --port-conflict <error|prompt|kill|next>
                           Configure how port conflicts are handled
    --verbose-lifecycle   Show verbose lifecycle logs
    --clear               Clear console on each reload
    -h, --help            Show this help message

  Examples:
    $ vext dev
    $ vext dev --config sg-sit
    $ vext dev --port 8080
    $ vext dev --host 127.0.0.1 --port 3000
    $ vext dev --poll --poll-interval 2000
    $ vext dev --debounce 50
    $ vext dev --no-hot
    $ vext dev --port-conflict prompt

  Environment variables:
    VEXT_CONFIG           Load a named config profile when --config is not set
    VEXT_DEV_POLL=1       Force polling mode
    VEXT_DEV_POLL=0       Force disable polling
    VEXT_DEV_NO_HOT=1     Disable soft reload
    VEXT_STARTUP_PROFILE_JSON=<path>
                           Write startup phase timings to a JSON file
    VEXT_DEV_STRICT_PREFLIGHT=1
                          Block start/reload on TypeScript diagnostics
    VEXT_DEV_DEBOUNCE=50  Set debounce interval (ms, default: 0)
    VEXT_PORT_CONFLICT=next
    VEXT_VERBOSE_LIFECYCLE=1
`);
}

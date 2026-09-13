import { resolve } from "node:path";
import {
  acquireProjectOwner,
  type ProjectOwner,
} from "../lib/project/owner.js";
import { createInterface } from "node:readline/promises";
import { detectProject } from "./utils/detect-project.js";
import { resolveFrameworkEntry } from "../lib/consumer-resolver.js";
import { runDevPreflight } from "./utils/dev-preflight.js";
import type { TsDiagnosticsMode } from "./utils/dev-preflight.js";
import { resolvePreloads } from "./utils/preload.js";
import { ColdRestarter } from "../lib/dev/cold-restarter.js";
import { DevOperationQueue } from "../lib/dev/operation-queue.js";
import type { WorkerOperation } from "../lib/dev/worker-protocol.js";
import type { ColdRestarterOptions } from "../lib/dev/cold-restarter.js";
import { VextFileWatcher } from "../lib/dev/file-watcher.js";
import type { FileChangeEvent } from "../lib/dev/file-watcher.js";
import { classifyChange } from "../lib/dev/change-classifier.js";
import type { ClassifierOptions } from "../lib/dev/change-classifier.js";
import { isProjectWatchLayout } from "../lib/project/layout.js";
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
import {
  failUnknownCliArgument,
  readRequiredOptionValueOrExit,
} from "./utils/command-args.js";
import { markUniqueOption } from "./utils/option-occurrence.js";
import {
  patchRuntimeSnapshot,
  writeRuntimeSnapshot,
} from "../lib/runtime-snapshot.js";

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
 *   - 编译失败：旧 handler 继续服务；运行态已变更后的失败先停止子进程，
 *     再通过 Cold Restart 恢复完整运行态
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
  classifierOptions?: ClassifierOptions,
): void {
  if (lifecycleLevel === "verbose") {
    console.log(`\n[vext dev] ${files.length} file(s) changed:`);
    for (const f of files) {
      const cls = classifyChange(f.path, classifierOptions);
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
interface DevCommandResources {
  stop?: () => Promise<void>;
  stopping?: boolean;
}

export async function devCommand(args: string[] = []): Promise<void> {
  const options = parseDevArgs(args);
  const resolvedConfigProfile = resolveCliConfigProfile(options);
  printConfigProfileWarning(resolvedConfigProfile);
  const project = detectProject(resolve(options.root || process.cwd()));
  const owner = await acquireProjectOwner(project.rootDir, "dev");
  const resources: DevCommandResources = {};
  try {
    await owner.reserveOutputs([".vext", "src/config", "src/types/generated"]);
    await owner.run(() =>
      runDevCommand(options, resolvedConfigProfile, project, owner, resources),
    );
  } catch (error) {
    await resources.stop?.();
    await owner.release();
    if (resources.stopping) return;
    throw error;
  }
}

async function runDevCommand(
  options: DevCommandOptions,
  resolvedConfigProfile: ReturnType<typeof resolveCliConfigProfile>,
  project: ReturnType<typeof detectProject>,
  owner: ProjectOwner,
  resources: DevCommandResources,
): Promise<void> {
  const hasLifecycleOverride =
    options.verboseLifecycle === true ||
    process.env.VEXT_LIFECYCLE_LEVEL === "verbose";
  let lifecycleLevel: "concise" | "verbose" = hasLifecycleOverride
    ? "verbose"
    : "concise";
  let promptActive = false;
  let pendingTsDiagnostics: Promise<unknown> | null = null;
  const operations = new DevOperationQueue();
  const cleanupListeners: (() => void)[] = [];
  const startupProfiler = createStartupProfiler({
    enabled:
      options.startupProfile === true || Boolean(options.startupProfileJson),
  });
  const commandStartedAt = performance.now();
  let pendingReadyStartedAt = commandStartedAt;
  const runtimeIdentity = {
    mode: "development" as const,
    pid: process.pid,
  };
  const readyLogger = {
    info(message: string) {
      console.log(message);
    },
  };

  // ── 1. 检测项目结构 ────────────────────────────────────
  const classifierOptions: ClassifierOptions = { rootDir: project.rootDir };
  let watcher: VextFileWatcher | undefined;

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
  const entryScript = resolveFrameworkEntry(project.rootDir, "dev");

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
    () => owner.run(() => resolvePreloads(project.rootDir)),
    { phase: "main/preload" },
  );
  startupProfiler.mark("main.preloads.resolved.initial", 0, {
    phase: "main/preload",
    detail: { preloads },
  });
  const preloadExecArgv = preloads.flatMap((p) => ["--import", p]);

  const restarterOptions: ColdRestarterOptions = {
    ownerGrant: owner.createGrant(),
    entryScript,
    env: restarterEnv,
    cwd: project.rootDir,
    extraExecArgv: preloadExecArgv,
  };

  const restarter = new ColdRestarter(restarterOptions);
  let stopTask: Promise<void> | undefined;
  resources.stop = () => {
    stopTask ??= (async () => {
      watcher?.stop();
      for (const cleanup of cleanupListeners.splice(0)) cleanup();
      const drained = operations.close();
      const results = await Promise.allSettled([restarter.kill(), drained]);
      await pendingTsDiagnostics;
      const failures = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length)
        throw new AggregateError(failures, "[vext dev] shutdown incomplete");
    })();
    return stopTask;
  };

  const refreshPreloads = async (): Promise<void> => {
    const latestPreloads = await startupProfiler.time(
      "main.preloads.resolve.refresh",
      () => owner.run(() => resolvePreloads(project.rootDir)),
      { phase: "main/preload" },
    );
    startupProfiler.mark("main.preloads.resolved.refresh", 0, {
      phase: "main/preload",
      detail: { preloads: latestPreloads },
    });
    restarter.setExtraExecArgv(latestPreloads.flatMap((p) => ["--import", p]));
  };

  const runPreflight = async (reason: string): Promise<boolean> => {
    operations.signal.throwIfAborted();
    const tsDiagnosticsMode: TsDiagnosticsMode = options.strictPreflight
      ? "blocking"
      : pendingTsDiagnostics
        ? "skip"
        : "async";
    const result = await owner.run(() =>
      runDevPreflight({
        rootDir: project.rootDir,
        language: project.language,
        reason,
        tsDiagnosticsMode,
        logTypegenDetails: Boolean(
          options.startupProfile || options.verboseLifecycle,
        ),
      }),
    );

    if (result.tsDiagnosticsTask) {
      const task = result.tsDiagnosticsTask
        .catch((error: unknown) => {
          console.error(
            "[vext dev] asynchronous TypeScript diagnostics failed:",
            error,
          );
        })
        .finally(() => {
          if (pendingTsDiagnostics === task) {
            pendingTsDiagnostics = null;
          }
        });
      pendingTsDiagnostics = task;
    }

    operations.signal.throwIfAborted();

    if (result.ok) {
      return true;
    }

    console.error(`[vext dev] blocking diagnostics found during ${reason}.`);
    console.error("[vext dev] fix the reported issues and save again\n");
    return false;
  };

  // 缓存失效后的 Soft Reload 失败不能继续复用当前 child。该标记在
  // restart 成功前保持为 true，使后续文件变更走 Cold Restart 而非 IPC HMR。
  let runtimeRecoveryRequired = false;
  let runtimeRecoveryInProgress = false;
  let recoveryQueued = false;

  const restartChild = async (reason: string): Promise<void> => {
    operations.signal.throwIfAborted();
    await refreshPreloads();
    operations.signal.throwIfAborted();
    pendingReadyStartedAt = performance.now();
    await restarter.restart(reason);
    operations.signal.throwIfAborted();
    runtimeRecoveryRequired = false;
  };

  const recoverRuntimeAfterMutation = async (reason: string): Promise<void> => {
    runtimeRecoveryRequired = true;
    runtimeRecoveryInProgress = true;
    try {
      // 先停止可能已经部分重载的 child；如果严格 preflight 阻断，不能让
      // 它继续服务混合运行态。
      await restarter.kill();

      if (!(await runPreflight(`child requested cold restart: ${reason}`))) {
        console.error(
          "[vext dev] runtime recovery is pending; save a valid change to restart.\n",
        );
        return;
      }

      await restartChild(reason);
    } catch (err) {
      console.error(
        "[vext dev] runtime recovery failed:",
        err instanceof Error ? err.message : err,
      );
      console.error(
        "[vext dev] runtime recovery is pending; fix the error and save to retry.\n",
      );
    } finally {
      runtimeRecoveryInProgress = false;
    }
  };

  const runWorkerOperation = async (
    operation: WorkerOperation,
  ): Promise<void> => {
    operations.signal.throwIfAborted();
    let result;
    try {
      result = await restarter.requestOperation(operation);
    } catch (error) {
      if (!operations.signal.aborted) {
        runtimeRecoveryRequired = true;
        await restarter.kill();
      }
      throw error;
    }
    operations.signal.throwIfAborted();
    if (!result.success) {
      runtimeRecoveryRequired ||= result.requestedColdRestart;
      throw new Error(result.error);
    }
    await patchRuntimeSnapshotSafe(project.rootDir, {
      runtimeIdentity,
      summary: { state: "ready", lastOperation: operation.operation },
      reload:
        operation.operation === "reload"
          ? {
              status: "success",
              files: operation.files.map((file) => file.path).slice(0, 50),
            }
          : undefined,
      event: {
        type:
          operation.operation === "frontend-rebuild"
            ? "frontend-rebuild"
            : "soft-reload",
        files: operation.files.map((file) => file.path).slice(0, 50),
      },
    });
  };

  // 监听子进程事件
  restarter.setEvents({
    onChildMessage: (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "watch-layout"
      ) {
        const layout = (msg as Record<string, unknown>).layout;
        if (isProjectWatchLayout(layout)) {
          Object.assign(classifierOptions, {
            frontendDirectories: layout.frontendDirectories,
            frontendFiles: layout.frontendFiles,
            backendDirectories: layout.backendDirectories,
            rootDir: project.rootDir,
          });
          watcher?.updateClassifierOptions(classifierOptions);
        } else {
          console.error("[vext dev] rejected invalid worker watch layout");
        }
        return;
      }
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

        void writeRuntimeSnapshotSafe(project.rootDir, {
          runtimeIdentity,
          summary: {
            state: "ready",
            host: readyMessage.server?.host ?? null,
            port: readyMessage.server?.port ?? null,
            softReload: true,
          },
          events: [
            {
              type: "ready",
              host: readyMessage.server?.host,
              port: readyMessage.server?.port,
            },
          ],
        });

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
        runtimeRecoveryRequired = true;
        if (recoveryQueued || operations.signal.aborted) return;
        recoveryQueued = true;
        void operations
          .run(async () => {
            if (runtimeRecoveryRequired)
              await recoverRuntimeAfterMutation(reason);
          })
          .catch((error: unknown) => {
            if (!operations.signal.aborted)
              console.error("[vext dev] runtime recovery failed:", error);
          })
          .finally(() => {
            recoveryQueued = false;
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
            if (!operations.signal.aborted)
              return restarter.sendToChild({
                type: "port-conflict-decision",
                action,
              });
          })
          .catch((error: unknown) =>
            console.error(
              "[vext dev] port decision could not be delivered:",
              error,
            ),
          )
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

  // ── 6. 创建并启动 FileWatcher ──────────────────────────
  const usePolling = options.poll ?? shouldUsePolling();

  watcher = new VextFileWatcher({
    root: project.rootDir,
    debounce: options.debounce ?? 0,
    usePolling,
    pollInterval: options.pollInterval ?? 1000,
    classifierOptions,
  });

  const handleFileChanges = async (event: FileChangeEvent): Promise<void> => {
    printFileChanges(event.files, lifecycleLevel, classifierOptions);
    if (options.clear) console.clear();
    const reason = event.files.map((file) => file.path).join(", ");
    if (runtimeRecoveryRequired) {
      await recoverRuntimeAfterMutation(reason);
      return;
    }
    const preflightReason =
      event.action === "cold"
        ? "cold restart preflight"
        : event.action === "client"
          ? "client rebuild preflight"
          : "soft reload preflight";
    if (!(await runPreflight(preflightReason))) return;
    if (
      event.action === "cold" ||
      (options.noHot && event.action !== "client") ||
      !restarter.isChildAlive()
    ) {
      await restartChild(reason);
      console.log("[vext dev] cold restart complete\n");
      return;
    }
    const clientFiles = event.files.filter(
      (file) =>
        classifyChange(file.path, classifierOptions).action === "client",
    );
    const serverFiles = event.files.filter(
      (file) => classifyChange(file.path, classifierOptions).action === "soft",
    );
    try {
      if (clientFiles.length)
        await runWorkerOperation({
          operation: "frontend-rebuild",
          files: clientFiles,
        });
      if (serverFiles.length)
        await runWorkerOperation({ operation: "reload", files: serverFiles });
    } catch (error) {
      // 混合变更若只处理了一部分，下次有效操作必须以完整启动恢复一致状态。
      if (clientFiles.length && serverFiles.length)
        runtimeRecoveryRequired = true;
      throw error;
    }
  };

  let pendingFileEvent: FileChangeEvent | undefined;
  let fileTask: Promise<void> | undefined;
  const enqueueFileChanges = (incoming: FileChangeEvent): Promise<void> => {
    if (operations.signal.aborted) return Promise.resolve();
    const files = new Map(
      (pendingFileEvent?.files ?? []).map((file) => [file.path, file]),
    );
    for (const file of incoming.files) {
      const previous = files.get(file.path);
      files.set(
        file.path,
        previous && previous.type !== "modify" && file.type === "modify"
          ? { ...file, type: "add" }
          : { ...file },
      );
    }
    const previousAction = pendingFileEvent?.action;
    const cold =
      incoming.action === "cold" ||
      previousAction === "cold" ||
      runtimeRecoveryInProgress ||
      restarter.getIsRestarting();
    pendingFileEvent = {
      files: [...files.values()],
      action: cold
        ? "cold"
        : incoming.action === "soft" || previousAction === "soft"
          ? "soft"
          : "client",
    };
    if (
      files.size > 5000 ||
      [...files.keys()].reduce(
        (bytes, file) => bytes + Buffer.byteLength(file) + 64,
        0,
      ) >
        1024 * 1024
    )
      pendingFileEvent = {
        action: "cold",
        files: [{ path: "src/", type: "modify" }],
      };
    if (fileTask) return fileTask;
    const task = operations
      .run(async (signal) => {
        while (pendingFileEvent && !signal.aborted) {
          const selected = pendingFileEvent;
          pendingFileEvent = undefined;
          try {
            await handleFileChanges(selected);
          } catch (error) {
            if (!signal.aborted) {
              console.error(
                "[vext dev] file change could not be applied:",
                error instanceof Error ? error.message : error,
              );
              console.error(
                "[vext dev] fix the error and save again to retry\n",
              );
            }
          }
        }
      })
      .catch(async (error: unknown) => {
        if (!operations.signal.aborted)
          console.error("[vext dev] file change queue failed:", error);
        await operations.waitForPending();
      })
      .finally(() => {
        if (fileTask === task) fileTask = undefined;
        if (operations.signal.aborted) pendingFileEvent = undefined;
        else if (pendingFileEvent) {
          const pending = pendingFileEvent;
          pendingFileEvent = undefined;
          return enqueueFileChanges(pending);
        }
      });
    fileTask = task;
    return task;
  };
  watcher.on("change", enqueueFileChanges);

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
    resources.stopping = true;

    console.log("\n[vext dev] shutting down...");

    await resources.stop?.();
    await patchRuntimeSnapshotSafe(project.rootDir, {
      runtimeIdentity,
      summary: { state: "stopped" },
      event: { type: "shutdown" },
    });
    await owner.release();

    process.exit(0);
  };

  const onParentSignal = () => {
    cleanup().catch(() => process.exit(1));
  };
  process.on("SIGINT", onParentSignal);
  process.on("SIGTERM", onParentSignal);
  cleanupListeners.push(() => {
    process.off("SIGINT", onParentSignal);
    process.off("SIGTERM", onParentSignal);
  });

  // ── 8. 键盘交互 ────────────────────────────────────────
  //
  // 仅在 TTY 环境下（交互式终端）启用：
  //   r — 手动触发 cold restart
  //   c — 清空控制台
  //   h — 手动触发全量 soft reload
  //   ? — 打印帮助
  //   Ctrl+C (0x03) — 退出
  //
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const onKey = (key: string) => {
      switch (key) {
        case "r":
          if (promptActive) break;
          console.log("\n[vext dev] manual cold restart...");
          operations
            .run(async () => {
              if (runtimeRecoveryRequired)
                await recoverRuntimeAfterMutation("manual");
              else if (await runPreflight("manual cold restart"))
                await restartChild("manual");
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
          operations
            .run(async () => {
              if (runtimeRecoveryRequired || !restarter.isChildAlive())
                await recoverRuntimeAfterMutation("manual reload");
              else if (await runPreflight("manual soft reload"))
                await runWorkerOperation({
                  operation: "reload",
                  files: [{ path: "src/", type: "modify" }],
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
    };
    process.stdin.on("data", onKey);
    cleanupListeners.push(() => {
      process.stdin.off("data", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    });
  }
  await operations.run(async () => {
    await watcher!.start();
    if (options.startupProfile || options.verboseLifecycle)
      console.log("[vext dev] starting initial compilation + server...");
    try {
      if (
        !(await startupProfiler.time("main.preflight.initial", () =>
          runPreflight("initial start"),
        ))
      )
        console.error(
          "[vext dev] initial checks failed. Waiting for changes...\n",
        );
      else
        await startupProfiler.time("main.worker.ready", () =>
          restartChild("initial start"),
        );
    } catch (error) {
      if (operations.signal.aborted) throw error;
      console.error(
        "[vext dev] initial start failed:",
        error instanceof Error ? error.message : error,
      );
      console.error("[vext dev] fix the error and save a file to retry\n");
    }
  });
}

async function writeRuntimeSnapshotSafe(
  rootDir: string,
  input: Omit<Parameters<typeof writeRuntimeSnapshot>[0], "rootDir">,
): Promise<void> {
  try {
    await writeRuntimeSnapshot({ rootDir, ...input });
  } catch (error) {
    console.warn(
      `[vext dev] runtime snapshot write failed: ${(error as Error).message}`,
    );
  }
}

async function patchRuntimeSnapshotSafe(
  rootDir: string,
  input: Omit<Parameters<typeof patchRuntimeSnapshot>[0], "rootDir">,
): Promise<void> {
  try {
    await patchRuntimeSnapshot({ rootDir, ...input });
  } catch (error) {
    console.warn(
      `[vext dev] runtime snapshot update failed: ${(error as Error).message}`,
    );
  }
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
  const seenOptions = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case "--root":
        {
          const parsed = readRequiredOptionValueOrExit(args, i, arg, "<path>");
          options.root = parsed.value;
          i = parsed.nextIndex;
        }
        break;

      case "--port":
        {
          const parsed = readRequiredOptionValueOrExit(
            args,
            i,
            arg,
            "<number>",
          );
          options.port = parseDevIntegerValue(parsed.value, {
            label: "port number",
            min: 1,
            max: 65535,
          });
          i = parsed.nextIndex;
        }
        break;

      case "--host":
        {
          const parsed = readRequiredOptionValueOrExit(
            args,
            i,
            arg,
            "<string>",
          );
          options.host = parsed.value;
          i = parsed.nextIndex;
        }
        break;

      case "--config":
        markUniqueOption(seenOptions, "--config");
        {
          const parsed = readRequiredOptionValueOrExit(args, i, arg, "<name>");
          options.configProfile = parsed.value;
          i = parsed.nextIndex;
        }
        break;

      case "--poll":
        options.poll = true;
        break;

      case "--poll-interval":
        {
          const parsed = readRequiredOptionValueOrExit(args, i, arg, "<ms>");
          options.pollInterval = parseDevIntegerValue(parsed.value, {
            label: "--poll-interval",
            min: 1,
          });
          i = parsed.nextIndex;
        }
        break;

      case "--debounce":
        {
          const parsed = readRequiredOptionValueOrExit(args, i, arg, "<ms>");
          options.debounce = parseDevIntegerValue(parsed.value, {
            label: "--debounce",
            min: 0,
          });
          i = parsed.nextIndex;
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
        {
          const parsed = readRequiredOptionValueOrExit(args, i, arg, "<path>");
          options.startupProfileJson = parsed.value;
          i = parsed.nextIndex;
        }
        break;

      case "--verbose-lifecycle":
        options.verboseLifecycle = true;
        break;

      case "--port-conflict":
        {
          const parsed = readRequiredOptionValueOrExit(
            args,
            i,
            arg,
            "<error|prompt|kill|next>",
          );
          const strategy = parsed.value;
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
          i = parsed.nextIndex;
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
        failUnknownCliArgument(arg, printDevHelp);
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
    options.debounce = parseDevIntegerValue(process.env.VEXT_DEV_DEBOUNCE, {
      label: "VEXT_DEV_DEBOUNCE",
      min: 0,
    });
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

function parseDevIntegerValue(
  value: string,
  options: { label: string; min: number; max?: number },
): number {
  const isInteger = /^[+-]?\d+$/u.test(value);
  const parsed = isInteger ? Number(value) : Number.NaN;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;

  if (!Number.isSafeInteger(parsed) || parsed < options.min || parsed > max) {
    console.error(`[vextjs] Invalid ${options.label} value: "${value}"`);
    process.exit(1);
  }

  return parsed;
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
  Positional arguments are not supported.
  Options that take values require a non-option value.
  Numeric options require complete integer values (for example, 3000x is invalid).

  Reload strategy (Tier 1/2/3):
    T1  Code changes (modify)    → soft reload via per-module compilation
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

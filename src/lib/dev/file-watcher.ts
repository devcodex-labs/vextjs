import { watch, type FSWatcher } from "node:fs";
import { join, relative, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { classifyChange } from "./change-classifier.js";
import type { ClassifierOptions } from "./change-classifier.js";
import {
  readWatchSnapshot,
  readWatchTargets,
  type WatchSnapshot,
  type WatchTarget,
} from "./watch-snapshot.js";

/**
 * file-watcher.ts — VextFileWatcher 文件监听器（Phase 2A）
 *
 * 热重载的入口组件，负责：
 *
 *   1. **监听** `src/` 目录（含 `src/preload/`）、兼容的项目根 `preload/`、`public/` 和根目录配置文件的变更
 *   2. **分类** 变更文件为 `cold`（冷重启）、`soft`（热替换）、`client`（前端重建）或 `ignore`（忽略）
 *   3. **识别变更类型**（`modify` / `add` / `delete`）— 决定走 Tier 1 还是 Tier 2 编译路径
 *   4. **防抖合并** 配置窗口内的变更，按窗口前后存在性确定最终事件
 *   5. **Docker 兼容** — inotify 不可用时自动降级为 polling
 *
 * 重要设计约束：
 *   - FileWatcher 监听的是 `src/` **源码目录**，不是 `.vext/dev/` 编译产物目录。
 *     这避免了 esbuild 编译输出触发二次变更事件的问题。
 *   - fs.watch 事件提示和轮询共用完整扫描器；读失败保留上一快照并重试。
 *   - 防抖窗口默认 0ms（不开启），文件变更立即触发重载；可通过 --debounce 选项开启。
 *
 * 事件：
 *   - `change` — 文件变更事件（FileChangeEvent），防抖合并后发射
 *
 * @module lib/dev/file-watcher
 * @see 11c-file-watcher.md（完整设计文档）
 * @see 11-hot-reload.md §3（文件分类规则）
 * @see IMPLEMENTATION-PLAN.md 任务 2.3
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * VextFileWatcher 构造选项
 */
export interface WatcherOptions {
  /** 项目根目录（绝对路径） */
  root: string;

  /** 防抖间隔（ms），默认 0（不开启防抖，文件变更立即触发重载） */
  debounce?: number;

  /** 使用轮询模式（Docker/网络文件系统降级方案） */
  usePolling?: boolean;

  /** 轮询间隔（ms），仅 usePolling 为 true 时有效，默认 1000ms */
  pollInterval?: number;

  /**
   * 内部分类与已解析目录 DTO；coldPatterns / ignorePatterns 是监听器扩展点，
   * 不是 config.dev 的公开配置键。
   */
  classifierOptions?: ClassifierOptions;
}

/**
 * 单个文件的变更信息
 *
 * 用于分级编译决策：
 *   - `modify` → Tier 1（批量编译变更文件）
 *   - `add` / `delete` → Tier 2（重建编译入口集合）
 */
export interface FileChangeInfo {
  /** 相对于项目根目录的文件路径（使用 / 分隔符，如 "src/routes/user.ts"） */
  path: string;

  /** 变更类型：modify=内容修改, add=新增文件, delete=删除文件 */
  type: "modify" | "add" | "delete";
}

/**
 * 文件变更事件（防抖合并后发射）
 *
 * 一个事件可能包含多个文件的变更（防抖窗口内的所有变更合并为一个事件）。
 *
 * action 字段是所有变更的合并结果：
 *   - 只要有一个 `cold` 分类的文件 → action = 'cold'（触发 Cold Restart）
 *   - 有 server source 变更 → action = 'soft'（触发 Soft Reload）
 *   - 只有 client 变更 → action = 'client'（触发前端重建）
 */
export interface FileChangeEvent {
  /** 变更文件列表（含路径和变更类型） */
  files: FileChangeInfo[];

  /** 合并后的最终动作（有一个 cold 就是 cold） */
  action: "soft" | "cold" | "client";
}

// ── 内部类型 ────────────────────────────────────────────────

/**
 * Pending 变更条目（防抖期间暂存）
 */
interface PendingChange {
  action: "soft" | "cold" | "client";
  type: "modify" | "add" | "delete";
}

// ── VextFileWatcher 类 ──────────────────────────────────────

export class VextFileWatcher extends EventEmitter {
  private nativeWatchers = new Map<
    string,
    WatchTarget & { watcher: FSWatcher }
  >();
  private running = false;
  private generation = 0;
  private configurationRevision = 0;
  private initializing = false;
  private startTask: Promise<void> | undefined;
  private scanRunner: Promise<void> | undefined;
  private scanRequested = false;
  private dirtyPaths = new Set<string>();
  private snapshot: WatchSnapshot = new Map();
  private pendingChanges = new Map<string, PendingChange>();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private lastScanError: string | undefined;
  private readonly options: Required<
    Omit<WatcherOptions, "classifierOptions">
  > & { classifierOptions?: ClassifierOptions };

  constructor(options: WatcherOptions) {
    super();
    this.options = {
      debounce: 0,
      usePolling: false,
      pollInterval: 1000,
      ...options,
      root: resolve(options.root),
      classifierOptions: {
        ...options.classifierOptions,
        rootDir: resolve(options.root),
      },
    };
  }

  /** 配置由 child 一次求值；parent 只消费目录 DTO，不执行用户配置。 */
  updateClassifierOptions(options: ClassifierOptions): void {
    this.options.classifierOptions = { ...options, rootDir: this.options.root };
    this.configurationRevision++;
    this.requestScan();
  }

  start(): Promise<void> {
    if (this.running) return this.startTask ?? Promise.resolve();
    this.running = true;
    this.initializing = true;
    const generation = ++this.generation;
    const task = (async () => {
      try {
        let revision: number;
        let snapshot: WatchSnapshot;
        do {
          revision = this.configurationRevision;
          snapshot = await readWatchSnapshot(
            this.options.root,
            this.options.classifierOptions,
          );
          if (!this.isCurrent(generation)) return;
        } while (revision !== this.configurationRevision);
        this.snapshot = snapshot;
        this.initializing = false;
        if (this.options.usePolling) this.startPolling();
        else this.reconcileNativeWatchers(generation);
        // 挂载与初次扫描之间的变化也必须得到下一轮检查。
        this.requestScan();
      } catch (error) {
        if (this.isCurrent(generation)) this.stop();
        throw error;
      } finally {
        if (this.generation === generation) this.startTask = undefined;
      }
    })();
    this.startTask = task;
    return task;
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.initializing = false;
    this.startTask = undefined;
    this.scanRunner = undefined;
    this.scanRequested = false;
    this.closeNativeWatchers();
    clearTimeout(this.debounceTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    this.debounceTimer = this.retryTimer = this.pollTimer = undefined;
    this.pendingChanges.clear();
    this.dirtyPaths.clear();
    this.snapshot = new Map();
    this.lastScanError = undefined;
  }

  private isCurrent(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private closeNativeWatchers(): void {
    for (const { watcher } of this.nativeWatchers.values()) watcher.close();
    this.nativeWatchers.clear();
  }

  private reconcileNativeWatchers(generation: number): void {
    if (!this.isCurrent(generation) || this.options.usePolling) return;
    const targets = readWatchTargets(
      this.options.root,
      this.options.classifierOptions,
    );
    for (const [target, current] of this.nativeWatchers) {
      const next = targets.get(target);
      if (
        !next ||
        next.identity !== current.identity ||
        next.recursive !== current.recursive
      ) {
        current.watcher.close();
        this.nativeWatchers.delete(target);
      }
    }
    for (const [target, descriptor] of targets) {
      if (this.nativeWatchers.has(target)) continue;
      try {
        const watcher = watch(
          target,
          { recursive: descriptor.recursive, persistent: true },
          (_event, filename) => {
            if (!this.isCurrent(generation)) return;
            const hint = filename
              ? relative(
                  this.options.root,
                  join(target, String(filename)),
                ).replaceAll("\\", "/")
              : undefined;
            this.requestScan(hint);
          },
        );
        watcher.on("error", (error: Error) => {
          if (
            this.isCurrent(generation) &&
            this.nativeWatchers.get(target)?.watcher === watcher
          )
            this.fallbackToPolling(error);
        });
        this.nativeWatchers.set(target, { ...descriptor, watcher });
      } catch (error) {
        this.fallbackToPolling(error);
        return;
      }
    }
  }

  private fallbackToPolling(error: unknown): void {
    if (!this.running) return;
    console.warn(
      "[vext dev] native file watch failed; falling back to polling:",
      error,
    );
    this.closeNativeWatchers();
    this.options.usePolling = true;
    this.startPolling();
    // 保留已知快照和积压事件；重新 start 会丢掉降级期间的修改。
    this.requestScan();
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    const generation = this.generation;
    this.pollTimer = setInterval(() => {
      if (this.isCurrent(generation) && !this.scanRunner) this.requestScan();
    }, this.options.pollInterval);
  }

  private requestScan(hint?: string): void {
    if (!this.running) return;
    if (hint) this.dirtyPaths.add(hint);
    this.scanRequested = true;
    if (this.initializing || this.scanRunner) return;
    const generation = this.generation;
    const runner = Promise.resolve().then(() => this.drainScans(generation));
    this.scanRunner = runner;
    void runner.finally(() => {
      if (this.scanRunner !== runner) return;
      this.scanRunner = undefined;
      if (this.isCurrent(generation) && this.scanRequested) this.requestScan();
    });
  }

  private async drainScans(generation: number): Promise<void> {
    while (this.isCurrent(generation) && this.scanRequested) {
      this.scanRequested = false;
      const hints = this.dirtyPaths;
      this.dirtyPaths = new Set();
      const revision = this.configurationRevision;
      try {
        const next = await readWatchSnapshot(
          this.options.root,
          this.options.classifierOptions,
        );
        if (!this.isCurrent(generation)) return;
        if (revision !== this.configurationRevision) {
          for (const hint of hints) this.dirtyPaths.add(hint);
          this.scanRequested = true;
          continue;
        }
        this.reconcileNativeWatchers(generation);
        const changes: FileChangeInfo[] = [];
        for (const [file, stamp] of next) {
          const previous = this.snapshot.get(file);
          if (previous === undefined) changes.push({ path: file, type: "add" });
          else if (stamp !== previous || hints.has(file))
            changes.push({ path: file, type: "modify" });
        }
        for (const file of this.snapshot.keys()) {
          if (!next.has(file)) changes.push({ path: file, type: "delete" });
        }
        this.snapshot = next;
        for (const change of changes)
          this.onFileChange(change.path, change.type);
        if (this.lastScanError !== undefined) {
          this.lastScanError = undefined;
          console.info("[vext dev] file monitoring recovered");
        }
      } catch (error) {
        if (!this.isCurrent(generation)) return;
        for (const hint of hints) this.dirtyPaths.add(hint);
        this.scanRequested = false;
        const detail = error instanceof Error ? error.message : String(error);
        if (detail !== this.lastScanError) {
          this.lastScanError = detail;
          console.warn(
            "[vext dev] file scan failed; retaining previous state and retrying:",
            error,
          );
        }
        if (!this.retryTimer) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            if (this.isCurrent(generation)) this.requestScan();
          }, this.options.pollInterval);
        }
        return;
      }
    }
  }

  private onFileChange(
    relativePath: string,
    changeType: FileChangeInfo["type"],
  ): void {
    if (!this.running) return;
    const classification = classifyChange(
      relativePath,
      this.options.classifierOptions,
    );
    if (classification.action === "ignore") return;
    const existing = this.pendingChanges.get(relativePath);
    // 首次 add 表示窗口开始时不存在；后续 modify 不能抹掉这个事实。
    const existed = existing ? existing.type !== "add" : changeType !== "add";
    const present = changeType !== "delete";
    if (!existed && !present) this.pendingChanges.delete(relativePath);
    else
      this.pendingChanges.set(relativePath, {
        action:
          existing &&
          compareActionPriority(existing.action, classification.action) > 0
            ? existing.action
            : classification.action,
        type: !present ? "delete" : existed ? "modify" : "add",
      });
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), this.options.debounce);
  }

  private flush(): void {
    this.debounceTimer = undefined;
    if (!this.running || this.pendingChanges.size === 0) return;
    const files = [...this.pendingChanges]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([path, info]) => ({ path, type: info.type }));
    const values = [...this.pendingChanges.values()];
    const action = values.some((value) => value.action === "cold")
      ? "cold"
      : values.some((value) => value.action === "soft")
        ? "soft"
        : "client";
    this.pendingChanges.clear();
    this.emit("change", { files, action } satisfies FileChangeEvent);
  }
}

function compareActionPriority(
  left: PendingChange["action"],
  right: PendingChange["action"],
): number {
  const order = { client: 1, soft: 2, cold: 3 } as const;
  return order[left] - order[right];
}

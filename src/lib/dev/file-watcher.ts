import { watch, statSync, existsSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { EventEmitter } from "node:events";
import { classifyChange } from "./change-classifier.js";
import type { ClassifierOptions } from "./change-classifier.js";

/**
 * file-watcher.ts — VextFileWatcher 文件监听器（Phase 2A）
 *
 * 热重载的入口组件，负责：
 *
 *   1. **监听** `src/` 目录、项目根 `preload/` 目录和根目录配置文件的变更
 *   2. **分类** 变更文件为 `cold`（冷重启）、`soft`（热替换）或 `ignore`（忽略）
 *   3. **识别变更类型**（`modify` / `add` / `delete`）— 决定走 Tier 1 还是 Tier 2 编译路径
 *   4. **防抖合并** 100ms 窗口内的多个变更为一次 reload 事件
 *   5. **Docker 兼容** — inotify 不可用时自动降级为 polling
 *
 * 重要设计约束：
 *   - FileWatcher 监听的是 `src/` **源码目录**，不是 `.vext/dev/` 编译产物目录。
 *     这避免了 esbuild 编译输出触发二次变更事件的问题。
 *   - 使用 Node.js 内置 `fs.watch`（零外部依赖），不依赖 chokidar 等第三方库。
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
   * 用户自定义分类选项（从 config.dev 传入）
   *
   * 允许用户在配置文件中自定义 coldPatterns / ignorePatterns，
   * 覆盖内置的文件分类规则。
   */
  classifierOptions?: ClassifierOptions;
}

/**
 * 单个文件的变更信息
 *
 * 用于分级编译决策：
 *   - `modify` → Tier 1（compileSingle，~1-5ms）
 *   - `add` / `delete` → Tier 2（rebuildWithNewEntryPoints，~50-600ms）
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
 *   - 全部为 `soft` 分类 → action = 'soft'（触发 Soft Reload）
 */
export interface FileChangeEvent {
  /** 变更文件列表（含路径和变更类型） */
  files: FileChangeInfo[];

  /** 合并后的最终动作（有一个 cold 就是 cold） */
  action: "soft" | "cold";
}

// ── 内部类型 ────────────────────────────────────────────────

/**
 * Pending 变更条目（防抖期间暂存）
 */
interface PendingChange {
  action: "soft" | "cold";
  type: "modify" | "add" | "delete";
}

/**
 * 可关闭的资源接口（统一管理 FSWatcher 和 polling 定时器）
 */
interface Closeable {
  close(): void;
}

// ── VextFileWatcher 类 ──────────────────────────────────────

export class VextFileWatcher extends EventEmitter {
  /**
   * 活跃的 watcher 列表（fs.watch 实例或 polling 定时器包装）
   *
   * stop() 时遍历关闭所有 watcher。
   */
  private watchers: Closeable[] = [];

  /** 当前挂载的项目级 preload 目录 watcher（如存在） */
  private preloadWatcher: Closeable | null = null;

  /**
   * 防抖期间暂存的变更集合
   *
   * key: 相对于项目根目录的文件路径（/ 分隔符）
   * value: 分类动作 + 变更类型
   *
   * 同一文件在防抖窗口内多次变更时，cold 优先级最高。
   */
  private pendingChanges = new Map<string, PendingChange>();

  /**
   * 防抖定时器
   *
   * 每次收到新变更时重置定时器。
   * 定时器到期后调用 flush() 合并发射事件。
   */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 配置选项（已填充默认值）
   */
  private readonly options: Required<
    Omit<WatcherOptions, "classifierOptions">
  > & {
    classifierOptions?: ClassifierOptions;
  };

  /**
   * v2.2：已知文件路径集合，用于区分 add 和 modify
   *
   * 在 start() 时扫描 src/ 初始化，后续根据文件变更事件维护：
   *   - add 事件 → 加入集合
   *   - delete 事件 → 从集合移除
   *
   * fs.watch 的 'rename' 事件无法直接区分新建和删除，
   * 需要配合 existsSync + knownFiles 来判断。
   */
  private knownFiles = new Set<string>();

  constructor(options: WatcherOptions) {
    super();
    this.options = {
      debounce: 0,
      usePolling: false,
      pollInterval: 1000,
      ...options,
    };
  }

  // ── 启动 ────────────────────────────────────────────────

  /**
   * start — 启动文件监听
   *
   * 流程：
   *   1. 扫描 src/ 初始化已知文件集合（knownFiles）
   *   2. 根据 usePolling 选项决定监听模式：
   *      - polling = false → 使用 fs.watch（递归监听 src/ + 单文件监听根配置）
   *      - polling = true → 使用 setInterval 定期扫描
   *
   * 监听目标：
     *   - src/ 目录（递归，所有源码文件变更）
     *   - preload/ 目录（非递归，项目级 preload 文件变更）
   *   - 根目录配置文件（package.json, tsconfig.json）
   *   - .env 文件（.env, .env.local, .env.production 等）
   */
  async start(): Promise<void> {
    const { root, usePolling } = this.options;

    // v2.2: 初始化已知文件集合（用于区分 add/modify/delete）
    await this.initKnownFiles(root);

    if (usePolling) {
      this.startPolling();
      return;
    }

    // ── 递归监听 src/ 目录 ──────────────────────────────
    const srcDir = join(root, "src");

    try {
      const watcher = watch(
        srcDir,
        {
          recursive: true,
          persistent: true,
        },
        (eventType, filename) => {
          if (!filename) return;

          const relativePath = relative(root, join(srcDir, filename));
          const normalizedPath = relativePath.replace(/\\/g, "/");

          // v2.2 修复：根据 eventType 和文件系统状态准确判断变更类型
          //
          // fs.watch 的 eventType 语义：
          //   'change'  → 文件内容修改（Windows/macOS/Linux 一致）
          //   'rename'  → 文件新建、删除、或重命名（无法直接区分）
          //
          // v2.1 Bug：所有事件 changeType 默认为 'modify'，Tier 2 永远不触发。
          // v2.2 Fix：
          //   - 'change' 事件 → 'modify'
          //   - 'rename' 事件 → 用 existsSync 判断文件是否存在：
          //     - 存在 + 不在 knownFiles 中 → 'add'（新文件）
          //     - 存在 + 在 knownFiles 中 → 'modify'（某些平台 rename 后同名写回）
          //     - 不存在 → 'delete'
          const changeType = this.detectChangeType(
            eventType,
            normalizedPath,
            join(srcDir, filename),
          );

          this.onFileChange(normalizedPath, changeType);
        },
      );

      watcher.on("error", (err) => {
        // Docker 中 inotify 可能报 ENOSPC，降级为 polling
        if ((err as NodeJS.ErrnoException).code === "ENOSPC") {
          console.warn(
            "[vext dev] inotify limit reached, falling back to polling",
          );
          this.restartWithPolling();
        }
      });

      this.watchers.push(watcher);
    } catch {
      // src/ 目录不存在时静默跳过
    }

    // ── preload/ 目录监听（项目级 preload，非递归）─────────
    this.attachPreloadWatcher(root);

    // ── 项目根目录监听（补足 preload/ 动态创建/删除）───────
    try {
      const watcher = watch(
        root,
        {
          recursive: false,
          persistent: true,
        },
        (_eventType, filename) => {
          if (!filename) return;

          const normalized = String(filename).replace(/\\/g, "/");
          if (!normalized.startsWith("preload")) return;

          void this.reconcilePreloadWatcher(root);
        },
      );

      watcher.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOSPC") {
          console.warn(
            "[vext dev] inotify limit reached, falling back to polling",
          );
          this.restartWithPolling();
        }
      });

      this.watchers.push(watcher);
    } catch {
      // 根目录监听失败时静默跳过
    }

    // ── 根目录配置文件单独监听 ──────────────────────────
    //
    // 配置文件变更触发 Cold Restart，需要在 src/ 外单独监听。
    // 这些文件通常在项目根目录（与 src/ 同级）。
    //
    const rootConfigFiles = ["package.json", "tsconfig.json"];

    // .env 文件（含 .env.local, .env.production 等）
    const envFiles = this.findEnvFiles(root);

    for (const configFile of rootConfigFiles) {
      const fullPath = join(root, configFile);
      try {
        statSync(fullPath);
        const watcher = watch(fullPath, () => {
          // 配置文件只关心内容修改，不关心 add/delete
          this.onFileChange(configFile, "modify");
        });
        this.watchers.push(watcher);
      } catch {
        // 文件不存在，跳过
      }
    }

    // .env 文件监听
    for (const envFile of envFiles) {
      const fullPath = join(root, envFile);
      try {
        const watcher = watch(fullPath, () => {
          this.onFileChange(envFile, "modify");
        });
        this.watchers.push(watcher);
      } catch {
        // 文件不存在，跳过
      }
    }
  }

  // ── 停止 ────────────────────────────────────────────────

  /**
   * stop — 停止所有 watcher 并清理状态
   *
   * 关闭所有 fs.watch 实例和 polling 定时器，
   * 清空 pending 变更和已知文件集合。
   *
   * 调用后可通过 start() 重新启动。
   */
  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingChanges.clear();
    this.knownFiles.clear();
    this.preloadWatcher = null;
  }

  // ── 内部方法 ──────────────────────────────────────────────

  /**
   * findEnvFiles — 查找根目录下所有 .env 文件
   *
   * 匹配 .env, .env.local, .env.production, .env.development 等。
   *
   * @param root 项目根目录
   * @returns .env 文件名列表
   */
  private findEnvFiles(root: string): string[] {
    try {
      const entries = readdirSync(root, { encoding: "utf-8" });
      return entries.filter((f: string) => /^\.env(\..+)?$/.test(f));
    } catch {
      return [".env"]; // fallback: 至少监听 .env
    }
  }

  /**
   * detectChangeType — 根据 fs.watch 事件类型和文件系统状态判断变更类型（v2.2）
   *
   * fs.watch 的 eventType 语义在不同平台有差异：
   *
   * | 平台    | eventType='change' | eventType='rename'          |
   * |---------|-------------------|-----------------------------|
   * | macOS   | 内容修改           | 新建/删除/重命名              |
   * | Windows | 内容修改           | rename 可能触发两次            |
   * | Linux   | 内容修改           | vim 写文件时可能报 rename       |
   *
   * 此方法统一处理跨平台差异：
   *   - 'change' → 'modify'
   *   - 'rename' → 检查文件是否存在 + knownFiles 集合来区分 add/modify/delete
   *
   * @param eventType fs.watch 回调的 eventType 参数
   * @param normalizedPath 相对于项目根的规范化路径（/ 分隔符）
   * @param absolutePath 文件的绝对路径（用于 existsSync 检查）
   * @returns 变更类型
   */
  private detectChangeType(
    eventType: string,
    normalizedPath: string,
    absolutePath: string,
  ): "modify" | "add" | "delete" {
    if (eventType === "change") {
      // 内容修改（所有平台一致）
      return "modify";
    }

    // eventType === 'rename'：可能是新建、删除或重命名
    if (existsSync(absolutePath)) {
      // 文件存在
      if (this.knownFiles.has(normalizedPath)) {
        // 已知文件 — 可能是某些平台将内容修改也报为 rename
        // 或者是 Vim/Emacs 的 "delete + rename" 策略中的 rename 阶段
        return "modify";
      } else {
        // 新文件 — add
        this.knownFiles.add(normalizedPath);
        return "add";
      }
    } else {
      // 文件不存在 — delete
      this.knownFiles.delete(normalizedPath);
      return "delete";
    }
  }

  /**
   * initKnownFiles — 初始化已知文件集合（v2.2）
   *
   * 启动时扫描 src/ 目录，记录所有已存在的文件路径。
   * 后续 detectChangeType() 通过检查文件是否在 knownFiles 中
   * 来区分 add 和 modify。
   *
   * @param root 项目根目录
   */
  private async initKnownFiles(root: string): Promise<void> {
    this.knownFiles.clear();
    const srcDir = join(root, "src");
    const files = [
      ...(await this.walkDirectory(srcDir)),
      ...(await this.listPreloadFiles(root)),
    ];
    for (const file of files) {
      const rel = relative(root, file).replace(/\\/g, "/");
      this.knownFiles.add(rel);
    }
  }

  private attachPreloadWatcher(root: string): void {
    if (this.preloadWatcher) return;

    const preloadDir = join(root, "preload");

    try {
      const watcher = watch(
        preloadDir,
        {
          recursive: false,
          persistent: true,
        },
        (eventType, filename) => {
          if (!filename) return;

          const relativePath = relative(root, join(preloadDir, filename));
          const normalizedPath = relativePath.replace(/\\/g, "/");

          const changeType = this.detectChangeType(
            eventType,
            normalizedPath,
            join(preloadDir, filename),
          );

          this.onFileChange(normalizedPath, changeType);
        },
      );

      watcher.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOSPC") {
          console.warn(
            "[vext dev] inotify limit reached, falling back to polling",
          );
          this.restartWithPolling();
        }
      });

      this.preloadWatcher = watcher;
      this.watchers.push(watcher);
    } catch {
      // preload/ 目录不存在时静默跳过
    }
  }

  private async reconcilePreloadWatcher(root: string): Promise<void> {
    const preloadDir = join(root, "preload");

    if (!existsSync(preloadDir)) {
      for (const filePath of [...this.knownFiles]) {
        if (!filePath.startsWith("preload/")) continue;
        this.knownFiles.delete(filePath);
        this.onFileChange(filePath, "delete");
      }

      if (this.preloadWatcher) {
        this.preloadWatcher.close();
        this.preloadWatcher = null;
      }
      return;
    }

    if (!this.preloadWatcher) {
      this.attachPreloadWatcher(root);
    }

    const currentFiles = await this.listPreloadFiles(root);
    for (const file of currentFiles) {
      const relativePath = relative(root, file).replace(/\\/g, "/");
      if (this.knownFiles.has(relativePath)) continue;
      this.knownFiles.add(relativePath);
      this.onFileChange(relativePath, "add");
    }
  }

  /**
   * onFileChange — 处理文件变更事件
   *
   * 调用 classifyChange() 分类文件变更，忽略 ignore 类型，
   * 将 cold/soft 类型加入 pending 集合，启动防抖定时器。
   *
   * 合并策略：
   *   - 同一文件在防抖窗口内多次变更 → 保留最高优先级的 action（cold > soft）
   *   - 不同文件独立记录
   *
   * @param relativePath 相对于项目根目录的文件路径（/ 分隔符）
   * @param changeType 变更类型
   */
  private onFileChange(
    relativePath: string,
    changeType: "modify" | "add" | "delete",
  ): void {
    const classification = classifyChange(
      relativePath,
      this.options.classifierOptions,
    );
    if (classification.action === "ignore") return;

    // 合并到 pending 集合
    // 如果已经有一个 cold，保持 cold（cold 优先级最高）
    const existing = this.pendingChanges.get(relativePath);
    if (!existing || classification.action === "cold") {
      this.pendingChanges.set(relativePath, {
        action: classification.action,
        type: changeType,
      });
    }

    // 防抖：重置定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.flush(), this.options.debounce);
  }

  /**
   * flush — 将 pending 变更合并为一个 FileChangeEvent 并发射
   *
   * 在防抖定时器到期后调用。
   * 将 pendingChanges Map 转换为 FileChangeEvent 并发射 'change' 事件。
   *
   * action 合并规则：
   *   - 只要有一个文件的 action 为 'cold' → 整体 action = 'cold'
   *   - 全部为 'soft' → 整体 action = 'soft'
   */
  private flush(): void {
    if (this.pendingChanges.size === 0) return;

    const files: FileChangeInfo[] = [...this.pendingChanges.entries()].map(
      ([filePath, info]) => ({ path: filePath, type: info.type }),
    );
    const hasCold = [...this.pendingChanges.values()].some(
      (v) => v.action === "cold",
    );

    const event: FileChangeEvent = {
      files,
      action: hasCold ? "cold" : "soft",
    };

    this.pendingChanges.clear();
    this.debounceTimer = null;

    this.emit("change", event);
  }

  /**
   * restartWithPolling — 当 inotify 限制时降级为 polling 模式
   *
   * 关闭所有现有 watcher，切换到 polling 模式重新开始监听。
   * 这是 Docker 容器中 inotify 报 ENOSPC 时的降级策略。
   */
  private restartWithPolling(): void {
    this.stop();
    this.options.usePolling = true;
    this.startPolling();
  }

  /**
   * startPolling — Polling 降级方案
   *
   * 适用于 Docker 挂载卷、网络文件系统等 fs.watch 不可靠的环境。
   *
   * 工作原理：
   *   1. 初始扫描建立基线（记录所有文件的 mtime）
   *   2. 每隔 pollInterval 毫秒重新扫描
   *   3. 对比前后两轮的文件列表和 mtime：
   *      - 新出现的文件 → add
   *      - mtime 变化的文件 → modify
   *      - 消失的文件 → delete
   *
   * v2.2 改进：polling 模式也能正确检测 add/delete
   * （通过对比前后两轮文件列表的差集）。
   *
   * 也会监听根目录配置文件（package.json, tsconfig.json, .env*）。
   */
  private startPolling(): void {
    const { root, pollInterval } = this.options;
    const fileStats = new Map<string, number>(); // path → mtime
    let initialized = false;

    const poll = async () => {
      const srcDir = join(root, "src");
      const files = [
        ...(await this.walkDirectory(srcDir)),
        ...(await this.listPreloadFiles(root)),
      ];
      const currentPaths = new Set<string>();

      for (const file of files) {
        const relativePath = relative(root, file).replace(/\\/g, "/");
        currentPaths.add(relativePath);

        try {
          const stat = statSync(file);
          const mtime = stat.mtimeMs;
          const prev = fileStats.get(relativePath);

          if (prev === undefined) {
            // 新文件（首轮扫描除外）
            if (initialized) {
              this.onFileChange(relativePath, "add");
            }
          } else if (prev !== mtime) {
            // 内容修改
            this.onFileChange(relativePath, "modify");
          }
          fileStats.set(relativePath, mtime);
        } catch {
          // stat 失败，可能已删除（下面的删除检测会处理）
        }
      }

      // 检测已删除的文件
      for (const [trackedPath] of fileStats) {
        if (!currentPaths.has(trackedPath)) {
          fileStats.delete(trackedPath);
          this.onFileChange(trackedPath, "delete");
        }
      }

      // 轮询根目录配置文件（package.json, tsconfig.json, .env*）
      const rootConfigFiles = [
        "package.json",
        "tsconfig.json",
        ...this.findEnvFiles(root),
      ];
      for (const configFile of rootConfigFiles) {
        const fullPath = join(root, configFile);
        try {
          const stat = statSync(fullPath);
          const mtime = stat.mtimeMs;
          const prev = fileStats.get(configFile);

          if (prev === undefined) {
            // 初始记录
            fileStats.set(configFile, mtime);
          } else if (prev !== mtime) {
            fileStats.set(configFile, mtime);
            this.onFileChange(configFile, "modify");
          }
        } catch {
          // 文件不存在或 stat 失败
        }
      }

      if (!initialized) {
        initialized = true;
      }
    };

    // 初始扫描（建立基线）
    const srcDir = join(root, "src");
    Promise.all([this.walkDirectory(srcDir), this.listPreloadFiles(root)])
      .then(([srcFiles, preloadFiles]) => {
        for (const file of [...srcFiles, ...preloadFiles]) {
          const relativePath = relative(root, file).replace(/\\/g, "/");
          try {
            const stat = statSync(file);
            fileStats.set(relativePath, stat.mtimeMs);
          } catch {
            // ignore
          }
        }

        // 也记录根配置文件的初始 mtime
        const rootConfigFiles = [
          "package.json",
          "tsconfig.json",
          ...this.findEnvFiles(root),
        ];
        for (const configFile of rootConfigFiles) {
          try {
            const stat = statSync(join(root, configFile));
            fileStats.set(configFile, stat.mtimeMs);
          } catch {
            // ignore
          }
        }

        initialized = true;
      })
      .catch(() => {
        initialized = true;
      });

    const timer = setInterval(() => {
      poll().catch(() => {
        // polling 错误静默处理
      });
    }, pollInterval);

    // 包装定时器为 Closeable 接口，统一由 stop() 管理
    this.watchers.push({ close: () => clearInterval(timer) } as Closeable);
  }

  /**
   * walkDirectory — 递归遍历目录，返回所有匹配的文件路径
   *
   * 遍历规则：
   *   - 跳过以 `.` 开头的隐藏目录（如 .git, .vext）
   *   - 跳过 node_modules 目录
   *   - 只收集代码文件（.ts / .js / .mjs / .cjs / .json）
   *
   * @param dir 要遍历的目录绝对路径
   * @returns 匹配的文件绝对路径列表
   */
  private async walkDirectory(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          // 跳过隐藏目录和 node_modules
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            results.push(...(await this.walkDirectory(fullPath)));
          }
        } else if (/\.(ts|js|mjs|cjs|json)$/.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } catch {
      // 目录不存在或无权限
    }
    return results;
  }

  /**
   * listPreloadFiles — 列出项目根 preload/ 目录中的一级文件
   *
   * 仅收集项目级 preload 支持的候选文件类型，且不递归子目录。
   */
  private async listPreloadFiles(root: string): Promise<string[]> {
    const preloadDir = join(root, "preload");
    const results: string[] = [];

    try {
      const entries = await readdir(preloadDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (/\.(ts|mts|js|mjs)$/.test(entry.name)) {
          results.push(join(preloadDir, entry.name));
        }
      }
    } catch {
      // preload/ 目录不存在或无权限
    }

    return results;
  }
}

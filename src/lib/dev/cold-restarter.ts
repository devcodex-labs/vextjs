import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";

/**
 * cold-restarter.ts — Cold Restart 子进程管理器（Phase 2A）
 *
 * 当配置文件、插件、`.env`、`package.json` 或 `tsconfig.json` 变更时（Tier 3），
 * 执行完整的进程替换。这是必要的，因为这些文件影响全局行为
 * （端口、DB URI、插件 `setup()` 副作用等），无法在进程内安全热替换。
 *
 * 子进程生命周期：
 *   1. `restart(reason)` — fork 新子进程（先 safeKill 旧进程）
 *   2. `waitForReady()` — 等待子进程通过 IPC 发送 `{ type: 'ready' }` 消息
 *   3. `sendToChild(msg)` — 向子进程发送 IPC 消息（如 soft reload 指令）
 *   4. `kill()` — 终止子进程（优雅退出时调用）
 *
 * safeKill 流程：
 *   1. 发送 SIGTERM（触发子进程的优雅关闭流程，见 06c-lifecycle.md）
 *   2. 等待子进程退出（最多 killTimeout ms）
 *   3. 超时后发送 SIGKILL 强制终止
 *
 * 设计约束：
 *   - 子进程入口是纯 JS（esbuild 已编译），无需 tsx/ts-node
 *   - IPC 通道通过 fork 的 stdio 配置自动创建
 *   - restart 有 isRestarting guard，防止快速连续触发导致并行 restart
 *
 * @module lib/dev/cold-restarter
 * @see 11d-bootstrap-cli.md §1（Cold Restart 详细设计）
 * @see 06c-lifecycle.md §2（优雅关闭执行流程）
 * @see IMPLEMENTATION-PLAN.md 任务 2.4
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * ColdRestarter 构造选项
 */
export interface ColdRestarterOptions {
  /**
   * dev 子进程入口脚本路径（绝对路径）
   *
   * 指向 esbuild 编译后的 JS 文件（如 dev-entry.js），
   * 由 ColdRestarter 通过 `child_process.fork()` 执行。
   */
  entryScript: string;

  /**
   * safeKill 超时时间（毫秒），默认 5000ms
   *
   * 发送 SIGTERM 后等待子进程退出的最大时间。
   * 超时后发送 SIGKILL 强制终止。
   *
   * 建议值：
   *   - 开发环境：5000ms（默认）
   *   - 大型项目（DB 连接池较大）：10000ms
   */
  killTimeout?: number;

  /**
   * waitForReady 超时时间（毫秒），默认 30000ms
   *
   * 等待子进程发送 `{ type: 'ready' }` 消息的最大时间。
   * 超时视为启动失败。
   */
  readyTimeout?: number;

  /**
   * 传递给子进程的环境变量（合并到 process.env 上）
   *
   * 可用于传递 VEXT_DEV_MODE / VEXT_ROOT 等标识。
   */
  env?: Record<string, string>;

  /**
   * 子进程的工作目录（默认继承当前进程 cwd）
   */
  cwd?: string;

  /**
   * 额外的 Node.js 运行时参数，附加到子进程 execArgv 末尾
   *
   * 格式：["--import", "file:///abs/path/a.js", "--import", "file:///abs/path/b.js"]
   *
   * 用于注入预加载模块（如 vextjs-opentelemetry SDK 初始化文件）。
   * Cold Restart 时每次 fork 自动复用，无需重新计算。
   *
   * 由 cli/dev.ts 通过 resolvePreloads() 填充。
   */
  extraExecArgv?: string[];
}

/**
 * 子进程事件监听器
 *
 * 允许外部（如 cli/dev.ts）监听子进程的特定事件，
 * 例如子进程请求 cold restart（级联检测过大时）。
 */
export interface ColdRestarterEvents {
  /**
   * 子进程发送的 IPC 消息
   *
   * 用于捕获子进程的 `request-cold-restart` 等消息。
   */
  onChildMessage?: (msg: unknown) => void;

  /**
   * 子进程异常退出
   *
   * code 为退出码（可能为 null），signal 为终止信号（可能为 null）。
   * 仅在非预期退出时触发（restart 期间的退出不触发）。
   */
  onChildExit?: (code: number | null, signal: string | null) => void;
}

// ── ColdRestarter 类 ────────────────────────────────────────

export class ColdRestarter {
  /**
   * 当前活跃的子进程引用
   *
   * 初始为 null，restart() 调用后持有子进程引用。
   * kill() 后重置为 null。
   */
  private child: ChildProcess | null = null;

  /**
   * 重启中 guard — 防止并行 restart
   *
   * 当 restart() 正在执行时，后续的 restart() 调用直接返回。
   * 这避免了用户快速连续修改多个配置文件时触发多次 fork。
   */
  private isRestarting = false;

  /**
   * 标记是否由 restart 发起的 kill（区分预期退出和异常退出）
   */
  private isExpectedKill = false;

  private readonly entryScript: string;
  private readonly killTimeout: number;
  private readonly readyTimeout: number;
  private readonly env: Record<string, string>;
  private readonly cwd: string | undefined;
  private readonly extraExecArgv: string[];
  private events: ColdRestarterEvents = {};

  constructor(options: ColdRestarterOptions) {
    this.entryScript = options.entryScript;
    this.killTimeout = options.killTimeout ?? 5000;
    this.readyTimeout = options.readyTimeout ?? 30_000;
    this.env = options.env ?? {};
    this.cwd = options.cwd;
    this.extraExecArgv = options.extraExecArgv ?? [];
  }

  /**
   * 设置事件监听器
   *
   * 允许外部模块（如 cli/dev.ts）监听子进程事件。
   * 每次调用会覆盖之前的监听器。
   *
   * @param events 事件回调集合
   */
  setEvents(events: ColdRestarterEvents): void {
    this.events = events;
  }

  /**
   * restart — 执行 Cold Restart
   *
   * 完整流程：
   *   1. 检查 isRestarting guard（防并行）
   *   2. safeKill 旧子进程（SIGTERM → 超时 SIGKILL）
   *   3. fork 新子进程（纯 JS 入口，无需 tsx）
   *   4. 注册 IPC 消息监听 + 异常退出监听
   *   5. waitForReady（等待子进程 `{ type: 'ready' }` 消息，超时 30s）
   *
   * @param reason 重启原因（用于日志输出，如 "initial start" 或文件路径）
   * @throws 子进程启动超时或退出非零码时抛出错误
   */
  async restart(reason: string): Promise<void> {
    if (this.isRestarting) {
      // 已经在重启中，合并（不重复执行）
      return;
    }

    this.isRestarting = true;

    try {
      // ── 1. 安全终止旧进程 ──────────────────────────────
      if (this.child && !this.child.killed) {
        this.isExpectedKill = true;
        await this.safeKill(this.child);
        this.isExpectedKill = false;
      }
      this.child = null;

      // ── 2. Fork 新进程 ─────────────────────────────────
      //
      // 注意：不需要 tsx loader 或 --import tsx/esm，
      // 因为 esbuild 已将 TS 源码编译为 CJS .js 文件。
      // 子进程入口（dev-entry.js）是纯 JS。
      //
      const childEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        VEXT_DEV_MODE: "1",
        ...this.env,
      };

      // 🆕 合并父进程现有 Node.js 标志（防止覆盖 --inspect、--max-old-space-size 等），
      // 追加 --enable-source-maps 使 Error.stack 自动翻译为 .ts 源码路径（dev 模式调试），
      // 追加 extraExecArgv（预加载模块 --import，如 vextjs-opentelemetry SDK 初始化）
      const devExecArgv = [
        ...process.execArgv.filter((f) => f !== "--enable-source-maps"),
        "--enable-source-maps",
        ...this.extraExecArgv,
      ];

      this.child = fork(this.entryScript, [], {
        env: childEnv,
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        cwd: this.cwd,
        execArgv: devExecArgv,
      });
      this.setupChildListeners(this.child);

      // ── 4. 等待新进程就绪 ──────────────────────────────
      await this.waitForReady(this.child);
    } finally {
      this.isRestarting = false;
    }
  }

  /**
   * 向子进程发送 IPC 消息
   *
   * 用于向子进程传递指令，如：
   *   - `{ type: 'reload', files: [...] }` — soft reload 指令
   *   - `{ type: 'shutdown' }` — 优雅关闭指令
   *
   * 如果子进程不存在或 IPC 通道已断开，静默忽略（不抛出错误）。
   *
   * @param msg 要发送的消息（可序列化的对象）
   */
  sendToChild(msg: unknown): void {
    if (this.child?.connected) {
      this.child.send(msg as object);
    }
  }

  /**
   * kill — 终止子进程（用于进程退出清理）
   *
   * 在 CLI 退出时调用，确保子进程被正确清理。
   * 使用与 restart 相同的 safeKill 流程（SIGTERM → 超时 SIGKILL）。
   */
  async kill(): Promise<void> {
    if (this.child && !this.child.killed) {
      this.isExpectedKill = true;
      await this.safeKill(this.child);
      this.isExpectedKill = false;
      this.child = null;
    }
  }

  /**
   * 获取当前子进程的 PID（调试/日志用）
   *
   * @returns 子进程 PID，如果无活跃子进程返回 null
   */
  getChildPid(): number | null {
    return this.child?.pid ?? null;
  }

  /**
   * 检查是否正在重启中
   */
  getIsRestarting(): boolean {
    return this.isRestarting;
  }

  /**
   * 检查子进程是否存活
   */
  isChildAlive(): boolean {
    return this.child !== null && !this.child.killed;
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * safeKill — 安全终止子进程
   *
   * 流程：
   *   1. 通知子进程关闭：
   *      - Windows: 优先通过 IPC 发送 { type: 'shutdown' } 消息（触发子进程优雅关闭）
   *        IPC 不可用时降级为 child.kill('SIGTERM')
   *      - Unix: 发送 SIGTERM（触发子进程 process.on('SIGTERM') 处理器）
   *   2. 等待子进程退出（最多 killTimeout ms）
   *   3. 超时后发送 SIGKILL 强制终止
   *
   * 🐛 修复 BUG-014：Windows 上 child.kill('SIGTERM') 不会触发子进程的
   * process.on('SIGTERM') 处理器——Node.js 在 Windows 上直接调用
   * TerminateProcess API 杀死进程，导致 onClose hooks 不执行。
   *
   * 使用 Promise + 双重退出监听确保在任何情况下都能 resolve：
   *   - 正常退出：'exit' 事件触发 → resolve
   *   - 超时强制终止：SIGKILL → 'exit' 事件 → resolve
   *
   * @param child 要终止的子进程
   */
  private async safeKill(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      // 监听退出事件
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });

      // 第一步: 通知子进程优雅关闭
      if (process.platform === "win32" && child.connected) {
        // Windows: 通过 IPC 消息通知子进程执行优雅关闭
        // dev-bootstrap 的 process.on('message') 已监听 { type: 'shutdown' }
        try {
          child.send({ type: "shutdown" });
        } catch {
          // IPC 发送失败，降级为 kill
          child.kill("SIGTERM");
        }
      } else {
        // Unix: 标准 SIGTERM 信号（触发子进程 process.on('SIGTERM') 处理器）
        child.kill("SIGTERM");
      }

      // 第二步: 超时后 SIGKILL（强制终止）
      const timer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
        // SIGKILL 后 exit 事件通常很快触发，
        // 但作为保险也在这里调用 done()
        done();
      }, this.killTimeout);
    });
  }

  /**
   * waitForReady — 等待子进程发送 ready 消息
   *
   * 子进程在 devBootstrap 完成初始化后发送 `{ type: 'ready' }` IPC 消息。
   * 本方法等待该消息，超时则视为启动失败。
   *
   * 异常处理：
   *   - 超时（readyTimeout）→ reject + Error
   *   - 子进程 error 事件 → reject + 原始 Error
   *   - 子进程退出（非零码）→ reject + Error
   *
   * @param child 要等待的子进程
   * @throws 超时或子进程异常退出时抛出错误
   */
  private async waitForReady(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        child.removeListener("message", onMessage);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
      };

      const timer = setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(
            new Error(
              `[vext dev] worker startup timeout (${this.readyTimeout}ms)`,
            ),
          );
        }
      }, this.readyTimeout);

      const onMessage = (msg: unknown) => {
        if (
          !settled &&
          typeof msg === "object" &&
          msg !== null &&
          (msg as Record<string, unknown>).type === "ready"
        ) {
          cleanup();
          resolve();
        }
      };

      const onError = (err: Error) => {
        if (!settled) {
          cleanup();
          reject(err);
        }
      };

      const onExit = (code: number | null) => {
        if (!settled) {
          cleanup();
          reject(
            new Error(
              `[vext dev] worker exited with code ${code ?? "unknown"}`,
            ),
          );
        }
      };

      child.on("message", onMessage);
      child.once("error", onError);
      child.once("exit", onExit);
    });
  }

  /**
   * setupChildListeners — 为新 fork 的子进程注册持久监听器
   *
   * 这些监听器在 waitForReady 完成后继续存活，
   * 用于处理运行期间的 IPC 消息和异常退出。
   *
   * @param child 新 fork 的子进程
   */
  private setupChildListeners(child: ChildProcess): void {
    // ── IPC 消息转发 ──────────────────────────────────────
    //
    // 将子进程的 IPC 消息转发给外部监听器。
    // 子进程可能发送的消息类型：
    //   - { type: 'request-cold-restart', reason: '...' } — 级联检测过大
    //
    child.on("message", (msg: unknown) => {
      if (this.events.onChildMessage) {
        this.events.onChildMessage(msg);
      }
    });

    // ── 异常退出处理 ──────────────────────────────────────
    //
    // 仅在非预期退出时触发回调（restart 期间的 kill 不算异常）。
    // 外部可据此决定是否自动 restart 或提示用户。
    //
    child.once("exit", (code, signal) => {
      // 清除引用（防止对已退出进程调用 send/kill）
      if (this.child === child) {
        this.child = null;
      }

      // 非预期退出 → 通知外部
      if (!this.isExpectedKill && this.events.onChildExit) {
        this.events.onChildExit(code, signal);
      }
    });
  }
}

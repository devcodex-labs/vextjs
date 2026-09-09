import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ProjectOwnerGrant } from "../project/owner.js";
import { randomUUID } from "node:crypto";
import {
  readWorkerOperationRequest,
  readWorkerOperationResponse,
  type WorkerOperation,
  type WorkerOperationResult,
} from "./worker-protocol.js";

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
 *   - restart 按请求代次串行替换进程，待处理请求合并；调用者等待最新一代 ready
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
  /** 仅通过 fork IPC 交付，不写环境、日志或发现文件。 */
  ownerGrant?: ProjectOwnerGrant;
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
   * 用于注入预加载模块（如 @devcodex/opentelemetry SDK 初始化文件）。
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

  private requestedGeneration = 0;
  private completedGeneration = 0;
  private restartRunner: Promise<void> | undefined;
  private activeStartup: AbortController | undefined;
  private stopping = false;
  private stopTask: Promise<void> | undefined;
  private restartWaiters: {
    generation: number;
    resolve: () => void;
    reject: (error: unknown) => void;
  }[] = [];

  /**
   * 标记是否由 restart 发起的 kill（区分预期退出和异常退出）
   */
  private isExpectedKill = false;

  private readonly entryScript: string;
  private readonly killTimeout: number;
  private readonly readyTimeout: number;
  private readonly env: Record<string, string>;
  private readonly cwd: string | undefined;
  private extraExecArgv: string[];
  private events: ColdRestarterEvents = {};
  private readonly ownerGrant: ProjectOwnerGrant | undefined;

  constructor(options: ColdRestarterOptions) {
    this.entryScript = options.entryScript;
    this.killTimeout = options.killTimeout ?? 5000;
    this.readyTimeout = options.readyTimeout ?? 30_000;
    this.env = options.env ?? {};
    this.cwd = options.cwd;
    this.extraExecArgv = options.extraExecArgv ?? [];
    this.ownerGrant = options.ownerGrant;
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
   * 更新冷重启子进程的额外 Node.js 运行参数
   *
   * 主要用于 dev 模式在项目级 preload 发生变化后，
   * 重新计算 `--import file:///...` 列表并在下一次 cold restart 中生效。
   */
  setExtraExecArgv(extraExecArgv: string[]): void {
    this.extraExecArgv = [...extraExecArgv];
  }
  /** 每个调用等待其请求被实际 ready 的代次覆盖；合并调度不能提前成功。 */
  restart(_reason: string): Promise<void> {
    if (this.stopping)
      return Promise.reject(new Error("[vext dev] worker is stopping"));
    const generation = ++this.requestedGeneration;
    const result = new Promise<void>((resolve, reject) =>
      this.restartWaiters.push({ generation, resolve, reject }),
    );
    this.ensureRestartRunner();
    return result;
  }

  private ensureRestartRunner(): void {
    if (
      this.restartRunner ||
      this.stopping ||
      this.completedGeneration >= this.requestedGeneration
    )
      return;
    // 同一轮同步请求先合并；实际启动过程中到达的请求留给下一代。
    const runner = Promise.resolve()
      .then(() => this.drainRestarts())
      .catch((error: unknown) => {
        this.completedGeneration = this.requestedGeneration;
        this.settleRestarts(this.requestedGeneration, error);
      });
    this.restartRunner = runner;
    void runner.finally(() => {
      if (this.restartRunner === runner) this.restartRunner = undefined;
      this.ensureRestartRunner();
    });
  }

  private settleRestarts(generation: number, error?: unknown): void {
    const ready = this.restartWaiters.filter(
      (waiter) => waiter.generation <= generation,
    );
    this.restartWaiters = this.restartWaiters.filter(
      (waiter) => waiter.generation > generation,
    );
    for (const waiter of ready) {
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  }

  private async drainRestarts(): Promise<void> {
    while (
      !this.stopping &&
      this.completedGeneration < this.requestedGeneration
    ) {
      const generation = this.requestedGeneration;
      const controller = new AbortController();
      this.activeStartup = controller;
      try {
        await this.performRestart(controller.signal);
        this.completedGeneration = generation;
        // 有更新的请求时，旧调用也等待最新代，避免调用方把消息发给正被替换的 worker。
        if (generation === this.requestedGeneration)
          this.settleRestarts(generation);
      } catch (error) {
        this.completedGeneration = generation;
        this.settleRestarts(generation, error);
      } finally {
        if (this.activeStartup === controller) this.activeStartup = undefined;
      }
    }
  }

  private async performRestart(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.child) {
      this.isExpectedKill = true;
      try {
        await this.safeKill(this.child);
      } finally {
        this.isExpectedKill = false;
      }
    }
    this.child = null;
    signal.throwIfAborted();
    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      VEXT_DEV_MODE: "1",
      ...this.env,
    };
    if (this.ownerGrant) childEnv.VEXT_DEV_OWNER_REQUIRED = "1";
    else delete childEnv.VEXT_DEV_OWNER_REQUIRED;
    const devExecArgv = [
      ...process.execArgv.filter((flag) => flag !== "--enable-source-maps"),
      "--enable-source-maps",
      ...this.extraExecArgv,
    ];
    const child = fork(this.entryScript, [], {
      env: childEnv,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      cwd: this.cwd,
      execArgv: devExecArgv,
    });
    this.child = child;
    this.setupChildListeners(child);
    try {
      await this.waitForReady(child, signal);
    } catch (error) {
      await this.cleanupFailedStartup(child);
      throw error;
    }
  }

  /**
   * 向子进程发送 IPC 消息
   *
   * 用于向子进程传递指令，如：
   *   - `{ type: 'reload', files: [...] }` — soft reload 指令
   *   - `{ type: 'shutdown' }` — 优雅关闭指令
   *
   * 返回传输完成；业务执行结果由 requestOperation 的独立回执确认。
   *
   * @param msg 要发送的消息（可序列化的对象）
   */
  sendToChild(msg: unknown): Promise<void> {
    return this.sendMessage(this.child, msg);
  }

  private sendMessage(child: ChildProcess | null, msg: unknown): Promise<void> {
    if (!child || child !== this.child || !child.connected || this.stopping)
      return Promise.reject(new Error("[vext dev] worker IPC is unavailable"));
    return new Promise<void>((resolve, reject) => {
      try {
        child.send(msg as object, (error) =>
          error ? reject(error) : resolve(),
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /** 回执只接受当前 child 和本次随机 ID；queued / send callback 均不是完成。 */
  requestOperation(
    operation: WorkerOperation,
    timeout = 30_000,
  ): Promise<WorkerOperationResult> {
    const child = this.child;
    if (!child?.connected || this.stopping)
      return Promise.reject(new Error("[vext dev] worker IPC is unavailable"));
    const request = readWorkerOperationRequest({
      type: "dev-operation",
      requestId: randomUUID(),
      ...operation,
    });
    if (!request)
      return Promise.reject(new Error("[vext dev] invalid worker operation"));
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        child.off("disconnect", onDisconnect);
        child.off("error", fail);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        cleanup();
        reject(error);
      };
      const onMessage = (value: unknown) => {
        const response = readWorkerOperationResponse(value);
        if (settled || !response || response.requestId !== request.requestId)
          return;
        cleanup();
        resolve(
          response.success
            ? { success: true }
            : {
                success: false,
                error: response.error,
                requestedColdRestart: response.requestedColdRestart,
              },
        );
      };
      const onExit = () =>
        fail(new Error("[vext dev] worker exited before operation completion"));
      const onDisconnect = () =>
        fail(
          new Error(
            "[vext dev] worker IPC disconnected before operation completion",
          ),
        );
      const timer = setTimeout(
        () =>
          fail(
            new Error(
              "[vext dev] worker operation timed out; runtime state is unverified",
            ),
          ),
        timeout,
      );
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.once("disconnect", onDisconnect);
      child.once("error", fail);
      void this.sendMessage(child, request).catch(fail);
    });
  }
  /** 取消尚未完成的启动，并观察到子进程退出后才完成关闭。 */
  kill(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopping = true;
    const canceled = new Error(
      "[vext dev] worker restart canceled by shutdown",
    );
    this.activeStartup?.abort(canceled);
    this.settleRestarts(this.requestedGeneration, canceled);
    const task = (async () => {
      try {
        await this.restartRunner;
        this.completedGeneration = this.requestedGeneration;
        if (this.child) {
          this.isExpectedKill = true;
          try {
            await this.safeKill(this.child);
          } finally {
            this.isExpectedKill = false;
          }
          this.child = null;
        }
      } finally {
        this.stopping = false;
        this.stopTask = undefined;
      }
    })();
    this.stopTask = task;
    return task;
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
    return this.restartWaiters.length > 0 || this.stopping;
  }

  /**
   * 检查子进程是否存活
   */
  isChildAlive(): boolean {
    return (
      this.child !== null &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    );
  }
  /** 只有观察到 exit 才算停止完成；发出 kill 信号不是退出证据。 */
  private async safeKill(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let forced: NodeJS.Timeout | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(graceful);
        if (forced) clearTimeout(forced);
        child.off("exit", onExit);
        child.off("error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onExit = () => finish();
      const onError = (error: Error) => finish(error);
      const graceful = setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGKILL");
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        forced = setTimeout(
          () =>
            finish(
              new Error(
                "[vext dev] worker did not exit after forced termination; ownership remains protected",
              ),
            ),
          2000,
        );
      }, this.killTimeout);
      child.once("exit", onExit);
      child.once("error", onError);
      try {
        if (process.platform === "win32" && child.connected) {
          child.send({ type: "shutdown" }, (error) => {
            if (error && !settled) {
              try {
                child.kill("SIGTERM");
              } catch (failure) {
                finish(
                  failure instanceof Error
                    ? failure
                    : new Error(String(failure)),
                );
              }
            }
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  private async waitForReady(
    child: ChildProcess,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("error", onError);
        child.off("exit", onExit);
        signal.removeEventListener("abort", onAbort);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        cleanup();
        reject(error);
      };
      const timer = setTimeout(
        () =>
          fail(
            new Error(
              `[vext dev] worker startup timeout (${this.readyTimeout}ms)`,
            ),
          ),
        this.readyTimeout,
      );
      const onMessage = (message: unknown) => {
        if (
          !settled &&
          message &&
          typeof message === "object" &&
          (message as Record<string, unknown>).type === "ready"
        ) {
          cleanup();
          resolve();
        }
      };
      const onError = (error: Error) => fail(error);
      const onExit = (code: number | null) =>
        fail(
          new Error(`[vext dev] worker exited with code ${code ?? "unknown"}`),
        );
      const onAbort = () => fail(signal.reason);
      child.on("message", onMessage);
      child.once("error", onError);
      child.once("exit", onExit);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async cleanupFailedStartup(child: ChildProcess): Promise<void> {
    if (this.child !== child) return;

    const isExited = child.exitCode !== null || child.signalCode !== null;
    if (!isExited) {
      this.isExpectedKill = true;
      try {
        await this.safeKill(child);
      } finally {
        this.isExpectedKill = false;
      }
    }

    if (this.child === child) {
      this.child = null;
    }
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
      if (
        this.ownerGrant &&
        msg &&
        typeof msg === "object" &&
        (msg as Record<string, unknown>).type === "owner-request"
      ) {
        if (child.connected)
          child.send(
            { type: "owner-grant", grant: this.ownerGrant },
            (error) => {
              if (error) this.activeStartup?.abort(error);
            },
          );
        return;
      }
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

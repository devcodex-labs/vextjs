import type { AppInternals } from "./app.js";
import type { VextServerHandle } from "../types/adapter.js";
import type { VextLogger } from "../types/app.js";

/**
 * shutdown.ts — 优雅关闭信号注册与编排模块
 *
 * 职责：
 *   1. 注册 SIGTERM / SIGINT 信号处理器
 *   2. 创建关闭处理函数（串联 internals.shutdown + serverHandle）
 *   3. 提供 _testMode 守卫（测试场景跳过信号注册）
 *
 * 与 app.ts internals.shutdown() 的关系：
 *   实际的关闭逻辑（停止接受新请求 → 等待飞行请求 → onClose LIFO → process.exit）
 *   由 app.ts 中 internals.shutdown(serverHandle) 实现。
 *   本模块负责的是 **信号注册** 和 **编排调用**，不重复实现关闭逻辑。
 *
 * 设计说明：
 *   - 使用 process.on（而非 process.once）+ _shuttingDown guard
 *     支持多实例 / 测试场景（process.once 会导致第二个实例无法注册信号处理器）
 *   - _testMode 为 true 时不注册信号处理器，由 createTestApp 控制生命周期
 *   - 信号处理器内部不抛出异常，所有错误在 shutdown 内部被捕获并记录
 *
 * 使用方式（在 bootstrap.ts 中）：
 *   ```typescript
 *   import { setupShutdown } from './shutdown.js'
 *
 *   // 步骤 ⑧: 注册信号处理
 *   const cleanup = setupShutdown({
 *     internals,
 *     serverHandle,
 *     logger: app.logger,
 *     testMode: config._testMode,
 *   })
 *   ```
 *
 * @module lib/shutdown
 * @see 06c-lifecycle.md §2（优雅关闭执行流程）
 * @see 06-built-ins.md §4（createApp 内部 internals.shutdown 实现）
 * @see IMPLEMENTATION-PLAN.md 任务 1.16
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * setupShutdown 的配置参数
 */
export interface ShutdownOptions {
  /** 框架内部方法（包含 shutdown 实现） */
  internals: AppInternals;

  /** HTTP 服务器句柄（用于停止接受新连接） */
  serverHandle: VextServerHandle;

  /** 日志实例（用于关闭过程中的日志输出） */
  logger: VextLogger;

  /**
   * 测试模式标志
   *
   * 为 true 时：
   *   - 不注册 process 信号处理器（避免干扰测试进程）
   *   - internals.shutdown() 内部也不调用 process.exit()
   *
   * 由 createTestApp 设置。
   */
  testMode?: boolean;
}

/**
 * 清理函数，移除已注册的信号处理器
 *
 * 主要用于：
 *   - 测试结束后清理信号处理器（避免泄漏）
 *   - 多实例场景下，某个实例关闭后移除其信号处理器
 */
export type ShutdownCleanup = () => void;

// ── 主函数 ──────────────────────────────────────────────────

/**
 * setupShutdown — 注册优雅关闭信号处理器
 *
 * 在 bootstrap 步骤 ⑧ 中调用。
 *
 * 注册流程：
 *   1. 创建 handleSignal 闭包（调用 internals.shutdown(serverHandle)）
 *   2. 在 process 上注册 SIGTERM / SIGINT 信号监听
 *   3. 返回 cleanup 函数，调用后移除监听器
 *
 * 信号处理行为：
 *   - SIGTERM：Docker / Kubernetes / PM2 发送，表示要求进程优雅退出
 *   - SIGINT：用户按 Ctrl+C 发送
 *   - 两个信号触发相同的关闭流程
 *   - internals.shutdown 内部有 _shuttingDown guard，防止重复触发
 *
 * @param options 关闭配置
 * @returns cleanup 函数，用于移除信号处理器
 */
export function setupShutdown(options: ShutdownOptions): ShutdownCleanup {
  const { internals, serverHandle, logger, testMode = false } = options;

  // 测试模式下不注册信号处理器
  // createTestApp 会直接调用 internals.shutdown() 控制生命周期
  if (testMode) {
    return () => {
      // no-op：测试模式下无需清理
    };
  }

  // ── 创建信号处理函数 ──────────────────────────────────────
  //
  // 使用箭头函数创建闭包，持有 internals / serverHandle / logger 引用。
  // internals.shutdown() 内部有 _shuttingDown guard，
  // 即使 SIGTERM 和 SIGINT 同时或连续触发，也只会执行一次关闭流程。
  //
  const handleSignal = (signal: string): void => {
    logger.info(`[vextjs] received ${signal}, starting graceful shutdown...`);

    // internals.shutdown() 是异步的，但信号处理器不能是 async
    // 使用 .catch() 捕获错误，避免 unhandled promise rejection
    internals.shutdown(serverHandle).catch((err) => {
      logger.error(
        { error: (err as Error).message },
        `[vextjs] shutdown error after ${signal}`,
      );

      // shutdown 失败是严重错误，强制退出
      // 使用 exit code 1 表示异常退出
      process.exit(1);
    });
  };

  // ── 注册信号监听 ──────────────────────────────────────────
  //
  // 使用 process.on（而非 process.once）：
  //   - process.once 在收到第一个信号后自动移除监听器
  //   - 如果 shutdown 流程耗时较长，用户可能再次按 Ctrl+C
  //   - 第二次信号到达时 _shuttingDown guard 会直接返回（不重复执行）
  //
  // 使用命名的 wrapper 函数以便 cleanup 时精确移除：
  //
  const onSigterm = () => handleSignal("SIGTERM");
  const onSigint = () => handleSignal("SIGINT");

  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);

  // ── 返回清理函数 ──────────────────────────────────────────
  //
  // cleanup 移除已注册的信号处理器，防止：
  //   - 多实例场景下旧实例的处理器持续存在
  //   - 测试场景下信号处理器泄漏
  //
  return () => {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
  };
}

/**
 * createShutdownHandler — 创建独立的关闭处理函数
 *
 * 用于需要手动触发关闭的场景（而非信号触发），例如：
 *   - Cluster Master 通知 Worker 关闭
 *   - 健康检查失败后主动关闭
 *   - 集成测试中的手动关闭
 *
 * 与 setupShutdown 的区别：
 *   - setupShutdown 注册信号处理器（自动触发）
 *   - createShutdownHandler 返回手动调用的函数
 *
 * @param internals 框架内部方法
 * @param serverHandle HTTP 服务器句柄
 * @returns 异步关闭函数
 *
 * @example
 * ```typescript
 * const shutdown = createShutdownHandler(internals, serverHandle)
 *
 * // 某个条件触发时手动关闭
 * if (shouldShutdown) {
 *   await shutdown()
 * }
 * ```
 */
export function createShutdownHandler(
  internals: AppInternals,
  serverHandle: VextServerHandle,
): () => Promise<void> {
  return async () => {
    await internals.shutdown(serverHandle);
  };
}

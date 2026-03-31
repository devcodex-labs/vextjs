import { devBootstrap } from "./dev-bootstrap.js";

/**
 * dev-entry.ts — Dev 子进程入口（Phase 2A）
 *
 * 此文件是 ColdRestarter 通过 `child_process.fork()` 执行的入口点。
 *
 * 职责：
 *   1. 从环境变量读取项目根目录（VEXT_ROOT）
 *   2. 调用 devBootstrap() 执行完整的 dev 模式初始化
 *   3. 捕获启动失败并以非零码退出（通知 ColdRestarter 启动失败）
 *
 * 环境变量：
 *   - VEXT_ROOT — 用户项目根目录（由 cli/dev.ts 设置）
 *   - VEXT_DEV_MODE=1 — dev 模式标识（由 ColdRestarter 设置）
 *
 * 进程通信：
 *   - devBootstrap 在初始化完成后通过 IPC 发送 `{ type: 'ready' }`
 *   - ColdRestarter.waitForReady() 接收此消息后认为启动成功
 *   - 启动失败时进程以 exit code 1 退出，ColdRestarter 捕获 'exit' 事件
 *
 * 注意：
 *   - 此文件编译为 CJS .js 后由 fork 直接执行，无需 tsx loader
 *   - 不要在此文件中添加复杂逻辑，所有初始化逻辑都在 devBootstrap 中
 *
 * @module lib/dev/dev-entry
 * @see 11d-bootstrap-cli.md §4（Dev 模式 Bootstrap）
 * @see 11d-bootstrap-cli.md §1（ColdRestarter 实现）
 * @see IMPLEMENTATION-PLAN.md 任务 2.4
 */

// ── 读取项目根目录 ──────────────────────────────────────────

const projectRoot = process.env.VEXT_ROOT;

if (!projectRoot) {
  console.error(
    "[vext dev] VEXT_ROOT environment variable is not set.\n" +
      "           This file should be executed by ColdRestarter via fork(),\n" +
      "           not run directly.",
  );
  process.exit(1);
}

// ── 执行 devBootstrap ──────────────────────────────────────

devBootstrap({ projectRoot }).catch((err: unknown) => {
  // devBootstrap 内部已做资源清理（server/compiler/internals），
  // 这里只需要输出错误信息并退出。
  //
  // ColdRestarter.waitForReady() 会捕获 'exit' 事件（非零码），
  // 并将错误传播给 cli/dev.ts 的调用方。

  console.error("[vext dev] worker startup failed:");

  if (err instanceof Error) {
    console.error(err.message);

    // 输出完整 stack trace 帮助用户定位问题
    // （如配置文件语法错误、插件 setup() 异常等）
    if (err.stack) {
      console.error(err.stack);
    }
  } else {
    console.error(err);
  }

  process.exit(1);
});

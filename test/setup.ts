/**
 * Vitest 全局 setup 文件
 *
 * 在每个 worker 进程的每个测试文件执行前运行。
 *
 * 主要职责：
 *   - 提升 process.setMaxListeners 限制，消除并行测试中的 MaxListenersExceededWarning。
 *
 * 背景：
 *   cold-restarter / build-compiler / cluster 等测试在同一 worker 进程中
 *   fork 多个子进程，每个子进程都会注册 process 事件监听器
 *   （uncaughtException / unhandledRejection / SIGTERM / SIGINT / exit），
 *   并行执行时累计超过 Node.js 默认限制 10，触发 MaxListenersExceededWarning。
 *   这不是内存泄漏，测试结束后监听器会正常清理。
 */

process.setMaxListeners(30);

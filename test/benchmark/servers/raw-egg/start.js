/**
 * egg.js 基准测试启动器
 *
 * 用于 benchmark 子进程模式：由 run-benchmark.mjs 通过 fork() 启动。
 *
 * 使用 egg.startCluster API 以单 worker 模式启动 egg 应用，
 * 避免 egg-scripts 的 daemon 模式复杂度。
 *
 * 启动成功后通过 process.send({ type: 'ready', port }) 通知父进程。
 *
 * 环境变量：
 *   PORT — 监听端口（默认 7001）
 *
 * 用法：
 *   PORT=19500 node test/benchmark/servers/raw-egg/start.js
 *   # 或由 run-benchmark.mjs fork 启动
 */

'use strict';

const path = require('node:path');

const port = parseInt(process.env.PORT || '7001', 10);
const baseDir = __dirname;

// egg.startCluster 是 egg 官方推荐的编程式启动方式
// 内部启动 master → agent → worker 多进程模型
const egg = require('egg');

egg.startCluster({
  baseDir,
  port,
  workers: 1,          // 单 worker，避免多进程优势干扰基准测试公平性
  framework: path.dirname(require.resolve('egg')),
}, () => {
  console.log(`[raw-egg] egg started on http://127.0.0.1:${port} (single worker mode)`);

  // 通知父进程已就绪（子进程模式）
  if (process.send) {
    process.send({ type: 'ready', port });
  }
});

// 优雅关闭
process.on('SIGTERM', () => {
  // egg master 会自行处理 SIGTERM 信号
  // 这里确保进程最终退出
  setTimeout(() => process.exit(0), 3000);
});

process.on('SIGINT', () => {
  setTimeout(() => process.exit(0), 3000);
});

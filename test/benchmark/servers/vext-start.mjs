/**
 * vext 子进程启动脚本
 *
 * 通过环境变量配置 adapter 和端口，在独立子进程中启动 vext 服务器。
 * 启动成功后通过 IPC 向父进程发送 { type: "ready", port } 消息。
 *
 * 环境变量：
 *   BENCH_ADAPTER  — adapter 名称（native / hono / fastify / express / koa）
 *   VEXT_BENCH_MODE — normal（正式 bootstrap）或 core（私有 direct harness）
 *   PORT           — 监听端口
 *
 * 用法（由 run-benchmark.mjs 通过 fork 调用）：
 *   BENCH_ADAPTER=native PORT=19200 node test/benchmark/servers/vext-start.mjs
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// vext 项目根目录（test/benchmark/servers/ → 上三层到 vext/）
const vextRoot = join(__dirname, "..", "..", "..");

const adapter = process.env.BENCH_ADAPTER || "native";
const port = parseInt(process.env.PORT || "3000", 10);
const benchmarkMode = process.env.VEXT_BENCH_MODE || "normal";

// vext-app 项目根目录
const rootDir = join(__dirname, "vext-app");

// 检查 dist/ 是否存在（需要先 npm run build）
const distBootstrap = join(vextRoot, "dist", "lib", "bootstrap.js");
if (!existsSync(distBootstrap)) {
  console.error(
    `[vext-${adapter}] ERROR: dist/lib/bootstrap.js not found.\n` +
      `         Please run 'npm run build' before running benchmarks.`,
  );
  process.exit(1);
}

// Core 是 test/benchmark 私有入口，不能通过用户配置启用。
if (benchmarkMode === "core") {
  if (adapter !== "native") {
    throw new Error("Vext benchmark core mode is only defined for Native");
  }
  await import("./vext-core-start.mjs");
} else if (benchmarkMode !== "normal") {
  throw new Error(`Unknown VEXT_BENCH_MODE: ${benchmarkMode}`);
} else {
  // ── 启动正式 bootstrap ─────────────────────────────────────

  let serverHandle = null;

  async function start() {
    try {
      // 动态导入 vext bootstrap（使用编译后的 dist/ 目录，避免 ESM 无法直接导入 .ts）
      const { bootstrap } = await import("../../../dist/lib/bootstrap.js");

      const result = await bootstrap(rootDir);
      serverHandle = result.serverHandle;

      const actualPort = serverHandle.port;
      const actualHost = serverHandle.host;

      console.log(
        `[vext-${adapter}-${benchmarkMode}] listening on http://${actualHost}:${actualPort}`,
      );

      // 通知父进程已就绪（子进程模式）
      if (process.send) {
        process.send({
          type: "ready",
          port: actualPort,
          telemetry: result.app.adapter.getBenchmarkTelemetry?.(),
        });
      }
    } catch (err) {
      console.error(`[vext-${adapter}-${benchmarkMode}] failed to start:`, err);

      // 通知父进程启动失败
      if (process.send) {
        process.send({ type: "error", message: err.message });
      }

      process.exit(1);
    }
  }

  // ── 优雅关闭 ─────────────────────────────────────────────────

  async function shutdown() {
    if (serverHandle) {
      try {
        await serverHandle.close();
      } catch {
        // 忽略关闭错误
      }
    }
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // 父进程断开 IPC 通道时也优雅退出（防止孤儿进程）
  process.on("disconnect", shutdown);

  // ── 启动 ─────────────────────────────────────────────────────
  start();
}

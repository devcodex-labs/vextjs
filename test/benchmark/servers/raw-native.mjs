/**
 * Native 裸跑基准测试服务器
 *
 * 使用 Node.js 原生 http.createServer + find-my-way（radix trie 路由库），
 * 不依赖任何第三方 HTTP 框架（无 Fastify / Express / Koa / Hono）。
 *
 * 这是 vext Native Adapter 的"裸跑"对照组，
 * 用于测量 find-my-way + http.createServer 的基准性能，
 * 与 vext-native（经过 vext 中间件链的 Native Adapter）对比计算 overhead。
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层中间件链 + JSON 响应
 *
 * 用法：
 *   PORT=3000 node test/benchmark/servers/raw-native.mjs
 */

import { createServer } from "node:http";
import Router from "find-my-way";

const port = parseInt(process.env.PORT || "3000", 10);

// ── 创建 find-my-way 路由器 ─────────────────────────────────
const router = Router({
  ignoreTrailingSlash: true,
  caseSensitive: false,
  defaultRoute: (_req, res) => {
    sendJson(res, { code: 404, message: "Not Found" }, 404);
  },
});

// ── 辅助：发送 JSON 响应 ────────────────────────────────────
function sendJson(res, data, statusCode = 200) {
  const body = JSON.stringify(data);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

// ── 场景 1: 纯 JSON 响应 ────────────────────────────────────
router.on("GET", "/json", (_req, res) => {
  sendJson(res, { message: "Hello World" });
});

// ── 场景 2: 路由参数解析 ────────────────────────────────────
router.on("GET", "/users/:id", (_req, res, params) => {
  sendJson(res, { id: params.id, name: `User ${params.id}` });
});

// ── 场景 3: 3 层中间件链 ────────────────────────────────────
// 使用内联逻辑模拟 3 层中间件效果（与其他裸跑服务器保持一致）
//
// 中间件 1: 请求计时
// 中间件 2: 请求 ID 生成
// 中间件 3: 简单鉴权模拟（读取 header）
router.on("GET", "/chain", (req, res) => {
  // ── 中间件 1 模拟：请求计时 ──────────────────────────────
  const startTime = Date.now();

  // ── 中间件 2 模拟：请求 ID 生成 ──────────────────────────
  const requestId = crypto.randomUUID();

  // ── 中间件 3 模拟：简单鉴权（读取 header） ──────────────
  // 模拟鉴权检查（不真正拒绝，只是做一次 header 读取）
  req.headers["authorization"];
  const authenticated = true;

  // ── handler 逻辑 ─────────────────────────────────────────
  const elapsed = Date.now() - startTime;

  // 写入自定义响应头（模拟洋葱模型回溯阶段的行为）
  res.setHeader("X-Response-Time", `${elapsed}ms`);
  res.setHeader("X-Request-Id", requestId);

  sendJson(res, {
    message: "Chain complete",
    requestId,
    authenticated,
  });
});

// ── 健康检查 ─────────────────────────────────────────────────
router.on("GET", "/health", (_req, res) => {
  sendJson(res, { status: "ok" });
});

// ── 创建 HTTP 服务器 ─────────────────────────────────────────
const server = createServer((req, res) => {
  // find-my-way 的 lookup 方法：直接执行路由匹配 + 调用 handler（一步完成）
  // 比 find() + 手动调用 handler 更高效（跳过中间对象分配）
  // 未匹配路由时自动走 defaultRoute（上方配置的 404 处理）
  router.lookup(req, res);
});

// ── 启动服务器 ───────────────────────────────────────────────
server.listen(port, "127.0.0.1", () => {
  console.log(`[raw-native] listening on http://127.0.0.1:${port}`);

  // 通知父进程已就绪（子进程模式）
  if (process.send) {
    process.send({ type: "ready", port });
  }
});

// ── 优雅关闭 ─────────────────────────────────────────────────
function shutdown() {
  server.close(() => {
    process.exit(0);
  });
  // 超时强制退出（防止挂起连接导致无法关闭）
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { server };

/**
 * Express 裸跑基准测试服务器
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层 handler 内联业务链 + JSON 响应
 *   4. GET /middleware-chain → 3 层真实中间件链 + JSON 响应
 *
 * 用法：
 *   PORT=3000 node test/benchmark/servers/raw-express.mjs
 */

import express from "express";
import crypto from "node:crypto";

const port = parseInt(process.env.PORT || "3000", 10);
const app = express();

// ── 禁用不必要的默认行为（与 vext express adapter 对齐）─────
app.disable("x-powered-by");
app.disable("etag");

// ── 场景 1: 纯 JSON 响应 ────────────────────────────────────
app.get("/json", (_req, res) => {
  res.json({ message: "Hello World" });
});

// ── 场景 2: 路由参数解析 ────────────────────────────────────
app.get("/users/:id", (req, res) => {
  const id = req.params.id;
  res.json({ id, name: `User ${id}` });
});

// ── 场景 3: 3 层 handler 内联业务链 ──────────────────────────
app.get("/chain", (req, res) => {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  req.headers.authorization;
  const elapsed = Date.now() - startTime;
  res.setHeader("X-Response-Time", `${elapsed}ms`);
  res.setHeader("X-Bench-Request-Id", requestId);
  res.json({
    message: "Chain complete",
    requestId,
    authenticated: true,
  });
});

// ── 场景 4: 3 层真实 route-level middleware chain ───────────

// 中间件 1: 请求计时
function timingMiddleware(req, res, next) {
  const startedAt = Date.now();
  res.setHeader("X-Response-Time", `${Date.now() - startedAt}ms`);
  next();
}

// 中间件 2: 请求 ID
function requestIdMiddleware(req, res, next) {
  const requestId = crypto.randomUUID();
  res.setHeader("X-Bench-Request-Id", requestId);
  next();
}

// 中间件 3: 简单鉴权模拟
function authMiddleware(req, _res, next) {
  // 模拟鉴权检查（不真正拒绝，只是做一次 header 读取）
  req.headers.authorization;
  next();
}

// middleware-chain 路由：应用 3 层中间件
app.get(
  "/middleware-chain",
  timingMiddleware,
  requestIdMiddleware,
  authMiddleware,
  (req, res) => {
    res.json({
      message: "Middleware chain complete",
      authenticated: true,
    });
  },
);

// ── 健康检查 ─────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── 启动服务器 ───────────────────────────────────────────────
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`[raw-express] listening on http://127.0.0.1:${port}`);
  // 通知父进程已就绪（子进程模式）
  if (process.send) {
    process.send({ type: "ready", port });
  }
});

// 优雅关闭
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

export { server };

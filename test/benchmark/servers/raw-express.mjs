/**
 * Express 裸跑基准测试服务器
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层中间件链 + JSON 响应
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

// ── 场景 3: 3 层中间件链 ────────────────────────────────────
// 模拟 vext 洋葱模型：每层中间件在请求前后各做一次操作

// 中间件 1: 请求计时
function timingMiddleware(req, res, next) {
  req._startTime = Date.now();
  res.on("finish", () => {
    // after: 计算耗时（洋葱模型回溯模拟）
    const elapsed = Date.now() - req._startTime;
    // header 已发送，这里只是模拟计算开销
    void elapsed;
  });
  next();
}

// 中间件 2: 请求 ID
function requestIdMiddleware(req, res, next) {
  const requestId = crypto.randomUUID();
  req._requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

// 中间件 3: 简单鉴权模拟
function authMiddleware(req, _res, next) {
  // 模拟鉴权检查（不真正拒绝，只是做一次 header 读取）
  req.headers["authorization"];
  req._authenticated = true;
  next();
}

// chain 路由：应用 3 层中间件
app.get(
  "/chain",
  timingMiddleware,
  requestIdMiddleware,
  authMiddleware,
  (req, res) => {
    res.json({
      message: "Chain complete",
      requestId: req._requestId,
      authenticated: req._authenticated,
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

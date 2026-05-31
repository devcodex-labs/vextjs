/**
 * Koa 裸跑基准测试服务器
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层中间件链 + JSON 响应
 *
 * 用法：
 *   PORT=3000 node test/benchmark/servers/raw-koa.mjs
 *
 * 说明：
 *   Koa 原生不包含路由功能，这里使用 Koa 生态路由器 @koa/router，
 *   与 vext 的 Koa Adapter 保持一致的宿主路由口径。
 */

import Koa from "koa";
import Router from "@koa/router";
import { createServer } from "node:http";

const port = parseInt(process.env.PORT || "3000", 10);
const app = new Koa();
const router = new Router();

// ── 场景 3: 3 层中间件链（仅对 /chain 路径生效） ────────────
// 模拟 vext 洋葱模型：每层中间件在请求前后各做一次操作

// 中间件 1: 请求计时
app.use(async (ctx, next) => {
  if (ctx.path === "/chain") {
    ctx.state.startTime = Date.now();
    await next();
    const elapsed = Date.now() - ctx.state.startTime;
    ctx.set("X-Response-Time", `${elapsed}ms`);
  } else {
    await next();
  }
});

// 中间件 2: 请求 ID
app.use(async (ctx, next) => {
  if (ctx.path === "/chain") {
    const requestId = crypto.randomUUID();
    ctx.state.requestId = requestId;
    await next();
    ctx.set("X-Request-Id", requestId);
  } else {
    await next();
  }
});

// 中间件 3: 简单鉴权模拟
app.use(async (ctx, next) => {
  if (ctx.path === "/chain") {
    // 模拟鉴权检查（不真正拒绝，只是做一次 header 读取）
    ctx.get("Authorization");
    ctx.state.authenticated = true;
  }
  await next();
});

// ── 路由定义 ─────────────────────────────────────────────────

// 场景 1: 纯 JSON 响应
router.get("/json", (ctx) => {
  ctx.status = 200;
  ctx.type = "application/json";
  ctx.body = JSON.stringify({ message: "Hello World" });
});

// 场景 2: 路由参数解析
router.get("/users/:id", (ctx) => {
  const { id } = ctx.params;
  ctx.status = 200;
  ctx.type = "application/json";
  ctx.body = JSON.stringify({ id, name: `User ${id}` });
});

// 场景 3: chain 路由处理器
router.get("/chain", (ctx) => {
  ctx.status = 200;
  ctx.type = "application/json";
  ctx.body = JSON.stringify({
    message: "Chain complete",
    requestId: ctx.state.requestId,
    authenticated: ctx.state.authenticated,
  });
});

// 健康检查
router.get("/health", (ctx) => {
  ctx.status = 200;
  ctx.type = "application/json";
  ctx.body = JSON.stringify({ status: "ok" });
});

// ── 路由分发中间件 ───────────────────────────────────────────
app.use(router.routes());
// 不挂载 allowedMethods()，保持 wrong-method => 404 的 benchmark 口径。
app.use(async (ctx) => {
  ctx.status = 404;
  ctx.type = "application/json";
  ctx.body = JSON.stringify({ code: 404, message: "Not Found" });
});

// ── 启动服务器 ───────────────────────────────────────────────
const callback = app.callback();
const server = createServer(callback);

server.listen(port, "127.0.0.1", () => {
  console.log(`[raw-koa] listening on http://127.0.0.1:${port}`);
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

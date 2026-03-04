/**
 * Fastify 裸跑基准测试服务器
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层中间件链 + JSON 响应
 *
 * 用法：
 *   PORT=3000 node test/benchmark/servers/raw-fastify.mjs
 */

import Fastify from "fastify";

const port = parseInt(process.env.PORT || "3000", 10);

const fastify = Fastify({
  logger: false,
  // 禁用不必要的开销，保持裸跑公平性
  disableRequestLogging: true,
  // FSTDEP022: 使用 routerOptions 替代顶层选项（Fastify v6 将移除顶层选项）
  routerOptions: {
    ignoreTrailingSlash: true,
    caseSensitive: false,
  },
});

// ── 场景 1: 纯 JSON 响应 ────────────────────────────────────
fastify.get("/json", async (_request, reply) => {
  return reply.send({ message: "Hello World" });
});

// ── 场景 2: 路由参数解析 ────────────────────────────────────
fastify.get("/users/:id", async (request, reply) => {
  const { id } = request.params;
  return reply.send({ id, name: `User ${id}` });
});

// ── 场景 3: 3 层中间件链 ────────────────────────────────────
// 使用 Fastify 的 hook 系统模拟洋葱模型中间件
//
// Fastify 没有 Koa/Express 那样的 next() 洋葱模型，
// 而是使用生命周期 hooks (onRequest → preHandler → handler → onSend)
// 这里用 onRequest + preHandler + onSend 模拟 3 层中间件效果

// 中间件 1: 请求计时（onRequest → onSend 回溯）
fastify.addHook("onRequest", async (request, _reply) => {
  if (request.url === "/chain") {
    request.startTime = Date.now();
  }
});

fastify.addHook("onSend", async (request, reply, payload) => {
  if (request.url === "/chain" && request.startTime) {
    const elapsed = Date.now() - request.startTime;
    reply.header("X-Response-Time", `${elapsed}ms`);
  }
  return payload;
});

// 中间件 2: 请求 ID（preHandler）
fastify.addHook("preHandler", async (request, reply) => {
  if (request.url === "/chain") {
    const requestId = crypto.randomUUID();
    request.benchRequestId = requestId;
    reply.header("X-Request-Id", requestId);
  }
});

// 中间件 3: 简单鉴权模拟（preHandler）
fastify.addHook("preHandler", async (request, _reply) => {
  if (request.url === "/chain") {
    // 模拟鉴权检查（不真正拒绝，只是做一次 header 读取）
    request.headers["authorization"];
    request.authenticated = true;
  }
});

// chain 路由处理器
fastify.get("/chain", async (request, reply) => {
  return reply.send({
    message: "Chain complete",
    requestId: request.benchRequestId,
    authenticated: request.authenticated,
  });
});

// ── 健康检查 ─────────────────────────────────────────────────
fastify.get("/health", async (_request, reply) => {
  return reply.send({ status: "ok" });
});

// ── 启动服务器 ───────────────────────────────────────────────
try {
  await fastify.listen({ port, host: "127.0.0.1" });
  console.log(`[raw-fastify] listening on http://127.0.0.1:${port}`);

  // 通知父进程已就绪（子进程模式）
  if (process.send) {
    process.send({ type: "ready", port });
  }
} catch (err) {
  console.error("[raw-fastify] failed to start:", err);
  process.exit(1);
}

// 优雅关闭
process.on("SIGTERM", async () => {
  await fastify.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await fastify.close();
  process.exit(0);
});

export { fastify };

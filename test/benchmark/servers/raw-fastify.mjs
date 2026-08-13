/**
 * Fastify 裸跑基准测试服务器
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层 handler 内联业务链 + JSON 响应
 *   4. GET /middleware-chain → 3 层真实中间件链 + JSON 响应
 *
 * 用法：
 *   PORT=3000 node test/benchmark/servers/raw-fastify.mjs
 */

import Fastify from "fastify";
import crypto from "node:crypto";

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

function sendJson(reply, data, statusCode = 200) {
  const body = JSON.stringify(data);
  reply.code(statusCode);
  reply.type("application/json; charset=utf-8");
  reply.header("Content-Length", Buffer.byteLength(body));
  reply.send(body);
}

// ── 场景 1: 纯 JSON 响应 ────────────────────────────────────
fastify.get("/json", (_request, reply) => {
  sendJson(reply, { message: "Hello World" });
});

// ── 场景 2: 路由参数解析 ────────────────────────────────────
fastify.get("/users/:id", (request, reply) => {
  const { id } = request.params;
  sendJson(reply, { id, name: `User ${id}` });
});

// ── 场景 3: 3 层 handler 内联业务链 ──────────────────────────
fastify.get("/chain", (request, reply) => {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  request.headers.authorization;
  const elapsed = Date.now() - startTime;
  reply.header("X-Response-Time", `${elapsed}ms`);
  reply.header("X-Bench-Request-Id", requestId);
  sendJson(reply, {
    message: "Chain complete",
    requestId,
    authenticated: true,
  });
});

// ── 场景 4: 3 层真实 route-level middleware chain ───────────
// Fastify 使用 route-level lifecycle hooks 作为其原生中间件模型。不要用
// 全局 URL 分支 hook，否则 /json 等对照场景也会承担额外调度开销。
const middlewareChainPreHandlers = [
  (_request, reply, done) => {
    const startedAt = Date.now();
    reply.header("X-Response-Time", `${Date.now() - startedAt}ms`);
    done();
  },
  (_request, reply, done) => {
    reply.header("X-Bench-Request-Id", crypto.randomUUID());
    done();
  },
  (request, _reply, done) => {
    request.headers.authorization;
    done();
  },
];

fastify.get(
  "/middleware-chain",
  { preHandler: middlewareChainPreHandlers },
  (_request, reply) => {
    sendJson(reply, {
      message: "Middleware chain complete",
      authenticated: true,
    });
  },
);

// ── 健康检查 ─────────────────────────────────────────────────
fastify.get("/health", (_request, reply) => {
  sendJson(reply, { status: "ok" });
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

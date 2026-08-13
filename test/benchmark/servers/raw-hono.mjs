/**
 * Hono 裸跑基准测试服务器
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层 handler 内联业务链 + JSON 响应
 *   4. GET /middleware-chain → 3 层真实中间件链 + JSON 响应
 *
 * 用法：
 *   PORT=3000 node test/benchmark/servers/raw-hono.mjs
 */

import { Hono } from "hono";
import { createServer } from "node:http";

const port = parseInt(process.env.PORT || "3000", 10);
const app = new Hono();

// ── 场景 1: 纯 JSON 响应 ────────────────────────────────────
app.get("/json", (c) => {
  return c.json({ message: "Hello World" });
});

// ── 场景 2: 路由参数解析 ────────────────────────────────────
app.get("/users/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ id, name: `User ${id}` });
});

// ── 场景 3: 3 层 handler 内联业务链 ──────────────────────────
app.get("/chain", (c) => {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  c.req.header("Authorization");
  const elapsed = Date.now() - startTime;
  c.header("X-Response-Time", `${elapsed}ms`);
  c.header("X-Bench-Request-Id", requestId);
  return c.json({
    message: "Chain complete",
    requestId,
    authenticated: true,
  });
});

// ── 场景 4: 3 层真实 route-level middleware chain ───────────

// 中间件 1: 请求计时
app.use("/middleware-chain", async (c, next) => {
  const startedAt = Date.now();
  c.header("X-Response-Time", `${Date.now() - startedAt}ms`);
  await next();
});

// 中间件 2: 请求 ID
app.use("/middleware-chain", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header("X-Bench-Request-Id", requestId);
  await next();
});

// 中间件 3: 简单鉴权模拟
app.use("/middleware-chain", async (c, next) => {
  // 模拟鉴权检查（不真正拒绝，只是做一次 header 读取）
  c.req.header("Authorization");
  await next();
});

app.get("/middleware-chain", (c) => {
  return c.json({
    message: "Middleware chain complete",
    authenticated: true,
  });
});

// ── 健康检查 ─────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok" }));

// ── 启动服务器 ───────────────────────────────────────────────
const server = createServer(async (nodeReq, nodeRes) => {
  const protocol = "http";
  const host = nodeReq.headers.host ?? `localhost:${port}`;
  const url = `${protocol}://${host}${nodeReq.url ?? "/"}`;

  const method = (nodeReq.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  let body = null;
  if (hasBody) {
    body = new ReadableStream({
      start(controller) {
        nodeReq.on("data", (chunk) =>
          controller.enqueue(new Uint8Array(chunk)),
        );
        nodeReq.on("end", () => controller.close());
        nodeReq.on("error", (err) => controller.error(err));
      },
    });
  }

  const headers = new Headers();
  const rawHeaders = nodeReq.rawHeaders;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i] && rawHeaders[i + 1]) {
      headers.append(rawHeaders[i], rawHeaders[i + 1]);
    }
  }

  const requestInit = { method, headers };
  if (body) {
    requestInit.body = body;
    requestInit.duplex = "half";
  }

  const webRequest = new Request(url, requestInit);
  const webResponse = await app.fetch(webRequest);

  nodeRes.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    nodeRes.setHeader(key, value);
  });

  if (webResponse.body) {
    const reader = webResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(value);
      }
    } catch {
      // client disconnected
    } finally {
      nodeRes.end();
    }
  } else {
    nodeRes.end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[raw-hono] listening on http://127.0.0.1:${port}`);
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

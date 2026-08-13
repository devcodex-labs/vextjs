/**
 * Native 裸跑基准测试服务器
 *
 * 使用 Node.js 原生 http.createServer + route-core（轻量路由核心），
 * 不依赖任何第三方 HTTP 框架（无 Fastify / Express / Koa / Hono）。
 *
 * 这是 vext Native Adapter 的"裸跑"对照组，
 * 用于测量 route-core + http.createServer 的基准性能，
 * 与 vext-native（经过 vext 中间件链的 Native Adapter）对比计算 overhead。
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层 handler 内联业务逻辑 + JSON 响应
 *   4. GET /middleware-chain → 3 层 async middleware chain + JSON 响应
 *
 * 用法：
 *   PORT=3000 node test/benchmark/servers/raw-native.mjs
 */

import { createServer } from "node:http";
import crypto from "node:crypto";
import { createRouter } from "route-core";

const port = parseInt(process.env.PORT || "3000", 10);

// ── 创建 route-core 路由器 ──────────────────────────────────
const router = createRouter({
  ignoreTrailingSlash: true,
  caseSensitive: false,
});
const routeStores = [];
const preparedMethods = new Map();

function register(method, path, handler) {
  const storeId = routeStores.length;
  routeStores.push(handler);
  router.add(method, path, storeId);
}

function getPreparedMethod(method) {
  const normalized = method.toUpperCase();
  let methodHandle = preparedMethods.get(normalized);
  if (!methodHandle) {
    methodHandle = router.prepareMethod(normalized);
    preparedMethods.set(normalized, methodHandle);
  }
  return methodHandle;
}

// ── 辅助：发送 JSON 响应 ────────────────────────────────────
function sendJson(res, data, statusCode = 200) {
  const body = JSON.stringify(data);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

async function runRawMiddlewareChain(req, res, middlewares, handler) {
  let index = -1;

  async function dispatch(i) {
    if (i <= index) {
      throw new Error("next() called multiple times");
    }
    index = i;

    const layer = i === middlewares.length ? handler : middlewares[i];
    if (!layer) return;
    await layer(req, res, () => dispatch(i + 1));
  }

  await dispatch(0);
}

// ── 场景 1: 纯 JSON 响应 ────────────────────────────────────
register("GET", "/json", (_req, res) => {
  sendJson(res, { message: "Hello World" });
});

// ── 场景 2: 路由参数解析 ────────────────────────────────────
register("GET", "/users/:id", (_req, res, params) => {
  sendJson(res, { id: params.id, name: `User ${params.id}` });
});

// ── 场景 3: 3 层 handler 内联业务逻辑 ───────────────────────
// 使用内联逻辑模拟 3 层中间件效果（与其他裸跑服务器保持一致）
//
// 中间件 1: 请求计时
// 中间件 2: 请求 ID 生成
// 中间件 3: 简单鉴权模拟（读取 header）
register("GET", "/chain", (req, res) => {
  // ── 中间件 1 模拟：请求计时 ──────────────────────────────
  const startTime = Date.now();

  // ── 中间件 2 模拟：请求 ID 生成 ──────────────────────────
  const requestId = crypto.randomUUID();

  // ── 中间件 3 模拟：简单鉴权（读取 header） ──────────────
  // 模拟鉴权检查（不真正拒绝，只是做一次 header 读取）
  req.headers.authorization;
  const authenticated = true;

  // ── handler 逻辑 ─────────────────────────────────────────
  const elapsed = Date.now() - startTime;

  // 写入自定义响应头（模拟洋葱模型回溯阶段的行为）
  res.setHeader("X-Response-Time", `${elapsed}ms`);
  res.setHeader("X-Bench-Request-Id", requestId);

  sendJson(res, {
    message: "Chain complete",
    requestId,
    authenticated,
  });
});

// ── 场景 4: 真实 async middleware chain ────────────────────
const rawMiddlewareChain = [
  async (_req, res, next) => {
    const startTime = Date.now();
    res.setHeader("X-Response-Time", `${Date.now() - startTime}ms`);
    await next();
  },
  async (_req, res, next) => {
    res.setHeader("X-Bench-Request-Id", crypto.randomUUID());
    await next();
  },
  async (req, _res, next) => {
    req.headers.authorization;
    await next();
  },
];

register("GET", "/middleware-chain", (req, res) => {
  void runRawMiddlewareChain(
    req,
    res,
    rawMiddlewareChain,
    async (_req, res, _next) => {
      sendJson(res, {
        message: "Middleware chain complete",
        authenticated: true,
      });
    },
  ).catch(() => {
    sendJson(res, { code: 500, message: "Internal Server Error" }, 500);
  });
});

// ── 健康检查 ─────────────────────────────────────────────────
register("GET", "/health", (_req, res) => {
  sendJson(res, { status: "ok" });
});

// ── 创建 HTTP 服务器 ─────────────────────────────────────────
const server = createServer((req, res) => {
  const rawUrl = req.url || "/";
  const qIdx = rawUrl.indexOf("?");
  const pathname = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
  const preparedPathname = router.preparePathname(pathname);
  if (!preparedPathname) {
    sendJson(res, { code: 404, message: "Not Found" }, 404);
    return;
  }

  // route-core prepared lookup：直接执行路由匹配 + 调用 handler（一步完成）
  // 比 find() + 手动调用 handler 更高效（跳过中间对象分配）。
  // 未匹配路由时保持 benchmark 口径：wrong method / not found => 404。
  const methodHandle = getPreparedMethod(req.method || "GET");
  const matched = methodHandle.lookup(preparedPathname, (storeId, params) => {
    routeStores[storeId](req, res, params || {});
  });

  if (!matched) {
    sendJson(res, { code: 404, message: "Not Found" }, 404);
  }
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

import crypto from "node:crypto";
import { defineRoutes } from "vextjs";

const BENCH_ROUTE_OPTIONS = { override: { cors: { enabled: false } } };

// ── 路由定义 ─────────────────────────────────────────────────
// GET /chain → 3 层 handler 内联业务逻辑
//
// 历史兼容场景：将 3 层逻辑（计时 / requestId / 鉴权模拟）内联到 handler 中。
// 它用于测量 handler 内部业务逻辑开销，不代表真实 vext middleware chain。
//
// 如需测量真实 route-level middleware chain，请使用 /middleware-chain。

export default defineRoutes((app) => {
  app.get("/", BENCH_ROUTE_OPTIONS, async (req, res) => {
    // ── 中间件 1 模拟：请求计时 ──────────────────────────
    const startTime = Date.now();

    // ── 中间件 2 模拟：请求 ID 生成 ──────────────────────
    const benchRequestId = crypto.randomUUID();

    // ── 中间件 3 模拟：简单鉴权（读取 header） ──────────
    req.headers.authorization;
    const authenticated = true;

    // ── handler 逻辑 ─────────────────────────────────────
    const elapsed = Date.now() - startTime;

    // 写入自定义响应头（模拟洋葱模型回溯阶段的行为）
    res.setHeader("X-Response-Time", `${elapsed}ms`);
    res.setHeader("X-Bench-Request-Id", benchRequestId);

    res.json({
      message: "Chain complete",
      requestId: benchRequestId,
      authenticated,
    });
  });
});

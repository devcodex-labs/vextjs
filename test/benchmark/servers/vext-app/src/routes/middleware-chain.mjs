import { defineRoutes } from "vextjs";

// ── 路由定义 ─────────────────────────────────────────────────
// GET /middleware-chain → 3 层 route-level middleware + JSON 响应

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      override: { cors: { enabled: false } },
      // router-loader 只会执行 RouteOptions.middlewares 中、且已在
      // config.middlewares 白名单声明的中间件。不要在 benchmark fixture
      // 中使用未被框架读取的私有 _inlineMiddlewares 字段。
      middlewares: ["bench-timing", "bench-request-id", "bench-auth"],
    },
    async (req, res) => {
      res.json({
        message: "Middleware chain complete",
        authenticated: true,
      });
    },
  );
});

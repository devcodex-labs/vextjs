import { defineMiddleware } from "../../../../../../dist/lib/define-middleware.js";

// 与所有 raw middleware-chain 对照组一致：在进入下一层前写入响应头。
export default defineMiddleware(async (_req, res, next) => {
  const startedAt = Date.now();
  res.setHeader("X-Response-Time", `${Date.now() - startedAt}ms`);
  await next();
});

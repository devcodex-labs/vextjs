import { defineMiddleware } from "../../../../../../dist/lib/define-middleware.js";

export default defineMiddleware(async (req, _res, next) => {
  // 模拟轻量鉴权检查；不拒绝请求，以便与 raw 对照组保持相同语义。
  req.headers.authorization;
  await next();
});

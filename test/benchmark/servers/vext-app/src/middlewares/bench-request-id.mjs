import crypto from "node:crypto";
import { defineMiddleware } from "../../../../../../dist/lib/define-middleware.js";

export default defineMiddleware(async (_req, res, next) => {
  res.setHeader("X-Bench-Request-Id", crypto.randomUUID());
  await next();
});

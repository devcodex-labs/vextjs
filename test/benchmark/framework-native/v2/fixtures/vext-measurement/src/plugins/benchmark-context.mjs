import { definePlugin, requestContext } from "vextjs";

import { ORDER_PATH } from "../../../../contract.mjs";
import { createError } from "../../../../application-model.mjs";

function contentType(request) {
  return String(request.headers["content-type"] ?? "")
    .split(";", 1)[0]
    .toLowerCase();
}

export default definePlugin({
  name: "framework-native-v2-context",
  setup(app) {
    app.use(async (req, res, next) => {
      if (req.path === ORDER_PATH && req.method !== "POST") {
        res.json(createError("METHOD_NOT_ALLOWED", req.requestId), 405);
        return;
      }
      if (req.path === ORDER_PATH && contentType(req) !== "application/json") {
        res.json(createError("UNSUPPORTED_MEDIA_TYPE", req.requestId), 415);
        return;
      }
      const store = requestContext.getStore();
      if (!store) throw new Error("Vext requestContext is unavailable");
      store.tenantId = String(req.headers["x-tenant-id"] ?? "benchmark-tenant");
      store.traceId = String(
        req.headers["x-trace-id"] ?? `trace-${req.requestId}`,
      );
      await next();
    });
  },
});

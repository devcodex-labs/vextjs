import type { VextMiddleware } from "../../types/middleware.js";
import type { VextInternalHooks } from "../../types/hooks.js";
import type { VextRequest } from "../../types/request.js";

export function createRequestHookMiddleware(
  hooks: VextInternalHooks,
): VextMiddleware {
  return async (req, _res, next) => {
    await hooks.emit("request:start", {
      req,
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      matched: true,
    });
    await next();
  };
}

export async function emitNotFoundRequestHooks(
  hooks: VextInternalHooks,
  req: VextRequest,
): Promise<void> {
  await hooks.emitSafe("request:start", {
    req,
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    matched: false,
  });
  await hooks.emitSafe("route:notFound", {
    req,
    requestId: req.requestId,
    path: req.path,
  });
}

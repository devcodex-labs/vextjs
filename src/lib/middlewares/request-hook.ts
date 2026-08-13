import type { VextMiddleware } from "../../types/middleware.js";
import type { VextInternalHooks } from "../../types/hooks.js";
import type { VextRequest } from "../../types/request.js";

export function createRequestHookMiddleware(
  hooks: VextInternalHooks,
): VextMiddleware {
  return (req, _res, next) => {
    // Keep the middleware installed so app.hooks.on() can start observing later
    // requests, but do not create an empty async lifecycle when no listener is
    // currently interested in request:start.
    if (!hooks.has("request:start")) {
      return next();
    }
    return hooks
      .emit("request:start", {
        req,
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        matched: true,
      })
      .then(() => next());
  };
}

export async function emitNotFoundRequestHooks(
  hooks: VextInternalHooks,
  req: VextRequest,
): Promise<void> {
  if (hooks.has("request:start")) {
    await hooks.emitSafe("request:start", {
      req,
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      matched: false,
    });
  }
  if (hooks.has("route:notFound")) {
    await hooks.emitSafe("route:notFound", {
      req,
      requestId: req.requestId,
      path: req.path,
    });
  }
}

import type { VextMiddleware } from "../../types/middleware.js";

export function createRouteTimeoutMiddleware(
  timeoutMs: number,
): VextMiddleware {
  if (
    !Number.isFinite(timeoutMs) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new Error(
      "[vextjs] RouteOptions.override.timeout must be a positive integer in milliseconds",
    );
  }

  return async (req, res, next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const previousOnBeforeSend = res._onBeforeSend;

    const clearTimer = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    res._onBeforeSend = (kind, data, statusCode, headers) => {
      clearTimer();
      previousOnBeforeSend?.(kind, data, statusCode, headers);
    };

    timer = setTimeout(() => {
      timer = undefined;
      if (res._isSent()) return;
      try {
        res.rawJson(
          {
            code: 504,
            message: "Request Timeout",
            requestId: req.requestId,
          },
          504,
        );
      } catch (error) {
        req.app.logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "[vextjs] failed to send route timeout response",
        );
      }
    }, timeoutMs);

    try {
      await next();
    } finally {
      clearTimer();
    }
  };
}

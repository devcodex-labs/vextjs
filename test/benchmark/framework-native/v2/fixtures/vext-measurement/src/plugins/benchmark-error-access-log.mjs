import { performance } from "node:perf_hooks";

import { definePlugin } from "vextjs";

/**
 * Vext's built-in onion access logger records completed normal chains. The
 * public error lifecycle is the documented companion for error responses, so
 * this plug-in emits the equivalent structured access record after an error
 * response. Comparator targets likewise emit one access record for every
 * response and a separate error record for 5xx failures.
 */
export default definePlugin({
  name: "framework-native-v2-error-access-log",
  setup(app) {
    const requests = new Map();
    app.hooks.on("request:start", ({ req, requestId, method, path }) => {
      requests.set(requestId, {
        method,
        path,
        ip: req.ip,
        startedAt: performance.now(),
      });
    });
    app.hooks.on("response:after", ({ requestId }) => {
      requests.delete(requestId);
    });
    app.hooks.on("error:afterResponse", ({ requestId, status }) => {
      const request = requests.get(requestId);
      requests.delete(requestId);
      if (!request) return;
      const durationMs = Math.max(
        0,
        Math.round(performance.now() - request.startedAt),
      );
      const message = `${request.method} ${request.path} ${status} ${durationMs}ms | ${request.ip}`;
      if (status >= 500) {
        app.logger.error({ requestId }, message);
      } else {
        app.logger.info({ requestId }, message);
      }
    });
  },
});

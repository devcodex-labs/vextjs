import { definePlugin, requestContext } from "vextjs";
import { createLogger } from "../../../../../../../dist/lib/logger.js";
import { CONTROL_PREFIX } from "../../../../contract.mjs";
import { createBenchmarkRuntime } from "../../../../runtime.mjs";

export const benchmarkRuntime = createBenchmarkRuntime("vext-native");

export default definePlugin({
  name: "framework-native-benchmark-runtime",
  setup(app) {
    const logger = createLogger(
      { level: "info", pretty: false },
      {
        requestContextEnabled: true,
        sink: {
          write() {
            benchmarkRuntime.record("structuredLog");
          },
        },
      },
    );
    app.setLogger(() => logger);
    app.extend("frameworkNativeBenchmarkRuntime", benchmarkRuntime);
    app.use(async (req, _res, next) => {
      if (!req.path.startsWith(CONTROL_PREFIX)) {
        benchmarkRuntime.record("requestId");
        benchmarkRuntime.record("authentication");
        const store = requestContext.getStore();
        if (!store)
          throw new Error(
            "Vext requestContext is unavailable in benchmark middleware",
          );
        store.tenantId = String(
          req.headers["x-tenant-id"] ?? "benchmark-tenant",
        );
        store.traceId = String(
          req.headers["x-trace-id"] ?? `trace-${req.requestId}`,
        );
        benchmarkRuntime.record("requestContext");
      }
      await next();
    });
    app.hooks.on("validation:success", () =>
      benchmarkRuntime.record("validation"),
    );
    app.hooks.on("validation:error", () =>
      benchmarkRuntime.record("validation"),
    );
    app.hooks.on("error:afterResponse", () =>
      benchmarkRuntime.record("errorHandler"),
    );
    app.onClose(() => benchmarkRuntime.close());
  },
});

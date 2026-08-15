import { definePlugin, requestContext } from "vextjs";
import { createLogger } from "../../../../../../../dist/lib/logger.js";
import {
  attachTenantContext,
  attachTraceContext,
  createEnterpriseState,
  createRequestContext,
  increment,
  stopResourceSampler,
} from "../../../../target-runtime.mjs";

const state = createEnterpriseState("vext-native");
export { state as enterpriseState };

function isControlRequest(req) {
  return req.path.startsWith("/benchmark");
}

export default definePlugin({
  name: "enterprise-runtime",
  setup(app) {
    const logger = createLogger(
      { level: "info", pretty: false },
      {
        requestContextEnabled: true,
        sink: {
          isTTY: false,
          write() {
            increment(state, "structuredLog");
          },
        },
      },
    );
    app.setLogger(() => logger);
    app.extend("enterpriseBenchmarkState", state);

    // The three global middlewares deliberately do real work. They represent
    // a common production correlation boundary rather than benchmark no-ops.
    app.use(async (req, _res, next) => {
      if (!isControlRequest(req)) {
        req.enterpriseContext = createRequestContext(state, req.headers);
      }
      await next();
    });
    app.use(async (req, _res, next) => {
      if (!isControlRequest(req)) {
        attachTenantContext(state, req.enterpriseContext, req.headers);
      }
      await next();
    });
    app.use(async (req, _res, next) => {
      if (!isControlRequest(req)) {
        attachTraceContext(state, req.enterpriseContext, req.headers);
        const store = requestContext.getStore();
        if (store) {
          store.traceId = req.enterpriseContext.traceId;
        }
      }
      await next();
    });

    app.hooks.on("validation:success", ({ req }) => {
      if (!isControlRequest(req)) increment(state, "validation");
    });
    app.hooks.on("validation:error", ({ req }) => {
      if (!isControlRequest(req)) increment(state, "validation");
    });
    app.hooks.on("error:afterResponse", () => {
      increment(state, "errorHandler");
    });
    app.onClose(() => stopResourceSampler(state));
  },
});

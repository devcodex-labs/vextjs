import type { VextApp, VextLogger } from "../types/app.js";
import type { VextInternalHooks } from "../types/hooks.js";
import { createVextFetch, type VextFetch } from "./fetch.js";

/** Bootstrap fetch before plugins while retaining later app.setLogger wrappers. */
export function createAppFetch(
  app: VextApp,
  hooks: VextInternalHooks,
): VextFetch {
  const logger = new Proxy({} as VextLogger, {
    get(_target, property) {
      const current = app.logger;
      const value = Reflect.get(current, property, current);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
  return createVextFetch(
    logger,
    app.config.fetch ?? {},
    app.config.requestId?.header ?? "x-request-id",
    hooks,
  );
}

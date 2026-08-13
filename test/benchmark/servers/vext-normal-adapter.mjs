import { createNativeAdapter } from "../../../dist/adapters/native/adapter.js";

function routeKey(method, path) {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Benchmark-only Native adapter wrapper.
 *
 * It measures registration-time chain composition without changing the public
 * adapter contract or the production bootstrap. The runner receives the values
 * through vext-start IPC and rejects a result when the expected Normal chain is
 * not present.
 */
export function createBenchmarkNormalAdapter(app) {
  const adapter = createNativeAdapter({}, app);
  const routeChains = new Map();
  let globalMiddlewareCount = 0;

  const registerMiddleware = adapter.registerMiddleware.bind(adapter);
  const registerRoute = adapter.registerRoute.bind(adapter);

  adapter.registerMiddleware = (middleware) => {
    globalMiddlewareCount += 1;
    registerMiddleware(middleware);
  };

  adapter.registerRoute = (method, path, chain, options) => {
    routeChains.set(routeKey(method, path), chain.length);
    registerRoute(method, path, chain, options);
  };

  Object.defineProperty(adapter, "getBenchmarkTelemetry", {
    value: () => ({
      mode: "normal",
      globalMiddlewareCount,
      routeChainLengths: Object.fromEntries(routeChains),
    }),
    enumerable: false,
  });

  return adapter;
}

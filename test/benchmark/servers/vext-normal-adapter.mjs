import { createNativeAdapter } from "../../../dist/adapters/native/adapter.js";
import { createHonoAdapter } from "../../../dist/adapters/hono/adapter.js";
import { createFastifyAdapter } from "../../../dist/adapters/fastify/adapter.js";
import { createExpressAdapter } from "../../../dist/adapters/express/adapter.js";
import { createKoaAdapter } from "../../../dist/adapters/koa/adapter.js";

function routeKey(method, path) {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Benchmark-only Normal adapter observer.
 *
 * It measures registration-time chain composition without changing the public
 * adapter contract or the production bootstrap. Every Vext adapter uses the
 * same observer so the adapter matrix can prove that its shared Normal fixture
 * really registered the same Vext chain before it measures throughput.
 */
export function createBenchmarkNormalAdapter(app) {
  const adapterName = process.env.BENCH_ADAPTER || "native";
  const adapter = createAdapter(adapterName, app);
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
      adapter: adapterName,
      globalMiddlewareCount,
      routeChainLengths: Object.fromEntries(routeChains),
    }),
    enumerable: false,
  });

  return adapter;
}

function createAdapter(adapterName, app) {
  switch (adapterName) {
    case "native":
      return createNativeAdapter({}, app);
    case "hono":
      return createHonoAdapter(app);
    case "fastify":
      return createFastifyAdapter({}, app);
    case "express":
      return createExpressAdapter({}, app);
    case "koa":
      return createKoaAdapter({}, app);
    default:
      throw new Error(`Unsupported benchmark adapter: ${adapterName}`);
  }
}

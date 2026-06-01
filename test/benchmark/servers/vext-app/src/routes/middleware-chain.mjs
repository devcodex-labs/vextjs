import crypto from "node:crypto";

// ── RouteDefinition 基础设施（与 E2E helpers 保持一致） ──────
function createCollector(routes) {
  function makeMethod(method) {
    return (path, optionsOrHandler, handler) => {
      if (typeof optionsOrHandler === "function") {
        routes.push({ method, path, options: {}, handler: optionsOrHandler });
      } else {
        routes.push({ method, path, options: optionsOrHandler || {}, handler });
      }
    };
  }
  return {
    get: makeMethod("GET"),
    post: makeMethod("POST"),
    put: makeMethod("PUT"),
    patch: makeMethod("PATCH"),
    delete: makeMethod("DELETE"),
    head: makeMethod("HEAD"),
    options: makeMethod("OPTIONS"),
  };
}

function normalizePath(prefix, subPath) {
  const cleanPrefix =
    prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;
  if (!cleanSubPath) return cleanPrefix || "/";
  if (cleanPrefix === "/") return `/${cleanSubPath}`;
  const fullPath = `${cleanPrefix}/${cleanSubPath}`;
  if (fullPath.length > 1 && fullPath.endsWith("/"))
    return fullPath.slice(0, -1);
  return fullPath;
}

function makeRouteDefinition(routes, collector, factory) {
  return {
    routes,
    sourceFile: "",
    register(adapter, prefix, middlewareDefs, globalMiddlewares) {
      for (const route of routes) {
        const fullPath = normalizePath(prefix, route.path);
        const routeMiddlewares = route.options._inlineMiddlewares || [];
        const handlerMiddleware = async (req, res, _next) => {
          await route.handler(req, res);
        };
        const chain = [...routeMiddlewares, handlerMiddleware];
        adapter.registerRoute(route.method, fullPath, chain);
      }
    },
    _factory: factory,
    _collector: collector,
  };
}

// ── 路由定义 ─────────────────────────────────────────────────
// GET /middleware-chain → 3 层 route-level middleware + JSON 响应

const routes = [];
const collector = createCollector(routes);

const timerMiddleware = async (_req, res, next) => {
  const startTime = Date.now();
  res.setHeader("X-Response-Time", `${Date.now() - startTime}ms`);
  await next();
};

const requestIdMiddleware = async (_req, res, next) => {
  res.setHeader("X-Bench-Request-Id", crypto.randomUUID());
  await next();
};

const authMiddleware = async (req, _res, next) => {
  req.headers.authorization;
  await next();
};

function factory(app) {
  collector.get(
    "/",
    {
      _inlineMiddlewares: [
        timerMiddleware,
        requestIdMiddleware,
        authMiddleware,
      ],
    },
    async (req, res) => {
      res.json({
        message: "Middleware chain complete",
        authenticated: true,
      });
    },
  );
}

export default makeRouteDefinition(routes, collector, factory);

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
        const handlerMiddleware = async (req, res, _next) => {
          await route.handler(req, res);
        };
        const chain = [handlerMiddleware];
        adapter.registerRoute(route.method, fullPath, chain);
      }
    },
    _factory: factory,
    _collector: collector,
  };
}

// ── 路由定义 ─────────────────────────────────────────────────
// GET /health → { status: "ok" }

const routes = [];
const collector = createCollector(routes);

function factory(app) {
  collector.get("/", {}, async (req, res) => {
    res.json({ status: "ok" });
  });
}

export default makeRouteDefinition(routes, collector, factory);

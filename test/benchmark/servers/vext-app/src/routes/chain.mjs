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
  if (cleanPrefix === "/") return "/" + cleanSubPath;
  const fullPath = cleanPrefix + "/" + cleanSubPath;
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

        // 组装路由级中间件链 + handler
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
// GET /chain → 3 层中间件逻辑内联到 handler 中
//
// 由于简化版 makeRouteDefinition 不支持路由级中间件链，
// 将 3 层中间件的逻辑（计时 / requestId / 鉴权模拟）内联到 handler 中。
// 这模拟了真实场景中 handler 内部的多层业务逻辑处理开销。
//
// 注意：vext 的全局中间件（requestId、cors、bodyParser、rateLimit、
// accessLog、responseWrapper）仍然正常执行，这里额外测量的是
// handler 内部的业务逻辑层开销。

const routes = [];
const collector = createCollector(routes);

function factory(app) {
  collector.get("/", {}, async (req, res) => {
    // ── 中间件 1 模拟：请求计时 ──────────────────────────
    const startTime = Date.now();

    // ── 中间件 2 模拟：请求 ID 生成 ──────────────────────
    const benchRequestId = crypto.randomUUID();

    // ── 中间件 3 模拟：简单鉴权（读取 header） ──────────
    const authHeader = req.headers["authorization"];
    const authenticated = true;

    // ── handler 逻辑 ─────────────────────────────────────
    const elapsed = Date.now() - startTime;

    // 写入自定义响应头（模拟洋葱模型回溯阶段的行为）
    res.setHeader("X-Response-Time", `${elapsed}ms`);
    res.setHeader("X-Bench-Request-Id", benchRequestId);

    res.json({
      message: "Chain complete",
      requestId: benchRequestId,
      authenticated,
    });
  });
}

export default makeRouteDefinition(routes, collector, factory);

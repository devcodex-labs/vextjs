import type { VextApp, RouteOptions, RouteRecord } from "../types/app.js";
import type { VextMiddleware, VextHandler } from "../types/middleware.js";
import type { VextAdapter } from "../types/adapter.js";
import type { RouteDefinition, RouteFactory } from "../types/route.js";

const ROUTE_INTERNALS_SYMBOL = Symbol.for("vext.routeDefinition.internals");

interface RouteDefinitionInternals {
  factory: RouteFactory;
  collector: Record<string, unknown>;
}

const routeDefinitionInternals = new WeakMap<
  RouteDefinition,
  RouteDefinitionInternals
>();

/**
 * defineRoutes — 路由定义辅助函数
 *
 * 提供路由收集模式：用户在 factory 回调中调用 app.get/post/... 注册路由，
 * 实际并不直接注册到 adapter，而是收集到 routes 数组中。
 * 后续由 router-loader 调用 routeDef.register() 统一注册到底层适配器。
 *
 * 设计说明：
 *   - factory 接收一个 collector 对象（模拟 VextApp 的 HTTP 方法签名）
 *   - collector 将每条 app.get/post/... 调用推入 routes 数组
 *   - 返回 RouteDefinition { routes, sourceFile, register }
 *   - register() 负责拼接前缀、组装中间件链、注册到 adapter
 *
 * 执行流程：
 *   1. defineRoutes(factory) 被调用
 *   2. 内部创建 collector（实现 HTTP 方法）
 *   3. 调用 factory(collector as VextApp)，用户代码注册路由
 *   4. collector 将每条路由推入 routes 数组
 *   5. 返回 RouteDefinition
 *   6. 稍后 router-loader 调用 routeDef.register(adapter, prefix, ...)
 *
 * @param factory 路由工厂函数，接收 app（实际是 collector）在其上注册路由
 * @returns RouteDefinition 对象
 *
 * @example
 * // src/routes/users.ts
 * import { defineRoutes } from 'vextjs'
 *
 * export default defineRoutes((app) => {
 *   app.get('/list', {
 *     validate: { query: { page: 'number:1-', limit: 'number:1-100' } },
 *   }, async (req, res) => {
 *     const { page, limit } = req.valid('query')
 *     const users = await app.services.user.findAll({ page, limit })
 *     res.json(users)
 *   })
 *
 *   app.post('/', {
 *     validate: { body: { name: 'string:1-50', email: 'email' } },
 *   }, async (req, res) => {
 *     const user = await app.services.user.create(req.valid('body'))
 *     res.json(user, 201)
 *   })
 * })
 */
export function defineRoutes(factory: RouteFactory): RouteDefinition {
  if (typeof factory !== "function") {
    throw new Error("[vextjs] defineRoutes(factory) expects a function.");
  }

  const routes: RouteRecord[] = [];

  // ── 创建路由收集方法 ────────────────────────────────────
  // 支持三段式 (path, options, handler) 和两段式 (path, handler)
  function createMethodCollector(method: string) {
    return (
      path: string,
      optionsOrHandler: RouteOptions | VextHandler,
      handler?: VextHandler,
    ): void => {
      assertRoutePath(method, path);

      if (typeof optionsOrHandler === "function") {
        // 两段式：(path, handler) — 无 options
        routes.push({
          method: method.toUpperCase(),
          path,
          options: {},
          handler: optionsOrHandler,
        });
      } else {
        // 三段式：(path, options, handler)
        if (handler === undefined) {
          throw new Error(
            `[vextjs] ${method.toUpperCase()} "${path}": handler is required when options are provided. ` +
              `Usage: app.${method}(path, options, handler) or app.${method}(path, handler)`,
          );
        }
        assertRouteOptions(method, path, optionsOrHandler);
        assertRouteHandler(method, path, handler);
        routes.push({
          method: method.toUpperCase(),
          path,
          options: optionsOrHandler,
          handler,
        });
      }
    };
  }

  // ── 创建 collector（模拟 VextApp 的 HTTP 方法签名）──────
  // collector 实现了 VextApp 的 HTTP 方法，但不是完整的 VextApp。
  // factory 回调中除了 HTTP 方法外，还可以通过闭包中捕获的 app 引用
  // 访问 app.services / app.config / app.throw 等能力。
  //
  // 这里只创建 HTTP 方法收集器，其他属性由 router-loader
  // 在调用 factory 前注入真正的 app 引用。
  const collector = {
    get: createMethodCollector("get"),
    post: createMethodCollector("post"),
    put: createMethodCollector("put"),
    patch: createMethodCollector("patch"),
    delete: createMethodCollector("delete"),
    head: createMethodCollector("head"),
    options: createMethodCollector("options"),
  };

  // ── RouteDefinition 对象 ────────────────────────────────

  const routeDefinition: RouteDefinition = {
    routes,
    sourceFile: "", // router-loader 在加载模块后设置此字段

    /**
     * 将收集到的路由注册到底层适配器
     *
     * 由 router-loader 对每个路由文件调用此方法：
     *   1. 拼接完整路径：fullPath = prefix + route.path
     *   2. 解析 middlewares 引用 → VextMiddleware[]
     *   3. 构建 validate 中间件（若有 options.validate）
     *   4. 将 handler 包装为 VextMiddleware（执行链的最后一环）
     *   5. 组装执行链：[...routeMiddlewares, validateMiddleware?, handlerMiddleware]
     *   6. adapter.registerRoute(method, fullPath, chain)
     *
     * 注意：全局中间件由 adapter 内部拼接（registerMiddleware 已收集），
     * 这里只处理路由级链。
     *
     * @param adapter           底层适配器实例
     * @param prefix            文件路径推导出的路由前缀
     * @param middlewareDefs    已加载的中间件定义映射（name → VextMiddleware）
     * @param globalMiddlewares 全局中间件列表（当前未使用，由 adapter 内部处理）
     */
    register(
      adapter: VextAdapter,
      prefix: string,
      middlewareDefs: Map<string, VextMiddleware>,
      _globalMiddlewares: VextMiddleware[],
    ): void {
      for (const route of routes) {
        // ── 1. 拼接完整路径 ──────────────────────────────
        const fullPath = normalizePath(prefix, route.path);

        // ── 2. 解析路由级中间件引用 ─────────────────────
        const routeMiddlewares: VextMiddleware[] = [];
        if (route.options.middlewares) {
          for (const ref of route.options.middlewares) {
            const name = typeof ref === "string" ? ref : ref.name;
            const middleware = middlewareDefs.get(name);
            if (!middleware) {
              throw new Error(
                `[vextjs] Route ${route.method} "${fullPath}" references middleware "${name}" ` +
                  `which is not registered in config.middlewares whitelist.\n` +
                  `         Source: ${routeDefinition.sourceFile}\n` +
                  `         Available middlewares: ${[...middlewareDefs.keys()].join(", ") || "(none)"}`,
              );
            }
            routeMiddlewares.push(middleware);
          }
        }

        // ── 3. 构建 validate 中间件（Phase 0 跳过，Phase 1 实现）──
        // 当 route.options.validate 存在时，在 Phase 1 将创建 validate 中间件
        // 并插入到 routeMiddlewares 末尾（handler 之前）

        // ── 4. 将 handler 包装为 VextMiddleware ─────────
        // handler 是执行链的最后一环，不调用 next()
        const handlerMiddleware: VextMiddleware = async (req, res, _next) => {
          await route.handler(req, res);
        };

        // ── 5. 组装执行链 ──────────────────────────────
        const chain: VextMiddleware[] = [
          ...routeMiddlewares,
          handlerMiddleware,
        ];

        // ── 6. 注册到 adapter ──────────────────────────
        adapter.registerRoute(route.method, fullPath, chain);
      }
    },
  };

  // ── 存储 factory 引用，供 router-loader 后续调用 ──────────
  // router-loader 会：
  //   1. import 路由文件获取 RouteDefinition
  //   2. 传入真正的 app 引用调用 factory
  //   3. 调用 routeDefinition.register() 注册到 adapter
  //
  // 但 defineRoutes 设计为「立即收集」模式：
  //   factory 在 defineRoutes() 调用时就执行，routes 立即被收集。
  //   router-loader 拿到的 RouteDefinition 已经包含完整的路由记录。
  //
  // 为了让 factory 能访问 app（app.services / app.throw 等），
  // router-loader 会在调用 factory 前将 app 的属性混入 collector。

  // 这里暂时不执行 factory——延迟到 router-loader 传入真正的 app 后执行。
  // 内部 factory/collector 存在 WeakMap 和非枚举 Symbol 中，避免污染公共对象形状。
  const internals = {
    factory,
    collector,
  } satisfies RouteDefinitionInternals;

  routeDefinitionInternals.set(routeDefinition, internals);
  Object.defineProperty(routeDefinition, ROUTE_INTERNALS_SYMBOL, {
    value: internals,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return routeDefinition;
}

/**
 * 执行路由收集（由 router-loader 调用）
 *
 * 将真正的 app 属性混入 collector，然后执行 factory 回调。
 * 执行后 routeDefinition.routes 就包含了所有收集到的路由记录。
 *
 * ⚠️ 注意：这里是“按执行时刻把属性值复制到 collector”，不是给 factory 提供一个
 * 与根 app 保持实时同步的代理对象。因此对 `config`、`services`、`logger`、`throw`
 * 这类稳定引用通常没问题；但若某字段会在运行期被 `app.extend()` 替换成新对象引用
 * （例如 `remoteConfig`），闭包 `app` 中捕获的旧引用不会自动刷新。此类场景应在
 * handler 中优先使用 `req.app`，或在 service 中通过 `this.app` 读取真实运行期 app。
 *
 * @param routeDefinition defineRoutes 返回的路由定义对象
 * @param app             真正的 VextApp 实例
 */
export function executeRouteFactory(
  routeDefinition: RouteDefinition,
  app: VextApp,
): void {
  const internals = getRouteDefinitionInternals(routeDefinition);

  if (!internals) {
    throw new Error(
      "[vextjs] Invalid route definition. Make sure to use defineRoutes() to create route files.",
    );
  }

  // 清空 routes 数组，避免重复调用时路由累积
  // （测试场景中 createTestApp 可能多次加载同一路由文件）
  routeDefinition.routes.length = 0;

  // 将 app 的属性混入 collector，使 factory 回调中能通过 app 访问
  // services / config / throw / logger 等能力。
  // 这里是属性值复制，不是 live proxy；后续若根 app 某个字段被整体替换为新引用，
  // 闭包 app 中的旧引用不会自动更新。
  const collector = internals.collector;

  // 混入 app 的非 HTTP 方法属性
  const httpMethods = new Set([
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
  ]);
  for (const key of Object.keys(app)) {
    if (!httpMethods.has(key)) {
      collector[key] = (app as Record<string, unknown>)[key];
    }
  }

  // 确保关键属性存在（即使不在 Object.keys 中，如原型链上的方法）
  collector.config = app.config;
  collector.services = app.services;
  collector.logger = app.logger;
  collector.throw = app.throw;
  collector.adapter = app.adapter;

  // 执行 factory 回调，收集路由
  internals.factory(collector as unknown as VextApp);

  // 保留内部 factory/collector：允许重复调用 executeRouteFactory
  // （测试场景多次 createTestApp、Phase 2 热重载都需要重新执行 factory）
}

function getRouteDefinitionInternals(
  routeDefinition: RouteDefinition,
): RouteDefinitionInternals | null {
  const weakMapInternals = routeDefinitionInternals.get(routeDefinition);
  if (weakMapInternals) return weakMapInternals;

  const symbolInternals = (
    routeDefinition as unknown as Record<symbol, unknown>
  )[ROUTE_INTERNALS_SYMBOL];
  if (isRouteDefinitionInternals(symbolInternals)) return symbolInternals;

  const legacy = routeDefinition as RouteDefinition & {
    _factory?: unknown;
    _collector?: unknown;
  };
  if (typeof legacy._factory === "function" && isRecord(legacy._collector)) {
    return {
      factory: legacy._factory as RouteFactory,
      collector: legacy._collector,
    };
  }

  return null;
}

function isRouteDefinitionInternals(
  value: unknown,
): value is RouteDefinitionInternals {
  return (
    isRecord(value) &&
    typeof value.factory === "function" &&
    isRecord(value.collector)
  );
}

function assertRoutePath(
  method: string,
  path: unknown,
): asserts path is string {
  if (typeof path !== "string") {
    throw new Error(
      `[vextjs] ${method.toUpperCase()} route path must be a string.`,
    );
  }
}

function assertRouteOptions(
  method: string,
  path: string,
  options: unknown,
): asserts options is RouteOptions {
  if (!isPlainRecord(options)) {
    throw new Error(
      `[vextjs] ${method.toUpperCase()} "${path}": route options must be a plain object when provided.`,
    );
  }
}

function assertRouteHandler(
  method: string,
  path: string,
  handler: unknown,
): asserts handler is VextHandler {
  if (typeof handler !== "function") {
    throw new Error(
      `[vextjs] ${method.toUpperCase()} "${path}": handler must be a function.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 规范化路由路径
 *
 * 将前缀和子路径拼接为完整路径，处理边界情况：
 *   - 去除重复的 /
 *   - 确保路径以 / 开头
 *   - 去除尾部 /（根路径 / 除外）
 *
 * @param prefix  文件路径推导出的路由前缀（如 /api/users）
 * @param subPath 文件内注册的子路径（如 /list、/:id、/）
 * @returns 规范化后的完整路径
 *
 * @example
 * normalizePath('/users', '/list')   → '/users/list'
 * normalizePath('/users', '/')       → '/users'
 * normalizePath('/users', '/:id')    → '/users/:id'
 * normalizePath('/', '/')            → '/'
 * normalizePath('/api/users', '')    → '/api/users'
 */
function normalizePath(prefix: string, subPath: string): string {
  // 去除前缀尾部 /（根路径 '/' 除外）
  const cleanPrefix =
    prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;

  // 去除子路径的前导 /（避免拼接后出现 //）
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;

  // 拼接
  if (!cleanSubPath) {
    // 子路径为空或 '/'，直接使用前缀
    return cleanPrefix || "/";
  }

  // 当 prefix 是根路径 '/' 时，直接拼接为 '/' + subPath，避免 '//health'
  if (cleanPrefix === "/") {
    return `/${cleanSubPath}`;
  }

  const fullPath = `${cleanPrefix}/${cleanSubPath}`;

  // 去除尾部 /（根路径除外）
  if (fullPath.length > 1 && fullPath.endsWith("/")) {
    return fullPath.slice(0, -1);
  }

  return fullPath;
}

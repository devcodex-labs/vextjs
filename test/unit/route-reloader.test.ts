/**
 * route-reloader 单元测试
 *
 * 测试覆盖：
 *   - reloadRoutes：Fresh Adapter 策略
 *     - 创建全新 adapter 实例（通过 resolveAdapter 调用）
 *     - 注册插件全局中间件到新 adapter
 *     - 注册内置中间件（requestId / securityHeaders / cors / body-parser / rate-limit / response-wrapper）
 *     - 调用 loadRoutes 加载路由到新 adapter
 *     - 注册错误处理 + 404 兜底
 *     - 调用 buildHandler 获取新 handler
 *     - 临时替换 app.adapter → 完成后恢复
 *     - 失败时仍恢复 app.adapter
 *     - routes 目录不存在时发出警告
 *   - createSimpleRouteReloader：预配置重载函数
 *     - 创建并返回简化重载函数
 *     - 正确传递所有依赖
 *
 * 策略：
 *   使用 mock 对象模拟 adapter / loadRoutes / resolveAdapter 等依赖，
 *   验证调用顺序和参数正确性。使用临时目录模拟 outDir 结构。
 *
 * @see 11b-soft-reload.md §5（路由重载 — Fresh Adapter 策略）
 * @see 11e-edge-cases.md §1（Reload 失败回退）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2b
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  reloadRoutes,
  createSimpleRouteReloader,
  type RouteReloaderApp,
  type RouteReloaderAdapter,
  type RouteReloaderMiddleware,
  type RouteReloaderErrorMiddleware,
  type MiddlewareRegistry,
  type AdapterResolver,
  type RoutesLoader,
  type ErrorHandlerFactory,
  type NotFoundHandlerFactory,
  type ReloadRoutesOptions,
  type BuiltinMiddlewareCreators,
} from "../../src/lib/dev/route-reloader.js";

// ── 测试辅助 ────────────────────────────────────────────────

/**
 * 创建 mock adapter 实例
 *
 * 跟踪所有方法调用，用于断言调用顺序和参数。
 */
function createMockAdapter(
  overrides?: Partial<RouteReloaderAdapter>,
): RouteReloaderAdapter & {
  _registeredMiddlewares: RouteReloaderMiddleware[];
  _registeredRoutes: Array<{
    method: string;
    path: string;
    chain: RouteReloaderMiddleware[];
  }>;
  _errorHandler: RouteReloaderErrorMiddleware | null;
  _notFoundHandler: RouteReloaderMiddleware | null;
} {
  const registeredMiddlewares: RouteReloaderMiddleware[] = [];
  const registeredRoutes: Array<{
    method: string;
    path: string;
    chain: RouteReloaderMiddleware[];
  }> = [];
  let errorHandler: RouteReloaderErrorMiddleware | null = null;
  let notFoundHandler: RouteReloaderMiddleware | null = null;

  const mockHandler = (_req: any, _res: any) => {};

  return {
    name: "mock-adapter",
    registerMiddleware: vi.fn((mw: RouteReloaderMiddleware) => {
      registeredMiddlewares.push(mw);
    }),
    registerRoute: vi.fn(
      (method: string, path: string, chain: RouteReloaderMiddleware[]) => {
        registeredRoutes.push({ method, path, chain });
      },
    ),
    registerErrorHandler: vi.fn((handler: RouteReloaderErrorMiddleware) => {
      errorHandler = handler;
    }),
    registerNotFound: vi.fn((handler: RouteReloaderMiddleware) => {
      notFoundHandler = handler;
    }),
    buildHandler: vi.fn(() => mockHandler),
    _registeredMiddlewares: registeredMiddlewares,
    _registeredRoutes: registeredRoutes,
    get _errorHandler() {
      return errorHandler;
    },
    get _notFoundHandler() {
      return notFoundHandler;
    },
    ...overrides,
  };
}

/**
 * 创建 mock VextApp
 */
function createMockApp(
  overrides?: Partial<RouteReloaderApp>,
): RouteReloaderApp {
  return {
    config: {
      port: 3000,
      host: "0.0.0.0",
      adapter: "hono",
      response: { envelope: true },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
    adapter: createMockAdapter(),
    services: {},
    ...overrides,
  };
}

/**
 * 创建 mock middleware
 */
function createMockMiddleware(name: string): RouteReloaderMiddleware {
  const fn: RouteReloaderMiddleware = async (_ctx, next) => {
    await next();
  };
  Object.defineProperty(fn, "name", { value: name });
  return fn;
}

/**
 * 创建 mock error middleware
 */
function createMockErrorMiddleware(): RouteReloaderErrorMiddleware {
  return async (_error, _ctx, next) => {
    await next();
  };
}

/**
 * 创建 mock not found handler
 */
function createMockNotFoundHandler(): RouteReloaderMiddleware {
  return async (_ctx, _next) => {};
}

/**
 * 创建临时目录
 */
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vext-route-reloader-test-"));
}

// ── reloadRoutes ────────────────────────────────────────────

describe("reloadRoutes", () => {
  let tempDir: string;
  let outDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outDir = join(tempDir, ".vext", "dev");
    await mkdir(join(outDir, "routes"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * 创建默认的 reloadRoutes 选项
   */
  function createDefaultOptions(
    overrides?: Partial<ReloadRoutesOptions>,
  ): ReloadRoutesOptions {
    const freshAdapter = createMockAdapter();
    const app = createMockApp();

    return {
      app,
      outDir,
      middlewareDefs: {} as MiddlewareRegistry,
      globalMiddlewares: [],
      resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      loadRoutes: vi.fn(async () => {}) as unknown as RoutesLoader,
      createErrorHandler: vi.fn(() =>
        createMockErrorMiddleware(),
      ) as unknown as ErrorHandlerFactory,
      createNotFoundHandler: vi.fn(() =>
        createMockNotFoundHandler(),
      ) as unknown as NotFoundHandlerFactory,
      ...overrides,
    };
  }

  // ── 创建全新 adapter ──────────────────────────────────

  describe("创建全新 adapter 实例", () => {
    it("应调用 resolveAdapter 创建新的 adapter 实例", async () => {
      const freshAdapter = createMockAdapter();
      const resolveAdapterFn = vi.fn(() => freshAdapter);
      const options = createDefaultOptions({
        resolveAdapter: resolveAdapterFn as unknown as AdapterResolver,
      });

      await reloadRoutes(options);

      expect(resolveAdapterFn).toHaveBeenCalledOnce();
    });

    it("应将 app.config 传递给 resolveAdapter", async () => {
      const app = createMockApp();
      const resolveAdapterFn = vi.fn(() => createMockAdapter());
      const options = createDefaultOptions({
        app,
        resolveAdapter: resolveAdapterFn as unknown as AdapterResolver,
      });

      await reloadRoutes(options);

      expect(resolveAdapterFn).toHaveBeenCalledWith(app.config, app);
    });

    it("应返回新 adapter 构建的 handler", async () => {
      const mockHandler = (_req: any, _res: any) => {
        // 新 handler 标识
      };
      const freshAdapter = createMockAdapter({
        buildHandler: vi.fn(() => mockHandler),
      });
      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      });

      const result = await reloadRoutes(options);

      expect(result.handler).toBe(mockHandler);
      expect(result.adapter).toBe(freshAdapter);
    });
  });

  // ── 调用 buildHandler ─────────────────────────────────

  describe("buildHandler 调用", () => {
    it("应在所有注册完成后调用 buildHandler", async () => {
      const callOrder: string[] = [];
      const freshAdapter = createMockAdapter({
        registerMiddleware: vi.fn(() => {
          callOrder.push("registerMiddleware");
        }),
        registerErrorHandler: vi.fn(() => {
          callOrder.push("registerErrorHandler");
        }),
        registerNotFound: vi.fn(() => {
          callOrder.push("registerNotFound");
        }),
        buildHandler: vi.fn(() => {
          callOrder.push("buildHandler");
          return (_req: any, _res: any) => {};
        }),
      });

      const loadRoutesFn = vi.fn(async () => {
        callOrder.push("loadRoutes");
      });

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
        globalMiddlewares: [createMockMiddleware("plugin-mw")],
      });

      await reloadRoutes(options);

      // buildHandler 应在最后调用
      expect(callOrder[callOrder.length - 1]).toBe("buildHandler");
      // loadRoutes 应在 buildHandler 之前
      expect(callOrder.indexOf("loadRoutes")).toBeLessThan(
        callOrder.indexOf("buildHandler"),
      );
    });

    it("应返回 buildHandler 的返回值", async () => {
      const expectedHandler = (_req: any, _res: any) => {
        /* specific handler */
      };
      const freshAdapter = createMockAdapter({
        buildHandler: vi.fn(() => expectedHandler),
      });

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      });

      const result = await reloadRoutes(options);
      expect(result.handler).toBe(expectedHandler);
    });
  });

  // ── 插件全局中间件注册 ────────────────────────────────

  describe("插件全局中间件注册", () => {
    it("应将所有全局中间件注册到新 adapter", async () => {
      const mw1 = createMockMiddleware("plugin-mw-1");
      const mw2 = createMockMiddleware("plugin-mw-2");
      const freshAdapter = createMockAdapter();

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        globalMiddlewares: [mw1, mw2],
      });

      await reloadRoutes(options);

      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(mw1);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(mw2);
    });

    it("应在无全局中间件时不调用 registerMiddleware（除内置中间件外）", async () => {
      const freshAdapter = createMockAdapter();

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        globalMiddlewares: [],
      });

      await reloadRoutes(options);

      // 无全局中间件，也无内置中间件 → registerMiddleware 不被调用
      expect(freshAdapter.registerMiddleware).not.toHaveBeenCalled();
    });

    it("应保持全局中间件的注册顺序", async () => {
      const order: string[] = [];
      const mw1: RouteReloaderMiddleware = async (_ctx, next) => {
        order.push("mw1");
        await next();
      };
      const mw2: RouteReloaderMiddleware = async (_ctx, next) => {
        order.push("mw2");
        await next();
      };

      const freshAdapter = createMockAdapter({
        registerMiddleware: vi.fn((mw: RouteReloaderMiddleware) => {
          if (mw === mw1) order.push("register-mw1");
          if (mw === mw2) order.push("register-mw2");
        }),
      });

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        globalMiddlewares: [mw1, mw2],
      });

      await reloadRoutes(options);

      expect(order).toEqual(["register-mw1", "register-mw2"]);
    });
  });

  // ── 内置中间件注册 ────────────────────────────────────

  describe("内置中间件注册", () => {
    it("应注册所有提供的内置中间件", async () => {
      const reqIdMw = createMockMiddleware("requestId");
      const corsMw = createMockMiddleware("cors");
      const bodyMw = createMockMiddleware("bodyParser");
      const rateMw = createMockMiddleware("rateLimit");
      const respMw = createMockMiddleware("responseWrapper");
      const frontendRenderMw = createMockMiddleware("frontendRender");
      const frontendDevEventsMw = createMockMiddleware("frontendDevEvents");
      const accessLogMw = createMockMiddleware("accessLog");
      const securityHeadersMw = createMockMiddleware("securityHeaders");
      const csrfMw = createMockMiddleware("csrf");
      const authContextMw = createMockMiddleware("authContext");
      const sessionMw = createMockMiddleware("session");

      const builtinMiddlewares: BuiltinMiddlewareCreators = {
        createRequestIdMiddleware: vi.fn(() => reqIdMw),
        authContextMiddleware: authContextMw,
        createSecurityHeadersMiddleware: vi.fn(() => securityHeadersMw),
        createCorsMiddleware: vi.fn(() => corsMw),
        createBodyParserMiddleware: vi.fn(() => bodyMw),
        createRateLimitMiddleware: vi.fn(() => rateMw),
        responseWrapper: respMw,
        createFrontendRenderMiddleware: vi.fn(() => frontendRenderMw),
        frontendDevEvents: frontendDevEventsMw,
        createAccessLogMiddleware: vi.fn(() => accessLogMw),
        sessionMiddleware: sessionMw,
        createCsrfMiddleware: vi.fn(() => csrfMw),
      };

      const freshAdapter = createMockAdapter();

      const options = createDefaultOptions({
        app: createMockApp({
          config: { session: { enabled: true } },
        }),
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        builtinMiddlewares,
      });

      await reloadRoutes(options);

      // 所有内置中间件都应被注册
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(reqIdMw);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(
        authContextMw,
      );
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(
        securityHeadersMw,
      );
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(corsMw);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(bodyMw);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(rateMw);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(respMw);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(
        frontendRenderMw,
      );
      expect(freshAdapter.registerRoute).toHaveBeenCalledWith(
        "GET",
        "/__vext/dev/events",
        [frontendDevEventsMw],
      );
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(accessLogMw);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(sessionMw);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(csrfMw);
    });

    it("应按正确顺序注册内置中间件与 dev events route", async () => {
      const registrationOrder: string[] = [];
      const reqIdMw = createMockMiddleware("requestId");
      const corsMw = createMockMiddleware("cors");
      const bodyMw = createMockMiddleware("bodyParser");
      const rateMw = createMockMiddleware("rateLimit");
      const respMw = createMockMiddleware("responseWrapper");
      const frontendRenderMw = createMockMiddleware("frontendRender");
      const frontendDevEventsMw = createMockMiddleware("frontendDevEvents");
      const accessLogMw = createMockMiddleware("accessLog");
      const globalMw = createMockMiddleware("globalPlugin");
      const securityHeadersMw = createMockMiddleware("securityHeaders");
      const csrfMw = createMockMiddleware("csrf");
      const authContextMw = createMockMiddleware("authContext");
      const sessionMw = createMockMiddleware("session");

      const builtinMiddlewares: BuiltinMiddlewareCreators = {
        createRequestIdMiddleware: vi.fn(() => reqIdMw),
        authContextMiddleware: authContextMw,
        createSecurityHeadersMiddleware: vi.fn(() => securityHeadersMw),
        createCorsMiddleware: vi.fn(() => corsMw),
        createBodyParserMiddleware: vi.fn(() => bodyMw),
        createRateLimitMiddleware: vi.fn(() => rateMw),
        responseWrapper: respMw,
        createFrontendRenderMiddleware: vi.fn(() => frontendRenderMw),
        frontendDevEvents: frontendDevEventsMw,
        createAccessLogMiddleware: vi.fn(() => accessLogMw),
        sessionMiddleware: sessionMw,
        createCsrfMiddleware: vi.fn(() => csrfMw),
      };

      const freshAdapter = createMockAdapter({
        registerMiddleware: vi.fn((mw: RouteReloaderMiddleware) => {
          if (mw === reqIdMw) registrationOrder.push("requestId");
          else if (mw === authContextMw) registrationOrder.push("authContext");
          else if (mw === securityHeadersMw)
            registrationOrder.push("securityHeaders");
          else if (mw === corsMw) registrationOrder.push("cors");
          else if (mw === bodyMw) registrationOrder.push("bodyParser");
          else if (mw === rateMw) registrationOrder.push("rateLimit");
          else if (mw === respMw) registrationOrder.push("responseWrapper");
          else if (mw === frontendRenderMw)
            registrationOrder.push("frontendRender");
          else if (mw === accessLogMw) registrationOrder.push("accessLog");
          else if (mw === sessionMw) registrationOrder.push("session");
          else if (mw === globalMw) registrationOrder.push("global");
          else if (mw === csrfMw) registrationOrder.push("csrf");
        }),
        registerRoute: vi.fn(
          (method: string, path: string, chain: RouteReloaderMiddleware[]) => {
            if (
              method === "GET" &&
              path === "/__vext/dev/events" &&
              chain[0] === frontendDevEventsMw
            ) {
              registrationOrder.push("frontendDevEventsRoute");
            }
          },
        ),
      });

      const options = createDefaultOptions({
        app: createMockApp({
          config: { session: { enabled: true } },
        }),
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        builtinMiddlewares,
        globalMiddlewares: [globalMw],
      });

      await reloadRoutes(options);

      expect(registrationOrder).toEqual([
        "requestId",
        "authContext",
        "securityHeaders",
        "cors",
        "bodyParser",
        "rateLimit",
        "responseWrapper",
        "frontendRender",
        "frontendDevEventsRoute",
        "accessLog",
        "session",
        "global",
        "csrf",
      ]);
    });

    it("应在未提供内置中间件时跳过", async () => {
      const freshAdapter = createMockAdapter();
      const globalMw = createMockMiddleware("globalPlugin");

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        globalMiddlewares: [globalMw],
        // builtinMiddlewares 不提供
      });

      await reloadRoutes(options);

      // 只注册了全局中间件
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledTimes(1);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(globalMw);
    });

    it("应在内置中间件部分缺失时只注册存在的", async () => {
      const corsMw = createMockMiddleware("cors");

      const builtinMiddlewares: BuiltinMiddlewareCreators = {
        // 只提供 cors，其他都不提供
        createCorsMiddleware: vi.fn(() => corsMw),
      };

      const freshAdapter = createMockAdapter();

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        builtinMiddlewares,
        globalMiddlewares: [],
      });

      await reloadRoutes(options);

      // 只注册了 cors
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledTimes(1);
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(corsMw);
    });

    it("条件守卫 disabled → creator undefined → 对应中间件不被注册（D2 修复覆盖）", async () => {
      // 模拟 config.response.wrap = false → builtinMwCreators.responseWrapper = undefined
      // 模拟 config.cors.enabled = false → builtinMwCreators.createCorsMiddleware = undefined
      // 只注册 requestId 和 bodyParser（enabled = true）
      const reqIdMw = createMockMiddleware("requestId");
      const bodyMw = createMockMiddleware("bodyParser");

      const builtinMiddlewares: BuiltinMiddlewareCreators = {
        createRequestIdMiddleware: vi.fn(() => reqIdMw),
        createCorsMiddleware: undefined, // cors disabled
        createBodyParserMiddleware: vi.fn(() => bodyMw),
        createRateLimitMiddleware: undefined, // rateLimit disabled
        responseWrapper: undefined, // response.wrap = false
        createAccessLogMiddleware: undefined, // accessLog disabled
      };

      const freshAdapter = createMockAdapter();

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        builtinMiddlewares,
        globalMiddlewares: [],
      });

      await reloadRoutes(options);

      // 只有 requestId 和 bodyParser 被注册
      expect(freshAdapter.registerMiddleware).toHaveBeenCalledTimes(2);
      expect(freshAdapter.registerMiddleware).toHaveBeenNthCalledWith(
        1,
        reqIdMw,
      );
      expect(freshAdapter.registerMiddleware).toHaveBeenNthCalledWith(
        2,
        bodyMw,
      );
    });

    it("应将 app.config 传递给内置中间件工厂", async () => {
      const createReqId = vi.fn(() => createMockMiddleware("rid"));

      const builtinMiddlewares: BuiltinMiddlewareCreators = {
        createRequestIdMiddleware: createReqId,
      };

      const app = createMockApp();

      const options = createDefaultOptions({
        app,
        resolveAdapter: vi.fn(() =>
          createMockAdapter(),
        ) as unknown as AdapterResolver,
        builtinMiddlewares,
      });

      await reloadRoutes(options);

      expect(createReqId).toHaveBeenCalledWith(app.config);
    });
  });

  // ── 错误处理 + 404 注册 ───────────────────────────────

  describe("错误处理 + 404 注册", () => {
    it("应注册错误处理器到新 adapter", async () => {
      const mockErrorHandler = createMockErrorMiddleware();
      const createErrorHandlerFn = vi.fn(() => mockErrorHandler);
      const freshAdapter = createMockAdapter();

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        createErrorHandler:
          createErrorHandlerFn as unknown as ErrorHandlerFactory,
      });

      await reloadRoutes(options);

      expect(freshAdapter.registerErrorHandler).toHaveBeenCalledOnce();
      expect(freshAdapter.registerErrorHandler).toHaveBeenCalledWith(
        mockErrorHandler,
      );
    });

    it("应注册 404 处理器到新 adapter", async () => {
      const mockNotFound = createMockNotFoundHandler();
      const createNotFoundFn = vi.fn(() => mockNotFound);
      const freshAdapter = createMockAdapter();

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        createNotFoundHandler:
          createNotFoundFn as unknown as NotFoundHandlerFactory,
      });

      await reloadRoutes(options);

      expect(freshAdapter.registerNotFound).toHaveBeenCalledOnce();
      expect(freshAdapter.registerNotFound).toHaveBeenCalledWith(mockNotFound);
    });

    it("应使用 config.response 配置创建错误处理器", async () => {
      const createErrorHandlerFn = vi.fn(() => createMockErrorMiddleware());
      const app = createMockApp({
        config: {
          port: 3000,
          response: { envelope: true, stackTrace: false },
        },
      });

      const options = createDefaultOptions({
        app,
        createErrorHandler:
          createErrorHandlerFn as unknown as ErrorHandlerFactory,
      });

      await reloadRoutes(options);

      expect(createErrorHandlerFn).toHaveBeenCalledWith({
        envelope: true,
        stackTrace: false,
      });
    });

    it("应在 config.response 缺失时使用空对象", async () => {
      const createErrorHandlerFn = vi.fn(() => createMockErrorMiddleware());
      const app = createMockApp({
        config: { port: 3000 },
      });

      const options = createDefaultOptions({
        app,
        createErrorHandler:
          createErrorHandlerFn as unknown as ErrorHandlerFactory,
      });

      await reloadRoutes(options);

      expect(createErrorHandlerFn).toHaveBeenCalledWith({});
    });
  });

  // ── 路由加载 ──────────────────────────────────────────

  describe("路由加载", () => {
    it("应调用 loadRoutes 将路由注册到新 adapter", async () => {
      const loadRoutesFn = vi.fn(async () => {});
      const freshAdapter = createMockAdapter();
      const mwDefs: MiddlewareRegistry = {
        auth: {
          handler: createMockMiddleware("auth"),
          defaultOptions: undefined,
          kind: "middleware",
        },
      };
      const globalMws = [createMockMiddleware("global")];

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
        middlewareDefs: mwDefs,
        globalMiddlewares: globalMws,
      });

      await reloadRoutes(options);

      expect(loadRoutesFn).toHaveBeenCalledOnce();
    });

    it("应将 middlewareDefs 传递给 loadRoutes", async () => {
      const loadRoutesFn = vi.fn(async () => {});
      const mwDefs: MiddlewareRegistry = {
        auth: {
          handler: createMockMiddleware("auth"),
          defaultOptions: undefined,
          kind: "middleware",
        },
      };

      const options = createDefaultOptions({
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
        middlewareDefs: mwDefs,
      });

      await reloadRoutes(options);

      const callArgs = loadRoutesFn.mock.calls[0] as unknown[];
      expect((callArgs[2] as any).middlewareDefs).toBe(mwDefs);
    });

    it("应将 globalMiddlewares 传递给 loadRoutes", async () => {
      const loadRoutesFn = vi.fn(async () => {});
      const globalMws = [
        createMockMiddleware("g1"),
        createMockMiddleware("g2"),
      ];

      const options = createDefaultOptions({
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
        globalMiddlewares: globalMws,
      });

      await reloadRoutes(options);

      const callArgs = loadRoutesFn.mock.calls[0] as unknown[];
      expect((callArgs[2] as any).globalMiddlewares).toBe(globalMws);
    });

    it("应将 routes 目录路径传递给 loadRoutes", async () => {
      const loadRoutesFn = vi.fn(async () => {});

      const options = createDefaultOptions({
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      });

      await reloadRoutes(options);

      const callArgs = loadRoutesFn.mock.calls[0] as unknown[];
      expect(callArgs[1]).toBe(join(outDir, "routes"));
    });

    it("应在 routes 目录不存在时发出警告并跳过 loadRoutes", async () => {
      const nonExistentOutDir = join(tempDir, "nonexistent-out");
      await mkdir(nonExistentOutDir, { recursive: true });
      // 不创建 routes 子目录

      const loadRoutesFn = vi.fn(async () => {});
      const app = createMockApp();

      const options = createDefaultOptions({
        app,
        outDir: nonExistentOutDir,
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      });

      await reloadRoutes(options);

      expect(loadRoutesFn).not.toHaveBeenCalled();
      expect(app.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("routes directory not found"),
      );
    });
  });

  // ── app.adapter 临时替换 ──────────────────────────────

  describe("app.adapter 临时替换与恢复", () => {
    it("应在 loadRoutes 调用期间将 app.adapter 设为新 adapter", async () => {
      const freshAdapter = createMockAdapter();
      const originalAdapter = createMockAdapter();
      const app = createMockApp({ adapter: originalAdapter });

      let adapterDuringLoad: RouteReloaderAdapter | null = null;
      const loadRoutesFn = vi.fn(async (appArg: RouteReloaderApp) => {
        adapterDuringLoad = appArg.adapter;
      });

      const options = createDefaultOptions({
        app,
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      });

      await reloadRoutes(options);

      // loadRoutes 执行期间 app.adapter 应为 freshAdapter
      expect(adapterDuringLoad).toBe(freshAdapter);
    });

    it("应在成功完成后恢复原始 adapter", async () => {
      const originalAdapter = createMockAdapter();
      const freshAdapter = createMockAdapter();
      const app = createMockApp({ adapter: originalAdapter });

      const options = createDefaultOptions({
        app,
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      });

      await reloadRoutes(options);

      // 完成后 app.adapter 应恢复为原始值
      expect(app.adapter).toBe(originalAdapter);
    });

    it("应在 loadRoutes 失败后恢复原始 adapter", async () => {
      const originalAdapter = createMockAdapter();
      const freshAdapter = createMockAdapter();
      const app = createMockApp({ adapter: originalAdapter });

      const loadRoutesFn = vi.fn(async () => {
        throw new Error("route loading failed");
      });

      const options = createDefaultOptions({
        app,
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      });

      await expect(reloadRoutes(options)).rejects.toThrow(
        "route loading failed",
      );

      // 失败后 app.adapter 仍应恢复
      expect(app.adapter).toBe(originalAdapter);
    });

    it("应在 buildHandler 失败后恢复原始 adapter", async () => {
      const originalAdapter = createMockAdapter();
      const freshAdapter = createMockAdapter({
        buildHandler: vi.fn(() => {
          throw new Error("buildHandler failed");
        }),
      });
      const app = createMockApp({ adapter: originalAdapter });

      const options = createDefaultOptions({
        app,
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      });

      await expect(reloadRoutes(options)).rejects.toThrow(
        "buildHandler failed",
      );

      expect(app.adapter).toBe(originalAdapter);
    });

    it("应在 resolveAdapter 失败后保持原始 adapter 不变", async () => {
      const originalAdapter = createMockAdapter();
      const app = createMockApp({ adapter: originalAdapter });

      const options = createDefaultOptions({
        app,
        resolveAdapter: vi.fn(() => {
          throw new Error("resolveAdapter failed");
        }) as unknown as AdapterResolver,
      });

      await expect(reloadRoutes(options)).rejects.toThrow(
        "resolveAdapter failed",
      );

      expect(app.adapter).toBe(originalAdapter);
    });
  });

  // ── 错误处理（失败不 swap）────────────────────────────

  describe("错误处理", () => {
    it("应在 resolveAdapter 失败时向上抛出错误", async () => {
      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => {
          throw new Error("adapter creation failed");
        }) as unknown as AdapterResolver,
      });

      await expect(reloadRoutes(options)).rejects.toThrow(
        "adapter creation failed",
      );
    });

    it("应在 loadRoutes 失败时向上抛出错误", async () => {
      const options = createDefaultOptions({
        loadRoutes: vi.fn(async () => {
          throw new Error("failed to load route file");
        }) as unknown as RoutesLoader,
      });

      await expect(reloadRoutes(options)).rejects.toThrow(
        "failed to load route file",
      );
    });

    it("应在 createErrorHandler 失败时向上抛出错误", async () => {
      const options = createDefaultOptions({
        createErrorHandler: vi.fn(() => {
          throw new Error("error handler creation failed");
        }) as unknown as ErrorHandlerFactory,
      });

      await expect(reloadRoutes(options)).rejects.toThrow(
        "error handler creation failed",
      );
    });

    it("应在 createNotFoundHandler 失败时向上抛出错误", async () => {
      const options = createDefaultOptions({
        createNotFoundHandler: vi.fn(() => {
          throw new Error("not found handler creation failed");
        }) as unknown as NotFoundHandlerFactory,
      });

      await expect(reloadRoutes(options)).rejects.toThrow(
        "not found handler creation failed",
      );
    });

    it("应在 buildHandler 失败时向上抛出错误", async () => {
      const freshAdapter = createMockAdapter({
        buildHandler: vi.fn(() => {
          throw new Error("build handler failed");
        }),
      });

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      });

      await expect(reloadRoutes(options)).rejects.toThrow(
        "build handler failed",
      );
    });

    it("应在失败时不调用 buildHandler（如果 loadRoutes 先失败）", async () => {
      const freshAdapter = createMockAdapter();
      const loadRoutesFn = vi.fn(async () => {
        throw new Error("route loading error");
      });

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      });

      await expect(reloadRoutes(options)).rejects.toThrow();

      // buildHandler 不应被调用
      expect(freshAdapter.buildHandler).not.toHaveBeenCalled();
    });
  });

  // ── 日志输出 ──────────────────────────────────────────

  describe("日志输出", () => {
    it("应在成功时记录 info 日志", async () => {
      const app = createMockApp();
      const options = createDefaultOptions({ app });

      await reloadRoutes(options);

      expect(app.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("routes reloaded via fresh adapter"),
      );
    });

    it("应在日志中包含 adapter 名称", async () => {
      const app = createMockApp();
      const freshAdapter = createMockAdapter();
      // @ts-expect-error — 只读属性，测试中需要覆盖
      freshAdapter.name = "test-adapter";

      const options = createDefaultOptions({
        app,
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      });

      await reloadRoutes(options);

      expect(app.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("test-adapter"),
      );
    });

    it("应在创建 adapter 时记录 debug 日志", async () => {
      const app = createMockApp();
      const options = createDefaultOptions({ app });

      await reloadRoutes(options);

      expect(app.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("creating fresh adapter"),
      );
    });
  });

  // ── 返回值 ────────────────────────────────────────────

  describe("返回值", () => {
    it("应返回包含 handler 和 adapter 的 RouteReloadResult", async () => {
      const mockHandler = (_req: any, _res: any) => {};
      const freshAdapter = createMockAdapter({
        buildHandler: vi.fn(() => mockHandler),
      });

      const options = createDefaultOptions({
        resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      });

      const result = await reloadRoutes(options);

      expect(result).toHaveProperty("handler");
      expect(result).toHaveProperty("adapter");
      expect(result.handler).toBe(mockHandler);
      expect(result.adapter).toBe(freshAdapter);
    });
  });

  // ── 中间件注册表传递 ──────────────────────────────────

  describe("中间件注册表传递", () => {
    it("应支持 MiddlewareRegistry 对象", async () => {
      const loadRoutesFn = vi.fn(async () => {});
      const mwDefs: MiddlewareRegistry = {
        auth: {
          handler: createMockMiddleware("auth"),
          defaultOptions: undefined,
          kind: "middleware",
        },
        rateLimit: {
          handler: (opts?: Record<string, unknown>) =>
            createMockMiddleware(`rateLimit-${JSON.stringify(opts)}`),
          defaultOptions: { max: 100 },
          kind: "factory",
        },
      };

      const options = createDefaultOptions({
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
        middlewareDefs: mwDefs,
      });

      await reloadRoutes(options);

      const callArgs = loadRoutesFn.mock.calls[0] as unknown[];
      expect((callArgs[2] as any).middlewareDefs).toBe(mwDefs);
    });

    it("应支持 Map<string, VextMiddleware> 类型", async () => {
      const loadRoutesFn = vi.fn(async () => {});
      const mwMap = new Map<string, RouteReloaderMiddleware>();
      mwMap.set("auth", createMockMiddleware("auth"));

      const options = createDefaultOptions({
        loadRoutes: loadRoutesFn as unknown as RoutesLoader,
        middlewareDefs: mwMap,
      });

      await reloadRoutes(options);

      const callArgs = loadRoutesFn.mock.calls[0] as unknown[];
      expect((callArgs[2] as any).middlewareDefs).toBe(mwMap);
    });
  });

  // ── 并发安全 ──────────────────────────────────────────

  describe("并发安全", () => {
    it("应支持连续多次调用（每次创建新 adapter）", async () => {
      const adapters: RouteReloaderAdapter[] = [];
      const resolveAdapterFn = vi.fn(() => {
        const adapter = createMockAdapter();
        adapters.push(adapter);
        return adapter;
      });

      const options = createDefaultOptions({
        resolveAdapter: resolveAdapterFn as unknown as AdapterResolver,
      });

      await reloadRoutes(options);
      await reloadRoutes(options);
      await reloadRoutes(options);

      expect(resolveAdapterFn).toHaveBeenCalledTimes(3);
      // 每次调用应创建不同的 adapter 实例
      expect(adapters[0]).not.toBe(adapters[1]);
      expect(adapters[1]).not.toBe(adapters[2]);
    });
  });
});

// ── createSimpleRouteReloader ───────────────────────────────

describe("createSimpleRouteReloader", () => {
  let tempDir: string;
  let outDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outDir = join(tempDir, ".vext", "dev");
    await mkdir(join(outDir, "routes"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("应返回一个函数", () => {
    const reloader = createSimpleRouteReloader({
      app: createMockApp(),
      resolveAdapter: vi.fn(() =>
        createMockAdapter(),
      ) as unknown as AdapterResolver,
      loadRoutes: vi.fn(async () => {}) as unknown as RoutesLoader,
      createErrorHandler: vi.fn(() =>
        createMockErrorMiddleware(),
      ) as unknown as ErrorHandlerFactory,
      createNotFoundHandler: vi.fn(() =>
        createMockNotFoundHandler(),
      ) as unknown as NotFoundHandlerFactory,
      middlewareDefs: {} as MiddlewareRegistry,
      globalMiddlewares: [],
    });

    expect(typeof reloader).toBe("function");
  });

  it("应使用注入的依赖调用 reloadRoutes", async () => {
    const freshAdapter = createMockAdapter();
    const resolveAdapterFn = vi.fn(() => freshAdapter);
    const loadRoutesFn = vi.fn(async () => {});
    const createErrorHandlerFn = vi.fn(() => createMockErrorMiddleware());
    const createNotFoundHandlerFn = vi.fn(() => createMockNotFoundHandler());

    const reloader = createSimpleRouteReloader({
      app: createMockApp(),
      resolveAdapter: resolveAdapterFn as unknown as AdapterResolver,
      loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      createErrorHandler:
        createErrorHandlerFn as unknown as ErrorHandlerFactory,
      createNotFoundHandler:
        createNotFoundHandlerFn as unknown as NotFoundHandlerFactory,
      middlewareDefs: {} as MiddlewareRegistry,
      globalMiddlewares: [],
    });

    const result = await reloader(outDir);

    expect(resolveAdapterFn).toHaveBeenCalled();
    expect(loadRoutesFn).toHaveBeenCalled();
    expect(createErrorHandlerFn).toHaveBeenCalled();
    expect(createNotFoundHandlerFn).toHaveBeenCalled();
    expect(result).toHaveProperty("handler");
    expect(result).toHaveProperty("adapter");
  });

  it("应将 outDir 参数传递到内部 reloadRoutes", async () => {
    const loadRoutesFn = vi.fn(async () => {});

    const reloader = createSimpleRouteReloader({
      app: createMockApp(),
      resolveAdapter: vi.fn(() =>
        createMockAdapter(),
      ) as unknown as AdapterResolver,
      loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      createErrorHandler: vi.fn(() =>
        createMockErrorMiddleware(),
      ) as unknown as ErrorHandlerFactory,
      createNotFoundHandler: vi.fn(() =>
        createMockNotFoundHandler(),
      ) as unknown as NotFoundHandlerFactory,
      middlewareDefs: {} as MiddlewareRegistry,
      globalMiddlewares: [],
    });

    await reloader(outDir);

    const callArgs = loadRoutesFn.mock.calls[0] as unknown[];
    expect(callArgs[1]).toBe(join(outDir, "routes"));
  });

  it("应传递 builtinMiddlewares 到内部 reloadRoutes", async () => {
    const reqIdMw = createMockMiddleware("requestId");
    const builtinMiddlewares: BuiltinMiddlewareCreators = {
      createRequestIdMiddleware: vi.fn(() => reqIdMw),
    };
    const freshAdapter = createMockAdapter();

    const reloader = createSimpleRouteReloader({
      app: createMockApp(),
      resolveAdapter: vi.fn(() => freshAdapter) as unknown as AdapterResolver,
      loadRoutes: vi.fn(async () => {}) as unknown as RoutesLoader,
      createErrorHandler: vi.fn(() =>
        createMockErrorMiddleware(),
      ) as unknown as ErrorHandlerFactory,
      createNotFoundHandler: vi.fn(() =>
        createMockNotFoundHandler(),
      ) as unknown as NotFoundHandlerFactory,
      middlewareDefs: {} as MiddlewareRegistry,
      globalMiddlewares: [],
      builtinMiddlewares,
    });

    await reloader(outDir);

    expect(builtinMiddlewares.createRequestIdMiddleware).toHaveBeenCalled();
    expect(freshAdapter.registerMiddleware).toHaveBeenCalledWith(reqIdMw);
  });

  it("应支持多次调用（每次创建新 adapter）", async () => {
    let callCount = 0;
    const resolveAdapterFn = vi.fn(() => {
      callCount++;
      return createMockAdapter();
    });

    const reloader = createSimpleRouteReloader({
      app: createMockApp(),
      resolveAdapter: resolveAdapterFn as unknown as AdapterResolver,
      loadRoutes: vi.fn(async () => {}) as unknown as RoutesLoader,
      createErrorHandler: vi.fn(() =>
        createMockErrorMiddleware(),
      ) as unknown as ErrorHandlerFactory,
      createNotFoundHandler: vi.fn(() =>
        createMockNotFoundHandler(),
      ) as unknown as NotFoundHandlerFactory,
      middlewareDefs: {} as MiddlewareRegistry,
      globalMiddlewares: [],
    });

    await reloader(outDir);
    await reloader(outDir);

    expect(callCount).toBe(2);
  });
});

// ── BUG-022: 热重载后 OpenAPI 端点重新注册 ─────────────────

describe("reloadRoutes — OpenAPI 重新注册 (BUG-022)", () => {
  let tempDir: string;
  let outDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outDir = tempDir;
    await mkdir(join(outDir, "routes"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * 创建默认的 reloadRoutes 选项（BUG-022 测试专用）
   */
  function createBugFixOptions(
    overrides?: Partial<ReloadRoutesOptions>,
  ): ReloadRoutesOptions {
    const freshAdapter = createMockAdapter();
    const app = createMockApp();

    return {
      app,
      outDir,
      middlewareDefs: {} as MiddlewareRegistry,
      globalMiddlewares: [],
      resolveAdapter: vi.fn(
        async () => freshAdapter,
      ) as unknown as AdapterResolver,
      loadRoutes: vi.fn(async () => {}) as unknown as RoutesLoader,
      createErrorHandler: vi.fn(() =>
        createMockErrorMiddleware(),
      ) as unknown as ErrorHandlerFactory,
      createNotFoundHandler: vi.fn(() =>
        createMockNotFoundHandler(),
      ) as unknown as NotFoundHandlerFactory,
      ...overrides,
    };
  }

  it("应在提供 openapiConfig 时注册 /docs 和 /openapi.json 端点到新 adapter", async () => {
    const freshAdapter = createMockAdapter();
    const loadRoutesFn = vi.fn(async () => {});
    const options = createBugFixOptions({
      resolveAdapter: vi.fn(
        async () => freshAdapter,
      ) as unknown as AdapterResolver,
      loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      openapiConfig: {
        enabled: true,
        title: "Test API",
        version: "1.0.0",
      },
    });

    await reloadRoutes(options);

    // 验证 /openapi.json 和 /docs 端点被注册到新 adapter
    const registeredRoutes = freshAdapter._registeredRoutes;
    const registeredPaths = registeredRoutes.map(
      (r: { method: string; path: string }) => r.path,
    );
    expect(registeredPaths).toContain("/openapi.json");
    expect(registeredPaths).toContain("/docs");
  });

  it("应将 collector 传递给 loadRoutes（第 4 个参数）", async () => {
    const loadRoutesFn = vi.fn(
      async (
        _app: unknown,
        _dir: string,
        _opts: unknown,
        collector?: unknown,
      ) => {
        // noop — 仅捕获参数
        void collector;
      },
    );
    const options = createBugFixOptions({
      loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      openapiConfig: {
        enabled: true,
        title: "Test API",
      },
    });

    await reloadRoutes(options);

    // loadRoutes 应被调用，且第 4 个参数（collector）是非 null 的对象
    expect(loadRoutesFn).toHaveBeenCalledTimes(1);
    const callArgs = loadRoutesFn.mock.calls[0] as unknown[];
    // 参数 4 = collector（RouteMetadataCollector 实例）
    expect(callArgs[3]).toBeDefined();
    expect(callArgs[3]).not.toBeNull();
    expect(typeof (callArgs[3] as Record<string, unknown>).addRoute).toBe(
      "function",
    );
    expect(typeof (callArgs[3] as Record<string, unknown>).getRoutes).toBe(
      "function",
    );
  });

  it("应在 openapiConfig.enabled = false 时不注册文档端点", async () => {
    const freshAdapter = createMockAdapter();
    const options = createBugFixOptions({
      resolveAdapter: vi.fn(
        async () => freshAdapter,
      ) as unknown as AdapterResolver,
      openapiConfig: {
        enabled: false,
        title: "Test API",
      },
    });

    await reloadRoutes(options);

    const registeredRoutes = freshAdapter._registeredRoutes;
    const registeredPaths = registeredRoutes.map(
      (r: { method: string; path: string }) => r.path,
    );
    expect(registeredPaths).not.toContain("/openapi.json");
    expect(registeredPaths).not.toContain("/docs");
  });

  it("应在无 openapiConfig 时不注册文档端点（向后兼容）", async () => {
    const freshAdapter = createMockAdapter();
    const options = createBugFixOptions({
      resolveAdapter: vi.fn(
        async () => freshAdapter,
      ) as unknown as AdapterResolver,
      // 不提供 openapiConfig
    });

    await reloadRoutes(options);

    const registeredRoutes = freshAdapter._registeredRoutes;
    const registeredPaths = registeredRoutes.map(
      (r: { method: string; path: string }) => r.path,
    );
    expect(registeredPaths).not.toContain("/openapi.json");
    expect(registeredPaths).not.toContain("/docs");
  });

  it("应使用自定义的 docsPath 和 jsonPath", async () => {
    const freshAdapter = createMockAdapter();
    const options = createBugFixOptions({
      resolveAdapter: vi.fn(
        async () => freshAdapter,
      ) as unknown as AdapterResolver,
      openapiConfig: {
        enabled: true,
        title: "Test API",
        docsPath: "/api-docs",
        jsonPath: "/api/spec.json",
      },
    });

    await reloadRoutes(options);

    const registeredRoutes = freshAdapter._registeredRoutes;
    const registeredPaths = registeredRoutes.map(
      (r: { method: string; path: string }) => r.path,
    );
    expect(registeredPaths).toContain("/api/spec.json");
    expect(registeredPaths).toContain("/api-docs");
    // 默认路径不应存在
    expect(registeredPaths).not.toContain("/openapi.json");
    expect(registeredPaths).not.toContain("/docs");
  });

  it("应在 info 日志中输出 [openapi] 路由文档数量", async () => {
    const app = createMockApp();
    const freshAdapter = createMockAdapter();
    const options = createBugFixOptions({
      app: app as unknown as RouteReloaderApp,
      resolveAdapter: vi.fn(
        async () => freshAdapter,
      ) as unknown as AdapterResolver,
      openapiConfig: {
        enabled: true,
        title: "Test API",
      },
    });

    await reloadRoutes(options);

    // 检查是否输出了 [openapi] 相关日志
    const infoCalls = (app.logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const openapiLog = infoCalls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("[openapi]"),
    );
    expect(openapiLog).toBeDefined();
  });

  it("应在每次 reload 时创建新的 collector（不复用旧状态）", async () => {
    const collectorInstances: unknown[] = [];
    const loadRoutesFn = vi.fn(
      async (
        _app: unknown,
        _dir: string,
        _opts: unknown,
        collector?: unknown,
      ) => {
        collectorInstances.push(collector);
      },
    );

    const options = createBugFixOptions({
      loadRoutes: loadRoutesFn as unknown as RoutesLoader,
      openapiConfig: {
        enabled: true,
        title: "Test API",
      },
    });

    await reloadRoutes(options);
    await reloadRoutes(options);

    expect(collectorInstances).toHaveLength(2);
    // 两次 reload 使用的 collector 应该是不同的实例
    expect(collectorInstances[0]).not.toBe(collectorInstances[1]);
  });

  it("createSimpleRouteReloader 应传递 openapiConfig", async () => {
    const freshAdapter = createMockAdapter();
    const openapiConfig = {
      enabled: true,
      title: "Simple Reloader API",
    };

    const reloader = createSimpleRouteReloader({
      app: createMockApp(),
      resolveAdapter: vi.fn(
        async () => freshAdapter,
      ) as unknown as AdapterResolver,
      loadRoutes: vi.fn(async () => {}) as unknown as RoutesLoader,
      createErrorHandler: vi.fn(() =>
        createMockErrorMiddleware(),
      ) as unknown as ErrorHandlerFactory,
      createNotFoundHandler: vi.fn(() =>
        createMockNotFoundHandler(),
      ) as unknown as NotFoundHandlerFactory,
      middlewareDefs: {} as MiddlewareRegistry,
      globalMiddlewares: [],
      openapiConfig,
    });

    await reloader(outDir);

    // 验证文档端点被注册
    const registeredPaths = freshAdapter._registeredRoutes.map(
      (r: { method: string; path: string }) => r.path,
    );
    expect(registeredPaths).toContain("/openapi.json");
    expect(registeredPaths).toContain("/docs");
  });
});

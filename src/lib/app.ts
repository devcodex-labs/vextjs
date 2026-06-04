import { createLogger } from "./logger.js";
import { createDefaultThrow } from "./default-throw.js";
import { schemaAdapter } from "./schema-adapter.js";
import type { DslDefinition } from "./schema-adapter.js";
import type { VextAdapter } from "../types/adapter.js";
import type {
  VextApp,
  VextConfig,
  VextServices,
  VextValidator,
  VextRateLimiter,
  VextLogger,
} from "../types/app.js";
import type { VextFetch } from "./fetch.js";
import type { VextMiddleware } from "../types/middleware.js";
import type { VextServerHandle } from "../types/adapter.js";
import { createResponseCache } from "response-cache-kit";
import { resolveVextResponseCacheOptions } from "./response-cache-config.js";

/**
 * 框架内部方法接口（不暴露给用户，仅 bootstrap 使用）
 *
 * 通过 createApp() 返回的 { app, internals } 中的 internals 访问。
 * 这些方法控制框架生命周期的关键节点，用户代码不应直接调用。
 */
export interface AppInternals {
  /**
   * 锁定 app.use()
   *
   * 在步骤⑤ router-loader 完成后由 bootstrap 显式调用。
   * 锁定后再调用 app.use() 将抛出错误，
   * 确保路由注册后不会有新的全局中间件插入导致行为不一致。
   */
  lockUse(): void;

  /**
   * 执行所有 onReady 钩子
   *
   * 在步骤⑧ HTTP 监听后由 bootstrap 调用。
   * 执行完毕后清空 hooks 数组，释放闭包引用。
   */
  runReady(): Promise<void>;

  /**
   * 获取全局中间件列表
   *
   * router-loader 组装路由链时使用，
   * 将全局中间件拼接在路由级中间件之前。
   */
  getGlobalMiddlewares(): VextMiddleware[];

  /**
   * 优雅关闭
   *
   * 流程：
   *   1. 停止接受新请求（serverHandle.close()）
   *   2. 等待飞行中请求完成（config.shutdown.timeout 超时保护）
   *   3. 按 LIFO 顺序执行所有 onClose 钩子
   *   4. process.exit(0)（测试模式 或 skipExit 时跳过）
   *
   * @param serverHandle VextServerHandle（可选，由 bootstrap 传入）
   * @param options.skipExit 为 true 时跳过 process.exit()，仅执行资源清理。
   *        用于 bootstrap catch 块中：启动失败时需要清理资源，
   *        但不应 process.exit(0)（否则会吞掉启动错误 + 返回错误的退出码）。
   */
  shutdown(
    serverHandle?: VextServerHandle,
    options?: { skipExit?: boolean },
  ): Promise<void>;

  /**
   * 获取用户自定义速率限制器（如果通过 app.setRateLimiter() 设置）
   *
   * bootstrap 将此 getter 传递给 createRateLimitMiddleware 工厂，
   * 使中间件在运行时动态读取最新的 limiter 实例。
   */
  getRateLimiter(): VextRateLimiter | null;

  /**
   * 获取用户自定义 requestId 生成器（如果通过 app.setRequestIdGenerator() 设置）
   *
   * bootstrap 将此 getter 传递给 createRequestIdMiddleware 工厂，
   * 使中间件在运行时动态读取最新的生成器。
   */
  getRequestIdGenerator(): (() => string) | null;
}

/**
 * createApp — 框架应用工厂函数
 *
 * 创建 VextApp 实例和框架内部方法集合。
 * 是整个 vext 框架的核心入口点。
 *
 * 返回 { app, internals }：
 *   - app: 用户可见的应用实例（VextApp 接口）
 *   - internals: 框架内部方法（仅 bootstrap 使用）
 *
 * 初始化流程：
 *   1. 创建 app 对象，挂载 logger / throw / config / services 等内置模块
 *   2. 通过 resolveAdapter 解析 config.adapter 创建底层适配器实例
 *   3. 返回 { app, internals }
 *
 * 后续由 bootstrap 编排完整的启动流程（plugin → middleware → service → route → listen）。
 *
 * Phase 1 升级说明（相对 Phase 0）：
 *   - logger: Phase 0 的 console 封装 → pino 封装（createLogger），支持 pretty/JSON 双模式 + requestId 自动注入
 *   - throw:  Phase 0 的内联简化实现 → createDefaultThrow()，通过 schema-adapter 防腐层联动 I18nError
 *   - validator: Phase 0 的 pass-through → schema-adapter 封装的 compile + validate
 *
 * @param config 框架运行时配置（已经过 config-loader 三层合并 + deepFreeze）
 * @returns { app, internals }
 */
export function createApp(config: VextConfig): {
  app: VextApp;
  internals: AppInternals;
} {
  const closeHooks: Array<() => Promise<void> | void> = [];
  const readyHooks: Array<() => Promise<void> | void> = [];
  const globalMiddlewares: VextMiddleware[] = [];

  let _validator: VextValidator = createSchemaAdapterValidator();
  let _rateLimiter: VextRateLimiter | null = null;
  let _requestIdGenerator: (() => string) | null = null;
  let _locked = false; // 路由注册完成后锁定（步骤⑤之后），禁止 app.use()
  let _shuttingDown = false; // 防止重复触发 shutdown

  // ── 创建 logger（pino 封装，Phase 1 升级）──────────────────
  //
  // 替换 Phase 0 的 createSimpleLogger（console 封装）。
  // pino 提供：
  //   - 结构化 JSON 日志（生产环境）
  //   - pretty 彩色输出（开发环境）
  //   - mixin hook 自动注入 requestId（从 AsyncLocalStorage 读取）
  //   - child logger（携带 service 名称等额外字段）
  //
  const logger = createLogger(config.logger, {
    requestContextEnabled: config.requestContext?.enabled !== false,
  });

  // ── 创建 defaultThrow（I18nError 联动，Phase 1 升级）────────
  //
  // 替换 Phase 0 的内联简化实现。
  // 通过 schema-adapter 防腐层访问 schema-dsl I18nError：
  //   - message 作为 i18n key 查找已注册的语言包
  //   - 从 requestContext（AsyncLocalStorage）获取请求级 locale（并发安全）
  //   - 翻译后的 message + 业务码 封装为 HttpError 抛出
  //
  const defaultThrow = createDefaultThrow();

  // ── 创建响应缓存核心（response-cache-kit）────────────────
  //
  // 在 createApp 阶段初始化（与 app.logger / app.throw 同模式），
  // config 在 createApp 参数中已可用，无需等到 bootstrap 阶段。
  //
  const responseCache = createResponseCache({
    ...resolveVextResponseCacheOptions(config.cache),
  });

  // ── 创建 app 对象 ──────────────────────────────────────────

  const app: VextApp = {
    // ── 内置模块（插件可覆盖）──────────────────────────────
    logger,
    throw: defaultThrow,

    // ── 运行时数据（不可覆盖）─────────────────────────────
    config,
    services: {} as VextServices,
    adapter: null as unknown as VextAdapter, // 稍后由 resolveAdapter 赋值

    // ── HTTP 方法占位（defineRoutes 的 collector 才真正使用）──
    // 这些方法在 app 上定义为占位，实际路由注册通过 defineRoutes 的 collector 完成。
    // 直接在 app 上调用会抛出错误，提示用户使用 defineRoutes。
    get: createRouteMethodPlaceholder("GET"),
    post: createRouteMethodPlaceholder("POST"),
    put: createRouteMethodPlaceholder("PUT"),
    patch: createRouteMethodPlaceholder("PATCH"),
    delete: createRouteMethodPlaceholder("DELETE"),
    head: createRouteMethodPlaceholder("HEAD"),
    options: createRouteMethodPlaceholder("OPTIONS"),

    // ── 框架扩展 API ──────────────────────────────────────
    extend<K extends string, V>(key: K, value: V) {
      if (key in app) {
        throw new Error(
          `[vextjs] app.extend("${key}") cannot override an existing app property. ` +
            "Use a different extension name.",
        );
      }
      (app as Record<string, unknown>)[key] = value;
    },

    setValidator(v: VextValidator) {
      _validator = v;
    },

    getValidator() {
      return _validator;
    },

    setThrow(wrapper: (original: VextApp["throw"]) => VextApp["throw"]) {
      app.throw = wrapper(app.throw.bind(app));
    },

    setLogger(wrapper: (original: VextLogger) => VextLogger) {
      app.logger = wrapper(app.logger);
    },

    setRateLimiter(limiter: VextRateLimiter) {
      _rateLimiter = limiter;
      (app as Record<string, unknown>)._rateLimiterOverridden = true;
    },

    setRequestIdGenerator(generate: () => string) {
      _requestIdGenerator = generate;
    },

    onClose(handler: () => Promise<void> | void) {
      closeHooks.push(handler);
    },

    onReady(handler: () => Promise<void> | void) {
      readyHooks.push(handler);
    },

    use(middleware: VextMiddleware) {
      if (_locked) {
        throw new Error(
          "[vextjs] app.use() is locked after route registration. " +
            "Global middleware must be registered in plugin setup().",
        );
      }
      globalMiddlewares.push(middleware);
    },

    // ── 缓存管理 API（路由级响应缓存）───────────────────────
    cache: {
      async invalidate(tag: string) {
        await responseCache.invalidateTag(tag);
      },
      async delete(key: string) {
        await responseCache.delete(key);
      },
      async clear() {
        await responseCache.clear();
      },
      stats() {
        const stats = responseCache.stats();
        return {
          ...stats,
          entries: stats.entries ?? 0,
          hits: stats.hits ?? 0,
          misses: stats.misses ?? 0,
          hitRate: stats.hitRate ?? 0,
        };
      },
      _getResponseCache() {
        return responseCache;
      },
    },

    // ── fetch 占位（由 bootstrap 在步骤 ④+ 覆盖为 createVextFetch 实例）──
    //
    // 在 createApp 阶段 fetch 尚未初始化（需要 config.fetch + requestId 配置）。
    // 提供占位实现确保类型为非可选，bootstrap 会在 loadRoutes 之前赋值真实实现。
    // 若路由 handler 在 bootstrap 赋值前调用 app.fetch，会收到明确的错误提示。
    fetch: Object.assign(
      async (_input: unknown, _init?: unknown): Promise<Response> => {
        throw new Error(
          "[vextjs] app.fetch is not initialized yet. " +
            "It is available after bootstrap completes step ④+.",
        );
      },
      {
        get: async () => {
          throw new Error("[vextjs] app.fetch not initialized");
        },
        post: async () => {
          throw new Error("[vextjs] app.fetch not initialized");
        },
        put: async () => {
          throw new Error("[vextjs] app.fetch not initialized");
        },
        patch: async () => {
          throw new Error("[vextjs] app.fetch not initialized");
        },
        delete: async () => {
          throw new Error("[vextjs] app.fetch not initialized");
        },
        create: () => {
          throw new Error("[vextjs] app.fetch not initialized");
        },
        proxy: new Proxy(
          async () => {
            throw new Error("[vextjs] app.fetch.proxy not initialized");
          },
          {
            get(_target, prop) {
              if (prop === "then") return undefined;
              return async () => {
                throw new Error("[vextjs] app.fetch.proxy not initialized");
              };
            },
          },
        ),
      },
    ) as unknown as VextFetch,
  };

  // ── adapter 延迟赋值 ──────────────────────────────────────
  // adapter 不再在 createApp 中同步解析，而是由 bootstrap / devBootstrap / createTestApp
  // 在 createApp 之后异步调用 resolveAdapter 并赋值到 app.adapter。
  // 这样 adapter-resolver.ts 可以使用动态 import() 按需加载框架依赖。

  // ── 框架内部方法（通过 internals 返回，不暴露在 VextApp 接口类型里）──

  const internals: AppInternals = {
    lockUse() {
      _locked = true;
    },

    async runReady() {
      for (const h of readyHooks) {
        await h();
      }
      // 执行完后清空，释放 hooks 持有的闭包引用
      readyHooks.length = 0;
    },

    getGlobalMiddlewares() {
      return globalMiddlewares;
    },

    getRateLimiter() {
      return _rateLimiter;
    },

    getRequestIdGenerator() {
      return _requestIdGenerator;
    },

    async shutdown(
      serverHandle?: VextServerHandle,
      options?: { skipExit?: boolean },
    ) {
      // guard：防止 SIGTERM + SIGINT 重复触发
      if (_shuttingDown) return;
      _shuttingDown = true;

      app.logger.info("[vextjs] starting graceful shutdown...");

      const shutdownTimeout = (config.shutdown?.timeout ?? 10) * 1000;

      // ── 步骤 1：停止接受新请求 + 等待飞行中请求完成 ──
      if (serverHandle) {
        await Promise.race([
          serverHandle.close(),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              app.logger.warn(
                "[vextjs] in-flight request wait timed out, forcing shutdown",
              );
              resolve();
            }, shutdownTimeout),
          ),
        ]);
      }

      // ── 步骤 2：按 LIFO 顺序执行 onClose 钩子 ──
      for (const h of [...closeHooks].reverse()) {
        try {
          await h();
        } catch (err) {
          app.logger.error(
            { error: (err as Error).message },
            "[vextjs] onClose hook failed",
          );
        }
      }
      // 执行完后清空，释放 hooks 持有的资源引用
      closeHooks.length = 0;

      // ── 步骤 3：关闭响应缓存运行时资源 ──
      try {
        await responseCache.close?.();
      } catch (err) {
        app.logger.error(
          { error: (err as Error).message },
          "[vextjs] response cache close failed",
        );
      }

      // ── 步骤 4：退出进程 ──
      //
      // 跳过 process.exit 的场景：
      //   - _testMode: 测试模式，由 createTestApp 控制生命周期
      //   - skipExit:  bootstrap catch 块中调用，仅需清理资源，
      //                不应 exit（否则吞掉启动错误 + 退出码 0 掩盖失败）
      //
      if (!config._testMode && !options?.skipExit) {
        process.exit(0);
      }
    },
  };

  return { app, internals };
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * 创建 HTTP 方法占位函数
 *
 * 直接在 app 上调用 app.get/post/... 会抛出错误，
 * 提示用户应通过 defineRoutes 注册路由。
 * 实际路由收集由 defineRoutes 内部的 collector 完成。
 */
function createRouteMethodPlaceholder(
  method: string,
): (...args: unknown[]) => void {
  return () => {
    throw new Error(
      `[vextjs] app.${method.toLowerCase()}() cannot be called directly on the app instance. ` +
        `Use defineRoutes(app => { app.${method.toLowerCase()}(...) }) in route files.`,
    );
  };
}

/**
 * 创建基于 schema-adapter 防腐层的校验引擎（Phase 1 升级）
 *
 * 替换 Phase 0 的 pass-through 校验器。
 * 通过 schemaAdapter 封装 schema-dsl 的 compile + validate 流程：
 *   1. compile(schema) → 将 DSL 定义编译为 JSON Schema
 *   2. 返回的校验函数调用 schemaAdapter.validate() 执行同步校验
 *
 * 插件可通过 app.setValidator() 替换为 Zod / Yup 等第三方校验库。
 */
function createSchemaAdapterValidator(): VextValidator {
  return {
    compile(schema: Record<string, unknown>) {
      // 将 DSL 定义编译为 JSON Schema（通过防腐层）
      const compiledSchema = schemaAdapter.compile(
        schema as Record<string, DslDefinition>,
      );

      // 返回校验函数
      return (data: unknown) => {
        const result = schemaAdapter.validate(compiledSchema, data);

        return {
          valid: result.valid,
          data: result.valid ? result.data : undefined,
          errors: result.valid
            ? undefined
            : (result.errors ?? []).map((e) => ({
                field: e.field ?? e.path ?? "",
                message: e.message ?? "Validation failed",
              })),
        };
      };
    },
  };
}

/**
 * 默认配置值
 *
 * 由 config-loader 在三层合并时使用。
 * 也可用于 createApp 的快速启动（跳过 config-loader 直接传入默认配置）。
 */
export const DEFAULT_CONFIG: VextConfig = {
  port: 3000,
  host: "0.0.0.0",
  adapter: "native",
  trustProxy: false,
  middlewares: [],
  cors: {
    enabled: true,
    origins: ["*"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    headers: ["Content-Type", "Authorization", "X-Request-Id"],
    credentials: false,
  },
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60,
    message: "Too Many Requests",
    keyBy: "ip",
  },
  requestId: {
    enabled: true,
    header: "x-request-id",
    responseHeader: "x-request-id",
  },
  logger: {
    level: "info",
  },
  shutdown: {
    timeout: 10,
  },
  response: {
    hideInternalErrors: true,
    wrap: true,
  },
  bodyParser: {
    enabled: true,
    maxBodySize: "1mb",
  },
  accessLog: {
    enabled: true,
    level: "info",
    skipPaths: [],
  },
  openapi: {
    enabled: false,
  },
  requestContext: {
    enabled: true,
  },
};

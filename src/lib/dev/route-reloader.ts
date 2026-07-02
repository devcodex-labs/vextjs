import path from "node:path";
import { existsSync } from "node:fs";
import { RouteMetadataCollector } from "../openapi/collector.js";
import {
  OpenAPIGenerator,
  createDeprecatedRouteDocsTagsWarning,
} from "../openapi/generator.js";
import { generateOpenAPIDocumentWithHooks } from "../openapi/hook-lifecycle.js";
import { registerDocEndpoints } from "../openapi/doc-endpoints.js";
import type { OpenAPIConfig } from "../openapi/types.js";
import { createRequestHookMiddleware } from "../middlewares/request-hook.js";
import type { VextInternalHooks } from "../../types/hooks.js";
import { writeDevRouteManifest } from "./route-manifest.js";
import { VEXT_FRONTEND_DEV_EVENT_PATH } from "../../frontend/runtime/dev-events.js";

/**
 * route-reloader.ts — 路由重载（Fresh Adapter 策略）（Phase 2B）
 *
 * 每次 soft reload 创建全新的 adapter 实例，走与生产环境完全一致的
 * 路由注册 + 中间件注册 + 错误处理注册 + buildHandler 流程。
 *
 * 为什么需要 Fresh Adapter：
 *
 *   | 问题                                    | 影响                                              |
 *   |-----------------------------------------|---------------------------------------------------|
 *   | hot reload 用 Vext 自建 router，prod 用  | 路由匹配行为不一致（优先级、通配符、参数提取）      |
 *   | Hono trie router                         |                                                   |
 *   | 绕过 adapter 层直接构建 handler           | Adapter 注入的逻辑丢失（VextReq/Res 转换等）      |
 *   | Hono 不支持 clearRoutes/removeRoute       | 无法在同一 Hono 实例上增量更新                     |
 *
 * 解决方案：每次 soft reload 创建全新的 adapter 实例。
 * 旧 adapter 实例由 GC 自动回收。
 *
 * 核心流程：
 *
 *   1. resolveAdapter(config, app) → 创建全新 adapter 实例
 *   2. 注册内置中间件（requestId / cors / body-parser / rate-limit / response-wrapper）
 *   3. 注册插件全局中间件
 *   4. 注册路由（从 outDir/routes/ 重新加载路由文件并注册到新 adapter）
 *   5. 注册错误处理 + 404 兜底
 *   6. adapter.buildHandler() → 返回新的 requestHandler
 *
 * 安全保证：
 *
 *   - 新 adapter 走与生产环境完全一致的代码路径
 *   - 路由注册表是干净的（全新实例），无需清除旧路由
 *   - buildHandler() 返回的 handler 与 listen() 内部使用的完全一致
 *   - 如果重载过程中任何步骤失败，不调用 HotSwappableHandler.swap()，
 *     旧 handler 通过闭包继续服务
 *
 * @module lib/dev/route-reloader
 * @see 11b-soft-reload.md §5（路由重载 — Fresh Adapter 策略）
 * @see 11e-edge-cases.md §1（Reload 失败回退）
 * @see 08-adapter.md（VextAdapter 接口）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2b
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ── 类型定义 ────────────────────────────────────────────────

/**
 * Node.js HTTP 请求处理函数类型
 *
 * 与 http.createServer() 的回调签名一致。
 * adapter.buildHandler() 返回此类型。
 */
export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

/**
 * 最小化的 VextMiddleware 类型
 *
 * 与框架的 VextMiddleware 签名兼容。
 * 使用局部类型避免循环依赖。
 */
export type RouteReloaderMiddleware = (
  ctx: unknown,
  next: () => Promise<void>,
) => unknown | Promise<unknown>;

/**
 * 最小化的 VextErrorMiddleware 类型
 */
export type RouteReloaderErrorMiddleware = (
  error: Error,
  ctx: unknown,
  next: () => Promise<void>,
) => unknown | Promise<unknown>;

/**
 * 最小化的 VextAdapter 接口（仅包含 route-reloader 需要的方法）
 */
export interface RouteReloaderAdapter {
  readonly name: string;
  registerMiddleware(middleware: RouteReloaderMiddleware): void;
  registerRoute(
    method: string,
    path: string,
    chain: RouteReloaderMiddleware[],
  ): void;
  registerErrorHandler(handler: RouteReloaderErrorMiddleware): void;
  registerNotFound(handler: RouteReloaderMiddleware): void;
  buildHandler(): RequestHandler;
}

/**
 * 最小化的 VextApp 接口（仅包含 route-reloader 需要的字段）
 */
export interface RouteReloaderApp {
  config: Record<string, unknown>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  adapter: RouteReloaderAdapter;
  services: Record<string, unknown>;
  hooks?: VextInternalHooks;
  cache?: {
    clear(): Promise<void>;
  };
}

/**
 * 中间件注册表条目
 *
 * 与 middleware-loader 的 MiddlewareRegistryEntry 兼容。
 */
export interface MiddlewareRegistryEntry {
  handler:
    | RouteReloaderMiddleware
    | ((options?: Record<string, unknown>) => RouteReloaderMiddleware);
  defaultOptions: Record<string, unknown> | undefined;
  kind: "middleware" | "factory";
}

/**
 * 中间件注册表
 *
 * name → MiddlewareRegistryEntry 的映射。
 */
export type MiddlewareRegistry = Record<string, MiddlewareRegistryEntry>;

/**
 * Adapter 解析函数类型
 *
 * 与 adapter-resolver.ts 的 resolveAdapter 签名兼容。
 * v2.4 变更：返回 Promise（resolveAdapter 改为异步动态 import）。
 */
export type AdapterResolver = (
  config: Record<string, unknown>,
  app: RouteReloaderApp,
) => Promise<RouteReloaderAdapter>;

/**
 * 路由加载函数类型
 *
 * 与 router-loader.ts 的 loadRoutes 签名兼容。
 */
export type RoutesLoader = (
  app: RouteReloaderApp,
  routesDir: string,
  options: {
    middlewareDefs: MiddlewareRegistry | Map<string, RouteReloaderMiddleware>;
    globalMiddlewares: RouteReloaderMiddleware[];
  },
  collector?: RouteMetadataCollector | null,
) => Promise<void>;

/**
 * 错误处理器工厂函数类型
 */
export type ErrorHandlerFactory = (
  config: Record<string, unknown>,
) => RouteReloaderErrorMiddleware;

/**
 * 404 处理器工厂函数类型
 */
export type NotFoundHandlerFactory = () => RouteReloaderMiddleware;

/**
 * 内置中间件创建器集合
 *
 * 用于在新 adapter 上注册所有内置中间件，
 * 保持与生产环境 bootstrap 完全一致的中间件栈。
 */
export interface BuiltinMiddlewareCreators {
  /**
   * 创建 requestId 中间件
   *
   * 需要从 config 中读取 requestId 配置，
   * 以及从 internals 获取 requestId 生成器。
   */
  createRequestIdMiddleware?: (
    config: Record<string, unknown>,
  ) => RouteReloaderMiddleware;

  /**
   * 创建 cors 中间件
   */
  createCorsMiddleware?: (
    config: Record<string, unknown>,
  ) => RouteReloaderMiddleware;

  /**
   * 创建 body-parser 中间件
   */
  createBodyParserMiddleware?: (
    config: Record<string, unknown>,
  ) => RouteReloaderMiddleware;

  /**
   * 创建 rate-limit 中间件
   */
  createRateLimitMiddleware?: (
    config: Record<string, unknown>,
  ) => RouteReloaderMiddleware;

  /**
   * response-wrapper 中间件（已创建好的实例）
   */
  responseWrapper?: RouteReloaderMiddleware;

  /**
   * 创建 frontend render 中间件
   */
  createFrontendRenderMiddleware?: (
    config: Record<string, unknown>,
  ) => RouteReloaderMiddleware;

  /**
   * frontend dev event SSE 处理器
   *
   * dev 模式前端 bundle 会连接 /__vext/dev/events。
   * soft reload 创建 fresh adapter 后也必须把它注册为内部 route。
   * 不能只注册为 middleware，因为 Native adapter 的全局中间件只在命中
   * 业务 route 后进入 chain，不处理未匹配路径。
   */
  frontendDevEvents?: RouteReloaderMiddleware;

  /**
   * 创建 access-log 中间件
   *
   * 需要从 config 中读取 accessLog 配置，
   * 以及使用 app.logger 输出日志。
   */
  createAccessLogMiddleware?: (
    config: Record<string, unknown>,
  ) => RouteReloaderMiddleware;
}

/**
 * 路由重载选项
 */
export interface ReloadRoutesOptions {
  /** VextApp 实例 */
  app: RouteReloaderApp;

  /** 编译产物目录（.vext/dev/ 的绝对路径） */
  outDir: string;

  /** 中间件注册表（从 middleware-loader 加载的） */
  middlewareDefs: MiddlewareRegistry | Map<string, RouteReloaderMiddleware>;

  /** 插件注册的全局中间件列表 */
  globalMiddlewares: RouteReloaderMiddleware[];

  /**
   * Adapter 解析函数
   *
   * 用于创建全新的 adapter 实例。
   * 通常传入 adapter-resolver.ts 的 resolveAdapter 函数。
   */
  resolveAdapter: AdapterResolver;

  /**
   * 路由加载函数
   *
   * 用于从 routesDir 扫描并注册所有路由到新 adapter。
   * 通常传入 router-loader.ts 的 loadRoutes 函数。
   */
  loadRoutes: RoutesLoader;

  /**
   * 错误处理器工厂
   *
   * 用于创建错误处理中间件。
   * 通常传入 error-handler.ts 的 createErrorHandler 函数。
   */
  createErrorHandler: ErrorHandlerFactory;

  /**
   * 404 处理器工厂
   *
   * 用于创建 404 兜底中间件。
   * 通常传入 error-handler.ts 或 dev-bootstrap.ts 的 createNotFoundHandler 函数。
   */
  createNotFoundHandler: NotFoundHandlerFactory;

  /**
   * 内置中间件创建器（可选）
   *
   * 如果提供，将在新 adapter 上注册所有内置中间件。
   * 如果不提供，假设内置中间件已包含在 globalMiddlewares 中，
   * 或者调用方自行处理内置中间件注册。
   */
  builtinMiddlewares?: BuiltinMiddlewareCreators;

  /**
   * OpenAPI 配置（可选）
   *
   * 如果提供且 enabled 不为 false，在路由重载后自动：
   *   1. 创建 RouteMetadataCollector 收集路由元信息
   *   2. 使用 OpenAPIGenerator 生成新的 OpenAPI spec
   *   3. 在新 adapter 上注册 /docs 和 /openapi.json 端点
   *
   * 确保热重载后文档端点仍然可用（修复 BUG-022）。
   */
  openapiConfig?: Record<string, unknown>;
}

/**
 * 路由重载结果
 */
export interface RouteReloadResult {
  /** 新的请求处理函数（供 HotSwappableHandler.swap 使用） */
  handler: RequestHandler;

  /** 新创建的 adapter 实例 */
  adapter: RouteReloaderAdapter;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * reloadRoutes — 重载路由并构建新的 requestHandler
 *
 * 核心策略：创建全新的 adapter 实例
 *   - Hono 等框架不支持清除路由 → 新建实例解决
 *   - 新 adapter 走与生产环境完全一致的注册 + 构建流程
 *   - 旧 adapter 实例由 GC 自动回收
 *
 * 流程：
 *   1. 创建全新的 adapter 实例（不是复用旧的！）
 *   2. 注册内置中间件（如果提供了 builtinMiddlewares）
 *   3. 注册插件全局中间件
 *   4. 注册错误处理 + 404 兜底
 *   5. 加载路由文件并注册到新 adapter
 *   6. adapter.buildHandler() → 返回新 handler
 *
 * @param options 重载选项
 * @returns 路由重载结果（新 handler + 新 adapter）
 * @throws 任何步骤失败时向上抛出（调用方不应调用 swap）
 */
export async function reloadRoutes(
  options: ReloadRoutesOptions,
): Promise<RouteReloadResult> {
  const {
    app,
    outDir,
    middlewareDefs,
    globalMiddlewares,
    resolveAdapter: resolveAdapterFn,
    loadRoutes: loadRoutesFn,
    createErrorHandler: createErrorHandlerFn,
    createNotFoundHandler: createNotFoundHandlerFn,
    builtinMiddlewares,
  } = options;

  const routesDir = path.join(outDir, "routes");

  // ── 1. 创建全新的 adapter 实例 ────────────────────────
  //
  // 这样路由注册表是干净的，且与生产环境走同一条代码路径。
  // resolveAdapter 根据 config.adapter 配置（默认 'native'）
  // 创建对应的 adapter 实例（异步动态 import 按需加载）。
  //
  const freshAdapter = await resolveAdapterFn(
    app.config as Record<string, unknown>,
    app,
  );

  app.logger.debug(`[hot-reload] creating fresh adapter: ${freshAdapter.name}`);

  // ── 2. 注册内置中间件（如果提供）─────────────────────
  //
  // 与 dev-bootstrap.ts 中的中间件注册顺序和条件守卫保持一致：
  //   requestId → cors → body-parser → rate-limit → response-wrapper
  //   → frontend render → frontend dev events route → access-log
  //
  // 注意：builtinMwCreators 中对应 creator 为 undefined 时表示该中间件被禁用，
  // route-reloader 通过 if 检查自动跳过，行为与 dev-bootstrap 条件守卫完全一致。
  //
  if (builtinMiddlewares) {
    if (builtinMiddlewares.createRequestIdMiddleware) {
      freshAdapter.registerMiddleware(
        builtinMiddlewares.createRequestIdMiddleware(
          app.config as Record<string, unknown>,
        ),
      );
    }
    if (app.hooks) {
      freshAdapter.registerMiddleware(
        createRequestHookMiddleware(
          app.hooks,
        ) as unknown as RouteReloaderMiddleware,
      );
    }
    if (builtinMiddlewares.createCorsMiddleware) {
      freshAdapter.registerMiddleware(
        builtinMiddlewares.createCorsMiddleware(
          app.config as Record<string, unknown>,
        ),
      );
    }
    if (builtinMiddlewares.createBodyParserMiddleware) {
      freshAdapter.registerMiddleware(
        builtinMiddlewares.createBodyParserMiddleware(
          app.config as Record<string, unknown>,
        ),
      );
    }
    if (builtinMiddlewares.createRateLimitMiddleware) {
      freshAdapter.registerMiddleware(
        builtinMiddlewares.createRateLimitMiddleware(
          app.config as Record<string, unknown>,
        ),
      );
    }
    if (builtinMiddlewares.responseWrapper) {
      freshAdapter.registerMiddleware(builtinMiddlewares.responseWrapper);
    }
    if (builtinMiddlewares.createFrontendRenderMiddleware) {
      freshAdapter.registerMiddleware(
        builtinMiddlewares.createFrontendRenderMiddleware(
          app.config as Record<string, unknown>,
        ),
      );
    }
    if (builtinMiddlewares.frontendDevEvents) {
      freshAdapter.registerRoute("GET", VEXT_FRONTEND_DEV_EVENT_PATH, [
        builtinMiddlewares.frontendDevEvents,
      ]);
    }
    if (builtinMiddlewares.createAccessLogMiddleware) {
      freshAdapter.registerMiddleware(
        builtinMiddlewares.createAccessLogMiddleware(
          app.config as Record<string, unknown>,
        ),
      );
    }
  }

  // ── 3. 注册插件全局中间件 ─────────────────────────────
  //
  // 来自 plugins 的全局中间件在 soft reload 时不变
  // （plugins 属于不可重载阶段，每次 cold restart 才会重新加载）。
  //
  for (const mw of globalMiddlewares) {
    freshAdapter.registerMiddleware(mw);
  }

  // ── 4. 注册错误处理 + 404 兜底 ────────────────────────
  //
  // v2.2: 统一使用 registerErrorHandler（与 08-adapter.md 接口一致）
  //
  const responseConfig = (app.config as Record<string, unknown>).response ?? {};
  freshAdapter.registerErrorHandler(
    createErrorHandlerFn(responseConfig as Record<string, unknown>),
  );
  freshAdapter.registerNotFound(createNotFoundHandlerFn());

  // ── 5. 临时替换 app.adapter 以便 loadRoutes 使用 ──────
  //
  // loadRoutes 内部通过 app.adapter.registerRoute() 注册路由。
  // 我们需要将 app.adapter 临时替换为新的 freshAdapter，
  // 让 loadRoutes 将路由注册到新实例上。
  //
  // 重载完成后恢复原始 adapter 引用（失败时也恢复）。
  //
  const originalAdapter = app.adapter;

  try {
    app.adapter = freshAdapter;

    // ── 6. 重新加载路由文件并注册到新 adapter ────────────
    //
    // require.cache 已被清除（cache-invalidator），
    // loadRoutes 内部的 dynamic import 或 require 会从
    // .vext/dev/routes/ 读取新编译的 .js。
    //
    // loadRoutes 走与 bootstrap 完全一致的路径：
    //   scanRouteFiles → filePathToPrefix → loadRouteFile →
    //   registerRouteDefinition（含中间件解析 + validate 构建）
    //
    // 🆕 BUG-022 修复：如果 openapiConfig 存在，创建 collector
    // 传入 loadRoutes，在路由加载完成后重新生成 OpenAPI spec
    // 并注册文档端点到新 adapter。
    //
    const openapiCfg = options.openapiConfig;
    const openapiEnabled =
      openapiCfg != null &&
      (openapiCfg as Record<string, unknown>).enabled !== false;
    const collector = new RouteMetadataCollector();

    if (existsSync(routesDir)) {
      await loadRoutesFn(
        app,
        routesDir,
        {
          middlewareDefs,
          globalMiddlewares,
        },
        collector,
      );
    } else {
      app.logger.warn(
        "[hot-reload] routes directory not found, no routes registered",
      );
    }

    // ── 6b. 🆕 重新生成 OpenAPI spec + 注册文档端点 ─────
    //
    // BUG-022 修复：热重载创建全新 adapter 实例后，
    // 原有的 /docs 和 /openapi.json 端点不在新 adapter 上，
    // 必须重新生成 spec 并注册端点。
    //
    const routes = collector.getRoutes();
    await writeDevRouteManifest(projectRootFromOutDir(outDir), routes).catch(
      (error: unknown) => {
        app.logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "[hot-reload] failed to write route manifest",
        );
      },
    );

    if (openapiEnabled) {
      const projectRoot = projectRootFromOutDir(outDir);
      const generator = new OpenAPIGenerator({
        title: (openapiCfg as Record<string, unknown>)?.title as
          | string
          | undefined,
        description: (openapiCfg as Record<string, unknown>)?.description as
          | string
          | undefined,
        version: (openapiCfg as Record<string, unknown>)?.version as
          | string
          | undefined,
        servers: (openapiCfg as Record<string, unknown>)?.servers as
          | Array<{ url: string; description?: string }>
          | undefined,
        tags: (openapiCfg as Record<string, unknown>)?.tags as
          | Array<{ name: string; description?: string }>
          | undefined,
        securitySchemes: (openapiCfg as Record<string, unknown>)
          ?.securitySchemes as Record<
          string,
          {
            type: "http" | "apiKey" | "oauth2" | "openIdConnect";
            scheme?: string;
            bearerFormat?: string;
            description?: string;
          }
        >,
        guardSecurityMap: (openapiCfg as Record<string, unknown>)
          ?.guardSecurityMap as Record<string, string> | undefined,
        contact: (openapiCfg as Record<string, unknown>)?.contact as
          | { name?: string; email?: string; url?: string }
          | undefined,
        license: (openapiCfg as Record<string, unknown>)?.license as
          | { name: string; url?: string }
          | undefined,
        tagGroups: (openapiCfg as Record<string, unknown>)?.tagGroups as
          | Array<{ name: string; tags: string[] }>
          | undefined,
      } as OpenAPIConfig);

      const docsTagsWarning = createDeprecatedRouteDocsTagsWarning(routes);
      if (docsTagsWarning) app.logger.warn(docsTagsWarning);

      const specProvider = createCachedOpenApiSpecProvider(() =>
        app.hooks
          ? generateOpenAPIDocumentWithHooks(app as any, generator, routes)
          : generator.generate(routes),
      );

      registerDocEndpoints(app as any, specProvider, {
        specPath:
          ((openapiCfg as Record<string, unknown>)?.jsonPath as string) ??
          "/openapi.json",
        specPublicPath: (openapiCfg as Record<string, unknown>)
          ?.jsonPublicPath as string | undefined,
        docsPath:
          ((openapiCfg as Record<string, unknown>)?.docsPath as string) ??
          "/docs",
        title: (openapiCfg as Record<string, unknown>)?.title as
          | string
          | undefined,
        docs: (openapiCfg as Record<string, unknown>)?.docs as
          | Record<string, unknown>
          | undefined,
        scalar: (openapiCfg as Record<string, unknown>)?.scalar as
          | Record<string, unknown>
          | undefined,
        rootDir: projectRoot,
        srcDir: path.join(projectRoot, "src"),
        modelsDir: (openapiCfg as Record<string, unknown>)?.docsModelsDir as
          | string
          | undefined,
      });

      app.logger.info(
        `[hot-reload] [openapi] ${collector.getCount()} route(s) documented`,
      );
    }

    // ── 7. 从 adapter 构建完整的 requestHandler ─────────
    //
    // adapter 内部的所有逻辑（VextRequest/VextResponse 转换、
    // Hono trie router、trustProxy 处理等）全部保持一致。
    //
    const handler = freshAdapter.buildHandler();

    // ── 7.1 清空路由缓存 ────────────────────────────────
    // 路由定义已变化，旧缓存可能无效，安全起见全部清空。
    if (app.cache) {
      await app.cache.clear();
    }

    app.logger.info(
      `[hot-reload] routes reloaded via fresh adapter (${freshAdapter.name})`,
    );

    return {
      handler,
      adapter: freshAdapter,
    };
  } finally {
    // ── 8. 恢复原始 adapter 引用 ────────────────────────
    //
    // 无论成功还是失败，都将 app.adapter 恢复为原始引用。
    //
    // 注意：soft reload 成功后，app.adapter 仍然指向原始 adapter。
    // 新的 freshAdapter 通过 buildHandler() 返回的 handler
    // 由 HotSwappableHandler.swap() 绑定到 server socket。
    //
    // 这是有意为之：app.adapter 在 dev 模式下不应被
    // 用户代码直接访问（标记为 @internal）。
    // Server socket 的请求处理通过 HotSwappableHandler 间接引用 handler，
    // 而非通过 app.adapter。
    //
    // 如果需要让后续操作使用新 adapter，调用方可以通过
    // RouteReloadResult.adapter 获取并手动更新。
    //
    app.adapter = originalAdapter;
  }
}

function createCachedOpenApiSpecProvider(generate: () => object): () => object {
  let cached: object | null = null;
  return () => {
    cached ??= generate();
    return cached;
  };
}

function projectRootFromOutDir(outDir: string): string {
  return path.resolve(outDir, "..", "..");
}

// ── 简化版重载函数 ──────────────────────────────────────────

/**
 * createSimpleRouteReloader — 创建一个预配置的路由重载函数
 *
 * 将所有依赖注入点绑定后，返回一个只需 outDir 和 invalidationSet 的
 * 简化重载函数。适合在 soft reload 主流程中使用。
 *
 * @param deps 依赖注入
 * @returns 简化的路由重载函数
 *
 * @example
 * ```ts
 * // 初始化时
 * const reloadRoutesFn = createSimpleRouteReloader({
 *   app,
 *   resolveAdapter,
 *   loadRoutes,
 *   createErrorHandler,
 *   createNotFoundHandler,
 *   middlewareDefs,
 *   globalMiddlewares,
 * })
 *
 * // soft reload 时
 * const { handler } = await reloadRoutesFn(outDir)
 * hotHandler.swap(handler)
 * ```
 */
export function createSimpleRouteReloader(deps: {
  app: RouteReloaderApp;
  resolveAdapter: AdapterResolver;
  loadRoutes: RoutesLoader;
  createErrorHandler: ErrorHandlerFactory;
  createNotFoundHandler: NotFoundHandlerFactory;
  middlewareDefs: MiddlewareRegistry | Map<string, RouteReloaderMiddleware>;
  globalMiddlewares: RouteReloaderMiddleware[];
  builtinMiddlewares?: BuiltinMiddlewareCreators;
  openapiConfig?: Record<string, unknown>;
}): (outDir: string) => Promise<RouteReloadResult> {
  return (outDir: string) =>
    reloadRoutes({
      app: deps.app,
      outDir,
      middlewareDefs: deps.middlewareDefs,
      globalMiddlewares: deps.globalMiddlewares,
      resolveAdapter: deps.resolveAdapter,
      loadRoutes: deps.loadRoutes,
      createErrorHandler: deps.createErrorHandler,
      createNotFoundHandler: deps.createNotFoundHandler,
      builtinMiddlewares: deps.builtinMiddlewares,
      openapiConfig: deps.openapiConfig,
    });
}

import path from "node:path";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { existsSync } from "node:fs";

import { DevCompiler } from "./compiler.js";
import type { CompileStats } from "./compiler.js";
import { HotSwappableHandler } from "./hot-swappable-handler.js";
import { SoftReloader } from "./soft-reloader.js";
import { reloadModels as reloadModelDefs } from "./model-reloader.js";
import type { ModelReloadResult } from "./model-reloader.js";
import { loadConfig } from "../config-loader.js";
import { createApp } from "../app.js";
import type { AppInternals } from "../app.js";
import { loadI18n } from "../i18n-loader.js";
import { loadPlugins } from "../plugin-loader.js";
import {
  createMonSQLizePlugin,
  shouldLoadMonSQLize,
} from "../plugins/monsqlize/index.js";
import { loadMiddlewares } from "../middleware-loader.js";
import { loadServices } from "../service-loader.js";
import { loadRoutes } from "../router-loader.js";
import { resolveAdapter } from "../adapter-resolver.js";
import { createRequestIdMiddleware } from "../middlewares/request-id.js";
import { createCorsMiddleware } from "../middlewares/cors.js";
import { createBodyParserMiddleware } from "../middlewares/body-parser.js";
import { createRateLimitMiddleware } from "../middlewares/rate-limit.js";
import { responseWrapper } from "../middlewares/response-wrapper.js";
import { createAccessLogMiddleware } from "../middlewares/access-log.js";
import { createErrorHandler } from "../middlewares/error-handler.js";
import { renderDevErrorPage } from "./error-overlay.js";
import { createVextFetch } from "../fetch.js";
import { RouteMetadataCollector } from "../openapi/collector.js";
import { OpenAPIGenerator } from "../openapi/generator.js";
import { registerDocEndpoints } from "../openapi/doc-endpoints.js";
import type { VextApp } from "../../types/app.js";
import type { VextMiddleware } from "../../types/middleware.js";
import type { VextServerHandle } from "../../types/adapter.js";
import type { FileChangeInfo } from "./file-watcher.js";
import type { BuiltinMiddlewareCreators } from "./route-reloader.js";
import { printReadyLog } from "../utils/network.js";

/**
 * dev-bootstrap.ts — Dev 模式启动编排（Phase 2B Soft Reload 版）
 *
 * 此文件在 ColdRestarter fork 的子进程中执行，负责：
 *
 *   1. 初始化 DevCompiler（esbuild 首次全量编译 src/ → .vext/dev/）
 *   2. 从编译产物目录加载配置（.vext/dev/config/）
 *   3. createApp 创建框架实例
 *   4. 加载 i18n、plugins、middlewares、services、routes
 *   5. 注册内置中间件 + 错误处理 + 404
 *   6. 创建 HTTP server（http.createServer + HotSwappableHandler）
 *   7. 创建 SoftReloader 并注册 IPC reload 消息监听
 *   8. 通过 IPC 发送 `{ type: 'ready' }` 通知主进程
 *   9. 注册信号处理 + 进程退出清理
 *
 * 与生产模式 bootstrap 的区别：
 *
 *   | 差异点           | 生产 bootstrap           | dev-bootstrap             |
 *   |------------------|--------------------------|---------------------------|
 *   | 代码来源         | src/ 或 dist/            | .vext/dev/（esbuild 产物）  |
 *   | TS 加载          | tsx / 已编译 JS          | esbuild 预编译为 CJS       |
 *   | HTTP server      | adapter.listen()         | http.createServer()        |
 *   | handler 包装     | 无                       | HotSwappableHandler        |
 *   | 进程通信         | 无                       | IPC（ready / reload）      |
 *   | 配置加载目录     | src/config               | .vext/dev/config           |
 *   | loader 加载目录  | src/<module>             | .vext/dev/<module>         |
 *   | Soft Reload      | 无                       | SoftReloader（Tier 1/2）   |
 *
 * Phase 2B 能力：
 *   - HotSwappableHandler 包装 handler，支持原子替换
 *   - SoftReloader 封装完整 Soft Reload 流程（编译→清缓存→i18n→服务→路由→swap）
 *   - IPC 消息监听：接收主进程的 `{ type: 'reload', files: [...] }` 指令
 *   - 级联爆炸检测 → 通过 IPC 请求 Cold Restart
 *   - 失败回退 → 旧 handler 通过闭包继续服务
 *
 * @module lib/dev/dev-bootstrap
 * @see 11d-bootstrap-cli.md §4（Dev 模式 Bootstrap）
 * @see 11d-bootstrap-cli.md §2（Bootstrap 改造）
 * @see 11d-bootstrap-cli.md §3（createApp reload 能力）
 * @see 11b-soft-reload.md §7（完整流程伪代码）
 * @see IMPLEMENTATION-PLAN.md 任务 2.4 / 2.8
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * devBootstrap 返回结果
 *
 * 包含启动后的资源引用，主要用于测试和调试。
 */
interface DevBootstrapResult {
  /** VextApp 实例 */
  app: VextApp;

  /** HTTP server 实例 */
  server: Server;

  /** 服务器句柄（含 host/port/close） */
  serverHandle: VextServerHandle;

  /** 框架内部方法 */
  internals: AppInternals;

  /** DevCompiler 实例（可用于 dispose） */
  compiler: DevCompiler;

  /**
   * 编译统计信息（首次全量编译耗时和文件数）
   */
  compileStats: CompileStats;

  /**
   * HotSwappableHandler 实例（Phase 2B）
   *
   * 用于原子替换 requestHandler。
   * Soft Reload 成功后调用 hotHandler.swap(newHandler)。
   */
  hotHandler: HotSwappableHandler;

  /**
   * SoftReloader 实例（Phase 2B）
   *
   * 封装完整的 Soft Reload 流程。
   * IPC 消息 `{ type: 'reload', files: [...] }` 触发 softReloader.reload()。
   */
  softReloader: SoftReloader;
}

/**
 * devBootstrap 选项
 */
export interface DevBootstrapOptions {
  /**
   * 用户项目根目录（绝对路径，包含 src/ 和 tsconfig.json）
   */
  projectRoot: string;

  /**
   * 编译产物输出目录（可选，默认 <projectRoot>/.vext/dev）
   *
   * 允许在测试中自定义输出路径，避免污染项目目录。
   */
  outDir?: string;

  /**
   * tsconfig.json 路径（可选，默认 <projectRoot>/tsconfig.json）
   */
  tsconfig?: string;

  /**
   * 是否禁用 IPC 通知（测试用）
   *
   * 当 true 时不调用 process.send()，避免在非 fork 场景下报错。
   */
  skipIpc?: boolean;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * devBootstrap — Dev 模式完整启动编排
 *
 * 在 ColdRestarter fork 的子进程中执行。
 * 完成 esbuild 编译 + 框架初始化 + HTTP 启动 + IPC 就绪通知。
 *
 * 流程：
 *   不可重载阶段：
 *     0. DevCompiler.start() → 全量编译 src/ → .vext/dev/
 *     1. loadConfig(outDir/config) → 从编译产物加载配置
 *     2. createApp(config) → 创建 app + internals
 *     3. loadI18n(outDir/locales) → 加载 i18n 语言包
 *     4. loadPlugins(app, outDir/plugins) → 加载并执行插件 setup()
 *
 *   可重载阶段（首次执行）：
 *     5. loadMiddlewares(outDir/middlewares) → 加载中间件定义
 *     6. loadServices(app, outDir/services) → 加载并注入服务
 *     7. loadRoutes(app, outDir/routes) → 加载路由并注册到 adapter
 *     8. 注册内置中间件 + 错误处理 + 404
 *     9. lockUse() → 锁定 app.use()
 *
 *   Server 启动（Phase 2B — HotSwappableHandler）：
 *     10. adapter.buildHandler() → 获取请求处理函数
 *     10b. new HotSwappableHandler(handler) → 包装为可热替换
 *     11. http.createServer(hotHandler.handle) → 创建 server
 *     12. server.listen() → 开始监听
 *
 *   Soft Reload 初始化（Phase 2B）：
 *     12b. 创建 SoftReloader 实例（注入所有依赖）
 *     12c. 注册 IPC reload 消息监听
 *
 *   就绪通知：
 *     13. IPC 发送 { type: 'ready' }
 *     14. 注册信号处理
 *     15. 执行 onReady 钩子
 *
 * @param options 启动选项
 * @returns 启动后的资源引用
 * @throws 任何启动步骤失败时抛出错误（由 dev-entry.ts 的 catch 处理）
 */
export async function devBootstrap(
  options: DevBootstrapOptions,
): Promise<DevBootstrapResult> {
  const { projectRoot, skipIpc = false } = options;
  const srcDir = path.join(projectRoot, "src");
  const outDir = options.outDir ?? path.join(projectRoot, ".vext", "dev");
  const tsconfig = options.tsconfig ?? path.join(projectRoot, "tsconfig.json");

  // 资源引用（用于错误边界清理）
  let internals: AppInternals | null = null;
  let server: Server | null = null;
  let compiler: DevCompiler | null = null;
  let hotHandler: HotSwappableHandler | null = null;
  let softReloader: SoftReloader | null = null;

  try {
    // ════════════════════════════════════════════════════════
    // 不可重载阶段
    // ════════════════════════════════════════════════════════

    // ── 步骤 0: DevCompiler 首次全量编译 ──────────────────
    //
    // 编译 src/ 下所有 .ts/.js/.mjs/.cjs 文件到 .vext/dev/
    // 输出格式：CJS（require/module.exports），因为 dev 子进程
    // 不带 tsx loader，需要直接 require 编译产物。
    //
    compiler = new DevCompiler({ srcDir, outDir, tsconfig });
    const compileStats = await compiler.start();

    // ── 步骤 1: 加载配置 ─────────────────────────────────
    //
    // 从编译产物的 config/ 子目录加载（不是 src/config/）。
    // dev 子进程不带 tsx loader，无法直接 require TS 文件。
    // compiler.start() 已将 src/config/ 编译为 .vext/dev/config/ 下的 CJS .js
    //
    const config = await loadConfig(path.join(outDir, "config"));

    // ── 步骤 2: createApp ────────────────────────────────
    const result = createApp(config);
    const app = result.app;
    internals = result.internals;

    // ── 步骤 2a: resolveAdapter（异步按需加载）────────────
    // 动态 import() 按需加载用户选择的 adapter 框架包。
    // 默认 native adapter（零外部依赖），其他 adapter 需用户额外安装对应框架。
    app.adapter = await resolveAdapter(config, app);

    app.logger.info("[vext dev] initializing (soft reload mode)...");
    app.logger.info(
      `[vext dev] compiled ${compileStats.fileCount} files in ${compileStats.elapsed}ms`,
    );

    // ── 步骤 3: i18n 语言包加载 ──────────────────────────
    //
    // 从编译产物的 locales/ 子目录加载（如果存在）
    //
    const localesDir = path.join(outDir, "locales");
    if (existsSync(localesDir)) {
      const loadedLocales = await loadI18n(localesDir, app.logger);
      if (loadedLocales.length > 0) {
        app.logger.info(
          `[vext dev] i18n locales loaded: ${loadedLocales.join(", ")}`,
        );
      }
    }

    // ── 步骤 3.5: 内置插件（MonSQLize）条件加载（P0 修复）──
    //
    // 生产 bootstrap.ts 有此步骤，dev-bootstrap 原先缺失，
    // 导致 dev 模式下 app.db / app.monsqlize 不存在。
    //
    // 仅当 config.database 存在时才启用 MonSQLize 内置插件。
    // 在用户插件之前执行，确保用户插件可安全依赖 app.db / app.monsqlize。
    // 无 database 配置则完全跳过，零开销。
    //
    // 注意：dev 模式使用 outDir（编译产物目录）而非 srcDir，
    // 因为 dev 子进程不带 tsx loader，需要从 .vext/dev/models/ 加载 CJS 编译产物。
    //
    const hasMonsqlize = shouldLoadMonSQLize(
      config as unknown as Record<string, unknown>,
    );
    if (hasMonsqlize) {
      const monsqlizePlugin = createMonSQLizePlugin(outDir);
      app.logger.debug(
        "[vext dev] built-in plugin: monsqlize (database config detected)",
      );
      await monsqlizePlugin.setup(app);
      app.logger.info("[vext dev] built-in plugin: monsqlize loaded");
    }

    // ── 步骤 4: 加载插件 ─────────────────────────────────
    //
    // 从编译产物的 plugins/ 子目录加载（如果存在）
    // 插件在 setup() 阶段注册钩子和中间件，属于不可重载阶段
    //
    const pluginsDir = path.join(outDir, "plugins");
    if (existsSync(pluginsDir)) {
      await loadPlugins(app, pluginsDir);
    }

    // ════════════════════════════════════════════════════════
    // 可重载阶段（首次执行）
    // ════════════════════════════════════════════════════════

    // ── fetchConfig 提前提取（步骤 8 的 requestId 中间件需要用到）──
    // 必须在步骤 5 之前定义，因为步骤 8 注册 requestId 中间件时
    // 需要将 propagateHeaders 传入，而 fetchConfig 原本在步骤 8+ 才读取。
    const fetchConfig = (config as Record<string, unknown>).fetch as
      | {
          timeout?: number;
          retry?: number;
          retryDelay?: number;
          propagateHeaders?: string[];
        }
      | undefined;

    // ── 步骤 5: 加载中间件定义 ───────────────────────────
    const middlewareRegistry = await loadMiddlewares(
      path.join(outDir, "middlewares"),
      config.middlewares ?? [],
      app.logger,
    );

    // ── 步骤 6: 加载服务 ─────────────────────────────────
    await loadServices(app, path.join(outDir, "services"));

    // ── 步骤 7: 加载路由 ─────────────────────────────────
    //
    // 🆕 OpenAPI 集成：若 openapi.enabled，创建 collector 传入 loadRoutes，
    // 在每条路由注册到 adapter 时同步收集元信息（method / path / options / sourceFile）。
    const openapiConfig = config.openapi;
    const openapiEnabled =
      openapiConfig?.enabled ?? process.env.NODE_ENV !== "production";

    const collector = openapiEnabled ? new RouteMetadataCollector() : null;

    await loadRoutes(
      app,
      path.join(outDir, "routes"),
      {
        middlewareDefs: middlewareRegistry,
        globalMiddlewares: internals.getGlobalMiddlewares(),
      },
      collector,
    );

    // ── 步骤 7+: OpenAPI 文档生成 ────────────────────────
    //
    // 在所有路由注册完成后、步骤 8（内置中间件注册）之前生成 OpenAPI 文档。
    // 使用 collector 收集到的路由元信息 + config.openapi 配置，
    // 生成 OpenAPI 3.0 spec 并注册 /docs + /openapi.json 端点。
    //
    if (openapiEnabled && collector) {
      const generator = new OpenAPIGenerator({
        title: openapiConfig?.title,
        description: openapiConfig?.description,
        version: openapiConfig?.version,
        servers: (openapiConfig as Record<string, unknown>)?.servers as
          | Array<{ url: string; description?: string }>
          | undefined,
        tags: (openapiConfig as Record<string, unknown>)?.tags as
          | Array<{ name: string; description?: string }>
          | undefined,
        securitySchemes: (openapiConfig as Record<string, unknown>)
          ?.securitySchemes as Record<
          string,
          {
            type: "http" | "apiKey" | "oauth2" | "openIdConnect";
            scheme?: string;
            bearerFormat?: string;
            description?: string;
          }
        >,
        guardSecurityMap: (openapiConfig as Record<string, unknown>)
          ?.guardSecurityMap as Record<string, string> | undefined,
        contact: (openapiConfig as Record<string, unknown>)?.contact as
          | { name?: string; email?: string; url?: string }
          | undefined,
        license: (openapiConfig as Record<string, unknown>)?.license as
          | { name: string; url?: string }
          | undefined,
      });

      const spec = generator.generate(collector.getRoutes());

      registerDocEndpoints(app, spec, {
        specPath: openapiConfig?.jsonPath ?? "/openapi.json",
        specPublicPath: (openapiConfig as Record<string, unknown>)
          ?.jsonPublicPath as string | undefined,
        docsPath: openapiConfig?.docsPath ?? "/docs",
        title: openapiConfig?.title,
        scalar: (openapiConfig as Record<string, unknown>)?.scalar as
          | Record<string, unknown>
          | undefined,
      });

      app.logger.info(`[openapi] ${collector.getCount()} route(s) documented`);
    }

    // ── 步骤 8: 注册内置中间件 ───────────────────────────
    //
    // 与生产 bootstrap 保持一致的中间件注册顺序：
    //   requestId → cors → body-parser → rate-limit → response-wrapper
    //   → access-log → 插件全局中间件 → 错误处理 → 404
    //

    // 1. requestId
    const requestIdMiddleware = createRequestIdMiddleware(
      config.requestId,
      () => internals!.getRequestIdGenerator(),
      (fetchConfig?.propagateHeaders ?? []) as string[],
    );
    app.adapter.registerMiddleware(requestIdMiddleware);

    // 2. cors
    const corsMiddleware = createCorsMiddleware(config.cors);
    app.adapter.registerMiddleware(corsMiddleware);

    // 3. body-parser
    const bodyParserMiddleware = createBodyParserMiddleware(config.bodyParser);
    app.adapter.registerMiddleware(bodyParserMiddleware);

    // 4. rate-limit
    const rateLimitMiddleware = createRateLimitMiddleware(
      config.rateLimit,
      () => internals!.getRateLimiter(),
    );
    app.adapter.registerMiddleware(rateLimitMiddleware);

    // 5. response-wrapper
    app.adapter.registerMiddleware(responseWrapper);

    // 6. access-log（洋葱模型 after-middleware：before 记录开始时间，after 记录耗时+状态码）
    const accessLogMiddleware = createAccessLogMiddleware(
      config.accessLog ?? {},
      app.logger,
    );
    app.adapter.registerMiddleware(accessLogMiddleware);

    // 注册插件全局中间件
    for (const mw of internals.getGlobalMiddlewares()) {
      app.adapter.registerMiddleware(mw);
    }

    // 错误处理 + 404
    // 🆕 Dev 错误覆盖层：读取 config.dev.errorOverlay 配置，enabled !== false 时注入
    const devOverlayConfig = (config as Record<string, unknown>).dev as
      | {
          errorOverlay?: {
            enabled?: boolean;
            theme?: "dark" | "light";
            maxFrames?: number;
          };
        }
      | undefined;
    const overlayEnabled = devOverlayConfig?.errorOverlay?.enabled !== false;
    const overlayOptions = devOverlayConfig?.errorOverlay
      ? {
          theme: devOverlayConfig.errorOverlay.theme,
          maxFrames: devOverlayConfig.errorOverlay.maxFrames,
        }
      : undefined;
    const overlayFn = overlayEnabled
      ? (err: unknown) => renderDevErrorPage(err, projectRoot, overlayOptions)
      : undefined;
    const errorHandler = createErrorHandler(config.response ?? {}, overlayFn);
    app.adapter.registerErrorHandler(errorHandler);
    app.adapter.registerNotFound(createNotFoundHandler());

    // ── 步骤 8+: 挂载 app.fetch ──────────────────────────
    // fetchConfig 已在步骤 5 之前提取，此处直接使用
    const requestIdHeader = config.requestId?.header ?? "x-request-id";
    app.fetch = createVextFetch(
      app.logger,
      fetchConfig ?? {},
      requestIdHeader,
    ) as unknown as VextApp["fetch"];

    // ── 步骤 9: 锁定 app.use() ──────────────────────────
    internals.lockUse();

    // ════════════════════════════════════════════════════════
    // Server 启动
    // ════════════════════════════════════════════════════════

    // ── 步骤 10: 构建请求处理函数 ────────────────────────
    //
    // Phase 2B（Soft Reload 模式）：
    //   使用 HotSwappableHandler 包装 handler，
    //   Soft Reload 时只需 hotHandler.swap(newHandler) 即可原子替换。
    //
    //   Server socket 绑定的是 hotHandler.handle（间接引用），
    //   soft reload 时只替换 currentHandler 引用，不影响 socket。
    //
    const handler = app.adapter.buildHandler();
    hotHandler = new HotSwappableHandler(handler);

    // ── 步骤 11: 创建 HTTP server ───────────────────────
    //
    // 关键决策：dev 模式下不通过 adapter.listen() 创建 server，
    // 而是框架直接用 http.createServer() 创建。
    //
    // 原因：
    //   1. Server socket 由框架控制，soft reload 时不受影响
    //   2. Adapter 可自由重建（每次 soft reload 创建新实例）
    //   3. 请求处理函数通过 HotSwappableHandler 可原子替换
    //
    server = createServer(hotHandler.handle);

    // 应用与生产模式一致的 server 配置
    const serverConfig = (config as Record<string, unknown>).server as
      | {
          keepAliveTimeout?: number;
          headersTimeout?: number;
          requestTimeout?: number;
        }
      | undefined;

    if (serverConfig?.keepAliveTimeout) {
      server.keepAliveTimeout = serverConfig.keepAliveTimeout;
    }
    if (serverConfig?.headersTimeout) {
      server.headersTimeout = serverConfig.headersTimeout;
    }
    if (serverConfig?.requestTimeout) {
      server.requestTimeout = serverConfig.requestTimeout;
    }

    // ── 步骤 12: 开始监听 ────────────────────────────────
    const port = config.port ?? 3000;
    const host = config.host ?? "0.0.0.0";

    const serverHandle = await new Promise<VextServerHandle>(
      (resolve, reject) => {
        server!.once("error", reject);

        server!.listen(port, host, () => {
          server!.removeListener("error", reject);

          resolve({
            port,
            host,
            async close() {
              return new Promise<void>((res, rej) => {
                server!.close((err) => {
                  if (err) rej(err);
                  else res();
                });
              });
            },
          });
        });
      },
    );

    // ════════════════════════════════════════════════════════
    // 就绪通知 & 信号注册
    // ════════════════════════════════════════════════════════

    // ── 步骤 12b: 创建 SoftReloader ─────────────────────
    //
    // SoftReloader 封装完整的 Soft Reload 流程，包含：
    //   编译 → 清缓存 → i18n → 中间件 → 服务 → 路由 → swap → 内存监控
    //
    // 所有依赖通过构造选项注入，SoftReloader 不直接 import 任何框架模块。
    //
    // 内置中间件创建器 — 供 route-reloader 在每次 soft reload 时
    // 在新 adapter 上重新注册所有内置中间件。
    //
    // 使用 as any 是因为 VextMiddleware 和 RouteReloaderMiddleware
    // 的签名形式不同（VextMiddleware 使用 req/res/next 三参数，
    // RouteReloaderMiddleware 使用 ctx/next 两参数），
    // 但运行时实际传递的函数是同一个对象，adapter 内部做转换。
    //
    // ── 步骤 12b-pre: 构造 reloadModels 闭包 ────────────
    //
    // 仅当 monSQLize 插件已加载时，构造 model 重载闭包注入 SoftReloader。
    // 闭包捕获 app 和 outDir，SoftReloader 在 Step 4.5 调用。
    //
    const reloadModelsClosure = hasMonsqlize
      ? (invalidated: Set<string>): Promise<ModelReloadResult> =>
          reloadModelDefs(app as any, outDir, invalidated)
      : undefined;

    const builtinMwCreators: BuiltinMiddlewareCreators = {
      createRequestIdMiddleware: ((cfg: Record<string, unknown>) =>
        createRequestIdMiddleware(
          cfg.requestId as any,
          () => internals!.getRequestIdGenerator(),
          (fetchConfig?.propagateHeaders ?? []) as string[],
        )) as any,
      createCorsMiddleware: ((cfg: Record<string, unknown>) =>
        createCorsMiddleware(cfg.cors as any)) as any,
      createBodyParserMiddleware: ((cfg: Record<string, unknown>) =>
        createBodyParserMiddleware(cfg.bodyParser as any)) as any,
      createRateLimitMiddleware: ((cfg: Record<string, unknown>) =>
        createRateLimitMiddleware(cfg.rateLimit as any, () =>
          internals!.getRateLimiter(),
        )) as any,
      responseWrapper: responseWrapper as any,
      createAccessLogMiddleware: ((cfg: Record<string, unknown>) =>
        createAccessLogMiddleware(
          (cfg.accessLog ?? {}) as any,
          app.logger,
        )) as any,
    };

    softReloader = new SoftReloader({
      compiler: compiler!,
      hotHandler: hotHandler!,
      app: app as any,
      config: config as any,
      logger: app.logger,
      resolveAdapter: resolveAdapter as any,
      loadRoutes: loadRoutes as any,
      loadMiddlewares: loadMiddlewares as any,
      createErrorHandler: ((cfg: Record<string, unknown>) =>
        createErrorHandler(
          (cfg as any).response ?? {},
          // 🆕 soft reload 后重建的错误处理器同样包含 overlay 注入
          overlayEnabled
            ? (err: unknown) =>
                renderDevErrorPage(err, projectRoot, overlayOptions)
            : undefined,
        )) as any,
      createNotFoundHandler: createNotFoundHandler as any,
      builtinMiddlewares: builtinMwCreators,
      getGlobalMiddlewares: () => internals!.getGlobalMiddlewares() as any,
      // 🆕 monSQLize 热重载：传递 reloadModels 闭包（仅当 monsqlize 已加载）
      reloadModels: reloadModelsClosure,
      // 🆕 BUG-022 修复：传递 openapiConfig 使热重载后自动重新注册 /docs + /openapi.json
      openapiConfig: openapiEnabled
        ? (openapiConfig as Record<string, unknown>)
        : undefined,
    });

    // ── 步骤 12c-pre: 定义 handleShutdown（提前到 IPC 监听之前）──
    //
    // handleShutdown 需要在 IPC message 监听器中引用，
    // 因此必须在注册 process.on('message') 之前定义（避免 const TDZ 错误）。
    //
    const handleShutdown = async () => {
      app.logger.info("[vext dev] worker shutting down...");

      try {
        // 停止接受新请求
        await serverHandle.close();
      } catch {
        // 静默忽略 server 关闭错误
      }

      try {
        // 执行 onClose hooks（DB 断开、缓存清理等）
        await internals!.shutdown();
      } catch {
        // 静默忽略 shutdown 错误
      }

      try {
        // 释放 esbuild 资源
        await compiler!.dispose();
      } catch {
        // 静默忽略 compiler dispose 错误
      }
    };

    // ── 步骤 12c: 注册 IPC 消息监听（reload + shutdown）──
    //
    // 主进程（cli/dev.ts）在 soft 类型的文件变更时，
    // 通过 restarter.sendToChild({ type: 'reload', files: [...] })
    // 发送 IPC 消息到本子进程。
    //
    // 本监听器接收消息后调用 softReloader.reload()
    // 执行完整的 Soft Reload 流程。
    //
    // 🐛 修复 BUG-014：同时监听 { type: 'shutdown' } 消息，
    // Windows 上 ColdRestarter 通过此 IPC 消息触发优雅关闭。
    //
    process.on("message", (msg: unknown) => {
      if (typeof msg !== "object" || msg === null) return;

      const msgType = (msg as Record<string, unknown>).type;

      if (msgType === "reload") {
        const files = (msg as Record<string, unknown>)
          .files as FileChangeInfo[];
        if (Array.isArray(files) && files.length > 0) {
          softReloader!.reload(files).catch((err: unknown) => {
            app.logger.error(
              "[hot-reload] unexpected error in reload:",
              err instanceof Error ? err.message : err,
            );
          });
        }
      } else if (msgType === "shutdown") {
        handleShutdown().finally(() => {
          process.exit(0);
        });
      }
    });

    // ── 步骤 13: IPC 就绪通知 ────────────────────────────
    //
    // 通知主进程（ColdRestarter）子进程已完成初始化，
    // 可以开始接受请求了。
    //
    if (!skipIpc && process.send) {
      process.send({ type: "ready" });
    }

    // ── 步骤 14: 信号处理 ────────────────────────────────
    //
    // Dev 子进程的信号处理：
    //   - SIGTERM：由 ColdRestarter.safeKill 发送 → 触发优雅关闭
    //   - SIGINT：一般不会直接收到（主进程拦截了），但作为保险注册
    //   - IPC { type: 'shutdown' }：Windows 上由 ColdRestarter 发送（BUG-014 修复）
    //     已在步骤 12c 的 process.on('message') 中处理
    //
    // 不使用 setupShutdown（因为 dev 子进程的退出由 ColdRestarter 控制，
    // 不需要 process.exit），直接注册信号处理。
    //
    // handleShutdown 已在步骤 12c-pre 中定义（供 IPC + 信号共用）。
    //

    process.once("SIGTERM", () => {
      handleShutdown().finally(() => {
        process.exit(0);
      });
    });

    process.once("SIGINT", () => {
      handleShutdown().finally(() => {
        process.exit(0);
      });
    });

    // ── 步骤 15: 执行 onReady 钩子 ──────────────────────
    await internals.runReady();

    printReadyLog(app.logger, serverHandle.host, serverHandle.port, {
      prefix: "[vext dev]",
      suffix: "(soft reload enabled)",
    });

    return {
      app,
      server,
      serverHandle,
      internals,
      compiler,
      compileStats,
      hotHandler: hotHandler!,
      softReloader: softReloader!,
    };
  } catch (err) {
    // ── 错误边界：清理已分配的资源 ─────────────────────────
    //
    // 启动过程中任何步骤失败时的清理逻辑。
    // 确保不会泄漏端口、文件句柄、esbuild 进程等资源。
    //

    if (server) {
      try {
        server.close();
      } catch {
        // 静默忽略
      }
    }

    if (internals) {
      try {
        await internals.shutdown(undefined, { skipExit: true });
      } catch {
        // 静默忽略
      }
    }

    if (compiler) {
      try {
        await compiler.dispose();
      } catch {
        // 静默忽略
      }
    }

    // 重新抛出，由 dev-entry.ts 的 catch 处理
    throw err;
  }
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * 创建 404 兜底处理函数
 *
 * 与生产 bootstrap 保持一致的 404 响应格式。
 */
function createNotFoundHandler(): VextMiddleware {
  return async (req, res, _next) => {
    res.rawJson(
      {
        code: 404,
        message: "Not Found",
        requestId: req.requestId,
      },
      404,
    );
  };
}

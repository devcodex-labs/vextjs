import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config-loader.js";
import { createApp } from "./app.js";
import type { AppInternals } from "./app.js";
import { loadI18n } from "./i18n-loader.js";
import { loadPlugins } from "./plugin-loader.js";
import { loadMiddlewares } from "./middleware-loader.js";
import { loadServices } from "./service-loader.js";
import { loadRoutes } from "./router-loader.js";
import { createRequestIdMiddleware } from "./middlewares/request-id.js";
import { createCorsMiddleware } from "./middlewares/cors.js";
import { createBodyParserMiddleware } from "./middlewares/body-parser.js";
import { createRateLimitMiddleware } from "./middlewares/rate-limit.js";
import { responseWrapper } from "./middlewares/response-wrapper.js";
import { createAccessLogMiddleware } from "./middlewares/access-log.js";
import { createErrorHandler } from "./middlewares/error-handler.js";
import { createVextFetch } from "./fetch.js";
import { setupShutdown } from "./shutdown.js";
import { RouteMetadataCollector } from "./openapi/collector.js";
import { OpenAPIGenerator } from "./openapi/generator.js";
import { registerOpenAPIRoutes } from "./openapi/swagger-ui.js";
import type { VextServerHandle } from "../types/adapter.js";
import type { VextApp } from "../types/app.js";
import type { VextMiddleware } from "../types/middleware.js";

/**
 * bootstrap — 框架完整启动编排（Phase 1）
 *
 * 启动流程（步骤 0 ~ ⑨）：
 *
 *   0. config-loader：加载 default → env → local 三层配置 + deepFreeze
 *   ①  createApp(config)：创建 app + internals（logger / throw / validator / adapter）
 *   ①+ i18n 语言包自动加载：src/locales/ 存在时通过 schemaAdapter.configure 注册
 *   ②  plugin-loader：扫描 src/plugins/，拓扑排序 + setup()（app.use() 可用窗口）
 *   ③  middleware-loader：按 config.middlewares 白名单加载路由级中间件定义
 *   ④  service-loader：扫描 src/services/，实例化注入 app.services
 *   ⑤  router-loader：扫描 src/routes/，注册路由到 adapter
 *   ⑤+ lockUse()：锁定 app.use()，后续调用抛错
 *   ⑥  注册内置中间件（requestId → cors → body-parser → rate-limit → response-wrapper）
 *       + 注册插件全局中间件（app.use() 收集的）
 *       + 注册错误处理 + 404 兜底
 *   ⑦  HTTP 开始监听（adapter.listen）
 *   ⑧  注册信号处理（SIGTERM / SIGINT → shutdown）
 *   ⑨  执行 onReady 钩子 + 打印启动日志
 *
 * 错误边界：
 *   启动过程中任何步骤抛出异常，都会尝试清理已分配的资源：
 *     - 如果 server 已绑定端口 → serverHandle.close()
 *     - 如果 internals 已创建 → internals.shutdown()（执行 onClose hooks）
 *     - 重新抛出错误，由外层 .catch() 处理
 *
 * 注意：内置中间件（requestId / cors / body-parser / rate-limit / response-wrapper）
 * 在步骤⑥通过 adapter.registerMiddleware() 注册，而非 app.use()。
 * 这些中间件在所有路由之前执行（adapter 层保证顺序）。
 * 插件通过 app.use() 注册的全局中间件也在步骤⑥注册到 adapter。
 *
 * @param rootDir 用户项目根目录（包含 src/ 的目录）
 * @returns 启动后的资源句柄（用于测试或 cluster Worker）
 *
 * @see 06-built-ins.md §4（createApp 内部概览 + bootstrap 完整调用顺序）
 * @see 09-cli.md §5（bootstrap.ts 框架内部启动文件）
 * @see IMPLEMENTATION-PLAN.md 任务 1.15
 */
export async function bootstrap(rootDir: string): Promise<BootstrapResult> {
  // 资源引用（用于错误边界清理）
  let internals: AppInternals | null = null;
  let serverHandle: VextServerHandle | null = null;

  try {
    // ── 源码 vs 编译产物目录切换 ──────────────────────────
    //
    // VEXT_BUILT=1 时（vext build 产物存在，vext start 检测到 dist/）：
    //   → 从 dist/ 加载所有模块（编译后的 JS，无需 tsx）
    //
    // 否则（默认）：
    //   → 从 src/ 加载源码（tsx 运行时或 dev 模式）
    //
    // 所有 loader（loadConfig / loadPlugins / loadMiddlewares / loadServices / loadRoutes）
    // 已使用相对路径扫描目录，只需切换根路径即可，loader 代码无需修改。
    //
    const isBuilt = process.env.VEXT_BUILT === "1";
    const srcDir = isBuilt ? join(rootDir, "dist") : join(rootDir, "src");

    // ── 步骤 0: config-loader ─────────────────────────────
    // default → env → local 三层合并 + deepFreeze
    const config = await loadConfig(join(srcDir, "config"));

    // ── 步骤 ①: createApp ─────────────────────────────────
    // 创建 app + internals（logger / throw / validator / adapter 已初始化）
    const result = createApp(config);
    const app = result.app;
    internals = result.internals;

    app.logger.info("[vextjs] initializing...");

    // ── 步骤 ①+: i18n 语言包自动加载 ─────────────────────
    // src/locales/ 目录存在时自动扫描语言文件，
    // 通过 schemaAdapter.configure({ i18n: locales }) 注册到 schema-dsl
    const localesDir = join(srcDir, "locales");
    if (existsSync(localesDir)) {
      const loadedLocales = await loadI18n(localesDir, app.logger);
      if (loadedLocales.length > 0) {
        app.logger.info(
          `[vextjs] i18n locales loaded: ${loadedLocales.join(", ")}`,
        );
      }
    }

    // ── 步骤 ②: plugin-loader ─────────────────────────────
    // 扫描 src/plugins/，拓扑排序（Kahn 算法），依次执行 setup()
    // 此阶段 app.use() 可用，插件可注册全局中间件
    await loadPlugins(app, join(srcDir, "plugins"));

    // ── 步骤 ③: middleware-loader ─────────────────────────
    // 按 config.middlewares 白名单从 src/middlewares/ 加载路由级中间件定义
    // 返回 MiddlewareRegistry 供 router-loader 解析路由级中间件引用
    const middlewareRegistry = await loadMiddlewares(
      join(srcDir, "middlewares"),
      config.middlewares ?? [],
      app.logger,
    );

    // ── 步骤 ④: service-loader ────────────────────────────
    // 扫描 src/services/，实例化（new ServiceClass(app)）注入 app.services
    // 加载完成后执行循环依赖静态检测（正则 + DFS）
    await loadServices(app, join(srcDir, "services"));

    // ── 步骤 ⑤: router-loader ────────────────────────────
    // 扫描 src/routes/，解析路由级中间件引用，注册到 adapter
    //
    // 🆕 OpenAPI 集成：若 openapi.enabled，创建 collector 传入 loadRoutes，
    // 在每条路由注册到 adapter 时同步收集元信息（method / path / options / sourceFile）。
    const openapiConfig = config.openapi;
    const openapiEnabled =
      openapiConfig?.enabled ?? process.env.NODE_ENV !== "production";

    const collector = openapiEnabled ? new RouteMetadataCollector() : null;

    await loadRoutes(
      app,
      join(srcDir, "routes"),
      {
        middlewareDefs: middlewareRegistry,
        globalMiddlewares: internals.getGlobalMiddlewares(),
      },
      collector,
    );

    // ── 步骤 ⑤+: 🆕 OpenAPI 文档生成 ─────────────────────
    //
    // 在所有路由注册完成后、lockUse() 之前生成 OpenAPI 文档。
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

      registerOpenAPIRoutes(app, spec, {
        docsPath: openapiConfig?.docsPath ?? "/docs",
        specPath: openapiConfig?.jsonPath ?? "/openapi.json",
        tryItOutEnabled: ((openapiConfig as Record<string, unknown>)
          ?.tryItOutEnabled ?? true) as boolean,
        docExpansion: ((openapiConfig as Record<string, unknown>)
          ?.docExpansion ?? "list") as "none" | "list" | "full",
      });

      app.logger.info(`[openapi] ${collector.getCount()} route(s) documented`);
    }

    // ── 步骤 ⑤+: 锁定 app.use() ──────────────────────────
    // 路由注册后立即锁定，后续调用 app.use() 将抛出错误
    internals.lockUse();

    // ── 步骤 ⑥: 注册内置中间件 ───────────────────────────
    //
    // 注册顺序决定执行顺序：
    //   1. requestId — 生成/透传请求唯一标识
    //   2. cors      — 处理跨域预检和响应头
    //   3. body-parser — 解析 JSON / URL-encoded 请求体
    //   4. rate-limit — 速率限制
    //   5. response-wrapper — 开启出口包装标志
    //   6. access-log — 洋葱模型 after-middleware（记录耗时/状态码/路径）
    //
    // 这些中间件通过 adapter.registerMiddleware() 注册，
    // 在所有路由（含路由级中间件）之前执行。

    // 1. requestId
    const requestIdMiddleware = createRequestIdMiddleware(
      config.requestId,
      () => internals!.getRequestIdGenerator(),
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

    // 5. response-wrapper（开启出口包装标志）
    app.adapter.registerMiddleware(responseWrapper);

    // 6. access-log（洋葱模型 after-middleware：before 记录开始时间，after 记录耗时+状态码）
    const accessLogMiddleware = createAccessLogMiddleware(
      config.accessLog ?? {},
      app.logger,
    );
    app.adapter.registerMiddleware(accessLogMiddleware);

    // ── 注册插件全局中间件（app.use() 收集的）─────────────
    // 插件在步骤②中通过 app.use() 注册的全局中间件
    // 在内置中间件之后、路由级中间件之前执行
    for (const mw of internals.getGlobalMiddlewares()) {
      app.adapter.registerMiddleware(mw);
    }

    // ── 注册错误处理 + 404 兜底 ──────────────────────────
    const errorHandler = createErrorHandler(config.response ?? {});
    app.adapter.registerErrorHandler(errorHandler);

    const notFoundHandler = createNotFoundHandler();
    app.adapter.registerNotFound(notFoundHandler);

    // ── 挂载 app.fetch ───────────────────────────────────
    // 封装 Node.js 内置 fetch，自动传播 requestId + 结构化日志
    const fetchConfig = (config as Record<string, unknown>).fetch as
      | {
          timeout?: number;
          retry?: number;
          retryDelay?: number;
          propagateHeaders?: string[];
        }
      | undefined;
    const requestIdHeader = config.requestId?.header ?? "x-request-id";
    app.fetch = createVextFetch(
      app.logger,
      fetchConfig ?? {},
      requestIdHeader,
    ) as unknown as VextApp["fetch"];

    // ── 步骤 ⑦: HTTP 开始监听 ────────────────────────────
    serverHandle = await app.adapter.listen(config.port, config.host);

    // ── 步骤 ⑧: 注册信号处理 ────────────────────────────
    // 通过 shutdown 模块注册 SIGTERM / SIGINT 信号处理器
    // testMode 下跳过注册，由 createTestApp 控制生命周期
    setupShutdown({
      internals,
      serverHandle,
      logger: app.logger,
      testMode: config._testMode,
    });

    // ── 步骤 ⑨: 执行 onReady 钩子 + 打印启动日志 ─────────
    await internals.runReady();

    app.logger.info(
      `[vextjs] ready on http://${serverHandle.host}:${serverHandle.port}`,
    );

    return { app, serverHandle, internals };
  } catch (err) {
    // ── 错误边界：清理已分配的资源 ─────────────────────────
    //
    // 启动过程中任何步骤抛出异常时的清理逻辑：
    //   1. 如果 server 已绑定端口 → 先关闭 server（停止接受新连接）
    //   2. 如果 internals 已创建 → 执行 shutdown（onClose hooks 清理 DB/缓存等）
    //   3. 重新抛出原始错误，由外层 .catch() 处理（如 CLI 层的 process.exit(1)）
    //

    // 关闭已监听的 server（如果有）
    if (serverHandle) {
      try {
        await serverHandle.close();
      } catch {
        // 静默忽略 server 关闭错误，避免掩盖原始启动错误
      }
    }

    // 执行 onClose hooks 清理资源（DB 连接、缓存等插件注册的清理逻辑）
    //
    // 🔴 传 skipExit: true — 仅执行资源清理，不调用 process.exit()。
    // 原因：
    //   1. 启动失败时应把原始错误 throw 给外层（CLI / 测试层）处理，
    //      而非被 process.exit(0) 吞掉。
    //   2. process.exit(0) 退出码为 0，掩盖了启动失败的事实。
    //   3. 用户只会看到 "优雅关闭" 日志，无法定位真正的启动错误。
    //
    if (internals) {
      try {
        await internals.shutdown(undefined, { skipExit: true });
      } catch {
        // 静默忽略 shutdown 错误，避免掩盖原始启动错误
      }
    }

    // 重新抛出，让外层处理（CLI 层 / 测试层）
    throw err;
  }
}

// ── 返回类型 ────────────────────────────────────────────────

/**
 * bootstrap 返回结果
 *
 * 包含启动后的资源引用，主要用于：
 *   - 测试中关闭服务器（serverHandle.close()）
 *   - 访问 app 实例进行断言
 *   - Cluster Worker 需要 app/internals 引用
 *   - 手动触发 shutdown（如集成测试收尾）
 */
export interface BootstrapResult {
  app: VextApp;
  serverHandle: VextServerHandle;
  internals: AppInternals;
}

// ── 404 兜底处理 ────────────────────────────────────────────

/**
 * 创建 404 兜底处理函数
 *
 * 当没有任何路由匹配时返回标准 404 响应。
 *
 * 注意：
 *   notFound 不经过常规中间件链，requestId 由 adapter 内联生成。
 *   使用 rawJson 发送响应，绕过出口包装（避免 404 被包装为 { code: 0, data: ... }）。
 *
 * @returns VextMiddleware（作为 notFound handler 使用）
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

// ── 自执行入口 ──────────────────────────────────────────────
//
// 当此文件作为入口直接被 fork 执行时（CLI 通过 fork(bootstrap.js) 启动），
// 自动执行 bootstrap 并处理错误。
//
// 检测方式：
//   1. CLI fork 时设置 VEXT_MODE 环境变量（'start' 或 'dev'）
//   2. 检查 process.argv[1] 是否是当前文件（直接运行场景）
//
// 如果是被其他模块 import（如测试、cluster Worker），
// 则只导出 bootstrap 函数，不自动执行。
//

const isDirectRun =
  process.env.VEXT_MODE === "start" || process.env.VEXT_MODE === "dev";

if (isDirectRun) {
  // 被 CLI fork 时自动执行
  // rootDir 由 CLI 通过 VEXT_ROOT 环境变量传入，
  // 降级使用 process.cwd()
  const rootDir = process.env.VEXT_ROOT || process.cwd();

  bootstrap(rootDir).catch((err) => {
    console.error("[vextjs] startup failed:");
    console.error(err);
    process.exit(1);
  });
}

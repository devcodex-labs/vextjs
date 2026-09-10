import path from "node:path";
import {
  acquireProjectOwner,
  currentProjectOwner,
  type ProjectOwner,
} from "../project/owner.js";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { DevCompiler } from "./compiler.js";
import type { CompileStats } from "./compiler.js";
import { HotSwappableHandler } from "./hot-swappable-handler.js";
import { SoftReloader } from "./soft-reloader.js";
import { DevOperationQueue } from "./operation-queue.js";
import { sendMessageToParent } from "../ipc-message.js";
import {
  readWorkerFiles,
  readWorkerOperationRequest,
  type WorkerOperation,
  type WorkerOperationResult,
} from "./worker-protocol.js";
import { reloadModels as reloadModelDefs } from "./model-reloader.js";
import type { ModelReloadResult } from "./model-reloader.js";
import { finalizeConfig, loadRawConfig } from "../config-loader.js";
import {
  createProjectWatchLayout,
  resolveLocaleDirectory,
} from "../project/layout.js";
import { resolveConfigProfile } from "../config-profile.js";
import { createApp } from "../app.js";
import type { AppInternals } from "../app.js";
import {
  applyServerConfig,
  createNodeServerOptions,
} from "../server-config.js";
import { loadI18n } from "../i18n-loader.js";
import { getAppSchemaRuntime } from "../i18n/app-runtime.js";
import { loadPlugins } from "../plugin-loader.js";
import {
  createMonSQLizePlugin,
  shouldLoadMonSQLize,
} from "../plugins/monsqlize/index.js";
import { setupMonSQLize } from "../plugins/monsqlize/plugin.js";
import { loadMiddlewares } from "../middleware-loader.js";
import { loadServices } from "../service-loader.js";
import { loadRoutes } from "../router-loader.js";
import { resolveAdapter } from "../adapter-resolver.js";
import { createRequestIdMiddleware } from "../middlewares/request-id.js";
import { createRequestMetadataMiddleware } from "../middlewares/request-metadata.js";
import { createCorsMiddleware } from "../middlewares/cors.js";
import { createBodyParserMiddleware } from "../middlewares/body-parser.js";
import { createRateLimitMiddleware } from "../middlewares/rate-limit.js";
import { responseWrapper } from "../middlewares/response-wrapper.js";
import { createAccessLogMiddleware } from "../middlewares/access-log.js";
import { createCsrfMiddleware } from "../csrf.js";
import {
  createConfiguredSessionRuntime,
  isSessionMiddleware,
} from "../session.js";
import { createAuthContextMiddleware } from "../auth.js";
import {
  createSecurityHeadersMiddleware,
  withSecurityHeadersErrorHandler,
  withSecurityHeadersNotFoundHandler,
} from "../security-headers.js";
import { createErrorHandler } from "../middlewares/error-handler.js";
import {
  createRequestHookMiddleware,
  emitNotFoundRequestHooks,
} from "../middlewares/request-hook.js";
import { renderDevErrorPage } from "./error-overlay.js";
import { type VextFetchConfig } from "../fetch.js";
import { createAppFetch } from "../app-fetch.js";
import { RouteMetadataCollector } from "../openapi/collector.js";
import {
  OpenAPIGenerator,
  createDeprecatedRouteDocsTagsWarning,
} from "../openapi/generator.js";
import { generateOpenAPIDocumentWithHooks } from "../openapi/hook-lifecycle.js";
import { registerDocEndpoints } from "../openapi/doc-endpoints.js";
import type { VextApp } from "../../types/app.js";
import type { VextInternalHooks } from "../../types/hooks.js";
import type { VextMiddleware } from "../../types/middleware.js";
import type { VextServerHandle } from "../../types/adapter.js";
import type { FileChangeInfo } from "./file-watcher.js";
import type { BuiltinMiddlewareCreators } from "./route-reloader.js";
import { printReadyLog } from "../utils/network.js";
import {
  normalizePortConflictStrategy,
  resolvePortConflict,
} from "../port-conflict.js";
import {
  requestPortConflictDecisionFromParent,
  sendLifecycleLevelToParent,
} from "../ipc-port-conflict.js";
import { quietStartupLogger } from "../startup-logger.js";
import { createStartupProfilerFromEnv } from "../startup-profiler.js";
import { writeDevRouteManifest } from "./route-manifest.js";
import { buildFrontendClient } from "../../frontend/tooling/client-build-compiler.js";
import type { BuildFrontendClientResult } from "../../frontend/tooling/client-build-compiler.js";
import { createFrontendNotFoundHandler } from "../../frontend/runtime/static-mount.js";
import { createFrontendRenderMiddleware } from "../../frontend/runtime/renderer.js";
import { registerFrontendSeoEndpoints } from "../../frontend/runtime/seo-endpoints.js";
import {
  createFrontendDevEventBus,
  VEXT_FRONTEND_DEV_EVENT_PATH,
  type VextFrontendDevEvent,
} from "../../frontend/runtime/dev-events.js";

function getLifecycleLevel(
  config: Record<string, unknown>,
): "concise" | "verbose" {
  const logger = config.logger as Record<string, unknown> | undefined;
  return logger?.lifecycleLevel === "verbose" ? "verbose" : "concise";
}

function isEnvFlagEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

async function createFrontendBuiltEvent(
  result: BuildFrontendClientResult,
  files: FileChangeInfo[],
): Promise<VextFrontendDevEvent> {
  const manifest = result.manifestPath
    ? JSON.parse(await readFile(result.manifestPath, "utf-8"))
    : {};
  const entry =
    Array.isArray(manifest.entrypoints) &&
    typeof manifest.entrypoints[0] === "string"
      ? manifest.entrypoints[0]
      : undefined;
  const styles = Array.isArray(manifest.assets)
    ? manifest.assets
        .map((asset: Record<string, unknown>) => asset.path)
        .filter(
          (assetPath: unknown): assetPath is string =>
            typeof assetPath === "string" && assetPath.endsWith(".css"),
        )
    : [];

  return {
    type: "frontend:built",
    action: isStyleOnlyFrontendChange(files)
      ? "style"
      : result.config.dev.hot && result.config.dev.fastRefresh
        ? "fast-refresh"
        : "reload",
    entry,
    styles,
    buildId: await readBuildIdFromRenderManifest(result),
    files: files.map((file) => file.path),
  };
}

async function readBuildIdFromRenderManifest(
  result: BuildFrontendClientResult,
): Promise<string | undefined> {
  if (!result.renderManifestPath) return undefined;
  try {
    if (!existsSync(result.renderManifestPath)) return undefined;
    const manifest = JSON.parse(
      await readFile(result.renderManifestPath, "utf-8"),
    );
    return typeof manifest.buildId === "string" ? manifest.buildId : undefined;
  } catch {
    return undefined;
  }
}

function isStyleOnlyFrontendChange(files: FileChangeInfo[]): boolean {
  return (
    files.length > 0 &&
    files.every((file) => /\.(css|pcss|postcss)$/u.test(file.path))
  );
}

function createRenderReloadEvent(
  files: FileChangeInfo[],
  renderRefresh: "prompt" | "auto" | "off",
): VextFrontendDevEvent | undefined {
  if (renderRefresh === "off") return undefined;
  if (!files.some((file) => isRenderRelatedServerFile(file.path))) {
    return undefined;
  }
  return {
    type: "render:reload",
    action: renderRefresh,
    files: files.map((file) => file.path),
  };
}

function isRenderRelatedServerFile(filePath: string): boolean {
  return (
    filePath === "src/" ||
    filePath === "src" ||
    filePath.startsWith("src/routes/") ||
    filePath.startsWith("src/services/") ||
    filePath.startsWith("src/middlewares/")
  );
}

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
 *   - 编译失败 → 旧 handler 继续服务；运行态变更后的失败 → 父进程停止
 *     当前 child 并执行 Cold Restart，避免继续服务混合运行态
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
  /** 统一停止入口：HTTP、插件、编译器、事件监听与写者身份一起释放。 */
  close(): Promise<void>;
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
 *     0. loadConfig(src/config) → 一次求值配置，确定目录角色
 *     1. DevCompiler.start() → 排除浏览器源后编译后端到 .vext/dev/
 *     2. createApp(config) → 创建 app + internals
 *     3. loadI18n(app, localeLayout.directory) → 加载应用独立语言包
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
  const owner =
    currentProjectOwner(options.projectRoot) ??
    (await acquireProjectOwner(options.projectRoot, "dev"));
  try {
    await owner.reserveOutputs([
      ".vext",
      "src/config",
      "src/types/generated",
      options.outDir ?? ".vext/dev",
    ]);
    return await owner.run(() => devBootstrapOwned(options, owner));
  } catch (error) {
    if (!(error instanceof DevCleanupError)) await owner.release();
    throw error;
  }
}

async function devBootstrapOwned(
  options: DevBootstrapOptions,
  owner: ProjectOwner,
): Promise<DevBootstrapResult> {
  const { projectRoot, skipIpc = false } = options;
  const srcDir = path.join(projectRoot, "src");
  const outDir = options.outDir ?? path.join(projectRoot, ".vext", "dev");
  const tsconfig = options.tsconfig ?? path.join(projectRoot, "tsconfig.json");
  const startupProfiler = createStartupProfilerFromEnv(process.env);

  // 资源引用（用于错误边界清理）
  let internals: AppInternals | null = null;
  let server: Server | null = null;
  let compiler: DevCompiler | null = null;
  let hotHandler: HotSwappableHandler | null = null;
  let softReloader: SoftReloader | null = null;
  let restoreStartupLogger: (() => void) | undefined;
  let startupCleanup: (() => Promise<void>) | undefined;
  let closeFrontendEvents: (() => void) | undefined;

  try {
    // ════════════════════════════════════════════════════════
    // 不可重载阶段
    // ════════════════════════════════════════════════════════

    // 先复用配置模块加载器求值一次，目录事实再交给编译器和 parent watcher。
    // 配置的 TS 导入由 user-module-loader 负责，不依赖完整后端先编译成功。
    //
    const resolvedConfigProfile = resolveConfigProfile({
      env: process.env,
      command: "dev",
    });
    const rawConfig = await startupProfiler.time("worker.config", () =>
      loadRawConfig(path.join(srcDir, "config"), {
        rootDir: projectRoot,
        command: "dev",
        mode: "development",
        configProfile: resolvedConfigProfile.profile,
        env: process.env,
      }),
    );

    const resolution = await resolvePortConflict({
      host: rawConfig.host as string | undefined,
      port: rawConfig.port as number,
      strategy: normalizePortConflictStrategy(process.env.VEXT_PORT_CONFLICT),
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      requestDecision: (request) =>
        requestPortConflictDecisionFromParent(request),
    });

    if (resolution.changed) {
      rawConfig.port = resolution.port;
      process.env.VEXT_PORT = String(resolution.port);
      console.log(
        `[vext dev] port conflict resolved: using next available port ${resolution.port}`,
      );
    } else if (resolution.action === "kill" && resolution.details?.pid) {
      console.log(
        `[vext dev] port conflict resolved: stopped process ${resolution.details.pid} on ${resolution.port}`,
      );
    }

    const config = finalizeConfig(rawConfig);
    const frontend =
      typeof config.frontend === "object" ? config.frontend : undefined;
    if (!skipIpc && process.send) {
      await sendMessageToParent({
        type: "watch-layout",
        layout: createProjectWatchLayout(projectRoot, {
          frontend,
          localeDirectory: config.locale?.directory,
          modelsDirectory: resolveConfiguredModelsDir(config),
        }),
      });
    }
    compiler = new DevCompiler({ srcDir, outDir, tsconfig, frontend });
    const compileStats = await startupProfiler.time("worker.compile", () =>
      compiler!.start(),
    );
    const lifecycleLevel = getLifecycleLevel(rawConfig);
    if (!skipIpc) sendLifecycleLevelToParent(lifecycleLevel);

    // ── 步骤 2: createApp ────────────────────────────────
    const result = createApp({ ...config, _runtimeMode: "development" });
    const app = result.app;
    const hooks = app.hooks as VextInternalHooks;
    internals = result.internals;
    const sessionRuntime = createConfiguredSessionRuntime(config.session);
    app.onClose(sessionRuntime.close);
    const corsMiddleware = createCorsMiddleware(config.cors);
    const parentReadyLog = isEnvFlagEnabled(
      process.env.VEXT_DEV_PARENT_READY_LOG,
    );
    restoreStartupLogger = quietStartupLogger(
      app,
      parentReadyLog &&
        lifecycleLevel !== "verbose" &&
        !isEnvFlagEnabled(process.env.VEXT_DEV_STARTUP_PROFILE_HUMAN),
    );

    // ── 步骤 2a: resolveAdapter（异步按需加载）────────────
    // 动态 import() 按需加载用户选择的 adapter 框架包。
    // 默认 native adapter（零外部依赖），其他 adapter 需用户额外安装对应框架。
    app.adapter = await startupProfiler.time("worker.adapter", () =>
      resolveAdapter(config, app),
    );

    app.logger.info("[vext dev] initializing (soft reload mode)...");
    app.logger.info(
      `[vext dev] compiled ${compileStats.fileCount} files in ${compileStats.elapsed}ms`,
    );

    // ── 步骤 3: i18n 语言包加载 ──────────────────────────
    //
    // 从编译产物的 locales/ 子目录加载（如果存在）
    //
    // 与生产共用catalog；编译产物含模块目录及JSON，不回退全局字典。
    //
    await startupProfiler.time(
      "worker.i18n",
      async () => {
        const localeLayout = resolveLocaleDirectory(
          projectRoot,
          outDir,
          config.locale?.directory,
        );
        const loadedLocales = await loadI18n(app, localeLayout.directory, {
          rootDir: projectRoot,
          compiled: localeLayout.compiled,
        });
        if (loadedLocales.length)
          app.logger.info(
            `[vextjs] i18n locales loaded: ${loadedLocales.join(", ")}`,
          );
      },
      { phase: "i18n" },
    );

    // ── 步骤 3.5: 内置插件（MonSQLize）条件加载（P0 修复）──
    //
    // 生产 bootstrap.ts 有此步骤，dev-bootstrap 原先缺失，
    // 导致 dev 模式下 app.db 不存在。
    //
    // 仅当 config.database 存在时才启用 MonSQLize 内置插件。
    // 在用户插件之前执行，确保用户插件可安全依赖完整的原始 app.db。
    // 无 database 配置则跳过 setup，不加载数据库运行时与 hook。
    //
    // 注意：dev 模式使用 outDir（编译产物目录）而非 srcDir，
    // 因为 dev 子进程不带 tsx loader，需要从 .vext/dev/models/ 加载 CJS 编译产物。
    //
    const hasMonsqlize = shouldLoadMonSQLize(
      config as unknown as Record<string, unknown>,
    );
    if (hasMonsqlize) {
      const monsqlizePlugin = createMonSQLizePlugin(outDir, projectRoot);
      app.logger.debug(
        "[vext dev] built-in plugin: monsqlize (database config detected)",
      );
      const startedAt = performance.now();
      hooks.emitSafeSync("plugin:beforeSetup", {
        plugin: monsqlizePlugin.name,
        sourceFile: "builtin:monsqlize",
        builtin: true,
      });
      internals.enterPluginSetup();
      try {
        await setupMonSQLize(app, outDir, {
          startupProfiler,
          rootDir: projectRoot,
        });
        hooks.emitSafeSync("plugin:afterSetup", {
          plugin: monsqlizePlugin.name,
          sourceFile: "builtin:monsqlize",
          builtin: true,
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        hooks.emitSafeSync("plugin:error", {
          plugin: monsqlizePlugin.name,
          sourceFile: "builtin:monsqlize",
          builtin: true,
          durationMs: Math.round(performance.now() - startedAt),
          error,
        });
        throw error;
      } finally {
        internals.exitPluginSetup();
      }
      app.logger.info("[vext dev] built-in plugin: monsqlize loaded");
    }

    // 插件 setup、服务构造函数和路由工厂共用已初始化的 fetch。
    // 与生产启动保持相同顺序；后续 requestId 中间件复用此配置。
    const fetchConfig = config.fetch as VextFetchConfig | undefined;
    await startupProfiler.time(
      "worker.fetch",
      () => {
        app.fetch = createAppFetch(app, hooks) as unknown as VextApp["fetch"];
      },
      { phase: "fetch" },
    );

    // ── 步骤 4: 加载插件 ─────────────────────────────────
    //
    // 从编译产物的 plugins/ 子目录加载（如果存在）
    // 插件在 setup() 阶段注册钩子和中间件，属于不可重载阶段
    //
    const pluginsDir = path.join(outDir, "plugins");
    if (existsSync(pluginsDir)) {
      internals.enterPluginSetup();
      try {
        await loadPlugins(app, pluginsDir, { startupProfiler });
      } finally {
        internals.exitPluginSetup();
      }
    }

    // ════════════════════════════════════════════════════════
    // 可重载阶段（首次执行）
    // ════════════════════════════════════════════════════════

    // ── 步骤 5: 加载中间件定义 ───────────────────────────
    const middlewareRegistry = await startupProfiler.time(
      "worker.middlewares",
      () =>
        loadMiddlewares(
          path.join(outDir, "middlewares"),
          config.middlewares ?? [],
          app.logger,
          config.logger?.lifecycleLevel ?? "concise",
          projectRoot,
        ),
    );

    // ── 步骤 6: 加载服务 ─────────────────────────────────
    await startupProfiler.time("worker.services", () =>
      loadServices(app, path.join(outDir, "services"), {
        rootDir: projectRoot,
      }),
    );

    // ── 步骤 7: 加载路由 ─────────────────────────────────
    //
    // 🆕 OpenAPI 集成：若 openapi.enabled，创建 collector 传入 loadRoutes，
    // 在每条路由注册到 adapter 时同步收集元信息（method / path / options / sourceFile）。
    const openapiConfig = config.openapi;
    const openapiEnabled =
      openapiConfig?.enabled ?? process.env.NODE_ENV !== "production";

    const collector = new RouteMetadataCollector();

    await startupProfiler.time("worker.routes", () =>
      loadRoutes(
        app,
        path.join(outDir, "routes"),
        {
          middlewareDefs: middlewareRegistry,
          globalMiddlewares: internals!.getGlobalMiddlewares(),
          sessionMiddleware: sessionRuntime.middleware,
          corsMiddleware,
          rootDir: projectRoot,
          frontendMode: "development",
        },
        collector,
      ),
    );

    // ── 步骤 7+: OpenAPI 文档生成 ────────────────────────
    //
    // 在所有路由注册完成后、步骤 8（内置中间件注册）之前生成 OpenAPI 文档。
    // 使用 collector 收集到的路由元信息 + config.openapi 配置，
    // 生成 OpenAPI 3.0 spec 并注册 /docs + /openapi.json 端点。
    //
    const collectedRoutes = collector.getRoutes();
    await startupProfiler.time("worker.routeManifest", () =>
      writeDevRouteManifest(projectRoot, collectedRoutes, { srcDir, outDir }),
    );
    const frontendBuild = await startupProfiler.time("worker.frontend", () =>
      buildFrontendClient({
        rootDir: projectRoot,
        config: config.frontend,
        mode: "development",
      }),
    );
    let frontendRuntimeConfig = frontendBuild.config;
    const frontendDevEvents = createFrontendDevEventBus();
    closeFrontendEvents = () => frontendDevEvents.close();
    if (!frontendBuild.skipped) {
      app.logger.info(
        `[vext dev] frontend built: ${path.relative(projectRoot, frontendBuild.config.outDir)}`,
      );
    }

    registerFrontendSeoEndpoints(app, frontendRuntimeConfig, {
      existingRoutes: collector.getRegisteredRoutes(),
    });

    if (openapiEnabled) {
      await startupProfiler.time(
        "worker.openapi.register",
        () => {
          const generator = new OpenAPIGenerator(
            {
              title: openapiConfig?.title,
              description: openapiConfig?.description,
              version: openapiConfig?.version,
              servers: (openapiConfig as Record<string, unknown>)?.servers as
                | Array<{ url: string; description?: string }>
                | undefined,
              tags: (openapiConfig as Record<string, unknown>)?.tags as
                | Array<{ name: string; description?: string }>
                | undefined,
              tagGroups: (openapiConfig as Record<string, unknown>)
                ?.tagGroups as
                | Array<{ name: string; tags: string[] }>
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
            },
            { responseWrap: config.response?.wrap !== false },
          );

          const docsTagsWarning =
            createDeprecatedRouteDocsTagsWarning(collectedRoutes);
          if (docsTagsWarning) app.logger.warn(docsTagsWarning);

          const specProvider = createCachedOpenApiSpecProvider(() =>
            generateOpenAPIDocumentWithHooks(app, generator, collectedRoutes),
          );

          registerDocEndpoints(app, specProvider, {
            specPath: openapiConfig?.jsonPath ?? "/openapi.json",
            specPublicPath: (openapiConfig as Record<string, unknown>)
              ?.jsonPublicPath as string | undefined,
            docsPath: openapiConfig?.docsPath ?? "/docs",
            title: openapiConfig?.title,
            docs: openapiConfig?.docs,
            scalar: (openapiConfig as Record<string, unknown>)?.scalar as
              | Record<string, unknown>
              | undefined,
            rootDir: projectRoot,
            srcDir,
            modelsDir: resolveConfiguredModelsDir(config),
          });

          app.logger.info(
            `[openapi] ${collector.getCount()} route(s) documented`,
          );
          setTimeout(() => {
            startupProfiler
              .time("worker.openapiWarm", () => Promise.resolve(specProvider()))
              .catch((error: unknown) => {
                app.logger.warn(
                  {
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                  "[openapi] background warm failed",
                );
              });
          }, 0);
        },
        { phase: "openapi", detail: { routes: collector.getCount() } },
      );
    }

    // ── 步骤 8: 注册内置中间件 ───────────────────────────
    //
    // 与生产 bootstrap 保持一致的中间件注册顺序和条件守卫：
    //   requestId → authContext → requestHook → securityHeaders → cors → body-parser → rate-limit → response-wrapper
    //   → frontend render → frontend dev events route → access-log
    //   → 插件全局中间件 → 错误处理 → 404
    //
    // 与生产 bootstrap 对齐；rate-limit 是 opt-in，仅 enabled === true 时注册。
    // 禁用的中间件完全不进入中间件链，避免额外的请求级调度。
    // 请求元数据独立注册，关闭 requestId 不关闭 locale 或显式头传播。
    //

    // 1. requestId（config.requestId.enabled，默认 true）
    const builtinMiddlewaresStartedAt = performance.now();
    app.adapter.registerMiddleware(
      createRequestMetadataMiddleware(
        fetchConfig?.propagateHeaders ?? [],
        config.locale as
          | import("../../types/app.js").VextLocaleConfig
          | undefined,
        app,
      ),
    );
    if (config.requestId?.enabled !== false) {
      const requestIdMiddleware = createRequestIdMiddleware(
        config.requestId,
        () => internals!.getRequestIdGenerator(),
      );
      app.adapter.registerMiddleware(requestIdMiddleware);
    }

    if (config.requestContext?.enabled !== false) {
      app.adapter.registerMiddleware(createAuthContextMiddleware());
    }

    app.adapter.registerMiddleware(createRequestHookMiddleware(hooks));

    if (config.securityHeaders?.enabled === true) {
      app.adapter.registerMiddleware(
        createSecurityHeadersMiddleware(config.securityHeaders),
      );
    }

    // 2. cors（config.cors.enabled，默认 true）
    if (config.cors?.enabled !== false) {
      app.adapter.registerMiddleware(corsMiddleware);
    }

    // 3. body-parser（config.bodyParser.enabled，默认 true）
    if (config.bodyParser?.enabled !== false) {
      const bodyParserMiddleware = createBodyParserMiddleware(
        config.bodyParser,
        config.multipart,
      );
      app.adapter.registerMiddleware(bodyParserMiddleware);
    }

    // 4. rate-limit（默认关闭，仅 enabled=true 时注册）
    if (config.rateLimit?.enabled === true) {
      const rateLimitMiddleware = createRateLimitMiddleware(
        config.rateLimit,
        () => internals!.getRateLimiter(),
      );
      app.adapter.registerMiddleware(rateLimitMiddleware);
    }

    // 5. response-wrapper（config.response.wrap，默认 true）
    if (config.response?.wrap !== false) {
      app.adapter.registerMiddleware(responseWrapper);
    }

    // 与生产 bootstrap 一致：frontend disabled 时 renderer 及其 dev-event
    // route 都不进入请求路径，避免 hot reload 后重新引入 noop middleware。
    if (isFrontendEnabled(config.frontend)) {
      app.adapter.registerMiddleware(
        createFrontendRenderMiddleware({
          rootDir: projectRoot,
          mode: "development",
          config: config.frontend,
        }),
      );
      app.adapter.registerRoute("GET", VEXT_FRONTEND_DEV_EVENT_PATH, [
        frontendDevEvents.middleware,
      ]);
    }

    // 6. access-log（config.accessLog.enabled，默认 true）
    //    洋葱模型 after-middleware：before 记录开始时间，after 记录耗时+状态码
    if (config.accessLog?.enabled !== false) {
      const accessLogMiddleware = createAccessLogMiddleware(
        config.accessLog ?? {},
        app.logger,
      );
      app.adapter.registerMiddleware(accessLogMiddleware);
    }

    if (config.session?.enabled === true) {
      if (internals.getGlobalMiddlewares().some(isSessionMiddleware)) {
        app.logger.warn(
          "[vextjs] config.session.enabled already auto-registers Session; remove manual app.use(session()) to avoid redundant middleware.",
        );
      }
      app.adapter.registerMiddleware(sessionRuntime.middleware);
    }

    // 注册插件全局中间件
    for (const mw of internals.getGlobalMiddlewares()) {
      app.adapter.registerMiddleware(mw);
    }

    if (config.csrf?.enabled === true) {
      app.adapter.registerMiddleware(createCsrfMiddleware(config.csrf));
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
    const errorHandler = createErrorHandler(
      config.response ?? {},
      overlayFn,
      app.logger,
      hooks,
    );
    app.adapter.registerErrorHandler(
      withSecurityHeadersErrorHandler(errorHandler, config.securityHeaders),
    );
    const frontendNotFoundHandler = createFrontendNotFoundHandler({
      rootDir: projectRoot,
      mode: "development",
      config: config.frontend,
      fallbackHandler: createNotFoundHandler(hooks),
      onNotFound: async (req) => {
        await emitNotFoundRequestHooks(hooks, req);
      },
    });
    app.adapter.registerNotFound(
      withSecurityHeadersNotFoundHandler(
        frontendNotFoundHandler,
        config.securityHeaders,
      ),
    );
    startupProfiler.mark(
      "worker.builtinMiddlewares",
      performance.now() - builtinMiddlewaresStartedAt,
      { phase: "middleware" },
    );

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
    const handler = await startupProfiler.time("worker.handler", () =>
      app.adapter.buildHandler(),
    );
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
    server = await startupProfiler.time("worker.server.create", () => {
      const createdServer = createServer(
        createNodeServerOptions(config.server),
        hotHandler!.handle,
      );
      applyServerConfig(createdServer, config.server);
      return createdServer;
    });

    // ── 步骤 12: 开始监听 ────────────────────────────────
    const port = config.port ?? 3000;
    const host = config.host ?? "0.0.0.0";

    await hooks.emit("server:beforeListen", {
      host,
      port,
      adapter: app.adapter,
      mode: "development",
      source: "dev-worker",
      app,
    });

    const serverHandle = await startupProfiler.time(
      "worker.listen",
      () =>
        new Promise<VextServerHandle>((resolve, reject) => {
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
        }),
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
          reloadModelDefs(app as any, outDir, invalidated, projectRoot)
      : undefined;

    // 🔧 D2/D3 修复（soft reload 侧）：
    // - 每个 creator 仅在对应 enabled 条件满足时注入（undefined 时 route-reloader 自动跳过）
    // - 元数据独立重建，确保关闭 ID 后热重载仍保留请求语言和传播头。
    const builtinMwCreators: BuiltinMiddlewareCreators = {
      createRequestMetadataMiddleware: (cfg) =>
        createRequestMetadataMiddleware(
          (fetchConfig?.propagateHeaders ?? []) as string[],
          cfg.locale as any,
          app,
        ) as any,
      createRequestIdMiddleware:
        config.requestId?.enabled !== false
          ? (((cfg: Record<string, unknown>) =>
              createRequestIdMiddleware(cfg.requestId as any, () =>
                internals!.getRequestIdGenerator(),
              )) as any)
          : undefined,
      authContextMiddleware:
        config.requestContext?.enabled !== false
          ? (createAuthContextMiddleware() as any)
          : undefined,
      createCorsMiddleware: ((cfg: Record<string, unknown>) =>
        createCorsMiddleware(cfg.cors as any)) as any,
      sessionMiddleware: sessionRuntime.middleware as any,
      createSecurityHeadersMiddleware:
        config.securityHeaders?.enabled === true
          ? (((cfg: Record<string, unknown>) =>
              createSecurityHeadersMiddleware(
                (cfg as any).securityHeaders,
              )) as any)
          : undefined,
      createBodyParserMiddleware:
        config.bodyParser?.enabled !== false
          ? (((cfg: Record<string, unknown>) =>
              createBodyParserMiddleware(
                cfg.bodyParser as any,
                cfg.multipart as any,
              )) as any)
          : undefined,
      // creator 必须常驻，soft reload 才能按最新配置支持 false ↔ true。
      createRateLimitMiddleware: ((cfg: Record<string, unknown>) =>
        createRateLimitMiddleware((cfg.rateLimit ?? {}) as any, () =>
          internals!.getRateLimiter(),
        )) as any,
      responseWrapper:
        config.response?.wrap !== false ? (responseWrapper as any) : undefined,
      createFrontendRenderMiddleware: isFrontendEnabled(config.frontend)
        ? (((cfg: Record<string, unknown>) =>
            createFrontendRenderMiddleware({
              rootDir: projectRoot,
              mode: "development",
              config: (cfg as any).frontend,
            })) as any)
        : undefined,
      frontendDevEvents: isFrontendEnabled(config.frontend)
        ? (frontendDevEvents.middleware as any)
        : undefined,
      createAccessLogMiddleware:
        config.accessLog?.enabled !== false
          ? (((cfg: Record<string, unknown>) =>
              createAccessLogMiddleware(
                (cfg.accessLog ?? {}) as any,
                app.logger,
              )) as any)
          : undefined,
      createCsrfMiddleware:
        config.csrf?.enabled === true
          ? (((cfg: Record<string, unknown>) =>
              createCsrfMiddleware((cfg as any).csrf)) as any)
          : undefined,
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
      createErrorHandler: ((responseConfig: Record<string, unknown>) =>
        withSecurityHeadersErrorHandler(
          createErrorHandler(
            responseConfig,
            // 🆕 soft reload 后重建的错误处理器同样包含 overlay 注入
            overlayEnabled
              ? (err: unknown) =>
                  renderDevErrorPage(err, projectRoot, overlayOptions)
              : undefined,
            app.logger, // 🆕 soft reload 后重建的错误处理器同样传入 logger
            hooks,
          ),
          (app.config as any).securityHeaders,
        )) as any,
      createNotFoundHandler: (() =>
        withSecurityHeadersNotFoundHandler(
          createFrontendNotFoundHandler({
            rootDir: projectRoot,
            mode: "development",
            config: config.frontend,
            fallbackHandler: createNotFoundHandler(hooks),
            onNotFound: async (req) => {
              await emitNotFoundRequestHooks(hooks, req);
            },
          }),
          (app.config as any).securityHeaders,
        )) as any,
      builtinMiddlewares: builtinMwCreators,
      configureI18n: getAppSchemaRuntime(app).replaceMessages,
      getGlobalMiddlewares: () => internals!.getGlobalMiddlewares() as any,
      // 🆕 monSQLize 热重载：传递 reloadModels 闭包（仅当 monsqlize 已加载）
      reloadModels: reloadModelsClosure,
      // 🆕 BUG-022 修复：传递 openapiConfig 使热重载后自动重新注册 /docs + /openapi.json
      openapiConfig: openapiEnabled
        ? {
            ...(openapiConfig as Record<string, unknown>),
            docsModelsDir: resolveConfiguredModelsDir(config),
          }
        : undefined,
    });

    // ── 步骤 12c-pre: 定义 handleShutdown（提前到 IPC 监听之前）──
    //
    // handleShutdown 需要在 IPC message 监听器中引用，
    // 因此必须在注册 process.on('message') 之前定义（避免 const TDZ 错误）。
    //
    const operations = new DevOperationQueue();
    const activeReloads = new Set<Promise<unknown>>();
    const trackReload = (task: Promise<unknown>) => {
      activeReloads.add(task);
      void task
        .finally(() => activeReloads.delete(task))
        .catch((error: unknown) => {
          app.logger.error(
            "[vext dev] worker operation response failed:",
            String(error),
          );
        });
    };
    let shutdownTask: Promise<void> | undefined;
    let readyTask: Promise<void> | undefined;
    const handleShutdown = (): Promise<void> => {
      shutdownTask ??= performShutdown();
      return shutdownTask;
    };
    const performShutdown = async () => {
      app.logger.info("[vext dev] worker shutting down...");
      if (readyTask) await Promise.allSettled([readyTask]);
      await operations.close();
      await Promise.allSettled([...activeReloads]);
      const failures: unknown[] = [];
      for (const close of [
        () => serverHandle.close(),
        () => internals!.shutdown(undefined, { skipExit: true }),
        () => compiler!.dispose(),
        () => frontendDevEvents.close(),
      ]) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      process.off("message", onMessage);
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
      if (failures.length) throw new DevCleanupError(failures);
      await owner.release();
    };
    const exitAfterShutdown = () => {
      void handleShutdown().then(
        () => process.exit(0),
        (error: unknown) => {
          app.logger.error("[vext dev] worker shutdown failed:", String(error));
          process.exit(1);
        },
      );
    };

    const sendOperationResult = async (
      requestId: string | undefined,
      result: WorkerOperationResult,
    ): Promise<void> => {
      if (!requestId || skipIpc || !process.send || !process.connected) return;
      await sendMessageToParent({
        type: "dev-operation-result",
        requestId,
        ...result,
      });
    };

    const executeOperation = async (
      operation: WorkerOperation,
      signal: AbortSignal,
    ): Promise<WorkerOperationResult> => {
      if (operation.operation === "reload") {
        const result = await softReloader!.reload(operation.files);
        signal.throwIfAborted();
        if (!result.success)
          return {
            success: false,
            requestedColdRestart: result.requestedColdRestart,
            error: (
              result.error ||
              (result.requestedColdRestart
                ? "cold restart required"
                : "reload failed")
            ).slice(0, 4096),
          };
        const event = createRenderReloadEvent(
          operation.files,
          frontendRuntimeConfig.dev.renderRefresh,
        );
        if (event) frontendDevEvents.publish(event);
        return { success: true };
      }
      try {
        const result = await buildFrontendClient({
          rootDir: projectRoot,
          config: config.frontend,
          mode: "development",
        });
        signal.throwIfAborted();
        frontendRuntimeConfig = result.config;
        if (!result.skipped) {
          app.logger.info(
            "[vext dev] frontend rebuilt: " +
              path.relative(projectRoot, result.config.outDir),
          );
          frontendDevEvents.publish(
            await createFrontendBuiltEvent(result, operation.files),
          );
        }
        return { success: true };
      } catch (error) {
        if (signal.aborted) throw error;
        const message =
          (error instanceof Error ? error.message : String(error)) ||
          "frontend rebuild failed";
        app.logger.error("[vext dev] frontend rebuild failed:", message);
        frontendDevEvents.publish({
          type: "frontend:error",
          action: "prompt",
          message,
          files: operation.files.map((file) => file.path),
        });
        return {
          success: false,
          requestedColdRestart: false,
          error: message.slice(0, 4096),
        };
      }
    };

    const onMessage = (msg: unknown) =>
      owner.run(() => {
        if (shutdownTask || typeof msg !== "object" || msg === null) return;
        const value = msg as Record<string, unknown>;
        if (value.type === "shutdown") {
          exitAfterShutdown();
          return;
        }
        const request = readWorkerOperationRequest(value);
        let operation: WorkerOperation | undefined = request ?? undefined;
        if (
          !operation &&
          (value.type === "reload" || value.type === "frontend-rebuild")
        ) {
          const files = readWorkerFiles(value.files ?? []);
          if (files && (value.type === "frontend-rebuild" || files.length > 0))
            operation = { operation: value.type, files };
        }
        if (!operation) return;
        const selected = operation;
        trackReload(
          operations
            .run((signal) => executeOperation(selected, signal))
            .then(
              (result) => sendOperationResult(request?.requestId, result),
              (error: unknown) => {
                const message =
                  (error instanceof Error ? error.message : String(error)) ||
                  "worker operation failed";
                app.logger.error(
                  "[vext dev] worker operation failed:",
                  message,
                );
                return sendOperationResult(request?.requestId, {
                  success: false,
                  error: message.slice(0, 4096),
                  requestedColdRestart: true,
                });
              },
            ),
        );
      });
    process.on("message", onMessage);

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

    const onSignal = exitAfterShutdown;
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
    startupCleanup = handleShutdown;

    // ── 步骤 15: 执行 onReady 钩子 ──────────────────────
    readyTask = Promise.resolve().then(() =>
      startupProfiler.time("worker.onReady", () => internals!.runReady()),
    );
    await readyTask;
    if (shutdownTask) {
      await shutdownTask;
      throw new Error("[vext dev] startup canceled by shutdown");
    }

    // ── 步骤 16: IPC 就绪通知 ────────────────────────────
    //
    // 通知主进程（ColdRestarter）子进程已完成初始化。
    // 放在 onReady 后发送，确保 parent 侧 startup summary 覆盖完整 ready 链路。
    //
    if (!skipIpc && process.send) {
      await sendMessageToParent({
        type: "ready",
        server: {
          host: serverHandle.host,
          port: serverHandle.port,
        },
        startupProfile: startupProfiler.toJSON(),
      });
    }

    restoreStartupLogger();
    restoreStartupLogger = undefined;

    if (!parentReadyLog) {
      printReadyLog(app.logger, serverHandle.host, serverHandle.port, {
        prefix: "[vext dev]",
        suffix: "(soft reload enabled)",
      });
    }

    return {
      app,
      server,
      serverHandle,
      internals,
      compiler,
      compileStats,
      hotHandler: hotHandler!,
      softReloader: softReloader!,
      close: handleShutdown,
    };
  } catch (err) {
    restoreStartupLogger?.();
    if (startupCleanup) {
      await startupCleanup();
      throw err;
    }

    // ── 错误边界：清理已分配的资源 ─────────────────────────
    //
    // 启动过程中任何步骤失败时的清理逻辑。
    // 确保不会泄漏端口、文件句柄、esbuild 进程等资源。
    //

    const cleanupFailures: unknown[] = [];
    if (server?.listening) {
      try {
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      } catch (error) {
        cleanupFailures.push(error);
      }
    }

    if (internals) {
      try {
        await internals.shutdown(undefined, { skipExit: true });
      } catch (error) {
        cleanupFailures.push(error);
      }
    }

    if (compiler) {
      try {
        await compiler.dispose();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }

    try {
      closeFrontendEvents?.();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length)
      throw new DevCleanupError([err, ...cleanupFailures]);
    // 资源已确认清理，才让外层释放 owner 并报告原始启动错误。
    throw err;
  }
}

function resolveConfiguredModelsDir(config: unknown): string | undefined {
  const database =
    typeof config === "object" && config !== null
      ? (config as Record<string, unknown>).database
      : undefined;
  if (typeof database !== "object" || database === null) {
    return undefined;
  }
  const models = (database as Record<string, unknown>).models;
  if (typeof models !== "object" || models === null) {
    return undefined;
  }
  const dir = (models as Record<string, unknown>).dir;
  return typeof dir === "string" ? dir : undefined;
}

function isFrontendEnabled(
  frontend:
    | import("../../frontend/contract/types.js").VextFrontendUserConfig
    | undefined,
): boolean {
  return (
    frontend === true ||
    (typeof frontend === "object" && frontend.enabled === true)
  );
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * 创建 404 兜底处理函数
 *
 * 与生产 bootstrap 保持一致的 404 响应格式。
 */
function createNotFoundHandler(hooks?: VextInternalHooks): VextMiddleware {
  return async (req, res, _next) => {
    if (hooks) {
      await emitNotFoundRequestHooks(hooks, req);
    }
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

function createCachedOpenApiSpecProvider(generate: () => object): () => object {
  let cached: object | null = null;
  return () => {
    cached ??= generate();
    return cached;
  };
}

/** 仍有未确认关闭的资源时，不释放 writer 身份给下一进程。 */
export class DevCleanupError extends AggregateError {
  constructor(errors: unknown[]) {
    super(errors, "[vext dev] cleanup incomplete; ownership remains protected");
    this.name = "DevCleanupError";
  }
}

import path from "node:path";

import type { DevCompiler } from "./compiler.js";
import type { HotSwappableHandler } from "./hot-swappable-handler.js";
import { invalidateAndEvict } from "./cache-invalidator.js";
import { reloadServices } from "./service-reloader.js";
import type { ServiceReloadResult } from "./service-reloader.js";
import { reloadRoutes } from "./route-reloader.js";
import type {
  RouteReloaderApp,
  RouteReloaderMiddleware,
  MiddlewareRegistry,
  AdapterResolver,
  RoutesLoader,
  ErrorHandlerFactory,
  NotFoundHandlerFactory,
  BuiltinMiddlewareCreators,
} from "./route-reloader.js";
import { reloadLocales, shouldReloadLocales } from "./i18n-reloader.js";
import type { ConfigureI18nFn } from "./i18n-reloader.js";
import { reportMemoryIfNeeded } from "./memory-monitor.js";
import type { MemoryReport } from "./memory-monitor.js";
import type { FileChangeInfo } from "./file-watcher.js";

/**
 * soft-reloader.ts — Soft Reload 完整流程编排器（Phase 2B）
 *
 * 封装 Soft Reload 的完整流程，包含：
 *
 *   1. 分级编译（Tier 1: transform 单文件 / Tier 2: rebuild 全量增量）
 *   2. require.cache 精确清除（反向依赖图 BFS）
 *   3. 级联爆炸检测（>80% 缓存失效 → 降级 Cold Restart）
 *   4. i18n 语言包热替换
 *   5. 中间件定义重载
 *   6. 选择性 Service 实例重载（仅 invalidated 的）
 *   7. 路由重载（Fresh Adapter 策略）
 *   8. requestHandler 原子替换（HotSwappableHandler.swap）
 *   9. 内存监控
 *
 * 并发保护（v2.2）：
 *   - reload 锁 + 待处理队列
 *   - 快速连续保存时自动合并变更文件
 *   - 当前 reload 完成后自动处理队列
 *
 * 降级策略：
 *   - Soft Reload 任何步骤失败 → 不调用 swap()，旧 handler 继续服务
 *   - 级联爆炸检测 → 通过 IPC 请求 Cold Restart
 *   - 编译错误 → 打印错误信息，等待用户修复后再次触发
 *
 * @module lib/dev/soft-reloader
 * @see 11b-soft-reload.md §7（完整流程伪代码）
 * @see 11d-bootstrap-cli.md §3（createApp reload 能力）
 * @see 11e-edge-cases.md §1（Reload 失败回退）
 * @see IMPLEMENTATION-PLAN.md 任务 2.8
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 最小化的 Logger 接口
 */
export interface SoftReloaderLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * 中间件加载函数类型
 *
 * 与 middleware-loader.ts 的 loadMiddlewares 签名兼容。
 */
export type MiddlewareLoader = (
  middlewaresDir: string,
  declarations: unknown[],
  logger: SoftReloaderLogger,
) => Promise<MiddlewareRegistry>;

/**
 * SoftReloader 依赖注入选项
 *
 * 所有外部依赖通过构造选项注入，便于单元测试和解耦。
 */
export interface SoftReloaderOptions {
  /** DevCompiler 实例（编译 + 路径映射） */
  compiler: DevCompiler;

  /** HotSwappableHandler 实例（原子替换 handler） */
  hotHandler: HotSwappableHandler;

  /** VextApp 实例（需要 services / logger / adapter / config） */
  app: RouteReloaderApp;

  /** 框架运行时配置 */
  config: Record<string, unknown>;

  /** Logger 实例 */
  logger: SoftReloaderLogger;

  /** Adapter 解析函数（创建全新 adapter 实例） */
  resolveAdapter: AdapterResolver;

  /** 路由加载函数 */
  loadRoutes: RoutesLoader;

  /** 中间件加载函数 */
  loadMiddlewares: MiddlewareLoader;

  /** 错误处理器工厂 */
  createErrorHandler: ErrorHandlerFactory;

  /** 404 处理器工厂 */
  createNotFoundHandler: NotFoundHandlerFactory;

  /** 内置中间件创建器集合 */
  builtinMiddlewares: BuiltinMiddlewareCreators;

  /**
   * i18n 配置回调（可选）
   *
   * 如果提供，soft reload 时会重新加载 locales/ 并调用此回调
   * 将新语言包注册到 schema-dsl。
   */
  configureI18n?: ConfigureI18nFn;

  /**
   * 获取插件全局中间件列表的函数
   *
   * 通常绑定为 () => internals.getGlobalMiddlewares()
   */
  getGlobalMiddlewares: () => RouteReloaderMiddleware[];
}

/**
 * Soft Reload 单次执行结果
 */
export interface SoftReloadResult {
  /** 是否成功 */
  success: boolean;

  /** 是否请求了 Cold Restart（级联爆炸） */
  requestedColdRestart: boolean;

  /** 总耗时（毫秒） */
  elapsed: number;

  /** 编译耗时（毫秒） */
  compileTime: number;

  /** 缓存清除耗时（毫秒） */
  cacheTime: number;

  /** i18n 重载耗时（毫秒） */
  i18nTime: number;

  /** 中间件重载耗时（毫秒） */
  middlewareTime: number;

  /** 服务重载耗时（毫秒） */
  serviceTime: number;

  /** 路由重载耗时（毫秒） */
  routeTime: number;

  /** handler 替换耗时（毫秒） */
  swapTime: number;

  /** 使用的 Tier（T1:code / T2:structural） */
  tier: "T1:code" | "T2:structural";

  /** 驱逐的模块数量 */
  evictedModules: number;

  /** 服务重载结果 */
  serviceResult?: ServiceReloadResult;

  /** 内存报告 */
  memoryReport?: MemoryReport;

  /** 错误信息（失败时） */
  error?: string;
}

// ── SoftReloader 类 ─────────────────────────────────────────

/**
 * SoftReloader — Soft Reload 编排器
 *
 * 核心职责：
 *   1. 编排 Soft Reload 的完整流程（7 个步骤）
 *   2. 管理并发保护（reload 锁 + 待处理队列）
 *   3. 提供降级策略（失败回退 + 级联检测）
 *
 * 使用方式（dev-bootstrap.ts 中创建）：
 *
 * ```ts
 * const softReloader = new SoftReloader({
 *   compiler,
 *   hotHandler,
 *   app,
 *   config,
 *   logger: app.logger,
 *   resolveAdapter,
 *   loadRoutes,
 *   loadMiddlewares,
 *   createErrorHandler,
 *   createNotFoundHandler,
 *   builtinMiddlewares,
 *   configureI18n,
 *   getGlobalMiddlewares: () => internals.getGlobalMiddlewares(),
 * });
 *
 * // IPC 消息中调用
 * process.on('message', async (msg) => {
 *   if (msg.type === 'reload') {
 *     await softReloader.reload(msg.files);
 *   }
 * });
 * ```
 */
export class SoftReloader {
  private readonly compiler: DevCompiler;
  private readonly hotHandler: HotSwappableHandler;
  private readonly app: RouteReloaderApp;
  private readonly config: Record<string, unknown>;
  private readonly logger: SoftReloaderLogger;
  private readonly resolveAdapterFn: AdapterResolver;
  private readonly loadRoutesFn: RoutesLoader;
  private readonly loadMiddlewaresFn: MiddlewareLoader;
  private readonly createErrorHandlerFn: ErrorHandlerFactory;
  private readonly createNotFoundHandlerFn: NotFoundHandlerFactory;
  private readonly builtinMiddlewares: BuiltinMiddlewareCreators;
  private readonly configureI18n?: ConfigureI18nFn;
  private readonly getGlobalMiddlewares: () => RouteReloaderMiddleware[];

  /**
   * v2.2 并发锁 — 防止多次 softReload 并行执行
   *
   * 当 reload() 正在执行时，后续的 reload() 调用将变更文件
   * 暂存到待处理队列中，当前 reload 完成后自动处理队列。
   */
  private reloadLock = false;

  /**
   * 待处理的变更文件队列
   *
   * 在 reloadLock 为 true 时，新的变更文件被暂存到此队列。
   * 当前 reload 完成后取出并执行。
   *
   * 合并策略：按 path 去重，保留最新的 type。
   */
  private pendingReload: FileChangeInfo[] | null = null;

  /**
   * 累计成功 reload 次数
   */
  private successCount = 0;

  /**
   * 累计失败 reload 次数
   */
  private failureCount = 0;

  constructor(options: SoftReloaderOptions) {
    this.compiler = options.compiler;
    this.hotHandler = options.hotHandler;
    this.app = options.app;
    this.config = options.config;
    this.logger = options.logger;
    this.resolveAdapterFn = options.resolveAdapter;
    this.loadRoutesFn = options.loadRoutes;
    this.loadMiddlewaresFn = options.loadMiddlewares;
    this.createErrorHandlerFn = options.createErrorHandler;
    this.createNotFoundHandlerFn = options.createNotFoundHandler;
    this.builtinMiddlewares = options.builtinMiddlewares;
    this.configureI18n = options.configureI18n;
    this.getGlobalMiddlewares = options.getGlobalMiddlewares;
  }

  // ── 公开方法 ──────────────────────────────────────────────

  /**
   * reload — Soft Reload 入口（含并发保护）
   *
   * 如果当前正在 reload，将变更暂存到队列中等待。
   * 当前 reload 完成后自动取出队列中的变更并执行。
   *
   * @param changedFiles 变更文件信息列表
   * @returns 最后一次 reload 的结果
   */
  async reload(changedFiles: FileChangeInfo[]): Promise<SoftReloadResult> {
    // ── 并发保护：合并到待处理队列 ──────────────────────
    if (this.reloadLock) {
      if (this.pendingReload) {
        // 按 path 去重，保留最新的 type
        const map = new Map(this.pendingReload.map((f) => [f.path, f]));
        for (const f of changedFiles) {
          map.set(f.path, f);
        }
        this.pendingReload = [...map.values()];
      } else {
        this.pendingReload = [...changedFiles];
      }
      this.logger.debug(
        `[hot-reload] reload in progress, queued ${changedFiles.length} file(s)`,
      );
      // 返回一个"已排队"的占位结果
      return {
        success: true,
        requestedColdRestart: false,
        elapsed: 0,
        compileTime: 0,
        cacheTime: 0,
        i18nTime: 0,
        middlewareTime: 0,
        serviceTime: 0,
        routeTime: 0,
        swapTime: 0,
        tier: "T1:code",
        evictedModules: 0,
      };
    }

    this.reloadLock = true;
    let lastResult: SoftReloadResult;

    try {
      lastResult = await this.doSoftReload(changedFiles);

      // ── 处理待处理队列 ────────────────────────────────
      while (this.pendingReload !== null) {
        const next = this.pendingReload;
        this.pendingReload = null;
        this.logger.info(
          `[hot-reload] processing queued changes: ${next.length} file(s)`,
        );
        lastResult = await this.doSoftReload(next);
      }

      return lastResult;
    } finally {
      this.reloadLock = false;
    }
  }

  /**
   * 获取累计成功 reload 次数
   */
  getSuccessCount(): number {
    return this.successCount;
  }

  /**
   * 获取累计失败 reload 次数
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * 检查当前是否正在 reload
   */
  isReloading(): boolean {
    return this.reloadLock;
  }

  /**
   * 检查是否有待处理的变更
   */
  hasPendingChanges(): boolean {
    return this.pendingReload !== null;
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * doSoftReload — 实际执行 Soft Reload（完整 7 步流程）
   *
   * 流程：
   *   0. 分级编译：modify → compileSingle (Tier 1, O(1))
   *                add/delete → rebuildWithNewEntryPoints (Tier 2, O(N))
   *   1. 清除 require.cache（编译产物及其依赖者）
   *   2. 重载 i18n（如变更包含 locales/）
   *   3. 重载 middleware definitions
   *   4. 选择性重载 services（仅 invalidated 的实例）
   *   5. 创建新 adapter 实例 + 重载 routes + buildHandler
   *   6. 原子替换 handler
   *   7. 内存监控
   *
   * 保持不变的：app、config、plugins、DB 连接、server socket、未变更的 service 实例
   *
   * @param changedFiles 变更文件信息列表（FileChangeInfo[]）
   * @returns 单次 reload 结果
   */
  private async doSoftReload(
    changedFiles: FileChangeInfo[],
  ): Promise<SoftReloadResult> {
    const startTime = performance.now();
    let compileEnd = startTime;
    let cacheEnd = startTime;
    let i18nEnd = startTime;
    let mwEnd = startTime;
    let svcEnd = startTime;
    let routeEnd = startTime;
    let swapEnd = startTime;

    const hasStructuralChange = changedFiles.some(
      (f) => f.type === "add" || f.type === "delete",
    );
    const tier: "T1:code" | "T2:structural" = hasStructuralChange
      ? "T2:structural"
      : "T1:code";

    try {
      // ── Step 0: 分级编译 ────────────────────────────────

      if (hasStructuralChange) {
        // Tier 2: 结构变更 → 重建 esbuild context + 全量增量编译
        await this.compiler.rebuildWithNewEntryPoints();
      } else {
        // Tier 1: 代码变更 → 单文件编译（O(1)，与项目大小无关）
        const projectRoot = this.compiler.getProjectRoot();
        const srcFiles = changedFiles
          .filter((f) => f.path.startsWith("src/"))
          .map((f) => path.resolve(projectRoot, f.path));

        if (srcFiles.length > 0) {
          await this.compiler.compileFiles(srcFiles);
        }
      }
      compileEnd = performance.now();

      // ── Step 1: 清除 require.cache ──────────────────────

      const outDir = this.compiler.getOutDir();
      const filePaths = changedFiles.map((f) => f.path);
      const compiledFiles = filePaths.map((f) =>
        this.compiler.resolveCompiled(f),
      );

      const cacheResult = invalidateAndEvict(compiledFiles, outDir);

      // 级联检测：失效集合 > 80% 缓存 → 降级 Cold Restart
      if (cacheResult.cascadeDetected) {
        this.logger.warn(
          "[hot-reload] invalidation cascade too large " +
            `(${cacheResult.invalidated.size} modules), requesting cold restart`,
        );
        process.send?.({
          type: "request-cold-restart",
          reason: "cascade too large",
        });

        this.failureCount++;
        const elapsed = performance.now() - startTime;
        return {
          success: false,
          requestedColdRestart: true,
          elapsed,
          compileTime: compileEnd - startTime,
          cacheTime: elapsed - (compileEnd - startTime),
          i18nTime: 0,
          middlewareTime: 0,
          serviceTime: 0,
          routeTime: 0,
          swapTime: 0,
          tier,
          evictedModules: 0,
        };
      }

      cacheEnd = performance.now();

      // ── Step 2: 重载 i18n ───────────────────────────────

      if (shouldReloadLocales(filePaths)) {
        await reloadLocales({
          outDir,
          logger: this.logger,
          configureI18n: this.configureI18n,
        });
      }
      i18nEnd = performance.now();

      // ── Step 3: 重载 middleware definitions ──────────────

      const middlewareDefs = await this.loadMiddlewaresFn(
        path.join(outDir, "middlewares"),
        (this.config.middlewares as unknown[]) ?? [],
        this.logger,
      );
      mwEnd = performance.now();

      // ── Step 4: 选择性重载 services ─────────────────────

      const serviceResult = await reloadServices(
        this.app,
        outDir,
        cacheResult.invalidated,
      );
      svcEnd = performance.now();

      // ── Step 5: 创建新 adapter + 重载 routes ────────────

      const globalMiddlewares = this.getGlobalMiddlewares();
      const routeResult = await reloadRoutes({
        app: this.app,
        outDir,
        middlewareDefs,
        globalMiddlewares,
        resolveAdapter: this.resolveAdapterFn,
        loadRoutes: this.loadRoutesFn,
        createErrorHandler: this.createErrorHandlerFn,
        createNotFoundHandler: this.createNotFoundHandlerFn,
        builtinMiddlewares: this.builtinMiddlewares,
      });
      routeEnd = performance.now();

      // ── Step 6: 原子替换 ────────────────────────────────

      this.hotHandler.swap(routeResult.handler);
      swapEnd = performance.now();

      // ── Step 7: 性能报告 + 内存监控 ─────────────────────

      const elapsed = swapEnd - startTime;
      const reloadCount = this.hotHandler.getReloadCount();

      this.logger.info(
        `[hot-reload] [OK] ${elapsed.toFixed(0)}ms [${tier}] ` +
          `(compile:${(compileEnd - startTime).toFixed(0)}ms ` +
          `cache:${(cacheEnd - compileEnd).toFixed(0)}ms ` +
          `i18n:${(i18nEnd - cacheEnd).toFixed(0)}ms ` +
          `mw:${(mwEnd - i18nEnd).toFixed(0)}ms ` +
          `svc:${(svcEnd - mwEnd).toFixed(0)}ms ` +
          `route:${(routeEnd - svcEnd).toFixed(0)}ms ` +
          `swap:${(swapEnd - routeEnd).toFixed(0)}ms) ` +
          `[${cacheResult.evicted} modules evicted] ` +
          `#${reloadCount}`,
      );

      // 内存监控
      const memoryReport = reportMemoryIfNeeded(reloadCount);

      this.successCount++;

      return {
        success: true,
        requestedColdRestart: false,
        elapsed,
        compileTime: compileEnd - startTime,
        cacheTime: cacheEnd - compileEnd,
        i18nTime: i18nEnd - cacheEnd,
        middlewareTime: mwEnd - i18nEnd,
        serviceTime: svcEnd - mwEnd,
        routeTime: routeEnd - svcEnd,
        swapTime: swapEnd - routeEnd,
        tier,
        evictedModules: cacheResult.evicted,
        serviceResult,
        memoryReport,
      };
    } catch (err) {
      // ── 失败回退 ────────────────────────────────────────
      //
      // Soft Reload 的任何步骤失败时：
      //   1. 不调用 swap() — 旧 handler 通过闭包继续服务
      //   2. 打印错误信息
      //   3. 等待用户修复后再次触发
      //
      // 这是设计文档 11e §1 描述的"失败回退机制"：
      //   "如果 soft reload 的任何步骤失败，不调用 swap()，
      //    旧 handler 通过闭包继续服务。"
      //

      const elapsed = performance.now() - startTime;

      this.logger.error(
        `[hot-reload] [FAIL] failed after ${elapsed.toFixed(0)}ms: ${(err as Error).message}`,
      );
      this.logger.error(
        "[hot-reload] keeping previous version active. Fix the error and save again.",
      );

      this.failureCount++;

      return {
        success: false,
        requestedColdRestart: false,
        elapsed,
        compileTime: compileEnd - startTime,
        cacheTime: cacheEnd - compileEnd,
        i18nTime: i18nEnd - cacheEnd,
        middlewareTime: mwEnd - i18nEnd,
        serviceTime: svcEnd - mwEnd,
        routeTime: routeEnd - svcEnd,
        swapTime: 0,
        tier,
        evictedModules: 0,
        error: (err as Error).message,
      };
    }
  }
}

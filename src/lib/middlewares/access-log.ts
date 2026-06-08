import type { VextMiddleware } from "../../types/middleware.js";
import type { VextAccessLogConfig } from "../../types/app.js";
import type { VextLogger } from "../../types/app.js";

/**
 * formatBytes — 将字节数格式化为人类可读的字符串
 *
 * @param bytes 字节数
 * @returns 格式化后的字符串，如 "1.2kB"、"3.4MB"
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * createAccessLogMiddleware — Access Log 中间件工厂
 *
 * 内置中间件 #6（response-wrapper 之后），职责：
 *   利用洋葱模型 after-middleware 模式，在 `await next()` 前记录请求开始时间，
 *   在 `await next()` 后记录请求耗时、HTTP 状态码、方法、路径、客户端 IP。
 *
 * 配置项（config.accessLog）：
 *   - enabled:          是否启用（默认 true）；false 时直接跳过，零开销
 *   - level:            日志输出级别（默认 'info'）；可设为 'debug' 由 logger.level 初始阈值或 setLevel() 统一控制
 *   - skipPaths:        精确匹配跳过的路径列表（如 ['/health', '/ready']），减少日志噪音
 *   - skipPathPrefixes: 前缀匹配跳过的路径列表（如 ['/internal']），跳过整个路径树
 *   - slowThreshold:    慢请求阈值（毫秒），超过时自动提升为 warn 级别并标记 [SLOW]
 *   - warnOn4xx:        是否将 4xx 响应提升为 warn 级别（默认 false）
 *   - logResponseSize:  是否在日志中追加 Content-Length（默认 false）
 *
 * 执行位置（中间件链注册顺序）：
 *   requestId → cors → body-parser → rateLimit → response-wrapper → 【access-log】
 *   → 插件全局中间件 → 路由级中间件 → validate → handler
 *
 * 时序保证：
 *   - requestId 中间件在 access-log 之前执行，req.requestId 已填充
 *   - 洋葱回程时 handler 已执行完毕，res.statusCode 已确定
 *
 * 日志格式（紧凑单行）：
 *   开发模式（pretty）：
 *     [17:53:26.174] INFO: GET / 200 1ms | 127.0.0.1
 *     [17:53:28.120] ERROR: POST /api/pay 500 312ms | 10.0.0.5
 *     [17:53:30.500] WARN: GET /api/reports 200 5231ms | 10.0.0.1 [SLOW]
 *     [17:53:31.200] INFO: GET /api/users 200 3ms | 127.0.0.1 [1.2kB]
 *   生产模式（JSON）：
 *     {"level":30,"time":"...","requestId":"...","msg":"GET / 200 1ms | 127.0.0.1"}
 *     {"level":50,"time":"...","requestId":"...","msg":"POST /api/pay 500 312ms | 10.0.0.5"}
 *
 *   requestId 由 logger mixin（AsyncLocalStorage）自动注入，无需在此重复传入。
 *   这样避免了 pretty 模式下将结构化字段展开为多行的问题。
 *
 * @param config Access Log 配置（从 VextConfig.accessLog 提取）
 * @param logger VextLogger 实例（框架 app.logger）
 * @returns VextMiddleware
 */
export function createAccessLogMiddleware(
  config: VextAccessLogConfig,
  logger: VextLogger,
): VextMiddleware {
  const enabled = config.enabled ?? true;
  const baseLevel = config.level ?? "info";
  const skipPaths = config.skipPaths ?? [];
  const skipPathPrefixes = config.skipPathPrefixes ?? [];
  const slowThreshold = config.slowThreshold ?? 0;
  const warnOn4xx = config.warnOn4xx ?? false;
  const logResponseSize = config.logResponseSize ?? false;

  // 预计算 skipPaths Set 以提升查找性能（O(1) vs O(n)）
  const skipSet: Set<string> =
    skipPaths.length > 0 ? new Set(skipPaths) : new Set();

  // 预分配 skipPathPrefixes 数组副本，避免运行时引用外部可变数据
  const prefixes: string[] =
    skipPathPrefixes.length > 0 ? [...skipPathPrefixes] : [];

  // 选择 logger 方法（避免每次请求动态查找）— 预绑定基础级别和提升级别
  const logInfo: VextLogger["info"] =
    baseLevel === "debug"
      ? logger.debug.bind(logger)
      : logger.info.bind(logger);
  const logWarn: VextLogger["warn"] = logger.warn.bind(logger);
  const logError: VextLogger["error"] = logger.error.bind(logger);

  // 预计算：是否需要进行前缀匹配检查
  const hasPrefixes = prefixes.length > 0;

  // 预计算：是否启用了慢请求检测
  const hasSlowThreshold = slowThreshold > 0;

  return async (req, res, next) => {
    // ── 快速跳过 ───────────────────────────────────────
    if (!enabled) {
      await next();
      return;
    }

    // 跳过指定路径（精确匹配）
    if (skipSet.size > 0 && skipSet.has(req.path)) {
      await next();
      return;
    }

    // 跳过指定路径前缀（前缀匹配）
    if (hasPrefixes) {
      let shouldSkip = false;
      for (let i = 0; i < prefixes.length; i++) {
        if (req.path.startsWith(prefixes[i]!)) {
          shouldSkip = true;
          break;
        }
      }
      if (shouldSkip) {
        await next();
        return;
      }
    }

    // ── before: 记录开始时间 ────────────────────────────
    const startTime = Date.now();

    // ── 执行下游中间件 + handler ─────────────────────────
    await next();

    // ── after: 记录耗时 + 状态码（紧凑单行格式）─────────
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;

    // ── 构建紧凑单行消息 ─────────────────────────────────
    // 基础格式：METHOD PATH STATUS TIMEms | IP
    // requestId 由 logger mixin 从 AsyncLocalStorage 自动注入，无需重复传入
    let msg = `${req.method} ${req.path} ${statusCode} ${responseTime}ms | ${req.ip}`;

    // 可选：追加 Content-Length
    // VextResponse 接口不暴露 getHeader，通过运行时检查底层实现
    if (logResponseSize) {
      const resAny = res as unknown as Record<string, unknown>;
      const getHeaderFn =
        typeof resAny.getHeader === "function"
          ? (resAny.getHeader as (
              name: string,
            ) => string | number | string[] | undefined)
          : typeof resAny._serverResponse === "object" &&
              resAny._serverResponse !== null &&
              typeof (resAny._serverResponse as Record<string, unknown>)
                .getHeader === "function"
            ? (
                (resAny._serverResponse as Record<string, unknown>)
                  .getHeader as (
                  name: string,
                ) => string | number | string[] | undefined
              ).bind(resAny._serverResponse)
            : null;

      if (getHeaderFn) {
        const contentLength = getHeaderFn("content-length");
        if (contentLength !== undefined) {
          const bytes =
            typeof contentLength === "string"
              ? parseInt(contentLength, 10)
              : typeof contentLength === "number"
                ? contentLength
                : 0;
          msg += ` [${bytes > 0 ? formatBytes(bytes) : "-"}]`;
        }
      }
    }

    // ── 确定日志级别 ─────────────────────────────────────
    //
    // 级别优先级（从高到低）：
    //   1. 5xx → 始终 error（服务端错误不可忽略）
    //   2. 慢请求 → warn（如果超过 slowThreshold）
    //   3. 4xx + warnOn4xx → warn（可选的客户端错误提升）
    //   4. 其他 → 配置的 baseLevel（info 或 debug）
    //

    if (statusCode >= 500) {
      // 5xx 始终提升为 error —— 服务端错误必须醒目
      logError(msg);
    } else if (hasSlowThreshold && responseTime > slowThreshold) {
      // 慢请求标记 —— 响应时间超过阈值
      logWarn(`${msg} [SLOW]`);
    } else if (warnOn4xx && statusCode >= 400) {
      // 4xx 可选提升为 warn
      logWarn(msg);
    } else {
      // 正常请求 —— 使用配置的基础级别
      logInfo(msg);
    }
  };
}

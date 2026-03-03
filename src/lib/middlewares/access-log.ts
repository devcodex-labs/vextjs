import type { VextMiddleware } from "../../types/middleware.js";
import type { VextAccessLogConfig } from "../../types/app.js";
import type { VextLogger } from "../../types/app.js";

/**
 * createAccessLogMiddleware — Access Log 中间件工厂
 *
 * 内置中间件 #6（response-wrapper 之后），职责：
 *   利用洋葱模型 after-middleware 模式，在 `await next()` 前记录请求开始时间，
 *   在 `await next()` 后记录请求耗时、HTTP 状态码、方法、路径、requestId、客户端 IP。
 *
 * 配置项（config.accessLog）：
 *   - enabled:   是否启用（默认 true）；false 时直接跳过，零开销
 *   - level:     日志输出级别（默认 'info'）；可设为 'debug' 由 logger.level 统一控制
 *   - skipPaths: 精确匹配跳过的路径列表（如 ['/health', '/ready']），减少日志噪音
 *
 * 执行位置（中间件链注册顺序）：
 *   requestId → cors → body-parser → rateLimit → response-wrapper → 【access-log】
 *   → 插件全局中间件 → 路由级中间件 → validate → handler
 *
 * 时序保证：
 *   - requestId 中间件在 access-log 之前执行，req.requestId 已填充
 *   - 洋葱回程时 handler 已执行完毕，res.statusCode 已确定
 *
 * 日志字段：
 *   - method:       HTTP 方法（GET / POST / ...）
 *   - path:         请求路径（不含 query string）
 *   - statusCode:   HTTP 响应状态码
 *   - responseTime: 请求处理耗时（毫秒，保留整数）
 *   - requestId:    请求唯一标识
 *   - ip:           客户端 IP
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
  const level = config.level ?? "info";
  const skipPaths = config.skipPaths ?? [];

  // 预计算 skipPaths Set 以提升查找性能（O(1) vs O(n)）
  const skipSet: Set<string> =
    skipPaths.length > 0 ? new Set(skipPaths) : new Set();

  // 选择 logger 方法（避免每次请求动态查找）
  const log: VextLogger["info"] | VextLogger["debug"] =
    level === "debug" ? logger.debug.bind(logger) : logger.info.bind(logger);

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

    // ── before: 记录开始时间 ────────────────────────────
    const startTime = Date.now();

    // ── 执行下游中间件 + handler ─────────────────────────
    await next();

    // ── after: 记录耗时 + 状态码 ────────────────────────
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;

    log(
      {
        method: req.method,
        path: req.path,
        statusCode,
        responseTime,
        requestId: req.requestId,
        ip: req.ip,
      },
      `${req.method} ${req.path} ${statusCode} ${responseTime}ms`,
    );
  };
}

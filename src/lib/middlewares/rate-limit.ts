import { RateLimiter } from "flex-rate-limit";
import type { VextMiddleware } from "../../types/middleware.js";
import type {
  RouteOptions,
  VextRateLimitConfig,
  VextRateLimiter,
} from "../../types/app.js";
import type { VextRequest } from "../../types/request.js";

/**
 * createRateLimitMiddleware — 速率限制中间件工厂
 *
 * 内置中间件 #4，职责：
 *   1. 对每个请求进行速率限制检查（基于 IP / user / 自定义 key）
 *   2. 超过限制时返回 429 Too Many Requests
 *   3. 在响应头中注入标准速率限制信息（RateLimit-* headers）
 *
 * 配置项（config.rateLimit）：
 *   - enabled:  是否启用速率限制（默认 true）；false 时跳过所有限流检查
 *   - max:      每个时间窗口内最大请求数（默认 100）
 *   - window:   时间窗口（秒，默认 60）
 *   - message:  超过限制时的错误消息（默认 'Too Many Requests'）
 *   - keyBy:    限流维度（默认 'ip'）：
 *                 'ip'   → 按客户端 IP
 *                 'user' → 按 req.user?.id（需 auth 中间件先行）
 *                 函数   → 自定义 key 生成（(req) => string）
 *
 * 默认实现：flex-rate-limit（sliding-window 算法 + 内存存储）
 *
 * 可替换：通过 app.setRateLimiter(limiter) 替换为自定义实现。
 *   自定义 limiter 需实现 VextRateLimiter 接口：
 *     { check(key: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> }
 *
 *   当 app.setRateLimiter() 被调用后，本中间件将使用自定义 limiter.check()
 *   代替内置 flex-rate-limit，但 keyBy / enabled / message 等配置仍然生效。
 *
 * 响应头（遵循 IETF RateLimit Header Fields 草案 delay-seconds 语义）：
 *   - RateLimit-Limit:     窗口期最大请求数
 *   - RateLimit-Remaining: 窗口期剩余请求数
 *   - RateLimit-Reset:     距窗口重置的剩余秒数（delay-seconds，非绝对 Unix 时间）
 *   - Retry-After:         超限时，客户端应等待的秒数（仅 429 响应）
 *
 * @param config       rateLimit 配置（从 VextConfig.rateLimit 提取）
 * @param getRateLimiter 获取当前自定义 limiter 的 getter（支持 app.setRateLimiter() 运行时替换）
 * @returns VextMiddleware
 */
export function createRateLimitMiddleware(
  config: VextRateLimitConfig,
  getRateLimiter: () => VextRateLimiter | null,
): VextMiddleware {
  // ── 创建内置 flex-rate-limit 实例池 ───────────────────────
  //
  // 使用 sliding-window 算法（默认）+ 内存存储（默认）。
  // route-level override 可修改 max/window，因此按配置缓存实例。
  //
  const builtinLimiters = new Map<string, RateLimiter>();

  const getBuiltinLimiter = (max: number, windowSec: number): RateLimiter => {
    const limiterKey = `${max}:${windowSec}`;
    let limiter = builtinLimiters.get(limiterKey);
    if (!limiter) {
      limiter = new RateLimiter({
        windowMs: windowSec * 1000,
        max,
        algorithm: "sliding-window",
        store: "memory",
        headers: false, // 我们自己写响应头，不依赖 flex-rate-limit 的中间件行为
      });
      builtinLimiters.set(limiterKey, limiter);
    }
    return limiter;
  };

  return async (req, res, next) => {
    const effectiveConfig = resolveEffectiveConfig(config, req);

    // ── 未启用直接跳过 ──────────────────────────────────
    if (!effectiveConfig) {
      await next();
      return;
    }

    const max = effectiveConfig.max;
    const windowSec = effectiveConfig.window;
    const message = effectiveConfig.message;
    const keyBy = effectiveConfig.keyBy;

    // ── 生成限流 key ────────────────────────────────────
    const key = resolveKey(req, keyBy);

    // ── 执行限流检查 ────────────────────────────────────
    const customLimiter = getRateLimiter();
    let allowed: boolean;
    let remaining: number;
    let resetAtUnix: number; // absolute Unix timestamp (seconds)

    if (customLimiter) {
      // ── 使用自定义 limiter（app.setRateLimiter() 注入）──
      const result = await customLimiter.check(key);
      allowed = result.allowed;
      remaining = result.remaining;
      resetAtUnix = result.resetAt;
    } else {
      // ── 使用内置 flex-rate-limit ──────────────────────
      const builtinLimiter = getBuiltinLimiter(max, windowSec);
      const result = await builtinLimiter.check(key, { req });
      allowed = result.allowed;
      remaining = Math.max(0, result.remaining);
      // flex-rate-limit 的 resetTime 是毫秒级 Unix 时间戳
      resetAtUnix = Math.ceil(result.resetTime / 1000);
    }

    // Public RateLimit-Reset uses delay-seconds (IETF draft), not absolute time.
    // Absolute timestamps differ across link/packed consumer runs and break
    // semantic parity; remaining-seconds stays stable for the same window.
    const nowSec = Math.ceil(Date.now() / 1000);
    const resetDelaySec = Math.max(0, resetAtUnix - nowSec);

    // ── 注入响应头（无论是否超限都写入）─────────────────
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetDelaySec));

    // ── 超限处理 → 429 ─────────────────────────────────
    if (!allowed) {
      const retryAfter = Math.max(1, resetDelaySec);
      res.setHeader("Retry-After", String(retryAfter));

      res.rawJson(
        {
          code: 429,
          message,
          requestId: req.requestId,
        },
        429,
      );
      return;
    }

    // ── 通过，继续中间件链 ──────────────────────────────
    await next();
  };
}

function resolveEffectiveConfig(
  config: VextRateLimitConfig,
  req: VextRequest,
): Required<
  Pick<VextRateLimitConfig, "enabled" | "max" | "window" | "message" | "keyBy">
> | null {
  const routeOptions = (req as Record<string, unknown>)._routeOptions as
    | RouteOptions
    | undefined;
  const routeOverride = routeOptions?.override?.rateLimit;

  if (routeOverride === false) {
    return null;
  }

  const merged =
    routeOverride && typeof routeOverride === "object"
      ? { ...config, ...routeOverride }
      : config;

  const enabled = merged.enabled ?? true;
  if (!enabled) {
    return null;
  }

  return {
    enabled,
    max: merged.max ?? 100,
    window: merged.window ?? 60,
    message: merged.message ?? "Too Many Requests",
    keyBy: merged.keyBy ?? "ip",
  };
}

/**
 * resolveKey — 根据 keyBy 配置解析限流 key
 *
 * @param req   VextRequest 实例
 * @param keyBy 限流维度配置
 * @returns 限流 key 字符串
 */
function resolveKey(
  req: VextRequest,
  keyBy: string | ((req: VextRequest) => string),
): string {
  // 函数模式：自定义 key 生成
  if (typeof keyBy === "function") {
    return keyBy(req);
  }

  switch (keyBy) {
    case "user": {
      // 需要 auth 中间件先行注入 req.user
      const user = (req as Record<string, any>).user as
        | { id?: string | number }
        | undefined;
      if (user?.id != null) {
        return `user:${user.id}`;
      }
      // fallback 到 IP（用户未认证时）
      return `ip:${req.ip}`;
    }
    default:
      return `ip:${req.ip}`;
  }
}

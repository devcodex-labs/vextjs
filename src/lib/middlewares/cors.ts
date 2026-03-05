import type { VextMiddleware } from "../../types/middleware.js";
import type { VextCorsConfig } from "../../types/app.js";

/**
 * createCorsMiddleware — CORS 跨域中间件工厂
 *
 * 内置中间件 #2，职责：
 *   1. 处理 OPTIONS preflight 请求 — 直接返回 204（不进入后续中间件链）
 *   2. 为所有响应注入 CORS 相关头（Access-Control-Allow-Origin 等）
 *
 * 配置项（config.cors）：
 *   - enabled:     是否启用 CORS（默认 true）；false 时跳过所有 CORS 处理
 *   - origins:     允许的 Origin 列表（默认 ['*']）；'*' 允许所有来源
 *   - methods:     允许的 HTTP 方法列表（默认常用 7 种方法）
 *   - headers:     允许的请求头列表（默认 ['Content-Type', 'Authorization']）
 *   - credentials: 是否允许携带 Cookie（默认 false）
 *   - maxAge:      preflight 缓存时间（秒，默认 86400 = 24 小时）
 *
 * Origin 匹配逻辑：
 *   - origins 包含 '*'：直接设置 Access-Control-Allow-Origin: *
 *     （credentials = true 时降级为回显请求 Origin，因为 '*' 与 credentials 不兼容）
 *   - origins 为具体域名列表：检查请求 Origin 是否在列表中，
 *     匹配则回显该 Origin，不匹配则不设置 CORS 头（浏览器会拒绝）
 *
 * 禁用内置 CORS 后的自定义方式：
 *   若需要更复杂的 CORS 逻辑（如动态 Origin 校验、按租户区分），
 *   可通过插件使用 app.use() 注册自定义 CORS 中间件并将 cors.enabled 设为 false。
 *
 * @param config CORS 配置（从 VextConfig.cors 提取）
 * @returns VextMiddleware
 */
export function createCorsMiddleware(config: VextCorsConfig): VextMiddleware {
  const enabled = config.enabled ?? true;
  const origins = config.origins ?? ["*"];
  const methods = config.methods ?? [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ];
  const allowHeaders = config.headers ?? ["Content-Type", "Authorization"];
  const credentials = config.credentials ?? false;
  const maxAge = config.maxAge ?? 86400;

  // 预计算不变的头值字符串，避免每次请求重复 join
  const methodsStr = methods.join(", ");
  const headersStr = allowHeaders.join(", ");
  const maxAgeStr = String(maxAge);

  // 是否为通配符模式
  const isWildcard = origins.includes("*");

  // 将 origins 转为 Set 提升查找性能（非通配符模式）
  const originsSet = isWildcard ? null : new Set(origins);

  return async (req, res, next) => {
    if (!enabled) {
      await next();
      return;
    }

    const requestOrigin = req.headers.origin;

    // ── 计算 Access-Control-Allow-Origin 的值 ─────────────
    //
    // 规则：
    //   1. 通配符 + 无 credentials → 直接 '*'
    //   2. 通配符 + credentials   → 回显请求 Origin（'*' 与 credentials 不兼容，RFC 6454）
    //   3. 具体列表              → 匹配则回显，不匹配则不设置（浏览器会拒绝）
    //
    let allowOrigin: string | null = null;

    if (isWildcard) {
      if (credentials && requestOrigin) {
        // credentials 模式不允许 '*'，回显请求 Origin
        allowOrigin = requestOrigin;
      } else {
        allowOrigin = "*";
      }
    } else if (requestOrigin && originsSet!.has(requestOrigin)) {
      allowOrigin = requestOrigin;
    }

    // 如果 Origin 不在允许列表中，仍然执行后续中间件（只是不设置 CORS 头）
    if (!allowOrigin) {
      await next();
      return;
    }

    // ── 注入 CORS 响应头（对所有请求生效）────────────────
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);

    if (credentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    // Vary: Origin — 当 Allow-Origin 不是 '*' 时，通知缓存需按 Origin 区分
    // 这确保 CDN / 浏览器缓存不会将 A 域的 CORS 响应错误地返回给 B 域
    if (allowOrigin !== "*") {
      res.setHeader("Vary", "Origin");
    }

    // ── Preflight 请求处理（OPTIONS）─────────────────────
    if (req.method === "OPTIONS") {
      // preflight 额外需要这些头
      res.setHeader("Access-Control-Allow-Methods", methodsStr);
      res.setHeader("Access-Control-Allow-Headers", headersStr);
      res.setHeader("Access-Control-Max-Age", maxAgeStr);

      // 直接返回 204 No Content，不进入后续中间件链
      // preflight 不需要响应体，204 是标准做法
      res.status(204).text("");
      return;
    }

    // ── 非 preflight 请求：继续中间件链 ──────────────────
    await next();
  };
}

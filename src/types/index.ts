// ── 中间件类型 ──────────────────────────────────────────────
export type {
  VextMiddleware,
  VextErrorMiddleware,
  VextHandler,
  VextDefinedMiddleware,
  VextMiddlewareFactory,
  VextMiddlewareExport,
} from "./middleware.js";

export { MIDDLEWARE_SYMBOL, MIDDLEWARE_FACTORY_SYMBOL } from "./middleware.js";

// ── 请求 / 响应类型 ────────────────────────────────────────
export type { VextRequest, ParsedFile } from "./request.js";
export type { VextResponse, VextPublicResponse } from "./response.js";

// ── 错误类型 ────────────────────────────────────────────────
export { HttpError, VextValidationError } from "./errors.js";
export type { VextValidationFieldError } from "./errors.js";

// ── Adapter 类型 ────────────────────────────────────────────
export type { VextAdapter, VextServerHandle } from "./adapter.js";

// ── App / Config / Services 类型 ────────────────────────────
export type {
  VextApp,
  VextServices,
  VextLogger,
  VextRateLimiter,
  VextValidator,
  VextConfig,
  VextUserConfig,
  VextMiddlewareDecl,
  VextMiddlewareConfig,
  VextCorsConfig,
  VextRateLimitConfig,
  VextRequestIdConfig,
  VextLoggerConfig,
  VextShutdownConfig,
  VextResponseConfig,
  VextLogErrorsConfig,
  VextOpenAPIConfig,
  VextBodyParserConfig,
  VextAccessLogConfig,
  VextClusterConfig,
  RouteOptions,
  RouteRecord,
  RouteDocsConfig,
  VextMiddlewareRef,
  RouteCacheOptions,
  VextCacheConfig,
  CacheStore,
  CacheEntry,
} from "./app.js";

// ── 插件类型 ────────────────────────────────────────────────
export type { VextPlugin } from "./plugin.js";
export { definePlugin } from "./plugin.js";

// ── 路由类型 ────────────────────────────────────────────────
export type { RouteDefinition, RouteCollector, RouteFactory } from "./route.js";

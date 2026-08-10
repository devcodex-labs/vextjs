/**
 * index.ts — OpenAPI 模块统一导出入口
 *
 * 集中导出 OpenAPI 模块的所有公共 API，
 * 供 bootstrap.ts 和其他内部模块使用。
 *
 * 使用方式：
 *   import { RouteMetadataCollector, OpenAPIGenerator, registerOpenAPIRoutes } from './openapi/index.js'
 *
 * @module lib/openapi
 * @see 14-openapi.md §2.2（模块划分）
 */

// ── 类型导出 ────────────────────────────────────────────────

export type {
  RouteMetadata,
  VextOpenAPIDocsKind,
  CollectedRoutes,
  JsonSchema,
  ConvertResult,
  SecurityScheme,
  OpenAPIConfig,
  OpenAPIDocument,
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIResponse,
  ScalarConfig,
  DocEndpointsConfig,
  ResponseConfig,
} from "./types.js";

// ── 收集器 ──────────────────────────────────────────────────

export { RouteMetadataCollector } from "./collector.js";

export {
  detectRenderCall,
  detectRenderCallSource,
  detectRouteDocsKind,
  detectRouteSourceDocsKind,
} from "./route-docs-kind.js";

// ── 转换器 ──────────────────────────────────────────────────

export { SchemaConverter } from "./schema-converter.js";

// ── 生成器 ──────────────────────────────────────────────────

export { OpenAPIGenerator } from "./generator.js";

// ── OperationId 推断 ────────────────────────────────────────

export { inferOperationId } from "./operation-id.js";

// ── Swagger UI 端点注册（向后兼容，委托 Vext Docs） ─────────

export { registerOpenAPIRoutes } from "./swagger-ui.js";

// ── 文档端点统一注册（Vext Docs） ──────────────────────────

export { registerDocEndpoints } from "./doc-endpoints.js";

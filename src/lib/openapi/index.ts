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
  CollectedRoutes,
  JsonSchema,
  ConvertResult,
  SecurityScheme,
  OpenAPIConfig,
  OpenAPIDocument,
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIResponse,
  OpenAPIEndpointConfig,
  ResponseConfig,
} from "./types.js";

// ── 收集器 ──────────────────────────────────────────────────

export { RouteMetadataCollector } from "./collector.js";

// ── 转换器 ──────────────────────────────────────────────────

export { SchemaConverter } from "./schema-converter.js";

// ── 生成器 ──────────────────────────────────────────────────

export { OpenAPIGenerator } from "./generator.js";

// ── OperationId 推断 ────────────────────────────────────────

export { inferOperationId } from "./operation-id.js";

// ── Swagger UI 端点注册 ─────────────────────────────────────

export { registerOpenAPIRoutes } from "./swagger-ui.js";

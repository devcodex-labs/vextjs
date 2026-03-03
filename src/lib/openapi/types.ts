/**
 * types.ts — OpenAPI 模块核心类型定义
 *
 * 定义路由元信息收集、JSON Schema 转换、OpenAPI 文档生成所需的类型。
 *
 * @module lib/openapi/types
 * @see 14-openapi.md §3.1（收集的数据结构）
 * @see 14-openapi.md §4.2（JSON Schema 类型）
 * @see 14-openapi.md §5.1（OpenAPI 文档类型）
 */

import type { RouteOptions } from "../../types/app.js";

// ── 路由元信息收集 ──────────────────────────────────────────

/**
 * RouteMetadata — 单条路由的元信息
 *
 * 由 RouteMetadataCollector 在 router-loader 扫描阶段收集。
 * 包含路由的 HTTP 方法、完整路径、options 配置对象、来源文件路径。
 */
export interface RouteMetadata {
  /** HTTP 方法（大写：GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS） */
  method: string;

  /** 完整路由路径（含前缀，如 /api/users/:id） */
  path: string;

  /** 路由 options 原始对象（含 validate / middlewares / docs） */
  options: RouteOptions;

  /** 路由文件来源（用于 tag 推断，如 routes/users.ts） */
  sourceFile: string;
}

/**
 * CollectedRoutes — 所有路由元信息汇总
 *
 * 收集器完成后传递给 OpenAPIGenerator，
 * 包含路由列表和全局中间件列表（用于安全方案推断）。
 */
export interface CollectedRoutes {
  /** 所有路由元信息 */
  routes: RouteMetadata[];

  /** 全局中间件列表（用于安全方案推断） */
  globalMiddlewares: string[];
}

// ── JSON Schema 类型 ────────────────────────────────────────

/**
 * JsonSchema — JSON Schema 对象（简化版，覆盖 OpenAPI 3.0 常用子集）
 *
 * SchemaConverter 将 schema-dsl DSL 字符串转换为此格式。
 * OpenAPIGenerator 将此格式嵌入 OpenAPI 文档的 parameters / requestBody / responses。
 */
export interface JsonSchema {
  type?: string;
  format?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
  nullable?: boolean;
  example?: unknown;
  oneOf?: JsonSchema[];
  $ref?: string;
  [key: string]: unknown;
}

/**
 * ConvertResult — DSL → JSON Schema 转换结果
 *
 * 包含转换后的 JSON Schema 对象和必填字段列表。
 */
export interface ConvertResult {
  /** JSON Schema 对象 */
  schema: JsonSchema;

  /** 必填字段列表 */
  required: string[];
}

// ── OpenAPI 文档类型 ────────────────────────────────────────

/**
 * SecurityScheme — OpenAPI 安全方案定义
 */
export interface SecurityScheme {
  type: "http" | "apiKey" | "oauth2" | "openIdConnect";
  scheme?: string;
  bearerFormat?: string;
  name?: string;
  in?: "header" | "query" | "cookie";
  description?: string;
}

/**
 * OpenAPIConfig — OpenAPI 生成器配置
 *
 * 从 vext config.openapi 映射而来，控制生成文档的元信息。
 */
export interface OpenAPIConfig {
  /** API 标题 */
  title?: string;

  /** API 描述 */
  description?: string;

  /** API 版本 */
  version?: string;

  /** 服务器地址列表 */
  servers?: Array<{ url: string; description?: string }>;

  /** 全局安全方案 */
  securitySchemes?: Record<string, SecurityScheme>;

  /** 全局标签定义 */
  tags?: Array<{ name: string; description?: string }>;

  /** 联系信息 */
  contact?: { name?: string; email?: string; url?: string };

  /** 许可证 */
  license?: { name: string; url?: string };

  /**
   * Guard 到 Security Scheme 的映射
   *
   * 用于从 middlewares 名称推断安全方案。
   * 例如: { auth: 'bearerAuth', apiKey: 'apiKeyAuth' }
   */
  guardSecurityMap?: Record<string, string>;
}

/**
 * OpenAPIDocument — OpenAPI 3.0 文档结构
 */
export interface OpenAPIDocument {
  openapi: string;
  info: {
    title: string;
    description?: string;
    version: string;
    contact?: { name?: string; email?: string; url?: string };
    license?: { name: string; url?: string };
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
  tags?: Array<{ name: string; description?: string }>;
}

/**
 * OpenAPIOperation — 单条路由的 Operation 对象
 */
export interface OpenAPIOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: JsonSchema }>;
  };
  responses: Record<string, OpenAPIResponse>;
  security?: Array<Record<string, string[]>>;
  [key: string]: unknown;
}

/**
 * OpenAPIParameter — 路由参数定义
 */
export interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema: JsonSchema;
  description?: string;
}

/**
 * OpenAPIResponse — 单个状态码的响应定义
 */
export interface OpenAPIResponse {
  description: string;
  content?: Record<
    string,
    {
      schema?: JsonSchema;
      example?: unknown;
      examples?: Record<
        string,
        {
          summary?: string;
          description?: string;
          value: unknown;
        }
      >;
    }
  >;
  headers?: Record<
    string,
    {
      description?: string;
      schema?: { type: string };
    }
  >;
}

// ── Swagger UI 端点配置 ─────────────────────────────────────

/**
 * OpenAPIEndpointConfig — Swagger UI + spec 端点配置
 */
export interface OpenAPIEndpointConfig {
  /** Swagger UI 路径 @default '/docs' */
  docsPath?: string;

  /** OpenAPI spec 路径 @default '/openapi.json' */
  specPath?: string;

  /** 页面标题 */
  title?: string;

  /** Swagger UI CDN 版本 @default '5.18.2' */
  swaggerUIVersion?: string;

  /** 是否启用 "Try it out" 功能 @default true */
  tryItOutEnabled?: boolean;

  /** 默认展开级别 @default 'list' */
  docExpansion?: "none" | "list" | "full";

  /** 深度链接 @default true */
  deepLinking?: boolean;
}

// ── ResponseConfig 扩展（docs.responses 内的单条配置）────────

/**
 * ResponseConfig — docs.responses 中单条响应的完整配置
 *
 * 扩展自设计文档 §1.1 的 ResponseConfig 接口。
 * 用户在路由 options.docs.responses 中声明响应格式。
 */
export interface ResponseConfig {
  /** 响应描述 */
  description: string;

  /**
   * 响应体 schema
   *
   * 支持三种格式：
   *   1. schema-dsl 字符串对象（与 validate 格式一致）
   *   2. JSON Schema 对象
   *   3. 引用字符串（如 '#/components/schemas/User'）
   */
  schema?: Record<string, unknown> | string;

  /** 响应头 */
  headers?: Record<
    string,
    {
      description?: string;
      schema?: { type: string };
    }
  >;

  /** Content-Type @default 'application/json' */
  contentType?: string;

  /** 响应示例 */
  example?: unknown;

  /** 多个响应示例 */
  examples?: Record<
    string,
    {
      summary?: string;
      description?: string;
      value: unknown;
    }
  >;
}

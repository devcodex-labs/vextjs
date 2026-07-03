/**
 * types.ts — OpenAPI 模块核心类型定义
 *
 * 定义路由元信息收集、JSON Schema 转换、OpenAPI 文档生成所需的类型。
 *
 * @module lib/openapi/types
 * @see 14-openapi.md §3.1（收集的数据结构）
 * @see 14-openapi.md §4.2（JSON Schema 类型）
 * @see 14-openapi.md §5.1（OpenAPI 文档类型）
 *
 * @changelog
 *   - v0.2.0: 历史 Scalar API Reference 替换 Redoc + Swagger UI 双端点方案
 *   - v0.3.x: 默认 /docs 切换为 Vext Docs；Scalar 配置仅保留历史 warning
 */

import type { RouteOptions, VextSchemaField } from "../../types/app.js";
import type { VextDocsConfig } from "../docs/types.js";

// ── 路由元信息收集 ──────────────────────────────────────────

export type VextOpenAPIDocsKind = "backend-api" | "frontend-route";

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

  /** 文档展示面：普通 API 路由或调用 res.render()/res.renderError() 的前端页面路由 */
  docsKind?: VextOpenAPIDocsKind;
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
  servers?: Array<{
    url: string;
    description?: string;
    variables?: Record<
      string,
      { default: string; enum?: string[]; description?: string }
    >;
  }>;

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

  /**
   * 显式 x-tagGroups vendor extension
   *
   * Vext Docs 默认使用 OpenAPI path segment 生成递归导航，不使用
   * tagGroups 构建菜单。未配置 `tagGroups` 时，框架不会自动生成
   * `x-tagGroups`；提供 `tagGroups` 数组后，框架会原样输出用户配置。
   *
   * @example
   * ```typescript
   * openapi: {
   *   tagGroups: [
   *     { name: 'Public API', tags: ['API v1'] },
   *     { name: 'Integration', tags: ['Webhooks'] },
   *   ],
   * }
   * ```
   *
   */
  tagGroups?: Array<{ name: string; tags: string[] }>;
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
  servers?: Array<{
    url: string;
    description?: string;
    variables?: Record<
      string,
      { default: string; enum?: string[]; description?: string }
    >;
  }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
  tags?: Array<{ name: string; description?: string }>;

  /**
   * Vendor extension: 显式 x-tagGroups
   *
   * 仅当 openapi.tagGroups 显式配置时由 OpenAPIGenerator 原样输出；
   * Vext Docs 默认导航不依赖该字段。
   */
  "x-tagGroups"?: Array<{ name: string; tags: string[] }>;

  /** 允许其他 vendor extensions (x-*) */
  [key: `x-${string}`]: unknown;
}

/**
 * OpenAPIOperation — 单条路由的 Operation 对象
 */
export interface OpenAPIOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  /** @deprecated route docs.tags is ignored; operation tags are inferred automatically. */
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

// ── Legacy Scalar compatibility ───────────────────────────

/** @deprecated openapi.scalar is ignored by Vext Docs and only triggers a migration warning. */
export type ScalarConfig = Record<string, unknown>;

// ── 文档端点统一配置 ─────────────────────────────────────────

/**
 * DocEndpointsConfig — 文档端点统一配置
 *
 * 使用 Vext Docs Renderer 作为默认文档 UI。
 *
 * 默认端点布局：
 *   - GET /docs         → Vext Docs Renderer
 *   - GET /openapi.json → OpenAPI spec JSON
 *   - GET /_vext/docs/* → Vext docs 系统资产与数据端点
 */
export interface DocEndpointsConfig {
  /** OpenAPI spec 路径 @default '/openapi.json' */
  specPath?: string;

  /**
   * OpenAPI spec 的公开访问路径，主要用于外部工具、链接和文档元信息。
   *
   * 仅影响公开 canonical spec URL，**不影响** vext 内部路由注册路径。
   * 未设置时默认与 `specPath` 相同。内置 source-aware Vext Docs 的
   * `/_vext/docs/*.json` 数据端点公开前缀由 `docs.assetsPublicPath` 负责。
   *
   * @example
   * ```typescript
   * // Nginx: /admin/* → vext（剥离 /admin 前缀）
   * // vext 路由注册在 /openapi.json
   * // 浏览器/外部工具访问 /admin/openapi.json → Nginx 剥离 → vext /openapi.json ✅
   * {
   *   specPath: '/openapi.json',             // vext 内部路由
   *   specPublicPath: '/admin/openapi.json', // 公开 canonical spec 地址
   * }
   * ```
   */
  specPublicPath?: string;

  /** 文档页面路径 @default '/docs' */
  docsPath?: string;

  /** 页面标题 */
  title?: string;

  /** Vext Docs Renderer 配置 */
  docs?: VextDocsConfig;

  /** @deprecated Scalar 已退出默认文档实现，仅作为历史 warning 触发字段保留 */
  scalar?: ScalarConfig;

  /** 项目根目录，供后续 Code JSDoc source 使用 */
  rootDir?: string;

  /** 源码目录，供后续 Code JSDoc source 使用 */
  srcDir?: string;

  /** Model 定义目录（相对于 src/），来自 database.models.dir */
  modelsDir?: string;
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
  schema?: Record<string, VextSchemaField> | string;

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

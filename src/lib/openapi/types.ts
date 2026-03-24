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
 *   - v0.2.0: Scalar API Reference 替换 Redoc + Swagger UI 双端点方案
 *             单端点 /docs 同时提供文档阅读 + Try it out 交互式测试
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

  /**
   * 标签分组（x-tagGroups）
   *
   * 用于在 Scalar API Reference 文档中将 tags 分组为多级导航。
   * OpenAPI 3.x 规范的 tags 是一维扁平列表，不原生支持嵌套层级。
   * 通过 vendor extension `x-tagGroups`（Scalar / Redocly 支持），
   * 可以将多个 tags 归入更高级别的分组，实现两级导航结构。
   *
   * **自动推断**（默认行为）：
   *   当未配置 `tagGroups` 时，框架根据路由文件的目录结构自动推断分组。
   *   例如：`routes/api/v1/users.ts` 和 `routes/api/v1/orders.ts` 的 tags
   *   会被自动归入 "api" 分组（基于第一层目录名）。
   *
   * **手动配置**（覆盖自动推断）：
   *   提供 `tagGroups` 数组后，框架不再自动推断，直接使用用户配置。
   *
   * @example
   * ```typescript
   * openapi: {
   *   tagGroups: [
   *     { name: 'User API', tags: ['users', 'user-profile'] },
   *     { name: 'Admin', tags: ['admin-dashboard', 'admin-users'] },
   *     { name: 'Webhooks', tags: ['webhooks'] },
   *   ],
   * }
   * ```
   *
   * @see https://github.com/scalar/scalar — x-tagGroups 支持
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
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
  tags?: Array<{ name: string; description?: string }>;

  /**
   * Vendor extension: 标签分组
   *
   * Scalar / Redocly 支持的扩展字段，用于将 tags 分组为两级导航。
   * 由 OpenAPIGenerator 根据配置或自动推断生成。
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

// ── Scalar API Reference 配置 ───────────────────────────────

/**
 * ScalarConfig — Scalar API Reference UI 配置
 *
 * 控制 Scalar 文档页面的外观和行为。
 * Scalar 同时提供文档阅读 + Try it out 交互式测试，
 * 替代原有的 Redoc + Swagger UI 双端点方案。
 *
 * @see https://github.com/scalar/scalar
 */
export interface ScalarConfig {
  /** 页面标题 */
  title?: string;

  /**
   * 主题
   *
   * Scalar 内置主题：
   *   - 'default' — 默认主题
   *   - 'alternate' — 备选主题
   *   - 'moon' — 深色月亮主题
   *   - 'purple' — 紫色主题
   *   - 'solarized' — Solarized 主题
   *   - 'bluePlanet' — 蓝色星球主题
   *   - 'saturn' — 土星主题
   *   - 'kepler' — 开普勒主题
   *   - 'mars' — 火星主题
   *   - 'deepSpace' — 深空主题
   *   - 'none' — 无主题（自定义 CSS）
   *
   * @default 'default'
   */
  theme?:
    | "default"
    | "alternate"
    | "moon"
    | "purple"
    | "solarized"
    | "bluePlanet"
    | "saturn"
    | "kepler"
    | "mars"
    | "deepSpace"
    | "none";

  /** 是否启用深色模式 @default false */
  darkMode?: boolean;

  /**
   * 布局模式
   *
   * - 'modern' — 现代三栏布局（默认）
   * - 'classic' — 经典双栏布局
   *
   * @default 'modern'
   */
  layout?: "modern" | "classic";

  /** 是否显示侧边栏 @default true */
  showSidebar?: boolean;

  /** 是否隐藏 Models/Schemas 面板 @default false */
  hideModels?: boolean;

  /**
   * 隐藏的客户端语言列表
   *
   * 在 Try it out 面板中隐藏指定语言的代码示例。
   * 例如: ['php', 'ruby'] 隐藏 PHP 和 Ruby 示例。
   */
  hiddenClients?: string[];

  /** 搜索热键 @default 'k' (Ctrl+K / Cmd+K) */
  searchHotKey?: string;

  /**
   * 代理 URL
   *
   * 用于避免 CORS 问题。Scalar 会通过此代理转发 Try it out 请求。
   * 留空则直接请求 API 服务器（同源时无需代理）。
   */
  proxyUrl?: string;

  /**
   * Favicon URL
   *
   * 文档页面的 favicon 图标地址。
   * 支持相对路径（如 '/favicon.svg'）或绝对 URL。
   * 未设置时浏览器使用默认行为（尝试加载 /favicon.ico）。
   */
  favicon?: string;

  /**
   * 多 OpenAPI 文档源
   *
   * 配置多个 OpenAPI 规范来源，Scalar 会在 UI 顶部显示文档切换器。
   * 每个 source 可以通过 `url`（远程/本地端点）或 `content`（内联 JSON 字符串）提供规范。
   *
   * 当配置了 `sources` 时，框架自动生成的 spec 会作为第一个 source 注入（除非 sources 中已包含本地 spec 路径）。
   *
   * @example
   * ```typescript
   * openapi: {
   *   scalar: {
   *     sources: [
   *       { title: 'Main API', url: '/openapi.json', slug: 'main' },
   *       { title: 'Partner API', url: 'https://partner.example.com/openapi.json', slug: 'partner' },
   *       { title: 'Legacy API', content: '{ "openapi": "3.0.0", ... }', slug: 'legacy' },
   *     ],
   *   },
   * }
   * ```
   *
   * @see https://github.com/scalar/scalar — sources 配置
   */
  sources?: Array<{
    /** 文档标题（显示在切换器中） */
    title?: string;
    /** OpenAPI 规范 URL（远程或本地端点） */
    url?: string;
    /** OpenAPI 规范内联 JSON 字符串（与 url 二选一） */
    content?: string;
    /** URL slug（用于浏览器地址栏标识，如 `/docs#/slug`） */
    slug?: string;
  }>;

  /**
   * 自定义 Scalar JS 加载地址
   *
   * 替代默认的 `https://cdn.jsdelivr.net/npm/@scalar/api-reference` CDN 地址。
   * 适用于以下场景：
   *   - **内网/离线部署**：将 Scalar JS 文件托管在内网 CDN 或静态服务器
   *   - **版本锁定**：使用特定版本的 Scalar（如 `https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0`）
   *   - **自托管镜像**：使用公司内部 npm 镜像或 CDN 镜像
   *
   * 未设置时默认使用 `https://cdn.jsdelivr.net/npm/@scalar/api-reference`。
   *
   * @example
   * ```typescript
   * openapi: {
   *   scalar: {
   *     // 内网 CDN
   *     cdnUrl: 'https://static.internal.com/scalar/api-reference.js',
   *     // 或版本锁定
   *     cdnUrl: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0',
   *     // 或本地静态文件（需配合框架静态文件服务）
   *     cdnUrl: '/static/scalar-api-reference.js',
   *   },
   * }
   * ```
   */
  cdnUrl?: string;

  /** 自定义 CSS */
  customCss?: string;

  /** 是否加载默认字体 @default true */
  withDefaultFonts?: boolean;

  /**
   * 默认认证方案
   *
   * 指定 Try it out 面板默认使用的认证方案名称。
   * 必须与 OpenAPI spec 中 components.securitySchemes 的 key 匹配。
   */
  defaultHttpClient?: {
    /** 目标语言 (如 'javascript', 'python', 'shell') */
    targetKey: string;
    /** 客户端库 (如 'fetch', 'axios', 'requests', 'curl') */
    clientKey: string;
  };
}

// ── 文档端点统一配置 ─────────────────────────────────────────

/**
 * DocEndpointsConfig — 文档端点统一配置
 *
 * 使用 Scalar API Reference 作为唯一文档 UI，
 * 同时提供文档阅读和交互式 Try it out 功能。
 *
 * 默认端点布局：
 *   - GET /docs         → Scalar API Reference（文档阅读 + Try it out）
 *   - GET /openapi.json → OpenAPI spec JSON
 */
export interface DocEndpointsConfig {
  /** OpenAPI spec 路径 @default '/openapi.json' */
  specPath?: string;

  /**
   * OpenAPI spec 的公开访问路径（用于 Scalar HTML 中引用 spec 的 URL）
   *
   * 仅影响 Scalar HTML 里 `url` 字段的值，**不影响** vext 内部路由注册路径。
   * 未设置时默认与 `specPath` 相同。
   *
   * **使用场景**：应用部署在反向代理路径前缀下，且代理**剥离**前缀后转发给 vext。
   * 此时 vext 内部路由是 `/openapi.json`，但浏览器必须通过 `/admin/openapi.json` 访问。
   * 如果不配置此字段，Scalar HTML 里会写死 `/openapi.json`（绝对路径），
   * 浏览器会请求 `https://example.com/openapi.json`（丢失代理前缀）导致 404。
   *
   * @example
   * ```typescript
   * // Nginx: /admin/* → vext（剥离 /admin 前缀）
   * // vext 路由注册在 /openapi.json
   * // 浏览器访问 /admin/openapi.json → Nginx 剥离 → vext /openapi.json ✅
   * {
   *   specPath: '/openapi.json',          // vext 内部路由
   *   specPublicPath: '/admin/openapi.json', // Scalar HTML 引用地址
   * }
   * ```
   */
  specPublicPath?: string;

  /** 文档页面路径 @default '/docs' */
  docsPath?: string;

  /** 页面标题 */
  title?: string;

  /** Scalar API Reference 配置 */
  scalar?: ScalarConfig;
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

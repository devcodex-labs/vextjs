/**
 * generator.ts — OpenAPIGenerator（OpenAPI 3.0 文档生成器）
 *
 * 接收 RouteMetadata[] 路由元信息列表，生成完整的 OpenAPI 3.0.3 文档。
 *
 * 核心职责：
 *   1. 遍历路由元信息，为每条路由构建 Operation 对象
 *   2. 将 validate.params / query → parameters
 *   3. 将 validate.body → requestBody
 *   4. 将 docs.responses → responses（成功响应自动包装为 { code, data, requestId }）
 *   5. 从 middlewares 推断 security（auth → bearerAuth）
 *   6. 从 middlewares 推断 x-rate-limit 扩展
 *   7. 自动推断 tags（从文件路径）和 operationId（从方法+路径）
 *   8. 注册通用 ErrorResponse / SuccessResponse components/schemas
 *
 * 路径格式转换：
 *   vext:    /users/:id     → OpenAPI: /users/{id}
 *   vext:    /files/*path   → OpenAPI: /files/{path}
 *
 * @module lib/openapi/generator
 * @see 14-openapi.md §5（OpenAPIGenerator — 文档生成器）
 */

import type {
  RouteMetadata,
  OpenAPIConfig,
  OpenAPIDocument,
  OpenAPIOperation,
  OpenAPIResponse,
  JsonSchema,
  SecurityScheme,
} from "./types.js";
import { SchemaConverter } from "./schema-converter.js";
import { inferOperationId } from "./operation-id.js";

/**
 * OpenAPIGenerator — OpenAPI 3.0 文档生成器
 *
 * 无状态生成器（converter 内部也无状态），可安全多次调用 generate()。
 *
 * @example
 * ```typescript
 * const generator = new OpenAPIGenerator({
 *   title: 'My API',
 *   version: '1.0.0',
 *   servers: [{ url: 'http://localhost:3000', description: 'Development' }],
 * })
 *
 * const routes = collector.getRoutes()
 * const doc = generator.generate(routes)
 * const json = generator.generateJSON(routes)
 * ```
 */
export class OpenAPIGenerator {
  private converter = new SchemaConverter();
  private config: OpenAPIConfig;

  constructor(config: OpenAPIConfig = {}) {
    this.config = config;
  }

  /**
   * 生成完整的 OpenAPI 3.0 文档
   *
   * @param routes RouteMetadata[] 路由元信息列表（由 collector.getRoutes() 提供）
   * @returns OpenAPIDocument 完整的 OpenAPI 3.0 文档对象
   */
  generate(routes: RouteMetadata[]): OpenAPIDocument {
    const doc: OpenAPIDocument = {
      openapi: "3.0.3",
      info: {
        title: this.config.title ?? "VextJS API",
        description:
          this.config.description ?? "Auto-generated API documentation",
        version: this.config.version ?? "1.0.0",
        ...(this.config.contact ? { contact: this.config.contact } : {}),
        ...(this.config.license ? { license: this.config.license } : {}),
      },
      servers: this.config.servers ?? [
        { url: "/", description: "Current server" },
      ],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: this.buildSecuritySchemes(),
      },
      tags: this.config.tags ?? this.inferTags(routes),
    };

    // ── 遍历路由，生成 paths ────────────────────────────────
    for (const route of routes) {
      const openApiPath = this.convertPath(route.path);
      const method = route.method.toLowerCase();

      if (!doc.paths[openApiPath]) {
        doc.paths[openApiPath] = {};
      }

      doc.paths[openApiPath][method] = this.buildOperation(route);
    }

    // ── 添加通用错误响应 schema ─────────────────────────────
    doc.components!.schemas!["ErrorResponse"] = {
      type: "object",
      properties: {
        code: {
          type: "integer",
          description: "HTTP 状态码或业务错误码",
        },
        message: {
          type: "string",
          description: "错误信息",
        },
        requestId: {
          type: "string",
          description: "请求追踪 ID",
        },
      },
      required: ["code", "message", "requestId"],
    };

    doc.components!.schemas!["SuccessResponse"] = {
      type: "object",
      properties: {
        code: {
          type: "integer",
          description: "状态码（0 表示成功）",
          example: 0,
        },
        data: {
          description: "响应数据",
        },
        requestId: {
          type: "string",
          description: "请求追踪 ID",
        },
      },
      required: ["code", "data", "requestId"],
    };

    return doc;
  }

  /**
   * 生成 JSON 格式的 OpenAPI 文档字符串
   *
   * @param routes RouteMetadata[] 路由元信息列表
   * @returns JSON 字符串（格式化缩进 2 空格）
   */
  generateJSON(routes: RouteMetadata[]): string {
    return JSON.stringify(this.generate(routes), null, 2);
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * 构建单个路由的 Operation 对象
   *
   * 依次处理：
   *   1. summary / operationId / tags / deprecated / description
   *   2. 路径参数（validate.params → parameters[in=path]）
   *   3. 查询参数（validate.query → parameters[in=query]）
   *   4. 请求体（validate.body → requestBody，仅 POST/PUT/PATCH）
   *   5. 响应（docs.responses → responses，成功响应自动包装）
   *   6. 默认响应（未声明时添加 200 OK）
   *   7. 安全方案（从 middlewares 或 docs.security 推断）
   *   8. 自定义扩展（docs.extensions → x-* 字段）
   *   9. 速率限制（从 rate-limit 中间件推断 x-rate-limit）
   *   10. 清空空参数数组
   *
   * @param route 单条路由的元信息
   * @returns OpenAPIOperation 对象
   */
  private buildOperation(route: RouteMetadata): OpenAPIOperation {
    const { options, method, path, sourceFile } = route;
    const docs = options.docs ?? {};

    const operation: OpenAPIOperation = {
      summary: docs.summary ?? `${method} ${path}`,
      operationId: docs.operationId ?? inferOperationId(method, path),
      tags: docs.tags ?? [this.inferTagFromFile(sourceFile)],
      deprecated: docs.deprecated ?? false,
      parameters: [],
      responses: {},
    };

    // ── 描述 ────────────────────────────────────────────────
    if (docs.description) {
      operation.description = docs.description;
    }

    // ── 路径参数（params / param） ──────────────────────────
    // validate.params 或 validate.param 中的每个字段都是路径参数（required = true）
    // 注意：vext 内部类型定义使用 `param`（单数），但设计文档使用 `params`（复数），
    // 此处两者均支持，优先使用 params（设计文档标准），降级使用 param（现有代码兼容）。
    const validateParams =
      (options.validate as Record<string, unknown>)?.params ??
      options.validate?.param;
    if (validateParams) {
      const params = validateParams as Record<string, string>;
      for (const [name, dsl] of Object.entries(params)) {
        const { schema } = this.converter.convertDSLString(
          typeof dsl === "string" ? dsl : "string",
        );
        operation.parameters!.push({
          name,
          in: "path",
          required: true,
          schema,
        });
      }
    }

    // ── 查询参数（query） ───────────────────────────────────
    // validate.query 中的每个字段映射为查询参数
    // 必填标记（!）映射为 required: true
    if (options.validate?.query) {
      const query = options.validate.query as Record<string, string>;
      for (const [name, dsl] of Object.entries(query)) {
        if (typeof dsl !== "string") continue;
        const { schema, isRequired } = this.converter.convertDSLString(dsl);
        operation.parameters!.push({
          name,
          in: "query",
          required: isRequired,
          schema,
        });
      }
    }

    // ── 请求体（body） ──────────────────────────────────────
    // 仅 POST / PUT / PATCH 方法生成 requestBody
    if (
      options.validate?.body &&
      ["POST", "PUT", "PATCH"].includes(method.toUpperCase())
    ) {
      const bodyResult = this.converter.convertValidateObject(
        options.validate.body as Record<string, unknown>,
      );
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: bodyResult.schema,
          },
        },
      };
    }

    // ── 响应（responses） ───────────────────────────────────
    // docs.responses 中的每个状态码映射为 OpenAPI responses
    if (docs.responses) {
      for (const [statusCode, config] of Object.entries(docs.responses)) {
        const code = String(statusCode);
        const responseObj: OpenAPIResponse = {
          description: config.description ?? "",
        };

        if (config.schema) {
          const converted = this.converter.convertResponseSchema(
            config.schema as Record<string, unknown> | string,
          );

          // 包装为 vext 标准响应格式 { code: 0, data: ..., requestId: ... }
          const wrappedSchema = this.wrapResponseSchema(
            Number(code),
            converted,
          );

          const contentType =
            ((config as Record<string, unknown>).contentType as string) ??
            "application/json";

          responseObj.content = {
            [contentType]: {
              schema: wrappedSchema,
            },
          };

          const contentEntry = responseObj.content![contentType]!;

          // 单个示例
          if ((config as Record<string, unknown>).example !== undefined) {
            contentEntry.example = this.wrapResponseExample(
              Number(code),
              (config as Record<string, unknown>).example,
            );
          }

          // 多个示例
          if ((config as Record<string, unknown>).examples) {
            const examples = (config as Record<string, unknown>)
              .examples as Record<
              string,
              { summary?: string; description?: string; value: unknown }
            >;
            contentEntry.examples = {};
            for (const [name, ex] of Object.entries(examples)) {
              contentEntry.examples![name] = {
                summary: ex.summary,
                description: ex.description,
                value: this.wrapResponseExample(Number(code), ex.value),
              };
            }
          }
        }

        // 响应头
        if ((config as Record<string, unknown>).headers) {
          responseObj.headers = (config as Record<string, unknown>)
            .headers as OpenAPIResponse["headers"];
        }

        operation.responses[code] = responseObj;
      }
    }

    // ── 默认响应（未声明 docs.responses 时） ─────────────────
    if (Object.keys(operation.responses).length === 0) {
      operation.responses["200"] = {
        description: "OK",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SuccessResponse" },
          },
        },
      };
    }

    // ── 安全方案（从 middlewares 推断或使用 docs.security）────
    if (docs.security !== undefined) {
      // 显式指定 security（包括空数组 = 无需认证）
      operation.security = docs.security as Array<Record<string, string[]>>;
    } else if (
      options.middlewares &&
      (options.middlewares as unknown[]).length > 0
    ) {
      // 从 middlewares 推断 security
      const inferred = this.inferSecurityFromMiddlewares(
        options.middlewares as Array<
          string | { name: string; options?: unknown }
        >,
      );
      if (inferred.length > 0) {
        operation.security = inferred;
      }
    }

    // ── 自定义扩展字段（docs.extensions → x-* ）─────────────
    if (docs.extensions) {
      for (const [key, value] of Object.entries(
        docs.extensions as Record<string, unknown>,
      )) {
        const xKey = key.startsWith("x-") ? key : `x-${key}`;
        (operation as Record<string, unknown>)[xKey] = value;
      }
    }

    // ── 速率限制扩展（从 rate-limit 中间件推断 x-rate-limit）──
    if (options.middlewares) {
      const rateLimitMw = (options.middlewares as unknown[]).find(
        (mw: unknown) =>
          (typeof mw === "string" ? mw : (mw as { name: string }).name) ===
          "rate-limit",
      );
      if (
        rateLimitMw &&
        typeof rateLimitMw === "object" &&
        rateLimitMw !== null &&
        (rateLimitMw as { options?: unknown }).options
      ) {
        const mwOptions = (rateLimitMw as { options: Record<string, unknown> })
          .options;
        (operation as Record<string, unknown>)["x-rate-limit"] = {
          max: mwOptions.max,
          window: mwOptions.window,
        };
      }
    }

    // ── 清空空参数数组 ──────────────────────────────────────
    if (operation.parameters!.length === 0) {
      delete operation.parameters;
    }

    return operation;
  }

  /**
   * 包装响应 schema 为 vext 标准格式
   *
   * 成功响应（2xx，非 204）:
   *   { code: 0, data: <原始 schema>, requestId: string }
   *
   * 204 No Content:
   *   空对象（无响应体）
   *
   * 错误响应（4xx/5xx）:
   *   直接使用原始 schema（通常是 ErrorResponse 格式）
   *
   * @param statusCode HTTP 状态码
   * @param dataSchema 原始数据 schema
   * @returns 包装后的 JsonSchema
   */
  private wrapResponseSchema(
    statusCode: number,
    dataSchema: JsonSchema,
  ): JsonSchema {
    if (statusCode === 204) {
      // 204 No Content — 无响应体
      return {};
    }

    if (statusCode >= 200 && statusCode < 300) {
      // 成功响应 — 包装为 { code: 0, data, requestId }
      return {
        type: "object",
        properties: {
          code: { type: "integer", example: 0 },
          data: dataSchema,
          requestId: {
            type: "string",
            example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          },
        },
        required: ["code", "data", "requestId"],
      };
    }

    // 错误响应 — 直接使用原始 schema（通常是 ErrorResponse 格式）
    return dataSchema;
  }

  /**
   * 包装响应示例为 vext 标准格式
   *
   * 成功响应（2xx，非 204）自动包装为 { code: 0, data: ..., requestId: '...' }
   * 错误响应直接返回原始示例
   *
   * @param statusCode HTTP 状态码
   * @param example    原始示例值
   * @returns 包装后的示例值
   */
  private wrapResponseExample(statusCode: number, example: unknown): unknown {
    if (statusCode >= 200 && statusCode < 300 && statusCode !== 204) {
      return {
        code: 0,
        data: example,
        requestId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      };
    }
    return example;
  }

  /**
   * 转换路由路径格式
   *
   * vext 使用 Express 风格的路径参数（:param），
   * OpenAPI 使用花括号风格（{param}）。
   *
   * vext:    /users/:id     → OpenAPI: /users/{id}
   * vext:    /files/*path   → OpenAPI: /files/{path}
   *
   * @param path vext 格式的路由路径
   * @returns OpenAPI 格式的路由路径
   */
  private convertPath(path: string): string {
    return path.replace(/:(\w+)/g, "{$1}").replace(/\*(\w+)/g, "{$1}");
  }

  /**
   * 从 middlewares 推断 security
   *
   * 检测 middleware 名称是否匹配 guardSecurityMap 中的 key。
   * middlewares 可以是 string 或 { name, options } 对象，需统一提取 name。
   *
   * 默认映射：
   *   - 'auth'    → bearerAuth
   *   - 'api-key' → apiKeyAuth
   *
   * 用户可通过 config.guardSecurityMap 自定义映射。
   *
   * @param middlewares 路由级中间件列表
   * @returns 推断出的 security 数组
   */
  private inferSecurityFromMiddlewares(
    middlewares: Array<string | { name: string; options?: unknown }>,
  ): Array<Record<string, string[]>> {
    const map = this.config.guardSecurityMap ?? {
      auth: "bearerAuth",
      "api-key": "apiKeyAuth",
    };

    return middlewares
      .map((m) => (typeof m === "string" ? m : m.name))
      .filter((name) => name in map)
      .map((name) => ({ [map[name] as string]: [] }));
  }

  /**
   * 构建 securitySchemes
   *
   * 优先使用用户配置的 securitySchemes。
   * 若未配置，提供默认的 Bearer Token 方案。
   *
   * @returns securitySchemes 对象
   */
  private buildSecuritySchemes(): Record<string, SecurityScheme> {
    if (this.config.securitySchemes) {
      return this.config.securitySchemes;
    }

    // 默认方案：Bearer Token
    return {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT Bearer Token 认证",
      },
    };
  }

  /**
   * 从路由列表推断 tags
   *
   * 收集所有路由的 tags（显式声明或从文件路径推断），
   * 去重排序后返回。
   *
   * @param routes 路由元信息列表
   * @returns tag 定义列表（按名称排序）
   */
  private inferTags(
    routes: RouteMetadata[],
  ): Array<{ name: string; description?: string }> {
    const tagSet = new Set<string>();

    for (const route of routes) {
      if (route.options.docs?.tags) {
        for (const tag of route.options.docs.tags) {
          tagSet.add(tag);
        }
      } else {
        tagSet.add(this.inferTagFromFile(route.sourceFile));
      }
    }

    return Array.from(tagSet)
      .sort()
      .map((name) => ({ name }));
  }

  /**
   * 从文件路径推断 tag
   *
   * 提取 routes/ 后面的相对路径，移除扩展名：
   *   routes/users.ts      → 'users'
   *   routes/admin/roles.ts → 'admin-roles'
   *   routes/index.ts       → 'default'
   *
   * @param sourceFile 路由文件的绝对路径
   * @returns 推断的 tag 名称
   */
  private inferTagFromFile(sourceFile: string): string {
    const relative = sourceFile
      .replace(/\\/g, "/")
      .replace(/^.*routes\//, "")
      .replace(/\.(ts|js|mts|mjs|cts|cjs)$/, "");

    if (relative === "index" || relative === "") {
      return "default";
    }

    return relative.replace(/\/index$/, "").replace(/\//g, "-");
  }
}

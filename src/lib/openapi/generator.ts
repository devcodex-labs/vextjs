/**
 * generator.ts — OpenAPIGenerator（OpenAPI 3.0 文档生成器）
 *
 * 接收 RouteMetadata[] 路由元信息列表，生成完整的 OpenAPI 3.0.3 文档。
 *
 * 核心职责：
 *   1. 遍历路由元信息，为每条路由构建 Operation 对象
 *   2. 将 validate.param / query → parameters
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
    doc.components!.schemas!.ErrorResponse = {
      type: "object",
      properties: {
        code: {
          type: "integer",
          description: "HTTP status code or business error code",
        },
        message: {
          type: "string",
          description: "Error message",
        },
        requestId: {
          type: "string",
          description: "Request trace ID",
        },
      },
      required: ["code", "message", "requestId"],
    };

    doc.components!.schemas!.SuccessResponse = {
      type: "object",
      properties: {
        code: {
          type: "integer",
          description: "Status code (0 = success)",
          example: 0,
        },
        data: {
          description: "Response data",
        },
        requestId: {
          type: "string",
          description: "Request trace ID",
        },
      },
      required: ["code", "data", "requestId"],
    };

    // ── 添加 x-tagGroups（标签分组）────────────────────────
    //
    // Scalar / Redocly 支持的 vendor extension，将 tags 分组为两级导航。
    // 优先使用用户配置的 tagGroups，否则自动从路由文件路径推断。
    //
    const tagGroups = this.buildTagGroups(routes, doc.tags ?? []);
    if (tagGroups.length > 0) {
      doc["x-tagGroups"] = tagGroups;
    }

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
   *   2. 路径参数（validate.param → parameters[in=path]）
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
    // validate.param 是当前公开契约；validate.params 仅作为旧文档/旧用法兼容。
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

    // ── 请求体（body / multipart） ──────────────────────────
    // 仅 POST / PUT / PATCH 方法生成 requestBody。
    // multipart.files 优先于 validate.body（两者互斥）。
    if (["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
      if (options.multipart?.files) {
        // multipart/form-data 文件上传
        const properties: Record<string, JsonSchema> = {};
        const required: string[] = [];

        for (const [fieldname, fieldConfig] of Object.entries(
          options.multipart.files,
        )) {
          const desc =
            typeof fieldConfig === "string"
              ? fieldConfig
              : (fieldConfig.description ?? "上传的文件");
          properties[fieldname] = {
            type: "string",
            format: "binary",
            description: desc,
          };
          if (typeof fieldConfig === "object" && fieldConfig.required) {
            required.push(fieldname);
          }
        }

        operation.requestBody = {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties,
                ...(required.length > 0 ? { required } : {}),
              },
            },
          },
        };
      } else if (options.validate?.body) {
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
      // 尝试从 validate.body 推断响应 schema（写操作通常返回创建/更新后的对象）
      const isWriteMethod = ["POST", "PUT", "PATCH"].includes(
        method.toUpperCase(),
      );
      const hasBody =
        options.validate?.body &&
        typeof options.validate.body === "object" &&
        Object.keys(options.validate.body as Record<string, unknown>).length >
          0;

      if (isWriteMethod && hasBody) {
        const bodySchema = this.converter.convertValidateObject(
          options.validate!.body as Record<string, unknown>,
        );
        const statusCode = method.toUpperCase() === "POST" ? "201" : "200";
        const description =
          method.toUpperCase() === "POST"
            ? "Created successfully"
            : "Updated successfully";

        const wrappedSchema = this.wrapResponseSchema(
          Number(statusCode),
          bodySchema.schema,
        );

        // 生成示例值：从 schema properties 中提取 example
        const exampleData: Record<string, unknown> = {};
        if (bodySchema.schema.properties) {
          for (const [key, prop] of Object.entries(
            bodySchema.schema.properties,
          )) {
            if (prop.example !== undefined) {
              exampleData[key] = prop.example;
            } else if (prop.type === "string") {
              exampleData[key] = key;
            } else if (prop.type === "number" || prop.type === "integer") {
              exampleData[key] = 0;
            } else if (prop.type === "boolean") {
              exampleData[key] = true;
            }
          }
        }

        const wrappedExample = this.wrapResponseExample(
          Number(statusCode),
          exampleData,
        );

        operation.responses[statusCode] = {
          description,
          content: {
            "application/json": {
              schema: wrappedSchema,
              example: wrappedExample,
            },
          },
        };
      } else {
        operation.responses["200"] = {
          description: "OK",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SuccessResponse" },
            },
          },
        };
      }
    }

    // ── 通用错误响应（所有路由自动追加 4xx/5xx 引用）─────────
    if (!operation.responses["422"] && options.validate) {
      operation.responses["422"] = {
        description: "Validation error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: {
              code: 422,
              message: "Validation failed",
              requestId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            },
          },
        },
      };
    }
    if (!operation.responses["500"]) {
      operation.responses["500"] = {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
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
        description: "JWT Bearer Token authentication",
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
  /**
   * 构建标签分组（x-tagGroups）
   *
   * 优先级：
   *   1. 用户在 config.tagGroups 中显式配置 → 直接使用
   *   2. 未配置 → 自动从路由文件路径推断分组
   *
   * 自动推断逻辑：
   *   - 提取每条路由文件路径在 routes/ 之后的第一层目录名作为分组名
   *   - 同一分组下的所有 tags 归入该分组
   *   - 直接位于 routes/ 下的文件（如 routes/index.ts）归入 "General" 分组
   *   - 分组名首字母大写（如 api → Api, admin → Admin）
   *   - 如果所有路由都在同一个分组中（无多级），则不生成 x-tagGroups（避免冗余）
   *
   * @param routes 路由元信息列表
   * @param tags 已生成的 tags 列表（用于确保所有 tag 都被分组覆盖）
   * @returns tagGroups 数组，空数组表示不需要分组
   */
  private buildTagGroups(
    routes: RouteMetadata[],
    tags: Array<{ name: string; description?: string }>,
  ): Array<{ name: string; tags: string[] }> {
    // 用户显式配置 → 直接使用
    if (this.config.tagGroups && this.config.tagGroups.length > 0) {
      return this.config.tagGroups;
    }

    // 自动推断
    return this.inferTagGroups(routes, tags);
  }

  /**
   * 从路由文件路径自动推断标签分组
   *
   * 策略：
   *   - 提取 routes/ 之后的第一层目录名作为 group name
   *   - 直接在 routes/ 下的文件归入 "General" 组
   *   - 每个 group 收集其下所有 tag（去重排序）
   *   - 如果只有一个分组，返回空数组（不需要分组）
   *
   * @example
   *   routes/users.ts          → group "General", tag "users"
   *   routes/api/v1/users.ts   → group "Api",     tag 从 docs.tags 或推断
   *   routes/admin/dashboard.ts→ group "Admin",    tag 从 docs.tags 或推断
   */
  private inferTagGroups(
    routes: RouteMetadata[],
    tags: Array<{ name: string; description?: string }>,
  ): Array<{ name: string; tags: string[] }> {
    // group name → Set<tag name>
    const groupMap = new Map<string, Set<string>>();

    for (const route of routes) {
      // 提取 routes/ 之后的相对路径
      const relative = route.sourceFile
        .replace(/\\/g, "/")
        .replace(/^.*routes\//, "");

      // 获取第一层目录名
      const segments = relative.split("/");
      let groupName: string;

      if (segments.length <= 1) {
        // 直接在 routes/ 下的文件（如 routes/users.ts）
        groupName = "General";
      } else {
        // 取第一层目录名并首字母大写
        const firstDir = segments[0] ?? "General";
        groupName = firstDir.charAt(0).toUpperCase() + firstDir.slice(1);
      }

      // 获取该路由的 tags
      const routeTags = route.options.docs?.tags ?? [
        this.inferTagFromFile(route.sourceFile),
      ];

      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, new Set());
      }
      const tagSet = groupMap.get(groupName)!;
      for (const tag of routeTags) {
        tagSet.add(tag);
      }
    }

    // 如果只有一个分组（或没有路由），不需要 x-tagGroups
    if (groupMap.size <= 1) {
      return [];
    }

    // 确保所有已声明的 tags 都被覆盖
    // 收集已分组的 tags
    const groupedTags = new Set<string>();
    for (const tagSet of groupMap.values()) {
      for (const tag of tagSet) {
        groupedTags.add(tag);
      }
    }

    // 检查是否有未分组的 tags（来自 config.tags 但未被任何路由关联）
    const ungroupedTags: string[] = [];
    for (const tag of tags) {
      if (!groupedTags.has(tag.name)) {
        ungroupedTags.push(tag.name);
      }
    }

    // 构建结果（按 group name 排序，General 放最后）
    const result: Array<{ name: string; tags: string[] }> = [];

    const sortedGroups = [...groupMap.keys()].sort((a, b) => {
      if (a === "General") return 1;
      if (b === "General") return -1;
      return a.localeCompare(b);
    });

    for (const groupName of sortedGroups) {
      const tagSet = groupMap.get(groupName)!;
      result.push({
        name: groupName,
        tags: [...tagSet].sort(),
      });
    }

    // 未分组的 tags 追加到 "Other" 分组
    if (ungroupedTags.length > 0) {
      result.push({
        name: "Other",
        tags: ungroupedTags.sort(),
      });
    }

    return result;
  }

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

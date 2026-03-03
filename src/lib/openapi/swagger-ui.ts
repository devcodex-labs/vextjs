/**
 * swagger-ui.ts — Swagger UI HTML 模板 + 端点注册
 *
 * 注册两个内置端点：
 *   - GET /openapi.json  → 返回 OpenAPI JSON spec
 *   - GET /docs           → 返回 Swagger UI HTML 页面
 *
 * Swagger UI 通过 CDN 加载（无需本地静态资源），
 * 页面加载后从 /openapi.json 端点获取 spec 并渲染。
 *
 * 端点直接注册到 adapter（不走中间件链），
 * 与 router-loader 注册的业务路由隔离。
 *
 * @module lib/openapi/swagger-ui
 * @see 14-openapi.md §7（Swagger UI 集成）
 */

import type { VextApp } from "../../types/app.js";
import type { OpenAPIEndpointConfig } from "./types.js";

/**
 * 注册 Swagger UI 和 OpenAPI spec 端点
 *
 * 在 bootstrap 的 OpenAPI 初始化阶段调用（router-loader 之后、lockUse 之前）。
 * 两个端点均直接注册到 adapter，不经过路由级中间件。
 *
 * @param app    VextApp 实例（用于访问 adapter 和 logger）
 * @param spec   OpenAPI 文档对象（由 OpenAPIGenerator.generate() 生成）
 * @param config 端点配置（路径、Swagger UI 版本、展开模式等）
 *
 * @example
 * ```typescript
 * const spec = generator.generate(collector.getRoutes())
 * registerOpenAPIRoutes(app, spec, {
 *   docsPath: '/docs',
 *   specPath: '/openapi.json',
 *   tryItOutEnabled: true,
 *   docExpansion: 'list',
 * })
 * ```
 */
export function registerOpenAPIRoutes(
  app: VextApp,
  spec: object,
  config: OpenAPIEndpointConfig,
): void {
  const docsPath = config.docsPath ?? "/docs";
  const specPath = config.specPath ?? "/openapi.json";

  // ── OpenAPI JSON spec 端点 ────────────────────────────────
  //
  // 返回 JSON 格式的 OpenAPI 文档，供 Swagger UI 或外部工具消费。
  // 设置 CORS 允许跨域访问（方便外部工具拉取 spec）。
  //
  app.adapter.registerRoute("GET", specPath, [
    async (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.rawJson(spec);
    },
  ]);

  // ── Swagger UI HTML 端点 ──────────────────────────────────
  //
  // 返回内嵌 Swagger UI 的 HTML 页面。
  // UI 通过 CDN 加载 swagger-ui-dist，无需本地打包。
  //
  app.adapter.registerRoute("GET", docsPath, [
    async (_req, res) => {
      const html = generateSwaggerHTML(specPath, config);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.text(html);
    },
  ]);

  app.logger.info(`[openapi] docs:     ${docsPath}`);
  app.logger.info(`[openapi] spec:     ${specPath}`);
}

/**
 * 生成 Swagger UI HTML 页面
 *
 * 使用 CDN 加载 Swagger UI（无需本地静态资源），
 * 配置项通过 SwaggerUIBundle 初始化参数传入。
 *
 * 页面特性：
 *   - 隐藏默认 topbar（Swagger 品牌栏）
 *   - 支持 "Try it out" 在线调试
 *   - 支持深度链接（URL hash 定位到具体 API）
 *   - 支持配置展开级别（none / list / full）
 *   - 浅灰色背景，滚动条始终可见
 *
 * @param specUrl OpenAPI spec 端点路径（如 '/openapi.json'）
 * @param config  端点配置
 * @returns HTML 字符串
 */
function generateSwaggerHTML(
  specUrl: string,
  config: OpenAPIEndpointConfig,
): string {
  const title = config.title ?? "API Documentation";
  const version = config.swaggerUIVersion ?? "5.18.2";
  const tryItOut = config.tryItOutEnabled ?? true;
  const docExpansion = config.docExpansion ?? "list";
  const deepLinking = config.deepLinking ?? true;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${version}/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${version}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url:             '${escapeJs(specUrl)}',
        dom_id:          '#swagger-ui',
        deepLinking:     ${deepLinking},
        docExpansion:    '${escapeJs(docExpansion)}',
        tryItOutEnabled: ${tryItOut},
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset,
        ],
        layout: 'StandaloneLayout',
      })
    }
  </script>
</body>
</html>`;
}

/**
 * HTML 实体转义
 *
 * 防止 XSS：对 title 等用户可控字符串进行 HTML 转义。
 *
 * @param str 原始字符串
 * @returns 转义后的安全字符串
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JavaScript 字符串转义
 *
 * 对嵌入 JS 字符串字面量中的特殊字符进行转义，
 * 防止注入攻击。
 *
 * @param str 原始字符串
 * @returns 转义后的安全字符串
 */
function escapeJs(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/<\//g, "<\\/");
}

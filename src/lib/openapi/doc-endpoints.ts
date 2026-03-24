/**
 * doc-endpoints.ts — 文档端点统一注册入口
 *
 * 统一管理两个文档端点的注册：
 *   - GET /openapi.json  → 返回 OpenAPI JSON spec
 *   - GET /docs           → 返回 Scalar API Reference HTML 页面
 *                           （文档阅读 + 内置 Try it out 交互式测试）
 *
 * 替代原有的 Redoc + Swagger UI 双端点方案，
 * 使用 Scalar API Reference 在单一页面同时提供文档阅读和交互式测试。
 *
 * @module lib/openapi/doc-endpoints
 * @see 14-openapi.md §7（文档 UI 集成）
 * @changelog
 *   - v0.2.0: 从 Redoc + Swagger UI 双端点切换为 Scalar 单端点
 *             移除 ui: 'both' | 'redoc' | 'swagger' 配置
 *             简化为 /docs (Scalar) + /openapi.json (spec)
 */

import type { VextApp } from "../../types/app.js";
import type { DocEndpointsConfig } from "./types.js";
import { generateScalarHTML } from "./redoc-ui.js";

/**
 * 注册文档端点（统一入口）
 *
 * 注册 Scalar API Reference 和 OpenAPI spec 端点。
 * 在 bootstrap 的 OpenAPI 初始化阶段调用（router-loader 之后、lockUse 之前）。
 *
 * @param app    VextApp 实例（用于访问 adapter 和 logger）
 * @param spec   OpenAPI 文档对象（由 OpenAPIGenerator.generate() 生成）
 * @param config 端点配置
 *
 * @example
 * ```typescript
 * const spec = generator.generate(collector.getRoutes())
 * registerDocEndpoints(app, spec, {
 *   specPath: '/openapi.json',
 *   docsPath: '/docs',
 *   title: 'My API',
 *   scalar: {
 *     theme: 'purple',
 *     darkMode: true,
 *   },
 * })
 * ```
 */
export function registerDocEndpoints(
  app: VextApp,
  spec: object,
  config: DocEndpointsConfig,
): void {
  const specPath = config.specPath ?? "/openapi.json";
  const specPublicPath = config.specPublicPath ?? specPath;
  const docsPath = config.docsPath ?? "/docs";
  const title = config.title ?? "API Documentation";

  // ── OpenAPI JSON spec 端点 ────────────────────────────────
  //
  // 返回 JSON 格式的 OpenAPI 文档，供 Scalar / 外部工具消费。
  // 设置 CORS 允许跨域访问（方便外部工具拉取 spec）。
  //
  app.adapter.registerRoute("GET", specPath, [
    async (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.rawJson(spec);
    },
  ]);

  app.logger.info(`[openapi] spec:     ${specPath}`);

  // ── Scalar API Reference 端点 ─────────────────────────────
  //
  // Scalar 同时提供：
  //   - 左侧多级导航 TOC（按 tag 分组）
  //   - 中间区域展示 API 描述、参数、响应 schema
  //   - 右侧多语言代码示例（cURL / JavaScript / Python 等）
  //   - 内置 Try it out 交互式请求（无需跳转到其他页面）
  //   - 搜索（Ctrl+K / Cmd+K）
  //
  // 通过 CDN 加载 @scalar/api-reference，无需本地静态资源。
  //
  const scalarConfig = {
    title,
    ...config.scalar,
  };

  app.adapter.registerRoute("GET", docsPath, [
    async (_req, res) => {
      const html = generateScalarHTML(specPublicPath, scalarConfig);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.text(html);
    },
  ]);

  app.logger.info(`[openapi] docs:     ${docsPath} (Scalar API Reference)`);
}

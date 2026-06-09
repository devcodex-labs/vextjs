/**
 * doc-endpoints.ts — 文档端点统一注册入口
 *
 * 统一管理两个文档端点的注册：
 *   - GET /openapi.json      → 返回 OpenAPI JSON spec
 *   - GET /docs              → 返回 Scalar API Reference HTML 页面
 *                              （文档阅读 + 内置 Try it out 交互式测试）
 *   - GET /_vext/scalar.js   → 本地 Scalar JS 资产（由 registerScalarAssets 注册）
 *
 * 替代原有的 Redoc + Swagger UI 双端点方案，
 * 使用 Scalar API Reference 在单一页面同时提供文档阅读和交互式测试。
 *
 * Scalar JS 加载策略（v0.2.2 新增）：
 *   1. 用户配置了 scalar.cdnUrl → 使用用户配置（不做任何检测或安装）
 *   2. 本地已安装 @scalar/api-reference → 自动切换本地路由加载
 *   3. 本地未安装 → 自动安装后切换本地路由加载
 *   4. 安装失败 → throw 明确错误（不静默降级回 CDN）
 *
 * @module lib/openapi/doc-endpoints
 * @see 14-openapi.md §7（文档 UI 集成）
 * @changelog
 *   - v0.2.0: 从 Redoc + Swagger UI 双端点切换为 Scalar 单端点
 *             移除 ui: 'both' | 'redoc' | 'swagger' 配置
 *             简化为 /docs (Scalar) + /openapi.json (spec)
 *   - v0.2.2: 新增本地资产自动检测与安装（registerScalarAssets）
 *             彻底移除默认 CDN 依赖，解决中国大陆/内网/离线环境白屏问题
 */

import type { VextApp } from "../../types/app.js";
import type { DocEndpointsConfig } from "./types.js";
import { generateScalarHTML } from "./redoc-ui.js";
import { registerScalarAssets } from "./scalar-assets.js";

export type OpenAPISpecProvider = object | (() => object | Promise<object>);

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
  spec: OpenAPISpecProvider,
  config: DocEndpointsConfig,
): void {
  const specPath = config.specPath ?? "/openapi.json";
  const specPublicPath = config.specPublicPath ?? specPath;
  const docsPath = config.docsPath ?? "/docs";
  const title = config.title ?? "API Documentation";

  // ── 本地资产检测（自动安装，无 CDN 回退）────────────────────
  //
  // registerScalarAssets 行为：
  //   - 用户配置了 scalar.cdnUrl → 返回 null（不干预用户配置）
  //   - 本地包已安装 → 注册 /_vext/scalar.js → 返回本地路由路径
  //   - 本地包未安装 → 自动安装 → 注册路由 → 返回本地路由路径
  //   - 安装/读取失败 → throw（服务启动中止，提示手动安装）
  //
  const userCdnUrl = config.scalar?.cdnUrl;
  const localScalarUrl = registerScalarAssets(app, userCdnUrl);

  // scalarConfig 中的 cdnUrl 优先级：
  //   1. 用户配置（localScalarUrl 为 null 时，config.scalar.cdnUrl 通过 spread 保留）
  //   2. 本地路由（localScalarUrl 非 null 时，末尾 spread 覆盖为 /_vext/scalar.js）
  const scalarConfig = {
    title,
    ...config.scalar,
    ...(localScalarUrl ? { cdnUrl: localScalarUrl } : {}),
  };

  // ── OpenAPI JSON spec 端点 ────────────────────────────────
  //
  // 返回 JSON 格式的 OpenAPI 文档，供 Scalar / 外部工具消费。
  // 设置 CORS 允许跨域访问（方便外部工具拉取 spec）。
  //
  app.adapter.registerRoute("GET", specPath, [
    async (_req, res) => {
      const resolvedSpec = await resolveOpenAPISpec(spec);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.rawJson(resolvedSpec);
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
  // Scalar JS 加载地址由 scalarConfig.cdnUrl 控制：
  //   - 本地模式（默认）：/_vext/scalar.js（registerScalarAssets 注册的内存路由）
  //   - 用户自定义模式：scalar.cdnUrl 配置的地址
  //
  app.adapter.registerRoute("GET", docsPath, [
    async (_req, res) => {
      const html = generateScalarHTML(specPublicPath, scalarConfig);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.text(html);
    },
  ]);

  app.logger.info(`[openapi] docs:     ${docsPath} (Scalar API Reference)`);
}

async function resolveOpenAPISpec(spec: OpenAPISpecProvider): Promise<object> {
  if (typeof spec === "function") {
    return spec();
  }
  return spec;
}

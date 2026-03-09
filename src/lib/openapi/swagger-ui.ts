/**
 * swagger-ui.ts — 向后兼容桩
 *
 * 原有的 Swagger UI HTML 模板 + 端点注册模块。
 * 现已被 Scalar API Reference 替代（doc-endpoints.ts + redoc-ui.ts）。
 *
 * 保留 registerOpenAPIRoutes 导出以维持向后兼容，
 * 内部委托给 registerDocEndpoints（Scalar 实现）。
 *
 * @deprecated 使用 registerDocEndpoints 替代
 * @module lib/openapi/swagger-ui
 * @see doc-endpoints.ts（Scalar API Reference 实现）
 */

import type { VextApp } from "../../types/app.js";
import { registerDocEndpoints } from "./doc-endpoints.js";

/**
 * 向后兼容的端点注册接口
 *
 * @deprecated 请使用 `registerDocEndpoints` 替代。
 *             此函数仅为向后兼容保留，内部委托给 Scalar 实现。
 */
export interface LegacyEndpointConfig {
  /** 文档页面路径 @default '/docs' */
  docsPath?: string;

  /** OpenAPI spec 路径 @default '/openapi.json' */
  specPath?: string;

  /** 页面标题 */
  title?: string;

  /** 以下字段已废弃，保留签名以避免类型报错 */
  swaggerUIVersion?: string;
  tryItOutEnabled?: boolean;
  docExpansion?: "none" | "list" | "full";
  deepLinking?: boolean;
  filter?: boolean;
}

/**
 * 注册 OpenAPI 文档端点（向后兼容）
 *
 * @deprecated 请使用 `registerDocEndpoints` 替代。
 *             此函数内部委托给 Scalar API Reference 实现。
 *
 * @param app    VextApp 实例
 * @param spec   OpenAPI 文档对象
 * @param config 端点配置（仅 docsPath / specPath / title 生效，其余参数忽略）
 */
export function registerOpenAPIRoutes(
  app: VextApp,
  spec: object,
  config: LegacyEndpointConfig,
): void {
  registerDocEndpoints(app, spec, {
    specPath: config.specPath,
    docsPath: config.docsPath,
    title: config.title,
  });
}

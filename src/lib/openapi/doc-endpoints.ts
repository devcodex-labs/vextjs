/**
 * doc-endpoints.ts — 文档端点兼容入口
 *
 * OpenAPI spec 仍属于 openapi 模块；文档页面、系统资产、数据端点和
 * renderer 合同已迁移到 lib/docs。保留 registerDocEndpoints() 名称，
 * 让 bootstrap/dev reload 旧调用点可以渐进迁移。
 */

import type { VextApp } from "../../types/app.js";
import {
  registerDocsEndpoints,
  type OpenAPISpecProvider,
} from "../docs/register-docs-endpoints.js";
import type { DocEndpointsConfig } from "./types.js";

export type { OpenAPISpecProvider };

export function registerDocEndpoints(
  app: VextApp,
  spec: OpenAPISpecProvider,
  config: DocEndpointsConfig,
): void {
  registerDocsEndpoints(app, spec, config);
}

/**
 * redoc-ui.ts → scalar-ui.ts (保留原文件名以减少 import 变更)
 *
 * Scalar API Reference HTML 模板生成
 *
 * 生成基于 Scalar 的 API 文档 HTML 页面，提供：
 *   - 左侧多级导航 TOC（按 tag 分组）
 *   - 中间区域展示 API 描述、参数、响应 schema
 *   - 右侧代码示例面板（多语言：cURL / JavaScript / Python 等）
 *   - 内置 Try it out 交互式请求（无需跳转 Swagger UI）
 *   - 深色/浅色主题支持
 *   - 搜索（Ctrl+K / Cmd+K）
 *
 * Scalar 通过 CDN 加载（无需本地静态资源），
 * 页面加载后从 OpenAPI spec 端点获取 spec 并渲染。
 *
 * 替代原有 Redoc + Swagger UI 双端点方案，
 * 用单一 Scalar 端点同时满足文档阅读和交互式测试需求。
 *
 * @module lib/openapi/redoc-ui
 * @see 14-openapi.md §7（文档 UI 集成）
 * @changelog
 *   - v0.2.0: 从 Redoc 切换为 Scalar API Reference
 *             合并文档阅读 + Try it out 到单一 /docs 端点
 */

import type { ScalarConfig } from "./types.js";

/**
 * 生成 Scalar API Reference HTML 页面
 *
 * 使用 CDN 加载 Scalar（无需本地静态资源），
 * 配置项通过 Scalar.createApiReference() 初始化参数传入。
 *
 * 页面特性：
 *   - 左侧多级导航（tag -> operation -> schema）
 *   - 响应式布局（modern / classic）
 *   - 深色/浅色主题支持（10+ 内置主题）
 *   - 内置 Try it out（同一页面发起 HTTP 请求）
 *   - 多语言代码示例（cURL / JavaScript / Python 等）
 *   - 搜索功能（Ctrl+K / Cmd+K）
 *   - 深度链接（URL hash 定位到具体 API）
 *
 * @param specUrl   OpenAPI spec 端点路径（如 '/openapi.json'）
 * @param config    Scalar 配置
 * @returns HTML 字符串
 */
export function generateScalarHTML(
  specUrl: string,
  config?: ScalarConfig,
): string {
  const title = config?.title ?? "API Documentation";

  // ── 构建 Scalar 配置对象 ────────────────────────────────────
  //
  // 当配置了 sources 时，使用 sources 数组替代单一 url。
  // 框架自动生成的 spec（specUrl）会作为默认 source 注入，
  // 除非 sources 中已包含相同路径。
  //
  const scalarConfig: Record<string, unknown> = {};

  if (config?.sources && config.sources.length > 0) {
    // 检查用户是否已在 sources 中包含了本地 spec 路径
    const hasLocalSpec = config.sources.some((s) => s.url === specUrl);
    const sources = hasLocalSpec
      ? config.sources
      : [{ title: config?.title ?? "API", url: specUrl }, ...config.sources];
    scalarConfig.sources = sources;
  } else {
    scalarConfig.url = specUrl;
  }

  // 主题
  if (config?.theme && config.theme !== "default") {
    scalarConfig.theme = config.theme;
  }

  // 深色模式
  if (config?.darkMode !== undefined) {
    scalarConfig.darkMode = config.darkMode;
  }

  // 布局
  if (config?.layout) {
    scalarConfig.layout = config.layout;
  }

  // 侧边栏
  if (config?.showSidebar !== undefined) {
    scalarConfig.showSidebar = config.showSidebar;
  }

  // 隐藏 Models
  if (config?.hideModels !== undefined) {
    scalarConfig.hideModels = config.hideModels;
  }

  // 隐藏的客户端语言
  if (config?.hiddenClients && config.hiddenClients.length > 0) {
    scalarConfig.hiddenClients = config.hiddenClients;
  }

  // 搜索热键
  if (config?.searchHotKey) {
    scalarConfig.searchHotKey = config.searchHotKey;
  }

  // 代理 URL（用于 Try it out 避免 CORS）
  if (config?.proxyUrl) {
    scalarConfig.proxyUrl = config.proxyUrl;
  }

  // 自定义 CSS
  if (config?.customCss) {
    scalarConfig.customCss = config.customCss;
  }

  // 默认字体
  if (config?.withDefaultFonts !== undefined) {
    scalarConfig.withDefaultFonts = config.withDefaultFonts;
  }

  // 默认 HTTP 客户端
  if (config?.defaultHttpClient) {
    scalarConfig.defaultHttpClient = config.defaultHttpClient;
  }

  const configJson = escapeJs(JSON.stringify(scalarConfig));

  // ── Favicon ─────────────────────────────────────────────────
  //
  // 支持 SVG / ICO / PNG 等格式，根据路径后缀自动推断 MIME type。
  // 未配置时不输出 <link rel="icon">，浏览器使用默认行为（请求 /favicon.ico）。
  //
  let faviconTag = "";
  if (config?.favicon) {
    const href = escapeHtml(config.favicon);
    const type = config.favicon.endsWith(".svg")
      ? ' type="image/svg+xml"'
      : config.favicon.endsWith(".png")
        ? ' type="image/png"'
        : "";
    faviconTag = `\n  <link rel="icon" href="${href}"${type} />`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>${faviconTag}
  <style>
    html, body { margin: 0; padding: 0; height: 100%; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="${escapeHtml(config?.cdnUrl ?? "https://cdn.jsdelivr.net/npm/@scalar/api-reference")}" crossorigin></script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      var config = JSON.parse('${configJson}');
      Scalar.createApiReference('#app', config);
    });
  </script>
</body>
</html>`;
}

// ── 向后兼容导出 ────────────────────────────────────────────
//
// bootstrap.ts 和 doc-endpoints.ts 之前 import { generateRedocHTML }，
// 为减少变更范围，同时导出旧名称作为别名。
// 新代码应使用 generateScalarHTML。
//

/** @deprecated 使用 generateScalarHTML 替代 */
export const generateRedocHTML = generateScalarHTML;

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

import type { ResolvedVextDocsConfig } from "../types.js";
import {
  VEXT_BRAND_ASSET_VERSION,
  renderVextDocsThemeVariables,
  renderVextMarkSvg,
} from "../../brand/vext-brand.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function versionedAssetUrl(value: string): string {
  const separator = value.includes("?") ? "&" : "?";
  return `${value}${separator}v=${VEXT_BRAND_ASSET_VERSION}`;
}

function renderCriticalBootScript(): string {
  return `<script id="vext-docs-critical-boot">
(function () {
  try {
    var theme = localStorage.getItem("vext-docs-theme");
    if (theme === "system" || theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-vext-docs-theme", theme);
    }
    var density = localStorage.getItem("vext-docs-density");
    if (density === "comfortable" || density === "compact") {
      document.documentElement.setAttribute("data-vext-docs-density", density);
    }
  } catch (_) {}
})();
</script>`;
}

function renderCriticalStyle(): string {
  return `<style id="vext-docs-critical-style">
:root {
${renderVextDocsThemeVariables("light")}
}
:root[data-vext-docs-theme="dark"] {
${renderVextDocsThemeVariables("dark")}
}
@media (prefers-color-scheme: dark) {
  :root[data-vext-docs-theme="system"] {
${renderVextDocsThemeVariables("dark")}
  }
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--vext-bg);
  color: var(--vext-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.vext-docs-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: var(--vext-docs-sidebar-width, 280px) 8px minmax(0, 1fr);
}
.vext-docs-sidebar {
  min-height: 100vh;
  padding: 20px;
  border-right: 1px solid var(--vext-line);
  background: var(--vext-panel);
}
.vext-docs-brand {
  display: flex;
  gap: 10px;
  align-items: center;
  font-weight: 700;
}
.vext-docs-brand-mark {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
}
.vext-docs-resizer {
  width: 8px;
}
.vext-docs-content {
  min-width: 0;
  padding: 32px;
}
.vext-docs-header {
  display: grid;
  grid-template-columns: minmax(160px, 260px) minmax(180px, 1fr);
  gap: 16px;
  align-items: center;
}
.vext-docs-header h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.15;
}
.vext-docs-search-input {
  min-height: 40px;
  border: 1px solid var(--vext-line);
  border-radius: 8px;
  background: var(--vext-panel);
  color: var(--vext-text);
}
.vext-docs-panel {
  min-height: 260px;
  margin-top: 20px;
  border: 1px solid var(--vext-line);
  border-radius: 8px;
  background: var(--vext-panel-soft);
}
.vext-docs-nav-skeleton,
.vext-docs-loading {
  display: grid;
  gap: 12px;
}
.vext-docs-loading {
  padding: 18px;
}
.vext-docs-loading-card {
  min-height: 126px;
  padding: 16px;
  border: 1px solid var(--vext-line);
  border-radius: 8px;
  background: var(--vext-panel);
}
.vext-docs-nav-skeleton-line,
.vext-docs-loading-line {
  border-radius: 999px;
  background: var(--vext-line);
  opacity: 0.68;
}
.vext-docs-nav-skeleton-line {
  height: 30px;
}
.vext-docs-nav-skeleton-line.is-child {
  margin-left: 18px;
}
.vext-docs-loading-line {
  height: 10px;
  margin: 10px 0;
}
.vext-docs-loading-line.is-short {
  width: 30%;
}
.vext-docs-loading-line.is-medium {
  width: 55%;
}
@media (max-width: 760px) {
  .vext-docs-shell {
    display: block;
  }
  .vext-docs-sidebar {
    min-height: auto;
  }
  .vext-docs-content {
    padding: 20px;
  }
  .vext-docs-header {
    grid-template-columns: 1fr;
  }
}
</style>`;
}

export function renderVextDocsHTML(config: ResolvedVextDocsConfig): string {
  const title = config.ui.title;
  const boot = {
    title,
    docsPath: config.path,
    assetsPath: config.assetsPublicPath,
    specPath: config.specPath,
    specPublicPath: config.specPublicPath,
    endpoints: config.publicEndpoints,
    ui: config.ui,
    tryItOut: config.tryItOut,
    assetVersion: VEXT_BRAND_ASSET_VERSION,
    accessMode: config.access.mode,
    project: config.project,
  };

  return `<!doctype html>
<html lang="en" data-vext-docs-theme="${escapeHtml(config.ui.theme)}" data-vext-docs-density="${escapeHtml(config.ui.density)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="${escapeHtml(versionedAssetUrl(config.publicEndpoints.faviconSvg))}">
  ${renderCriticalBootScript()}
  ${renderCriticalStyle()}
  <link rel="stylesheet" href="${escapeHtml(versionedAssetUrl(config.publicEndpoints.styleCss))}">
</head>
<body>
  <main id="vext-docs-root" class="vext-docs-shell">
    <div id="vext-docs-sidebar-backdrop" class="vext-docs-sidebar-backdrop" hidden></div>
    <aside id="vext-docs-sidebar" class="vext-docs-sidebar">
      <div class="vext-docs-brand">${renderVextMarkSvg({ className: "vext-docs-brand-mark", ariaHidden: true })}<span>Vext Docs</span></div>
      <div id="vext-docs-mobile-sidebar-tools" class="vext-docs-mobile-sidebar-tools" aria-label="Mobile documentation tools"></div>
      <nav id="vext-docs-nav" aria-label="Documentation sections">
        <div class="vext-docs-nav-skeleton" aria-hidden="true">
          <div class="vext-docs-nav-skeleton-line"></div>
          <div class="vext-docs-nav-skeleton-line"></div>
          <div class="vext-docs-nav-skeleton-line is-child"></div>
          <div class="vext-docs-nav-skeleton-line is-child"></div>
          <div class="vext-docs-nav-skeleton-line"></div>
        </div>
      </nav>
    </aside>
    <div id="vext-docs-resizer" class="vext-docs-resizer" role="separator" aria-orientation="vertical" aria-label="Resize navigation" tabindex="0"></div>
    <section class="vext-docs-content">
      <header class="vext-docs-header">
        <button id="vext-docs-mobile-nav-toggle" class="vext-docs-mobile-nav-toggle" type="button" aria-controls="vext-docs-sidebar" aria-expanded="false">Menu</button>
        <h1>${escapeHtml(title)}</h1>
        <input id="vext-docs-search" class="vext-docs-search-input" type="search" placeholder="Search" aria-label="Search documentation">
      </header>
      <div id="vext-docs-status" class="vext-docs-status">Loading documentation...</div>
      <div id="vext-docs-panel" class="vext-docs-panel" aria-busy="true">
        <div class="vext-docs-loading" aria-hidden="true">
          <div class="vext-docs-loading-card">
            <div class="vext-docs-loading-line is-short"></div>
            <div class="vext-docs-loading-line is-medium"></div>
            <div class="vext-docs-loading-line"></div>
          </div>
          <div class="vext-docs-loading-card">
            <div class="vext-docs-loading-line is-short"></div>
            <div class="vext-docs-loading-line is-medium"></div>
            <div class="vext-docs-loading-line"></div>
          </div>
        </div>
      </div>
    </section>
  </main>
  <noscript><p class="vext-docs-noscript">JavaScript is required to browse this documentation.</p></noscript>
  <script id="vext-docs-config" type="application/json">${safeJson(boot)}</script>
  <script src="${escapeHtml(versionedAssetUrl(config.publicEndpoints.appJs))}" defer></script>
</body>
</html>`;
}

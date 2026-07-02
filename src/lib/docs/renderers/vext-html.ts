import type { ResolvedVextDocsConfig } from "../types.js";

const VEXT_DOCS_ASSET_VERSION = "20260702-b31";

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
  return `${value}${separator}v=${VEXT_DOCS_ASSET_VERSION}`;
}

export function renderVextDocsHTML(config: ResolvedVextDocsConfig): string {
  const title = config.ui.title;
  const boot = {
    title,
    docsPath: config.path,
    assetsPath: config.assetsPath,
    specPath: config.specPath,
    specPublicPath: config.specPublicPath,
    endpoints: config.endpoints,
    ui: config.ui,
    assetVersion: VEXT_DOCS_ASSET_VERSION,
    accessMode: config.access.mode,
    project: config.project,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="${escapeHtml(versionedAssetUrl(config.endpoints.styleCss))}">
</head>
<body>
  <main id="vext-docs-root" class="vext-docs-shell">
    <div id="vext-docs-sidebar-backdrop" class="vext-docs-sidebar-backdrop" hidden></div>
    <aside id="vext-docs-sidebar" class="vext-docs-sidebar">
      <div class="vext-docs-brand">Vext Docs</div>
      <div id="vext-docs-mobile-sidebar-tools" class="vext-docs-mobile-sidebar-tools" aria-label="Mobile documentation tools"></div>
      <nav id="vext-docs-nav" aria-label="Documentation sections"></nav>
    </aside>
    <div id="vext-docs-resizer" class="vext-docs-resizer" role="separator" aria-orientation="vertical" aria-label="Resize navigation" tabindex="0"></div>
    <section class="vext-docs-content">
      <header class="vext-docs-header">
        <button id="vext-docs-mobile-nav-toggle" class="vext-docs-mobile-nav-toggle" type="button" aria-controls="vext-docs-sidebar" aria-expanded="false">Menu</button>
        <h1>${escapeHtml(title)}</h1>
        <input id="vext-docs-search" class="vext-docs-search-input" type="search" placeholder="Search" aria-label="Search documentation">
      </header>
      <div id="vext-docs-status" class="vext-docs-status">Loading documentation...</div>
      <div id="vext-docs-panel" class="vext-docs-panel"></div>
    </section>
  </main>
  <noscript><p class="vext-docs-noscript">JavaScript is required to browse this documentation.</p></noscript>
  <script id="vext-docs-config" type="application/json">${safeJson(boot)}</script>
  <script src="${escapeHtml(versionedAssetUrl(config.endpoints.appJs))}" defer></script>
</body>
</html>`;
}

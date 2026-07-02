export const VEXT_DOCS_STYLE_CSS = `
:root {
  color-scheme: light;
  --vext-bg: #f7f8fb;
  --vext-panel: #ffffff;
  --vext-text: #20242c;
  --vext-muted: #6b7280;
  --vext-line: #d8dee8;
  --vext-accent: #2563eb;
  --vext-accent-soft: #e8f0ff;
  --vext-code: #111827;
  --vext-success: #10b981;
  --vext-panel-soft: #f3f6fb;
  --vext-code-bg: #111827;
  --vext-code-fg: #f9fafb;
  --vext-card-shadow: 0 7px 18px rgba(15, 23, 42, 0.07);
  --vext-card-shadow-hover: 0 10px 24px rgba(15, 23, 42, 0.11);
  --vext-density-scale: 1;
}

:root[data-vext-docs-theme="dark"] {
  color-scheme: dark;
  --vext-bg: #111827;
  --vext-panel: #182233;
  --vext-text: #f8fafc;
  --vext-muted: #a9b4c5;
  --vext-line: #334155;
  --vext-accent: #60a5fa;
  --vext-accent-soft: #1d365d;
  --vext-code: #f8fafc;
  --vext-panel-soft: #0f172a;
  --vext-code-bg: #020617;
  --vext-code-fg: #e5e7eb;
  --vext-card-shadow: 0 7px 18px rgba(0, 0, 0, 0.24);
  --vext-card-shadow-hover: 0 10px 24px rgba(0, 0, 0, 0.34);
}

:root[data-vext-docs-density="compact"] {
  --vext-density-scale: 0.82;
}

@media (prefers-color-scheme: dark) {
  :root[data-vext-docs-theme="system"] {
    color-scheme: dark;
    --vext-bg: #111827;
    --vext-panel: #182233;
    --vext-text: #f8fafc;
    --vext-muted: #a9b4c5;
    --vext-line: #334155;
    --vext-accent: #60a5fa;
    --vext-accent-soft: #1d365d;
    --vext-code: #f8fafc;
    --vext-panel-soft: #0f172a;
    --vext-code-bg: #020617;
    --vext-code-fg: #e5e7eb;
    --vext-card-shadow: 0 7px 18px rgba(0, 0, 0, 0.24);
    --vext-card-shadow-hover: 0 10px 24px rgba(0, 0, 0, 0.34);
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
  border-right: 1px solid var(--vext-line);
  background: var(--vext-panel);
  padding: 20px;
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  overflow-y: auto;
  scrollbar-color: var(--vext-line) transparent;
  scrollbar-width: thin;
}

.vext-docs-sidebar::-webkit-scrollbar {
  width: 8px;
}

.vext-docs-sidebar::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--vext-line);
}

.vext-docs-sidebar::-webkit-scrollbar-track {
  background: transparent;
}

.vext-docs-resizer {
  position: sticky;
  top: 0;
  align-self: start;
  width: 8px;
  height: 100vh;
  cursor: col-resize;
  touch-action: none;
  z-index: 5;
}

.vext-docs-resizer::after {
  content: "";
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 3px;
  width: 2px;
  border-radius: 999px;
  background: transparent;
  transition: background 120ms ease;
}

.vext-docs-resizer:hover::after,
.vext-docs-resizer:focus-visible::after,
.vext-docs-resizing .vext-docs-resizer::after {
  background: var(--vext-accent);
}

.vext-docs-resizer:focus-visible {
  outline: 2px solid var(--vext-accent);
  outline-offset: 2px;
}

.vext-docs-resizing {
  cursor: col-resize;
  user-select: none;
}

.vext-docs-brand {
  font-weight: 700;
  margin-bottom: 18px;
}

.vext-docs-content {
  min-width: 0;
  padding: 24px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0 18px;
}

.vext-docs-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px 16px;
  align-items: end;
  justify-content: stretch;
  margin-bottom: 22px;
}

.vext-docs-search-tools,
.vext-docs-ui-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.vext-docs-ui-controls {
  grid-column: 1 / -1;
  align-self: end;
}

.vext-docs-search-tools {
  grid-column: 1 / -1;
  align-self: end;
}

.vext-docs-ui-controls label {
  display: inline-grid;
  gap: 3px;
  color: var(--vext-muted);
  font-size: 11px;
}

.vext-docs-ui-controls select {
  height: 30px;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel);
  color: var(--vext-text);
  font: inherit;
  font-size: 12px;
  padding: 0 8px;
}

.vext-docs-filter-button,
.vext-docs-copy-button,
.vext-docs-overview-button {
  min-height: 28px;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel);
  color: var(--vext-muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 5px 8px;
}

.vext-docs-filter-button[aria-pressed="true"],
.vext-docs-filter-button:hover,
.vext-docs-filter-button:focus-visible,
.vext-docs-copy-button:hover,
.vext-docs-copy-button:focus-visible,
.vext-docs-overview-button:hover,
.vext-docs-overview-button:focus-visible {
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  outline: none;
}

.vext-docs-copy-button.is-copied {
  border-color: var(--vext-success);
  color: var(--vext-success);
}

.vext-docs-header h1 {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
}

.vext-docs-header input {
  grid-column: 1 / -1;
  width: min(760px, 100%);
  height: 36px;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel);
  color: var(--vext-text);
  padding: 0 12px;
  font: inherit;
}

.vext-docs-auth {
  grid-column: 1 / -1;
  width: min(760px, 100%);
  min-width: 0;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel);
}

.vext-docs-auth summary {
  cursor: pointer;
  padding: 8px 10px;
  color: var(--vext-accent);
  font-weight: 650;
}

.vext-docs-auth-body {
  display: grid;
  gap: 8px;
  padding: 0 10px 10px;
}

.vext-docs-auth label {
  display: grid;
  gap: 5px;
  color: var(--vext-muted);
  font-size: 12px;
}

.vext-docs-auth input {
  width: 100%;
  height: 32px;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel);
  padding: 0 10px;
  color: var(--vext-text);
  font: inherit;
}

.vext-docs-status {
  color: var(--vext-muted);
  margin-bottom: 12px;
}

.vext-docs-panel {
  background: var(--vext-panel-soft);
  border: 1px solid var(--vext-line);
  border-radius: 8px;
  overflow: visible;
  padding: 10px 0 18px;
}

.vext-docs-panel[data-vext-docs-view="overview"] {
  background: transparent;
  border: 0;
  padding: 0;
}

.vext-docs-panel[data-vext-docs-view="overview"] .vext-docs-code-item {
  margin: 0;
}

.vext-docs-outline {
  display: none;
}

.vext-docs-outline[hidden] {
  display: none !important;
}

@media (min-width: 1400px) {
  .vext-docs-content {
    grid-template-columns: minmax(0, 1fr) 230px;
  }

  .vext-docs-header,
  .vext-docs-status,
  .vext-docs-panel {
    grid-column: 1;
  }

  .vext-docs-outline {
    display: block;
    grid-column: 2;
    grid-row: 2 / span 2;
    align-self: start;
    position: sticky;
    top: 18px;
    max-height: calc(100vh - 36px);
    overflow-y: auto;
    border: 1px solid var(--vext-line);
    border-radius: 8px;
    background: var(--vext-panel);
    padding: 12px;
  }
}

.vext-docs-outline-title {
  margin: 0 0 8px;
  color: var(--vext-text);
  font-size: 13px;
  font-weight: 700;
}

.vext-docs-outline-link {
  display: block;
  border-radius: 5px;
  color: var(--vext-muted);
  font-size: 12px;
  line-height: 1.35;
  padding: 6px 7px;
  text-decoration: none;
}

.vext-docs-outline-link:hover,
.vext-docs-outline-link:focus-visible {
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  outline: none;
}

.vext-docs-empty,
.vext-docs-error {
  padding: 18px;
  color: var(--vext-muted);
}

.vext-docs-operation {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  margin: 16px 22px 26px;
  padding: calc(18px * var(--vext-density-scale));
  border: 1px solid #cbd5e1;
  border-left: 4px solid #93c5fd;
  border-radius: 8px;
  background: var(--vext-panel);
  box-shadow: var(--vext-card-shadow);
  transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}

.vext-docs-operation:hover,
.vext-docs-operation:focus-within {
  border-color: #bfdbfe;
  border-left-color: var(--vext-accent);
  box-shadow: var(--vext-card-shadow-hover);
  transform: translateY(-1px);
}

.vext-docs-operation:last-child {
  margin-bottom: 6px;
}

.vext-docs-operation + .vext-docs-operation {
  margin-top: 24px;
}

.vext-docs-operation-body {
  min-width: 0;
}

.vext-docs-operation-body > .vext-docs-detail,
.vext-docs-operation-body > .vext-docs-tryout {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e8edf5;
}

.vext-docs-method {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  border-radius: 4px;
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  font-weight: 700;
  font-size: 12px;
}

.vext-docs-path {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  color: var(--vext-code);
  overflow-wrap: anywhere;
}

.vext-docs-summary {
  margin: 4px 0 0;
  color: var(--vext-muted);
  line-height: 1.55;
}

.vext-docs-meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.vext-docs-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border: 1px solid var(--vext-line);
  border-radius: 4px;
  padding: 0 7px;
  color: var(--vext-muted);
  font-size: 12px;
}

.vext-docs-source-link {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border: 1px solid var(--vext-line);
  border-radius: 4px;
  padding: 0 7px;
  color: var(--vext-accent);
  font-size: 12px;
  text-decoration: none;
}

.vext-docs-source-link:hover,
.vext-docs-source-link:focus-visible {
  background: var(--vext-accent-soft);
  outline: none;
}

.vext-docs-code-item {
  margin: 16px 22px 26px;
  padding: 18px 20px 20px;
  border: 1px solid #cbd5e1;
  border-left: 4px solid #a7f3d0;
  border-radius: 8px;
  background: var(--vext-panel);
  box-shadow: var(--vext-card-shadow);
  transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}

.vext-docs-code-item:hover,
.vext-docs-code-item:focus-within {
  border-color: #bbf7d0;
  border-left-color: #10b981;
  box-shadow: var(--vext-card-shadow-hover);
  transform: translateY(-1px);
}

.vext-docs-code-item:last-child {
  margin-bottom: 6px;
}

.vext-docs-code-item + .vext-docs-code-item {
  margin-top: 24px;
}

.vext-docs-code-title {
  margin: 0 0 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e8edf5;
  font-size: 16px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.vext-docs-code-desc,
.vext-docs-code-section {
  margin: 16px 0 0;
  padding-top: 16px;
  border-top: 1px solid #e8edf5;
  color: var(--vext-muted);
  line-height: 1.6;
}

.vext-docs-code-desc {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.vext-docs-code-desc p {
  margin: 0 0 8px;
}

.vext-docs-code-desc p:last-child,
.vext-docs-code-list:last-child,
.vext-docs-code-inline-block:last-child {
  margin-bottom: 0;
}

.vext-docs-code-list {
  margin: 8px 0;
  padding-left: 20px;
}

.vext-docs-code-list li {
  margin: 4px 0;
}

.vext-docs-code-inline-block {
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel-soft);
  color: var(--vext-code);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.vext-docs-code-section strong {
  display: block;
  margin-bottom: 8px;
  color: var(--vext-text);
}

@media (max-width: 980px) {
  .vext-docs-header {
    grid-template-columns: minmax(0, 1fr);
  }

  .vext-docs-ui-controls,
  .vext-docs-search-tools {
    grid-column: 1 / -1;
  }
}

.vext-docs-model-note {
  color: var(--vext-muted);
  font-size: 13px;
}

.vext-docs-section {
  border-bottom: 1px solid var(--vext-line);
  padding: 12px 0 22px;
}

.vext-docs-section:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.vext-docs-section-heading {
  margin: 0;
  padding: 2px 22px 8px;
  font-size: 15px;
  line-height: 1.35;
}

.vext-docs-detail {
  margin-top: 12px;
}

.vext-docs-detail h3,
.vext-docs-detail h4 {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.35;
}

.vext-docs-detail p {
  margin: 0 0 8px;
  color: var(--vext-muted);
  line-height: 1.55;
}

.vext-docs-response-explorer {
  display: block;
}

.vext-docs-response-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
  max-width: 100%;
  overflow-x: auto;
}

.vext-docs-response-tab {
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel);
  color: var(--vext-muted);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  text-align: center;
  white-space: nowrap;
}

.vext-docs-response-tab[aria-selected="true"] {
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  font-weight: 650;
}

.vext-docs-response-panel {
  min-width: 0;
}

.vext-docs-metadata {
  margin-top: 8px;
}

.vext-docs-metadata summary {
  cursor: pointer;
  color: var(--vext-muted);
  font-size: 12px;
}

.vext-docs-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
}

.vext-docs-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  font-size: 13px;
}

.vext-docs-table th,
.vext-docs-table td {
  border-bottom: 1px solid var(--vext-line);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

.vext-docs-table th {
  background: var(--vext-panel-soft);
  color: var(--vext-text);
  font-weight: 650;
}

.vext-docs-table tr:last-child td {
  border-bottom: 0;
}

.vext-docs-table code,
.vext-docs-path code {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}

.vext-docs-code-section pre {
  margin: 8px 0 0;
  padding: 12px;
  max-width: 100%;
  overflow: auto;
  border-radius: 6px;
  background: var(--vext-code-bg);
  color: var(--vext-code-fg);
}

.vext-docs-tryout {
  margin-top: 12px;
  border-top: 1px dashed var(--vext-line);
  padding-top: 12px;
}

.vext-docs-tryout summary {
  cursor: pointer;
  color: var(--vext-accent);
  font-weight: 600;
}

.vext-docs-tryout-grid {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}

.vext-docs-tryout-target,
.vext-docs-auth-note,
.vext-docs-kv-section,
.vext-docs-code-samples,
.vext-docs-history,
.vext-docs-response-toolbar {
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel-soft);
  padding: 10px;
}

.vext-docs-tryout-target {
  color: var(--vext-muted);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.vext-docs-tryout-tabs,
.vext-docs-sample-tabs {
  display: grid;
  gap: 10px;
}

.vext-docs-tablist {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  overflow-x: auto;
  padding-bottom: 2px;
}

.vext-docs-tab {
  min-width: 0 !important;
  border: 1px solid var(--vext-line) !important;
  background: var(--vext-panel) !important;
  color: var(--vext-muted) !important;
}

.vext-docs-tab[aria-selected="true"] {
  background: var(--vext-accent-soft) !important;
  color: var(--vext-accent) !important;
  font-weight: 650;
}

.vext-docs-tabpanel {
  min-height: 132px;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel-soft);
  padding: 10px;
}

.vext-docs-tabpanel[hidden] {
  display: none;
}

.vext-docs-tryout-panel-grid {
  display: grid;
  gap: 10px;
}

.vext-docs-tryout-target strong,
.vext-docs-auth-note strong,
.vext-docs-kv-section strong,
.vext-docs-code-samples strong,
.vext-docs-history strong {
  display: block;
  margin-bottom: 8px;
  color: var(--vext-text);
}

.vext-docs-kv-section {
  display: grid;
  gap: 8px;
}

.vext-docs-kv-empty {
  margin: 0;
  color: var(--vext-muted);
  font-size: 13px;
  line-height: 1.5;
}

.vext-docs-kv-row {
  display: grid;
  grid-template-columns: minmax(90px, 0.8fr) minmax(120px, 1.2fr) auto;
  gap: 6px;
  align-items: center;
}

.vext-docs-kv-row button,
.vext-docs-tryout-actions button,
.vext-docs-response-toolbar button,
.vext-docs-history button,
.vext-docs-code-samples button {
  min-height: 30px;
}

.vext-docs-tryout-actions,
.vext-docs-response-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.vext-docs-tryout-status {
  min-width: 120px;
  color: var(--vext-muted);
  font-size: 13px;
}

.vext-docs-secondary-button {
  border: 1px solid var(--vext-line) !important;
  background: var(--vext-panel) !important;
  color: var(--vext-muted) !important;
}

.vext-docs-secondary-button:hover,
.vext-docs-secondary-button:focus-visible {
  background: var(--vext-accent-soft) !important;
  color: var(--vext-accent) !important;
  outline: none;
}

.vext-docs-auth-note {
  color: var(--vext-muted);
  font-size: 13px;
  line-height: 1.55;
}

.vext-docs-auth-note ul,
.vext-docs-history-list {
  margin: 8px 0 0;
  padding-left: 18px;
}

.vext-docs-auth-note li,
.vext-docs-history-list li {
  margin: 4px 0;
}

.vext-docs-code-samples {
  display: grid;
  gap: 10px;
}

.vext-docs-code-sample {
  display: grid;
  gap: 8px;
}

.vext-docs-code-sample-header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.vext-docs-code-sample pre {
  margin: 0;
  max-width: 100%;
  max-height: 220px;
  overflow: auto;
  border-radius: 6px;
  background: var(--vext-code-bg);
  color: var(--vext-code-fg);
  padding: 12px;
  white-space: pre;
}

.vext-docs-history-list button {
  width: 100%;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel);
  color: var(--vext-text);
  cursor: pointer;
  font: inherit;
  padding: 8px 10px;
  text-align: left;
}

.vext-docs-history-list button:hover,
.vext-docs-history-list button:focus-visible {
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  outline: none;
}

.vext-docs-tryout label {
  display: grid;
  gap: 5px;
  color: var(--vext-muted);
  font-size: 13px;
}

.vext-docs-tryout input,
.vext-docs-tryout select,
.vext-docs-tryout textarea {
  width: 100%;
  border: 1px solid var(--vext-line);
  border-radius: 6px;
  background: var(--vext-panel);
  padding: 8px 10px;
  color: var(--vext-text);
  font: inherit;
}

.vext-docs-tryout textarea {
  min-height: 76px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}

.vext-docs-tryout button {
  justify-self: start;
  border: 0;
  border-radius: 6px;
  background: var(--vext-accent);
  color: white;
  cursor: pointer;
  font: inherit;
  min-width: 76px;
  padding: 8px 12px;
}

.vext-docs-tryout button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.vext-docs-tryout .vext-docs-copy-button {
  border: 1px solid var(--vext-line);
  background: var(--vext-panel);
  color: var(--vext-muted);
}

.vext-docs-tryout-result {
  margin: 8px 0 0;
  padding: 12px;
  overflow: auto;
  border-radius: 6px;
  background: var(--vext-code-bg);
  color: var(--vext-code-fg);
  height: 180px;
  min-height: 180px;
  max-height: 320px;
  white-space: pre-wrap;
}

.vext-docs-nav-button {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--vext-text);
  text-align: left;
  padding: 8px 10px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  cursor: pointer;
}

.vext-docs-nav-button[aria-current="page"] {
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  font-weight: 650;
}

.vext-docs-nav-button:hover,
.vext-docs-nav-button:focus-visible {
  background: var(--vext-accent-soft);
  outline: none;
}

.vext-docs-nav-tree {
  margin: 2px 0 8px 0;
  padding-left: 16px;
  display: grid;
  gap: 2px;
}

.vext-docs-nav-children {
  margin: 2px 0 8px 10px;
  padding-left: 8px;
  border-left: 1px solid #e8edf5;
  display: grid;
  gap: 2px;
}

.vext-docs-nav-branch,
.vext-docs-nav-leaf,
.vext-docs-nav-child {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--vext-muted);
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  min-width: 0;
}

.vext-docs-nav-leaf,
.vext-docs-nav-child {
  cursor: pointer;
}

.vext-docs-nav-branch {
  background: var(--vext-panel-soft);
  color: var(--vext-text);
  font-weight: 600;
  cursor: default;
}

.vext-docs-nav-caret-button {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0;
  cursor: pointer;
}

.vext-docs-nav-caret-button:hover,
.vext-docs-nav-caret-button:focus-visible {
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  outline: none;
}

.vext-docs-nav-caret {
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  color: var(--vext-muted);
  flex: 0 0 auto;
  transition: transform 120ms ease;
}

.vext-docs-nav-branch[aria-expanded="true"] .vext-docs-nav-caret,
.vext-docs-nav-button[aria-expanded="true"] .vext-docs-nav-caret {
  transform: rotate(90deg);
}

.vext-docs-nav-caret-spacer {
  width: 5px;
  flex: 0 0 auto;
}

.vext-docs-nav-leaf-spacer {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.vext-docs-nav-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.vext-docs-nav-branch .vext-docs-nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vext-docs-nav-count {
  flex: 0 0 auto;
  color: var(--vext-muted);
  font-size: 12px;
  font-weight: 500;
}

.vext-docs-nav-method {
  flex: 0 0 auto;
  min-width: 36px;
  color: var(--vext-accent);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.vext-docs-nav-param {
  color: var(--vext-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-weight: 500;
}

.vext-docs-mark {
  border-radius: 3px;
  background: #fef08a;
  color: #111827;
  padding: 0 2px;
}

.vext-docs-overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.vext-docs-overview-card {
  border: 1px solid var(--vext-line);
  border-radius: 8px;
  background: var(--vext-panel);
  padding: 12px;
  text-align: left;
  width: 100%;
}

.vext-docs-overview-card strong {
  display: block;
  color: var(--vext-text);
  font-size: 18px;
  line-height: 1.2;
}

.vext-docs-overview-card span {
  color: var(--vext-muted);
  font-size: 12px;
}

.vext-docs-project {
  display: grid;
  gap: 12px;
  margin-top: 18px;
  border-top: 1px solid var(--vext-line);
  padding-top: 16px;
}

.vext-docs-project h3 {
  margin: 0;
  font-size: 16px;
}

.vext-docs-command-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.vext-docs-command-group {
  min-width: 0;
  border: 1px solid var(--vext-line);
  border-radius: 8px;
  background: var(--vext-panel);
  padding: 10px;
}

.vext-docs-command-group h4 {
  margin: 0 0 8px;
  font-size: 13px;
}

.vext-docs-command-list {
  display: grid;
  gap: 8px;
}

.vext-docs-command-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.vext-docs-command-main {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.vext-docs-command-main code {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.vext-docs-command-main span {
  color: var(--vext-muted);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.vext-docs-nav-leaf[aria-current="location"] {
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  font-weight: 650;
}

.vext-docs-nav-branch:hover,
.vext-docs-nav-branch:focus-visible,
.vext-docs-nav-leaf:hover,
.vext-docs-nav-leaf:focus-visible,
.vext-docs-nav-child:hover,
.vext-docs-nav-child:focus-visible {
  background: var(--vext-accent-soft);
  color: var(--vext-accent);
  outline: none;
}

.vext-docs-noscript {
  padding: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .vext-docs-operation,
  .vext-docs-code-item,
  .vext-docs-resizer::after {
    transition: none;
  }

  .vext-docs-operation:hover,
  .vext-docs-operation:focus-within,
  .vext-docs-code-item:hover,
  .vext-docs-code-item:focus-within {
    transform: none;
  }
}

@media (max-width: 760px) {
  .vext-docs-shell {
    grid-template-columns: 1fr;
  }

  .vext-docs-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--vext-line);
    position: sticky;
    top: 0;
    z-index: 10;
    height: auto;
    max-height: 54vh;
    overflow-y: auto;
    padding: 14px 16px;
  }

  .vext-docs-sidebar::-webkit-scrollbar {
    width: 5px;
  }

  .vext-docs-resizer {
    display: none;
  }

  .vext-docs-content {
    padding: 16px;
  }

  .vext-docs-header {
    align-items: stretch;
    grid-template-columns: minmax(0, 1fr);
  }

  .vext-docs-header input,
  .vext-docs-auth {
    width: 100%;
  }

  .vext-docs-panel {
    padding: 8px 0 12px;
  }

  .vext-docs-operation,
  .vext-docs-code-item {
    margin: 12px 0 18px;
  }

  .vext-docs-operation {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 14px;
  }

  .vext-docs-method {
    justify-self: start;
    min-width: 72px;
  }

  .vext-docs-section-heading {
    padding-left: 14px;
    padding-right: 14px;
  }

  .vext-docs-response-tabs {
    flex-wrap: nowrap;
    padding-bottom: 2px;
  }

  .vext-docs-kv-row {
    grid-template-columns: 1fr;
  }

  .vext-docs-code-sample pre {
    max-width: 100%;
  }
}
`;

export const VEXT_DOCS_APP_JS = `
(() => {
  const configEl = document.getElementById("vext-docs-config");
  const rootEl = document.getElementById("vext-docs-root");
  const statusEl = document.getElementById("vext-docs-status");
  const panelEl = document.getElementById("vext-docs-panel");
  const navEl = document.getElementById("vext-docs-nav");
  const searchEl = document.getElementById("vext-docs-search");
  const contentEl = document.querySelector(".vext-docs-content");
  const sidebarEl = document.querySelector(".vext-docs-sidebar");
  const resizerEl = document.getElementById("vext-docs-resizer");
  const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
  const SIDEBAR_WIDTH_STORAGE_KEY = "vext-docs-sidebar-width";
  const THEME_STORAGE_KEY = "vext-docs-theme";
  const DENSITY_STORAGE_KEY = "vext-docs-density";
  const REQUEST_HISTORY_STORAGE_KEY = "vext-docs-request-history";
  const SIDEBAR_MIN_WIDTH = 240;
  const SIDEBAR_MAX_WIDTH = 480;
  const SIDEBAR_AUTO_MAX_WIDTH = 380;
  const VIEW_FILTERS = [
    ["all", "All"],
    ["backend-api", "HTTP API"],
    ["frontend-route", "Pages"],
    ["service", "Services"],
    ["utils", "Utils"],
    ["model", "Models"],
    ["component", "Components"],
    ["plugin", "Plugins"],
    ["middleware", "Middlewares"],
  ];
  const PROJECT_SCRIPT_GROUPS = [
    ["development", "Development"],
    ["production", "Production"],
    ["verification", "Verification"],
  ];

  const readConfig = () => {
    if (!configEl || !configEl.textContent) return null;
    try {
      return JSON.parse(configEl.textContent);
    } catch {
      return null;
    }
  };

  const clear = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  const text = (value) => String(value ?? "");

  const clampSidebarWidth = (value) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));

  const currentSidebarWidth = () => {
    if (!sidebarEl) return 280;
    return clampSidebarWidth(sidebarEl.getBoundingClientRect().width || 280);
  };

  const applySidebarWidth = (value) => {
    if (!rootEl) return;
    rootEl.style.setProperty("--vext-docs-sidebar-width", clampSidebarWidth(value) + "px");
  };

  const hasStoredSidebarWidth = () => readStoredSidebarWidth() > 0;

  const applyAutoSidebarWidth = () => {
    if (!rootEl || !navEl || hasStoredSidebarWidth() || window.matchMedia("(max-width: 760px)").matches) return;
    const labels = Array.from(navEl.querySelectorAll(".vext-docs-nav-label"));
    if (labels.length === 0) return;
    const canvas = applyAutoSidebarWidth.canvas || (applyAutoSidebarWidth.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    if (!context) return;
    let maxLabelWidth = 0;
    for (const label of labels) {
      const style = window.getComputedStyle(label);
      context.font = style.font || style.fontSize + " " + style.fontFamily;
      maxLabelWidth = Math.max(maxLabelWidth, context.measureText(text(label.textContent)).width);
    }
    const desired = Math.min(SIDEBAR_AUTO_MAX_WIDTH, Math.max(280, Math.ceil(maxLabelWidth + 118)));
    applySidebarWidth(desired);
    if (resizerEl) resizerEl.setAttribute("aria-valuenow", String(clampSidebarWidth(desired)));
  };

  const readStoredSidebarWidth = () => {
    try {
      const rawValue = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      if (rawValue == null || rawValue === "") return 0;
      const value = Number(rawValue);
      return Number.isFinite(value) ? clampSidebarWidth(value) : 0;
    } catch {
      return 0;
    }
  };

  const writeStoredSidebarWidth = (value) => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(value)));
    } catch {
      // Ignore storage errors in locked-down browsers.
    }
  };

  const setupSidebarResize = () => {
    if (!rootEl || !sidebarEl || !resizerEl) return;
    const storedWidth = readStoredSidebarWidth();
    if (storedWidth) applySidebarWidth(storedWidth);

    let activePointerId = null;
    let startX = 0;
    let startWidth = 0;

    const updateWidth = (width) => {
      const nextWidth = clampSidebarWidth(width);
      applySidebarWidth(nextWidth);
      resizerEl.setAttribute("aria-valuenow", String(nextWidth));
      return nextWidth;
    };

    resizerEl.setAttribute("aria-valuemin", String(SIDEBAR_MIN_WIDTH));
    resizerEl.setAttribute("aria-valuemax", String(SIDEBAR_MAX_WIDTH));
    resizerEl.setAttribute("aria-valuenow", String(currentSidebarWidth()));

    const handlePointerMove = (event) => {
      if (activePointerId !== event.pointerId) return;
      updateWidth(startWidth + event.clientX - startX);
    };

    const finishResize = (event) => {
      if (activePointerId !== event.pointerId) return;
      const width = currentSidebarWidth();
      writeStoredSidebarWidth(width);
      if (resizerEl.hasPointerCapture(event.pointerId)) resizerEl.releasePointerCapture(event.pointerId);
      document.documentElement.classList.remove("vext-docs-resizing");
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishResize);
      document.removeEventListener("pointercancel", finishResize);
      activePointerId = null;
    };

    resizerEl.addEventListener("pointerdown", (event) => {
      if (window.matchMedia("(max-width: 760px)").matches) return;
      activePointerId = event.pointerId;
      startX = event.clientX;
      startWidth = currentSidebarWidth();
      resizerEl.setPointerCapture(event.pointerId);
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", finishResize);
      document.addEventListener("pointercancel", finishResize);
      document.documentElement.classList.add("vext-docs-resizing");
      event.preventDefault();
    });

    resizerEl.addEventListener("dblclick", () => {
      try {
        localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
      } catch {
        // Ignore storage errors in locked-down browsers.
      }
      applyAutoSidebarWidth();
    });

    resizerEl.addEventListener("pointermove", handlePointerMove);
    resizerEl.addEventListener("pointerup", finishResize);
    resizerEl.addEventListener("pointercancel", finishResize);
    resizerEl.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const delta = event.key === "ArrowRight" ? 16 : -16;
      const width = updateWidth(currentSidebarWidth() + delta);
      writeStoredSidebarWidth(width);
      event.preventDefault();
    });
  };

  const readStoredChoice = (key, allowed, fallback) => {
    try {
      const value = localStorage.getItem(key);
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };

  const writeStoredChoice = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage errors in locked-down browsers.
    }
  };

  const applyThemeAndDensity = (theme, density) => {
    document.documentElement.setAttribute("data-vext-docs-theme", theme);
    document.documentElement.setAttribute("data-vext-docs-density", density);
  };

  const setupUiControls = () => {
    if (!searchEl || !searchEl.parentElement) return;
    const header = searchEl.parentElement;

    const controls = document.createElement("div");
    controls.className = "vext-docs-ui-controls";

    const createSelect = (labelText, options, value, onChange) => {
      const label = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = labelText;
      const select = document.createElement("select");
      for (const [optionValue, optionLabel] of options) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionLabel;
        select.appendChild(option);
      }
      select.value = value;
      select.addEventListener("change", () => onChange(select.value));
      label.appendChild(span);
      label.appendChild(select);
      return label;
    };

    const defaultTheme = config && config.ui && config.ui.theme ? config.ui.theme : "system";
    const defaultDensity = config && config.ui && config.ui.density ? config.ui.density : "comfortable";
    const theme = readStoredChoice(THEME_STORAGE_KEY, ["system", "light", "dark"], defaultTheme);
    const density = readStoredChoice(DENSITY_STORAGE_KEY, ["comfortable", "compact"], defaultDensity);
    applyThemeAndDensity(theme, density);

    controls.appendChild(createSelect("Theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], theme, (value) => {
      applyThemeAndDensity(value, document.documentElement.getAttribute("data-vext-docs-density") || "comfortable");
      writeStoredChoice(THEME_STORAGE_KEY, value);
    }));
    controls.appendChild(createSelect("Density", [["comfortable", "Comfortable"], ["compact", "Compact"]], density, (value) => {
      applyThemeAndDensity(document.documentElement.getAttribute("data-vext-docs-theme") || "system", value);
      writeStoredChoice(DENSITY_STORAGE_KEY, value);
    }));
    header.appendChild(controls);

    const filters = document.createElement("div");
    filters.className = "vext-docs-search-tools";
    filters.setAttribute("aria-label", "Search categories");
    for (const [view, label] of VIEW_FILTERS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vext-docs-filter-button";
      button.textContent = label;
      button.setAttribute("aria-pressed", view === state.searchScope ? "true" : "false");
      button.addEventListener("click", () => {
        state.searchScope = view;
        state.view = view === "all" ? "overview" : view;
        state.anchor = "";
        render();
      });
      filters.appendChild(button);
    }
    header.appendChild(filters);

    document.addEventListener("keydown", (event) => {
      const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
      const editable = tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable;
      if ((event.key === "/" && !editable) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
        searchEl.focus();
        searchEl.select();
        event.preventDefault();
      }
    });
  };

  const setupOutline = () => {
    if (!contentEl || outlineEl) return;
    outlineEl = document.createElement("aside");
    outlineEl.className = "vext-docs-outline";
    outlineEl.setAttribute("aria-label", "Page outline");
    contentEl.insertBefore(outlineEl, panelEl);
  };

  const copyText = async (value) => {
    const payload = text(value);
    if (!payload) return false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(payload);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = payload;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  };

  const createCopyButton = (label, getValue) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vext-docs-copy-button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      const original = button.textContent;
      try {
        const ok = await copyText(typeof getValue === "function" ? getValue() : getValue);
        button.textContent = ok ? "Copied" : "Select to copy";
        button.classList.toggle("is-copied", ok);
      } catch {
        button.textContent = "Copy failed";
      } finally {
        window.setTimeout(() => {
          button.textContent = original;
          button.classList.remove("is-copied");
        }, 1200);
      }
    });
    return button;
  };

  const renderProjectCommands = (parent) => {
    const project = config.project || {};
    const scripts = Array.isArray(project.scripts) ? project.scripts : [];
    if (!project.name && !project.version && scripts.length === 0) return;

    const section = document.createElement("section");
    section.className = "vext-docs-project";
    const heading = document.createElement("h3");
    heading.textContent = "Project commands";
    section.appendChild(heading);

    const meta = document.createElement("div");
    meta.className = "vext-docs-meta";
    if (project.name) appendBadge(meta, "package: " + project.name);
    if (project.version) appendBadge(meta, "version: " + project.version);
    if (project.type) appendBadge(meta, "type: " + project.type);
    if (meta.children.length > 0) section.appendChild(meta);

    if (scripts.length > 0) {
      const groups = document.createElement("div");
      groups.className = "vext-docs-command-groups";
      for (const [groupValue, groupLabel] of PROJECT_SCRIPT_GROUPS) {
        const groupScripts = scripts.filter((script) => script.group === groupValue);
        if (groupScripts.length === 0) continue;
        const group = document.createElement("section");
        group.className = "vext-docs-command-group";
        const groupHeading = document.createElement("h4");
        groupHeading.textContent = groupLabel;
        group.appendChild(groupHeading);
        const list = document.createElement("div");
        list.className = "vext-docs-command-list";
        for (const script of groupScripts) {
          const row = document.createElement("div");
          row.className = "vext-docs-command-row";
          const main = document.createElement("div");
          main.className = "vext-docs-command-main";
          const command = document.createElement("code");
          command.textContent = script.command;
          const value = document.createElement("span");
          value.textContent = script.value;
          main.appendChild(command);
          main.appendChild(value);
          row.appendChild(main);
          row.appendChild(createCopyButton("Copy", script.command));
          list.appendChild(row);
        }
        group.appendChild(list);
        groups.appendChild(group);
      }
      if (groups.children.length > 0) section.appendChild(groups);
    } else {
      const empty = document.createElement("p");
      empty.className = "vext-docs-code-desc";
      empty.textContent = "No package scripts were found for this project.";
      section.appendChild(empty);
    }

    parent.appendChild(section);
  };

  const linkForAnchor = (anchor) => {
    const url = new URL(window.location.href);
    url.hash = anchor || "";
    return url.toString();
  };

  const updateSearchFilterButtons = () => {
    const scope = state.searchScope === "all" && state.view !== "overview" ? state.view : state.searchScope;
    for (const button of document.querySelectorAll(".vext-docs-filter-button")) {
      const match = VIEW_FILTERS.find(([, label]) => label === button.textContent);
      button.setAttribute("aria-pressed", match && match[0] === scope ? "true" : "false");
    }
  };

  const state = {
    view: "overview",
    query: "",
    anchor: "",
    collapsedGroups: new Set(),
    collapsedNav: new Set(),
    searchScope: "all",
    spec: null,
    codeDocs: { items: [] },
    auth: {},
  };

  let outlineEl = null;

  const resolveInitialView = (config) => {
    const view = config && config.ui ? config.ui.defaultView : "overview";
    if (view === "api") return "backend-api";
    if (view === "code") return "service";
    return "overview";
  };

  const appendBadge = (parent, label) => {
    const badge = document.createElement("span");
    badge.className = "vext-docs-badge";
    badge.textContent = label;
    parent.appendChild(badge);
  };

  const isLocalDocsPage = () => {
    const host = window.location.hostname.toLowerCase();
    return host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
  };

  const sourceLinkHref = (doc) => {
    const location = doc && doc.sourceLocation ? doc.sourceLocation : null;
    if (!isLocalDocsPage() || !config.endpoints || !config.endpoints.source || !location || !location.file) {
      return "";
    }
    const params = new URLSearchParams();
    params.set("file", location.file);
    if (location.line) params.set("line", String(location.line));
    return config.endpoints.source + "?" + params.toString();
  };

  const appendSourceLink = (parent, doc) => {
    const href = sourceLinkHref(doc);
    if (!href) return;
    const link = document.createElement("a");
    link.className = "vext-docs-source-link";
    link.href = href;
    link.textContent = "Open source";
    link.title = "Open source file";
    parent.appendChild(link);
  };

  const authStorageKey = (name) => "vext-docs-auth:" + name;

  const readStoredAuth = (name) => {
    try {
      return sessionStorage.getItem(authStorageKey(name)) || "";
    } catch {
      return "";
    }
  };

  const writeStoredAuth = (name, value) => {
    try {
      if (value) {
        sessionStorage.setItem(authStorageKey(name), value);
      } else {
        sessionStorage.removeItem(authStorageKey(name));
      }
    } catch {
      // Ignore storage errors in locked-down browsers.
    }
  };

  const createBlock = (value) => {
    const pre = document.createElement("pre");
    pre.textContent = value;
    return pre;
  };

  const isDescriptionCodeLine = (line) => {
    return /^(?:\\{|\\[|middlewares?:|plugins?:|routes?:|(?:config|src)\\/[^\\s]+\\.(?:ts|tsx|js|jsx|mjs|cjs)$|const\\s+|let\\s+|var\\s+|await\\s+|return\\s+|import\\s+|export\\s+|app\\.|define[A-Z]|[A-Za-z_$][\\w$.-]*\\s*[:=])/u.test(line);
  };

  const appendFormattedDescription = (parent, value) => {
    const raw = text(value);
    if (!raw.trim()) return;

    const wrap = document.createElement("div");
    wrap.className = "vext-docs-code-desc";
    let list = null;
    let codeLines = [];

    const flushCode = () => {
      if (codeLines.length === 0) return;
      const pre = document.createElement("pre");
      pre.className = "vext-docs-code-inline-block";
      pre.textContent = codeLines.join("\\n");
      wrap.appendChild(pre);
      codeLines = [];
    };

    const flushList = () => {
      list = null;
    };

    for (const rawLine of raw.split(/\\r?\\n/u)) {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) {
        flushCode();
        flushList();
        continue;
      }

      const bullet = /^[-*]\\s+(.+)$/u.exec(trimmed);
      if (bullet) {
        flushCode();
        if (!list) {
          list = document.createElement("ul");
          list.className = "vext-docs-code-list";
          wrap.appendChild(list);
        }
        const li = document.createElement("li");
        li.textContent = bullet[1];
        list.appendChild(li);
        continue;
      }

      if (isDescriptionCodeLine(trimmed)) {
        flushList();
        codeLines.push(trimmed);
        continue;
      }

      flushCode();
      flushList();
      const p = document.createElement("p");
      p.textContent = trimmed;
      wrap.appendChild(p);
    }

    flushCode();
    if (wrap.childNodes.length > 0) parent.appendChild(wrap);
  };

  const createDetail = (titleText) => {
    const section = document.createElement("section");
    section.className = "vext-docs-detail";
    const title = document.createElement("h3");
    title.textContent = titleText;
    section.appendChild(title);
    return section;
  };

  const createDataTable = (headers, rows) => {
    if (!rows.length) return null;
    const wrap = document.createElement("div");
    wrap.className = "vext-docs-table-wrap";
    const table = document.createElement("table");
    table.className = "vext-docs-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const header of headers) {
      const cell = document.createElement("th");
      cell.textContent = header;
      headRow.appendChild(cell);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const value of row) {
        const cell = document.createElement("td");
        cell.textContent = text(value);
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  };

  const appendTableSection = (parent, titleText, headers, rows) => {
    const table = createDataTable(headers, rows);
    if (!table) return;
    const section = document.createElement("div");
    section.className = "vext-docs-code-section";
    const label = document.createElement("strong");
    label.textContent = titleText;
    section.appendChild(label);
    section.appendChild(table);
    parent.appendChild(section);
  };

  const appendModelDetails = (parent, doc) => {
    const model = doc && doc.model ? doc.model : null;
    if (!model) return;

    const basicRows = [
      ["Registry key", model.registryKey || ""],
      ["Name", model.name || ""],
      ["Collection", model.collection || ""],
      ["Connection", model.connection ? JSON.stringify(model.connection) : ""],
      ["Depth", model.depth === undefined ? "" : String(model.depth)],
    ].filter((row) => row[1]);
    appendTableSection(parent, "Model", ["Property", "Value"], basicRows);

    appendTableSection(
      parent,
      "Schema fields",
      ["Field", "Required", "Type", "Description", "Raw"],
      Array.isArray(model.fields)
        ? model.fields.map((field) => [
            field.name,
            field.required ? "yes" : "no",
            field.type || "",
            [
              field.description || "",
              Array.isArray(field.enum) && field.enum.length > 0 ? "enum: " + field.enum.join(", ") : "",
            ].filter(Boolean).join(" "),
            field.raw || "",
          ])
        : [],
    );

    appendTableSection(
      parent,
      "Enums",
      ["Name", "Values"],
      Array.isArray(model.enums)
        ? model.enums.map((entry) => [entry.name, entry.values.join(", ")])
        : [],
    );

    appendTableSection(
      parent,
      "Options",
      ["Name", "Value"],
      Array.isArray(model.options)
        ? model.options.map((entry) => [entry.name, entry.value])
        : [],
    );

    appendTableSection(
      parent,
      "Indexes",
      ["Keys", "Unique", "Options"],
      Array.isArray(model.indexes)
        ? model.indexes.map((entry) => [
            entry.keys,
            entry.unique === undefined ? "" : entry.unique ? "yes" : "no",
            entry.options || "",
          ])
        : [],
    );

    const methodRows = [];
    if (model.methods && Array.isArray(model.methods.instance)) {
      for (const name of model.methods.instance) methodRows.push(["instance", name]);
    }
    if (model.methods && Array.isArray(model.methods.static)) {
      for (const name of model.methods.static) methodRows.push(["static", name]);
    }
    appendTableSection(parent, "Methods", ["Scope", "Name"], methodRows);

    appendTableSection(
      parent,
      "Hooks",
      ["Operation", "Phases"],
      Array.isArray(model.hooks)
        ? model.hooks.map((entry) => [entry.operation, entry.phases.join(", ")])
        : [],
    );

    if (model.parseNote) {
      const note = document.createElement("p");
      note.className = "vext-docs-model-note";
      note.textContent = model.parseNote;
      parent.appendChild(note);
    }
  };

  const appendPluginDetails = (parent, doc) => {
    const plugin = doc && doc.plugin ? doc.plugin : null;
    if (!plugin) return;

    const lifecycle = plugin.lifecycle || {};
    const lifecycleText = [
      lifecycle.setup ? "setup" : "",
      lifecycle.onReady ? "onReady" : "",
      lifecycle.onClose ? "onClose" : "",
    ].filter(Boolean).join(", ");
    const rows = [
      ["Name", plugin.name || ""],
      ["Dependencies", Array.isArray(plugin.dependencies) ? plugin.dependencies.join(", ") : ""],
      ["After", Array.isArray(plugin.after) ? plugin.after.join(", ") : ""],
      ["Lifecycle", lifecycleText],
      ["App extensions", Array.isArray(plugin.extensions) ? plugin.extensions.join(", ") : ""],
      ["Global middleware", plugin.globalMiddlewares ? "yes" : ""],
    ].filter((row) => row[1]);
    appendTableSection(parent, "Plugin", ["Property", "Value"], rows);
  };

  const appendMiddlewareDetails = (parent, doc) => {
    const middleware = doc && doc.middleware ? doc.middleware : null;
    if (!middleware) return;

    const rows = [
      ["Name", middleware.name || ""],
      ["Type", middleware.type || ""],
      ["Default options", middleware.defaultOptions || ""],
      ["Route usage", middleware.usage || ""],
    ].filter((row) => row[1]);
    appendTableSection(parent, "Middleware", ["Property", "Value"], rows);
  };

  const resolveLocalRef = (ref) => {
    if (!ref || typeof ref !== "string" || !ref.startsWith("#/")) return null;
    const parts = ref.slice(2).split("/").map((part) => decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~")));
    let current = state.spec;
    for (const part of parts) {
      if (!current || typeof current !== "object") return null;
      current = current[part];
    }
    return current && typeof current === "object" ? current : null;
  };

  const mergeAllOf = (schemas, seen) => {
    const merged = { type: "object", properties: {}, required: [] };
    for (const schema of schemas) {
      const resolved = resolveSchema(schema, seen);
      if (!resolved || typeof resolved !== "object") continue;
      Object.assign(merged, resolved);
      if (resolved.properties && typeof resolved.properties === "object") {
        merged.properties = { ...(merged.properties || {}), ...resolved.properties };
      }
      if (Array.isArray(resolved.required)) {
        merged.required = Array.from(new Set([...(merged.required || []), ...resolved.required]));
      }
    }
    return merged;
  };

  const resolveSchema = (schema, seen) => {
    if (!schema || typeof schema !== "object") return schema;
    const nextSeen = seen || new Set();
    if (schema.$ref) {
      if (nextSeen.has(schema.$ref)) return schema;
      const target = resolveLocalRef(schema.$ref);
      if (!target) return schema;
      const withRef = new Set(nextSeen);
      withRef.add(schema.$ref);
      return { ...resolveSchema(target, withRef), ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref")) };
    }
    if (Array.isArray(schema.allOf)) return mergeAllOf(schema.allOf, nextSeen);
    const copy = { ...schema };
    if (copy.items && typeof copy.items === "object") copy.items = resolveSchema(copy.items, nextSeen);
    if (copy.properties && typeof copy.properties === "object") {
      const properties = {};
      for (const [key, child] of Object.entries(copy.properties)) {
        properties[key] = resolveSchema(child, nextSeen);
      }
      copy.properties = properties;
    }
    return copy;
  };

  const describeSchema = (schema) => {
    schema = resolveSchema(schema);
    if (!schema || typeof schema !== "object") return "";
    if (schema.$ref) return "ref " + schema.$ref;
    const parts = [];
    if (schema.type) parts.push(schema.type);
    if (schema.format) parts.push("(" + schema.format + ")");
    if (Array.isArray(schema.enum)) parts.push("enum: " + schema.enum.join(", "));
    if (schema.items) parts.push("array<" + describeSchema(schema.items) + ">");
    if (schema.nullable) parts.push("nullable");
    return parts.join(" ") || "object";
  };

  const formatExample = (value) => {
    if (value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const schemaRows = (schema, prefix, requiredNames, depth) => {
    schema = resolveSchema(schema);
    if (!schema || typeof schema !== "object") return [];
    const rows = [];
    const hasProperties = schema.properties && typeof schema.properties === "object";
    const name = prefix || (schema.type === "array" ? "(response)" : "(body)");
    const description = [schema.description, schema.example !== undefined ? "example: " + formatExample(schema.example) : ""]
      .filter(Boolean)
      .join(" ");

    if (prefix || !hasProperties) {
      rows.push([
        name,
        requiredNames && requiredNames.has(name.split(".").pop()) ? "yes" : "no",
        describeSchema(schema),
        description,
      ]);
    }

    if (depth >= 4) return rows;
    if (hasProperties) {
      const nextRequired = new Set(Array.isArray(schema.required) ? schema.required : []);
      for (const [key, child] of Object.entries(schema.properties)) {
        rows.push(...schemaRows(child, prefix ? prefix + "." + key : key, nextRequired, depth + 1));
      }
    }
    const items = resolveSchema(schema.items);
    if (items && typeof items === "object" && items.properties) {
      rows.push(...schemaRows(items, prefix ? prefix + "[]" : "[]", new Set(Array.isArray(items.required) ? items.required : []), depth + 1));
    }
    return rows;
  };

  const createSchemaSection = (titleText, schema) => {
    if (!schema || typeof schema !== "object") return null;
    const section = createDetail(titleText);
    const table = createDataTable(
      ["Field", "Required", "Type", "Description"],
      schemaRows(schema, "", new Set(Array.isArray(schema.required) ? schema.required : []), 0),
    );
    if (table) section.appendChild(table);
    return section;
  };

  const getFirstContentEntry = (content) => {
    if (!content || typeof content !== "object") return null;
    const entries = Object.entries(content);
    if (entries.length === 0) return null;
    const [contentType, entry] = entries[0];
    return { contentType, entry: entry || {} };
  };

  const createParametersSection = (parameters) => {
    if (!Array.isArray(parameters) || parameters.length === 0) return null;
    const section = createDetail("Parameters");
    const table = createDataTable(
      ["Name", "In", "Required", "Type", "Description"],
      parameters.map((param) => [
        param.name,
        param.in,
        param.required ? "yes" : "no",
        describeSchema(param.schema),
        param.description || (param.schema && param.schema.description) || "",
      ]),
    );
    if (table) section.appendChild(table);
    return section;
  };

  const createHeadersSection = (headers) => {
    if (!headers || typeof headers !== "object") return null;
    const rows = Object.entries(headers).map(([name, header]) => [
      name,
      describeSchema(header && header.schema),
      header && header.description ? header.description : "",
    ]);
    const table = createDataTable(["Name", "Type", "Description"], rows);
    if (!table) return null;
    const section = createDetail("Headers");
    section.appendChild(table);
    return section;
  };

  const createRequestBodySection = (requestBody) => {
    if (!requestBody || typeof requestBody !== "object") return null;
    const first = getFirstContentEntry(requestBody.content);
    const section = createDetail("Request body");
    const meta = document.createElement("p");
    meta.textContent = [
      requestBody.required ? "required" : "optional",
      first ? first.contentType : "",
    ].filter(Boolean).join(" · ");
    section.appendChild(meta);
    if (first && first.entry && first.entry.schema) {
      const schemaSection = createSchemaSection("Fields", first.entry.schema);
      if (schemaSection) section.appendChild(schemaSection);
      if (first.entry.example !== undefined) {
        section.appendChild(createBlock(JSON.stringify(first.entry.example, null, 2)));
      }
    }
    return section;
  };

  const responseStatusSort = (entries) => {
    return entries.sort(([left], [right]) => {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
      return left.localeCompare(right);
    });
  };

  const createResponsePanelContent = (status, response) => {
    const block = document.createElement("div");
    block.className = "vext-docs-response-panel";
    const headers = createHeadersSection(response && response.headers);
    if (headers) block.appendChild(headers);
    const contentEntries = response && response.content && typeof response.content === "object"
      ? Object.entries(response.content)
      : [];
    for (const [contentType, entry] of contentEntries) {
      const contentBlock = document.createElement("div");
      contentBlock.className = "vext-docs-detail";
      const label = document.createElement("p");
      label.textContent = contentType;
      contentBlock.appendChild(label);
      if (entry && entry.schema) {
        const schemaSection = createSchemaSection("Fields", entry.schema);
        if (schemaSection) contentBlock.appendChild(schemaSection);
      }
      if (entry && entry.example !== undefined) {
        contentBlock.appendChild(createBlock(JSON.stringify(entry.example, null, 2)));
      }
      if (entry && entry.examples && typeof entry.examples === "object") {
        for (const [name, example] of Object.entries(entry.examples)) {
          const exampleLabel = document.createElement("p");
          exampleLabel.textContent = "Example: " + name;
          contentBlock.appendChild(exampleLabel);
          contentBlock.appendChild(createBlock(JSON.stringify(example && example.value !== undefined ? example.value : example, null, 2)));
        }
      }
      block.appendChild(contentBlock);
    }
    return block;
  };

  const createResponsesSection = (responses) => {
    if (!responses || typeof responses !== "object") return null;
    const entries = responseStatusSort(Object.entries(responses));
    if (entries.length === 0) return null;
    const section = createDetail("Responses");
    const explorer = document.createElement("div");
    explorer.className = "vext-docs-response-explorer";
    const tabs = document.createElement("div");
    tabs.className = "vext-docs-response-tabs";
    tabs.setAttribute("role", "tablist");
    const panel = document.createElement("div");
    const panelId = "vext-docs-response-panel-" + Math.random().toString(36).slice(2);
    panel.id = panelId;
    panel.setAttribute("role", "tabpanel");

    const select = (selectedIndex) => {
      clear(panel);
      for (const [index, button] of Array.from(tabs.children).entries()) {
        button.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
        button.tabIndex = index === selectedIndex ? 0 : -1;
      }
      const [status, response] = entries[selectedIndex];
      panel.appendChild(createResponsePanelContent(status, response));
    };

    const defaultIndex = Math.max(0, entries.findIndex(([status]) => status.startsWith("2")));
    entries.forEach(([status, response], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vext-docs-response-tab";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", panelId);
      button.textContent = status + (response && response.description ? " " + response.description : "");
      button.addEventListener("click", () => select(index));
      tabs.appendChild(button);
    });
    explorer.appendChild(tabs);
    explorer.appendChild(panel);
    section.appendChild(explorer);
    if (entries.length > 0) {
      select(defaultIndex);
    }
    return section;
  };

  const getSecuritySchemes = () => {
    const schemes = state.spec && state.spec.components && state.spec.components.securitySchemes;
    return schemes && typeof schemes === "object" ? schemes : {};
  };

  const getSupportedAuthSchemes = () => {
    return Object.entries(getSecuritySchemes())
      .filter(([, scheme]) => {
        if (!scheme || typeof scheme !== "object") return false;
        if (scheme.type === "http" && String(scheme.scheme || "").toLowerCase() === "bearer") return true;
        if (scheme.type === "apiKey" && ["header", "query", "cookie"].includes(String(scheme.in || ""))) return true;
        return false;
      })
      .map(([name, scheme]) => ({ name, scheme }));
  };

  const getOperationSecurity = (operation) => {
    if (operation && Array.isArray(operation.security)) return operation.security;
    return state.spec && Array.isArray(state.spec.security) ? state.spec.security : [];
  };

  const describeOperationSecurity = (operation) => {
    if (operation && Array.isArray(operation.security) && operation.security.length === 0) return "no auth";
    const requirements = getOperationSecurity(operation);
    const names = Array.from(new Set(requirements.flatMap((requirement) => Object.keys(requirement || {}))));
    return names.length > 0 ? "auth: " + names.join(", ") : "";
  };

  const renderAuthControls = () => {
    const existing = document.getElementById("vext-docs-auth");
    if (existing) existing.remove();
    const schemes = getSupportedAuthSchemes();
    if (schemes.length === 0) return;
    const header = searchEl && searchEl.parentElement;
    if (!header) return;
    const details = document.createElement("details");
    details.id = "vext-docs-auth";
    details.className = "vext-docs-auth";
    const summary = document.createElement("summary");
    summary.textContent = "Authorize";
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "vext-docs-auth-body";
    for (const { name, scheme } of schemes) {
      const label = document.createElement("label");
      const labelText = document.createElement("span");
      const location = scheme.type === "apiKey" ? " (" + scheme.in + ": " + scheme.name + ")" : "";
      labelText.textContent = name + location;
      const input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.placeholder = scheme.type === "http" ? "Bearer token" : "API key";
      input.value = state.auth[name] || readStoredAuth(name);
      state.auth[name] = input.value;
      input.addEventListener("input", () => {
        state.auth[name] = input.value;
        writeStoredAuth(name, input.value);
      });
      label.appendChild(labelText);
      label.appendChild(input);
      body.appendChild(label);
    }
    details.appendChild(body);
    header.appendChild(details);
  };

  const buildAuthParts = (operation) => {
    const headers = {};
    const query = [];
    const schemes = getSecuritySchemes();
    const requirements = getOperationSecurity(operation);
    const names = Array.from(new Set(requirements.flatMap((requirement) => Object.keys(requirement || {}))));
    for (const name of names) {
      const value = state.auth[name] || readStoredAuth(name);
      const scheme = schemes[name];
      if (!value || !scheme || typeof scheme !== "object") continue;
      if (scheme.type === "http" && String(scheme.scheme || "").toLowerCase() === "bearer") {
        headers.authorization = value.toLowerCase().startsWith("bearer ") ? value : "Bearer " + value;
      }
      if (scheme.type === "apiKey" && scheme.name) {
        if (scheme.in === "header") headers[String(scheme.name).toLowerCase()] = value;
        if (scheme.in === "query") query.push([String(scheme.name), value]);
      }
    }
    return { headers, query };
  };

  const describeAuthInjection = (operation) => {
    if (operation && Array.isArray(operation.security) && operation.security.length === 0) {
      return ["This operation declares no auth."];
    }
    const schemes = getSecuritySchemes();
    const requirements = getOperationSecurity(operation);
    const names = Array.from(new Set(requirements.flatMap((requirement) => Object.keys(requirement || {}))));
    if (names.length === 0) return ["No auth scheme is attached to this operation."];
    const lines = [];
    for (const name of names) {
      const scheme = schemes[name];
      if (!scheme || typeof scheme !== "object") {
        lines.push(name + ": unknown scheme, not auto-injected.");
        continue;
      }
      if (scheme.type === "http" && String(scheme.scheme || "").toLowerCase() === "bearer") {
        lines.push(name + ": auto-injected as Authorization bearer header when configured.");
        continue;
      }
      if (scheme.type === "apiKey" && scheme.name) {
        if (scheme.in === "header") {
          lines.push(name + ": auto-injected as header " + scheme.name + " when configured.");
        } else if (scheme.in === "query") {
          lines.push(name + ": auto-injected as query " + scheme.name + " when configured.");
        } else if (scheme.in === "cookie") {
          lines.push(name + ": cookie apiKey is not auto-injected in browser console.");
        }
        continue;
      }
      if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
        lines.push(name + ": " + scheme.type + " is not auto-injected in browser console.");
        continue;
      }
      lines.push(name + ": not auto-injected in browser console.");
    }
    lines.push("Manual header rows or raw JSON override auto auth headers with the same name.");
    return lines;
  };

  const createOperation = (method, path, operation) => {
    const item = document.createElement("article");
    item.className = "vext-docs-operation";
    item.id = operationAnchorId(method, path);

    const methodEl = document.createElement("span");
    methodEl.className = "vext-docs-method";
    methodEl.textContent = method.toUpperCase();
    item.appendChild(methodEl);

    const body = document.createElement("div");
    body.className = "vext-docs-operation-body";
    const pathEl = document.createElement("p");
    pathEl.className = "vext-docs-path";
    pathEl.textContent = path;
    body.appendChild(pathEl);

    const summary = document.createElement("p");
    summary.className = "vext-docs-summary";
    summary.textContent = text(operation.summary || operation.description || operation.operationId || "No summary");
    body.appendChild(summary);

    const meta = document.createElement("div");
    meta.className = "vext-docs-meta";
    if (operation.deprecated) appendBadge(meta, "deprecated");
    if (operation["x-vext-docs-tryItOut"] === false) appendBadge(meta, "try it out disabled");
    const security = describeOperationSecurity(operation);
    if (security) appendBadge(meta, security);
    meta.appendChild(createCopyButton("Copy endpoint", () => method.toUpperCase() + " " + path));
    meta.appendChild(createCopyButton("Copy link", () => linkForAnchor(item.id)));
    if (meta.childNodes.length > 0) body.appendChild(meta);

    const metadata = createOperationMetadata(method, path, operation);
    if (metadata) body.appendChild(metadata);

    const params = createParametersSection(operation.parameters);
    if (params) body.appendChild(params);
    const requestBody = createRequestBodySection(operation.requestBody);
    if (requestBody) body.appendChild(requestBody);
    const responses = createResponsesSection(operation.responses);
    if (responses) body.appendChild(responses);

    if (config && config.ui && config.ui.tryItOut && operation["x-vext-docs-tryItOut"] !== false) {
      body.appendChild(createTryItOut(method, path, operation));
    }

    item.appendChild(body);
    return item;
  };

  let tabIdSequence = 0;

  const createTabs = (items, initialId, className) => {
    const wrapper = document.createElement("div");
    wrapper.className = className || "vext-docs-tabs";
    const tablist = document.createElement("div");
    tablist.className = "vext-docs-tablist";
    tablist.setAttribute("role", "tablist");
    wrapper.appendChild(tablist);

    const panels = document.createElement("div");
    panels.className = "vext-docs-tabpanels";
    wrapper.appendChild(panels);

    const tabs = [];
    const activate = (id, focus) => {
      for (const entry of tabs) {
        const selected = entry.id === id;
        entry.button.setAttribute("aria-selected", selected ? "true" : "false");
        entry.button.tabIndex = selected ? 0 : -1;
        entry.panel.hidden = !selected;
        if (selected && focus) entry.button.focus();
      }
    };

    items.forEach((item, index) => {
      const unique = "vext-docs-tab-" + ++tabIdSequence + "-" + item.id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vext-docs-tab";
      button.id = unique;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", unique + "-panel");
      button.textContent = item.label;
      button.addEventListener("click", () => activate(item.id, false));
      button.addEventListener("keydown", (event) => {
        const current = tabs.findIndex((entry) => entry.id === item.id);
        let next = current;
        if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        activate(tabs[next].id, true);
      });
      tablist.appendChild(button);

      const panel = document.createElement("div");
      panel.className = "vext-docs-tabpanel";
      panel.id = unique + "-panel";
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", unique);
      panel.appendChild(item.content);
      panels.appendChild(panel);
      tabs.push({ id: item.id, button, panel });
      if (index !== 0) panel.hidden = true;
    });

    activate(initialId || (tabs[0] && tabs[0].id), false);
    return { element: wrapper, activate };
  };

  const createTryItOut = (method, path, operation) => {
    const methodName = method.toUpperCase();
    const operationKey = methodName + " " + path;
    const details = document.createElement("details");
    details.className = "vext-docs-tryout";
    const summary = document.createElement("summary");
    summary.textContent = "Try it out";
    details.appendChild(summary);

    const grid = document.createElement("div");
    grid.className = "vext-docs-tryout-grid";

    const serverSelect = document.createElement("select");
    for (const option of getServerOptions()) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      serverSelect.appendChild(item);
    }
    grid.appendChild(wrapControl("Server", serverSelect));

    const targetPreview = document.createElement("div");
    targetPreview.className = "vext-docs-tryout-target";
    grid.appendChild(targetPreview);

    const paramsPanel = document.createElement("div");
    paramsPanel.className = "vext-docs-tryout-panel-grid";
    const pathInputs = [];
    for (const name of getPathParamNames(path, operation)) {
      const input = document.createElement("input");
      input.name = name;
      input.placeholder = name;
      pathInputs.push(input);
      paramsPanel.appendChild(wrapControl("Path " + name, input));
    }

    const queryEditor = createKeyValueEditor(
      "Query parameters",
      getParameterRows(operation, "query"),
      "Raw query fallback",
      buildQueryPlaceholder(operation),
      "No declared query parameters. Add a row to send manual query values.",
    );
    paramsPanel.appendChild(queryEditor.element);

    const headersEditor = createKeyValueEditor(
      "Headers",
      getParameterRows(operation, "header"),
      "Raw headers JSON fallback",
      "{\\n  \\"x-request-id\\": \\"demo\\"\\n}",
      "No declared request headers. Add a row to send manual headers.",
    );
    const headersPanel = document.createElement("div");
    headersPanel.className = "vext-docs-tryout-panel-grid";
    headersPanel.appendChild(headersEditor.element);

    const authNote = createAuthNote(operation);
    const authPanel = document.createElement("div");
    authPanel.className = "vext-docs-tryout-panel-grid";
    authPanel.appendChild(authNote);

    let bodyInput = null;
    const bodyPanel = document.createElement("div");
    bodyPanel.className = "vext-docs-tryout-panel-grid";
    if (!["get", "head"].includes(method.toLowerCase())) {
      bodyInput = document.createElement("textarea");
      bodyInput.placeholder = buildBodyPlaceholder(operation);
      bodyInput.value = buildBodyPlaceholder(operation);
      bodyPanel.appendChild(wrapControl("Request body", bodyInput));
    } else {
      const emptyBody = document.createElement("p");
      emptyBody.className = "vext-docs-kv-empty";
      emptyBody.textContent = "No request body for " + methodName + " requests.";
      bodyPanel.appendChild(emptyBody);
    }

    const actions = document.createElement("div");
    actions.className = "vext-docs-tryout-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Send";
    actions.appendChild(button);

    const copyUrl = createCopyButton("Copy URL", () => {
      const request = collectRequest();
      return request.displayUrl || request.target;
    });
    actions.appendChild(copyUrl);

    const copyResponse = createCopyButton("Copy response", () => result.textContent || "");
    actions.appendChild(copyResponse);

    const status = document.createElement("span");
    status.className = "vext-docs-tryout-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    actions.appendChild(status);

    const samples = createCodeSamplesSection();
    const sampleBlocks = samples.blocks;

    const history = createRequestHistorySection(operationKey, restoreSnapshot);

    const responseToolbar = document.createElement("div");
    responseToolbar.className = "vext-docs-response-toolbar";
    const prettyButton = createSecondaryButton("Pretty body", () => {
      responseMode = "pretty";
      renderResponseResult();
    });
    const rawButton = createSecondaryButton("Raw body", () => {
      responseMode = "raw";
      renderResponseResult();
    });
    responseToolbar.appendChild(prettyButton);
    responseToolbar.appendChild(rawButton);

    const result = document.createElement("pre");
    result.className = "vext-docs-tryout-result";
    result.textContent = "No request sent.";
    let lastResponse = null;
    let responseMode = "pretty";
    const responsePanel = document.createElement("div");
    responsePanel.className = "vext-docs-tryout-panel-grid";
    responsePanel.appendChild(responseToolbar);
    responsePanel.appendChild(result);

    const tabs = createTabs(
      [
        { id: "params", label: "Params", content: paramsPanel },
        { id: "headers", label: "Headers", content: headersPanel },
        { id: "body", label: "Body", content: bodyPanel },
        { id: "auth", label: "Auth", content: authPanel },
        { id: "samples", label: "Samples", content: samples.element },
        { id: "history", label: "History", content: history.element },
        { id: "response", label: "Response", content: responsePanel },
      ],
      "params",
      "vext-docs-tryout-tabs",
    );
    grid.appendChild(tabs.element);
    grid.appendChild(actions);

    const collectRequest = () => {
      const auth = buildAuthParts(operation);
      const queryParts = collectQueryParts(queryEditor.values(), queryEditor.rawInput.value, auth.query);
      const target = buildTryItOutUrl(serverSelect.value, path, pathInputs, queryParts);
      const manualHeaders = {
        ...normalizeHeaders(headersEditor.valuesObject()),
        ...normalizeHeaders(parseHeaders(headersEditor.rawInput.value)),
      };
      const headers = { ...auth.headers, ...manualHeaders };
      const body = bodyInput && bodyInput.value.trim() ? bodyInput.value : "";
      if (body && !headers["content-type"]) headers["content-type"] = getRequestBodyContentType(operation);
      return {
        method: methodName,
        target,
        headers,
        body,
        server: serverSelect.value,
        displayUrl: resolveDisplayUrl(target),
      };
    };

    const collectSnapshot = () => ({
      operationKey,
      server: serverSelect.value,
      pathValues: pathInputs.map((input) => ({ name: input.name, value: input.value })),
      queryRows: queryEditor.snapshot(),
      queryRaw: queryEditor.rawInput.value,
      headerRows: headersEditor.snapshot(),
      headerRaw: headersEditor.rawInput.value,
      body: bodyInput ? bodyInput.value : "",
    });

    function restoreSnapshot(snapshot) {
      if (!snapshot || snapshot.operationKey !== operationKey) return;
      serverSelect.value = snapshot.server || "";
      for (const input of pathInputs) {
        const next = (snapshot.pathValues || []).find((entry) => entry.name === input.name);
        input.value = next ? next.value : "";
      }
      queryEditor.restore(snapshot.queryRows || []);
      queryEditor.rawInput.value = snapshot.queryRaw || "";
      headersEditor.restore(snapshot.headerRows || []);
      headersEditor.rawInput.value = snapshot.headerRaw || "";
      if (bodyInput) bodyInput.value = snapshot.body || "";
      updateConsole();
    }

    const updateConsole = () => {
      try {
        const request = collectRequest();
        const cors = isAbsoluteUrl(request.server) ? " Browser CORS rules apply." : " Same-origin request.";
        targetPreview.textContent = "URL: " + (request.displayUrl || request.target) + "." + cors;
        renderCodeSamples(sampleBlocks, request);
      } catch (error) {
        targetPreview.textContent = error && error.message ? error.message : String(error);
        for (const block of Object.values(sampleBlocks)) block.textContent = "Fix request inputs to generate samples.";
      }
    };

    const renderResponseResult = () => {
      if (!lastResponse) {
        result.textContent = "No request sent.";
        return;
      }
      result.textContent = formatTryOutResult(lastResponse, responseMode);
    };

    const bindUpdate = (node) => {
      node.addEventListener("input", updateConsole);
      node.addEventListener("change", updateConsole);
    };
    bindUpdate(serverSelect);
    for (const input of pathInputs) bindUpdate(input);
    queryEditor.onChange = updateConsole;
    headersEditor.onChange = updateConsole;
    if (bodyInput) bindUpdate(bodyInput);

    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Sending...";
      try {
        const request = collectRequest();
        const init = { method: request.method, headers: request.headers };
        if (request.body) init.body = request.body;
        const startedAt = performance.now();
        const response = await fetch(request.target, init);
        const elapsed = Math.round(performance.now() - startedAt);
        const responseText = await response.text();
        const responseHeaders = [];
        response.headers.forEach((value, key) => {
          responseHeaders.push(key + ": " + value);
        });
        lastResponse = {
          statusLine: response.status + " " + response.statusText,
          url: request.displayUrl || request.target,
          request: {
            method: request.method,
            url: request.displayUrl || request.target,
            headers: request.headers,
          },
          elapsed,
          headers: responseHeaders,
          body: responseText,
          prettyBody: formatResponseBody(responseText),
          error: "",
        };
        pushRequestHistory({
          operationKey,
          method: request.method,
          url: request.displayUrl || request.target,
          status: response.status,
          elapsed,
          time: new Date().toISOString(),
          bodySummary: summarizeBody(responseText),
          input: collectSnapshot(),
        });
        history.render();
        renderResponseResult();
        tabs.activate("response", false);
        status.textContent = "Done.";
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        let request = null;
        let target = "";
        try {
          request = collectRequest();
          target = request.displayUrl || request.target;
        } catch {
          target = "";
        }
        lastResponse = {
          statusLine: "Request failed",
          url: target,
          request: request
            ? {
              method: request.method,
                url: request.displayUrl || request.target,
                headers: request.headers,
              }
            : null,
          elapsed: 0,
          headers: [],
          body: message,
          prettyBody: message,
          error: message,
        };
        pushRequestHistory({
          operationKey,
          method: methodName,
          url: target || path,
          status: "ERR",
          elapsed: 0,
          time: new Date().toISOString(),
          bodySummary: message,
          input: collectSnapshot(),
        });
        history.render();
        renderResponseResult();
        tabs.activate("response", false);
        status.textContent = "Request failed.";
      } finally {
        button.disabled = false;
      }
    });

    details.appendChild(grid);
    updateConsole();
    history.render();
    return details;
  };

  const createOperationMetadata = (method, path, operation) => {
    const badges = document.createElement("div");
    badges.className = "vext-docs-meta";
    if (operation.operationId) appendBadge(badges, "operationId: " + operation.operationId);
    appendBadge(badges, getOperationKind(operation, path) === "frontend-route" ? "page" : "http api");
    if (Array.isArray(operation.tags)) {
      for (const tag of operation.tags) appendBadge(badges, "tag: " + tag);
    }
    if (badges.childNodes.length === 0) return null;
    const details = document.createElement("details");
    details.className = "vext-docs-metadata";
    const summary = document.createElement("summary");
    summary.textContent = "Metadata";
    details.appendChild(summary);
    details.appendChild(badges);
    return details;
  };

  const wrapControl = (labelText, control) => {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(control);
    return label;
  };

  const createSecondaryButton = (label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vext-docs-secondary-button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };

  const getServerOptions = () => {
    const options = [{ label: "Same origin", value: "" }];
    const servers = state.spec && Array.isArray(state.spec.servers) ? state.spec.servers : [];
    for (const server of servers) {
      if (!server || !server.url) continue;
      const url = text(server.url).trim();
      if (!url) continue;
      const description = server.description ? text(server.description) + " - " : "";
      if (!options.some((entry) => entry.value === url)) {
        options.push({ label: description + url, value: url });
      }
    }
    return options;
  };

  const isAbsoluteUrl = (value) => /^https?:\\/\\//iu.test(text(value));

  const resolveDisplayUrl = (target) => {
    try {
      return new URL(target, window.location.origin).href;
    } catch {
      return target;
    }
  };

  const joinServerAndPath = (server, path) => {
    const base = text(server).trim();
    if (!base) return path;
    if (base.endsWith("/") && path.startsWith("/")) return base.slice(0, -1) + path;
    if (!base.endsWith("/") && !path.startsWith("/")) return base + "/" + path;
    return base + path;
  };

  const createKeyValueEditor = (titleText, initialRows, rawLabel, rawPlaceholder, emptyText) => {
    const section = document.createElement("div");
    section.className = "vext-docs-kv-section";
    const title = document.createElement("strong");
    title.textContent = titleText;
    section.appendChild(title);

    const rowsWrap = document.createElement("div");
    rowsWrap.className = "vext-docs-kv-rows";
    section.appendChild(rowsWrap);

    const empty = document.createElement("p");
    empty.className = "vext-docs-kv-empty";
    empty.textContent = emptyText || "No declared values. Add a row to send manual values.";
    section.appendChild(empty);

    const editor = {
      element: section,
      rows: [],
      rawInput: document.createElement("textarea"),
      onChange: null,
      refreshEmpty() {
        empty.hidden = this.rows.length > 0;
      },
      values() {
        return this.rows
          .map((row) => ({ key: row.key.value.trim(), value: row.value.value }))
          .filter((row) => row.key || row.value);
      },
      valuesObject() {
        const object = {};
        for (const row of this.values()) {
          if (row.key) object[row.key] = row.value;
        }
        return object;
      },
      snapshot() {
        return this.values();
      },
      restore(rows) {
        while (rowsWrap.firstChild) rowsWrap.removeChild(rowsWrap.firstChild);
        this.rows = [];
        const nextRows = Array.isArray(rows) && rows.length > 0 ? rows : [];
        for (const row of nextRows) this.addRow(row.key || "", row.value || "");
        this.refreshEmpty();
      },
      addRow(key, value) {
        const rowEl = document.createElement("div");
        rowEl.className = "vext-docs-kv-row";
        const keyInput = document.createElement("input");
        keyInput.placeholder = "name";
        keyInput.value = key || "";
        const valueInput = document.createElement("input");
        valueInput.placeholder = "value";
        valueInput.value = value || "";
        const remove = createSecondaryButton("Remove", () => {
          rowEl.remove();
          editor.rows = editor.rows.filter((row) => row.element !== rowEl);
          editor.refreshEmpty();
          if (editor.onChange) editor.onChange();
        });
        const notify = () => {
          if (editor.onChange) editor.onChange();
        };
        keyInput.addEventListener("input", notify);
        valueInput.addEventListener("input", notify);
        rowEl.appendChild(keyInput);
        rowEl.appendChild(valueInput);
        rowEl.appendChild(remove);
        rowsWrap.appendChild(rowEl);
        editor.rows.push({ element: rowEl, key: keyInput, value: valueInput });
        editor.refreshEmpty();
      },
    };

    const seedRows = Array.isArray(initialRows) && initialRows.length > 0 ? initialRows : [];
    for (const row of seedRows) editor.addRow(row.key || "", row.value || "");
    editor.refreshEmpty();

    const add = createSecondaryButton("Add row", () => {
      editor.addRow("", "");
      if (editor.onChange) editor.onChange();
    });
    section.appendChild(add);

    const raw = document.createElement("details");
    const rawSummary = document.createElement("summary");
    rawSummary.textContent = rawLabel;
    raw.appendChild(rawSummary);
    editor.rawInput.placeholder = rawPlaceholder || "";
    editor.rawInput.addEventListener("input", () => {
      if (editor.onChange) editor.onChange();
    });
    raw.appendChild(editor.rawInput);
    section.appendChild(raw);
    return editor;
  };

  const createAuthNote = (operation) => {
    const note = document.createElement("div");
    note.className = "vext-docs-auth-note";
    const title = document.createElement("strong");
    title.textContent = "Auth injection";
    note.appendChild(title);
    const list = document.createElement("ul");
    for (const line of describeAuthInjection(operation)) {
      const item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    }
    note.appendChild(list);
    return note;
  };

  const createCodeSamplesSection = () => {
    const section = document.createElement("div");
    section.className = "vext-docs-code-samples";
    const title = document.createElement("strong");
    title.textContent = "Code samples";
    section.appendChild(title);
    const blocks = {};
    const sampleTabs = [];
    for (const [key, label] of [["curl", "cURL"], ["browserFetch", "Browser fetch"], ["nodeFetch", "Node fetch"], ["axios", "Axios"]]) {
      const sample = document.createElement("div");
      sample.className = "vext-docs-code-sample";
      const header = document.createElement("div");
      header.className = "vext-docs-code-sample-header";
      const name = document.createElement("strong");
      name.textContent = label;
      const pre = document.createElement("pre");
      pre.textContent = "";
      header.appendChild(name);
      header.appendChild(createCopyButton("Copy " + label, () => pre.textContent || ""));
      sample.appendChild(header);
      sample.appendChild(pre);
      sampleTabs.push({ id: key, label, content: sample });
      blocks[key] = pre;
    }
    section.appendChild(createTabs(sampleTabs, "curl", "vext-docs-sample-tabs").element);
    return { element: section, blocks };
  };

  const createRequestHistorySection = (operationKey, restore) => {
    const section = document.createElement("div");
    section.className = "vext-docs-history";
    const title = document.createElement("strong");
    title.textContent = "Request history";
    section.appendChild(title);
    const clearButton = createSecondaryButton("Clear history", () => {
      writeRequestHistory(readRequestHistory().filter((entry) => entry.operationKey !== operationKey));
      render();
    });
    section.appendChild(clearButton);
    const list = document.createElement("ul");
    list.className = "vext-docs-history-list";
    section.appendChild(list);

    const render = () => {
      clear(list);
      const items = readRequestHistory().filter((entry) => entry.operationKey === operationKey).slice(0, 20);
      if (items.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No history yet.";
        list.appendChild(empty);
        return;
      }
      for (const entry of items) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = [entry.method, entry.url, entry.status, entry.elapsed + "ms", formatHistoryTime(entry.time)].filter(Boolean).join(" · ");
        button.title = entry.bodySummary || "";
        button.addEventListener("click", () => restore(entry.input));
        li.appendChild(button);
        list.appendChild(li);
      }
    };
    return { element: section, render };
  };

  const extractPathParams = (path) => {
    const names = [];
    const pattern = /\\{([^}]+)\\}|:([A-Za-z0-9_]+)/g;
    let match;
    while ((match = pattern.exec(path)) !== null) {
      names.push(match[1] || match[2]);
    }
    return names;
  };

  const getPathParamNames = (path, operation) => {
    const fromSpec = Array.isArray(operation.parameters)
      ? operation.parameters.filter((param) => param.in === "path").map((param) => param.name)
      : [];
    return fromSpec.length > 0 ? fromSpec : extractPathParams(path);
  };

  const getParameterRows = (operation, location) => {
    const params = Array.isArray(operation.parameters)
      ? operation.parameters.filter((param) => param.in === location)
      : [];
    const rows = params.map((param) => ({
      key: param.name,
      value: text(sampleFromSchema(param.schema)),
    }));
    return rows;
  };

  const buildQueryPlaceholder = (operation) => {
    const queryParams = Array.isArray(operation.parameters)
      ? operation.parameters.filter((param) => param.in === "query")
      : [];
    if (queryParams.length === 0) return "page=1&limit=20";
    return queryParams
      .map((param) => param.name + "=" + encodeURIComponent(sampleFromSchema(param.schema)))
      .join("&");
  };

  const buildBodyPlaceholder = (operation) => {
    const first = getFirstContentEntry(operation.requestBody && operation.requestBody.content);
    if (!first || !first.entry || !first.entry.schema) {
      return "{\\n  \\"name\\": \\"Vext\\"\\n}";
    }
    return JSON.stringify(sampleFromSchema(first.entry.schema), null, 2);
  };

  const getRequestBodyContentType = (operation) => {
    const first = getFirstContentEntry(operation.requestBody && operation.requestBody.content);
    return first && first.key ? first.key : "application/json";
  };

  const sampleFromSchema = (schema) => {
    schema = resolveSchema(schema);
    if (!schema || typeof schema !== "object") return "";
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
    if (schema.$ref) return {};
    if (schema.type === "array") return [sampleFromSchema(schema.items)];
    if (schema.type === "integer" || schema.type === "number") return 0;
    if (schema.type === "boolean") return true;
    if (schema.properties && typeof schema.properties === "object") {
      const value = {};
      for (const [key, child] of Object.entries(schema.properties)) {
        value[key] = sampleFromSchema(child);
      }
      return value;
    }
    return schema.type === "string" || !schema.type ? "string" : "";
  };

  const collectQueryParts = (rows, rawQuery, authQuery) => {
    const queryParts = [];
    for (const row of rows || []) {
      if (!row.key) continue;
      queryParts.push(encodeURIComponent(row.key) + "=" + encodeURIComponent(row.value || ""));
    }
    const trimmedQuery = text(rawQuery).trim().replace(/^\\?/u, "");
    if (trimmedQuery) queryParts.push(trimmedQuery);
    if (Array.isArray(authQuery)) {
      for (const [name, value] of authQuery) {
        queryParts.push(encodeURIComponent(name) + "=" + encodeURIComponent(value));
      }
    }
    return queryParts;
  };

  const buildTryItOutUrl = (server, path, pathInputs, queryParts) => {
    let target = path;
    for (const input of pathInputs) {
      const encoded = encodeURIComponent(input.value);
      target = target.replace("{" + input.name + "}", encoded).replace(":" + input.name, encoded);
    }
    target = joinServerAndPath(server, target);
    const joined = queryParts.filter(Boolean).join("&");
    return joined ? target + (target.includes("?") ? "&" : "?") + joined : target;
  };

  const parseHeaders = (value) => {
    if (!value.trim()) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Headers must be a JSON object.");
    }
    return parsed;
  };

  const normalizeHeaders = (headers) => {
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
      normalized[String(key).toLowerCase()] = value;
    }
    return normalized;
  };

  const formatResponseBody = (body) => {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  };

  const formatTryOutResult = (response, mode) => {
    const body = mode === "raw" ? response.body : response.prettyBody;
    const request = response.request || {};
    const requestHeaders = formatHeaderLines(request.headers);
    const lines = [
      response.statusLine + (response.elapsed ? " (" + response.elapsed + "ms)" : ""),
      request.method && request.url ? "Request: " + request.method + " " + request.url : response.url ? "URL: " + response.url : "",
      response.error ? "Error: " + response.error : "",
      "",
      "Request headers:",
      requestHeaders.length > 0 ? requestHeaders.join("\\n") : "(none)",
      "",
      "Response headers:",
      response.headers && response.headers.length > 0 ? response.headers.join("\\n") : "(none)",
      "",
      mode === "raw" ? "Raw body:" : "Body:",
      body || "(empty)",
    ];
    return lines
      .filter((line, index, list) => line !== "" || (list[index - 1] !== "" && list[index + 1] !== ""))
      .join("\\n");
  };

  const formatHeaderLines = (headers) => {
    if (!headers || typeof headers !== "object") return [];
    return Object.entries(headers).map(([key, value]) => key + ": " + text(value));
  };

  const summarizeBody = (body) => {
    const compactBody = text(body).replace(/\\s+/gu, " ").trim();
    return compactBody.length > 160 ? compactBody.slice(0, 157) + "..." : compactBody;
  };

  const formatHistoryTime = (value) => {
    try {
      return new Date(value).toLocaleTimeString();
    } catch {
      return text(value);
    }
  };

  const readRequestHistory = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(REQUEST_HISTORY_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeRequestHistory = (items) => {
    try {
      localStorage.setItem(REQUEST_HISTORY_STORAGE_KEY, JSON.stringify(items.slice(0, 20)));
    } catch {
      // Ignore storage errors in locked-down browsers.
    }
  };

  const pushRequestHistory = (entry) => {
    const next = [entry, ...readRequestHistory().filter((item) => item.operationKey !== entry.operationKey || item.url !== entry.url || item.time !== entry.time)];
    writeRequestHistory(next);
  };

  const renderCodeSamples = (blocks, request) => {
    blocks.curl.textContent = createCurlSample(request);
    blocks.browserFetch.textContent = createBrowserFetchSample(request);
    blocks.nodeFetch.textContent = createNodeFetchSample(request);
    blocks.axios.textContent = createAxiosSample(request);
  };

  const jsonLiteral = (value) => JSON.stringify(value, null, 2);

  const bodyExpression = (body) => {
    if (!body) return "";
    try {
      return "JSON.stringify(" + jsonLiteral(JSON.parse(body)) + ")";
    } catch {
      return JSON.stringify(body);
    }
  };

  const createCurlSample = (request) => {
    const lines = ["curl -X " + request.method + " " + JSON.stringify(request.displayUrl || request.target)];
    for (const [key, value] of Object.entries(request.headers || {})) {
      lines.push("-H " + JSON.stringify(key + ": " + value));
    }
    if (request.body) lines.push("--data-raw " + JSON.stringify(request.body));
    return lines.join(" \\\\\\n  ");
  };

  const createBrowserFetchSample = (request) => {
    const lines = ["await fetch(" + JSON.stringify(request.target) + ", {", "  method: " + JSON.stringify(request.method) + ","];
    if (Object.keys(request.headers || {}).length > 0) {
      lines.push("  headers: " + indentMultiline(jsonLiteral(request.headers), 2) + ",");
    }
    const body = bodyExpression(request.body);
    if (body) lines.push("  body: " + body + ",");
    lines.push("});");
    return lines.join("\\n");
  };

  const createNodeFetchSample = (request) => {
    return [
      "// Node.js 20+ has global fetch.",
      "const response = await fetch(" + JSON.stringify(request.displayUrl || request.target) + ", {",
      "  method: " + JSON.stringify(request.method) + (Object.keys(request.headers || {}).length > 0 || request.body ? "," : ""),
      Object.keys(request.headers || {}).length > 0 ? "  headers: " + indentMultiline(jsonLiteral(request.headers), 2) + (request.body ? "," : "") : "",
      request.body ? "  body: " + bodyExpression(request.body) + "," : "",
      "});",
      "const data = await response.text();",
    ].filter(Boolean).join("\\n");
  };

  const createAxiosSample = (request) => {
    const lines = ["// Axios example only; install axios in your project if you use it.", "await axios({", "  method: " + JSON.stringify(request.method.toLowerCase()) + ",", "  url: " + JSON.stringify(request.displayUrl || request.target) + ","];
    if (Object.keys(request.headers || {}).length > 0) {
      lines.push("  headers: " + indentMultiline(jsonLiteral(request.headers), 2) + ",");
    }
    if (request.body) {
      try {
        lines.push("  data: " + indentMultiline(jsonLiteral(JSON.parse(request.body)), 2) + ",");
      } catch {
        lines.push("  data: " + JSON.stringify(request.body) + ",");
      }
    }
    lines.push("});");
    return lines.join("\\n");
  };

  const indentMultiline = (value, spaces) => {
    const indent = " ".repeat(spaces);
    return text(value).split("\\n").map((line, index) => index === 0 ? line : indent + line).join("\\n");
  };

  const createCodeItem = (doc) => {
    const item = document.createElement("article");
    item.className = "vext-docs-code-item";
    item.id = codeAnchorId(doc);

    const title = document.createElement("h2");
    title.className = "vext-docs-code-title";
    title.textContent = text(doc.title || doc.id);
    item.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "vext-docs-meta";
    appendBadge(meta, text(doc.kind));
    if (doc.sourceFile) appendBadge(meta, doc.sourceFile);
    appendSourceLink(meta, doc);
    if (doc.sourceFile) meta.appendChild(createCopyButton("Copy source path", () => doc.sourceFile));
    meta.appendChild(createCopyButton("Copy link", () => linkForAnchor(item.id)));
    if (doc.deprecated) appendBadge(meta, "deprecated");
    item.appendChild(meta);

    if (doc.summary || doc.description) appendFormattedDescription(item, doc.description || doc.summary);

    appendModelDetails(item, doc);
    appendPluginDetails(item, doc);
    appendMiddlewareDetails(item, doc);

    const usage = createUsageSnippet(doc);
    if (usage) {
      const section = document.createElement("div");
      section.className = "vext-docs-code-section";
      const label = document.createElement("strong");
      label.textContent = "Usage";
      section.appendChild(label);
      section.appendChild(createCopyButton("Copy usage", () => usage));
      section.appendChild(createBlock(usage));
      item.appendChild(section);
    }

    if (Array.isArray(doc.params) && doc.params.length > 0) {
      const section = document.createElement("div");
      section.className = "vext-docs-code-section";
      const label = document.createElement("strong");
      label.textContent = "Parameters";
      section.appendChild(label);
      const table = createDataTable(
        ["Name", "Type", "Optional", "Description"],
        doc.params.map((param) => [
          param.name,
          param.type || "",
          param.optional ? "yes" : "no",
          param.description || "",
        ]),
      );
      if (table) section.appendChild(table);
      item.appendChild(section);
    }

    if (doc.returns && (doc.returns.type || doc.returns.description)) {
      const returns = document.createElement("p");
      returns.className = "vext-docs-code-section";
      returns.textContent = "Returns: " + [doc.returns.type, doc.returns.description].filter(Boolean).join(" - ");
      item.appendChild(returns);
    }

    if (Array.isArray(doc.throws) && doc.throws.length > 0) {
      const throwsEl = document.createElement("p");
      throwsEl.className = "vext-docs-code-section";
      throwsEl.textContent = "Throws: " + doc.throws.map((entry) => [entry.type, entry.description].filter(Boolean).join(" - ")).join("; ");
      item.appendChild(throwsEl);
    }

    if (Array.isArray(doc.examples) && doc.examples.length > 0) {
      const section = document.createElement("div");
      section.className = "vext-docs-code-section";
      const label = document.createElement("strong");
      label.textContent = "Examples";
      section.appendChild(label);
      for (const example of doc.examples) {
        const pre = document.createElement("pre");
        pre.textContent = example;
        section.appendChild(pre);
      }
      item.appendChild(section);
    }

    return item;
  };

  const createUsageSnippet = (doc) => {
    const args = Array.isArray(doc.params) ? doc.params.map((param) => param.name).join(", ") : "";
    if (doc.kind === "service") {
      const title = text(doc.title || "");
      if (title.startsWith("services.")) {
        return "await app." + title + "(" + args + ");";
      }
      const parsed = parseDocId(doc.id);
      return "await app.services." + parsed.scope + "." + parsed.member + "(" + args + ");";
    }
    if (doc.kind === "utils") {
      const exportName = doc.exportName || parseDocId(doc.id).member;
      const source = text(doc.sourceFile || "").replace(/\\.(ts|js|mts|mjs|cts|cjs)$/u, "");
      const importPath = source ? "./" + source.replace(/^src\\//u, "src/") : "./src/utils";
      return "import { " + exportName + " } from \\"" + importPath + "\\";\\n\\n" + exportName + "(" + args + ");";
    }
    if (doc.kind === "model") {
      if (doc.model && doc.model.usage) return doc.model.usage;
      return "// Model reference: " + text(doc.title || doc.id) + "\\n// Use it from your project database/model layer or service contract.";
    }
    if (doc.kind === "component") {
      const exportName = doc.exportName || parseDocId(doc.id).member;
      const source = text(doc.sourceFile || "").replace(/\\.(tsx|jsx|ts|js|mts|mjs|cts|cjs)$/u, "");
      const importPath = source ? "./" + source.replace(/^src\\//u, "src/") : "./src/frontend/components";
      if (exportName === "default") {
        const fallbackName = text(doc.title || "Component").split("#")[0].split("/").pop() || "Component";
        return "import " + fallbackName + " from \\"" + importPath + "\\";\\n\\n<" + fallbackName + " />;";
      }
      return "import { " + exportName + " } from \\"" + importPath + "\\";\\n\\n<" + exportName + " />;";
    }
    if (doc.kind === "plugin") {
      const name = doc.plugin && doc.plugin.name ? doc.plugin.name : parseDocId(doc.id).scope;
      const extensions = doc.plugin && Array.isArray(doc.plugin.extensions) ? doc.plugin.extensions : [];
      const calls = extensions.map((entry) => "app." + entry + ";").join("\\n");
      return "// Place this file under src/plugins; Vext loads it during bootstrap.\\n// Plugin name: " + name + (calls ? "\\n\\n" + calls : "");
    }
    if (doc.kind === "middleware") {
      if (doc.middleware && doc.middleware.usage) {
        return "// config/default.ts\\nmiddlewares: [\\"" + (doc.middleware.name || parseDocId(doc.id).scope) + "\\"],\\n\\n// route options\\n" + doc.middleware.usage;
      }
      return "// config/default.ts\\nmiddlewares: [\\"" + parseDocId(doc.id).scope + "\\"]";
    }
    if (doc.kind === "locale") {
      const source = text(doc.sourceFile || "");
      if (source.startsWith("frontend/locales/")) {
        return "import { useVextI18n } from \\"vextjs/frontend\\";\\n\\nconst i18n = useVextI18n();\\n// Read frontend messages from " + source + ".";
      }
      return "// Backend locale resource: " + source + "\\nreq.t(\\"your.message.key\\");\\napp.throw(\\"your.message.key\\");";
    }
    if (doc.kind === "config") {
      return "// Vext loads src/" + text(doc.sourceFile || "config/default.ts") + " for the selected config profile.\\n// Start with: vext start --config " + parseDocId(doc.id).scope;
    }
    if (doc.kind === "preload") {
      return "// Project preload file: " + text(doc.sourceFile || "preload") + "\\n// It runs before app bootstrap when configured by the Vext CLI preload pipeline.";
    }
    if (doc.kind === "style") {
      const source = text(doc.sourceFile || "").replace(/\\.(ts|js|mts|mjs|cts|cjs)$/u, "");
      const importPath = source ? "./src/" + source.replace(/^src\\//u, "") : "./src/frontend/styles";
      return "import \\"" + importPath + "\\";\\n// Use exported Vext JSCSS classes/vars from this style module.";
    }
    return "";
  };

  const parseDocId = (id) => {
    const parts = text(id).split("#");
    const rawScope = parts[0] || "";
    const scope = rawScope.replace(/^[^:]+:/u, "") || "default";
    return {
      scope,
      member: parts[1] || "default",
    };
  };

  const flattenOperations = (spec) => {
    const paths = spec && spec.paths && typeof spec.paths === "object" ? spec.paths : {};
    const operations = [];
    for (const [path, methods] of Object.entries(paths)) {
      if (!methods || typeof methods !== "object") continue;
      for (const [method, operation] of Object.entries(methods)) {
        if (!HTTP_METHODS.includes(method)) continue;
        const op = operation || {};
        operations.push({ method, path, operation: op, kind: getOperationKind(op, path) });
      }
    }
    return operations;
  };

  const flattenCodeItems = (codeDocs, kind) => {
    const items = codeDocs && Array.isArray(codeDocs.items) ? codeDocs.items : [];
    return items.filter((item) => item.kind === kind);
  };

  const visibleOperations = (view) => {
    return flattenOperations(state.spec)
      .filter((item) => !view || item.kind === view)
      .filter((item) => matchesQuery([
        item.method,
        item.path,
        item.operation.summary,
        item.operation.description,
        item.operation.operationId,
        ...(Array.isArray(item.operation.tags) ? item.operation.tags : []),
      ], state.query));
  };

  const visibleCodeItems = (view) => {
    return flattenCodeItems(state.codeDocs, view).filter((item) => matchesQuery([
      item.id,
      item.title,
      item.summary,
      item.description,
      item.sourceFile,
      item.exportName,
      item.model && item.model.registryKey,
      item.model && item.model.collection,
      item.model && Array.isArray(item.model.fields) ? item.model.fields.map((field) => field.name + " " + (field.type || "")).join(" ") : "",
      item.plugin && item.plugin.name,
      item.plugin && Array.isArray(item.plugin.dependencies) ? item.plugin.dependencies.join(" ") : "",
      item.plugin && Array.isArray(item.plugin.extensions) ? item.plugin.extensions.join(" ") : "",
      item.middleware && item.middleware.name,
      item.middleware && item.middleware.type,
      Array.isArray(item.tags) ? item.tags.join(" ") : "",
    ], state.query));
  };

  const viewForAnchor = (anchor) => {
    if (!anchor) return "";
    for (const item of flattenOperations(state.spec)) {
      if (operationAnchorId(item.method, item.path) === anchor) return item.kind;
    }
    for (const item of state.codeDocs.items || []) {
      if (codeAnchorId(item) === anchor) return item.kind;
    }
    return "";
  };

  const getOperationKind = (operation, path) => {
    if (operation && operation["x-vext-docs-kind"] === "frontend-route") return "frontend-route";
    if (operation && operation["x-vext-docs-kind"] === "backend-api") return "backend-api";
    const tags = Array.isArray(operation && operation.tags) ? operation.tags.map((tag) => String(tag).toLowerCase()) : [];
    if (tags.includes("frontend") || path.startsWith("/frontend")) return "frontend-route";
    return "backend-api";
  };

  const getOperationTags = (operation) => {
    return Array.isArray(operation && operation.tags) && operation.tags.length > 0
      ? operation.tags.map((tag) => text(tag))
      : ["Untagged"];
  };

  const matchesQuery = (values, query) => {
    if (!query.trim()) return true;
    return values.join(" ").toLowerCase().includes(query.trim().toLowerCase());
  };

  const activeQuery = () => state.query.trim();

  const appendHighlightedText = (parent, className, value) => {
    const span = document.createElement("span");
    span.className = className;
    const label = text(value);
    const query = activeQuery();
    if (!query) {
      span.textContent = label;
      parent.appendChild(span);
      return span;
    }
    const lower = label.toLowerCase();
    const needle = query.toLowerCase();
    let cursor = 0;
    let index = lower.indexOf(needle);
    while (index >= 0) {
      if (index > cursor) span.appendChild(document.createTextNode(label.slice(cursor, index)));
      const mark = document.createElement("mark");
      mark.className = "vext-docs-mark";
      mark.textContent = label.slice(index, index + query.length);
      span.appendChild(mark);
      cursor = index + query.length;
      index = lower.indexOf(needle, cursor);
    }
    if (cursor < label.length) span.appendChild(document.createTextNode(label.slice(cursor)));
    parent.appendChild(span);
    return span;
  };

  const sectionId = (view, label) => {
    const slug = text(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return "vext-docs-" + view + "-" + (slug || "section");
  };

  const operationAnchorId = (method, path) => sectionId("operation", method + "-" + path);
  const codeAnchorId = (doc) => sectionId("code", doc.id || doc.title || "item");

  const pathSegments = (path) => {
    const cleaned = text(path).replace(/^\\/+|\\/+$/g, "");
    return cleaned ? cleaned.split("/").filter(Boolean) : ["root"];
  };

  const isDynamicPathSegment = (segment) => {
    return /^\\{[^}]+\\}$/u.test(segment) || /^:[A-Za-z0-9_]+$/u.test(segment) || /^\\[[^\\]]+\\]$/u.test(segment);
  };

  const operationTreeSegments = (path) => {
    const segments = pathSegments(path);
    const treeSegments = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const dynamic = isDynamicPathSegment(segment);
      if (dynamic) {
        const hasStableTail = segments.slice(index + 1).some((tail) => !isDynamicPathSegment(tail));
        if (!hasStableTail) continue;
      }
      treeSegments.push({ label: segment, dynamic });
    }
    return treeSegments.length > 0 ? treeSegments : [{ label: "root", dynamic: false }];
  };

  const operationLeafLabel = (item) => {
    const summary = text(item.operation && item.operation.summary).trim();
    return summary || item.path;
  };

  const sortTreeNodes = (nodes) => {
    nodes.sort((a, b) => {
      if (a.anchorId && !b.anchorId) return 1;
      if (!a.anchorId && b.anchorId) return -1;
      return a.label.localeCompare(b.label);
    });
    for (const node of nodes) sortTreeNodes(node.children);
    return nodes;
  };

  const ensureTreeChild = (node, key, label, dynamic) => {
    let child = node.children.find((candidate) => candidate.key === key && !candidate.anchorId);
    if (!child) {
      child = { key, label, dynamic: Boolean(dynamic), count: 0, children: [], anchorId: "" };
      node.children.push(child);
    }
    return child;
  };

  const addTreeLeaf = (root, segments, leafLabel, anchorId, metadata) => {
    let node = root;
    node.count += 1;
    const normalizedSegments = segments.length > 0 ? segments : [];
    let key = root.key;
    for (const segment of normalizedSegments) {
      const label = typeof segment === "string" ? segment : segment.label;
      const dynamic = typeof segment === "string" ? false : segment.dynamic;
      key += "/" + label;
      node = ensureTreeChild(node, key, label, dynamic);
      node.count += 1;
    }
    node.children.push({
      key: key + "#" + anchorId,
      label: leafLabel,
      method: metadata && metadata.method ? metadata.method : "",
      fullLabel: metadata && metadata.fullLabel ? metadata.fullLabel : leafLabel,
      count: 1,
      children: [],
      anchorId,
    });
  };

  const flattenSingleOperationBranches = (nodes, insideDynamicBranch = false) => {
    const flattened = [];
    for (const node of nodes) {
      if (!node.anchorId) {
        node.children = flattenSingleOperationBranches(node.children, insideDynamicBranch || Boolean(node.dynamic));
        const branchChildren = node.children.filter((child) => !child.anchorId);
        const leafChildren = node.children.filter((child) => Boolean(child.anchorId));
        if (!insideDynamicBranch && !node.dynamic && branchChildren.length === 0 && leafChildren.length === 1) {
          const leaf = leafChildren[0];
          if (leaf.method && leaf.label === "/") {
            flattened.push({
              ...leaf,
              label: node.label === "root" ? "/" : node.label,
            });
          } else {
            flattened.push(leaf);
          }
          continue;
        }
      }
      flattened.push(node);
    }
    return flattened;
  };

  const buildOperationTree = (operations, view) => {
    const root = { key: view, label: view, count: 0, children: [], anchorId: "" };
    for (const item of operations) {
      addTreeLeaf(
        root,
        operationTreeSegments(item.path),
        operationLeafLabel(item),
        operationAnchorId(item.method, item.path),
        {
          method: item.method.toUpperCase(),
          fullLabel: item.method.toUpperCase() + " " + item.path,
        },
      );
    }
    root.children = flattenSingleOperationBranches(root.children);
    sortTreeNodes(root.children);
    return root.children;
  };

  const splitScope = (value) => text(value).split(".").map((part) => part.trim()).filter(Boolean);

  const stripExtension = (value) => text(value).replace(/\\.(ts|js|mts|mjs|cts|cjs)$/u, "");

  const codeLeafLabel = (item, fallback) => {
    const parsed = parseDocId(item.id);
    const member = item.exportName || parsed.member || "";
    const base = text(fallback || item.title || item.id);
    return member && member !== "default" ? base + "." + member : base;
  };

  const codeTreePath = (item) => {
    const parsed = parseDocId(item.id);
    if (item.kind === "service") {
      return {
        segments: splitScope(parsed.scope),
        leaf: parsed.member || item.exportName || text(item.title || item.id),
      };
    }
    if (item.kind === "utils") {
      const source = stripExtension(item.sourceFile || "").replace(/^src\\//u, "").replace(/^utils\\//u, "");
      const segments = source ? source.split("/").filter(Boolean) : [];
      return {
        segments,
        leaf: item.exportName || parsed.member || text(item.title || item.id),
      };
    }
    if (item.kind === "model") {
      const modelName = parsed.scope || text(item.title || item.id).replace(/^models\\./u, "");
      const source = stripExtension(item.sourceFile || "").replace(/^src\\//u, "").replace(/^models\\//u, "");
      const parts = source ? source.split("/").filter(Boolean) : [];
      return {
        segments: parts.slice(0, -1),
        leaf: modelName,
      };
    }
    if (item.kind === "plugin") {
      const source = stripExtension(item.sourceFile || "").replace(/^src\\//u, "").replace(/^plugins\\//u, "");
      const parts = source ? source.split("/").filter(Boolean) : [];
      const pluginName = item.plugin && item.plugin.name ? item.plugin.name : parts[parts.length - 1] || parsed.scope;
      return {
        segments: parts.slice(0, -1),
        leaf: codeLeafLabel(item, pluginName),
      };
    }
    if (item.kind === "middleware") {
      const source = stripExtension(item.sourceFile || "").replace(/^src\\//u, "").replace(/^middlewares\\//u, "");
      const parts = source ? source.split("/").filter(Boolean) : [];
      const middlewareName = item.middleware && item.middleware.name ? item.middleware.name : parts[parts.length - 1] || parsed.scope;
      return {
        segments: parts.slice(0, -1),
        leaf: codeLeafLabel(item, middlewareName),
      };
    }
    if (item.kind === "component") {
      const source = stripExtension(item.sourceFile || "").replace(/^src\\//u, "").replace(/^frontend\\/components\\//u, "");
      const segments = source ? source.split("/").filter(Boolean) : [];
      return {
        segments,
        leaf: item.exportName || parsed.member || text(item.title || item.id),
      };
    }
    if (item.kind === "locale") {
      const source = stripExtension(item.sourceFile || "").replace(/^src\\//u, "");
      const normalized = source.startsWith("frontend/locales/")
        ? source.replace(/^frontend\\/locales\\//u, "frontend/")
        : source.replace(/^locales\\//u, "");
      const parts = normalized ? normalized.split("/").filter(Boolean) : [];
      return {
        segments: parts.slice(0, -1),
        leaf: parts[parts.length - 1] || parsed.scope || text(item.title || item.id),
      };
    }
    if (item.kind === "config") {
      const source = stripExtension(item.sourceFile || "").replace(/^src\\//u, "").replace(/^config\\//u, "");
      const parts = source ? source.split("/").filter(Boolean) : [];
      return {
        segments: parts.slice(0, -1),
        leaf: parts[parts.length - 1] || parsed.scope || text(item.title || item.id),
      };
    }
    if (item.kind === "style") {
      const source = stripExtension(item.sourceFile || "").replace(/^src\\//u, "").replace(/^frontend\\/styles\\//u, "");
      const parts = source ? source.split("/").filter(Boolean) : [];
      return {
        segments: parts.slice(0, -1),
        leaf: parts[parts.length - 1] || parsed.scope || text(item.title || item.id),
      };
    }
    if (item.kind === "preload") {
      const source = stripExtension(item.sourceFile || "").replace(/^preload\\//u, "");
      const parts = source ? source.split("/").filter(Boolean) : [];
      return {
        segments: parts.slice(0, -1),
        leaf: parts[parts.length - 1] || parsed.scope || text(item.title || item.id),
      };
    }
    return {
      segments: [item.kind || "code"],
      leaf: item.exportName || parsed.member || text(item.title || item.id),
    };
  };

  const buildCodeTree = (items, view) => {
    const root = { key: view, label: view, count: 0, children: [], anchorId: "" };
    for (const item of items) {
      const path = codeTreePath(item);
      addTreeLeaf(root, path.segments, path.leaf, codeAnchorId(item));
    }
    sortTreeNodes(root.children);
    return root.children;
  };

  const renderOperations = (operations) => {
    for (const item of operations) {
      panelEl.appendChild(createOperation(item.method, item.path, item.operation));
    }
  };

  const groupCodeItems = (items, view) => {
    const groups = new Map();
    for (const item of items) {
      const label = codeGroupLabel(item);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    }
    return Array.from(groups.entries()).map(([label, groupItems]) => ({
      id: sectionId(view, label),
      label,
      items: groupItems,
    }));
  };

  const codeGroupLabel = (item) => {
    if (item.kind === "service") return "services." + parseDocId(item.id).scope;
    if (item.kind === "utils") return item.sourceFile || "utils";
    if (item.kind === "model") return item.sourceFile ? item.sourceFile.split("/").slice(0, -1).join("/") || "models" : "models";
    if (item.kind === "component") return item.sourceFile || "components";
    if (item.kind === "plugin") return item.sourceFile ? item.sourceFile.split("/").slice(0, -1).join("/") || "plugins" : "plugins";
    if (item.kind === "middleware") return item.sourceFile ? item.sourceFile.split("/").slice(0, -1).join("/") || "middlewares" : "middlewares";
    if (item.kind === "locale") return item.sourceFile ? item.sourceFile.split("/").slice(0, -1).join("/") || "locales" : "locales";
    if (item.kind === "config") return item.sourceFile ? item.sourceFile.split("/").slice(0, -1).join("/") || "config" : "config";
    if (item.kind === "style") return item.sourceFile ? item.sourceFile.split("/").slice(0, -1).join("/") || "styles" : "styles";
    if (item.kind === "preload") return item.sourceFile ? item.sourceFile.split("/").slice(0, -1).join("/") || "preload" : "preload";
    return item.kind || "code";
  };

  const scrollToAnchor = () => {
    if (!state.anchor) return;
    const target = document.getElementById(state.anchor);
    if (target) target.scrollIntoView({ block: "start" });
  };

  const ensureElementId = (element, prefix) => {
    if (element.id) return element.id;
    const label = element.textContent || prefix;
    element.id = sectionId(prefix, label + "-" + Math.random().toString(36).slice(2));
    return element.id;
  };

  const renderOutline = () => {
    if (!outlineEl) return;
    clear(outlineEl);
    if (state.view === "overview") {
      outlineEl.hidden = true;
      return;
    }
    outlineEl.hidden = false;
    const title = document.createElement("p");
    title.className = "vext-docs-outline-title";
    title.textContent = "On this page";
    outlineEl.appendChild(title);
    const candidates = Array.from(panelEl.querySelectorAll(
      ".vext-docs-operation .vext-docs-path, .vext-docs-detail h3, details.vext-docs-tryout > summary, .vext-docs-code-title, .vext-docs-code-section strong, .vext-docs-section-heading",
    ));
    const seen = new Set();
    for (const element of candidates) {
      const label = text(element.textContent).trim();
      if (!label || seen.has(label + element.tagName)) continue;
      const id = ensureElementId(element, "outline");
      seen.add(label + element.tagName);
      const link = document.createElement("a");
      link.className = "vext-docs-outline-link";
      link.href = "#" + id;
      link.textContent = label;
      link.addEventListener("click", () => {
        state.anchor = id;
      });
      outlineEl.appendChild(link);
    }
    if (outlineEl.childNodes.length === 1) {
      const empty = document.createElement("span");
      empty.className = "vext-docs-outline-link";
      empty.textContent = "No sections";
      outlineEl.appendChild(empty);
    }
  };

  const appendNavText = (parent, className, value) => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text(value);
    parent.appendChild(span);
    return span;
  };

  const appendBranchContent = (row, node, onToggle) => {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "vext-docs-nav-caret-button";
    toggle.setAttribute("aria-label", "Toggle " + node.label);
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle();
    });
    const caret = document.createElement("span");
    caret.className = "vext-docs-nav-caret";
    caret.setAttribute("aria-hidden", "true");
    toggle.appendChild(caret);
    row.appendChild(toggle);
    appendHighlightedText(row, "vext-docs-nav-label" + (node.dynamic ? " vext-docs-nav-param" : ""), node.label);
    appendNavText(row, "vext-docs-nav-count", String(node.count));
  };

  const appendLeafContent = (button, node) => {
    if (node.method) {
      appendNavText(button, "vext-docs-nav-method", node.method);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "vext-docs-nav-leaf-spacer";
      spacer.setAttribute("aria-hidden", "true");
      button.appendChild(spacer);
    }
    appendHighlightedText(button, "vext-docs-nav-label", node.label);
  };

  const appendTopLevelNavContent = (button, group, hasTree) => {
    if (hasTree) {
      const caret = document.createElement("span");
      caret.className = "vext-docs-nav-caret";
      caret.setAttribute("aria-hidden", "true");
      button.appendChild(caret);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "vext-docs-nav-caret-spacer";
      spacer.setAttribute("aria-hidden", "true");
      button.appendChild(spacer);
    }
    appendHighlightedText(button, "vext-docs-nav-label", group.label);
    appendNavText(button, "vext-docs-nav-count", String(group.count));
  };

  const renderNavTree = (nodes, parent, view, depth) => {
    if (nodes.length === 0) return;
    const wrap = document.createElement("div");
    wrap.className = depth === 0 ? "vext-docs-nav-tree" : "vext-docs-nav-children";
    for (const node of nodes) {
      const isLeaf = Boolean(node.anchorId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = isLeaf ? "vext-docs-nav-leaf vext-docs-nav-child" : "vext-docs-nav-branch";
      if (isLeaf && state.anchor === node.anchorId) {
        button.setAttribute("aria-current", "location");
      }

      if (isLeaf) {
        const fullLabel = text(node.fullLabel || (node.method ? node.method + " " + node.label : node.label));
        button.title = fullLabel;
        button.setAttribute("aria-label", fullLabel);
        appendLeafContent(button, node);
        button.addEventListener("click", () => {
          state.anchor = node.anchorId;
          if (history.replaceState) history.replaceState(null, "", "#" + node.anchorId);
          render();
        });
      } else {
        const collapsedKey = view + ":" + node.key;
        const isCollapsed = !state.query.trim() && state.collapsedNav.has(collapsedKey);
        const row = document.createElement("div");
        row.className = "vext-docs-nav-branch";
        row.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
        row.title = node.label + " (" + node.count + ")";
        const toggleBranch = () => {
          if (state.collapsedNav.has(collapsedKey)) {
            state.collapsedNav.delete(collapsedKey);
          } else {
            state.collapsedNav.add(collapsedKey);
          }
          renderNav();
        };
        appendBranchContent(row, node, toggleBranch);
        row.addEventListener("click", () => {
          if (state.collapsedNav.has(collapsedKey)) {
            state.collapsedNav.delete(collapsedKey);
            renderNav();
          }
        });
        wrap.appendChild(row);
        if (!isCollapsed) {
          renderNavTree(node.children, wrap, view, depth + 1);
        }
        continue;
      }
      wrap.appendChild(button);
    }
    parent.appendChild(wrap);
  };

  const renderNav = () => {
    clear(navEl);
    const operations = flattenOperations(state.spec);
    const backendOperations = visibleOperations("backend-api");
    const frontendOperations = visibleOperations("frontend-route");
    const groups = [
      { view: "overview", label: "Overview", count: operations.length + ((state.codeDocs.items || []).length), tree: [] },
      { view: "backend-api", label: "HTTP API", count: backendOperations.length },
      { view: "frontend-route", label: "Pages", count: frontendOperations.length },
      { view: "service", label: "Services", count: visibleCodeItems("service").length },
      { view: "utils", label: "Utils", count: visibleCodeItems("utils").length },
      { view: "model", label: "Models", count: visibleCodeItems("model").length },
    ];
    const componentCount = visibleCodeItems("component").length;
    if (componentCount > 0) {
      groups.push({ view: "component", label: "Components", count: componentCount });
    }
    const pluginCount = visibleCodeItems("plugin").length;
    if (pluginCount > 0) {
      groups.push({ view: "plugin", label: "Plugins", count: pluginCount });
    }
    const middlewareCount = visibleCodeItems("middleware").length;
    if (middlewareCount > 0) {
      groups.push({ view: "middleware", label: "Middlewares", count: middlewareCount });
    }
    for (const group of groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vext-docs-nav-button";
      const hasTree = group.view !== "overview" && group.count > 0;
      const isCurrent = state.view === group.view;
      const isCollapsed = hasTree && !state.query.trim() && state.collapsedGroups.has(group.view);
      const isExpanded = hasTree && isCurrent && !isCollapsed;
      appendTopLevelNavContent(button, group, hasTree);
      if (hasTree) {
        button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        button.setAttribute(
          "aria-label",
          (isExpanded ? "Collapse " : "Expand ") + group.label,
        );
      }
      if (isCurrent) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => {
        if (state.view === group.view) {
          if (hasTree) {
            if (state.collapsedGroups.has(group.view)) {
              state.collapsedGroups.delete(group.view);
            } else {
              state.collapsedGroups.add(group.view);
            }
            renderNav();
          }
          return;
        }
        state.view = group.view;
        state.searchScope = group.view === "overview" ? "all" : group.view;
        state.anchor = "";
        state.collapsedGroups.delete(group.view);
        render();
      });
      navEl.appendChild(button);

      if (isCurrent && !isCollapsed) {
        const tree = getNavTree(group.view);
        renderNavTree(tree, navEl, group.view, 0);
      }
    }
    applyAutoSidebarWidth();
  };

  const getNavTree = (view) => {
    if (view === "backend-api" || view === "frontend-route") {
      return buildOperationTree(visibleOperations(view), view);
    }
    if (view === "service" || view === "utils" || view === "model" || view === "component" || view === "plugin" || view === "middleware" || view === "locale" || view === "config" || view === "style" || view === "preload") {
      return buildCodeTree(visibleCodeItems(view), view);
    }
    return [];
  };

  const render = () => {
    clear(panelEl);
    if (rootEl) rootEl.setAttribute("data-vext-docs-view", state.view);
    panelEl.setAttribute("data-vext-docs-view", state.view);
    updateSearchFilterButtons();
    renderNav();

    if (state.view === "overview") {
      const overview = document.createElement("div");
      overview.className = "vext-docs-code-item";
      const title = document.createElement("h2");
      title.className = "vext-docs-code-title";
      title.textContent = config.title || "Overview";
      overview.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "vext-docs-meta";
      const operations = flattenOperations(state.spec);
      appendBadge(meta, "OpenAPI source: " + config.specPublicPath);
      appendBadge(meta, "asset: " + (config.assetVersion || "dev"));
      appendBadge(meta, "access: " + (config.accessMode || "off"));
      overview.appendChild(meta);
      const desc = document.createElement("p");
      desc.className = "vext-docs-code-desc";
      desc.textContent = "Browse API operations and standard JSDoc entries generated from this Vext application.";
      overview.appendChild(desc);
      const cards = document.createElement("div");
      cards.className = "vext-docs-overview-grid";
      const createOverviewCard = (view, label, count) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "vext-docs-overview-card vext-docs-overview-button";
        const strong = document.createElement("strong");
        strong.textContent = String(count);
        const span = document.createElement("span");
        span.textContent = label;
        card.appendChild(strong);
        card.appendChild(span);
        card.addEventListener("click", () => {
          state.view = view;
          state.searchScope = view === "overview" ? "all" : view;
          state.anchor = "";
          render();
        });
        cards.appendChild(card);
      };
      createOverviewCard("backend-api", "HTTP API", operations.filter((item) => item.kind === "backend-api").length);
      createOverviewCard("frontend-route", "Pages", operations.filter((item) => item.kind === "frontend-route").length);
      createOverviewCard("service", "Services", flattenCodeItems(state.codeDocs, "service").length);
      createOverviewCard("utils", "Utils", flattenCodeItems(state.codeDocs, "utils").length);
      createOverviewCard("model", "Models", flattenCodeItems(state.codeDocs, "model").length);
      createOverviewCard("component", "Components", flattenCodeItems(state.codeDocs, "component").length);
      createOverviewCard("plugin", "Plugins", flattenCodeItems(state.codeDocs, "plugin").length);
      createOverviewCard("middleware", "Middlewares", flattenCodeItems(state.codeDocs, "middleware").length);
      overview.appendChild(cards);
      renderProjectCommands(overview);
      panelEl.appendChild(overview);
      renderOutline();
      return;
    }

    if (state.view === "backend-api" || state.view === "frontend-route") {
      const operations = visibleOperations(state.view);

      if (operations.length === 0) {
        renderEmpty("No documented operations found.");
        return;
      }

      renderOperations(operations);
      renderOutline();
      window.requestAnimationFrame(scrollToAnchor);
      return;
    }

    const codeItems = visibleCodeItems(state.view);

    if (codeItems.length === 0) {
      renderEmpty("No Code JSDoc entries found.");
      return;
    }

    for (const section of groupCodeItems(codeItems, state.view)) {
      const sectionEl = document.createElement("section");
      sectionEl.className = "vext-docs-section";
      sectionEl.id = section.id;
      const heading = document.createElement("h2");
      heading.className = "vext-docs-section-heading";
      heading.textContent = section.label;
      sectionEl.appendChild(heading);
      for (const item of section.items) sectionEl.appendChild(createCodeItem(item));
      panelEl.appendChild(sectionEl);
    }
    renderOutline();
    window.requestAnimationFrame(scrollToAnchor);
  };

  const renderEmpty = (message) => {
    const empty = document.createElement("div");
    empty.className = "vext-docs-empty";
    empty.textContent = message;
    panelEl.appendChild(empty);
    renderOutline();
  };

  const config = readConfig();
  if (!config) {
    statusEl.textContent = "Failed to read docs configuration.";
    return;
  }
  state.view = resolveInitialView(config);
  setupSidebarResize();
  setupOutline();
  setupUiControls();

  Promise.all([
    fetch(config.endpoints.openapi, { headers: { Accept: "application/json" } }),
    fetch(config.endpoints.code, { headers: { Accept: "application/json" } }),
  ])
    .then(([specRes, codeRes]) => {
      if (!specRes.ok) throw new Error("OpenAPI HTTP " + specRes.status);
      if (!codeRes.ok) throw new Error("Code docs HTTP " + codeRes.status);
      return Promise.all([specRes.json(), codeRes.json()]);
    })
    .then(([spec, codeDocs]) => {
      state.spec = spec;
      state.codeDocs = codeDocs || { items: [] };
      const initialHash = decodeURIComponent(window.location.hash.replace(/^#/u, ""));
      if (initialHash) {
        state.anchor = initialHash;
        const hashView = viewForAnchor(initialHash);
        if (hashView) {
          state.view = hashView;
          state.searchScope = hashView;
        }
      }
      statusEl.textContent = "OpenAPI source: " + config.specPublicPath;
      renderAuthControls();
      render();
      searchEl.addEventListener("input", () => {
        state.query = searchEl.value;
        render();
      });
    })
    .catch((error) => {
      clear(panelEl);
      statusEl.textContent = "Failed to load documentation.";
      const errorEl = document.createElement("div");
      errorEl.className = "vext-docs-error";
      errorEl.textContent = error && error.message ? error.message : String(error);
      panelEl.appendChild(errorEl);
      renderOutline();
    });
})();
`;

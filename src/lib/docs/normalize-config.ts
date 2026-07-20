import type { VextOpenAPIConfig } from "../../types/app.js";
import {
  DEFAULT_DOCS_ASSETS_PATH,
  DEFAULT_DOCS_PATH,
  DEFAULT_DOCS_RENDERER,
  DEFAULT_OPENAPI_SPEC_PATH,
} from "./config.js";
import type {
  ResolvedVextCodeDocsConfig,
  ResolvedVextDocsAccessConfig,
  ResolvedVextDocsConfig,
  ResolvedVextDocsSource,
  ResolvedVextDocsTryItOutConfig,
  ResolvedVextDocsUiConfig,
  VextCodeDocsSourceConfig,
  VextDocsSourceCodeFilterConfig,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCodeSource(
  value: unknown,
  defaultEnabled: boolean,
): boolean | VextCodeDocsSourceConfig {
  if (typeof value === "boolean") {
    return value;
  }
  if (isRecord(value)) {
    return value as VextCodeDocsSourceConfig;
  }
  return defaultEnabled;
}

function joinAssetPath(base: string, file: string): string {
  return `${base.replace(/\/+$/, "")}/${file.replace(/^\/+/, "")}`;
}

function createEndpointMap(base: string): ResolvedVextDocsConfig["endpoints"] {
  return {
    page: "",
    openapi: joinAssetPath(base, "openapi.json"),
    config: joinAssetPath(base, "config.json"),
    code: joinAssetPath(base, "code.json"),
    search: joinAssetPath(base, "search.json"),
    source: joinAssetPath(base, "source"),
    appJs: joinAssetPath(base, "app.js"),
    styleCss: joinAssetPath(base, "style.css"),
    faviconSvg: joinAssetPath(base, "favicon.svg"),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSourceCodeFilter(
  value: unknown,
): VextDocsSourceCodeFilterConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const code: VextDocsSourceCodeFilterConfig = {};
  const include = normalizeStringArray(value.include);
  const exclude = normalizeStringArray(value.exclude);
  if (include.length > 0) code.include = include;
  if (exclude.length > 0) code.exclude = exclude;
  return code.include || code.exclude ? code : undefined;
}

function normalizeDocsSources(value: unknown): ResolvedVextDocsSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sources: ResolvedVextDocsSource[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string") {
      continue;
    }
    const id = item.id.trim();
    const match = normalizeStringArray(item.match);
    if (!id || seen.has(id) || match.length === 0) {
      continue;
    }
    seen.add(id);

    const source: ResolvedVextDocsSource = {
      id,
      label:
        typeof item.label === "string" && item.label.trim()
          ? item.label.trim()
          : id,
      match,
      default: item.default === true,
    };
    if (typeof item.version === "string" && item.version.trim()) {
      source.version = item.version.trim();
    }
    if (typeof item.description === "string" && item.description.trim()) {
      source.description = item.description.trim();
    }
    if (item.access !== undefined) {
      source.access = item.access as ResolvedVextDocsSource["access"];
    }
    const code = normalizeSourceCodeFilter(item.code);
    if (code) {
      source.code = code;
    }
    sources.push(source);
  }

  if (sources.length > 0 && !sources.some((source) => source.default)) {
    sources[0] = { ...sources[0]!, default: true };
  }
  return sources;
}

export function normalizeDocsConfig(
  openapi: VextOpenAPIConfig = {},
): ResolvedVextDocsConfig {
  const docs = isRecord(openapi.docs) ? openapi.docs : {};
  const code = isRecord(docs.code) ? docs.code : {};

  const specPath = openapi.jsonPath ?? DEFAULT_OPENAPI_SPEC_PATH;
  const specPublicPath = openapi.jsonPublicPath ?? specPath;
  const docsPath = openapi.docs?.path ?? openapi.docsPath ?? DEFAULT_DOCS_PATH;
  const assetsPath = openapi.docs?.assetsPath ?? DEFAULT_DOCS_ASSETS_PATH;
  const assetsPublicPath = openapi.docs?.assetsPublicPath ?? assetsPath;

  const ui: ResolvedVextDocsUiConfig = {
    title: openapi.docs?.ui?.title ?? openapi.title ?? "Vext API Docs",
    tryItOut: openapi.docs?.ui?.tryItOut ?? true,
    defaultView: openapi.docs?.ui?.defaultView ?? "overview",
    theme: openapi.docs?.ui?.theme ?? "system",
    density: openapi.docs?.ui?.density ?? "comfortable",
  };

  const codeConfig: ResolvedVextCodeDocsConfig = {
    enabled: openapi.docs?.code?.enabled ?? "auto",
    services: normalizeCodeSource(code.services, true),
    utils: normalizeCodeSource(code.utils, true),
    models: normalizeCodeSource(code.models, true),
    components: normalizeCodeSource(code.components, true),
    plugins: normalizeCodeSource(code.plugins, true),
    middlewares: normalizeCodeSource(code.middlewares, true),
    locales: normalizeCodeSource(code.locales, false),
    config: normalizeCodeSource(code.config, false),
    preload: normalizeCodeSource(code.preload, false),
    styles: normalizeCodeSource(code.styles, false),
    scan: openapi.docs?.code?.scan ?? "lazy",
  };

  const access: ResolvedVextDocsAccessConfig = {
    mode: openapi.docs?.access?.mode ?? "off",
    openapiJson: openapi.docs?.access?.openapiJson ?? "filtered",
    resolver: openapi.docs?.access?.resolver,
  };
  const tryItOut: ResolvedVextDocsTryItOutConfig = {
    hookScript: openapi.docs?.tryItOut?.hookScript,
    hookGlobal: openapi.docs?.tryItOut?.hookGlobal ?? "VextDocsHooks",
    defaultServer: openapi.docs?.tryItOut?.defaultServer,
    sameOrigin: openapi.docs?.tryItOut?.sameOrigin ?? "auto",
    customServer: openapi.docs?.tryItOut?.customServer ?? true,
    customServerUrl: openapi.docs?.tryItOut?.customServerUrl,
  };
  const renderer = openapi.docs?.renderer;
  if (renderer !== undefined && renderer !== DEFAULT_DOCS_RENDERER) {
    throw new Error(
      '[vextjs] openapi.docs.renderer only supports "vext". Third-party docs renderer objects are no longer supported; external tools can consume /openapi.json.',
    );
  }

  return {
    path: docsPath,
    assetsPath,
    assetsPublicPath,
    specPath,
    specPublicPath,
    renderer: DEFAULT_DOCS_RENDERER,
    ui,
    code: codeConfig,
    access,
    tryItOut,
    sources: normalizeDocsSources(openapi.docs?.sources),
    endpoints: { ...createEndpointMap(assetsPath), page: docsPath },
    publicEndpoints: { ...createEndpointMap(assetsPublicPath), page: docsPath },
  };
}

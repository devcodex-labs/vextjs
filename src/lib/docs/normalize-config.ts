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
  ResolvedVextDocsUiConfig,
  VextCodeDocsSourceConfig,
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

export function normalizeDocsConfig(
  openapi: VextOpenAPIConfig = {},
): ResolvedVextDocsConfig {
  const docs = isRecord(openapi.docs) ? openapi.docs : {};
  const code = isRecord(docs.code) ? docs.code : {};

  const specPath = openapi.jsonPath ?? DEFAULT_OPENAPI_SPEC_PATH;
  const specPublicPath = openapi.jsonPublicPath ?? specPath;
  const docsPath = openapi.docs?.path ?? openapi.docsPath ?? DEFAULT_DOCS_PATH;
  const assetsPath = openapi.docs?.assetsPath ?? DEFAULT_DOCS_ASSETS_PATH;

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
    cacheKey: openapi.docs?.access?.cacheKey,
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
    specPath,
    specPublicPath,
    renderer: DEFAULT_DOCS_RENDERER,
    ui,
    code: codeConfig,
    access,
    endpoints: {
      page: docsPath,
      openapi: joinAssetPath(assetsPath, "openapi.json"),
      config: joinAssetPath(assetsPath, "config.json"),
      code: joinAssetPath(assetsPath, "code.json"),
      search: joinAssetPath(assetsPath, "search.json"),
      source: joinAssetPath(assetsPath, "source"),
      appJs: joinAssetPath(assetsPath, "app.js"),
      styleCss: joinAssetPath(assetsPath, "style.css"),
    },
  };
}

export type VextFrontendFramework = "react" | (string & {});

export type VextFrontendMode = "development" | "production";

export interface VextFrontendPagesConfig {
  dir?: string;
  extensions?: string[];
  document?: string;
  errorDir?: string;
}

export interface VextFrontendSpaFallbackScope {
  basePath: string;
  page: string;
  ssr?: boolean;
  exclude?: string[];
  status?: number;
}

export interface VextFrontendSpaFallbackConfig {
  enabled?: boolean;
  exclude?: string[];
  scopes?: VextFrontendSpaFallbackScope[];
}

export interface VextFrontendJscssConfig {
  enabled?: boolean;
  files?: string[];
  runtimeAdapter?: "css-variables" | "none" | false;
  dynamicVars?: boolean;
  recipes?: boolean;
}

export interface VextFrontendStylesConfig {
  entry?: string;
  jscss?: boolean | VextFrontendJscssConfig;
}

export interface VextFrontendBuildTargetConfig {
  outDir?: string;
  outFile?: string;
  assetsDir?: string;
  target?: string | string[];
  minify?: boolean;
  sourcemap?: boolean;
  splitting?: boolean;
  entryNames?: string;
  chunkNames?: string;
  assetNames?: string;
  manifest?: boolean;
  external?: string[];
}

export interface VextFrontendBuildConfig {
  /**
   * Shared shorthand build flags for client and server frontend compiler paths.
   * Specific sections can override these defaults.
   */
  minify?: boolean;
  sourcemap?: boolean;
  target?: string | string[];
  client?: VextFrontendBuildTargetConfig;
  server?: VextFrontendBuildTargetConfig;
  assets?: {
    inlineLimit?: number;
  };
  css?: {
    modules?: boolean;
  };
  diagnostics?: {
    metafile?: boolean;
    sizeReport?: boolean;
    leakScan?: boolean;
  };
}

export interface VextFrontendDeployConfig {
  assetBaseUrl?: string;
  crossOrigin?: "anonymous" | "use-credentials";
  integrity?: boolean;
}

export interface VextFrontendRenderConfig {
  ssr?: boolean;
  fallback?: "client" | "error";
  timeoutMs?: number;
  layout?: boolean;
}

export interface VextFrontendErrorPagesConfig {
  default?: string;
  status?: Record<string | number, string>;
}

export interface VextFrontendI18nConfig {
  enabled?: boolean;
  source?: string;
  defaultLocale?: "inherit" | string;
  detect?: string[];
  inject?: "used" | "all";
  clientSwitch?: "reload";
  htmlLang?: boolean;
  vary?: boolean;
}

export interface VextFrontendDevConfig {
  hot?: boolean;
  fastRefresh?: boolean;
  transport?: "sse";
  overlay?: boolean;
  debounceMs?: number;
  renderRefresh?: "prompt" | "auto" | "off";
}

export interface VextFrontendApiClientConfig {
  enabled?: boolean;
}

export interface VextFrontendConfig {
  enabled?: boolean;
  framework?: VextFrontendFramework;
  root?: string;
  pages?: VextFrontendPagesConfig;
  componentsDir?: string;
  styles?: VextFrontendStylesConfig;
  assetsDir?: string;
  entry?: string;
  indexHtml?: string;
  outDir?: string;
  publicDir?: string;
  publicPath?: string;
  alias?: Record<string, string>;
  spaFallback?: boolean | VextFrontendSpaFallbackConfig;
  apiClient?: boolean | VextFrontendApiClientConfig;
  build?: VextFrontendBuildConfig;
  deploy?: VextFrontendDeployConfig;
  render?: VextFrontendRenderConfig;
  errorPages?: VextFrontendErrorPagesConfig;
  i18n?: VextFrontendI18nConfig;
  dev?: VextFrontendDevConfig;
  adapter?: VextFrontendAdapter;
}

export type VextFrontendUserConfig = boolean | VextFrontendConfig;

export interface ResolvedVextFrontendSpaFallbackScope {
  basePath: string;
  page: string;
  ssr: boolean;
  exclude: string[];
  status: number;
}

export interface ResolvedVextFrontendConfig {
  enabled: boolean;
  framework: VextFrontendFramework;
  root: string;
  pages: {
    dir: string;
    extensions: string[];
    document: string;
    errorDir: string;
  };
  componentsDir: string;
  styles: {
    entry: string;
    jscss: {
      enabled: boolean;
      files: string[];
      runtimeAdapter: "css-variables" | "none" | false;
      dynamicVars: boolean;
      recipes: boolean;
    };
  };
  assetsDir: string;
  entry: string;
  indexHtml: string;
  outDir: string;
  publicDir: string;
  publicPath: string;
  alias: Record<string, string>;
  spaFallback: {
    enabled: boolean;
    exclude: string[];
    scopes: ResolvedVextFrontendSpaFallbackScope[];
  };
  apiClient: {
    enabled: boolean;
  };
  build: Required<VextFrontendBuildConfig> & {
    target: string[];
    client: Required<Omit<VextFrontendBuildTargetConfig, "outFile">> & {
      target: string[];
      outFile?: string;
    };
    server: Required<Omit<VextFrontendBuildTargetConfig, "outDir">> & {
      target: string[];
      outDir?: string;
    };
    assets: {
      inlineLimit: number;
    };
    css: {
      modules: boolean;
    };
    diagnostics: {
      metafile: boolean;
      sizeReport: boolean;
      leakScan: boolean;
    };
  };
  deploy: {
    assetBaseUrl?: string;
    crossOrigin?: "anonymous" | "use-credentials";
    integrity: boolean;
  };
  render: Required<VextFrontendRenderConfig>;
  errorPages: {
    default: string;
    status: Record<string, string>;
  };
  i18n: Required<VextFrontendI18nConfig>;
  dev: Required<VextFrontendDevConfig>;
  adapter?: VextFrontendAdapter;
}

export interface VextFrontendAdapter {
  name: string;
  framework: VextFrontendFramework;
  resolveBuildOptions?(
    config: ResolvedVextFrontendConfig,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
}

export type VextClientRouteMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface VextClientSchemaReference {
  type: "unknown" | "schema";
  schema?: unknown;
}

export interface VextClientRouteContract {
  method: VextClientRouteMethod;
  path: string;
  operationId: string;
  summary?: string | null;
  tags?: string[];
  input?: {
    params?: VextClientSchemaReference;
    query?: VextClientSchemaReference;
    body?: VextClientSchemaReference;
    headers?: VextClientSchemaReference;
  };
  response?: VextClientSchemaReference;
}

export interface VextClientContract {
  schemaVersion: 1;
  kind: "client-contract";
  source: "routes-manifest";
  generatedAt: string;
  routes: readonly VextClientRouteContract[];
  warnings: string[];
}

export interface VextFrontendManifestAsset {
  path: string;
  bytes: number;
  entry?: boolean;
}

export interface VextFrontendManifest {
  schemaVersion: 1;
  kind: "frontend-manifest";
  generatedAt: string;
  mode: VextFrontendMode;
  publicPath: string;
  indexHtml: string;
  entrypoints: string[];
  assets: VextFrontendManifestAsset[];
}

export interface VextFrontendPageRegistryEntry {
  id: string;
  file: string;
  routePath: string;
}

export interface VextFrontendLayoutRegistryEntry {
  id: string;
  file: string;
  directory: string;
}

export interface VextFrontendErrorPageRegistryEntry {
  id: string;
  file: string;
  status?: number;
}

export interface VextFrontendLocaleRegistryEntry {
  locale: string;
  file: string;
}

export interface VextFrontendRenderManifest {
  schemaVersion: 1;
  kind: "frontend-render-manifest";
  buildId: string;
  generatedAt: string;
  mode: VextFrontendMode;
  framework: VextFrontendFramework;
  root: string;
  publicPath: string;
  assetBaseUrl?: string;
  indexHtml: string;
  browserManifest: string;
  serverRenderer: string;
  pages: VextFrontendPageRegistryEntry[];
  layouts: VextFrontendLayoutRegistryEntry[];
  errorPages: VextFrontendErrorPageRegistryEntry[];
  i18n: {
    enabled: boolean;
    defaultLocale: string;
    locales: VextFrontendLocaleRegistryEntry[];
  };
  diagnostics: {
    metafile: boolean;
    sizeReport: boolean;
    leakScan: boolean;
  };
}

export interface VextFrontendMessagesManifest {
  schemaVersion: 1;
  kind: "frontend-messages-manifest";
  buildId: string;
  generatedAt: string;
  defaultLocale: string;
  locales: VextFrontendLocaleRegistryEntry[];
}

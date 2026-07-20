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
  assetsDir?: string;
  target?: string | string[];
  minify?: boolean;
  sourcemap?: boolean;
  splitting?: boolean;
  entryNames?: string;
  chunkNames?: string;
  assetNames?: string;
  external?: string[];
  externalRuntime?: Record<string, string | VextFrontendExternalRuntimeEntry>;
}

export interface VextFrontendServerBuildTargetConfig {
  outFile?: string;
  target?: string | string[];
  minify?: boolean;
  sourcemap?: boolean;
  external?: string[];
}

export interface VextFrontendExternalRuntimeEntry {
  url: string;
  integrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";
}

export interface VextFrontendVendorChunksConfig {
  enabled?: boolean;
  packages?: string[];
  entryName?: string;
}

export interface VextFrontendBuildBudgetsConfig {
  maxAssetBytes?: number;
  maxInitialJsBytes?: number;
  maxInitialJsGzipBytes?: number;
  maxInitialJsBrotliBytes?: number;
  maxRouteInitialJsBrotliBytes?: number;
  maxAppOwnedInitialJsBrotliBytes?: number;
  maxTotalBytes?: number;
  warnOnly?: boolean;
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
  server?: VextFrontendServerBuildTargetConfig;
  vendorChunks?: boolean | VextFrontendVendorChunksConfig;
  budgets?: VextFrontendBuildBudgetsConfig;
  assets?: {
    inlineLimit?: number;
  };
  css?: {
    modules?: boolean;
  };
  diagnostics?: {
    metafile?: boolean;
    sizeReport?: boolean;
    performanceReport?: boolean;
    leakScan?: boolean;
  };
}

export interface VextFrontendDeployConfig {
  assetBaseUrl?: string;
  crossOrigin?: "anonymous" | "use-credentials";
  integrity?: boolean;
  upload?: boolean | VextFrontendDeployUploadConfig;
}

export type VextFrontendDeployUploadAdapterName =
  | "filesystem"
  | "mock"
  | (string & {});

export interface VextFrontendDeployUploadAdapter {
  name: string;
  upload(
    input: VextFrontendDeployUploadAdapterInput,
  ): Promise<VextFrontendDeployUploadAdapterResult>;
}

export interface VextFrontendDeployUploadAdapterInput {
  asset: VextFrontendDeployManifestAsset;
  sourcePath: string;
  uploadKey: string;
  dryRun: boolean;
}

export interface VextFrontendDeployUploadAdapterResult {
  uploaded: boolean;
  url?: string;
  etag?: string;
}

export interface VextFrontendDeployUploadConfig {
  enabled?: boolean;
  adapter?:
    | VextFrontendDeployUploadAdapterName
    | VextFrontendDeployUploadAdapter;
  targetDir?: string;
  publicBaseUrl?: string;
  prefix?: string;
  stateFile?: string;
  dryRun?: boolean;
  concurrency?: number;
  include?: string[];
  exclude?: string[];
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

export type VextFrontendI18nClientLoad = "current" | "all";

export interface VextFrontendI18nConfig {
  enabled?: boolean;
  source?: string;
  defaultLocale?: "inherit" | string;
  detect?: string[];
  inject?: "used" | "all";
  clientLoad?: VextFrontendI18nClientLoad;
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
  build: Omit<
    Required<VextFrontendBuildConfig>,
    | "target"
    | "client"
    | "server"
    | "vendorChunks"
    | "budgets"
    | "assets"
    | "css"
    | "diagnostics"
  > & {
    target: string[];
    client: Required<
      Omit<VextFrontendBuildTargetConfig, "target" | "externalRuntime">
    > & {
      outDir: string;
      target: string[];
      externalRuntime: Record<string, VextFrontendExternalRuntimeEntry>;
    };
    server: Required<Omit<VextFrontendServerBuildTargetConfig, "target">> & {
      target: string[];
    };
    vendorChunks: Required<VextFrontendVendorChunksConfig>;
    budgets: Required<VextFrontendBuildBudgetsConfig>;
    assets: {
      inlineLimit: number;
    };
    css: {
      modules: boolean;
    };
    diagnostics: {
      metafile: boolean;
      sizeReport: boolean;
      performanceReport: boolean;
      leakScan: boolean;
    };
  };
  deploy: {
    assetBaseUrl?: string;
    crossOrigin?: "anonymous" | "use-credentials";
    integrity: boolean;
    upload: {
      enabled: boolean;
      adapter:
        | VextFrontendDeployUploadAdapterName
        | VextFrontendDeployUploadAdapter;
      targetDir?: string;
      publicBaseUrl?: string;
      prefix: string;
      stateFile: string;
      dryRun: boolean;
      concurrency: number;
      include: string[];
      exclude: string[];
    };
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
  entryPoint?: string;
  source?: "bundle" | "public" | "external";
  sha256?: string;
  integrity?: string;
  contentType?: string;
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

export interface VextFrontendDeployManifestAsset {
  file: string;
  path: string;
  uploadKey: string;
  bytes: number;
  sha256: string;
  integrity: string;
  contentType: string;
  source: "bundle" | "public";
  entry?: boolean;
  immutable: boolean;
}

export interface VextFrontendDeployManifest {
  schemaVersion: 1;
  kind: "frontend-deploy-manifest";
  generatedAt: string;
  mode: VextFrontendMode;
  outDir: string;
  publicPath: string;
  assetBaseUrl?: string;
  upload: {
    enabled: boolean;
    adapter: string;
    prefix: string;
    publicBaseUrl?: string;
    stateFile: string;
    dryRun: boolean;
  };
  assets: VextFrontendDeployManifestAsset[];
}

export interface VextFrontendDeployPlanItem {
  asset: VextFrontendDeployManifestAsset;
  sourcePath: string;
  status: "upload" | "skip";
  reason: "missing-state" | "hash-changed" | "unchanged";
  previousSha256?: string;
}

export interface VextFrontendDeployPlan {
  manifestPath: string;
  outDir: string;
  items: VextFrontendDeployPlanItem[];
  summary: {
    total: number;
    upload: number;
    skip: number;
    bytes: number;
    uploadBytes: number;
  };
}

export interface VextFrontendDeployResult {
  manifestPath: string;
  stateFile: string;
  dryRun: boolean;
  uploaded: number;
  skipped: number;
  bytesUploaded: number;
  assets: Array<{
    file: string;
    uploadKey: string;
    status: "uploaded" | "skipped" | "planned";
    url?: string;
  }>;
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

export type VextFrontendAssetGroup =
  | "entry"
  | "shared"
  | "page"
  | "layout"
  | "locale"
  | "style"
  | "asset"
  | "external";

export interface VextFrontendSizeMetric {
  path: string;
  bytes: number;
  gzipBytes: number;
  brotliBytes: number;
  source: "bundle" | "public" | "external";
  group: VextFrontendAssetGroup;
  entry?: boolean;
  entryPoint?: string;
}

export interface VextFrontendRouteInitialAssets {
  page: string;
  routePath: string;
  layouts: string[];
  locale?: string;
  scripts: string[];
  styles: string[];
  assets: string[];
  externalScripts: string[];
  initialJsBytes?: number;
  initialJsGzipBytes?: number;
  initialJsBrotliBytes?: number;
  appOwnedInitialJsBrotliBytes?: number;
}

export interface VextFrontendRouteAssetsManifest {
  schemaVersion: 1;
  routes: VextFrontendRouteInitialAssets[];
}

export interface VextFrontendSizeReport {
  schemaVersion: 1;
  kind: "frontend-size-report";
  generatedAt: string;
  totalBytes: number;
  totalGzipBytes: number;
  totalBrotliBytes: number;
  initialJsBytes: number;
  initialJsGzipBytes: number;
  initialJsBrotliBytes: number;
  appOwnedInitialJsBrotliBytes: number;
  assets: VextFrontendSizeMetric[];
  routes?: VextFrontendRouteInitialAssets[];
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
    performanceReport: boolean;
    leakScan: boolean;
  };
  routeAssets?: VextFrontendRouteAssetsManifest;
}

export interface VextFrontendMessagesManifest {
  schemaVersion: 1;
  kind: "frontend-messages-manifest";
  buildId: string;
  generatedAt: string;
  defaultLocale: string;
  locales: VextFrontendLocaleRegistryEntry[];
}

export type VextDocsRendererName = "vext";

export type VextDocsDefaultView = "overview" | "api" | "code";

export type VextDocsTheme = "system" | "light" | "dark";

export type VextDocsDensity = "comfortable" | "compact";

export type VextDocsCodeScanMode = "lazy" | "background";

export type VextDocsAccessMode = "off" | "visibility-only" | "enforce";

export type VextDocsSourceKind =
  | "openapi"
  | "service"
  | "utils"
  | "model"
  | "component"
  | "plugin"
  | "middleware"
  | "locale"
  | "config"
  | "preload"
  | "style";

export interface VextDocsEndpointMap {
  page: string;
  openapi: string;
  config: string;
  code: string;
  search: string;
  source: string;
  appJs: string;
  styleCss: string;
}

export interface VextDocsRequestContext {
  method?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  viewer?: unknown;
}

export interface VextDocsOpenAPIDocument {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, unknown>;
  tags?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface VextCodeDocParam {
  name: string;
  type?: string;
  description?: string;
  optional?: boolean;
}

export interface VextCodeDocSourceLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface VextModelFieldDoc {
  name: string;
  required?: boolean;
  type?: string;
  description?: string;
  enum?: string[];
  raw?: string;
}

export interface VextModelEnumDoc {
  name: string;
  values: string[];
}

export interface VextModelOptionDoc {
  name: string;
  value: string;
}

export interface VextModelIndexDoc {
  keys: string;
  unique?: boolean;
  options?: string;
}

export interface VextModelHookDoc {
  operation: string;
  phases: string[];
}

export interface VextModelDetails {
  registryKey: string;
  name?: string;
  collection?: string;
  connection?: Record<string, string>;
  depth?: number;
  fields?: VextModelFieldDoc[];
  enums?: VextModelEnumDoc[];
  options?: VextModelOptionDoc[];
  indexes?: VextModelIndexDoc[];
  methods?: {
    instance?: string[];
    static?: string[];
  };
  hooks?: VextModelHookDoc[];
  usage?: string;
  parseStatus?: "complete" | "partial" | "unavailable";
  parseNote?: string;
}

export interface VextPluginDetails {
  name?: string;
  dependencies?: string[];
  after?: string[];
  lifecycle?: {
    setup?: boolean;
    onReady?: boolean;
    onClose?: boolean;
  };
  extensions?: string[];
  globalMiddlewares?: boolean;
}

export interface VextMiddlewareDetails {
  name?: string;
  type?: "middleware" | "factory" | "unknown";
  defaultOptions?: string;
  usage?: string;
}

export interface VextCodeDocItem {
  id: string;
  kind: VextDocsSourceKind;
  title: string;
  sourceFile?: string;
  sourceLocation?: VextCodeDocSourceLocation;
  exportName?: string;
  summary?: string;
  description?: string;
  params?: VextCodeDocParam[];
  returns?: { type?: string; description?: string };
  throws?: Array<{ type?: string; description?: string }>;
  examples?: string[];
  deprecated?: boolean | string;
  tags?: string[];
  model?: VextModelDetails;
  plugin?: VextPluginDetails;
  middleware?: VextMiddlewareDetails;
}

export interface VextCodeDocsDocument {
  items: VextCodeDocItem[];
  generatedAt?: string;
}

export interface VextDocsMenuItem {
  id: string;
  title: string;
  kind: VextDocsSourceKind | "group";
  source?: VextDocsSourceKind;
  children?: VextDocsMenuItem[];
  descriptor?: VextDocsAccessDescriptor;
}

export interface VextDocsMenu {
  items: VextDocsMenuItem[];
}

export interface ResolvedVextDocsUiConfig {
  title: string;
  tryItOut: boolean;
  defaultView: VextDocsDefaultView;
  theme: VextDocsTheme;
  density: VextDocsDensity;
}

export interface ResolvedVextCodeDocsConfig {
  enabled: boolean | "auto";
  services: boolean | VextCodeDocsSourceConfig;
  utils: boolean | VextCodeDocsSourceConfig;
  models: boolean | VextCodeDocsSourceConfig;
  components: boolean | VextCodeDocsSourceConfig;
  plugins: boolean | VextCodeDocsSourceConfig;
  middlewares: boolean | VextCodeDocsSourceConfig;
  locales: boolean | VextCodeDocsSourceConfig;
  config: boolean | VextCodeDocsSourceConfig;
  preload: boolean | VextCodeDocsSourceConfig;
  styles: boolean | VextCodeDocsSourceConfig;
  scan: VextDocsCodeScanMode;
}

export interface ResolvedVextDocsAccessConfig {
  mode: VextDocsAccessMode;
  openapiJson: "filtered" | "public";
  resolver?: VextDocsAccessResolver;
  cacheKey?: VextDocsAccessCacheKeyResolver | string;
}

export type VextDocsProjectScriptGroup =
  | "development"
  | "production"
  | "verification";

export interface VextDocsProjectScript {
  name: string;
  command: string;
  value: string;
  group: VextDocsProjectScriptGroup;
}

export interface VextDocsProjectInfo {
  name?: string;
  version?: string;
  type?: string;
  scripts: VextDocsProjectScript[];
}

export interface ResolvedVextDocsConfig {
  path: string;
  assetsPath: string;
  specPath: string;
  specPublicPath: string;
  renderer: VextDocsRendererName;
  ui: ResolvedVextDocsUiConfig;
  code: ResolvedVextCodeDocsConfig;
  access: ResolvedVextDocsAccessConfig;
  endpoints: VextDocsEndpointMap;
  project?: VextDocsProjectInfo;
}

export interface VextCodeDocsSourceConfig {
  enabled?: boolean;
  dir?: string;
  include?: string[];
  exclude?: string[];
  title?: string;
}

export interface VextDocsUiConfig {
  title?: string;
  tryItOut?: boolean;
  defaultView?: VextDocsDefaultView;
  theme?: VextDocsTheme;
  density?: VextDocsDensity;
}

export interface VextDocsConfig {
  path?: string;
  assetsPath?: string;
  renderer?: VextDocsRendererName;
  ui?: VextDocsUiConfig;
  code?: {
    enabled?: boolean | "auto";
    services?: boolean | VextCodeDocsSourceConfig;
    utils?: boolean | VextCodeDocsSourceConfig;
    models?: boolean | VextCodeDocsSourceConfig;
    components?: boolean | VextCodeDocsSourceConfig;
    plugins?: boolean | VextCodeDocsSourceConfig;
    middlewares?: boolean | VextCodeDocsSourceConfig;
    locales?: boolean | VextCodeDocsSourceConfig;
    config?: boolean | VextCodeDocsSourceConfig;
    preload?: boolean | VextCodeDocsSourceConfig;
    styles?: boolean | VextCodeDocsSourceConfig;
    scan?: VextDocsCodeScanMode;
  };
  access?: VextDocsAccessConfig;
}

export type VextDocsAccessDescriptor =
  | {
      kind: "operation";
      id: string;
      method: string;
      path: string;
      tags?: string[];
      operationId?: string;
    }
  | {
      kind: "service";
      id: string;
      serviceKey: string;
      member?: string;
    }
  | {
      kind: "utils";
      id: string;
      file: string;
      exportName: string;
    }
  | {
      kind: "model";
      id: string;
      modelKey: string;
    }
  | {
      kind: "component";
      id: string;
      file: string;
      exportName: string;
    }
  | {
      kind: "plugin";
      id: string;
      pluginName: string;
      file?: string;
    }
  | {
      kind: "middleware";
      id: string;
      middlewareName: string;
      file?: string;
      middlewareType?: "middleware" | "factory" | "unknown";
    }
  | {
      kind: "locale" | "config" | "preload" | "style";
      id: string;
      file?: string;
      title: string;
    }
  | {
      kind: "group";
      id: string;
      title: string;
      source: "openapi" | "code";
    };

export interface VextDocsAccessContext {
  descriptor: VextDocsAccessDescriptor;
  request?: VextDocsRequestContext;
  viewer?: unknown;
}

export type VextDocsAccessResult =
  | boolean
  | {
      visible?: boolean;
      tryItOut?: boolean;
    };

export type VextDocsAccessResolver = (
  context: VextDocsAccessContext,
) => VextDocsAccessResult | Promise<VextDocsAccessResult>;

export type VextDocsAccessCacheKeyResolver = (
  context: Pick<VextDocsAccessContext, "request" | "viewer">,
) => string | undefined;

export interface VextDocsAccessConfig {
  mode?: VextDocsAccessMode;
  resolver?: VextDocsAccessResolver;
  cacheKey?: VextDocsAccessCacheKeyResolver | string;
  openapiJson?: "filtered" | "public";
}

export interface VextRouteDocsAccessConfig {
  roles?: string[];
  permissions?: string[];
  visible?: boolean;
  tryItOut?: boolean;
  group?: string;
}

/** @deprecated openapi.scalar is ignored by Vext Docs and only triggers a migration warning. */
export interface VextScalarConfig {
  [key: string]: unknown;
}

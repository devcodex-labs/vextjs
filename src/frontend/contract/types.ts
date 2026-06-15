export type VextFrontendFramework = "react" | (string & {});

export type VextFrontendMode = "development" | "production";

export interface VextFrontendSpaFallbackConfig {
  enabled?: boolean;
  exclude?: string[];
}

export interface VextFrontendBuildConfig {
  minify?: boolean;
  sourcemap?: boolean;
  target?: string | string[];
}

export interface VextFrontendApiClientConfig {
  enabled?: boolean;
}

export interface VextFrontendConfig {
  enabled?: boolean;
  framework?: VextFrontendFramework;
  root?: string;
  entry?: string;
  indexHtml?: string;
  outDir?: string;
  publicDir?: string;
  publicPath?: string;
  spaFallback?: boolean | VextFrontendSpaFallbackConfig;
  apiClient?: boolean | VextFrontendApiClientConfig;
  build?: VextFrontendBuildConfig;
  adapter?: VextFrontendAdapter;
}

export type VextFrontendUserConfig = boolean | VextFrontendConfig;

export interface ResolvedVextFrontendConfig {
  enabled: boolean;
  framework: VextFrontendFramework;
  root: string;
  entry: string;
  indexHtml: string;
  outDir: string;
  publicDir: string;
  publicPath: string;
  spaFallback: {
    enabled: boolean;
    exclude: string[];
  };
  apiClient: {
    enabled: boolean;
  };
  build: Required<VextFrontendBuildConfig> & {
    target: string[];
  };
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

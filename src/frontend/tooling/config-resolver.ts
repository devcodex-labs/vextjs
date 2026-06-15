import path from "node:path";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendSpaFallbackConfig,
  VextFrontendMode,
  VextFrontendUserConfig,
} from "../contract/types.js";

export interface ResolveFrontendConfigOptions {
  rootDir: string;
  mode: VextFrontendMode;
}

const DEFAULT_FALLBACK_EXCLUDE = ["/api/**", "/openapi.json", "/docs/**"];

export function resolveFrontendConfig(
  input: VextFrontendUserConfig | undefined,
  options: ResolveFrontendConfigOptions,
): ResolvedVextFrontendConfig {
  const raw =
    input === true ? { enabled: true } : input === false ? { enabled: false } : input;
  const enabled = raw?.enabled ?? false;
  const root = resolveProjectPath(
    options.rootDir,
    raw?.root ?? "src/client",
    "config.frontend.root",
  );
  const outDir = resolveProjectPath(
    options.rootDir,
    raw?.outDir ??
      (options.mode === "development" ? ".vext/client" : "dist/client"),
    "config.frontend.outDir",
  );
  const publicDir = resolveProjectPath(
    options.rootDir,
    raw?.publicDir ?? "public",
    "config.frontend.publicDir",
  );
  const entry = resolveProjectPath(
    options.rootDir,
    raw?.entry ?? path.join("src", "client", "main.tsx"),
    "config.frontend.entry",
  );
  const indexHtml = resolveProjectPath(
    options.rootDir,
    raw?.indexHtml ?? path.join("src", "client", "index.html"),
    "config.frontend.indexHtml",
  );
  const spaFallback = normalizeSpaFallback(raw?.spaFallback);
  const apiClient = raw?.apiClient;
  const build = raw?.build ?? {};
  const target = build.target
    ? Array.isArray(build.target)
      ? build.target
      : [build.target]
    : ["es2022"];

  return {
    enabled,
    framework: raw?.framework ?? "react",
    root,
    entry,
    indexHtml,
    outDir,
    publicDir,
    publicPath: normalizePublicPath(raw?.publicPath ?? "/"),
    spaFallback,
    apiClient: {
      enabled:
        typeof apiClient === "boolean" ? apiClient : apiClient?.enabled ?? true,
    },
    build: {
      minify: build.minify ?? options.mode === "production",
      sourcemap: build.sourcemap ?? options.mode === "development",
      target,
    },
    adapter: raw?.adapter,
  };
}

function normalizeSpaFallback(
  input: VextFrontendSpaFallbackConfig | boolean | undefined,
): ResolvedVextFrontendConfig["spaFallback"] {
  if (input === false) {
    return { enabled: false, exclude: DEFAULT_FALLBACK_EXCLUDE };
  }
  if (input === true || input === undefined) {
    return { enabled: true, exclude: DEFAULT_FALLBACK_EXCLUDE };
  }
  return {
    enabled: input.enabled ?? true,
    exclude: input.exclude ?? DEFAULT_FALLBACK_EXCLUDE,
  };
}

function normalizePublicPath(value: string): string {
  if (/^[a-z]+:\/\//i.test(value)) {
    throw new Error("[vextjs] config.frontend.publicPath must be a path, not a URL.");
  }
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  const collapsed = withLeading.replace(/\/+/g, "/");
  return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
}

function resolveProjectPath(rootDir: string, value: string, label: string): string {
  const resolved = path.resolve(rootDir, value);
  const relative = path.relative(rootDir, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`[vextjs] ${label} must resolve inside the project root.`);
  }
  return resolved;
}

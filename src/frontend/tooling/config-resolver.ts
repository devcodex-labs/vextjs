import path from "node:path";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendSpaFallbackConfig,
  VextFrontendSpaFallbackScope,
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
    input === true
      ? { enabled: true }
      : input === false
        ? { enabled: false }
        : input;
  const enabled = raw?.enabled ?? false;
  const root = resolveProjectPath(
    options.rootDir,
    raw?.root ?? "src/frontend",
    "config.frontend.root",
  );
  const pages = raw?.pages ?? {};
  const pagesDir = resolveFrontendPath(
    options.rootDir,
    root,
    pages.dir ?? "pages",
    "config.frontend.pages.dir",
  );
  const pageExtensions = pages.extensions ?? [".tsx", ".jsx", ".ts", ".js"];
  const componentsDir = resolveFrontendPath(
    options.rootDir,
    root,
    raw?.componentsDir ?? "components",
    "config.frontend.componentsDir",
  );
  const styles = raw?.styles ?? {};
  const stylesEntry = resolveFrontendPath(
    options.rootDir,
    root,
    styles.entry ?? path.join("styles", "index.css"),
    "config.frontend.styles.entry",
  );
  const jscss =
    typeof styles.jscss === "boolean"
      ? { enabled: styles.jscss }
      : (styles.jscss ?? {});
  const assetsDir = resolveFrontendPath(
    options.rootDir,
    root,
    raw?.assetsDir ?? "assets",
    "config.frontend.assetsDir",
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
    raw?.entry ??
      path.join(".vext", "generated", "frontend", "browser-entry.tsx"),
    "config.frontend.entry",
  );
  const indexHtml = resolveProjectPath(
    options.rootDir,
    raw?.indexHtml ?? path.join("src", "frontend", "pages", "_document.html"),
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
  const clientBuild = build.client ?? {};
  const clientTarget = normalizeTarget(clientBuild.target, "es2022");
  const serverBuild = build.server ?? {};
  const serverTarget = normalizeTarget(serverBuild.target, "node20");

  return {
    enabled,
    framework: raw?.framework ?? "react",
    root,
    pages: {
      dir: pagesDir,
      extensions: pageExtensions,
      document: resolveFrontendPath(
        options.rootDir,
        root,
        pages.document ?? path.join("pages", "_document.html"),
        "config.frontend.pages.document",
      ),
      errorDir: resolveFrontendPath(
        options.rootDir,
        root,
        pages.errorDir ?? path.join("pages", "error"),
        "config.frontend.pages.errorDir",
      ),
    },
    componentsDir,
    styles: {
      entry: stylesEntry,
      jscss: {
        enabled: jscss.enabled ?? true,
        files: jscss.files ?? ["**/*.style.ts", "**/*.style.js", "**/*.css.ts"],
        runtimeAdapter: jscss.runtimeAdapter ?? "css-variables",
        dynamicVars: jscss.dynamicVars ?? true,
        recipes: jscss.recipes ?? true,
      },
    },
    assetsDir,
    entry,
    indexHtml,
    outDir,
    publicDir,
    publicPath: normalizePublicPath(raw?.publicPath ?? "/"),
    alias: resolveAlias(options.rootDir, root, raw?.alias),
    spaFallback,
    apiClient: {
      enabled:
        typeof apiClient === "boolean"
          ? apiClient
          : (apiClient?.enabled ?? true),
    },
    build: {
      minify: build.minify ?? options.mode === "production",
      sourcemap: build.sourcemap ?? options.mode === "development",
      target,
      client: {
        outDir,
        outFile: clientBuild.outFile,
        assetsDir: clientBuild.assetsDir ?? "assets",
        target: clientTarget,
        minify:
          clientBuild.minify ?? build.minify ?? options.mode === "production",
        sourcemap:
          clientBuild.sourcemap ??
          build.sourcemap ??
          options.mode === "development",
        splitting: clientBuild.splitting ?? true,
        entryNames: clientBuild.entryNames ?? "[name]-[hash]",
        chunkNames: clientBuild.chunkNames ?? "[name]-[hash]",
        assetNames: clientBuild.assetNames ?? "[name]-[hash]",
        manifest: clientBuild.manifest ?? true,
        external: clientBuild.external ?? [],
      },
      server: {
        outFile:
          serverBuild.outFile ?? path.join(outDir, "server", "renderer.cjs"),
        outDir: serverBuild.outDir,
        assetsDir: serverBuild.assetsDir ?? "assets",
        target: serverTarget,
        minify: serverBuild.minify ?? false,
        sourcemap: serverBuild.sourcemap ?? options.mode === "development",
        splitting: serverBuild.splitting ?? false,
        entryNames: serverBuild.entryNames ?? "[name]",
        chunkNames: serverBuild.chunkNames ?? "[name]",
        assetNames: serverBuild.assetNames ?? "[name]",
        manifest: serverBuild.manifest ?? true,
        external: serverBuild.external ?? [],
      },
      assets: {
        inlineLimit: build.assets?.inlineLimit ?? 0,
      },
      css: {
        modules: build.css?.modules ?? true,
      },
      diagnostics: {
        metafile: build.diagnostics?.metafile ?? true,
        sizeReport: build.diagnostics?.sizeReport ?? true,
        leakScan: build.diagnostics?.leakScan ?? true,
      },
    },
    deploy: {
      assetBaseUrl: normalizeAssetBaseUrl(raw?.deploy?.assetBaseUrl),
      crossOrigin: raw?.deploy?.crossOrigin,
      integrity: raw?.deploy?.integrity ?? false,
    },
    render: {
      ssr: raw?.render?.ssr ?? true,
      fallback: raw?.render?.fallback ?? "client",
      timeoutMs: raw?.render?.timeoutMs ?? 3000,
      layout: raw?.render?.layout ?? true,
    },
    errorPages: {
      default: raw?.errorPages?.default ?? "error/default",
      status: normalizeErrorPages(raw?.errorPages?.status),
    },
    i18n: {
      enabled: raw?.i18n?.enabled ?? false,
      source: resolveFrontendPath(
        options.rootDir,
        root,
        raw?.i18n?.source ?? "locales",
        "config.frontend.i18n.source",
      ),
      defaultLocale: raw?.i18n?.defaultLocale ?? "inherit",
      detect: raw?.i18n?.detect ?? ["accept-language"],
      inject: raw?.i18n?.inject ?? "used",
      clientSwitch: raw?.i18n?.clientSwitch ?? "reload",
      htmlLang: raw?.i18n?.htmlLang ?? true,
      vary: raw?.i18n?.vary ?? true,
    },
    dev: {
      hot: raw?.dev?.hot ?? true,
      fastRefresh: raw?.dev?.fastRefresh ?? true,
      transport: raw?.dev?.transport ?? "sse",
      overlay: raw?.dev?.overlay ?? true,
      debounceMs: raw?.dev?.debounceMs ?? 50,
      renderRefresh: raw?.dev?.renderRefresh ?? "prompt",
    },
    adapter: raw?.adapter,
  };
}

function normalizeTarget(
  value: string | string[] | undefined,
  fallback: string,
): string[] {
  if (!value) return [fallback];
  return Array.isArray(value) ? value : [value];
}

function normalizeSpaFallback(
  input: VextFrontendSpaFallbackConfig | boolean | undefined,
): ResolvedVextFrontendConfig["spaFallback"] {
  if (input === false) {
    return { enabled: false, exclude: DEFAULT_FALLBACK_EXCLUDE, scopes: [] };
  }
  if (input === undefined) {
    return { enabled: true, exclude: DEFAULT_FALLBACK_EXCLUDE, scopes: [] };
  }
  if (input === true) {
    return {
      enabled: true,
      exclude: DEFAULT_FALLBACK_EXCLUDE,
      scopes: [
        {
          basePath: "/",
          page: "index",
          ssr: false,
          exclude: [],
          status: 200,
        },
      ],
    };
  }
  return {
    enabled: input.enabled ?? true,
    exclude: input.exclude ?? DEFAULT_FALLBACK_EXCLUDE,
    scopes: (input.scopes ?? []).map(normalizeSpaFallbackScope),
  };
}

function normalizeSpaFallbackScope(
  scope: VextFrontendSpaFallbackScope,
): ResolvedVextFrontendConfig["spaFallback"]["scopes"][number] {
  return {
    basePath: normalizeUrlPath(
      scope.basePath,
      "config.frontend.spaFallback.scopes[].basePath",
    ),
    page: scope.page,
    ssr: scope.ssr ?? false,
    exclude: scope.exclude ?? [],
    status: scope.status ?? 200,
  };
}

function normalizePublicPath(value: string): string {
  if (/^[a-z]+:\/\//i.test(value)) {
    throw new Error(
      "[vextjs] config.frontend.publicPath must be a path, not a URL.",
    );
  }
  return normalizeUrlPath(value, "config.frontend.publicPath");
}

function normalizeUrlPath(value: string, label: string): string {
  if (/^[a-z]+:\/\//i.test(value)) {
    throw new Error(`[vextjs] ${label} must be a path, not a URL.`);
  }
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  const collapsed = withLeading.replace(/\/+/g, "/");
  return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
}

function normalizeAssetBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[a-z]+:\/\//i.test(value)) {
    throw new Error(
      "[vextjs] config.frontend.deploy.assetBaseUrl must be an absolute URL.",
    );
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeErrorPages(
  value: Record<string | number, string> | undefined,
): Record<string, string> {
  if (!value) {
    return {
      "404": "error/404",
      "500": "error/500",
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([status, page]) => [String(status), page]),
  );
}

function resolveAlias(
  rootDir: string,
  frontendRoot: string,
  alias: Record<string, string> | undefined,
): Record<string, string> {
  const defaults: Record<string, string> = {
    "@frontend": ".",
    "@pages": "pages",
    "@components": "components",
    "@styles": "styles",
    "@assets": "assets",
  };
  return Object.fromEntries(
    Object.entries({ ...defaults, ...(alias ?? {}) }).map(([key, value]) => [
      key,
      resolveFrontendPath(
        rootDir,
        frontendRoot,
        value,
        `config.frontend.alias.${key}`,
      ),
    ]),
  );
}

function resolveFrontendPath(
  rootDir: string,
  frontendRoot: string,
  value: string,
  label: string,
): string {
  const resolved = path.isAbsolute(value)
    ? value
    : path.resolve(frontendRoot, value);
  ensureInsideProject(rootDir, resolved, label);
  return resolved;
}

function resolveProjectPath(
  rootDir: string,
  value: string,
  label: string,
): string {
  const resolved = path.resolve(rootDir, value);
  ensureInsideProject(rootDir, resolved, label);
  return resolved;
}

function ensureInsideProject(
  rootDir: string,
  resolved: string,
  label: string,
): void {
  const relative = path.relative(rootDir, resolved);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`[vextjs] ${label} must resolve inside the project root.`);
  }
}

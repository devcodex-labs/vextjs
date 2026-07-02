import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { VextApp } from "../../types/app.js";
import type { DocEndpointsConfig } from "../openapi/types.js";
import {
  createDocsSearchIndex,
  filterCodeDocsForDocs,
  filterOpenAPIDocumentForDocs,
} from "./access/filter.js";
import { normalizeDocsConfig } from "./normalize-config.js";
import { renderVextDocsHTML } from "./renderers/vext-html.js";
import {
  VEXT_DOCS_APP_JS,
  VEXT_DOCS_STYLE_CSS,
} from "./renderers/vext-assets.js";
import {
  createCodeDocsProvider,
  type CodeDocsProvider,
} from "./sources/code-jsdoc-source.js";
import type {
  ResolvedVextDocsConfig,
  VextDocsProjectInfo,
  VextDocsProjectScriptGroup,
  VextDocsOpenAPIDocument,
  VextDocsRequestContext,
} from "./types.js";

export type OpenAPISpecProvider = object | (() => object | Promise<object>);

export function registerDocsEndpoints(
  app: VextApp,
  spec: OpenAPISpecProvider,
  config: DocEndpointsConfig,
): void {
  const normalizedDocsConfig = normalizeDocsConfig({
    title: config.title,
    docsPath: config.docsPath,
    jsonPath: config.specPath,
    jsonPublicPath: config.specPublicPath,
    docs: config.docs,
  });
  const project = readDocsProjectInfo(config.rootDir);
  const docsConfig: ResolvedVextDocsConfig = project
    ? { ...normalizedDocsConfig, project }
    : normalizedDocsConfig;
  const codeDocsProvider = createCodeDocsProvider({
    rootDir: config.rootDir,
    srcDir: config.srcDir,
    modelsDir: config.modelsDir,
    config: docsConfig,
  });
  warnScalarMigration(app, config);

  registerOpenAPIJsonEndpoint(app, spec, docsConfig);
  registerDocsDataEndpoints(app, spec, codeDocsProvider, docsConfig, config);
  registerVextDocsAssets(app, docsConfig);
  registerDocsPage(app, docsConfig);

  app.logger.info(`[openapi] spec:     ${docsConfig.specPath}`);
  app.logger.info(
    `[openapi] docs:     ${docsConfig.path} (${docsConfig.renderer} docs renderer)`,
  );
}

function registerOpenAPIJsonEndpoint(
  app: VextApp,
  spec: OpenAPISpecProvider,
  config: ResolvedVextDocsConfig,
): void {
  app.adapter.registerRoute("GET", config.specPath, [
    async (req, res) => {
      const resolvedSpec = await resolveOpenAPISpecForEndpoint(
        spec,
        config,
        toDocsRequestContext(req),
        config.access.openapiJson === "public",
      );
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.rawJson(resolvedSpec);
    },
  ]);
}

function registerDocsDataEndpoints(
  app: VextApp,
  spec: OpenAPISpecProvider,
  codeDocsProvider: CodeDocsProvider,
  config: ResolvedVextDocsConfig,
  endpointConfig: DocEndpointsConfig,
): void {
  app.adapter.registerRoute("GET", config.endpoints.config, [
    async (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.rawJson(createPublicDocsConfig(config));
    },
  ]);

  app.adapter.registerRoute("GET", config.endpoints.openapi, [
    async (req, res) => {
      const resolvedSpec = await resolveOpenAPISpecForEndpoint(
        spec,
        config,
        toDocsRequestContext(req),
        false,
      );
      res.setHeader("Content-Type", "application/json");
      res.rawJson(resolvedSpec);
    },
  ]);

  app.adapter.registerRoute("GET", config.endpoints.code, [
    async (req, res) => {
      const codeDocs = await resolveCodeDocsForView(
        codeDocsProvider,
        config,
        toDocsRequestContext(req),
      );
      res.setHeader("Content-Type", "application/json");
      res.rawJson(codeDocs);
    },
  ]);

  app.adapter.registerRoute("GET", config.endpoints.search, [
    async (req, res) => {
      const request = toDocsRequestContext(req);
      const resolvedSpec = await resolveOpenAPISpecForEndpoint(
        spec,
        config,
        request,
        false,
      );
      const codeDocs = await resolveCodeDocsForView(
        codeDocsProvider,
        config,
        request,
      );
      res.setHeader("Content-Type", "application/json");
      res.rawJson(createDocsSearchIndex(codeDocs, resolvedSpec));
    },
  ]);

  app.adapter.registerRoute("GET", config.endpoints.source, [
    async (req, res) => {
      if (!isLocalDocsRequest(req)) {
        res.rawJson(
          { code: 403, message: "Source links are only available locally." },
          403,
        );
        return;
      }

      const file = typeof req.query.file === "string" ? req.query.file : "";
      if (!isSafeSourceFile(file)) {
        res.rawJson({ code: 400, message: "Invalid source file." }, 400);
        return;
      }

      const sourceTarget = resolveDocsSourceTarget(endpointConfig, file);
      if (!sourceTarget) {
        res.rawJson({ code: 404, message: "Source file not found." }, 404);
        return;
      }

      const line = parsePositiveInt(req.query.line) ?? 1;
      res.redirect(toVscodeLink(sourceTarget, line, 1));
    },
  ]);
}

function registerVextDocsAssets(
  app: VextApp,
  config: ResolvedVextDocsConfig,
): void {
  app.adapter.registerRoute("GET", config.endpoints.appJs, [
    async (_req, res) => {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
      res.text(VEXT_DOCS_APP_JS);
    },
  ]);

  app.adapter.registerRoute("GET", config.endpoints.styleCss, [
    async (_req, res) => {
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
      res.text(VEXT_DOCS_STYLE_CSS);
    },
  ]);
}

function registerDocsPage(
  app: VextApp,
  config: ResolvedVextDocsConfig,
): void {
  app.adapter.registerRoute("GET", config.path, [
    async (_req, res) => {
      const html = renderVextDocsHTML(config);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.text(html);
    },
  ]);
}

function createPublicDocsConfig(config: ResolvedVextDocsConfig) {
  const publicConfig: Record<string, unknown> = {
    path: config.path,
    assetsPath: config.assetsPath,
    specPath: config.specPath,
    specPublicPath: config.specPublicPath,
    endpoints: config.endpoints,
    ui: config.ui,
    code: config.code,
    access: {
      mode: config.access.mode,
      openapiJson: config.access.openapiJson,
    },
  };
  if (config.project) {
    publicConfig.project = config.project;
  }
  return publicConfig;
}

function readDocsProjectInfo(rootDir?: string): VextDocsProjectInfo | undefined {
  const packagePath = resolve(rootDir ?? process.cwd(), "package.json");
  if (!existsSync(packagePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as Record<
      string,
      unknown
    >;
    const scripts = isRecord(parsed.scripts)
      ? collectProjectScripts(parsed.scripts)
      : [];
    if (
      scripts.length === 0 &&
      typeof parsed.name !== "string" &&
      typeof parsed.version !== "string"
    ) {
      return undefined;
    }
    const project: VextDocsProjectInfo = { scripts };
    if (typeof parsed.name === "string") project.name = parsed.name;
    if (typeof parsed.version === "string") project.version = parsed.version;
    if (typeof parsed.type === "string") project.type = parsed.type;
    return project;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectProjectScripts(scripts: Record<string, unknown>) {
  return Object.entries(scripts)
    .filter(([, value]) => typeof value === "string")
    .map(([name, value]) => ({
      name,
      command: scriptCommand(name),
      value: value as string,
      group: scriptGroup(name),
    }))
    .filter((script) => script.group !== undefined)
    .sort((a, b) => {
      const order = scriptOrder(a.name) - scriptOrder(b.name);
      return order === 0 ? a.name.localeCompare(b.name) : order;
    })
    .slice(0, 18) as VextDocsProjectInfo["scripts"];
}

function scriptGroup(name: string): VextDocsProjectScriptGroup | undefined {
  if (name === "dev" || name.startsWith("dev:")) return "development";
  if (name === "start" || name.startsWith("start:") || name === "build" || name.startsWith("build:")) {
    return "production";
  }
  if (name === "test" || name.startsWith("test:") || name === "verify" || name.startsWith("verify:")) {
    return "verification";
  }
  return undefined;
}

function scriptCommand(name: string): string {
  if (name === "start") return "npm start";
  if (name === "test") return "npm test";
  return `npm run ${name}`;
}

function scriptOrder(name: string): number {
  const priority = [
    "dev",
    "dev:light",
    "dev:profile",
    "start",
    "start:light",
    "start:profile",
    "build",
    "test",
    "test:unit",
    "test:int",
    "test:e2e",
    "verify:core",
    "verify:frontend",
    "verify:frontend-deploy",
    "verify:frontend-performance",
    "verify:config-profile",
    "verify:build",
    "verify:all",
  ];
  const index = priority.indexOf(name);
  if (index >= 0) return index;
  const group = scriptGroup(name);
  const offset =
    group === "development" ? 100 : group === "production" ? 200 : 300;
  return offset;
}

function resolveDocsSourceDir(config: DocEndpointsConfig): string {
  if (config.rootDir) {
    const sourceDir = join(config.rootDir, "src");
    if (existsSync(sourceDir)) {
      return resolve(sourceDir);
    }
  }
  if (config.srcDir) {
    return resolve(config.srcDir);
  }
  return resolve(config.rootDir ?? process.cwd(), "src");
}

function resolveDocsSourceTarget(
  config: DocEndpointsConfig,
  file: string,
): string | undefined {
  const sourceRoot = resolveDocsSourceDir(config);
  const sourceTarget = resolve(sourceRoot, file);
  if (isInside(sourceRoot, sourceTarget) && existsSync(sourceTarget)) {
    return sourceTarget;
  }
  if (config.rootDir && file.startsWith("preload/")) {
    const root = resolve(config.rootDir);
    const rootTarget = resolve(root, file);
    if (isInside(root, rootTarget) && existsSync(rootTarget)) {
      return rootTarget;
    }
  }
  return undefined;
}

function isSafeSourceFile(file: string): boolean {
  return (
    file.length > 0 &&
    !file.startsWith("/") &&
    !file.startsWith("\\") &&
    !file.includes("..") &&
    /^[A-Za-z0-9_./-]+\.(tsx?|jsx?|mjs|cjs)$/u.test(file)
  );
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isLocalDocsRequest(request: {
  headers?: Record<string, string | undefined>;
  ip?: string;
}): boolean {
  const host = request.headers?.host ?? "";
  return isLoopbackHost(host) && isLoopbackAddress(request.ip ?? "");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .replace(/^\[/u, "")
    .replace(/\](:\d+)?$/u, "")
    .replace(/:\d+$/u, "")
    .toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized === "::ffff:127.0.0.1" ||
    normalized.startsWith("::ffff:127.")
  );
}

function toVscodeLink(file: string, line: number, column: number): string {
  return `vscode://file/${file.replace(/\\/gu, "/")}:${line}:${column}`;
}

async function resolveOpenAPISpec(
  spec: OpenAPISpecProvider,
): Promise<VextDocsOpenAPIDocument> {
  if (typeof spec === "function") {
    return (await spec()) as VextDocsOpenAPIDocument;
  }
  return spec as VextDocsOpenAPIDocument;
}

async function resolveOpenAPISpecForEndpoint(
  spec: OpenAPISpecProvider,
  config: ResolvedVextDocsConfig,
  request: VextDocsRequestContext | undefined,
  allowPublicCanonical: boolean,
  filterOptions = {},
): Promise<VextDocsOpenAPIDocument> {
  const resolved = await resolveOpenAPISpec(spec);
  if (allowPublicCanonical) {
    return resolved;
  }
  return filterOpenAPIDocumentForDocs(
    resolved,
    config.access,
    request,
    filterOptions,
  );
}

async function resolveCodeDocsForView(
  codeDocsProvider: CodeDocsProvider,
  config: ResolvedVextDocsConfig,
  request: VextDocsRequestContext | undefined,
) {
  const codeDocs = await codeDocsProvider();
  return filterCodeDocsForDocs(codeDocs, config.access, request, {
    includeVisibilityOnly: true,
  });
}

function warnScalarMigration(app: VextApp, config: DocEndpointsConfig): void {
  if (!config.scalar) {
    return;
  }
  app.logger.warn(
    "[openapi] openapi.scalar is deprecated and no longer powers the default /docs page. Use the built-in Vext Docs page or point external tools at /openapi.json.",
  );
}

function toDocsRequestContext(
  request: unknown,
): VextDocsRequestContext | undefined {
  if (typeof request !== "object" || request === null) {
    return undefined;
  }
  const req = request as Record<string, unknown>;
  return {
    method: typeof req.method === "string" ? req.method : undefined,
    path: typeof req.path === "string" ? req.path : undefined,
    headers:
      typeof req.headers === "object" && req.headers !== null
        ? (req.headers as Record<string, string | string[] | undefined>)
        : undefined,
    viewer: req.viewer ?? req.user,
  };
}

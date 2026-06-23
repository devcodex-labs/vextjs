import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendMode,
  VextFrontendRenderManifest,
  VextFrontendUserConfig,
} from "../contract/types.js";
import { resolveFrontendConfig } from "../tooling/config-resolver.js";
import type {
  VextRenderErrorOptions,
  VextRenderHeadOptions,
  VextRenderOptions,
} from "../../types/response.js";
import type { VextMiddleware } from "../../types/middleware.js";
import { normalizeErrorForResponse } from "../../lib/error-response.js";

const require = createRequire(import.meta.url);

export interface CreateFrontendRendererOptions {
  rootDir: string;
  mode: VextFrontendMode;
  config: VextFrontendUserConfig | undefined;
}

export interface VextRenderPayload {
  page: string;
  props: Record<string, unknown>;
  options: VextRenderOptions;
  buildId: string;
  mode: VextFrontendMode;
}

export interface VextRenderCacheEntry {
  __vextResponseKind: "render";
  payload: VextRenderPayload;
}

export interface VextRenderedHtml {
  html: string;
  status: number;
  headers: Record<string, string>;
  payload: VextRenderPayload;
}

export interface VextFrontendRenderer {
  readonly enabled: boolean;
  renderPage(
    page: string,
    props?: Record<string, unknown>,
    options?: VextRenderOptions,
    currentStatus?: number,
  ): VextRenderedHtml;
  renderError(
    errorOrStatus?: Error | number | string,
    pageOrOptions?:
      | string
      | Record<string, unknown>
      | unknown[]
      | VextRenderErrorOptions,
    options?: VextRenderErrorOptions,
    currentStatus?: number,
    requestId?: string,
  ): VextRenderedHtml;
  renderCached(
    payload: unknown,
    status: number,
    headers: Record<string, string>,
  ): VextRenderedHtml;
}

interface FrontendRendererAssets {
  manifest: VextFrontendRenderManifest;
  template: string;
  serverRenderer: VextServerRendererModule;
  serverRendererPath: string;
}

interface VextServerRendererModule {
  renderPage(request?: Record<string, unknown>): {
    html?: string;
    head?: string;
  };
  renderError?(request?: Record<string, unknown>): {
    html?: string;
    head?: string;
  };
}

export function createFrontendRenderer(
  options: CreateFrontendRendererOptions,
): VextFrontendRenderer {
  const config = resolveFrontendConfig(options.config, {
    rootDir: options.rootDir,
    mode: options.mode,
  });

  if (!config.enabled) {
    return {
      enabled: false,
      renderPage: () => {
        throw new Error(
          "[vextjs] res.render() requires config.frontend.enabled=true.",
        );
      },
      renderError: () => {
        throw new Error(
          "[vextjs] res.renderError() requires config.frontend.enabled=true.",
        );
      },
      renderCached: () => {
        throw new Error(
          "[vextjs] cached render replay requires config.frontend.enabled=true.",
        );
      },
    };
  }

  let cachedAssets: FrontendRendererAssets | undefined;
  const loadAssets = (): FrontendRendererAssets => {
    if (options.mode === "production" && cachedAssets) {
      return cachedAssets;
    }

    const manifest = readRenderManifest(options.rootDir, config, options.mode);
    const serverRendererPath = resolveServerRendererPath(
      options.rootDir,
      config,
      manifest,
    );
    const assets = {
      manifest,
      template: readIndexHtml(options.rootDir, config),
      serverRendererPath,
      serverRenderer: readServerRenderer(
        options.rootDir,
        serverRendererPath,
        options.mode,
      ),
    };

    if (options.mode === "production") {
      cachedAssets = assets;
    }

    return assets;
  };

  return {
    enabled: true,
    renderPage: (page, props, renderOptions, currentStatus) =>
      renderPageDocument({
        mode: options.mode,
        assets: loadAssets(),
        page,
        props: props ?? {},
        options: renderOptions ?? {},
        currentStatus,
      }),
    renderError: (
      errorOrStatus,
      pageOrOptions,
      renderOptions,
      currentStatus,
      requestId,
    ) =>
      renderErrorDocument({
        mode: options.mode,
        config,
        assets: loadAssets(),
        errorOrStatus,
        pageOrOptions,
        options: renderOptions,
        currentStatus,
        requestId,
      }),
    renderCached: (payload, status, headers) =>
      renderCachedDocument({
        mode: options.mode,
        assets: loadAssets(),
        payload,
        status,
        headers,
      }),
  };
}

export function createFrontendRenderMiddleware(
  options: CreateFrontendRendererOptions,
): VextMiddleware {
  const renderer = createFrontendRenderer(options);
  if (!renderer.enabled) {
    return async (_req, _res, next) => next();
  }

  return async (req, res, next) => {
    res._renderCached = (payload, status, headers): void => {
      const rendered = renderer.renderCached(payload, status, headers);
      sendRenderedHtml(res, rendered);
    };

    res.render = (page, props, renderOptions): void => {
      const rendered = renderer.renderPage(
        page,
        props,
        renderOptions,
        res.statusCode,
      );
      res._onSend?.(
        createRenderCacheEntry(rendered.payload),
        rendered.status,
        rendered.headers,
      );
      sendRenderedHtml(res, rendered);
    };

    res.renderError = (errorOrStatus, pageOrOptions, renderOptions): void => {
      const rendered = renderer.renderError(
        errorOrStatus,
        pageOrOptions,
        renderOptions,
        res.statusCode,
        req.requestId,
      );
      res._onSend?.(
        createRenderCacheEntry(rendered.payload),
        rendered.status,
        rendered.headers,
      );
      sendRenderedHtml(res, rendered);
    };

    await next();
  };
}

function createRenderCacheEntry(
  payload: VextRenderPayload,
): VextRenderCacheEntry {
  return {
    __vextResponseKind: "render",
    payload,
  };
}

function renderCachedDocument(input: {
  mode: VextFrontendMode;
  assets: FrontendRendererAssets;
  payload: unknown;
  status: number;
  headers: Record<string, string>;
}): VextRenderedHtml {
  const cacheEntry = assertRenderCacheEntry(input.payload);
  if (cacheEntry.payload.buildId !== input.assets.manifest.buildId) {
    throw new Error(
      `[vextjs] cached render payload buildId mismatch: cache=${cacheEntry.payload.buildId}, current=${input.assets.manifest.buildId}. Clear route cache after frontend deploy.`,
    );
  }

  const rendered = renderPageDocument({
    mode: input.mode,
    assets: input.assets,
    page: cacheEntry.payload.page,
    props: cacheEntry.payload.props,
    options: cacheEntry.payload.options,
    currentStatus: input.status,
  });

  return {
    ...rendered,
    status: input.status,
    headers: {
      ...rendered.headers,
      ...input.headers,
    },
  };
}

function assertRenderCacheEntry(payload: unknown): VextRenderCacheEntry {
  if (!isRecord(payload) || payload.__vextResponseKind !== "render") {
    throw new Error("[vextjs] invalid cached render payload.");
  }
  const entryPayload = payload.payload;
  if (!isRecord(entryPayload)) {
    throw new Error("[vextjs] invalid cached render payload.");
  }
  const page = entryPayload.page;
  const props = entryPayload.props;
  const options = entryPayload.options;
  const buildId = entryPayload.buildId;
  const mode = entryPayload.mode;
  if (
    typeof page !== "string" ||
    !isRecord(props) ||
    !isRecord(options) ||
    typeof buildId !== "string" ||
    (mode !== "production" && mode !== "development")
  ) {
    throw new Error("[vextjs] invalid cached render payload.");
  }

  return {
    __vextResponseKind: "render",
    payload: {
      page,
      props,
      options,
      buildId,
      mode,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendRenderedHtml(
  res: Parameters<VextMiddleware>[1],
  rendered: VextRenderedHtml,
): void {
  if (!res._sendHtml) {
    throw new Error(
      "[vextjs] current adapter does not support HTML rendering. Update the adapter response bridge.",
    );
  }
  res._sendHtml(
    rendered.html,
    rendered.status,
    rendered.headers,
    "render",
    rendered.payload,
  );
}

function renderPageDocument(input: {
  mode: VextFrontendMode;
  assets: FrontendRendererAssets;
  page: string;
  props: Record<string, unknown>;
  options: VextRenderOptions;
  currentStatus?: number;
}): VextRenderedHtml {
  assertPageExists(input.page, input.assets.manifest);

  const status = input.options.status ?? input.currentStatus ?? 200;
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    ...(input.options.headers ?? {}),
  };
  const payload: VextRenderPayload = {
    page: input.page,
    props: input.props,
    options: sanitizeRenderOptions(input.options),
    buildId: input.assets.manifest.buildId,
    mode: input.mode,
  };
  const ssr = input.assets.serverRenderer.renderPage({
    page: input.page,
    props: input.props,
    options: input.options,
  });
  const html = renderDocument(input.assets.template, {
    page: input.page,
    manifest: input.assets.manifest,
    head: input.options.head,
    headHtml: ssr.head,
    nonce: input.options.nonce,
    payload,
    bodyHtml: ssr.html ?? "",
  });

  return { html, status, headers, payload };
}

function renderErrorDocument(input: {
  mode: VextFrontendMode;
  config: ResolvedVextFrontendConfig;
  assets: FrontendRendererAssets;
  errorOrStatus?: Error | number | string;
  pageOrOptions?:
    | string
    | Record<string, unknown>
    | unknown[]
    | VextRenderErrorOptions;
  options?: VextRenderErrorOptions;
  currentStatus?: number;
  requestId?: string;
}): VextRenderedHtml {
  const status = resolveErrorStatus(input.errorOrStatus, input.currentStatus);
  const { explicitPage, options } = normalizeRenderErrorArguments(
    input.pageOrOptions,
    input.options,
  );
  const page = selectErrorPage(
    input.assets.manifest,
    input.config,
    status,
    explicitPage ?? options.page,
  );
  const normalized = normalizeErrorForResponse(input.errorOrStatus ?? status, {
    requestId: input.requestId,
    status,
    code: options.code,
    message: options.message,
    details: options.details,
    expose: options.expose,
    stringAsCode: typeof input.errorOrStatus === "string",
  });
  const props = {
    ...(options.props ?? {}),
    error: { status: normalized.status, ...normalized.body },
  };

  if (!page) {
    return renderBuiltinErrorDocument({
      mode: input.mode,
      assets: input.assets,
      page: `error/${normalized.status}`,
      props,
      options: { ...options, status: normalized.status },
      status: normalized.status,
    });
  }

  return renderPageDocument({
    mode: input.mode,
    assets: input.assets,
    page,
    props,
    options: { ...options, status: normalized.status },
    currentStatus: normalized.status,
  });
}

function normalizeRenderErrorArguments(
  pageOrOptions:
    | string
    | Record<string, unknown>
    | unknown[]
    | VextRenderErrorOptions
    | undefined,
  options: VextRenderErrorOptions | undefined,
): { explicitPage?: string; options: VextRenderErrorOptions } {
  if (typeof pageOrOptions === "string") {
    return { explicitPage: pageOrOptions, options: options ?? {} };
  }
  if (pageOrOptions === undefined) {
    return { options: options ?? {} };
  }
  if (isRenderErrorOptions(pageOrOptions)) {
    return {
      explicitPage: pageOrOptions.page,
      options: { ...pageOrOptions, ...(options ?? {}) },
    };
  }
  return {
    options: {
      ...(options ?? {}),
      details: pageOrOptions,
    },
  };
}

function isRenderErrorOptions(value: unknown): value is VextRenderErrorOptions {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const optionKeys = new Set([
    "page",
    "props",
    "code",
    "message",
    "details",
    "expose",
    "status",
    "headers",
    "head",
    "nonce",
    "locale",
    "messages",
    "layout",
    "layoutData",
  ]);
  return Object.keys(value).some((key) => optionKeys.has(key));
}

function selectErrorPage(
  manifest: VextFrontendRenderManifest,
  config: ResolvedVextFrontendConfig,
  status: number,
  explicitPage?: string,
): string | undefined {
  const candidates = [
    explicitPage,
    config.errorPages.status[String(status)],
    `error/${status}`,
    config.errorPages.default,
    "error/default",
  ].filter(
    (page): page is string => typeof page === "string" && page.length > 0,
  );

  const seen = new Set<string>();
  for (const page of candidates) {
    if (seen.has(page)) continue;
    seen.add(page);
    if (pageExists(page, manifest)) return page;
  }
  return undefined;
}

function renderBuiltinErrorDocument(input: {
  mode: VextFrontendMode;
  assets: FrontendRendererAssets;
  page: string;
  props: Record<string, unknown>;
  options: VextRenderOptions;
  status: number;
}): VextRenderedHtml {
  const error = input.props.error as Record<string, unknown> | undefined;
  const message =
    typeof error?.message === "string"
      ? error.message
      : input.status === 404
        ? "Not Found"
        : "Internal Server Error";
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    ...(input.options.headers ?? {}),
  };
  const payload: VextRenderPayload = {
    page: input.page,
    props: input.props,
    options: sanitizeRenderOptions(input.options),
    buildId: input.assets.manifest.buildId,
    mode: input.mode,
  };
  const html = renderDocument(input.assets.template, {
    page: input.page,
    manifest: input.assets.manifest,
    head: input.options.head ?? { title: `${input.status} ${message}` },
    nonce: input.options.nonce,
    payload,
    bodyHtml: renderBuiltinErrorBody(input.status, message, error?.requestId),
  });

  return { html, status: input.status, headers, payload };
}

function renderBuiltinErrorBody(
  status: number,
  message: string,
  requestId: unknown,
): string {
  const requestIdHtml =
    typeof requestId === "string" && requestId
      ? `<p style="margin:16px 0 0;color:#5f6368;font-size:14px">Request ID: <code>${escapeHtml(requestId)}</code></p>`
      : "";
  return `<section style="min-height:60vh;display:grid;place-items:center;padding:48px 24px;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#202124"><div style="max-width:560px"><p style="margin:0 0 12px;color:#5f6368;font-size:14px;letter-spacing:.08em;text-transform:uppercase">${status}</p><h1 style="margin:0;font-size:40px;line-height:1.1;font-weight:700">${escapeHtml(message)}</h1>${requestIdHtml}<a href="/" style="display:inline-block;margin-top:28px;color:#0b57d0;text-decoration:none;font-weight:600">Back home</a></div></section>`;
}

function readRenderManifest(
  rootDir: string,
  config: ResolvedVextFrontendConfig,
  mode: VextFrontendMode,
): VextFrontendRenderManifest {
  const manifestPath = path.join(config.outDir, "render-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[vextjs] frontend render manifest is missing: ${path.relative(rootDir, manifestPath)}. Run "vext build" first.`,
    );
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf-8"),
  ) as VextFrontendRenderManifest;
  if (mode === "production" && !manifest.routeAssets) {
    throw new Error(
      `[vextjs] frontend render-manifest.json is missing routeAssets. Run "vext build" again before starting production SSR.`,
    );
  }
  return manifest;
}

function readIndexHtml(
  rootDir: string,
  config: ResolvedVextFrontendConfig,
): string {
  const indexPath = path.join(config.outDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(
      `[vextjs] frontend document is missing: ${path.relative(rootDir, indexPath)}. Run "vext build" first.`,
    );
  }
  return readFileSync(indexPath, "utf-8");
}

function resolveServerRendererPath(
  rootDir: string,
  config: ResolvedVextFrontendConfig,
  manifest: VextFrontendRenderManifest,
): string {
  const rendererPath = path.join(config.outDir, manifest.serverRenderer);
  if (!existsSync(rendererPath)) {
    throw new Error(
      `[vextjs] frontend server renderer is missing: ${path.relative(rootDir, rendererPath)}. Run "vext build" first.`,
    );
  }
  return rendererPath;
}

function readServerRenderer(
  rootDir: string,
  rendererPath: string,
  mode: VextFrontendMode,
): VextServerRendererModule {
  try {
    const resolved = require.resolve(rendererPath);
    if (mode === "development") {
      delete require.cache[resolved];
    }
    return require(resolved) as VextServerRendererModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[vextjs] failed to load frontend server renderer ${path.relative(rootDir, rendererPath)}: ${message}`,
    );
  }
}

function assertPageExists(
  page: string,
  manifest: VextFrontendRenderManifest,
): void {
  if (pageExists(page, manifest)) return;
  throw new Error(
    `[vextjs] frontend page "${page}" was not found in render-manifest.json.`,
  );
}

function pageExists(
  page: string,
  manifest: VextFrontendRenderManifest,
): boolean {
  const entries = [...manifest.pages, ...manifest.errorPages];
  if (entries.length === 0) return true;
  return entries.some((entry) => entry.id === page);
}

function renderDocument(
  template: string,
  input: {
    page: string;
    manifest: VextFrontendRenderManifest;
    head?: VextRenderHeadOptions;
    headHtml?: string;
    nonce?: string;
    payload: VextRenderPayload;
    bodyHtml: string;
  },
): string {
  const payloadJson = serializeJsonForHtml(input.payload);
  const headHtml = [
    renderRoutePreloads(input.manifest, input.page),
    renderHead(input.head),
    input.headHtml,
  ]
    .filter(Boolean)
    .join("\n");
  let html = template;
  html = html.replaceAll(
    "{vext.lang}",
    escapeAttribute(input.payload.options.locale ?? ""),
  );

  html = html.replace(
    /<div\s+id=["']root["'][^>]*data-vext-root[^>]*><\/div>/iu,
    `<div id="root" data-vext-root data-vext-page="${escapeAttribute(input.page)}">${input.bodyHtml}</div>`,
  );

  html = html.replace(
    /(<script\s+type=["']application\/json["']\s+id=["']__VEXT_DATA__["']\s+data-vext-data[^>]*>)([\s\S]*?)(<\/script>)/iu,
    `$1${payloadJson}$3`,
  );

  if (headHtml && html.includes("</head>")) {
    html = html.replace("</head>", `${headHtml}\n</head>`);
  }

  if (input.nonce) {
    html = addNonceToVextScripts(html, input.nonce);
  }

  return html;
}

function addNonceToVextScripts(html: string, nonce: string): string {
  return html.replace(
    /<script\b(?=[^>]*\bdata-vext-(?:data|entry)\b)(?![^>]*\bnonce=)([^>]*)>/giu,
    `<script$1 nonce="${escapeAttribute(nonce)}">`,
  );
}

function renderRoutePreloads(
  manifest: VextFrontendRenderManifest,
  page: string,
): string {
  const route = manifest.routeAssets?.routes.find((item) => item.page === page);
  if (!route) return "";
  return route.scripts
    .map(
      (href) =>
        `<link rel="modulepreload" href="${escapeAttribute(href)}" data-vext-route-preload>`,
    )
    .join("\n");
}

function renderHead(head: VextRenderHeadOptions | undefined): string {
  if (!head) return "";
  const tags: string[] = [];
  if (head.title) {
    tags.push(`<title>${escapeHtml(head.title)}</title>`);
  }
  if (head.description) {
    tags.push(
      `<meta name="description" content="${escapeAttribute(head.description)}">`,
    );
  }
  for (const [name, content] of Object.entries(head.meta ?? {})) {
    tags.push(
      `<meta name="${escapeAttribute(name)}" content="${escapeAttribute(content)}">`,
    );
  }
  for (const attrs of head.links ?? []) {
    const renderedAttrs = Object.entries(attrs)
      .map(
        ([name, value]) =>
          `${escapeAttribute(name)}="${escapeAttribute(value)}"`,
      )
      .join(" ");
    tags.push(`<link ${renderedAttrs}>`);
  }
  return tags.join("\n");
}

function sanitizeRenderOptions(options: VextRenderOptions): VextRenderOptions {
  const { headers: _headers, nonce: _nonce, ...safeOptions } = options;
  return safeOptions;
}

function resolveErrorStatus(
  errorOrStatus: Error | number | string | undefined,
  currentStatus: number | undefined,
): number {
  if (typeof errorOrStatus === "number") return errorOrStatus;
  if (typeof errorOrStatus === "string") {
    const parsed = Number.parseInt(errorOrStatus, 10);
    return Number.isNaN(parsed) ? (currentStatus ?? 500) : parsed;
  }
  if (errorOrStatus && typeof errorOrStatus === "object") {
    const maybeStatus =
      (errorOrStatus as Error & { status?: unknown; statusCode?: unknown })
        .status ??
      (errorOrStatus as Error & { status?: unknown; statusCode?: unknown })
        .statusCode;
    if (typeof maybeStatus === "number") return maybeStatus;
  }
  return currentStatus && currentStatus >= 400 ? currentStatus : 500;
}

function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return char;
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/gu, "&quot;");
}

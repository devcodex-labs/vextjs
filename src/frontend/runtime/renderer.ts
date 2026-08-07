import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
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
import type { VextRequest } from "../../types/request.js";
import type { VextHeaders } from "../../types/headers.js";
import type { VextMiddleware } from "../../types/middleware.js";
import type { RouteOptions } from "../../types/app.js";
import { normalizeErrorForResponse } from "../../lib/error-response.js";
import { prepareRedirect } from "../../lib/redirect.js";
import {
  createDigest,
  createRouteFreshnessIdentity,
  createRouteId,
} from "../contract/schema-ir.js";
import {
  VEXT_PAGE_MEDIA_TYPE,
  VEXT_PAGE_PROTOCOL_VERSION,
  type VextPageEnvelopeCacheV1,
  type VextPageEnvelopeV1,
} from "../contract/page-envelope.js";
import { withVextMediaManifest } from "../media/server-runtime.js";
import { VEXT_MEDIA_MANIFEST_SCRIPT_ID } from "../media/runtime.js";
import type { VextFrontendMediaManifest } from "../media/types.js";

const require = createRequire(import.meta.url);

export interface CreateFrontendRendererOptions {
  rootDir: string;
  mode: VextFrontendMode;
  config: VextFrontendUserConfig | ResolvedVextFrontendConfig | undefined;
}

export interface VextRenderPayload {
  page: string;
  props: Record<string, unknown>;
  options: VextRenderOptions;
  buildId: string;
  mode: VextFrontendMode;
  protocolVersion: 1;
  routeId: string;
  url: string;
  layouts: string[];
  head: VextRenderHeadOptions;
  assets: string[];
  contractDigest: string;
  cache: VextPageEnvelopeCacheV1;
}

export interface VextRenderCacheEntry {
  __vextResponseKind: "render";
  payload: VextRenderPayload;
}

export interface VextRenderedHtml {
  html: string;
  status: number;
  headers: VextHeaders;
  payload: VextRenderPayload;
}

export interface VextRenderedPageEnvelope {
  envelope: VextPageEnvelopeV1;
  status: number;
  headers: VextHeaders;
  payload?: VextRenderPayload;
}

interface VextRenderedStream {
  stream: NodeJS.ReadableStream;
  abort(): void;
}

export interface VextFrontendRenderer {
  readonly enabled: boolean;
  streamPage(
    page: string,
    props: Record<string, unknown> | undefined,
    options: VextRenderOptions | undefined,
    currentStatus: number | undefined,
    res: Parameters<VextMiddleware>[1],
    req?: VextRequest,
  ): void;
  renderPage(
    page: string,
    props?: Record<string, unknown>,
    options?: VextRenderOptions,
    currentStatus?: number,
    req?: VextRequest,
  ): VextRenderedHtml;
  renderPageEnvelope(
    page: string,
    props: Record<string, unknown> | undefined,
    options: VextRenderOptions | undefined,
    currentStatus: number | undefined,
    req: VextRequest,
  ): VextRenderedPageEnvelope;
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
    req?: VextRequest,
  ): VextRenderedHtml;
  renderErrorEnvelope(
    errorOrStatus: Error | number | string | undefined,
    pageOrOptions:
      | string
      | Record<string, unknown>
      | unknown[]
      | VextRenderErrorOptions
      | undefined,
    options: VextRenderErrorOptions | undefined,
    currentStatus: number | undefined,
    requestId: string | undefined,
    req: VextRequest,
  ): VextRenderedPageEnvelope;
  renderRedirectEnvelope(
    location: string,
    status: 301 | 302 | 303 | 307 | 308,
    req: VextRequest,
  ): VextRenderedPageEnvelope;
  renderCached(
    payload: unknown,
    status: number,
    headers: VextHeaders,
    req?: VextRequest,
  ): VextRenderedHtml;
  renderCachedEnvelope(
    payload: unknown,
    status: number,
    headers: VextHeaders,
    req: VextRequest,
  ): VextRenderedPageEnvelope;
}

interface FrontendRendererAssets {
  manifest: VextFrontendRenderManifest;
  mediaManifest?: VextFrontendMediaManifest;
  template: string;
  serverRenderer: VextServerRendererModule;
  serverRendererPath: string;
}

type FrontendRenderPolicy = ResolvedVextFrontendConfig["render"];

interface VextServerRendererModule {
  renderPage(request?: Record<string, unknown>): {
    html?: string;
    head?: string;
  };
  renderError?(request?: Record<string, unknown>): {
    html?: string;
    head?: string;
  };
  renderPageStream?(
    request?: Record<string, unknown>,
    lifecycle?: {
      onShellReady?(stream: NodeJS.ReadableStream): void;
      onAllReady?(): void;
      onShellError?(error: unknown): void;
      onError?(error: unknown): void;
    },
  ): VextRenderedStream;
}

export function createFrontendRenderer(
  options: CreateFrontendRendererOptions,
): VextFrontendRenderer {
  const config = isResolvedFrontendConfig(options.config)
    ? options.config
    : resolveFrontendConfig(options.config, {
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
      renderPageEnvelope: () => {
        throw new Error(
          "[vextjs] page envelopes require config.frontend.enabled=true.",
        );
      },
      streamPage: () => {
        throw new Error(
          "[vextjs] res.render() requires config.frontend.enabled=true.",
        );
      },
      renderError: () => {
        throw new Error(
          "[vextjs] res.renderError() requires config.frontend.enabled=true.",
        );
      },
      renderErrorEnvelope: () => {
        throw new Error(
          "[vextjs] page envelopes require config.frontend.enabled=true.",
        );
      },
      renderRedirectEnvelope: () => {
        throw new Error(
          "[vextjs] page envelopes require config.frontend.enabled=true.",
        );
      },
      renderCached: () => {
        throw new Error(
          "[vextjs] cached render replay requires config.frontend.enabled=true.",
        );
      },
      renderCachedEnvelope: () => {
        throw new Error(
          "[vextjs] cached page envelopes require config.frontend.enabled=true.",
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
      mediaManifest: readMediaManifest(config),
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
    streamPage: (page, props, renderOptions, currentStatus, res, req) => {
      if (!shouldStreamRender(config.render, renderOptions)) {
        const rendered = renderPageDocument({
          mode: options.mode,
          assets: loadAssets(),
          render: config.render,
          i18n: config.i18n,
          page,
          props: props ?? {},
          options: renderOptions ?? {},
          currentStatus,
          req,
        });
        res._onSend?.(
          createRenderCacheEntry(rendered.payload),
          rendered.status,
          rendered.headers,
        );
        sendRenderedHtml(res, rendered);
        return;
      }
      streamRenderedPage({
        mode: options.mode,
        config,
        assets: loadAssets(),
        render: config.render,
        i18n: config.i18n,
        page,
        props: props ?? {},
        options: renderOptions ?? {},
        currentStatus,
        res,
        req,
      });
    },
    renderPage: (page, props, renderOptions, currentStatus, req) =>
      renderPageDocument({
        mode: options.mode,
        assets: loadAssets(),
        render: config.render,
        i18n: config.i18n,
        page,
        props: props ?? {},
        options: renderOptions ?? {},
        currentStatus,
        req,
      }),
    renderPageEnvelope: (page, props, renderOptions, currentStatus, req) => {
      const rendered = renderPageDocument({
        mode: options.mode,
        assets: loadAssets(),
        render: config.render,
        i18n: config.i18n,
        page,
        props: props ?? {},
        options: renderOptions ?? {},
        currentStatus,
        req,
      });
      return renderedPageToEnvelope(rendered);
    },
    renderError: (
      errorOrStatus,
      pageOrOptions,
      renderOptions,
      currentStatus,
      requestId,
      req,
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
        req,
      }),
    renderErrorEnvelope: (
      errorOrStatus,
      pageOrOptions,
      renderOptions,
      currentStatus,
      requestId,
      req,
    ) => {
      const rendered = renderErrorDocument({
        mode: options.mode,
        config,
        assets: loadAssets(),
        errorOrStatus,
        pageOrOptions,
        options: renderOptions,
        currentStatus,
        requestId,
        req,
      });
      return renderedErrorToEnvelope(rendered);
    },
    renderRedirectEnvelope: (location, status, req) => {
      const assets = loadAssets();
      const prepared = prepareRedirect(location, status);
      const identity = createRenderIdentity(assets.manifest, undefined, req);
      return {
        envelope: {
          protocolVersion: VEXT_PAGE_PROTOCOL_VERSION,
          buildId: assets.manifest.buildId,
          routeId: identity.routeId,
          url: req.url,
          result: {
            kind: "redirect",
            location: prepared.location,
            status: prepared.status,
            replace: true,
          },
          cache: { ...identity.cache, noStore: true },
        },
        status: 200,
        headers: pageEnvelopeHeaders({ "Cache-Control": "no-store" }),
      };
    },
    renderCached: (payload, status, headers, req) =>
      renderCachedDocument({
        mode: options.mode,
        assets: loadAssets(),
        render: config.render,
        i18n: config.i18n,
        payload,
        status,
        headers,
        req,
      }),
    renderCachedEnvelope: (payload, status, headers, req) => {
      const rendered = renderCachedDocument({
        mode: options.mode,
        assets: loadAssets(),
        render: config.render,
        i18n: config.i18n,
        payload,
        status,
        headers,
        req,
      });
      return renderedPageToEnvelope(rendered);
    },
  };
}

function isResolvedFrontendConfig(
  value: CreateFrontendRendererOptions["config"],
): value is ResolvedVextFrontendConfig {
  return (
    value !== undefined &&
    typeof value === "object" &&
    "root" in value &&
    "outDir" in value &&
    "entry" in value &&
    "build" in value &&
    "render" in value
  );
}

export function createFrontendRenderMiddleware(
  options: CreateFrontendRendererOptions,
): VextMiddleware {
  const renderer = createFrontendRenderer(options);
  if (!renderer.enabled) {
    return async (_req, _res, next) => next();
  }

  return async (req, res, next) => {
    const pageEnvelopeRequest = isPageEnvelopeRequest(req);
    const originalRedirect = res.redirect.bind(res);

    res._renderCached = (payload, status, headers): void => {
      if (pageEnvelopeRequest) {
        const rendered = renderer.renderCachedEnvelope(
          payload,
          status,
          headers,
          req,
        );
        sendRenderedPageEnvelope(res, rendered);
      } else {
        const rendered = renderer.renderCached(payload, status, headers, req);
        sendRenderedHtml(res, rendered);
      }
    };

    res._captureFrontendRender = (page, props, renderOptions) => {
      if (pageEnvelopeRequest) {
        const rendered = renderer.renderPageEnvelope(
          page,
          props,
          renderOptions,
          res.statusCode,
          req,
        );
        if (!rendered.payload) {
          throw new Error(
            "[vextjs] page envelope render did not produce a payload.",
          );
        }
        return {
          payload: createRenderCacheEntry(rendered.payload),
          status: rendered.status,
          headers: rendered.headers,
        };
      }
      const rendered = renderer.renderPage(
        page,
        props,
        renderOptions,
        res.statusCode,
        req,
      );
      return {
        payload: createRenderCacheEntry(rendered.payload),
        status: rendered.status,
        headers: rendered.headers,
      };
    };

    res.render = (page, props, renderOptions): void => {
      if (pageEnvelopeRequest) {
        const rendered = renderer.renderPageEnvelope(
          page,
          props,
          renderOptions,
          res.statusCode,
          req,
        );
        res._onSend?.(
          createRenderCacheEntry(rendered.payload!),
          rendered.status,
          rendered.headers,
        );
        sendRenderedPageEnvelope(res, rendered);
        return;
      }
      renderer.streamPage(page, props, renderOptions, res.statusCode, res, req);
    };

    res.renderError = (errorOrStatus, pageOrOptions, renderOptions): void => {
      if (pageEnvelopeRequest) {
        const rendered = renderer.renderErrorEnvelope(
          errorOrStatus,
          pageOrOptions,
          renderOptions,
          res.statusCode,
          req.requestId,
          req,
        );
        sendRenderedPageEnvelope(res, rendered);
        return;
      }
      const rendered = renderer.renderError(
        errorOrStatus,
        pageOrOptions,
        renderOptions,
        res.statusCode,
        req.requestId,
        req,
      );
      res._onSend?.(
        createRenderCacheEntry(rendered.payload),
        rendered.status,
        rendered.headers,
      );
      sendRenderedHtml(res, rendered);
    };

    if (pageEnvelopeRequest) {
      res.redirect = (location, status = 302): void => {
        const rendered = renderer.renderRedirectEnvelope(location, status, req);
        sendRenderedPageEnvelope(res, rendered);
      };
    } else {
      res.redirect = originalRedirect;
    }

    await next();
  };
}

export function isPageEnvelopeRequest(
  req: Pick<VextRequest, "headers">,
): boolean {
  if (req.headers["vext-navigation"] !== "1") return false;
  const accept = req.headers.accept ?? "";
  return accept
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\s+/gu, ""))
    .some((entry) => entry === VEXT_PAGE_MEDIA_TYPE);
}

function shouldStreamRender(
  render: FrontendRenderPolicy,
  options: VextRenderOptions | undefined,
): boolean {
  return (options?.ssr ?? render.ssr) && render.streaming === "auto";
}

function streamRenderedPage(input: {
  mode: VextFrontendMode;
  config: ResolvedVextFrontendConfig;
  assets: FrontendRendererAssets;
  render: FrontendRenderPolicy;
  i18n: ResolvedVextFrontendConfig["i18n"];
  page: string;
  props: Record<string, unknown>;
  options: VextRenderOptions;
  currentStatus?: number;
  res: Parameters<VextMiddleware>[1];
  req?: VextRequest;
}): void {
  assertPageExists(input.page, input.assets.manifest);
  const renderPageStream = input.assets.serverRenderer.renderPageStream;
  if (!renderPageStream) {
    throw new Error(
      "[vextjs] the generated server renderer does not support streaming. Rebuild the frontend output.",
    );
  }

  const status = input.options.status ?? input.currentStatus ?? 200;
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    ...(input.options.headers ?? {}),
  };
  if (input.mode === "development" && !hasHeader(headers, "Cache-Control")) {
    headers["Cache-Control"] = "no-store";
  }
  const payload = createRenderPayload(
    input.assets.manifest,
    input.page,
    input.props,
    input.options,
    input.mode,
    input.req,
  );
  const marker = "<!--vext-stream-body-->";
  const document = renderDocument(input.assets.template, {
    page: input.page,
    manifest: input.assets.manifest,
    mediaManifest: input.assets.mediaManifest,
    i18n: input.i18n,
    head: input.options.head,
    headHtml: "",
    nonce: input.options.nonce,
    payload,
    bodyHtml: marker,
  });
  const markerIndex = document.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      "[vextjs] frontend document template lost the streaming marker.",
    );
  }
  const prefix = document.slice(0, markerIndex);
  const suffix = document.slice(markerIndex + marker.length);
  const output = new PassThrough();
  let shellSent = false;
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  let controller: VextRenderedStream | undefined;
  const cleanup = (): void => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
  };
  const failBeforeShell = (error: unknown): void => {
    if (shellSent) {
      output.destroy(
        error instanceof Error
          ? error
          : new Error("[vextjs] streamed SSR failed."),
      );
      cleanup();
      return;
    }
    cleanup();
    const rendered = renderErrorDocument({
      mode: input.mode,
      config: input.config,
      assets: input.assets,
      errorOrStatus:
        error instanceof Error
          ? error
          : new Error("[vextjs] streamed SSR failed."),
      currentStatus: status,
    });
    sendRenderedHtml(input.res, rendered);
  };

  controller = withVextMediaManifest(input.assets.mediaManifest, () =>
    renderPageStream(
      { page: input.page, props: input.props, options: input.options },
      {
        onShellReady: (body) => {
          if (shellSent) return;
          shellSent = true;
          input.res._onSend?.(createRenderCacheEntry(payload), status, headers);
          input.res.status(status);
          for (const [name, value] of Object.entries(headers)) {
            input.res.setHeader(name, value);
          }
          // Materialize the frozen document shell before handing the stream to
          // adapters whose Web-stream bridge starts reading asynchronously.
          output.write(prefix);
          input.res.stream(output, "text/html; charset=utf-8");
          body.once("error", (error) => output.destroy(error));
          body.once("end", () => {
            output.end(suffix);
            cleanup();
          });
          body.pipe(output, { end: false });
        },
        onShellError: failBeforeShell,
        onError: (error) => {
          if (shellSent)
            output.destroy(error instanceof Error ? error : undefined);
        },
      },
    ),
  );
  output.once("close", () => {
    controller?.abort();
    cleanup();
  });
  const timeoutMs = Math.max(0, input.render.timeoutMs);
  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      controller?.abort();
      failBeforeShell(
        new Error(`[vextjs] SSR render timed out after ${timeoutMs}ms.`),
      );
    }, timeoutMs);
    timeout.unref?.();
  }
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
  render: FrontendRenderPolicy;
  i18n: ResolvedVextFrontendConfig["i18n"];
  payload: unknown;
  status: number;
  headers: VextHeaders;
  req?: VextRequest;
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
    render: input.render,
    i18n: input.i18n,
    page: cacheEntry.payload.page,
    props: cacheEntry.payload.props,
    options: cacheEntry.payload.options,
    currentStatus: input.status,
    req: input.req,
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
      protocolVersion: 1,
      routeId:
        typeof entryPayload.routeId === "string" ? entryPayload.routeId : "",
      url: typeof entryPayload.url === "string" ? entryPayload.url : "",
      layouts: Array.isArray(entryPayload.layouts)
        ? entryPayload.layouts.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      head: isRecord(entryPayload.head) ? entryPayload.head : {},
      assets: Array.isArray(entryPayload.assets)
        ? entryPayload.assets.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      contractDigest:
        typeof entryPayload.contractDigest === "string"
          ? entryPayload.contractDigest
          : "",
      cache: isEnvelopeCache(entryPayload.cache)
        ? entryPayload.cache
        : {
            contractDigest: "",
            partition: "public",
            tags: [],
            noStore: false,
          },
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

function sendRenderedPageEnvelope(
  res: Parameters<VextMiddleware>[1],
  rendered: VextRenderedPageEnvelope,
): void {
  for (const [name, value] of Object.entries(rendered.headers)) {
    if (name.toLowerCase() === "content-length") continue;
    res.setHeader(name, value);
  }
  res.setHeader("Content-Type", `${VEXT_PAGE_MEDIA_TYPE}; charset=utf-8`);
  res.rawJson(rendered.envelope, rendered.status);
}

function renderedPageToEnvelope(
  rendered: VextRenderedHtml,
): VextRenderedPageEnvelope {
  const payload = rendered.payload;
  return {
    envelope: {
      protocolVersion: VEXT_PAGE_PROTOCOL_VERSION,
      buildId: payload.buildId,
      routeId: payload.routeId,
      url: payload.url,
      result: {
        kind: "page",
        page: payload.page,
        props: payload.props,
        layouts: payload.layouts,
        head: payload.head,
        assets: payload.assets,
      },
      cache: payload.cache,
    },
    status: rendered.status,
    headers: pageEnvelopeHeaders(rendered.headers, payload.cache.noStore),
    payload,
  };
}

function renderedErrorToEnvelope(
  rendered: VextRenderedHtml,
): VextRenderedPageEnvelope {
  const error = isRecord(rendered.payload.props.error)
    ? rendered.payload.props.error
    : {};
  const code =
    typeof error.code === "string" || typeof error.code === "number"
      ? error.code
      : undefined;
  const requestId =
    typeof error.requestId === "string" ? error.requestId : undefined;
  const message =
    typeof error.message === "string"
      ? error.message
      : rendered.status === 404
        ? "Not Found"
        : "Internal Server Error";
  return {
    envelope: {
      protocolVersion: VEXT_PAGE_PROTOCOL_VERSION,
      buildId: rendered.payload.buildId,
      routeId: rendered.payload.routeId,
      url: rendered.payload.url,
      result: {
        kind: "error",
        status: rendered.status,
        ...(code === undefined ? {} : { code }),
        message,
        ...(requestId ? { requestId } : {}),
      },
      cache: { ...rendered.payload.cache, noStore: true },
    },
    status: rendered.status,
    headers: pageEnvelopeHeaders(rendered.headers, true),
  };
}

function pageEnvelopeHeaders(
  input: VextHeaders = {},
  noStore = false,
): VextHeaders {
  const headers: VextHeaders = { ...input };
  for (const name of Object.keys(headers)) {
    if (
      ["content-type", "content-length", "location"].includes(
        name.toLowerCase(),
      )
    ) {
      delete headers[name];
    }
  }
  headers["Content-Type"] = `${VEXT_PAGE_MEDIA_TYPE}; charset=utf-8`;
  const varyKey =
    Object.keys(headers).find((name) => name.toLowerCase() === "vary") ??
    "Vary";
  const vary = String(headers[varyKey] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const value of ["Accept", "Vext-Navigation", "Vext-Build-Id"]) {
    if (!vary.some((item) => item.toLowerCase() === value.toLowerCase())) {
      vary.push(value);
    }
  }
  headers[varyKey] = vary.join(", ");
  if (noStore) headers["Cache-Control"] = "private, no-store";
  return headers;
}

function createRenderPayload(
  manifest: VextFrontendRenderManifest,
  page: string,
  props: Record<string, unknown>,
  options: VextRenderOptions,
  mode: VextFrontendMode,
  req?: VextRequest,
): VextRenderPayload {
  const identity = createRenderIdentity(manifest, page, req);
  return {
    page,
    props,
    options: sanitizeRenderOptions(options),
    buildId: manifest.buildId,
    mode,
    protocolVersion: VEXT_PAGE_PROTOCOL_VERSION,
    routeId: identity.routeId,
    url: identity.url,
    layouts: resolveLayoutIds(manifest, page, options.layout),
    head: options.head ?? {},
    assets: resolvePageAssets(manifest, page),
    contractDigest: identity.cache.contractDigest,
    cache: identity.cache,
  };
}

function createRenderIdentity(
  manifest: VextFrontendRenderManifest,
  page: string | undefined,
  req?: VextRequest,
): {
  routeId: string;
  url: string;
  cache: VextPageEnvelopeCacheV1;
} {
  const fallbackRoute =
    manifest.pages.find((entry) => entry.id === page)?.routePath ?? "/";
  const routePath = req?.route || req?.path || fallbackRoute;
  const routeId = createRouteId(req?.method ?? "GET", routePath);
  const freshness = resolveRouteFreshness(req);
  const contractDigest = createDigest({
    protocolVersion: VEXT_PAGE_PROTOCOL_VERSION,
    buildId: manifest.buildId,
    routeId,
    freshness,
  });
  const privateIdentity = req
    ? req.auth?.isAuthenticated
      ? {
          auth: true,
          subject: req.auth.subject,
          userId: req.auth.userId,
          roles: req.auth.roles,
          scopes: req.auth.scopes,
        }
      : req.session
        ? { session: req.session.id }
        : undefined
    : undefined;
  const noStore = Boolean(privateIdentity);
  const partition = privateIdentity
    ? `private-${createDigest(privateIdentity).slice(0, 16)}`
    : "public";
  return {
    routeId,
    url: req?.url ?? fallbackRoute,
    cache: {
      contractDigest,
      partition,
      tags: [...(freshness.tags ?? [])],
      noStore,
    },
  };
}

function resolveRouteFreshness(req: VextRequest | undefined) {
  return createRouteFreshnessIdentity(
    (req as (VextRequest & { _routeOptions?: RouteOptions }) | undefined)
      ?._routeOptions,
  );
}

function resolveLayoutIds(
  manifest: VextFrontendRenderManifest,
  page: string,
  layoutOption: VextRenderOptions["layout"],
): string[] {
  if (layoutOption === false) return [];
  if (typeof layoutOption === "string") {
    return manifest.layouts
      .filter((layout) => layout.id === layoutOption)
      .map((layout) => layout.id);
  }
  if (Array.isArray(layoutOption)) {
    const requested = new Set(layoutOption);
    return manifest.layouts
      .filter((layout) => requested.has(layout.id))
      .map((layout) => layout.id);
  }
  const pageDirectory = page.includes("/")
    ? page.slice(0, page.lastIndexOf("/"))
    : "";
  return manifest.layouts
    .filter((layout) => {
      const directory = layout.directory ?? "";
      return (
        directory === "" ||
        pageDirectory === directory ||
        pageDirectory.startsWith(`${directory}/`)
      );
    })
    .sort(
      (left, right) =>
        (left.directory ?? "").length - (right.directory ?? "").length,
    )
    .map((layout) => layout.id);
}

function resolvePageAssets(
  manifest: VextFrontendRenderManifest,
  page: string,
): string[] {
  const route = manifest.routeAssets?.routes.find((item) => item.page === page);
  if (!route) return [];
  return [
    ...new Set([
      ...route.scripts,
      ...route.styles,
      ...route.assets,
      ...route.externalScripts,
    ]),
  ];
}

function isEnvelopeCache(value: unknown): value is VextPageEnvelopeCacheV1 {
  return (
    isRecord(value) &&
    typeof value.contractDigest === "string" &&
    typeof value.partition === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((item) => typeof item === "string") &&
    typeof value.noStore === "boolean"
  );
}

function renderPageDocument(input: {
  mode: VextFrontendMode;
  assets: FrontendRendererAssets;
  render: FrontendRenderPolicy;
  i18n: ResolvedVextFrontendConfig["i18n"];
  page: string;
  props: Record<string, unknown>;
  options: VextRenderOptions;
  currentStatus?: number;
  req?: VextRequest;
}): VextRenderedHtml {
  assertPageExists(input.page, input.assets.manifest);

  const status = input.options.status ?? input.currentStatus ?? 200;
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    ...(input.options.headers ?? {}),
  };
  if (input.mode === "development" && !hasHeader(headers, "Cache-Control")) {
    headers["Cache-Control"] = "no-store";
  }
  const payload = createRenderPayload(
    input.assets.manifest,
    input.page,
    input.props,
    input.options,
    input.mode,
    input.req,
  );
  const ssr = renderServerPageBody(input);
  const html = renderDocument(input.assets.template, {
    page: input.page,
    manifest: input.assets.manifest,
    mediaManifest: input.assets.mediaManifest,
    i18n: input.i18n,
    head: input.options.head,
    headHtml: ssr.head,
    nonce: input.options.nonce,
    payload,
    bodyHtml: ssr.html ?? "",
  });

  return { html, status, headers, payload };
}

function renderServerPageBody(input: {
  assets: FrontendRendererAssets;
  render: FrontendRenderPolicy;
  page: string;
  props: Record<string, unknown>;
  options: VextRenderOptions;
  req?: VextRequest;
}): { html?: string; head?: string } {
  if (resolveRouteFreshness(input.req).clientOnly) return {};
  const shouldRenderServerBody = input.options.ssr ?? input.render.ssr;
  if (!shouldRenderServerBody) return {};

  const timeoutMs = Math.max(0, input.render.timeoutMs);
  const startedAt = Date.now();
  try {
    const rendered = withVextMediaManifest(input.assets.mediaManifest, () =>
      input.assets.serverRenderer.renderPage({
        page: input.page,
        props: input.props,
        options: input.options,
      }),
    );
    // Server rendering is synchronous, so timeoutMs is enforced after renderPage returns.
    if (timeoutMs > 0 && Date.now() - startedAt > timeoutMs) {
      return handleServerRenderFailure(
        new Error(`[vextjs] SSR render timed out after ${timeoutMs}ms.`),
        input.render,
      );
    }
    return extractReactPreloads(rendered);
  } catch (error) {
    return handleServerRenderFailure(error, input.render);
  }
}

function hasHeader(headers: Record<string, unknown>, name: string): boolean {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}

function handleServerRenderFailure(
  error: unknown,
  render: FrontendRenderPolicy,
): { html?: string; head?: string } {
  if (render.fallback === "client") return {};
  if (error instanceof Error) throw error;
  throw new Error("[vextjs] SSR render failed.");
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
  req?: VextRequest;
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
      i18n: input.config.i18n,
      page: `error/${normalized.status}`,
      props,
      options: { ...options, status: normalized.status },
      status: normalized.status,
      req: input.req,
    });
  }

  return renderPageDocument({
    mode: input.mode,
    assets: input.assets,
    render: input.config.render,
    i18n: input.config.i18n,
    page,
    props,
    options: { ...options, status: normalized.status },
    currentStatus: normalized.status,
    req: input.req,
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
  i18n: ResolvedVextFrontendConfig["i18n"];
  page: string;
  props: Record<string, unknown>;
  options: VextRenderOptions;
  status: number;
  req?: VextRequest;
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
  const payload = createRenderPayload(
    input.assets.manifest,
    input.page,
    input.props,
    input.options,
    input.mode,
    input.req,
  );
  const html = renderDocument(input.assets.template, {
    page: input.page,
    manifest: input.assets.manifest,
    mediaManifest: input.assets.mediaManifest,
    i18n: input.i18n,
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

function readMediaManifest(
  config: ResolvedVextFrontendConfig,
): VextFrontendMediaManifest | undefined {
  const manifestPath = path.join(config.outDir, "media-manifest.json");
  if (!existsSync(manifestPath)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { kind?: unknown }).kind !== "frontend-media-manifest"
  ) {
    throw new Error(
      '[vextjs] frontend media-manifest.json is invalid. Run "vext build" again.',
    );
  }
  return parsed as VextFrontendMediaManifest;
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
    mediaManifest?: VextFrontendMediaManifest;
    i18n: ResolvedVextFrontendConfig["i18n"];
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
    renderMediaHead(input.mediaManifest),
    renderHead(input.head),
    input.headHtml,
  ]
    .filter(Boolean)
    .join("\n");
  let html = template;
  html = renderDocumentLang(html, input.i18n, input.payload.options.locale);

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

function renderDocumentLang(
  html: string,
  i18n: ResolvedVextFrontendConfig["i18n"],
  locale: string | undefined,
): string {
  const markedHtmlLang =
    /<html\b([^>]*?)\slang=(["'])[^"']*\2([^>]*?\sdata-vext-lang(?:=(["'])[^"']*\4)?[^>]*)>/iu;
  const htmlLangAttribute = /<html\b([^>]*?)\slang=(["'])[^"']*\2([^>]*)>/iu;
  const htmlWithoutLang = /<html\b((?:(?!\slang=)[^>])*)>/iu;
  const tokenLangAttribute = /\s+lang=(["'])\{vext\.lang\}\1/giu;

  if (!i18n.htmlLang) {
    return html
      .replace(markedHtmlLang, "<html$1$3>")
      .replace(tokenLangAttribute, "")
      .replace(/\s+data-vext-lang(?:=(["'])[^"']*\1)?/giu, "")
      .replaceAll("{vext.lang}", "");
  }

  const resolvedLang =
    locale && locale.length > 0
      ? locale
      : i18n.defaultLocale === "inherit"
        ? ""
        : i18n.defaultLocale;
  const langAttribute = escapeAttribute(resolvedLang);
  return html
    .replace(markedHtmlLang, `<html$1 lang="${langAttribute}"$3>`)
    .replace(htmlLangAttribute, `<html$1 lang="${langAttribute}"$3>`)
    .replace(htmlWithoutLang, `<html lang="${langAttribute}"$1>`)
    .replace(tokenLangAttribute, ` lang="${langAttribute}"`)
    .replace(/\s+data-vext-lang(?:=(["'])[^"']*\1)?/giu, "")
    .replaceAll("{vext.lang}", langAttribute);
}

function addNonceToVextScripts(html: string, nonce: string): string {
  return html.replace(
    /<script\b(?=[^>]*\bdata-vext-(?:data|entry|media)\b)(?![^>]*\bnonce=)([^>]*)>/giu,
    `<script$1 nonce="${escapeAttribute(nonce)}">`,
  );
}

function renderMediaHead(
  manifest: VextFrontendMediaManifest | undefined,
): string {
  if (!manifest) return "";
  const fontPreloads = manifest.fonts
    .filter((font) => font.preload)
    .map(
      (font) =>
        `<link rel="preload" href="${escapeAttribute(font.src)}" as="font" type="font/woff2" crossorigin="anonymous" integrity="${escapeAttribute(font.integrity)}" data-vext-font-preload>`,
    );
  const fontRules = manifest.fonts.map((font) => {
    const descriptors = [
      `font-family:${escapeCssString(font.family)}`,
      `src:url(${escapeCssUrl(font.src)}) format(\"woff2\")`,
      `font-weight:${escapeCssString(font.weight)}`,
      `font-style:${escapeCssString(font.style)}`,
      `font-display:${escapeCssString(font.display)}`,
      font.unicodeRange
        ? `unicode-range:${escapeCssString(font.unicodeRange)}`
        : undefined,
      font.fallback.sizeAdjust
        ? `size-adjust:${escapeCssString(font.fallback.sizeAdjust)}`
        : undefined,
      font.fallback.ascentOverride
        ? `ascent-override:${escapeCssString(font.fallback.ascentOverride)}`
        : undefined,
      font.fallback.descentOverride
        ? `descent-override:${escapeCssString(font.fallback.descentOverride)}`
        : undefined,
      font.fallback.lineGapOverride
        ? `line-gap-override:${escapeCssString(font.fallback.lineGapOverride)}`
        : undefined,
    ]
      .filter(Boolean)
      .join(";");
    return `@font-face{${descriptors}}`;
  });
  const fallbackRules = manifest.fonts.map(
    (font) =>
      `:root{--vext-font-${font.id.slice(0, 12)}:${escapeCssString(font.family)},${escapeCssString(font.fallback.family)}}`,
  );
  const style =
    fontRules.length > 0
      ? `<style id="__VEXT_MEDIA_FONTS__" data-vext-media-fonts>${fontRules.concat(fallbackRules).join("")}</style>`
      : "";
  const data = `<script type="application/json" id="${VEXT_MEDIA_MANIFEST_SCRIPT_ID}" data-vext-media>${serializeJsonForHtml(manifest)}</script>`;
  return [...fontPreloads, style, data].filter(Boolean).join("\n");
}

function extractReactPreloads(rendered: { html?: string; head?: string }): {
  html?: string;
  head?: string;
} {
  let html = rendered.html ?? "";
  const preloads: string[] = [];
  const preload = /^<link\s+rel="preload"\s+as="image"[^>]*\/>/iu;
  let match: RegExpMatchArray | null;
  while ((match = html.match(preload))) {
    preloads.push(match[0]);
    html = html.slice(match[0].length);
  }
  const head = [rendered.head, ...preloads].filter(Boolean).join("\n");
  return { html: html || undefined, head: head || undefined };
}

function escapeCssString(value: string): string {
  return `"${escapeCssValue(value)}"`;
}

function escapeCssUrl(value: string): string {
  return `"${escapeCssValue(value).replaceAll(")", "\\)")}"`;
}

function escapeCssValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\a ")
    .replaceAll("\r", "\\d ");
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

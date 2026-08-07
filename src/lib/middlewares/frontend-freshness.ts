import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRouteFreshnessIdentity } from "../../frontend/contract/schema-ir.js";
import type {
  VextFrontendMode,
  VextFrontendUserConfig,
  VextRouteFreshnessIdentity,
} from "../../frontend/contract/types.js";
import {
  createFreshnessKeyDigest,
  getFrontendFreshnessStore,
  type VextFrontendFreshnessEntry,
  type VextFrontendFreshnessKey,
  type VextFrontendFreshnessResponse,
} from "../../frontend/runtime/freshness.js";
import { resolveFrontendConfig } from "../../frontend/tooling/config-resolver.js";
import type { RouteOptions } from "../../types/app.js";
import type { VextHeaders } from "../../types/headers.js";
import type { VextMiddleware } from "../../types/middleware.js";
import type { VextRequest } from "../../types/request.js";
import type { VextResponse } from "../../types/response.js";

export interface CreateFrontendFreshnessMiddlewareOptions {
  rootDir: string;
  config: VextFrontendUserConfig | undefined;
  mode: VextFrontendMode;
}

/**
 * Makes RouteOptions.frontend the sole policy input for runtime freshness.
 * Route/cache and frontend/page concerns intentionally remain separate: this
 * store owns only public render payloads, then replays them through the
 * current renderer for document versus page-envelope negotiation.
 */
export function buildFrontendFreshnessMiddleware(
  routeOptions: RouteOptions | undefined,
  options: CreateFrontendFreshnessMiddlewareOptions,
): VextMiddleware | undefined {
  const freshness = createRouteFreshnessIdentity(routeOptions);
  if (freshness.mode === "dynamic") return undefined;

  const store = getFrontendFreshnessStore(options.rootDir);
  return async (req, res, next) => {
    if (!isCacheableRequest(req) || isPrivateRequest(req)) {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Vext-Freshness", "bypass");
      await next();
      return;
    }

    const key = createRequestKey(
      req,
      freshness,
      resolveFrontendBuildId(options),
    );
    const read = await store.read(key);
    if (read.state === "fresh" && read.entry) {
      replay(res, read.entry, freshness, "hit");
      return;
    }

    if (read.state === "stale" && read.entry) {
      replay(res, read.entry, freshness, "stale");
      void store
        .singleFlight(key, async () => {
          const captured = await captureRouteRender(res, next);
          if (!captured) return undefined;
          return store.write({
            key,
            tags: freshness.tags ?? [],
            ttlMs: freshnessTtlMs(freshness),
            response: captured,
          });
        })
        .catch(() => undefined);
      return;
    }

    const result = await store.singleFlight(key, async () => {
      const captured = await captureRouteRender(res, next);
      if (!captured) return undefined;
      return store.write({
        key,
        tags: freshness.tags ?? [],
        ttlMs: freshnessTtlMs(freshness),
        response: captured,
      });
    });
    if (result.value) {
      replay(res, result.value, freshness, result.leader ? "miss" : "hit");
      return;
    }

    // A route using this policy is not required to call res.render(). Preserve
    // ordinary route behavior, including JSON/file responses, without storing
    // a synthetic cache entry.
    if (!result.leader && !res._isSent()) {
      await next();
    }
  };
}

function isCacheableRequest(req: VextRequest): boolean {
  return req.method === "GET" || req.method === "HEAD";
}

function isPrivateRequest(req: VextRequest): boolean {
  return Boolean(req.auth?.isAuthenticated || req.session);
}

function createRequestKey(
  req: VextRequest,
  freshness: VextRouteFreshnessIdentity,
  buildId: string,
): VextFrontendFreshnessKey {
  return {
    route: req.route || req.path,
    path: req.path,
    query: Object.fromEntries(
      Object.entries(req.query).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    locale:
      req.headers["x-vext-locale"] ??
      req.cookie("locale") ??
      req.headers["accept-language"]?.split(",")[0]?.trim() ??
      "default",
    buildId,
    partition: "public",
    policy: {
      mode: freshness.mode,
      ...(freshness.revalidate !== undefined
        ? { revalidate: freshness.revalidate }
        : {}),
      ...(freshness.clientOnly ? { clientOnly: true } : {}),
    },
  };
}

function resolveFrontendBuildId(
  options: CreateFrontendFreshnessMiddlewareOptions,
): string {
  const config = resolveFrontendConfig(options.config, {
    rootDir: options.rootDir,
    mode: options.mode,
  });
  const manifestPath = path.join(config.outDir, "render-manifest.json");
  if (!existsSync(manifestPath)) return `unbuilt-${options.mode}`;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      buildId?: unknown;
    };
    return typeof manifest.buildId === "string" && manifest.buildId
      ? manifest.buildId
      : `unbuilt-${options.mode}`;
  } catch {
    return `unbuilt-${options.mode}`;
  }
}

function freshnessTtlMs(
  freshness: VextRouteFreshnessIdentity,
): number | undefined {
  return freshness.mode === "revalidate" && freshness.revalidate !== undefined
    ? freshness.revalidate * 1000
    : undefined;
}

async function captureRouteRender(
  res: VextResponse,
  next: () => Promise<void>,
): Promise<VextFrontendFreshnessResponse | undefined> {
  const originalRender = res.render.bind(res);
  let captured: VextFrontendFreshnessResponse | undefined;
  res.render = (page, props, renderOptions): void => {
    const result = res._captureFrontendRender?.(page, props, renderOptions);
    if (!result) {
      originalRender(page, props, renderOptions);
      return;
    }
    captured = result;
  };
  try {
    await next();
  } finally {
    res.render = originalRender;
  }
  return captured;
}

function replay(
  res: VextResponse,
  entry: VextFrontendFreshnessEntry,
  freshness: VextRouteFreshnessIdentity,
  state: "miss" | "hit" | "stale",
): void {
  const keyDigest = createFreshnessKeyDigest(entry.key);
  res._renderCached?.(
    entry.response.payload,
    entry.response.status,
    withFreshnessHeaders(entry.response.headers, freshness, state, keyDigest),
  );
}

function withFreshnessHeaders(
  headers: VextHeaders,
  freshness: VextRouteFreshnessIdentity,
  state: "miss" | "hit" | "stale",
  keyDigest: string,
): VextHeaders {
  return {
    ...headers,
    "Cache-Control":
      headers["Cache-Control"] ??
      (freshness.mode === "static"
        ? "public, max-age=0, must-revalidate"
        : `public, max-age=0, s-maxage=${freshness.revalidate ?? 0}, stale-while-revalidate=${freshness.revalidate ?? 0}`),
    "X-Vext-Freshness": state,
    "X-Vext-Freshness-Key": keyDigest,
  };
}

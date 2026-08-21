import type { ResolvedVextFrontendConfig } from "../contract/types.js";
import type { VextRequest } from "../../types/request.js";
import type { VextRenderOptions } from "../../types/response.js";
import { createRouteFreshnessIdentity } from "../contract/schema-ir.js";
import type { RouteOptions } from "../../types/app.js";

export interface VextDocumentPolicy {
  hydration: "full" | "none";
  pageEnvelope: boolean;
  streaming: boolean;
}

export function resolveDocumentPolicy(input: {
  config: Pick<ResolvedVextFrontendConfig, "render">;
  options?: VextRenderOptions;
  req?: VextRequest;
}): VextDocumentPolicy {
  const freshness = createRouteFreshnessIdentity(
    (input.req as (VextRequest & { _routeOptions?: RouteOptions }) | undefined)
      ?._routeOptions,
  );
  const hydration = freshness.hydration === "none" ? "none" : "full";
  if (hydration === "none") {
    const ssr = input.options?.ssr ?? input.config.render.ssr;
    if (!ssr) {
      throw new Error(
        '[vextjs] RouteOptions.frontend.hydration="none" requires SSR to remain enabled.',
      );
    }
  }
  return {
    hydration,
    pageEnvelope: hydration === "full",
    streaming:
      hydration === "full" &&
      (input.options?.ssr ?? input.config.render.ssr) &&
      input.config.render.streaming === "auto",
  };
}

/** Removes only framework-owned browser runtime artifacts. User scripts stay. */
export function applyDocumentPolicy(
  html: string,
  policy: VextDocumentPolicy,
): string {
  if (policy.hydration === "full") return html;
  return html
    .replace(
      /\s*<script\b(?=[^>]*\bdata-vext-(?:entry|data|media|external-runtime)\b)[^>]*>[\s\S]*?<\/script>/giu,
      "",
    )
    .replace(
      /\s*<link\b(?=[^>]*\bdata-vext-(?:route-preload|external-runtime)\b)[^>]*\/?>/giu,
      "",
    )
    .replace(
      /(<div\s+id=["']root["'][^>]*\bdata-vext-root\b)(?![^>]*\bdata-vext-hydration=)([^>]*>)/iu,
      '$1 data-vext-hydration="none"$2',
    );
}

export function isNoHydrationRequest(req: VextRequest | undefined): boolean {
  return (
    createRouteFreshnessIdentity(
      (req as (VextRequest & { _routeOptions?: RouteOptions }) | undefined)
        ?._routeOptions,
    ).hydration === "none"
  );
}

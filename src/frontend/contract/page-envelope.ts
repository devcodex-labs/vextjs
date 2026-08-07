import type { VextRenderHeadOptions } from "../../types/response.js";

export const VEXT_PAGE_PROTOCOL_VERSION = 1 as const;
export const VEXT_PAGE_MEDIA_TYPE =
  "application/vnd.vext.page+json;v=1" as const;
export const VEXT_NAVIGATION_HEADER = "Vext-Navigation" as const;
export const VEXT_BUILD_ID_HEADER = "Vext-Build-Id" as const;

export interface VextPageEnvelopeCacheV1 {
  contractDigest: string;
  partition: string;
  tags: string[];
  noStore: boolean;
}

export interface VextPageEnvelopePageResultV1 {
  kind: "page";
  page: string;
  props: unknown;
  layouts: string[];
  head: VextRenderHeadOptions;
  assets: string[];
}

export interface VextPageEnvelopeRedirectResultV1 {
  kind: "redirect";
  location: string;
  status: number;
  replace: boolean;
}

export interface VextPageEnvelopeErrorResultV1 {
  kind: "error";
  status: number;
  code?: string | number;
  message: string;
  requestId?: string;
}

export type VextPageEnvelopeResultV1 =
  | VextPageEnvelopePageResultV1
  | VextPageEnvelopeRedirectResultV1
  | VextPageEnvelopeErrorResultV1;

export interface VextPageEnvelopeV1 {
  protocolVersion: 1;
  buildId: string;
  routeId: string;
  url: string;
  result: VextPageEnvelopeResultV1;
  /** Browser-cache identity metadata. It contains no credential or session id. */
  cache?: VextPageEnvelopeCacheV1;
}

export function isVextPageEnvelopeV1(
  value: unknown,
): value is VextPageEnvelopeV1 {
  if (!isRecord(value) || value.protocolVersion !== 1) return false;
  if (
    typeof value.buildId !== "string" ||
    typeof value.routeId !== "string" ||
    typeof value.url !== "string" ||
    !isRecord(value.result)
  ) {
    return false;
  }

  switch (value.result.kind) {
    case "page":
      return (
        typeof value.result.page === "string" &&
        Array.isArray(value.result.layouts) &&
        value.result.layouts.every((item) => typeof item === "string") &&
        isRecord(value.result.head) &&
        Array.isArray(value.result.assets) &&
        value.result.assets.every((item) => typeof item === "string")
      );
    case "redirect":
      return (
        typeof value.result.location === "string" &&
        typeof value.result.status === "number" &&
        typeof value.result.replace === "boolean"
      );
    case "error":
      return (
        typeof value.result.status === "number" &&
        typeof value.result.message === "string"
      );
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

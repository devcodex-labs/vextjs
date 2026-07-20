import type { VextClientContract, VextClientRouteMethod } from "./types.js";

type VextHeadersInit = ConstructorParameters<typeof Headers>[0];

type RoutesByMethod<
  TContract extends VextClientContract,
  TMethod extends VextClientRouteMethod,
> = Extract<TContract["routes"][number], { method: TMethod }>;

type PathFor<
  TContract extends VextClientContract,
  TMethod extends VextClientRouteMethod,
> = RoutesByMethod<TContract, TMethod>["path"] & string;

export interface VextApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: VextHeadersInit;
}

export interface VextApiRequestOptions {
  params?: Record<string, string | number | boolean>;
  query?: Record<
    string,
    string | number | boolean | null | undefined | Array<string | number>
  >;
  body?: unknown;
  headers?: VextHeadersInit;
  signal?: AbortSignal;
}

export class VextApiError extends Error {
  override readonly name = "VextApiError";
  readonly status: number;
  readonly code: unknown;
  readonly details: unknown;
  readonly response: Response;
  readonly rawBody: unknown;

  constructor(args: {
    status: number;
    message: string;
    response: Response;
    rawBody: unknown;
    code?: unknown;
    details?: unknown;
  }) {
    super(args.message);
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.response = args.response;
    this.rawBody = args.rawBody;
  }
}

export function isVextApiError(error: unknown): error is VextApiError {
  return error instanceof VextApiError;
}

export interface VextApiClient<TContract extends VextClientContract> {
  readonly contract: TContract;
  request<TMethod extends VextClientRouteMethod>(
    method: TMethod,
    path: PathFor<TContract, TMethod>,
    options?: VextApiRequestOptions,
  ): Promise<unknown>;
  GET(
    path: PathFor<TContract, "GET">,
    options?: VextApiRequestOptions,
  ): Promise<unknown>;
  POST(
    path: PathFor<TContract, "POST">,
    options?: VextApiRequestOptions,
  ): Promise<unknown>;
  PUT(
    path: PathFor<TContract, "PUT">,
    options?: VextApiRequestOptions,
  ): Promise<unknown>;
  PATCH(
    path: PathFor<TContract, "PATCH">,
    options?: VextApiRequestOptions,
  ): Promise<unknown>;
  DELETE(
    path: PathFor<TContract, "DELETE">,
    options?: VextApiRequestOptions,
  ): Promise<unknown>;
  HEAD(
    path: PathFor<TContract, "HEAD">,
    options?: VextApiRequestOptions,
  ): Promise<unknown>;
  OPTIONS(
    path: PathFor<TContract, "OPTIONS">,
    options?: VextApiRequestOptions,
  ): Promise<unknown>;
}

export function createVextApiClient<const TContract extends VextClientContract>(
  contract: TContract,
  options: VextApiClientOptions = {},
): VextApiClient<TContract> {
  const request = async <TMethod extends VextClientRouteMethod>(
    method: TMethod,
    path: PathFor<TContract, TMethod>,
    requestOptions: VextApiRequestOptions = {},
  ): Promise<unknown> => {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("[vextjs/frontend] fetch is not available.");
    }

    const url = buildUrl(options.baseUrl, String(path), requestOptions);
    const headers = new Headers(options.headers);
    mergeHeaders(headers, requestOptions.headers);

    const init: RequestInit = {
      method,
      headers,
      signal: requestOptions.signal,
    };

    if (
      requestOptions.body !== undefined &&
      method !== "GET" &&
      method !== "HEAD"
    ) {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      init.body =
        typeof requestOptions.body === "string"
          ? requestOptions.body
          : JSON.stringify(requestOptions.body);
    }

    const response = await fetchImpl(url, init);
    const body = await readResponseBody(response);
    if (!response.ok) {
      const errorBody = isRecord(body) ? body : {};
      throw new VextApiError({
        status: response.status,
        message:
          typeof errorBody.message === "string"
            ? errorBody.message
            : response.statusText || "Vext API request failed",
        response,
        rawBody: body,
        code: errorBody.code,
        details: errorBody.details,
      });
    }
    return unwrapVextResponse(body);
  };

  return {
    contract,
    request,
    GET: (path, requestOptions) => request("GET", path, requestOptions),
    POST: (path, requestOptions) => request("POST", path, requestOptions),
    PUT: (path, requestOptions) => request("PUT", path, requestOptions),
    PATCH: (path, requestOptions) => request("PATCH", path, requestOptions),
    DELETE: (path, requestOptions) => request("DELETE", path, requestOptions),
    HEAD: (path, requestOptions) => request("HEAD", path, requestOptions),
    OPTIONS: (path, requestOptions) => request("OPTIONS", path, requestOptions),
  };
}

function buildUrl(
  baseUrl: string | undefined,
  path: string,
  options: VextApiRequestOptions,
): string {
  const replacedPath = replaceParams(path, options.params ?? {});
  const url = new URL(replacedPath, baseUrl ?? getGlobalLocationOrigin());

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  if (!baseUrl) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}

function replaceParams(
  path: string,
  params: Record<string, string | number | boolean>,
): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (match, key: string) => {
    if (!(key in params)) return match;
    return encodeURIComponent(String(params[key]));
  });
}

function getGlobalLocationOrigin(): string {
  const maybeGlobal = globalThis as { location?: { origin?: string } };
  return maybeGlobal.location?.origin ?? "http://localhost";
}

function mergeHeaders(
  target: Headers,
  source: VextHeadersInit | undefined,
): void {
  if (!source) return;
  new Headers(source).forEach((value, key) => target.set(key, value));
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204) return null;
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function unwrapVextResponse(body: unknown): unknown {
  if (!isRecord(body)) return body;
  if ("code" in body && "data" in body && body.code === 0) {
    return body.data;
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { VextApp } from "./app.js";
import type { VextRequest } from "./request.js";
import type { VextResponse } from "./response.js";
import type { RouteOptions } from "./app.js";
import type { VextHeaders } from "./headers.js";

export type VextHookName =
  | "request:start"
  | "route:matched"
  | "route:notFound"
  | "validation:success"
  | "validation:error"
  | "handler:before"
  | "handler:after"
  | "handler:error"
  | "response:before"
  | "response:after"
  | "error:beforeResponse"
  | "error:afterResponse"
  | "fetch:before"
  | "fetch:after"
  | "fetch:error"
  | "proxy:before"
  | "proxy:after"
  | "proxy:error"
  | "service:loaded"
  | "service:reloaded"
  | "service:beforeCall"
  | "service:afterCall"
  | "service:error"
  | "cache:hit"
  | "cache:miss"
  | "cache:write"
  | "cache:error"
  | "plugin:beforeSetup"
  | "plugin:afterSetup"
  | "plugin:error"
  | "routes:ready"
  | "openapi:beforeGenerate"
  | "openapi:afterGenerate"
  | "server:beforeListen"
  | "app:ready"
  | "app:close";

export type VextRuntimeMode = "production" | "development" | "test";

export interface VextRouteHookInfo {
  method: string;
  path: string;
  options?: RouteOptions;
  sourceFile?: string;
}

export interface VextValidationLocationResult {
  location: "param" | "query" | "header" | "cookie" | "body";
  data: unknown;
}

export type VextResponseKind =
  | "json"
  | "rawJson"
  | "text"
  | "html"
  | "render"
  | "stream"
  | "download"
  | "redirect";

export interface VextResponseBeforePatch {
  data?: unknown;
  status?: number;
  headers?: VextHeaders;
}

export interface VextErrorBeforeResponsePatch {
  body?: Record<string, unknown>;
  status?: number;
}

export interface VextOpenAPIAfterGeneratePatch {
  document?: unknown;
}

export interface VextOpenAPIDocumentPatch {
  openapi: string;
  [key: string]: unknown;
}

export interface VextHookPayloadMap {
  "request:start": {
    req: VextRequest;
    requestId: string;
    method: string;
    path: string;
    matched?: boolean;
  };
  "route:matched": {
    req: VextRequest;
    route: VextRouteHookInfo;
    params: Record<string, string>;
    requestId: string;
  };
  "route:notFound": {
    req: VextRequest;
    requestId: string;
    path: string;
  };
  "validation:success": {
    req: VextRequest;
    route: VextRouteHookInfo;
    locationResults: VextValidationLocationResult[];
    requestId: string;
  };
  "validation:error": {
    req: VextRequest;
    route: VextRouteHookInfo;
    errors: Array<{ field: string; message: string }>;
    requestId: string;
  };
  "handler:before": {
    req: VextRequest;
    res: VextResponse;
    route: VextRouteHookInfo;
    requestId: string;
  };
  "handler:after": {
    req: VextRequest;
    res: VextResponse;
    route: VextRouteHookInfo;
    requestId: string;
    durationMs: number;
  };
  "handler:error": {
    req: VextRequest;
    res: VextResponse;
    route: VextRouteHookInfo;
    error: unknown;
    requestId: string;
  };
  "response:before": {
    kind: VextResponseKind;
    data?: unknown;
    status: number;
    headers: VextHeaders;
    wrapped: boolean;
    requestId: string;
  };
  "response:after": {
    kind: VextResponseKind;
    status: number;
    headers: VextHeaders;
    requestId: string;
    durationMs: number;
  };
  "error:beforeResponse": {
    error: Error;
    status: number;
    body: Record<string, unknown>;
    requestId: string;
  };
  "error:afterResponse": {
    error: Error;
    status: number;
    requestId: string;
  };
  "fetch:before": {
    url: string;
    method: string;
    headers: Headers;
    requestId?: string;
    operationId?: string;
    clientId?: string;
    parentClientId?: string;
    baseURL?: string;
    attempt?: number;
    maxRetries?: number;
    init?: RequestInit & Record<string, unknown>;
  };
  "fetch:after": {
    url: string;
    method: string;
    response: Response;
    durationMs: number;
    requestId?: string;
    operationId?: string;
    clientId?: string;
    parentClientId?: string;
    baseURL?: string;
    attempt?: number;
    maxRetries?: number;
  };
  "fetch:error": {
    url: string;
    method: string;
    error: Error;
    requestId?: string;
    operationId?: string;
    clientId?: string;
    parentClientId?: string;
    baseURL?: string;
    attempt?: number;
    maxRetries?: number;
  };
  "proxy:before": {
    req: VextRequest;
    target?: string;
    url: string;
    method: string;
    headers: Headers;
    requestId: string;
    operationId?: string;
    clientId?: string;
    attempt?: number;
    maxRetries?: number;
  };
  "proxy:after": {
    req: VextRequest;
    target?: string;
    url?: string;
    method?: string;
    status: number;
    requestId: string;
    operationId?: string;
    clientId?: string;
    attempt?: number;
    maxRetries?: number;
    durationMs?: number;
  };
  "proxy:error": {
    req: VextRequest;
    target?: string;
    url?: string;
    method?: string;
    error: Error;
    requestId: string;
    operationId?: string;
    clientId?: string;
    attempt?: number;
    maxRetries?: number;
  };
  "service:loaded": {
    name: string;
    instance: unknown;
    filePath: string;
  };
  "service:reloaded": {
    name: string;
    instance: unknown;
    filePath: string;
  };
  "service:beforeCall": {
    service: string;
    method: string;
    args: unknown[];
  };
  "service:afterCall": {
    service: string;
    method: string;
    args: unknown[];
    result: unknown;
  };
  "service:error": {
    service: string;
    method: string;
    args: unknown[];
    error: unknown;
  };
  "cache:hit": {
    req: VextRequest;
    route?: string;
    key: string;
    state: "hit" | "deduped";
    metadata: unknown;
  };
  "cache:miss": {
    req: VextRequest;
    route?: string;
    key?: string;
    state: "miss" | "skipped";
    metadata?: unknown;
  };
  "cache:write": {
    req: VextRequest;
    route?: string;
    key: string;
    state: "write";
    metadata?: unknown;
  };
  "cache:error": {
    req: VextRequest;
    route?: string;
    key?: string;
    state: "error";
    metadata?: unknown;
    error: unknown;
  };
  "plugin:beforeSetup": {
    plugin: string;
    sourceFile: string;
    builtin?: boolean;
  };
  "plugin:afterSetup": {
    plugin: string;
    sourceFile: string;
    builtin?: boolean;
    durationMs: number;
  };
  "plugin:error": {
    plugin: string;
    sourceFile: string;
    builtin?: boolean;
    durationMs?: number;
    error: unknown;
  };
  "routes:ready": {
    count: number;
    routes: VextRouteHookInfo[];
    collector?: unknown;
  };
  "openapi:beforeGenerate": {
    routes: unknown[];
  };
  "openapi:afterGenerate": {
    routes: unknown[];
    document: unknown;
  };
  "server:beforeListen": {
    host: string;
    port: number;
    adapter: unknown;
    mode?: VextRuntimeMode;
    source?: string;
    app?: VextApp;
  };
  "app:ready": {
    app: VextApp;
    phase: "before" | "after";
    mode?: VextRuntimeMode;
    source?: string;
  };
  "app:close": {
    app: VextApp;
    phase: "before" | "after";
    mode?: VextRuntimeMode;
    source?: string;
  };
}

export type VextHookReturn<K extends VextHookName> = K extends "response:before"
  ? VextResponseBeforePatch | void
  : K extends "error:beforeResponse"
    ? VextErrorBeforeResponsePatch | void
    : K extends "openapi:afterGenerate"
      ? VextOpenAPIAfterGeneratePatch | VextOpenAPIDocumentPatch | void
      : void;

type VextSyncOnlyHookName = "openapi:beforeGenerate" | "openapi:afterGenerate";

export type VextHookHandler<K extends VextHookName> = (
  payload: VextHookPayloadMap[K],
) => K extends VextSyncOnlyHookName
  ? VextHookReturn<K>
  : VextHookReturn<K> | Promise<VextHookReturn<K>>;

export interface VextHooks {
  on<K extends VextHookName>(name: K, handler: VextHookHandler<K>): () => void;
  has(name: VextHookName): boolean;
}

export interface VextInternalHooks extends VextHooks {
  emit<K extends VextHookName>(
    name: K,
    payload: VextHookPayloadMap[K],
  ): Promise<VextHookReturn<K> | undefined>;
  emitSafe<K extends VextHookName>(
    name: K,
    payload: VextHookPayloadMap[K],
  ): Promise<VextHookReturn<K> | undefined>;
  emitSync<K extends VextHookName>(
    name: K,
    payload: VextHookPayloadMap[K],
  ): VextHookReturn<K> | undefined;
  emitSafeSync<K extends VextHookName>(
    name: K,
    payload: VextHookPayloadMap[K],
  ): VextHookReturn<K> | undefined;
}

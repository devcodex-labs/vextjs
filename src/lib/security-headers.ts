import type { RouteOptions } from "../types/app.js";
import type {
  VextErrorMiddleware,
  VextMiddleware,
} from "../types/middleware.js";
import type { VextRequest } from "../types/request.js";
import type { VextResponse } from "../types/response.js";
import type {
  VextContentSecurityPolicyConfig,
  VextCspDirectiveValue,
  VextHstsConfig,
  VextPermissionsPolicyConfig,
  VextSecurityHeadersConfig,
  VextSecurityHeadersPreset,
} from "../types/security-headers.js";

export type {
  VextContentSecurityPolicyConfig,
  VextCspDirectiveValue,
  VextHstsConfig,
  VextPermissionsPolicyConfig,
  VextSecurityHeadersConfig,
  VextSecurityHeadersPreset,
} from "../types/security-headers.js";

const BASIC_PRESET_HEADERS = {
  contentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
  frameOptions: "SAMEORIGIN",
} as const;

const STRICT_HSTS_MAX_AGE = 15_552_000;

export interface ResolvedSecurityHeadersConfig {
  enabled: boolean;
  preset: VextSecurityHeadersPreset;
  contentTypeOptions?: "nosniff" | false;
  referrerPolicy?: string | false;
  frameOptions?: "DENY" | "SAMEORIGIN" | false;
  hsts?: false | VextHstsConfig;
  contentSecurityPolicy?: false | string | VextContentSecurityPolicyConfig;
  permissionsPolicy?: false | VextPermissionsPolicyConfig;
  crossOriginOpenerPolicy?:
    | false
    | "same-origin"
    | "same-origin-allow-popups"
    | "unsafe-none";
  crossOriginEmbedderPolicy?:
    | false
    | "require-corp"
    | "credentialless"
    | "unsafe-none";
  crossOriginResourcePolicy?:
    | false
    | "same-origin"
    | "same-site"
    | "cross-origin";
  headers?: Record<string, string>;
  skipPaths?: string[];
}

interface ApplySecurityHeadersOptions {
  defaultEnabled?: boolean;
}

/**
 * Applies security headers directly so error and 404 paths can share the same
 * behavior even when they do not run through the normal middleware chain.
 */
export function applySecurityHeaders(
  req: VextRequest,
  res: VextResponse,
  options?: VextSecurityHeadersConfig,
  applyOptions: ApplySecurityHeadersOptions = {},
): void {
  const config = resolveSecurityHeadersConfig(
    options,
    applyOptions.defaultEnabled ?? false,
  );
  if (!config.enabled || shouldSkipSecurityHeaders(req, config)) return;

  const headers = buildSecurityHeaders(req, config);
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
}

export function createSecurityHeadersMiddleware(
  options: VextSecurityHeadersConfig = {},
): VextMiddleware {
  return async (req, res, next) => {
    applySecurityHeaders(req, res, options, { defaultEnabled: true });
    await next();
  };
}

export const securityHeaders = createSecurityHeadersMiddleware;

export function withSecurityHeadersErrorHandler(
  handler: VextErrorMiddleware,
  options?: VextSecurityHeadersConfig,
): VextErrorMiddleware {
  return (err, req, res) => {
    applySecurityHeaders(req, res, options);
    handler(err, req, res);
  };
}

export function withSecurityHeadersNotFoundHandler(
  handler: VextMiddleware,
  options?: VextSecurityHeadersConfig,
): VextMiddleware {
  return async (req, res, next) => {
    applySecurityHeaders(req, res, options);
    await handler(req, res, next);
  };
}

export function resolveSecurityHeadersConfig(
  options: VextSecurityHeadersConfig | undefined,
  defaultEnabled = false,
): ResolvedSecurityHeadersConfig {
  const preset = options?.preset ?? "basic";
  return {
    enabled: options?.enabled ?? defaultEnabled,
    preset,
    contentTypeOptions: options?.contentTypeOptions,
    referrerPolicy: options?.referrerPolicy,
    frameOptions: options?.frameOptions,
    hsts: options?.hsts,
    contentSecurityPolicy: options?.contentSecurityPolicy,
    permissionsPolicy: options?.permissionsPolicy,
    crossOriginOpenerPolicy: options?.crossOriginOpenerPolicy,
    crossOriginEmbedderPolicy: options?.crossOriginEmbedderPolicy,
    crossOriginResourcePolicy: options?.crossOriginResourcePolicy,
    headers: options?.headers,
    skipPaths: options?.skipPaths,
  };
}

export function buildSecurityHeaders(
  req: VextRequest,
  config: ResolvedSecurityHeadersConfig,
): Record<string, string> {
  const headers: Record<string, string> = {};

  applyPreset(headers, req, config);
  applyExplicitHeaders(headers, req, config);

  if (config.headers) {
    for (const [name, value] of Object.entries(config.headers)) {
      setHeader(headers, name, value);
    }
  }

  return headers;
}

function applyPreset(
  headers: Record<string, string>,
  req: VextRequest,
  config: ResolvedSecurityHeadersConfig,
): void {
  if (config.preset === "custom") return;

  setHeader(
    headers,
    "X-Content-Type-Options",
    BASIC_PRESET_HEADERS.contentTypeOptions,
  );
  setHeader(headers, "Referrer-Policy", BASIC_PRESET_HEADERS.referrerPolicy);
  setHeader(headers, "X-Frame-Options", BASIC_PRESET_HEADERS.frameOptions);

  if (config.preset !== "strict") return;

  const hsts = serializeHsts(req, {
    enabled: true,
    maxAge: STRICT_HSTS_MAX_AGE,
  });
  if (hsts) setHeader(headers, "Strict-Transport-Security", hsts);

  setHeader(
    headers,
    "Permissions-Policy",
    serializePermissionsPolicy({
      geolocation: false,
      microphone: false,
      camera: false,
    }),
  );
  setHeader(headers, "Cross-Origin-Opener-Policy", "same-origin");
  setHeader(headers, "Cross-Origin-Resource-Policy", "same-origin");
}

function applyExplicitHeaders(
  headers: Record<string, string>,
  req: VextRequest,
  config: ResolvedSecurityHeadersConfig,
): void {
  setOrDelete(headers, "X-Content-Type-Options", config.contentTypeOptions);
  setOrDelete(headers, "Referrer-Policy", config.referrerPolicy);
  setOrDelete(headers, "X-Frame-Options", config.frameOptions);

  if (config.hsts === false) {
    deleteHeader(headers, "Strict-Transport-Security");
  } else if (config.hsts) {
    const hsts = serializeHsts(req, config.hsts);
    if (hsts) setHeader(headers, "Strict-Transport-Security", hsts);
    else deleteHeader(headers, "Strict-Transport-Security");
  }

  if (config.contentSecurityPolicy === false) {
    deleteHeader(headers, "Content-Security-Policy");
    deleteHeader(headers, "Content-Security-Policy-Report-Only");
  } else if (config.contentSecurityPolicy) {
    const csp = serializeCsp(config.contentSecurityPolicy);
    const headerName =
      typeof config.contentSecurityPolicy === "object" &&
      config.contentSecurityPolicy.reportOnly === true
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy";
    setHeader(headers, headerName, csp);
    deleteHeader(
      headers,
      headerName === "Content-Security-Policy"
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy",
    );
  }

  if (config.permissionsPolicy === false) {
    deleteHeader(headers, "Permissions-Policy");
  } else if (config.permissionsPolicy) {
    setHeader(
      headers,
      "Permissions-Policy",
      serializePermissionsPolicy(config.permissionsPolicy),
    );
  }

  setOrDelete(
    headers,
    "Cross-Origin-Opener-Policy",
    config.crossOriginOpenerPolicy,
  );
  setOrDelete(
    headers,
    "Cross-Origin-Embedder-Policy",
    config.crossOriginEmbedderPolicy,
  );
  setOrDelete(
    headers,
    "Cross-Origin-Resource-Policy",
    config.crossOriginResourcePolicy,
  );
}

function serializeHsts(
  req: VextRequest,
  hsts: VextHstsConfig,
): string | undefined {
  if (hsts.enabled === false) return undefined;
  // HSTS is only safe on HTTPS unless force is explicitly requested.
  if (req.protocol !== "https" && hsts.force !== true) return undefined;

  const maxAge = hsts.maxAge ?? STRICT_HSTS_MAX_AGE;
  const parts = [`max-age=${maxAge}`];
  if (hsts.includeSubDomains) parts.push("includeSubDomains");
  if (hsts.preload) parts.push("preload");
  return parts.join("; ");
}

function serializeCsp(value: string | VextContentSecurityPolicyConfig): string {
  if (typeof value === "string") return value;
  const directives = value.directives ?? {};
  const parts: string[] = [];
  for (const [name, directiveValue] of Object.entries(directives)) {
    const serialized = serializeCspDirective(name, directiveValue);
    if (serialized) parts.push(serialized);
  }
  return parts.join("; ");
}

function serializeCspDirective(
  name: string,
  value: VextCspDirectiveValue,
): string | undefined {
  if (value === false) return undefined;
  if (value === true) return name;
  if (Array.isArray(value)) {
    return value.length > 0 ? `${name} ${value.join(" ")}` : name;
  }
  return value ? `${name} ${value}` : name;
}

function serializePermissionsPolicy(
  value: VextPermissionsPolicyConfig,
): string {
  if (typeof value === "string") return value;
  return Object.entries(value)
    .map(([feature, allowList]) => {
      if (allowList === true) return `${feature}=*`;
      if (allowList === false) return `${feature}=()`;
      return `${feature}=(${allowList.join(" ")})`;
    })
    .join(", ");
}

function shouldSkipSecurityHeaders(
  req: VextRequest,
  config: ResolvedSecurityHeadersConfig,
): boolean {
  const routeOptions = (req as { _routeOptions?: RouteOptions })._routeOptions;
  if (routeOptions?.securityHeaders === false) return true;

  const path = req.path || "/";
  return (config.skipPaths ?? []).some((candidate) =>
    candidate.endsWith("*")
      ? path.startsWith(candidate.slice(0, -1))
      : path === candidate,
  );
}

function setOrDelete(
  headers: Record<string, string>,
  name: string,
  value: string | false | undefined,
): void {
  if (value === undefined) return;
  if (value === false) {
    deleteHeader(headers, name);
    return;
  }
  setHeader(headers, name, value);
}

function setHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  const existing = findHeaderName(headers, name);
  if (existing && existing !== name) delete headers[existing];
  headers[name] = value;
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  const existing = findHeaderName(headers, name);
  if (existing) delete headers[existing];
}

function findHeaderName(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === wanted);
}

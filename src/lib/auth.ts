import { HttpError } from "../types/errors.js";
import type { VextMiddleware } from "../types/middleware.js";
import type { VextRequest } from "../types/request.js";
import type {
  VextAuthContext,
  VextAuthContextSnapshot,
  VextAuthErrorCode,
  VextAuthMiddlewareOptions,
  VextAuthRequirement,
  VextAuthResult,
  VextAuthSource,
  VextPermissionRequirement,
} from "../types/auth.js";
import { requestContext } from "./request-context.js";

type AuthRouteOption = false | true | VextAuthRequirement | undefined;

interface CredentialReadResult {
  credential?: string;
  invalid?: boolean;
}

interface ResolvedPermissionRequirement {
  action: string;
  resource?: string;
  context?: Record<string, unknown>;
}

export type {
  VextAuthCan,
  VextAuthAssert,
  VextAuthContext,
  VextAuthContextSnapshot,
  VextAuthErrorCode,
  VextAuthMiddlewareOptions,
  VextAuthRequirement,
  VextAuthResult,
  VextAuthSource,
  VextPermissionRequirement,
} from "../types/auth.js";

/**
 * Creates the default anonymous auth context present on every request.
 */
export function createAnonymousAuthContext(): VextAuthContext {
  return {
    isAuthenticated: false,
    roles: [],
    scopes: [],
    claims: {},
  };
}

/**
 * Creates an authenticated context from a user provider result.
 */
export function createAuthContext(
  result?: VextAuthResult | null | false,
  defaults: Pick<VextAuthResult, "scheme" | "provider"> = {},
): VextAuthContext {
  if (!result) return createAnonymousAuthContext();

  return {
    isAuthenticated: true,
    subject: result.subject,
    userId: result.userId,
    roles: normalizeStringArray(result.roles),
    scopes: normalizeStringArray(result.scopes),
    claims: isRecord(result.claims) ? { ...result.claims } : {},
    scheme: result.scheme ?? defaults.scheme,
    provider: result.provider ?? defaults.provider,
    can: result.can,
    assert: result.assert,
  };
}

/**
 * Creates an unauthenticated context with a stable auth error code.
 */
export function createInvalidAuthContext(
  error: VextAuthErrorCode = "AUTH_INVALID",
  defaults: Pick<VextAuthResult, "scheme" | "provider"> = {},
): VextAuthContext {
  return {
    ...createAnonymousAuthContext(),
    scheme: defaults.scheme,
    provider: defaults.provider,
    error,
  };
}

/**
 * Assigns req.auth and syncs a safe snapshot into requestContext if enabled.
 */
export function setRequestAuth(
  req: VextRequest,
  authOrResult?: VextAuthContext | VextAuthResult | null | false,
): VextAuthContext {
  const auth = isAuthContext(authOrResult)
    ? cloneAuthContext(authOrResult)
    : createAuthContext(authOrResult);

  req.auth = auth;
  syncRequestContextAuth(auth);
  return auth;
}

/**
 * Ensures req.auth exists for all requests, including public and 404 paths.
 */
export function createAuthContextMiddleware(): VextMiddleware {
  return async (req, _res, next) => {
    if (!req.auth) {
      req.auth = createAnonymousAuthContext();
    }
    syncRequestContextAuth(req.auth);
    await next();
  };
}

/**
 * Creates an authentication middleware. It only identifies the request;
 * route protection is handled by RouteOptions.auth.
 */
export function createAuthMiddleware(
  options: VextAuthMiddlewareOptions,
): VextMiddleware {
  const source = options.source ?? "bearer";
  const defaults = { scheme: source, provider: options.provider };

  return async (req, _res, next) => {
    if (typeof options.verify !== "function") {
      throwAuthError(
        "AUTH_CONFIG_ERROR",
        "Auth middleware requires a verify function",
        500,
      );
    }

    const credential = readCredential(req, options, source);
    if (credential.invalid) {
      setRequestAuth(req, createInvalidAuthContext("AUTH_INVALID", defaults));
      await next();
      return;
    }

    if (credential.credential === undefined && source !== "custom") {
      setRequestAuth(req, createAnonymousAuthContext());
      await next();
      return;
    }

    let result: VextAuthResult | null | false;
    try {
      result = await options.verify(credential.credential, req);
    } catch {
      throwAuthError(
        "AUTH_PROVIDER_ERROR",
        "Auth provider failed",
        500,
      );
    }

    if (!result) {
      const auth =
        credential.credential === undefined && options.optional === true
          ? createAnonymousAuthContext()
          : createInvalidAuthContext("AUTH_INVALID", defaults);
      setRequestAuth(req, auth);
      await next();
      return;
    }

    setRequestAuth(req, createAuthContext(result, defaults));
    await next();
  };
}

export const auth = createAuthMiddleware;

export function normalizeAuthRequirement(
  value: AuthRouteOption,
): VextAuthRequirement | null {
  if (value === undefined || value === false) return null;
  if (value === true) return { required: true, mode: "any" };
  return {
    ...value,
    required: value.required ?? true,
    mode: value.mode ?? "any",
  };
}

export function buildRouteAuthGuardMiddleware(
  value: AuthRouteOption,
): VextMiddleware | null {
  const requirement = normalizeAuthRequirement(value);
  if (!requirement) return null;

  return async (req, _res, next) => {
    await assertRouteAuth(req, requirement);
    await next();
  };
}

export async function assertRouteAuth(
  req: VextRequest,
  requirementInput: VextAuthRequirement,
): Promise<void> {
  const requirement = normalizeAuthRequirement(requirementInput) ?? {};
  const authContext = req.auth ?? setRequestAuth(req, createAnonymousAuthContext());

  if (authContext.error) {
    throwAuthError(
      authContext.error,
      authContext.error === "AUTH_INVALID"
        ? "Invalid authentication credential"
        : "Authentication failed",
      authContext.error === "AUTH_INVALID" ? 401 : 500,
    );
  }

  const hasAuthorizationRule =
    hasItems(requirement.roles) ||
    hasItems(requirement.scopes) ||
    hasItems(requirement.permissions) ||
    typeof requirement.check === "function";
  const requiresAuth = requirement.required !== false || hasAuthorizationRule;

  if (requiresAuth && !authContext.isAuthenticated) {
    throwAuthError("AUTH_REQUIRED", "Authentication required", 401);
  }

  if (!authContext.isAuthenticated) return;

  const mode = requirement.mode ?? "any";
  if (
    hasItems(requirement.roles) &&
    !matchesRequiredValues(authContext.roles, requirement.roles!, mode)
  ) {
    throwAuthError("AUTH_FORBIDDEN", "Forbidden", 403);
  }

  if (
    hasItems(requirement.scopes) &&
    !matchesRequiredValues(authContext.scopes, requirement.scopes!, mode)
  ) {
    throwAuthError("AUTH_FORBIDDEN", "Forbidden", 403);
  }

  if (hasItems(requirement.permissions)) {
    const results = await Promise.all(
      requirement.permissions!.map((permission) =>
        evaluatePermission(req, authContext, permission),
      ),
    );
    const allowed = mode === "all" ? results.every(Boolean) : results.some(Boolean);
    if (!allowed) {
      throwAuthError("AUTH_FORBIDDEN", "Forbidden", 403);
    }
  }

  if (requirement.check) {
    let allowed = false;
    try {
      allowed = await requirement.check(req, authContext);
    } catch {
      throwAuthError(
        "AUTH_PROVIDER_ERROR",
        "Auth check failed",
        500,
      );
    }
    if (!allowed) {
      throwAuthError("AUTH_FORBIDDEN", "Forbidden", 403);
    }
  }
}

export function authRequirementToOpenApiSecurity(
  value: AuthRouteOption,
): Array<Record<string, string[]>> {
  const requirement = normalizeAuthRequirement(value);
  if (!requirement) return [];

  const security = requirement.security;
  if (typeof security === "string") {
    return [{ [security]: [] }];
  }
  if (Array.isArray(security)) {
    if (security.every((item): item is string => typeof item === "string")) {
      return security.map((scheme) => ({ [scheme]: [] }));
    }
    return security as Array<Record<string, string[]>>;
  }
  return [{ bearerAuth: [] }];
}

export function createAuthContextSnapshot(
  authContext: VextAuthContext,
): VextAuthContextSnapshot {
  return {
    isAuthenticated: authContext.isAuthenticated,
    subject: authContext.subject,
    userId: authContext.userId,
    roles: [...authContext.roles],
    scopes: [...authContext.scopes],
    scheme: authContext.scheme,
    provider: authContext.provider,
  };
}

function syncRequestContextAuth(authContext: VextAuthContext): void {
  const store = requestContext.getStore();
  if (store) {
    store.auth = createAuthContextSnapshot(authContext);
  }
}

function readCredential(
  req: VextRequest,
  options: VextAuthMiddlewareOptions,
  source: VextAuthSource,
): CredentialReadResult {
  if (source === "custom") return {};

  if (source === "bearer") {
    const raw = readHeader(req, options.header ?? "authorization");
    if (!raw) return {};
    const match = /^Bearer\s+(.+)$/iu.exec(raw.trim());
    if (!match?.[1]) return { invalid: true };
    return { credential: match[1] };
  }

  if (source === "apiKey") {
    const fromHeader = readHeader(req, options.header ?? "x-api-key");
    if (fromHeader) return { credential: fromHeader };
    if (options.cookie) {
      const fromCookie = req.cookie(options.cookie);
      if (fromCookie) return { credential: fromCookie };
    }
    return {};
  }

  const sessionKey = options.sessionKey ?? "userId";
  const value = req.session?.[sessionKey];
  if (typeof value === "string" && value) return { credential: value };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { credential: String(value) };
  }
  return {};
}

function readHeader(req: VextRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function evaluatePermission(
  req: VextRequest,
  authContext: VextAuthContext,
  permission: VextPermissionRequirement,
): Promise<boolean> {
  const resolved = resolvePermissionRequirement(req, permission);

  if (!authContext.can && !authContext.assert) {
    throwAuthError(
      "AUTH_CONFIG_ERROR",
      "Auth permission check requires can() or assert()",
      500,
    );
  }

  if (authContext.can) {
    try {
      return await authContext.can(
        resolved.action,
        resolved.resource,
        resolved.context,
      );
    } catch {
      throwAuthError(
        "AUTH_PROVIDER_ERROR",
        "Auth permission provider failed",
        500,
      );
    }
  }

  try {
    await authContext.assert!(
      resolved.action,
      resolved.resource,
      resolved.context,
    );
    return true;
  } catch {
    return false;
  }
}

function resolvePermissionRequirement(
  req: VextRequest,
  permission: VextPermissionRequirement,
): ResolvedPermissionRequirement {
  if (typeof permission === "string") {
    return { action: permission };
  }
  return {
    action: permission.action,
    resource:
      typeof permission.resource === "function"
        ? permission.resource(req)
        : permission.resource,
    context:
      typeof permission.context === "function"
        ? permission.context(req)
        : permission.context,
  };
}

function matchesRequiredValues(
  actual: string[],
  required: string[],
  mode: "any" | "all",
): boolean {
  if (required.length === 0) return true;
  const actualSet = new Set(actual);
  return mode === "all"
    ? required.every((value) => actualSet.has(value))
    : required.some((value) => actualSet.has(value));
}

function hasItems<T>(value: T[] | undefined): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

function normalizeStringArray(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item))];
}

function cloneAuthContext(value: VextAuthContext): VextAuthContext {
  return {
    ...value,
    roles: normalizeStringArray(value.roles),
    scopes: normalizeStringArray(value.scopes),
    claims: isRecord(value.claims) ? { ...value.claims } : {},
  };
}

function isAuthContext(value: unknown): value is VextAuthContext {
  return isRecord(value) && typeof value.isAuthenticated === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwAuthError(
  code: VextAuthErrorCode,
  message: string,
  status: number,
): never {
  throw new HttpError(status, message, code);
}

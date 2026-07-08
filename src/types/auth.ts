import type { VextRequest } from "./request.js";

export type VextAuthErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_FORBIDDEN"
  | "AUTH_CONFIG_ERROR"
  | "AUTH_PROVIDER_ERROR";

export type VextAuthSource = "bearer" | "apiKey" | "session" | "custom";

export type VextAuthCan = (
  action: string,
  resource?: string,
  context?: Record<string, unknown>,
) => boolean | Promise<boolean>;

export type VextAuthAssert = (
  action: string,
  resource?: string,
  context?: Record<string, unknown>,
) => void | Promise<void>;

export type VextPermissionRequirement =
  | string
  | {
      action: string;
      resource?:
        | string
        | ((req: VextRequest) => string | undefined);
      context?:
        | Record<string, unknown>
        | ((req: VextRequest) => Record<string, unknown> | undefined);
    };

export interface VextAuthResult {
  subject?: string;
  userId?: string;
  roles?: string[];
  scopes?: string[];
  claims?: Record<string, unknown>;
  scheme?: VextAuthSource;
  provider?: string;
  can?: VextAuthCan;
  assert?: VextAuthAssert;
}

export interface VextAuthContext extends VextAuthResult {
  isAuthenticated: boolean;
  roles: string[];
  scopes: string[];
  claims: Record<string, unknown>;
  error?: VextAuthErrorCode;
}

export interface VextAuthContextSnapshot {
  isAuthenticated: boolean;
  subject?: string;
  userId?: string;
  roles: string[];
  scopes: string[];
  scheme?: VextAuthSource;
  provider?: string;
}

export interface VextAuthMiddlewareOptions {
  source?: VextAuthSource;
  provider?: string;
  header?: string;
  cookie?: string;
  sessionKey?: string;
  optional?: boolean;
  verify(
    credential: string | undefined,
    req: VextRequest,
  ): VextAuthResult | null | false | Promise<VextAuthResult | null | false>;
}

export interface VextAuthRequirement {
  required?: boolean;
  roles?: string[];
  scopes?: string[];
  permissions?: VextPermissionRequirement[];
  mode?: "any" | "all";
  security?: string | string[] | Array<Record<string, string[]>>;
  check?: (
    req: VextRequest,
    auth: VextAuthContext,
  ) => boolean | Promise<boolean>;
}

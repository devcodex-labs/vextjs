import type { CookieSerializeOptions } from "./cookies.js";

export type VextCsrfMode = "auto" | "session" | "signed-cookie";

export type VextCsrfErrorCode =
  | "CSRF_TOKEN_MISSING"
  | "CSRF_TOKEN_INVALID"
  | "CSRF_COOKIE_INVALID"
  | "CSRF_FETCH_METADATA_REJECTED"
  | "CSRF_ORIGIN_REJECTED"
  | "CSRF_CONFIGURATION_ERROR";

export interface VextCsrfCookieConfig
  extends Omit<CookieSerializeOptions, "secure"> {
  name?: string;
  secure?: boolean | "auto";
}

export interface VextCsrfOriginConfig {
  trustedOrigins?: string[];
}

export interface VextCsrfConfig {
  enabled?: boolean;
  mode?: VextCsrfMode;
  secret?: string;
  methods?: string[];
  headerNames?: string[];
  bodyField?: string | false;
  cookie?: VextCsrfCookieConfig;
  fetchMetadata?: boolean;
  origin?: false | VextCsrfOriginConfig;
}

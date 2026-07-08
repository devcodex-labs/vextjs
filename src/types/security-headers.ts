export type VextSecurityHeadersPreset = "basic" | "strict" | "custom";

export interface VextHstsConfig {
  enabled?: boolean;
  maxAge?: number;
  includeSubDomains?: boolean;
  preload?: boolean;
  force?: boolean;
}

export type VextCspDirectiveValue = string | string[] | true | false;

export interface VextContentSecurityPolicyConfig {
  directives?: Record<string, VextCspDirectiveValue>;
  reportOnly?: boolean;
}

export type VextPermissionsPolicyConfig =
  | string
  | Record<string, boolean | string[]>;

export interface VextSecurityHeadersConfig {
  enabled?: boolean;
  preset?: VextSecurityHeadersPreset;
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

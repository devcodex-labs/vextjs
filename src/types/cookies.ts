export type VextCookieSameSite = boolean | "lax" | "strict" | "none";

export type VextCookiePriority = "low" | "medium" | "high";

export interface CookieParseOptions {
  decode?: (value: string) => string;
}

export interface CookieSerializeOptions {
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: VextCookieSameSite;
  priority?: VextCookiePriority;
  partitioned?: boolean;
  encode?: (value: string) => string;
}

export type VextCookieJar = Readonly<Record<string, string>>;

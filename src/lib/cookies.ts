import type {
  CookieParseOptions,
  CookieSerializeOptions,
  VextCookieJar,
} from "../types/cookies.js";
import type { VextHeaders } from "../types/headers.js";
import { appendHeader } from "./headers.js";

export type {
  CookieParseOptions,
  CookieSerializeOptions,
  VextCookieJar,
  VextCookiePriority,
  VextCookieSameSite,
} from "../types/cookies.js";

const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FIELD_CONTENT_RE = /^[\u0009\u0020-\u007e\u0080-\u00ff]*$/;

const DEFAULT_DECODE = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const DEFAULT_ENCODE = (value: string): string => encodeURIComponent(value);

export function parseCookies(
  header: string | string[] | undefined,
  options: CookieParseOptions = {},
): VextCookieJar {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  const cookies: Record<string, string> = {};
  if (!raw) return Object.freeze(cookies);

  const decode = options.decode ?? DEFAULT_DECODE;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;

    const name = trimmed.slice(0, eq).trim();
    if (!name || Object.prototype.hasOwnProperty.call(cookies, name)) {
      continue;
    }

    const value = trimmed.slice(eq + 1).trim();
    Object.defineProperty(cookies, name, {
      value: decode(value),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }

  return Object.freeze(cookies);
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieSerializeOptions = {},
): string {
  assertCookieName(name);

  const encode = options.encode ?? DEFAULT_ENCODE;
  const encodedValue = encode(String(value));
  assertCookieValue(encodedValue);

  const parts = [`${name}=${encodedValue}`];

  if (options.maxAge !== undefined) {
    if (!Number.isFinite(options.maxAge)) {
      throw new TypeError("Cookie maxAge must be a finite number");
    }
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }

  if (options.domain) {
    assertFieldContent(options.domain, "Cookie domain");
    parts.push(`Domain=${options.domain}`);
  }

  if (options.path) {
    assertFieldContent(options.path, "Cookie path");
    parts.push(`Path=${options.path}`);
  }

  if (options.expires) {
    if (!Number.isFinite(options.expires.valueOf())) {
      throw new TypeError("Cookie expires must be a valid Date");
    }
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");

  if (options.sameSite !== undefined && options.sameSite !== false) {
    const sameSite =
      options.sameSite === true
        ? "Strict"
        : normalizeSameSite(options.sameSite);
    parts.push(`SameSite=${sameSite}`);
  }

  if (options.priority) {
    parts.push(`Priority=${normalizePriority(options.priority)}`);
  }

  if (options.partitioned) {
    parts.push("Partitioned");
  }

  return parts.join("; ");
}

export function serializeClearCookie(
  name: string,
  options: CookieSerializeOptions = {},
): string {
  return serializeCookie(name, "", {
    ...options,
    expires: new Date(0),
    maxAge: 0,
  });
}

export function appendSetCookie(headers: VextHeaders, cookie: string): void {
  appendHeader(headers, "Set-Cookie", cookie);
}

function assertCookieName(name: string): void {
  if (!TOKEN_RE.test(name)) {
    throw new TypeError(`Invalid cookie name: ${name}`);
  }
}

function assertCookieValue(value: string): void {
  if (!FIELD_CONTENT_RE.test(value) || /[;,\r\n]/.test(value)) {
    throw new TypeError("Invalid cookie value");
  }
}

function assertFieldContent(value: string, label: string): void {
  if (!FIELD_CONTENT_RE.test(value) || /[\r\n;]/.test(value)) {
    throw new TypeError(`${label} contains invalid characters`);
  }
}

function normalizeSameSite(
  value: Exclude<CookieSerializeOptions["sameSite"], boolean | undefined>,
): string {
  switch (value.toLowerCase()) {
    case "lax":
      return "Lax";
    case "strict":
      return "Strict";
    case "none":
      return "None";
    default:
      throw new TypeError(`Invalid SameSite value: ${value}`);
  }
}

function normalizePriority(
  value: NonNullable<CookieSerializeOptions["priority"]>,
): string {
  switch (value.toLowerCase()) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    default:
      throw new TypeError(`Invalid cookie priority: ${value}`);
  }
}

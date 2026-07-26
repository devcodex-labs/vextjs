/**
 * Shared redirect safety helpers for all adapters.
 *
 * Guarantees:
 *   - Location is free of CR/LF/NUL (header-injection boundary)
 *   - Non-ASCII / non-header-safe bytes are percent-encoded so
 *     Node's setHeader / validateHeaderValue never throws mid-send
 *   - Already-percent-encoded sequences and ASCII URI structure are preserved
 *   - Only 301/302/303/307/308 are accepted; everything else coerces to 302
 */

import { HttpError } from "../types/errors.js";

export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

const ALLOWED_REDIRECT_STATUSES = new Set<number>([301, 302, 303, 307, 308]);

/** CR, LF, or NUL — must be rejected, not percent-encoded away. */
const UNSAFE_LOCATION_CHARS = /[\r\n\u0000]/;

/**
 * Normalize a redirect status code.
 *
 * Allowed: 301, 302, 303, 307, 308.
 * Missing / invalid values coerce to 302 (never hang or leak a raw 999).
 */
export function normalizeRedirectStatus(
  status?: number | null,
): RedirectStatus {
  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    ALLOWED_REDIRECT_STATUSES.has(status)
  ) {
    return status as RedirectStatus;
  }
  return 302;
}

/**
 * Encode characters that Node's validateHeaderValue rejects, while keeping
 * ASCII (including `%` of already-encoded sequences) and HTAB intact.
 *
 * Using whole-string `encodeURI` would re-encode `%` → `%25` and break
 * pre-encoded Locations.
 */
function encodeLocationHeaderValue(url: string): string {
  let out = "";
  for (const char of url) {
    const code = char.codePointAt(0)!;
    // HTAB or printable ASCII — safe for HTTP header values
    if (code === 0x09 || (code >= 0x20 && code <= 0x7e)) {
      out += char;
      continue;
    }
    out += encodeURIComponent(char);
  }
  return out;
}

/**
 * Normalize a redirect Location value.
 *
 * - Rejects CR/LF/NUL with a TypeError (bounded failure before send)
 * - Percent-encodes non-ASCII so the value is a valid HTTP header token
 *   for Node's validateHeaderValue / setHeader
 * - Leaves already-encoded sequences and URI-reserved ASCII intact
 *
 * @throws {TypeError} when location is not a string or contains CR/LF/NUL
 */
export function normalizeRedirectLocation(url: string): string {
  if (typeof url !== "string") {
    throw new HttpError(
      400,
      "redirect location must be a string",
      400,
    );
  }

  if (UNSAFE_LOCATION_CHARS.test(url)) {
    // Public 400 without stack noise so link/packed adapter parity holds.
    throw new HttpError(
      400,
      "redirect location must not contain CR, LF, or NUL characters",
      400,
    );
  }

  return encodeLocationHeaderValue(url);
}

/**
 * Prepare redirect status + Location for adapters.
 * Call this *before* marking the response as sent.
 */
export function prepareRedirect(
  url: string,
  status?: number | null,
): { location: string; status: RedirectStatus } {
  return {
    location: normalizeRedirectLocation(url),
    status: normalizeRedirectStatus(status),
  };
}

import type { ResolvedVextFrontendConfig } from "../contract/types.js";
import type { VextRequest } from "../../types/request.js";
import {
  matchLocale,
  negotiateLocale,
  requestLocaleResolution,
} from "../../lib/i18n/locale-resolution.js";

export interface FrontendLocaleResolution {
  locale: string;
  vary: string[];
  noStore: boolean;
}

/** The renderer and freshness lookup use the same request language identity. */
export function resolveFrontendLocale(
  config: ResolvedVextFrontendConfig["i18n"],
  available: readonly string[],
  req?: VextRequest,
  explicit?: string,
): FrontendLocaleResolution {
  if (!config.enabled)
    return { locale: explicit ?? "", vary: [], noStore: false };
  const fallback =
    matchLocale(config.defaultLocale, available) ?? available[0] ?? "en-US";
  const vary: string[] = [];
  let locale: string | undefined;
  let noStore = false;
  if (config.defaultLocale === "inherit" && req?.locale) {
    locale = matchLocale(req.locale, available);
    if (locale) {
      const inherited = requestLocaleResolution(req);
      if (inherited) vary.push(...inherited.vary);
      else noStore = true; // A custom/identity-derived locale has no public cache contract.
    }
  }
  if (!locale && req) {
    for (const source of config.detect) {
      if (source === "accept-language") {
        vary.push("Accept-Language");
        locale = negotiateLocale(req.headers["accept-language"], available);
      } else if (source === "header" || source === "x-vext-locale") {
        vary.push("X-Vext-Locale");
        locale = matchLocale(req.headers["x-vext-locale"], available);
      } else if (source === "query") {
        locale = matchLocale(req.query?.locale, available);
      } else if (source === "cookie") {
        vary.push("Cookie");
        locale = matchLocale(req.cookie("locale"), available);
        if (locale) noStore = true;
      }
      if (locale) break;
    }
  }
  const automatic = locale ?? fallback;
  const override =
    explicit && explicit !== "inherit"
      ? (matchLocale(explicit, available) ?? fallback)
      : undefined;
  if (override && override !== automatic) {
    const urlLocale = matchLocale(
      req?.query?.locale ?? req?.params?.locale,
      available,
    );
    if (urlLocale !== override) noStore = true;
  }
  return {
    locale: override ?? automatic,
    vary: config.vary ? [...new Set(vary)] : [],
    noStore,
  };
}

export function applyLocaleHeaders(
  headers: Record<string, string>,
  resolution: FrontendLocaleResolution,
): void {
  const keys = Object.keys(headers).filter(
    (key) => key.toLowerCase() === "vary",
  );
  const existing = keys.flatMap((key) =>
    headers[key]!.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (existing.includes("*")) return;
  const values = new Map(existing.map((value) => [value.toLowerCase(), value]));
  for (const value of resolution.vary) values.set(value.toLowerCase(), value);
  if (values.size) {
    for (const key of keys) delete headers[key];
    headers.Vary = [...values.values()].join(", ");
  }
}

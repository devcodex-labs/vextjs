import { requestContext } from "../request-context.js";
import type { VextApp, VextLocaleConfig } from "../../types/app.js";
import { bindRequestLocaleOwner } from "../i18n/app-runtime.js";
import type { VextMiddleware } from "../../types/middleware.js";
import {
  negotiateLocale,
  recordRequestLocale,
} from "../i18n/locale-resolution.js";

/** 请求语言和显式传播头有独立生命周期，不受 requestId.enabled 控制。 */
export function createRequestMetadataMiddleware(
  propagateHeaderNames: string[] = [],
  localeConfig?: VextLocaleConfig,
  app?: VextApp,
): VextMiddleware {
  const headers = propagateHeaderNames.map((name) => name.toLowerCase());
  const defaultLocale = localeConfig?.default ?? "en-US";
  const supported = new Map(
    (localeConfig?.supported ?? []).map((locale) => [
      locale.toLowerCase(),
      locale,
    ]),
  );
  return async (req, _res, next) => {
    const locale =
      negotiateLocale(req.headers["accept-language"], [
        ...supported.values(),
      ]) ?? defaultLocale;
    recordRequestLocale(
      req,
      locale,
      supported.size > 0 ? ["Accept-Language"] : [],
    );
    const store = requestContext.getStore();
    if (store) {
      if (app) bindRequestLocaleOwner(app);
      store.locale = locale;
      if (headers.length > 0) {
        const captured: Record<string, string> = {};
        for (const key of headers) {
          const raw = req.headers[key];
          const value = Array.isArray(raw) ? raw[0] : raw;
          if (value) captured[key] = value;
        }
        if (Object.keys(captured).length > 0)
          store.propagatedHeaders = captured;
      }
    }
    await next();
  };
}

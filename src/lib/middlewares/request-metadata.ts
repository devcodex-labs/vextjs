import { requestContext } from "../request-context.js";
import type { VextApp, VextLocaleConfig } from "../../types/app.js";
import { bindRequestLocaleOwner } from "../i18n/app-runtime.js";
import type { VextMiddleware } from "../../types/middleware.js";

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
    const store = requestContext.getStore();
    if (store) {
      if (app) bindRequestLocaleOwner(app);
      const accept = req.headers["accept-language"];
      store.locale =
        accept && supported.size > 0
          ? parseAcceptLanguage(accept, supported, defaultLocale)
          : defaultLocale;
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

// 保留既有精确优先、语言前缀其次、默认值兜底的协商规则。
function parseAcceptLanguage(
  header: string,
  supportedMap: Map<string, string>,
  defaultLocale: string,
): string {
  // 解析为 { locale, quality } 数组并按 quality 降序排列
  const parts = header
    .split(",")
    .map((part) => {
      const segments = part.trim().split(";");
      const localeStr = segments[0]?.trim().toLowerCase() ?? "";
      const qParam = segments.slice(1).find((p) => p.trim().startsWith("q="));
      const quality = qParam ? parseFloat(qParam.trim().slice(2)) : 1.0;
      return { locale: localeStr, quality };
    })
    .filter((p) => p.quality > 0 && p.locale !== "*")
    .sort((a, b) => b.quality - a.quality);

  // 1. 精确匹配
  for (const { locale } of parts) {
    const match = supportedMap.get(locale);
    if (match) return match;
  }

  // 2. 前缀匹配（如 "zh" 匹配 "zh-CN"）
  for (const { locale } of parts) {
    const prefix = locale.split("-")[0] ?? locale;
    for (const [key, value] of supportedMap) {
      if (key.startsWith(prefix)) return value;
    }
  }

  // 3. 无匹配 → 默认值
  return defaultLocale;
}

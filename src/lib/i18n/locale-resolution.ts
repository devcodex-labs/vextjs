import type { VextRequest } from "../../types/request.js";

export function matchLocale(
  value: string | undefined,
  available: readonly string[],
): string | undefined {
  if (!value || value === "inherit") return undefined;
  const lower = value.toLowerCase();
  return (
    available.find((locale) => locale.toLowerCase() === lower) ??
    available.find(
      (locale) => locale.toLowerCase().split("-")[0] === lower.split("-")[0],
    )
  );
}

export function negotiateLocale(
  header: string | undefined,
  available: readonly string[],
): string | undefined {
  if (!header) return undefined;
  const preferences = header
    .split(",")
    .map((part) => {
      const [language, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      const weight =
        quality === undefined ? 1 : Number(quality.trim().slice(2));
      return { language, weight };
    })
    .filter(
      ({ language, weight }) =>
        language !== "*" &&
        Number.isFinite(weight) &&
        weight > 0 &&
        weight <= 1,
    )
    .sort((left, right) => right.weight - left.weight);
  for (const { language } of preferences) {
    const match = matchLocale(language, available);
    if (match) return match;
  }
  return undefined;
}

const resolutions = new WeakMap<
  VextRequest,
  { locale: string; vary: string[] }
>();
export function recordRequestLocale(
  req: VextRequest,
  locale: string,
  vary: string[],
): void {
  req.locale = locale;
  resolutions.set(req, { locale, vary });
}
export function requestLocaleResolution(
  req: VextRequest,
): { locale: string; vary: string[] } | undefined {
  const resolution = resolutions.get(req);
  return resolution?.locale === req.locale ? resolution : undefined;
}

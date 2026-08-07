import type {
  VextDefinedFont,
  VextFontDefinition,
  VextFontFallbackMetrics,
} from "./types.js";

export function defineFont(input: VextFontDefinition): VextDefinedFont {
  if (!input.src || isRemoteSource(input.src)) {
    throw new Error(
      "[vextjs] defineFont() only accepts a local font source; remote font URLs are never fetched by Vext.",
    );
  }
  if (!input.family.trim()) {
    throw new Error("[vextjs] defineFont() requires a non-empty family.");
  }
  if (!input.license.trim()) {
    throw new Error(
      "[vextjs] defineFont() requires a license identifier or application-owned license reference.",
    );
  }
  const fallback = normalizeFallback(input.fallback);
  return Object.freeze({
    __vextFont: true as const,
    ...input,
    axes: input.axes ? Object.freeze({ ...input.axes }) : {},
    fallback,
    fallbackFamily: fallback.family,
    display: input.display ?? "swap",
    preload: input.preload ?? false,
    style: input.style ?? "normal",
    weight: String(input.weight ?? "400"),
  });
}

export function normalizeFallback(
  value: VextFontDefinition["fallback"],
): VextFontFallbackMetrics {
  if (typeof value === "string") return { family: value };
  return {
    family: value?.family || "system-ui",
    sizeAdjust: value?.sizeAdjust,
    ascentOverride: value?.ascentOverride,
    descentOverride: value?.descentOverride,
    lineGapOverride: value?.lineGapOverride,
  };
}

function isRemoteSource(value: string): boolean {
  return /^https?:\/\//iu.test(value.trim());
}

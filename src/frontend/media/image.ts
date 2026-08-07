import { createElement } from "react";
import type { ImgHTMLAttributes } from "react";
import { findVextMediaImage, getVextMediaManifest } from "./runtime.js";
import type {
  VextFrontendMediaVariant,
  VextImageRemoteLoader,
} from "./types.js";

export interface VextImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height"
> {
  src: string;
  width?: number;
  height?: number;
  quality?: number;
  priority?: boolean;
  loader?: VextImageRemoteLoader;
}

export function defineImageLoader(
  input: VextImageRemoteLoader,
): VextImageRemoteLoader {
  if (!Array.isArray(input.allowlist) || input.allowlist.length === 0) {
    throw new Error(
      "[vextjs] defineImageLoader() requires a non-empty remote hostname allowlist.",
    );
  }
  if (typeof input.load !== "function") {
    throw new Error("[vextjs] defineImageLoader() requires a load() function.");
  }
  return Object.freeze({
    name: input.name,
    allowlist: Object.freeze([...input.allowlist]),
    load: input.load,
  });
}

export function Image(props: VextImageProps) {
  const {
    src,
    width,
    height,
    quality,
    priority = false,
    loader,
    loading: requestedLoading,
    decoding: requestedDecoding,
    sizes: requestedSizes,
    srcSet: _ignoredSrcSet,
    fetchPriority: _ignoredFetchPriority,
    style,
    ...rest
  } = props;

  if (isRemoteSource(src)) {
    return createElement("img", {
      ...rest,
      src: resolveRemoteImage(src, width, quality, loader),
      width,
      height,
      loading: priority ? "eager" : (requestedLoading ?? "lazy"),
      decoding: requestedDecoding ?? "async",
      fetchPriority: priority ? "high" : undefined,
    });
  }

  const image = findVextMediaImage(getVextMediaManifest(), src);
  if (!image) {
    throw new Error(
      `[vextjs] Image source "${src}" is not present in the local media manifest. Keep the input under config.frontend.assetsDir and rebuild.`,
    );
  }
  const priorityVariants = image.variants.filter(
    (variant) => variant.format === "webp",
  );
  const fallbackVariants =
    priority && priorityVariants.length > 0
      ? priorityVariants
      : image.variants.filter(
          (variant) => variant.format === image.originalFormat,
        );
  const fallback = selectVariant(
    fallbackVariants.length > 0 ? fallbackVariants : image.variants,
    width ?? image.width,
  );
  const srcSet = (
    fallbackVariants.length > 0 ? fallbackVariants : image.variants
  )
    .map((variant) => `${variant.src} ${variant.width}w`)
    .join(", ");
  const imageElement = createElement("img", {
    ...rest,
    src: fallback.src,
    srcSet,
    sizes: requestedSizes ?? "100vw",
    width: width ?? image.width,
    height: height ?? image.height,
    loading: priority ? "eager" : (requestedLoading ?? "lazy"),
    decoding: requestedDecoding ?? "async",
    fetchPriority: priority ? "high" : undefined,
    "data-vext-image-placeholder": image.placeholder,
    style: {
      backgroundColor: "#f3f4f6",
      ...style,
    },
  });
  const sourceElements = priority
    ? []
    : [...new Set(image.variants.map((variant) => variant.format))]
        .filter((format) => format !== image.originalFormat)
        .map((format) => {
          const variants = image.variants.filter(
            (variant) => variant.format === format,
          );
          return createElement("source", {
            key: format,
            type: `image/${format}`,
            srcSet: variants
              .map((variant) => `${variant.src} ${variant.width}w`)
              .join(", "),
            sizes: requestedSizes ?? "100vw",
          });
        });
  return sourceElements.length > 0
    ? createElement("picture", null, ...sourceElements, imageElement)
    : imageElement;
}

function selectVariant(
  variants: readonly VextFrontendMediaVariant[],
  requestedWidth: number,
): VextFrontendMediaVariant {
  const candidates = [...variants].sort(
    (left, right) => left.width - right.width,
  );
  return (
    candidates.find((variant) => variant.width >= requestedWidth) ??
    candidates[candidates.length - 1]!
  );
}

function resolveRemoteImage(
  src: string,
  width: number | undefined,
  quality: number | undefined,
  loader: VextImageRemoteLoader | undefined,
): string {
  if (!loader) {
    throw new Error(
      "[vextjs] Remote Image sources require an explicit defineImageLoader() allowlist; Vext never fetches or proxies remote image URLs.",
    );
  }
  const hostname = new URL(src).hostname.toLowerCase();
  if (!loader.allowlist.some((entry) => matchesAllowedHost(hostname, entry))) {
    throw new Error(
      `[vextjs] Remote Image source host "${hostname}" is outside the explicit loader allowlist.`,
    );
  }
  const resolved = loader.load({
    src,
    width: Math.max(1, Math.trunc(width ?? 1)),
    quality: Math.max(1, Math.min(100, Math.trunc(quality ?? 75))),
  });
  if (!/^https?:\/\//iu.test(resolved)) {
    throw new Error(
      "[vextjs] Image loader must return an absolute http(s) URL.",
    );
  }
  return resolved;
}

function matchesAllowedHost(hostname: string, rule: string): boolean {
  const normalized = rule.trim().toLowerCase().replace(/^\./u, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function isRemoteSource(value: string): boolean {
  return /^https?:\/\//iu.test(value.trim());
}

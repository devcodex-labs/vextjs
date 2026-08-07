export type VextMediaRasterFormat = "avif" | "jpeg" | "png" | "webp";

export interface VextFrontendMediaVariant {
  file: string;
  src: string;
  width: number;
  height: number;
  format: VextMediaRasterFormat;
  quality: number;
  bytes: number;
  sha256: string;
  integrity: string;
  contentType: string;
}

export interface VextFrontendMediaImage {
  source: string;
  width: number;
  height: number;
  originalFormat: VextMediaRasterFormat;
  placeholder: string;
  variants: VextFrontendMediaVariant[];
}

export interface VextFontFallbackMetrics {
  family: string;
  sizeAdjust?: string;
  ascentOverride?: string;
  descentOverride?: string;
  lineGapOverride?: string;
}

export interface VextFontVariationAxisRange {
  min?: number;
  max?: number;
  default?: number;
}

export type VextFontVariationAxis = number | VextFontVariationAxisRange;

export interface VextFontDefinition {
  src: string;
  family: string;
  weight?: string | number;
  style?: "normal" | "italic" | "oblique" | string;
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
  preload?: boolean;
  fallback?: string | VextFontFallbackMetrics;
  subset?: string;
  unicodeRange?: string;
  axes?: Record<string, VextFontVariationAxis>;
  /** SPDX identifier or an application-owned license reference. */
  license: string;
}

export interface VextDefinedFont extends Readonly<VextFontDefinition> {
  readonly __vextFont: true;
  readonly fallbackFamily: string;
}

export interface VextFrontendMediaFont {
  id: string;
  source: string;
  file: string;
  src: string;
  family: string;
  weight: string;
  style: string;
  display: string;
  preload: boolean;
  fallback: VextFontFallbackMetrics;
  subset: string;
  unicodeRange?: string;
  axes: Record<string, VextFontVariationAxis>;
  license: string;
  bytes: number;
  sha256: string;
  integrity: string;
  contentType: "font/woff2";
}

export interface VextFrontendMediaManifest {
  schemaVersion: 1;
  kind: "frontend-media-manifest";
  generatedAt: string;
  assetBaseUrl: string;
  totalBytes: number;
  images: VextFrontendMediaImage[];
  fonts: VextFrontendMediaFont[];
}

export interface VextImageRemoteLoaderInput {
  src: string;
  width: number;
  quality: number;
}

export interface VextImageRemoteLoader {
  readonly allowlist: readonly string[];
  readonly name?: string;
  readonly load: (input: VextImageRemoteLoaderInput) => string;
}

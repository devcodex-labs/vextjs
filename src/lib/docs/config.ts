import type {
  VextDocsAccessMode,
  VextDocsCodeScanMode,
  VextDocsDefaultView,
  VextDocsRendererName,
} from "./types.js";

export const DEFAULT_DOCS_PATH = "/docs";
export const DEFAULT_DOCS_ASSETS_PATH = "/_vext/docs";
export const DEFAULT_OPENAPI_SPEC_PATH = "/openapi.json";
export const DEFAULT_DOCS_RENDERER: VextDocsRendererName = "vext";

export const VEXT_DOCS_DEFAULT_VIEWS = [
  "overview",
  "api",
  "code",
] as const satisfies readonly VextDocsDefaultView[];

export const VEXT_DOCS_CODE_SCAN_MODES = [
  "lazy",
  "background",
] as const satisfies readonly VextDocsCodeScanMode[];

export const VEXT_DOCS_ACCESS_MODES = [
  "off",
  "visibility-only",
  "enforce",
] as const satisfies readonly VextDocsAccessMode[];

export const VEXT_DOCS_OPENAPI_JSON_MODES = [
  "filtered",
  "public",
] as const;

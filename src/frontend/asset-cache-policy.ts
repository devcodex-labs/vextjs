export const FRONTEND_INDEX_CACHE_CONTROL = "no-cache";
export const FRONTEND_REVALIDATE_CACHE_CONTROL =
  "no-cache, max-age=0, must-revalidate";
export const FRONTEND_IMMUTABLE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

export function getFrontendStaticCacheControl(
  file: string,
  assetsDir: string,
): string {
  const normalized = normalizeFrontendAssetFile(file);
  if (normalized === "index.html") return FRONTEND_INDEX_CACHE_CONTROL;
  if (isImmutableFrontendBundleAsset(normalized, assetsDir)) {
    return FRONTEND_IMMUTABLE_CACHE_CONTROL;
  }
  return FRONTEND_REVALIDATE_CACHE_CONTROL;
}

export function isImmutableFrontendBundleAsset(
  file: string,
  assetsDir: string,
): boolean {
  const normalized = normalizeFrontendAssetFile(file);
  const normalizedAssetsDir = normalizeFrontendAssetFile(assetsDir).replace(
    /\/+$/u,
    "",
  );
  if (!normalizedAssetsDir) return false;
  if (!normalized.startsWith(`${normalizedAssetsDir}/`)) return false;
  if (normalized.endsWith(".map")) return false;
  return hasContentHash(normalized);
}

function normalizeFrontendAssetFile(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/u, "");
}

function hasContentHash(file: string): boolean {
  const filename = file.split("/").pop() ?? "";
  const nameWithoutExtension = filename.replace(/\.[^.]+$/u, "");
  return /(?:^|[-_.])[A-Za-z0-9_-]{8,}(?:$|[-_.])/u.test(nameWithoutExtension);
}

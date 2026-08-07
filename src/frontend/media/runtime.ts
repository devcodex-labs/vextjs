import type {
  VextFrontendMediaImage,
  VextFrontendMediaManifest,
} from "./types.js";

export const VEXT_MEDIA_MANIFEST_SCRIPT_ID = "__VEXT_MEDIA_MANIFEST__";
const VEXT_MEDIA_CONTEXT_KEY = "__VEXT_MEDIA_CONTEXT__";

let browserManifest: VextFrontendMediaManifest | undefined;

export function getVextMediaManifest(): VextFrontendMediaManifest | undefined {
  const context = (
    globalThis as typeof globalThis & {
      [VEXT_MEDIA_CONTEXT_KEY]?: () => VextFrontendMediaManifest | undefined;
    }
  )[VEXT_MEDIA_CONTEXT_KEY]?.();
  if (isMediaManifest(context)) return context;
  if (browserManifest) return browserManifest;
  const documentLike = (
    globalThis as typeof globalThis & {
      document?: {
        getElementById(id: string): { textContent: string | null } | null;
      };
    }
  ).document;
  if (!documentLike) return undefined;
  const script = documentLike.getElementById(VEXT_MEDIA_MANIFEST_SCRIPT_ID);
  if (!script?.textContent) return undefined;
  try {
    const parsed: unknown = JSON.parse(script.textContent);
    if (isMediaManifest(parsed)) {
      browserManifest = parsed;
      return parsed;
    }
  } catch {
    // The document owns the manifest and a malformed payload remains an absent manifest.
  }
  return undefined;
}

export function findVextMediaImage(
  manifest: VextFrontendMediaManifest | undefined,
  source: string,
): VextFrontendMediaImage | undefined {
  if (!manifest) return undefined;
  const normalized = normalizeMediaSource(source);
  return manifest.images.find(
    (image) => normalizeMediaSource(image.source) === normalized,
  );
}

export function normalizeMediaSource(value: string): string {
  const withoutQuery = value.split(/[?#]/u, 1)[0] ?? value;
  return withoutQuery.replace(/\\/gu, "/").replace(/^\.?(?:\/)+/u, "");
}

function isMediaManifest(value: unknown): value is VextFrontendMediaManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VextFrontendMediaManifest>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.kind === "frontend-media-manifest" &&
    Array.isArray(candidate.images) &&
    Array.isArray(candidate.fonts)
  );
}

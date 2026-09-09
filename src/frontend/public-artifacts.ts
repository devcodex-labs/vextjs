import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { normalizeSafeRelativePath } from "../lib/path-boundary.js";

export const FRONTEND_PUBLIC_MANIFEST = "public-manifest.json";

/** Internal build records are never browser assets, even under a custom outDir. */
export const FRONTEND_INTERNAL_FILES = new Set([
  FRONTEND_PUBLIC_MANIFEST,
  "deploy-manifest.json",
  "manifest.json",
  "messages-manifest.json",
  "media-manifest.json",
  "render-manifest.json",
  "size-report.json",
  "static-manifest.json",
  "client-contract.json",
  "route-contract.json",
  "api.generated.ts",
]);

export interface FrontendPublicManifest {
  schemaVersion: 1;
  kind: "frontend-public-manifest";
  buildId: string;
  files: string[];
}

export function readFrontendPublicFiles(
  outDir: string,
  required = true,
): ReadonlySet<string> {
  const file = path.join(outDir, FRONTEND_PUBLIC_MANIFEST);
  if (!required && !existsSync(file)) return new Set();
  try {
    const value = JSON.parse(
      readFileSync(file, "utf8"),
    ) as FrontendPublicManifest;
    if (
      value?.schemaVersion !== 1 ||
      value.kind !== "frontend-public-manifest" ||
      typeof value.buildId !== "string" ||
      !Array.isArray(value.files)
    ) {
      throw new Error("invalid public artifact manifest");
    }
    const files = value.files.map((file) => {
      if (
        typeof file !== "string" ||
        normalizeSafeRelativePath(file, "public artifact") !== file ||
        FRONTEND_INTERNAL_FILES.has(file.toLowerCase())
      ) {
        throw new Error("invalid public artifact path");
      }
      return file;
    });
    return new Set(files);
  } catch (error) {
    throw new Error(
      `[vextjs] frontend ${FRONTEND_PUBLIC_MANIFEST} is missing or invalid. Run "vext build" again.`,
      { cause: error },
    );
  }
}

/** Development rebuilds replace the list; a handler must not retain an old allowlist. */
export function createFrontendPublicFileReader(
  outDir: string,
): () => ReadonlySet<string> {
  let signature: string | undefined;
  let files: ReadonlySet<string> = new Set();
  return () => {
    const file = path.join(outDir, FRONTEND_PUBLIC_MANIFEST);
    if (!existsSync(file)) {
      signature = undefined;
      return new Set();
    }
    const stat = statSync(file);
    const next = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    if (next !== signature) {
      files = readFrontendPublicFiles(outDir);
      signature = next;
    }
    return files;
  };
}

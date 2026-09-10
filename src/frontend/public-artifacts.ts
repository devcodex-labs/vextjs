import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { normalizeSafeRelativePath } from "../lib/path-boundary.js";
import { readProjectFile } from "../lib/project/read-project-file.js";

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

/** 解析与I/O分离，构建位置可以对同一份清单字节计算摘要并验证内容。 */
export function parseFrontendPublicManifest(
  bytes: Uint8Array,
): FrontendPublicManifest {
  const value = JSON.parse(
    Buffer.from(bytes).toString("utf8"),
  ) as FrontendPublicManifest;
  if (
    value?.schemaVersion !== 1 ||
    value.kind !== "frontend-public-manifest" ||
    typeof value.buildId !== "string" ||
    !value.buildId ||
    value.buildId.length > 128 ||
    !Array.isArray(value.files) ||
    value.files.length > 50_000
  )
    throw new Error("invalid public artifact manifest");
  const identities = new Set<string>();
  for (const file of value.files) {
    if (
      typeof file !== "string" ||
      normalizeSafeRelativePath(file, "public artifact") !== file ||
      FRONTEND_INTERNAL_FILES.has(file.toLowerCase())
    )
      throw new Error("invalid public artifact path");
    const identity = process.platform === "win32" ? file.toLowerCase() : file;
    if (identities.has(identity))
      throw new Error("duplicate public artifact path");
    identities.add(identity);
  }
  return value;
}

export function readFrontendPublicManifest(
  outDir: string,
): FrontendPublicManifest {
  try {
    const bytes = readProjectFile(
      outDir,
      FRONTEND_PUBLIC_MANIFEST,
      8 * 1024 * 1024,
    );
    if (!bytes) throw new Error("missing public artifact manifest");
    return parseFrontendPublicManifest(bytes);
  } catch (error) {
    throw new Error(
      `[vextjs] frontend ${FRONTEND_PUBLIC_MANIFEST} is missing or invalid. Run "vext build" again.`,
      { cause: error },
    );
  }
}

export function readFrontendPublicFiles(
  outDir: string,
  required = true,
): ReadonlySet<string> {
  if (!required && !existsSync(path.join(outDir, FRONTEND_PUBLIC_MANIFEST)))
    return new Set();
  return new Set(readFrontendPublicManifest(outDir).files);
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

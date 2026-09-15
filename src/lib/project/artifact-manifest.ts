import { createHash } from "node:crypto";
import path from "node:path";
import { ProjectFileReadError, readProjectFile } from "./read-project-file.js";
import {
  assertPathInside,
  assertRealPathInside,
  assertExplicitOutputDirectory,
  canonicalPath,
  physicalPath,
  isPathInside,
  normalizeSafeRelativePath,
} from "../path-boundary.js";

export const ARTIFACT_STATE_DIRECTORY = ".vext/freshness/v1";
export const ARTIFACT_MANIFEST_FILE = `${ARTIFACT_STATE_DIRECTORY}/artifacts.json`;
export const ARTIFACT_JOURNAL_FILE = `${ARTIFACT_STATE_DIRECTORY}/transaction.json`;
export const MAX_ARTIFACT_FILES = 50_000;
export const MAX_ARTIFACT_METADATA_BYTES = 16 * 1024 * 1024;

export class ArtifactError extends Error {
  constructor(
    public readonly code: "VEXT_OUTPUT_CONFLICT" | "VEXT_OUTPUT_UNVERIFIED",
    message: string,
  ) {
    super(`[vextjs] ${code}: ${message}`);
    this.name = "ArtifactError";
  }
}

export interface ArtifactFile {
  /** 项目内为相对路径；显式外部scope使用规范化绝对路径。保存字节身份。 */
  path: string;
  sha256: string;
  source?: string;
}

export interface ArtifactScope {
  id: string;
  producer: string;
  outputDir: string;
  producerVersion: string;
  inputDigest: string | null;
  generation: number;
  files: ArtifactFile[];
}

export interface ArtifactManifest {
  schemaVersion: 1;
  realRoot: string;
  scopes: ArtifactScope[];
}

export function artifactDigest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isArtifactDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function artifactPath(
  root: string,
  relative: string,
  allowExternal = false,
): string {
  if (allowExternal && path.isAbsolute(relative)) {
    const target = path.resolve(relative);
    const normalized = canonicalPath(target).replaceAll("\\", "/");
    const input = canonicalPath(relative).replaceAll("\\", "/");
    const identity = process.platform === "win32" ? input.toLowerCase() : input;
    const normalizedIdentity =
      process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (identity !== normalizedIdentity || isPathInside(root, target, true))
      throw new ArtifactError(
        "VEXT_OUTPUT_UNVERIFIED",
        `External artifact path is not canonical: ${relative}`,
      );
    normalizeSafeRelativePath(
      path.relative(path.parse(target).root, target),
      "external artifact path",
    );
    return target;
  }
  const portable = normalizeSafeRelativePath(relative, "artifact path");
  if (/[<>:"|?*]/u.test(portable)) {
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      `Non-portable artifact path: ${relative}`,
    );
  }
  const target = assertPathInside(
    root,
    path.resolve(root, portable),
    "artifact path",
  );
  assertRealPathInside(root, target, "artifact path");
  return target;
}

export function artifactRelativePath(
  root: string,
  target: string,
  allowExternal = false,
): string {
  const resolvedRoot = physicalPath(root);
  const resolvedTarget = path.resolve(target);
  if (allowExternal && !isPathInside(resolvedRoot, resolvedTarget, true)) {
    const reference = physicalPath(resolvedTarget).replaceAll("\\", "/");
    artifactPath(resolvedRoot, reference, true);
    return reference;
  }
  const relative = path
    .relative(resolvedRoot, resolvedTarget)
    .replaceAll("\\", "/");
  artifactPath(resolvedRoot, relative);
  return relative;
}

/** 缺失是允许重建的状态；不可读、目录、链接、超限均不能视为空文件。 */
export function readArtifactFile(
  root: string,
  relative: string,
  maxBytes?: number,
  allowExternal = false,
): Buffer | null {
  const target = artifactPath(root, relative, allowExternal);
  try {
    return allowExternal && path.isAbsolute(relative)
      ? readProjectFile(path.dirname(target), path.basename(target), maxBytes)
      : readProjectFile(root, relative, maxBytes);
  } catch (error) {
    if (error instanceof ProjectFileReadError) {
      throw new ArtifactError("VEXT_OUTPUT_UNVERIFIED", error.message);
    }
    throw error;
  }
}

export function parseArtifactManifest(
  bytes: Buffer | null,
  realRoot: string,
): ArtifactManifest {
  if (!bytes) return { schemaVersion: 1, realRoot, scopes: [] };
  try {
    const value = JSON.parse(bytes.toString("utf8")) as ArtifactManifest;
    if (
      value.schemaVersion !== 1 ||
      value.realRoot !== realRoot ||
      !Array.isArray(value.scopes) ||
      value.scopes.length > 256
    ) {
      throw new Error("Manifest schema, root, or scope count differs");
    }
    const ids = new Set<string>();
    const outputs = new Set<string>();
    for (const scope of value.scopes) {
      if (
        !scope ||
        typeof scope.producer !== "string" ||
        !/^[a-z][a-z0-9-]{0,47}$/u.test(scope.producer) ||
        typeof scope.outputDir !== "string" ||
        scope.id !== `${scope.producer}:${scope.outputDir}` ||
        ids.has(scope.id) ||
        typeof scope.producerVersion !== "string" ||
        scope.producerVersion.length > 100 ||
        (scope.inputDigest !== null && !isArtifactDigest(scope.inputDigest)) ||
        !Number.isSafeInteger(scope.generation) ||
        scope.generation < 1 ||
        !Array.isArray(scope.files)
      ) {
        throw new Error("Invalid manifest scope");
      }
      const output = artifactPath(realRoot, scope.outputDir, true);
      if (path.isAbsolute(scope.outputDir))
        assertExplicitOutputDirectory(realRoot, output, "artifact output");
      ids.add(scope.id);
      for (const file of scope.files) {
        if (
          !file ||
          typeof file.path !== "string" ||
          !file.path.startsWith(`${scope.outputDir}/`) ||
          !isArtifactDigest(file.sha256) ||
          (file.source !== undefined && typeof file.source !== "string")
        )
          throw new Error("Invalid manifest file");
        artifactPath(realRoot, file.path, true);
        if (file.source !== undefined)
          artifactPath(realRoot, file.source, true);
        const key =
          process.platform === "win32" ? file.path.toLowerCase() : file.path;
        if (outputs.has(key))
          throw new Error(`Duplicate artifact ownership: ${file.path}`);
        outputs.add(key);
        if (outputs.size > MAX_ARTIFACT_FILES)
          throw new Error("Too many artifact files");
      }
    }
    return value;
  } catch (error) {
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      `Inspect the artifact manifest before recovery: ${String(error)}`,
    );
  }
}

export function serializeArtifactManifest(value: ArtifactManifest): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > MAX_ARTIFACT_METADATA_BYTES) {
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      "Artifact manifest exceeds the metadata limit.",
    );
  }
  return bytes;
}

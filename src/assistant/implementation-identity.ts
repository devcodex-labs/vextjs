import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFile } from "../lib/project/read-project-file.js";
import { fingerprintImplementationTree } from "../lib/project/implementation-fingerprint.mjs";

// Replaced only in emitted JS by the managed build; null identifies unsealed tsc output.
const COMPILED_INPUT_DIGEST: string | null = null;

export interface ImplementationIdentity {
  loadedDigest: string | null;
  onDiskDigest: string | null;
  state: "current" | "restart-required" | "unverified";
  evidence: "build-manifest" | "source-tree" | "unverified";
  buildState: "complete" | "building" | "missing" | "invalid" | "source";
  packageVersion: string | null;
}

/**
 * 只检查随框架安装的代码，不扫描消费项目。模块加载时固定版本证据；
 * 磁盘变化只能要求重启，不能冒充当前进程已经加载新实现。
 */
export function createImplementationTracker(
  codeRoot: string,
  options: {
    allowSourceFallback?: boolean;
    compiledInputDigest?: string | null;
  } = {},
): () => ImplementationIdentity {
  const loaded = readIdentity(codeRoot, options.allowSourceFallback === true);
  if (
    "compiledInputDigest" in options &&
    (!options.compiledInputDigest ||
      options.compiledInputDigest !== loaded.inputDigest)
  ) {
    loaded.digest = null;
    loaded.evidence = "unverified";
  }
  return () => {
    const current = readIdentity(
      codeRoot,
      options.allowSourceFallback === true,
    );
    return {
      loadedDigest: loaded.digest,
      onDiskDigest: current.digest,
      state:
        !loaded.digest || !current.digest
          ? "unverified"
          : loaded.digest === current.digest
            ? "current"
            : "restart-required",
      evidence: loaded.evidence,
      buildState: current.state,
      packageVersion: loaded.packageVersion,
    };
  };
}

interface Manifest {
  schemaVersion: 1;
  contractVersion: 2;
  state: "complete";
  digest: string;
  inputDigest: string;
  sourceDigest: string;
  outputDigest: string;
  metadata: Record<string, string>;
  packageVersion: string;
  buildId: string;
  formats: string[];
}

function readManifest(
  codeRoot: string,
): Manifest | "building" | "missing" | "invalid" {
  try {
    const bytes = readProjectFile(codeRoot, ".implementation.json", 32 * 1024);
    if (!bytes) return "missing";
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!value || typeof value !== "object") return "invalid";
    const data = value as Record<string, unknown>;
    if (data.schemaVersion !== 1 || data.contractVersion !== 2)
      return "invalid";
    if (data.state === "building") return "building";
    if (
      data.state !== "complete" ||
      typeof data.packageVersion !== "string" ||
      typeof data.buildId !== "string" ||
      !Array.isArray(data.formats) ||
      !data.formats.length ||
      data.formats.some((format) => !["esm", "cjs"].includes(String(format))) ||
      !data.metadata ||
      typeof data.metadata !== "object" ||
      Array.isArray(data.metadata)
    )
      return "invalid";
    if (
      ["digest", "sourceDigest", "inputDigest", "outputDigest"].some(
        (key) =>
          typeof data[key] !== "string" ||
          !/^[a-f0-9]{64}$/u.test(data[key] as string),
      )
    )
      return "invalid";
    const computed = hash(
      JSON.stringify({
        inputDigest: data.inputDigest,
        outputDigest: data.outputDigest,
        contractVersion: 2,
        packageVersion: data.packageVersion,
        formats: data.formats,
      }),
    );
    if (computed !== data.digest) return "invalid";
    return data as unknown as Manifest;
  } catch {
    return "invalid";
  }
}

function readIdentity(
  codeRoot: string,
  allowSourceFallback: boolean,
): {
  digest: string | null;
  evidence: ImplementationIdentity["evidence"];
  state: ImplementationIdentity["buildState"];
  packageVersion: string | null;
  inputDigest: string | null;
} {
  const manifest = readManifest(codeRoot);
  if (typeof manifest !== "string")
    return {
      digest: manifest.digest,
      evidence: "build-manifest",
      state: "complete",
      packageVersion: manifest.packageVersion,
      inputDigest: manifest.inputDigest,
    };
  if (manifest === "missing" && allowSourceFallback) {
    try {
      return {
        digest: fingerprintImplementationTree(codeRoot),
        evidence: "source-tree",
        state: "source",
        packageVersion: null,
        inputDigest: null,
      };
    } catch {
      /* A partial source tree is not a loaded implementation proof. */
    }
  }
  return {
    digest: null,
    evidence: "unverified",
    state: manifest,
    packageVersion: null,
    inputDigest: null,
  };
}

/** Explicit CLI check only: production requests read a small manifest, never traverse dist or src. */
export function inspectFrameworkSourceBuild(codeRoot: string) {
  const packageRoot = path.dirname(realpathSync(codeRoot));
  if (
    !existsSync(
      path.join(packageRoot, "src", "assistant", "implementation-identity.ts"),
    )
  )
    return {
      state: "unavailable" as const,
      reason: "Installed package does not include framework sources.",
    };
  const manifest = readManifest(codeRoot);
  if (typeof manifest === "string")
    return {
      state: "unverified" as const,
      reason: "No complete implementation build manifest.",
    };
  try {
    const sourceDigest = fingerprintImplementationTree(
      path.join(packageRoot, "src"),
    );
    const metadata: Record<string, string> = {};
    for (const file of Object.keys(manifest.metadata).sort()) {
      // The manifest names framework build inputs, not arbitrary filesystem paths.
      if (
        !/^(?:package(?:-lock)?\.json|tsconfig\.json|scripts\/[a-z-]+\.mjs)$/u.test(
          file,
        )
      )
        throw new Error("Unsupported build input path.");
      metadata[file] = hash(
        readProjectFile(packageRoot, file, 4 * 1024 * 1024) ?? Buffer.alloc(0),
      );
    }
    const matches =
      sourceDigest === manifest.sourceDigest &&
      Object.entries(metadata).every(
        ([file, digest]) => digest === manifest.metadata[file],
      );
    return {
      state: matches ? ("current" as const) : ("build-required" as const),
      reason: matches
        ? null
        : "Framework source or build inputs changed. Run npm run build, then reconnect MCP.",
    };
  } catch (error) {
    return {
      state: "unverified" as const,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const filename =
  typeof __filename === "string" ? __filename : fileURLToPath(import.meta.url);
export const IMPLEMENTATION_CODE_ROOT = path.dirname(path.dirname(filename));
export const inspectImplementationIdentity = createImplementationTracker(
  IMPLEMENTATION_CODE_ROOT,
  path.basename(IMPLEMENTATION_CODE_ROOT) === "src"
    ? { allowSourceFallback: true }
    : { compiledInputDigest: COMPILED_INPUT_DIGEST },
);

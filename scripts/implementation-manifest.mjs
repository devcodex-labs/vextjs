import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  fingerprintImplementationTree,
  readImplementationFile,
} from "../src/lib/project/implementation-fingerprint.mjs";

export const IMPLEMENTATION_MANIFEST = ".implementation.json";
export const BUILD_INPUT_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "scripts/build-framework.mjs",
  "scripts/build-cjs.mjs",
  "scripts/implementation-manifest.mjs",
];

export function inspectBuildInputs(rootDir) {
  const sourceDigest = fingerprintImplementationTree(path.join(rootDir, "src"));
  const metadata = Object.fromEntries(
    BUILD_INPUT_FILES.map((file) => [
      file,
      hash(readImplementationFile(path.join(rootDir, file), 4 * 1024 * 1024)),
    ]),
  );
  const inputDigest = hash(JSON.stringify({ sourceDigest, metadata }));
  const pkg = JSON.parse(
    readImplementationFile(
      path.join(rootDir, "package.json"),
      256 * 1024,
    ).toString("utf8"),
  );
  return { sourceDigest, metadata, inputDigest, packageVersion: pkg.version };
}

/** Publication marker is written last; build identity is never inferred from package version alone. */
export function publishImplementationManifest(rootDir, state) {
  const dist = path.join(rootDir, "dist");
  mkdirSync(dist, { recursive: true });
  if (realpathSync(dist) !== path.join(realpathSync(rootDir), "dist"))
    throw new Error(
      "Framework dist must be a local owned directory, not a symbolic link.",
    );
  const file = path.join(dist, IMPLEMENTATION_MANIFEST);
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(
      temporary,
      JSON.stringify({ schemaVersion: 1, contractVersion: 2, ...state }) + "\n",
      { flag: "wx" },
    );
    renameSync(temporary, file);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export function completeImplementationBuild(rootDir, before, buildId, formats) {
  const after = inspectBuildInputs(rootDir);
  if (after.inputDigest !== before.inputDigest)
    throw new Error(
      "Framework inputs changed during build. Rebuild before starting MCP.",
    );
  const outputDigest = fingerprintImplementationTree(
    path.join(rootDir, "dist"),
  );
  const digest = hash(
    JSON.stringify({
      inputDigest: before.inputDigest,
      outputDigest,
      contractVersion: 2,
      packageVersion: before.packageVersion,
      formats,
    }),
  );
  const result = {
    ...before,
    outputDigest,
    digest,
    buildId,
    formats,
    state: "complete",
  };
  publishImplementationManifest(rootDir, result);
  return result;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

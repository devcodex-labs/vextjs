#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveValidationCommand } from "./resolve-command.mjs";

export const RELEASE_CANDIDATE_RECEIPT_SCHEMA_VERSION = 1;

const moduleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SHA1_PATTERN = /^[a-f0-9]{40}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;
const SHA512_PATTERN = /^[a-f0-9]{128}$/iu;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(location, message) {
  throw new Error(`[release-candidate] ${location} ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(record, field, location) {
  const value = record?.[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${location}.${field}`, "must be a non-empty string");
  }
  return value.trim();
}

function readPositiveInteger(record, field, location) {
  const value = record?.[field];
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${location}.${field}`, "must be a positive integer");
  }
  return value;
}

function readNonNegativeInteger(record, field, location) {
  const value = record?.[field];
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${location}.${field}`, "must be a non-negative integer");
  }
  return value;
}

function readDigest(record, field, pattern, location) {
  const value = readString(record, field, location).toLowerCase();
  if (!pattern.test(value)) {
    fail(`${location}.${field}`, "has an invalid digest shape");
  }
  return value;
}

function hashBuffer(buffer, algorithm, encoding = "hex") {
  return createHash(algorithm).update(buffer).digest(encoding);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function runCapture(command, args, cwd, label) {
  ({ command, args } = resolveValidationCommand(command, args));
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    fail(
      label,
      `failed with exitCode ${result.status ?? "unknown"}: ${(result.stderr || result.stdout || "no output").trim()}`,
    );
  }
  return result.stdout;
}

function runInherited(command, args, cwd, label) {
  ({ command, args } = resolveValidationCommand(command, args));
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    fail(label, `failed with exitCode ${result.status ?? "unknown"}`);
  }
}

function readGitIdentity(rootDir) {
  const commit = runCapture("git", ["rev-parse", "HEAD"], rootDir, "git HEAD")
    .trim()
    .toLowerCase();
  const tree = runCapture(
    "git",
    ["rev-parse", "HEAD^{tree}"],
    rootDir,
    "git tree",
  )
    .trim()
    .toLowerCase();
  if (!SHA1_PATTERN.test(commit) || !SHA1_PATTERN.test(tree)) {
    fail("git", "must resolve full SHA-1 commit and tree identities");
  }
  return { commit, tree };
}

function assertCleanWorktree(rootDir) {
  const status = runCapture(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    rootDir,
    "git status",
  ).trim();
  if (status !== "") {
    fail("git status", "requires a clean tracked and untracked worktree");
  }
}

function parseNpmPackResult(stdout, location) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    fail(
      location,
      `did not return JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail(location, "must return exactly one package result");
  }
  if (!Array.isArray(value[0].files) || value[0].files.length === 0) {
    fail(`${location}.files`, "must contain at least one packed file");
  }
  return value[0];
}

function normalizePackManifest(packResult, location) {
  return packResult.files
    .map((file, index) => {
      if (!isRecord(file))
        fail(`${location}.files[${index}]`, "must be an object");
      const filePath = readString(file, "path", `${location}.files[${index}]`)
        .split("\\")
        .join("/");
      if (
        path.posix.isAbsolute(filePath) ||
        filePath.split("/").includes("..")
      ) {
        fail(
          `${location}.files[${index}].path`,
          "must stay inside the package",
        );
      }
      const size = readNonNegativeInteger(
        file,
        "size",
        `${location}.files[${index}]`,
      );
      const mode =
        Number.isSafeInteger(file.mode) && file.mode >= 0 ? file.mode : null;
      return { path: filePath, packedSize: size, mode };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function resolveSourceFile(rootDir, portablePath) {
  const resolved = path.resolve(rootDir, ...portablePath.split("/"));
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("packInput", `escapes the source root: ${portablePath}`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    fail("packInput", `cannot hash source file ${portablePath}`);
  }
  return resolved;
}

function createPackInput(rootDir, packResult, location) {
  const manifest = normalizePackManifest(packResult, location);
  const files = manifest.map((item) => {
    const sourcePath = resolveSourceFile(rootDir, item.path);
    const sourceBytes = readFileSync(sourcePath);
    return {
      ...item,
      sourceBytes: sourceBytes.byteLength,
      sourceSHA256: hashBuffer(sourceBytes, "sha256"),
    };
  });
  return {
    digest: hashBuffer(Buffer.from(stableStringify(files)), "sha256"),
    fileCount: files.length,
    files,
  };
}

function readDryRunPackInput(rootDir) {
  const result = parseNpmPackResult(
    runCapture(
      npmCommand,
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      rootDir,
      "npm pack dry-run",
    ),
    "npm pack dry-run",
  );
  return {
    result,
    packInput: createPackInput(rootDir, result, "npm pack dry-run"),
  };
}

function normalizeReceiptPackInput(packInput, location) {
  if (!isRecord(packInput)) fail(location, "must be an object");
  const digest = readDigest(packInput, "digest", SHA256_PATTERN, location);
  const fileCount = readPositiveInteger(packInput, "fileCount", location);
  if (!Array.isArray(packInput.files) || packInput.files.length !== fileCount) {
    fail(`${location}.files`, "must match fileCount");
  }
  const files = packInput.files
    .map((file, index) => {
      const itemLocation = `${location}.files[${index}]`;
      if (!isRecord(file)) fail(itemLocation, "must be an object");
      const filePath = readString(file, "path", itemLocation);
      const packedSize = readNonNegativeInteger(
        file,
        "packedSize",
        itemLocation,
      );
      const sourceBytes = readNonNegativeInteger(
        file,
        "sourceBytes",
        itemLocation,
      );
      const sourceSHA256 = readDigest(
        file,
        "sourceSHA256",
        SHA256_PATTERN,
        itemLocation,
      );
      const mode = file.mode === null ? null : Number(file.mode);
      if (mode !== null && (!Number.isSafeInteger(mode) || mode < 0)) {
        fail(`${itemLocation}.mode`, "must be a non-negative integer or null");
      }
      return { path: filePath, packedSize, mode, sourceBytes, sourceSHA256 };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const computedDigest = hashBuffer(
    Buffer.from(stableStringify(files)),
    "sha256",
  );
  if (computedDigest !== digest) {
    fail(`${location}.digest`, "does not match the recorded file identities");
  }
  return { digest, fileCount, files };
}

export function validateCandidatePackInput(expected, actual) {
  const normalizedExpected = normalizeReceiptPackInput(
    expected,
    "receipt.packInput",
  );
  const normalizedActual = normalizeReceiptPackInput(
    actual,
    "source.packInput",
  );
  if (
    stableStringify(normalizedExpected) !== stableStringify(normalizedActual)
  ) {
    fail(
      "source.packInput",
      "does not match the frozen candidate pack-input closure",
    );
  }
  return normalizedActual;
}

function assertGzipArtifact(buffer, location) {
  if (buffer.byteLength < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
    fail(location, "must be a gzip tarball (magic bytes 1f8b)");
  }
}

export function verifyReleaseCandidateReceipt({
  receiptPath,
  artifactPath,
  expectedPackageName,
  expectedArtifactVersion,
  expectedSourceCommit,
  expectedSourceTree,
}) {
  if (!existsSync(receiptPath))
    fail("receiptPath", `does not exist: ${receiptPath}`);
  if (!existsSync(artifactPath))
    fail("artifactPath", `does not exist: ${artifactPath}`);
  const receiptBytes = readFileSync(receiptPath);
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch (error) {
    fail(
      "receiptPath",
      `is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(receipt)) fail("receipt", "must be an object");
  if (receipt.schemaVersion !== RELEASE_CANDIDATE_RECEIPT_SCHEMA_VERSION) {
    fail(
      "receipt.schemaVersion",
      `must equal ${RELEASE_CANDIDATE_RECEIPT_SCHEMA_VERSION}`,
    );
  }
  if (receipt.kind !== "vextjs-release-candidate") {
    fail("receipt.kind", "must equal vextjs-release-candidate");
  }
  readString(receipt, "taskId", "receipt");
  if (!isRecord(receipt.source)) fail("receipt.source", "must be an object");
  const sourceCommit = readDigest(
    receipt.source,
    "commit",
    SHA1_PATTERN,
    "receipt.source",
  );
  const sourceTree = readDigest(
    receipt.source,
    "tree",
    SHA1_PATTERN,
    "receipt.source",
  );
  if (receipt.source.clean !== true) {
    fail("receipt.source.clean", "must equal true");
  }
  if (sourceCommit !== expectedSourceCommit.toLowerCase()) {
    fail("receipt.source.commit", "does not match the current source commit");
  }
  if (
    expectedSourceTree !== undefined &&
    sourceTree !== expectedSourceTree.toLowerCase()
  ) {
    fail("receipt.source.tree", "does not match the current source tree");
  }
  if (!isRecord(receipt.package)) fail("receipt.package", "must be an object");
  if (
    readString(receipt.package, "name", "receipt.package") !==
    expectedPackageName
  ) {
    fail("receipt.package.name", "does not match package.json");
  }
  if (
    readString(receipt.package, "version", "receipt.package") !==
    expectedArtifactVersion
  ) {
    fail("receipt.package.version", "does not match package.json");
  }
  const packInput = normalizeReceiptPackInput(
    receipt.packInput,
    "receipt.packInput",
  );
  if (!isRecord(receipt.artifact))
    fail("receipt.artifact", "must be an object");
  const fileName = readString(receipt.artifact, "fileName", "receipt.artifact");
  if (path.basename(artifactPath) !== fileName) {
    fail(
      "receipt.artifact.fileName",
      "does not match the provided artifact path",
    );
  }
  const artifactBytes = readFileSync(artifactPath);
  assertGzipArtifact(artifactBytes, "receipt.artifact");
  const sha256 = readDigest(
    receipt.artifact,
    "sha256",
    SHA256_PATTERN,
    "receipt.artifact",
  );
  const sha512 = readDigest(
    receipt.artifact,
    "sha512",
    SHA512_PATTERN,
    "receipt.artifact",
  );
  const bytes = readPositiveInteger(
    receipt.artifact,
    "bytes",
    "receipt.artifact",
  );
  const entryCount = readPositiveInteger(
    receipt.artifact,
    "entryCount",
    "receipt.artifact",
  );
  const actualSha256 = hashBuffer(artifactBytes, "sha256");
  const actualSha512 = hashBuffer(artifactBytes, "sha512");
  const actualIntegrity = `sha512-${hashBuffer(artifactBytes, "sha512", "base64")}`;
  if (sha256 !== actualSha256 || sha512 !== actualSha512) {
    fail("receipt.artifact", "digest does not match the frozen tarball bytes");
  }
  if (
    readString(receipt.artifact, "integrity", "receipt.artifact") !==
    actualIntegrity
  ) {
    fail(
      "receipt.artifact.integrity",
      "does not match the frozen tarball bytes",
    );
  }
  if (
    bytes !== artifactBytes.byteLength ||
    entryCount !== packInput.fileCount
  ) {
    fail(
      "receipt.artifact",
      "byte or entry count does not match the frozen artifact closure",
    );
  }
  return {
    receipt,
    receiptSHA256: hashBuffer(receiptBytes, "sha256"),
    artifactSHA256: actualSha256,
    sourceCommit,
    sourceTree,
    packInput,
  };
}

export function verifyReleaseCandidateSourceInputs({ rootDir, receipt }) {
  assertCleanWorktree(rootDir);
  const source = readGitIdentity(rootDir);
  if (
    !isRecord(receipt.source) ||
    source.commit !== String(receipt.source.commit).toLowerCase() ||
    source.tree !== String(receipt.source.tree).toLowerCase()
  ) {
    fail("source", "commit or tree changed after the candidate was frozen");
  }
  const { packInput } = readDryRunPackInput(rootDir);
  return validateCandidatePackInput(receipt.packInput, packInput);
}

function readCliOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!["--output-dir", "--task-id"].includes(arg)) {
      fail("arguments", `unknown option ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("arguments", `${arg} requires a value`);
    }
    options[arg.slice(2)] = value;
    index++;
  }
  return options;
}

function freezeReleaseCandidate({ rootDir, outputDir, taskId }) {
  if (!taskId?.trim()) fail("taskId", "is required");
  const resolvedOutputDir = path.resolve(outputDir);
  const relation = path.relative(rootDir, resolvedOutputDir);
  if (!relation.startsWith("..") && !path.isAbsolute(relation)) {
    fail("outputDir", "must be outside the source repository");
  }
  if (existsSync(resolvedOutputDir)) {
    fail("outputDir", "must not already exist; use a new candidate generation");
  }
  if (!existsSync(path.dirname(resolvedOutputDir))) {
    fail("outputDir", "parent directory must already exist");
  }

  assertCleanWorktree(rootDir);
  const before = readGitIdentity(rootDir);
  runInherited(npmCommand, ["run", "build"], rootDir, "npm run build");
  assertCleanWorktree(rootDir);
  const afterBuild = readGitIdentity(rootDir);
  if (before.commit !== afterBuild.commit || before.tree !== afterBuild.tree) {
    fail("source", "commit or tree changed while building the candidate");
  }

  const dryRun = readDryRunPackInput(rootDir);
  mkdirSync(resolvedOutputDir);
  const packed = parseNpmPackResult(
    runCapture(
      npmCommand,
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        resolvedOutputDir,
      ],
      rootDir,
      "npm pack",
    ),
    "npm pack",
  );
  const dryManifest = normalizePackManifest(dryRun.result, "npm pack dry-run");
  const packedManifest = normalizePackManifest(packed, "npm pack");
  if (stableStringify(dryManifest) !== stableStringify(packedManifest)) {
    fail(
      "npm pack",
      "actual tarball manifest differs from the dry-run manifest",
    );
  }
  const packedInput = createPackInput(rootDir, packed, "npm pack");
  validateCandidatePackInput(dryRun.packInput, packedInput);
  assertCleanWorktree(rootDir);
  const afterPack = readGitIdentity(rootDir);
  if (before.commit !== afterPack.commit || before.tree !== afterPack.tree) {
    fail("source", "commit or tree changed while packing the candidate");
  }

  const fileName = readString(packed, "filename", "npm pack");
  const artifactPath = path.join(resolvedOutputDir, fileName);
  if (!existsSync(artifactPath)) {
    fail("npm pack", `did not create ${artifactPath}`);
  }
  const artifactBytes = readFileSync(artifactPath);
  assertGzipArtifact(artifactBytes, "npm pack artifact");
  const sha512Base64 = hashBuffer(artifactBytes, "sha512", "base64");
  const pkg = JSON.parse(
    readFileSync(path.join(rootDir, "package.json"), "utf8"),
  );
  const receipt = {
    schemaVersion: RELEASE_CANDIDATE_RECEIPT_SCHEMA_VERSION,
    kind: "vextjs-release-candidate",
    taskId: taskId.trim(),
    source: { commit: before.commit, tree: before.tree, clean: true },
    package: { name: pkg.name, version: pkg.version },
    artifact: {
      fileName,
      sha256: hashBuffer(artifactBytes, "sha256"),
      sha512: hashBuffer(artifactBytes, "sha512"),
      integrity: `sha512-${sha512Base64}`,
      bytes: artifactBytes.byteLength,
      entryCount: dryRun.packInput.fileCount,
    },
    packInput: dryRun.packInput,
    generator: {
      command:
        "npm run freeze:release-candidate -- --output-dir <new-generation> --task-id <task-id>",
      nodeVersion: process.version,
      platform: process.platform,
    },
    createdAt: new Date().toISOString(),
  };
  const receiptPath = path.join(resolvedOutputDir, "candidate-receipt.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { artifactPath, receiptPath, receipt };
}

function runCli() {
  const options = readCliOptions(process.argv.slice(2));
  if (!options["output-dir"]) fail("outputDir", "requires --output-dir");
  if (!options["task-id"]) fail("taskId", "requires --task-id");
  const result = freezeReleaseCandidate({
    rootDir: moduleRoot,
    outputDir: options["output-dir"],
    taskId: options["task-id"],
  });
  const verified = verifyReleaseCandidateReceipt({
    receiptPath: result.receiptPath,
    artifactPath: result.artifactPath,
    expectedPackageName: result.receipt.package.name,
    expectedArtifactVersion: result.receipt.package.version,
    expectedSourceCommit: result.receipt.source.commit,
    expectedSourceTree: result.receipt.source.tree,
  });
  console.log(
    JSON.stringify({
      status: "frozen",
      artifactPath: result.artifactPath,
      artifactSHA256: verified.artifactSHA256,
      receiptPath: result.receiptPath,
      receiptSHA256: verified.receiptSHA256,
    }),
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

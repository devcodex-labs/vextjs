#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseCandidateReceipt } from "./freeze-release-candidate.mjs";

export const EXTERNAL_EVIDENCE_SCHEMA_VERSION = 2;

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SHA1_PATTERN = /^[a-f0-9]{40}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/u;
const REQUIRED_MATRIX = [
  ["win32", 20],
  ["win32", 22],
  ["linux", 20],
  ["linux", 22],
];
const REQUIRED_MATRIX_CELLS = new Set(
  REQUIRED_MATRIX.map(
    ([platform, nodeMajor]) => `${platform}:node${nodeMajor}`,
  ),
);

function fail(location, message) {
  throw new Error(`[external-evidence-v2] ${location} ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(record, field, location) {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${location}.${field}`, "must be a non-empty string");
  }
  return value.trim();
}

function readCommit(record, field, location) {
  const value = readString(record, field, location).toLowerCase();
  if (!SHA1_PATTERN.test(value)) {
    fail(`${location}.${field}`, "must be a full 40-character commit SHA");
  }
  return value;
}

function readArtifactSha256(record, location) {
  return readSha256(record, "artifactSHA256", location);
}

function readSha256(record, field, location) {
  const value = readString(record, field, location).toLowerCase();
  if (!SHA256_PATTERN.test(value)) {
    fail(`${location}.${field}`, "must be a 64-character SHA-256 digest");
  }
  return value;
}

function readVersion(record, field, location) {
  const value = readString(record, field, location);
  const match = SEMVER_PATTERN.exec(value);
  if (!match) {
    fail(`${location}.${field}`, "must be an exact semantic version");
  }
  return {
    value: value.replace(/^v/u, ""),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function parseMinimumNodeRange(value) {
  if (typeof value !== "string") {
    fail(
      "expectedNodeRange",
      "must be provided from package.json engines.node",
    );
  }
  const match = /^>=(\d+)\.(\d+)\.(\d+)$/u.exec(value.trim());
  if (!match) {
    fail(
      "expectedNodeRange",
      `uses unsupported range ${JSON.stringify(value)}; expected an exact >=major.minor.patch floor`,
    );
  }
  return {
    value: value.trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function satisfiesMinimum(version, minimum) {
  for (const field of ["major", "minor", "patch"]) {
    if (version[field] > minimum[field]) return true;
    if (version[field] < minimum[field]) return false;
  }
  return true;
}

function readPortableRelativePath(record, field, location) {
  const value = readString(record, field, location);
  if (
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.split("/").includes("..")
  ) {
    fail(
      `${location}.${field}`,
      "must be a portable relative path without backslashes or parent traversal",
    );
  }
  return value;
}

function readCommand(record, location) {
  if (!isRecord(record.command)) {
    fail(`${location}.command`, "must be an object");
  }
  const executable = readString(
    record.command,
    "executable",
    `${location}.command`,
  );
  if (
    !Array.isArray(record.command.args) ||
    record.command.args.some((arg) => typeof arg !== "string")
  ) {
    fail(`${location}.command.args`, "must be an array of strings");
  }
  return { executable, args: [...record.command.args] };
}

function readLog(record, location) {
  if (!isRecord(record.log)) fail(`${location}.log`, "must be an object");
  return {
    path: readPortableRelativePath(record.log, "path", `${location}.log`),
    sha256: readSha256(record.log, "sha256", `${location}.log`),
  };
}

function readResult(record, location) {
  if (!isRecord(record.result)) {
    fail(`${location}.result`, "must be an object");
  }
  if (record.result.status !== "passed") {
    fail(`${location}.result.status`, "must equal passed");
  }
  return {
    path: readPortableRelativePath(record.result, "path", `${location}.result`),
    status: "passed",
    sha256: readSha256(record.result, "sha256", `${location}.result`),
  };
}

/**
 * Validate the versioned, per-cell external consumer evidence contract.
 * Every cell repeats the source and artifact identity so records remain
 * independently attributable when copied into external run receipts.
 */
export function validateExternalEvidenceV2(
  document,
  {
    expectedArtifactVersion,
    expectedArtifactSHA256,
    expectedSourceCommit,
    expectedCandidateReceiptSHA256,
    expectedTaskId,
    expectedNodeRange,
    requireMatrix = true,
  },
) {
  if (!isRecord(document)) {
    fail("document", "must be a JSON object");
  }
  if (document.schemaVersion !== EXTERNAL_EVIDENCE_SCHEMA_VERSION) {
    fail("schemaVersion", `must equal ${EXTERNAL_EVIDENCE_SCHEMA_VERSION}`);
  }
  const artifactVersion = readString(document, "artifactVersion", "document");
  if (artifactVersion !== expectedArtifactVersion) {
    fail(
      "document.artifactVersion",
      `must equal package version ${expectedArtifactVersion}`,
    );
  }
  if (!Array.isArray(document.records) || document.records.length === 0) {
    fail("document.records", "must contain at least one evidence cell");
  }

  const normalizedSourceCommit = expectedSourceCommit.toLowerCase();
  const normalizedArtifactSHA256 = expectedArtifactSHA256.toLowerCase();
  if (typeof expectedCandidateReceiptSHA256 !== "string") {
    fail("expectedCandidateReceiptSHA256", "must be a SHA-256 digest");
  }
  const normalizedCandidateReceiptSHA256 =
    expectedCandidateReceiptSHA256.toLowerCase();
  if (
    typeof expectedTaskId !== "string" ||
    expectedTaskId.trim().length === 0
  ) {
    fail("expectedTaskId", "must come from the frozen candidate receipt");
  }
  const normalizedTaskId = expectedTaskId.trim();
  const minimumNodeVersion = parseMinimumNodeRange(expectedNodeRange);
  if (!SHA1_PATTERN.test(normalizedSourceCommit)) {
    fail("expectedSourceCommit", "must be a full 40-character commit SHA");
  }
  if (!SHA256_PATTERN.test(normalizedArtifactSHA256)) {
    fail("expectedArtifactSHA256", "must be a SHA-256 digest");
  }
  if (!SHA256_PATTERN.test(normalizedCandidateReceiptSHA256)) {
    fail("expectedCandidateReceiptSHA256", "must be a SHA-256 digest");
  }

  const cellIds = new Set();
  const matrixCells = new Set();
  const runIds = new Set();
  let expectedConsumerIdentity;
  let expectedConsumerCwd;
  let hasTypeScript59 = false;
  const records = document.records.map((rawRecord, index) => {
    const location = `document.records[${index}]`;
    if (!isRecord(rawRecord)) {
      fail(location, "must be a JSON object");
    }
    if (rawRecord.accepted !== true) {
      fail(`${location}.accepted`, "must equal true");
    }

    const sourceCommit = readCommit(rawRecord, "sourceCommit", location);
    const artifactSHA256 = readArtifactSha256(rawRecord, location);
    const candidateReceiptSHA256 = readSha256(
      rawRecord,
      "candidateReceiptSHA256",
      location,
    );
    const platform = readString(rawRecord, "platform", location);
    if (platform !== "win32" && platform !== "linux") {
      fail(`${location}.platform`, "must equal win32 or linux");
    }
    const nodeVersion = readVersion(rawRecord, "nodeVersion", location);
    const testCell = readString(rawRecord, "testCell", location);
    const consumerRepo = readString(rawRecord, "consumerRepo", location);
    const consumerCommit = readCommit(rawRecord, "consumerCommit", location);
    const runId = readString(rawRecord, "runId", location);
    const taskId = readString(rawRecord, "taskId", location);
    const command = readCommand(rawRecord, location);
    const cwd = readPortableRelativePath(rawRecord, "cwd", location);
    if (rawRecord.exitCode !== 0) {
      fail(`${location}.exitCode`, "must equal 0");
    }
    const log = readLog(rawRecord, location);
    const result = readResult(rawRecord, location);
    if (!isRecord(rawRecord.inputRevision)) {
      fail(`${location}.inputRevision`, "must be an object");
    }
    const inputRevision = {
      sourceCommit: readCommit(
        rawRecord.inputRevision,
        "sourceCommit",
        `${location}.inputRevision`,
      ),
      artifactSHA256: readArtifactSha256(
        rawRecord.inputRevision,
        `${location}.inputRevision`,
      ),
      consumerCommit: readCommit(
        rawRecord.inputRevision,
        "consumerCommit",
        `${location}.inputRevision`,
      ),
      candidateReceiptSHA256: readSha256(
        rawRecord.inputRevision,
        "candidateReceiptSHA256",
        `${location}.inputRevision`,
      ),
    };

    if (sourceCommit !== normalizedSourceCommit) {
      fail(
        `${location}.sourceCommit`,
        `does not match expected source commit ${normalizedSourceCommit}`,
      );
    }
    if (artifactSHA256 !== normalizedArtifactSHA256) {
      fail(
        `${location}.artifactSHA256`,
        `does not match frozen artifact ${normalizedArtifactSHA256}`,
      );
    }
    if (candidateReceiptSHA256 !== normalizedCandidateReceiptSHA256) {
      fail(
        `${location}.candidateReceiptSHA256`,
        `does not match candidate receipt ${normalizedCandidateReceiptSHA256}`,
      );
    }
    if (taskId !== normalizedTaskId) {
      fail(
        `${location}.taskId`,
        `does not match candidate receipt task ${normalizedTaskId}`,
      );
    }
    const expectedTestCell = `${platform}-node${nodeVersion.major}`;
    if (testCell !== expectedTestCell) {
      fail(`${location}.testCell`, `must equal ${expectedTestCell}`);
    }
    if (!satisfiesMinimum(nodeVersion, minimumNodeVersion)) {
      fail(
        `${location}.nodeVersion`,
        `does not satisfy package engine ${minimumNodeVersion.value}`,
      );
    }
    if (
      inputRevision.sourceCommit !== sourceCommit ||
      inputRevision.artifactSHA256 !== artifactSHA256 ||
      inputRevision.consumerCommit !== consumerCommit ||
      inputRevision.candidateReceiptSHA256 !== candidateReceiptSHA256
    ) {
      fail(
        `${location}.inputRevision`,
        "must repeat the record source, artifact, consumer, and candidate receipt identities exactly",
      );
    }
    const consumerIdentity = `${consumerRepo}\n${consumerCommit}`;
    expectedConsumerIdentity ??= consumerIdentity;
    if (consumerIdentity !== expectedConsumerIdentity) {
      fail(
        `${location}.consumerRepo`,
        "must use the same consumer repository and commit in every matrix cell",
      );
    }
    expectedConsumerCwd ??= cwd;
    if (cwd !== expectedConsumerCwd) {
      fail(`${location}.cwd`, "must be the same in every matrix cell");
    }
    if (cellIds.has(testCell)) {
      fail(`${location}.testCell`, `duplicates evidence cell ${testCell}`);
    }
    cellIds.add(testCell);
    if (runIds.has(runId)) {
      fail(`${location}.runId`, `duplicates execution identity ${runId}`);
    }
    runIds.add(runId);
    const matrixCell = `${platform}:node${nodeVersion.major}`;
    if (!REQUIRED_MATRIX_CELLS.has(matrixCell)) {
      fail(
        `${location}.nodeVersion`,
        `is not an allowed matrix cell ${matrixCell}`,
      );
    }
    if (matrixCells.has(matrixCell)) {
      fail(`${location}.nodeVersion`, `duplicates matrix cell ${matrixCell}`);
    }
    matrixCells.add(matrixCell);

    let typescriptVersion;
    if (rawRecord.typescriptVersion !== undefined) {
      typescriptVersion = readVersion(
        rawRecord,
        "typescriptVersion",
        location,
      ).value;
      if (/^5\.9\./u.test(typescriptVersion)) hasTypeScript59 = true;
    }

    return {
      accepted: true,
      sourceCommit,
      platform,
      nodeVersion: nodeVersion.value,
      testCell,
      artifactSHA256,
      candidateReceiptSHA256,
      consumerRepo,
      consumerCommit,
      runId,
      taskId,
      command,
      cwd,
      exitCode: 0,
      log,
      result,
      inputRevision,
      ...(typescriptVersion ? { typescriptVersion } : {}),
    };
  });

  if (requireMatrix) {
    for (const [platform, nodeMajor] of REQUIRED_MATRIX) {
      const cell = `${platform}:node${nodeMajor}`;
      if (!matrixCells.has(cell)) {
        fail("document.records", `is missing required matrix cell ${cell}`);
      }
    }
    if (!hasTypeScript59) {
      fail("document.records", "must include a TypeScript 5.9 consumer cell");
    }
  }

  return {
    schemaVersion: EXTERNAL_EVIDENCE_SCHEMA_VERSION,
    artifactVersion,
    artifactSHA256: normalizedArtifactSHA256,
    candidateReceiptSHA256: normalizedCandidateReceiptSHA256,
    sourceCommit: normalizedSourceCommit,
    taskId: normalizedTaskId,
    nodeRange: minimumNodeVersion.value,
    records,
  };
}

function verifyMaterialFile(evidenceDir, material, location) {
  const resolvedEvidenceDir = path.resolve(evidenceDir);
  const materialPath = path.resolve(
    resolvedEvidenceDir,
    ...material.path.split("/"),
  );
  const relativePath = path.relative(resolvedEvidenceDir, materialPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    fail(`${location}.path`, "escapes the external evidence directory");
  }
  if (!existsSync(materialPath)) {
    fail(`${location}.path`, `does not exist: ${material.path}`);
  }
  let currentPath = resolvedEvidenceDir;
  for (const segment of material.path.split("/")) {
    currentPath = path.join(currentPath, segment);
    if (lstatSync(currentPath).isSymbolicLink()) {
      fail(`${location}.path`, "must not traverse symbolic links");
    }
  }
  const canonicalEvidenceDir = realpathSync(resolvedEvidenceDir);
  const canonicalMaterialPath = realpathSync(materialPath);
  const canonicalRelativePath = path.relative(
    canonicalEvidenceDir,
    canonicalMaterialPath,
  );
  if (
    canonicalRelativePath.startsWith("..") ||
    path.isAbsolute(canonicalRelativePath)
  ) {
    fail(
      `${location}.path`,
      "resolves outside the external evidence directory",
    );
  }
  if (!lstatSync(canonicalMaterialPath).isFile()) {
    fail(`${location}.path`, "must reference an ordinary file");
  }
  const bytes = readFileSync(canonicalMaterialPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== material.sha256) {
    fail(`${location}.sha256`, `does not match ${material.path}`);
  }
  return bytes;
}

function verifyLogMaterial(record, bytes, location) {
  const log = bytes.toString("utf8");
  const identities = {
    testCell: record.testCell,
    sourceCommit: record.sourceCommit,
    artifactSHA256: record.artifactSHA256,
    candidateReceiptSHA256: record.candidateReceiptSHA256,
    consumerRepo: record.consumerRepo,
    consumerCommit: record.consumerCommit,
    cwd: record.cwd,
    nodeVersion: record.nodeVersion,
    platform: record.platform,
    runId: record.runId,
    taskId: record.taskId,
  };
  for (const [field, value] of Object.entries(identities)) {
    if (!log.includes(`${field}=${value}`)) {
      fail(location, `does not bind ${field}=${value}`);
    }
  }
}

function verifyResultMaterial(record, bytes, location) {
  let result;
  try {
    result = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(
      location,
      `must contain JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(result)) fail(location, "must contain a JSON object");
  const expected = {
    schemaVersion: 1,
    kind: "vextjs-external-consumer-cell-result",
    accepted: true,
    status: "passed",
    exitCode: 0,
    sourceCommit: record.sourceCommit,
    platform: record.platform,
    nodeVersion: record.nodeVersion,
    testCell: record.testCell,
    artifactSHA256: record.artifactSHA256,
    candidateReceiptSHA256: record.candidateReceiptSHA256,
    consumerRepo: record.consumerRepo,
    consumerCommit: record.consumerCommit,
    runId: record.runId,
    taskId: record.taskId,
    command: record.command,
    cwd: record.cwd,
    ...(record.typescriptVersion
      ? { typescriptVersion: record.typescriptVersion }
      : {}),
  };
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(result).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(location, "must contain exactly the versioned result fields");
  }
  for (const [field, value] of Object.entries(expected)) {
    const matches =
      field === "command"
        ? JSON.stringify(result[field]) === JSON.stringify(value)
        : result[field] === value;
    if (!matches) {
      fail(`${location}.${field}`, "does not match the evidence record");
    }
  }
}

export function verifyExternalEvidenceFile({
  evidencePath,
  artifactPath,
  candidateReceiptPath,
  expectedPackageName,
  expectedArtifactVersion,
  expectedSourceCommit,
  expectedSourceTree,
  expectedNodeRange,
  requireMatrix = true,
}) {
  if (!existsSync(evidencePath)) {
    fail("evidencePath", `does not exist: ${evidencePath}`);
  }
  if (!existsSync(artifactPath)) {
    fail("artifactPath", `does not exist: ${artifactPath}`);
  }
  if (!existsSync(candidateReceiptPath)) {
    fail("candidateReceiptPath", `does not exist: ${candidateReceiptPath}`);
  }
  if (
    typeof expectedPackageName !== "string" ||
    expectedPackageName.trim().length === 0
  ) {
    fail("expectedPackageName", "must come from package.json");
  }
  if (
    typeof expectedSourceTree !== "string" ||
    !SHA1_PATTERN.test(expectedSourceTree)
  ) {
    fail("expectedSourceTree", "must be the full current source tree SHA");
  }
  const candidate = verifyReleaseCandidateReceipt({
    receiptPath: candidateReceiptPath,
    artifactPath,
    expectedPackageName,
    expectedArtifactVersion,
    expectedSourceCommit,
    expectedSourceTree,
  });
  const document = JSON.parse(readFileSync(evidencePath, "utf8"));
  const verified = validateExternalEvidenceV2(document, {
    expectedArtifactVersion,
    expectedArtifactSHA256: candidate.artifactSHA256,
    expectedSourceCommit,
    expectedCandidateReceiptSHA256: candidate.receiptSHA256,
    expectedTaskId: candidate.receipt.taskId,
    expectedNodeRange,
    requireMatrix,
  });
  const evidenceDir = path.dirname(path.resolve(evidencePath));
  for (const [index, record] of verified.records.entries()) {
    const location = `document.records[${index}]`;
    const logBytes = verifyMaterialFile(
      evidenceDir,
      record.log,
      `${location}.log`,
    );
    verifyLogMaterial(record, logBytes, `${location}.log.material`);
    const resultBytes = verifyMaterialFile(
      evidenceDir,
      record.result,
      `${location}.result`,
    );
    verifyResultMaterial(record, resultBytes, `${location}.result.material`);
  }
  return verified;
}

function readCliOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (
      ![
        "--evidence",
        "--artifact",
        "--candidate-receipt",
        "--source-commit",
      ].includes(arg)
    ) {
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

function readGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function readGitTree() {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function runCli() {
  const options = readCliOptions(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const packageMajor = /^(\d+)\./u.exec(String(pkg.version))?.[1];
  if (!packageMajor) fail("package.json", "version has no major component");
  const evidencePath = path.resolve(
    root,
    options.evidence ??
      process.env.VEXT_EXTERNAL_EVIDENCE_FILE ??
      `release/v${packageMajor}-external-validation.json`,
  );
  const artifactInput =
    options.artifact ?? process.env.VEXT_PREFLIGHT_VEXT_TARBALL;
  if (!artifactInput) {
    fail("artifactPath", "requires --artifact or VEXT_PREFLIGHT_VEXT_TARBALL");
  }
  const candidateReceiptInput =
    options["candidate-receipt"] ??
    process.env.VEXT_PREFLIGHT_CANDIDATE_RECEIPT;
  if (!candidateReceiptInput) {
    fail(
      "candidateReceiptPath",
      "requires --candidate-receipt or VEXT_PREFLIGHT_CANDIDATE_RECEIPT",
    );
  }
  const result = verifyExternalEvidenceFile({
    evidencePath,
    artifactPath: path.resolve(root, artifactInput),
    candidateReceiptPath: path.resolve(root, candidateReceiptInput),
    expectedPackageName: pkg.name,
    expectedArtifactVersion: pkg.version,
    expectedSourceCommit:
      options["source-commit"] ??
      process.env.VEXT_EXPECTED_SOURCE_COMMIT ??
      readGitHead(),
    expectedSourceTree: readGitTree(),
    expectedNodeRange: pkg.engines?.node,
    requireMatrix: true,
  });
  console.log(
    JSON.stringify({
      schemaVersion: result.schemaVersion,
      sourceCommit: result.sourceCommit,
      artifactSHA256: result.artifactSHA256,
      candidateReceiptSHA256: result.candidateReceiptSHA256,
      recordCount: result.records.length,
      status: "verified",
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

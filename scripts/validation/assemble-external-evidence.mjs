#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyExternalEvidenceFile } from "./verify-external-evidence.mjs";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function fail(location, message) {
  throw new Error(`[external-evidence-assembly] ${location} ${message}`);
}

function readOptions(argv) {
  const allowed = new Set([
    "--records-dir",
    "--output",
    "--artifact",
    "--candidate-receipt",
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!allowed.has(name)) fail("arguments", `unknown option ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("arguments", `${name} requires a value`);
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  for (const name of allowed) {
    if (!options[name.slice(2)]) fail("arguments", `${name} is required`);
  }
  return options;
}

function findRecordFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findRecordFiles(entryPath));
    else if (entry.isFile() && entry.name === "record.json")
      files.push(entryPath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function readRecord(filePath) {
  let wrapper;
  try {
    wrapper = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(
      filePath,
      `must contain JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    wrapper?.schemaVersion !== 1 ||
    wrapper?.kind !== "vextjs-external-consumer-cell-record" ||
    wrapper.record === null ||
    typeof wrapper.record !== "object" ||
    Array.isArray(wrapper.record)
  ) {
    fail(filePath, "must contain one versioned external consumer record");
  }
  return wrapper.record;
}

export function assembleExternalEvidence({
  recordsDir,
  outputPath,
  artifactPath,
  candidateReceiptPath,
  expectedPackageName,
  expectedArtifactVersion,
  expectedSourceCommit,
  expectedSourceTree,
  expectedNodeRange,
}) {
  const resolvedRecordsDir = path.resolve(recordsDir);
  const resolvedOutputPath = path.resolve(outputPath);
  if (
    !existsSync(resolvedRecordsDir) ||
    !statSync(resolvedRecordsDir).isDirectory()
  ) {
    fail("recordsDir", `does not contain a directory: ${resolvedRecordsDir}`);
  }
  const recordFiles = findRecordFiles(resolvedRecordsDir);
  if (recordFiles.length === 0)
    fail("recordsDir", "contains no record.json files");
  const records = recordFiles
    .map(readRecord)
    .sort((left, right) =>
      String(left.testCell).localeCompare(String(right.testCell)),
    );
  const document = {
    schemaVersion: 2,
    artifactVersion: expectedArtifactVersion,
    records,
  };
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(
    resolvedOutputPath,
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  const verified = verifyExternalEvidenceFile({
    evidencePath: resolvedOutputPath,
    artifactPath: path.resolve(artifactPath),
    candidateReceiptPath: path.resolve(candidateReceiptPath),
    expectedPackageName,
    expectedArtifactVersion,
    expectedSourceCommit,
    expectedSourceTree,
    expectedNodeRange,
    requireMatrix: true,
  });
  return { document, recordFiles, verified };
}

function gitValue(args) {
  return execFileSync("git", args, {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
}

function runCli() {
  const options = readOptions(process.argv.slice(2));
  const pkg = JSON.parse(
    readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
  );
  const result = assembleExternalEvidence({
    recordsDir: options["records-dir"],
    outputPath: options.output,
    artifactPath: options.artifact,
    candidateReceiptPath: options["candidate-receipt"],
    expectedPackageName: pkg.name,
    expectedArtifactVersion: pkg.version,
    expectedSourceCommit: gitValue(["rev-parse", "HEAD"]),
    expectedSourceTree: gitValue(["rev-parse", "HEAD^{tree}"]),
    expectedNodeRange: pkg.engines?.node,
  });
  console.log(
    JSON.stringify({
      status: "verified",
      recordCount: result.verified.records.length,
      artifactSHA256: result.verified.artifactSHA256,
      candidateReceiptSHA256: result.verified.candidateReceiptSHA256,
      outputPath: path.resolve(options.output),
    }),
  );
}

const directExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseCandidateReceipt } from "./freeze-release-candidate.mjs";
import { resolveValidationCommand } from "./resolve-command.mjs";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const commandTimeoutMs = 20 * 60 * 1_000;

function fail(location, message) {
  throw new Error(`[external-consumer-cell] ${location} ${message}`);
}

function readOptions(argv) {
  const allowed = new Set([
    "--artifact",
    "--candidate-receipt",
    "--consumer-root",
    "--consumer-repo",
    "--output-dir",
    "--material-prefix",
    "--platform",
    "--node-major",
    "--run-id",
    "--task-id",
    "--test-cell",
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
    const key = name.slice(2);
    if (!options[key]) fail("arguments", `${name} is required`);
  }
  return options;
}

function readPortableRelativePath(value, location) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.split("/").includes("..")
  ) {
    fail(location, "must be a portable relative path without parent traversal");
  }
  return value;
}

export function derivePortableConsumerCwd(workspaceRoot, consumerRoot) {
  const relativePath = path.relative(
    path.resolve(workspaceRoot),
    path.resolve(consumerRoot),
  );
  const portablePath = relativePath.split(path.sep).join("/");
  if (portablePath === "" || portablePath === ".") {
    fail(
      "consumerCwd",
      "must identify a consumer below the execution workspace",
    );
  }
  return readPortableRelativePath(portablePath, "consumerCwd");
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitValue(rootDir, args, location) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail(
      location,
      result.error?.message || result.stderr.trim() || "git failed",
    );
  }
  return result.stdout.trim();
}

function normalizeRepositoryUrl(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/u, "https://github.com/")
    .replace(/\.git$/u, "")
    .replace(/\/$/u, "")
    .toLowerCase();
}

function formatCommand(command, args) {
  return [command, ...args]
    .map((value) => (/\s/u.test(value) ? JSON.stringify(value) : value))
    .join(" ");
}

function runLogged(log, label, command, args, cwd, environment = {}) {
  ({ command, args } = resolveValidationCommand(command, args));
  log.push(`\n## ${label}\n$ ${formatCommand(command, args)}\n`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true", NO_COLOR: "1", ...environment },
    maxBuffer: 16 * 1024 * 1024,
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  if (result.stdout) log.push(result.stdout);
  if (result.stderr) log.push(result.stderr);
  if (result.error) {
    log.push(`${result.error.stack ?? result.error.message}\n`);
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status ?? "unknown"}`,
    );
  }
  return result.stdout.trim();
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function runExternalConsumerCell(options) {
  const artifactPath = path.resolve(options.artifact);
  const receiptPath = path.resolve(options["candidate-receipt"]);
  const consumerRootInput = path.resolve(options["consumer-root"]);
  const outputDir = path.resolve(options["output-dir"]);
  const materialPrefix = readPortableRelativePath(
    options["material-prefix"],
    "materialPrefix",
  );
  if (!existsSync(artifactPath))
    fail("artifact", `does not exist: ${artifactPath}`);
  if (!existsSync(receiptPath))
    fail("candidateReceipt", `does not exist: ${receiptPath}`);
  if (!existsSync(consumerRootInput))
    fail("consumerRoot", `does not exist: ${consumerRootInput}`);
  const consumerRoot = realpathSync(consumerRootInput);
  const executionWorkspace = path.dirname(realpathSync(sourceRoot));
  const consumerCwd = derivePortableConsumerCwd(
    executionWorkspace,
    consumerRoot,
  );
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) {
    fail("outputDir", "must be empty for one immutable cell result");
  }
  mkdirSync(outputDir, { recursive: true });

  const pkg = JSON.parse(
    readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
  );
  const sourceCommit = gitValue(
    sourceRoot,
    ["rev-parse", "HEAD"],
    "sourceCommit",
  );
  const sourceTree = gitValue(
    sourceRoot,
    ["rev-parse", "HEAD^{tree}"],
    "sourceTree",
  );
  if (gitValue(sourceRoot, ["status", "--porcelain"], "sourceStatus") !== "") {
    fail("sourceStatus", "must be clean before verifying a frozen candidate");
  }
  const candidate = verifyReleaseCandidateReceipt({
    receiptPath,
    artifactPath,
    expectedPackageName: pkg.name,
    expectedArtifactVersion: pkg.version,
    expectedSourceCommit: sourceCommit,
    expectedSourceTree: sourceTree,
  });
  if (candidate.receipt.taskId !== options["task-id"]) {
    fail("taskId", "does not match the frozen candidate receipt");
  }

  const nodeMajor = Number(options["node-major"]);
  if (
    !Number.isInteger(nodeMajor) ||
    Number(process.versions.node.split(".")[0]) !== nodeMajor
  ) {
    fail(
      "nodeMajor",
      `does not match the active Node ${process.versions.node}`,
    );
  }
  if (options.platform !== process.platform) {
    fail("platform", `does not match the active platform ${process.platform}`);
  }
  const expectedCell = `${process.platform}-node${nodeMajor}`;
  if (options["test-cell"] !== expectedCell) {
    fail("testCell", `must equal ${expectedCell}`);
  }

  const consumerCommit = gitValue(
    consumerRoot,
    ["rev-parse", "HEAD"],
    "consumerCommit",
  );
  if (
    gitValue(consumerRoot, ["status", "--porcelain"], "consumerStatus") !== ""
  ) {
    fail("consumerStatus", "must be clean before candidate installation");
  }
  const consumerRemote = gitValue(
    consumerRoot,
    ["remote", "get-url", "origin"],
    "consumerRepo",
  );
  if (
    normalizeRepositoryUrl(consumerRemote) !==
    normalizeRepositoryUrl(options["consumer-repo"])
  ) {
    fail("consumerRepo", "does not match the checked-out repository");
  }

  const consumerPackagePath = path.join(consumerRoot, "package.json");
  const consumerPackage = JSON.parse(readFileSync(consumerPackagePath, "utf8"));
  consumerPackage.dependencies = {
    ...(consumerPackage.dependencies ?? {}),
    vextjs: `file:${artifactPath.replaceAll("\\", "/")}`,
  };
  writeJson(consumerPackagePath, consumerPackage);

  const commandRecord = {
    executable: process.execPath,
    args: [
      "scripts/validation/run-external-consumer-cell.mjs",
      ...process.argv.slice(2),
    ],
  };

  const log = [
    `testCell=${options["test-cell"]}\n`,
    `sourceCommit=${sourceCommit}\n`,
    `sourceTree=${sourceTree}\n`,
    `artifactSHA256=${candidate.artifactSHA256}\n`,
    `candidateReceiptSHA256=${candidate.receiptSHA256}\n`,
    `consumerRepo=${options["consumer-repo"]}\n`,
    `consumerCommit=${consumerCommit}\n`,
    `cwd=${consumerCwd}\n`,
    `nodeVersion=${process.versions.node}\n`,
    `platform=${process.platform}\n`,
    `runId=${options["run-id"]}\n`,
    `taskId=${candidate.receipt.taskId}\n`,
  ];
  let failure;
  let typescriptVersion;
  try {
    runLogged(
      log,
      "install external consumer from exact candidate",
      npmCommand,
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumerRoot,
    );
    runLogged(
      log,
      "build external consumer",
      npmCommand,
      ["run", "build"],
      consumerRoot,
    );
    runLogged(
      log,
      "verify exact packed dependency and runtime contracts",
      process.execPath,
      [
        path.join(
          sourceRoot,
          "scripts",
          "validation",
          "verify-packed-install.mjs",
        ),
      ],
      sourceRoot,
      {
        VEXT_PREFLIGHT_VEXT_TARBALL: artifactPath,
        VEXT_PREFLIGHT_ACCEPTED_CONSUMER: consumerRoot,
        VEXT_EXPECTED_ARTIFACT_SHA256: candidate.artifactSHA256,
      },
    );
    typescriptVersion = runLogged(
      log,
      "capture external consumer TypeScript version",
      process.execPath,
      ["-p", "require('typescript/package.json').version"],
      consumerRoot,
    );
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    log.push(`\nFAILED: ${failure.stack ?? failure.message}\n`);
  }

  const accepted = failure === undefined;
  const exitCode = accepted ? 0 : 1;
  const logPath = path.join(outputDir, "consumer.log");
  const logBytes = Buffer.from(log.join(""), "utf8");
  writeFileSync(logPath, logBytes);
  const resultMaterial = {
    schemaVersion: 1,
    kind: "vextjs-external-consumer-cell-result",
    accepted,
    status: accepted ? "passed" : "failed",
    exitCode,
    sourceCommit,
    platform: process.platform,
    nodeVersion: process.versions.node,
    testCell: options["test-cell"],
    artifactSHA256: candidate.artifactSHA256,
    candidateReceiptSHA256: candidate.receiptSHA256,
    consumerRepo: options["consumer-repo"],
    consumerCommit,
    runId: options["run-id"],
    taskId: candidate.receipt.taskId,
    command: commandRecord,
    cwd: consumerCwd,
    ...(typescriptVersion ? { typescriptVersion } : {}),
    ...(failure ? { error: failure.message } : {}),
  };
  const resultPath = path.join(outputDir, "result.json");
  writeJson(resultPath, resultMaterial);
  const resultBytes = readFileSync(resultPath);
  const record = {
    accepted,
    sourceCommit,
    platform: process.platform,
    nodeVersion: process.versions.node,
    ...(typescriptVersion ? { typescriptVersion } : {}),
    testCell: options["test-cell"],
    artifactSHA256: candidate.artifactSHA256,
    candidateReceiptSHA256: candidate.receiptSHA256,
    consumerRepo: options["consumer-repo"],
    consumerCommit,
    runId: options["run-id"],
    taskId: candidate.receipt.taskId,
    command: commandRecord,
    cwd: consumerCwd,
    exitCode,
    log: {
      path: path.posix.join(materialPrefix, "consumer.log"),
      sha256: hash(logBytes),
    },
    result: {
      path: path.posix.join(materialPrefix, "result.json"),
      status: accepted ? "passed" : "failed",
      sha256: hash(resultBytes),
    },
    inputRevision: {
      sourceCommit,
      artifactSHA256: candidate.artifactSHA256,
      consumerCommit,
      candidateReceiptSHA256: candidate.receiptSHA256,
    },
  };
  writeJson(path.join(outputDir, "record.json"), {
    schemaVersion: 1,
    kind: "vextjs-external-consumer-cell-record",
    record,
  });
  if (failure) throw failure;
  return record;
}

function runCli() {
  const record = runExternalConsumerCell(readOptions(process.argv.slice(2)));
  console.log(
    JSON.stringify({
      status: "passed",
      testCell: record.testCell,
      artifactSHA256: record.artifactSHA256,
      consumerCommit: record.consumerCommit,
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

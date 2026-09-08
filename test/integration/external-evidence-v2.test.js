import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateExternalEvidenceV2,
  verifyExternalEvidenceFile,
} from "../../scripts/validation/verify-external-evidence.mjs";
import { assembleExternalEvidence } from "../../scripts/validation/assemble-external-evidence.mjs";

const fixturePath = fileURLToPath(
  new URL("../fixtures/external-evidence-v2/valid.json", import.meta.url),
);
const sourceCommit = "1".repeat(40);
const sourceTree = "2".repeat(40);
const taskId = "5516fb86-bfa7-52eb-8aca-09e5be0e7d56";
let temporaryRoot;
let temporaryOutsideRoot;

afterEach(async () => {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
  if (temporaryOutsideRoot) {
    await rm(temporaryOutsideRoot, { recursive: true, force: true });
    temporaryOutsideRoot = undefined;
  }
});

async function readFixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function digest(bytes, algorithm, encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function createPackInput(files) {
  return {
    digest: digest(Buffer.from(stableStringify(files)), "sha256"),
    fileCount: files.length,
    files,
  };
}

async function createBoundFixture() {
  temporaryRoot = await mkdtemp(join(tmpdir(), "vext-evidence-v2-"));
  const artifactPath = join(temporaryRoot, "vextjs-2.0.0.tgz");
  const artifactBytes = gzipSync(
    Buffer.from("one immutable fixture artifact", "utf8"),
  );
  await writeFile(artifactPath, artifactBytes);
  const artifactSHA256 = digest(artifactBytes, "sha256");
  const files = [
    {
      path: "package.json",
      packedSize: 128,
      mode: 420,
      sourceBytes: 128,
      sourceSHA256: "3".repeat(64),
    },
  ];
  const packInput = createPackInput(files);
  const candidateReceiptPath = join(temporaryRoot, "candidate-receipt.json");
  const receipt = {
    schemaVersion: 1,
    kind: "vextjs-release-candidate",
    taskId,
    source: { commit: sourceCommit, tree: sourceTree, clean: true },
    package: { name: "vextjs", version: "2.0.0" },
    artifact: {
      fileName: "vextjs-2.0.0.tgz",
      sha256: artifactSHA256,
      sha512: digest(artifactBytes, "sha512"),
      integrity: `sha512-${digest(artifactBytes, "sha512", "base64")}`,
      bytes: artifactBytes.byteLength,
      entryCount: files.length,
    },
    packInput,
    generator: {
      command: "fixture",
      nodeVersion: process.version,
      platform: process.platform,
    },
    createdAt: "2026-08-30T00:00:00.000Z",
  };
  await writeFile(
    candidateReceiptPath,
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  const candidateReceiptSHA256 = digest(
    await readFile(candidateReceiptPath),
    "sha256",
  );
  const document = await readFixture();
  const materialPaths = [];
  await mkdir(join(temporaryRoot, "evidence"), { recursive: true });
  for (const record of document.records) {
    record.sourceCommit = sourceCommit;
    record.artifactSHA256 = artifactSHA256;
    record.candidateReceiptSHA256 = candidateReceiptSHA256;
    record.inputRevision.sourceCommit = sourceCommit;
    record.inputRevision.artifactSHA256 = artifactSHA256;
    record.inputRevision.candidateReceiptSHA256 = candidateReceiptSHA256;
    const logPath = join(temporaryRoot, ...record.log.path.split("/"));
    const logBytes = Buffer.from(
      [
        `testCell=${record.testCell}`,
        `sourceCommit=${sourceCommit}`,
        `artifactSHA256=${artifactSHA256}`,
        `candidateReceiptSHA256=${candidateReceiptSHA256}`,
        `consumerRepo=${record.consumerRepo}`,
        `consumerCommit=${record.consumerCommit}`,
        `cwd=${record.cwd}`,
        `nodeVersion=${record.nodeVersion}`,
        `platform=${record.platform}`,
        `runId=${record.runId}`,
        `taskId=${taskId}`,
        "passed",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(logPath, logBytes);
    record.log.sha256 = digest(logBytes, "sha256");

    const resultPath = join(temporaryRoot, ...record.result.path.split("/"));
    const resultMaterial = {
      schemaVersion: 1,
      kind: "vextjs-external-consumer-cell-result",
      accepted: true,
      status: "passed",
      exitCode: 0,
      sourceCommit,
      platform: record.platform,
      nodeVersion: record.nodeVersion,
      testCell: record.testCell,
      artifactSHA256,
      candidateReceiptSHA256,
      consumerRepo: record.consumerRepo,
      consumerCommit: record.consumerCommit,
      runId: record.runId,
      taskId,
      command: record.command,
      cwd: record.cwd,
      typescriptVersion: record.typescriptVersion,
    };
    const resultBytes = Buffer.from(
      `${JSON.stringify(resultMaterial, null, 2)}\n`,
      "utf8",
    );
    await writeFile(resultPath, resultBytes);
    record.result.sha256 = digest(resultBytes, "sha256");
    materialPaths.push({ logPath, resultPath });
  }
  const evidencePath = join(temporaryRoot, "external-evidence.json");
  await writeFile(evidencePath, JSON.stringify(document, null, 2), "utf8");
  return {
    artifactPath,
    artifactSHA256,
    candidateReceiptPath,
    candidateReceiptSHA256,
    document,
    evidencePath,
    materialPaths,
  };
}

function validationOptions(fixture, overrides = {}) {
  return {
    expectedArtifactVersion: "2.0.0",
    expectedArtifactSHA256: fixture.artifactSHA256,
    expectedSourceCommit: sourceCommit,
    expectedCandidateReceiptSHA256: fixture.candidateReceiptSHA256,
    expectedTaskId: taskId,
    expectedNodeRange: ">=20.19.0",
    ...overrides,
  };
}

function verifyBoundFixture(fixture) {
  return verifyExternalEvidenceFile({
    evidencePath: fixture.evidencePath,
    artifactPath: fixture.artifactPath,
    candidateReceiptPath: fixture.candidateReceiptPath,
    expectedPackageName: "vextjs",
    expectedArtifactVersion: "2.0.0",
    expectedSourceCommit: sourceCommit,
    expectedSourceTree: sourceTree,
    expectedNodeRange: ">=20.19.0",
  });
}

describe("external evidence v2", () => {
  it("accepts a complete matrix bound to one artifact and source commit", async () => {
    const fixture = await createBoundFixture();
    const result = verifyBoundFixture(fixture);

    expect(result.artifactSHA256).toBe(fixture.artifactSHA256);
    expect(result.sourceCommit).toBe(sourceCommit);
    expect(result.records).toHaveLength(4);
  });

  it("assembles four immutable cell fragments before verification", async () => {
    const fixture = await createBoundFixture();
    const recordsDir = join(temporaryRoot, "record-fragments");
    for (const record of fixture.document.records) {
      const cellDir = join(recordsDir, record.testCell);
      await mkdir(cellDir, { recursive: true });
      await writeFile(
        join(cellDir, "record.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            kind: "vextjs-external-consumer-cell-record",
            record,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    const outputPath = join(temporaryRoot, "assembled-evidence.json");
    const result = assembleExternalEvidence({
      recordsDir,
      outputPath,
      artifactPath: fixture.artifactPath,
      candidateReceiptPath: fixture.candidateReceiptPath,
      expectedPackageName: "vextjs",
      expectedArtifactVersion: "2.0.0",
      expectedSourceCommit: sourceCommit,
      expectedSourceTree: sourceTree,
      expectedNodeRange: ">=20.19.0",
    });

    expect(result.recordFiles).toHaveLength(4);
    expect(result.verified.records).toHaveLength(4);
  });

  it("rejects a missing referenced log file", async () => {
    const fixture = await createBoundFixture();
    await rm(fixture.materialPaths[0].logPath);
    expect(() => verifyBoundFixture(fixture)).toThrow(
      "log.path does not exist",
    );
  });

  it("rejects a material path that traverses a symbolic directory", async () => {
    const fixture = await createBoundFixture();
    const evidenceDirectory = join(temporaryRoot, "evidence");
    temporaryOutsideRoot = await mkdtemp(
      join(tmpdir(), "vext-evidence-outside-"),
    );
    const relocatedDirectory = join(temporaryOutsideRoot, "materials");
    await rename(evidenceDirectory, relocatedDirectory);
    await symlink(
      relocatedDirectory,
      evidenceDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() => verifyBoundFixture(fixture)).toThrow(
      "must not traverse symbolic links",
    );
  });

  it("rejects referenced log bytes that no longer match their digest", async () => {
    const fixture = await createBoundFixture();
    await writeFile(fixture.materialPaths[0].logPath, "tampered log\n", "utf8");
    expect(() => verifyBoundFixture(fixture)).toThrow(
      "log.sha256 does not match",
    );
  });

  it("rejects a rehashed log whose execution identity differs", async () => {
    const fixture = await createBoundFixture();
    const record = fixture.document.records[0];
    const logBytes = Buffer.from(
      (await readFile(fixture.materialPaths[0].logPath, "utf8")).replace(
        `runId=${record.runId}`,
        "runId=another-run",
      ),
      "utf8",
    );
    await writeFile(fixture.materialPaths[0].logPath, logBytes);
    record.log.sha256 = digest(logBytes, "sha256");
    await writeFile(
      fixture.evidencePath,
      JSON.stringify(fixture.document, null, 2),
      "utf8",
    );

    expect(() => verifyBoundFixture(fixture)).toThrow(
      "log.material does not bind runId",
    );
  });

  it("rejects a missing referenced result file", async () => {
    const fixture = await createBoundFixture();
    await rm(fixture.materialPaths[0].resultPath);
    expect(() => verifyBoundFixture(fixture)).toThrow(
      "result.path does not exist",
    );
  });

  it("rejects referenced result bytes that no longer match their digest", async () => {
    const fixture = await createBoundFixture();
    await writeFile(
      fixture.materialPaths[0].resultPath,
      '{"status":"passed"}\n',
      "utf8",
    );
    expect(() => verifyBoundFixture(fixture)).toThrow(
      "result.sha256 does not match",
    );
  });

  it("rejects a rehashed result whose semantic identity differs", async () => {
    const fixture = await createBoundFixture();
    const resultMaterial = JSON.parse(
      await readFile(fixture.materialPaths[0].resultPath, "utf8"),
    );
    resultMaterial.runId = "another-run";
    const resultBytes = Buffer.from(
      `${JSON.stringify(resultMaterial, null, 2)}\n`,
      "utf8",
    );
    await writeFile(fixture.materialPaths[0].resultPath, resultBytes);
    fixture.document.records[0].result.sha256 = digest(resultBytes, "sha256");
    await writeFile(
      fixture.evidencePath,
      JSON.stringify(fixture.document, null, 2),
      "utf8",
    );
    expect(() => verifyBoundFixture(fixture)).toThrow(
      "result.material.runId does not match",
    );
  });

  it("rejects unexpected fields in a rehashed result material", async () => {
    const fixture = await createBoundFixture();
    const resultMaterial = JSON.parse(
      await readFile(fixture.materialPaths[0].resultPath, "utf8"),
    );
    resultMaterial.note = "shape-only pass";
    const resultBytes = Buffer.from(
      `${JSON.stringify(resultMaterial, null, 2)}\n`,
      "utf8",
    );
    await writeFile(fixture.materialPaths[0].resultPath, resultBytes);
    fixture.document.records[0].result.sha256 = digest(resultBytes, "sha256");
    await writeFile(
      fixture.evidencePath,
      JSON.stringify(fixture.document, null, 2),
      "utf8",
    );

    expect(() => verifyBoundFixture(fixture)).toThrow(
      "must contain exactly the versioned result fields",
    );
  });

  it("rejects a shape-only candidate receipt before trusting its task id", async () => {
    const fixture = await createBoundFixture();
    await writeFile(
      fixture.candidateReceiptPath,
      JSON.stringify({ schemaVersion: 1, taskId }),
      "utf8",
    );
    expect(() => verifyBoundFixture(fixture)).toThrow("receipt.kind");
  });

  it("rejects a missing required cell field", async () => {
    const fixture = await createBoundFixture();
    delete fixture.document.records[0].platform;

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("records[0].platform");
  });

  it("rejects evidence for a different artifact SHA", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[2].artifactSHA256 = "f".repeat(64);

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("does not match frozen artifact");
  });

  it("rejects evidence for a different source commit", async () => {
    const fixture = await createBoundFixture();

    expect(() =>
      validateExternalEvidenceV2(
        fixture.document,
        validationOptions(fixture, {
          expectedSourceCommit: "a".repeat(40),
        }),
      ),
    ).toThrow("does not match expected source commit");
  });

  it("rejects an incomplete Windows/Linux and Node 20/22 matrix", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records = fixture.document.records.filter(
      (record) =>
        !(record.platform === "linux" && record.nodeVersion.startsWith("22.")),
    );

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("missing required matrix cell linux:node22");
  });

  it("rejects a test-cell label that disagrees with its platform and Node major", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[0].testCell = "another-cell";

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("testCell must equal win32-node20");
  });

  it("rejects cells outside the exact four-cell matrix", async () => {
    const fixture = await createBoundFixture();
    const extra = structuredClone(fixture.document.records[3]);
    extra.nodeVersion = "24.0.0";
    extra.testCell = "linux-node24";
    extra.runId = "fixture-linux-node24";
    fixture.document.records.push(extra);

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("not an allowed matrix cell linux:node24");
  });

  it("rejects duplicate execution identities across matrix cells", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[1].runId = fixture.document.records[0].runId;

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("duplicates execution identity");
  });

  it("rejects mixed consumer working directories across matrix cells", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[1].cwd = "another-consumer";

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("must be the same in every matrix cell");
  });

  it("rejects cells without reproducible command evidence", async () => {
    const fixture = await createBoundFixture();
    delete fixture.document.records[0].command;

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("records[0].command");
  });

  it("rejects non-zero command results even when accepted is true", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[0].exitCode = 1;

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("records[0].exitCode");
  });

  it("rejects an input revision that does not repeat the tested identities", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[0].inputRevision.consumerCommit = "a".repeat(40);

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("records[0].inputRevision");
  });

  it("rejects Node 20 versions below the package engine floor", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[0].nodeVersion = "20.0.0";

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("does not satisfy package engine >=20.19.0");
  });

  it("rejects a mixed consumer repository or commit across matrix cells", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[3].consumerRepo =
      "https://github.com/devcodex-labs/other-consumer.git";

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("same consumer repository and commit");
  });

  it("rejects evidence bound to another candidate receipt", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[1].candidateReceiptSHA256 = "f".repeat(64);

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("does not match candidate receipt");
  });

  it("rejects a matrix cell attributed to another task", async () => {
    const fixture = await createBoundFixture();
    fixture.document.records[2].taskId = "another-task";

    expect(() =>
      validateExternalEvidenceV2(fixture.document, validationOptions(fixture)),
    ).toThrow("does not match candidate receipt task");
  });
});

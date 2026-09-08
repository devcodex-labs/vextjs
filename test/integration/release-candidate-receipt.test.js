import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  validateCandidatePackInput,
  verifyReleaseCandidateReceipt,
} from "../../scripts/validation/freeze-release-candidate.mjs";

const sourceCommit = "1".repeat(40);
const sourceTree = "2".repeat(40);
let temporaryRoot;

afterEach(async () => {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

function digest(buffer, algorithm, encoding = "hex") {
  return createHash(algorithm).update(buffer).digest(encoding);
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

async function createFixture({ gzip = true } = {}) {
  temporaryRoot = await mkdtemp(join(tmpdir(), "vext-release-receipt-"));
  const artifactPath = join(temporaryRoot, "vextjs-2.0.0.tgz");
  const artifactBytes = gzip
    ? gzipSync(Buffer.from("immutable release candidate"))
    : Buffer.from("not a gzip artifact");
  await writeFile(artifactPath, artifactBytes);
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
  const sha512Base64 = digest(artifactBytes, "sha512", "base64");
  const receipt = {
    schemaVersion: 1,
    kind: "vextjs-release-candidate",
    taskId: "5516fb86-bfa7-52eb-8aca-09e5be0e7d56",
    source: { commit: sourceCommit, tree: sourceTree, clean: true },
    package: { name: "vextjs", version: "2.0.0" },
    artifact: {
      fileName: "vextjs-2.0.0.tgz",
      sha256: digest(artifactBytes, "sha256"),
      sha512: digest(artifactBytes, "sha512"),
      integrity: `sha512-${sha512Base64}`,
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
  const receiptPath = join(temporaryRoot, "candidate-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { artifactPath, packInput, receipt, receiptPath };
}

function verifyFixture(fixture, overrides = {}) {
  return verifyReleaseCandidateReceipt({
    receiptPath: fixture.receiptPath,
    artifactPath: fixture.artifactPath,
    expectedPackageName: "vextjs",
    expectedArtifactVersion: "2.0.0",
    expectedSourceCommit: sourceCommit,
    expectedSourceTree: sourceTree,
    ...overrides,
  });
}

describe("release candidate receipt", () => {
  it("accepts a gzip artifact bound to source, package, and pack inputs", async () => {
    const fixture = await createFixture();
    const result = verifyFixture(fixture);

    expect(result.sourceCommit).toBe(sourceCommit);
    expect(result.sourceTree).toBe(sourceTree);
    expect(result.artifactSHA256).toBe(fixture.receipt.artifact.sha256);
    expect(result.receiptSHA256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a non-gzip file even when its digests were recorded", async () => {
    const fixture = await createFixture({ gzip: false });

    expect(() => verifyFixture(fixture)).toThrow("must be a gzip tarball");
  });

  it("rejects a receipt for another source commit", async () => {
    const fixture = await createFixture();

    expect(() =>
      verifyFixture(fixture, { expectedSourceCommit: "a".repeat(40) }),
    ).toThrow("does not match the current source commit");
  });

  it("rejects source pack-input drift after the candidate was frozen", async () => {
    const fixture = await createFixture();
    const changedFiles = fixture.packInput.files.map((file) => ({
      ...file,
      sourceSHA256: "f".repeat(64),
    }));
    const changed = createPackInput(changedFiles);

    expect(() =>
      validateCandidatePackInput(fixture.packInput, changed),
    ).toThrow("does not match the frozen candidate pack-input closure");
  });

  it("rejects artifact bytes that no longer match the receipt", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.artifactPath,
      gzipSync(Buffer.from("different candidate bytes")),
    );

    expect(() => verifyFixture(fixture)).toThrow(
      "digest does not match the frozen tarball bytes",
    );
  });
});

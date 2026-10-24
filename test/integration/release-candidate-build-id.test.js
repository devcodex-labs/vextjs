import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  freezeReleaseCandidate,
  readFrozenFrameworkBuildId,
  verifyReleaseCandidateReceipt,
  verifyReleaseCandidateSourceInputs,
} from "../../scripts/validation/freeze-release-candidate.mjs";
import {
  FRAMEWORK_BUILD_ID_ENV,
  resolveFrameworkBuildId,
} from "../../scripts/implementation-manifest.mjs";

const manifestModule = pathToFileURL(
  resolve("scripts/implementation-manifest.mjs"),
).href;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
let temporaryRoot;

afterEach(async () => {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Minimal package whose build mirrors the framework one-shot buildId rule. */
async function createPackage() {
  temporaryRoot = await mkdtemp(join(tmpdir(), "vext-release-build-id-"));
  const rootDir = join(temporaryRoot, "source");
  execFileSync("git", ["init", "-q", rootDir]);
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "vextjs",
      version: "2.1.0",
      files: ["dist"],
      scripts: { build: "node build.mjs" },
    }),
  );
  await writeFile(join(rootDir, ".gitignore"), "dist\n");
  await writeFile(
    join(rootDir, "build.mjs"),
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      `import { resolveFrameworkBuildId } from ${JSON.stringify(manifestModule)};`,
      'mkdirSync("dist", { recursive: true });',
      'writeFileSync("dist/index.js", "export const answer = 42;\\n");',
      "writeFileSync(",
      '  "dist/.implementation.json",',
      '  JSON.stringify({ state: "complete", buildId: resolveFrameworkBuildId() }) + "\\n",',
      ");",
      "",
    ].join("\n"),
  );
  git(rootDir, "add", "-A");
  git(
    rootDir,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  return rootDir;
}

function rebuild(rootDir, buildId) {
  const env = { ...process.env };
  delete env[FRAMEWORK_BUILD_ID_ENV];
  if (buildId !== undefined) env[FRAMEWORK_BUILD_ID_ENV] = buildId;
  execFileSync("node", ["build.mjs"], { cwd: rootDir, env, stdio: "pipe" });
}

function verifyRebuilt(rootDir, frozen) {
  const verified = verifyReleaseCandidateReceipt({
    receiptPath: frozen.receiptPath,
    artifactPath: frozen.artifactPath,
    expectedPackageName: "vextjs",
    expectedArtifactVersion: "2.1.0",
    expectedSourceCommit: git(rootDir, "rev-parse", "HEAD"),
    expectedSourceTree: git(rootDir, "rev-parse", "HEAD^{tree}"),
  });
  return verifyReleaseCandidateSourceInputs({
    rootDir,
    receipt: verified.receipt,
  });
}

describe("frozen framework buildId reuse", () => {
  it("resolves a random buildId unless a valid one is pinned", () => {
    const first = resolveFrameworkBuildId({});
    const second = resolveFrameworkBuildId({});
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
    const pinned = "0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f";
    expect(resolveFrameworkBuildId({ [FRAMEWORK_BUILD_ID_ENV]: pinned })).toBe(
      pinned,
    );
    for (const invalid of [
      "bad",
      pinned.toUpperCase(),
      `${pinned} `,
      `${pinned}0`,
    ]) {
      expect(() =>
        resolveFrameworkBuildId({ [FRAMEWORK_BUILD_ID_ENV]: invalid }),
      ).toThrow(/must be a lowercase UUID/u);
    }
  });

  it("matches the frozen pack-input only when rebuilt with the frozen buildId", async () => {
    const rootDir = await createPackage();
    const frozen = freezeReleaseCandidate({
      rootDir,
      outputDir: join(temporaryRoot, "candidate"),
      taskId: "build-id-regression",
    });
    const frozenBuildId = readFrozenFrameworkBuildId(frozen.artifactPath);
    expect(frozenBuildId).toMatch(UUID);
    expect(
      JSON.parse(
        await readFile(join(rootDir, "dist/.implementation.json"), "utf8"),
      ).buildId,
    ).toBe(frozenBuildId);

    // A fresh random buildId reproduces the v2.1.0 final-preflight failure.
    await rm(join(rootDir, "dist"), { recursive: true, force: true });
    rebuild(rootDir);
    expect(() => verifyRebuilt(rootDir, frozen)).toThrow(
      /does not match the frozen candidate pack-input closure/u,
    );

    await rm(join(rootDir, "dist"), { recursive: true, force: true });
    rebuild(rootDir, frozenBuildId);
    expect(verifyRebuilt(rootDir, frozen).fileCount).toBe(
      frozen.receipt.packInput.fileCount,
    );

    await appendFile(join(rootDir, "dist/index.js"), " ");
    expect(() => verifyRebuilt(rootDir, frozen)).toThrow(
      /does not match the frozen candidate pack-input closure/u,
    );
  });

  it("rejects a tarball without a framework implementation manifest", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "vext-release-build-id-"));
    const artifactPath = join(temporaryRoot, "vextjs-2.1.0.tgz");
    await writeFile(artifactPath, "not gzip");
    expect(() => readFrozenFrameworkBuildId(artifactPath)).toThrow(
      /not a readable gzip tarball/u,
    );
  });
});

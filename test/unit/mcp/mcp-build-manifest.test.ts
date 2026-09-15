import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  createImplementationTracker,
  inspectFrameworkSourceBuild,
} from "../../../src/assistant/implementation-identity.js";
import {
  BUILD_INPUT_FILES,
  inspectBuildInputs,
  publishImplementationManifest,
  completeImplementationBuild,
} from "../../../scripts/implementation-manifest.mjs";

async function fixture(run: (root: string, dist: string) => Promise<void>) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "vext-build-manifest-"));
  try {
    await mkdir(path.join(root, "src", "assistant"), { recursive: true });
    await mkdir(path.join(root, "scripts"));
    await mkdir(path.join(root, "dist"));
    for (const file of BUILD_INPUT_FILES)
      await writeFile(
        path.join(root, file),
        file === "package.json" ? '{"name":"fixture","version":"2.0.0"}' : "{}",
      );
    await writeFile(
      path.join(root, "src", "assistant", "implementation-identity.ts"),
      "export const answer = 1;",
    );
    await writeFile(
      path.join(root, "dist", "server.js"),
      "export const answer = 1;",
    );
    await run(root, path.join(root, "dist"));
  } finally {
    expect(path.dirname(await realpath(root))).toBe(parent);
    await rm(root, { recursive: true, force: true });
  }
}

it("requires completed build evidence, captures loaded identity, and detects same-version rebuilt code", async () =>
  fixture(async (root, dist) => {
    expect(createImplementationTracker(dist)()).toMatchObject({
      state: "unverified",
      buildState: "missing",
    });
    const before = inspectBuildInputs(root);
    publishImplementationManifest(root, {
      state: "building",
      buildId: randomUUID(),
    });
    const partial = createImplementationTracker(dist);
    expect(partial()).toMatchObject({
      state: "unverified",
      buildState: "building",
    });
    completeImplementationBuild(root, before, randomUUID(), ["esm"]);
    expect(partial().state).toBe("unverified"); // initialization during a build never becomes current retroactively
    expect(
      createImplementationTracker(dist, {
        compiledInputDigest: "0".repeat(64),
      })().state,
    ).toBe("unverified");
    const inspect = createImplementationTracker(dist, {
      compiledInputDigest: before.inputDigest,
    });
    const loaded = inspect();
    expect(loaded).toMatchObject({
      state: "current",
      evidence: "build-manifest",
      packageVersion: "2.0.0",
    });
    await writeFile(path.join(dist, "server.js"), "export const answer = 2;");
    completeImplementationBuild(root, before, randomUUID(), ["esm"]);
    expect(inspect()).toMatchObject({
      state: "restart-required",
      loadedDigest: loaded.loadedDigest,
    });
    expect(createImplementationTracker(dist)().state).toBe("current");
  }));

it("checks source freshness explicitly, detects changing build inputs, and does not require source in installed packages", async () =>
  fixture(async (root, dist) => {
    const before = inspectBuildInputs(root);
    completeImplementationBuild(root, before, randomUUID(), ["esm"]);
    expect(inspectFrameworkSourceBuild(dist).state).toBe("current");
    await writeFile(
      path.join(root, "src", "assistant", "implementation-identity.ts"),
      "export const answer = 2;",
    );
    expect(inspectFrameworkSourceBuild(dist).state).toBe("build-required");
    expect(() =>
      completeImplementationBuild(root, before, randomUUID(), ["esm"]),
    ).toThrow("changed during build");
    await rm(path.join(root, "src", "assistant", "implementation-identity.ts"));
    expect(inspectFrameworkSourceBuild(dist).state).toBe("unavailable");
    expect(createImplementationTracker(dist)().state).toBe("current");
  }));

it("does not recursively scan dist for each inspection and rejects invalid completion markers", async () =>
  fixture(async (root, dist) => {
    completeImplementationBuild(root, inspectBuildInputs(root), randomUUID(), [
      "esm",
    ]);
    const inspect = createImplementationTracker(dist);
    // A large unrelated output is not touched by per-request manifest inspection.
    await writeFile(
      path.join(dist, "unrelated.js"),
      "x".repeat(4 * 1024 * 1024 + 1),
    );
    expect(inspect().state).toBe("current");
    const marker = path.join(dist, ".implementation.json");
    const data = JSON.parse(await readFile(marker, "utf8"));
    data.digest = "0".repeat(64);
    await writeFile(marker, JSON.stringify(data));
    expect(inspect()).toMatchObject({
      state: "unverified",
      buildState: "invalid",
    });
  }));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { build as bundle } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginBuild,
  completeBuild,
  failBuild,
  resolveBuildLocation,
  selectBuildOutput,
} from "../../src/lib/build/build-location.js";
import {
  acquireProjectOwner,
  withProjectOwner,
} from "../../src/lib/project/owner.js";
import { withArtifactGroupTransaction } from "../../src/lib/project/artifact-transaction.js";

const roots: string[] = [];
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-build-state-"));
  roots.push(root);
  return root;
}
function read(root: string, file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function write(root: string, file: string, content: string) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("build state publication", () => {
  it("rejects completion from an older generation", async () => {
    const root = project();
    const first = await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    const before = read(root, "release/.vext-build.json");
    await expect(
      Promise.resolve().then(() => completeBuild(root, first)),
    ).rejects.toThrow();
    expect(read(root, "release/.vext-build.json")).toBe(before);
  });

  it("does not publish ready when the second identity path cannot be written", async () => {
    const root = project();
    const build = await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    fs.mkdirSync(path.join(root, ".vext", "build-location.json"), {
      recursive: true,
    });
    const before = read(root, "release/.vext-build.json");
    await expect(
      Promise.resolve().then(() => completeBuild(root, build)),
    ).rejects.toThrow();
    expect(read(root, "release/.vext-build.json")).toBe(before);
  });

  it("acquires ownership before invalidating the old build", async () => {
    const root = project();
    const build = await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    await completeBuild(root, build);
    const before = read(root, "release/.vext-build.json");
    const owner = await acquireProjectOwner(root, "dev");
    try {
      await expect(
        Promise.resolve().then(() =>
          beginBuild(
            root,
            path.join(root, "release"),
            "production",
            "compiled",
          ),
        ),
      ).rejects.toMatchObject({ code: "VEXT_OWNER_BUSY" });
      expect(read(root, "release/.vext-build.json")).toBe(before);
    } finally {
      await owner.release();
    }
  });

  it("preserves externally edited identity files", async () => {
    const root = project();
    const build = await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    const changed = JSON.stringify({ ...build, buildId: "external" });
    write(root, "release/.vext-build.json", changed);
    await expect(
      Promise.resolve().then(() => completeBuild(root, build)),
    ).rejects.toThrow();
    expect(read(root, "release/.vext-build.json")).toBe(changed);
  });

  it("rejects oversized identity metadata without treating it as a missing build", async () => {
    const root = project();
    const build = await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    write(
      root,
      "release/.vext-build.json",
      JSON.stringify({ ...build, padding: "x".repeat(20 * 1024) }),
    );
    expect(() => resolveBuildLocation(root, "release")).toThrow();
  });

  it("does not attest ready while a generated artifact transaction is pending", async () => {
    const root = project();
    const build = await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    await completeBuild(root, build);
    write(root, ".vext/freshness/v1/transaction.json", '{"pending":true}');
    expect(resolveBuildLocation(root).failure).toMatch(/transaction/);
  });

  it("rolls back both identity files when replacement of the location pointer fails", async () => {
    const root = project();
    await completeBuild(
      root,
      await beginBuild(
        root,
        path.join(root, "release"),
        "production",
        "compiled",
      ),
    );
    const build = await beginBuild(
      root,
      path.join(root, "release"),
      "staging",
      "compiled",
    );
    const files = [
      "release/.vext-build.json",
      ".vext/build-location.json",
      ".vext/freshness/v1/artifacts.json",
    ];
    const before = files.map((file) => read(root, file));
    const rename = fs.renameSync;
    let failed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (
        !failed &&
        String(to).toLowerCase() ===
          path.join(root, ".vext/build-location.json").toLowerCase()
      ) {
        failed = true;
        throw Object.assign(new Error("injected pointer replacement failure"), {
          code: "EACCES",
        });
      }
      return rename(from, to);
    });
    await expect(completeBuild(root, build)).rejects.toThrow(
      "injected pointer",
    );
    expect(failed).toBe(true);
    expect(files.map((file) => read(root, file))).toEqual(before);
    expect(
      fs.existsSync(path.join(root, ".vext/freshness/v1/transaction.json")),
    ).toBe(false);
    vi.restoreAllMocks();
    await completeBuild(root, build);
    expect(resolveBuildLocation(root).identity?.profile).toBe("staging");
  });

  it("keeps a different successful output selected after failure and refuses to complete the failed generation", async () => {
    const root = project();
    await completeBuild(
      root,
      await beginBuild(root, path.join(root, "good"), "production", "compiled"),
    );
    const build = await beginBuild(
      root,
      path.join(root, "bad"),
      "staging",
      "compiled",
    );
    await failBuild(root, build);
    expect(resolveBuildLocation(root).outDir).toBe(path.join(root, "good"));
    expect(resolveBuildLocation(root).failure).toBeUndefined();
    expect(resolveBuildLocation(root, "bad").identity?.status).toBe("failed");
    await expect(completeBuild(root, build)).rejects.toThrow("failed build");
    const repaired = await beginBuild(
      root,
      path.join(root, "bad"),
      "staging",
      "compiled",
    );
    await completeBuild(root, repaired);
    expect(resolveBuildLocation(root).outDir).toBe(path.join(root, "bad"));
  });

  it("does not trust a matching pair of identity files changed outside their recorded generation", async () => {
    const root = project();
    const build = await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    await completeBuild(root, build);
    const edited = JSON.stringify({
      ...build,
      status: "ready",
      buildId: "externally-attested",
    });
    write(root, "release/.vext-build.json", edited);
    write(root, ".vext/build-location.json", edited);
    expect(resolveBuildLocation(root).failure).toMatch(/identity/);
  });

  it.each(["output", "pointer", "manifest"])(
    "recovers a process interrupted after the %s replacement",
    async (phase) => {
      const root = project();
      const outDir = path.join(root, "release");
      const previous = await beginBuild(root, outDir, "production", "compiled");
      await completeBuild(root, previous);
      const attempt = await beginBuild(root, outDir, "staging", "compiled");
      write(root, "build-attempt.json", JSON.stringify(attempt));
      const fixture = path.join(root, "crash.cjs");
      await bundle({
        entryPoints: [path.resolve("test/fixtures/build-state-crash-child.ts")],
        outfile: fixture,
        bundle: true,
        platform: "node",
        format: "cjs",
        logLevel: "silent",
      });
      const child = fork(fixture, [root, phase], {
        execArgv: [],
        stdio: "ignore",
      });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 12_000);
      try {
        await new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", () => resolve());
        });
      } finally {
        clearTimeout(timeout);
      }
      expect(JSON.parse(read(root, "crash-point.json"))).toEqual({
        phase,
        pid: child.pid,
      });
      expect(child.exitCode).not.toBe(0);
      expect(resolveBuildLocation(root).failure).toMatch(/transaction/);
      await withProjectOwner(root, "build", [outDir, ".vext"], () =>
        withArtifactGroupTransaction(
          { rootDir: root, outputs: [{ outDir, producer: "build-state" }] },
          async () => {
            const marker = JSON.parse(read(root, "release/.vext-build.json"));
            const pointer = JSON.parse(read(root, ".vext/build-location.json"));
            expect(marker.status).toBe(
              phase === "manifest" ? "ready" : "building",
            );
            expect(pointer.buildId).toBe(
              phase === "manifest" ? attempt.buildId : previous.buildId,
            );
          },
        ),
      );
      await completeBuild(root, attempt);
      expect(resolveBuildLocation(root).failure).toBeUndefined();
      expect(
        fs.existsSync(path.join(root, ".vext/freshness/v1/transaction.json")),
      ).toBe(false);
      expect(
        fs.readdirSync(path.join(root, ".vext/freshness/v1/transactions")),
      ).toEqual([]);
      console.log(
        `[build state recovery] phase=${phase} pid=${child.pid} exited, recovered=${root}`,
      );
    },
  );

  it("does not rewrite already completed identity files", async () => {
    const root = project();
    const build = await beginBuild(
      root,
      path.join(root, "release"),
      "production",
      "compiled",
    );
    await completeBuild(root, build);
    const files = ["release/.vext-build.json", ".vext/build-location.json"];
    for (const file of files) fs.utimesSync(path.join(root, file), 1000, 1000);
    await completeBuild(root, build);
    expect(
      files.map((file) => fs.statSync(path.join(root, file)).mtimeMs),
    ).toEqual([1_000_000, 1_000_000]);
  });

  it("does not silently fall back to dist after a recorded custom location is deleted", async () => {
    const root = project();
    await completeBuild(
      root,
      await beginBuild(root, path.join(root, "dist"), "production", "compiled"),
    );
    await completeBuild(
      root,
      await beginBuild(
        root,
        path.join(root, "release"),
        "production",
        "compiled",
      ),
    );
    fs.unlinkSync(path.join(root, ".vext/build-location.json"));
    expect(resolveBuildLocation(root).failure).toMatch(/identity/);
    expect(() => selectBuildOutput(root)).toThrow(
      "recorded build location is missing",
    );
    expect(selectBuildOutput(root, "release")).toBe(path.join(root, "release"));
    expect(resolveBuildLocation(root, "release").failure).toBeUndefined();
  });
});

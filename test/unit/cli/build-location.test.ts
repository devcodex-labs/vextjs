import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectProject,
  inspectDistBuild,
} from "../../../src/cli/utils/detect-project.js";
import { resolvePreloads } from "../../../src/cli/utils/preload.js";
import {
  beginBuild,
  completeBuild,
  resolveBuildLocation,
  selectBuildOutput,
  withBuildFrontendOutDir,
} from "../../../src/lib/build/build-location.js";

let root: string;
function write(file: string, content = "") {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
function built(outDir: string, buildId = "build-a") {
  const record = {
    schemaVersion: 1,
    status: "ready",
    outDir,
    buildId,
    profile: "production",
    backend: "compiled",
  };
  write(`${outDir}/package.json`, '{"type":"commonjs"}');
  write(`${outDir}/config/default.js`, "module.exports = {};");
  write(`${outDir}/.vext-build.json`, JSON.stringify(record));
  return record;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vext-build-location-"));
  write("package.json", '{"type":"module"}');
  write("src/config/default.ts", "export default {};");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("production build location consumers", () => {
  it("allows compiled deployment without src only when start requests it", () => {
    write(".vext/build-location.json", JSON.stringify(built("release")));
    rmSync(join(root, "src"), { recursive: true });
    expect(detectProject(root, { allowBuilt: true }).language).toBe("ts");
    expect(() => detectProject(root)).toThrow(/src/);
  });
  it("allows legacy compiled-only dist selected explicitly", () => {
    built("release");
    rmSync(join(root, "release/.vext-build.json"));
    rmSync(join(root, "src"), { recursive: true });
    expect(
      detectProject(root, { allowBuilt: true, outDir: "release" }).language,
    ).toBe("ts");
  });
  it("does not treat a source-mode record as a compiled-only deployment", () => {
    completeBuild(
      root,
      beginBuild(root, join(root, "release"), "production", "source"),
    );
    rmSync(join(root, "src"), { recursive: true });
    expect(() => detectProject(root, { allowBuilt: true })).toThrow(/src/);
  });
  it("only commits a completed build and invalidates a failed rebuild of the same output", () => {
    const initial = beginBuild(
      root,
      join(root, "build"),
      "staging",
      "compiled",
    );
    expect(resolveBuildLocation(root).outDir).toBe(join(root, "dist"));
    completeBuild(root, initial);
    expect(resolveBuildLocation(root).identity?.profile).toBe("staging");
    const second = beginBuild(
      root,
      join(root, "build"),
      "production",
      "compiled",
    );
    expect(resolveBuildLocation(root).failure).toMatch(/identity/);
    expect(selectBuildOutput(root)).toBe(join(root, "build"));
    completeBuild(root, second);
    expect(resolveBuildLocation(root).failure).toBeUndefined();
  });
  it("preserves the last successful output when a different output fails", () => {
    completeBuild(
      root,
      beginBuild(root, join(root, "good"), "staging", "compiled"),
    );
    beginBuild(root, join(root, "bad"), "production", "compiled");
    expect(resolveBuildLocation(root).outDir).toBe(join(root, "good"));
    expect(resolveBuildLocation(root).failure).toBeUndefined();
    expect(resolveBuildLocation(root, "bad").failure).toMatch(/identity/);
  });
  it("recovers corrupt location metadata through an explicit rebuild directory", () => {
    write(".vext/build-location.json", "{");
    expect(selectBuildOutput(root, "release")).toBe(join(root, "release"));
    completeBuild(
      root,
      beginBuild(root, join(root, "release"), "production", "compiled"),
    );
    expect(resolveBuildLocation(root).failure).toBeUndefined();
  });
  it("uses explicit output before environment and recorded output", () => {
    completeBuild(
      root,
      beginBuild(root, join(root, "recorded"), "production", "compiled"),
    );
    const previous = process.env.VEXT_BUILD_OUTDIR;
    process.env.VEXT_BUILD_OUTDIR = "environment";
    try {
      expect(selectBuildOutput(root)).toBe(join(root, "environment"));
      expect(selectBuildOutput(root, "explicit")).toBe(join(root, "explicit"));
    } finally {
      if (previous === undefined) delete process.env.VEXT_BUILD_OUTDIR;
      else process.env.VEXT_BUILD_OUTDIR = previous;
    }
  });
  it("shares frontend defaults while preserving explicit frontend output", () => {
    expect(withBuildFrontendOutDir(true, "release")).toEqual({
      enabled: true,
      outDir: join("release", "client"),
    });
    expect(
      withBuildFrontendOutDir({ enabled: true, outDir: "web" }, "release"),
    ).toEqual({ enabled: true, outDir: "web" });
    expect(withBuildFrontendOutDir(false, "release")).toBe(false);
  });
  it("inspects the last successful custom output instead of dist", () => {
    write(".vext/build-location.json", JSON.stringify(built("build/api")));
    expect(inspectDistBuild(root).valid).toBe(true);
  });
  it("reports missing files from the selected output", () => {
    write(".vext/build-location.json", JSON.stringify(built("build")));
    write("src/routes/user.ts", "export default {};");
    expect(inspectDistBuild(root).missing).toEqual(["build/routes/user.js"]);
  });
  it.each(["building", "different-build", "missing-marker"])(
    "rejects %s even when all compiled files remain",
    (state) => {
      const record = built("dist");
      write(".vext/build-location.json", JSON.stringify(record));
      if (state === "missing-marker")
        rmSync(join(root, "dist/.vext-build.json"));
      else
        write(
          "dist/.vext-build.json",
          JSON.stringify({
            ...record,
            ...(state === "building"
              ? { status: "building" }
              : { buildId: "other" }),
          }),
        );
      expect(inspectDistBuild(root).valid).toBe(false);
    },
  );
  it("retains structural inspection of legacy dist without an identity record", () => {
    built("dist");
    rmSync(join(root, "dist/.vext-build.json"));
    expect(inspectDistBuild(root).valid).toBe(true);
  });
  it.each(["../other", ".vext", "src"])(
    "rejects unsafe recorded output %s",
    (outDir) => {
      const record = built("dist");
      write(".vext/build-location.json", JSON.stringify({ ...record, outDir }));
      expect(() => inspectDistBuild(root)).toThrow(
        /build|outdir|relative|protected/i,
      );
    },
  );
  it("does not silently fall back to dist on a malformed location record", () => {
    built("dist");
    write(".vext/build-location.json", "{");
    expect(() => inspectDistBuild(root)).toThrow(/build-location/);
  });
  it("rejects an output junction escaping the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "vext-build-outside-"));
    try {
      const record = built("dist");
      symlinkSync(
        outside,
        join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      write(
        ".vext/build-location.json",
        JSON.stringify({ ...record, outDir: "linked" }),
      );
      expect(() => inspectDistBuild(root)).toThrow(/symbolic|inside/);
    } finally {
      rmSync(join(root, "linked"), { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });
  it("loads compiled project preload from the chosen output, ignoring changed source", async () => {
    write(
      "src/preload/instrument.mjs",
      'throw new Error("source must not run");',
    );
    write("build/preload/instrument.mjs", "globalThis.__builtPreload = true;");
    const preloads = await resolvePreloads(root, {
      builtOutDir: join(root, "build"),
    });
    expect(preloads.map(fileURLToPath)).toEqual([
      join(root, "build/preload/instrument.mjs"),
    ]);
  });
});

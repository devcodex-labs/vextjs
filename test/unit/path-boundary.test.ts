import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { artifactRelativePath } from "../../src/lib/project/artifact-manifest.js";
import {
  assertSafeProjectOutputDirectory,
  isPathInside,
  normalizeSafeRelativePath,
  physicalPath,
  resolvePathInside,
} from "../../src/lib/path-boundary.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("path boundary", () => {
  it("normalizes portable relative paths and rejects traversal identities", () => {
    expect(normalizeSafeRelativePath("assets/main.js", "asset")).toBe(
      "assets/main.js",
    );
    expect(normalizeSafeRelativePath("assets\\main.js", "asset")).toBe(
      "assets/main.js",
    );

    for (const value of [
      "",
      ".",
      "..",
      "../secret",
      "a/../secret",
      "/abs",
      "C:\\abs",
    ]) {
      expect(() => normalizeSafeRelativePath(value, "asset")).toThrow(
        /relative path|path segments/iu,
      );
    }
  });

  it("allows dedicated project outputs but rejects destructive project roots", async () => {
    const rootDir = await tempRoot();
    await mkdir(path.join(rootDir, "src"), { recursive: true });

    expect(
      assertSafeProjectOutputDirectory(
        rootDir,
        path.join(rootDir, "dist"),
        "output",
      ),
    ).toBe(path.join(rootDir, "dist"));
    expect(() =>
      assertSafeProjectOutputDirectory(rootDir, rootDir, "output"),
    ).toThrow("inside");
    expect(() =>
      assertSafeProjectOutputDirectory(
        rootDir,
        path.join(rootDir, "src"),
        "output",
      ),
    ).toThrow("protected project path src");
    expect(() =>
      assertSafeProjectOutputDirectory(
        rootDir,
        path.join(rootDir, "..", "outside"),
        "output",
      ),
    ).toThrow("inside");
  });

  it("rejects output and file paths that escape through a junction", async () => {
    const rootDir = await tempRoot();
    const outsideDir = await tempRoot();
    await writeFile(path.join(outsideDir, "secret.txt"), "secret");
    await symlink(
      outsideDir,
      path.join(rootDir, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() =>
      assertSafeProjectOutputDirectory(
        rootDir,
        path.join(rootDir, "linked", "output"),
        "output",
      ),
    ).toThrow("symbolic links");
    expect(() =>
      resolvePathInside(rootDir, "linked/secret.txt", "asset", {
        realpath: true,
      }),
    ).toThrow("symbolic links");
    expect(() =>
      artifactRelativePath(
        rootDir,
        path.join(rootDir, "linked", "secret.txt"),
        true,
      ),
    ).toThrow("symbolic links");
  });

  it("keeps artifact references relative through a project directory alias", async () => {
    const rootDir = await tempRoot();
    const parentDir = await tempRoot();
    const alias = path.join(parentDir, "project");
    await mkdir(path.join(rootDir, ".vext", "client"), { recursive: true });
    await symlink(
      rootDir,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(
      artifactRelativePath(alias, path.join(alias, ".vext", "client"), true),
    ).toBe(".vext/client");
    expect(
      artifactRelativePath(alias, path.join(rootDir, ".vext", "client"), true),
    ).toBe(".vext/client");
    expect(
      artifactRelativePath(
        alias,
        path.join(alias, ".vext", "generated", "next"),
        true,
      ),
    ).toBe(".vext/generated/next");
  });

  it("keeps absolute references only for explicit external artifact outputs", async () => {
    const rootDir = await tempRoot();
    const outsideDir = await tempRoot();
    const target = path.join(outsideDir, "generated");

    expect(artifactRelativePath(rootDir, target, true)).toBe(
      physicalPath(target).replaceAll("\\", "/"),
    );
    expect(() => artifactRelativePath(rootDir, target)).toThrow(
      /path segments/iu,
    );
  });

  it.runIf(process.platform === "win32")(
    "treats Windows namespace and ordinary drive paths as the same root",
    async () => {
      const rootDir = await tempRoot();
      const outputDir = path.join(rootDir, ".vext", "client");
      await mkdir(outputDir, { recursive: true });
      const namespacedRoot = `\\\\?\\${rootDir}`;

      expect(isPathInside(namespacedRoot, outputDir)).toBe(true);
      expect(artifactRelativePath(namespacedRoot, outputDir, true)).toBe(
        ".vext/client",
      );
    },
  );
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vext-path-boundary-"));
  tempDirs.push(dir);
  return dir;
}

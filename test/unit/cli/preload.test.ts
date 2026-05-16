import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolvePreloads } from "../../../src/cli/utils/preload.js";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

describe("resolvePreloads", () => {
  const tmpDirs: string[] = [];

  function createTmpProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vext-preload-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  function writeProjectPackageJson(rootDir: string): void {
    writeJson(path.join(rootDir, "package.json"), {
      name: "test-project",
      type: "module",
      dependencies: {},
      devDependencies: {},
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] when project package.json does not exist", async () => {
    const rootDir = createTmpProject();
    await expect(resolvePreloads(rootDir)).resolves.toEqual([]);
  });

  it("collects project-level JS preloads before package-level preloads", async () => {
    const rootDir = createTmpProject();

    writeJson(path.join(rootDir, "package.json"), {
      type: "module",
      dependencies: {
        "dep-a": "1.0.0",
      },
    });

    fs.mkdirSync(path.join(rootDir, "preload"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "preload", "02-project.js"),
      "export {}\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(rootDir, "preload", "01-project.mjs"),
      "export {}\n",
      "utf-8",
    );

    writeJson(path.join(rootDir, "node_modules", "dep-a", "package.json"), {
      name: "dep-a",
      vext: {
        preload: "./dist/instrumentation.js",
      },
    });
    fs.mkdirSync(path.join(rootDir, "node_modules", "dep-a", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "node_modules", "dep-a", "dist", "instrumentation.js"),
      "export {}\n",
      "utf-8",
    );

    await expect(resolvePreloads(rootDir)).resolves.toEqual([
      pathToFileURL(path.join(rootDir, "preload", "01-project.mjs")).href,
      pathToFileURL(path.join(rootDir, "preload", "02-project.js")).href,
      pathToFileURL(
        path.join(rootDir, "node_modules", "dep-a", "dist", "instrumentation.js"),
      ).href,
    ]);
  });

  it("compiles TypeScript project preloads into .vext/preload and returns compiled mjs URLs", async () => {
    const rootDir = createTmpProject();
    writeProjectPackageJson(rootDir);

    fs.writeFileSync(
      path.join(rootDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" } }),
      "utf-8",
    );

    fs.mkdirSync(path.join(rootDir, "preload"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "preload", "01-env.ts"),
      "export const flag: string = 'ok';\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(rootDir, "preload", "02-hook.mts"),
      "export const boot = () => 'hook';\n",
      "utf-8",
    );

    const result = await resolvePreloads(rootDir);
    expect(result).toHaveLength(2);

    const compiledPaths = result.map((url) => fileURLToPath(url));
    expect(compiledPaths[0]).toContain(path.join(".vext", "preload"));
    expect(compiledPaths[0]).toContain("01-env.__compiled__.mjs");
    expect(compiledPaths[1]).toContain("02-hook.__compiled__.mjs");
    for (const compiledFile of compiledPaths) {
      expect(fs.existsSync(compiledFile)).toBe(true);
      expect(fs.readFileSync(compiledFile, "utf-8")).toContain("export");
    }
  });

  it("falls back to dist/preload when root preload/ does not exist", async () => {
    const rootDir = createTmpProject();
    writeProjectPackageJson(rootDir);

    fs.mkdirSync(path.join(rootDir, "dist", "preload"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "dist", "preload", "01-built.mjs"),
      "export const built = true;\n",
      "utf-8",
    );

    await expect(resolvePreloads(rootDir)).resolves.toEqual([
      pathToFileURL(path.join(rootDir, "dist", "preload", "01-built.mjs")).href,
    ]);
  });

  it("skips unsupported project preload extensions and warns", async () => {
    const rootDir = createTmpProject();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeProjectPackageJson(rootDir);

    fs.mkdirSync(path.join(rootDir, "preload"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "preload", "01-ignore.txt"), "noop\n", "utf-8");

    await expect(resolvePreloads(rootDir)).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unsupported project preload extension"),
    );
  });

  it("skips non-file entries in project preload directory and warns", async () => {
    const rootDir = createTmpProject();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeProjectPackageJson(rootDir);

    fs.mkdirSync(path.join(rootDir, "preload", "nested"), { recursive: true });

    await expect(resolvePreloads(rootDir)).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not a regular file"),
    );
  });

  it("de-duplicates project and package preloads by absolute path", async () => {
    const rootDir = createTmpProject();

    writeJson(path.join(rootDir, "package.json"), {
      type: "module",
      dependencies: {
        dup: "1.0.0",
      },
    });

    fs.mkdirSync(path.join(rootDir, "preload"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "preload", "01-shared.mjs"),
      "export {}\n",
      "utf-8",
    );

    writeJson(path.join(rootDir, "node_modules", "dup", "package.json"), {
      name: "dup",
      vext: {
        preload: "../../preload/01-shared.mjs",
      },
    });
    fs.mkdirSync(path.join(rootDir, "node_modules", "dup"), { recursive: true });

    await expect(resolvePreloads(rootDir)).resolves.toEqual([
      pathToFileURL(path.join(rootDir, "preload", "01-shared.mjs")).href,
    ]);
  });

  it("collects package preload entries from dependencies and devDependencies", async () => {
    const rootDir = createTmpProject();

    writeJson(path.join(rootDir, "package.json"), {
      dependencies: {
        "dep-a": "1.0.0",
      },
      devDependencies: {
        "dep-b": "1.0.0",
      },
    });

    writeJson(path.join(rootDir, "node_modules", "dep-a", "package.json"), {
      name: "dep-a",
      vext: {
        preload: "./dist/instrumentation.js",
      },
    });
    fs.mkdirSync(path.join(rootDir, "node_modules", "dep-a", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "node_modules", "dep-a", "dist", "instrumentation.js"),
      "export {}\n",
      "utf-8",
    );

    writeJson(path.join(rootDir, "node_modules", "dep-b", "package.json"), {
      name: "dep-b",
      vext: {
        preload: ["./a.js", "./b.js"],
      },
    });
    fs.mkdirSync(path.join(rootDir, "node_modules", "dep-b"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "node_modules", "dep-b", "a.js"), "export {}\n", "utf-8");
    fs.writeFileSync(path.join(rootDir, "node_modules", "dep-b", "b.js"), "export {}\n", "utf-8");

    await expect(resolvePreloads(rootDir)).resolves.toEqual([
      pathToFileURL(path.join(rootDir, "node_modules", "dep-a", "dist", "instrumentation.js")).href,
      pathToFileURL(path.join(rootDir, "node_modules", "dep-b", "a.js")).href,
      pathToFileURL(path.join(rootDir, "node_modules", "dep-b", "b.js")).href,
    ]);
  });

  it("skips missing package preload files and warns", async () => {
    const rootDir = createTmpProject();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    writeJson(path.join(rootDir, "package.json"), {
      dependencies: {
        "dep-a": "1.0.0",
      },
    });

    writeJson(path.join(rootDir, "node_modules", "dep-a", "package.json"), {
      name: "dep-a",
      vext: {
        preload: "./dist/missing.js",
      },
    });

    await expect(resolvePreloads(rootDir)).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("file not found"));
  });

  it("returns [] and warns when project package.json is invalid", async () => {
    const rootDir = createTmpProject();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fs.writeFileSync(path.join(rootDir, "package.json"), "{ invalid json", "utf-8");

    await expect(resolvePreloads(rootDir)).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse package.json"),
    );
  });

  it("skips dependency with invalid package.json and continues", async () => {
    const rootDir = createTmpProject();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    writeJson(path.join(rootDir, "package.json"), {
      dependencies: {
        bad: "1.0.0",
        good: "1.0.0",
      },
    });

    fs.mkdirSync(path.join(rootDir, "node_modules", "bad"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "node_modules", "bad", "package.json"),
      "{ invalid json",
      "utf-8",
    );

    writeJson(path.join(rootDir, "node_modules", "good", "package.json"), {
      name: "good",
      vext: {
        preload: "./dist/instrumentation.js",
      },
    });
    fs.mkdirSync(path.join(rootDir, "node_modules", "good", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "node_modules", "good", "dist", "instrumentation.js"),
      "export {}\n",
      "utf-8",
    );

    const result = await resolvePreloads(rootDir);
    expect(result).toEqual([
      pathToFileURL(path.join(rootDir, "node_modules", "good", "dist", "instrumentation.js")).href,
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse bad/package.json"),
    );
  });

  it("fails fast when a project TypeScript preload cannot be compiled", async () => {
    const rootDir = createTmpProject();
    writeProjectPackageJson(rootDir);

    fs.mkdirSync(path.join(rootDir, "preload"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "preload", "01-broken.ts"),
      "export const broken = ;\n",
      "utf-8",
    );

    await expect(resolvePreloads(rootDir)).rejects.toThrow(
      "failed to compile TypeScript preload",
    );
  });
});

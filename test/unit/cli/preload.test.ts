import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] when project package.json does not exist", () => {
    const rootDir = createTmpProject();
    expect(resolvePreloads(rootDir)).toEqual([]);
  });

  it("collects preload entries from dependencies and devDependencies", () => {
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
      "export {};\n",
      "utf-8",
    );

    writeJson(path.join(rootDir, "node_modules", "dep-b", "package.json"), {
      name: "dep-b",
      vext: {
        preload: ["./a.js", "./b.js"],
      },
    });
    fs.mkdirSync(path.join(rootDir, "node_modules", "dep-b"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "node_modules", "dep-b", "a.js"),
      "export {};\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(rootDir, "node_modules", "dep-b", "b.js"),
      "export {};\n",
      "utf-8",
    );

    expect(resolvePreloads(rootDir)).toEqual([
      pathToFileURL(path.join(rootDir, "node_modules", "dep-a", "dist", "instrumentation.js")).href,
      pathToFileURL(path.join(rootDir, "node_modules", "dep-b", "a.js")).href,
      pathToFileURL(path.join(rootDir, "node_modules", "dep-b", "b.js")).href,
    ]);
  });

  it("skips missing preload files and warns", () => {
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

    expect(resolvePreloads(rootDir)).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("file not found"),
    );
  });

  it("returns [] and warns when project package.json is invalid", () => {
    const rootDir = createTmpProject();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fs.writeFileSync(path.join(rootDir, "package.json"), "{ invalid json", "utf-8");

    expect(resolvePreloads(rootDir)).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse package.json"),
    );
  });

  it("skips dependency with invalid package.json and continues", () => {
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
      "export {};\n",
      "utf-8",
    );

    const result = resolvePreloads(rootDir);
    expect(result).toEqual([
      pathToFileURL(path.join(rootDir, "node_modules", "good", "dist", "instrumentation.js")).href,
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse bad/package.json"),
    );
  });
});



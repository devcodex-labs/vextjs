import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    existsSync: vi.fn(() => false),
    rmSync: vi.fn(),
    execSync: vi.fn(() => {
      order.push("typecheck");
    }),
    detectProject: vi.fn(() => ({
      rootDir: "E:/app",
      srcDir: "E:/app/src",
      language: "ts",
    })),
    runTypegen: vi.fn(async () => {
      order.push("typegen");
      return {
        ok: true,
        files: [],
        diagnostics: [],
        warnings: [],
      };
    }),
    runDoctor: vi.fn(async () => {
      order.push("doctor");
      return {
        ok: true,
      };
    }),
    build: vi.fn(async () => {
      order.push("build");
      return {
        success: true,
        fileCount: 1,
        totalFiles: 1,
        elapsed: 1,
        outDir: "E:/app/dist",
        warnings: [],
        errors: [],
      };
    }),
  };
});

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  rmSync: mocks.rmSync,
}));

vi.mock("node:child_process", () => ({
  execSync: mocks.execSync,
}));

vi.mock("../../../src/cli/utils/detect-project.js", () => ({
  detectProject: mocks.detectProject,
}));

vi.mock("../../../src/tooling/typegen/index.js", () => ({
  runTypegen: mocks.runTypegen,
}));

vi.mock("../../../src/tooling/doctor/index.js", () => ({
  runDoctor: mocks.runDoctor,
}));

vi.mock("../../../src/lib/build/build-compiler.js", () => ({
  BuildCompiler: vi.fn().mockImplementation(() => ({
    build: mocks.build,
  })),
}));

import { buildCommand } from "../../../src/cli/build.js";

describe("buildCommand", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("refreshes generated artifacts before optional TypeScript typecheck", async () => {
    await buildCommand(["--typecheck"]);

    expect(mocks.order).toEqual(["typegen", "doctor", "typecheck", "build"]);
    expect(mocks.runTypegen).toHaveBeenCalledWith({
      rootDir: "E:/app",
      generateServices: true,
      generateAppExtensions: true,
      writeManifest: true,
    });
    expect(mocks.runDoctor).toHaveBeenCalledWith({
      rootDir: "E:/app",
      target: "routes",
      writeManifest: true,
      refresh: true,
    });
    expect(mocks.execSync).toHaveBeenCalledWith("npx tsc --noEmit", {
      cwd: "E:/app",
      stdio: "inherit",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

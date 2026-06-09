import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const existsSync = vi.fn();
  const runTypegen = vi.fn();
  const loadTsMorph = vi.fn();
  const state = {
    diagnostics: [] as Array<{ getCategory: () => unknown }>,
    formatted: "formatted diagnostics",
  };

  class MockProject {
    getPreEmitDiagnostics() {
      return state.diagnostics;
    }

    formatDiagnosticsWithColorAndContext() {
      return state.formatted;
    }
  }

  return {
    existsSync,
    runTypegen,
    loadTsMorph,
    state,
    MockProject,
  };
});

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
}));

vi.mock("../../../src/tooling/typegen/index.js", () => ({
  runTypegen: mocks.runTypegen,
}));

vi.mock("../../../src/tooling/shared/lazy-ts-morph.js", () => ({
  loadTsMorph: mocks.loadTsMorph,
}));

import { runDevPreflight } from "../../../src/cli/utils/dev-preflight.js";

describe("runDevPreflight", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.runTypegen.mockResolvedValue({
      ok: true,
      files: [],
      diagnostics: [],
      warnings: [],
    });
    mocks.state.diagnostics = [];
    mocks.state.formatted = "formatted diagnostics";
    mocks.loadTsMorph.mockResolvedValue({
      Project: mocks.MockProject,
      ts: {
        DiagnosticCategory: {
          Error: "error",
        },
      },
    });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips TypeScript diagnostics for JavaScript projects while logging typegen output", async () => {
    mocks.runTypegen.mockResolvedValueOnce({
      ok: false,
      files: [
        {
          filePath: "E:\\app\\src\\types\\generated\\services.generated.d.ts",
          status: "written",
        },
      ],
      diagnostics: [{ level: "error", message: "service dependency issue" }],
      warnings: ["manual review suggested"],
      manifest: {
        filePath: "E:\\app\\.vext\\inspect\\services.manifest.json",
        status: "written",
      },
    });

    const result = await runDevPreflight({
      rootDir: "E:\\app",
      language: "js",
      reason: "initial start",
    });

    expect(result).toEqual({
      ok: false,
      typegenOk: false,
      tsOk: true,
    });
    expect(mocks.loadTsMorph).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[vext dev] generated src/types/generated/services.generated.d.ts",
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[vext dev] generated .vext/inspect/services.manifest.json",
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[vext dev] typegen warning: manual review suggested",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[vext dev] typegen error: service dependency issue",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[vext dev] typegen reported blocking issues during initial start.",
    );
  });

  it("treats missing tsconfig.json as a non-blocking TypeScript project", async () => {
    mocks.existsSync.mockReturnValue(false);

    const result = await runDevPreflight({
      rootDir: "E:\\app",
      language: "ts",
      reason: "soft reload",
    });

    expect(result).toEqual({
      ok: true,
      typegenOk: true,
      tsOk: true,
    });
    expect(mocks.loadTsMorph).not.toHaveBeenCalled();
  });

  it("reports formatted TypeScript diagnostics when semantic errors exist", async () => {
    mocks.state.diagnostics = [
      { getCategory: () => "error" },
      { getCategory: () => "warning" },
    ];
    mocks.state.formatted =
      "TS2322: Type 'string' is not assignable to type 'number'.";

    const result = await runDevPreflight({
      rootDir: "E:\\app",
      language: "ts",
      reason: "soft reload",
    });

    expect(result).toEqual({
      ok: false,
      typegenOk: true,
      tsOk: false,
    });
    expect(mocks.loadTsMorph).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[vext dev] TypeScript reported 1 blocking error(s) during soft reload.",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "TS2322: Type 'string' is not assignable to type 'number'.",
    );
  });

  it("runs TypeScript diagnostics asynchronously without blocking the preflight result", async () => {
    mocks.state.diagnostics = [{ getCategory: () => "error" }];
    mocks.state.formatted = "async TS error";

    const result = await runDevPreflight({
      rootDir: "E:\\app",
      language: "ts",
      reason: "initial start",
      tsDiagnosticsMode: "async",
    });

    expect(result.ok).toBe(true);
    expect(result.typegenOk).toBe(true);
    expect(result.tsOk).toBe(true);
    expect(result.tsDiagnosticsPending).toBe(true);
    expect(result.tsDiagnosticsTask).toBeInstanceOf(Promise);

    await result.tsDiagnosticsTask;

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "TypeScript reported 1 blocking error(s) after initial start.",
      ),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith("async TS error");
  });

  it("can skip TypeScript diagnostics while keeping typegen blocking", async () => {
    const result = await runDevPreflight({
      rootDir: "E:\\app",
      language: "ts",
      reason: "soft reload",
      tsDiagnosticsMode: "skip",
    });

    expect(result).toEqual({
      ok: true,
      typegenOk: true,
      tsOk: true,
    });
    expect(mocks.loadTsMorph).not.toHaveBeenCalled();
  });

  it("keeps both failure channels visible when typegen and TypeScript diagnostics fail together", async () => {
    mocks.runTypegen.mockResolvedValueOnce({
      ok: false,
      files: [],
      diagnostics: [],
      warnings: [],
    });
    mocks.state.diagnostics = [
      { getCategory: () => "error" },
      { getCategory: () => "error" },
    ];
    mocks.state.formatted = "TS errors present";

    const result = await runDevPreflight({
      rootDir: "E:\\app",
      language: "ts",
      reason: "cold restart preflight",
    });

    expect(result).toEqual({
      ok: false,
      typegenOk: false,
      tsOk: false,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[vext dev] typegen reported blocking issues during cold restart preflight.",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[vext dev] TypeScript reported 2 blocking error(s) during cold restart preflight.",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith("TS errors present");
  });
});

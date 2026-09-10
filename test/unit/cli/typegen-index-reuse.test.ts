import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const index = {
    source: { rootDir: "" },
    serviceEntries: [
      {
        filePath: "",
        importPath: "../../src/services/user.js",
        serviceKey: "user",
        keySegments: ["user"],
      },
    ],
    appExtensions: [],
  };

  return {
    index,
    buildProjectIndex: vi.fn(async () => index),
    analyzeIndexedServiceDependencies: vi.fn(() => ({
      diagnostics: [],
      graph: new Map(),
    })),
  };
});

vi.mock("../../../src/tooling/project-index/index.js", () => ({
  buildProjectIndex: mocks.buildProjectIndex,
}));

vi.mock("../../../src/tooling/diagnostics/service-deps.js", () => ({
  analyzeIndexedServiceDependencies: mocks.analyzeIndexedServiceDependencies,
}));

import { runTypegen } from "../../../src/tooling/typegen/index.js";

describe("runTypegen project index reuse", () => {
  it("passes the already-built project index to service dependency analysis", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-typegen-index-"));
    mocks.index.source.rootDir = root;
    mocks.index.serviceEntries[0]!.filePath = path.join(
      root,
      "src/services/user.ts",
    );
    try {
      const result = await runTypegen({
        rootDir: root,
        generateServices: true,
        generateAppExtensions: true,
        writeManifest: true,
      });
      expect(result.ok).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(mocks.buildProjectIndex).toHaveBeenCalledTimes(1);
      expect(mocks.analyzeIndexedServiceDependencies).toHaveBeenCalledWith(
        mocks.index,
      );
      expect(
        fs.readFileSync(
          path.join(root, ".vext/types/services.generated.d.ts"),
          "utf8",
        ),
      ).toContain('user: import("../../src/services/user.js").default');
    } finally {
      const real = fs.realpathSync.native(root);
      expect(path.dirname(real)).toBe(fs.realpathSync.native(os.tmpdir()));
      expect(path.basename(real).startsWith("vext-typegen-index-")).toBe(true);
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
});

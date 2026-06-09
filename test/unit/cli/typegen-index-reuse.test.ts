import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const index = {
    serviceEntries: [
      {
        filePath: "E:/app/src/services/user.ts",
        importPath: "../services/user.js",
        serviceKey: "user",
        keySegments: ["user"],
        sourceFile: {},
      },
    ],
    appExtensions: [],
  };

  return {
    index,
    buildProjectIndex: vi.fn(async () => index),
    analyzeServiceDependencies: vi.fn(async () => ({
      diagnostics: [],
      graph: new Map(),
    })),
    generateServicesDts: vi.fn(async () => ({
      filePath: "E:/app/src/types/generated/services.generated.d.ts",
      status: "unchanged",
    })),
    generateAppExtensionsDts: vi.fn(async () => ({
      file: {
        filePath: "E:/app/src/types/generated/app-extensions.generated.d.ts",
        status: "unchanged",
      },
      warnings: [],
    })),
    writeServiceManifestFile: vi.fn(async () => ({
      filePath: "E:/app/.vext/inspect/services.manifest.json",
      status: "unchanged",
    })),
  };
});

vi.mock("../../../src/tooling/project-index/index.js", () => ({
  buildProjectIndex: mocks.buildProjectIndex,
}));

vi.mock("../../../src/tooling/diagnostics/service-deps.js", () => ({
  analyzeServiceDependencies: mocks.analyzeServiceDependencies,
}));

vi.mock("../../../src/tooling/typegen/generate-services-dts.js", () => ({
  generateServicesDts: mocks.generateServicesDts,
}));

vi.mock("../../../src/tooling/typegen/generate-app-extensions-dts.js", () => ({
  generateAppExtensionsDts: mocks.generateAppExtensionsDts,
}));

vi.mock("../../../src/tooling/typegen/write-service-manifest.js", () => ({
  writeServiceManifestFile: mocks.writeServiceManifestFile,
}));

import { runTypegen } from "../../../src/tooling/typegen/index.js";

describe("runTypegen project index reuse", () => {
  it("passes the already-built project index to service dependency analysis", async () => {
    await runTypegen({
      rootDir: "E:/app",
      generateServices: true,
      generateAppExtensions: true,
      writeManifest: true,
    });

    expect(mocks.buildProjectIndex).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeServiceDependencies).toHaveBeenCalledWith("E:/app", {
      index: mocks.index,
    });
  });
});

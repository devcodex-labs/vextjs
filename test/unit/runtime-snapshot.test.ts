import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  patchRuntimeSnapshot,
  writeRuntimeSnapshot,
} from "../../src/lib/runtime-snapshot.js";
import { inspectRuntimeSnapshot } from "../../src/mcp/runtime-snapshot.js";
import type { VextMcpProjectInspection } from "../../src/assistant/project-inspector.js";

describe("runtime snapshot writer", () => {
  it("writes and patches the managed runtime snapshot for MCP inspection", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vext-runtime-snapshot-"));
    try {
      await writeRuntimeSnapshot({
        rootDir,
        runtimeIdentity: { mode: "development", pid: 1234 },
        summary: { state: "ready", port: 3000 },
        events: [{ type: "ready" }],
      });
      await patchRuntimeSnapshot({
        rootDir,
        runtimeIdentity: { mode: "development", pid: 1234 },
        summary: { lastOperation: "reload" },
        reload: { status: "success", files: ["src/routes/hello.ts"] },
        event: { type: "soft-reload", files: ["src/routes/hello.ts"] },
      });

      const project = fakeProject(rootDir);
      const summary = await inspectRuntimeSnapshot({
        rootDir,
        project,
        options: { section: "summary" },
      });
      expect(summary.data.availability).toBe("available");
      expect(summary.data.snapshot).toMatchObject({
        summary: { state: "ready", port: 3000, lastOperation: "reload" },
        counts: { reloads: 1, events: 2 },
      });

      const reloads = await inspectRuntimeSnapshot({
        rootDir,
        project,
        options: { section: "reloads" },
      });
      expect(reloads.data.items[0]).toMatchObject({
        status: "success",
        files: ["src/routes/hello.ts"],
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

function fakeProject(rootDir: string): VextMcpProjectInspection {
  return {
    schemaVersion: 1,
    status: "ok",
    identity: {
      projectId: "0".repeat(64),
      contextRevision: null,
      rootDir,
      packageName: "fixture",
      packageVersion: "1.0.0",
      frameworkVersion: "2.0.0",
      sourceState: "complete",
    },
    snapshot: {
      language: "ts",
      packageManager: "npm",
      frameworkDependency: "2.0.0",
      sections: {},
    },
    partitions: [],
    structureDecisions: [],
    assistant: {
      contractVersion: 1,
      devMcp: {
        schemaVersion: 1,
        declared: false,
        enabled: false,
        hosts: [],
        sync: "off",
        http: { enabled: false, port: 3980 },
      },
      devMcpSources: [],
      workspace: null,
    },
    warnings: [],
  };
}

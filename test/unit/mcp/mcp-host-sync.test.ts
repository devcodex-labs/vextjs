import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { mcpCommand } from "../../../src/cli/mcp.js";
import { createVextMcpHostSyncPlan } from "../../../src/mcp/hosts/plan.js";

describe("Vext MCP host sync planning", () => {
  it("builds a dry-run plan from declared dev.mcp hosts", async () => {
    const root = await createProject();
    const plan = createVextMcpHostSyncPlan({
      rootDir: root,
      frameworkVersion: "2.0.0",
      mode: "dry-run",
    });

    expect(plan.status).toBe("ok");
    expect(plan.serviceKey).toMatch(/^vext-api-[a-f0-9]{8}$/);
    expect(plan.launcher.path).toBe(path.join(".vext", "mcp", "launcher.cjs"));
    expect(plan.launcher.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.targets).toHaveLength(2);
    expect(plan.targets.map((target) => target.host).sort()).toEqual([
      "codex",
      "vscode",
    ]);
    expect(plan.targets[0]?.action).toBe("plan-managed-entry");
    expect(plan.targets[0]?.args).toContain("--root");
  });

  it("prints one JSON plan from the CLI without host config writes", async () => {
    const root = await createProject();
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((message?: unknown) => {
        logs.push(String(message));
      });
    try {
      await mcpCommand([
        "sync",
        "--root",
        root,
        "--check",
        "--host",
        "codex",
        "--json",
      ]);
      const result = JSON.parse(logs.at(-1) ?? "{}");
      expect(result).toMatchObject({
        status: "ok",
        dryRunOnly: true,
        plan: {
          mode: "check",
          targets: [{ host: "codex", configPath: ".codex/config.toml" }],
        },
      });
      expect(result.plan.targets[0].reason).toContain(
        "does not edit host config",
      );
    } finally {
      spy.mockRestore();
    }
  });
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "vext-mcp-host-sync-"));
  await mkdir(path.join(root, "src", "config"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "host-sync-app",
        version: "1.0.0",
        dependencies: { vextjs: "2.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, "src", "config", "default.ts"),
    'export default { server: { port: 3000 }, dev: { mcp: { enabled: true, hosts: ["codex", "vscode"], sync: "check" } } };\n',
  );
  await writeFile(
    path.join(root, "vext.workspace.jsonc"),
    JSON.stringify(
      {
        schemaVersion: 1,
        services: [{ id: "api", root: "." }],
      },
      null,
      2,
    ),
  );
  return root;
}

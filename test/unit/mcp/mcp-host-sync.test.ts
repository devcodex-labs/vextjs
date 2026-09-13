import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
        plan: {
          mode: "check",
          targets: [{ host: "codex", configPath: ".codex/config.toml" }],
        },
      });
      expect(result.plan.targets[0].reason).toContain("TOML host config");
    } finally {
      spy.mockRestore();
    }
  });

  it("writes launcher, state, and JSON host config entries by default", async () => {
    const root = await createProject();
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((message?: unknown) => {
        logs.push(String(message));
      });
    try {
      await mcpCommand(["sync", "--root", root, "--host", "vscode", "--json"]);
      const result = JSON.parse(logs.at(-1) ?? "{}");
      expect(result).toMatchObject({
        status: "ok",
        applied: {
          status: "ok",
          launcher: { status: "written" },
          state: { status: "written" },
          targets: [{ host: "vscode", status: "written" }],
        },
      });
      const config = JSON.parse(
        await readFile(path.join(root, ".vscode", "mcp.json"), "utf8"),
      );
      const entry = Object.values(config.servers)[0] as {
        command: string;
        args: string[];
      };
      expect(entry.command).toBe("node");
      expect(entry.args).toContain("mcp");
      expect(
        await readFile(path.join(root, ".vext", "mcp", "launcher.cjs"), "utf8"),
      ).toContain('dist", "cli", "index.js');

      logs.length = 0;
      await mcpCommand(["sync", "--root", root, "--host", "vscode", "--json"]);
      const second = JSON.parse(logs.at(-1) ?? "{}");
      expect(second.applied).toMatchObject({
        launcher: { status: "up-to-date" },
        state: { status: "up-to-date" },
        targets: [{ status: "up-to-date" }],
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("blocks malformed JSON host config without overwriting it", async () => {
    const root = await createProject();
    await mkdir(path.join(root, ".vscode"), { recursive: true });
    await writeFile(path.join(root, ".vscode", "mcp.json"), "{ bad json", {
      encoding: "utf8",
    });
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((message?: unknown) => {
        logs.push(String(message));
      });
    try {
      await mcpCommand(["sync", "--root", root, "--host", "vscode", "--json"]);
      const result = JSON.parse(logs.at(-1) ?? "{}");
      expect(result.applied).toMatchObject({
        status: "partial",
        targets: [{ host: "vscode", status: "blocked" }],
      });
      expect(
        await readFile(path.join(root, ".vscode", "mcp.json"), "utf8"),
      ).toBe("{ bad json");
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

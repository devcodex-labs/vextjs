import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(plan.targets[0]?.action).toBe("write-managed-entry");
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
          targets: [{ host: "vscode", status: "written", verified: true }],
          nextSteps: [{ host: "vscode", reason: "config-written" }],
        },
      });
      expect(result.applied.nextSteps[0].summary).toContain("VS Code");
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
        targets: [{ status: "up-to-date", verified: true }],
        nextSteps: [],
      });

      await rm(path.join(root, ".vext", "mcp", "launcher.cjs"));
      logs.length = 0;
      await mcpCommand(["sync", "--root", root, "--host", "vscode", "--json"]);
      const launcherRestored = JSON.parse(logs.at(-1) ?? "{}");
      expect(launcherRestored.applied).toMatchObject({
        launcher: { status: "written" },
        targets: [{ status: "up-to-date", verified: true }],
        nextSteps: [{ host: "vscode", reason: "launcher-written" }],
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
        targets: [{ host: "vscode", status: "blocked", verified: false }],
        nextSteps: [],
      });
      expect(
        await readFile(path.join(root, ".vscode", "mcp.json"), "utf8"),
      ).toBe("{ bad json");
    } finally {
      spy.mockRestore();
    }
  });

  it("writes TOML host config entries with a managed block", async () => {
    const root = await createProject();
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((message?: unknown) => {
        logs.push(String(message));
      });
    try {
      await mcpCommand(["sync", "--root", root, "--host", "codex", "--json"]);
      const result = JSON.parse(logs.at(-1) ?? "{}");
      expect(result).toMatchObject({
        status: "ok",
        applied: {
          status: "ok",
          targets: [{ host: "codex", status: "written", verified: true }],
          nextSteps: [{ host: "codex", reason: "config-written" }],
        },
      });
      expect(result.applied.nextSteps[0].summary).toContain("Codex");
      const toml = await readFile(
        path.join(root, ".codex", "config.toml"),
        "utf8",
      );
      expect(toml).toContain("# BEGIN VEXT MCP MANAGED");
      expect(toml).toContain("[mcp_servers.");
      expect(toml).toContain('command = "node"');
      expect(toml).toContain('"mcp"');

      logs.length = 0;
      await mcpCommand(["sync", "--root", root, "--host", "codex", "--json"]);
      const second = JSON.parse(logs.at(-1) ?? "{}");
      expect(second.applied).toMatchObject({
        targets: [{ status: "up-to-date", verified: true }],
        nextSteps: [],
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("writes project-local Skill files when requested", async () => {
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
        "--host",
        "vscode",
        "--skill",
        "--json",
      ]);
      const result = JSON.parse(logs.at(-1) ?? "{}");
      expect(result.plan.skill).toMatchObject({
        include: true,
        targets: [{ host: "vscode", path: ".github/skills/vextjs/SKILL.md" }],
      });
      expect(result.applied).toMatchObject({
        status: "ok",
        skills: [{ host: "vscode", status: "written", verified: true }],
        nextSteps: [{ host: "vscode", reason: "config-written" }],
      });
      expect(result.applied.nextSteps[0].validation).toContain(
        "Run a read-only Vext MCP project inspection before applying generated changes.",
      );
      const skill = await readFile(
        path.join(root, ".github", "skills", "vextjs", "SKILL.md"),
        "utf8",
      );
      expect(skill).toContain("VextJS Official MCP Skill");

      logs.length = 0;
      await mcpCommand([
        "sync",
        "--root",
        root,
        "--host",
        "vscode",
        "--skill",
        "--json",
      ]);
      const second = JSON.parse(logs.at(-1) ?? "{}");
      expect(second.applied).toMatchObject({
        skills: [{ status: "up-to-date", verified: true }],
        nextSteps: [],
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("blocks different project-local Skill files", async () => {
    const root = await createProject();
    await mkdir(path.join(root, ".github", "skills", "vextjs"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".github", "skills", "vextjs", "SKILL.md"),
      "# Custom Skill\n",
      "utf8",
    );
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
        "--host",
        "vscode",
        "--skill",
        "--json",
      ]);
      const result = JSON.parse(logs.at(-1) ?? "{}");
      expect(result.applied).toMatchObject({
        status: "partial",
        skills: [{ host: "vscode", status: "blocked", verified: false }],
      });
      expect(
        await readFile(
          path.join(root, ".github", "skills", "vextjs", "SKILL.md"),
          "utf8",
        ),
      ).toBe("# Custom Skill\n");
    } finally {
      spy.mockRestore();
    }
  });

  it("blocks unmanaged TOML tables with the same service key", async () => {
    const root = await createProject();
    const plan = createVextMcpHostSyncPlan({
      rootDir: root,
      frameworkVersion: "2.0.0",
      host: "codex",
      mode: "write",
    });
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(
      path.join(root, ".codex", "config.toml"),
      `[mcp_servers.${plan.serviceKey}]
command = "node"
args = ["custom.js"]
`,
      "utf8",
    );
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((message?: unknown) => {
        logs.push(String(message));
      });
    try {
      await mcpCommand(["sync", "--root", root, "--host", "codex", "--json"]);
      const result = JSON.parse(logs.at(-1) ?? "{}");
      expect(result.applied).toMatchObject({
        status: "partial",
        targets: [{ host: "codex", status: "blocked", verified: false }],
      });
      expect(
        await readFile(path.join(root, ".codex", "config.toml"), "utf8"),
      ).toContain('args = ["custom.js"]');
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

import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { getVextMcpSkillManifest } from "../../../src/assistant/skill.js";
import { mcpCommand } from "../../../src/cli/mcp.js";

describe("Vext MCP bundled Skill", () => {
  it("exposes a stable manifest", () => {
    const manifest = getVextMcpSkillManifest();
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      name: "vextjs-official-mcp",
      version: "1",
    });
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.bytes).toBeGreaterThan(1000);
  });

  it("prints and writes the bundled Skill without host config mutation", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((message?: unknown) => {
        logs.push(String(message));
      });
    try {
      await mcpCommand(["skill", "check"]);
      expect(JSON.parse(logs.pop() ?? "{}")).toMatchObject({
        status: "ok",
        hostNativeInstall: "not-managed-by-this-command",
      });

      await mcpCommand(["skill", "print"]);
      expect(logs.pop()).toContain("VextJS Official MCP Skill");

      const root = await mkdtemp(path.join(os.tmpdir(), "vext-mcp-skill-"));
      const output = path.join(
        root,
        ".vext",
        "skills",
        "vextjs-official-mcp",
        "SKILL.md",
      );
      await mcpCommand(["skill", "write", "--output", output]);
      expect(await readFile(output, "utf8")).toContain(
        "Use this skill when helping with a project that depends on VextJS",
      );

      logs.length = 0;
      await mcpCommand(["skill", "write", "--output", output]);
      expect(JSON.parse(logs.pop() ?? "{}")).toMatchObject({
        status: "up-to-date",
      });
    } finally {
      spy.mockRestore();
    }
  });
});

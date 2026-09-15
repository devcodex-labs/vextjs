import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { format } from "prettier";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  getVextMcpSkillManifest,
  VEXT_MCP_SKILL_CONTENT,
  VEXT_MCP_SKILL_NAME,
  VEXT_MCP_SKILL_DESCRIPTION,
} from "../../../src/assistant/skill.js";
import { mcpCommand } from "../../../src/cli/mcp.js";

describe("Vext MCP bundled Skill", () => {
  it("exposes a stable manifest", async () => {
    const manifest = getVextMcpSkillManifest();
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      name: "vextjs",
      version: "2",
    });
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.bytes).toBeGreaterThan(1000);
    const header = VEXT_MCP_SKILL_CONTENT.match(/^---\n([^]*?)\n---\n/u)?.[1];
    expect(header).toBeDefined();
    await expect(format(header!, { parser: "yaml" })).resolves.toContain(
      "name: vextjs",
    );
    const fields = Object.fromEntries(
      header!.split("\n").map((line) => {
        const split = line.indexOf(":");
        return [line.slice(0, split), line.slice(split + 1).trim()];
      }),
    );
    expect(fields.name).toBe(VEXT_MCP_SKILL_NAME);
    expect(JSON.parse(fields.description!)).toBe(VEXT_MCP_SKILL_DESCRIPTION);
  });

  it("prints and writes the bundled Skill without host config mutation", async () => {
    const logs: string[] = [];
    let root: string | undefined;
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

      root = await mkdtemp(path.join(os.tmpdir(), "vext-mcp-skill-"));
      const output = path.join(
        root,
        ".vext",
        "skills",
        VEXT_MCP_SKILL_NAME,
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
      if (
        root &&
        path.dirname(root) === os.tmpdir() &&
        path.basename(root).startsWith("vext-mcp-skill-")
      )
        await rm(root, { recursive: true, force: true });
    }
  });
});

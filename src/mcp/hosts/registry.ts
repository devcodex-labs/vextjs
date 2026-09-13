import type { VextMcpHostId } from "../../assistant/contracts.js";

export interface VextMcpHostDescriptor {
  id: VextMcpHostId;
  configPath: string;
  configRootKey: string;
  configFormat: "json" | "toml";
  skillPath: string;
  notes: string;
}

export const VEXT_MCP_HOST_REGISTRY: Record<
  VextMcpHostId,
  VextMcpHostDescriptor
> = {
  codex: {
    id: "codex",
    configPath: ".codex/config.toml",
    configRootKey: "mcp_servers",
    configFormat: "toml",
    skillPath: ".agents/skills/vextjs/SKILL.md",
    notes:
      "Local trusted-project Codex config; cloud tasks are not assumed to reach this machine.",
  },
  "claude-code": {
    id: "claude-code",
    configPath: ".mcp.json",
    configRootKey: "mcpServers",
    configFormat: "json",
    skillPath: ".claude/skills/vextjs/SKILL.md",
    notes: "Claude Code project config; Claude Desktop config is out of scope.",
  },
  cursor: {
    id: "cursor",
    configPath: ".cursor/mcp.json",
    configRootKey: "mcpServers",
    configFormat: "json",
    skillPath: ".cursor/skills/vextjs/SKILL.md",
    notes:
      "Cursor local config; Cursor Cloud support must be verified separately.",
  },
  vscode: {
    id: "vscode",
    configPath: ".vscode/mcp.json",
    configRootKey: "servers",
    configFormat: "json",
    skillPath: ".github/skills/vextjs/SKILL.md",
    notes: "VS Code MCP config; standalone agent-host config is not inferred.",
  },
  grok: {
    id: "grok",
    configPath: ".grok/config.toml",
    configRootKey: "mcp_servers",
    configFormat: "toml",
    skillPath: ".grok/skills/vextjs/SKILL.md",
    notes:
      "Grok Build config; compatibility imports must be deduplicated later.",
  },
};

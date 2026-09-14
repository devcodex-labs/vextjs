import type { VextMcpHostId } from "../../assistant/contracts.js";

export interface VextMcpHostDescriptor {
  id: VextMcpHostId;
  configScope?: "project" | "user";
  configPath: string;
  configRootKey: string;
  configFormat: "json" | "toml";
  skillPath: string;
  refresh: VextMcpHostRefreshHint;
  notes: string;
}

export interface VextMcpHostRefreshHint {
  summary: string;
  steps: string[];
  validation: string[];
}

export const VEXT_MCP_HOST_REGISTRY: Record<
  VextMcpHostId,
  VextMcpHostDescriptor
> = {
  codex: {
    id: "codex",
    configScope: "user",
    configPath: "config.toml",
    configRootKey: "mcp_servers",
    configFormat: "toml",
    skillPath: ".agents/skills/vextjs/SKILL.md",
    refresh: {
      summary:
        "Restart the local Codex client or open a new local task so Codex rereads the user-level config.toml entry and project Skill files.",
      steps: [
        "Close and reopen the Codex client, or start a new local Codex task after sync completes.",
        "Start a fresh MCP interaction after reload so the vextjs server is discovered from the managed config block.",
      ],
      validation: [
        "Run codex mcp list and confirm the vextjs MCP server appears for this project.",
        "Run a read-only Vext MCP inspection from the refreshed host before applying generated changes.",
      ],
    },
    notes:
      "Codex desktop/CLI reads the user-level Codex config; project-local .codex/config.toml is not assumed to be auto-loaded.",
  },
  "claude-code": {
    id: "claude-code",
    configPath: ".mcp.json",
    configRootKey: "mcpServers",
    configFormat: "json",
    skillPath: ".claude/skills/vextjs/SKILL.md",
    refresh: {
      summary:
        "Restart Claude Code or reload the current project so the project .mcp.json entry and Skill file are discovered.",
      steps: [
        "Restart Claude Code or open a new project session after sync completes.",
        "If Claude Code exposes an MCP server refresh command, run that command instead of a full restart.",
      ],
      validation: [
        "Confirm the vextjs MCP server appears for this project.",
        "Invoke a read-only project inspection before trusting generated steps.",
      ],
    },
    notes: "Claude Code project config; Claude Desktop config is out of scope.",
  },
  cursor: {
    id: "cursor",
    configPath: ".cursor/mcp.json",
    configRootKey: "mcpServers",
    configFormat: "json",
    skillPath: ".cursor/skills/vextjs/SKILL.md",
    refresh: {
      summary:
        "Reload the Cursor window or start a new local agent session so Cursor rereads .cursor/mcp.json and project Skill files.",
      steps: [
        "Reload the Cursor window after sync completes.",
        "Start a new local agent session for the project before relying on the synchronized MCP entry.",
      ],
      validation: [
        "Confirm Cursor shows the vextjs MCP server for this workspace.",
        "Run a read-only Vext MCP project inspection from the refreshed session.",
      ],
    },
    notes:
      "Cursor local config; Cursor Cloud support must be verified separately.",
  },
  vscode: {
    id: "vscode",
    configPath: ".vscode/mcp.json",
    configRootKey: "servers",
    configFormat: "json",
    skillPath: ".github/skills/vextjs/SKILL.md",
    refresh: {
      summary:
        "Reload the VS Code window or restart the MCP server so .vscode/mcp.json and the project Skill file take effect.",
      steps: [
        "Reload the VS Code window after sync completes, or use the VS Code MCP command to restart the server if available.",
        "Open a fresh chat/agent session for the workspace after the MCP server is restarted.",
      ],
      validation: [
        "Confirm VS Code exposes the vextjs MCP server for this workspace.",
        "Run a read-only Vext MCP project inspection before applying generated changes.",
      ],
    },
    notes: "VS Code MCP config; standalone agent-host config is not inferred.",
  },
  grok: {
    id: "grok",
    configPath: ".grok/config.toml",
    configRootKey: "mcp_servers",
    configFormat: "toml",
    skillPath: ".grok/skills/vextjs/SKILL.md",
    refresh: {
      summary:
        "Restart or reload the Grok Build project session so the TOML managed block and project Skill are discovered.",
      steps: [
        "Restart the Grok Build project session after sync completes.",
        "Avoid importing duplicate compatibility config until the refreshed session confirms the managed vextjs entry.",
      ],
      validation: [
        "Confirm Grok lists the vextjs MCP server for this project.",
        "Run a read-only Vext MCP inspection from the refreshed session.",
      ],
    },
    notes:
      "Grok Build config; compatibility imports must be deduplicated later.",
  },
};

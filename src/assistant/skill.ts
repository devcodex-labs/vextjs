import { createHash } from "node:crypto";

export const VEXT_MCP_SKILL_NAME = "vextjs-official-mcp";
export const VEXT_MCP_SKILL_VERSION = "1";

export const VEXT_MCP_SKILL_CONTENT = `# VextJS Official MCP Skill

Use this skill when helping with a project that depends on VextJS and has access to the bundled \`vext mcp --root <dir>\` server.

## Core rules

- Treat the MCP server as the source of Vext framework facts for the installed package version.
- Use \`vext_project_inspect\` before planning file placement or generation.
- Use \`vext_knowledge_search\` for Vext APIs, project structure, recipes, resources, prompts, operations, dependencies, and framework-specific guidance.
- Use \`vext_generate_changes\` only for create-only drafts. The host applies file changes after validating identity and hashes.
- Use \`vext_validate_changes\` before applying a draft or user-supplied candidate.
- Use \`vext_project_check\` after changes to collect MCP diagnostics, then run the host-side commands returned by the tool.
- Do not ask the MCP server to execute shell commands, start services, apply file changes, run tests, modify databases, or edit host configuration. The host owns those actions.

## Standard workflow

1. Inspect the project with \`vext_project_inspect\`.
2. Search versioned knowledge with \`vext_knowledge_search\` for the relevant domain.
3. Check support with \`vext_capability_check\` when the task touches framework capabilities.
4. Generate or review a create-only ChangeSet if needed.
5. Validate the candidate with \`vext_validate_changes\`.
6. Apply changes in the host and run the returned \`requiredHostSteps\`.
7. Re-run \`vext_project_check\` and the appropriate build, test, docs, or packed-install checks.

## Placement policy

- Prefer directories detected from the current project.
- If the project has no user convention, use Vext default directories as recommendations.
- In workspaces, respect \`vext.workspace.json(c)\` services and sharedPackages.
- Shared contracts, models, UI, config, utilities, and test helpers must be placed in the matching shared package source exports when configured.
- Default directories are not mandatory. User architecture, naming, comments, and validation rules override MCP defaults.

## Validation expectations

- Backend/API changes usually require typecheck, focused unit/integration tests, and route or OpenAPI validation.
- Frontend changes usually require typecheck, build, and browser or e2e validation when behavior changes.
- Job changes require job unit tests and scheduler/worker/runtime checks through host commands.
- Shared packages require downstream consumer checks.
- Release candidates require \`npm run verify:pack-install\` and the release workflow's real platform, database, browser, and host matrix.

## Known boundaries

- Runtime Bridge and host refresh remain separate work packages unless the installed version reports them as available.
- Host configuration sync is available through \`vext mcp sync\`; project-local Skill file sync is available through \`vext mcp sync --skill\` when the installed version reports C29/C30 support.
- Tools remain usable even when Resources, Prompts, or host-native Skill support is missing.
- If MCP output is incomplete or clipped, request a narrower scope before applying changes.
`;

export interface VextMcpSkillManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  digest: string;
  bytes: number;
}

export function getVextMcpSkillManifest(): VextMcpSkillManifest {
  return {
    schemaVersion: 1,
    name: VEXT_MCP_SKILL_NAME,
    version: VEXT_MCP_SKILL_VERSION,
    digest: createHash("sha256").update(VEXT_MCP_SKILL_CONTENT).digest("hex"),
    bytes: Buffer.byteLength(VEXT_MCP_SKILL_CONTENT, "utf8"),
  };
}

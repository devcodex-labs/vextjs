import { createHash } from "node:crypto";

export const VEXT_MCP_SKILL_NAME = "vextjs";
export const VEXT_MCP_SKILL_VERSION = "2";
export const VEXT_MCP_SKILL_DESCRIPTION =
  "Develop or review VextJS applications using the bundled MCP server for installed framework APIs, project placement, code candidates, and validation evidence.";

export const VEXT_MCP_SKILL_CONTENT = `---
name: ${VEXT_MCP_SKILL_NAME}
description: ${JSON.stringify(VEXT_MCP_SKILL_DESCRIPTION)}
---

# VextJS Official MCP Skill

Use this skill when helping with a project that depends on VextJS and has access to the bundled \`vext mcp --root <dir>\` server.

## Core rules

- Stay within the user\'s requested Vext project and task. Inspect the returned root before using its facts; a configured server may target another service. Project architecture and user requirements override default conventions, while real framework contracts and incomplete evidence remain explicit.
- Treat MCP output as versioned framework evidence, not proof of business correctness. Compare loaded implementation identity, knowledge reviewed versions, and resolved dependency owners before adopting examples.
- Use \`vext_project_inspect\` before planning file placement or generation.
- Use \`vext_knowledge_search\` for Vext APIs, project structure, recipes, resources, prompts, operations, dependencies, and framework-specific guidance.
- Use \`vext_generate_changes\` only for create-only drafts. The host applies file changes after validating identity and hashes.
- Use \`vext_validate_changes\` before applying a draft or user-supplied candidate.
- Use \`vext_project_check\` after changes to collect MCP diagnostics. Pass \`configTarget\` as \`development\`, \`production\`, or \`all\` when configuration can differ by runtime target, then run the host-side commands returned by the tool.
- Do not ask the MCP server to execute shell commands, start services, apply file changes, run tests, modify databases, or edit host configuration. The host owns those actions.

## Standard workflow

1. Inspect the project with vext_project_inspect. Preserve projectId/contextRevision and check completeness; a nonempty source listing is not a passing verdict.
2. Search versioned knowledge with vext_knowledge_search for the relevant domain. Prefer native monSQLize model<T>(), findPage and findAndCount contracts over copied driver interfaces or application-side pagination.
3. Check support with \`vext_capability_check\` when the task touches framework capabilities.
4. Pass the effective language, comments, roles and architecture through policyPatch. Generate or review a create-only ChangeSet if needed; a scaffold and its prerequisites are unfinished integration work.
5. Validate with vext_validate_changes using the same base identity and file hashes. Refresh stale identity and resolve invalid/incomplete results; reducing the displayed page cannot prove missing facts.
6. Apply changes in the host and run the returned \`requiredHostSteps\`.
7. Re-run relevant checks after changes and record actual host commands/exit codes. Use focused local verification during development; reserve packed-install checks for package boundaries or release candidates and clean temporary installations afterward.

## Placement policy

- Prefer directories detected from the current project.
- If the project has no user convention, use Vext default directories as recommendations.
- In workspaces, respect \`vext.workspace.json(c)\` services and sharedPackages.
- Shared contracts, models, UI, config, utilities, and test helpers must be placed in the matching shared package source exports when configured.
- Default directories are not mandatory. User architecture, naming, comments, and engineering conventions override defaults. Keep loader entries when implementations move; an import-only role does not become app injection.
- Place reusable service contracts in the effective service-types role (default src/types/server/services), model documents in server-model-types, and serialized browser contracts in shared-types only when they differ. JS uses JSDoc as needed; do not copy native database method interfaces.
- Place reusable Job payload contracts in the effective job-types role (default src/types/server/jobs) and share the runtime payload schema from schemas. Scheduled runs created by the built-in scheduler do not carry business payload; required-payload work must be run/enqueued explicitly or derived inside the scheduled handler.
- Keep mock data/scenarios/adapters separate and seeds explicit. GET requests do not seed databases or silently fall back to mock data. Route files are not shared helper libraries; private service logic and callbacks are valid, while reused pure operations belong near their consumers.
- Explain non-obvious contracts, permissions, idempotency, cache failures and time units in the adopted comment language. Run the project formatter; do not add redundant wrappers or comments based solely on function counts.
- Route/page Recipes accept JSON-safe \`RouteOptions\` data through \`routeOptions\` plus top-level \`auth\`, \`middlewares\`, \`cache\`, \`docs\`, \`operationId\`, \`security\`, and \`access\`. Preserve explicit \`false\` and \`[]\`; route cache uses \`false\`, a positive TTL number, or a \`RouteCacheOptions\` object. Function-based auth/check middleware, instantiated stores, and other runtime objects must be wired in host code or existing modules, not serialized into MCP options.
- Protected pages or admin APIs must declare the selected route authorization/middleware boundary or reuse an existing configured middleware before reading protected data. Do not simulate authorization by spreading route handlers or hiding admin branches in generated service code.
- Locales are feature/subfeature resources. Backend locale entries describe error keys with code/message/status semantics; frontend locale entries describe user-facing copy, actions, and states. Keep mock data in mock-data/mock-scenarios roles, never inside services as seed data.

## Validation expectations

- Backend/API changes usually require typecheck, focused unit/integration tests, route checks, and OpenAPI validation when docs or responses change.
- Frontend changes usually require typecheck, build, and browser or e2e validation when behavior changes.
- Job changes require job unit tests and scheduler/worker/runtime checks through host commands. Redis-backed Job changes also require a real Redis integration check when Redis is available; report skip explicitly when it is not. Store completion must reject missing, queued, terminal, repeated and non-current-owner completion attempts without overwriting the terminal record.
- Shared packages require downstream consumer checks.
- Release candidates require \`npm run verify:pack-install\` and the release workflow's real platform, database, browser, and host matrix; successful pack-install runs clean their temporary workspace unless evidence retention is explicitly requested.

## Known boundaries

- RateLimit, Job, Session, and response cache own separate Redis integration boundaries. Do not assume one module's Redis config injects another module's store; inspect each module config independently.
- Job scheduler and worker processes are explicit runtime roles. HTTP service startup alone does not prove scheduled work is active, jobs.worker.concurrency is per worker process, and horizontal scale still requires business idempotency around side effects.
- Runtime Bridge reads framework-managed evidence for the fixed project. Inspect web/cluster/worker/scheduler identities and freshness separately. Snapshot presence or updatedAt alone is not liveness or proof that current source is running.
- Host configuration sync is available through \`vext mcp sync\`; project-local Skill file sync is available through \`vext mcp sync --skill\` when the installed version reports C29/C30 support.
- Tools remain usable even when Resources, Prompts, or host-native Skill support is missing.
- If output is paged, read the remaining pages without weakening the total verdict. If coverage is incomplete, resolve its cause or report the missing evidence; a narrower display does not make unsafe candidates valid.

## Adoption evidence

Distinguish four steps: configuration read-back, valid Skill metadata and discovery location, a real connected Tool response with the expected implementation digest, and this task\'s actual Tool/host-command history. File sync proves only the first two when checked. Do not infer whether an earlier task used MCP without its trace. A project Skill under a child service is not automatically discovered from a parent workspace session.

Preserve a concise verification record containing called Tool names, project root, identity, candidate hashes, host commands/exit codes and unresolved behavior. Use the seven Tools directly when Resources, Prompts or native Skills are unavailable; do not invent tool execution receipts.
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

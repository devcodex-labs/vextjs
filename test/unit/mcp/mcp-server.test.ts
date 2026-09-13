import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  VEXT_MCP_CAPABILITIES,
  VEXT_MCP_PROMPT_NAMES,
  VEXT_MCP_RECIPES,
  VEXT_MCP_RESOURCE_URIS,
  VEXT_MCP_TOOL_NAMES,
  searchMcpCatalog,
} from "../../../src/assistant/catalog.js";
import { inspectVextProject } from "../../../src/assistant/project-inspector.js";
import { createVextMcpServer } from "../../../src/mcp/server.js";

let rootDir: string | undefined;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
  rootDir = undefined;
});

describe("Vext MCP catalog", () => {
  it("keeps the contracted protocol surface counts stable", () => {
    expect(VEXT_MCP_TOOL_NAMES).toHaveLength(7);
    expect(VEXT_MCP_RESOURCE_URIS).toHaveLength(11);
    expect(VEXT_MCP_PROMPT_NAMES).toHaveLength(4);
  });

  it("returns deterministic built-in knowledge matches", () => {
    const result = searchMcpCatalog({ query: "job", limit: 10 });
    expect(result.catalogDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.matches.some((match) => match.id === "C34")).toBe(true);
    expect(result.unknownIds).toEqual([]);
    expect(
      searchMcpCatalog({ query: "候选 校验 目录", limit: 10 }).matches.some(
        (match) => match.id === "C27",
      ),
    ).toBe(true);
    const dependency = searchMcpCatalog({
      query: "schema-dsl",
      kinds: ["knowledge"],
      limit: 5,
    });
    expect(dependency.matches[0]).toMatchObject({
      id: "K01",
      kind: "knowledge",
      title: "schema-dsl",
    });
    expect(dependency.matches[0]?.summary).toContain("3.0.4");
  });

  it("marks implemented recipe and knowledge surfaces as available", () => {
    expect(VEXT_MCP_RECIPES.find((item) => item.id === "RCP-17")).toMatchObject(
      { status: "available" },
    );
    expect(
      VEXT_MCP_CAPABILITIES.find((item) => item.id === "C26"),
    ).toMatchObject({ status: "available" });
    expect(
      VEXT_MCP_CAPABILITIES.find((item) => item.id === "C27"),
    ).toMatchObject({ status: "available" });
    expect(
      VEXT_MCP_CAPABILITIES.find((item) => item.id === "C23"),
    ).toMatchObject({ status: "available" });
    expect(
      VEXT_MCP_CAPABILITIES.find((item) => item.id === "C24"),
    ).toMatchObject({ status: "available" });
    expect(
      VEXT_MCP_CAPABILITIES.find((item) => item.id === "C33"),
    ).toMatchObject({ status: "available" });
    expect(
      VEXT_MCP_CAPABILITIES.find((item) => item.id === "C34"),
    ).toMatchObject({ status: "available" });
    expect(
      VEXT_MCP_CAPABILITIES.find((item) => item.id === "C18"),
    ).toMatchObject({ status: "partial" });
  });
});

describe("Vext MCP project inspector", () => {
  it("inspects a bounded Vext project structure without creating files", async () => {
    rootDir = await createFixtureProject();
    const inspection = inspectVextProject({
      rootDir,
      frameworkVersion: "2.0.0",
    });
    expect(inspection.identity.sourceState).toBe("complete");
    expect(inspection.identity.contextRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(inspection.snapshot.sections.config?.state).toBe("known");
    expect(inspection.snapshot.sections.jobs?.state).toBe("known");
    expect(inspection.snapshot.sections.schemas?.defaultPath).toBe(
      "src/schemas",
    );
    expect(inspection.snapshot.sections["shared-types"]?.defaultPath).toBe(
      "src/types/shared",
    );
    expect(
      inspection.snapshot.sections["frontend-components"]?.defaultPath,
    ).toBe("src/frontend/components");
    expect(
      inspection.structureDecisions.find((item) => item.role === "locales")
        ?.defaultPath,
    ).toBe("src/locales");
    expect(inspection.assistant.devMcp).toMatchObject({
      declared: true,
      enabled: true,
      hosts: ["codex"],
      sync: "check",
    });
    expect(inspection.assistant.devMcpSources).toEqual([
      "src/config/default.ts",
    ]);
    expect(inspection.assistant.workspace?.config.services?.[0]).toMatchObject({
      id: "api",
      root: ".",
      sharedPackages: ["models"],
    });
    expect(
      inspection.assistant.workspace?.config.sharedPackages?.[0],
    ).toMatchObject({
      id: "models",
      root: "packages/models",
      kind: "models",
    });
  });
});

describe("Vext MCP server", () => {
  it("serves tools, resources, prompts, and a real project inspect call", async () => {
    rootDir = await createFixtureProject();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createVextMcpServer({ rootDir, version: "2.0.0" });
    const client = new Client(
      { name: "vextjs-test-client", version: "1.0.0" },
      { versionNegotiation: { mode: "legacy" } },
    );
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
        [...VEXT_MCP_TOOL_NAMES].sort(),
      );
      const resources = await client.listResources();
      expect(
        resources.resources.map((resource) => resource.uri).sort(),
      ).toEqual([...VEXT_MCP_RESOURCE_URIS].sort());
      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual(
        [...VEXT_MCP_PROMPT_NAMES].sort(),
      );

      const inspect = await client.callTool({
        name: "vext_project_inspect",
        arguments: { section: "summary" },
      });
      expect(inspect.structuredContent).toMatchObject({ status: "ok" });
      const config = await client.callTool({
        name: "vext_project_inspect",
        arguments: { section: "config" },
      });
      expect(JSON.stringify(config.structuredContent)).toContain(
        "devMcpSources",
      );
      const services = await client.callTool({
        name: "vext_project_inspect",
        arguments: { section: "services" },
      });
      expect(services.structuredContent).toMatchObject({
        status: "ok",
        section: "services",
        details: {
          workspaceServices: [
            {
              id: "api",
              root: ".",
              isCurrentRoot: true,
              sharedPackages: [{ id: "models" }],
            },
          ],
        },
      });
      const models = await client.callTool({
        name: "vext_project_inspect",
        arguments: { section: "models" },
      });
      expect(models.structuredContent).toMatchObject({
        status: "ok",
        section: "models",
        details: {
          sharedModelPackages: [
            {
              id: "models",
              kind: "models",
              sourceExports: { user: "src/user.ts" },
              consumers: ["api"],
            },
          ],
        },
      });
      const jobs = await client.callTool({
        name: "vext_project_inspect",
        arguments: { section: "jobs" },
      });
      expect(jobs.structuredContent).toMatchObject({
        status: "ok",
        section: "jobs",
        details: {
          config: {
            scheduler: { mode: "enqueue", tickInterval: 1000 },
            worker: { concurrency: 2 },
          },
          jobs: [
            {
              name: "billing.closeInvoice",
              sourceFile: "src/jobs/billing/close.ts",
              hasSchedule: true,
              queue: { priority: 5 },
            },
          ],
        },
      });
      expect(JSON.stringify(jobs.structuredContent)).toContain(
        "vext job scheduler",
      );
      const knowledge = await client.callTool({
        name: "vext_knowledge_search",
        arguments: { query: "job", limit: 5 },
      });
      expect(JSON.stringify(knowledge.structuredContent)).toContain("C34");
      const dependencyKnowledge = await client.callTool({
        name: "vext_knowledge_search",
        arguments: {
          query: "monsqlize",
          kinds: ["knowledge"],
          limit: 5,
        },
      });
      expect(JSON.stringify(dependencyKnowledge.structuredContent)).toContain(
        "K05",
      );
      const draft = await client.callTool({
        name: "vext_generate_changes",
        arguments: {
          recipeId: "RCP-11",
          name: "Billing Event",
          options: { description: "Billing event contract." },
        },
      });
      expect(draft.structuredContent).toMatchObject({
        status: "ok",
        data: { kind: "change-set", verdict: "ready" },
      });
      expect(JSON.stringify(draft.structuredContent)).toContain(
        "src/types/shared/billing-event.d.ts",
      );
      const validateDraft = await client.callTool({
        name: "vext_validate_changes",
        arguments: {
          changeSet: (
            draft.structuredContent as { data: { changeSet: unknown } }
          ).data.changeSet,
        },
      });
      expect(validateDraft.structuredContent).toMatchObject({
        status: "ok",
        data: { verdict: "valid", fileCount: 1 },
      });
      const existingFile = await client.callTool({
        name: "vext_validate_changes",
        arguments: {
          files: [
            {
              path: "src/routes/hello.ts",
              action: "create",
              encoding: "utf8",
              content: "export {};",
            },
          ],
        },
      });
      expect(existingFile.structuredContent).toMatchObject({
        status: "ok",
        data: { verdict: "invalid" },
      });
      expect(JSON.stringify(existingFile.structuredContent)).toContain(
        "already exists",
      );
      const sharedPackageFile = await client.callTool({
        name: "vext_validate_changes",
        arguments: {
          files: [
            {
              path: "packages/models/src/order.ts",
              action: "create",
              encoding: "utf8",
              content: "export interface Order {}\n",
            },
          ],
        },
      });
      expect(sharedPackageFile.structuredContent).toMatchObject({
        status: "ok",
        data: {
          verdict: "valid",
          fileCount: 1,
          files: [
            {
              path: "packages/models/src/order.ts",
              verdict: "valid",
              directory: {
                source: "workspace-shared-package",
                packageId: "models",
              },
            },
          ],
        },
      });
      expect(JSON.stringify(sharedPackageFile.structuredContent)).toContain(
        "Run tests for every workspace service that consumes the changed shared package.",
      );
      const unsupportedDirectory = await client.callTool({
        name: "vext_validate_changes",
        arguments: {
          files: [
            {
              path: "docs/notes.md",
              action: "create",
              encoding: "utf8",
              content: "# Notes\n",
            },
          ],
        },
      });
      expect(unsupportedDirectory.structuredContent).toMatchObject({
        status: "ok",
        data: {
          verdict: "invalid",
          files: [{ path: "docs/notes.md", verdict: "invalid" }],
        },
      });
      expect(JSON.stringify(unsupportedDirectory.structuredContent)).toContain(
        "outside supported Vext candidate directories",
      );
      const routeDraft = await client.callTool({
        name: "vext_generate_changes",
        arguments: { recipeId: "RCP-01", name: "Account Profile" },
      });
      expect(routeDraft.structuredContent).toMatchObject({
        status: "ok",
        data: { kind: "change-set", verdict: "ready" },
      });
      expect(JSON.stringify(routeDraft.structuredContent)).toContain(
        "src/routes/account-profile.ts",
      );
      const schemaDraft = await client.callTool({
        name: "vext_generate_changes",
        arguments: { recipeId: "RCP-15", name: "Payment Request" },
      });
      expect(schemaDraft.structuredContent).toMatchObject({
        status: "ok",
        data: { kind: "change-set", verdict: "ready" },
      });
      expect(JSON.stringify(schemaDraft.structuredContent)).toContain(
        "src/schemas/payment-request.ts",
      );
      const invalid = await client.callTool({
        name: "vext_generate_changes",
        arguments: { recipeId: "RCP-01", name: "../bad" },
      });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid.structuredContent)).toContain(
        "VEXT_VALIDATION_FAILED",
      );
      const stale = await client.callTool({
        name: "vext_project_check",
        arguments: {
          expectedIdentity: {
            projectId: "0".repeat(64),
            contextRevision: "0".repeat(64),
          },
        },
      });
      expect(stale.isError).toBe(true);
      expect(JSON.stringify(stale.structuredContent)).toContain(
        "VEXT_CONTEXT_STALE",
      );
      const workspaceCapability = await client.callTool({
        name: "vext_capability_check",
        arguments: { capability: "C23" },
      });
      expect(workspaceCapability.structuredContent).toMatchObject({
        status: "ok",
        data: { projectState: "enabled" },
      });
      const sharedPackageCapability = await client.callTool({
        name: "vext_capability_check",
        arguments: { capability: "C24" },
      });
      expect(sharedPackageCapability.structuredContent).toMatchObject({
        status: "ok",
        data: { projectState: "enabled" },
      });
      const runtimeCapability = await client.callTool({
        name: "vext_capability_check",
        arguments: { capability: "C18" },
      });
      expect(runtimeCapability.structuredContent).toMatchObject({
        status: "ok",
        data: { projectState: "partial" },
      });
      expect(JSON.stringify(runtimeCapability.structuredContent)).toContain(
        "vext_runtime_inspect",
      );
      const runtimeMissing = await client.callTool({
        name: "vext_runtime_inspect",
        arguments: { section: "summary" },
      });
      expect(runtimeMissing.structuredContent).toMatchObject({
        status: "ok",
        data: { availability: "unavailable", snapshot: null },
      });
      const identity = inspectVextProject({
        rootDir,
        frameworkVersion: "2.0.0",
      }).identity;
      await mkdir(join(rootDir, ".vext", "runtime"), { recursive: true });
      await writeFile(
        join(rootDir, ".vext", "runtime", "snapshot.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            identity: { contextRevision: identity.contextRevision },
            runtimeIdentity: {
              mode: "development",
              pid: 1234,
              contextRevision: identity.contextRevision,
            },
            updatedAt: "2026-09-13T14:00:00.000Z",
            summary: { state: "ready" },
            workers: [{ id: 1, pid: 1235, state: "ready" }],
            reloads: [{ id: "reload-1", status: "success" }],
            events: [
              { id: "event-1", type: "ready" },
              { id: "event-2", type: "reload" },
            ],
          },
          null,
          2,
        )}\n`,
      );
      const runtimeEvents = await client.callTool({
        name: "vext_runtime_inspect",
        arguments: { section: "events", limit: 1 },
      });
      expect(runtimeEvents.structuredContent).toMatchObject({
        status: "ok",
        data: {
          availability: "available",
          runtimeIdentity: { mode: "development", pid: 1234 },
          events: [{ id: "event-1" }],
          pageInfo: { nextCursor: "1" },
          resyncRequired: false,
        },
      });
      const runtimeResource = await client.readResource({
        uri: "vext://runtime/snapshot",
      });
      expect(runtimeResource.contents[0]?.text).toContain(
        '"availability": "available"',
      );
      const hostSyncCapability = await client.callTool({
        name: "vext_capability_check",
        arguments: { capability: "C29" },
      });
      expect(hostSyncCapability.structuredContent).toMatchObject({
        status: "ok",
        data: { projectState: "partial" },
      });
      expect(JSON.stringify(hostSyncCapability.structuredContent)).toContain(
        "vext mcp sync",
      );
      const skillCapability = await client.callTool({
        name: "vext_capability_check",
        arguments: { capability: "C30" },
      });
      expect(skillCapability.structuredContent).toMatchObject({
        status: "ok",
        data: { projectState: "partial" },
      });
      expect(JSON.stringify(skillCapability.structuredContent)).toContain(
        "vext mcp skill check",
      );
      const releaseCapability = await client.callTool({
        name: "vext_capability_check",
        arguments: { capability: "C32" },
      });
      expect(releaseCapability.structuredContent).toMatchObject({
        status: "ok",
        data: { projectState: "partial" },
      });
      expect(JSON.stringify(releaseCapability.structuredContent)).toContain(
        "verify:pack-install",
      );
      const resource = await client.readResource({
        uri: "vext://catalog/recipes",
      });
      expect(resource.contents[0]?.text).toContain("RCP-17");
      const structure = await client.readResource({
        uri: "vext://project/structure",
      });
      expect(structure.contents[0]?.text).toContain("workspace");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function createFixtureProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vext-mcp-"));
  await mkdir(join(dir, "src", "config"), { recursive: true });
  await mkdir(join(dir, "src", "routes"), { recursive: true });
  await mkdir(join(dir, "src", "services"), { recursive: true });
  await mkdir(join(dir, "src", "jobs", "billing"), { recursive: true });
  await mkdir(join(dir, "src", "locales", "billing"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-app",
        version: "1.0.0",
        dependencies: { vextjs: "2.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "NodeNext" } }),
  );
  await writeFile(
    join(dir, "src", "config", "default.ts"),
    'export default { server: { port: 3000 }, jobs: { scheduler: { mode: "enqueue", tickInterval: 1000 }, worker: { concurrency: 2 }, store: { type: "file", dir: ".vext/jobs" } }, dev: { mcp: { enabled: true, hosts: ["codex"], sync: "check" } } };\n',
  );
  await writeFile(
    join(dir, "vext.workspace.jsonc"),
    JSON.stringify(
      {
        schemaVersion: 1,
        hosts: ["codex"],
        services: [{ id: "api", root: ".", sharedPackages: ["models"] }],
        sharedPackages: [
          {
            id: "models",
            root: "packages/models",
            kind: "models",
            sourceExports: { user: "src/user.ts" },
          },
        ],
        policyDefaults: { outputLanguage: "zh" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(dir, "src", "routes", "hello.ts"),
    "export default function routes() {}\n",
  );
  await writeFile(
    join(dir, "src", "jobs", "billing", "close.ts"),
    'import { defineJob } from "vextjs";\n\nexport default defineJob({\n  name: "billing.closeInvoice",\n  description: "Close overdue invoices.",\n  tags: ["billing"],\n  queue: { priority: 5 },\n  schedule: { cron: "0 * * * *", timezone: "UTC", singleton: true },\n  concurrency: 1,\n  async handler() {}\n});\n',
  );
  return dir;
}

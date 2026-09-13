import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  VEXT_MCP_PROMPT_NAMES,
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
    expect(
      inspection.structureDecisions.find((item) => item.role === "locales")
        ?.defaultPath,
    ).toBe("src/locales");
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
      const knowledge = await client.callTool({
        name: "vext_knowledge_search",
        arguments: { query: "job", limit: 5 },
      });
      expect(JSON.stringify(knowledge.structuredContent)).toContain("C34");
      const resource = await client.readResource({
        uri: "vext://catalog/recipes",
      });
      expect(resource.contents[0]?.text).toContain("RCP-17");
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
    "export default { server: { port: 3000 } };\n",
  );
  await writeFile(
    join(dir, "src", "routes", "hello.ts"),
    "export default function routes() {}\n",
  );
  await writeFile(
    join(dir, "src", "jobs", "billing", "close.ts"),
    "export default {};\n",
  );
  return dir;
}

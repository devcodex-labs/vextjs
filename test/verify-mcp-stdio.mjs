import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let rootDir;

try {
  rootDir = await mkdtemp(join(tmpdir(), "vext-mcp-stdio-"));
  await mkdir(join(rootDir, "src", "config"), { recursive: true });
  await mkdir(join(rootDir, "src", "jobs"), { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify(
      {
        name: "stdio-fixture",
        version: "1.0.0",
        dependencies: { vextjs: "2.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(rootDir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "NodeNext" } }),
  );
  await writeFile(
    join(rootDir, "src", "config", "default.ts"),
    "export default { server: { port: 3000 } };\n",
  );

  const client = new Client(
    { name: "vextjs-stdio-verify", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, "dist", "cli", "index.js"), "mcp", "--root", rootDir],
    cwd: rootDir,
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    if (tools.tools.length !== 7)
      throw new Error(`Expected 7 tools, received ${tools.tools.length}.`);
    const resources = await client.listResources();
    if (resources.resources.length !== 11)
      throw new Error(
        `Expected 11 resources, received ${resources.resources.length}.`,
      );
    const prompts = await client.listPrompts();
    if (prompts.prompts.length !== 4)
      throw new Error(
        `Expected 4 prompts, received ${prompts.prompts.length}.`,
      );
    const inspect = await client.callTool({
      name: "vext_project_inspect",
      arguments: { section: "summary" },
    });
    const text = inspect.content?.[0]?.text ?? "";
    if (!text.includes("stdio-fixture"))
      throw new Error(
        "Inspect result did not include fixture package identity.",
      );
    const knowledge = await client.callTool({
      name: "vext_knowledge_search",
      arguments: { query: "Job", limit: 5 },
    });
    if (!JSON.stringify(knowledge).includes("C34"))
      throw new Error("Knowledge search did not return Job capability.");
  } finally {
    await client.close();
  }
} finally {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
}

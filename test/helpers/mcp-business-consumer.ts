import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createVextMcpServer } from "../../src/mcp/server.js";
import type { VextAssistantPolicyPatch } from "../../src/assistant/contracts.js";
import type { VextMcpChangeSet } from "../../src/assistant/change-set.js";

export const repository = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** The host owns writes/execution. MCP calls and subsequent manual integration remain separately auditable. */
export async function createBusinessConsumer(options: { name?: string } = {}) {
  const name = options.name ?? "mcp-blog";
  if (!/^[a-z][a-z0-9-]{0,100}$/u.test(name))
    throw new Error("Invalid consumer name");
  const parent = await mkdtemp(path.join(tmpdir(), "vext-mcp-business-"));
  const root = path.join(parent, name);
  const history: Array<Record<string, unknown>> = [];
  let client: Client | undefined;
  let server: ReturnType<typeof createVextMcpServer> | undefined;
  const target = (relative: string) => {
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep))
      throw new Error(`Outside owned consumer: ${relative}`);
    return file;
  };
  async function command(args: string[], cwd = root) {
    const started = Date.now();
    try {
      const result = await execute(process.execPath, args, {
        cwd,
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      history.push({
        command: [process.execPath, ...args],
        cwd,
        exitCode: 0,
        durationMs: Date.now() - started,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      return result;
    } catch (error) {
      const failure = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: unknown;
      };
      history.push({
        command: [process.execPath, ...args],
        cwd,
        error: String(error),
        stdout: failure.stdout,
        stderr: failure.stderr,
        exitCode: failure.code,
      });
      throw new Error(`${String(error)}\n${failure.stdout ?? ""}`, {
        cause: error,
      });
    }
  }
  async function put(relative: string, content: string, reason: string) {
    const file = target(relative);
    const previous = await readFile(file, "utf8").catch(() => null);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    history.push({
      action: "host-write",
      path: relative,
      reason,
      previousSha256: previous === null ? null : digest(previous),
      sha256: digest(content),
    });
  }
  async function call(name: string, args: Record<string, unknown> = {}) {
    if (!client) throw new Error("MCP client is not connected");
    const response = await client.callTool({ name, arguments: args });
    const payload = response.structuredContent as {
      status?: string;
      data?: Record<string, any>;
      [key: string]: any;
    };
    history.push({ action: "mcp-call", name, args, payload });
    if (!payload || response.isError || payload.status === "error")
      throw new Error(JSON.stringify(payload ?? response));
    return payload;
  }
  async function generate(
    recipeId: string,
    name: string,
    options: Record<string, unknown>,
    overrides: VextAssistantPolicyPatch = {},
  ) {
    const policyPatch = { commentLanguage: "en" as const, ...overrides };
    const inspection = await call("vext_project_inspect", {
      section: "identity",
      refresh: true,
      policyPatch,
    });
    const current = inspection.data?.identity ?? inspection.identity;
    const identity = {
      projectId: current.projectId,
      contextRevision: current.contextRevision,
    };
    const payload = await call("vext_generate_changes", {
      recipeId,
      name,
      options,
      expectedIdentity: identity,
      policyPatch,
    });
    const changeSet = payload.data?.changeSet as VextMcpChangeSet | undefined;
    if (!changeSet)
      throw new Error(`Recipe ${recipeId}: ${JSON.stringify(payload)}`);
    const validation = await call("vext_validate_changes", {
      changeSet,
      expectedIdentity: identity,
      profile: "strict",
      policyPatch,
    });
    if (
      validation.data?.staticVerdict !== "valid" ||
      validation.data?.applyReady !== true
    )
      throw new Error(`Candidate: ${JSON.stringify(validation)}`);
    for (const file of changeSet.files)
      await put(
        file.path,
        file.content,
        `Apply MCP ${recipeId} candidate after host review`,
      );
    return changeSet;
  }
  async function overlayFixture(relative: string) {
    const source = path.join(
      repository,
      "test/fixtures/mcp-business",
      relative,
    );
    async function visit(directory: string, prefix: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const item = path.join(directory, entry.name);
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink())
          throw new Error(`Unexpected fixture link: ${item}`);
        if (entry.isDirectory()) await visit(item, name);
        else
          await put(
            name,
            await readFile(item, "utf8"),
            "Host integrates reviewed business behavior; general Recipe does not generate the entire application",
          );
      }
    }
    await visit(source, "");
  }
  async function close() {
    try {
      await client?.close();
    } finally {
      try {
        await server?.close();
      } finally {
        if (
          path.dirname(parent) !== tmpdir() ||
          !path.basename(parent).startsWith("vext-mcp-business-")
        )
          throw new Error("Unexpected consumer cleanup root");
        await rm(parent, { recursive: true, force: true });
        history.push({ action: "remove-owned-consumer", root: parent });
      }
    }
  }

  try {
    await command(
      [
        path.join(repository, "dist/cli/index.js"),
        "create",
        name,
        "--template",
        "fullstack-react",
        "--adapter",
        "native",
        "--skip-install",
      ],
      parent,
    );
    // All starter files belong to the CLI invocation above; record them before replacing this isolated consumer's demonstration.
    async function removeStarter(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await removeStarter(file);
        else {
          const relative = path.relative(root, file);
          history.push({
            action: "remove-cli-starter",
            path: relative,
            sha256: digest(await readFile(file, "utf8")),
          });
          await rm(target(relative));
        }
      }
    }
    await removeStarter(target("src"));
    await mkdir(target("node_modules"), { recursive: true });
    for (const name of [
      "vextjs",
      "react",
      "react-dom",
      "monsqlize",
      "schema-dsl",
      "typescript",
      "@types/node",
      "@types/react",
      "@types/react-dom",
    ]) {
      const link = target(`node_modules/${name}`);
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(
        name === "vextjs"
          ? repository
          : path.join(repository, "node_modules", name),
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    await put(
      "src/config/default.ts",
      "export default {};\n",
      "Initial isolated MCP analysis context; actual targets supplied by the runner",
    );
    server = createVextMcpServer({ rootDir: root, version: "2.0.0" });
    client = new Client({ name: "vext-mcp-business-host", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await call("vext_knowledge_search", {
      ids: ["K01", "K05", "K02"],
      locale: "zh",
    });
    return {
      root,
      parent,
      history,
      put,
      generate,
      call,
      command,
      overlayFixture,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

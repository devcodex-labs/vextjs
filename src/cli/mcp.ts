import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  VEXT_MCP_HOST_IDS,
  type VextMcpHostId,
} from "../assistant/contracts.js";
import {
  getVextMcpSkillManifest,
  VEXT_MCP_SKILL_CONTENT,
} from "../assistant/skill.js";
import { createVextMcpHostSyncPlan } from "../mcp/hosts/plan.js";
import { applyVextMcpHostSyncPlan } from "../mcp/hosts/sync.js";
import { parseMcpCliArgs, serveVextMcpStdio } from "../mcp/server.js";

export async function mcpCommand(args: string[] = []): Promise<void> {
  if (args[0] === "sync") {
    await mcpSyncCommand(args.slice(1));
    return;
  }
  if (args[0] === "skill") {
    await mcpSkillCommand(args.slice(1));
    return;
  }
  const options = parseMcpCliArgs(args);
  if (options.help) {
    printMcpHelp();
    return;
  }
  try {
    await serveVextMcpStdio({ rootDir: options.rootDir });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

function printMcpHelp(): void {
  console.log(`
  Usage: vext mcp [options]
         vext mcp sync --root <dir> [--check|--dry-run] [--host <id>] [--skill] [--json]
         vext mcp skill <check|print|write> [options]

  Options:
    --root <dir>          Bind MCP server to a Vext project root (defaults to cwd)
    -h, --help            Show this help message

  Notes:
    vext mcp starts a stdio MCP server. It does not execute project scripts,
    start dev servers, apply changes, or modify host MCP configuration.

  Sync:
    vext mcp sync --root . --host vscode --json
    vext mcp sync --root . --host codex --skill --json
    vext mcp sync --root . --check --json
    vext mcp sync --root . --dry-run --host codex --json

  Skill:
    vext mcp skill check
    vext mcp skill print
    vext mcp skill write --output .vext/skills/vextjs-official-mcp/SKILL.md
`);
}

async function mcpSyncCommand(args: string[]): Promise<void> {
  const options = parseMcpSyncArgs(args);
  if (options.help) {
    printMcpSyncHelp();
    return;
  }
  const plan = createVextMcpHostSyncPlan({
    rootDir: options.rootDir,
    frameworkVersion: readFrameworkVersion(),
    host: options.host,
    mode: options.mode,
    includeSkill: options.includeSkill,
  });
  const result = {
    status: "ok",
    plan,
    applied:
      options.mode === "write"
        ? await applyVextMcpHostSyncPlan(plan)
        : undefined,
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function parseMcpSyncArgs(args: string[]): {
  rootDir: string;
  host?: VextMcpHostId;
  mode: "check" | "dry-run" | "write";
  includeSkill: boolean;
  json: boolean;
  help: boolean;
} {
  let rootDir = process.cwd();
  let host: VextMcpHostId | undefined;
  let check = false;
  let dryRun = false;
  let includeSkill = false;
  let json = false;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case "--root": {
        const value = args[index + 1];
        if (!value || value.startsWith("-")) {
          throw new Error(
            "[vextjs] vext mcp sync --root requires a directory.",
          );
        }
        rootDir = path.resolve(value);
        index += 1;
        break;
      }
      case "--host": {
        const value = args[index + 1];
        if (!value || value.startsWith("-")) {
          throw new Error("[vextjs] vext mcp sync --host requires a host id.");
        }
        if (!isVextMcpHostId(value)) {
          throw new Error(
            `[vextjs] Unknown MCP host "${value}". Supported hosts: ${VEXT_MCP_HOST_IDS.join(", ")}.`,
          );
        }
        host = value;
        index += 1;
        break;
      }
      case "--check":
        check = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--json":
        json = true;
        break;
      case "--skill":
        includeSkill = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`[vextjs] Unknown vext mcp sync argument: ${arg}`);
    }
  }
  if (help) {
    return { rootDir, host, mode: "check", includeSkill, json, help };
  }
  if (check && dryRun) {
    throw new Error(
      "[vextjs] vext mcp sync --check and --dry-run are mutually exclusive.",
    );
  }
  return {
    rootDir,
    host,
    mode: check ? "check" : dryRun ? "dry-run" : "write",
    includeSkill,
    json,
    help,
  };
}

function isVextMcpHostId(value: string): value is VextMcpHostId {
  return (VEXT_MCP_HOST_IDS as readonly string[]).includes(value);
}

function printMcpSyncHelp(): void {
  console.log(`
  Usage: vext mcp sync --root <dir> [--check|--dry-run] [--host <id>] [--skill] [--json]

  Options:
    --root <dir>          Vext service root
    --host <id>           Filter to one declared host: ${VEXT_MCP_HOST_IDS.join(", ")}
    --check               Compare intent and print the plan without writes
    --dry-run             Print the planned managed entry without writes
    --json                Print a single JSON object
    --skill               Also write bundled project-local Skill file(s)
    -h, --help            Show this help message

  Notes:
    Without --check or --dry-run, sync writes the project launcher/state and JSON
    host config entries or TOML managed blocks. --skill writes project-local
    Skill files only when the target file is missing or already managed by Vext.
`);
}

async function mcpSkillCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printMcpSkillHelp();
    return;
  }
  switch (command) {
    case "check":
      printSkillManifest();
      return;
    case "print":
      console.log(VEXT_MCP_SKILL_CONTENT.trimEnd());
      return;
    case "write":
      await writeSkill(args.slice(1));
      return;
    default:
      throw new Error(`[vextjs] Unknown vext mcp skill command: ${command}`);
  }
}

function printMcpSkillHelp(): void {
  console.log(`
  Usage: vext mcp skill <check|print|write> [options]

  Commands:
    check                 Print the bundled Skill manifest as JSON
    print                 Print the bundled Skill Markdown
    write --output <file> Write the bundled Skill to a user-selected file

  Options:
    --output <file>       Target path for "write"
    --force               Replace an existing different file for "write"
    -h, --help            Show this help message

  Notes:
    These commands only inspect or export the bundled Skill. They do not modify
    host MCP configuration or install files into a host-specific global path.
`);
}

function printSkillManifest(): void {
  console.log(
    JSON.stringify(
      {
        status: "ok",
        skill: getVextMcpSkillManifest(),
        hostNativeInstall: "not-managed-by-this-command",
      },
      null,
      2,
    ),
  );
}

async function writeSkill(args: string[]): Promise<void> {
  let outputPath: string | undefined;
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case "--output": {
        const value = args[index + 1];
        if (!value || value.startsWith("-")) {
          throw new Error(
            "[vextjs] vext mcp skill write --output requires a file path.",
          );
        }
        outputPath = path.resolve(value);
        index += 1;
        break;
      }
      case "--force":
        force = true;
        break;
      default:
        throw new Error(
          `[vextjs] Unknown vext mcp skill write argument: ${arg}`,
        );
    }
  }
  if (!outputPath) {
    throw new Error("[vextjs] vext mcp skill write requires --output <file>.");
  }

  const content = `${VEXT_MCP_SKILL_CONTENT.trimEnd()}\n`;
  try {
    const existing = await readFile(outputPath, "utf8");
    if (existing === content) {
      printSkillWriteResult(outputPath, "up-to-date");
      return;
    }
    if (!force) {
      throw new Error(
        "[vextjs] Skill file already exists with different content. Re-run with --force to replace it.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
  printSkillWriteResult(outputPath, "written");
}

function printSkillWriteResult(
  outputPath: string,
  status: "written" | "up-to-date",
) {
  console.log(
    JSON.stringify(
      {
        status,
        path: outputPath,
        skill: getVextMcpSkillManifest(),
      },
      null,
      2,
    ),
  );
}

function readFrameworkVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

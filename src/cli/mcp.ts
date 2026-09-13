import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getVextMcpSkillManifest,
  VEXT_MCP_SKILL_CONTENT,
} from "../assistant/skill.js";
import { parseMcpCliArgs, serveVextMcpStdio } from "../mcp/server.js";

export async function mcpCommand(args: string[] = []): Promise<void> {
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
         vext mcp skill <check|print|write> [options]

  Options:
    --root <dir>          Bind MCP server to a Vext project root (defaults to cwd)
    -h, --help            Show this help message

  Notes:
    vext mcp starts a stdio MCP server. It does not execute project scripts,
    start dev servers, apply changes, or modify host MCP configuration.

  Skill:
    vext mcp skill check
    vext mcp skill print
    vext mcp skill write --output .vext/skills/vextjs-official-mcp/SKILL.md
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

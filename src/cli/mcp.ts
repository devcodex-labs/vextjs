import { parseMcpCliArgs, serveVextMcpStdio } from "../mcp/server.js";

export async function mcpCommand(args: string[] = []): Promise<void> {
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

  Options:
    --root <dir>          Bind MCP server to a Vext project root (defaults to cwd)
    -h, --help            Show this help message

  Notes:
    vext mcp starts a stdio MCP server. It does not execute project scripts,
    start dev servers, apply changes, or modify host MCP configuration.
`);
}

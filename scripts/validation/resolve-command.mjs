import { statSync } from "node:fs";
import path from "node:path";

function isFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// Windows cannot spawn npm.cmd without a shell. Invoke npm's JS entry with
// the selected Node instead, retaining argument boundaries and matrix identity.
export function resolveValidationCommand(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || !["npm", "npm.cmd"].includes(command)) {
    return { command, args };
  }
  const node = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;
  const fileExists = options.isFile ?? isFile;
  const candidates = [
    env.npm_execpath,
    path.win32.join(
      path.win32.dirname(node),
      "node_modules/npm/bin/npm-cli.js",
    ),
  ];
  const cli = candidates.find(
    (candidate) =>
      typeof candidate === "string" &&
      path.win32.isAbsolute(candidate) &&
      path.win32.basename(candidate) === "npm-cli.js" &&
      fileExists(candidate),
  );
  if (!cli) {
    throw new Error(
      "Cannot locate npm-cli.js for the selected Windows Node; run via npm or use a Node installation with bundled npm",
    );
  }
  return { command: node, args: [cli, ...args] };
}

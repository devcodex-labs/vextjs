import { statSync } from "node:fs";
import path from "node:path";

function isFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// Windows cannot spawn package-manager .cmd shims without a shell. Prefer
// the manager's JS entry with the selected Node, preserving each argument.
export function resolveValidationCommand(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (
    platform !== "win32" ||
    !["npm", "npm.cmd", "pnpm", "pnpm.cmd"].includes(command)
  ) {
    return { command, args };
  }
  const node = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;
  const fileExists = options.isFile ?? isFile;
  const manager = command.replace(/\.cmd$/, "");
  const entry = manager === "npm" ? "npm-cli.js" : "pnpm.cjs";
  const searchPath = (env.PATH ?? env.Path ?? "")
    .split(";")
    .filter((directory) => path.win32.isAbsolute(directory));
  const candidates = [
    env.npm_execpath,
    path.win32.join(
      path.win32.dirname(node),
      `node_modules/${manager}/bin/${entry}`,
    ),
    ...searchPath.map((directory) =>
      path.win32.join(directory, `node_modules/${manager}/bin/${entry}`),
    ),
  ];
  const cli = candidates.find(
    (candidate) =>
      typeof candidate === "string" &&
      path.win32.isAbsolute(candidate) &&
      path.win32.basename(candidate) === entry &&
      fileExists(candidate),
  );
  if (!cli) {
    // Native manager launchers (including Volta and pnpm standalone) do not
    // need a shell. Never execute a .cmd file through string interpolation.
    const executable = searchPath
      .map((directory) => path.win32.join(directory, `${manager}.exe`))
      .find(fileExists);
    if (executable) return { command: executable, args };
    throw new Error(
      `Cannot locate ${entry} or a native ${manager} launcher for the selected Windows Node`,
    );
  }
  return { command: node, args: [cli, ...args] };
}

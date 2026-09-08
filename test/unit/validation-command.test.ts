import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveValidationCommand } from "../../scripts/validation/resolve-command.mjs";
import { derivePortableConsumerCwd } from "../../scripts/validation/run-external-consumer-cell.mjs";

describe("validation command invocation", () => {
  const node = "C:\\Program Files\\nodejs\\node.exe";
  const cli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const options = {
    platform: "win32",
    execPath: node,
    env: {},
    isFile: (value: string) => value === cli,
  };

  it("uses the selected Node and preserves each npm argument without a shell", () => {
    const args = [
      "pack",
      "--pack-destination",
      "C:\\candidate & evidence\\new generation",
    ];
    expect(resolveValidationCommand("npm.cmd", args, options)).toEqual({
      command: node,
      args: [cli, ...args],
    });
    expect(args).toHaveLength(3);
  });

  it("uses an explicit npm JS entry when invoked through npm", () => {
    const npm = "D:\\npm\\bin\\npm-cli.js";
    expect(
      resolveValidationCommand("npm", ["--version"], {
        ...options,
        env: { npm_execpath: npm },
        isFile: (value: string) => value === npm,
      }),
    ).toEqual({ command: node, args: [npm, "--version"] });
  });

  it("ignores non-npm script and relative environment entries", () => {
    for (const npm_execpath of ["npm-cli.js", "C:\\other\\pnpm.cjs"]) {
      expect(
        resolveValidationCommand("npm.cmd", [], {
          ...options,
          env: { npm_execpath },
        }),
      ).toEqual({ command: node, args: [cli] });
    }
  });

  it("fails explicitly if npm cannot be found", () => {
    expect(() =>
      resolveValidationCommand("npm.cmd", [], {
        ...options,
        isFile: () => false,
      }),
    ).toThrow("Cannot locate npm-cli.js");
  });

  it("does not change Linux npm or native commands", () => {
    expect(
      resolveValidationCommand("npm", ["--version"], { platform: "linux" }),
    ).toEqual({ command: "npm", args: ["--version"] });
    expect(resolveValidationCommand("git", ["status"], options)).toEqual({
      command: "git",
      args: ["status"],
    });
  });

  it("can actually launch the installed npm without a shell", () => {
    const invocation = resolveValidationCommand("npm", ["--version"]);
    const result = spawnSync(invocation.command, invocation.args, {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("derives the recorded consumer cwd from the actual workspace path", () => {
    const workspace = path.resolve("fixture-workspace");
    expect(
      derivePortableConsumerCwd(
        workspace,
        path.join(workspace, "external-consumer"),
      ),
    ).toBe("external-consumer");
    expect(() =>
      derivePortableConsumerCwd(
        workspace,
        path.resolve(workspace, "..", "outside-consumer"),
      ),
    ).toThrow("must be a portable relative path");
  });
});

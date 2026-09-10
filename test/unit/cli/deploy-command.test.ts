import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deployCommand,
  parseDeployAssetsArgs,
} from "../../../src/cli/deploy.js";

describe("deploy assets command", () => {
  function expectDeployArgsToFail(args: string[], expectedError: string): void {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    try {
      expect(() => parseDeployAssetsArgs(args)).toThrow(
        expectedError.trimEnd(),
      );
      expect(error).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes upload key prefix from CLI options", () => {
    const options = parseDeployAssetsArgs(["--prefix", "/cdn/v1/"]);

    expect(options.prefix).toBe("cdn/v1");
  });

  it("parses --config for frontend deploy settings", () => {
    const options = parseDeployAssetsArgs(["--config", "sg-sit"]);

    expect(options.configProfile).toBe("sg-sit");
  });

  it("rejects duplicate --config options", () => {
    expectDeployArgsToFail(
      ["--config", "one", "--config", "two"],
      "[vextjs] --config may only be specified once",
    );
  });

  it.each([
    ["--outdir", "<path>"],
    ["--manifest", "<path>"],
    ["--config", "<name>"],
    ["--adapter", "<name>"],
    ["--target-dir", "<path>"],
    ["--prefix", "<path>"],
    ["--state-file", "<path>"],
  ])("%s 缺少值时应失败", (option, valueLabel) => {
    expectDeployArgsToFail(
      [option],
      `[vextjs] Option "${option}" requires a value: ${valueLabel}`,
    );
  });

  it.each([
    ["--manifest", "<path>"],
    ["--adapter", "<name>"],
    ["--target-dir", "<path>"],
    ["--prefix", "<path>"],
    ["--state-file", "<path>"],
  ])("%s 后跟另一个 flag 时应失败", (option, valueLabel) => {
    expectDeployArgsToFail(
      [option, "--dry-run"],
      `[vextjs] Option "${option}" requires a value: ${valueLabel}; received option-like value "--dry-run"`,
    );
  });

  it("未知位置参数应失败", () => {
    expectDeployArgsToFail(["extra"], '[vextjs] Unknown argument: "extra"\n');
  });

  it("dry-run 后的未知位置参数也应失败", () => {
    expectDeployArgsToFail(
      ["--dry-run", "extra"],
      '[vextjs] Unknown argument: "extra"\n',
    );
  });

  it("rejects unsafe upload key prefix from CLI options", () => {
    expect(() => parseDeployAssetsArgs(["--prefix", "../outside"])).toThrow(
      "[vextjs] --prefix must not contain '..'.",
    );
  });

  it.each([
    ["unknown", "--json"],
    ["assets", "--manifest", "--json"],
    ["assets", "--unknown", "--json"],
    ["assets", "extra", "--json"],
    ["assets", "--config", "one", "--config", "two", "--json"],
    ["assets", "--config", "../outside", "--json"],
  ])(
    "prints one JSON result for invalid command arguments: %j",
    async (...args) => {
      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(process, "exit").mockImplementation(((code) => {
        throw new Error(`process.exit(${code})`);
      }) as typeof process.exit);
      await expect(deployCommand(args)).rejects.toThrow("process.exit(1)");
      expect(stdout).toHaveBeenCalledTimes(1);
      expect(JSON.parse(stdout.mock.calls[0]![0])).toMatchObject({
        ok: false,
        error: expect.any(String),
      });
      expect(stderr).not.toHaveBeenCalled();
    },
  );
});

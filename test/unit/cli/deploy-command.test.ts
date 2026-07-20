import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDeployAssetsArgs } from "../../../src/cli/deploy.js";

describe("deploy assets command", () => {
  function expectDeployArgsToExit(args: string[], expectedError: string): void {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    try {
      expect(() => parseDeployAssetsArgs(args)).toThrow("process.exit(1)");
      expect(error).toHaveBeenCalledWith(expectedError);
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
    expectDeployArgsToExit(
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
    expectDeployArgsToExit(
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
    expectDeployArgsToExit(
      [option, "--dry-run"],
      `[vextjs] Option "${option}" requires a value: ${valueLabel}; received option-like value "--dry-run"`,
    );
  });

  it("未知位置参数应失败", () => {
    expectDeployArgsToExit(["extra"], '[vextjs] Unknown argument: "extra"\n');
  });

  it("dry-run 后的未知位置参数也应失败", () => {
    expectDeployArgsToExit(
      ["--dry-run", "extra"],
      '[vextjs] Unknown argument: "extra"\n',
    );
  });

  it("rejects unsafe upload key prefix from CLI options", () => {
    expect(() => parseDeployAssetsArgs(["--prefix", "../outside"])).toThrow(
      "[vextjs] --prefix must not contain '..'.",
    );
  });
});

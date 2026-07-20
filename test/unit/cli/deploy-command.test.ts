import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDeployAssetsArgs } from "../../../src/cli/deploy.js";

describe("deploy assets command", () => {
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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    expect(() =>
      parseDeployAssetsArgs(["--config", "one", "--config", "two"]),
    ).toThrow("process.exit(1)");
    expect(error).toHaveBeenCalledWith(
      "[vextjs] --config may only be specified once",
    );
  });

  it("rejects unsafe upload key prefix from CLI options", () => {
    expect(() => parseDeployAssetsArgs(["--prefix", "../outside"])).toThrow(
      "[vextjs] --prefix must not contain '..'.",
    );
  });
});

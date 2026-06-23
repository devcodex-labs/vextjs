import { describe, expect, it } from "vitest";
import { parseDeployAssetsArgs } from "../../../src/cli/deploy.js";

describe("deploy assets command", () => {
  it("normalizes upload key prefix from CLI options", () => {
    const options = parseDeployAssetsArgs(["--prefix", "/cdn/v1/"]);

    expect(options.prefix).toBe("cdn/v1");
  });

  it("parses --config for frontend deploy settings", () => {
    const options = parseDeployAssetsArgs(["--config", "sg-sit"]);

    expect(options.configProfile).toBe("sg-sit");
  });

  it("rejects unsafe upload key prefix from CLI options", () => {
    expect(() => parseDeployAssetsArgs(["--prefix", "../outside"])).toThrow(
      "[vextjs] --prefix must not contain '..'.",
    );
  });
});

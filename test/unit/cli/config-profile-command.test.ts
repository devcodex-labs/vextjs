import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDevArgs } from "../../../src/cli/dev.js";
import { parseStartArgs } from "../../../src/cli/start.js";

describe("CLI config profile options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses vext start --config", () => {
    const options = parseStartArgs(["--config", "sg-sit"]);

    expect(options.configProfile).toBe("sg-sit");
  });

  it("rejects vext start --config without a value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    expect(() => parseStartArgs(["--config"])).toThrow("process.exit(1)");
    expect(error).toHaveBeenCalledWith("[vextjs] --config requires a value");
  });

  it("parses vext dev --config", () => {
    const options = parseDevArgs(["--config", "sg-sit"]);

    expect(options.configProfile).toBe("sg-sit");
  });

  it("rejects vext dev --config without a value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    expect(() => parseDevArgs(["--config"])).toThrow("process.exit(1)");
    expect(error).toHaveBeenCalledWith("[vextjs] --config requires a value");
  });
});

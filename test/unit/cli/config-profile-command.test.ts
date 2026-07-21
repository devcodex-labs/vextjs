import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDevArgs } from "../../../src/cli/dev.js";
import { parseStartArgs } from "../../../src/cli/start.js";

describe("CLI config profile options", () => {
  function expectCliArgsToExit(fn: () => unknown, expectedError: string): void {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    try {
      expect(fn).toThrow("process.exit(1)");
      expect(error).toHaveBeenCalledWith(expectedError);
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses vext start --config", () => {
    const options = parseStartArgs(["--config", "sg-sit"]);

    expect(options.configProfile).toBe("sg-sit");
  });

  it("rejects vext start --config without a value", () => {
    expectCliArgsToExit(
      () => parseStartArgs(["--config"]),
      '[vextjs] Option "--config" requires a value: <name>',
    );
  });

  it("rejects vext start --startup-profile-json with a following flag", () => {
    expectCliArgsToExit(
      () => parseStartArgs(["--startup-profile-json", "--port", "3000"]),
      '[vextjs] Option "--startup-profile-json" requires a value: <path>; received option-like value "--port"',
    );
  });

  it("rejects vext start unknown positional arguments", () => {
    expectCliArgsToExit(
      () => parseStartArgs(["extra"]),
      '[vextjs] Unknown argument: "extra"\n',
    );
  });

  it("rejects duplicate vext start --config options", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    expect(() =>
      parseStartArgs(["--config", "one", "--config", "two"]),
    ).toThrow("process.exit(1)");
    expect(error).toHaveBeenCalledWith(
      "[vextjs] --config may only be specified once",
    );
  });

  it("parses vext dev --config", () => {
    const options = parseDevArgs(["--config", "sg-sit"]);

    expect(options.configProfile).toBe("sg-sit");
  });

  it("rejects vext dev --config without a value", () => {
    expectCliArgsToExit(
      () => parseDevArgs(["--config"]),
      '[vextjs] Option "--config" requires a value: <name>',
    );
  });

  it.each([
    ["--root", "<path>"],
    ["--port", "<number>"],
    ["--host", "<string>"],
    ["--poll-interval", "<ms>"],
    ["--debounce", "<ms>"],
    ["--startup-profile-json", "<path>"],
    ["--port-conflict", "<error|prompt|kill|next>"],
  ])("rejects vext dev %s without a value", (option, valueLabel) => {
    expectCliArgsToExit(
      () => parseDevArgs([option]),
      `[vextjs] Option "${option}" requires a value: ${valueLabel}`,
    );
  });

  it.each([
    ["--root", "<path>"],
    ["--port", "<number>"],
    ["--host", "<string>"],
    ["--poll-interval", "<ms>"],
    ["--debounce", "<ms>"],
    ["--startup-profile-json", "<path>"],
    ["--port-conflict", "<error|prompt|kill|next>"],
  ])("rejects vext dev %s followed by another flag", (option, valueLabel) => {
    expectCliArgsToExit(
      () => parseDevArgs([option, "--poll"]),
      `[vextjs] Option "${option}" requires a value: ${valueLabel}; received option-like value "--poll"`,
    );
  });

  it("rejects vext dev unknown positional arguments", () => {
    expectCliArgsToExit(
      () => parseDevArgs(["extra"]),
      '[vextjs] Unknown argument: "extra"\n',
    );
  });

  it.each([
    [["--port", "3000x"], '[vextjs] Invalid port number value: "3000x"'],
    [
      ["--poll-interval", "2000x"],
      '[vextjs] Invalid --poll-interval value: "2000x"',
    ],
    [["--debounce", "50x"], '[vextjs] Invalid --debounce value: "50x"'],
  ])("rejects malformed vext dev numeric arguments", (args, expectedError) => {
    expectCliArgsToExit(() => parseDevArgs(args), expectedError);
  });

  it("rejects malformed VEXT_DEV_DEBOUNCE values", () => {
    process.env.VEXT_DEV_DEBOUNCE = "50x";

    try {
      expectCliArgsToExit(
        () => parseDevArgs([]),
        '[vextjs] Invalid VEXT_DEV_DEBOUNCE value: "50x"',
      );
    } finally {
      delete process.env.VEXT_DEV_DEBOUNCE;
    }
  });

  it("rejects duplicate vext dev --config options", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    expect(() => parseDevArgs(["--config", "one", "--config", "two"])).toThrow(
      "process.exit(1)",
    );
    expect(error).toHaveBeenCalledWith(
      "[vextjs] --config may only be specified once",
    );
  });
});

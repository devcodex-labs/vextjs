import { afterEach, describe, expect, it, vi } from "vitest";
import { sendLifecycleLevelToParent } from "../../src/lib/ipc-port-conflict.js";

describe("ipc-port-conflict lifecycle IPC", () => {
  const originalSend = process.send;
  const originalVextMode = process.env.VEXT_MODE;

  afterEach(() => {
    Object.defineProperty(process, "send", {
      value: originalSend,
      configurable: true,
      writable: true,
    });

    if (originalVextMode === undefined) {
      delete process.env.VEXT_MODE;
    } else {
      process.env.VEXT_MODE = originalVextMode;
    }

    vi.restoreAllMocks();
  });

  it("does not send lifecycle config from non-vext child processes", () => {
    const send = vi.fn();
    Object.defineProperty(process, "send", {
      value: send,
      configurable: true,
      writable: true,
    });
    delete process.env.VEXT_MODE;

    sendLifecycleLevelToParent("concise");

    expect(send).not.toHaveBeenCalled();
  });

  it("sends lifecycle config from vext dev child process", () => {
    const send = vi.fn();
    Object.defineProperty(process, "send", {
      value: send,
      configurable: true,
      writable: true,
    });
    process.env.VEXT_MODE = "dev";

    sendLifecycleLevelToParent("verbose");

    expect(send).toHaveBeenCalledWith({
      type: "lifecycle-config",
      level: "verbose",
    });
  });
});


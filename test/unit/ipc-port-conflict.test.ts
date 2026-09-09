import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestPortConflictDecisionFromParent,
  sendLifecycleLevelToParent,
} from "../../src/lib/ipc-port-conflict.js";

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

    expect(send).toHaveBeenCalledWith(
      {
        type: "lifecycle-config",
        level: "verbose",
      },
      expect.any(Function),
    );
  });

  it("rejects transport errors immediately and removes prompt listeners", async () => {
    const before = process.listenerCount("message");
    const beforeDisconnect = process.listenerCount("disconnect");
    process.send = vi.fn((_message, callback) => {
      (callback as (error: Error) => void)(new Error("send failed"));
      return false;
    }) as typeof process.send;
    await expect(
      requestPortConflictDecisionFromParent({
        port: 3000,
        details: { occupied: true },
      }),
    ).rejects.toThrow("send failed");
    expect(process.listenerCount("message")).toBe(before);
    expect(process.listenerCount("disconnect")).toBe(beforeDisconnect);
  });

  it("disconnect and timeout both remove prompt listeners", async () => {
    for (const disconnected of [true, false]) {
      const before = process.listeners("disconnect");
      const messages = process.listenerCount("message");
      process.send = vi.fn((_message, callback) => {
        (callback as () => void)();
        return true;
      }) as typeof process.send;
      const pending = requestPortConflictDecisionFromParent(
        { port: 3000, details: { occupied: true } },
        10,
      );
      const rejected = expect(pending).rejects.toThrow(
        disconnected ? "disconnected" : "Timed out",
      );
      if (disconnected) {
        const listener = process
          .listeners("disconnect")
          .find((entry) => !before.includes(entry));
        expect(listener).toBeDefined();
        listener!.call(process);
      }
      await rejected;
      expect(process.listenerCount("message")).toBe(messages);
      expect(process.listeners("disconnect")).toEqual(before);
    }
  });
});

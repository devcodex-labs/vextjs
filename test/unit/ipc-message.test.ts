import { describe, expect, it, vi } from "vitest";
import { sendMessageToParent } from "../../src/lib/ipc-message.js";

describe("IPC send completion", () => {
  it("does not turn a queued send into completion", async () => {
    const original = process.send;
    let callback!: (error: Error | null) => void;
    process.send = vi.fn((_message, complete) => {
      callback = complete as typeof callback;
      return false;
    }) as typeof process.send;
    let delivered = false;
    let pending: Promise<void>;
    try {
      pending = sendMessageToParent({ type: "probe" }).then(() => {
        delivered = true;
      });
    } finally {
      process.send = original;
    }
    await Promise.resolve();
    expect(delivered).toBe(false);
    callback(null);
    await pending;
    expect(delivered).toBe(true);
  });

  it("rejects absent parents, synchronous throws and callback errors", async () => {
    const original = process.send;
    const senders = [
      undefined,
      vi.fn(() => {
        throw new Error("synchronous");
      }),
      vi.fn((_message, complete) => {
        (complete as (error: Error) => void)(new Error("callback"));
        return false;
      }),
    ];
    for (const [index, send] of senders.entries()) {
      let pending: Promise<void>;
      try {
        process.send = send as typeof process.send;
        pending = sendMessageToParent({ type: "probe" });
      } finally {
        process.send = original;
      }
      await expect(pending).rejects.toThrow(
        ["disconnected", "synchronous", "callback"][index],
      );
    }
  });
});

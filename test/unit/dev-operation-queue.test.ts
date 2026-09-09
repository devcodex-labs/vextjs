import { describe, expect, it } from "vitest";
import { DevOperationQueue } from "../../src/lib/dev/operation-queue.js";

describe("dev operation queue", () => {
  it("serializes work and a failed operation cannot drop the next one", async () => {
    const queue = new DevOperationQueue();
    const order: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run(async () => {
      order.push("first");
      await held;
      throw new Error("first failed");
    });
    const failed = first.catch((error) => (error as Error).message);
    const second = queue.run(async () => {
      order.push("second");
      return 2;
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    release();
    expect(await failed).toBe("first failed");
    expect(await second).toBe(2);
    expect(order).toEqual(["first", "second"]);
    await queue.close();
  });

  it("close cancels pending work and waits for the active cleanup", async () => {
    const queue = new DevOperationQueue();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cleaned = false;
    const first = queue
      .run(async (signal) => {
        try {
          await held;
          signal.throwIfAborted();
        } finally {
          cleaned = true;
        }
      })
      .catch(() => "canceled");
    let secondRan = false;
    const second = queue
      .run(async () => {
        secondRan = true;
      })
      .catch(() => "canceled");
    await Promise.resolve();
    let closed = false;
    const closing = queue.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(queue.run(async () => {})).rejects.toThrow("shutdown");
    release();
    await closing;
    expect(await first).toBe("canceled");
    expect(await second).toBe("canceled");
    expect(secondRan).toBe(false);
    expect(cleaned).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createHookManager } from "../../../src/lib/hooks.js";

function createLogger() {
  return {
    error: vi.fn(),
  };
}

describe("createHookManager", () => {
  it("registers, emits, and unregisters handlers", async () => {
    const hooks = createHookManager();
    const handler = vi.fn();
    const off = hooks.on("request:start", handler);

    await hooks.emit("request:start", {
      req: {} as any,
      requestId: "req-1",
      method: "GET",
      path: "/users",
      matched: true,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(hooks.has("request:start")).toBe(true);

    off();
    expect(hooks.has("request:start")).toBe(false);
  });

  it("safe emit logs handler errors and continues", async () => {
    const logger = createLogger();
    const hooks = createHookManager(logger as any);
    const after = vi.fn();

    hooks.on("app:ready", () => {
      throw new Error("broken hook");
    });
    hooks.on("app:ready", after);

    await hooks.emitSafe("app:ready", {
      app: {} as any,
      phase: "after",
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("sync emit rejects async handlers at synchronous lifecycle points", () => {
    const hooks = createHookManager();
    hooks.on("response:before", async () => ({ status: 201 }));

    expect(() =>
      hooks.emitSync("response:before", {
        kind: "json",
        data: { ok: true },
        status: 200,
        headers: {},
        wrapped: false,
        requestId: "req-1",
      }),
    ).toThrow(/must be synchronous/);
  });

  it("returns the latest non-undefined sync patch", () => {
    const hooks = createHookManager();
    hooks.on("response:before", () => ({ status: 201 }));
    hooks.on("response:before", () => undefined);
    hooks.on("response:before", () => ({ headers: { "x-hook": "yes" } }));

    const patch = hooks.emitSync("response:before", {
      kind: "json",
      data: { ok: true },
      status: 200,
      headers: {},
      wrapped: false,
      requestId: "req-1",
    });

    expect(patch).toEqual({ headers: { "x-hook": "yes" } });
  });
});

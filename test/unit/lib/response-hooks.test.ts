import { describe, expect, it, vi } from "vitest";
import { createHookManager } from "../../../src/lib/hooks.js";
import {
  beginResponseSend,
  finishResponseSend,
} from "../../../src/lib/response-hooks.js";
import type { VextResponse } from "../../../src/types/response.js";

describe("response hook lifecycle helpers", () => {
  it("runs the internal all-response hook before public response hooks", () => {
    const hooks = createHookManager();
    const order: string[] = [];
    hooks.on("response:before", ({ headers }) => {
      order.push("public");
      expect(headers["set-cookie"]).toBe("sid=1");
    });
    const res = {
      _hooks: hooks,
      _onBeforeSend(_kind, _data, _status, headers) {
        order.push("internal");
        headers["set-cookie"] = "sid=1";
      },
    } as VextResponse;

    const state = beginResponseSend(res, {
      kind: "stream",
      status: 200,
      headers: {},
      wrapped: false,
      requestId: "req-1",
    });

    expect(order).toEqual(["internal", "public"]);
    expect(state.headers["set-cookie"]).toBe("sid=1");
  });

  it("applies response:before patch and emits response:after", () => {
    const hooks = createHookManager();
    const after = vi.fn();
    hooks.on("response:before", () => ({
      data: { ok: false, patched: true },
      status: 202,
      headers: { "x-hook": "yes" },
    }));
    hooks.on("response:after", after);
    const res = { _hooks: hooks } as VextResponse;

    const state = beginResponseSend(res, {
      kind: "json",
      data: { ok: true },
      status: 200,
      headers: { "content-type": "application/json" },
      wrapped: false,
      requestId: "req-1",
    });
    finishResponseSend(res, state);

    expect(state).toEqual(
      expect.objectContaining({
        kind: "json",
        data: { ok: false, patched: true },
        status: 202,
        headers: {
          "content-type": "application/json",
          "x-hook": "yes",
        },
        requestId: "req-1",
      }),
    );
    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "json",
        status: 202,
        headers: {
          "content-type": "application/json",
          "x-hook": "yes",
        },
        requestId: "req-1",
        durationMs: expect.any(Number),
      }),
    );
  });
});

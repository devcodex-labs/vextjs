import { EventEmitter } from "node:events";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createHookManager } from "../../../src/lib/hooks.js";
import {
  beginResponseSend,
  finishResponseSend,
  finishResponseSendAfterStreamSettlement,
  waitForResponseSend,
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

  it("emits response:after after stream target settlement", async () => {
    const hooks = createHookManager();
    const after = vi.fn();
    hooks.on("response:after", after);
    const res = { _hooks: hooks } as VextResponse;
    const readable = new EventEmitter() as NodeJS.ReadableStream;
    const target = new EventEmitter();

    const state = beginResponseSend(res, {
      kind: "stream",
      status: 200,
      headers: {},
      wrapped: false,
      requestId: "req-1",
    });
    finishResponseSendAfterStreamSettlement(res, state, readable, target);

    await Promise.resolve();
    expect(after).not.toHaveBeenCalled();

    target.emit("finish");
    await waitForResponseSend(res);

    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stream",
        status: 200,
        requestId: "req-1",
      }),
    );
  });

  it("settles stream response hooks and closes the target on readable error", async () => {
    const hooks = createHookManager();
    const after = vi.fn();
    hooks.on("response:after", after);
    const res = { _hooks: hooks } as VextResponse;
    const readable = new EventEmitter() as NodeJS.ReadableStream;
    const target = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      destroyed: false,
      writableEnded: false,
    });

    const state = beginResponseSend(res, {
      kind: "download",
      status: 200,
      headers: {},
      wrapped: false,
      requestId: "req-1",
    });
    const error = new Error("stream failed");
    finishResponseSendAfterStreamSettlement(res, state, readable, target);
    readable.emit("error", error);
    await waitForResponseSend(res);

    expect(target.destroy).toHaveBeenCalledWith();
    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "download",
        status: 200,
        requestId: "req-1",
      }),
    );
  });

  it("does not forward readable errors into assigned response sockets", async () => {
    const hooks = createHookManager();
    const after = vi.fn();
    hooks.on("response:after", after);
    const res = { _hooks: hooks } as VextResponse;
    const readable = new EventEmitter() as NodeJS.ReadableStream;
    const reqSocket = new Socket();
    const mockReq = Object.assign(Readable.from(Buffer.alloc(0)), {
      method: "GET",
      url: "/stream/error",
      headers: {},
      socket: reqSocket,
    }) as IncomingMessage;
    const serverResponse = new ServerResponse(mockReq);
    const resSocket = new PassThrough() as unknown as Socket;
    const socketError = vi.fn();

    resSocket.on("error", socketError);
    resSocket.resume();
    serverResponse.assignSocket(resSocket);

    const state = beginResponseSend(res, {
      kind: "stream",
      status: 200,
      headers: {},
      wrapped: false,
      requestId: "req-1",
    });
    finishResponseSendAfterStreamSettlement(
      res,
      state,
      readable,
      serverResponse,
    );

    readable.emit("error", new Error("stream failed"));
    await waitForResponseSend(res);

    expect(socketError).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stream",
        status: 200,
        requestId: "req-1",
      }),
    );

    reqSocket.destroy();
    resSocket.destroy();
  });
});

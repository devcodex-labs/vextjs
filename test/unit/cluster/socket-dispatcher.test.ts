import net from "node:net";
import type { Worker } from "node:cluster";
import { expect, it, vi } from "vitest";
import { SocketDispatcher } from "../../../src/lib/cluster/socket-dispatcher.js";

it("cancels uncommitted offers when a Worker stops and ignores its late prepare", async () => {
  let offered!: (message: any) => void;
  const offer = new Promise<any>((resolve) => {
    offered = resolve;
  });
  const send = vi.fn((message, ...args) => {
    if (message.type === "socket-offer") offered(message);
    const callback = args.at(-1);
    if (typeof callback === "function") callback(null);
    return true;
  });
  const worker = {
    id: 1,
    process: { killed: false },
    isConnected: () => true,
    send,
  } as unknown as Worker;
  const unresponsive = vi.fn();
  const dispatcher = new SocketDispatcher(
    () => [{ slot: 0, generation: "one", worker }],
    unresponsive,
  );
  const endpoint = await dispatcher.listen(0, "127.0.0.1");
  dispatcher.open();
  const socket = net.connect(endpoint.port, endpoint.host);
  socket.on("error", () => {});
  try {
    const message = await offer;
    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    dispatcher.workerStopping(worker.id);
    await closed;
    dispatcher.prepared(worker, {
      ...message,
      type: "socket-prepared",
      accepted: true,
    });
    expect(dispatcher.snapshot()).toMatchObject({
      pending: 0,
      rejected: 1,
      committed: 0,
      timedOut: 0,
    });
    expect(send.mock.calls.map(([sent]) => sent.type)).toEqual([
      "socket-offer",
      "socket-cancel",
    ]);
    expect(unresponsive).not.toHaveBeenCalled();
  } finally {
    socket.destroy();
    dispatcher.beginShutdown();
  }
});

import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocketReceiver } from "../../../src/lib/cluster/socket-receiver.js";
import { SOCKET_HANDOFF_POLICY } from "../../../src/lib/cluster/connection-policy.js";

afterEach(() => vi.useRealTimers());
describe("paused socket ownership", () => {
  function setup() {
    const receiveSocket = vi.fn();
    const reply = vi.fn();
    const receiver = new SocketReceiver(
      "one",
      { host: "127.0.0.1", port: 80, close: async () => {}, receiveSocket },
      reply,
    );
    return { receiver, receiveSocket, reply };
  }
  const offer = {
    type: "socket-offer",
    generation: "one",
    transferId: "a",
  } as const;

  it("starts application processing only on commit, once", () => {
    const { receiver, receiveSocket, reply } = setup();
    const socket = new Socket();
    receiver.message(offer, socket);
    expect(reply).toHaveBeenCalledWith({
      ...offer,
      type: "socket-prepared",
      accepted: true,
    });
    expect(receiveSocket).not.toHaveBeenCalled();
    receiver.message({ ...offer, type: "socket-commit" });
    receiver.message({ ...offer, type: "socket-commit" });
    expect(receiveSocket).toHaveBeenCalledExactlyOnceWith(socket);
    socket.destroy();
    receiver.close();
  });

  it("expires offers independently of Master and ignores late commits", () => {
    vi.useFakeTimers();
    const { receiver, receiveSocket } = setup();
    const socket = new Socket();
    receiver.message(offer, socket);
    vi.advanceTimersByTime(SOCKET_HANDOFF_POLICY.timeout);
    expect(socket.destroyed).toBe(true);
    receiver.message({ ...offer, type: "socket-commit" });
    expect(receiveSocket).not.toHaveBeenCalled();
    receiver.close();
  });

  it("rejects old-generation offers and cancels pending offers on close", () => {
    const { receiver, receiveSocket } = setup();
    const invalid = new Socket();
    receiver.message({ ...offer, generation: "old" }, invalid);
    expect(invalid.destroyed).toBe(true);
    const socket = new Socket();
    receiver.message(offer, socket);
    receiver.close();
    expect(socket.destroyed).toBe(true);
    receiver.message({ ...offer, type: "socket-commit" });
    expect(receiveSocket).not.toHaveBeenCalled();
  });
});

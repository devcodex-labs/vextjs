import { Socket } from "node:net";
import type { VextServerHandle } from "../../types/adapter.js";
import { SOCKET_HANDOFF_POLICY } from "./connection-policy.js";
import type {
  MasterToWorkerMessage,
  SocketPreparedMessage,
} from "./ipc-types.js";

/** Worker owns paused offers until commit, with an independent bounded deadline. */
export class SocketReceiver {
  private readonly offers = new Map<
    string,
    { socket: Socket; deadline: number; timer: ReturnType<typeof setTimeout> }
  >();
  private closed = false;
  constructor(
    private readonly generation: string,
    private readonly handle: VextServerHandle,
    private readonly reply: (message: SocketPreparedMessage) => void,
  ) {}

  message(message: MasterToWorkerMessage, socket?: unknown): void {
    if (
      message.type !== "socket-offer" &&
      message.type !== "socket-commit" &&
      message.type !== "socket-cancel"
    )
      return;
    if (
      message.generation !== this.generation ||
      typeof message.transferId !== "string"
    ) {
      if (socket instanceof Socket) socket.destroy();
      return;
    }
    const id = message.transferId;
    if (message.type === "socket-offer") {
      const accepted =
        !this.closed &&
        socket instanceof Socket &&
        !socket.destroyed &&
        !!this.handle.receiveSocket &&
        !this.offers.has(id) &&
        this.offers.size < SOCKET_HANDOFF_POLICY.maxPendingPerWorker;
      if (accepted) {
        socket.pause();
        const timer = setTimeout(
          () => this.cancel(id),
          SOCKET_HANDOFF_POLICY.timeout,
        );
        timer.unref();
        this.offers.set(id, {
          socket,
          deadline: Date.now() + SOCKET_HANDOFF_POLICY.timeout,
          timer,
        });
        socket.once("close", () => {
          if (this.offers.get(id)?.socket === socket) this.remove(id);
        });
        socket.on("error", () => {});
      } else if (socket instanceof Socket) socket.destroy();
      try {
        this.reply({
          type: "socket-prepared",
          transferId: id,
          generation: this.generation,
          accepted,
        });
      } catch {
        this.cancel(id);
      }
    } else if (message.type === "socket-cancel") this.cancel(id);
    else {
      const offer = this.remove(id);
      if (!offer) return; // Expired/duplicate commit cannot resurrect an offer.
      if (this.closed || Date.now() >= offer.deadline) {
        offer.socket.destroy();
        return;
      }
      try {
        this.handle.receiveSocket!(offer.socket);
      } catch {
        offer.socket.destroy();
      }
    }
  }

  close(): void {
    this.closed = true;
    for (const id of this.offers.keys()) this.cancel(id);
  }
  private cancel(id: string): void {
    this.remove(id)?.socket.destroy();
  }
  private remove(id: string) {
    const offer = this.offers.get(id);
    if (offer) {
      clearTimeout(offer.timer);
      this.offers.delete(id);
    }
    return offer;
  }
}

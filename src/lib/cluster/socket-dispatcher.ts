import { createServer, type Server, type Socket } from "node:net";
import type { Worker } from "node:cluster";
import { randomUUID } from "node:crypto";
import { selectAffinitySlot } from "./affinity-router.js";
import { SOCKET_HANDOFF_POLICY } from "./connection-policy.js";
import type { SocketPreparedMessage } from "./ipc-types.js";

export interface SocketTarget {
  slot: number;
  generation: string;
  worker: Worker;
}
interface Transfer {
  socket: Socket;
  target: SocketTarget;
  timer: ReturnType<typeof setTimeout>;
}

/** Accepts paused sockets; never reads HTTP or replays a handed-off connection. */
export class SocketDispatcher {
  private readonly server: Server;
  private readonly transfers = new Map<string, Transfer>();
  private readonly perWorker = new Map<number, number>();
  private readonly prefix = randomUUID();
  private sequence = 0;
  private accepting = false;
  private stopped = false;
  private endpoint?: { host: string; port: number };
  private readonly counters = {
    committed: 0,
    rejected: 0,
    timedOut: 0,
    sendFailed: 0,
    backpressure: 0,
  };

  constructor(
    private readonly targets: () => SocketTarget[],
    private readonly unresponsive: (worker: Worker) => void,
    onError?: (error: Error) => void,
  ) {
    this.server = createServer({ pauseOnConnect: true }, (socket) =>
      this.dispatch(socket),
    );
    // After successful binding, listener errors are observed by the host.
    this.server.on("error", (error) => {
      this.accepting = false;
      if (this.endpoint) onError?.(error);
    });
  }

  async listen(
    port: number,
    host: string,
  ): Promise<{ host: string; port: number }> {
    await new Promise<void>((resolve, reject) => {
      const error = (err: Error) => {
        this.server.off("listening", ready);
        reject(err);
      };
      const ready = () => {
        this.server.off("error", error);
        resolve();
      };
      this.server.once("error", error);
      this.server.once("listening", ready);
      this.server.listen(port, host);
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing TCP listener address");
    this.endpoint = { host: address.address, port: address.port };
    return this.endpoint;
  }

  open(): void {
    if (!this.stopped) this.accepting = true;
  }
  address(): { host: string; port: number } | undefined {
    return this.endpoint;
  }
  snapshot() {
    return { mode: "ip", pending: this.transfers.size, ...this.counters };
  }

  prepared(worker: Worker, message: SocketPreparedMessage): void {
    const transfer = this.transfers.get(message.transferId);
    if (
      !transfer ||
      transfer.target.worker.id !== worker.id ||
      transfer.target.generation !== message.generation
    )
      return;
    if (
      !message.accepted ||
      this.stopped ||
      !worker.isConnected() ||
      worker.process.killed
    ) {
      this.counters.rejected++;
      this.cancel(message.transferId);
      return;
    }
    try {
      worker.send(
        {
          type: "socket-commit",
          transferId: message.transferId,
          generation: message.generation,
        },
        (error: Error | null) => {
          if (!this.transfers.has(message.transferId)) return;
          if (error) {
            this.counters.sendFailed++;
            this.unresponsive(worker);
            this.cancel(message.transferId);
          } else {
            this.counters.committed++;
            this.finish(message.transferId);
          }
        },
      );
    } catch {
      this.counters.sendFailed++;
      this.unresponsive(worker);
      this.cancel(message.transferId);
    }
  }

  workerExited(workerId: number): void {
    for (const [id, transfer] of this.transfers) {
      if (transfer.target.worker.id === workerId) this.finish(id);
    }
  }

  workerStopping(workerId: number): void {
    for (const [id, transfer] of this.transfers) {
      if (transfer.target.worker.id === workerId) {
        this.counters.rejected++;
        this.cancel(id);
      }
    }
  }

  beginShutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.accepting = false;
    // Start close before Worker IPC disconnect; never await before draining Workers.
    this.server.close(() => {});
    for (const id of this.transfers.keys()) this.cancel(id);
  }

  private dispatch(socket: Socket): void {
    socket.on("error", () => {});
    const targets = this.targets();
    let selected: number | undefined;
    try {
      selected = socket.remoteAddress
        ? selectAffinitySlot(
            socket.remoteAddress,
            targets.map((t) => t.slot),
          )
        : undefined;
    } catch {
      /* Invalid/missing TCP address: reject rather than invent a shared key. */
    }
    const target = targets.find((t) => t.slot === selected);
    if (
      !this.accepting ||
      !target ||
      this.transfers.size >= SOCKET_HANDOFF_POLICY.maxPending ||
      (this.perWorker.get(target.worker.id) ?? 0) >=
        SOCKET_HANDOFF_POLICY.maxPendingPerWorker
    ) {
      this.counters.rejected++;
      socket.destroy();
      return;
    }
    const id = `${this.prefix}:${++this.sequence}`;
    const timer = setTimeout(() => {
      this.counters.timedOut++;
      // A stopped/event-loop-blocked Worker cannot run its own deadline. Exclude
      // and terminate it before releasing credits, so its IPC queue stays bounded.
      this.unresponsive(target.worker);
      this.cancel(id);
    }, SOCKET_HANDOFF_POLICY.timeout);
    timer.unref();
    this.transfers.set(id, { socket, target, timer });
    this.perWorker.set(
      target.worker.id,
      (this.perWorker.get(target.worker.id) ?? 0) + 1,
    );
    try {
      const available = target.worker.send(
        { type: "socket-offer", transferId: id, generation: target.generation },
        socket,
        { keepOpen: false },
        (error: Error | null) => {
          if (error && this.transfers.has(id)) {
            this.counters.sendFailed++;
            this.unresponsive(target.worker);
            this.cancel(id);
          }
        },
      );
      if (!available) this.counters.backpressure++;
    } catch {
      this.counters.sendFailed++;
      this.unresponsive(target.worker);
      this.cancel(id);
    }
  }

  private cancel(id: string): void {
    const transfer = this.transfers.get(id);
    if (!transfer) return;
    try {
      if (
        transfer.target.worker.isConnected() &&
        !transfer.target.worker.process.killed
      )
        transfer.target.worker.send(
          {
            type: "socket-cancel",
            transferId: id,
            generation: transfer.target.generation,
          },
          () => {},
        );
    } catch {
      /* Receiver's independent prepare deadline still destroys the socket. */
    }
    this.finish(id);
  }

  private finish(id: string): void {
    const transfer = this.transfers.get(id);
    if (!transfer) return;
    this.transfers.delete(id);
    clearTimeout(transfer.timer);
    transfer.socket.destroy();
    const count = (this.perWorker.get(transfer.target.worker.id) ?? 1) - 1;
    if (count) this.perWorker.set(transfer.target.worker.id, count);
    else this.perWorker.delete(transfer.target.worker.id);
  }
}

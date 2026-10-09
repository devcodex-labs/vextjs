import {
  Server,
  createServer,
  type RequestListener,
  type ServerOptions,
} from "node:http";
import { isIP, type AddressInfo, type Socket } from "node:net";
import type {
  VextAdapterRuntimeContext,
  VextServerHandle,
} from "../types/adapter.js";

/** Node HTTP parser/timeouts with a logical listener receiving IPC sockets. */
export class SocketHTTPServer extends Server {
  private opened = false;
  private draining = false;
  private closed = false;
  private readonly sockets = new Set<Socket>();
  private readonly callbacks: Array<(error?: Error) => void> = [];
  private finishing = false;
  private readonly endpoint: AddressInfo;

  constructor(
    options: ServerOptions,
    handler: RequestListener,
    endpoint: { host: string; port: number },
  ) {
    super(options, handler);
    this.endpoint = {
      address: endpoint.host,
      port: endpoint.port,
      family: isIP(endpoint.host) === 6 ? "IPv6" : "IPv4",
    };
    this.prependListener("request", (_request, response) => {
      response.once("finish", () => {
        if (this.draining) this.closeIdleConnections();
      });
    });
  }

  override listening = false;
  override address(): AddressInfo | null {
    return this.listening ? this.endpoint : null;
  }
  override listen(...args: unknown[]): this {
    if (this.opened || this.draining)
      throw new Error("Socket HTTP server cannot listen twice");
    this.opened = true;
    this.listening = true;
    const callback = args.at(-1);
    process.nextTick(() => {
      if (!this.listening) return; // An immediate close must not start HTTP timers.
      // Public lifecycle event initializes Node's HTTP connection tracker.
      this.emit("listening");
      if (typeof callback === "function") callback.call(this);
    });
    return this;
  }

  receiveSocket(socket: Socket): void {
    if (!this.listening || socket.destroyed) {
      socket.destroy();
      throw new Error("Socket HTTP receiver is closing");
    }
    this.sockets.add(socket);
    socket.once("close", () => {
      this.sockets.delete(socket);
      this.finishClose();
    });
    try {
      this.emit("connection", socket);
      socket.resume();
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  override getConnections(
    callback: (error: Error | null, count: number) => void,
  ): this {
    process.nextTick(callback, null, this.sockets.size);
    return this;
  }

  override close(callback?: (error?: Error) => void): this {
    if (this.closed) {
      if (callback) process.nextTick(callback);
      return this;
    }
    if (callback) this.callbacks.push(callback);
    this.draining = true;
    this.listening = false;
    this.closeIdleConnections();
    this.finishClose();
    return this;
  }

  forceClose(): void {
    this.draining = true;
    this.listening = false;
    for (const socket of this.sockets) socket.destroy();
    this.finishClose();
  }

  private finishClose(): void {
    if (!this.draining || this.sockets.size || this.finishing || this.closed)
      return;
    this.finishing = true;
    // Also disposes the HTTP connection checking interval. No OS listener exists.
    super.close((error?: Error) => {
      this.closed = true;
      const result =
        (error as NodeJS.ErrnoException | undefined)?.code ===
        "ERR_SERVER_NOT_RUNNING"
          ? undefined
          : error;
      for (const callback of this.callbacks.splice(0)) callback(result);
    });
  }
}

export function createAdapterHTTPServer(
  context: VextAdapterRuntimeContext | undefined,
  options: ServerOptions,
  handler: RequestListener,
): Server {
  return context?.socketHandoff
    ? new SocketHTTPServer(options, handler, context.socketHandoff)
    : createServer(options, handler);
}

export function socketHandoffControls(
  server: Server,
): Pick<VextServerHandle, "receiveSocket" | "forceClose"> {
  return server instanceof SocketHTTPServer
    ? {
        receiveSocket: (socket) => server.receiveSocket(socket),
        forceClose: () => server.forceClose(),
      }
    : {};
}

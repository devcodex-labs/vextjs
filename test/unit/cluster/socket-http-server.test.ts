import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { SocketHTTPServer } from "../../../src/lib/socket-http-server.js";

async function ingress(
  handler: http.RequestListener,
  options: http.ServerOptions = {},
) {
  let receiver: SocketHTTPServer;
  const server = net.createServer({ pauseOnConnect: true }, (socket) =>
    receiver.receiveSocket(socket),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = server.address() as net.AddressInfo;
  receiver = new SocketHTTPServer(options, handler, {
    host: endpoint.address,
    port: endpoint.port,
  });
  await new Promise<void>((resolve) =>
    receiver.listen(endpoint.port, endpoint.address, resolve),
  );
  return {
    receiver,
    port: endpoint.port,
    async cleanup() {
      const closing = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      receiver.forceClose();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
      await closing;
    },
  };
}

describe("managed Node HTTP lifecycle", () => {
  it("cancels the listening event when closed before the next tick", async () => {
    const receiver = new SocketHTTPServer({}, (_req, res) => res.end(), {
      host: "127.0.0.1",
      port: 80,
    });
    let listened = false;
    receiver.once("listening", () => {
      listened = true;
    });
    receiver.listen(80, "127.0.0.1");
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    expect(listened).toBe(false);
    expect(receiver.address()).toBeNull();
  });
  it("reports handed-off connections and waits for in-flight responses on repeated close", async () => {
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const test = await ingress((_request, response) => {
      started();
      setTimeout(() => response.end("done"), 80);
    });
    try {
      const response = new Promise<string>((resolve, reject) => {
        http
          .get(
            { port: test.port, host: "127.0.0.1", agent: false },
            (result) => {
              let body = "";
              result.on("data", (chunk) => {
                body += chunk;
              });
              result.on("end", () => resolve(body));
            },
          )
          .on("error", reject);
      });
      await began;
      expect(test.receiver.address()?.port).toBe(test.port);
      expect(
        await new Promise<number>((resolve, reject) =>
          test.receiver.getConnections((error, count) =>
            error ? reject(error) : resolve(count),
          ),
        ),
      ).toBe(1);
      let finished = false;
      const closed = new Promise<void>((resolve, reject) =>
        test.receiver.close((error) => {
          finished = true;
          error ? reject(error) : resolve();
        }),
      );
      const again = new Promise<void>((resolve, reject) =>
        test.receiver.close((error) => (error ? reject(error) : resolve())),
      );
      expect(finished).toBe(false);
      expect(test.receiver.listening).toBe(false);
      expect(await response).toBe("done");
      await Promise.all([closed, again]);
      expect(test.receiver.address()).toBeNull();
    } finally {
      await test.cleanup();
    }
  });

  it("enforces Node headersTimeout on externally accepted sockets", async () => {
    const test = await ingress((_req, res) => res.end("unexpected"), {
      headersTimeout: 40,
      requestTimeout: 500,
      connectionsCheckingInterval: 10,
    });
    const socket = net.connect(test.port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
      let result = "";
      socket.on("data", (chunk) => {
        result += chunk;
      });
      await once(socket, "close");
      expect(result).toContain("408 Request Timeout");
    } finally {
      socket.destroy();
      await test.cleanup();
    }
  });

  it("force closes upgraded sockets as well as ordinary HTTP sockets", async () => {
    const test = await ingress((_req, res) => res.end("ok"));
    test.receiver.on("upgrade", (_req, socket) =>
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n",
      ),
    );
    const socket = net.connect(test.port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.write(
        "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n",
      );
      expect(String((await once(socket, "data"))[0])).toContain(
        "101 Switching",
      );
      const closed = once(socket, "close");
      test.receiver.forceClose();
      await closed;
      await new Promise<void>((resolve) =>
        test.receiver.close(() => resolve()),
      );
    } finally {
      socket.destroy();
      await test.cleanup();
    }
  });
});

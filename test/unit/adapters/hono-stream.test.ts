import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createHonoAdapter } from "../../../src/adapters/hono/adapter.js";
import { getHandlerDone } from "../../../src/lib/handler-completion.js";
import { createHookManager } from "../../../src/lib/hooks.js";
import type { VextAdapter } from "../../../src/types/adapter.js";
import type { VextApp } from "../../../src/types/app.js";
import type { VextMiddleware } from "../../../src/types/middleware.js";

interface DispatchResult {
  status: number;
  headers: Record<string, string | string[]>;
  text: string;
}

function createAdapter(): VextAdapter {
  return createHonoAdapter({
    config: {
      requestContext: { enabled: false },
      requestId: { header: "x-request-id" },
      trustProxy: false,
    },
    hooks: createHookManager(),
  } as unknown as VextApp);
}

function registerGet(adapter: VextAdapter, path: string, handler: VextMiddleware) {
  adapter.registerRoute("GET", path, [handler]);
}

function dispatch(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  path: string,
): Promise<DispatchResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`dispatch timed out for GET ${path}`)),
      10_000,
    );
    const chunks: Buffer[] = [];
    const requestSocket = new Socket();
    const request = Object.assign(Readable.from(Buffer.alloc(0)), {
      method: "GET",
      url: path,
      headers: { host: "localhost" },
      rawHeaders: ["host", "localhost"],
      socket: requestSocket,
      connection: requestSocket,
      complete: true,
      aborted: false,
      trailers: {},
      rawTrailers: [],
    }) as IncomingMessage;
    const response = new ServerResponse(request);
    const responseSocket = new PassThrough() as unknown as Socket;
    responseSocket.resume();
    response.assignSocket(responseSocket);

    const cleanup = () => {
      clearTimeout(timeout);
      requestSocket.destroy();
      responseSocket.destroy();
    };
    const originalWrite = response.write.bind(response);
    const originalEnd = response.end.bind(response);
    (response as any).write = (chunk: unknown, ...args: any[]) => {
      if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk as any));
      return originalWrite(chunk as any, ...args);
    };
    (response as any).end = (chunk?: unknown, ...args: any[]) => {
      if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk as any));
      const result = originalEnd(chunk as any, ...args);
      queueMicrotask(() => {
        void (async () => {
          await getHandlerDone(response);
          const headers = Object.fromEntries(
            response
              .getHeaderNames()
              .map((name) => [name, response.getHeader(name) as string | string[]]),
          );
          cleanup();
          resolve({
            status: response.statusCode,
            headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        })().catch((error: unknown) => {
          cleanup();
          reject(error);
        });
      });
      return result;
    };

    try {
      handler(request, response);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

describe("Hono adapter stream responses", () => {
  it("writes Node readable streams through the Web Response bridge", async () => {
    const adapter = createAdapter();
    registerGet(adapter, "/stream", async (req, res) => {
      req.requestId = "req-1";
      res
        .status(206)
        .setHeader("x-stream", "yes")
        .stream(Readable.from(["hello", "-hono"]), "text/plain");
    });

    const response = await dispatch(adapter.buildHandler(), "/stream");

    expect(response.status).toBe(206);
    expect(response.headers["content-type"]).toBe("text/plain");
    expect(response.headers["x-stream"]).toBe("yes");
    expect(response.text).toBe("hello-hono");
  });

  it("settles Node readable errors without hanging the Hono bridge", async () => {
    const adapter = createAdapter();
    registerGet(adapter, "/stream-error", async (req, res) => {
      req.requestId = "req-1";
      res.stream(
        new Readable({
          read() {
            this.destroy(new Error("stream failed"));
          },
        }),
        "text/plain",
      );
    });

    const response = await dispatch(adapter.buildHandler(), "/stream-error");

    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(JSON.parse(response.text)).toEqual({
      code: 500,
      message: "stream failed",
    });
  });
});

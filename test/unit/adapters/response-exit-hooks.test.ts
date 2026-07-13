import { describe, expect, it, vi } from "vitest";
import { createVextResponse as createNativeResponse } from "../../../src/adapters/native/response.js";
import { createVextResponse as createExpressResponse } from "../../../src/adapters/express/response.js";
import { createVextResponse as createFastifyResponse } from "../../../src/adapters/fastify/response.js";
import { createVextResponse as createKoaResponse } from "../../../src/adapters/koa/response.js";
import {
  createResponseBox,
  createVextResponse as createHonoResponse,
} from "../../../src/adapters/hono/response.js";
import type { VextResponse } from "../../../src/types/response.js";

interface ResponseHarness {
  res: VextResponse;
  headers: Record<string, unknown>;
  status(): number;
}

function nodeResponseHarness(
  create: (host: any, requestId: any) => VextResponse,
): ResponseHarness {
  const headers: Record<string, unknown> = {};
  const host = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = value;
    },
    removeHeader: vi.fn(),
    end: vi.fn(),
  };
  return {
    res: create(host, () => "req-1"),
    headers,
    status: () => host.statusCode,
  };
}

function fastifyResponseHarness(): ResponseHarness {
  const headers: Record<string, unknown> = {};
  let statusCode = 200;
  const reply = {
    status(code: number) {
      statusCode = code;
      return reply;
    },
    header(name: string, value: unknown) {
      headers[name.toLowerCase()] = value;
      return reply;
    },
    send: vi.fn(),
  };
  return {
    res: createFastifyResponse(reply as any, () => "req-1"),
    headers,
    status: () => statusCode,
  };
}

function koaResponseHarness(): ResponseHarness {
  const harness = nodeResponseHarness((host) =>
    createKoaResponse({ res: host } as any, () => "req-1"),
  );
  return harness;
}

function honoResponseHarness(): ResponseHarness {
  const headers: Record<string, unknown> = {};
  let statusCode = 200;
  const context = {
    status(code: number) {
      statusCode = code;
    },
    header(name: string, value: unknown) {
      headers[name.toLowerCase()] = value;
    },
    body: vi.fn(() => new Response(null, { status: statusCode })),
  };
  return {
    res: createHonoResponse(context as any, () => "req-1", createResponseBox()),
    headers,
    status: () => statusCode,
  };
}

const adapters: Array<[string, () => ResponseHarness]> = [
  ["native", () => nodeResponseHarness(createNativeResponse as any)],
  ["express", () => nodeResponseHarness(createExpressResponse as any)],
  ["fastify", fastifyResponseHarness],
  ["koa", koaResponseHarness],
  ["hono", honoResponseHarness],
];

describe.each(adapters)(
  "%s response exit lifecycle",
  (_name, createHarness) => {
    it.each(["redirect", "download"] as const)(
      "runs the internal hook for %s responses",
      (kind) => {
        const { res, headers, status } = createHarness();
        const seen: string[] = [];
        res._onBeforeSend = (responseKind, _data, _status, responseHeaders) => {
          seen.push(responseKind);
          responseHeaders["Set-Cookie"] = "sid=1";
        };

        if (kind === "redirect") {
          res.redirect("/next", 307);
          expect(status()).toBe(307);
          expect(headers.location).toBe("/next");
        } else {
          const readable = {
            pipe: vi.fn(),
          } as unknown as NodeJS.ReadableStream;
          res.download(readable, "report.txt", "text/plain");
          expect(headers["content-type"]).toBe("text/plain");
          expect(headers["content-disposition"]).toBe(
            'attachment; filename="report.txt"',
          );
        }

        expect(seen).toEqual([kind]);
        expect(headers["set-cookie"]).toBe("sid=1");
      },
    );
  },
);

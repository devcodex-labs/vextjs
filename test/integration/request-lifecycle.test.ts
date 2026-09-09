import http from "node:http";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createNativeAdapter } from "../../src/adapters/native/adapter.js";
import { createHonoAdapter } from "../../src/adapters/hono/adapter.js";
import { createFastifyAdapter } from "../../src/adapters/fastify/adapter.js";
import { createExpressAdapter } from "../../src/adapters/express/adapter.js";
import { createKoaAdapter } from "../../src/adapters/koa/adapter.js";
import { DEFAULT_CONFIG } from "../../src/lib/app.js";
import type { VextApp } from "../../src/types/app.js";
import type { VextRequest } from "../../src/types/request.js";

const factories = {
  native: (app: VextApp) => createNativeAdapter({}, app),
  hono: createHonoAdapter,
  fastify: (app: VextApp) => createFastifyAdapter({}, app),
  express: (app: VextApp) => createExpressAdapter({}, app),
  koa: (app: VextApp) => createKoaAdapter({}, app),
};

for (const [name, createAdapter] of Object.entries(factories)) {
  describe(`${name} request lifecycle over HTTP`, () => {
    it("keeps a completed POST body live until the response finishes", async () => {
      const adapter = createAdapter({ config: DEFAULT_CONFIG } as VextApp);
      const requests: VextRequest[] = [];
      let closes = 0;
      adapter.registerRoute("POST", "/lifecycle", [
        async (req, res) => {
          requests.push(req);
          req.onClose(() => closes++);
          await (req as any)._getRawBody();
          await setImmediate();
          res.json({ aborted: req.signal.aborted, closes });
        },
      ]);
      const server = await adapter.listen(0, "127.0.0.1");
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      try {
        for (let index = 0; index < 5; index++) {
          const result = await new Promise<any>((resolve, reject) => {
            const request = http.request(
              {
                hostname: server.host,
                port: server.port,
                method: "POST",
                path: "/lifecycle",
                agent,
                headers: { "content-type": "text/plain" },
              },
              (response) => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                  body += chunk;
                });
                response.on("end", () => {
                  try {
                    resolve(JSON.parse(body));
                  } catch (error) {
                    reject(error);
                  }
                });
              },
            );
            request.on("error", reject);
            request.end("complete request body");
          });
          expect(result).toEqual({ aborted: false, closes: index });
        }
        await setImmediate();
        expect(closes).toBe(5);
        expect(requests.every((req) => !req.signal.aborted)).toBe(true);
        requests[0]!.onClose(() => closes++);
        expect(closes).toBe(6);
      } finally {
        agent.destroy();
        await server.close();
      }
    });

    it("aborts when the client disconnects while the handler is pending", async () => {
      const adapter = createAdapter({ config: DEFAULT_CONFIG } as VextApp);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: (request: VextRequest) => void;
      const ready = new Promise<VextRequest>((resolve) => {
        entered = resolve;
      });
      let closes = 0;
      adapter.registerRoute("GET", "/pending", [
        async (req, res) => {
          req.onClose(() => closes++);
          entered(req);
          await pending;
          res.text("done");
        },
      ]);
      const server = await adapter.listen(0, "127.0.0.1");
      const client = http.get({
        hostname: server.host,
        port: server.port,
        path: "/pending",
      });
      client.on("error", () => {});
      try {
        const req = await ready;
        expect(req.signal.aborted).toBe(false);
        client.destroy();
        await expect.poll(() => req.signal.aborted).toBe(true);
        expect(closes).toBe(1);
      } finally {
        client.destroy();
        release();
        await server.close();
      }
    });
  });
}

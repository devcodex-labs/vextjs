import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVextFetch } from "../../src/lib/fetch.js";
import { createLogger } from "../../src/lib/logger.js";
import { createMemoryLogSink } from "../../src/lib/logger/sinks/memory.js";
import { createNativeAdapter } from "../../src/adapters/native/adapter.js";
import { DEFAULT_CONFIG } from "../../src/lib/app.js";
import type { VextApp } from "../../src/types/app.js";

let server: Server;
let base: string;
let attempts: number;
let closedStreams: number;
const timers = new Set<ReturnType<typeof setTimeout>>();
function later(callback: () => void, ms: number) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    callback();
  }, ms);
  timers.add(timer);
}
beforeEach(async () => {
  attempts = 0;
  closedStreams = 0;
  server = createServer((req, res) => {
    attempts++;
    if (req.url === "/slow-headers") {
      later(() => res.end("late"), 200);
      return;
    }
    if (req.url?.includes("retry") && attempts === 1) {
      res.writeHead(503);
      res.end("retry");
      return;
    }
    res.once("close", () => {
      if (!res.writableFinished) closedStreams++;
    });
    res.writeHead(200, { "content-type": "text/plain" });
    res.flushHeaders();
    res.write("first");
    later(() => res.end("last"), req.url?.includes("proxy") ? 1000 : 200);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener address");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
function client() {
  return createVextFetch(
    createLogger({ level: "silent" }, { sink: createMemoryLogSink() }),
    {},
    "x-request-id",
  );
}

describe("real HTTP outbound fetch lifecycle", () => {
  it.each(["deadline", "disconnect-after-retry", "downstream-disconnect"])(
    "keeps proxy body cancellation connected over real TCP: %s",
    async (mode) => {
      const outbound = client();
      const adapter = createNativeAdapter({}, {
        config: DEFAULT_CONFIG,
      } as VextApp);
      adapter.registerRoute("GET", "/", [
        (req, res) =>
          outbound.proxy(req, res, {
            url: `${base}/${mode === "disconnect-after-retry" ? "proxy-retry" : "proxy"}`,
            timeout: mode === "deadline" ? 100 : 2000,
            retry: 1,
            retryDelay: 0,
          }),
      ]);
      const handle = await adapter.listen(0, "127.0.0.1");
      const downstream = new AbortController();
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port}`, {
          signal: downstream.signal,
        });
        const body = response.text().then(
          () => "completed",
          () => "cancelled",
        );
        if (mode !== "deadline") downstream.abort();
        expect(await Promise.race([body, delay(600, "still-reading")])).toBe(
          "cancelled",
        );
        const deadline = Date.now() + 600;
        while (!closedStreams && Date.now() < deadline) await delay(10);
        expect(closedStreams).toBe(1);
        expect(attempts).toBe(mode === "disconnect-after-retry" ? 2 : 1);
      } finally {
        downstream.abort();
        await handle.close();
      }
    },
  );

  it("times out waiting for headers", async () => {
    await expect(
      client()(`${base}/slow-headers`, { timeout: 30 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("keeps ordinary timeout scoped to headers while a slow body completes", async () => {
    const response = await client()(`${base}/body`, { timeout: 100 });
    expect(await response.text()).toBe("firstlast");
    expect(attempts).toBe(1);
  });

  it.each(["/body", "/retry"])(
    "keeps caller cancellation connected to the returned body: %s",
    async (pathname) => {
      const controller = new AbortController();
      const response = await client()(base + pathname, {
        timeout: 1000,
        retry: 1,
        retryDelay: 0,
        signal: controller.signal,
      });
      const result = response.text().then(
        () => "completed",
        () => "cancelled",
      );
      controller.abort(new Error("caller cancelled body"));
      expect(await Promise.race([result, delay(100, "still-reading")])).toBe(
        "cancelled",
      );
      expect(attempts).toBe(pathname === "/retry" ? 2 : 1);
    },
  );
});

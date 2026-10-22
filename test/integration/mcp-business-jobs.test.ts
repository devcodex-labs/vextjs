import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import {
  createBusinessConsumer,
  repository,
} from "../helpers/mcp-business-consumer.js";
import { resolveVextRedisKeyPrefix } from "../../src/lib/redis/namespace.js";

const redisUrl = process.env.VEXT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

describe("MCP-generated scheduled Jobs consumer", () => {
  it.each([
    { mode: "ipc", slow: false },
    { mode: "redis", slow: false },
    { mode: "ipc", slow: true },
    { mode: "redis", slow: true },
  ])(
    "builds MCP definitions with built-in Cluster $mode, slow=$slow",
    async ({ mode, slow }) => {
      const consumer = await createBusinessConsumer({
        name: `scheduled-${randomUUID().replaceAll("-", "")}`,
      });
      const eventsFile = path.join(consumer.parent, "job-events.jsonl");
      const port = await availablePort();
      const client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        connectTimeout: 1000,
      });
      client.on("error", () => {});
      try {
        if (mode === "redis") {
          await client.connect();
          await client.ping();
        }
        await consumer.put(
          "src/config/default.ts",
          `export default ${JSON.stringify({
            host: "127.0.0.1",
            port,
            cluster: { enabled: true, workers: 2, autoRestart: false },
            logger: { level: "silent" },
            frontend: { enabled: false },
            openapi: { enabled: false },
            jobs:
              mode === "redis"
                ? { redis: { url: redisUrl, leaseTtl: 1000 } }
                : {},
          })};\n`,
          "Shared Redis for real application-started tasks",
        );
        await consumer.call("vext_knowledge_search", {
          ids: ["K07", "K08"],
          locale: "zh",
        });
        await consumer.generate("service", "calculator", {
          language: "ts",
          method: "double",
          input: { amount: "number" },
          output: { amount: "number" },
          body: "return { amount: input.amount * 2 };",
        });
        await consumer.generate("job-handler", "scheduled", {
          language: "ts",
          cron: "* * * * * *",
          leaseTtl: 2000,
          handler: `ctx.signal.throwIfAborted();\nconst result = await ctx.app.services.calculator.double({ amount: 3 });\nconst { appendFile } = await import("node:fs/promises");\n${slow ? `await appendFile(${JSON.stringify(eventsFile)}, JSON.stringify({phase:"start",at:Date.now(),scheduledAt:ctx.scheduledAt.toISOString(),pid:process.pid})+"\\n");await new Promise(resolve=>setTimeout(resolve,1500));` : ""}\nawait appendFile(${JSON.stringify(eventsFile)}, JSON.stringify({ phase:"end", at:Date.now(), scheduledAt: ctx.scheduledAt.toISOString(), result, pid: process.pid }) + "\\n");`,
        });
        if (slow)
          await consumer.put(
            "jobs-case.json",
            JSON.stringify({ slow: true, eventsFile }),
            "Hold the old handler across replacement",
          );
        await consumer.overlayFixture("jobs");
        await consumer.command([
          path.join(repository, "dist/cli/index.js"),
          "build",
          "--typecheck",
        ]);
        const inspected = await consumer.call("vext_project_inspect", {
          section: "jobs",
        });
        expect(JSON.stringify(inspected)).toContain("cron");
        expect(JSON.stringify(inspected)).toContain("runtimeVerified");
        const result = await consumer.command([
          "scripts/verify/job-process.mjs",
          "cluster",
        ]);
        expect(result.stdout).toContain('"status":"PASS"');
        const owned = (
          await readFile(
            path.join(consumer.root, "jobs-owned-processes.jsonl"),
            "utf8",
          )
        )
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        for (const owner of owned)
          expect(() => process.kill(owner.pid, 0)).toThrow();
        const allEvents = (await readFile(eventsFile, "utf8"))
          .trim()
          .split("\n")
          .map(
            (line) =>
              JSON.parse(line) as {
                scheduledAt: string;
                result: { amount: number };
                pid: number;
                phase: string;
                at: number;
              },
          );
        const events = allEvents.filter((event) => event.phase === "end");
        expect(events.length).toBeGreaterThanOrEqual(slow ? 2 : 5);
        if (slow) {
          let running = 0;
          for (const event of allEvents) {
            running += event.phase === "start" ? 1 : -1;
            expect(running).toBeGreaterThanOrEqual(0);
            expect(running).toBeLessThanOrEqual(1);
          }
          expect(running).toBe(0);
        }
        expect(new Set(events.map((event) => event.scheduledAt)).size).toBe(
          events.length,
        );
        expect(events.every((event) => event.result.amount === 6)).toBe(true);
        expect(
          events.every((event) => Date.parse(event.scheduledAt) % 1000 === 0),
        ).toBe(true);
        expect(
          consumer.history.some((item) => item.action === "host-write"),
        ).toBe(true);
        if (process.env.VEXT_JOBS_EVIDENCE_DIR)
          await writeFile(
            path.join(
              process.env.VEXT_JOBS_EVIDENCE_DIR,
              `cluster-consumer-${mode}${slow ? "-slow" : ""}.json`,
            ),
            JSON.stringify(
              {
                mode,
                slow,
                port,
                owned,
                events: allEvents,
                history: consumer.history,
                cleanup: { workersExited: true },
              },
              null,
              2,
            ),
          );
      } finally {
        const prefix = resolveVextRedisKeyPrefix({
          rootDir: consumer.root,
          module: "job",
          runtimeMode: "production",
        });
        const tag = createHash("sha256")
          .update(prefix)
          .update("\0")
          .update("scheduled")
          .digest("hex");
        if (client.status === "ready")
          await client.del(
            `{${tag}}:${prefix}scheduled:last`,
            `{${tag}}:${prefix}scheduled:running`,
          );
        client.disconnect();
        await rm(eventsFile, { force: true });
        await consumer.close();
      }
    },
    90000,
  );
});

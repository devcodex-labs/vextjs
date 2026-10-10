import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import {
  createBusinessConsumer,
  repository,
} from "../helpers/mcp-business-consumer.js";
import { resolveVextRedisKeyPrefix } from "../../src/lib/redis/namespace.js";

const redisUrl = process.env.VEXT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";

describe("MCP-generated scheduled Jobs consumer", () => {
  it("builds generated definitions and automatically schedules one shared trigger across HTTP Cluster workers", async () => {
    const consumer = await createBusinessConsumer({
      name: `scheduled-${randomUUID().replaceAll("-", "")}`,
    });
    const eventsFile = path.join(consumer.parent, "job-events.jsonl");
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 1000,
    });
    client.on("error", () => {});
    try {
      await client.connect();
      await client.ping();
      await consumer.put(
        "src/config/default.ts",
        `export default ${JSON.stringify({
          server: { host: "127.0.0.1", port: 0 },
          logger: { level: "silent" },
          frontend: { enabled: false },
          openapi: { enabled: false },
          jobs: { redis: { url: redisUrl, leaseTtl: 1000 } },
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
        interval: 200,
        handler: `ctx.signal.throwIfAborted();\nconst result = await ctx.app.services.calculator.double({ amount: 3 });\nconst { appendFile } = await import("node:fs/promises");\nawait appendFile(${JSON.stringify(eventsFile)}, JSON.stringify({ scheduledAt: ctx.scheduledAt.toISOString(), result, pid: process.pid }) + "\\n");`,
      });
      await consumer.overlayFixture("jobs");
      await consumer.command([
        path.join(repository, "dist/cli/index.js"),
        "build",
        "--typecheck",
      ]);
      const inspected = await consumer.call("vext_project_inspect", {
        section: "jobs",
      });
      expect(JSON.stringify(inspected)).toContain("interval");
      const result = await consumer.command([
        "scripts/verify/job-process.mjs",
        "cluster",
      ]);
      expect(result.stdout).toContain('"status":"PASS"');
      const events = (await readFile(eventsFile, "utf8"))
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              scheduledAt: string;
              result: { amount: number };
              pid: number;
            },
        );
      expect(events.length).toBeGreaterThanOrEqual(5);
      expect(new Set(events.map((event) => event.scheduledAt)).size).toBe(
        events.length,
      );
      expect(events.every((event) => event.result.amount === 6)).toBe(true);
      expect(
        events.every((event) => Date.parse(event.scheduledAt) % 200 === 0),
      ).toBe(true);
      expect(
        consumer.history.some((item) => item.action === "host-write"),
      ).toBe(true);
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
  }, 90000);
});

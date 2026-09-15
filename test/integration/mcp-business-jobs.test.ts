import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bootstrapJobRuntime,
  type VextJobRuntime,
} from "../../src/lib/jobs/job-runtime.js";
import { tickJobScheduler } from "../../src/lib/jobs/scheduler.js";
import { startJobWorker } from "../../src/lib/jobs/worker.js";
import {
  resolveJobDueTimes,
  getNextJobRunTime,
} from "../../src/lib/jobs/schedule.js";
import { resolveVextRedisKeyPrefix } from "../../src/lib/redis/namespace.js";
import {
  createBusinessConsumer,
  repository,
} from "../helpers/mcp-business-consumer.js";

const redisUrl = process.env.VEXT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
const ownedId = randomUUID().replaceAll("-", "");
const consumers: Array<Awaited<ReturnType<typeof createBusinessConsumer>>> = [];
const runtimes: VextJobRuntime[] = [];
const prefixes: string[] = [];
let redis: Redis;

beforeAll(async () => {
  redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
  });
  redis.on("error", () => undefined);
  // Missing Redis is a failed prerequisite, not a passing test with its assertions omitted.
  await redis.connect();
  await redis.ping();
  for (const service of ["a", "b"]) {
    const schedulerMode = service === "b" ? "inline" : "enqueue";
    const consumer = await createBusinessConsumer({
      name: `mcp-job-${service}-${ownedId}`,
    });
    consumers.push(consumer);
    prefixes.push(
      resolveVextRedisKeyPrefix({
        rootDir: consumer.root,
        module: "job",
        runtimeMode: "production",
        configProfile: "default",
      }),
    );
    await consumer.put(
      "src/config/default.ts",
      `export default ${JSON.stringify(
        {
          logger: { level: "silent" },
          frontend: { enabled: false },
          openapi: { enabled: false },
          jobs: {
            enabled: true,
            store: { type: "redis", url: redisUrl },
            scheduler: {
              mode: schedulerMode,
              tickInterval: 100,
              lease: { ttl: 1000, renewInterval: 200 },
            },
            worker: {
              concurrency: 2,
              pollInterval: 20,
              shutdownTimeout: 100,
              lease: { ttl: 1000, renewInterval: 200 },
            },
          },
        },
        null,
        2,
      )};\n`,
      "Bind this service's own default Redis namespace; no shared singleton or PID prefix",
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
    await consumer.generate("job-handler", "calculate", {
      language: "ts",
      payload: { amount: "number!" },
      concurrency: 1,
      queue: { enabled: true, priority: 5 },
      timeout: 1000,
      handler:
        "ctx.signal.throwIfAborted();\nreturn ctx.app.services.calculator.double(ctx.payload);",
    });
    await consumer.generate("job-handler", "scheduled", {
      language: "ts",
      schedule: {
        cron: "* * * * * *",
        timezone: "UTC",
        misfirePolicy: "catch-up",
        maxCatchUp: 2,
        jitter: service === "b" ? 0 : 10,
        singleton: true,
      },
      queue: { enabled: true, priority: 3 },
      handler:
        "ctx.signal.throwIfAborted();\nreturn ctx.app.services.calculator.double({ amount: 3 });",
    });
    await consumer.generate("job-handler", "retry", {
      language: "ts",
      retry: { attempts: 2, delay: 5, backoff: "exponential" },
      handler:
        "if (ctx.attempt === 1) throw new Error('owned retry probe');\nreturn { attempts: ctx.attempt };",
    });
    await consumer.generate("job-handler", "timeout", {
      language: "ts",
      timeout: 20,
      handler:
        "const { setTimeout } = await import('node:timers/promises');\nawait setTimeout(2000, undefined, { signal: ctx.signal });",
    });
    await consumer.generate("job-handler", "cancel", {
      language: "ts",
      handler:
        "if (!ctx.signal.aborted) await new Promise(resolve => ctx.signal.addEventListener('abort', () => resolve(undefined), { once: true }));\nreturn { stopped: ctx.signal.aborted };",
    });
    await consumer.overlayFixture("jobs");
    await consumer.command([
      path.join(repository, "dist/cli/index.js"),
      "build",
      "--typecheck",
    ]);
    runtimes.push(
      await bootstrapJobRuntime({
        rootDir: consumer.root,
        built: true,
      }),
    );
  }
}, 120_000);

afterAll(async () => {
  const errors: unknown[] = [];
  for (const runtime of runtimes) {
    try {
      await runtime.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (redis?.status === "ready") {
    for (const prefix of prefixes) {
      try {
        if (!prefix.includes(ownedId) || !prefix.startsWith("vext:mcp-job-"))
          throw new Error("Unowned Redis prefix");
        let cursor = "0";
        let count = 0;
        do {
          const page = await redis.scan(
            cursor,
            "MATCH",
            prefix + "*",
            "COUNT",
            100,
          );
          cursor = page[0];
          if (page[1].some((key) => !key.startsWith(prefix)))
            throw new Error("Unexpected Redis cleanup key");
          count += page[1].length;
          if (count > 500) throw new Error("Unexpected Job fixture size");
          if (page[1].length) await redis.del(...page[1]);
        } while (cursor !== "0");
        consumers[0]?.history.push({
          action: "delete-owned-redis-keys",
          prefix,
          count,
        });
      } catch (error) {
        errors.push(error);
      }
    }
  }
  redis?.disconnect();
  for (const consumer of consumers) {
    try {
      await consumer.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (process.env.VEXT_MCP_BUSINESS_EVIDENCE)
    await writeFile(
      process.env.VEXT_MCP_BUSINESS_EVIDENCE,
      JSON.stringify(
        consumers.map((consumer) => consumer.history),
        null,
        2,
      ),
    );
  if (errors.length)
    throw new AggregateError(errors, "Owned Job cleanup failed");
});

describe.sequential("MCP Job native consumer", () => {
  it("uses the generated payload schema, real service, retry, timeout and cooperative cancellation", async () => {
    const runtime = runtimes[0]!;
    expect(
      await runtime.run("calculate", { payload: { amount: 4 } }),
    ).toMatchObject({ status: "success", result: { amount: 8 } });
    expect(
      await runtime.run("calculate", { payload: { amount: "invalid" } }),
    ).toMatchObject({ status: "failed" });
    expect(await runtime.run("retry")).toMatchObject({
      status: "success",
      attempts: 2,
    });
    expect(await runtime.run("timeout")).toMatchObject({ status: "timeout" });
    const controller = new AbortController();
    const run = runtime.run("cancel", { signal: controller.signal });
    controller.abort();
    expect(await run).toMatchObject({
      status: "cancelled",
      result: { stopped: true },
    });
  });

  it("shares a stable namespace within one service and isolates another service on the same Redis", async () => {
    const [first, second] = await Promise.all([
      runtimes[0]!.enqueue("calculate", {
        payload: { amount: 7 },
        idempotencyKey: "one-event",
      }),
      runtimes[0]!.enqueue("calculate", {
        payload: { amount: 7 },
        idempotencyKey: "one-event",
      }),
    ]);
    const other = await runtimes[1]!.enqueue("calculate", {
      payload: { amount: 7 },
      idempotencyKey: "one-event",
    });
    expect(first.id).toBe(second.id);
    expect(other.id).not.toBe(first.id);
    expect(await runtimes[1]!.getRun(first.id)).toBeUndefined();
    expect(prefixes[0]).not.toBe(prefixes[1]);
    await startJobWorker(runtimes[0]!, { once: true });
    expect(await runtimes[0]!.getRun(first.id)).toMatchObject({
      status: "success",
      result: { amount: 14 },
    });
  });

  it("atomically leases, renews, takes over expired runs and rejects a stale owner", async () => {
    const store = runtimes[0]!.store;
    const record = await store.enqueueRun({
      jobName: "calculate",
      trigger: "enqueue",
    });
    const at = new Date();
    const [a, b] = await Promise.all([
      store.claimRun(record.id, { ownerId: "a", now: at, leaseTtl: 1000 }),
      store.claimRun(record.id, { ownerId: "b", now: at, leaseTtl: 1000 }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const owner = a ? "a" : "b";
    expect(
      await store.renewRunLease(
        record.id,
        owner,
        1000,
        new Date(at.getTime() + 500),
      ),
    ).toBe(true);
    expect(
      await store.claimRun(record.id, {
        ownerId: "new",
        now: new Date(at.getTime() + 2000),
        leaseTtl: 1000,
      }),
    ).toMatchObject({ leaseOwner: "new" });
    expect(
      await store.completeRun(
        record.id,
        { status: "success" },
        { ownerId: owner },
      ),
    ).toBe(false);
    expect(await store.renewRunLease(record.id, owner, 1000)).toBe(false);
    expect(
      await store.completeRun(
        record.id,
        { status: "success" },
        { ownerId: "new" },
      ),
    ).toBe(true);
    const completed = await store.getRun(record.id);
    expect(
      await store.completeRun(
        record.id,
        { status: "failed", result: "stale" },
        { ownerId: owner },
      ),
    ).toBe(false);
    expect(await store.getRun(record.id)).toEqual(completed);
    const leases = await Promise.all([
      store.acquireSchedulerLease("scheduler-a", 1000, at),
      store.acquireSchedulerLease("scheduler-b", 1000, at),
    ]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const schedulerOwner = leases[0] ? "scheduler-a" : "scheduler-b";
    expect(
      await store.renewSchedulerLease(
        schedulerOwner,
        1000,
        new Date(at.getTime() + 500),
      ),
    ).toBe(true);
    expect(
      await store.acquireSchedulerLease(
        "scheduler-new",
        1000,
        new Date(at.getTime() + 2000),
      ),
    ).toBe(true);
    expect(await store.renewSchedulerLease(schedulerOwner, 1000)).toBe(false);
    await store.releaseSchedulerLease("scheduler-new");
  });

  it("uses actual schedule windows, priority, jitter and explicit inline or queued execution", async () => {
    const runtime = runtimes[0]!;
    const at = new Date(Math.floor(Date.now() / 1000) * 1000);
    const job = runtime.registry.get("scheduled")!.definition;
    const due = resolveJobDueTimes({
      schedule: job.schedule!,
      now: at,
      previousTick: new Date(at.getTime() - 3000),
    });
    expect(due).toHaveLength(2);
    expect(
      getNextJobRunTime({
        schedule: { cron: "0 9 * * *", timezone: "Asia/Shanghai" },
        from: new Date("2026-09-15T00:00:00Z"),
      })?.toISOString(),
    ).toBe("2026-09-15T01:00:00.000Z");
    expect(
      resolveJobDueTimes({
        schedule: { interval: 1000, startAt: new Date(at.getTime() + 1000) },
        now: at,
      }),
    ).toEqual([]);
    expect(
      resolveJobDueTimes({
        schedule: { interval: 1000, endAt: new Date(at.getTime() - 1) },
        now: at,
      }),
    ).toEqual([]);
    const created = await tickJobScheduler(runtime, {
      ownerId: "owned-tick",
      now: at,
      previousTick: new Date(at.getTime() - 3000),
    });
    expect(created).toBe(2);
    const records = await runtime.listRuns({ jobName: "scheduled" });
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record).toMatchObject({
        status: "queued",
        priority: 3,
        trigger: "schedule",
      });
      expect(
        Date.parse(record.runAt) - Date.parse(record.scheduledAt!),
      ).toBeGreaterThanOrEqual(0);
      expect(
        Date.parse(record.runAt) - Date.parse(record.scheduledAt!),
      ).toBeLessThan(10);
    }
    const inlineRuntime = runtimes[1]!;
    const inlineAt = new Date(at.getTime() + 10_000);
    const inlineCreated = await tickJobScheduler(inlineRuntime, {
      ownerId: "inline-tick",
      now: inlineAt,
      previousTick: new Date(inlineAt.getTime() - 3000),
    });
    expect(inlineCreated).toBeGreaterThan(0);
    const inlineRecords = await inlineRuntime.listRuns({
      jobName: "scheduled",
    });
    expect(inlineRecords).toHaveLength(inlineCreated);
    expect(
      inlineRecords.every(
        (record) =>
          record.status === "success" &&
          (record.result as { amount?: unknown } | undefined)?.amount === 6 &&
          record.trigger === "schedule",
      ),
    ).toBe(true);
  });

  it("runs two independent schedulers and workers, then Node cluster workers through the same native store", async () => {
    const consumer = consumers[0]!;
    const script = "scripts/verify/job-process.mjs";
    const processes = await Promise.all([
      consumer.command([script, "scheduler"]),
      consumer.command([script, "scheduler"]),
    ]);
    const schedulers = processes.map((result) => JSON.parse(result.stdout));
    expect(new Set(schedulers.map((item) => item.pid)).size).toBe(2);
    const records = await runtimes[0]!.listRuns({ jobName: "scheduled" });
    expect(new Set(records.map((record) => record.scheduledAt)).size).toBe(
      records.length,
    );
    await Promise.all([
      consumer.command([script, "worker"]),
      consumer.command([script, "worker"]),
    ]);
    expect(
      (await runtimes[0]!.listRuns({ jobName: "scheduled" })).every(
        (record) => record.status === "success",
      ),
    ).toBe(true);
    const queued = await Promise.all(
      Array.from({ length: 4 }, (_, amount) =>
        runtimes[0]!.enqueue("calculate", { payload: { amount } }),
      ),
    );
    const result = JSON.parse(
      (await consumer.command([script, "cluster"])).stdout,
    );
    expect(result.status).toBe("PASS");
    expect(result.pids).toHaveLength(2);
    for (const run of queued)
      expect(await runtimes[0]!.getRun(run.id)).toMatchObject({
        status: "success",
      });
  }, 30_000);
});

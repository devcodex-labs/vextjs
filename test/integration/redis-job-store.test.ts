import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { createRedisJobStore } from "../../src/lib/jobs/stores/redis-store.js";

const redisUrl =
  process.env.VEXT_TEST_REDIS_URL ??
  process.env.REDIS_URL ??
  "redis://127.0.0.1:6379";

describe("RedisJobStore", () => {
  it("claims, renews, and completes runs with owner protection", async () => {
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
    });
    try {
      await client.connect();
      await client.ping();
    } catch {
      console.warn(
        `[vextjs:test] Redis unavailable at ${redisUrl}; skipping RedisJobStore integration assertion.`,
      );
      client.disconnect();
      return;
    }

    const namespace = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const store = createRedisJobStore({
      client,
      namespace,
      rootDir: process.cwd(),
      runtimeMode: "test",
    });

    try {
      await store.init?.();
      const run = await store.enqueueRun({
        jobName: "billing.sync",
        trigger: "enqueue",
        payload: { id: 1 },
      });
      const claimed = await store.claimRun(run.id, {
        ownerId: "worker-a",
        leaseTtl: 1_000,
        now: new Date("2026-09-13T00:00:00.000Z"),
      });
      expect(claimed).toMatchObject({
        status: "running",
        leaseOwner: "worker-a",
      });
      await expect(
        store.completeRun(
          run.id,
          { status: "success", attempts: 1, durationMs: 1 },
          { ownerId: "worker-b" },
        ),
      ).resolves.toBe(false);
      await expect(
        store.renewRunLease(
          run.id,
          "worker-a",
          2_000,
          new Date("2026-09-13T00:00:00.500Z"),
        ),
      ).resolves.toBe(true);
      await expect(store.getRun(run.id)).resolves.toMatchObject({
        leaseUntil: "2026-09-13T00:00:02.500Z",
      });
      await expect(
        store.completeRun(
          run.id,
          { status: "success", attempts: 1, durationMs: 1 },
          { ownerId: "worker-a" },
        ),
      ).resolves.toBe(true);
      await expect(store.getRun(run.id)).resolves.toMatchObject({
        status: "success",
      });
    } finally {
      await store.close?.();
    }
  });

  it("serializes scheduler lease acquisition and idempotent enqueue", async () => {
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
    });
    try {
      await client.connect();
      await client.ping();
    } catch {
      console.warn(
        `[vextjs:test] Redis unavailable at ${redisUrl}; skipping RedisJobStore integration assertion.`,
      );
      client.disconnect();
      return;
    }

    const namespace = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const store = createRedisJobStore({
      client,
      namespace,
      rootDir: process.cwd(),
      runtimeMode: "test",
    });

    try {
      await store.init?.();
      const at = new Date("2026-09-13T00:00:00.000Z");
      const [leaseA, leaseB] = await Promise.all([
        store.acquireSchedulerLease("scheduler-a", 10_000, at),
        store.acquireSchedulerLease("scheduler-b", 10_000, at),
      ]);
      expect([leaseA, leaseB].filter(Boolean)).toHaveLength(1);

      const [first, second] = await Promise.all([
        store.enqueueRun({
          jobName: "billing.sync",
          trigger: "enqueue",
          payload: { id: 1 },
          idempotencyKey: "same-business-key",
        }),
        store.enqueueRun({
          jobName: "billing.sync",
          trigger: "enqueue",
          payload: { id: 1 },
          idempotencyKey: "same-business-key",
        }),
      ]);
      expect(first.id).toBe(second.id);
      await expect(
        store.listRuns({ jobName: "billing.sync" }),
      ).resolves.toHaveLength(1);
    } finally {
      await store.close?.();
    }
  });
});

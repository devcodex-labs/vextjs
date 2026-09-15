import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { createRedisJobStore } from "../../src/lib/jobs/stores/redis-store.js";
import { resolveVextRedisKeyPrefix } from "../../src/lib/redis/index.js";
import type { VextJobStore } from "../../src/lib/jobs/types.js";
import { jobStoreCompletionCases } from "../helpers/job-store-completion-cases.js";

const redisUrl =
  process.env.VEXT_TEST_REDIS_URL ??
  process.env.REDIS_URL ??
  "redis://127.0.0.1:6379";

describe("RedisJobStore", () => {
  it.each(jobStoreCompletionCases)("$name", async ({ run }) => {
    await withRedisJobStore(run);
  });
  it("claims, renews, and completes runs with owner protection", async () => {
    await withRedisJobStore(async (store) => {
      const run = await store.enqueueRun({
        jobName: "billing.sync",
        trigger: "enqueue",
        payload: { id: 1 },
        runAt: new Date("2026-09-13T00:00:00.000Z"),
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
    });
  });

  it("serializes scheduler lease acquisition and idempotent enqueue", async () => {
    await withRedisJobStore(async (store) => {
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
    });
  });
});

/** Use an owned namespace and delete its known keys without scanning shared Redis. */
async function withRedisJobStore(
  run: (store: VextJobStore) => Promise<void>,
): Promise<void> {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
  });
  const options = {
    client,
    namespace: `job-completion-${randomUUID()}`,
    rootDir: process.cwd(),
    runtimeMode: "test",
  };
  const prefix = resolveVextRedisKeyPrefix({ ...options, module: "job" });
  const store = createRedisJobStore(options);
  try {
    await client.connect();
    await store.init?.();
    await run(store);
  } finally {
    try {
      if (client.status === "ready") {
        await client.del(
          ...[
            "scheduler:lease",
            "workers",
            "runs",
            "queue",
            "running",
            "idem:billing.sync:same-business-key",
          ].map((suffix) => `${prefix}${suffix}`),
        );
      }
      await store.close?.();
    } finally {
      client.disconnect();
    }
  }
}

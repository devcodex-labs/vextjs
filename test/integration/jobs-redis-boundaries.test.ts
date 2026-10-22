import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { createJobCoordinator } from "../../src/lib/jobs/redis-coordinator.js";
import { resolveVextRedisKeyPrefix } from "../../src/lib/redis/namespace.js";
import { createTestJobScheduler } from "../../src/testing/index.js";
import { defineJob } from "../../src/lib/jobs/define-job.js";

const url = process.env.VEXT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
describe("real Redis conservative lease boundaries", () => {
  it("quarantines all new app admissions after real owner loss without deleting another owner", async () => {
    const client = new Redis(url, { maxRetriesPerRequest: 0 });
    client.on("error", () => {});
    const redis = { client, namespace: `lost-${randomUUID()}`, leaseTtl: 1000 };
    const prefix = resolveVextRedisKeyPrefix({
      ...redis,
      rootDir: process.cwd(),
      module: "job",
    });
    const keys = (name: string) => {
      const tag = createHash("sha256")
        .update(prefix)
        .update("\0")
        .update(name)
        .digest("hex");
      return [
        `{${tag}}:${prefix}${name}:last`,
        `{${tag}}:${prefix}${name}:running`,
      ];
    };
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false,
      bRuns = 0;
    const now = new Date();
    const point = new Date((Math.floor(now.getTime() / 1000) + 1) * 1000);
    const test = await createTestJobScheduler({
      services: false,
      middlewares: false,
      now,
      config: { logger: { level: "silent" }, jobs: { redis } },
      jobs: [
        defineJob({
          name: "a",
          cron: "* * * * * *",
          handler(ctx) {
            started();
            return new Promise<void>((resolve) =>
              ctx.signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  resolve();
                },
                { once: true },
              ),
            );
          },
        }),
        defineJob({
          name: "b",
          cron: "* * * * * *",
          handler() {
            bRuns++;
          },
        }),
      ],
    });
    try {
      await delay(Math.max(0, point.getTime() - Date.now()));
      const work = test.tick(point);
      await entered;
      await client.set(keys("a")[1]!, "different-owner", "PX", 5000);
      await work;
      expect(aborted).toBe(true);
      const before = bRuns;
      await test.tick(new Date(point.getTime() + 1000));
      expect(bRuns).toBe(before);
      expect(await client.get(keys("a")[1]!)).toBe("different-owner");
      expect(await client.ping()).toBe("PONG");
    } finally {
      await test.close();
      await client.del(...keys("a"), ...keys("b"));
      client.disconnect();
    }
  });
  it("abandons a successful but late claim and releases only its own owner", async () => {
    const client = new Redis(url, { maxRetriesPerRequest: 0 });
    client.on("error", () => {});
    const namespace = `late-${randomUUID()}`;
    let delayed = false;
    const proxy = {
      ping: () => client.ping(),
      eval: async (...args: Parameters<Redis["eval"]>) => {
        const result = await client.eval(...args);
        if (args[1] === 2 && !delayed) {
          delayed = true;
          await delay(450);
        }
        return result;
      },
    };
    const config = { client: proxy, namespace, leaseTtl: 1000 };
    const prefix = resolveVextRedisKeyPrefix({
      ...config,
      rootDir: process.cwd(),
      module: "job",
    });
    const tag = createHash("sha256")
      .update(prefix)
      .update("\0")
      .update("late")
      .digest("hex");
    const base = `{${tag}}:${prefix}late`;
    const coordinator = await createJobCoordinator(config, process.cwd());
    try {
      const point = new Date(Date.now() - 10);
      await expect(
        coordinator.claim("late", point, new Date(Date.now() + 60000), false),
      ).rejects.toThrow("timed out");
      await delay(200);
      expect(await client.exists(base + ":running")).toBe(0);
      expect(
        await coordinator.claim(
          "late",
          point,
          new Date(Date.now() + 60000),
          false,
        ),
      ).toBeNull();
    } finally {
      coordinator.close();
      await client.del(base + ":last", base + ":running");
      client.disconnect();
    }
  });
  it("measures real TIME skew as a bounded offset interval without adjusting the clock", async () => {
    const client = new Redis(url, { maxRetriesPerRequest: 0 });
    client.on("error", () => {});
    const events: Array<{
      reason: string;
      offsetMinMs: number;
      offsetMaxMs: number;
      rttMs: number;
    }> = [];
    const coordinator = await createJobCoordinator(
      { client, namespace: `skew-${randomUUID()}` },
      process.cwd(),
      (event) => events.push(event),
    );
    const actual = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(actual + 5000);
    try {
      expect(
        await coordinator.claim(
          "future",
          new Date(actual + 5000),
          new Date(actual + 6000),
          false,
        ),
      ).toBeNull();
      expect(events[0]).toMatchObject({ reason: "server-clock-before-point" });
      expect(events[0]!.offsetMaxMs).toBeLessThan(-1000);
      expect(events[0]!.offsetMinMs).toBeLessThanOrEqual(
        events[0]!.offsetMaxMs,
      );
      expect(events[0]!.rttMs).toBeGreaterThanOrEqual(0);
      expect(Date.now()).toBe(actual + 5000);
    } finally {
      now.mockRestore();
      coordinator.close();
      client.disconnect();
    }
  });
  it.runIf(!!process.env.VEXT_TEST_REDIS_CLUSTER_PORT)(
    "uses the same hash slot on an actual three-master Redis Cluster",
    async () => {
      const port = Number(process.env.VEXT_TEST_REDIS_CLUSTER_PORT);
      const client = new Redis.Cluster([{ host: "127.0.0.1", port }], {
        redisOptions: { maxRetriesPerRequest: 0 },
        clusterRetryStrategy: () => null,
      });
      client.on("error", () => {});
      const namespace = `cluster-${randomUUID()}`;
      const config = { client, namespace, leaseTtl: 1000 };
      const prefix = resolveVextRedisKeyPrefix({
        ...config,
        rootDir: process.cwd(),
        module: "job",
      });
      const tag = createHash("sha256")
        .update(prefix)
        .update("\0")
        .update("sample")
        .digest("hex");
      const base = `{${tag}}:${prefix}sample`;
      const a = await createJobCoordinator(config, process.cwd()),
        b = await createJobCoordinator(config, process.cwd());
      try {
        const at = new Date(Date.now() - 10),
          expires = new Date(Date.now() + 60000);
        const leases = await Promise.all([
          a.claim("sample", at, expires, false),
          b.claim("sample", at, expires, false),
        ]);
        expect(leases.filter(Boolean)).toHaveLength(1);
        expect(await leases.find(Boolean)!.renew!()).toBe(true);
        await leases.find(Boolean)!.release();
        expect(await b.claim("sample", at, expires, false)).toBeNull();
        const master = client.nodes("master")[0]!;
        expect(await master.cluster("keyslot", base + ":last")).toBe(
          await master.cluster("keyslot", base + ":running"),
        );
        expect(client.nodes("master")).toHaveLength(3);
        a.close();
        expect(await client.ping()).toBe("PONG");
      } finally {
        a.close();
        b.close();
        await client.del(base + ":last", base + ":running");
        await client.quit();
      }
    },
  );
});

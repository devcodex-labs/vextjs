import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";
import {
  createJobCoordinator,
  type JobCoordinator,
} from "../../src/lib/jobs/redis-coordinator.js";
import { defineJob } from "../../src/lib/jobs/define-job.js";
import { createTestJobScheduler } from "../../src/testing/index.js";
import { resolveVextRedisKeyPrefix } from "../../src/lib/redis/namespace.js";

const redisUrl =
  process.env.VEXT_TEST_REDIS_URL ??
  process.env.REDIS_URL ??
  "redis://127.0.0.1:6379";

async function withRedis(
  run: (
    client: Redis,
    config: { client: Redis; namespace: string; leaseTtl: number },
    coordinator: JobCoordinator,
    keys: (name: string, prefix?: string) => string[],
  ) => Promise<void>,
) {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
  });
  client.on("error", () => {});
  const config = {
    client,
    namespace: `scheduled-test-${randomUUID()}`,
    leaseTtl: 1000,
  };
  const prefix = resolveVextRedisKeyPrefix({
    ...config,
    rootDir: process.cwd(),
    module: "job",
  });
  const ownedKeys = new Set<string>();
  const keys = (name: string, keyPrefix = prefix) => {
    const tag = createHash("sha256")
      .update(keyPrefix)
      .update("\0")
      .update(name)
      .digest("hex");
    const base = `{${tag}}:${keyPrefix}${encodeURIComponent(name)}`;
    const result = [`${base}:last`, `${base}:running`];
    result.forEach((key) => ownedKeys.add(key));
    return result;
  };
  let coordinator: JobCoordinator | undefined;
  try {
    await client.connect();
    coordinator = await createJobCoordinator(config, process.cwd());
    await run(client, config, coordinator, keys);
  } finally {
    coordinator?.close();
    if (client.status === "ready" && ownedKeys.size)
      await client.del(...ownedKeys);
    client.disconnect();
  }
}

describe("Redis scheduled jobs", () => {
  it("automatically shares namespaces across replicas and isolates projects/profiles/modes", async () => {
    await withRedis(async (client, _config, _coordinator, keys) => {
      const root = await mkdtemp(
        path.join(tmpdir(), "vext-jobs-auto-namespace-"),
      );
      const coordinators: JobCoordinator[] = [];
      try {
        const packageName = `auto-${randomUUID()}`;
        const roots = ["replica-a", "replica-b", "other-app"].map((name) =>
          path.join(root, name),
        );
        for (const [index, directory] of roots.entries()) {
          await mkdir(directory);
          await writeFile(
            path.join(directory, "package.json"),
            JSON.stringify({
              name: index === 2 ? `${packageName}-other` : packageName,
            }),
          );
        }
        vi.stubEnv("VEXT_CONFIG", "production");
        vi.stubEnv("NODE_ENV", "production");
        const point = new Date(Date.now() - 10);
        const expires = new Date(Date.now() + 60000);
        const create = async (directory: string) => {
          const prefix = resolveVextRedisKeyPrefix({
            rootDir: directory,
            module: "job",
          });
          keys("daily", prefix);
          const coordinator = await createJobCoordinator(
            { client, leaseTtl: 1000 },
            directory,
          );
          coordinators.push(coordinator);
          return coordinator;
        };
        const a = await create(roots[0]!);
        const b = await create(roots[1]!);
        const first = await a.claim("daily", point, expires, false);
        expect(first).not.toBeNull();
        await first!.release();
        expect(await b.claim("daily", point, expires, false)).toBeNull();
        const other = await create(roots[2]!);
        const otherLease = await other.claim("daily", point, expires, false);
        expect(otherLease).not.toBeNull();
        await otherLease!.release();
        for (const [profile, mode] of [
          ["staging", "production"],
          ["production", "development"],
        ]) {
          vi.stubEnv("VEXT_CONFIG", profile);
          vi.stubEnv("NODE_ENV", mode);
          const isolated = await create(roots[0]!);
          const lease = await isolated.claim("daily", point, expires, false);
          expect(lease).not.toBeNull();
          await lease!.release();
        }
      } finally {
        coordinators.forEach((coordinator) => coordinator.close());
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  it("admits only one replica and retains deduplication after a quick completion", async () => {
    await withRedis(async (client, config, first, keys) => {
      const second = await createJobCoordinator(config, process.cwd());
      keys("fast");
      const at = new Date(Date.now() - 10);
      const expires = new Date(Date.now() + 60000);
      try {
        const leases = await Promise.all([
          first.claim("fast", at, expires, false),
          second.claim("fast", at, expires, false),
        ]);
        expect(leases.filter(Boolean)).toHaveLength(1);
        await leases.find(Boolean)!.release();
        expect(await second.claim("fast", at, expires, false)).toBeNull();
        expect(await client.get(keys("fast")[0]!)).toBe(String(at.getTime()));
      } finally {
        second.close();
      }
      // The caller owns supplied clients.
      expect(await client.ping()).toBe("PONG");
    });
  });
  it("consumes overlapping points instead of running them after the previous task finishes", async () => {
    await withRedis(async (_client, _config, coordinator, keys) => {
      keys("slow");
      const expires = new Date(Date.now() + 60000);
      const first = await coordinator.claim(
        "slow",
        new Date(Date.now() - 20),
        expires,
        false,
      );
      const nextPoint = new Date(Date.now() - 10);
      expect(
        await coordinator.claim("slow", nextPoint, expires, false),
      ).toBeNull();
      await first!.release();
      expect(
        await coordinator.claim("slow", nextPoint, expires, false),
      ).toBeNull();
    });
  });
  it("does not reclaim the same occurrence after a crash/expired lease", async () => {
    await withRedis(async (_client, _config, coordinator, keys) => {
      keys("crash");
      const at = new Date(Date.now() - 10);
      const expires = new Date(Date.now() + 60000);
      expect(
        await coordinator.claim("crash", at, expires, false),
      ).not.toBeNull();
      await delay(1100);
      expect(await coordinator.claim("crash", at, expires, false)).toBeNull();
      const future = await coordinator.claim(
        "crash",
        new Date(),
        expires,
        false,
      );
      expect(future).not.toBeNull();
      await future!.release();
    });
  });
  it("checks ownership for renewal and release and refuses stale/future points", async () => {
    await withRedis(async (client, _config, coordinator, keys) => {
      const [marker, running] = keys("owner");
      const expires = new Date(Date.now() + 60000);
      expect(
        await coordinator.claim(
          "owner",
          new Date(Date.now() + 10000),
          expires,
          false,
        ),
      ).toBeNull();
      expect(await client.exists(marker!)).toBe(0);
      expect(
        await coordinator.claim(
          "owner",
          new Date(Date.now() - 10000),
          new Date(Date.now() - 1),
          false,
        ),
      ).toBeNull();
      const lease = await coordinator.claim(
        "owner",
        new Date(Date.now() - 10),
        expires,
        false,
      );
      await client.set(running!, "replacement-owner", "PX", 10000);
      expect(await lease!.renew()).toBe(false);
      await lease!.release();
      expect(await client.get(running!)).toBe("replacement-owner");
    });
  });
  it("renews a long running handler and skips it in another replica", async () => {
    await withRedis(async (client, config, _coordinator, keys) => {
      const [, running] = keys("long");
      let executions = 0;
      let finish!: () => void;
      const definition = defineJob({
        name: "long",
        interval: 1000,
        handler() {
          executions++;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      });
      const start = new Date();
      const point = new Date((Math.floor(start.getTime() / 1000) + 1) * 1000);
      const options = {
        services: false,
        middlewares: false,
        now: start,
        config: {
          logger: { level: "silent" as const },
          jobs: { redis: config },
        },
        jobs: [definition],
      };
      const a = await createTestJobScheduler(options);
      const b = await createTestJobScheduler(options);
      let work: Promise<void> | undefined;
      try {
        await delay(Math.max(0, point.getTime() - Date.now()));
        work = a.tick(point);
        await delay(30);
        expect(executions).toBe(1);
        await delay(1100);
        expect(await client.pttl(running!)).toBeGreaterThan(100);
        // Replica b missed its first timer period; advance then test a shared next point.
        await b.tick(new Date(point.getTime() + 1000));
        await a.tick(new Date(point.getTime() + 1000));
        expect(executions).toBe(1);
        finish();
        await work;
        expect(await client.exists(running!)).toBe(0);
      } finally {
        finish?.();
        await work;
        await a.close();
        await b.close();
      }
    });
  });
  it("fails closed on Redis loss and resumes only future periods", async () => {
    await withRedis(async (client, config, _coordinator, keys) => {
      keys("outage");
      let executions = 0;
      const start = new Date();
      const point = new Date((Math.floor(start.getTime() / 1000) + 1) * 1000);
      const test = await createTestJobScheduler({
        services: false,
        middlewares: false,
        now: start,
        config: { logger: { level: "silent" }, jobs: { redis: config } },
        jobs: [
          defineJob({
            name: "outage",
            interval: 1000,
            handler() {
              executions++;
            },
          }),
        ],
      });
      try {
        await delay(Math.max(0, point.getTime() - Date.now()));
        const disconnected = new Promise<void>((resolve) =>
          client.once("end", resolve),
        );
        client.disconnect();
        await disconnected;
        await test.tick(point);
        expect(executions).toBe(0);
        await client.connect();
        const next = new Date(point.getTime() + 1000);
        await delay(Math.max(0, next.getTime() - Date.now()));
        await test.tick(next);
        expect(executions).toBe(1);
        await test.tick(point);
        expect(executions).toBe(1);
      } finally {
        await test.close();
      }
    });
  });
  it("isolates job names without closing caller connections", async () => {
    await withRedis(async (client, _config, coordinator, keys) => {
      const point = new Date(Date.now() - 10);
      const expires = new Date(Date.now() + 60000);
      for (const name of ["one:two", "one.two"]) {
        keys(name);
        const lease = await coordinator.claim(name, point, expires, false);
        expect(lease).not.toBeNull();
        await lease!.release();
      }
      coordinator.close();
      expect(await client.ping()).toBe("PONG");
    });
  });
  it("rejects unavailable Redis at startup", async () => {
    await expect(
      createJobCoordinator({ url: "redis://127.0.0.1:1" }, process.cwd()),
    ).rejects.toThrow("could not connect");
  });
});

import { createHash, randomUUID } from "node:crypto";
import { resolveModuleDefault } from "../interop.js";
import { assertRedisTarget, resolveRedisUrl } from "../redis/config.js";
import { resolveVextRedisKeyPrefix } from "../redis/namespace.js";
import type { VextJobsConfig } from "./types.js";

interface RedisClient {
  eval(
    script: string,
    count: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  ping(): Promise<unknown>;
  disconnect?(): void;
}

// The marker survives release/crash, so a quick handler or an expired lease can
// never make the SAME scheduled point eligible again. No execution history is stored.
const CLAIM = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local point = tonumber(ARGV[1])
if point > now or now >= tonumber(ARGV[2]) then return 0 end
local last = tonumber(redis.call('GET', KEYS[1]) or '-1')
if point <= last then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
if ARGV[5] == '1' or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
return 1`;
const RENEW = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])`;
const RELEASE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`;

export interface JobLease {
  renew(): Promise<boolean>;
  release(): Promise<void>;
}

export interface JobCoordinator {
  ttl: number;
  claim(
    name: string,
    scheduledAt: Date,
    expiresAt: Date,
    skip: boolean,
  ): Promise<JobLease | null>;
  close(): void;
}

export async function createJobCoordinator(
  config: NonNullable<VextJobsConfig["redis"]>,
  rootDir: string,
): Promise<JobCoordinator> {
  assertRedisTarget(config, "config.jobs.redis");
  const ttl = config.leaseTtl ?? 30000;
  if (!Number.isSafeInteger(ttl) || ttl < 1000)
    throw new Error(
      "[vextjs] config.jobs.redis.leaseTtl must be a safe integer >= 1000 ms.",
    );
  const owned = !config.client;
  let client: RedisClient;
  if (owned) {
    const module = await import("ioredis");
    const Redis = resolveModuleDefault(
      module,
    ) as typeof import("ioredis").Redis;
    client = new Redis(resolveRedisUrl(config)!, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 2000,
    });
    // Observe connection errors without leaking credentials through error events.
    (client as InstanceType<typeof Redis>).on("error", () => {});
    try {
      await bounded((client as InstanceType<typeof Redis>).connect());
    } catch {
      client.disconnect?.();
      throw new Error("[vextjs] config.jobs.redis could not connect to Redis.");
    }
  } else {
    client = config.client as RedisClient;
  }
  if (typeof client.eval !== "function" || typeof client.ping !== "function") {
    if (owned) client.disconnect?.();
    throw new Error(
      "[vextjs] config.jobs.redis.client requires eval() and ping() methods.",
    );
  }
  try {
    await bounded(client.ping());
    if (Number(await bounded(client.eval("return 1", 0))) !== 1)
      throw new Error("Unsupported Redis eval contract");
  } catch {
    if (owned) client.disconnect?.();
    throw new Error(
      "[vextjs] config.jobs.redis is unavailable or does not support Lua eval during startup.",
    );
  }
  const prefix = resolveVextRedisKeyPrefix({
    ...config,
    rootDir,
    module: "job",
  });
  let closed = false;
  return {
    ttl,
    async claim(name, scheduledAt, expiresAt, skip) {
      if (closed) return null;
      const tag = createHash("sha256")
        .update(prefix)
        .update("\0")
        .update(name)
        .digest("hex");
      // Both keys share a Redis Cluster hash slot, including custom prefixes.
      const base = `{${tag}}:${prefix}${encodeURIComponent(name)}`;
      const marker = `${base}:last`;
      const running = `${base}:running`;
      const owner = randomUUID();
      const result = await bounded(
        client.eval(
          CLAIM,
          2,
          marker,
          running,
          scheduledAt.getTime(),
          expiresAt.getTime(),
          owner,
          ttl,
          skip ? "1" : "0",
        ),
        Math.min(2000, Math.floor(ttl / 3)),
      );
      if (Number(result) !== 1) return null;
      return {
        async renew() {
          if (closed) return false;
          return (
            Number(
              await bounded(
                client.eval(RENEW, 1, running, owner, ttl),
                Math.min(2000, Math.floor(ttl / 3)),
              ),
            ) === 1
          );
        },
        async release() {
          if (!closed) await bounded(client.eval(RELEASE, 1, running, owner));
        },
      };
    },
    close() {
      closed = true;
      if (owned) client.disconnect?.();
    },
  };
}

function bounded<T>(promise: Promise<T>, timeout = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Redis operation timed out")),
        timeout,
      );
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

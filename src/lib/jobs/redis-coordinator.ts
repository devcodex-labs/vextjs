import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { validateJobLeaseTtl } from "./define-job.js";
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
if point > now then return {-1, now} end
if now >= tonumber(ARGV[2]) then return {-2, now} end
local last = tonumber(redis.call('GET', KEYS[1]) or '-1')
if point <= last then return {0, now} end
redis.call('SET', KEYS[1], ARGV[1])
if ARGV[5] == '1' or redis.call('EXISTS', KEYS[2]) == 1 then return {0, now} end
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
return {1, now}`;
const RENEW = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])`;
const RELEASE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`;

export interface JobLease {
  readonly ttl?: number;
  valid(): boolean;
  /** Synchronous last gate for an IPC permit. It may be consumed only once. */
  start?(): boolean;
  readonly signal?: AbortSignal;
  renew?(): Promise<boolean>;
  release(): Promise<void>;
}

export interface JobCoordinator {
  ttl?: number;
  claim(
    name: string,
    scheduledAt: Date,
    expiresAt: Date,
    skip: boolean,
    leaseTtl?: number,
  ): Promise<JobLease | null>;
  close(): void;
}

export async function createJobCoordinator(
  config: NonNullable<VextJobsConfig["redis"]>,
  rootDir: string,
  observe?: (event: {
    job: string;
    reason: string;
    rttMs: number;
    offsetMinMs: number;
    offsetMaxMs: number;
  }) => void,
): Promise<JobCoordinator> {
  assertRedisTarget(config, "config.jobs.redis");
  const ttl = config.leaseTtl ?? 30000;
  validateJobLeaseTtl(ttl, "config.jobs.redis.leaseTtl");
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
  const inFlight = new Set<string>();
  return {
    ttl,
    async claim(name, scheduledAt, expiresAt, skip, leaseTtl = ttl) {
      validateJobLeaseTtl(leaseTtl);
      if (closed || inFlight.has(name)) return null;
      const effectiveTtl = leaseTtl;
      const budget = Math.min(2000, Math.floor(effectiveTtl / 3));
      const started = performance.now();
      if (!Number.isFinite(started))
        throw new Error("[vextjs] Jobs monotonic clock is unavailable");
      const wallStarted = Date.now();
      let validUntil = started + effectiveTtl;
      let lost = false;
      let lastMono = started;
      const monotonic = () => {
        const value = performance.now();
        if (!Number.isFinite(value) || value < lastMono) lost = true;
        lastMono = value;
        return value;
      };
      const status = (result: unknown) =>
        Number(Array.isArray(result) ? result[0] : result);
      let settled = false;
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
      inFlight.add(name);
      let abandoned = false;
      let raw: Promise<unknown>;
      try {
        raw = Promise.resolve(
          client.eval(
            CLAIM,
            2,
            marker,
            running,
            scheduledAt.getTime(),
            expiresAt.getTime(),
            owner,
            effectiveTtl,
            skip ? "1" : "0",
          ),
        );
      } catch (error) {
        inFlight.delete(name);
        throw error;
      }
      // Keep one unresolved command per Job even after our local timeout.
      // A late success can only release its own token, never restore admission.
      void raw
        .then(
          async (result) => {
            inFlight.delete(name);
            if (status(result) === 1 && abandoned && !closed)
              await bounded(client.eval(RELEASE, 1, running, owner), budget);
          },
          () => {
            inFlight.delete(name);
          },
        )
        .catch(() => {});
      let result: unknown;
      try {
        result = await bounded(raw, budget);
        const now = monotonic();
        if (Array.isArray(result) && Number.isFinite(Number(result[1]))) {
          const serverNow = Number(result[1]);
          observe?.({
            job: name,
            reason:
              status(result) === -1
                ? "server-clock-before-point"
                : status(result) === -2
                  ? "server-window-expired"
                  : status(result) === 1
                    ? "granted"
                    : "consumed-or-busy",
            rttMs: now - started,
            offsetMinMs: serverNow - Date.now(),
            offsetMaxMs: serverNow - wallStarted,
          });
        }
        if (
          closed ||
          lost ||
          now < started ||
          now >= started + budget ||
          now >= validUntil
        ) {
          abandoned = true;
          if (status(result) === 1 && !closed)
            void bounded(client.eval(RELEASE, 1, running, owner), budget).catch(
              () => {},
            );
          return null;
        }
      } catch (error) {
        abandoned = true;
        throw error;
      }
      if (status(result) !== 1) return null;
      return {
        ttl: effectiveTtl,
        valid() {
          const now = monotonic();
          if (now < started || now >= validUntil) lost = true;
          return !closed && !lost && !settled;
        },
        async renew() {
          const renewalStart = monotonic();
          if (
            closed ||
            lost ||
            settled ||
            renewalStart < started ||
            renewalStart >= validUntil
          ) {
            lost = true;
            return false;
          }
          const priorDeadline = validUntil;
          try {
            const renewed = await bounded(
              client.eval(RENEW, 1, running, owner, effectiveTtl),
              budget,
            );
            const now = monotonic();
            if (
              closed ||
              lost ||
              settled ||
              Number(renewed) !== 1 ||
              now < renewalStart ||
              now >= renewalStart + budget ||
              now >= priorDeadline
            ) {
              lost = true;
              return false;
            }
            validUntil = renewalStart + effectiveTtl;
            return true;
          } catch (error) {
            lost = true;
            throw error;
          }
        },
        async release() {
          if (settled) return;
          settled = true;
          if (!closed)
            await bounded(client.eval(RELEASE, 1, running, owner), budget);
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

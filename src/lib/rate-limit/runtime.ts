import { Redis } from "ioredis";
import { RateLimiter, RedisStore, type Store } from "flex-rate-limit";
import type { VextRateLimitConfig } from "../../types/app.js";
import {
  assertRedisTarget,
  resolveRedisUrl,
  resolveVextRedisKeyPrefix,
} from "../redis/index.js";

export interface CreateRateLimitRuntimeOptions {
  rootDir?: string;
  configProfile?: string;
  runtimeMode?: string;
}

export interface VextRateLimitRuntime {
  getLimiter(max: number, windowSec: number): RateLimiter;
  close(): Promise<void>;
}

export function createRateLimitRuntime(
  config: VextRateLimitConfig | undefined,
  options: CreateRateLimitRuntimeOptions = {},
): VextRateLimitRuntime {
  const storeConfig =
    config?.enabled === true ? (config.store ?? "memory") : "memory";
  const limiters = new Map<string, RateLimiter>();
  const sharedStore = createRateLimitStore(storeConfig, options);

  return {
    getLimiter(max, windowSec) {
      const key = `${max}:${windowSec}`;
      let limiter = limiters.get(key);
      if (!limiter) {
        limiter = new RateLimiter({
          windowMs: windowSec * 1000,
          max,
          algorithm: "sliding-window",
          store: sharedStore ?? "memory",
          headers: false,
        });
        limiters.set(key, limiter);
      }
      return limiter;
    },
    async close() {
      if (sharedStore?.close) await sharedStore.close();
    },
  };
}

function createRateLimitStore(
  storeConfig: VextRateLimitConfig["store"],
  options: CreateRateLimitRuntimeOptions,
): Store | undefined {
  if (!storeConfig || storeConfig === "memory") return undefined;
  if (storeConfig === "redis") {
    const target = {};
    assertRedisTarget(target, "config.rateLimit.store");
    const client = new Redis(resolveRedisUrl(target)!);
    return new RedisStore({
      client,
      ownsClient: true,
      prefix: resolveVextRedisKeyPrefix({
        rootDir: options.rootDir,
        module: "rate-limit",
        configProfile: options.configProfile,
        runtimeMode: options.runtimeMode,
      }),
    });
  }

  assertRedisTarget(storeConfig, "config.rateLimit.store");
  const client = storeConfig.client ?? new Redis(resolveRedisUrl(storeConfig)!);
  return new RedisStore({
    client,
    ownsClient: !storeConfig.client,
    prefix: resolveVextRedisKeyPrefix({
      rootDir: options.rootDir,
      module: "rate-limit",
      namespace: storeConfig.namespace,
      keyPrefix: storeConfig.keyPrefix,
      configProfile: options.configProfile,
      runtimeMode: options.runtimeMode,
    }),
  });
}

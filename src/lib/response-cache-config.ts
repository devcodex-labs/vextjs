import type {
  ResponseCacheHubOptions,
  ResponseCacheOptions,
} from "response-cache-kit";
import type { VextCacheConfig } from "../types/app.js";

const RESPONSE_CACHE_NAMESPACE = "vext-route-cache";
const DEFAULT_RESPONSE_CACHE_TTL = 60_000;
const DEFAULT_MEMORY_MAX_ENTRIES = 1000;

export function resolveVextResponseCacheOptions(
  config: VextCacheConfig | undefined,
): ResponseCacheOptions {
  return {
    namespace: RESPONSE_CACHE_NAMESPACE,
    ttl: config?.defaultTtl ?? DEFAULT_RESPONSE_CACHE_TTL,
    cacheHub: resolveVextResponseCacheHubOptions(config),
  };
}

export function resolveVextResponseCacheHubOptions(
  config: VextCacheConfig | undefined,
): ResponseCacheHubOptions {
  if (config?.enabled === false) {
    // Disabling route cache should not open Redis/MultiLevel connections.
    return {
      mode: "memory",
      enabled: false,
      enableStats: true,
    };
  }

  const cacheHub = config?.cacheHub;
  const mode = cacheHub?.mode ?? "memory";

  if (mode === "memory") {
    return {
      mode: "memory",
      maxEntries: config?.maxEntries ?? DEFAULT_MEMORY_MAX_ENTRIES,
      ...(config?.maxMemory !== undefined && { maxMemory: config.maxMemory }),
      ...(config?.cleanupInterval !== undefined && {
        cleanupInterval: config.cleanupInterval,
      }),
      enableStats: true,
      ...(cacheHub as Extract<ResponseCacheHubOptions, { mode?: "memory" }>),
    };
  }

  return cacheHub as ResponseCacheHubOptions;
}

import type {
  VextCacheLike,
  VextCacheSessionStoreOptions,
  VextSessionData,
  VextSessionStore,
  VextSessionStoreSerializer,
} from "../types/session.js";

const DEFAULT_SESSION_CACHE_PREFIX = "vext:session:";

const DEFAULT_SERIALIZER: VextSessionStoreSerializer = {
  serialize(data) {
    return JSON.stringify(data);
  },

  deserialize(value) {
    if (typeof value !== "string") {
      throw new Error(
        "[vextjs] session cache store payload must be a JSON string.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw createValidationError(
        "[vextjs] session cache store payload must be valid JSON.",
        error,
      );
    }

    if (!isPlainSessionData(parsed)) {
      throw new Error(
        "[vextjs] session cache store payload must be a plain object.",
      );
    }

    return parsed;
  },
};

export function createCacheSessionStore(
  cache: VextCacheLike,
  options: VextCacheSessionStoreOptions = {},
): VextSessionStore {
  assertCacheLike(cache);
  const prefix = normalizePrefix(options.prefix);
  const serializer = options.serializer ?? DEFAULT_SERIALIZER;

  const store: VextSessionStore = {
    async get(id) {
      try {
        const raw = await cache.get(keyFor(prefix, id));
        if (raw === undefined) return null;
        const data = serializer.deserialize(raw);
        if (!isPlainSessionData(data)) {
          throw new Error(
            "[vextjs] session cache store deserializer must return a plain object.",
          );
        }
        return { ...data };
      } catch (error) {
        throw createOperationError("get", error);
      }
    },

    async set(id, data, ttlSeconds) {
      const ttlMs = ttlSecondsToMilliseconds(ttlSeconds);
      try {
        const serialized = serializer.serialize({ ...data });
        if (serialized === undefined) {
          throw new Error(
            "[vextjs] session cache store serializer must not return undefined.",
          );
        }
        await cache.set(keyFor(prefix, id), serialized, ttlMs);
      } catch (error) {
        throw createOperationError("set", error);
      }
    },

    async delete(id) {
      try {
        await cache.del(keyFor(prefix, id));
      } catch (error) {
        throw createOperationError("delete", error);
      }
    },

    async touch(id, ttlSeconds) {
      const ttlMs = ttlSecondsToMilliseconds(ttlSeconds);
      try {
        const raw = await cache.get(keyFor(prefix, id));
        if (raw === undefined) return;
        await cache.set(keyFor(prefix, id), raw, ttlMs);
      } catch (error) {
        throw createOperationError("touch", error);
      }
    },
  };

  if (options.close) {
    store.close = async () => {
      try {
        await options.close?.();
      } catch (error) {
        throw createOperationError("close", error);
      }
    };
  }

  return store;
}

function assertCacheLike(cache: VextCacheLike): void {
  if (!cache || typeof cache !== "object") {
    throw new Error("[vextjs] session cache store cache must be an object.");
  }
  if (typeof cache.get !== "function") {
    throw new Error(
      "[vextjs] session cache store cache.get must be a function.",
    );
  }
  if (typeof cache.set !== "function") {
    throw new Error(
      "[vextjs] session cache store cache.set must be a function.",
    );
  }
  if (typeof cache.del !== "function") {
    throw new Error(
      "[vextjs] session cache store cache.del must be a function.",
    );
  }
}

function normalizePrefix(prefix = DEFAULT_SESSION_CACHE_PREFIX): string {
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new Error(
      "[vextjs] session cache store prefix must be a non-empty string.",
    );
  }
  return prefix;
}

function keyFor(prefix: string, id: string): string {
  return `${prefix}${id}`;
}

function ttlSecondsToMilliseconds(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(
      "[vextjs] session cache store ttlSeconds must be a positive finite number.",
    );
  }

  const ttlMs = Math.ceil(ttlSeconds * 1000);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error(
      "[vextjs] session cache store ttlSeconds must produce a safe millisecond ttl.",
    );
  }

  return ttlMs;
}

function isPlainSessionData(value: unknown): value is VextSessionData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createOperationError(operation: string, cause: unknown): Error {
  const error = new Error(`[vextjs] session cache store ${operation} failed.`);
  defineCause(error, cause);
  return error;
}

function createValidationError(message: string, cause: unknown): Error {
  const error = new Error(message);
  defineCause(error, cause);
  return error;
}

function defineCause(error: Error, cause: unknown): void {
  Object.defineProperty(error, "cause", {
    configurable: true,
    value: cause,
  });
}

import { describe, expect, it, vi } from "vitest";
import { createCacheSessionStore } from "../../../src/lib/session-store-adapters.js";
import type { VextCacheLike } from "../../../src/types/session.js";

interface FakeCacheEntry {
  value: unknown;
  ttlMs?: number;
}

function createFakeCache() {
  const entries = new Map<string, FakeCacheEntry>();
  const calls = {
    get: [] as string[],
    set: [] as Array<{ key: string; value: unknown; ttlMs?: number }>,
    del: [] as string[],
  };

  const cache: VextCacheLike = {
    async get(key) {
      calls.get.push(key);
      return entries.get(key)?.value;
    },
    async set(key, value, ttlMs) {
      calls.set.push({ key, value, ttlMs });
      entries.set(key, { value, ttlMs });
    },
    async del(key) {
      calls.del.push(key);
      entries.delete(key);
      return true;
    },
  };

  return { cache, calls, entries };
}

describe("createCacheSessionStore", () => {
  it("rejects invalid cache-like objects and prefixes", () => {
    expect(() => createCacheSessionStore({} as VextCacheLike)).toThrow(
      "cache.get must be a function",
    );

    const { cache } = createFakeCache();
    expect(() => createCacheSessionStore(cache, { prefix: "" })).toThrow(
      "prefix must be a non-empty string",
    );
  });

  it("stores JSON strings with prefixed keys and millisecond TTL", async () => {
    const { cache, calls, entries } = createFakeCache();
    const store = createCacheSessionStore(cache, { prefix: "app:sess:" });

    await store.set("sid-1", { userId: "u1", role: "admin" }, 1.25);

    expect(calls.set).toEqual([
      {
        key: "app:sess:sid-1",
        value: '{"userId":"u1","role":"admin"}',
        ttlMs: 1250,
      },
    ]);
    expect(entries.get("app:sess:sid-1")).toEqual({
      value: '{"userId":"u1","role":"admin"}',
      ttlMs: 1250,
    });
  });

  it("returns null only for undefined cache misses", async () => {
    const { cache } = createFakeCache();
    const store = createCacheSessionStore(cache);

    await expect(store.get("missing")).resolves.toBeNull();
  });

  it("deserializes cache hits into detached plain session data", async () => {
    const { cache, entries } = createFakeCache();
    entries.set("vext:session:sid-1", {
      value: '{"userId":"u1","roles":["admin"]}',
      ttlMs: 60000,
    });
    const store = createCacheSessionStore(cache);

    const first = await store.get("sid-1");
    expect(first).toEqual({ userId: "u1", roles: ["admin"] });
    first!.userId = "changed";

    await expect(store.get("sid-1")).resolves.toEqual({
      userId: "u1",
      roles: ["admin"],
    });
  });

  it("touches existing raw values and ignores missing keys", async () => {
    const { cache, calls, entries } = createFakeCache();
    entries.set("app:sess:sid-1", {
      value: '{"userId":"u1"}',
      ttlMs: 1000,
    });
    const store = createCacheSessionStore(cache, { prefix: "app:sess:" });

    await store.touch!("missing", 5);
    expect(calls.set).toEqual([]);

    await store.touch!("sid-1", 2);
    expect(calls.set).toEqual([
      {
        key: "app:sess:sid-1",
        value: '{"userId":"u1"}',
        ttlMs: 2000,
      },
    ]);
  });

  it("deletes keys through the cache del method", async () => {
    const { cache, calls, entries } = createFakeCache();
    entries.set("vext:session:sid-1", {
      value: '{"userId":"u1"}',
      ttlMs: 60000,
    });
    const store = createCacheSessionStore(cache);

    await store.delete("sid-1");

    expect(calls.del).toEqual(["vext:session:sid-1"]);
    expect(entries.has("vext:session:sid-1")).toBe(false);
  });

  it("supports custom serializers", async () => {
    const { cache, entries } = createFakeCache();
    const serializer = {
      serialize: vi.fn((data) => ({ payload: data })),
      deserialize: vi.fn((value) => (value as { payload: object }).payload),
    };
    const store = createCacheSessionStore(cache, {
      prefix: "custom:",
      serializer,
    });

    await store.set("sid-1", { userId: "u1" }, 60);
    expect(entries.get("custom:sid-1")?.value).toEqual({
      payload: { userId: "u1" },
    });

    await expect(store.get("sid-1")).resolves.toEqual({ userId: "u1" });
  });

  it("exposes close only when the caller provides lifecycle ownership", async () => {
    const { cache } = createFakeCache();
    expect(createCacheSessionStore(cache).close).toBeUndefined();

    const close = vi.fn();
    const store = createCacheSessionStore(cache, { close });
    await store.close!();

    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects invalid ttl values before calling the cache", async () => {
    const { cache, calls } = createFakeCache();
    const store = createCacheSessionStore(cache);

    await expect(store.set("sid-1", {}, 0)).rejects.toThrow(
      "ttlSeconds must be a positive finite number",
    );
    expect(calls.set).toEqual([]);
  });

  it("wraps invalid payload and cache errors without leaking keys or data", async () => {
    const { cache, entries } = createFakeCache();
    entries.set("vext:session:secret-sid", {
      value: "not-json",
      ttlMs: 60000,
    });
    const store = createCacheSessionStore(cache);

    await expect(store.get("secret-sid")).rejects.toThrow(
      "[vextjs] session cache store get failed.",
    );

    const failingStore = createCacheSessionStore({
      get: async () => {
        throw new Error("redis://user:pass@example.internal");
      },
      set: async () => undefined,
      del: async () => undefined,
    });

    await expect(failingStore.get("secret-sid")).rejects.toThrow(
      "[vextjs] session cache store get failed.",
    );
  });
});

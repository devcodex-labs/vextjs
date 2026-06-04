import { describe, expect, it } from "vitest";
import {
  resolveVextResponseCacheHubOptions,
  resolveVextResponseCacheOptions,
} from "../../src/lib/response-cache-config.js";

describe("resolveVextResponseCacheOptions", () => {
  it("uses Memory defaults when cache config is absent", () => {
    expect(resolveVextResponseCacheOptions(undefined)).toEqual({
      namespace: "vext-route-cache",
      ttl: 60_000,
      cacheHub: {
        mode: "memory",
        maxEntries: 1000,
        enableStats: true,
      },
    });
  });

  it("maps legacy Memory shorthand into cacheHub options", () => {
    expect(
      resolveVextResponseCacheHubOptions({
        defaultTtl: 2_000,
        maxEntries: 50,
        maxMemory: 1024,
        cleanupInterval: 500,
      }),
    ).toEqual({
      mode: "memory",
      maxEntries: 50,
      maxMemory: 1024,
      cleanupInterval: 500,
      enableStats: true,
    });
  });

  it("lets cacheHub Memory fields override legacy shorthand", () => {
    expect(
      resolveVextResponseCacheHubOptions({
        maxEntries: 50,
        cacheHub: {
          mode: "memory",
          maxEntries: 10,
          enableStats: false,
        },
      }),
    ).toEqual({
      mode: "memory",
      maxEntries: 10,
      enableStats: false,
    });
  });

  it("passes Redis runtime config through without adding Memory shortcuts", () => {
    const cacheHub = {
      mode: "redis" as const,
      url: "redis://localhost:6379",
      lease: { waitForOwner: 1_000, onTimeout: "fetch" as const },
      distributed: { channel: "vext:response-cache" },
    };

    expect(
      resolveVextResponseCacheOptions({
        defaultTtl: 2_000,
        maxEntries: 50,
        cacheHub,
      }),
    ).toEqual({
      namespace: "vext-route-cache",
      ttl: 2_000,
      cacheHub,
    });
  });

  it("passes MultiLevel runtime config through", () => {
    const cacheHub = {
      mode: "multi-level" as const,
      memory: { maxEntries: 100 },
      redis: { url: "redis://localhost:6379" },
      writePolicy: "both" as const,
      backfillOnRemoteHit: true,
      remoteTimeout: 50,
      lease: true,
    };

    expect(resolveVextResponseCacheHubOptions({ cacheHub })).toBe(cacheHub);
  });

  it("disables the runtime without opening Redis when global cache is disabled", () => {
    expect(
      resolveVextResponseCacheHubOptions({
        enabled: false,
        cacheHub: {
          mode: "redis",
          url: "redis://localhost:6379",
        },
      }),
    ).toEqual({
      mode: "memory",
      enabled: false,
      enableStats: true,
    });
  });
});

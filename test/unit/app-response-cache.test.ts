import { beforeEach, describe, expect, it, vi } from "vitest";

const responseCacheMock = vi.hoisted(() => {
  const close = vi.fn();
  const cache = {
    invalidateTag: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    stats: vi.fn(() => ({ entries: 0, hits: 0, misses: 0, hitRate: 0 })),
    getStore: vi.fn(),
    handle: vi.fn(),
    makeKey: vi.fn(),
    getRemainingTtl: vi.fn(),
    close,
  };
  const createResponseCache = vi.fn(() => cache);
  return { cache, close, createResponseCache };
});

vi.mock("response-cache-kit", () => ({
  createResponseCache: responseCacheMock.createResponseCache,
}));

import { createApp, DEFAULT_CONFIG } from "../../src/lib/app.js";

describe("createApp response cache runtime", () => {
  beforeEach(() => {
    responseCacheMock.close.mockReset();
    responseCacheMock.createResponseCache.mockClear();
  });

  it("creates response-cache-kit with resolved cacheHub options", () => {
    createApp({
      ...DEFAULT_CONFIG,
      cache: {
        defaultTtl: 2_000,
        cacheHub: {
          mode: "redis",
          url: "redis://localhost:6379",
          lease: { waitForOwner: 1_000 },
        },
      },
    });

    expect(responseCacheMock.createResponseCache).toHaveBeenCalledWith({
      namespace: "vext-route-cache",
      ttl: 2_000,
      cacheHub: {
        mode: "redis",
        url: "redis://localhost:6379",
        lease: { waitForOwner: 1_000 },
      },
    });
  });

  it("closes response cache runtime after user onClose hooks", async () => {
    const order: string[] = [];
    responseCacheMock.close.mockImplementation(async () => {
      order.push("response-cache");
    });

    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      _testMode: true,
    });
    app.onClose(() => {
      order.push("user-close");
    });

    await internals.shutdown(undefined, { skipExit: true });

    expect(order).toEqual(["user-close", "response-cache"]);
    expect(responseCacheMock.close).toHaveBeenCalledTimes(1);
  });
});

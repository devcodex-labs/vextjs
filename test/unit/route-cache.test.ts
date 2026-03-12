/**
 * route-cache 缓存中间件单元测试
 *
 * 测试覆盖：
 *   - normalizeCacheOptions：false / number / object / ttl<=0 / undefined
 *   - defaultCacheKey：静态路径 / 动态参数 / query 排序 / vary headers / 空 query
 *   - 缓存中间件：HIT 返回缓存 / MISS 走 handler / condition 跳过 / 空 key 跳过
 *   - X-Cache 响应头：HIT / MISS
 *   - Cache-Control 响应头
 *   - 204 不缓存
 *   - 非 2xx 不缓存
 *
 * @see 15-route-cache.md §10.2
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeCacheOptions,
  defaultCacheKey,
  buildRouteCacheMiddleware,
} from "../../src/lib/middlewares/route-cache.js";
import { MemoryCacheStore } from "../../src/lib/cache/memory-store.js";
import type { VextRequest } from "../../src/types/request.js";
import type { VextResponse } from "../../src/types/response.js";

// ── 测试辅助 ────────────────────────────────────────────────

/**
 * 创建 mock VextRequest
 */
function createMockReq(overrides: Partial<VextRequest> = {}): VextRequest {
  return {
    method: "GET",
    path: "/products",
    url: "/products",
    query: {},
    body: undefined,
    params: {},
    headers: {},
    requestId: "test-req-id",
    ip: "127.0.0.1",
    protocol: "http",
    app: {} as any,
    valid: vi.fn(),
    ...overrides,
  } as VextRequest;
}

/**
 * 创建 mock VextResponse（追踪 json/setHeader 调用）
 */
function createMockRes(): VextResponse & {
  _jsonCalls: Array<{ data: unknown; status?: number }>;
  _headerCalls: Array<{ name: string; value: string }>;
  _statusVal: number;
} {
  const res: any = {
    _jsonCalls: [],
    _headerCalls: [],
    _statusVal: 200,
    _onSend: undefined,
    json(data: unknown, status?: number) {
      // 模拟 _onSend 调用（在 adapter 中的行为）
      const finalStatus = status ?? res._statusVal;
      if (res._onSend) {
        res._onSend(data, finalStatus);
      }
      res._jsonCalls.push({ data, status: finalStatus });
    },
    rawJson(data: unknown, status?: number) {
      res._jsonCalls.push({ data, status });
    },
    text(_content: string, _status?: number) {},
    stream(_readable: any, _contentType?: string) {},
    download(_readable: any, _filename: string, _contentType?: string) {},
    redirect(_url: string, _status?: number) {},
    status(code: number) {
      res._statusVal = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headerCalls.push({ name, value });
      return res;
    },
    get statusCode() {
      return res._statusVal;
    },
    _enableWrap() {},
  };
  return res;
}

// ── normalizeCacheOptions 测试 ────────────────────────────

describe("normalizeCacheOptions", () => {
  it("undefined → null", () => {
    expect(normalizeCacheOptions(undefined)).toBeNull();
  });

  it("false → null", () => {
    expect(normalizeCacheOptions(false)).toBeNull();
  });

  it("0 → null", () => {
    expect(normalizeCacheOptions(0)).toBeNull();
  });

  it("负数 → null", () => {
    expect(normalizeCacheOptions(-5)).toBeNull();
  });

  it("正数 → { ttl: number }", () => {
    const result = normalizeCacheOptions(60);
    expect(result).toEqual({ ttl: 60 });
  });

  it("对象形式正常返回", () => {
    const opts = { ttl: 300, vary: ["accept-language"] as string[] };
    const result = normalizeCacheOptions(opts);
    expect(result).toEqual(opts);
  });

  it("对象形式 ttl <= 0 → null", () => {
    expect(normalizeCacheOptions({ ttl: 0 })).toBeNull();
    expect(normalizeCacheOptions({ ttl: -1 })).toBeNull();
  });

  it("对象形式 ttl 未设置时使用 globalDefaultTtl", () => {
    const result = normalizeCacheOptions({ ttl: 0 as any, vary: [] }, 120);
    // ttl=0 → will use globalDefaultTtl if ttl is falsy
    expect(result).toEqual({ ttl: 120, vary: [] });
  });
});

// ── defaultCacheKey 测试 ──────────────────────────────────

describe("defaultCacheKey", () => {
  it("静态路径", () => {
    const req = createMockReq({ method: "GET", path: "/products" });
    expect(defaultCacheKey(req, [])).toBe("GET:/products");
  });

  it("动态参数路径（已解析）", () => {
    const req = createMockReq({
      method: "GET",
      path: "/products/42",
      params: { id: "42" },
    });
    expect(defaultCacheKey(req, [])).toBe("GET:/products/42");
  });

  it("query 参数排序", () => {
    const req = createMockReq({
      query: { b: "2", a: "1" },
    });
    expect(defaultCacheKey(req, [])).toBe("GET:/products?a=1&b=2");
  });

  it("空 query 无问号", () => {
    const req = createMockReq({ query: {} });
    expect(defaultCacheKey(req, [])).toBe("GET:/products");
  });

  it("vary headers", () => {
    const req = createMockReq({
      headers: { "accept-language": "zh-CN" },
    });
    expect(defaultCacheKey(req, ["accept-language"])).toBe(
      "GET:/products|accept-language=zh-CN",
    );
  });

  it("vary header 不存在时值为空", () => {
    const req = createMockReq({ headers: {} });
    expect(defaultCacheKey(req, ["accept-encoding"])).toBe(
      "GET:/products|accept-encoding=",
    );
  });

  it("query + vary 组合", () => {
    const req = createMockReq({
      method: "GET",
      path: "/api/items",
      query: { page: "1" },
      headers: { "accept-language": "en" },
    });
    expect(defaultCacheKey(req, ["accept-language"])).toBe(
      "GET:/api/items?page=1|accept-language=en",
    );
  });

  it("POST 方法", () => {
    const req = createMockReq({ method: "POST", path: "/data" });
    expect(defaultCacheKey(req, [])).toBe("POST:/data");
  });
});

// ── buildRouteCacheMiddleware 测试 ────────────────────────

describe("buildRouteCacheMiddleware", () => {
  let store: MemoryCacheStore;

  beforeEach(() => {
    store = new MemoryCacheStore({ maxEntries: 100 });
  });

  it("cacheOpts 为 null 时返回 null", () => {
    const middleware = buildRouteCacheMiddleware(null, () => store);
    expect(middleware).toBeNull();
  });

  it("MISS 时应调用 next 并设置 X-Cache: MISS", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;
    expect(middleware).not.toBeNull();

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._headerCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "X-Cache", value: "MISS" }),
      ]),
    );
  });

  it("MISS 时应注册 _onSend 钩子", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(req, res, next);

    expect(res._onSend).toBeDefined();
  });

  it("MISS → handler 调用 json() → 触发 _onSend → 缓存写入", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn(async () => {
      // 模拟 handler 调用 res.json()
      res.json({ products: [1, 2, 3] });
    });

    await middleware(req, res, next);

    // 缓存应被写入
    const cached = store.get("GET:/products");
    expect(cached).not.toBeNull();
    expect(cached!.body).toEqual({ products: [1, 2, 3] });
    expect(cached!.statusCode).toBe(200);
  });

  it("HIT 时应直接返回缓存数据并设置 X-Cache: HIT", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    // 第一次请求：MISS → 写入缓存
    const req1 = createMockReq();
    const res1 = createMockRes();
    const next1 = vi.fn(async () => {
      res1.json({ products: [1, 2, 3] });
    });
    await middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    // 第二次请求：HIT
    const req2 = createMockReq();
    const res2 = createMockRes();
    const next2 = vi.fn();
    await middleware(req2, res2, next2);

    // next 不应被调用（HIT 跳过 handler）
    expect(next2).not.toHaveBeenCalled();
    // X-Cache: HIT
    expect(res2._headerCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "X-Cache", value: "HIT" }),
      ]),
    );
    // 应调用 res.json() 返回缓存数据
    expect(res2._jsonCalls.length).toBe(1);
    expect(res2._jsonCalls[0]!.data).toEqual({ products: [1, 2, 3] });
  });

  it("condition 返回 false 时应跳过缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60, condition: (req) => !req.query.refresh },
      () => store,
    )!;

    const req = createMockReq({ query: { refresh: "1" } });
    const res = createMockRes();
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(req, res, next);

    // 应直接调用 next，不走缓存
    expect(next).toHaveBeenCalled();
    // 不应设置 X-Cache
    expect(
      res._headerCalls.find((h) => h.name === "X-Cache"),
    ).toBeUndefined();
    // 不应注册 _onSend
    expect(res._onSend).toBeUndefined();
  });

  it("自定义 key 函数空字符串时应跳过缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60, key: () => "" },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._onSend).toBeUndefined();
  });

  it("204 响应不应被缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn(async () => {
      res.json(null, 204);
    });

    await middleware(req, res, next);

    const cached = store.get("GET:/products");
    expect(cached).toBeNull();
  });

  it("非 2xx 响应不应被缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn(async () => {
      res.json({ error: "not found" }, 404);
    });

    await middleware(req, res, next);

    const cached = store.get("GET:/products");
    expect(cached).toBeNull();
  });

  it("Cache-Control 响应头应正确设置", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 120 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn(async () => {
      res.json({ data: "test" });
    });

    await middleware(req, res, next);

    const ccHeader = res._headerCalls.find(
      (h) => h.name === "Cache-Control",
    );
    expect(ccHeader).toBeDefined();
    expect(ccHeader!.value).toBe("public, max-age=120");
  });

  it("cacheControl=false 时不设置 Cache-Control", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60, cacheControl: false },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn(async () => {
      res.json({ data: "test" });
    });

    await middleware(req, res, next);

    const ccHeader = res._headerCalls.find(
      (h) => h.name === "Cache-Control",
    );
    expect(ccHeader).toBeUndefined();
  });

  it("HIT 时 Cache-Control 显示剩余时间", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const middleware = buildRouteCacheMiddleware(
      { ttl: 120 },
      () => store,
    )!;

    // MISS → 写入缓存
    const req1 = createMockReq();
    const res1 = createMockRes();
    await middleware(req1, res1, vi.fn(async () => {
      res1.json({ data: "cached" });
    }));

    // 30 秒后 HIT
    vi.setSystemTime(now + 30_000);
    const req2 = createMockReq();
    const res2 = createMockRes();
    await middleware(req2, res2, vi.fn());

    const ccHeader = res2._headerCalls.find(
      (h) => h.name === "Cache-Control",
    );
    expect(ccHeader).toBeDefined();
    expect(ccHeader!.value).toBe("public, max-age=90"); // 120 - 30

    vi.useRealTimers();
  });

  it("tags 应传递到缓存条目", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60, tags: ["products", "catalog"] },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    await middleware(req, res, vi.fn(async () => {
      res.json({ data: "test" });
    }));

    const cached = store.get("GET:/products");
    expect(cached).not.toBeNull();
    expect(cached!.tags).toEqual(["products", "catalog"]);

    // invalidateByTag 应生效
    store.invalidateByTag("products");
    expect(store.get("GET:/products")).toBeNull();
  });

  it("vary headers 应影响缓存 key", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60, vary: ["accept-language"] },
      () => store,
    )!;

    // 中文请求
    const req1 = createMockReq({
      headers: { "accept-language": "zh-CN" },
    });
    const res1 = createMockRes();
    await middleware(req1, res1, vi.fn(async () => {
      res1.json({ lang: "zh-CN" });
    }));

    // 英文请求（不同 key）
    const req2 = createMockReq({
      headers: { "accept-language": "en-US" },
    });
    const res2 = createMockRes();
    const next2 = vi.fn(async () => {
      res2.json({ lang: "en-US" });
    });
    await middleware(req2, res2, next2);

    // 英文请求应 MISS（不同 key）
    expect(next2).toHaveBeenCalled();

    // 中文请求再次访问应 HIT
    const req3 = createMockReq({
      headers: { "accept-language": "zh-CN" },
    });
    const res3 = createMockRes();
    const next3 = vi.fn();
    await middleware(req3, res3, next3);

    expect(next3).not.toHaveBeenCalled();
    expect(res3._jsonCalls[0]!.data).toEqual({ lang: "zh-CN" });
  });

  it("自定义 key 函数应被使用", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60, key: (req) => `custom:${req.params.id}` },
      () => store,
    )!;

    const req = createMockReq({ params: { id: "42" } });
    const res = createMockRes();
    await middleware(req, res, vi.fn(async () => {
      res.json({ id: 42 });
    }));

    const cached = store.get("custom:42");
    expect(cached).not.toBeNull();
    expect(cached!.body).toEqual({ id: 42 });
  });

  // ── 补充边界场景 ─────────────────────────────────────────

  it("handler 不调用任何发送方法 → 不缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(req, res, next);

    // _onSend 已注册但未触发，不应有缓存
    const cached = store.get("GET:/products");
    expect(cached).toBeNull();
  });

  it("handler 抛出异常应传播错误（不缓存）", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn(async () => {
      throw new Error("handler error");
    });

    await expect(middleware(req, res, next)).rejects.toThrow("handler error");

    // 不应缓存
    const cached = store.get("GET:/products");
    expect(cached).toBeNull();
  });

  it("HIT 返回非 200 状态码（如 201）应正确传递", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    // MISS → 写入 201 缓存
    const req1 = createMockReq();
    const res1 = createMockRes();
    await middleware(req1, res1, vi.fn(async () => {
      res1.json({ id: 1, created: true }, 201);
    }));

    // HIT → 应返回 201
    const req2 = createMockReq();
    const res2 = createMockRes();
    await middleware(req2, res2, vi.fn());

    expect(res2._jsonCalls[0]!.status).toBe(201);
    expect(res2._jsonCalls[0]!.data).toEqual({ id: 1, created: true });
  });

  it("异步 CacheStore 应正确处理（get 返回 Promise）", async () => {
    const asyncStore: any = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      invalidateByTag: vi.fn(),
      clear: vi.fn(),
    };

    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => asyncStore,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn(async () => {
      res.json({ async: true });
    });

    await middleware(req, res, next);

    // async store.get 应被调用
    expect(asyncStore.get).toHaveBeenCalledWith("GET:/products");
    // next 应被调用（MISS）
    expect(next).toHaveBeenCalled();
  });

  it("异步 CacheStore 的 set 返回 rejected Promise 应静默忽略", async () => {
    const asyncStore: any = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn().mockRejectedValue(new Error("write failed")),
      delete: vi.fn(),
      invalidateByTag: vi.fn(),
      clear: vi.fn(),
    };

    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => asyncStore,
    )!;

    const req = createMockReq();
    const res = createMockRes();

    // 不应抛出异常
    await expect(
      middleware(req, res, vi.fn(async () => {
        res.json({ data: "test" });
      })),
    ).resolves.not.toThrow();
  });

  it("异步 CacheStore 的 HIT 路径", async () => {
    const cachedEntry = {
      body: { cached: true },
      statusCode: 200,
      cachedAt: Date.now(),
      tags: [],
    };

    const asyncStore: any = {
      get: vi.fn().mockResolvedValue(cachedEntry),
      set: vi.fn(),
      delete: vi.fn(),
      invalidateByTag: vi.fn(),
      clear: vi.fn(),
    };

    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => asyncStore,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    // 应 HIT
    expect(next).not.toHaveBeenCalled();
    expect(res._jsonCalls[0]!.data).toEqual({ cached: true });
    expect(
      res._headerCalls.find((h) => h.name === "X-Cache"),
    ).toEqual({ name: "X-Cache", value: "HIT" });
  });

  it("多个 vary headers 应全部包含在 key 中", () => {
    const req = createMockReq({
      headers: {
        "accept-language": "zh-CN",
        "accept-encoding": "gzip",
      },
    });
    const key = defaultCacheKey(req, ["accept-language", "accept-encoding"]);
    expect(key).toBe(
      "GET:/products|accept-language=zh-CN|accept-encoding=gzip",
    );
  });

  it("1xx 状态码不应被缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    await middleware(req, res, vi.fn(async () => {
      res.json(null, 100);
    }));

    expect(store.get("GET:/products")).toBeNull();
  });

  it("3xx 状态码不应被缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    await middleware(req, res, vi.fn(async () => {
      res.json({ redirect: true }, 301);
    }));

    expect(store.get("GET:/products")).toBeNull();
  });

  it("5xx 状态码不应被缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60 },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    await middleware(req, res, vi.fn(async () => {
      res.json({ error: "internal" }, 500);
    }));

    expect(store.get("GET:/products")).toBeNull();
  });

  it("condition 返回 true 时应正常走缓存", async () => {
    const middleware = buildRouteCacheMiddleware(
      { ttl: 60, condition: () => true },
      () => store,
    )!;

    const req = createMockReq();
    const res = createMockRes();
    await middleware(req, res, vi.fn(async () => {
      res.json({ data: "test" });
    }));

    // 应注册 _onSend
    expect(
      res._headerCalls.find((h) => h.name === "X-Cache"),
    ).toEqual({ name: "X-Cache", value: "MISS" });
  });
});

// ── normalizeCacheOptions 补充测试 ────────────────────────

describe("normalizeCacheOptions 补充", () => {
  it("对象形式 ttl 未设置且无 globalDefaultTtl → null", () => {
    // ttl=0, falsy → no global → null
    expect(normalizeCacheOptions({ ttl: 0 })).toBeNull();
  });

  it("对象形式 ttl 为正数 + globalDefaultTtl → 使用对象自身 ttl", () => {
    const result = normalizeCacheOptions({ ttl: 30 }, 120);
    expect(result).toEqual({ ttl: 30 });
  });

  it("小数 TTL 应正常处理", () => {
    const result = normalizeCacheOptions(0.5);
    expect(result).toEqual({ ttl: 0.5 });
  });

  it("极大 TTL 值应正常处理", () => {
    const result = normalizeCacheOptions(86400);
    expect(result).toEqual({ ttl: 86400 });
  });

  it("对象形式带所有可选字段应保留", () => {
    const opts = {
      ttl: 60,
      vary: ["accept-language"],
      tags: ["products"],
      cacheControl: false,
      store: "redis",
      swr: 10,
    };
    const result = normalizeCacheOptions(opts as any);
    expect(result).toEqual(opts);
  });
});


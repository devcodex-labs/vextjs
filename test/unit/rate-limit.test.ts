import { describe, expect, it, vi } from "vitest";
import { createRateLimitMiddleware } from "../../src/lib/middlewares/rate-limit.js";
import type { VextRequest } from "../../src/types/request.js";
import type { VextResponse } from "../../src/types/response.js";

function createMockReq(routeOptions?: Record<string, unknown>): VextRequest {
  return {
    ip: "127.0.0.1",
    requestId: "req-1",
    _routeOptions: routeOptions,
  } as unknown as VextRequest;
}

function createMockRes(): VextResponse & {
  headers: Map<string, string>;
  rawJson: ReturnType<typeof vi.fn>;
} {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name, value);
      return this;
    },
    rawJson: vi.fn(),
  } as unknown as VextResponse & {
    headers: Map<string, string>;
    rawJson: ReturnType<typeof vi.fn>;
  };
}

describe("createRateLimitMiddleware", () => {
  it("skips rate limiting when route override is false", async () => {
    const middleware = createRateLimitMiddleware(
      { enabled: true, max: 1, window: 60 },
      () => null,
    );
    const req = createMockReq({ override: { rateLimit: false } });
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers.has("RateLimit-Limit")).toBe(false);
    expect(res.rawJson).not.toHaveBeenCalled();
  });

  it("applies route-level max/window override", async () => {
    const middleware = createRateLimitMiddleware(
      { enabled: true, max: 100, window: 60 },
      () => null,
    );
    const routeOptions = { override: { rateLimit: { max: 1, window: 60 } } };

    const firstRes = createMockRes();
    await middleware(createMockReq(routeOptions), firstRes, vi.fn());
    expect(firstRes.headers.get("RateLimit-Limit")).toBe("1");
    expect(firstRes.rawJson).not.toHaveBeenCalled();

    const secondRes = createMockRes();
    await middleware(createMockReq(routeOptions), secondRes, vi.fn());

    expect(secondRes.headers.get("RateLimit-Limit")).toBe("1");
    expect(secondRes.rawJson).toHaveBeenCalledWith(
      {
        code: 429,
        message: "Too Many Requests",
        requestId: "req-1",
      },
      429,
    );
  });
});

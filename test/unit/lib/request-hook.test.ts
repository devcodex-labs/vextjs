import { describe, expect, it, vi } from "vitest";
import { createHookManager } from "../../../src/lib/hooks.js";
import {
  createRequestHookMiddleware,
  emitNotFoundRequestHooks,
} from "../../../src/lib/middlewares/request-hook.js";
import type { VextRequest } from "../../../src/types/request.js";

function createReq(overrides: Partial<VextRequest> = {}): VextRequest {
  return {
    requestId: "req-1",
    method: "GET",
    url: "/users",
    path: "/users",
    route: "/users",
    query: {},
    params: {},
    headers: {},
    body: undefined,
    app: {} as any,
    ip: "127.0.0.1",
    protocol: "http",
    valid: vi.fn(),
    onClose: vi.fn(),
    _getRawBody: vi.fn(),
    _getRawBodyBuffer: vi.fn(),
    ...overrides,
  };
}

describe("request hook middleware", () => {
  it("passes through without creating a request hook lifecycle when unobserved", async () => {
    const hooks = createHookManager();
    const next = vi.fn(async () => undefined);

    await createRequestHookMiddleware(hooks)(createReq(), {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("emits request:start for matched requests before next", async () => {
    const hooks = createHookManager();
    const onStart = vi.fn();
    const next = vi.fn();
    hooks.on("request:start", onStart);

    await createRequestHookMiddleware(hooks)(createReq(), {} as any, next);

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        method: "GET",
        path: "/users",
        matched: true,
      }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("observes listeners registered after the middleware is created", async () => {
    const hooks = createHookManager();
    const middleware = createRequestHookMiddleware(hooks);
    const onStart = vi.fn();

    await middleware(createReq(), {} as any, vi.fn());
    hooks.on("request:start", onStart);
    await middleware(createReq(), {} as any, vi.fn());

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("emits request:start and route:notFound for notFound requests", async () => {
    const hooks = createHookManager();
    const onStart = vi.fn();
    const onNotFound = vi.fn();
    hooks.on("request:start", onStart);
    hooks.on("route:notFound", onNotFound);

    await emitNotFoundRequestHooks(hooks, createReq({ path: "/missing" }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/missing", matched: false }),
    );
    expect(onNotFound).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/missing", requestId: "req-1" }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { createHookManager } from "../../../src/lib/hooks.js";
import { buildValidateMiddleware } from "../../../src/lib/validate-middleware.js";
import { VextValidationError } from "../../../src/types/errors.js";
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
    cookies: {},
    cookie: vi.fn(),
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

describe("buildValidateMiddleware hooks", () => {
  it("emits validation:success after all configured locations pass", async () => {
    const hooks = createHookManager();
    const onSuccess = vi.fn();
    hooks.on("validation:success", onSuccess);
    const middleware = buildValidateMiddleware(
      { query: { page: "number" } },
      () => ({
        compile: () => () => ({ valid: true, data: { page: 1 } }),
      }),
      hooks,
      { method: "GET", path: "/users" },
    )!;
    const next = vi.fn();

    await middleware(createReq({ query: { page: "1" } }), {} as any, next);

    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        route: { method: "GET", path: "/users" },
        locationResults: [{ location: "query", data: { page: 1 } }],
        requestId: "req-1",
      }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("emits validation:error and throws VextValidationError on failure", async () => {
    const hooks = createHookManager();
    const onError = vi.fn();
    hooks.on("validation:error", onError);
    const middleware = buildValidateMiddleware(
      { body: { name: "string!" } },
      () => ({
        compile: () => () => ({
          valid: false,
          errors: [{ field: "name", message: "Required" }],
        }),
      }),
      hooks,
      { method: "POST", path: "/users" },
    )!;

    await expect(
      middleware(createReq({ method: "POST", body: {} }), {} as any, vi.fn()),
    ).rejects.toBeInstanceOf(VextValidationError);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        route: { method: "POST", path: "/users" },
        errors: [{ field: "name", message: "Required" }],
        requestId: "req-1",
      }),
    );
  });

  it("validates cookie data and stores validated cookie result", async () => {
    const middleware = buildValidateMiddleware(
      { cookie: { sid: "string!" } },
      () => ({
        compile: () => (data: unknown) => ({
          valid: true,
          data: { sid: (data as Record<string, string>).sid },
        }),
      }),
    )!;
    const req = createReq({ cookies: { sid: "abc" } });
    const next = vi.fn();

    await middleware(req, {} as any, next);

    expect((req as any)._validated_cookie).toEqual({ sid: "abc" });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  assertRouteAuth,
  auth,
  createAnonymousAuthContext,
  createAuthContextMiddleware,
  createAuthMiddleware,
  setRequestAuth,
} from "../../../src/lib/auth.js";
import { requestContext } from "../../../src/lib/request-context.js";
import { HttpError } from "../../../src/types/errors.js";
import type { RouteOptions } from "../../../src/types/app.js";
import type { VextCookieJar } from "../../../src/types/cookies.js";
import type { VextRequest } from "../../../src/types/request.js";
import type { VextResponse } from "../../../src/types/response.js";

function createReq(options: {
  headers?: Record<string, string | undefined>;
  cookies?: VextCookieJar;
  session?: Record<string, unknown>;
  routeOptions?: RouteOptions;
} = {}): VextRequest {
  const cookies = options.cookies ?? {};
  return {
    requestId: "req-auth",
    method: "GET",
    url: "/secure",
    path: "/secure",
    route: "/secure",
    query: {},
    params: {},
    headers: options.headers ?? {},
    cookies,
    cookie(name: string) {
      return cookies[name];
    },
    csrfToken() {
      throw new Error("csrf middleware not attached");
    },
    auth: createAnonymousAuthContext(),
    body: undefined,
    app: { config: {} } as any,
    ip: "127.0.0.1",
    protocol: "http",
    valid: vi.fn(),
    onClose: vi.fn(),
    session: options.session as any,
    _routeOptions: options.routeOptions,
    _getRawBody: vi.fn(),
    _getRawBodyBuffer: vi.fn(),
  } as VextRequest;
}

const res = {} as VextResponse;

function expectHttpError(error: unknown, code: string, status: number): void {
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).code).toBe(code);
  expect((error as HttpError).status).toBe(status);
}

async function expectRejectsHttpError(
  promise: Promise<unknown>,
  code: string,
  status: number,
): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expectHttpError(error, code, status);
}

describe("auth middleware and route guard", () => {
  it("exports auth as createAuthMiddleware alias", () => {
    expect(auth).toBe(createAuthMiddleware);
  });

  it("keeps anonymous auth context when no credential is present", async () => {
    const req = createReq();
    const middleware = createAuthMiddleware({
      verify: vi.fn(),
    });

    await middleware(req, res, async () => {
      expect(req.auth.isAuthenticated).toBe(false);
      expect(req.auth.roles).toEqual([]);
    });
  });

  it("sets authenticated bearer context and requestContext safe snapshot", async () => {
    const req = createReq({
      headers: { authorization: "Bearer token-1" },
    });
    const middleware = createAuthMiddleware({
      provider: "unit",
      verify: async (token) => ({
        subject: token,
        userId: "u1",
        roles: ["admin", "admin"],
        scopes: ["posts:write"],
        claims: { secret: "claim" },
      }),
    });

    await requestContext.run({ requestId: "req-auth" }, async () => {
      await middleware(req, res, async () => undefined);
      expect(req.auth).toMatchObject({
        isAuthenticated: true,
        subject: "token-1",
        userId: "u1",
        roles: ["admin"],
        scopes: ["posts:write"],
        scheme: "bearer",
        provider: "unit",
      });
      expect(requestContext.getStore()?.auth).toEqual({
        isAuthenticated: true,
        subject: "token-1",
        userId: "u1",
        roles: ["admin"],
        scopes: ["posts:write"],
        scheme: "bearer",
        provider: "unit",
      });
      expect(requestContext.getStore()?.auth).not.toHaveProperty("claims");
    });
  });

  it("marks malformed bearer credentials as AUTH_INVALID", async () => {
    const req = createReq({ headers: { authorization: "Token nope" } });

    await createAuthMiddleware({ verify: vi.fn() })(req, res, async () => {
      expect(req.auth.error).toBe("AUTH_INVALID");
    });

    await expectRejectsHttpError(
      assertRouteAuth(req, { required: true }),
      "AUTH_INVALID",
      401,
    );
  });

  it("requires authentication before role, scope and permission checks", async () => {
    const req = createReq();

    await expectRejectsHttpError(
      assertRouteAuth(req, { roles: ["admin"] }),
      "AUTH_REQUIRED",
      401,
    );
  });

  it("enforces roles and scopes", async () => {
    const req = createReq();
    setRequestAuth(req, {
      subject: "u1",
      roles: ["admin"],
      scopes: ["posts:read", "posts:write"],
    });

    await expect(
      assertRouteAuth(req, {
        roles: ["admin"],
        scopes: ["posts:write"],
        mode: "all",
      }),
    ).resolves.toBeUndefined();

    await expectRejectsHttpError(
      assertRouteAuth(req, { roles: ["owner"] }),
      "AUTH_FORBIDDEN",
      403,
    );
  });

  it("delegates permission checks to can() or assert()", async () => {
    const canReq = createReq();
    setRequestAuth(canReq, {
      subject: "u1",
      can: async (action, resource) =>
        action === "post:update" && resource === "42",
    });

    await expectRejectsHttpError(
      assertRouteAuth(canReq, {
        permissions: [
          {
            action: "post:update",
            resource: (req) => req.params.id,
          },
        ],
      }),
      "AUTH_FORBIDDEN",
      403,
    );

    canReq.params.id = "42";
    await expect(
      assertRouteAuth(canReq, {
        permissions: [
          {
            action: "post:update",
            resource: (req) => req.params.id,
          },
        ],
      }),
    ).resolves.toBeUndefined();

    const assertReq = createReq();
    setRequestAuth(assertReq, {
      subject: "u2",
      assert: async () => undefined,
    });
    await expect(
      assertRouteAuth(assertReq, { permissions: ["dashboard:view"] }),
    ).resolves.toBeUndefined();
  });

  it("returns AUTH_CONFIG_ERROR when permission contract is missing", async () => {
    const req = createReq();
    setRequestAuth(req, { subject: "u1" });

    await expectRejectsHttpError(
      assertRouteAuth(req, { permissions: ["dashboard:view"] }),
      "AUTH_CONFIG_ERROR",
      500,
    );
  });

  it("initializes auth context middleware for public requests", async () => {
    const req = createReq();
    req.auth = undefined as any;

    await createAuthContextMiddleware()(req, res, async () => undefined);

    expect(req.auth.isAuthenticated).toBe(false);
  });
});

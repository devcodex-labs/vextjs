import { describe, expect, it, vi } from "vitest";
import {
  applySecurityHeaders,
  createSecurityHeadersMiddleware,
  securityHeaders,
  withSecurityHeadersErrorHandler,
  withSecurityHeadersNotFoundHandler,
} from "../../../src/lib/security-headers.js";
import type { VextRequest } from "../../../src/types/request.js";
import type { VextResponse } from "../../../src/types/response.js";

function createReq(overrides: Partial<VextRequest> = {}): VextRequest {
  return {
    method: "GET",
    path: "/secure",
    url: "/secure",
    query: {},
    body: undefined,
    params: {},
    headers: {},
    cookies: {},
    cookie(name: string) {
      return (this.cookies as Record<string, string>)[name];
    },
    requestId: "req-security-headers",
    ip: "127.0.0.1",
    protocol: "http",
    app: {},
    valid: vi.fn(),
    csrfToken: vi.fn(),
    ...overrides,
  } as VextRequest;
}

function createRes(): VextResponse & {
  headers: Record<string, string | string[]>;
  statusValue: number;
  body: unknown;
} {
  const res: any = {
    headers: {},
    statusValue: 200,
    body: undefined,
    json(data: unknown, status?: number) {
      res.statusValue = status ?? res.statusValue;
      res.body = data;
    },
    rawJson(data: unknown, status?: number) {
      res.statusValue = status ?? res.statusValue;
      res.body = data;
    },
    text(data: string, status?: number) {
      res.statusValue = status ?? res.statusValue;
      res.body = data;
    },
    stream() {},
    download() {},
    redirect() {},
    status(code: number) {
      res.statusValue = code;
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      res.headers[name] = value;
      return res;
    },
    cookie() {
      return res;
    },
    clearCookie() {
      return res;
    },
    _enableWrap() {},
  };
  return res;
}

describe("security headers middleware", () => {
  it("exports securityHeaders as createSecurityHeadersMiddleware alias", () => {
    expect(securityHeaders).toBe(createSecurityHeadersMiddleware);
  });

  it("manual middleware applies the basic preset by default", async () => {
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await createSecurityHeadersMiddleware()(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(res.headers["Strict-Transport-Security"]).toBeUndefined();
    expect(res.headers["X-XSS-Protection"]).toBeUndefined();
  });

  it("custom preset only emits explicit headers", () => {
    const req = createReq();
    const res = createRes();

    applySecurityHeaders(
      req,
      res,
      {
        enabled: true,
        preset: "custom",
        headers: {
          "X-App-Security": "custom",
        },
      },
      { defaultEnabled: true },
    );

    expect(res.headers).toEqual({ "X-App-Security": "custom" });
  });

  it("strict preset keeps HSTS HTTPS-only unless force is enabled", () => {
    const httpReq = createReq({ protocol: "http" });
    const httpsReq = createReq({ protocol: "https" });
    const forcedReq = createReq({ protocol: "http" });
    const httpRes = createRes();
    const httpsRes = createRes();
    const forcedRes = createRes();

    applySecurityHeaders(httpReq, httpRes, {
      enabled: true,
      preset: "strict",
    });
    applySecurityHeaders(httpsReq, httpsRes, {
      enabled: true,
      preset: "strict",
    });
    applySecurityHeaders(forcedReq, forcedRes, {
      enabled: true,
      preset: "strict",
      hsts: { force: true, maxAge: 60, includeSubDomains: true, preload: true },
    });

    expect(httpRes.headers["Strict-Transport-Security"]).toBeUndefined();
    expect(httpsRes.headers["Strict-Transport-Security"]).toBe(
      "max-age=15552000",
    );
    expect(forcedRes.headers["Strict-Transport-Security"]).toBe(
      "max-age=60; includeSubDomains; preload",
    );
    expect(httpsRes.headers["Permissions-Policy"]).toBe(
      "geolocation=(), microphone=(), camera=()",
    );
    expect(httpsRes.headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(httpsRes.headers["Cross-Origin-Resource-Policy"]).toBe(
      "same-origin",
    );
    expect(httpsRes.headers["Cross-Origin-Embedder-Policy"]).toBeUndefined();
  });

  it("serializes CSP report-only and Permissions-Policy objects", () => {
    const req = createReq();
    const res = createRes();

    applySecurityHeaders(req, res, {
      enabled: true,
      preset: "custom",
      contentSecurityPolicy: {
        reportOnly: true,
        directives: {
          "default-src": ["'self'"],
          "upgrade-insecure-requests": true,
          "object-src": false,
        },
      },
      permissionsPolicy: {
        geolocation: false,
        camera: [],
        fullscreen: ["self"],
      },
    });

    expect(res.headers["Content-Security-Policy"]).toBeUndefined();
    expect(res.headers["Content-Security-Policy-Report-Only"]).toBe(
      "default-src 'self'; upgrade-insecure-requests",
    );
    expect(res.headers["Permissions-Policy"]).toBe(
      "geolocation=(), camera=(), fullscreen=(self)",
    );
  });

  it("supports route opt-out and skipPaths", () => {
    const routeOptOutReq = createReq({
      _routeOptions: { securityHeaders: false },
    } as Partial<VextRequest>);
    const skippedReq = createReq({ path: "/public/app.js" });
    const protectedReq = createReq({ path: "/api/users" });
    const routeOptOutRes = createRes();
    const skippedRes = createRes();
    const protectedRes = createRes();

    const config = {
      enabled: true,
      preset: "basic" as const,
      skipPaths: ["/public/*", "/healthz"],
    };

    applySecurityHeaders(routeOptOutReq, routeOptOutRes, config);
    applySecurityHeaders(skippedReq, skippedRes, config);
    applySecurityHeaders(protectedReq, protectedRes, config);

    expect(routeOptOutRes.headers["X-Content-Type-Options"]).toBeUndefined();
    expect(skippedRes.headers["X-Content-Type-Options"]).toBeUndefined();
    expect(protectedRes.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("lets explicit false remove preset headers and custom headers override case-insensitively", () => {
    const req = createReq();
    const res = createRes();

    applySecurityHeaders(req, res, {
      enabled: true,
      preset: "basic",
      frameOptions: false,
      headers: {
        "referrer-policy": "no-referrer",
      },
    });

    expect(res.headers["X-Frame-Options"]).toBeUndefined();
    expect(res.headers["Referrer-Policy"]).toBeUndefined();
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("wraps error and notFound handlers without changing their response behavior", async () => {
    const req = createReq();
    const errorRes = createRes();
    const notFoundRes = createRes();
    const error = new Error("boom");
    const errorHandler = vi.fn((_err, _req, res) => {
      res.json({ code: "INTERNAL" }, 500);
    });
    const notFoundHandler = vi.fn(async (_req, res) => {
      res.json({ code: "NOT_FOUND" }, 404);
    });

    withSecurityHeadersErrorHandler(errorHandler, {
      enabled: true,
      preset: "basic",
    })(error, req, errorRes);
    await withSecurityHeadersNotFoundHandler(notFoundHandler, {
      enabled: true,
      preset: "basic",
    })(req, notFoundRes, vi.fn());

    expect(errorHandler).toHaveBeenCalledWith(error, req, errorRes);
    expect(errorRes.statusValue).toBe(500);
    expect(errorRes.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(notFoundHandler).toHaveBeenCalled();
    expect(notFoundRes.statusValue).toBe(404);
    expect(notFoundRes.headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});

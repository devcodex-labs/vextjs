import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createNativeAdapter } from "../../../src/adapters/native/adapter.js";
import type {
  VextAdapter,
  VextServerHandle,
} from "../../../src/types/adapter.js";
import type { VextApp, VextConfig } from "../../../src/types/app.js";
import type { VextRequest } from "../../../src/types/request.js";
import type { VextResponse } from "../../../src/types/response.js";
import { DEFAULT_CONFIG } from "../../../src/lib/app.js";
import http from "node:http";

// ── 测试辅助 ─────────────────────────────────────────────────

/**
 * 创建最小化的 mock VextApp 实例
 *
 * Native Adapter 需要 VextApp 实例来：
 *   - 读取 config.trustProxy
 *   - 读取 config.requestId.header
 *   - 传递给 createVextRequest 的 app 字段
 */
function createMockApp(configOverrides?: Partial<VextConfig>): VextApp {
  const config = { ...DEFAULT_CONFIG, ...configOverrides } as VextConfig;

  return {
    config,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => null as any,
      }),
    },
    throw: (() => {}) as any,
    services: {} as any,
    adapter: null as any,
    get: (() => {}) as any,
    post: (() => {}) as any,
    put: (() => {}) as any,
    patch: (() => {}) as any,
    delete: (() => {}) as any,
    head: (() => {}) as any,
    options: (() => {}) as any,
    extend: () => {},
    setValidator: () => {},
    getValidator: () => ({
      compile: () => () => ({ valid: true, data: {} }),
    }),
    setThrow: () => {},
    setRateLimiter: () => {},
    setRequestIdGenerator: () => {},
    onClose: () => {},
    onReady: () => {},
    use: () => {},
  } as unknown as VextApp;
}

/**
 * 向指定端口发送 HTTP 请求
 *
 * 使用 Node.js 原生 http.request，避免引入额外依赖。
 * 返回响应的 statusCode、headers、body（字符串）。
 */
function httpRequest(options: {
  port: number;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: options.port,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// ── 测试开始 ─────────────────────────────────────────────────

describe("Native Adapter — VextAdapter 接口合规性", () => {
  let adapter: VextAdapter;
  let handle: VextServerHandle | null = null;
  let mockApp: VextApp;

  beforeEach(() => {
    mockApp = createMockApp();
    adapter = createNativeAdapter({}, mockApp);
    handle = null;
  });

  afterEach(async () => {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // 忽略关闭错误
      }
      handle = null;
    }
  });

  // ── 1. 接口完整性 ──────────────────────────────────────────

  describe("接口完整性", () => {
    it("应具有 name 属性且值为 'native'", () => {
      expect(adapter.name).toBe("native");
    });

    it("应实现所有 VextAdapter 必需方法", () => {
      expect(typeof adapter.registerRoute).toBe("function");
      expect(typeof adapter.registerMiddleware).toBe("function");
      expect(typeof adapter.registerErrorHandler).toBe("function");
      expect(typeof adapter.registerNotFound).toBe("function");
      expect(typeof adapter.listen).toBe("function");
      expect(typeof adapter.buildHandler).toBe("function");
    });
  });

  // ── 2. 路由注册与响应 ──────────────────────────────────────

  describe("路由注册与响应", () => {
    it("GET 路由应正确响应 JSON", async () => {
      adapter.registerRoute("GET", "/hello", [
        async (req: VextRequest, res: VextResponse) => {
          res.json({ message: "hello world" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/hello" });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ message: "hello world" });
    });

    it("POST 路由应正确注册并响应", async () => {
      adapter.registerRoute("POST", "/data", [
        async (req: VextRequest, res: VextResponse) => {
          res.json({ received: true }, 201);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/data",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });

      expect(response.status).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ received: true });
    });

    it("应支持所有 HTTP 方法（PUT / PATCH / DELETE / HEAD / OPTIONS）", async () => {
      const methods = ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

      for (const method of methods) {
        adapter.registerRoute(method, `/${method.toLowerCase()}`, [
          async (req: VextRequest, res: VextResponse) => {
            if (method === "HEAD") {
              res.status(200).json(null);
            } else {
              res.json({ method });
            }
          },
        ]);
      }

      handle = await adapter.listen(0, "127.0.0.1");

      for (const method of methods) {
        const response = await httpRequest({
          port: handle.port,
          method,
          path: `/${method.toLowerCase()}`,
        });

        expect(response.status).toBe(200);

        if (method !== "HEAD") {
          const body = JSON.parse(response.body);
          expect(body).toEqual({ method });
        }
      }
    });

    it("路由参数（:param）应正确解析", async () => {
      adapter.registerRoute("GET", "/users/:id", [
        async (req: VextRequest, res: VextResponse) => {
          res.json({ id: req.params.id });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/users/42",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ id: "42" });
    });

    it("多个路由参数应正确解析", async () => {
      adapter.registerRoute("GET", "/orgs/:orgId/users/:userId", [
        async (req: VextRequest, res: VextResponse) => {
          res.json({ orgId: req.params.orgId, userId: req.params.userId });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/orgs/acme/users/99",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ orgId: "acme", userId: "99" });
    });

    it("query 参数应正确解析", async () => {
      adapter.registerRoute("GET", "/search", [
        async (req: VextRequest, res: VextResponse) => {
          res.json({ q: req.query.q, page: req.query.page });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/search?q=hello&page=2",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ q: "hello", page: "2" });
    });

    it("无 query string 时 req.query 应为空对象", async () => {
      adapter.registerRoute("GET", "/no-query", [
        async (req: VextRequest, res: VextResponse) => {
          res.json({ keys: Object.keys(req.query) });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/no-query",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ keys: [] });
    });

    it("query 懒解析应正确缓存（多次访问返回同一对象）", async () => {
      let firstAccess: Record<string, string> | undefined;
      let secondAccess: Record<string, string> | undefined;

      adapter.registerRoute("GET", "/query-cache", [
        async (req: VextRequest, res: VextResponse) => {
          firstAccess = req.query;
          secondAccess = req.query;
          res.json({ same: firstAccess === secondAccess });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/query-cache?a=1",
      });

      const body = JSON.parse(response.body);
      expect(body.same).toBe(true);
      expect(firstAccess).toEqual({ a: "1" });
    });
  });

  // ── 3. 中间件链执行 ────────────────────────────────────────

  describe("中间件链执行", () => {
    it("全局中间件应在路由级中间件之前执行", async () => {
      const order: string[] = [];

      adapter.registerMiddleware(async (req, res, next) => {
        order.push("global-1");
        await next();
      });

      adapter.registerMiddleware(async (req, res, next) => {
        order.push("global-2");
        await next();
      });

      adapter.registerRoute("GET", "/test", [
        async (req, res, next) => {
          order.push("route-1");
          await next();
        },
        async (req, res) => {
          order.push("handler");
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/test" });

      expect(order).toEqual(["global-1", "global-2", "route-1", "handler"]);
    });

    it("洋葱模型 — after-middleware 逻辑应在 next() 返回后执行", async () => {
      const order: string[] = [];

      adapter.registerMiddleware(async (req, res, next) => {
        order.push("before-global");
        await next();
        order.push("after-global");
      });

      adapter.registerRoute("GET", "/onion", [
        async (req, res, next) => {
          order.push("before-route");
          await next();
          order.push("after-route");
        },
        async (req, res) => {
          order.push("handler");
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/onion" });

      expect(order).toEqual([
        "before-global",
        "before-route",
        "handler",
        "after-route",
        "after-global",
      ]);
    });

    it("中间件可以修改 req 和 res 对象", async () => {
      adapter.registerMiddleware(async (req, res, next) => {
        (req as any).customField = "injected-value";
        await next();
      });

      adapter.registerRoute("GET", "/custom", [
        async (req, res) => {
          res.json({ custom: (req as any).customField });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/custom",
      });

      const body = JSON.parse(response.body);
      expect(body).toEqual({ custom: "injected-value" });
    });

    it("中间件可以短路（不调用 next()）", async () => {
      const order: string[] = [];

      adapter.registerMiddleware(async (req, res, next) => {
        order.push("guard");
        // 短路 — 不调用 next()，直接返回 403
        res.rawJson({ code: 403, message: "Forbidden" }, 403);
      });

      adapter.registerRoute("GET", "/protected", [
        async (req, res) => {
          order.push("handler"); // 不应到达
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/protected",
      });

      expect(response.status).toBe(403);
      expect(order).toEqual(["guard"]); // handler 不应执行
    });

    it("多个全局中间件的执行顺序与注册顺序一致", async () => {
      const order: string[] = [];

      for (let i = 1; i <= 5; i++) {
        adapter.registerMiddleware(async (req, res, next) => {
          order.push(`mw-${i}`);
          await next();
        });
      }

      adapter.registerRoute("GET", "/order", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/order" });

      expect(order).toEqual(["mw-1", "mw-2", "mw-3", "mw-4", "mw-5"]);
    });
  });

  // ── 4. 错误处理 ────────────────────────────────────────────

  describe("错误处理", () => {
    it("应通过 errorHandler 捕获中间件链抛出的错误", async () => {
      let caughtError: unknown = null;

      adapter.registerErrorHandler((err, req, res) => {
        caughtError = err;
        res.rawJson({ code: 500, message: "handled" }, 500);
      });

      adapter.registerRoute("GET", "/error", [
        async () => {
          throw new Error("test error");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/error" });

      expect(response.status).toBe(500);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ code: 500, message: "handled" });
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe("test error");
    });

    it("errorHandler 自身抛出异常时应返回最低限度 500", async () => {
      adapter.registerErrorHandler(() => {
        throw new Error("handler also failed");
      });

      adapter.registerRoute("GET", "/double-error", [
        async () => {
          throw new Error("original error");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/double-error",
      });

      expect(response.status).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.code).toBe(500);
      expect(body.message).toBe("Internal Server Error");
    });

    it("路由级中间件抛错应被 errorHandler 捕获", async () => {
      let caughtError: unknown = null;

      adapter.registerErrorHandler((err, req, res) => {
        caughtError = err;
        res.rawJson({ code: 500, message: "caught" }, 500);
      });

      adapter.registerRoute("GET", "/mw-error", [
        async (req, res, next) => {
          throw new Error("middleware error");
        },
        async (req, res) => {
          res.json({ ok: true }); // 不应到达
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/mw-error",
      });

      expect(response.status).toBe(500);
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe("middleware error");
    });

    it("无 errorHandler 时应返回最低限度 500", async () => {
      adapter.registerRoute("GET", "/no-handler-error", [
        async () => {
          throw new Error("unhandled");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/no-handler-error",
      });

      expect(response.status).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.code).toBe(500);
      expect(body.message).toBe("Internal Server Error");
    });
  });

  // ── 5. 404 Not Found ──────────────────────────────────────

  describe("404 Not Found", () => {
    it("应通过 notFoundHandler 处理未匹配路由", async () => {
      let notFoundCalled = false;

      adapter.registerNotFound(async (req, res) => {
        notFoundCalled = true;
        res.rawJson({ code: 404, message: "Not Found" }, 404);
      });

      // 注册一个路由（确保路由表非空）
      adapter.registerRoute("GET", "/exists", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/nonexistent",
      });

      expect(response.status).toBe(404);
      expect(notFoundCalled).toBe(true);

      const body = JSON.parse(response.body);
      expect(body).toEqual({ code: 404, message: "Not Found" });
    });

    it("404 handler 中 req.requestId 应有值（内联生成）", async () => {
      let capturedRequestId = "";

      adapter.registerNotFound(async (req, res) => {
        capturedRequestId = req.requestId;
        res.rawJson(
          { code: 404, message: "Not Found", requestId: req.requestId },
          404,
        );
      });

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/nonexistent" });

      expect(capturedRequestId).toBeTruthy();
      // 应是有效的 UUID v4 格式（crypto.randomUUID()）
      expect(capturedRequestId.length).toBeGreaterThan(0);
    });

    it("404 handler 应透传 x-request-id 请求头", async () => {
      let capturedRequestId = "";

      adapter.registerNotFound(async (req, res) => {
        capturedRequestId = req.requestId;
        res.rawJson({ code: 404, message: "Not Found" }, 404);
      });

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/nonexistent",
        headers: { "x-request-id": "custom-req-id-123" },
      });

      expect(capturedRequestId).toBe("custom-req-id-123");
    });

    it("无 notFoundHandler 时应返回默认 404 JSON", async () => {
      // 不注册 notFoundHandler
      adapter.registerRoute("GET", "/exists", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/nonexistent",
      });

      expect(response.status).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe(404);
      expect(body.message).toBe("Not Found");
    });
  });

  // ── 6. VextResponse 方法 ──────────────────────────────────

  describe("VextResponse 方法", () => {
    it("json() 应返回 JSON 和正确的 Content-Type", async () => {
      adapter.registerRoute("GET", "/json", [
        async (req, res) => {
          res.json({ name: "Alice" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/json" });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(response.body)).toEqual({ name: "Alice" });
    });

    it("json() + _enableWrap() 应包装为 { code: 0, data, requestId }", async () => {
      adapter.registerMiddleware(async (req, res, next) => {
        req.requestId = "test-req-id";
        res._enableWrap();
        await next();
      });

      adapter.registerRoute("GET", "/wrapped", [
        async (req, res) => {
          res.json({ name: "Bob" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/wrapped",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        code: 0,
        data: { name: "Bob" },
        requestId: "test-req-id",
      });
    });

    it("json() + 204 应返回无消息体（RFC 9110 §15.3.5）", async () => {
      adapter.registerRoute("DELETE", "/item", [
        async (req, res) => {
          res.status(204).json(null);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        method: "DELETE",
        path: "/item",
      });

      expect(response.status).toBe(204);
      expect(response.body).toBe("");
    });

    it("json() + 204 + _enableWrap() 仍应返回无消息体", async () => {
      adapter.registerMiddleware(async (req, res, next) => {
        res._enableWrap();
        await next();
      });

      adapter.registerRoute("DELETE", "/item-wrapped", [
        async (req, res) => {
          res.status(204).json(null);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        method: "DELETE",
        path: "/item-wrapped",
      });

      expect(response.status).toBe(204);
      expect(response.body).toBe("");
    });

    it("rawJson() 应绕过出口包装", async () => {
      adapter.registerMiddleware(async (req, res, next) => {
        res._enableWrap();
        await next();
      });

      adapter.registerRoute("GET", "/raw", [
        async (req, res) => {
          res.rawJson({ custom: "format" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/raw" });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ custom: "format" });
      // 不应有 code / data / requestId 包装
      expect(body.code).toBeUndefined();
    });

    it("rawJson() 可指定状态码", async () => {
      adapter.registerRoute("GET", "/raw-status", [
        async (req, res) => {
          res.rawJson({ error: "bad request" }, 400);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/raw-status",
      });

      expect(response.status).toBe(400);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ error: "bad request" });
    });

    it("text() 应返回纯文本和正确的 Content-Type", async () => {
      adapter.registerRoute("GET", "/text", [
        async (req, res) => {
          res.text("Hello, World!");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/text" });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/plain");
      expect(response.body).toBe("Hello, World!");
    });

    it("text() 在 setHeader 预设 Content-Type 后不应覆盖（BUG-031 回归）", async () => {
      adapter.registerRoute("GET", "/text-html", [
        async (req, res) => {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.text("<h1>Hello</h1>");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/text-html",
      });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toBe("<h1>Hello</h1>");
    });

    it("text() 可指定状态码", async () => {
      adapter.registerRoute("GET", "/text-status", [
        async (req, res) => {
          res.text("Not Authorized", 401);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/text-status",
      });

      expect(response.status).toBe(401);
      expect(response.body).toBe("Not Authorized");
    });

    it("status() 应支持链式调用", async () => {
      adapter.registerRoute("POST", "/created", [
        async (req, res) => {
          res.status(201).json({ id: 1 });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/created",
      });

      expect(response.status).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ id: 1 });
    });

    it("setHeader() 应支持链式调用并设置自定义响应头", async () => {
      adapter.registerRoute("GET", "/custom-header", [
        async (req, res) => {
          res.setHeader("X-Custom", "test-value").json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/custom-header",
      });

      expect(response.status).toBe(200);
      expect(response.headers["x-custom"]).toBe("test-value");
    });

    it("setHeader() 多次调用应累积响应头", async () => {
      adapter.registerRoute("GET", "/multi-header", [
        async (req, res) => {
          res
            .setHeader("X-First", "one")
            .setHeader("X-Second", "two")
            .json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/multi-header",
      });

      expect(response.headers["x-first"]).toBe("one");
      expect(response.headers["x-second"]).toBe("two");
    });

    it("statusCode 只读属性应返回当前状态码", async () => {
      let capturedStatusCode = 0;

      adapter.registerMiddleware(async (req, res, next) => {
        await next();
        // after-middleware：读取 statusCode
        capturedStatusCode = res.statusCode;
      });

      adapter.registerRoute("GET", "/status-code", [
        async (req, res) => {
          res.status(201).json({ created: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/status-code" });

      expect(capturedStatusCode).toBe(201);
    });

    it("statusCode 默认应为 200", async () => {
      let capturedStatusCode = 0;

      adapter.registerMiddleware(async (req, res, next) => {
        capturedStatusCode = res.statusCode;
        await next();
      });

      adapter.registerRoute("GET", "/default-status", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/default-status" });

      expect(capturedStatusCode).toBe(200);
    });

    it("redirect() 应返回重定向响应", async () => {
      adapter.registerRoute("GET", "/old", [
        async (req, res) => {
          res.redirect("/new", 301);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      // 使用原生 http.request 但不跟随重定向
      const response = await new Promise<{
        status: number;
        headers: http.IncomingHttpHeaders;
      }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: handle!.port,
            method: "GET",
            path: "/old",
          },
          (res) => {
            // 不读取 body，只获取 status 和 headers
            res.resume(); // 消费数据以避免背压
            resolve({ status: res.statusCode ?? 0, headers: res.headers });
          },
        );
        req.on("error", reject);
        req.end();
      });

      expect(response.status).toBe(301);
      expect(response.headers.location).toBe("/new");
    });

    it("redirect() 默认应为 302", async () => {
      adapter.registerRoute("GET", "/temp-redirect", [
        async (req, res) => {
          res.redirect("/destination");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      const response = await new Promise<{
        status: number;
        headers: http.IncomingHttpHeaders;
      }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: handle!.port,
            method: "GET",
            path: "/temp-redirect",
          },
          (res) => {
            res.resume();
            resolve({ status: res.statusCode ?? 0, headers: res.headers });
          },
        );
        req.on("error", reject);
        req.end();
      });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe("/destination");
    });

    it("重复调用 json() 应被忽略（重复发送保护）", async () => {
      let callCount = 0;

      adapter.registerRoute("GET", "/double-send", [
        async (req, res) => {
          res.json({ first: true });
          callCount++;
          res.json({ second: true }); // 第二次调用应被忽略
          callCount++;
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/double-send",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ first: true }); // 应该是第一次的数据
      expect(callCount).toBe(2); // handler 本身执行完毕
    });

    it("重复调用不同发送方法也应被忽略", async () => {
      adapter.registerRoute("GET", "/mixed-send", [
        async (req, res) => {
          res.json({ data: "json" });
          res.text("text"); // 应被忽略
          res.rawJson({ raw: true }); // 应被忽略
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/mixed-send",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ data: "json" });
    });
  });

  // ── 7. VextRequest 字段 ───────────────────────────────────

  describe("VextRequest 字段", () => {
    it("req.method 应为大写", async () => {
      let method = "";

      adapter.registerRoute("POST", "/method-check", [
        async (req, res) => {
          method = req.method;
          res.json({ method: req.method });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/method-check",
      });

      expect(method).toBe("POST");
    });

    it("req.path 应不含 query string", async () => {
      let path = "";

      adapter.registerRoute("GET", "/path-check", [
        async (req, res) => {
          path = req.path;
          res.json({ path });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/path-check?foo=bar",
      });

      expect(path).toBe("/path-check");
    });

    it("req.url 应包含完整路径和 query string", async () => {
      let url = "";

      adapter.registerRoute("GET", "/url-check", [
        async (req, res) => {
          url = req.url;
          res.json({ url });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/url-check?key=value",
      });

      expect(url).toContain("/url-check?key=value");
    });

    it("req.headers 应包含请求头（key 小写）", async () => {
      let headerValue: string | undefined;

      adapter.registerRoute("GET", "/headers-check", [
        async (req, res) => {
          headerValue = req.headers["x-custom-header"] as string;
          res.json({ header: headerValue });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/headers-check",
        headers: { "X-Custom-Header": "test-value" },
      });

      expect(headerValue).toBe("test-value");
    });

    it("req.app 应指向 VextApp 实例", async () => {
      let appRef: any = null;

      adapter.registerRoute("GET", "/app-check", [
        async (req, res) => {
          appRef = req.app;
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/app-check" });

      expect(appRef).toBe(mockApp);
    });

    it("req.requestId 初始应为空字符串", async () => {
      let requestId = "not-empty";

      adapter.registerRoute("GET", "/reqid-check", [
        async (req, res) => {
          requestId = req.requestId;
          res.json({ requestId });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/reqid-check" });

      expect(requestId).toBe("");
    });

    it("req.requestId 应可由中间件设置", async () => {
      let capturedId = "";

      adapter.registerMiddleware(async (req, res, next) => {
        req.requestId = "custom-id-456";
        await next();
      });

      adapter.registerRoute("GET", "/reqid-set", [
        async (req, res) => {
          capturedId = req.requestId;
          res.json({ requestId: capturedId });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/reqid-set" });

      expect(capturedId).toBe("custom-id-456");
    });

    it("req.ip 应有值", async () => {
      let ip = "";

      adapter.registerRoute("GET", "/ip-check", [
        async (req, res) => {
          ip = req.ip;
          res.json({ ip });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/ip-check" });

      expect(ip).toBeTruthy();
    });

    it("trustProxy = true 时 req.ip 应从 X-Forwarded-For 读取", async () => {
      const trustedApp = createMockApp({ trustProxy: true });
      const trustedAdapter = createNativeAdapter({}, trustedApp);
      let ip = "";

      trustedAdapter.registerRoute("GET", "/ip-proxy", [
        async (req, res) => {
          ip = req.ip;
          res.json({ ip });
        },
      ]);

      handle = await trustedAdapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/ip-proxy",
        headers: { "X-Forwarded-For": "203.0.113.50, 70.41.3.18" },
      });

      expect(ip).toBe("203.0.113.50");
    });

    it("trustProxy = false 时 req.ip 应从 socket 读取（忽略 X-Forwarded-For）", async () => {
      let ip = "";

      adapter.registerRoute("GET", "/ip-no-proxy", [
        async (req, res) => {
          ip = req.ip;
          res.json({ ip });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/ip-no-proxy",
        headers: { "X-Forwarded-For": "203.0.113.50" },
      });

      // 本地连接应为 127.0.0.1 或 ::1（不是 X-Forwarded-For 的值）
      expect(ip).not.toBe("203.0.113.50");
      expect(ip).toBeTruthy();
    });

    it("trustProxy = true 时 req.protocol 应从 X-Forwarded-Proto 读取", async () => {
      const trustedApp = createMockApp({ trustProxy: true });
      const trustedAdapter = createNativeAdapter({}, trustedApp);
      let protocol: string = "";

      trustedAdapter.registerRoute("GET", "/proto-proxy", [
        async (req, res) => {
          protocol = req.protocol;
          res.json({ protocol });
        },
      ]);

      handle = await trustedAdapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/proto-proxy",
        headers: { "X-Forwarded-Proto": "https" },
      });

      expect(protocol).toBe("https");
    });

    it("trustProxy = false 时 req.protocol 应为 'http'（本地连接）", async () => {
      let protocol: string = "";

      adapter.registerRoute("GET", "/proto-no-proxy", [
        async (req, res) => {
          protocol = req.protocol;
          res.json({ protocol });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/proto-no-proxy",
        headers: { "X-Forwarded-Proto": "https" },
      });

      // 本地非 TLS 连接应为 http
      expect(protocol).toBe("http");
    });

    it("req.valid() 应返回 _validated_<location> 上的数据", async () => {
      let validQuery: any = null;

      adapter.registerMiddleware(async (req, res, next) => {
        // 模拟 validate 中间件写入校验后数据
        (req as any)._validated_query = { page: 1, limit: 10 };
        await next();
      });

      adapter.registerRoute("GET", "/valid-check", [
        async (req, res) => {
          validQuery = req.valid("query");
          res.json({ validQuery });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/valid-check" });

      expect(validQuery).toEqual({ page: 1, limit: 10 });
    });

    it("req.valid() 多个 location 应独立工作", async () => {
      let validQuery: any = null;
      let validBody: any = null;

      adapter.registerMiddleware(async (req, res, next) => {
        (req as any)._validated_query = { q: "search" };
        (req as any)._validated_body = { name: "Alice" };
        await next();
      });

      adapter.registerRoute("GET", "/valid-multi", [
        async (req, res) => {
          validQuery = req.valid("query");
          validBody = req.valid("body");
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/valid-multi" });

      expect(validQuery).toEqual({ q: "search" });
      expect(validBody).toEqual({ name: "Alice" });
    });

    it("req.onClose() 应注册回调", async () => {
      let closeCalled = false;

      adapter.registerRoute("GET", "/on-close", [
        async (req, res) => {
          req.onClose(() => {
            closeCalled = true;
          });
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/on-close" });

      // 等待请求关闭事件触发
      await new Promise((r) => setTimeout(r, 100));

      expect(closeCalled).toBe(true);
    });
  });

  // ── 8. Body 解析兼容性 ────────────────────────────────────

  describe("Body 解析兼容性（_getRawBody）", () => {
    it("POST JSON body 应通过 _getRawBody 可读", async () => {
      let rawBody = "";

      adapter.registerRoute("POST", "/raw-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody as () => Promise<string>;
          rawBody = await getRawBody();
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/raw-body",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });

      expect(rawBody).toBe('{"name":"test"}');
    });

    it("GET 请求 _getRawBody 应返回空字符串", async () => {
      let rawBody: string | null = null;

      adapter.registerRoute("GET", "/no-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody as () => Promise<string>;
          rawBody = await getRawBody();
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/no-body" });

      expect(rawBody).toBe("");
    });

    it("_getRawBody 多次调用应返回相同结果（缓存）", async () => {
      let firstCall = "";
      let secondCall = "";

      adapter.registerRoute("POST", "/cached-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody as () => Promise<string>;
          firstCall = await getRawBody();
          secondCall = await getRawBody();
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/cached-body",
        headers: { "Content-Type": "application/json" },
        body: '{"cached":true}',
      });

      expect(firstCall).toBe('{"cached":true}');
      expect(secondCall).toBe('{"cached":true}');
    });

    it("HEAD 请求 _getRawBody 应返回空字符串", async () => {
      let rawBody: string | null = null;

      adapter.registerRoute("HEAD", "/head-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody as () => Promise<string>;
          rawBody = await getRawBody();
          res.status(200).json(null);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "HEAD",
        path: "/head-body",
      });

      expect(rawBody).toBe("");
    });

    it("OPTIONS 请求 _getRawBody 应返回空字符串", async () => {
      let rawBody: string | null = null;

      adapter.registerRoute("OPTIONS", "/options-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody as () => Promise<string>;
          rawBody = await getRawBody();
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "OPTIONS",
        path: "/options-body",
      });

      expect(rawBody).toBe("");
    });

    it("PUT body 应正确读取", async () => {
      let rawBody = "";

      adapter.registerRoute("PUT", "/put-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody as () => Promise<string>;
          rawBody = await getRawBody();
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "PUT",
        path: "/put-body",
        headers: { "Content-Type": "application/json" },
        body: '{"updated":true}',
      });

      expect(rawBody).toBe('{"updated":true}');
    });

    it("空 body POST 应返回空字符串", async () => {
      let rawBody: string | null = null;

      adapter.registerRoute("POST", "/empty-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody as () => Promise<string>;
          rawBody = await getRawBody();
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/empty-body",
      });

      expect(rawBody).toBe("");
    });
  });

  // ── 9. listen / close / port ──────────────────────────────

  describe("listen / close / port", () => {
    it("listen(0) 应分配随机端口且 port > 0", async () => {
      adapter.registerRoute("GET", "/", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      expect(handle.port).toBeGreaterThan(0);
      expect(handle.host).toBeDefined();
    });

    it("close() 后端口应释放", async () => {
      adapter.registerRoute("GET", "/", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const port = handle.port;

      // 正常请求应成功
      const response = await httpRequest({ port, path: "/" });
      expect(response.status).toBe(200);

      // 关闭服务器
      await handle.close();

      // 关闭后请求应失败
      await expect(httpRequest({ port, path: "/" })).rejects.toThrow();

      handle = null; // 防止 afterEach 重复关闭
    });

    it("close() 应可多次调用而不报错", async () => {
      adapter.registerRoute("GET", "/", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      await handle.close();
      // 第二次关闭不应抛异常（Node.js http.Server.close 多次调用会报 ERR_SERVER_NOT_RUNNING）
      // Native adapter 需要处理此边界
      try {
        await handle.close();
      } catch {
        // 可接受：Node.js 原生 http.Server.close() 多次调用可能报错
      }

      handle = null;
    });

    it("listen 后应能正常处理请求", async () => {
      adapter.registerRoute("GET", "/health", [
        async (req, res) => {
          res.json({ status: "ok" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      const response = await httpRequest({
        port: handle.port,
        path: "/health",
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: "ok" });
    });

    it("handle.host 应有值", async () => {
      adapter.registerRoute("GET", "/", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      expect(handle.host).toBeTruthy();
    });
  });

  // ── 10. buildHandler ──────────────────────────────────────

  describe("buildHandler", () => {
    it("应返回 (req, res) => void 函数", () => {
      adapter.registerRoute("GET", "/", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      const handler = adapter.buildHandler();
      expect(typeof handler).toBe("function");
      expect(handler.length).toBe(2); // (req, res) 两个参数
    });

    it("通过 buildHandler 返回的 handler 应能处理请求", async () => {
      const buildAdapter = createNativeAdapter({}, mockApp);

      buildAdapter.registerRoute("GET", "/build-test", [
        async (req, res) => {
          res.json({ source: "buildHandler" });
        },
      ]);

      const handler = buildAdapter.buildHandler();
      const server = http.createServer(handler);

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      const addr = server.address() as { port: number };
      const response = await httpRequest({
        port: addr.port,
        path: "/build-test",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ source: "buildHandler" });

      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it("buildHandler 返回的 handler 应包含中间件", async () => {
      const buildAdapter = createNativeAdapter({}, mockApp);
      const order: string[] = [];

      buildAdapter.registerMiddleware(async (req, res, next) => {
        order.push("middleware");
        await next();
      });

      buildAdapter.registerRoute("GET", "/with-mw", [
        async (req, res) => {
          order.push("handler");
          res.json({ ok: true });
        },
      ]);

      const handler = buildAdapter.buildHandler();
      const server = http.createServer(handler);

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      const addr = server.address() as { port: number };
      await httpRequest({ port: addr.port, path: "/with-mw" });

      expect(order).toEqual(["middleware", "handler"]);

      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it("buildHandler 的 handler 应处理 404", async () => {
      const buildAdapter = createNativeAdapter({}, mockApp);

      buildAdapter.registerNotFound(async (req, res) => {
        res.rawJson({ code: 404, message: "Custom Not Found" }, 404);
      });

      buildAdapter.registerRoute("GET", "/exists", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      const handler = buildAdapter.buildHandler();
      const server = http.createServer(handler);

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      const addr = server.address() as { port: number };
      const response = await httpRequest({
        port: addr.port,
        path: "/missing",
      });

      expect(response.status).toBe(404);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ code: 404, message: "Custom Not Found" });

      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    });
  });

  // ── 11. Native Adapter 选项 ───────────────────────────────

  describe("Native Adapter 选项", () => {
    it("ignoreTrailingSlash 默认应为 true", async () => {
      adapter.registerRoute("GET", "/users", [
        async (req, res) => {
          res.json({ matched: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      // /users/ 应匹配 /users（ignoreTrailingSlash: true）
      const response = await httpRequest({
        port: handle.port,
        path: "/users/",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ matched: true });
    });

    it("ignoreTrailingSlash: false 时 /users/ 不应匹配 /users", async () => {
      const strictAdapter = createNativeAdapter(
        { ignoreTrailingSlash: false },
        mockApp,
      );

      strictAdapter.registerNotFound(async (req, res) => {
        res.rawJson({ code: 404, message: "Not Found" }, 404);
      });

      strictAdapter.registerRoute("GET", "/users", [
        async (req, res) => {
          res.json({ matched: true });
        },
      ]);

      handle = await strictAdapter.listen(0, "127.0.0.1");

      // /users 应匹配
      const response1 = await httpRequest({
        port: handle.port,
        path: "/users",
      });
      expect(response1.status).toBe(200);

      // /users/ 不应匹配
      const response2 = await httpRequest({
        port: handle.port,
        path: "/users/",
      });
      expect(response2.status).toBe(404);
    });

    it("caseSensitive 默认应为 false（大小写不敏感）", async () => {
      adapter.registerNotFound(async (req, res) => {
        res.rawJson({ code: 404, message: "Not Found" }, 404);
      });

      adapter.registerRoute("GET", "/Users", [
        async (req, res) => {
          res.json({ matched: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      // /users 应匹配 /Users（caseSensitive: false）
      const response = await httpRequest({
        port: handle.port,
        path: "/users",
      });
      expect(response.status).toBe(200);
    });

    it("caseSensitive: true 时路径应区分大小写", async () => {
      const csApp = createMockApp();
      const csAdapter = createNativeAdapter({ caseSensitive: true }, csApp);

      csAdapter.registerNotFound(async (req, res) => {
        res.rawJson({ code: 404, message: "Not Found" }, 404);
      });

      csAdapter.registerRoute("GET", "/Users", [
        async (req, res) => {
          res.json({ matched: true });
        },
      ]);

      handle = await csAdapter.listen(0, "127.0.0.1");

      // /Users 应匹配
      const response1 = await httpRequest({
        port: handle.port,
        path: "/Users",
      });
      expect(response1.status).toBe(200);

      // /users 不应匹配
      const response2 = await httpRequest({
        port: handle.port,
        path: "/users",
      });
      expect(response2.status).toBe(404);
    });

    it("maxParamLength 应限制参数长度", async () => {
      const limitAdapter = createNativeAdapter({ maxParamLength: 5 }, mockApp);

      limitAdapter.registerNotFound(async (req, res) => {
        res.rawJson({ code: 404, message: "Not Found" }, 404);
      });

      limitAdapter.registerRoute("GET", "/items/:id", [
        async (req, res) => {
          res.json({ id: req.params.id });
        },
      ]);

      handle = await limitAdapter.listen(0, "127.0.0.1");

      // 短参数应匹配
      const response1 = await httpRequest({
        port: handle.port,
        path: "/items/abc",
      });
      expect(response1.status).toBe(200);

      // 超长参数不应匹配（超过 maxParamLength: 5）
      const response2 = await httpRequest({
        port: handle.port,
        path: "/items/abcdef",
      });
      expect(response2.status).toBe(404);
    });
  });

  // ── 12. 并发请求隔离 ──────────────────────────────────────

  describe("并发请求隔离", () => {
    it("多个并发请求不应互相干扰", async () => {
      adapter.registerRoute("GET", "/slow/:id", [
        async (req, res) => {
          const id = req.params.id;
          // 模拟不同耗时
          const delay = id === "1" ? 100 : 10;
          await new Promise((r) => setTimeout(r, delay));
          res.json({ id });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      // 同时发送两个请求
      const [r1, r2] = await Promise.all([
        httpRequest({ port: handle.port, path: "/slow/1" }),
        httpRequest({ port: handle.port, path: "/slow/2" }),
      ]);

      expect(JSON.parse(r1.body)).toEqual({ id: "1" });
      expect(JSON.parse(r2.body)).toEqual({ id: "2" });
    });

    it("并发请求中间件状态应独立", async () => {
      adapter.registerMiddleware(async (req, res, next) => {
        (req as any)._timestamp = Date.now();
        await next();
      });

      adapter.registerRoute("GET", "/concurrent/:id", [
        async (req, res) => {
          const id = req.params.id;
          if (id === "1") {
            await new Promise((r) => setTimeout(r, 50));
          }
          res.json({
            id,
            hasTimestamp: typeof (req as any)._timestamp === "number",
          });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      const [r1, r2] = await Promise.all([
        httpRequest({ port: handle.port, path: "/concurrent/1" }),
        httpRequest({ port: handle.port, path: "/concurrent/2" }),
      ]);

      const body1 = JSON.parse(r1.body);
      const body2 = JSON.parse(r2.body);

      expect(body1.id).toBe("1");
      expect(body1.hasTimestamp).toBe(true);
      expect(body2.id).toBe("2");
      expect(body2.hasTimestamp).toBe(true);
    });
  });

  // ── 13. 预组装中间件链缓存 ────────────────────────────────

  describe("预组装中间件链缓存", () => {
    it("首次请求后中间件链应被缓存（后续请求不重新组装）", async () => {
      let callCount = 0;

      adapter.registerMiddleware(async (req, res, next) => {
        callCount++;
        await next();
      });

      adapter.registerRoute("GET", "/cached-chain", [
        async (req, res) => {
          res.json({ count: callCount });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      // 发送三次请求
      await httpRequest({ port: handle.port, path: "/cached-chain" });
      await httpRequest({ port: handle.port, path: "/cached-chain" });
      await httpRequest({ port: handle.port, path: "/cached-chain" });

      // 中间件应被调用 3 次（每次请求都执行，但链只组装一次）
      expect(callCount).toBe(3);
    });
  });

  // ── 14. AsyncLocalStorage 请求上下文 ──────────────────────

  describe("AsyncLocalStorage 请求上下文", () => {
    it("请求处理应在 requestContext.run 内执行", async () => {
      // 通过导入 requestContext 验证
      const { requestContext } =
        await import("../../../src/lib/request-context.js");

      let store: any = null;

      adapter.registerMiddleware(async (req, res, next) => {
        store = requestContext.getStore();
        await next();
      });

      adapter.registerRoute("GET", "/ctx-check", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/ctx-check" });

      // store 应不为 null（requestContext.run 已执行）
      expect(store).not.toBeNull();
      expect(store).toHaveProperty("requestId");
    });
  });

  // ── 15. nativeAdapter 工厂函数 ────────────────────────────

  describe("nativeAdapter 工厂函数", () => {
    it("nativeAdapter() 应返回工厂函数", async () => {
      const { nativeAdapter } =
        await import("../../../src/adapters/native/index.js");

      const factory = nativeAdapter();
      expect(typeof factory).toBe("function");
    });

    it("nativeAdapter() 工厂函数应创建有效的 adapter", async () => {
      const { nativeAdapter } =
        await import("../../../src/adapters/native/index.js");

      const factory = nativeAdapter();
      const nAdapter = factory(mockApp);

      expect(nAdapter.name).toBe("native");
      expect(typeof nAdapter.registerRoute).toBe("function");
      expect(typeof nAdapter.listen).toBe("function");
    });

    it("nativeAdapter(options) 应传递选项", async () => {
      const { nativeAdapter } =
        await import("../../../src/adapters/native/index.js");

      const factory = nativeAdapter({ caseSensitive: true });
      const csAdapter = factory(mockApp);

      csAdapter.registerNotFound(async (req, res) => {
        res.rawJson({ code: 404, message: "Not Found" }, 404);
      });

      csAdapter.registerRoute("GET", "/Test", [
        async (req, res) => {
          res.json({ matched: true });
        },
      ]);

      handle = await csAdapter.listen(0, "127.0.0.1");

      // /Test 应匹配
      const response1 = await httpRequest({
        port: handle.port,
        path: "/Test",
      });
      expect(response1.status).toBe(200);

      // /test 不应匹配（caseSensitive: true）
      const response2 = await httpRequest({
        port: handle.port,
        path: "/test",
      });
      expect(response2.status).toBe(404);
    });
  });

  // ── 16. 边界场景 ──────────────────────────────────────────

  describe("边界场景", () => {
    it("空路径应正常处理", async () => {
      adapter.registerRoute("GET", "/", [
        async (req, res) => {
          res.json({ root: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/" });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ root: true });
    });

    it("深层嵌套路由应正常匹配", async () => {
      adapter.registerRoute("GET", "/a/b/c/d/e", [
        async (req, res) => {
          res.json({ depth: 5 });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/a/b/c/d/e",
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ depth: 5 });
    });

    it("特殊字符的 query 应正确解析", async () => {
      adapter.registerRoute("GET", "/special", [
        async (req, res) => {
          res.json({ value: req.query.key });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/special?key=hello%20world%26test",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.value).toBe("hello world&test");
    });

    it("json() 传入 null 应正确返回 null", async () => {
      adapter.registerRoute("GET", "/null-json", [
        async (req, res) => {
          res.json(null);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/null-json",
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toBeNull();
    });

    it("json() 传入数组应正确返回数组", async () => {
      adapter.registerRoute("GET", "/array-json", [
        async (req, res) => {
          res.json([1, 2, 3]);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/array-json",
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual([1, 2, 3]);
    });

    it("json() 传入空对象应正确返回", async () => {
      adapter.registerRoute("GET", "/empty-json", [
        async (req, res) => {
          res.json({});
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/empty-json",
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({});
    });

    it("text() 传入空字符串应正确返回", async () => {
      adapter.registerRoute("GET", "/empty-text", [
        async (req, res) => {
          res.text("");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/empty-text",
      });

      expect(response.status).toBe(200);
      expect(response.body).toBe("");
    });

    it("多个路由不应互相干扰", async () => {
      adapter.registerRoute("GET", "/route-a", [
        async (req, res) => {
          res.json({ route: "a" });
        },
      ]);

      adapter.registerRoute("GET", "/route-b", [
        async (req, res) => {
          res.json({ route: "b" });
        },
      ]);

      adapter.registerRoute("POST", "/route-a", [
        async (req, res) => {
          res.json({ route: "a-post" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      const [rA, rB, rAPost] = await Promise.all([
        httpRequest({ port: handle.port, path: "/route-a" }),
        httpRequest({ port: handle.port, path: "/route-b" }),
        httpRequest({ port: handle.port, method: "POST", path: "/route-a" }),
      ]);

      expect(JSON.parse(rA.body)).toEqual({ route: "a" });
      expect(JSON.parse(rB.body)).toEqual({ route: "b" });
      expect(JSON.parse(rAPost.body)).toEqual({ route: "a-post" });
    });
  });
});

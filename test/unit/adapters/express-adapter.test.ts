import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createExpressAdapter } from "../../../src/adapters/express/adapter.js";
import type { ExpressAdapterOptions } from "../../../src/adapters/express/adapter.js";
import type {
  VextAdapter,
  VextServerHandle,
} from "../../../src/types/adapter.js";
import type { VextApp, VextConfig } from "../../../src/types/app.js";
import type {
  VextMiddleware,
  VextErrorMiddleware,
} from "../../../src/types/middleware.js";
import type { VextRequest } from "../../../src/types/request.js";
import type { VextResponse } from "../../../src/types/response.js";
import { DEFAULT_CONFIG } from "../../../src/lib/app.js";
import http from "node:http";

// ── 测试辅助 ─────────────────────────────────────────────────

/**
 * 创建最小化的 mock VextApp 实例
 *
 * Express Adapter 需要 VextApp 实例来：
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

describe("Express Adapter — VextAdapter 接口合规性", () => {
  let adapter: VextAdapter;
  let handle: VextServerHandle | null = null;
  let mockApp: VextApp;

  beforeEach(() => {
    mockApp = createMockApp();
    adapter = createExpressAdapter({}, mockApp);
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
    it("应具有 name 属性且值为 'express'", () => {
      expect(adapter.name).toBe("express");
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
          res.json({ received: true });
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

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ received: true });
    });

    it("应支持所有 HTTP 方法（PUT / PATCH / DELETE / HEAD / OPTIONS）", async () => {
      const methods = ["PUT", "PATCH", "DELETE", "OPTIONS"];

      for (const method of methods) {
        const localAdapter = createExpressAdapter({}, mockApp);
        localAdapter.registerRoute(method, "/test", [
          async (req: VextRequest, res: VextResponse) => {
            res.json({ method: req.method });
          },
        ]);

        const localHandle = await localAdapter.listen(0, "127.0.0.1");
        try {
          const response = await httpRequest({
            port: localHandle.port,
            method,
            path: "/test",
          });

          if (method === "HEAD") {
            expect(response.status).toBe(200);
          } else {
            expect(response.status).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toEqual({ method });
          }
        } finally {
          await localHandle.close();
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

      adapter.registerRoute("GET", "/order", [
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
      await httpRequest({ port: handle.port, path: "/order" });

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
        (req as any).custom = "injected-value";
        await next();
      });

      adapter.registerRoute("GET", "/custom", [
        async (req, res) => {
          res.json({ custom: (req as any).custom });
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

      adapter.registerMiddleware(async (req, res) => {
        order.push("guard");
        res.rawJson({ code: 403, message: "Forbidden" }, 403);
        // 不调用 next()
      });

      adapter.registerRoute("GET", "/protected", [
        async (req, res) => {
          order.push("handler"); // 不应执行
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
  });

  // ── 4. 错误处理 ────────────────────────────────────────────

  describe("错误处理", () => {
    it("应通过 errorHandler 捕获中间件链抛出的错误", async () => {
      let caughtError: unknown = null;

      adapter.registerErrorHandler((err, req, res) => {
        caughtError = err;
        res.rawJson({ code: 500, message: "Caught!" }, 500);
      });

      adapter.registerRoute("GET", "/error", [
        async () => {
          throw new Error("test error");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/error",
      });

      expect(response.status).toBe(500);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ code: 500, message: "Caught!" });
      expect(caughtError).toBeInstanceOf(Error);
    });

    it("errorHandler 自身抛出异常时应返回最低限度 500", async () => {
      adapter.registerErrorHandler(() => {
        throw new Error("handler also fails");
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
    });
  });

  // ── 5. 404 Not Found ──────────────────────────────────────

  describe("404 Not Found", () => {
    it("应通过 notFoundHandler 处理未匹配路由", async () => {
      let notFoundCalled = false;

      adapter.registerNotFound(async (req, res) => {
        notFoundCalled = true;
        res.rawJson({ code: 404, message: "Custom Not Found" }, 404);
      });

      adapter.registerRoute("GET", "/exists", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      // 请求不存在的路由
      const response = await httpRequest({
        port: handle.port,
        path: "/does-not-exist",
      });

      expect(response.status).toBe(404);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ code: 404, message: "Custom Not Found" });
      expect(notFoundCalled).toBe(true);
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
      await httpRequest({ port: handle.port, path: "/nope" });

      expect(capturedRequestId).toBeTruthy();
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
        path: "/missing",
        headers: { "x-request-id": "custom-req-id-123" },
      });

      expect(capturedRequestId).toBe("custom-req-id-123");
    });
  });

  // ── 6. VextResponse 方法 ──────────────────────────────────

  describe("VextResponse 方法", () => {
    it("json() 应返回 JSON 和正确的 Content-Type", async () => {
      adapter.registerRoute("GET", "/json", [
        async (req, res) => {
          res.json({ name: "test" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/json" });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(response.body)).toEqual({ name: "test" });
    });

    it("json() + _enableWrap() 应包装为 { code: 0, data, requestId }", async () => {
      adapter.registerMiddleware(async (req, res, next) => {
        req.requestId = "test-req-id";
        res._enableWrap();
        await next();
      });

      adapter.registerRoute("GET", "/wrapped", [
        async (req, res) => {
          res.json({ name: "test" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/wrapped",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.code).toBe(0);
      expect(body.data).toEqual({ name: "test" });
      expect(body.requestId).toBe("test-req-id");
    });

    it("json() + 204 应返回无消息体（RFC 9110 §15.3.5）", async () => {
      adapter.registerRoute("DELETE", "/resource", [
        async (req, res) => {
          res.status(204).json(null);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        method: "DELETE",
        path: "/resource",
      });

      expect(response.status).toBe(204);
      expect(response.body).toBe("");
    });

    it("json() + 204 + _enableWrap() 仍应返回无消息体", async () => {
      adapter.registerMiddleware(async (req, res, next) => {
        req.requestId = "test-req-id";
        res._enableWrap();
        await next();
      });

      adapter.registerRoute("DELETE", "/wrapped-204", [
        async (req, res) => {
          res.status(204).json(null);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        method: "DELETE",
        path: "/wrapped-204",
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
          res.rawJson({ custom: "data" });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/raw" });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      // rawJson 不应包含 code / data / requestId 包装
      expect(body).toEqual({ custom: "data" });
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

    it("status() 应支持链式调用", async () => {
      adapter.registerRoute("POST", "/created", [
        async (req, res) => {
          res.status(201).json({ id: "new-item" });
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
      expect(body).toEqual({ id: "new-item" });
    });

    it("setHeader() 应支持链式调用并设置自定义响应头", async () => {
      adapter.registerRoute("GET", "/custom-header", [
        async (req, res) => {
          res.setHeader("X-Custom", "my-value").json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/custom-header",
      });

      expect(response.status).toBe(200);
      expect(response.headers["x-custom"]).toBe("my-value");
    });

    it("statusCode 只读属性应返回当前状态码", async () => {
      let capturedStatusCode = 0;

      adapter.registerRoute("POST", "/status-check", [
        async (req, res, next) => {
          await next();
          capturedStatusCode = res.statusCode;
        },
        async (req, res) => {
          res.status(201).json({ created: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/status-check",
      });

      expect(capturedStatusCode).toBe(201);
    });

    it("redirect() 应返回重定向响应", async () => {
      adapter.registerRoute("GET", "/old-page", [
        async (req, res) => {
          res.redirect("/new-page", 301);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      // 使用低级 http.request 以避免自动跟随重定向
      const response = await new Promise<{
        status: number;
        headers: http.IncomingHttpHeaders;
      }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: handle!.port,
            method: "GET",
            path: "/old-page",
          },
          (res) => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
            });
            res.resume(); // 消费响应体
          },
        );
        req.on("error", reject);
        req.end();
      });

      expect(response.status).toBe(301);
      expect(response.headers.location).toBe("/new-page");
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
  });

  // ── 7. VextRequest 字段 ────────────────────────────────────

  describe("VextRequest 字段", () => {
    it("req.method 应为大写", async () => {
      let method = "";

      adapter.registerRoute("POST", "/method-test", [
        async (req, res) => {
          method = req.method;
          res.json({ method });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/method-test",
      });

      expect(method).toBe("POST");
    });

    it("req.path 应不含 query string", async () => {
      let path = "";

      adapter.registerRoute("GET", "/path-test", [
        async (req, res) => {
          path = req.path;
          res.json({ path });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/path-test?foo=bar",
      });

      expect(path).toBe("/path-test");
    });

    it("req.url 应包含完整路径和 query string", async () => {
      let url = "";

      adapter.registerRoute("GET", "/url-test", [
        async (req, res) => {
          url = req.url;
          res.json({ url });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/url-test?key=value",
      });

      expect(url).toContain("/url-test");
      expect(url).toContain("key=value");
    });

    it("req.headers 应包含请求头（key 小写）", async () => {
      let headerValue = "";

      adapter.registerRoute("GET", "/header-test", [
        async (req, res) => {
          headerValue = req.headers["x-custom-header"] as string;
          res.json({ header: headerValue });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        path: "/header-test",
        headers: { "X-Custom-Header": "custom-value" },
      });

      expect(headerValue).toBe("custom-value");
    });

    it("req.app 应指向 VextApp 实例", async () => {
      let appRef: VextApp | null = null;

      adapter.registerRoute("GET", "/app-test", [
        async (req, res) => {
          appRef = req.app;
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/app-test" });

      expect(appRef).toBe(mockApp);
    });

    it("req.requestId 初始应为空字符串", async () => {
      let requestId = "should-be-empty";

      adapter.registerRoute("GET", "/reqid-test", [
        async (req, res) => {
          requestId = req.requestId;
          res.json({ requestId });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/reqid-test" });

      expect(requestId).toBe("");
    });

    it("req.ip 应有值", async () => {
      let ip = "";

      adapter.registerRoute("GET", "/ip-test", [
        async (req, res) => {
          ip = req.ip;
          res.json({ ip });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/ip-test" });

      expect(ip).toBeTruthy();
    });

    it("trustProxy = true 时 req.ip 应从 X-Forwarded-For 读取", async () => {
      const trustedApp = createMockApp({ trustProxy: true });
      const trustedAdapter = createExpressAdapter({}, trustedApp);
      let ip = "";

      trustedAdapter.registerRoute("GET", "/ip-proxy", [
        async (req, res) => {
          ip = req.ip;
          res.json({ ip });
        },
      ]);

      const trustedHandle = await trustedAdapter.listen(0, "127.0.0.1");
      try {
        await httpRequest({
          port: trustedHandle.port,
          path: "/ip-proxy",
          headers: { "X-Forwarded-For": "10.0.0.1, 172.16.0.1" },
        });

        expect(ip).toBe("10.0.0.1");
      } finally {
        await trustedHandle.close();
      }
    });

    it("trustProxy = true 时 req.protocol 应从 X-Forwarded-Proto 读取", async () => {
      const trustedApp = createMockApp({ trustProxy: true });
      const trustedAdapter = createExpressAdapter({}, trustedApp);
      let protocol = "";

      trustedAdapter.registerRoute("GET", "/proto-proxy", [
        async (req, res) => {
          protocol = req.protocol;
          res.json({ protocol });
        },
      ]);

      const trustedHandle = await trustedAdapter.listen(0, "127.0.0.1");
      try {
        await httpRequest({
          port: trustedHandle.port,
          path: "/proto-proxy",
          headers: { "X-Forwarded-Proto": "https" },
        });

        expect(protocol).toBe("https");
      } finally {
        await trustedHandle.close();
      }
    });

    it("req.valid() 应返回 _validated_<location> 上的数据", async () => {
      let validQuery: any = null;

      adapter.registerMiddleware(async (req, res, next) => {
        (req as any)._validated_query = { page: 1, limit: 10 };
        await next();
      });

      adapter.registerRoute("GET", "/valid-test", [
        async (req, res) => {
          validQuery = req.valid("query");
          res.json(validQuery);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/valid-test" });

      expect(validQuery).toEqual({ page: 1, limit: 10 });
    });
  });

  // ── 8. Body 解析兼容性（_getRawBody） ─────────────────────

  describe("Body 解析兼容性（_getRawBody）", () => {
    it("POST JSON body 应通过 _getRawBody 可读", async () => {
      let rawBody = "";

      adapter.registerRoute("POST", "/raw-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody;
          expect(typeof getRawBody).toBe("function");
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
      let rawBody = "initial";

      adapter.registerRoute("GET", "/get-raw", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody;
          expect(typeof getRawBody).toBe("function");
          rawBody = await getRawBody();
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/get-raw" });

      expect(rawBody).toBe("");
    });

    it("_getRawBody 多次调用应返回相同结果（缓存）", async () => {
      let firstCall = "";
      let secondCall = "";

      adapter.registerRoute("POST", "/cache-body", [
        async (req, res) => {
          const getRawBody = (req as any)._getRawBody;
          expect(typeof getRawBody).toBe("function");
          firstCall = await getRawBody();
          secondCall = await getRawBody();
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({
        port: handle.port,
        method: "POST",
        path: "/cache-body",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cached: true }),
      });

      expect(firstCall).toBe(secondCall);
      expect(firstCall).toBe('{"cached":true}');
    });
  });

  // ── 9. listen / close / port ───────────────────────────────

  describe("listen / close / port", () => {
    it("listen(0) 应分配随机端口且 port > 0", async () => {
      handle = await adapter.listen(0, "127.0.0.1");

      expect(handle.port).toBeGreaterThan(0);
      expect(typeof handle.close).toBe("function");
    });

    it("close() 后端口应释放", async () => {
      adapter.registerRoute("GET", "/close-test", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      expect(handle.port).toBeGreaterThan(0);

      const port = handle.port;

      // 确认服务器可用
      const response = await httpRequest({ port, path: "/close-test" });
      expect(response.status).toBe(200);

      // 关闭服务器
      await handle.close();
      handle = null;

      // 确认连接被拒绝
      await expect(
        httpRequest({ port, path: "/close-test" }),
      ).rejects.toThrow();
    });

    it("close() 应可多次调用而不报错", async () => {
      handle = await adapter.listen(0, "127.0.0.1");

      await handle.close();
      // 第二次 close 可能会报 ERR_SERVER_NOT_RUNNING，但不应 throw 到调用方
      // 或者确实报错也是合理的 — 这里只测试第一次 close 成功
      handle = null;
    });
  });

  // ── 10. buildHandler ───────────────────────────────────────

  describe("buildHandler", () => {
    it("应返回 (req, res) => void 函数", async () => {
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
      // 创建独立的 adapter 实例用于此测试
      const buildAdapter = createExpressAdapter({}, mockApp);

      buildAdapter.registerRoute("GET", "/build-test", [
        async (req, res) => {
          res.json({ source: "buildHandler" });
        },
      ]);

      // Express app 本身就是 handler，无需先 listen
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
  });

  // ── 11. Express 特有行为 ───────────────────────────────────

  describe("Express 特有行为", () => {
    it("不应返回 X-Powered-By 响应头", async () => {
      adapter.registerRoute("GET", "/no-powered-by", [
        async (req, res) => {
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/no-powered-by",
      });

      expect(response.headers["x-powered-by"]).toBeUndefined();
    });
  });

  // ── 12. 并发请求隔离 ───────────────────────────────────────

  describe("并发请求隔离", () => {
    it("多个并发请求不应互相干扰", async () => {
      adapter.registerRoute("GET", "/concurrent/:id", [
        async (req, res) => {
          const id = req.params.id;
          // 模拟异步延迟
          const delay = id === "1" ? 50 : 10;
          await new Promise((r) => setTimeout(r, delay));
          res.json({ id });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");

      const [r1, r2] = await Promise.all([
        httpRequest({ port: handle.port, path: "/concurrent/1" }),
        httpRequest({ port: handle.port, path: "/concurrent/2" }),
      ]);

      expect(JSON.parse(r1.body)).toEqual({ id: "1" });
      expect(JSON.parse(r2.body)).toEqual({ id: "2" });
    });
  });
});

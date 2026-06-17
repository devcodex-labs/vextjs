import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHonoAdapter } from "../../../src/adapters/hono/adapter.js";
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
 * Hono Adapter 需要 VextApp 实例来：
 *   - 读取 config.requestId.header
 *   - 读取 config.requestContext.enabled（ALS 开关）
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

describe("Hono Adapter — VextAdapter 接口合规性", () => {
  let adapter: VextAdapter;
  let handle: VextServerHandle | null = null;
  let mockApp: VextApp;

  beforeEach(() => {
    mockApp = createMockApp();
    adapter = createHonoAdapter(mockApp);
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
    it("应具有 name 属性且值为 'hono'", () => {
      expect(adapter.name).toBe("hono");
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

    it("路由参数应正确解析", async () => {
      adapter.registerRoute("GET", "/users/:id", [
        async (req: VextRequest, res: VextResponse) => {
          res.json({ id: req.params["id"] });
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

    it("未注册路由应返回 404", async () => {
      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/not-exist",
      });

      expect(response.status).toBe(404);
    });
  });

  // ── 3. VextResponse 方法 ───────────────────────────────────

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

    it("_sendHtml() 应发送 HTML 响应并保留自定义响应头", async () => {
      adapter.registerRoute("GET", "/render-html", [
        async (_req, res) => {
          res._sendHtml?.(
            "<main>Rendered</main>",
            202,
            { "X-Render": "yes" },
            "render",
            { page: "index" },
          );
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/render-html",
      });

      expect(response.status).toBe(202);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["x-render"]).toBe("yes");
      expect(response.body).toBe("<main>Rendered</main>");
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

    it("redirect() 应返回正确的重定向响应", async () => {
      adapter.registerRoute("GET", "/old", [
        async (req, res) => {
          res.redirect("/new", 301);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/old" });

      expect(response.status).toBe(301);
      expect(response.headers["location"]).toBe("/new");
    });

    it("json() 传入 204 状态码应返回无消息体的响应", async () => {
      adapter.registerRoute("DELETE", "/item", [
        async (req, res) => {
          res.json(null, 204);
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

    it("rawJson() 应跳过出口包装直接返回 JSON", async () => {
      adapter.registerRoute("GET", "/raw", [
        async (req, res) => {
          (res as any).rawJson({ code: 500, message: "error" }, 500);
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/raw" });

      expect(response.status).toBe(500);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ code: 500, message: "error" });
    });

    it("statusCode 只读属性应反映通过 status() 设置的值", async () => {
      let capturedStatus = 0;

      adapter.registerRoute("GET", "/status-read", [
        async (req, res) => {
          res.status(201);
          capturedStatus = res.statusCode;
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/status-read" });

      expect(capturedStatus).toBe(201);
    });
  });

  // ── 4. 中间件支持 ─────────────────────────────────────────

  describe("中间件支持", () => {
    it("全局中间件应在 handler 之前执行", async () => {
      const order: string[] = [];

      adapter.registerMiddleware(async (req, res, next) => {
        order.push("middleware");
        await next();
      });

      adapter.registerRoute("GET", "/order", [
        async (req, res) => {
          order.push("handler");
          res.json({ order });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/order" });

      expect(order).toEqual(["middleware", "handler"]);
    });

    it("洋葱模型：after-middleware 应在 handler 之后执行", async () => {
      const order: string[] = [];

      adapter.registerMiddleware(async (req, res, next) => {
        order.push("before");
        await next();
        order.push("after");
      });

      adapter.registerRoute("GET", "/onion", [
        async (req, res) => {
          order.push("handler");
          res.json({ ok: true });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      await httpRequest({ port: handle.port, path: "/onion" });

      expect(order).toEqual(["before", "handler", "after"]);
    });

    it("中间件可通过 req 向 handler 传递数据", async () => {
      adapter.registerMiddleware(async (req: any, res, next) => {
        req.customData = "from-middleware";
        await next();
      });

      adapter.registerRoute("GET", "/passdata", [
        async (req: any, res) => {
          res.json({ data: req.customData });
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/passdata",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ data: "from-middleware" });
    });
  });

  // ── 5. 错误处理 ────────────────────────────────────────────

  describe("错误处理", () => {
    it("registerErrorHandler 应捕获 handler 抛出的异常", async () => {
      adapter.registerErrorHandler((err: any, req, res) => {
        (res as any).rawJson({ code: 500, message: err.message }, 500);
      });

      adapter.registerRoute("GET", "/throw", [
        async (req, res) => {
          throw new Error("test error");
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({ port: handle.port, path: "/throw" });

      expect(response.status).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.message).toBe("test error");
    });
  });

  // ── 6. Not Found 处理 ─────────────────────────────────────

  describe("Not Found 处理", () => {
    it("registerNotFound 应自定义 404 响应", async () => {
      adapter.registerNotFound(async (req, res) => {
        (res as any).rawJson({ code: 404, message: "custom not found" }, 404);
      });

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/not-exist",
      });

      expect(response.status).toBe(404);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ code: 404, message: "custom not found" });
    });
  });

  // ── 7. 重复发送保护 ────────────────────────────────────────

  describe("重复发送保护", () => {
    it("重复调用发送方法应被忽略，不抛出异常", async () => {
      adapter.registerRoute("GET", "/double", [
        async (req, res) => {
          res.json({ first: true });
          res.json({ second: true }); // 应被忽略
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/double",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ first: true });
    });

    it("重复调用不同发送方法也应被忽略", async () => {
      adapter.registerRoute("GET", "/double-mixed", [
        async (req, res) => {
          res.json({ data: "json" });
          res.text("text"); // 应被忽略
        },
      ]);

      handle = await adapter.listen(0, "127.0.0.1");
      const response = await httpRequest({
        port: handle.port,
        path: "/double-mixed",
      });

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ data: "json" });
    });
  });

  // ── 8. buildHandler ───────────────────────────────────────

  describe("buildHandler", () => {
    it("buildHandler 应返回一个函数", () => {
      const handler = adapter.buildHandler();
      expect(typeof handler).toBe("function");
    });
  });
});

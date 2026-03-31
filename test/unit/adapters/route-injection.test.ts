/**
 * route-injection.test.ts — F-01 req.route 注入验证
 *
 * 覆盖场景（每个 Adapter × 4 场景 = 5 × 4 = 20 个测试用例）：
 *   1. 静态路由：GET /users → req.route === '/users'
 *   2. 路径参数路由：GET /users/:id → req.route === '/users/:id'
 *   3. 嵌套参数路由：GET /orgs/:orgId/users/:userId → 正确模板
 *   4. 404 场景：notFound handler 中 req.route === ''
 *
 * 测试原理：
 *   在路由 handler 内将 req.route 写入响应体，通过 HTTP 请求读取验证。
 *
 * @see src/adapters/ - adapter.ts in each adapter dir (registerRoute impl)
 * @see src/types/request.ts - VextRequest.route field definition
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { DEFAULT_CONFIG } from "../../../src/lib/app.js";
import { createNativeAdapter } from "../../../src/adapters/native/adapter.js";
import { createHonoAdapter } from "../../../src/adapters/hono/adapter.js";
import { createFastifyAdapter } from "../../../src/adapters/fastify/adapter.js";
import { createExpressAdapter } from "../../../src/adapters/express/adapter.js";
import { createKoaAdapter } from "../../../src/adapters/koa/adapter.js";
import type {
  VextAdapter,
  VextServerHandle,
} from "../../../src/types/adapter.js";
import type { VextApp, VextConfig } from "../../../src/types/app.js";
import type { VextRequest } from "../../../src/types/request.js";
import type { VextResponse } from "../../../src/types/response.js";

// ── 测试辅助 ─────────────────────────────────────────────────

function createMockApp(configOverrides?: Partial<VextConfig>): VextApp {
  const config = { ...DEFAULT_CONFIG, ...configOverrides } as VextConfig;
  const silentLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child: () => silentLogger,
  };

  return {
    config,
    logger: silentLogger,
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

function httpRequest(options: {
  port: number;
  method?: string;
  path?: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: options.port,
        method: options.method ?? "GET",
        path: options.path ?? "/",
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** 将 req.route 写入 JSON 响应体的通用 handler */
function makeRouteEchoHandler() {
  return async (req: VextRequest, res: VextResponse) => {
    res.json({ route: req.route });
  };
}

/** 注册一个把 req.route 写入响应体的 notFound handler */
function registerNotFoundEcho(adapter: VextAdapter) {
  adapter.registerNotFound(async (req: VextRequest, res: VextResponse) => {
    res.json({ route: req.route }, 404);
  });
}

// ── 通用测试套件工厂 ─────────────────────────────────────────

/**
 * 针对单个 adapter 的 route 注入测试套件
 *
 * @param name   Adapter 名称（用于 describe 标题）
 * @param create 创建 VextAdapter 实例的工厂函数
 */
function makeRouteInjectionSuite(
  name: string,
  create: (app: VextApp) => VextAdapter
) {
  describe(`${name} Adapter — req.route 注入`, () => {
    let adapter: VextAdapter;
    let handle: VextServerHandle | null = null;

    beforeEach(() => {
      adapter = create(createMockApp());
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

    // ── 场景 1：静态路由 ──────────────────────────────────

    it("静态路由：req.route 应等于注册的路径字符串", async () => {
      adapter.registerRoute("GET", "/users", [makeRouteEchoHandler()]);
      registerNotFoundEcho(adapter);

      handle = await adapter.listen(0, "127.0.0.1");
      const res = await httpRequest({ port: handle.port, path: "/users" });

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.route).toBe("/users");
    });

    // ── 场景 2：单路径参数路由 ────────────────────────────

    it("路径参数路由：req.route 应为模板（如 /users/:id），而非实际路径", async () => {
      adapter.registerRoute("GET", "/users/:id", [makeRouteEchoHandler()]);
      registerNotFoundEcho(adapter);

      handle = await adapter.listen(0, "127.0.0.1");
      // 请求实际路径 /users/abc-123，route 应为模板 /users/:id
      const res = await httpRequest({
        port: handle.port,
        path: "/users/abc-123",
      });

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.route).toBe("/users/:id");
      // 确认不是实际路径（高基数的值）
      expect(body.route).not.toBe("/users/abc-123");
    });

    // ── 场景 3：嵌套路径参数路由 ──────────────────────────

    it("嵌套参数路由：多个 :param 的路由模板应完整保留", async () => {
      adapter.registerRoute("GET", "/orgs/:orgId/users/:userId", [
        makeRouteEchoHandler(),
      ]);
      registerNotFoundEcho(adapter);

      handle = await adapter.listen(0, "127.0.0.1");
      const res = await httpRequest({
        port: handle.port,
        path: "/orgs/org-42/users/usr-99",
      });

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.route).toBe("/orgs/:orgId/users/:userId");
    });

    // ── 场景 4：404 场景 ──────────────────────────────────

    it("404 场景：notFound handler 中 req.route 应为空字符串 ''", async () => {
      // 注册一个无关路由，访问不存在的路径触发 notFound
      adapter.registerRoute("GET", "/exists", [makeRouteEchoHandler()]);
      registerNotFoundEcho(adapter);

      handle = await adapter.listen(0, "127.0.0.1");
      const res = await httpRequest({
        port: handle.port,
        path: "/not-found-path",
      });

      expect(res.status).toBe(404);
      const body = JSON.parse(res.body);
      // 未匹配路由时 route 为空字符串（非 undefined / null）
      expect(body.route).toBe("");
    });
  });
}

// ── 执行各 Adapter 的测试套件 ────────────────────────────────

makeRouteInjectionSuite("Native", (app) => createNativeAdapter({}, app));

makeRouteInjectionSuite("Hono", (app) => createHonoAdapter(app));

makeRouteInjectionSuite("Fastify", (app) => createFastifyAdapter({}, app));

makeRouteInjectionSuite("Express", (app) => createExpressAdapter({}, app));

makeRouteInjectionSuite("Koa", (app) => createKoaAdapter({}, app));

// ── 多路由注册验证（Native 代表性测试）───────────────────────

describe("多路由注册 — 不同路由模板互不干扰", () => {
  let adapter: VextAdapter;
  let handle: VextServerHandle | null = null;

  beforeEach(() => {
    adapter = createNativeAdapter({}, createMockApp());
  });

  afterEach(async () => {
    if (handle) {
      await handle.close().catch(() => {});
      handle = null;
    }
  });

  it("同时注册多条路由，各自 req.route 应独立正确", async () => {
    adapter.registerRoute("GET", "/a", [makeRouteEchoHandler()]);
    adapter.registerRoute("GET", "/b/:id", [makeRouteEchoHandler()]);
    adapter.registerRoute("POST", "/c/:x/d/:y", [makeRouteEchoHandler()]);
    registerNotFoundEcho(adapter);

    handle = await adapter.listen(0, "127.0.0.1");

    const [r1, r2, r3] = await Promise.all([
      httpRequest({ port: handle.port, path: "/a" }),
      httpRequest({ port: handle.port, path: "/b/hello" }),
      httpRequest({ port: handle.port, method: "POST", path: "/c/1/d/2" }),
    ]);

    expect(JSON.parse(r1.body).route).toBe("/a");
    expect(JSON.parse(r2.body).route).toBe("/b/:id");
    expect(JSON.parse(r3.body).route).toBe("/c/:x/d/:y");
  });
});

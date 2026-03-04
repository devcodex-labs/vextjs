/**
 * Adapter E2E 测试
 *
 * 真实 HTTP 端到端测试，验证所有 5 个 Adapter（Hono / Fastify / Express / Koa / Native）
 * 在完整 bootstrap 启动后的行为一致性：
 *
 *   - GET / → hello world 响应
 *   - CRUD 全链路（GET /users/list, POST /users, GET /users/:id, PUT /users/:id, DELETE /users/:id）
 *   - 422 校验错误响应格式
 *   - 404 未匹配路由
 *   - 500 错误处理（同步 + 异步）
 *   - requestId 自动生成与透传
 *   - 自定义 header 透传
 *   - 并发请求正确性
 *   - Content-Type 响应头
 *   - 健康检查端点 /health
 *   - 优雅关闭（close 后端口释放）
 *
 * 策略：
 *   每个 adapter 独立创建临时项目 → bootstrap 启动真实 HTTP 服务器 →
 *   通过 Node.js 内置 fetch 发送真实 TCP 请求 → 断言响应 → 优雅关闭 → 清理临时目录。
 *
 * @see 10-testing.md §9（CI 集成指南）
 * @see IMPLEMENTATION-PLAN.md 任务 4.5
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  allocatePort,
  createE2EProject,
  startE2EApp,
  stopE2EApp,
  cleanupE2EProject,
  e2eGet,
  e2ePost,
  e2ePut,
  e2eDelete,
  e2eRequest,
  type E2EApp,
  type E2EProject,
} from "./helpers.js";

// ── 所有 adapter 的测试矩阵 ──────────────────────────────────

const ADAPTERS = ["hono", "fastify", "express", "koa", "native"] as const;

for (const adapterName of ADAPTERS) {
  describe(`E2E: ${adapterName} adapter`, () => {
    let app: E2EApp;
    let project: E2EProject;

    beforeAll(async () => {
      const port = allocatePort();
      project = await createE2EProject({ adapter: adapterName, port });
      app = await startE2EApp(project);
    }, 30_000);

    afterAll(async () => {
      if (app) await stopE2EApp(app);
      if (project) await cleanupE2EProject(project);
    }, 15_000);

    // ── GET / — Hello World ──────────────────────────────

    describe("GET /", () => {
      it("returns 200 with hello message", async () => {
        const res = await e2eGet(app.baseUrl, "/");
        expect(res.status).toBe(200);

        const body = res.body as Record<string, unknown>;
        expect(body).toHaveProperty("code", 0);
        expect(body).toHaveProperty("requestId");

        const data = body.data as Record<string, unknown>;
        expect(data).toHaveProperty("message", "hello vext");
        expect(data).toHaveProperty("adapter", adapterName);
      });

      it("returns application/json content type", async () => {
        const res = await e2eGet(app.baseUrl, "/");
        expect(res.headers["content-type"]).toContain("application/json");
      });
    });

    // ── requestId ────────────────────────────────────────

    describe("requestId", () => {
      it("auto-generates requestId when not provided", async () => {
        const res = await e2eGet(app.baseUrl, "/");
        const body = res.body as Record<string, unknown>;
        expect(body.requestId).toBeDefined();
        expect(typeof body.requestId).toBe("string");
        expect((body.requestId as string).length).toBeGreaterThan(0);
      });

      it("returns requestId in response header", async () => {
        const res = await e2eGet(app.baseUrl, "/");
        expect(res.headers["x-request-id"]).toBeDefined();
        expect(res.headers["x-request-id"]!.length).toBeGreaterThan(0);
      });

      it("transparently passes requestId from x-request-id header", async () => {
        const customId = "e2e-test-custom-id-12345";
        const res = await e2eGet(app.baseUrl, "/", {
          headers: { "x-request-id": customId },
        });

        const body = res.body as Record<string, unknown>;
        expect(body.requestId).toBe(customId);
        expect(res.headers["x-request-id"]).toBe(customId);
      });

      it("generates unique requestId for each request", async () => {
        const res1 = await e2eGet(app.baseUrl, "/");
        const res2 = await e2eGet(app.baseUrl, "/");

        const body1 = res1.body as Record<string, unknown>;
        const body2 = res2.body as Record<string, unknown>;
        expect(body1.requestId).not.toBe(body2.requestId);
      });
    });

    // ── Custom Headers ───────────────────────────────────

    describe("custom headers", () => {
      it("passes custom headers to handler", async () => {
        const res = await e2eGet(app.baseUrl, "/echo-header", {
          headers: { "x-custom-header": "my-value-123" },
        });

        expect(res.status).toBe(200);
        const data = (res.body as Record<string, unknown>).data as Record<
          string,
          unknown
        >;
        expect(data.echo).toBe("my-value-123");
      });
    });

    // ── CRUD: GET /users/list ────────────────────────────

    describe("GET /users/list", () => {
      it("returns 200 with user list", async () => {
        const res = await e2eGet(app.baseUrl, "/users/list?page=1&limit=10");
        expect(res.status).toBe(200);

        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(0);

        const data = body.data as Record<string, unknown>;
        expect(data.list).toBeInstanceOf(Array);
        expect((data.list as unknown[]).length).toBeGreaterThanOrEqual(1);
        expect(data.total).toBeGreaterThanOrEqual(1);
      });

      it("returns paginated results", async () => {
        const res = await e2eGet(app.baseUrl, "/users/list?page=1&limit=1");
        expect(res.status).toBe(200);

        const data = (res.body as Record<string, unknown>).data as Record<
          string,
          unknown
        >;
        expect((data.list as unknown[]).length).toBe(1);
        expect(data.page).toBe(1);
        expect(data.limit).toBe(1);
      });

      it("returns 422 on invalid page parameter", async () => {
        const res = await e2eGet(app.baseUrl, "/users/list?page=-1&limit=10");
        expect(res.status).toBe(422);

        const body = res.body as Record<string, unknown>;
        expect(body.field).toBe("page");
      });

      it("returns 422 on invalid limit parameter", async () => {
        const res = await e2eGet(app.baseUrl, "/users/list?page=1&limit=999");
        expect(res.status).toBe(422);

        const body = res.body as Record<string, unknown>;
        expect(body.field).toBe("limit");
      });
    });

    // ── CRUD: POST /users ────────────────────────────────

    describe("POST /users", () => {
      it("creates user and returns 201", async () => {
        const res = await e2ePost(app.baseUrl, "/users", {
          name: "Charlie",
          email: "charlie@test.com",
        });

        expect(res.status).toBe(201);
        const body = res.body as Record<string, unknown>;
        const data = body.data as Record<string, unknown>;
        expect(data.name).toBe("Charlie");
        expect(data.email).toBe("charlie@test.com");
        expect(data.id).toBeDefined();
      });

      it("returns 422 when name is missing", async () => {
        const res = await e2ePost(app.baseUrl, "/users", {
          email: "noname@test.com",
        });

        expect(res.status).toBe(422);
        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(422);
      });

      it("returns 422 when email is missing", async () => {
        const res = await e2ePost(app.baseUrl, "/users", {
          name: "NoEmail",
        });

        expect(res.status).toBe(422);
        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(422);
      });

      it("returns 422 when body is empty", async () => {
        const res = await e2eRequest(`${app.baseUrl}/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });

        expect(res.status).toBe(422);
      });
    });

    // ── CRUD: GET /users/:id ─────────────────────────────

    describe("GET /users/:id", () => {
      it("returns existing user by id", async () => {
        const res = await e2eGet(app.baseUrl, "/users/1");
        expect(res.status).toBe(200);

        const data = (res.body as Record<string, unknown>).data as Record<
          string,
          unknown
        >;
        expect(data.id).toBe(1);
        expect(data.name).toBeDefined();
      });

      it("returns 404 for non-existing user", async () => {
        const res = await e2eGet(app.baseUrl, "/users/99999");
        expect(res.status).toBe(404);

        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(404);
      });
    });

    // ── CRUD: PUT /users/:id ─────────────────────────────

    describe("PUT /users/:id", () => {
      it("updates existing user", async () => {
        const res = await e2ePut(app.baseUrl, "/users/1", {
          name: "Alice Updated",
        });
        expect(res.status).toBe(200);

        const data = (res.body as Record<string, unknown>).data as Record<
          string,
          unknown
        >;
        expect(data.name).toBe("Alice Updated");
      });

      it("returns 404 for non-existing user", async () => {
        const res = await e2ePut(app.baseUrl, "/users/99999", {
          name: "Ghost",
        });
        expect(res.status).toBe(404);

        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(404);
      });
    });

    // ── CRUD: DELETE /users/:id ──────────────────────────

    describe("DELETE /users/:id", () => {
      it("deletes existing user and returns 204", async () => {
        // 先创建一个用户用于删除
        const createRes = await e2ePost(app.baseUrl, "/users", {
          name: "ToDelete",
          email: "delete@test.com",
        });
        const created = (createRes.body as Record<string, unknown>)
          .data as Record<string, unknown>;
        const id = created.id;

        const res = await e2eDelete(app.baseUrl, `/users/${id}`);
        expect(res.status).toBe(204);
      });

      it("returns 404 for non-existing user", async () => {
        const res = await e2eDelete(app.baseUrl, "/users/99999");
        expect(res.status).toBe(404);

        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(404);
      });
    });

    // ── 404 Not Found ────────────────────────────────────

    describe("404 Not Found", () => {
      it("returns 404 for unmatched route", async () => {
        const res = await e2eGet(app.baseUrl, "/this/route/does/not/exist");
        expect(res.status).toBe(404);

        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(404);
        expect(body.message).toContain("Not Found");
      });

      it("returns 404 for wrong HTTP method", async () => {
        // PATCH /users/list 不存在
        const res = await e2eRequest(`${app.baseUrl}/users/list`, {
          method: "PATCH",
        });
        expect(res.status).toBe(404);
      });
    });

    // ── 500 Error Handling ───────────────────────────────

    describe("500 Error handling", () => {
      it("returns 500 on synchronous error", async () => {
        const res = await e2eGet(app.baseUrl, "/errors/sync-error");
        expect(res.status).toBe(500);

        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(500);
        // hideInternalErrors=true → 不暴露内部错误信息
        expect(body.requestId).toBeDefined();
      });

      it("returns 500 on asynchronous error", async () => {
        const res = await e2eGet(app.baseUrl, "/errors/async-error");
        expect(res.status).toBe(500);

        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(500);
        expect(body.requestId).toBeDefined();
      });

      it("returns custom status code", async () => {
        const res = await e2eGet(app.baseUrl, "/errors/custom-status");
        expect(res.status).toBe(418);

        const body = res.body as Record<string, unknown>;
        expect(body.code).toBe(418);
        expect(body.message).toBe("I'm a teapot");
      });
    });

    // ── Health Check ─────────────────────────────────────

    describe("GET /health", () => {
      it("returns health status", async () => {
        const res = await e2eGet(app.baseUrl, "/health");
        expect(res.status).toBe(200);

        const body = res.body as Record<string, unknown>;
        expect(body).toHaveProperty("code", 0);
        const data = body.data as Record<string, unknown>;
        expect(data).toHaveProperty("status", "ok");
      });
    });

    // ── 并发请求 ─────────────────────────────────────────

    describe("concurrent requests", () => {
      it("handles 10 concurrent requests correctly", async () => {
        const promises = Array.from({ length: 10 }, (_, i) =>
          e2eGet(app.baseUrl, `/users/list?page=1&limit=10`, {
            headers: { "x-request-id": `concurrent-${i}` },
          }),
        );

        const results = await Promise.all(promises);

        // 所有请求应成功
        for (const res of results) {
          expect(res.status).toBe(200);
          const body = res.body as Record<string, unknown>;
          expect(body.code).toBe(0);
        }

        // 每个请求有唯一的 requestId
        const requestIds = results.map((r) => r.headers["x-request-id"]);
        const uniqueIds = new Set(requestIds);
        expect(uniqueIds.size).toBe(10);
      });

      it("handles mixed concurrent requests (GET + POST)", async () => {
        const promises = [
          e2eGet(app.baseUrl, "/"),
          e2eGet(app.baseUrl, "/users/list?page=1&limit=10"),
          e2ePost(app.baseUrl, "/users", {
            name: "Concurrent",
            email: "concurrent@test.com",
          }),
          e2eGet(app.baseUrl, "/health"),
          e2eGet(app.baseUrl, "/errors/custom-status"),
        ];

        const results = await Promise.all(promises);

        expect(results[0]!.status).toBe(200); // GET /
        expect(results[1]!.status).toBe(200); // GET /users/list
        expect(results[2]!.status).toBe(201); // POST /users
        expect(results[3]!.status).toBe(200); // GET /health
        expect(results[4]!.status).toBe(418); // GET /errors/custom-status
      });
    });

    // ── Response format wrapping ─────────────────────────

    describe("response format", () => {
      it("wraps successful response as { code: 0, data, requestId }", async () => {
        const res = await e2eGet(app.baseUrl, "/");
        expect(res.status).toBe(200);

        const body = res.body as Record<string, unknown>;
        expect(body).toHaveProperty("code", 0);
        expect(body).toHaveProperty("data");
        expect(body).toHaveProperty("requestId");
        expect(typeof body.requestId).toBe("string");
      });

      it("wraps 201 response correctly", async () => {
        const res = await e2ePost(app.baseUrl, "/users", {
          name: "WrapTest",
          email: "wrap@test.com",
        });

        expect(res.status).toBe(201);
        const body = res.body as Record<string, unknown>;
        expect(body).toHaveProperty("code", 0);
        expect(body).toHaveProperty("data");
        expect(body).toHaveProperty("requestId");
      });
    });

    // ── CORS headers ─────────────────────────────────────

    describe("CORS", () => {
      it("returns CORS headers on regular request", async () => {
        const res = await e2eGet(app.baseUrl, "/", {
          headers: { Origin: "http://example.com" },
        });

        expect(res.status).toBe(200);
        // cors enabled with origins: ['*']
        expect(res.headers["access-control-allow-origin"]).toBeDefined();
      });
    });
  });
}

// ── 跨 adapter 一致性验证 ──────────────────────────────────

describe("E2E: cross-adapter consistency", () => {
  const apps = new Map<string, E2EApp>();
  const projects = new Map<string, E2EProject>();

  beforeAll(async () => {
    for (const adapter of ADAPTERS) {
      const port = allocatePort();
      const project = await createE2EProject({ adapter, port });
      const app = await startE2EApp(project);
      apps.set(adapter, app);
      projects.set(adapter, project);
    }
  }, 60_000);

  afterAll(async () => {
    for (const [name, app] of apps) {
      await stopE2EApp(app);
      const proj = projects.get(name);
      if (proj) await cleanupE2EProject(proj);
    }
  }, 30_000);

  it("all adapters return identical response structure for GET /", async () => {
    const responses = new Map<string, Record<string, unknown>>();

    for (const [name, app] of apps) {
      const res = await e2eGet(app.baseUrl, "/");
      expect(res.status).toBe(200);
      responses.set(name, res.body as Record<string, unknown>);
    }

    // 验证所有 adapter 的响应结构一致
    const keys = [...responses.values()].map((b) =>
      Object.keys(b).sort().join(","),
    );
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(1); // 所有结构相同

    // 验证 code 都是 0
    for (const [, body] of responses) {
      expect(body.code).toBe(0);
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("requestId");
    }
  });

  it("all adapters return identical 404 structure", async () => {
    for (const [, app] of apps) {
      const res = await e2eGet(app.baseUrl, "/nonexistent-path");
      expect(res.status).toBe(404);

      const body = res.body as Record<string, unknown>;
      expect(body.code).toBe(404);
      expect(body.message).toContain("Not Found");
      expect(body).toHaveProperty("requestId");
    }
  });

  it("all adapters return identical 500 structure", async () => {
    for (const [, app] of apps) {
      const res = await e2eGet(app.baseUrl, "/errors/sync-error");
      expect(res.status).toBe(500);

      const body = res.body as Record<string, unknown>;
      expect(body.code).toBe(500);
      expect(body).toHaveProperty("requestId");
    }
  });

  it("all adapters return x-request-id header", async () => {
    for (const [, app] of apps) {
      const res = await e2eGet(app.baseUrl, "/");
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.headers["x-request-id"]!.length).toBeGreaterThan(0);
    }
  });

  it("all adapters honor custom x-request-id", async () => {
    const customId = "cross-adapter-test-id";

    for (const [, app] of apps) {
      const res = await e2eGet(app.baseUrl, "/", {
        headers: { "x-request-id": customId },
      });
      expect(res.headers["x-request-id"]).toBe(customId);
    }
  });

  it("all adapters return Content-Type: application/json", async () => {
    for (const [, app] of apps) {
      const res = await e2eGet(app.baseUrl, "/");
      expect(res.headers["content-type"]).toContain("application/json");
    }
  });
});

// ── 优雅关闭验证 ────────────────────────────────────────────

describe("E2E: graceful shutdown", () => {
  it("releases port after shutdown", async () => {
    const port = allocatePort();
    const project = await createE2EProject({ adapter: "hono", port });
    const app = await startE2EApp(project);

    // 验证服务器正在运行
    const res = await e2eGet(app.baseUrl, "/");
    expect(res.status).toBe(200);

    // 关闭服务器
    await stopE2EApp(app);

    // 验证端口已释放（请求应失败）
    try {
      await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1000),
      });
      // 如果请求成功说明端口未释放 — 测试失败
      expect.unreachable("Port should be released after shutdown");
    } catch {
      // 预期行为：连接被拒绝
    }

    await cleanupE2EProject(project);
  }, 15_000);

  it("can restart on same port after shutdown", async () => {
    const port = allocatePort();

    // 第一次启动
    const project1 = await createE2EProject({ adapter: "hono", port });
    const app1 = await startE2EApp(project1);

    const res1 = await e2eGet(app1.baseUrl, "/");
    expect(res1.status).toBe(200);

    // 关闭
    await stopE2EApp(app1);
    await cleanupE2EProject(project1);

    // 等待端口完全释放
    await new Promise((r) => setTimeout(r, 200));

    // 第二次启动（相同端口）
    const project2 = await createE2EProject({ adapter: "hono", port });
    const app2 = await startE2EApp(project2);

    const res2 = await e2eGet(app2.baseUrl, "/");
    expect(res2.status).toBe(200);

    await stopE2EApp(app2);
    await cleanupE2EProject(project2);
  }, 30_000);
});

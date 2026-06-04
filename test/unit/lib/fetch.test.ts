/**
 * fetch.ts 单元测试
 *
 * 测试覆盖：
 *   - requestId 自动注入（从 requestContext 读取并注入出站请求头）
 *   - propagateHeaders 透传（BUG-006 修复验证：从 store.propagatedHeaders 注入到出站请求头）
 *   - propagateRequestId: false 禁用 requestId 注入
 *   - 超时控制（AbortController）
 *   - 自动重试（幂等方法 5xx + 网络错误）
 *   - 非幂等方法不重试
 *   - 快捷方法（get/post/put/patch/delete）
 *   - create() 子客户端（baseURL 拼接 + 默认 headers）
 *   - 结构化日志（出站请求 + 响应）
 *
 * @see src/lib/fetch.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVextFetch } from "../../../src/lib/fetch.js";
import { requestContext } from "../../../src/lib/request-context.js";
import type { VextLogger } from "../../../src/types/app.js";
import type { VextRequest } from "../../../src/types/request.js";
import type { VextResponse } from "../../../src/types/response.js";

// ── 测试工具 ────────────────────────────────────────────────

/**
 * 创建模拟的 VextLogger
 */
function createMockLogger(): VextLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(function () {
      return createMockLogger();
    }),
  } as unknown as VextLogger;
}

/**
 * 创建一个可控的 fetch mock，返回指定 status 和 body
 */
function createFetchMock(
  status: number = 200,
  body: unknown = { ok: true },
  headers: Record<string, string> = {},
) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

/**
 * 从 fetch mock 中提取最后一次调用时发送的 Headers 对象
 */
function getLastRequestHeaders(fetchMock: ReturnType<typeof vi.fn>): Headers {
  const calls = fetchMock.mock.calls;
  const lastCall = calls[calls.length - 1];
  // fetch(input, init) — init.headers
  const init = lastCall?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

function createProxyRequest(
  overrides: Partial<VextRequest> & { rawBody?: Buffer } = {},
): VextRequest {
  const rawBody = overrides.rawBody ?? Buffer.alloc(0);
  const closeHandlers: Array<() => void> = [];

  const req: VextRequest = {
    query: {},
    body: undefined,
    params: {},
    headers: {},
    method: "GET",
    url: "/proxy",
    path: "/proxy",
    route: "/proxy",
    app: {} as VextRequest["app"],
    requestId: "proxy-req-1",
    ip: "127.0.0.1",
    protocol: "http",
    onClose(handler: () => void): void {
      closeHandlers.push(handler);
    },
    valid: vi.fn(),
    _getRawBody: vi.fn().mockResolvedValue(rawBody.toString("utf-8")),
    _getRawBodyBuffer: vi.fn().mockResolvedValue(rawBody),
    ...overrides,
  };
  Object.defineProperty(req, "__triggerClose", {
    value: () => {
      for (const handler of closeHandlers) {
        handler();
      }
    },
  });

  return req;
}

interface MockResponseState {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  sentBy: string | null;
}

function createProxyResponse(): {
  res: VextResponse;
  state: MockResponseState;
} {
  const state: MockResponseState = {
    statusCode: 200,
    headers: {},
    body: undefined,
    sentBy: null,
  };

  const res: VextResponse = {
    get statusCode() {
      return state.statusCode;
    },
    json(data: unknown, status?: number): void {
      state.statusCode = status ?? state.statusCode;
      state.body = data;
      state.sentBy = "json";
    },
    rawJson(data: unknown, status?: number): void {
      state.statusCode = status ?? state.statusCode;
      state.body = data;
      state.sentBy = "rawJson";
    },
    text(content: string, status?: number): void {
      state.statusCode = status ?? state.statusCode;
      state.body = content;
      state.sentBy = "text";
    },
    stream(readable: NodeJS.ReadableStream, contentType?: string): void {
      state.body = readable;
      state.headers["content-type"] = contentType ?? "application/octet-stream";
      state.sentBy = "stream";
    },
    download(): void {
      state.sentBy = "download";
    },
    redirect(url: string, status: 301 | 302 | 307 | 308 = 302): void {
      state.statusCode = status;
      state.headers.location = url;
      state.sentBy = "redirect";
    },
    status(code: number): VextResponse {
      state.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string): VextResponse {
      state.headers[name.toLowerCase()] = value;
      return res;
    },
    _enableWrap(): void {
      // proxy tests assert raw passthrough, wrapping is intentionally unused.
    },
  };

  return { res, state };
}

// ── 全局 fetch mock ──────────────────────────────────────────

let globalFetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globalFetchMock = createFetchMock();
  vi.stubGlobal("fetch", globalFetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════
// requestId 自动注入
// ════════════════════════════════════════════════════════════

describe("requestId 自动注入", () => {
  it("从 requestContext 读取 requestId 并注入到出站请求头", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run({ requestId: "test-req-123" }, async () => {
      await vextFetch("https://example.com/api");

      const headers = getLastRequestHeaders(globalFetchMock);
      expect(headers.get("x-request-id")).toBe("test-req-123");
    });
  });

  it("requestContext 为空时不注入 requestId 头（不抛错）", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    // 在 requestContext 作用域外调用
    await vextFetch("https://example.com/api");

    const headers = getLastRequestHeaders(globalFetchMock);
    expect(headers.has("x-request-id")).toBe(false);
  });

  it("requestId 为空字符串时不注入头", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run({ requestId: "" }, async () => {
      await vextFetch("https://example.com/api");

      const headers = getLastRequestHeaders(globalFetchMock);
      expect(headers.has("x-request-id")).toBe(false);
    });
  });

  it("自定义 requestIdHeader 使用指定头名", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-trace-id");

    await requestContext.run({ requestId: "trace-abc" }, async () => {
      await vextFetch("https://example.com/api");

      const headers = getLastRequestHeaders(globalFetchMock);
      expect(headers.get("x-trace-id")).toBe("trace-abc");
      expect(headers.has("x-request-id")).toBe(false);
    });
  });

  it("init.headers 已有 requestId 头时不覆盖（用户显式设置优先）", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run({ requestId: "context-id" }, async () => {
      await vextFetch("https://example.com/api", {
        headers: { "x-request-id": "user-set-id" },
      });

      const headers = getLastRequestHeaders(globalFetchMock);
      expect(headers.get("x-request-id")).toBe("user-set-id");
    });
  });

  it("propagateRequestId: false 时不注入 requestId 头", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run({ requestId: "should-not-appear" }, async () => {
      await vextFetch("https://example.com/api", {
        propagateRequestId: false,
      });

      const headers = getLastRequestHeaders(globalFetchMock);
      expect(headers.has("x-request-id")).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════
// propagateHeaders 透传（BUG-006 修复验证）
// ════════════════════════════════════════════════════════════

describe("propagateHeaders 透传（BUG-006 修复）", () => {
  it("从 store.propagatedHeaders 注入到出站请求头", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run(
      {
        requestId: "req-1",
        propagatedHeaders: {
          "x-trace-id": "trace-xyz",
          "x-tenant-id": "tenant-001",
        },
      },
      async () => {
        await vextFetch("https://example.com/api");

        const headers = getLastRequestHeaders(globalFetchMock);
        expect(headers.get("x-trace-id")).toBe("trace-xyz");
        expect(headers.get("x-tenant-id")).toBe("tenant-001");
        // requestId 同时注入
        expect(headers.get("x-request-id")).toBe("req-1");
      },
    );
  });

  it("store.propagatedHeaders 为空时不影响出站请求", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run(
      { requestId: "req-2", propagatedHeaders: {} },
      async () => {
        await vextFetch("https://example.com/api");

        const headers = getLastRequestHeaders(globalFetchMock);
        expect(headers.has("x-trace-id")).toBe(false);
        expect(headers.get("x-request-id")).toBe("req-2");
      },
    );
  });

  it("init.headers 手动设置的头不被 propagatedHeaders 覆盖", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run(
      {
        requestId: "req-3",
        propagatedHeaders: { "x-trace-id": "from-store" },
      },
      async () => {
        await vextFetch("https://example.com/api", {
          headers: { "x-trace-id": "manually-set" },
        });

        const headers = getLastRequestHeaders(globalFetchMock);
        // 用户手动设置的头优先，store 中的值不覆盖
        expect(headers.get("x-trace-id")).toBe("manually-set");
      },
    );
  });

  it("propagateRequestId: false 时仍然透传 propagatedHeaders", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run(
      {
        requestId: "req-4",
        propagatedHeaders: { "x-trace-id": "trace-abc" },
      },
      async () => {
        await vextFetch("https://example.com/api", {
          propagateRequestId: false,
        });

        const headers = getLastRequestHeaders(globalFetchMock);
        // requestId 不注入
        expect(headers.has("x-request-id")).toBe(false);
        // 但 propagatedHeaders 仍然透传
        expect(headers.get("x-trace-id")).toBe("trace-abc");
      },
    );
  });

  it("requestContext 为空时不注入 propagatedHeaders（不抛错）", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    // requestContext 外调用，store 为 undefined
    await vextFetch("https://example.com/api");

    const headers = getLastRequestHeaders(globalFetchMock);
    expect(headers.has("x-trace-id")).toBe(false);
  });

  it("同时透传多个自定义头", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run(
      {
        requestId: "req-multi",
        propagatedHeaders: {
          "x-trace-id": "trace-111",
          "x-tenant-id": "tenant-222",
          "x-user-id": "user-333",
          "x-region": "cn-north-1",
        },
      },
      async () => {
        await vextFetch("https://downstream.example.com/api");

        const headers = getLastRequestHeaders(globalFetchMock);
        expect(headers.get("x-trace-id")).toBe("trace-111");
        expect(headers.get("x-tenant-id")).toBe("tenant-222");
        expect(headers.get("x-user-id")).toBe("user-333");
        expect(headers.get("x-region")).toBe("cn-north-1");
        expect(headers.get("x-request-id")).toBe("req-multi");
      },
    );
  });
});

// ════════════════════════════════════════════════════════════
// 超时控制
// ════════════════════════════════════════════════════════════

describe("超时控制", () => {
  it("fetch 超时后抛出 TimeoutError 或 AbortError", async () => {
    const logger = createMockLogger();
    // 全局 fetch 永不 resolve（模拟超时）
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_input: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener("abort", () => {
                reject(
                  new DOMException("The operation was aborted", "AbortError"),
                );
              });
            }
            // 永不 resolve
          }),
      ),
    );

    const vextFetch = createVextFetch(logger, { timeout: 50 }, "x-request-id");

    await expect(vextFetch("https://slow.example.com/api")).rejects.toThrow();
  });

  it("单次请求 init.timeout 覆盖全局配置", async () => {
    const logger = createMockLogger();
    let capturedSignal: AbortSignal | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_input: unknown, init?: RequestInit) => {
        capturedSignal = init?.signal ?? null;
        return Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        );
      }),
    );

    const vextFetch = createVextFetch(
      logger,
      { timeout: 10_000 },
      "x-request-id",
    );
    // 单次 timeout 50ms，不应使用全局的 10s
    await vextFetch("https://example.com/api", { timeout: 50 });

    // signal 存在（说明 AbortController 已创建）
    expect(capturedSignal).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
// 自动重试
// ════════════════════════════════════════════════════════════

describe("自动重试", () => {
  it("GET 请求 5xx 时自动重试指定次数", async () => {
    const logger = createMockLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      { retry: 2, retryDelay: 0 },
      "x-request-id",
    );
    const res = await vextFetch("https://example.com/api", { method: "GET" });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("POST 请求 5xx 时不重试（非幂等方法）", async () => {
    const logger = createMockLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 503 }));

    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      { retry: 3, retryDelay: 0 },
      "x-request-id",
    );
    const res = await vextFetch("https://example.com/api", { method: "POST" });

    // POST 不重试，只调用一次
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("重试次数耗尽后返回最后一次响应", async () => {
    const logger = createMockLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 503 }));

    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      { retry: 2, retryDelay: 0 },
      "x-request-id",
    );
    const res = await vextFetch("https://example.com/api", { method: "GET" });

    // 1 次首发 + 2 次重试 = 3 次
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(503);
  });

  it("init.retry 可覆盖全局重试配置", async () => {
    const logger = createMockLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 503 }));

    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      { retry: 5, retryDelay: 0 },
      "x-request-id",
    );
    // 单次请求覆盖为 1 次重试
    await vextFetch("https://example.com/api", {
      method: "GET",
      retry: 1,
      retryDelay: 0,
    });

    // 1 + 1 = 2 次
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("幂等方法集合：GET/HEAD/OPTIONS/PUT/DELETE 允许重试", async () => {
    const logger = createMockLogger();
    const idempotentMethods = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"];

    for (const method of idempotentMethods) {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 503 }))
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      vi.stubGlobal("fetch", fetchMock);

      const vextFetch = createVextFetch(
        logger,
        { retry: 1, retryDelay: 0 },
        "x-request-id",
      );
      const res = await vextFetch("https://example.com/api", { method });

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("retryDelay 支持函数形式（指数退避）", async () => {
    const logger = createMockLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const delayFn = vi.fn().mockReturnValue(0); // 返回 0 避免等待

    const vextFetch = createVextFetch(
      logger,
      {
        retry: 1,
        retryDelay: delayFn as (attempt: number) => number,
      },
      "x-request-id",
    );
    await vextFetch("https://example.com/api", { method: "GET" });

    // delayFn 在重试时被调用（attempt=1）
    expect(delayFn).toHaveBeenCalledWith(1);
  });
});

// ════════════════════════════════════════════════════════════
// 快捷方法
// ════════════════════════════════════════════════════════════

describe("快捷方法", () => {
  it("vextFetch.get() 发送 GET 请求", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await vextFetch.get("https://example.com/users");

    expect(globalFetchMock).toHaveBeenCalledOnce();
    const call = globalFetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect((init.method as string).toUpperCase()).toBe("GET");
  });

  it("vextFetch.post() 发送 POST 请求并序列化 body 为 JSON", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await vextFetch.post("https://example.com/users", { name: "Alice" });

    expect(globalFetchMock).toHaveBeenCalledOnce();
    const call = globalFetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect((init.method as string).toUpperCase()).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "Alice" }));
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("vextFetch.put() 发送 PUT 请求", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await vextFetch.put("https://example.com/users/1", { name: "Bob" });

    const call = globalFetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect((init.method as string).toUpperCase()).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ name: "Bob" }));
  });

  it("vextFetch.patch() 发送 PATCH 请求", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await vextFetch.patch("https://example.com/users/1", { name: "Carol" });

    const call = globalFetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect((init.method as string).toUpperCase()).toBe("PATCH");
  });

  it("vextFetch.delete() 发送 DELETE 请求", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await vextFetch.delete("https://example.com/users/1");

    const call = globalFetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect((init.method as string).toUpperCase()).toBe("DELETE");
  });
});

// ════════════════════════════════════════════════════════════
// create() 子客户端
// ════════════════════════════════════════════════════════════

describe("create() 子客户端", () => {
  it("create() 自动拼接 baseURL", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const client = vextFetch.create({ baseURL: "https://api.example.com/v1" });

    await client("/users");

    const call = globalFetchMock.mock.calls[0];
    expect(call[0]).toBe("https://api.example.com/v1/users");
  });

  it("create() baseURL 末尾斜杠不重复", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const client = vextFetch.create({
      baseURL: "https://api.example.com/v1/",
    });

    await client("/users");

    const call = globalFetchMock.mock.calls[0];
    expect(call[0]).toBe("https://api.example.com/v1/users");
  });

  it("create() 合并默认 headers", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const client = vextFetch.create({
      baseURL: "https://api.example.com",
      headers: { Authorization: "Bearer token-xyz" },
    });

    await client("/protected");

    const headers = getLastRequestHeaders(globalFetchMock);
    expect(headers.get("authorization")).toBe("Bearer token-xyz");
  });

  it("create() 继承父客户端的 requestId 注入能力", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const client = vextFetch.create({ baseURL: "https://api.example.com" });

    await requestContext.run({ requestId: "child-req-1" }, async () => {
      await client("/users");

      const headers = getLastRequestHeaders(globalFetchMock);
      expect(headers.get("x-request-id")).toBe("child-req-1");
    });
  });

  it("create() 继承父客户端的 propagatedHeaders 透传能力", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const client = vextFetch.create({ baseURL: "https://api.example.com" });

    await requestContext.run(
      {
        requestId: "child-req-2",
        propagatedHeaders: { "x-trace-id": "trace-child" },
      },
      async () => {
        await client("/downstream");

        const headers = getLastRequestHeaders(globalFetchMock);
        expect(headers.get("x-trace-id")).toBe("trace-child");
      },
    );
  });

  it("create() 返回的子客户端同样有 get/post 快捷方法", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const client = vextFetch.create({ baseURL: "https://api.example.com" });

    expect(typeof client.get).toBe("function");
    expect(typeof client.post).toBe("function");
    expect(typeof client.put).toBe("function");
    expect(typeof client.patch).toBe("function");
    expect(typeof client.delete).toBe("function");
    expect(typeof client.create).toBe("function");
  });

  it("create() 返回的子客户端不暴露 proxy", () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const client = vextFetch.create({ baseURL: "https://api.example.com" });

    expect((client as unknown as { proxy?: unknown }).proxy).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════
// app.fetch.proxy 代理
// ════════════════════════════════════════════════════════════

describe("app.fetch.proxy 代理", () => {
  it("按 config.fetch.proxy 目标代理并直接透传上游 JSON 响应", async () => {
    const logger = createMockLogger();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1, name: "Alice" }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "x-upstream": "users",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      {
        proxy: [
          {
            name: "userService",
            baseURL: "https://users.example.com/api",
            headers: { "x-target": "base" },
            forwardHeaders: ["x-tenant-id"],
            defaultInjectHeaders: { "x-default": "target" },
          },
        ],
      },
      "x-request-id",
    );
    const req = createProxyRequest({
      method: "GET",
      query: { page: "1" },
      headers: {
        "x-tenant-id": "tenant-a",
        authorization: "Bearer raw-token",
      },
    });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy.userService(req, res, {
      path: "/users",
      query: { page: 2, keyword: "alice" },
      headers: { "x-target": "call" },
      injectHeaders: { "x-inject": "top" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://users.example.com/api/users?page=2&keyword=alice",
    );

    const headers = getLastRequestHeaders(fetchMock);
    expect(headers.get("x-tenant-id")).toBe("tenant-a");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-target")).toBe("call");
    expect(headers.get("x-default")).toBe("target");
    expect(headers.get("x-inject")).toBe("top");

    expect(state.statusCode).toBe(201);
    expect(state.headers["content-type"]).toContain("application/json");
    expect(state.headers["x-upstream"]).toBe("users");
    expect(state.body).toBe('{"id":1,"name":"Alice"}');
    expect(state.sentBy).toBe("text");
  });

  it("支持直接 URL fallback 代理", async () => {
    const logger = createMockLogger();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const req = createProxyRequest({ query: { trace: "1" } });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy(req, res, {
      url: "https://api.example.com/health",
      query: { trace: null, verbose: true },
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/health?verbose=true",
    );
    expect(state.statusCode).toBe(200);
    expect(state.body).toBe("ok");
  });

  it("直接 URL fallback 传入非法 URL 时返回本地 400", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");
    const req = createProxyRequest();
    const { res, state } = createProxyResponse();

    await vextFetch.proxy(req, res, { url: "/relative-only" });

    expect(globalFetchMock).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
    expect(state.sentBy).toBe("rawJson");
    expect(state.body).toMatchObject({
      code: "FETCH_PROXY_INVALID_URL",
      requestId: "proxy-req-1",
    });
  });

  it("未显式允许时禁止透传原始 Authorization header", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(
      logger,
      {
        proxy: [
          {
            name: "secureService",
            baseURL: "https://secure.example.com",
            forwardHeaders: ["authorization"],
          },
        ],
      },
      "x-request-id",
    );
    const req = createProxyRequest({
      headers: { authorization: "Bearer raw-token" },
    });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy.secureService(req, res, { path: "/profile" });

    expect(globalFetchMock).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
    expect(state.sentBy).toBe("rawJson");
    expect(state.body).toMatchObject({
      code: "FETCH_PROXY_AUTHORIZATION_FORWARD_FORBIDDEN",
      requestId: "proxy-req-1",
    });
  });

  it("GET 上游 5xx 会按 retry 合同重试，最终响应直接透传", async () => {
    const logger = createMockLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response("ready", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      {
        retry: 2,
        retryDelay: 0,
        proxy: [
          {
            name: "userService",
            baseURL: "https://users.example.com",
          },
        ],
      },
      "x-request-id",
    );
    const req = createProxyRequest({ method: "GET" });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy.userService(req, res, { path: "/health" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.statusCode).toBe(200);
    expect(state.body).toBe("ready");
  });

  it("客户端在 retry delay 期间断开时不再发起后续重试", async () => {
    const logger = createMockLogger();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("busy", {
        status: 503,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      {
        retry: 2,
        retryDelay: () => {
          (req as unknown as { __triggerClose: () => void }).__triggerClose();
          return 0;
        },
        proxy: [
          {
            name: "userService",
            baseURL: "https://users.example.com",
          },
        ],
      },
      "x-request-id",
    );
    const req = createProxyRequest({ method: "GET" });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy.userService(req, res, { path: "/health" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.sentBy).toBeNull();
    expect(state.body).toBeUndefined();
  });

  it("POST 上游 5xx 默认不重试", async () => {
    const logger = createMockLogger();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("failed", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      {
        retry: 3,
        retryDelay: 0,
        proxy: [
          {
            name: "writeService",
            baseURL: "https://write.example.com",
          },
        ],
      },
      "x-request-id",
    );
    const req = createProxyRequest({
      method: "POST",
      rawBody: Buffer.from('{"name":"Alice"}'),
    });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy.writeService(req, res, { path: "/users" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.statusCode).toBe(503);
    expect(state.body).toBe("failed");
  });

  it("上游超时返回本地 504 且不重试", async () => {
    const logger = createMockLogger();
    const fetchMock = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      {
        retry: 2,
        retryDelay: 0,
        proxy: [
          {
            name: "slowService",
            baseURL: "https://slow.example.com",
            timeout: 5,
          },
        ],
      },
      "x-request-id",
    );
    const req = createProxyRequest({ method: "GET" });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy.slowService(req, res, { path: "/timeout" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.statusCode).toBe(504);
    expect(state.body).toMatchObject({
      code: "FETCH_PROXY_TIMEOUT",
      requestId: "proxy-req-1",
    });
  });

  it("204 响应不发送 body 且过滤 hop-by-hop headers", async () => {
    const logger = createMockLogger();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: {
          "x-upstream": "no-content",
          connection: "close",
          "content-length": "12",
          "transfer-encoding": "chunked",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      {
        proxy: [
          {
            name: "emptyService",
            baseURL: "https://empty.example.com",
          },
        ],
      },
      "x-request-id",
    );
    const req = createProxyRequest({ method: "DELETE" });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy.emptyService(req, res, { path: "/items/1" });

    expect(state.statusCode).toBe(204);
    expect(state.body).toBe("");
    expect(state.sentBy).toBe("text");
    expect(state.headers["x-upstream"]).toBe("no-content");
    expect(state.headers.connection).toBeUndefined();
    expect(state.headers["content-length"]).toBeUndefined();
    expect(state.headers["transfer-encoding"]).toBeUndefined();
  });

  it("stream 响应透传下载头，客户端断开后继续 abort 上游 body", async () => {
    const logger = createMockLogger();
    let upstreamSignal: AbortSignal | undefined;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      upstreamSignal = init?.signal;
      return Promise.resolve(
        new Response(upstreamBody, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": 'attachment; filename="demo.bin"',
            "content-length": "5",
            "transfer-encoding": "chunked",
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      {
        proxy: [
          {
            name: "fileService",
            baseURL: "https://files.example.com",
          },
        ],
      },
      "x-request-id",
    );
    const req = createProxyRequest({ method: "GET" });
    const { res, state } = createProxyResponse();

    await vextFetch.proxy.fileService(req, res, { path: "/demo.bin" });

    expect(state.statusCode).toBe(200);
    expect(state.sentBy).toBe("stream");
    expect(state.headers["content-type"]).toBe("application/octet-stream");
    expect(state.headers["content-disposition"]).toBe(
      'attachment; filename="demo.bin"',
    );
    expect(state.headers["content-length"]).toBeUndefined();
    expect(state.headers["transfer-encoding"]).toBeUndefined();
    expect(upstreamSignal?.aborted).toBe(false);

    (req as unknown as { __triggerClose: () => void }).__triggerClose();

    expect(upstreamSignal?.aborted).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// 结构化日志
// ════════════════════════════════════════════════════════════

describe("结构化日志", () => {
  it("成功请求时调用 logger.debug 记录出站日志", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await requestContext.run({ requestId: "log-req-1" }, async () => {
      await vextFetch("https://example.com/api");
    });

    // debug 应被调用（出站请求日志，成功请求使用 debug 级别）
    expect(logger.debug).toHaveBeenCalled();
    const debugCall = (logger.debug as ReturnType<typeof vi.fn>).mock.calls;
    // 至少有一个调用包含 type: "outbound"
    const outboundLog = debugCall.find(
      (args: unknown[]) =>
        typeof args[0] === "object" &&
        args[0] !== null &&
        (args[0] as Record<string, unknown>).type === "outbound",
    );
    expect(outboundLog).toBeDefined();
  });

  it("失败请求（5xx）时调用 logger.error", async () => {
    const logger = createMockLogger();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );

    const vextFetch = createVextFetch(logger, { retry: 0 }, "x-request-id");
    await vextFetch("https://example.com/api");

    expect(logger.error).toHaveBeenCalled();
  });

  it("网络错误时调用 logger.error", async () => {
    const logger = createMockLogger();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network Error")),
    );

    const vextFetch = createVextFetch(logger, { retry: 0 }, "x-request-id");

    await expect(vextFetch("https://example.com/api")).rejects.toThrow(
      "Network Error",
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════
// 边界场景
// ════════════════════════════════════════════════════════════

describe("边界场景", () => {
  it("URL 对象作为 input 正常处理", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await vextFetch(new URL("https://example.com/api"));

    expect(globalFetchMock).toHaveBeenCalledOnce();
  });

  it("Request 对象作为 input 正常处理", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await vextFetch(new Request("https://example.com/api"));

    expect(globalFetchMock).toHaveBeenCalledOnce();
  });

  it("post 请求 body 为 undefined 时不设置 content-type", async () => {
    const logger = createMockLogger();
    const vextFetch = createVextFetch(logger, {}, "x-request-id");

    await vextFetch.post("https://example.com/api", undefined);

    const call = globalFetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = new Headers(init.headers);
    // body 为 undefined 时不强制设置 content-type
    expect(headers.has("content-type")).toBe(false);
  });

  it("4xx 响应不触发重试", async () => {
    const logger = createMockLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 400 }));

    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      { retry: 3, retryDelay: 0 },
      "x-request-id",
    );
    const res = await vextFetch("https://example.com/api", { method: "GET" });

    // 4xx 不重试，只调用一次
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("2xx 响应不触发重试", async () => {
    const logger = createMockLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 201 }));

    vi.stubGlobal("fetch", fetchMock);

    const vextFetch = createVextFetch(
      logger,
      { retry: 3, retryDelay: 0 },
      "x-request-id",
    );
    await vextFetch("https://example.com/api", { method: "GET" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

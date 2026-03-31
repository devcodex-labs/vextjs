/**
 * error-handler.ts 内容协商 + devOverlay 单元测试
 *
 * 测试覆盖：
 *   - 内容协商：Accept: text/html + devOverlay 注入 → 调用 devOverlay，返回 HTML
 *   - 内容协商：Accept: *\/\* / application/json / 无 Accept → 返回 JSON
 *   - devOverlay 未注入（生产模式）→ 始终返回 JSON
 *   - devOverlay 抛错 → fallback 到 JSON（E8）
 *   - 状态码映射：VextValidationError → 422 / HttpError → err.status / 未知 → 500
 *   - soft reload 兼容性：createErrorHandler 工厂函数包含 overlay 注入
 *
 * @see src/lib/middlewares/error-handler.ts
 */

import { describe, it, expect, vi } from "vitest";
import { createErrorHandler } from "../../../src/lib/middlewares/error-handler.js";
import { HttpError, VextValidationError } from "../../../src/types/errors.js";
import type { DevOverlayFn } from "../../../src/lib/middlewares/error-handler.js";

// ── Mock req / res ───────────────────────────────────────────

function createMockReq(acceptHeader?: string) {
  return {
    requestId: "test-req-id",
    headers: acceptHeader !== undefined ? { accept: acceptHeader } : {},
  };
}

function createMockRes() {
  const calls: { method: string; args: unknown[] }[] = [];
  let contentTypeHeader: string | undefined;

  return {
    calls,
    rawJson: vi.fn((body: unknown, status?: number) => {
      calls.push({ method: "rawJson", args: [body, status] });
    }),
    text: vi.fn((body: string, status?: number) => {
      calls.push({ method: "text", args: [body, status] });
    }),
    setHeader: vi.fn((name: string, value: string) => {
      if (name === "Content-Type") contentTypeHeader = value;
      calls.push({ method: "setHeader", args: [name, value] });
    }),
    getContentType: () => contentTypeHeader,
  };
}

// ── 内容协商（devOverlay 已注入）─────────────────────────────

describe("内容协商 — devOverlay 已注入", () => {
  const mockOverlay: DevOverlayFn = vi.fn(() => "<html>error</html>");

  it("Accept: text/html → 调用 devOverlay，设置 text/html Content-Type", () => {
    const handler = createErrorHandler({}, mockOverlay);
    const req = createMockReq("text/html,application/xhtml+xml");
    const res = createMockRes();

    handler(new Error("boom"), req as any, res as any);

    expect(mockOverlay).toHaveBeenCalledWith(expect.any(Error));
    const setHeaderCall = res.calls.find((c) => c.method === "setHeader");
    expect(setHeaderCall?.args[0]).toBe("Content-Type");
    expect(setHeaderCall?.args[1]).toContain("text/html");
    const textCall = res.calls.find((c) => c.method === "text");
    expect(textCall?.args[0]).toBe("<html>error</html>");
  });

  it("Accept: text/html + VextValidationError → 422 + HTML", () => {
    const handler = createErrorHandler({}, mockOverlay);
    const req = createMockReq("text/html");
    const res = createMockRes();

    handler(new VextValidationError([]), req as any, res as any);

    const textCall = res.calls.find((c) => c.method === "text");
    expect(textCall?.args[1]).toBe(422);
  });

  it("Accept: text/html + HttpError(404) → 404 + HTML", () => {
    const handler = createErrorHandler({}, mockOverlay);
    const req = createMockReq("text/html");
    const res = createMockRes();

    handler(new HttpError(404, "Not Found"), req as any, res as any);

    const textCall = res.calls.find((c) => c.method === "text");
    expect(textCall?.args[1]).toBe(404);
  });

  it("Accept: text/html + 未知错误 → 500 + HTML", () => {
    const handler = createErrorHandler({}, mockOverlay);
    const req = createMockReq("text/html");
    const res = createMockRes();

    handler(new Error("unknown"), req as any, res as any);

    const textCall = res.calls.find((c) => c.method === "text");
    expect(textCall?.args[1]).toBe(500);
  });

  it("Accept: */* → 不调用 devOverlay，返回 JSON", () => {
    const overlay = vi.fn(() => "<html>error</html>");
    const handler = createErrorHandler({}, overlay);
    const req = createMockReq("*/*");
    const res = createMockRes();

    handler(new Error("boom"), req as any, res as any);

    expect(overlay).not.toHaveBeenCalled();
    const jsonCall = res.calls.find((c) => c.method === "rawJson");
    expect(jsonCall).toBeDefined();
  });

  it("Accept: application/json → 返回 JSON", () => {
    const overlay = vi.fn(() => "<html>error</html>");
    const handler = createErrorHandler({}, overlay);
    const req = createMockReq("application/json");
    const res = createMockRes();

    handler(new HttpError(400, "Bad Request"), req as any, res as any);

    expect(overlay).not.toHaveBeenCalled();
    const jsonCall = res.calls.find((c) => c.method === "rawJson");
    expect(jsonCall).toBeDefined();
  });

  it("无 Accept 头 → 返回 JSON", () => {
    const overlay = vi.fn(() => "<html>error</html>");
    const handler = createErrorHandler({}, overlay);
    const req = createMockReq(undefined);
    const res = createMockRes();

    handler(new Error("boom"), req as any, res as any);

    expect(overlay).not.toHaveBeenCalled();
    const jsonCall = res.calls.find((c) => c.method === "rawJson");
    expect(jsonCall).toBeDefined();
  });
});

// ── devOverlay 未注入（生产模式）────────────────────────────

describe("devOverlay 未注入（生产模式）", () => {
  it("Accept: text/html → 仍然返回 JSON（无 overlay 时行为不变）", () => {
    const handler = createErrorHandler({});
    const req = createMockReq("text/html");
    const res = createMockRes();

    handler(new Error("boom"), req as any, res as any);

    const jsonCall = res.calls.find((c) => c.method === "rawJson");
    expect(jsonCall).toBeDefined();
    const textCall = res.calls.find((c) => c.method === "text");
    expect(textCall).toBeUndefined();
  });

  it("VextValidationError → 422 JSON（与原有行为一致）", () => {
    const handler = createErrorHandler({});
    const req = createMockReq(undefined);
    const res = createMockRes();

    const err = new VextValidationError([
      { field: "email", message: "Invalid email" },
    ]);
    handler(err, req as any, res as any);

    const jsonCall = res.calls.find((c) => c.method === "rawJson");
    expect(jsonCall?.args[1]).toBe(422);
    const body = jsonCall?.args[0] as Record<string, unknown>;
    expect(body.code).toBe(422);
    expect(body.errors).toHaveLength(1);
  });
});

// ── fallback：devOverlay 抛错 ────────────────────────────────

describe("fallback — devOverlay 抛错时降级到 JSON（E8）", () => {
  it("overlay 抛错 → fallback 到 JSON 500", () => {
    const throwingOverlay: DevOverlayFn = () => {
      throw new Error("render failed");
    };
    const handler = createErrorHandler({}, throwingOverlay);
    const req = createMockReq("text/html");
    const res = createMockRes();

    handler(new Error("original error"), req as any, res as any);

    const jsonCall = res.calls.find((c) => c.method === "rawJson");
    expect(jsonCall).toBeDefined();
    const body = jsonCall?.args[0] as Record<string, unknown>;
    expect(body.code).toBe(500);
  });

  it("overlay 抛错 + HttpError(404) → fallback 到 JSON 404", () => {
    const throwingOverlay: DevOverlayFn = () => {
      throw new Error("render failed");
    };
    const handler = createErrorHandler({}, throwingOverlay);
    const req = createMockReq("text/html");
    const res = createMockRes();

    handler(new HttpError(404, "Not Found"), req as any, res as any);

    const jsonCall = res.calls.find((c) => c.method === "rawJson");
    expect(jsonCall?.args[1]).toBe(404);
  });
});

// ── soft reload 兼容性 ────────────────────────────────────────

describe("soft reload 兼容性 — createErrorHandler 工厂函数含 overlay 注入", () => {
  it("工厂函数返回的 handler 包含 overlay（模拟 SoftReloader 调用模式）", () => {
    const overlay = vi.fn(() => "<html>overlay</html>");

    // 模拟 SoftReloader 中的工厂包装方式：
    // ((cfg) => createErrorHandler(cfg.response ?? {}, overlayFn)) as any
    const factory = (cfg: Record<string, unknown>) =>
      createErrorHandler((cfg as any).response ?? {}, overlay);

    // SoftReloader 用新 config 重建错误处理器
    const handler = factory({ response: {} });
    const req = createMockReq("text/html");
    const res = createMockRes();

    handler(new Error("soft reload error"), req as any, res as any);

    expect(overlay).toHaveBeenCalled();
    const textCall = res.calls.find((c) => c.method === "text");
    expect(textCall).toBeDefined();
  });

  it("工厂函数在 overlay 为 undefined 时不调用 devOverlay", () => {
    // 模拟 overlayEnabled = false 时的工厂
    const factory = (cfg: Record<string, unknown>) =>
      createErrorHandler((cfg as any).response ?? {}, undefined);

    const handler = factory({ response: {} });
    const req = createMockReq("text/html");
    const res = createMockRes();

    handler(new Error("boom"), req as any, res as any);

    const jsonCall = res.calls.find((c) => c.method === "rawJson");
    expect(jsonCall).toBeDefined();
  });
});

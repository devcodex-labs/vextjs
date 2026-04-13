/**
 * error-handler.ts — logger 日志行为单元测试
 *
 * 职责说明：
 *   本文件覆盖 logger 注入和 logErrors 配置等「日志行为」维度。
 *   响应格式（devOverlay 内容协商、状态码映射）由 error-handler-overlay.test.ts 覆盖，
 *   两文件职责不重叠。
 *
 * 测试覆盖：
 *   - 向后兼容：不传 logger 时不报错
 *   - 未知错误（500）→ logger.error 含 err 对象（R1）
 *   - logErrors.unknownErrors: false → 不记录
 *   - VextValidationError → logger 不被调用
 *   - HttpError 5xx → logger.error（R2）
 *   - logErrors.http5xx: false → 不记录
 *   - HttpError 4xx，默认配置 → logger.warn 不被调用（R3 默认 off）
 *   - HttpError 4xx，logErrors.http4xx: true → logger.warn 被调用（R3）
 *   - devOverlay 触发 + 未知 500 → logger.error 仍被调用（日志先于响应格式）
 *   - devOverlay 触发 + HttpError 404 默认 → logger.warn 不被调用
 *
 * @see src/lib/middlewares/error-handler.ts
 * @see test/unit/lib/error-handler-overlay.test.ts（响应格式测试）
 */

import { describe, it, expect, vi } from "vitest";
import { createErrorHandler } from "../../../src/lib/middlewares/error-handler.js";
import { HttpError, VextValidationError } from "../../../src/types/errors.js";

// ── Mock 工厂 ────────────────────────────────────────────────

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
}

function createMockReq(acceptHeader?: string) {
  return {
    requestId: "test-req-id",
    headers: acceptHeader !== undefined ? { accept: acceptHeader } : {},
  };
}

function createMockRes() {
  return {
    rawJson: vi.fn(),
    text: vi.fn(),
    setHeader: vi.fn(),
  };
}

// ── 测试套件 ─────────────────────────────────────────────────

describe("createErrorHandler — logger 日志行为", () => {
  // ── 向后兼容 ──────────────────────────────────────────────

  describe("向后兼容 — 不传 logger", () => {
    it("无 logger 时处理未知错误不报错，正常返回 JSON 500", () => {
      const handler = createErrorHandler({ hideInternalErrors: true });
      const req = createMockReq();
      const res = createMockRes();

      expect(() => handler(new Error("boom"), req as any, res as any)).not.toThrow();
      expect(res.rawJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: 500 }),
        500,
      );
    });
  });

  // ── 未知错误（500）日志 ───────────────────────────────────

  describe("未知错误（500）日志", () => {
    it("未知错误 → logger.error 被调用，第一参数含 err 对象（R1）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler({ hideInternalErrors: true }, undefined, logger);
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error("runtime crash");

      handler(err, req as any, res as any);

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [firstArg, secondArg] = logger.error.mock.calls[0]!;
      expect(firstArg).toEqual(expect.objectContaining({ err }));
      expect(secondArg).toContain("[uncaught]");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("logErrors.unknownErrors: false → logger.error 不被调用", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler(
        { hideInternalErrors: true, logErrors: { unknownErrors: false } },
        undefined,
        logger,
      );
      const req = createMockReq();
      const res = createMockRes();

      handler(new Error("silent error"), req as any, res as any);

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("VextValidationError → logger 不被调用（范围外，不记录校验错误）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler({ hideInternalErrors: true }, undefined, logger);
      const req = createMockReq();
      const res = createMockRes();
      const err = new VextValidationError([
        { field: "email", message: "格式错误" },
      ]);

      handler(err, req as any, res as any);

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // ── HttpError 5xx 日志 ────────────────────────────────────

  describe("HttpError 5xx 日志", () => {
    it("HttpError 500 → logger.error 被调用，消息含 status 和 message（R2）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler({ hideInternalErrors: true }, undefined, logger);
      const req = createMockReq();
      const res = createMockRes();

      handler(new HttpError(500, "Service Unavailable"), req as any, res as any);

      expect(logger.error).toHaveBeenCalledTimes(1);
      const msg = logger.error.mock.calls[0]![0] as string;
      expect(msg).toContain("500");
      expect(msg).toContain("Service Unavailable");
      expect(msg).toContain("[http-error]");
    });

    it("logErrors.http5xx: false → HttpError 5xx 不记录", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler(
        { hideInternalErrors: true, logErrors: { http5xx: false } },
        undefined,
        logger,
      );
      const req = createMockReq();
      const res = createMockRes();

      handler(new HttpError(503, "Service Down"), req as any, res as any);

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // ── HttpError 4xx 日志 ────────────────────────────────────

  describe("HttpError 4xx 日志", () => {
    it("HttpError 404，默认配置 → logger.warn 不被调用（R3 默认 off）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler({ hideInternalErrors: true }, undefined, logger);
      const req = createMockReq();
      const res = createMockRes();

      handler(new HttpError(404, "Not Found"), req as any, res as any);

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("HttpError 404，logErrors.http4xx: true → logger.warn 被调用（R3）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler(
        { hideInternalErrors: true, logErrors: { http4xx: true } },
        undefined,
        logger,
      );
      const req = createMockReq();
      const res = createMockRes();

      handler(new HttpError(404, "Not Found"), req as any, res as any);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const msg = logger.warn.mock.calls[0]![0] as string;
      expect(msg).toContain("404");
      expect(msg).toContain("Not Found");
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("HttpError 422，logErrors.http4xx: true → logger.warn 被调用", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler(
        { hideInternalErrors: true, logErrors: { http4xx: true } },
        undefined,
        logger,
      );
      const req = createMockReq();
      const res = createMockRes();

      handler(new HttpError(422, "Unprocessable"), req as any, res as any);

      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  // ── devOverlay 路径 — 日志不受响应格式影响 ───────────────

  describe("devOverlay 路径 — 日志不受响应格式影响", () => {
    it("devOverlay 触发 + 未知 500 → logger.error 仍被调用（日志先于响应格式）", () => {
      const logger = createMockLogger();
      const overlay = vi.fn(() => "<html>error</html>");
      const handler = createErrorHandler({ hideInternalErrors: true }, overlay, logger);
      // Accept 含 text/html → 触发 devOverlay
      const req = createMockReq("text/html,application/xhtml+xml");
      const res = createMockRes();

      handler(new Error("boom in browser"), req as any, res as any);

      // 日志必须被记录（前置于 devOverlay）
      expect(logger.error).toHaveBeenCalledTimes(1);
      // overlay 也被调用（响应返回 HTML）
      expect(overlay).toHaveBeenCalledTimes(1);
    });

    it("devOverlay 触发 + HttpError 404 默认配置 → logger.warn 不被调用", () => {
      const logger = createMockLogger();
      const overlay = vi.fn(() => "<html>404</html>");
      const handler = createErrorHandler({ hideInternalErrors: true }, overlay, logger);
      const req = createMockReq("text/html,application/xhtml+xml");
      const res = createMockRes();

      handler(new HttpError(404, "Not Found"), req as any, res as any);

      // 4xx 默认不记录，即使 devOverlay 触发
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // ── 边界条件 — 非 Error 对象 ─────────────────────────────

  describe("边界条件 — 非 Error 对象", () => {
    it("throw 'string error' → logger.error 被调用，message 正确（T-M1）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler({ hideInternalErrors: true }, undefined, logger);
      const req = createMockReq();
      const res = createMockRes();

      handler("string error" as unknown, req as any, res as any);

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [firstArg, secondArg] = logger.error.mock.calls[0]!;
      expect(firstArg.err).toBeInstanceOf(Error);
      expect(firstArg.err.message).toBe("string error");
      expect(secondArg).toContain("[uncaught]");
      // 响应仍正常
      expect(res.rawJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: 500 }),
        500,
      );
    });

    it("throw null → logger.error 被调用，不崩溃（T-M2a）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler({ hideInternalErrors: true }, undefined, logger);
      const req = createMockReq();
      const res = createMockRes();

      expect(() => handler(null as unknown, req as any, res as any)).not.toThrow();
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(res.rawJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: 500 }),
        500,
      );
    });

    it("throw undefined → logger.error 被调用，不崩溃（T-M2b）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler({ hideInternalErrors: true }, undefined, logger);
      const req = createMockReq();
      const res = createMockRes();

      expect(() => handler(undefined as unknown, req as any, res as any)).not.toThrow();
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(res.rawJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: 500 }),
        500,
      );
    });
  });

  // ── 组合配置 ──────────────────────────────────────────────

  describe("组合配置", () => {
    it("http4xx: true + http5xx: false → 4xx 记录 warn，5xx 不记录（T-M3）", () => {
      const logger = createMockLogger();
      const handler = createErrorHandler(
        { hideInternalErrors: true, logErrors: { http4xx: true, http5xx: false } },
        undefined,
        logger,
      );
      const req = createMockReq();
      const res = createMockRes();

      // 4xx → warn
      handler(new HttpError(400, "Bad Request"), req as any, res as any);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();

      // reset
      logger.warn.mockClear();
      logger.error.mockClear();

      // 5xx → 不记录
      const res2 = createMockRes();
      handler(new HttpError(503, "Service Down"), req as any, res2 as any);
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // ── logger 自身异常防护 ───────────────────────────────────

  describe("logger 自身异常防护", () => {
    it("logger.error 抛出异常 → 不影响响应，请求正常返回 500（T-M4）", () => {
      const logger = createMockLogger();
      logger.error.mockImplementation(() => {
        throw new Error("logger broken");
      });
      const handler = createErrorHandler({ hideInternalErrors: true }, undefined, logger);
      const req = createMockReq();
      const res = createMockRes();

      // 不应抛出
      expect(() => handler(new Error("boom"), req as any, res as any)).not.toThrow();
      // 响应仍正常返回
      expect(res.rawJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: 500 }),
        500,
      );
    });

    it("logger.warn 抛出异常 → 不影响响应（T-M4b）", () => {
      const logger = createMockLogger();
      logger.warn.mockImplementation(() => {
        throw new Error("logger warn broken");
      });
      const handler = createErrorHandler(
        { hideInternalErrors: true, logErrors: { http4xx: true } },
        undefined,
        logger,
      );
      const req = createMockReq();
      const res = createMockRes();

      expect(() => handler(new HttpError(404, "Not Found"), req as any, res as any)).not.toThrow();
      expect(res.rawJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: 404 }),
        404,
      );
    });
  });
});


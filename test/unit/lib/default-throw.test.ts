/**
 * default-throw.ts 单元测试
 *
 * 测试覆盖：
 *   - 标准调用：app.throw(status, message)
 *   - 标准调用 + 业务码：app.throw(status, message, code)
 *   - 标准调用 + i18n 参数：app.throw(status, message, params)
 *   - 标准调用 + i18n 参数 + 业务码：app.throw(status, message, params, code)
 *   - 🆕 快捷方式：app.throw('balance.insufficient')
 *   - 🆕 快捷方式 + 参数：app.throw('balance.insufficient', { balance: 50 })
 *   - 🆕 快捷方式默认 status 400
 *   - 🆕 快捷方式从 i18n 配置读取 statusCode
 *
 * @see src/lib/default-throw.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDefaultThrow } from "../../../src/lib/default-throw.js";
import { requestContext } from "../../../src/lib/request-context.js";
import { HttpError } from "../../../src/types/errors.js";
import { schemaAdapter } from "../../../src/lib/schema-adapter.js";

// ── Mock schema-adapter ─────────────────────────────────────

vi.mock("../../../src/lib/schema-adapter.js", () => {
  return {
    schemaAdapter: {
      createI18nError: vi.fn(),
    },
  };
});

// ── 测试工具 ────────────────────────────────────────────────

/**
 * 创建模拟的 I18nError 返回值
 */
function createMockI18nError(overrides: {
  message?: string;
  code?: string;
  originalKey?: string;
  statusCode?: number;
}) {
  return {
    message: overrides.message ?? "some error",
    code: overrides.code ?? overrides.originalKey ?? "error.key",
    originalKey: overrides.originalKey ?? "error.key",
    statusCode: overrides.statusCode ?? undefined,
  };
}

// ── 测试 ────────────────────────────────────────────────────

describe("createDefaultThrow", () => {
  let throwFn: ReturnType<typeof createDefaultThrow>;
  const mockCreateI18nError = vi.mocked(schemaAdapter.createI18nError);

  beforeEach(() => {
    throwFn = createDefaultThrow();
    mockCreateI18nError.mockReset();
  });

  // ── 标准调用（第一参数为 number）────────────────────────

  describe("standard call: throw(status, message)", () => {
    it("should throw HttpError with status and message", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "User not found",
          originalKey: "user.not_found",
          code: "user.not_found",
        }) as any,
      );

      expect(() => throwFn(404, "user.not_found")).toThrow(HttpError);

      try {
        throwFn(404, "user.not_found");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(404);
        expect(httpErr.message).toBe("User not found");
      }
    });

    it("should pass message as i18n key to schemaAdapter", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "用户不存在",
          originalKey: "user.not_found",
          code: "user.not_found",
        }) as any,
      );

      try {
        throwFn(404, "user.not_found");
      } catch {
        // expected
      }

      expect(mockCreateI18nError).toHaveBeenCalledWith(
        "user.not_found",
        {},
        404,
        undefined, // no locale in store
      );
    });
  });

  describe("standard call: throw(status, message, code)", () => {
    it("should use explicit numeric business code", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "邮箱已注册",
          originalKey: "邮箱已注册",
          code: "邮箱已注册",
        }) as any,
      );

      try {
        throwFn(400, "邮箱已注册", 10001);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(400);
        expect(httpErr.message).toBe("邮箱已注册");
        expect(httpErr.code).toBe(10001);
      }
    });

    it("should use explicit string business code", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Unauthorized",
          originalKey: "Unauthorized",
          code: "Unauthorized",
        }) as any,
      );

      try {
        throwFn(401, "Unauthorized", "UNAUTHORIZED");
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(401);
        expect(httpErr.code).toBe("UNAUTHORIZED");
      }
    });
  });

  describe("standard call: throw(status, message, params)", () => {
    it("should pass i18n params to schemaAdapter", () => {
      const params = { balance: 50, required: 100 };

      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "余额不足，当前 50，需要 100",
          originalKey: "balance.insufficient",
          code: "balance.insufficient",
        }) as any,
      );

      try {
        throwFn(400, "balance.insufficient", params);
      } catch {
        // expected
      }

      expect(mockCreateI18nError).toHaveBeenCalledWith(
        "balance.insufficient",
        params,
        400,
        undefined,
      );
    });
  });

  describe("standard call: throw(status, message, params, code)", () => {
    it("should use explicit code over locale code", () => {
      const params = { balance: 50 };

      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "余额不足",
          originalKey: "balance.insufficient",
          code: "40001", // locale-defined code
        }) as any,
      );

      try {
        throwFn(400, "balance.insufficient", params, 50001);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(400);
        expect(httpErr.code).toBe(50001); // explicit code wins over locale code
      }
    });

    it("should treat fourth argument object as error details", () => {
      const params = { provider: "stripe" };
      const details = {
        vendorCode: "card_declined",
        vendorMessage: "declined",
      };

      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Payment rejected",
          originalKey: "payment.rejected",
          code: "payment.rejected",
        }) as any,
      );

      try {
        throwFn(402, "payment.rejected", params, details);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(402);
        expect(httpErr.message).toBe("Payment rejected");
        expect(httpErr.code).toBeUndefined();
        expect(httpErr.details).toEqual(details);
      }
    });

    it("should support object style call with code and details", () => {
      const details = { upstream: { code: "E_LIMIT", retryable: false } };

      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Upstream rejected",
          originalKey: "upstream.rejected",
          code: "upstream.rejected",
        }) as any,
      );

      try {
        throwFn({
          status: 502,
          message: "upstream.rejected",
          params: { provider: "crm" },
          code: "CRM_REJECTED",
          details,
        });
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(502);
        expect(httpErr.code).toBe("CRM_REJECTED");
        expect(httpErr.details).toEqual(details);
      }
    });
  });

  // ── 快捷方式（第一参数为 string）────────────────────────

  describe("shorthand: throw(messageKey)", () => {
    it("should throw HttpError with default status 400", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Insufficient balance",
          originalKey: "balance.insufficient",
          code: "balance.insufficient",
          statusCode: undefined, // no statusCode in i18n config
        }) as any,
      );

      try {
        throwFn("balance.insufficient" as any);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(400); // default 400
        expect(httpErr.message).toBe("Insufficient balance");
      }
    });

    it("should call schemaAdapter.createI18nError with messageKey", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "balance error",
          originalKey: "balance.insufficient",
          code: "balance.insufficient",
        }) as any,
      );

      try {
        throwFn("balance.insufficient" as any);
      } catch {
        // expected
      }

      expect(mockCreateI18nError).toHaveBeenCalledWith(
        "balance.insufficient",
        {},
        undefined, // statusCode left to i18n config
        undefined, // no locale
      );
    });

    it("should use statusCode from i18n config when available", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "User not found",
          originalKey: "user.not_found",
          code: "user.not_found",
          statusCode: 404, // i18n config specifies 404
        }) as any,
      );

      try {
        throwFn("user.not_found" as any);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(404); // from i18n config
        expect(httpErr.message).toBe("User not found");
      }
    });

    it("should extract locale code from i18n config", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Unauthorized",
          originalKey: "auth.unauthorized",
          code: "40100", // locale config defines a code different from originalKey
          statusCode: 401,
        }) as any,
      );

      try {
        throwFn("auth.unauthorized" as any);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(401);
        expect(httpErr.code).toBe(40100); // parsed as number
      }
    });

    it("should fallback to messageKey when i18n has no translation", () => {
      // Directly return an object with message: null to bypass createMockI18nError default
      mockCreateI18nError.mockReturnValue({
        message: null,
        code: "unknown.key",
        originalKey: "unknown.key",
        statusCode: undefined,
      } as any);

      try {
        throwFn("unknown.key" as any);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(400);
        expect(httpErr.message).toBe("unknown.key"); // fallback
      }
    });
  });

  describe("shorthand: throw(messageKey, params)", () => {
    it("should pass params to schemaAdapter", () => {
      const params = { balance: 50, required: 100 };

      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Insufficient balance: 50 < 100",
          originalKey: "balance.insufficient",
          code: "balance.insufficient",
        }) as any,
      );

      try {
        throwFn("balance.insufficient" as any, params);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.message).toBe("Insufficient balance: 50 < 100");
      }

      expect(mockCreateI18nError).toHaveBeenCalledWith(
        "balance.insufficient",
        params,
        undefined,
        undefined,
      );
    });

    it("should use statusCode from i18n config with params", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Too many requests from 192.168.1.1",
          originalKey: "rate_limit.exceeded",
          code: "42900",
          statusCode: 429,
        }) as any,
      );

      try {
        throwFn("rate_limit.exceeded" as any, { ip: "192.168.1.1" });
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(429);
        expect(httpErr.code).toBe(42900);
      }
    });
  });

  // ── requestContext locale ────────────────────────────────

  describe("locale from requestContext", () => {
    it("should pass locale from requestContext store (standard call)", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "用户不存在",
          originalKey: "user.not_found",
          code: "user.not_found",
        }) as any,
      );

      requestContext.run({ locale: "zh-CN" } as any, () => {
        try {
          throwFn(404, "user.not_found");
        } catch {
          // expected
        }
      });

      expect(mockCreateI18nError).toHaveBeenCalledWith(
        "user.not_found",
        {},
        404,
        "zh-CN",
      );
    });

    it("should pass locale from requestContext store (shorthand call)", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "用户不存在",
          originalKey: "user.not_found",
          code: "user.not_found",
          statusCode: 404,
        }) as any,
      );

      requestContext.run({ locale: "zh-CN" } as any, () => {
        try {
          throwFn("user.not_found" as any);
        } catch (err) {
          const httpErr = err as HttpError;
          expect(httpErr.status).toBe(404);
          expect(httpErr.message).toBe("用户不存在");
        }
      });

      expect(mockCreateI18nError).toHaveBeenCalledWith(
        "user.not_found",
        {},
        undefined,
        "zh-CN",
      );
    });
  });

  // ── locale code priority ────────────────────────────────

  describe("business code priority", () => {
    it("locale code should be used when no explicit code is passed", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Forbidden",
          originalKey: "auth.forbidden",
          code: "40300", // locale-defined code (different from originalKey)
        }) as any,
      );

      try {
        throwFn(403, "auth.forbidden");
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.code).toBe(40300); // locale code
      }
    });

    it("explicit code should override locale code", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Forbidden",
          originalKey: "auth.forbidden",
          code: "40300", // locale-defined code
        }) as any,
      );

      try {
        throwFn(403, "auth.forbidden", 99999);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.code).toBe(99999); // explicit wins
      }
    });

    it("no code when locale code equals originalKey", () => {
      mockCreateI18nError.mockReturnValue(
        createMockI18nError({
          message: "Not found",
          originalKey: "not.found",
          code: "not.found", // same as originalKey → no independent code
        }) as any,
      );

      try {
        throwFn(404, "not.found");
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.code).toBeUndefined();
      }
    });
  });
});

/**
 * cluster-checks 单元测试
 *
 * 测试覆盖：
 *   - checkClusterCompatibility：多 Worker 场景下的兼容性检测
 *   - rate-limit 内存 store 警告：触发条件、跳过条件、警告消息内容
 *   - 单 Worker / 无 cluster 场景下不触发检测
 *   - _rateLimiterOverridden 标记对检测行为的影响
 *
 * 测试策略：
 *   - 构造 mock VextApp 对象（仅需 config + logger）
 *   - 通过不同的 config 组合验证检测逻辑
 *   - 验证 logger.warn 的调用情况
 *
 * @see 12-cluster.md §4.1（Cluster 模式启动检测与警告）
 */

import { describe, it, expect, vi } from "vitest";
import { checkClusterCompatibility } from "../../../src/lib/cluster/cluster-checks.js";
import type { VextApp } from "../../../src/types/app.js";

// ── Mock 工厂 ────────────────────────────────────────────────

/**
 * 创建最小化的 mock VextApp
 *
 * 仅包含 checkClusterCompatibility 需要的字段：
 *   - config.rateLimit（控制检测行为）
 *   - logger.warn（验证警告输出）
 *   - _rateLimiterOverridden（标记用户是否替换了 rate limiter）
 */
function createMockApp(
  options: {
    rateLimitEnabled?: boolean;
    rateLimitMax?: number;
    rateLimiterOverridden?: boolean;
  } = {},
): VextApp {
  const {
    rateLimitEnabled = true,
    rateLimitMax = 100,
    rateLimiterOverridden = false,
  } = options;

  const app = {
    config: {
      rateLimit: {
        enabled: rateLimitEnabled,
        max: rateLimitMax,
        window: 60,
        message: "Too Many Requests",
        keyBy: "ip",
      },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    },
    _rateLimiterOverridden: rateLimiterOverridden,
  } as unknown as VextApp;

  return app;
}

// ── 测试套件 ────────────────────────────────────────────────

describe("checkClusterCompatibility", () => {
  // ── 不触发检测的场景 ──────────────────────────────────

  describe("should NOT warn (skip detection)", () => {
    it("should return empty results when workerCount = 0", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 0);

      expect(results).toEqual([]);
      expect(app.logger.warn).not.toHaveBeenCalled();
    });

    it("should return empty results when workerCount = 1 (single worker)", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 1);

      expect(results).toEqual([]);
      expect(app.logger.warn).not.toHaveBeenCalled();
    });

    it("should return empty results when workerCount is negative", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, -1);

      expect(results).toEqual([]);
      expect(app.logger.warn).not.toHaveBeenCalled();
    });

    it("should not warn when rateLimit is disabled", () => {
      const app = createMockApp({ rateLimitEnabled: false });
      const results = checkClusterCompatibility(app, 4);

      expect(results).toHaveLength(1);
      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck).toBeDefined();
      expect(rateLimitCheck!.warned).toBe(false);
      expect(app.logger.warn).not.toHaveBeenCalled();
    });

    it("should not warn when rateLimiter has been overridden by user", () => {
      const app = createMockApp({ rateLimiterOverridden: true });
      const results = checkClusterCompatibility(app, 4);

      expect(results).toHaveLength(1);
      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck).toBeDefined();
      expect(rateLimitCheck!.warned).toBe(false);
      expect(app.logger.warn).not.toHaveBeenCalled();
    });

    it("should not warn when rateLimit is disabled AND limiter is overridden", () => {
      const app = createMockApp({
        rateLimitEnabled: false,
        rateLimiterOverridden: true,
      });
      const results = checkClusterCompatibility(app, 8);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(false);
      expect(app.logger.warn).not.toHaveBeenCalled();
    });
  });

  // ── 触发警告的场景 ────────────────────────────────────

  describe("should WARN (detection triggered)", () => {
    it("should warn when workerCount > 1 and rateLimit uses default memory store", () => {
      const app = createMockApp({ rateLimitMax: 100 });
      const results = checkClusterCompatibility(app, 4);

      expect(results).toHaveLength(1);
      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck).toBeDefined();
      expect(rateLimitCheck!.warned).toBe(true);
      expect(rateLimitCheck!.message).toBeDefined();
      expect(app.logger.warn).toHaveBeenCalledTimes(1);
    });

    it("should warn with correct worker count in message", () => {
      const app = createMockApp({ rateLimitMax: 50 });
      const results = checkClusterCompatibility(app, 8);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(true);

      const message = rateLimitCheck!.message!;
      expect(message).toContain("8 workers");
      expect(message).toContain("8 × 50");
      expect(message).toContain("= 400");
    });

    it("should include recommendation in warning message", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 2);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.message).toContain("Recommendation");
      expect(rateLimitCheck!.message).toContain("Redis");
      expect(rateLimitCheck!.message).toContain("app.setRateLimiter()");
    });

    it("should include docs link in warning message", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 2);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.message).toContain(
        "https://vextjs.dev/guide/cluster#rate-limit",
      );
    });

    it("should pass warning message to app.logger.warn", () => {
      const app = createMockApp({ rateLimitMax: 200 });
      checkClusterCompatibility(app, 3);

      expect(app.logger.warn).toHaveBeenCalledTimes(1);
      const warnArg = (app.logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(warnArg).toContain("3 workers");
      expect(warnArg).toContain("3 × 200");
      expect(warnArg).toContain("= 600");
    });

    it("should warn with workerCount = 2 (minimum multi-worker)", () => {
      const app = createMockApp({ rateLimitMax: 100 });
      const results = checkClusterCompatibility(app, 2);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(true);
      expect(rateLimitCheck!.message).toContain("2 workers");
      expect(rateLimitCheck!.message).toContain("2 × 100");
      expect(rateLimitCheck!.message).toContain("= 200");
    });

    it("should warn with large workerCount", () => {
      const app = createMockApp({ rateLimitMax: 50 });
      const results = checkClusterCompatibility(app, 64);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(true);
      expect(rateLimitCheck!.message).toContain("64 workers");
      expect(rateLimitCheck!.message).toContain("64 × 50");
      expect(rateLimitCheck!.message).toContain("= 3200");
    });
  });

  // ── rateLimit 配置变体 ────────────────────────────────

  describe("rateLimit config variations", () => {
    it("should handle rateLimit.enabled = undefined (treated as enabled)", () => {
      const app = createMockApp();
      // 修改 config 使 enabled 为 undefined
      (app.config.rateLimit as Record<string, unknown>).enabled = undefined;

      const results = checkClusterCompatibility(app, 4);

      // enabled 不是 false → 触发检测 → 内存 store → 警告
      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(true);
    });

    it("should handle rateLimit.enabled = true explicitly", () => {
      const app = createMockApp({ rateLimitEnabled: true });
      const results = checkClusterCompatibility(app, 4);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(true);
    });

    it("should handle rateLimit.max = 0", () => {
      const app = createMockApp({ rateLimitMax: 0 });
      const results = checkClusterCompatibility(app, 4);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(true);
      expect(rateLimitCheck!.message).toContain("4 × 0");
      expect(rateLimitCheck!.message).toContain("= 0");
    });

    it("should handle missing rateLimit config entirely", () => {
      const app = createMockApp();
      // 删除整个 rateLimit 配置
      (app.config as Record<string, unknown>).rateLimit = undefined;

      const results = checkClusterCompatibility(app, 4);

      // rateLimit 为 undefined → enabled 不是 false → 继续检测
      // 但 max 也是 undefined，结果中应包含 "N/A" 或 0
      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck).toBeDefined();
      // 具体行为取决于实现：rateLimit?.enabled === false 为 false（undefined !== false）
      // 所以仍会触发警告
      expect(rateLimitCheck!.warned).toBe(true);
    });
  });

  // ── _rateLimiterOverridden 标记 ──────────────────────

  describe("_rateLimiterOverridden flag", () => {
    it("should check _rateLimiterOverridden on app object", () => {
      const app = createMockApp({ rateLimiterOverridden: false });
      const results = checkClusterCompatibility(app, 4);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(true);
    });

    it("should not warn when _rateLimiterOverridden is true", () => {
      const app = createMockApp({ rateLimiterOverridden: true });
      const results = checkClusterCompatibility(app, 4);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(false);
      expect(app.logger.warn).not.toHaveBeenCalled();
    });

    it("should treat missing _rateLimiterOverridden as false (not overridden)", () => {
      const app = createMockApp();
      // 确保标记不存在
      delete (app as Record<string, unknown>)._rateLimiterOverridden;

      const results = checkClusterCompatibility(app, 4);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(true);
    });

    it("should treat _rateLimiterOverridden = 'truthy-string' as false (strict boolean check)", () => {
      const app = createMockApp();
      (app as Record<string, unknown>)._rateLimiterOverridden = "yes";

      const results = checkClusterCompatibility(app, 4);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      // 严格检查 === true，字符串 "yes" 不满足
      expect(rateLimitCheck!.warned).toBe(true);
    });

    it("should treat _rateLimiterOverridden = 1 as false (strict boolean check)", () => {
      const app = createMockApp();
      (app as Record<string, unknown>)._rateLimiterOverridden = 1;

      const results = checkClusterCompatibility(app, 4);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      // 严格检查 === true，数字 1 不满足
      expect(rateLimitCheck!.warned).toBe(true);
    });
  });

  // ── 返回值结构 ────────────────────────────────────────

  describe("return value structure", () => {
    it("should return an array", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 4);

      expect(Array.isArray(results)).toBe(true);
    });

    it("should return results with correct shape (name, warned, message?)", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 4);

      for (const result of results) {
        expect(result).toHaveProperty("name");
        expect(typeof result.name).toBe("string");
        expect(result).toHaveProperty("warned");
        expect(typeof result.warned).toBe("boolean");

        if (result.warned) {
          expect(result).toHaveProperty("message");
          expect(typeof result.message).toBe("string");
          expect(result.message!.length).toBeGreaterThan(0);
        }
      }
    });

    it("should include rate-limit-memory-store check for multi-worker", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 4);

      const names = results.map((r) => r.name);
      expect(names).toContain("rate-limit-memory-store");
    });

    it("should return exactly 1 check result for current implementation", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 4);

      // 当前实现只有 rate-limit 检测
      expect(results).toHaveLength(1);
    });

    it("should return empty array for single worker (no checks needed)", () => {
      const app = createMockApp();
      const results = checkClusterCompatibility(app, 1);

      expect(results).toHaveLength(0);
    });

    it("warned=false result should not have message property or should have undefined message", () => {
      const app = createMockApp({ rateLimitEnabled: false });
      const results = checkClusterCompatibility(app, 4);

      const rateLimitCheck = results.find(
        (r) => r.name === "rate-limit-memory-store",
      );
      expect(rateLimitCheck!.warned).toBe(false);
      expect(rateLimitCheck!.message).toBeUndefined();
    });
  });

  // ── 警告消息格式 ──────────────────────────────────────

  describe("warning message format", () => {
    it("should include vextjs prefix", () => {
      const app = createMockApp();
      checkClusterCompatibility(app, 4);

      const warnArg = (app.logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(warnArg).toContain("[vextjs]");
    });

    it("should include ⚠️ emoji indicator", () => {
      const app = createMockApp();
      checkClusterCompatibility(app, 4);

      const warnArg = (app.logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(warnArg).toContain("⚠️");
    });

    it("should include 'Cluster mode' in message", () => {
      const app = createMockApp();
      checkClusterCompatibility(app, 4);

      const warnArg = (app.logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(warnArg).toContain("Cluster mode");
    });

    it("should include 'in-memory store' in message", () => {
      const app = createMockApp();
      checkClusterCompatibility(app, 4);

      const warnArg = (app.logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(warnArg).toContain("in-memory store");
    });

    it("should include 'independent counters' explanation", () => {
      const app = createMockApp();
      checkClusterCompatibility(app, 4);

      const warnArg = (app.logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(warnArg).toContain("independent counters");
    });

    it("should calculate correct total rate for different configs", () => {
      // 3 workers × 200 max = 600
      const app1 = createMockApp({ rateLimitMax: 200 });
      checkClusterCompatibility(app1, 3);
      const msg1 = (app1.logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(msg1).toContain("3 × 200");
      expect(msg1).toContain("= 600");

      // 16 workers × 10 max = 160
      const app2 = createMockApp({ rateLimitMax: 10 });
      checkClusterCompatibility(app2, 16);
      const msg2 = (app2.logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(msg2).toContain("16 × 10");
      expect(msg2).toContain("= 160");
    });
  });

  // ── 不同 rateLimit.enabled 值的边界测试 ──────────────

  describe("rateLimit.enabled edge cases", () => {
    it("should not warn when enabled is explicitly false", () => {
      const app = createMockApp({ rateLimitEnabled: false });
      const results = checkClusterCompatibility(app, 4);

      expect(results[0]!.warned).toBe(false);
    });

    it("should warn when enabled is explicitly true", () => {
      const app = createMockApp({ rateLimitEnabled: true });
      const results = checkClusterCompatibility(app, 4);

      expect(results[0]!.warned).toBe(true);
    });
  });

  // ── 多次调用 ──────────────────────────────────────────

  describe("multiple invocations", () => {
    it("should produce consistent results across multiple calls", () => {
      const app = createMockApp();

      const results1 = checkClusterCompatibility(app, 4);
      const results2 = checkClusterCompatibility(app, 4);

      expect(results1).toHaveLength(results2.length);
      expect(results1[0]!.name).toBe(results2[0]!.name);
      expect(results1[0]!.warned).toBe(results2[0]!.warned);
    });

    it("should call logger.warn each time when warning is triggered", () => {
      const app = createMockApp();

      checkClusterCompatibility(app, 4);
      checkClusterCompatibility(app, 4);
      checkClusterCompatibility(app, 4);

      expect(app.logger.warn).toHaveBeenCalledTimes(3);
    });
  });
});

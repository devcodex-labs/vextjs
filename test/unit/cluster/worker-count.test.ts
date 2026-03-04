/**
 * worker-count 单元测试
 *
 * 测试覆盖：
 *   - resolveWorkerCount：显式数字、'auto'、'auto-1' 三种模式
 *   - 边界值保护：最小值 1、最大值 64
 *   - 输入类型验证
 *
 * @see 12a-master.md §2（Worker 数量计算）
 */

import { describe, it, expect } from "vitest";
import {
  resolveWorkerCount,
  _internals,
} from "../../../src/lib/cluster/worker-count.js";

// ── resolveWorkerCount ──────────────────────────────────────

describe("resolveWorkerCount", () => {
  // ── 显式数字模式 ──────────────────────────────────────

  describe("numeric config", () => {
    it("should return the exact number when within valid range", () => {
      expect(resolveWorkerCount(4)).toBe(4);
    });

    it("should return 1 for input of 1", () => {
      expect(resolveWorkerCount(1)).toBe(1);
    });

    it("should return 1 for input of 0 (minimum protection)", () => {
      expect(resolveWorkerCount(0)).toBe(1);
    });

    it("should return 1 for negative numbers (minimum protection)", () => {
      expect(resolveWorkerCount(-1)).toBe(1);
      expect(resolveWorkerCount(-100)).toBe(1);
    });

    it("should return 64 for numbers exceeding MAX_WORKERS (hard cap)", () => {
      expect(resolveWorkerCount(65)).toBe(64);
      expect(resolveWorkerCount(100)).toBe(64);
      expect(resolveWorkerCount(1000)).toBe(64);
    });

    it("should return 64 for exactly MAX_WORKERS", () => {
      expect(resolveWorkerCount(64)).toBe(64);
    });

    it("should handle common worker counts correctly", () => {
      expect(resolveWorkerCount(2)).toBe(2);
      expect(resolveWorkerCount(8)).toBe(8);
      expect(resolveWorkerCount(16)).toBe(16);
      expect(resolveWorkerCount(32)).toBe(32);
    });
  });

  // ── 'auto' 模式 ──────────────────────────────────────

  describe("'auto' config", () => {
    it("should return a positive integer", () => {
      const result = resolveWorkerCount("auto");
      expect(result).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(result)).toBe(true);
    });

    it("should not exceed MAX_WORKERS", () => {
      const result = resolveWorkerCount("auto");
      expect(result).toBeLessThanOrEqual(_internals.MAX_WORKERS);
    });

    it("should return at least 1", () => {
      const result = resolveWorkerCount("auto");
      expect(result).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 'auto-1' 模式 ────────────────────────────────────

  describe("'auto-1' config", () => {
    it("should return a positive integer", () => {
      const result = resolveWorkerCount("auto-1");
      expect(result).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(result)).toBe(true);
    });

    it("should return at least 1 (never zero even on single-core)", () => {
      const result = resolveWorkerCount("auto-1");
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it("should return less than or equal to 'auto' result", () => {
      const autoResult = resolveWorkerCount("auto");
      const auto1Result = resolveWorkerCount("auto-1");
      expect(auto1Result).toBeLessThanOrEqual(autoResult);
    });

    it("should not exceed MAX_WORKERS", () => {
      const result = resolveWorkerCount("auto-1");
      expect(result).toBeLessThanOrEqual(_internals.MAX_WORKERS);
    });
  });

  // ── 'auto' vs 'auto-1' 关系 ──────────────────────────

  describe("auto vs auto-1 relationship", () => {
    it("auto-1 should be auto - 1 when auto > 1", () => {
      const autoResult = resolveWorkerCount("auto");
      const auto1Result = resolveWorkerCount("auto-1");

      if (autoResult > 1) {
        expect(auto1Result).toBe(autoResult - 1);
      } else {
        // 单核场景：两者都应该是 1
        expect(auto1Result).toBe(1);
      }
    });
  });
});

// ── _internals ──────────────────────────────────────────────

describe("_internals", () => {
  describe("MAX_WORKERS", () => {
    it("should be 64", () => {
      expect(_internals.MAX_WORKERS).toBe(64);
    });
  });

  describe("detectCpuCount", () => {
    it("should return a positive integer", () => {
      const count = _internals.detectCpuCount();
      expect(count).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(count)).toBe(true);
    });

    it("should not exceed MAX_WORKERS", () => {
      const count = _internals.detectCpuCount();
      expect(count).toBeLessThanOrEqual(_internals.MAX_WORKERS);
    });
  });

  describe("adjustForCgroupV1", () => {
    it("should return fallback on non-Linux platforms", () => {
      // 在 Windows/macOS 上运行时，应直接返回 fallback
      if (process.platform !== "linux") {
        expect(_internals.adjustForCgroupV1(8)).toBe(8);
        expect(_internals.adjustForCgroupV1(1)).toBe(1);
      }
    });

    it("should return fallback value when no cgroup files exist", () => {
      // 非容器环境中 cgroup 文件通常不存在或配额为 -1
      const result = _internals.adjustForCgroupV1(4);
      // 结果应为 <= fallback（cgroup 可能限制更低）
      expect(result).toBeLessThanOrEqual(4);
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it("should handle various fallback values", () => {
      expect(_internals.adjustForCgroupV1(1)).toBeGreaterThanOrEqual(1);
      expect(_internals.adjustForCgroupV1(16)).toBeLessThanOrEqual(16);
      expect(_internals.adjustForCgroupV1(64)).toBeLessThanOrEqual(64);
    });
  });
});

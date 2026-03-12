/**
 * MemoryCacheStore 单元测试
 *
 * 测试覆盖：
 *   - get/set 基本读写
 *   - TTL 过期清除
 *   - LRU 淘汰（maxEntries）
 *   - 标签索引：invalidateByTag 批量失效
 *   - clear 清空
 *   - stats 统计（hits/misses/hitRate）
 *   - 边界场景：空 tags、key 覆盖、并发安全
 *
 * @see 15-route-cache.md §10.1
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryCacheStore } from "../../src/lib/cache/memory-store.js";
import type { CacheEntry } from "../../src/types/app.js";

// ── 测试辅助 ────────────────────────────────────────────────

function createEntry(
  body: unknown = { data: "test" },
  statusCode: number = 200,
  tags: string[] = [],
): CacheEntry {
  return {
    body,
    statusCode,
    cachedAt: Date.now(),
    tags,
  };
}

// ── 测试用例 ────────────────────────────────────────────────

describe("MemoryCacheStore", () => {
  let store: MemoryCacheStore;

  beforeEach(() => {
    store = new MemoryCacheStore({ maxEntries: 5 });
  });

  // ── 基本读写 ────────────────────────────────────────────

  describe("get/set 基本读写", () => {
    it("set 后 get 应返回相同数据", () => {
      const entry = createEntry({ products: [1, 2, 3] });
      store.set("key1", entry, 60);

      const result = store.get("key1");
      expect(result).not.toBeNull();
      expect(result!.body).toEqual({ products: [1, 2, 3] });
      expect(result!.statusCode).toBe(200);
      expect(result!.tags).toEqual([]);
    });

    it("get 不存在的 key 应返回 null", () => {
      const result = store.get("nonexistent");
      expect(result).toBeNull();
    });

    it("set 应覆盖已有 key", () => {
      store.set("key1", createEntry("old"), 60);
      store.set("key1", createEntry("new"), 60);

      const result = store.get("key1");
      expect(result!.body).toBe("new");
    });
  });

  // ── TTL 过期 ────────────────────────────────────────────

  describe("TTL 过期", () => {
    it("未过期条目应正常返回", () => {
      store.set("key1", createEntry("alive"), 60);
      const result = store.get("key1");
      expect(result).not.toBeNull();
      expect(result!.body).toBe("alive");
    });

    it("过期条目应返回 null 并自动删除", () => {
      // 创建已过期的条目（cachedAt 设置为过去）
      const entry: CacheEntry = {
        body: "expired",
        statusCode: 200,
        cachedAt: Date.now() - 120_000, // 2 分钟前
        tags: [],
      };
      store.set("key1", entry, 60); // TTL 60s，但 cachedAt 是 2 分钟前

      const result = store.get("key1");
      expect(result).toBeNull();

      // 条目应被清除
      expect(store.stats().entries).toBe(0);
    });

    it("TTL 恰好在边界应正确处理", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      store.set("key1", createEntry("border"), 10);

      // 9 秒后仍有效
      vi.setSystemTime(now + 9_000);
      expect(store.get("key1")).not.toBeNull();

      // 11 秒后过期
      vi.setSystemTime(now + 11_000);
      expect(store.get("key1")).toBeNull();

      vi.useRealTimers();
    });
  });

  // ── LRU 淘汰 ────────────────────────────────────────────

  describe("LRU 淘汰（maxEntries）", () => {
    it("超过 maxEntries 应淘汰最旧条目", () => {
      // maxEntries = 5
      for (let i = 1; i <= 6; i++) {
        store.set(`key${i}`, createEntry(`data${i}`), 60);
      }

      // key1 应被淘汰
      expect(store.get("key1")).toBeNull();
      // key2-key6 应存在
      expect(store.get("key2")).not.toBeNull();
      expect(store.get("key6")).not.toBeNull();
      expect(store.stats().entries).toBe(5);
    });

    it("访问过的条目不应优先被淘汰", () => {
      for (let i = 1; i <= 5; i++) {
        store.set(`key${i}`, createEntry(`data${i}`), 60);
      }

      // 访问 key1，将其移到 Map 末尾
      store.get("key1");

      // 再插入一个新条目，key2（最旧未访问）应被淘汰
      store.set("key6", createEntry("data6"), 60);

      expect(store.get("key1")).not.toBeNull(); // LRU 保护
      expect(store.get("key2")).toBeNull(); // 被淘汰
      expect(store.get("key6")).not.toBeNull();
    });
  });

  // ── 标签索引 ────────────────────────────────────────────

  describe("标签索引：invalidateByTag", () => {
    it("按标签批量失效应删除所有关联条目", () => {
      store.set("p1", createEntry("product1", 200, ["products"]), 60);
      store.set("p2", createEntry("product2", 200, ["products"]), 60);
      store.set("u1", createEntry("user1", 200, ["users"]), 60);

      store.invalidateByTag("products");

      expect(store.get("p1")).toBeNull();
      expect(store.get("p2")).toBeNull();
      expect(store.get("u1")).not.toBeNull();
    });

    it("失效不存在的标签不应报错", () => {
      store.set("key1", createEntry("data1"), 60);
      expect(() => store.invalidateByTag("nonexistent")).not.toThrow();
      expect(store.get("key1")).not.toBeNull();
    });

    it("多标签条目：失效其中一个标签应删除整个条目", () => {
      store.set(
        "key1",
        createEntry("multi-tag", 200, ["tag-a", "tag-b"]),
        60,
      );

      store.invalidateByTag("tag-a");

      expect(store.get("key1")).toBeNull();
    });

    it("覆盖 key 时应更新标签索引", () => {
      store.set("key1", createEntry("v1", 200, ["old-tag"]), 60);
      store.set("key1", createEntry("v2", 200, ["new-tag"]), 60);

      // old-tag 失效不应影响 key1（标签已更新）
      store.invalidateByTag("old-tag");
      expect(store.get("key1")).not.toBeNull();

      // new-tag 失效应删除 key1
      store.invalidateByTag("new-tag");
      expect(store.get("key1")).toBeNull();
    });
  });

  // ── clear ──────────────────────────────────────────────

  describe("clear 清空", () => {
    it("清空后所有条目不可访问", () => {
      store.set("key1", createEntry("data1"), 60);
      store.set("key2", createEntry("data2"), 60);

      store.clear();

      expect(store.get("key1")).toBeNull();
      expect(store.get("key2")).toBeNull();
      expect(store.stats().entries).toBe(0);
    });

    it("清空后仍可正常写入", () => {
      store.set("key1", createEntry("data1"), 60);
      store.clear();
      store.set("key2", createEntry("data2"), 60);

      expect(store.get("key2")).not.toBeNull();
    });
  });

  // ── delete ─────────────────────────────────────────────

  describe("delete 删除", () => {
    it("删除已存在的 key", () => {
      store.set("key1", createEntry("data1", 200, ["tag"]), 60);
      store.delete("key1");

      expect(store.get("key1")).toBeNull();
      expect(store.stats().entries).toBe(0);
    });

    it("删除不存在的 key 不报错", () => {
      expect(() => store.delete("nonexistent")).not.toThrow();
    });
  });

  // ── stats 统计 ──────────────────────────────────────────

  describe("stats 统计", () => {
    it("初始状态应全为 0", () => {
      const stats = store.stats();
      expect(stats.entries).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("HIT 应增加 hits 计数", () => {
      store.set("key1", createEntry("data1"), 60);
      store.get("key1");
      store.get("key1");

      const stats = store.stats();
      expect(stats.hits).toBe(2);
    });

    it("MISS 应增加 misses 计数", () => {
      store.get("nonexistent");
      store.get("also-nonexistent");

      const stats = store.stats();
      expect(stats.misses).toBe(2);
    });

    it("hitRate 应正确计算", () => {
      store.set("key1", createEntry("data1"), 60);
      store.get("key1"); // hit
      store.get("key1"); // hit
      store.get("miss"); // miss

      const stats = store.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });

    it("过期条目的 get 应计为 miss", () => {
      const entry: CacheEntry = {
        body: "expired",
        statusCode: 200,
        cachedAt: Date.now() - 120_000,
        tags: [],
      };
      store.set("key1", entry, 60);
      store.get("key1"); // 过期 → miss

      expect(store.stats().misses).toBe(1);
      expect(store.stats().hits).toBe(0);
    });

    it("entries 应反映当前存储数量", () => {
      store.set("key1", createEntry("d1"), 60);
      store.set("key2", createEntry("d2"), 60);
      expect(store.stats().entries).toBe(2);

      store.delete("key1");
      expect(store.stats().entries).toBe(1);
    });
  });

  // ── 边界场景 ────────────────────────────────────────────

  describe("边界场景", () => {
    it("maxEntries=1 应只保留最新条目", () => {
      const tinyStore = new MemoryCacheStore({ maxEntries: 1 });
      tinyStore.set("key1", createEntry("d1"), 60);
      tinyStore.set("key2", createEntry("d2"), 60);

      expect(tinyStore.get("key1")).toBeNull();
      expect(tinyStore.get("key2")).not.toBeNull();
    });

    it("空 tags 数组应正常处理", () => {
      store.set("key1", createEntry("data", 200, []), 60);
      expect(store.get("key1")).not.toBeNull();
      store.invalidateByTag("any"); // 不影响无标签条目
      expect(store.get("key1")).not.toBeNull();
    });

    it("默认 maxEntries 应为 1000", () => {
      const defaultStore = new MemoryCacheStore();
      // 写入大量条目
      for (let i = 0; i < 1001; i++) {
        defaultStore.set(`key${i}`, createEntry(`d${i}`), 60);
      }
      // key0 应被淘汰
      expect(defaultStore.get("key0")).toBeNull();
      // key1000 应存在
      expect(defaultStore.get("key1000")).not.toBeNull();
    });

    it("LRU 淘汰时应清理被淘汰条目的标签索引", () => {
      // maxEntries=5, 用带标签的条目填满
      store.set("k1", createEntry("d1", 200, ["evict-tag"]), 60);
      store.set("k2", createEntry("d2", 200, []), 60);
      store.set("k3", createEntry("d3", 200, []), 60);
      store.set("k4", createEntry("d4", 200, []), 60);
      store.set("k5", createEntry("d5", 200, []), 60);

      // k1 将被淘汰，其标签索引也应被清理
      store.set("k6", createEntry("d6", 200, ["evict-tag"]), 60);

      // k1 被淘汰后，evict-tag 应仅关联 k6
      store.invalidateByTag("evict-tag");
      expect(store.get("k6")).toBeNull(); // k6 被标签失效
      // k2-k5 不受影响
      expect(store.get("k2")).not.toBeNull();
    });

    it("get 返回的 cachedAt 应与写入时一致", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const entry = createEntry("data1");
      store.set("key1", entry, 60);

      vi.setSystemTime(now + 5000);
      const result = store.get("key1");
      expect(result).not.toBeNull();
      expect(result!.cachedAt).toBe(entry.cachedAt);

      vi.useRealTimers();
    });

    it("TTL 恰好等于过期边界（expiresAt === Date.now()）不应返回", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      store.set("key1", createEntry("exact"), 10);

      // 恰好 10 秒（expiresAt = now + 10000, Date.now() = now + 10000）
      // Date.now() > entry.expiresAt → false（等于不算过期）
      vi.setSystemTime(now + 10_000);
      expect(store.get("key1")).not.toBeNull();

      // 10001ms → 过期
      vi.setSystemTime(now + 10_001);
      expect(store.get("key1")).toBeNull();

      vi.useRealTimers();
    });

    it("delete 后标签索引也应被清理", () => {
      store.set("key1", createEntry("data", 200, ["my-tag"]), 60);
      store.set("key2", createEntry("data2", 200, ["my-tag"]), 60);
      store.delete("key1");

      // my-tag 标签失效后 key2 仍应被删除
      store.invalidateByTag("my-tag");
      expect(store.get("key2")).toBeNull();
    });

    it("clear 后标签索引也应被清理", () => {
      store.set("key1", createEntry("data", 200, ["tag-a"]), 60);
      store.clear();

      // 写入新的无标签条目
      store.set("key2", createEntry("data2"), 60);

      // tag-a 失效不应影响新条目
      store.invalidateByTag("tag-a");
      expect(store.get("key2")).not.toBeNull();
    });

    it("连续两次 invalidateByTag 同一标签不应报错", () => {
      store.set("key1", createEntry("data", 200, ["tag-x"]), 60);
      store.invalidateByTag("tag-x");
      expect(() => store.invalidateByTag("tag-x")).not.toThrow();
    });

    it("set 覆盖已有 key 时 entries 数量不变", () => {
      store.set("key1", createEntry("v1"), 60);
      store.set("key1", createEntry("v2"), 60);
      expect(store.stats().entries).toBe(1);
    });

    it("statusCode 应正确保留", () => {
      store.set("key1", createEntry("data", 201, []), 60);
      const result = store.get("key1");
      expect(result!.statusCode).toBe(201);
    });
  });
});


/**
 * MemoryCacheStore — 基于 Map 的 LRU 内存缓存存储
 *
 * 核心特性：
 *   - LRU 淘汰：读取时 delete+set 移到 Map 末尾；满时删除 Map 第一个（最旧）
 *   - TTL 过期：get() 时检查 Date.now() > expiresAt，过期即删除
 *   - 标签索引：tagIndex: Map<tag, Set<key>>，invalidateByTag() 批量删除
 *   - 同步接口：get() 返回 CacheEntry | null（非 Promise），避免微任务开销
 *   - 统计：hits / misses 计数，stats() 计算 hitRate
 *
 * @module lib/cache/memory-store
 * @see 15-route-cache.md §4.6（MemoryCacheStore 设计）
 */

import type { CacheStore, CacheEntry } from "../../types/app.js";

/**
 * 内部存储条目（扩展 CacheEntry 增加过期时间）
 */
interface InternalEntry {
  /** 缓存的响应数据（包装前的原始 data） */
  body: unknown;
  /** 响应状态码 */
  statusCode: number;
  /** 缓存写入时间戳（ms） */
  cachedAt: number;
  /** 关联标签 */
  tags: string[];
  /** 过期时间戳（ms） */
  expiresAt: number;
}

/**
 * MemoryCacheStore 构造选项
 */
export interface MemoryCacheStoreOptions {
  /** 最大缓存条目数（默认 1000） */
  maxEntries?: number;
}

/**
 * MemoryCacheStore — LRU 内存缓存实现
 *
 * 基于 ES6 Map 的插入顺序特性实现 LRU：
 *   - Map 保持插入顺序（ECMAScript 规范保证）
 *   - get() 命中时 delete+set 将条目移到末尾（最新）
 *   - 容量满时删除 Map.keys().next()（最旧/最少使用）
 *
 * 性能：
 *   - get / set / delete: O(1)
 *   - invalidateByTag: O(tag 关联的 key 数量)
 *   - clear: O(1)
 */
export class MemoryCacheStore implements CacheStore {
  private _store: Map<string, InternalEntry> = new Map();
  private _tagIndex: Map<string, Set<string>> = new Map();
  private _maxEntries: number;
  private _hits: number = 0;
  private _misses: number = 0;

  constructor(options?: MemoryCacheStoreOptions) {
    this._maxEntries = options?.maxEntries ?? 1000;
  }

  /**
   * 获取缓存条目
   *
   * 同步返回（内存存储无异步 I/O）。
   * 检查 TTL 过期，过期则删除并返回 null。
   * LRU 命中时 delete+set 移到 Map 末尾。
   */
  get(key: string): CacheEntry | null {
    const entry = this._store.get(key);

    if (!entry) {
      this._misses++;
      return null;
    }

    // TTL 过期检查
    if (Date.now() > entry.expiresAt) {
      this._deleteEntry(key, entry);
      this._misses++;
      return null;
    }

    // LRU: 移到 Map 末尾（最新访问）
    this._store.delete(key);
    this._store.set(key, entry);

    this._hits++;
    return {
      body: entry.body,
      statusCode: entry.statusCode,
      cachedAt: entry.cachedAt,
      tags: entry.tags,
    };
  }

  /**
   * 写入缓存条目
   *
   * LRU 淘汰：超过 maxEntries 时删除最旧条目。
   * 标签索引：维护 tag → Set<key> 映射。
   */
  set(key: string, entry: CacheEntry, ttl: number): void {
    // 如果 key 已存在，先删除旧的标签索引
    const existing = this._store.get(key);
    if (existing) {
      this._removeTagIndex(key, existing.tags);
      this._store.delete(key);
    }

    // LRU 淘汰：超过上限时删除最旧条目
    while (this._store.size >= this._maxEntries) {
      const oldestKey = this._store.keys().next().value;
      if (oldestKey !== undefined) {
        const oldEntry = this._store.get(oldestKey);
        if (oldEntry) {
          this._removeTagIndex(oldestKey, oldEntry.tags);
        }
        this._store.delete(oldestKey);
      } else {
        break;
      }
    }

    const internalEntry: InternalEntry = {
      body: entry.body,
      statusCode: entry.statusCode,
      cachedAt: entry.cachedAt,
      tags: entry.tags,
      expiresAt: entry.cachedAt + ttl * 1000,
    };

    this._store.set(key, internalEntry);
    this._addTagIndex(key, entry.tags);
  }

  /**
   * 删除指定 key 的缓存条目
   */
  delete(key: string): void {
    const entry = this._store.get(key);
    if (entry) {
      this._deleteEntry(key, entry);
    }
  }

  /**
   * 按标签批量失效
   *
   * 删除所有关联到指定 tag 的缓存条目。
   */
  invalidateByTag(tag: string): void {
    const keys = this._tagIndex.get(tag);
    if (!keys) return;

    for (const key of keys) {
      const entry = this._store.get(key);
      if (entry) {
        // 从其他标签的索引中也移除该 key
        for (const t of entry.tags) {
          if (t !== tag) {
            const tagKeys = this._tagIndex.get(t);
            if (tagKeys) {
              tagKeys.delete(key);
              if (tagKeys.size === 0) {
                this._tagIndex.delete(t);
              }
            }
          }
        }
        this._store.delete(key);
      }
    }

    this._tagIndex.delete(tag);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this._store.clear();
    this._tagIndex.clear();
    // 保留统计数据（不重置 hits/misses）
  }

  /**
   * 缓存统计信息
   */
  stats(): { entries: number; hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      entries: this._store.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }

  // ── 内部辅助方法 ──────────────────────────────────────────

  /**
   * 删除条目及其标签索引
   */
  private _deleteEntry(key: string, entry: InternalEntry): void {
    this._removeTagIndex(key, entry.tags);
    this._store.delete(key);
  }

  /**
   * 从标签索引中移除 key
   */
  private _removeTagIndex(key: string, tags: string[]): void {
    for (const tag of tags) {
      const keys = this._tagIndex.get(tag);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this._tagIndex.delete(tag);
        }
      }
    }
  }

  /**
   * 将 key 添加到标签索引
   */
  private _addTagIndex(key: string, tags: string[]): void {
    for (const tag of tags) {
      let keys = this._tagIndex.get(tag);
      if (!keys) {
        keys = new Set();
        this._tagIndex.set(tag, keys);
      }
      keys.add(key);
    }
  }
}


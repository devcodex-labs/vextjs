/**
 * route-cache.ts — 路由级缓存中间件工厂
 *
 * 职责：
 *   1. normalizeCacheOptions：统一 false/number/object → RouteCacheOptions | null
 *   2. defaultCacheKey：默认 key 生成（method:path?sortedQuery|varyHeaders）
 *   3. buildRouteCacheMiddleware：构建路由级缓存中间件
 *
 * 设计：
 *   - 缓存中间件插入在路由级中间件之后、validate 之前
 *   - HIT：直接 res.json(cached.body) + return（跳过 validate + handler）
 *   - MISS：注册 res._onSend 钩子，handler 执行 res.json() 时捕获原始 data 写入缓存
 *   - 204 不缓存（_onSend 钩子内排除）
 *   - 空 key 跳过缓存
 *
 * @module lib/middlewares/route-cache
 * @see 15-route-cache.md §4（内部架构）
 */

import type { VextMiddleware } from "../../types/middleware.js";
import type {
  RouteCacheOptions,
  CacheStore,
  CacheEntry,
} from "../../types/app.js";
import type { VextRequest } from "../../types/request.js";

// ── normalizeCacheOptions ──────────────────────────────────────

/**
 * 统一路由级 cache 配置
 *
 * @param cache RouteOptions.cache 原始值
 * @param globalDefaultTtl 全局默认 TTL（来自 config.cache.defaultTtl）
 * @returns 规范化的 RouteCacheOptions | null（null 表示不缓存）
 *
 * 规则：
 *   - `undefined` → null（未配置，不缓存）
 *   - `false`     → null（显式禁用）
 *   - `0` 或负值  → null（数字简写禁用）
 *   - `number > 0` → { ttl: number }（数字简写）
 *   - `{ ttl, ... }` → 原样返回（对象形式）
 */
export function normalizeCacheOptions(
  cache: false | number | RouteCacheOptions | undefined,
  globalDefaultTtl?: number,
): RouteCacheOptions | null {
  if (cache === undefined || cache === false) {
    return null;
  }

  if (typeof cache === "number") {
    if (cache <= 0) return null;
    return { ttl: cache };
  }

  // 对象形式
  if (!cache.ttl && globalDefaultTtl && globalDefaultTtl > 0) {
    return { ...cache, ttl: globalDefaultTtl };
  }

  if (cache.ttl <= 0) {
    return null;
  }

  return cache;
}

// ── defaultCacheKey ────────────────────────────────────────────

/**
 * 默认缓存 key 生成
 *
 * 格式: `${method}:${path}[?${sortedQuery}][|${varyValues}]`
 *
 * 设计原则:
 *   1. method + path 天然区分不同路由和动态参数
 *      (req.path = '/users/42' 而非 '/users/:id')
 *   2. query 参数排序确保 ?a=1&b=2 ≡ ?b=2&a=1
 *   3. vary headers 区分同路径不同语言/编码
 *   4. 不含 auth/cookie → 安全默认
 *
 * 示例:
 *   GET /products               → 'GET:/products'
 *   GET /products?limit=10&page=2 → 'GET:/products?limit=10&page=2'
 *   GET /products + zh-CN         → 'GET:/products|accept-language=zh-CN'
 */
export function defaultCacheKey(req: VextRequest, vary: string[]): string {
  let key = `${req.method}:${req.path}`;

  const queryKeys = Object.keys(req.query);
  if (queryKeys.length > 0) {
    queryKeys.sort();
    key += "?" + queryKeys.map((k) => `${k}=${req.query[k]}`).join("&");
  }

  if (vary.length > 0) {
    for (const h of vary) {
      key += `|${h}=${req.headers[h.toLowerCase()] ?? ""}`;
    }
  }

  return key;
}

// ── buildRouteCacheMiddleware ──────────────────────────────────

/**
 * 构建路由级缓存中间件
 *
 * @param cacheOpts 规范化后的缓存配置（null 时返回 null，不构建中间件）
 * @param getStore  延迟获取 CacheStore 的工厂函数（避免在路由注册时 store 尚未就绪）
 * @returns VextMiddleware | null
 */
export function buildRouteCacheMiddleware(
  cacheOpts: RouteCacheOptions | null,
  getStore: () => CacheStore,
): VextMiddleware | null {
  if (!cacheOpts) return null;

  const {
    ttl,
    key: keyFn,
    condition,
    vary = [],
    cacheControl = true,
    tags = [],
  } = cacheOpts;

  const cacheMiddleware: VextMiddleware = async (req, res, next) => {
    // ── condition 检查 ───────────────────────────────────
    if (condition && !condition(req)) {
      res.setHeader("X-Cache", "MISS");
      await next();
      return;
    }

    // ── 生成缓存 key ────────────────────────────────────
    const cacheKey = keyFn ? keyFn(req) : defaultCacheKey(req, vary);

    // 空 key 跳过缓存
    if (!cacheKey) {
      await next();
      return;
    }

    // ── 查找缓存 ────────────────────────────────────────
    const store = getStore();
    const result = store.get(cacheKey);
    const cached: CacheEntry | null =
      result instanceof Promise ? await result : result;

    if (cached) {
      // ── HIT ───────────────────────────────────────────
      res.setHeader("X-Cache", "HIT");

      if (cacheControl) {
        const age = Math.floor((Date.now() - cached.cachedAt) / 1000);
        const remaining = Math.max(0, ttl - age);
        res.setHeader("Cache-Control", `public, max-age=${remaining}`);
      }

      res.json(cached.body, cached.statusCode);
      return; // 不调用 next → 跳过 validate + handler
    }

    // ── MISS ──────────────────────────────────────────────
    res.setHeader("X-Cache", "MISS");

    // 注册 _onSend 钩子：handler 执行 res.json() 时捕获原始 data
    res._onSend = (data: unknown, statusCode: number) => {
      // 排除 204 和非 2xx 响应
      if (statusCode === 204 || statusCode < 200 || statusCode >= 300) {
        return;
      }

      const entry: CacheEntry = {
        body: data,
        statusCode,
        cachedAt: Date.now(),
        tags,
      };

      const setResult = store.set(cacheKey, entry, ttl);
      // 如果 store.set 返回 Promise（外部存储），不 await（fire-and-forget）
      if (setResult instanceof Promise) {
        setResult.catch(() => {
          // 静默忽略写入失败
        });
      }
    };

    if (cacheControl) {
      res.setHeader("Cache-Control", `public, max-age=${ttl}`);
    }

    await next();
  };

  return cacheMiddleware;
}

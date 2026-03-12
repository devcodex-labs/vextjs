# 路由缓存

VextJS 提供声明式路由级响应缓存，通过路由选项的 `cache` 字段配置。缓存命中时跳过参数校验和 handler 执行，直接返回缓存的响应数据，显著提升热点接口性能。

## 基本用法

### 数字简写

最简配置，指定缓存秒数：

```typescript
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  // 缓存 60 秒
  app.get('/products', { cache: 60 }, async (req, res) => {
    const products = await db.getProducts();
    res.json(products);
  });
});
```

### 完整配置

```typescript
app.get('/products', {
  cache: {
    ttl: 120,                              // 缓存 120 秒
    vary: ['accept-language'],             // 不同语言分别缓存
    tags: ['products'],                    // 标签（用于批量失效）
    condition: (req) => !req.query.refresh, // 条件缓存
    cacheControl: true,                    // 设置 Cache-Control 头（默认 true）
  },
}, async (req, res) => {
  res.json(await db.getProducts());
});
```

### 显式禁用

```typescript
app.get('/realtime', { cache: false }, async (req, res) => {
  res.json({ timestamp: Date.now() });
});
```

## 配置选项

### RouteOptions.cache

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `ttl` | `number` | — | 缓存有效期（秒），必须 > 0 |
| `key` | `(req) => string` | 自动生成 | 自定义缓存 key 生成函数 |
| `condition` | `(req) => boolean` | — | 返回 `true` 时才走缓存逻辑 |
| `vary` | `string[]` | `[]` | Vary headers，不同值视为不同缓存条目 |
| `cacheControl` | `boolean` | `true` | 是否设置 `Cache-Control` 响应头 |
| `tags` | `string[]` | `[]` | 缓存标签（用于 `app.cache.invalidate(tag)` 批量失效） |
| `store` | `string` | `'memory'` | 存储适配器（Phase 1 仅支持 memory） |

### 全局配置 (config.cache)

```typescript
// src/config/default.ts
export default {
  cache: {
    enabled: true,       // 是否启用路由缓存（默认 true）
    defaultTtl: 60,      // 路由未指定 ttl 时的默认值（秒）
    maxEntries: 1000,    // LRU 最大缓存条目数
  },
};
```

## 缓存行为

### 响应头

| 头 | 值 | 说明 |
|------|------|------|
| `X-Cache` | `HIT` | 缓存命中 |
| `X-Cache` | `MISS` | 缓存未命中（首次请求或过期） |
| `Cache-Control` | `public, max-age=N` | MISS 时 N=TTL，HIT 时 N=剩余秒数 |

### 缓存 Key 算法

默认 key 格式：`${method}:${path}[?sortedQuery][|varyHeaders]`

```
GET /products                              → GET:/products
GET /products?limit=10&page=2              → GET:/products?limit=10&page=2
GET /products (Accept-Language: zh-CN)     → GET:/products|accept-language=zh-CN
```

- Query 参数自动排序（`?b=2&a=1` ≡ `?a=1&b=2`）
- 默认 key **不包含** Authorization / Cookie（安全设计）
- 需要按用户区分缓存时，使用自定义 `key` 函数

### 不缓存的场景

- `204 No Content` 响应
- 非 2xx 状态码（3xx / 4xx / 5xx）
- `cache: false` 显式禁用
- `cache: 0` 或负值
- `condition` 返回 `false`
- 自定义 `key` 返回空字符串

## 运行时 API

通过 `app.cache` 在路由 handler 中操作缓存：

```typescript
// 按标签批量失效
app.post('/products', {}, async (req, res) => {
  await db.createProduct(req.body);
  await app.cache.invalidate('products'); // 所有带 products 标签的缓存全部失效
  res.json({ created: true }, 201);
});

// 删除指定 key
await app.cache.delete('GET:/products');

// 清空所有缓存
await app.cache.clear();

// 查看统计
const stats = app.cache.stats();
// → { entries: 42, hits: 128, misses: 31, hitRate: 0.805 }
```

## Vary Headers

不同的请求头值会生成不同的缓存条目：

```typescript
app.get('/products', {
  cache: {
    ttl: 120,
    vary: ['accept-language'],
  },
}, handler);
```

```
GET /products (Accept-Language: zh-CN) → 独立缓存
GET /products (Accept-Language: en-US) → 独立缓存
```

## 条件缓存

通过 `condition` 函数控制是否走缓存逻辑：

```typescript
app.get('/data', {
  cache: {
    ttl: 60,
    // 带 refresh 参数时跳过缓存
    condition: (req) => !req.query.refresh,
  },
}, handler);
```

```bash
curl /data           # 走缓存
curl /data?refresh=1 # 跳过缓存，直接执行 handler
```

## 自定义 Key

需要按用户身份区分缓存时：

```typescript
app.get('/profile', {
  cache: {
    ttl: 300,
    key: (req) => `profile:${req.headers['x-user-id'] ?? 'anonymous'}`,
  },
}, handler);
```

## 安全注意事项

:::warning
**认证路由 + 缓存**：默认缓存 key 不包含用户身份信息。如果同时使用 `middlewares: ['auth']` 和 `cache`，不同用户可能命中相同缓存，导致数据泄露。

框架在启动时会检测此场景并发出警告。解决方案：
- 使用自定义 `key` 函数包含用户标识
- 使用 `condition` 排除已认证请求
:::

```typescript
// ✅ 正确：自定义 key 包含用户 ID
app.get('/my-orders', {
  middlewares: ['auth'],
  cache: {
    ttl: 60,
    key: (req) => `orders:${req.headers['x-user-id']}`,
  },
}, handler);

// ✅ 正确：已认证用户不走缓存
app.get('/products', {
  middlewares: ['auth'],
  cache: {
    ttl: 60,
    condition: (req) => !req.headers.authorization,
  },
}, handler);
```


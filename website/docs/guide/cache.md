# 响应缓存

VextJS 提供声明式路由级响应缓存，通过路由选项的 `cache` 字段配置。缓存命中时跳过参数校验和 handler 执行，直接返回已缓存的 JSON 响应。

## 基本用法

### 数字简写

最简配置，指定缓存有效期，单位为毫秒：

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // 缓存 60 秒
  app.get("/products", { cache: 60_000 }, async (req, res) => {
    const products = await db.getProducts();
    res.json(products);
  });
});
```

### 完整配置

```typescript
app.get(
  "/products",
  {
    cache: {
      ttl: 120_000, // 缓存 120 秒
      vary: ["accept-language"], // 不同语言分别缓存
      tags: ["products"], // 标签（用于批量失效）
      condition: (req) => !req.query.refresh, // 条件缓存
      cacheControl: true, // 设置 Cache-Control 头（默认 true）
    },
  },
  async (req, res) => {
    res.json(await db.getProducts());
  },
);
```

### 显式禁用

```typescript
app.get("/realtime", { cache: false }, async (req, res) => {
  res.json({ timestamp: Date.now() });
});
```

## 配置选项

### RouteOptions.cache

| 字段                      | 类型                        | 默认值   | 说明                                                            |
| ------------------------- | --------------------------- | -------- | --------------------------------------------------------------- |
| `ttl`                     | `number`                    | —        | 缓存有效期，单位毫秒，必须 > 0                                  |
| `key`                     | `string \| (req) => string` | 自动生成 | 自定义缓存 key；`partitionKey` 与 `vary` 仍会参与最终底层 key   |
| `condition`               | `(req) => boolean`          | —        | 返回 `true` 时才走缓存逻辑                                      |
| `vary`                    | `string[] \| "*"`           | `[]`     | 参与缓存 key 的请求头；`"*"` 表示所有请求头都参与               |
| `partitionKey`            | `string \| (req) => string` | —        | 用户、租户或其他业务分区，用于隔离带认证或多租户响应            |
| `allowAuthorizationCache` | `boolean`                   | `false`  | 没有 `partitionKey` 时，是否仍允许缓存带 `Authorization` 的请求 |
| `cacheControl`            | `boolean`                   | `true`   | 是否设置 `Cache-Control` 响应头                                 |
| `tags`                    | `string[]`                  | `[]`     | 缓存标签，用于 `app.cache.invalidate(tag)` 批量失效             |

### 全局配置 (config.cache)

```typescript
// src/config/default.ts
export default {
  cache: {
    enabled: true, // 是否启用路由级响应缓存（默认 true）
    defaultTtl: 60_000, // 路由未指定 ttl 时的默认值，单位毫秒
    maxEntries: 1000, // 最大缓存条目数
    maxMemory: 50 * 1024 * 1024, // 最大内存占用 bytes
  },
};
```

响应缓存运行时由 `response-cache-kit` 承接，底层缓存由 `cache-hub` 管理。Vext 只暴露上面的业务配置，不开放自定义 Store 配置。

## 缓存行为

默认只处理 GET / HEAD 请求，并捕获通过 `res.json()` 发送的成功响应。`res.text()`、流式响应、下载和重定向不会写入响应缓存。

### 响应头

| 头              | 值                  | 说明                                  |
| --------------- | ------------------- | ------------------------------------- |
| `X-Cache`       | `HIT`               | 缓存命中                              |
| `X-Cache`       | `MISS`              | 缓存未命中（首次请求或过期）          |
| `Cache-Control` | `public, max-age=N` | MISS 时 N=TTL 秒数，HIT 时 N=剩余秒数 |

### 缓存 Key 算法

默认 key 包含请求方法、路径、排序后的 query、`partitionKey` 和 `vary` 请求头。

```
GET /products                              → GET:/products
GET /products?limit=10&page=2              → GET:/products?limit=10&page=2
GET /products (Accept-Language: zh-CN)     → GET:/products|accept-language=zh-CN
```

- Query 参数自动排序（`?b=2&a=1` ≡ `?a=1&b=2`）
- 带 `Authorization` 的请求默认不缓存，除非配置了 `partitionKey` 或显式设置 `allowAuthorizationCache: true`
- 需要按用户或租户区分缓存时，优先使用 `partitionKey`
- 使用自定义 `key` 时，`partitionKey` 与 `vary` 仍会追加到底层 key 上

### 不缓存的场景

- `204 No Content` 响应
- 非 2xx 状态码（3xx / 4xx / 5xx）
- 响应包含 `Set-Cookie`
- 响应头包含 `Cache-Control: no-store` 或 `private`
- 请求头包含 `Cache-Control: no-store` 或 `no-cache`
- 带 `Authorization` 且未配置 `partitionKey` / `allowAuthorizationCache`
- 未通过 `res.json()` 发送的响应
- `cache: false` 显式禁用
- `cache: 0` 或负值
- `condition` 返回 `false`
- 自定义 `key` 返回空字符串

## 运行时 API

通过 `app.cache` 在路由 handler 中操作缓存：

```typescript
// 按标签批量失效
app.post("/products", {}, async (req, res) => {
  await db.createProduct(req.body);
  await app.cache.invalidate("products"); // 所有带 products 标签的缓存全部失效
  res.json({ created: true }, 201);
});

// 删除指定 key
await app.cache.delete("GET:/products");

// 清空所有缓存
await app.cache.clear();

// 查看统计
const stats = app.cache.stats();
// → { entries: 42, hits: 128, misses: 31, hitRate: 0.805 }
```

## Vary Headers

不同的请求头值会生成不同的缓存条目：

```typescript
app.get(
  "/products",
  {
    cache: {
      ttl: 120_000,
      vary: ["accept-language"],
    },
  },
  handler,
);
```

```
GET /products (Accept-Language: zh-CN) → 独立缓存
GET /products (Accept-Language: en-US) → 独立缓存
```

允许所有请求头都参与缓存 key：

```typescript
app.get("/debug", { cache: { ttl: 10_000, vary: "*" } }, handler);
```

`vary: "*"` 会显著增加缓存条目数量，通常只建议用于调试、代理透传或确实需要强隔离的接口。

## 条件缓存

通过 `condition` 函数控制是否走缓存逻辑：

```typescript
app.get(
  "/data",
  {
    cache: {
      ttl: 60_000,
      // 带 refresh 参数时跳过缓存
      condition: (req) => !req.query.refresh,
    },
  },
  handler,
);
```

```bash
curl /data           # 走缓存
curl /data?refresh=1 # 跳过缓存，直接执行 handler
```

## 自定义 Key

固定业务 key：

```typescript
app.get(
  "/products",
  {
    cache: {
      ttl: 60_000,
      key: "products:list",
      tags: ["products"],
    },
  },
  handler,
);
```

需要按请求参数生成 key 时：

```typescript
app.get(
  "/profile",
  {
    cache: {
      ttl: 300_000,
      key: (req) => `profile:${req.headers["x-user-id"] ?? "anonymous"}`,
    },
  },
  handler,
);
```

## Partition Key

`partitionKey` 是缓存分区。它不会改变业务响应，只会让底层缓存 key 按用户、租户、区域等维度隔离。

```typescript
app.get(
  "/tenant/products",
  {
    middlewares: ["auth"],
    cache: {
      ttl: 60_000,
      key: "tenant:products",
      partitionKey: (req) => req.headers["x-tenant-id"],
      tags: ["products"],
    },
  },
  handler,
);
```

上例中，即使多个租户访问同一个 URL，也会写入不同缓存分区。带 `Authorization` 的请求默认会绕过缓存；配置 `partitionKey` 后，Vext 才会允许它进入响应缓存。

如果你确认响应与用户无关，也可以显式开启：

```typescript
app.get(
  "/public-with-auth",
  {
    cache: {
      ttl: 60_000,
      allowAuthorizationCache: true,
    },
  },
  handler,
);
```

多数业务接口推荐使用 `partitionKey`，而不是直接打开 `allowAuthorizationCache`。

## 并发回源

同一个缓存 key 过期后，如果 100 个请求同时到达，Vext 会通过 `response-cache-kit` 的 single-flight 机制只执行一次 handler，其余请求等待同一份回源结果，避免缓存击穿。真正执行 handler 的请求是 `MISS`；等待并复用同一份结果的请求会输出 `HIT`。

## 安全注意事项

:::warning
**认证路由 + 缓存**：带 `Authorization` 的请求默认不会写入响应缓存。需要缓存认证接口时，请使用 `partitionKey` 明确隔离用户或租户。

框架在启动时会检测此场景并发出警告。解决方案：

- 使用 `partitionKey` 按用户/租户隔离
- 使用 `condition` 排除不应缓存的请求
- 只有确认响应与用户无关时，才设置 `allowAuthorizationCache: true`

:::

```typescript
// 推荐：使用 partitionKey 做租户隔离
app.get(
  "/my-orders",
  {
    middlewares: ["auth"],
    cache: {
      ttl: 60_000,
      partitionKey: (req) => req.headers["x-user-id"],
    },
  },
  handler,
);

// 也可以：已认证用户不走缓存
app.get(
  "/products",
  {
    middlewares: ["auth"],
    cache: {
      ttl: 60_000,
      condition: (req) => !req.headers.authorization,
    },
  },
  handler,
);
```

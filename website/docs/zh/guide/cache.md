# 响应缓存

VextJS 提供声明式路由级响应缓存，通过路由选项的 `cache` 字段配置。路由中间件和认证守卫先执行；缓存命中后跳过参数校验和 handler，返回缓存结果。适合允许短时陈旧的公开查询，不适合依靠每次 handler 执行产生副作用的接口。

本页以 JSON API 为主。`res.render()` 另有渲染缓存集成，见[渲染数据与缓存](/zh/frontend/render-data-and-cache)；不能把本页策略直接套用于任意 HTML、流式输出或个人数据。

## 两文件完整示例与验证

在[快速开始](/zh/guide/quick-start)创建的 API 项目中合并下面配置并新增路由。计数器仅用来观察 handler 是否执行；它保存在当前进程内，重启后清零，不是持久业务数据。

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  cache: { enabled: true, maxEntries: 100 },
} satisfies VextUserConfig;
```

```typescript
// src/routes/cache-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  let executions = 0;
  app.get(
    "/",
    {
      cache: {
        ttl: 60_000,
        tags: ["cache-demo"],
        vary: ["accept-language"],
        condition: (req) =>
          req.query.refresh === undefined && req.headers.cookie === undefined,
      },
    },
    (req, res) => {
      executions += 1;
      res.json({
        executions,
        language: req.headers["accept-language"] ?? "default",
      });
    },
  );
  app.post("/invalidate", {}, async (_req, res) => {
    await app.cache.invalidate("cache-demo");
    res.json({ invalidated: true });
  });
});
```

执行 `npm run dev` 后，在另一个终端按顺序请求；Windows PowerShell 可把 `curl` 换成 `curl.exe`：

```bash
curl -i http://127.0.0.1:3000/cache-demo
curl -i http://127.0.0.1:3000/cache-demo
curl -i -X POST http://127.0.0.1:3000/cache-demo/invalidate
curl -i http://127.0.0.1:3000/cache-demo
curl -i 'http://127.0.0.1:3000/cache-demo?refresh='
```

前两次都是 200，JSON 包装中的 `data.executions` 都是 1，头分别为 MISS/HIT。失效请求 200 且 `data.invalidated` 为 true；之后 GET 是 MISS、计数为 2；带 refresh 的请求跳过缓存，计数为 3。保持同一进程、在 60 秒内执行，才能按此顺序比较。

再用不同 `Accept-Language` 验证独立条目；交换同一组 query 参数的顺序应命中同一条目。此例的 Cookie 请求由显式 condition 绕过，Authorization 请求由默认请求策略绕过，不能用它们验证公开缓存命中。示例的失效端点只用于本地演示，业务部署应加权限检查。

开发流程通过后，停止开发进程，再执行 `npm run build -- --typecheck` 和 `npm start`，重复以上请求。生产进程的计数重新从 0 开始；不要同时启动两个占用 3000 端口的进程。

## 基本用法

以下 `db`、`handler` 为业务代码占位，片段用于说明各项配置，不能单独启动。首次验证请使用上面的完整示例。

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
      condition: (req) => req.query.refresh === undefined, // 出现 refresh 参数即跳过
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

| 字段                      | 类型                                             | 默认值   | 说明                                                            |
| ------------------------- | ------------------------------------------------ | -------- | --------------------------------------------------------------- |
| `ttl`                     | `number`                                         | —        | 缓存有效期，单位毫秒，必须 > 0                                  |
| `key`                     | `string \| (req) => string`                      | 自动生成 | 自定义缓存 key；`partitionKey` 与 `vary` 仍会参与最终底层 key   |
| `condition`               | `(req) => boolean`                               | —        | 返回 `true` 时才走缓存逻辑                                      |
| `vary`                    | `string[] \| "*"`                                | `[]`     | 参与缓存 key 的请求头；`"*"` 表示所有请求头都参与               |
| `partitionKey`            | `string \| (req) => string \| null \| undefined` | —        | 可信用户、租户等分区；函数可返回空值，须配合 condition 处理     |
| `allowAuthorizationCache` | `boolean`                                        | `false`  | 没有 `partitionKey` 时，是否仍允许缓存带 `Authorization` 的请求 |
| `allowCookieCache`        | `boolean`                                        | `false`  | 控制带 Cookie 回源结果能否写入；已有缓存读取限制见下文          |
| `cacheControl`            | `boolean`                                        | `true`   | 是否设置 `Cache-Control` 响应头                                 |
| `tags`                    | `string[]`                                       | `[]`     | 缓存标签，用于 `app.cache.invalidate(tag)` 批量失效             |

### 全局配置 (config.cache)

`config.cache` 控制整个应用的响应缓存运行时。路由是否缓存仍由每条路由的 `RouteOptions.cache` 决定。

```typescript
// 合并到 src/config/default.ts 的配置片段
export default {
  cache: {
    enabled: true, // 是否启用路由级响应缓存（默认 true）
    defaultTtl: 60_000, // 运行时 TTL 兜底，类型化的路由对象仍应显式填写 ttl
    maxEntries: 1000, // Memory 快捷配置：最大缓存条目数
    maxMemory: 50 * 1024 * 1024, // Memory 快捷配置：最大内存占用 bytes
    cleanupInterval: 30_000, // Memory 快捷配置：周期清理间隔，0 表示只做惰性清理
  },
};
```

响应缓存运行时由 `response-cache-kit` 承接，底层缓存由 `cache-hub` 管理。Vext 不为响应缓存开放自定义 Store；需要调整底层运行时，请配置 `cache.cacheHub`。Session Store 是独立链路，请使用带独立 prefix 的 `createCacheSessionStore(cacheLike)`，不要复用 `app.cache` 或 `config.cache.cacheHub`。

#### config.cache 字段

| 字段              | 类型      | 默认值  | 说明                                                                                      |
| ----------------- | --------- | ------- | ----------------------------------------------------------------------------------------- |
| `enabled`         | `boolean` | `true`  | 是否启用路由级响应缓存。设为 `false` 后不安装缓存中间件，也不会打开 Redis/MultiLevel 连接 |
| `defaultTtl`      | `number`  | `60000` | 运行时兜底 TTL；TypeScript 的路由缓存对象仍要求 `ttl`                                     |
| `maxEntries`      | `number`  | `1000`  | Memory 模式快捷配置，`cacheHub` 未配置或为 Memory 时生效                                  |
| `maxMemory`       | `number`  | —       | Memory 模式快捷配置，最大内存占用 bytes                                                   |
| `cleanupInterval` | `number`  | `0`     | Memory 模式快捷配置，周期清理间隔；`0` 表示只在访问时惰性清理                             |
| `cacheHub`        | `object`  | Memory  | 底层运行时配置：Memory、Redis、MultiLevel、lease、distributed                             |

#### Memory cacheHub

`cache: { ttl: 60_000 }` 的 `ttl` 在公开类型中必填。当前运行时对对象中缺失或为 `0` 的 TTL 会尝试应用全局兜底，所以 **`cache: { ttl: 0 }` 不能可靠地禁用缓存**；请用 `cache: false` 或数字形式 `cache: 0`。Memory 模式下 `cacheHub` 的同名字段覆盖外层快捷配置。

```typescript
export default {
  cache: {
    defaultTtl: 60_000,
    cacheHub: {
      mode: "memory",
      maxEntries: 1000,
      maxMemory: 50 * 1024 * 1024,
      cleanupInterval: 30_000,
      enableStats: true,
    },
  },
};
```

| 字段              | 类型       | 默认值     | 说明                       |
| ----------------- | ---------- | ---------- | -------------------------- |
| `mode`            | `"memory"` | `"memory"` | 使用进程内 Memory 缓存     |
| `maxEntries`      | `number`   | `1000`     | 最大条目数                 |
| `maxMemory`       | `number`   | —          | 最大内存占用 bytes         |
| `cleanupInterval` | `number`   | `0`        | 周期清理间隔，单位毫秒     |
| `enableStats`     | `boolean`  | `true`     | 是否记录统计信息           |
| `enabled`         | `boolean`  | `true`     | 底层 Memory Store 是否启用 |

#### Redis cacheHub

```typescript
export default {
  cache: {
    defaultTtl: 2_000,
    cacheHub: {
      mode: "redis",
      url: "redis://localhost:6379",
      deleteCommand: "unlink",
      lease: {
        waitForOwner: 1_000,
        onTimeout: "fetch",
      },
      distributed: {
        redisUrl: "redis://localhost:6379",
        channel: "vext:response-cache",
      },
    },
  },
};
```

Redis 模式适合多实例共享响应缓存。使用 Redis URL 创建连接时，业务项目需要安装 `ioredis`：

```bash
npm install ioredis
```

| 字段            | 类型                | 默认值                   | 说明                             |
| --------------- | ------------------- | ------------------------ | -------------------------------- |
| `mode`          | `"redis"`           | 必填                     | 使用 Redis 存储响应快照          |
| `url`           | `string`            | `redis://localhost:6379` | Redis URL                        |
| `client`        | `object`            | —                        | 已有 Redis-like client，高级用法 |
| `metaKeyPrefix` | `string`            | cache-hub 默认值         | tag 元数据 key 前缀              |
| `scanCount`     | `number`            | cache-hub 默认值         | SCAN 批量大小                    |
| `deleteCommand` | `"del" \| "unlink"` | `del`                    | 删除命令；大值建议 `unlink`      |
| `lease`         | `boolean \| object` | `false`                  | 跨进程同 key 回源协调            |
| `distributed`   | `boolean \| object` | `false`                  | 分布式 pattern/tag 失效广播      |

响应缓存按 `client` → `url` → `redis://localhost:6379` 选择 Redis 目标，不会自动读取 `VEXT_REDIS_URL` / `REDIS_URL`。传入已有 `client` 时，其连接生命周期由提供方管理；由 URL 创建的连接在应用关闭时由框架关闭。

当前 Vext 响应缓存 namespace 固定为 `vext-route-cache`，没有公开的 `config.cache.namespace`。不同应用或环境应使用独立 Redis 数据库或实例；只改 `metaKeyPrefix`、广播 `channel` 或个别路由 key，不等于隔离所有响应条目和 `clear()` 的范围。

#### MultiLevel cacheHub

```typescript
export default {
  cache: {
    defaultTtl: 60_000,
    cacheHub: {
      mode: "multi-level",
      memory: {
        maxEntries: 1000,
        cleanupInterval: 30_000,
      },
      redis: {
        url: "redis://localhost:6379",
      },
      writePolicy: "both",
      backfillOnRemoteHit: true,
      remoteTimeout: 50,
      lease: true,
    },
  },
};
```

MultiLevel 使用本进程 Memory 作为 L1、Redis 作为 L2，适合希望降低 Redis 读取压力但仍需要跨进程共享缓存的服务。

| 字段                       | 类型                                   | 默认值   | 说明                                                         |
| -------------------------- | -------------------------------------- | -------- | ------------------------------------------------------------ |
| `mode`                     | `"multi-level"`                        | 必填     | 启用 L1 Memory + L2 Redis                                    |
| `memory`                   | `object`                               | `{}`     | L1 Memory 配置                                               |
| `redis`                    | `object`                               | `{}`     | L2 Redis 配置                                                |
| `writePolicy`              | `"both" \| "local-first-async-remote"` | `both`   | 写入策略                                                     |
| `backfillOnRemoteHit`      | `boolean`                              | `true`   | L2 命中后是否回填 L1                                         |
| `remoteTimeout`            | `number`                               | `50`     | L2 get/exists/getMany 等读取等待上限，毫秒；不覆盖写入和失效 |
| `remoteInvalidationErrors` | `"ignore" \| "throw"`                  | `ignore` | L2 批量/标签失效错误处理；单 key delete 的 L2 错误仍忽略     |
| `lease`                    | `boolean \| object`                    | `false`  | 使用 Redis 层做跨进程回源协调                                |
| `distributed`              | `boolean \| object`                    | `false`  | 分布式失效广播                                               |

#### lease 与 distributed

`lease` 用于降低多进程缓存击穿：同一个 key 过期后，一个进程获得 lease 并执行 handler，其它进程短暂等待缓存被写入。等待超时默认继续回源，优先保证可用性。

下面两段是 `cache.cacheHub`（Redis 或 MultiLevel 模式）内部字段片段。lease 使用缓存的 Redis 层；它不负责使其他进程的 L1 条目失效。

```typescript
lease: {
  ttl: 500,
  waitForOwner: 1_000,
  pollInterval: 10,
  onTimeout: "fetch", // 或 "throw"
}
```

`distributed` 用于把 `app.cache.invalidate(tag)`、`app.cache.clear()` 这类失效动作广播到其它实例：

```typescript
distributed: {
  redisUrl: "redis://localhost:6379",
  channel: "vext:response-cache",
  // 省略 instanceId，让运行时为每个实例生成唯一标识
}
```

`distributed` 的连接独立选择 `redis` 或 `redisUrl`，不会继承外层 `cacheHub.client/url` 或 `cacheHub.redis.url`；两者都未填时仍使用 localhost:6379。配置远端 Redis 时必须同步核对广播地址。若手动填写 `instanceId`，各实例必须不同，否则会把其他实例的消息当作自身消息忽略。

`invalidate(tag)` / `clear()` 先完成当前实例失效，再发布消息；返回不表示所有订阅者已处理完毕。`app.cache.delete(key)` 不广播，MultiLevel 下其他实例的 L1 可能保留旧值直到过期。需要一组实例同步失效时，使用标签及正确配置的 distributed；广播不是强一致事务。

## 缓存行为

默认只处理 GET / HEAD 请求，并捕获通过 `res.json()` 发送的成功响应（2xx 中排除 204）。`res.render()` 的专用缓存路径见前端指南；普通 `res.text()`、流式响应、下载和重定向不通过 JSON 缓存路径写入。

### 响应头

| 头              | 值                  | 说明                                             |
| --------------- | ------------------- | ------------------------------------------------ |
| `X-Cache`       | `HIT`               | 已有条目命中或并发复用，不保证已写入存储         |
| `X-Cache`       | `MISS`              | 未命中或部分绕过缓存的请求，不代表一定写入了缓存 |
| `Cache-Control` | `public, max-age=N` | MISS 时 N=TTL 秒数，HIT 时 N=剩余秒数            |

以上头只适用于进入相应缓存流程的响应。`cacheControl: false` 关闭自动生成 `public` 头，不关闭服务器缓存，也不会删除业务代码主动设置的头。业务响应已有 `private` / `no-store` 时不会写入服务器缓存。

`partitionKey` 只隔离服务器缓存，不能隔离浏览器、代理或 CDN。个性化响应必须另行确定 HTTP 缓存策略；不要因为配置了分区就接受默认 `public`。`private` / `no-store` 会阻止响应写入存储，但不能作为阻止并发复用的唯一措施，见[并发回源](#并发回源)。

### 缓存 Key 算法

当前实际存储路径使用底层 `createVextLegacyKey`：方法、规范化 URL，再追加分区和 vary 请求头。源码中的 `defaultCacheKey()` 虽然生成版本化 JSON tuple，但该值目前用于流程中的 key/Hook 记录，不能据此当作实际存储 key 删除。请优先按标签失效，避免绑定内部 key 格式。

```
GET /products                              → GET:/products
GET /products?limit=10&page=2              → GET:/products?limit=10&page=2
GET /products (Accept-Language: zh-CN)     → GET:/products|accept-language=zh-CN
```

- Query 参数自动排序（`?b=2&a=1` ≡ `?a=1&b=2`）
- 带 `Authorization` 的请求默认不缓存，除非配置了 `partitionKey` 或显式设置 `allowAuthorizationCache: true`
- 带 `Cookie` 的回源结果默认不写入；已有缓存读取存在下面说明的限制
- 需要按用户或租户区分缓存时，优先使用 `partitionKey`
- 使用自定义 `key` 时，`partitionKey` 与 `vary` 仍会追加到底层 key 上

:::warning Cookie 读取限制
当前实现中，`allowCookieCache: false` 在回源时阻止写入，但不会阻止带 Cookie 的请求读取已存在的公开缓存。验证顺序必须包含“匿名请求填充缓存 → 带 Cookie 请求”，不能只测冷缓存。需要完全绕过 Cookie 请求时，请显式配置 `condition: (req) => req.headers.cookie === undefined`，或直接禁用该路由缓存。开头的完整示例已加入此条件。
:::

### 不缓存的场景

以下清单包含前置绕过与响应不写入两类情况。“不写入”不保证当前并发请求不会共享结果，见[并发回源](#并发回源)。

- `204 No Content` 响应
- 非 2xx 状态码（3xx / 4xx / 5xx）
- 响应包含 `Set-Cookie`
- 响应头包含 `Cache-Control: no-store` 或 `private`
- 请求头包含 `Cache-Control: no-store` 或 `no-cache`
- 带 `Authorization` 且未配置 `partitionKey` / `allowAuthorizationCache`
- 带 `Cookie` 且未配置 `allowCookieCache` 的回源结果（不保证绕过已有条目）
- 未经过 JSON 或专用渲染缓存捕获路径的响应
- Session 有待提交变更，导致当前响应禁止存储
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

// 删除指定默认 key
await app.cache.delete("GET:/products");

// 清空所有缓存
await app.cache.clear();

// 查看统计
const stats = app.cache.stats();
// → { entries: 42, hits: 128, misses: 31, hitRate: 0.805 }
```

`app.cache.clear()` 清理当前 vext 响应缓存 namespace。Redis/MultiLevel 模式下它不会执行 Redis 全库清空，但共享同一数据库的 Vext 应用仍可能互相影响。Memory 缓存和统计以当前运行实例为范围，cluster 不会自动汇总各 worker 的内存统计；上面的统计数值仅为示意。

`delete()` 需要准确的最终 key：带 query、vary、partition 或自定义 key 时不能照抄无参数示例。涉及一组变体时优先使用标签失效。先完成业务写入，再失效对应标签；这两个动作不是自动组成的数据库事务，失败和并发回填策略需由业务处理。

Redis 适配器的 `stats()` 当前返回全零占位，不代表 Redis 中没有缓存；MultiLevel 返回本进程 L1 统计，不是 L1+L2 或集群汇总。判断实际复用情况时还应区分已有条目命中与并发复用。

### 存储失败边界

- 缓存读取异常按未命中处理；写入异常不会改成一份新的业务错误响应，但该次写入不成功，不能仅凭 `X-Cache: MISS` 或 `cache:write` 判断已存储。
- MultiLevel 的 `remoteTimeout` 不包含写入、失效或回填 TTL 查询；`writePolicy: "both"` 等待 L2 写入，`local-first-async-remote` 在写入 L1 后异步写 L2，远端失败可能留下不一致。
- Redis 删除/标签失效及广播发布可能抛错。MultiLevel 单 key 删除忽略 L2 错误，批量/标签失效按 `remoteInvalidationErrors` 处理；调用成功不能一概证明每个副本已失效。
- `lease.onTimeout: "fetch"` 只控制等待持有者超时后的策略，不代表获取 lease 的连接错误也会自动回源。不要把缓存的所有故障都假定为透明降级。

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

`vary: "*"` 会显著增加缓存条目数量，应优先列出确实影响正文的请求头。它不替代认证、权限校验或可信分区。

## 条件缓存

通过 `condition` 函数控制是否走缓存逻辑：

```typescript
app.get(
  "/data",
  {
    cache: {
      ttl: 60_000,
      // 带 refresh 参数时跳过缓存
      condition: (req) => req.query.refresh === undefined,
    },
  },
  handler,
);
```

```bash
curl http://localhost:3000/data           # 走缓存
curl 'http://localhost:3000/data?refresh=' # 即使值为空也跳过缓存
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
  "/products",
  {
    cache: {
      ttl: 300_000,
      key: (req) => JSON.stringify(["products", req.query.category ?? "all"]),
    },
  },
  handler,
);
```

自定义 key 会替换默认的 method/path/query 组合，只有分区和 vary 仍会追加。上面的自定义函数仅适用于内容只受 category 影响的列表；若有分页、排序等参数，也必须纳入 key，否则不同请求会错误共享结果。通常保留默认 key 更合适。

## Partition Key

`partitionKey` 是缓存分区。它不会改变业务响应，只会让底层缓存 key 按用户、租户、区域等维度隔离。

```typescript
app.get(
  "/tenant/products",
  {
    cache: {
      ttl: 60_000,
      key: "tenant:products",
      condition: (req) =>
        typeof req.auth?.claims.tenantId === "string" &&
        req.auth.claims.tenantId.length > 0,
      partitionKey: (req) =>
        typeof req.auth?.claims.tenantId === "string"
          ? encodeURIComponent(req.auth.claims.tenantId)
          : undefined,
      cacheControl: false,
      tags: ["products"],
    },
    middlewares: ["auth"],
    auth: { required: true, security: "bearerAuth" },
  },
  handler,
);
```

上例是局部配置：须先按[认证指南](/zh/guide/security)注册 `auth` 中间件，由认证逻辑校验凭据并填充可信的 `claims.tenantId`，且该租户内所有访问者确实可看到同一份列表。不能直接信任客户端的 `x-tenant-id` / `x-user-id`。分区值编码后参与 key，缺少可信租户时 `condition` 禁止走缓存；带 `Authorization` 的请求必须取得非空分区，或显式允许，才具备缓存资格。

此处关闭自动 `public` 头；部署时仍须确认代理不会自行缓存个人或租户响应。认证和权限检查必须位于缓存之前。仅声明 `partitionKey` 不会替你认证、授权，也不会验证响应是否确实属于该分区。

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

同一进程内、通过前置请求策略且相同最终 key 的并发请求，通过 `response-cache-kit` 的 single-flight 合并回源；复用结果的等待请求输出 `HIT`，实际回源请求输出 `MISS`。前置绕过、回源失败及不同 worker/实例会改变执行次数。跨进程需另配 lease；租约过期或 `onTimeout: "fetch"` 仍可能多次回源，不能用于保证业务操作恰好执行一次。

:::warning 不写入存储不等于不共享并发结果
当前实现会合并同 key 的在途回源，即使最终响应因为 `private`、`no-store` 或 `Set-Cookie` 没有写入存储，等待请求仍可能得到第一份正文且显示 `HIT`。默认 `cacheControl: true` 下，这类等待响应还可能丢失原有的 `private` / `no-store` 头；首个响应的 `Set-Cookie` 不会被重放。

因此，私有数据、创建/修改会话或要求每次独立执行的接口，应使用 `cache: false`，或在进入缓存前用 `condition` 明确排除。不能只在 handler 中设置响应头来阻止本次并发共享。开头示例只返回可共享的演示数据，并在前置条件中排除 Cookie。
:::

缓存 Hooks 适合追踪流程，但当前 `cache:miss` 在底层查找前发出，最终 HIT 也可能先收到它；`cache:write` 表示捕获响应，不代表底层写入已成功。统计实际命中应结合最终响应和运行时统计，不能直接把事件次数当作准确的命中率。

## 安全注意事项

:::warning
**认证路由 + 缓存**：带 `Authorization` 的请求默认不会写入响应缓存。需要缓存认证接口时，请使用 `partitionKey` 明确隔离用户或租户。

框架在路由声明 auth 或名称包含 auth 的中间件并开启缓存、且未声明分区或授权缓存选项时可发出警告。警告不能证明身份来源可信，也不能代替隔离验证。选择策略：

- 使用 `partitionKey` 按用户/租户隔离
- 使用 `condition` 排除不应缓存的请求
- 只有确认响应与用户无关时，才设置 `allowAuthorizationCache: true`

:::

```typescript
// 局部示例：auth 必须先校验凭据并写入可信 subject
app.get(
  "/my-orders",
  {
    cache: {
      ttl: 60_000,
      condition: (req) => Boolean(req.auth?.subject),
      partitionKey: (req) =>
        req.auth?.subject ? encodeURIComponent(req.auth.subject) : undefined,
      cacheControl: false,
    },
    middlewares: ["auth"],
    auth: { required: true, security: "bearerAuth" },
  },
  handler,
);
```

若接口同时支持匿名与已登录访问，可以在前置中间件可靠建立身份后，使用 `condition: (req) => !req.auth?.isAuthenticated && req.headers.cookie === undefined && !req.headers.authorization` 只缓存匿名请求；如果接口强制登录，这个条件将导致所有成功请求都不使用缓存，此时直接 `cache: false` 更清楚。

## 排错与检查

| 现象                     | 核对与处理                                                                             | 复验                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 总是 MISS                | 检查全局 enabled、TTL、请求认证/Cookie/Cache-Control、condition、响应状态及 Set-Cookie | 用无 Cookie 的 curl 重复请求公开示例                 |
| 更改参数却返回旧结果     | 检查自定义 key 是否遗漏分页、筛选、身份等维度                                          | 对不同输入分别请求并检查正文                         |
| `{ ttl: 0 }` 仍缓存      | 对象 TTL 可能被全局默认值补上                                                          | 改为 `cache: false` 后确认每次 handler 都执行        |
| 修改数据后仍命中         | 检查写入是否成功、失效标签是否一致、是否跨进程使用 Memory                              | 失效后检查 MISS，再检查下一次 HIT                    |
| 租户之间串数据           | 检查可信身份来源、非空分区、自定义 key 和共享 Redis 范围                               | 使用两套经过校验的身份分别验证，不伪造身份头代替认证 |
| CDN 返回了其他用户的数据 | 服务器分区不控制外部共享缓存                                                           | 关闭该接口共享缓存，核查实际 HTTP 头与代理策略       |

继续阅读：[中间件顺序](/zh/guide/middleware)、[Hooks](/zh/guide/hooks)、[Cookie 与 Session](/zh/guide/cookies-session)、[路由 API](/zh/api/route-definition)。

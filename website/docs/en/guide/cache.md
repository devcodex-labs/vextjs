# Response caching

VextJS provides declarative route-level response caching through the `cache` route option. Route middleware and the authentication Guard run first; on a cache hit, parameter validation and the handler are skipped and the cached result is returned. This suits public queries that tolerate brief staleness, not endpoints whose handlers must execute side effects every time.

This page focuses on JSON APIs. `res.render()` has separate render-cache integration; see [Render Data and Cache](/frontend/render-data-and-cache). Do not apply these settings uncritically to arbitrary HTML, streams, or personal data.

## Complete two-file example and verification

In the API project from [Quick Start](/guide/quick-start), merge the following configuration and add the route. The counter only shows when the handler executes; it lives in one process and resets on restart, so it is not persistent business data.

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

After `npm run dev`, send these requests in order from another terminal. On Windows PowerShell, use `curl.exe`:

```bash
curl -i http://127.0.0.1:3000/cache-demo
curl -i http://127.0.0.1:3000/cache-demo
curl -i -X POST http://127.0.0.1:3000/cache-demo/invalidate
curl -i http://127.0.0.1:3000/cache-demo
curl -i 'http://127.0.0.1:3000/cache-demo?refresh='
```

The first two requests return 200 with `data.executions: 1` and MISS/HIT headers respectively. Invalidation returns 200 with `data.invalidated: true`; the next GET is a MISS with count 2; the refresh request bypasses cache and has count 3. Use the same process and finish within 60 seconds to compare this sequence.

Try different `Accept-Language` values to verify separate entries; swapping the order of identical query parameters should hit the same entry. Cookie requests bypass this example through its condition, while Authorization requests bypass by default request policy, so they do not demonstrate public cache hits. The invalidation endpoint is for local demonstration only; protect it in a business deployment.

After development verification, stop dev, run `npm run build -- --typecheck` and `npm start`, and repeat the requests. The production process starts its counter from zero. Do not run two services on port 3000 at the same time.

## Basic usage

The `db` and `handler` references below stand for application code. These snippets explain options and cannot start on their own. Use the complete example above for first verification.

### Numeric abbreviation

The simplest configuration, specifying the cache validity period in milliseconds:

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // cache for 60 seconds
  app.get("/products", { cache: 60_000 }, async (req, res) => {
    const products = await db.getProducts();
    res.json(products);
  });
});
```

### Complete configuration

```typescript
app.get(
  "/products",
  {
    cache: {
      ttl: 120_000, // cache for 120 seconds
      vary: ["accept-language"], // Different languages are cached separately
      tags: ["products"], // Tags (for batch invalidation)
      condition: (req) => req.query.refresh === undefined, // bypass when refresh is present
      cacheControl: true, // Set Cache-Control (default true)
    },
  },
  async (req, res) => {
    res.json(await db.getProducts());
  },
);
```

### Explicitly disable

```typescript
app.get("/realtime", { cache: false }, async (req, res) => {
  res.json({ timestamp: Date.now() });
});
```

## Configuration options

### RouteOptions.cache

| Field                     | Type                                             | Default Value           | Description                                                                                               |
| ------------------------- | ------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `ttl`                     | `number`                                         | —                       | Cache validity period, in milliseconds, must be > 0                                                       |
| `key`                     | `string \| (req) => string`                      | Automatically generated | Custom cache key; `partitionKey` and `vary` will still participate in the final underlying key            |
| `condition`               | `(req) => boolean`                               | —                       | The caching logic is only used when `true` is returned                                                    |
| `vary`                    | `string[] \| "*"`                                | `[]`                    | Request headers that participate in caching key; `"*"` means that all request headers are involved        |
| `partitionKey`            | `string \| (req) => string \| null \| undefined` | —                       | Trusted user/tenant partition; handle an empty result with `condition`                                    |
| `allowAuthorizationCache` | `boolean`                                        | `false`                 | Whether to still allow caching of requests with `Authorization` when there is no `partitionKey`           |
| `allowCookieCache`        | `boolean`                                        | `false`                 | Whether a Cookie-bearing origin result can be written; reading existing entries has separate limits below |
| `cacheControl`            | `boolean`                                        | `true`                  | Whether to set the `Cache-Control` response header                                                        |
| `tags`                    | `string[]`                                       | `[]`                    | Cache tag, used for `app.cache.invalidate(tag)` batch invalidation                                        |

### Global configuration (config.cache)

`config.cache` controls the response caching runtime for the entire application. Whether a route is cached is still determined by each route's `RouteOptions.cache`.

```typescript
// src/config/default.ts
export default {
  cache: {
    enabled: true, // Whether to enable route-level response caching (default true)
    defaultTtl: 60_000, // Runtime TTL fallback; typed route objects should still specify ttl
    maxEntries: 1000, // Memory quick configuration: maximum number of cache entries
    maxMemory: 50 * 1024 * 1024, // Memory quick configuration: maximum memory usage bytes
    cleanupInterval: 30_000, // Memory quick configuration: periodic cleaning interval, 0 means only lazy cleaning
  },
};
```

The response cache runtime is handled by `response-cache-kit`, and the underlying cache is managed by `cache-hub`. Vext does not open custom Store for response cache; if you need to adjust the underlying runtime, please configure `cache.cacheHub`. Session Store is separate: use `createCacheSessionStore(cacheLike)` with its own prefix instead of reusing `app.cache` or `config.cache.cacheHub`.

#### config.cache field

| Field             | Type      | Default Value | Description                                                                                                                                                            |
| ----------------- | --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`         | `boolean` | `true`        | Whether to enable route-level response caching. When set to `false`, the cache middleware will not be installed and the Redis/MultiLevel connection will not be opened |
| `defaultTtl`      | `number`  | `60000`       | Runtime TTL fallback; typed route cache objects still require `ttl`                                                                                                    |
| `maxEntries`      | `number`  | `1000`        | Memory mode quick configuration, effective when `cacheHub` is not configured or is Memory                                                                              |
| `maxMemory`       | `number`  | —             | Memory mode quick configuration, maximum memory usage bytes                                                                                                            |
| `cleanupInterval` | `number`  | `0`           | Memory mode quick configuration, periodic cleaning interval; `0` means lazy cleaning only during access                                                                |
| `cacheHub`        | `object`  | Memory        | Underlying runtime configuration: Memory, Redis, MultiLevel, lease, distributed                                                                                        |

#### Memory cacheHub

`ttl` is required in the public type for `cache: { ttl: 60_000 }`. At runtime a missing or zero object TTL may be filled by the global fallback, so **`cache: { ttl: 0 }` does not reliably disable caching**. Use `cache: false` or numeric `cache: 0`. In Memory mode, matching fields inside `cacheHub` override the outer convenience settings.

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

| Field             | Type       | Default Value | Description                                    |
| ----------------- | ---------- | ------------- | ---------------------------------------------- |
| `mode`            | `"memory"` | `"memory"`    | Use in-process Memory cache                    |
| `maxEntries`      | `number`   | `1000`        | Maximum number of entries                      |
| `maxMemory`       | `number`   | —             | Maximum memory usage bytes                     |
| `cleanupInterval` | `number`   | `0`           | Periodic cleanup interval, in milliseconds     |
| `enableStats`     | `boolean`  | `true`        | Whether to record statistical information      |
| `enabled`         | `boolean`  | `true`        | Whether the underlying Memory Store is enabled |

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

Redis mode is suitable for multiple instances to share response cache. When enabling Redis/MultiLevel in a business project, `ioredis` needs to be installed:

```bash
npm install ioredis
```

| Field           | Type                | Default Value            | Description                                            |
| --------------- | ------------------- | ------------------------ | ------------------------------------------------------ |
| `mode`          | `"redis"`           | Required                 | Use Redis to store response snapshots                  |
| `url`           | `string`            | `redis://localhost:6379` | Redis URL                                              |
| `client`        | `object`            | —                        | Existing Redis-like client, advanced usage             |
| `metaKeyPrefix` | `string`            | cache-hub default value  | tag metadata key prefix                                |
| `scanCount`     | `number`            | cache-hub default value  | SCAN batch size                                        |
| `deleteCommand` | `"del" \| "unlink"` | `del`                    | Delete command; large value recommended `unlink`       |
| `lease`         | `boolean \| object` | `false`                  | Cross-process coordination with key back to the source |
| `distributed`   | `boolean \| object` | `false`                  | Distributed pattern/tag invalidation broadcast         |

Response caching chooses its Redis target by `client` → `url` → `redis://localhost:6379`; it does not automatically read `VEXT_REDIS_URL` or `REDIS_URL`. A supplied client is owned by its caller; the framework closes a connection it creates from a URL at app shutdown.

The current Vext response-cache namespace is fixed as `vext-route-cache`; there is no public `config.cache.namespace`. Separate applications or environments should use separate Redis databases or instances. Changing `metaKeyPrefix`, broadcast channel, or one route key does not isolate every response entry or the scope of `clear()`.

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

MultiLevel uses the memory of this process as L1 and Redis as L2. It is suitable for services that want to reduce the reading pressure of Redis but still need to share the cache across processes.

| Field                      | Type                                   | Default Value | Description                                                                                  |
| -------------------------- | -------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `mode`                     | `"multi-level"`                        | Required      | Enable L1 Memory + L2 Redis                                                                  |
| `memory`                   | `object`                               | `{}`          | L1 Memory configuration                                                                      |
| `redis`                    | `object`                               | `{}`          | L2 Redis configuration                                                                       |
| `writePolicy`              | `"both" \| "local-first-async-remote"` | `both`        | Write policy                                                                                 |
| `backfillOnRemoteHit`      | `boolean`                              | `true`        | Whether to backfill L1 after L2 hits                                                         |
| `remoteTimeout`            | `number`                               | `50`          | L2 get/exists/getMany read wait limit in milliseconds; does not cover writes or invalidation |
| `remoteInvalidationErrors` | `"ignore" \| "throw"`                  | `ignore`      | L2 batch/tag invalidation handling; L2 single-key delete errors are still ignored            |
| `lease`                    | `boolean \| object`                    | `false`       | Use the Redis layer for cross-process back-to-source coordination                            |
| `distributed`              | `boolean \| object`                    | `false`       | Distributed failure broadcast                                                                |

#### lease and distributed

`lease` is used to reduce multi-process cache breakdown: after the same key expires, one process obtains the lease and executes the handler, and other processes wait briefly for the cache to be written. By default, the system continues to return to the source after waiting timeout, with priority given to ensuring availability.

The following fragments are fields inside `cache.cacheHub` in Redis or MultiLevel mode. Lease uses the cache's Redis layer; it does not invalidate other processes' L1 entries.

```typescript
lease: {
  ttl: 500,
  waitForOwner: 1_000,
  pollInterval: 10,
  onTimeout: "fetch", // or "throw"
}
```

`distributed` is used to broadcast invalidation actions such as `app.cache.invalidate(tag)` and `app.cache.clear()` to other instances:

```typescript
distributed: {
  redisUrl: "redis://localhost:6379",
  channel: "vext:response-cache",
  // Omit instanceId so the runtime assigns a unique ID per instance.
}
```

The distributed connection chooses `redis` or `redisUrl` independently; it does not inherit outer `cacheHub.client/url` or `cacheHub.redis.url`, and defaults to localhost:6379 when neither is supplied. Check the broadcast address when using remote Redis. If you set `instanceId` manually, every instance needs a different value or it may ignore another instance's message as its own.

`invalidate(tag)` and `clear()` invalidate the local instance before publishing. Return does not mean every subscriber has processed the message. `app.cache.delete(key)` is not broadcast, so another instance's MultiLevel L1 may retain the old value until expiry. Use tags and correctly configured distributed invalidation when coordinating a group; broadcast is not a strongly consistent transaction.

## Caching behavior

By default, only GET/HEAD requests are processed, and successful 2xx responses sent with `res.json()` are captured, excluding 204. `res.render()` has a dedicated cache path in the Frontend guide. Ordinary `res.text()`, streams, downloads, and redirects do not write through the JSON cache path.

### Response header

| header          | value               | description                                                          |
| --------------- | ------------------- | -------------------------------------------------------------------- |
| `X-Cache`       | `HIT`               | Existing entry or concurrent reuse; does not prove storage succeeded |
| `X-Cache`       | `MISS`              | Miss or some bypass paths; does not prove a write happened           |
| `Cache-Control` | `public, max-age=N` | N=TTL seconds on MISS, remaining seconds on HIT                      |

These headers apply only to responses entering the relevant cache flow. `cacheControl: false` disables the generated `public` header, not server caching, and does not remove a header set by application code. Responses with `private` or `no-store` are not written to server storage.

`partitionKey` isolates only server cache, not browser, proxy, or CDN caches. Set a suitable HTTP cache policy for personalized responses; a partition does not make the default `public` appropriate. `private`/`no-store` prevent storage but are not enough by themselves to prevent concurrent reuse; see [Concurrent origin fetches](#concurrent-origin-fetches).

### Cache Key algorithm

The actual storage path currently uses the underlying `createVextLegacyKey`: method plus normalized URL, then partition and vary request headers. The versioned JSON tuple from `defaultCacheKey()` is currently used for flow key/Hook records, not as the stored key to delete. Prefer tag invalidation over depending on an internal key format.

```
GET /products                              → GET:/products
GET /products?limit=10&page=2              → GET:/products?limit=10&page=2
GET /products (Accept-Language: zh-CN)     → GET:/products|accept-language=zh-CN
```

- Query parameters are automatically sorted (`?b=2&a=1` ≡ `?a=1&b=2`)
- Requests with `Authorization` are not cached by default unless `partitionKey` is configured or `allowAuthorizationCache: true` is explicitly set
- An origin result for a Cookie-bearing request is not written by default; reading an existing entry has the limitation below
- When you need to differentiate cache by user or tenant, use `partitionKey` first
- When using a custom `key`, `partitionKey` and `vary` will still be appended to the underlying key

:::warning Cookie read limitation
In the current implementation, `allowCookieCache: false` prevents writing an origin response but does not prevent a Cookie-bearing request from reading an existing public entry. Test “anonymous request populates cache → Cookie-bearing request”; a cold-cache test alone misses this behavior. To bypass all Cookie requests, explicitly set `condition: (req) => req.headers.cookie === undefined`, or disable caching for the route. The complete example above includes this condition.
:::

### Scenarios without caching

The following list includes both early bypass and responses that are not written. “Not written” does not prove concurrent requests cannot share a result; see [Concurrent origin fetches](#concurrent-origin-fetches).

- `204 No Content` response
- Non-2xx status codes (3xx/4xx/5xx)
- Response contains `Set-Cookie`
- Response header contains `Cache-Control: no-store` or `private`
- The request header contains `Cache-Control: no-store` or `no-cache`
- With `Authorization` and no `partitionKey` / `allowAuthorizationCache` configured
- An origin result with Cookie and no `allowCookieCache` (does not guarantee bypass of an existing entry)
- A response outside JSON or dedicated render-cache capture
- A Session with pending changes that prevents storage of the current response
- `cache: false` explicitly disabled
- `cache: 0` or negative value
- `condition` returns `false`
- Custom `key` returns empty string

## Runtime API

Operate the cache in the route handler through `app.cache`:

```typescript
// Invalidate batches by tag
app.post("/products", {}, async (req, res) => {
  await db.createProduct(req.body);
  await app.cache.invalidate("products"); // All caches with products tags are invalidated
  res.json({ created: true }, 201);
});

// Delete the specified default key
await app.cache.delete("GET:/products");

//Clear all caches
await app.cache.clear();

// View statistics
const stats = app.cache.stats();
// → { entries: 42, hits: 128, misses: 31, hitRate: 0.805 }
```

`app.cache.clear()` clears the current Vext response-cache namespace. In Redis/MultiLevel mode it does not clear the whole Redis database, although Vext applications sharing the same database may affect each other. Memory cache and statistics cover only the current runtime instance; cluster worker memory statistics are not automatically aggregated. The numeric statistics above are illustrative.

`delete()` needs the exact final key: do not copy the no-query example for keys with query, vary, partition, or custom key. Prefer tag invalidation for a group of variants. Complete the business write before invalidating the corresponding tag; these steps are not automatically one database transaction, so the business must handle failure and concurrent refill.

Redis adapter `stats()` currently returns all-zero placeholders, which do not prove Redis has no entries. MultiLevel statistics cover this process's L1, not L1+L2 or the cluster. Distinguish existing-entry hits from concurrent reuse when evaluating actual caching.

### Store failure boundaries

- A cache-read error is treated as a miss. A write error does not create a new business error response, but storage did not succeed; `X-Cache: MISS` or `cache:write` alone does not prove persistence.
- MultiLevel `remoteTimeout` does not cover writes, invalidation, or refill TTL lookup. `writePolicy: "both"` waits for L2, while `local-first-async-remote` writes L1 then L2 asynchronously; remote failure may leave inconsistent layers.
- Redis deletion, tag invalidation, and broadcast publication can throw. MultiLevel single-key deletion ignores L2 errors; batch/tag invalidation follows `remoteInvalidationErrors`. A successful call does not universally prove every replica was invalidated.
- `lease.onTimeout: "fetch"` controls what to do when waiting for a lease owner times out; it does not imply that a connection error while acquiring a lease automatically fetches from origin. Do not assume all cache failures degrade transparently.

## Vary Headers

Different request header values will generate different cache entries:

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
GET /products (Accept-Language: zh-CN) → independent cache
GET /products (Accept-Language: en-US) → independent cache
```

Allow all request headers to participate in the cache key:

```typescript
app.get("/debug", { cache: { ttl: 10_000, vary: "*" } }, handler);
```

`vary: "*"` can greatly increase entry count. Prefer listing the headers that actually affect content. It does not replace authentication, authorization, or a trusted partition.

## Conditional caching

Use the `condition` function to control whether to use caching logic:

```typescript
app.get(
  "/data",
  {
    cache: {
      ttl: 60_000,
      // Skip cache when taking refresh parameter
      condition: (req) => req.query.refresh === undefined,
    },
  },
  handler,
);
```

```bash
curl http://localhost:3000/data           # Use cache
curl 'http://localhost:3000/data?refresh=' # Bypass even with an empty value
```

## Custom Key

Fixed business key:

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

When you need to generate key according to request parameters:

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

A custom key replaces the default method/path/query combination; only partition and vary are still appended. This function is safe only if category is the sole input affecting content. Include pagination, sorting, or other parameters when relevant, or distinct requests can incorrectly share a result. Keeping the default key is usually simpler.

## Partition Key

`partitionKey` is the cache partition. It does not change the business response, but only isolates the underlying cache keys by user, tenant, region and other dimensions.

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

This is a partial route configuration. First register `auth` middleware as described in [Authentication and Security](/guide/security); it must validate credentials and populate trusted `claims.tenantId`. All viewers within a tenant must also be allowed to see the same list. Do not trust client-supplied `x-tenant-id` or `x-user-id`. The encoded partition enters the key, and the condition prevents caching without a trusted tenant. An Authorization request needs a nonempty partition, or an explicit allow option, to be cache eligible.

Automatic `public` headers are disabled here. Still verify that proxies do not independently cache personal or tenant responses. Authentication and authorization must run before caching. Declaring `partitionKey` does not authenticate, authorize, or prove that a response belongs to that partition.

If you confirm that the response is not relevant to the user, you can also enable it explicitly:

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

Most business interfaces recommend using `partitionKey` instead of directly opening `allowAuthorizationCache`.

## Concurrent origin fetches

In one process, concurrent requests that pass the pre-request policy and have the same final key use `response-cache-kit` single-flight to share an origin result. The requester fetching from origin reports `MISS`; waiters reusing that result report `HIT`. Early bypass, failed origin fetches, and separate workers/instances change execution counts. Cross-process coordination requires a lease; expiry or `onTimeout: "fetch"` can still cause multiple origin fetches and cannot guarantee exactly-once business execution.

:::warning Not stored does not mean not shared concurrently
The current implementation merges in-flight origin fetches with the same key even if the final response is not stored because of `private`, `no-store`, or `Set-Cookie`. Waiters may receive the first body's result with `HIT`. Under default `cacheControl: true`, such waiter responses may also lose the original `private`/`no-store` header; the first response's `Set-Cookie` is not replayed.

For private data, session creation/mutation, or endpoints that must run independently on each call, use `cache: false` or a `condition` that excludes the request before cache entry. A header set only in the handler cannot prevent this in-flight sharing. The opening example returns shareable demonstration data and excludes Cookie requests up front.
:::

Cache Hooks trace flow, but `cache:miss` currently fires before the underlying lookup, so a final HIT may have emitted it first. `cache:write` means a response was captured, not that storage succeeded. Combine final responses and runtime statistics when measuring hits; event counts alone are not an accurate hit rate.

## Safety precautions

:::warning
**Authentication routing + cache**: Requests with `Authorization` will not be written to the response cache by default. When you need to cache authentication interfaces, use `partitionKey` to explicitly isolate users or tenants.

The framework can warn when a cached route declares auth or has middleware with auth in its name without partition or authorization-cache settings. A warning does not prove the identity source is trusted or replace isolation tests. Choose a policy:

- Use `partitionKey` to isolate by user/tenant
- Use `condition` to exclude requests that should not be cached
- Set `allowAuthorizationCache: true` only when the response is truly independent of the user

:::

```typescript
// Partial example: auth must verify credentials and provide a trusted subject.
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

For an endpoint that serves both anonymous and authenticated users, after middleware reliably establishes identity, `condition: (req) => !req.auth?.isAuthenticated && req.headers.cookie === undefined && !req.headers.authorization` can cache only anonymous requests. On a login-required endpoint it would exclude every successful request; `cache: false` is clearer.

## Troubleshooting and verification

| Symptom                            | Check                                                                                      | Recheck                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Always MISS                        | Global enabled, TTL, Authorization/Cookie/Cache-Control, condition, status, and Set-Cookie | Repeat a public example request without Cookie                          |
| Changed parameters return old data | Custom key omits pagination, filters, or identity dimensions                               | Request distinct inputs and inspect bodies                              |
| `{ ttl: 0 }` still caches          | Object TTL may be filled by a global default                                               | Set `cache: false` and confirm every request runs the handler           |
| Data changed but remains cached    | Business write, matching invalidation tag, or process-local Memory                         | Confirm MISS after invalidation, then HIT on the next request           |
| Tenant data crosses boundaries     | Trusted identity source, nonempty partition, custom key, shared Redis scope                | Verify with two validated identities, not forged identity headers       |
| CDN serves another user's data     | Server partition does not control an external shared cache                                 | Disable shared caching and inspect actual HTTP headers and proxy policy |

Continue with [Middleware order](/guide/middleware), [Hooks](/guide/hooks), [Cookies and Sessions](/guide/cookies-session), and [Route API](/api/route-definition).

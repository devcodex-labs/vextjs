# Rate Limiting

VextJS global rate limiting is disabled by default. Once enabled explicitly, it can count by IP, a custom request key, or a supported user field, with per-route quota overrides or bypass. See the [Security and Resource Specification](/specification/security-and-resources#vext-sec-004) for architecture boundaries.

## Run a minimal example

Prerequisite: prepare a TypeScript project with [Quick Start](/guide/quick-start), including npm scripts `dev: vext dev`, `build: vext build`, and `start: vext start`. These two files use an in-process Store. Start a fresh process and send requests in order so earlier requests do not affect counts. Merge fields into existing configuration where needed.

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  rateLimit: {
    enabled: true,
    max: 2,
    window: 60,
    keyBy: (req) => `${req.ip}:${req.path}`,
    store: "memory",
  },
} satisfies VextUserConfig;
```

This demonstration deliberately uses “IP + actual path” as its key so three endpoints count separately. A real endpoint with dynamic paths may create many distinct keys. Design production keys around resources and access dimensions instead of adopting this example key for every endpoint.

```typescript
// src/routes/limits.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    res.json({ ok: true });
  });
  app.get(
    "/once",
    { override: { rateLimit: { max: 1, window: 60 } } },
    async (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.get("/free", { override: { rateLimit: false } }, async (_req, res) => {
    res.json({ ok: true });
  });
});
```

Run `npm run dev`; these requests target the example's `http://127.0.0.1:3000`. On Windows PowerShell, use `curl.exe`:

```bash
curl -i http://127.0.0.1:3000/limits
curl -i http://127.0.0.1:3000/limits
curl -i http://127.0.0.1:3000/limits
curl -i http://127.0.0.1:3000/limits/once
curl -i http://127.0.0.1:3000/limits/once
curl -i http://127.0.0.1:3000/limits/free
```

| Order                   | Expected result                                                    |
| ----------------------- | ------------------------------------------------------------------ |
| `/limits` calls 1 and 2 | HTTP 200                                                           |
| `/limits` call 3        | HTTP 429, `code: 429`, default `message: "Too Many Requests"`      |
| `/limits/once` call 1   | HTTP 200                                                           |
| `/limits/once` call 2   | HTTP 429                                                           |
| `/limits/free`          | HTTP 200, no rate-limit response headers; may be called repeatedly |

The 429 is a direct JSON response with `code`, `message`, and `requestId`; do not parse it as a successful response's `data` wrapper. Stop the development service, run `npm run build -- --typecheck` and `npm start`, then repeat the sequence. Wait for window recovery or restart this demonstration's in-memory process before another run. Restarting the application does not clear counts stored in Redis.

## Configuration, units, and overrides

| Field     | Default             | Meaning                                                           |
| --------- | ------------------- | ----------------------------------------------------------------- |
| `enabled` | `false`             | Whether framework startup registers global rate limiting          |
| `max`     | `100`               | Allowed requests in the current window                            |
| `window`  | `60`                | Window length in **seconds**                                      |
| `message` | `Too Many Requests` | Over-limit response text                                          |
| `keyBy`   | `"ip"`              | Built-in dimension or a function synchronously returning a string |
| `store`   | `"memory"`          | Built-in Store; Redis configuration is also supported             |

`RouteOptions.override.rateLimit` may set `max`, `window`, or string `keyBy`, or be `false` to bypass limiting. The public route type does not accept a custom key function or route-specific Store. Without global enablement, writing a route override alone does not register rate-limit middleware.

The built-in limiter uses a sliding window. The default IP key does not include the route path. In the memory Store, requests using the same max/window enter the same limiter and share quota when keys match. To separate quotas, design and verify keys for same-key, different-key, and different-route cases. Redis limiters with different max/window values also share a Store; changing quota parameters alone does not isolate Redis counts.

Counting occurs before later business work. A later success or failure does not roll back the count, and an over-limit attempt also enters the sliding window. Continuous retries can postpone recovery; clients should back off. Do not interpret a reset header as a promise that the entire quota returns in that second.

| Response header       | Meaning                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `RateLimit-Limit`     | Current effective max                                                                                                    |
| `RateLimit-Remaining` | Remaining requests                                                                                                       |
| `RateLimit-Reset`     | Seconds until the earliest record in the current window expires; not a Unix timestamp or promise of full bucket recovery |
| `Retry-After`         | Suggested retry delay on 429, at least one second                                                                        |

## IP, user, and authentication order

- `keyBy: "ip"` uses the framework-resolved `req.ip`; check client-address and trust settings behind a proxy.
- `keyBy: "user"` reads `req.user.id` and falls back to IP if absent. It does not read `req.auth.subject` or `req.auth.userId` automatically. Other strings also use IP; for example, `"tenant"` does not read a tenant field automatically.
- Global rate limiting runs before plugin global middleware and route middleware. Identity written later by ordinary authentication middleware is generally unavailable at this point.
- A custom key function receives the request in its current state and must synchronously return a nonempty string. Do not rely on later Schema validation or use an asynchronous function. For business quotas based on authenticated identity, implement and verify the policy at an explicit point after authentication.

See [Authentication and Security](/guide/security) for identity integration. Rate limiting does not replace endpoint authorization or object-level permission checks.

## Multiple workers and Redis

An in-memory quota belongs to one process; workers or instances do not share it automatically. To count across instances, use a Redis Store and the same namespace/keyPrefix for instances that should share quota.

`rateLimit.store` accepts `"memory"`, `"redis"`, or a Redis configuration object. The object must include `type: "redis"` and may provide `url`, `uri`, or an existing `client`. Address resolution follows `url` → `uri` → `VEXT_REDIS_URL` → `REDIS_URL`; bare `"redis"` must not be assumed to discover the correct service. See the [Configuration API](/api/config) for fields and environment selection.

An explicit `keyPrefix` takes precedence over namespace. With neither an explicit prefix nor namespace, the default prefix is derived from the project package name, configuration profile, runtime mode, and module. Verify that instances intended to share quota resolve to the same prefix; isolate different applications or environments. Redis keys do not automatically append routes or max/window. Policies sharing one key can affect each other's counts and expiry cleanup.

The runtime closes Redis clients it creates for limiting; it does not close an externally supplied client. An application must also explicitly arrange cleanup for a custom limiter; `setRateLimiter()` alone does not take ownership of its client.

### Storage failures and allow policy

When the current built-in dependency's algorithm or Store check throws, it logs the error and returns `allowed: true`; the request may continue to business logic instead of necessarily returning 500. A Redis disconnect may first trigger connection/command retries, so an immediate return is not guaranteed. Even a successful request or rate-limit response headers do not prove the shared Store is healthy.

This differs from startup failure due to a missing Redis target and from a custom `check()` throwing into framework error handling (500 by default). There is no public switch to make the built-in failure policy deny requests directly. An application that must deny on storage failure should use a custom limiter or entry-point rate limiter with an explicit policy and verify failure and recovery.

## Custom limiter

A plugin can supply `check(key)` through `app.setRateLimiter()`, returning `allowed`, `remaining`, and `resetAt`. Global `rateLimit.enabled: true` is still required. Here `resetAt` is an **absolute Unix timestamp in seconds**, which the framework converts into seconds remaining in the response header.

The custom interface receives only a key. The framework still handles key generation, enablement/bypass, headers, and 429 responses, but route `max/window` is not passed automatically to the custom algorithm. State your own quota policy and verify that headers match it. This is an application extension point; the built-in limiter's full parameter semantics do not automatically apply to a replacement.

## Troubleshooting and verification

| Symptom                                  | Check and response                                                                       | Recheck                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Route quota has no effect                | Is global `enabled` true?                                                                | Repeat requests with a low quota and confirm 429                                                  |
| Different users share quota              | Does `keyBy` read the right field at the right authentication stage, or fall back to IP? | Check the actual key policy for different identities sharing an IP                                |
| Total quota grows after scaling          | Is each process still using `memory`?                                                    | Send requests to different workers and inspect shared Store counts                                |
| Instances do not share Redis quota       | Do target address, profile/mode, and prefix match?                                       | Use the same key across instances                                                                 |
| Redis failure still returns 200 or waits | Check Store errors, connection retries, and built-in allow-on-error behavior             | Trigger a controlled failure, check whether business code runs, then verify counts after recovery |
| Custom limiter exception returns 500     | Check exceptions from `check` and application error handling                             | Distinguish explicit denial (`allowed: false`, 429) from infrastructure exceptions                |

Application test helpers disable rate limiting by default. Pass `rateLimit.enabled: true` when testing this feature; do not mistake test defaults for effective production configuration.

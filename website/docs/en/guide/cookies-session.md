# Cookies and Sessions

Vext provides Cookie reading/writing, configuration-driven Session, and CSRF middleware across Native, Hono, Fastify, Express, and Koa adapters. Basic Cookies and in-memory Session need no extra library; external stores such as Redis need their corresponding client. Run a complete flow first, then read the persistence, isolation, and failure boundaries below.

## Run a Cookie, Session, and CSRF flow first

Prepare a TypeScript app from [Quick start](/guide/quick-start) with `dev: vext dev`, `build: vext build`, and `start: vext start`. Add these two files, merging fields into existing config. The visit counter demonstrates session state; identity authentication is covered in [Authentication and security](/guide/security).

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  session: { enabled: true },
  csrf: { enabled: true, mode: "session" },
} satisfies VextUserConfig;
```

```typescript
// src/routes/session-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (req, res) => {
    res.json({
      theme: req.cookie("theme") ?? "system",
      visits: req.session!.visits ?? 0,
    });
  });
  app.get("/token", {}, async (req, res) => {
    res.json({ token: req.csrfToken() });
  });
  app.post("/visit", {}, async (req, res) => {
    const previous = req.session!.visits;
    req.session!.visits = (typeof previous === "number" ? previous : 0) + 1;
    res.cookie("theme", "dark", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    res.json({ visits: req.session!.visits });
  });
  app.post("/rotate", {}, async (req, res) => {
    await req.session!.regenerate();
    res.json({ visits: req.session!.visits ?? 0 });
  });
  app.post("/logout", {}, async (req, res) => {
    await req.session!.destroy();
    res.clearCookie("theme", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/public", { session: false }, async (req, res) => {
    res.json({ hasSession: req.session !== undefined });
  });
});
```

Run `npm run dev`. These commands save and send Cookies through `cookies.txt` from the example directory; use `curl.exe` in Windows PowerShell. First verify that a missing token is rejected, then obtain one:

```bash
curl -i -X POST http://127.0.0.1:3000/session-demo/visit
curl -i -c cookies.txt http://127.0.0.1:3000/session-demo/token
```

The first request returns 403 with `CSRF_TOKEN_MISSING`. The second returns 200 with `data.token`, sets `vext.sid`, and sends `Cache-Control: no-store`. Replace `TOKEN` below with that response's token. Keep the same `cookies.txt`; sending the token without its session is insufficient:

```bash
curl -i -b cookies.txt -c cookies.txt -X POST -H "x-csrf-token: TOKEN" http://127.0.0.1:3000/session-demo/visit
curl -i -b cookies.txt http://127.0.0.1:3000/session-demo
curl -i -b cookies.txt -X POST -H "x-csrf-token: invalid" http://127.0.0.1:3000/session-demo/visit
curl -i -b cookies.txt -c cookies.txt -X POST -H "x-csrf-token: TOKEN" http://127.0.0.1:3000/session-demo/rotate
curl -i -b cookies.txt -c cookies.txt -X POST -H "x-csrf-token: TOKEN" http://127.0.0.1:3000/session-demo/logout
curl -i -b cookies.txt http://127.0.0.1:3000/session-demo
curl -i http://127.0.0.1:3000/session-demo/public
```

| Step                           | Expected result                                                           |
| ------------------------------ | ------------------------------------------------------------------------- |
| Visit with valid token/session | 200, visits is 1; theme and session Cookies written                       |
| Read state                     | 200, theme is dark and visits is 1                                        |
| Invalid token                  | 403, `CSRF_TOKEN_INVALID`; count unchanged                                |
| Rotate                         | 200, `vext.sid` changes while data including count and CSRF token remains |
| Logout                         | 200, session and theme Cookies cleared, original Store entry removed      |
| Read again                     | 200, theme is system and visits is 0                                      |
| Public route                   | 200, hasSession is false                                                  |

Successful responses use the default envelope, so values are under `data`. Stop dev, run `npm run build -- --typecheck` and `npm start`, then obtain a fresh token/Cookie and repeat. Memory Store data does not survive a process restart.

## Cookies

Every request exposes parsed Cookies. Place these route fragments inside `defineRoutes((app) => { ... })`:

```typescript
app.get("/preferences", {}, async (req, res) => {
  const theme = req.cookie("theme") ?? "system";
  res.json({ theme, all: req.cookies });
});
```

Set cookies through `res.cookie()` and clear them through `res.clearCookie()`:

```typescript
res.cookie("theme", "dark", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
});

res.clearCookie("theme", { path: "/" });
```

Multiple `res.cookie()` calls are emitted as multiple `Set-Cookie` headers. Vext does not join them with commas.

`req.cookies` is readonly and uses first-wins semantics for duplicate cookie names. `res.cookie()` also supports `priority`, `partitioned`, and a custom `encode` function for advanced cases.

`maxAge` is in seconds and `expires` takes a Date. Ordinary Cookie `secure` is boolean; only Session/CSRF configuration additionally accepts `"auto"`. Match the original path/domain when clearing. Response methods set headers but do not mutate the current request's `req.cookies`; the next request must carry the new Cookie.

## Cookie Validation

`validate.cookie` validates parsed cookie values and emits OpenAPI `in: cookie` parameters:

```typescript
app.get(
  "/me",
  {
    validate: {
      cookie: {
        sid: "string!",
      },
    },
  },
  async (req, res) => {
    const { sid } = req.valid("cookie");
    res.json({ sid });
  },
);
```

Validation order is `param -> query -> header -> cookie -> body`.

Built-in OpenAPI docs can display `validate.cookie` as cookie parameters. Browser Try it out cannot set the forbidden `Cookie` header directly; use cookies already present for the same origin, a browser login flow, or an HTTP client such as cURL for manual cookie values.

## Sessions

Session is disabled by default. With configuration enabled, development and production startup and soft reload register it. `createTestApp()` does not load project config; tests must explicitly pass `config.session.enabled: true`:

```typescript
// Configuration fragment for src/config/default.ts
export default {
  session: {
    enabled: true,
  },
};
```

Use `req.session` in route handlers:

```typescript
app.post("/demo-user", {}, async (req, res) => {
  // Fixed value demonstrates state only. Real login must verify identity first.
  req.session!.userId = "u_123";
  res.json({ ok: true });
});

app.post("/logout", {}, async (req, res) => {
  await req.session!.destroy();
  res.json({ ok: true });
});
```

The session object supports:

| Method         | Description                                                                                |
| -------------- | ------------------------------------------------------------------------------------------ |
| `save()`       | Wait for Store write/refresh and set the response's session Cookie                         |
| `regenerate()` | Delete old id, create new id while retaining data; persist via autoCommit or explicit save |
| `destroy()`    | Delete Store data and clear the Cookie                                                     |

Session metadata such as `id`, `isNew`, `save`, `regenerate`, and `destroy` is non-enumerable and is not persisted into the store.

`autoCommit: true` is the default. At the response send barrier before an ordinary response is sent, Vext awaits a required asynchronous Store commit. If it fails, the unsent original success response and new session Cookie are withheld. Await explicit methods sequentially before sending a response; do not call them concurrently or mutate a session after response. A completed save with unchanged data is not normally written again by autoCommit, but this does not provide transactions or concurrent-update protection.

`regenerate()` retains data and does not authenticate a login. With `autoCommit: false`, call `save()` again to persist the new id. Do not write business state after `destroy()`. Before streaming or downloading with dirty or rolling Session, call `await req.session!.save()` before `res.stream()` or `res.download()`.

An untouched new Session does not write Store data or issue a Cookie merely from reading in default nonrolling mode. An ordinary read does not refresh an existing TTL; rolling does so on response. Persistent data must fit the chosen Store/serializer. Concurrent writes to one Session need an application/Store strategy; Vext does not merge them automatically.

## Configuration

`config.session.enabled: true` enables the global Session runtime and the
remaining fields configure it:

```typescript
export default {
  session: {
    enabled: true,
    name: "vext.sid",
    ttl: 86400,
    rolling: false,
    autoCommit: true,
    idLength: 32,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: "auto",
    },
  },
};
```

TTL is in seconds (default 86400); Cookie maxAge follows TTL unless separately specified. `idLength` is random bytes for the id (16–128, default 32), not the encoded string length. `secure: "auto"` sends Secure only when `req.protocol === "https"`; verify `trustProxy` and the actual protocol behind a reverse proxy.

The default memory Store removes expired entries on access and through bounded opportunistic sweeps, without a timer that retains the process. It suits development, tests, and single-process deployments that accept process-local state. Multiple workers/instances need a shared Store; soft reload is no substitute for restart persistence.

### Optional: use a shared Store

`createCacheSessionStore()` from the root entry accepts a structural cache. This Redis fragment replaces the Session field while retaining the main example's other config. Install `cache-hub` and `ioredis` in the consuming app (`npm install cache-hub ioredis`) and supply a real Redis service:

```typescript
import { createCacheSessionStore } from "vextjs";
import { createRedisCacheAdapter } from "cache-hub/redis";
import { Redis } from "ioredis";

// Build and other commands may read config; connect on first Store operation.
const redis = new Redis("redis://localhost:6379", { lazyConnect: true });
const sessionCache = createRedisCacheAdapter(redis);

export default {
  session: {
    enabled: true,
    store: createCacheSessionStore(sessionCache, {
      prefix: "my-app:sess:",
      close: async () => {
        if (redis.status === "wait" || redis.status === "end") {
          redis.disconnect();
        } else {
          await redis.quit();
        }
      },
    }),
  },
};
```

`createCacheSessionStore()` accepts a structural cache with `get`, `set`, and `del`. It converts `VextSessionStore` TTL seconds to cache milliseconds, stores JSON strings by default, and implements rolling `touch()` as a cache `get` plus `set`. Install `cache-hub` and the selected backend client, such as `ioredis`, in the consuming app.

`config.cache.cacheHub` and `app.cache` belong to route response cache, not Session. Use distinct key prefixes. The application chooses this prefix; the default `vext:session:` does not automatically isolate project/environment. Instances sharing one policy need the same prefix, while different apps/environments need different prefixes. Cache `get` plus `set` for rolling `touch()` is not atomic; choose an implementation appropriate to concurrency needs.

Each Session runtime invokes its Store's exposed `close()` exactly once during app shutdown. `createCacheSessionStore()` exposes it only when a close callback is passed. The cache-hub adapter above wraps an external Redis instance; adapter close does not replace caller cleanup, so the Store callback closes the example's exclusively owned client. If the client is shared, define one owner for shutdown. A cache-hub adapter created directly from a URL owns and closes its own connection. A custom `VextSessionStore` can implement get/set/delete and optional touch/close.

Use route options `session: false` to skip Session on a public route; this does not delete stored data or clear its Cookie. When the
global runtime is disabled, `session: true` or `{ session: { enabled: true,
rolling: true } }` enables it for one route. The explicit `session()` middleware
remains available for scoped/manual registration; do not combine it with
`config.session.enabled: true`.

## CSRF Protection

CSRF protection is available through `csrf()` and `config.csrf`. In `mode: "auto"` Vext uses the configured Session runtime when `req.session` is available; otherwise it can use a signed double-submit cookie when `config.csrf.secret` is configured.

The two-file example above shows token retrieval and submission. Session mode keeps the token in the server Session; signed-cookie mode needs a stable secret and checks the client-submitted raw token against the signed Cookie value. Multiple instances need consistent secrets/Stores as applicable.

Unsafe methods default to `POST`, `PUT`, `PATCH`, and `DELETE`. Submit the token through `x-csrf-token`, `x-xsrf-token`, or body field `_csrf`. Use route options `{ csrf: false }` for public endpoints that must accept unsafe methods without a CSRF token.

`config.csrf.enabled: true` auto-registers CSRF after body parsing, global Session, and plugin global middleware, but before route-specific Session and route identity guards. For Session mode, enable Session globally as in the main example; route-only Session may not exist at global CSRF time. For scoped protection, register `csrf()` manually in a plugin after the necessary Session and avoid duplicate global registration.

Without registered CSRF middleware, route `csrf: true` does not add it. `csrf: false` skips validation but still mounts the token method; calling it requires an available Session or secret. `req.csrfToken()` sets `Cache-Control: no-store`; never put that response into shared cache.

Fetch Metadata checks are enabled by default: protected methods carrying `Sec-Fetch-Site: cross-site` receive 403. Origin checks are off by default. With `origin: { trustedOrigins: [...] }`, Vext checks an existing Origin, then Referer if Origin is absent; if both are absent, this option alone does not reject. Verify token, source checks, and business authorization separately.

## Cache Safety

Verify both cold and existing cache entries for Cookie requests:

- By default a Cookie request's origin response is not written, but it may read an existing public entry. To bypass entirely, set `condition: (req) => req.headers.cookie === undefined` or `cache: false`; see [Cache key limitations](/guide/cache#cache-key-algorithm).
- responses with `Set-Cookie` are never written to cache
- set `allowCookieCache: true` only for routes whose cookie input is known to be safe

```typescript
app.get(
  "/public-ab-test",
  {
    cache: {
      ttl: 60_000,
      allowCookieCache: true,
      vary: ["cookie"],
    },
  },
  async (req, res) => {
    res.json({ theme: req.cookie("theme") ?? "system" });
  },
);
```

This fragment demonstrates a response explicitly varied by Cookie, not a Session token or private user data. A response that creates a Session or updates a Cookie still must not enter a shared cache.

“Not written” is not the same as “excluded from concurrent request coalescing”: in-flight requests under the same key may reuse the first body. For Session creation/mutation, private data, or endpoints that must run independently each time, exclude requests before entering cache with `cache: false` or a condition. Do not rely solely on Set-Cookie, private, or no-store response headers. See [Concurrent origin fetches](/guide/cache#concurrent-origin-fetches).

## Common issues and recheck

| Symptom                                    | What to check and fix                                                                  | Recheck                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| No Set-Cookie                              | Was a new Session merely read? Does the browser reject Secure/path/domain?             | Token/visit response headers and next request Cookie            |
| `req.session` missing                      | Global/route switches, manual registration position, explicit test config              | Compare normal and `session: false` routes                      |
| Correct token still 403                    | Lost associated Cookie, old process-local Session, Fetch Metadata, or Origin rejection | Fetch fresh token and Cookie; distinguish error codes           |
| 500 `CSRF_CONFIGURATION_ERROR`             | No usable Session or secret at CSRF execution time                                     | Check global/route chain order                                  |
| State lost or overwritten across instances | Memory Store, inconsistent prefix, or concurrent writes                                | Cross-instance and concurrent Store behavior                    |
| Store failure yet expecting success        | Store get/set/delete error and whether response was sent                               | Confirm success response is withheld, then retry after recovery |

See [Configuration API](/api/config), [Context API](/api/context), and [Security and resources specification](/specification/security-and-resources).

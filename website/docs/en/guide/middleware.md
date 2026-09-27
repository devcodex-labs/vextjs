# Middleware

VextJS middleware uses the **onion model** for work before and after the next step. Define ordinary middleware with `defineMiddleware` or parameterized middleware with `defineMiddlewareFactory`; the loader looks up explicitly allowlisted files in the conventional directory. This page starts with a complete example without business dependencies, then covers authentication, error handling, and lifecycle.

For route references, registration order, and constraints, see the [HTTP and Routing Specification](/specification/http-and-routing). Start from a working project created with [Quick Start](/guide/quick-start): define two files, allowlist them, reference them from a route, and verify requests. The later authentication, API key, and cache examples require their own configuration or services.

## Onion model

Middleware calls the next step with `await next()`. When it returns, post-processing runs. The handler may already have sent or begun sending a response, so post-processing cannot assume that response headers are still writable:

```
Request → [Middleware A before] → [Middleware B before] → [Handler] → [Middleware B after] → [Middleware A after]
```

```typescript
import type { VextMiddleware } from "vextjs";

const timing: VextMiddleware = async (req, res, next) => {
  // Before the next step
  const start = Date.now();

  await next(); // Execute the next middleware / final handler

  // After the next step
  const ms = Date.now() - start;
  req.app.logger.info(
    `${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`,
  );
};
```

## Middleware signature

```typescript
type VextMiddleware = (
  req: VextRequest,
  res: VextResponse,
  next: () => Promise<void>,
) => Promise<void> | void;
```

| Parameters | Description                                                                            |
| ---------- | -------------------------------------------------------------------------------------- |
| `req`      | Framework-unified request object (decoupled from Adapter)                              |
| `res`      | Framework-unified response object                                                      |
| `next`     | Call the next middleware; await it for post-processing, or return its Promise directly |

## Define middleware

Put middleware files in `src/middlewares/`. The filename is the middleware name; the loader finds it through the configuration allowlist. A file existing in that directory does not enable it automatically.

### Common middleware — `defineMiddleware`

Use `defineMiddleware` when no options are needed. This complete file adds a response header and logs elapsed time:

```typescript
// src/middlewares/audit-log.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  res.setHeader("X-Audit", "visited");
  const start = Date.now();
  try {
    await next();
  } finally {
    req.app.logger.info(
      { path: req.path, elapsedMs: Date.now() - start },
      "Request finished",
    );
  }
});
```

### Factory middleware — `defineMiddlewareFactory`

Use `defineMiddlewareFactory` to accept options and return middleware. This complete file derives a response header from configuration:

```typescript
// src/middlewares/response-label.ts
import { defineMiddlewareFactory } from "vextjs";

interface LabelOptions {
  value?: string;
}

export default defineMiddlewareFactory<LabelOptions>((options) => {
  const value = options?.value ?? "default";
  return async (_req, res, next) => {
    res.setHeader("X-Route-Label", value);
    await next();
  };
});
```

Set headers before `next()`. Post-processing suits logging and cleanup, but cannot assume that a response, especially a stream, has not started.

:::tip Why mark middleware explicitly?
`defineMiddleware` and `defineMiddlewareFactory` use Symbol tags. The loader checks `isMiddleware()` and `isMiddlewareFactory()` to distinguish ordinary middleware from factories. Untagged functions still have a compatibility inference path, but it emits a deprecation warning and depends on whether default options exist. Use explicit tags in new code.
:::

## Registration and use

Use middleware in two steps: **allowlist it in configuration**, then **reference it from a route**.

### Step 1: Declare the allowlist in configuration

Create the two files above, then add their names to your existing project configuration:

```typescript
// src/config/default.ts
export default {
  middlewares: [
    "audit-log",
    { name: "response-label", options: { value: "configured" } },
  ],
};
```

The allowlist declares availability and factory defaults; it does not apply middleware to every route. Ordinary middleware does not accept `options`; define a factory when parameters are needed.

### Step 2: Reference it in a route

```typescript
// src/routes/middleware-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    { middlewares: ["audit-log", "response-label"] },
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.get(
    "/custom",
    {
      middlewares: [
        "audit-log",
        { name: "response-label", options: { value: "route" } },
      ],
    },
    (_req, res) => {
      res.json({ ok: true });
    },
  );
});
```

### Step 3: Start and verify

Merge the allowlist into the project's existing `src/config/default.ts`; run `npm run dev` from the project root. In another terminal, use the port shown on startup. On Windows PowerShell, call `curl.exe`:

```bash
curl -i http://localhost:3000/middleware-demo
curl -i http://localhost:3000/middleware-demo/custom
```

| Request                   | Expected status and headers                          | Why                              |
| ------------------------- | ---------------------------------------------------- | -------------------------------- |
| `/middleware-demo`        | 200, `X-Audit: visited`, `X-Route-Label: configured` | Uses configured factory defaults |
| `/middleware-demo/custom` | 200, `X-Audit: visited`, `X-Route-Label: route`      | Uses route options               |

Both default-wrapped responses contain `data.ok: true`; the server logs `Request finished`. If an environment override is configured, check the section below.

For a negative test, stop the dev process, remove `response-label` from the allowlist while keeping its route reference, and restart. Route loading should fail with an undeclared-middleware diagnostic naming `response-label`. Restore the allowlist and rerun both requests. A file's existence does not count as a configuration declaration.

For authentication, use `auth()` to establish `req.auth`, then protect routes with [`RouteOptions.auth`](/api/route-definition#auth). Final options can be inline or a statically projectable same-file `const`; do not hide them behind a route-options helper call. See the [permission-core Auth example](/examples/permission-core-auth).

### Option precedence

Route-level `options` **replace the entire configured default options object** for a factory; fields are not merged one by one:

```
Configured defaults                 → Route options
{ roles: ["user"] }                 → { roles: ["superadmin"] }
```

### Environment-level configuration override

An environment configuration can override factory defaults:

```typescript
// src/config/default.ts (continuing the complete example)
export default {
  middlewares: [
    "audit-log",
    { name: "response-label", options: { value: "configured" } },
  ],
};
```

```typescript
// src/config/development.ts
export default {
  middlewares: [{ name: "response-label", options: { value: "development" } }],
};
```

Configuration uses a smart patch strategy that matches and merges middleware array entries by `name`. This environment merge differs from route-level options replacement. `enabled: false` retains the name but loads a no-op instead of executing the middleware body. Treat that as ordinary middleware and reference its name only; passing `options` fails registration because the no-op accepts no parameters.

## Middleware execution sequence

### Global middleware

On production startup, enabled features enter these layers in order; disabled features are not installed:

1. Request metadata, request ID, auth context, and request hooks.
2. Security headers, CORS, body parser, and explicitly enabled rate limiting.
3. Response wrapper, frontend renderer, access log, and global Session.
4. Global middleware registered by plugins with `app.use()`.
5. Explicitly enabled CSRF, then the matching route chain.

The adapter registers the error handler separately for exceptions propagated from the chain; it is not an ordinary step guaranteed to run after every handler. A direct response, cache hit, or thrown error can prevent later steps from running.

Rate limiting is opt-in. Only `rateLimit.enabled === true` installs the limiter. If `rateLimit` is absent or its `enabled` field is not exactly `true`, Vext emits no rate-limit headers or HTTP 429 from it.

```typescript
// src/config/default.ts
export default {
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60,
    store: { type: "redis", url: "redis://127.0.0.1:6379" }, // optional shared store
  },
};
```

Once enabled globally, a route can skip it with `override: { rateLimit: false }` or override `max`, `window`, or `keyBy`. The default store is in memory. For cluster or multiple instances, use `rateLimit.store: { type: "redis", url }`, or `rateLimit.store: "redis"` with `VEXT_REDIS_URL` or `REDIS_URL`. Vext creates one shared Redis store and derives a default key prefix from project, profile, runtime mode, and the `rate-limit` module. Specify `namespace` or `keyPrefix` only when explicit key sharing or isolation is needed. `app.setRateLimiter()` changes the limiter implementation but does not enable app rate limiting. The exported `createRateLimitMiddleware()` factory remains available for explicit manual composition.

### Route-level middleware

After the `route:matched` hook, the route chain runs enabled timeout/CORS/Session wrappers, multipart processing, custom middleware, auth guard, response cache and page freshness, automatic validation, and the handler. Custom middleware follows `options.middlewares` order. Its pre-processing cannot rely on automatic validation that has not yet run:

```typescript
app.post(
  "/sensitive-action",
  {
    middlewares: ["auth", "check-role", "audit-log"],
    //            ↑ 1st    ↑ 2nd        ↑ 3rd
  },
  handler,
);
```

## Global middleware (plug-in registration)

Plugins can register global middleware with `app.use()`. It runs after the preceding global layers and before enabled CSRF and the route chain. If an earlier layer short-circuits or throws, this plugin middleware does not run:

```typescript
// src/plugins/request-timing.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "request-timing",
  setup(app) {
    app.use(async (req, res, next) => {
      const startedAt = Date.now();
      await next();
      app.logger.info(
        { elapsedMs: Date.now() - startedAt },
        "Request finished",
      );
    });
  },
});
```

For browser security response headers, prefer the built-in `config.securityHeaders` path. It covers normal responses, errors, 404, testing helpers, and dev soft reload consistently:

```typescript
export default {
  securityHeaders: {
    enabled: true,
    preset: "basic",
  },
};
```

:::warning note
`app.use()` can only be called in a plugin's `setup()`. Calling after route registration is complete will throw an error.
:::

## Common middleware examples

### Authentication middleware

This business snippet requires an application `identity.verifyAccessToken` service that returns `null` for invalid credentials and a user ID and roles for valid ones. VextJS does not provide that business identity database.

```typescript
// src/middlewares/auth.ts
import { auth, defineMiddleware } from "vextjs";

export default defineMiddleware(
  auth({
    source: "bearer",
    async verify(credential, req) {
      if (!credential) return null;
      const user =
        await req.app.services.identity.verifyAccessToken(credential);
      if (!user) return null;
      return { subject: user.id, userId: user.id, roles: user.roles };
    },
  }),
);
```

`auth()` establishes identity context. Missing or invalid credentials are recorded in `req.auth`; the guard on a protected route decides whether to reject the request. Do not use a placeholder that returns a fixed user as credential verification.

### Role checking middleware

For ordinary role protection, declare the route options. Authentication middleware runs first, then the framework guard:

```typescript
// Use in a route's app.get(path, adminOptions, handler) in the same file
const adminOptions = {
  middlewares: ["auth"],
  auth: { required: true, roles: ["admin"], security: "bearerAuth" },
};
```

Custom middleware can read `req.auth.isAuthenticated` and `req.auth.roles`. Writing private `req.user` does not synchronize it to `req.auth`. For fields and error codes, see the [Route API](/api/route-definition#auth).

### Request time-consuming record

```typescript
// src/middlewares/timing.ts
import { defineMiddleware } from "vextjs";
export default defineMiddleware(async (req, res, next) => {
  const start = performance.now();

  await next();

  const duration = (performance.now() - start).toFixed(2);

  req.app.logger.info(
    {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
    },
    "Request completed",
  );
});
```

### API Key Verification

```typescript
// src/middlewares/api-key.ts
import { defineMiddlewareFactory } from "vextjs";

interface ApiKeyOptions {
  header?: string;
  keys?: string[];
}

export default defineMiddlewareFactory<ApiKeyOptions>((options) => {
  const headerName = (options?.header ?? "x-api-key").toLowerCase();
  const validKeys = new Set(options?.keys ?? []);

  return async (req, res, next) => {
    if (validKeys.size === 0) {
      req.app.throw(500, "API key middleware requires configured keys");
    }

    const apiKey = req.headers[headerName];
    if (!apiKey || !validKeys.has(apiKey)) {
      req.app.throw(401, "Invalid API key");
    }

    await next();
  };
});
```

### Cache Control

```typescript
// src/middlewares/cache-control.ts
import { defineMiddlewareFactory } from "vextjs";

interface CacheOptions {
  maxAge?: number; // seconds
  directive?: string; // 'public' | 'private' | 'no-cache' | 'no-store'
}

export default defineMiddlewareFactory<CacheOptions>((options) => {
  const maxAge = options?.maxAge ?? 0;
  const directive = options?.directive ?? "public";
  const value = maxAge > 0 ? `${directive}, max-age=${maxAge}` : "no-store";

  return async (req, res, next) => {
    res.setHeader("Cache-Control", value);
    await next();
  };
});
```

## Error handling middleware

The built-in `error-handler` handles exceptions thrown or awaited in the request middleware chain. This guarantee does not cover background Promises or timers detached from that chain:

- `HttpError` from `app.throw()` → retains its declared HTTP status and business error fields.
- `VextValidationError` → 400 for path parameters, 422 for other locations, with an `errors` array.
- Ordinary `Error` → defaults to HTTP 500 without a valid `status` or `statusCode`; a valid explicit status is normalized, so `Object.assign(new Error("Conflict"), { statusCode: 409 })` returns 409.

For JSON API diagnostics, explicitly request `Accept: application/json`. A browser requesting HTML may receive the dev overlay or rendered error page. See [Error Handling](/guide/error-handling#differences-from-ordinary-error) for format, hidden-message, and `details` boundaries.

### When to use which error throwing method?

- When explicit HTTP semantics are required, use `app.throw(...)` in preference. For example, `404`, `401`, `409`, or scenarios that require business error codes.
- When field-level validation details need to be returned, `VextValidationError` is thrown.
- When a real unexpected exception occurs, you can directly `throw new Error("...")`, and the framework will automatically catch it and convert it to `500`.

```typescript
// Structured HTTP errors
req.app.throw(404, "user.not_found");

// When the fourth parameter is an object/array, it is output as details, which is suitable for revealing third-party business details.
req.app.throw(
  502,
  "payment.failed",
  { orderId },
  {
    provider: "stripe",
    providerCode: "card_declined",
  },
);

//Field-level validation errors
throw new VextValidationError([
  { field: "email", message: "The email format is incorrect" },
]);

// Unexpected runtime error
throw new Error("Database connection lost");
```

Note that `throw new Error("...")` does not mean that the client will definitely see the complete error details. Its purpose is to let the framework catch "unknown exceptions":

- By default, clients receive a safe `500 Internal Server Error`
- JSON 500 responses come with `stack` when `response.hideInternalErrors = false`
- When the browser accesses the error page in dev mode, you may also see the built-in HTML error overlay

Therefore, if your goal is to "return an unambiguous 4xx/5xx HTTP result to the caller", you should use `app.throw(...)` instead of relying on the normal `Error`

If you only want to log the request "after the route parameter verification passes", you can use `app.hooks.on("validation:success", ...)`. This hook is triggered after all `validate` passes, and requests that fail the verification will not enter it:

```typescript
export default definePlugin({
  name: "validated-access-log",
  setup(app) {
    app.hooks.on("validation:success", ({ req, route }) => {
      app.logger.info(
        { requestId: req.requestId, route: route.path },
        "validated request",
      );
    });
  },
});
```

You do not need to write a framework error handler. To observe errors propagated from downstream plugin middleware, register a try-catch through `app.use()`. It cannot catch parsing, rate limiting, or other stages before it. This snippet logs and rethrows; call an installed and initialized Sentry SDK at the comment if you integrate one:

```typescript
// src/plugins/sentry.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "sentry",
  setup(app) {
    app.use(async (req, res, next) => {
      try {
        await next();
      } catch (err) {
        //Report errors to Sentry
        // Sentry.captureException(err);
        app.logger.error({ err }, "Captured by Sentry plugin");
        // Rethrow and let the framework's error-handler handle the response
        throw err;
      }
    });
  },
});
```

## `req.app` in middleware

Route-level middleware does not have the closure `app` of `defineRoutes`, so the framework capabilities are accessed through `req.app`:

```typescript
export default defineMiddleware(async (req, res, next) => {
  //Access various framework capabilities through req.app
  req.app.logger.info("Middleware executing"); // Log
  // req.app.throw(403, "Forbidden"); // Reject if needed; stops execution.
  const config = req.app.config; // Read configuration
  const userSvc = req.app.services.user; // Access services

  await next();
});
```

## Built-in middleware

Common built-in middleware and configuration are listed below. See the order above; the frontend renderer is installed only when frontend features are enabled.

| Middleware          | Configuration            | Role                                                                                  |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| **requestId**       | `config.requestId`       | Generate or propagate a request ID                                                    |
| **authContext**     | `config.requestContext`  | Synchronize auth context; does not verify credentials                                 |
| **securityHeaders** | `config.securityHeaders` | Explicitly enable browser security response headers                                   |
| **cors**            | `config.cors`            | Cross-origin handling                                                                 |
| **bodyParser**      | `config.bodyParser`      | Parse JSON and URL-encoded bodies                                                     |
| **rateLimit**       | `config.rateLimit`       | Global limiter installed only with `enabled: true`                                    |
| **accessLog**       | `config.accessLog`       | Method, path, status, duration logging                                                |
| **responseWrapper** | `config.response`        | Wrap output as `{ code, data, requestId }`                                            |
| **session**         | `config.session`         | Enable globally or on individual routes                                               |
| **csrf**            | `config.csrf`            | Explicit CSRF protection                                                              |
| **errorHandler**    | —                        | Global error handling, with exposure and logging controlled by response configuration |

See [Configuration](/guide/configuration) for options. The adapter initializes `req.auth` as anonymous when creating the request. `requestContext.enabled: false` skips the auth-context middleware and framework request ALS scope; it does not remove `req.auth` or disable explicitly registered `auth()` authentication and route guards.

## TypeScript type extensions

If the middleware mounts custom attributes on `req` (such as `req.user`), it is recommended to extend the type through `declare module`:

```typescript
// src/types/extensions.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextRequest {
    user?: {
      id: string;
      email: string;
      role: string;
    };
  }
}
```

After the extension, accessing `req.user` in all routes and middleware will get type hints, without the need for `as any` assertion.

## Best Practices

### 1. Keep middleware with a single responsibility

Keep responsibilities focused. Let authentication middleware establish identity and use the `RouteOptions.auth` guard for ordinary authorization. Add custom authorization middleware when the application needs it:

```typescript
// ✅ Correct — Single responsibility
middlewares: ["auth", "check-role"];

// ❌ Avoid — One middleware does too much
middlewares: ["auth-and-role-check"];
```

<a id="2-always-await-next"></a>

### 2. Await or return `next()`

Use `await next()` when post-processing follows. With no post-processing, `return next()` also passes the Promise upstream. Do not call it and discard the Promise:

```typescript
// ✅ Correct
export default defineMiddleware(async (req, res, next) => {
  console.log("before");
  await next(); // Wait for subsequent middleware and handler to complete
  console.log("after");
});

// ❌ Error - forget await, the post logic will be executed before the handler completes
export default defineMiddleware(async (req, res, next) => {
  console.log("before");
  next(); // No await!
  console.log("after — this will be executed before the handler");
});
```

### 3. Short circuit response

To short-circuit, send a response with `res.json()` or a similar method and return, or throw with `app.throw()`. Neither path calls `next()`; merely returning does not create a response:

```typescript
export default defineMiddleware(async (req, res, next) => {
  if (!isAllowed(req)) {
    // Throw an error directly without calling next() - the request terminates here
    req.app.throw(403, "Access denied");
  }

  await next();
});
```

Since the return type of `app.throw()` is `never`, it will automatically terminate the execution flow.

### 4. Manage in configuration instead of hard coding

Avoid hardcoding configuration values inside middleware. Use factory mode to receive parameters and manage them uniformly in the configuration file:

```typescript
// ✅ Correct — parameters are managed by configuration
export default defineMiddlewareFactory<{ maxAge: number }>((options) => {
  const maxAge = options?.maxAge ?? 3600;
  return async (req, res, next) => {
    res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
    await next();
  };
});

// ❌ Avoid — hard coding
export default defineMiddleware(async (req, res, next) => {
  res.setHeader("Cache-Control", "public, max-age=3600"); // Cannot vary by environment
  await next();
});
```

## Next step

- Learn how [Plugins](/guide/plugins) register global middleware through `app.use()`

- Understand the automatic generation of [Parameter Validation](/guide/validation) middleware
- See the complete options for built-in middleware in [Configuration](/guide/configuration)
- Explore [Testing](/guide/testing) how to test middleware logic
- Check middleware Rule IDs in the [HTTP and Routing Specification](/specification/http-and-routing)

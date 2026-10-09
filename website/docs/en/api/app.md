# Application Instance

This page details the complete API of the VextJS application instance `VextApp`, including built-in modules, extension methods, life cycle hooks and startup functions.

## Find an API by task

| Goal                                                         | Entry points                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start your first application                                 | [Quick Start](/guide/quick-start); normal applications use the CLI, while [bootstrap](#bootstrap)/[createApp](#createapp) support custom orchestration |
| Use logging, configuration, Services, or databases in routes | [VextApp interface](#vextapp-interface); see [Complete usage example](#complete-usage-example) for combined usage                                      |
| Write plugins, replace implementations, or release resources | [Framework extension API](#framework-extension-api), [Life cycle hook](#life-cycle-hook)                                                               |
| Understand internal startup/testing flows                    | [AppInternals](#appinternals) and the following helpers; business code need not read these first                                                       |

The route factory's app facade exposes real application capabilities through controlled entry points and limits the lifecycle for HTTP registration. It does not copy services/config into a snapshot; request handlers retain access to those capabilities. Ownership describes which application or build process creates and releases resources/files, rather than business access permissions.

## Overview

`VextApp` is the core object of the entire VextJS application, created through `createApp(config)`. It mounts built-in capabilities such as configuration, services, logging, and error throwing, and supports plug-in extensions through methods such as `extend()` / `use()`.

Normal projects start with `npm run dev`, `npm run build`, and `npm start` from [Quick Start](/guide/quick-start); the CLI orchestrates initialization. Call `bootstrap()` or lower-level `createApp()` directly only for a custom startup flow. This page is a reference; see the complete example below for combined usage. Access `app` through:

- **Route handler**: Closure parameter of `defineRoutes((app) => { ... })`
- **Middleware**: `req.app`
- **Plugin setup**: `setup(app)` receives `VextPluginContext`
- **Service**: its `constructor(app: VextApp)` receives the app

---

## Life cycle

These are the main stages of standard HTTP `bootstrap()`. CLI development and testing helpers orchestrate their own lifecycles. A bare `createApp()` has not completed these stages:

```
Load, validate, and freeze config
  → createApp(config)         // Create base modules and runtime
  → resolveAdapter()          // Resolve HTTP adapter
  → i18n, built-in database plugin as configured
  → mount app.fetch            // Available before user plugin setup
  → plugin-loader             // User plugin setup; app.use available
  → middleware-loader         // Validate allowlist and load definitions
  → service-loader            // Inject services
  → router-loader             // Register business routes
  → frontend, OpenAPI/Docs    // Optional endpoints
  → lockUse()                 // Lock app.use
  → global chain, errors, 404 // See routing specification for order
  → server:beforeListen
  → adapter.listen()          // HTTP begins listening
  → register shutdown/fatal error handlers
  → runReady()                // Ready callbacks
  → Running...
  → SIGTERM / SIGINT
  → shutdown()                // Stop new requests, wait for in-flight work,
                              // run onClose LIFO and clean cache/logger;
                              // tests or skipExit avoid process exit
```

---

## bootstrap

`bootstrap()` is the standard startup function of the framework, arranging a complete startup process.

```typescript
import { bootstrap } from "vextjs";

await bootstrap();
```

### Function signature

```typescript
function bootstrap(rootDir?: string): Promise<BootstrapResult>;

interface BootstrapResult {
  app: VextApp;
  serverHandle: VextServerHandle;
  internals: AppInternals;
}
```

### Parameters

| Parameters | Type     | Default value   | Description            |
| ---------- | -------- | --------------- | ---------------------- |
| `rootDir`  | `string` | `process.cwd()` | Project root directory |

### Start the process

`bootstrap()` internally performs the following steps (in order):

| Step | Action                                | Meaning                                                                                                               |
| ---- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | Config load/finalize                  | default → environment → local → provider patch → CLI override; local in dev/test only, then validate and deep-freeze. |
| 2    | `createApp(config)` and runtime       | Logger, hooks, validator, response cache, optional session/rate-limit runtimes.                                       |
| 3    | `resolveAdapter()`, i18n              | Adapter and locale/error translation.                                                                                 |
| 4    | Built-in database plugin, `app.fetch` | MonSQLize only with database config; fetch before user plugins.                                                       |
| 5    | `loadPlugins()`                       | Topological user setup; build output in production.                                                                   |
| 6    | Middleware and services               | Validate middleware allowlist, load definitions, then services.                                                       |
| 7    | Routes and optional endpoints         | Business routes, frontend, OpenAPI/Docs.                                                                              |
| 8    | `lockUse()` and chain                 | Built-ins, error handler, and 404 fallback.                                                                           |
| 9    | `server:beforeListen`, listen         | Listen after the event.                                                                                               |
| 10   | Shutdown and ready                    | Register signal/fatal handlers, runReady, return result.                                                              |

See [Configuration Guide](/guide/configuration) for config conditions and [HTTP and Routing Specification](/specification/http-and-routing) for the request chain. Registration order and execution order are different.

### Typical entry file

This is a fragment for a custom startup. A CLI project needs no extra file; running TypeScript source directly requires a suitable loader, and production should use a built project.

```typescript
// src/index.ts
import { bootstrap } from "vextjs";

bootstrap().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
```

### Return value

```typescript
const { app, serverHandle, internals } = await bootstrap();
app.logger.info(
  { host: serverHandle.host, port: serverHandle.port },
  "HTTP listening",
);
// To stop manually: await internals.shutdown(serverHandle, { skipExit: true });
```

`serverHandle` exposes read-only host/port and async close(). A bind address such as `0.0.0.0` or `::` is not a public URL. Use `internals.shutdown(serverHandle, { skipExit: true })` to stop the full app; close() alone stops only the server.

---

## createApp

`createApp()` is the underlying factory function that creates `VextApp` instances and a collection of framework internal methods.

```typescript
import { createApp, DEFAULT_CONFIG } from "vextjs";

const { app, internals } = createApp(DEFAULT_CONFIG);
app.logger.info("Base app created; HTTP not listening");
await internals.shutdown(undefined, { skipExit: true });
```

### Function signature

```typescript
function createApp(config: VextConfig): {
  app: VextApp;
  internals: AppInternals;
};
```

### Return value

| Field       | Type           | Description                                         |
| ----------- | -------------- | --------------------------------------------------- |
| `app`       | `VextApp`      | User-visible application instance                   |
| `internals` | `AppInternals` | Framework internal methods (only used by bootstrap) |

:::tip
Normally there is no need to call `createApp()` directly. `bootstrap()` and `createTestApp()` have encapsulated the complete initialization process internally. Only use this function if you need to completely customize the startup process.
:::

It requires a complete `VextConfig`; it does not load/merge config, plugins, or services, or start HTTP. The adapter is unresolved and fetch is not yet mounted as a usable client. The caller owns further initialization and cleanup.

---

## VextApp interface

### Built-in modules

#### `app.logger`

Structured log instance, implemented based on Vext’s built-in logger kernel.

```typescript
logger: VextRuntimeLogger;
```

Inside an enabled request context, logs carry requestId from AsyncLocalStorage. Startup logs and others outside the scope lack that request field. Runtime supplies `trace()`, `getLevel()` / `setLevel()`, and `.child()`.

```typescript
//Basic usage
app.logger.info("Server started successfully");
app.logger.error({ userId: "123" }, "User query failed");
app.logger.debug("Debug information");
app.logger.trace("Detailed troubleshooting information");

//Adjust subsequent log thresholds at runtime
app.logger.getLevel(); // "info"
app.logger.setLevel("debug");

// Structured log (object + message)
app.logger.info(
  { event: "user_created", userId: "abc" },
  "User created successfully",
);

// Child logger (carries additional context)
const serviceLogger = app.logger.child({ service: "UserService" });
serviceLogger.info("Query user list");
// → { service: 'UserService', requestId: '...', msg: 'Query user list' }
```

**Log level method**:

| Method              | Level | Description                                                    |
| ------------------- | ----- | -------------------------------------------------------------- |
| `logger.fatal(...)` | fatal | Highest severity; calling it does not itself exit the process. |
| `logger.error(...)` | error | runtime error                                                  |
| `logger.warn(...)`  | warn  | Warning message                                                |
| `logger.info(...)`  | info  | General information (default level)                            |
| `logger.debug(...)` | debug | debug information                                              |
| `logger.trace(...)` | trace | The most granular troubleshooting information                  |

Every level accepts a message or object form, illustrated with info. Error and fatal also accept an Error object:

```typescript
// pure message
logger.info(msg: string, ...args: unknown[]): void;

// object + message
logger.info(obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;

logger.error(err: Error, msg?: string, ...args: unknown[]): void;
logger.fatal(err: Error, msg?: string, ...args: unknown[]): void;
```

**`getLevel()` / `setLevel(level)`**:

```typescript
getLevel(): "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
setLevel(level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent"): void;
```

`setLevel()` only affects subsequent logs; created child loggers share the current runtime level with the parent logger. The default logger does not provide a writable `app.logger.level` property.

**`child(bindings)`**:

```typescript
child(bindings: Record<string, unknown>): VextRuntimeLogger;
```

Create a child logger with additional context fields. All logs output through child loggers will automatically have the fields in `bindings` appended.

```typescript
// Create a dedicated logger in a service.
import type { VextApp, VextLogger } from "vextjs";

class UserService {
  private logger: VextLogger;

  constructor(app: VextApp) {
    this.logger = app.logger.child({ service: "UserService" });
  }

  async findById(id: string) {
    this.logger.info({ userId: id }, "Query user");
    // → { service: 'UserService', userId: '123', requestId: '...', msg: 'Query user' }
  }
}
```

---

#### `app.throw(status, message, paramsOrCode?, codeOrDetails?)`

When an HTTP error is thrown, the framework uniformly converts it to a standard error response. Three calling forms are supported.

:::info When to use `app.throw()`
`app.throw()` is suitable for scenarios where "I want to actively return a clear HTTP error to the caller", such as `401`, `404`, `409` or a response with a business error code.

For an unexpected runtime exception, `throw new Error("...")` is also caught but becomes an unknown `500 Internal Server Error`. For field-level validation details, throw `VextValidationError`.
:::

**Function signature**:

```typescript
// Shortcut (i18n key, status read from i18n configuration, default 400)
throw(messageKey: string): never;
throw(messageKey: string, params: Record<string, unknown>): never;

// Complete object entry
throw(options: {
  status: number;
  message: string;
  params?: Record<string, unknown>;
  code?: number | string;
  details?: unknown;
}): never;

// Standard call (explicitly specify HTTP status code)
throw(
  status: number,
  message: string,
  paramsOrCode?: Record<string, unknown> | number | string,
  codeOrDetails?: number | string | Record<string, unknown> | unknown[],
): never;
```

---

##### Shortcut (recommended for i18n scenarios)

When the first parameter is a **string**, it is regarded as an i18n key shortcut call. The HTTP status code is read from the `statusCode` field configured in the i18n language package. If not configured, the default is `400`:

```typescript
// The shortest way - status is read from i18n configuration, default is 400
app.throw("balance.insufficient");

//With i18n interpolation parameters
app.throw("balance.insufficient", { balance: 50, required: 100 });

// i18n configuration specifies statusCode: 404 → automatically uses 404
app.throw("user.not_found");
```

**Status parsing rules for shortcuts**:

| Priority | Source                                | Description                                              |
| :------: | ------------------------------------- | -------------------------------------------------------- |
|    1     | `statusCode` in i18n language package | If `user.not_found` is configured with `statusCode: 404` |
|    2     | Default value `400`                   | Base value when `statusCode` is not configured           |

**Business error code of shortcut**: If the i18n language package is configured with an independent `code` for the key (different from the key itself), it will be automatically appended to the response.

---

##### Standard call

When the first parameter is a number, as an HTTP status code, the behavior is exactly the same as before:

```typescript
// simple error
app.throw(404, "User does not exist");

//With business error code (number)
app.throw(400, "Email has been registered", 10001);

//With business error code (string)
app.throw(401, "Missing authentication token", "UNAUTHORIZED");

//With i18n parameter
app.throw(400, "balance.insufficient", { balance: 50 });

// Bring i18n parameters and business code at the same time
app.throw(400, "balance.insufficient", { balance: 50 }, 20001);

// When the fourth parameter is an object or array, it is output as details
app.throw(
  502,
  "payment.failed",
  { orderId },
  {
    provider: "stripe",
    providerCode: "card_declined",
  },
);

// When code + details are required at the same time, use the object entry
app.throw({
  status: 502,
  message: "payment.failed",
  code: "PAYMENT_FAILED",
  details: { provider: "stripe", providerCode: "card_declined" },
});
```

**Standard calling parameters**:

| Parameters      | Type                                                       | Description                                                                                                   |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `status`        | `number`                                                   | HTTP status code (400/401/403/404/409/500…)                                                                   |
| `message`       | `string`                                                   | Error description (also looked up as i18n key)                                                                |
| `paramsOrCode`  | `Record<string, unknown> \| number \| string`              | i18n interpolation parameter object or business error code                                                    |
| `codeOrDetails` | `number \| string \| Record<string, unknown> \| unknown[]` | When the fourth parameter is number/string, it is the business code; when it is object/array, it is `details` |

`details` can hold caller-visible upstream error codes, messages, trace IDs, or other business fields. JSON-safe cleaning turns cycles or repeated object references into `"[Circular]"`, Date into ISO strings, and Error into name/message. Object properties containing functions or undefined are omitted; array positions containing them become null. Prefer `HttpError` or `app.throw` for explicit details. Normalization also reads an explicitly attached `details` field on an ordinary exception but does not expose the entire exception object. `hideInternalErrors` does not filter arbitrary custom details; see [Error Handling: Details](/guide/error-handling#details).

---

##### i18n linkage

`message` (or `messageKey` for shortcuts) also serves as the i18n key for language pack lookup. The framework obtains the `locale` of the current request through AsyncLocalStorage and automatically translates the error message:

```typescript
// standard call
app.throw(404, "user.not_found");

// Shortcut (same effect, provided statusCode: 404 is in i18n configuration)
app.throw("user.not_found");

// Chinese environment → { code: 404, message: '用户不存在' }
// English environment → { code: 404, message: 'User not found' }
```

When there is no i18n language pack, it degrades to the original message and is passed directly.

**Error response format**:

```json
{
  "code": 10001,
  "message": "Email has been registered",
  "details": {
    "provider": "stripe",
    "providerCode": "card_declined"
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

:::tip
`app.throw()` returns `never` and throws at runtime. TypeScript narrowing around nested properties can be limited; `return this.app.throw(404, "User not found")` makes the subsequent branch explicitly handle only an existing user.
:::

---

#### `app.config`

Final merged runtime configuration (read-only).

```typescript
config: Readonly<VextConfig>;
```

Standard startup loads `default → environment config → local → bootstrap provider patch → CLI override` and deeply freezes the final configuration. Production does not load `local`. A direct `createApp(config)` call does not apply that configuration-loading chain to an arbitrary object.

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/info", {}, async (_req, res) => {
    res.json({
      port: app.config.port,
      adapter: typeof app.config.adapter,
      corsEnabled: app.config.cors.enabled,
    });
  });
});
```

:::warning
The standard startup freezes `app.config` at runtime. An attempt to modify it throws in strict mode or fails silently. For application-owned dynamic state, mount a separate object with `app.extend()` during plugin setup.
:::

---

#### `app.services`

All service instances injected by `service-loader`.

```typescript
services: VextServices;
```

Access instances through `app.services.<name>`. In standard startup, services load before routes, so handlers can use registered services. Plugin setup does not yet have every service, and service constructors cannot assume that other services have already been instantiated. Make cross-service calls in methods or `onReady`.

```typescript
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  constructor(private app: VextApp) {}

  async findById(id: string) {
    // ...
  }
}

// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", async (req, res) => {
    const user = await app.services.user.findById(req.params.id);
    res.json(user);
  });
});
```

The CLI generates `VextServices` types for resolvable services. Declare them manually only for custom loading or other cases the generator cannot resolve, and include the declaration in `tsconfig`:

```typescript
// types/vext.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextServices {
    user: import("../src/services/user.js").default;
  }
}
```

---

#### `app.hooks`

Framework lifecycle hook manager for registering runtime observations, lightweight patches, and cross-module integration logic.

```typescript
hooks: VextHooks;

type Off = () => void;

app.hooks.on(name, handler): Off;
app.hooks.has(name): boolean;
```

`app.hooks.on()` returns an unsubscribe function. `app.hooks` is reserved and cannot be overridden with `app.extend("hooks", ...)`.

```typescript
const off = app.hooks.on("validation:success", ({ req, route }) => {
  app.logger.info(
    { requestId: req.requestId, route: route.path },
    "validated request",
  );
});

app.hooks.on("response:before", ({ headers }) => ({
  headers: { ...headers, "x-powered-by": "vext" },
}));

off(); // No later validation:success events; the other listener remains active.
```

**Execution strategy**:

| Hook events                                                                                                                                                                        | Promise             | Listener errors                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- |
| `request:start` (matched=true), `route:matched`, `validation:success`, `handler:before`, `fetch:before`, `proxy:before`, user `plugin:beforeSetup`, `server:beforeListen`          | Awaited if returned | Propagate and stop the following step                           |
| `response:before`, `service:beforeCall`                                                                                                                                            | Not allowed         | Propagate and stop the following step                           |
| `request:start` (404 with matched=false), `route:notFound`, `validation:error`, `handler:after/error`, `fetch:after/error`, `proxy:after/error`, `routes:ready`, `app:ready/close` | Awaited if returned | Safe notification: log the error and continue the original flow |
| `response:after`, `error:beforeResponse/afterResponse`, `service:loaded/reloaded/afterCall/error`, `cache:*`, `plugin:afterSetup/error`, `openapi:*`                               | Not allowed         | Safe synchronous notification                                   |

Slashes in this table abbreviate multiple events; register each full event name. The built-in MonSQLize `plugin:beforeSetup` notification runs in its own safe synchronous initialization path. A safe listener may still be awaited when the event supports async handlers, and does not imply that the business operation succeeds. Synchronous events must not return a Promise. See [Hooks: Execution strategy](/guide/hooks#execution-strategy) for multi-listener, patch, and error behavior.

**Available hooks**:

| Name                                                      | Trigger Point                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `request:start`                                           | Global request-hook position after request metadata, requestId, and authentication context; also runs for 404 with `matched=false`   |
| `route:matched`                                           | After the adapter matches the route and before validation and the handler                                                            |
| `route:notFound`                                          | No route matching, 404 response before sending                                                                                       |
| `validation:success`                                      | Route `validate` all passed, before `next()`                                                                                         |
| `validation:error`                                        | Route `validate` fails and throws `VextValidationError` before                                                                       |
| `handler:before`                                          | Before the business handler is called                                                                                                |
| `handler:after`                                           | After the handler returns and the framework-tracked response sending flow completes; streaming waits for closure, not client receipt |
| `handler:error`                                           | After the business handler throws an error and before entering global error handling                                                 |
| `response:before`                                         | Runs before `json/rawJson/text/html/render/stream/download/redirect`; synchronously patches `data/status/headers`                    |
| `response:after`                                          | After the response is sent                                                                                                           |
| `error:beforeResponse`                                    | `error-handler` can synchronize patch `body/status` before writing JSON error response                                               |
| `error:afterResponse`                                     | After the error response is sent                                                                                                     |
| `fetch:before`                                            | Before an outbound `app.fetch`; may modify `Headers`                                                                                 |
| `fetch:after`                                             | After `app.fetch` returns a `Response`, including HTTP error statuses                                                                |
| `fetch:error`                                             | When the actual request/retry flow ends due to network error, timeout, or cancellation                                               |
| `proxy:before`                                            | `app.fetch.proxy` After parsing the upstream request and before sending it                                                           |
| `proxy:after`                                             | `app.fetch.proxy` after receiving the upstream response and before passing it to the caller                                          |
| `proxy:error`                                             | `app.fetch.proxy` on local error, timeout or upstream network failure                                                                |
| `service:loaded`                                          | After service is loaded and mounted during cold start                                                                                |
| `service:reloaded`                                        | dev soft reload after re-instantiating service                                                                                       |
| `service:beforeCall`                                      | Before a framework-wrapped service prototype method; excludes instance arrow functions and getters                                   |
| `service:afterCall`                                       | After the service method returns successfully                                                                                        |
| `service:error`                                           | After the service method throws an error or rejects                                                                                  |
| `cache:hit`, `cache:miss`, `cache:write`, `cache:error`   | Route-level response cache read and write life cycle                                                                                 |
| `plugin:beforeSetup`, `plugin:afterSetup`, `plugin:error` | Plugin `setup()` before and after and failure; plugins cannot observe their own `beforeSetup`                                        |
| `routes:ready`                                            | After route scanning and registration are completed                                                                                  |
| `openapi:beforeGenerate`, `openapi:afterGenerate`         | Before and after OpenAPI document generation; `afterGenerate` can replace document synchronously                                     |
| `server:beforeListen`                                     | Before HTTP server starts listening                                                                                                  |
| `app:ready`                                               | `onReady` before and after execution                                                                                                 |
| `app:close`                                               | `onClose`/shutdown before and after execution                                                                                        |

`app:ready` and `app:close` distinguish the two stages with `phase: "before" | "after"`. A listener sees only events after it is registered; it cannot replay completed built-in plugin initialization. A listener removed in `onClose` will not see the closing after phase.

:::tip
If you only want to record "requests that pass parameter verification", use `validation:success`. In this way, requests that fail verification will not enter this hook, which is more direct than manually excluding `VextValidationError` in ordinary global middleware.
:::

---

#### `app.cache`

Route-level response cache management API. Initialized in the `createApp` stage, it provides operations such as label invalidation, specified key deletion, clearing, and statistics.

```typescript
cache: {
  invalidate(tag: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): VextCacheStats;
};
```

| Method            | Description                                                                             |
| ----------------- | --------------------------------------------------------------------------------------- |
| `invalidate(tag)` | Batch invalidate all associated cache entries by tag                                    |
| `delete(key)`     | Delete the cache of the specified key                                                   |
| `clear()`         | Clear all entries in the current vext response cache namespace                          |
| `stats()`         | Return cache statistics (number of entries, number of hits, number of misses, hit rate) |

```typescript
// Fragment inside defineRoutes: application code performs the product write.
app.post("/products", {}, async (req, res) => {
  // Complete the product write first, then invalidate related cache entries.
  await app.cache.invalidate("products");
  res.json({ created: true }, 201);
});

// View cache statistics.
app.get("/admin/cache-stats", {}, async (req, res) => {
  res.json(app.cache.stats());
});
```

`VextCacheStats` includes `entries`, `hits`, `misses`, `hitRate`, and underlying statistics. `app.cache` is Vext's control surface wrapper for `response-cache-kit`; business code does not need to directly operate the underlying Store. In Redis/MultiLevel mode, `clear()` only clears the current Vext response-cache namespace, not the entire Redis database. On shutdown, Vext closes the response-cache runtime after the user's `onClose` hook. See the [Response Caching Guide](/guide/cache).

---

#### `app.db`

The single database entry point. When `config.database` is present, Vext mounts
the exact raw `MonSQLize` instance here; without database configuration the
property remains unavailable.

```typescript
db?: VextDatabase; // MonSQLize plus Vext's read-only client getter
```

`app.db` is not a facade or Proxy, so the complete upstream instance API is
available: `collection()`, `model()`, `use()`, `pool()`, `scopedModel()`,
`withTransaction()`, `sync()`, events, diagnostics, and management methods.
Vext v2 does not expose a second `app.monsqlize` property.

```typescript
const users = app.db?.collection("users");
const User = app.db?.model("users");
const Invoice = app.db?.use("billing").model("BillingInvoice");
const session = app.db?.client.startSession();
```

Model registry keys are exact. `use()` and `pool()` select a database or pool
scope but never prepend scope names or fall back to a transformed key. A short
name is valid only when the Model explicitly registered that `key` alias. Vext
owns connection cleanup during graceful shutdown; application code should not
close `app.db` in a second `onClose` hook. Use a separate extension name for application-owned SQL resources instead of overwriting this property. See the [Database Guide](/guide/database).

---

#### `app.fetch`

The built-in HTTP client has type `VextFetch`. Standard startup mounts it before user plugin setup, with outbound requests, requestId propagation, structured logging, and proxy support. A bare `createApp()` return value has not mounted it yet.

```typescript
const response = await app.fetch("https://example.com/api/status");
if (!response.ok) {
  app.throw(502, "Upstream request failed");
}
```

Replace the example URL with your upstream. See the [Fetch API](/api/fetch) for options, timeout, retries, shortcuts, and `proxy`, and the [Fetch guide](/guide/fetch) for integration. The fetch function supplied to a `defineRoutes` factory is bound: `app.fetch(url, init)` works there, but attached methods such as `get`, `create`, and `proxy` are not retained. Use `req.app.fetch` inside a handler for those methods. Plugin setup and services receive the actual app.

---

#### `app.adapter`

The underlying adapter instance (mounted after being resolved by `resolveAdapter()`).

```typescript
adapter: VextAdapter;
```

:::warning
This is a framework internal property and user code usually does not need to manipulate the adapter directly. The framework registers middleware, routing, error handling, etc. through adapter.
:::

---

### HTTP method

The HTTP methods on `VextApp` (`get/post/put/patch/delete/head/options`) are **placeholder methods** and cannot be called directly. The actual route registration is done through `defineRoutes`.

```typescript
// ❌ Calling it directly on the app will throw an error
app.get("/hello", handler);
// Error: [vextjs] app.get() cannot be called directly on the app instance.
// Use defineRoutes(app => { app.get(...) }) in route files.

// ✅ Register via defineRoutes
export default defineRoutes((app) => {
  app.get("/hello", handler); // OK — app here is collector
});
```

Supports **three-paragraph** and **two-paragraph** two syntaxes:

```typescript
// Three-part formula: (path, options, handler)
app.get(
  "/users",
  {
    validate: { query: { page: "number:1-" } },
  },
  handler,
);

//Two paragraphs: (path, handler)
app.get("/health", handler);
```

Supported methods: `get` / `post` / `put` / `patch` / `delete` / `head` / `options`

---

### Framework extension API

Configure these methods in plugin setup. `app.use()` has a defined setup window and lock check; do not assume that every `set*` method has the same runtime check. Plugin context is tied to setup lifecycle. After setup, work through registered callbacks instead of mutating a retained context asynchronously.

#### `app.extend(key, value)`

Mount a custom property on the app, usually during plugin setup.

```typescript
extend<K extends keyof VextApp>(key: K, value: VextApp[K]): void;
extend<K extends string, V>(key: K extends keyof VextApp ? never : K, value: V): void;
```

```typescript
// Mount in a plugin.
import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  featureFlags: Map<string, boolean>;
}>();

export default definePlugin({
  name: "feature-flags",
  setup(app) {
    const flags = new Map<string, boolean>([["search", true]]);
    app.extend("featureFlags", flags);
    app.onClose(() => flags.clear());
  },
});
```

`defineAppExtensions` provides an explicit static declaration so CLI type generation can type `app.featureFlags`. For custom loading that the generator cannot resolve, declare the property manually instead. Do not maintain conflicting declarations for the same property:

```typescript
// types/vext.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextApp {
    featureFlags: Map<string, boolean>;
  }
}

// In application code: app.featureFlags.get("search")
```

The key must be a nonempty valid JavaScript identifier. It cannot be reserved by the framework, shadow an inherited property, or overwrite an existing property. A repeated `extend` does not replace the previous value. Declared keys also check the value type; declaring a type alone does not create a runtime property.

---

#### `app.use(middleware)`

Register global HTTP middleware (**plugin-specific**).

```typescript
use(middleware: VextMiddleware): void;
```

Effective for all routes, executed before route-level middlewares. It can only be called in plug-in `setup()`. The call will throw an error after the route registration is completed.

```typescript
import { definePlugin, securityHeaders } from "vextjs";

export default definePlugin({
  name: "security",
  setup(app) {
    app.use(securityHeaders({ preset: "strict" }));
  },
});
```

For app-wide browser security headers, prefer `config.securityHeaders` because it also covers errors, 404 responses, testing helpers, and dev soft reload. Manual `app.use(securityHeaders())` is a scoped plugin entry.

:::warning
`app.use()` will be locked after route registration (`router-loader`) is completed. Calls after this will throw an error:

```
[vextjs] app.use() is locked after route registration.
Global middleware must be registered in plugin setup().
```

:::

---

#### `app.setValidator(validator)`

Replace the global validation engine (**Plug-in only**).

```typescript
setValidator(validator: VextValidator): void;
```

The default is `schema-dsl`. For this Zod example, install `zod` in the application first (`npm install zod`), then add the plugin. Vext's compile and validation functions are synchronous and cannot support refinements or transforms requiring `safeParseAsync()`. See the [official Zod basics](https://zod.dev/basics).

```typescript
import { definePlugin } from "vextjs";
import { z } from "zod";

export default definePlugin({
  name: "zod-validator",
  setup(app) {
    const originalValidator = app.getValidator();

    app.setValidator({
      compile(schema) {
        const toVextResult = (result: ReturnType<z.ZodType["safeParse"]>) =>
          result.success
            ? { valid: true, data: result.data }
            : {
                valid: false,
                errors: result.error.issues.map((issue) => ({
                  field: issue.path.join("."),
                  message: issue.message,
                })),
              };

        if (schema instanceof z.ZodType) {
          return (data) => toVextResult(schema.safeParse(data));
        }

        const fields = Object.entries(schema);
        const zodFields = fields.filter(
          ([, value]) => value instanceof z.ZodType,
        );
        if (zodFields.length > 0 && zodFields.length !== fields.length) {
          throw new Error("Cannot mix Zod and schema-dsl fields in one object");
        }
        if (zodFields.length > 0) {
          const zodShape = Object.fromEntries(zodFields) as Record<
            string,
            z.ZodType
          >;
          const zodSchema = z.object(zodShape);
          return (data) => toVextResult(zodSchema.safeParse(data));
        }

        return originalValidator.compile(schema);
      },
    });
  },
});
```

When calling the public `compile(Record<string, unknown>)` interface directly, use a field object. An all-Zod object goes to Zod, a pure DSL object goes to the original validator, and mixed fields fail during compilation instead of silently skipping validation. The adapter also retains a runtime branch for receiving a whole Zod schema. Replacing the engine affects subsequent compilation only; cached validators are not automatically recompiled.

`setValidator()` does not extend the public `RouteOptions.validate` type. Placing Zod fields directly into route validation currently causes a type error. This supported example validates non-HTTP service input; HTTP routes can keep DSL fields, which this plugin delegates to the original engine. Runtime compatibility does not imply route type inference support.

```typescript
// In an application using the plugin above: src/services/message.ts
import { VextValidationError, type VextApp, type VextValidator } from "vextjs";
import { z } from "zod";

export default class MessageService {
  private validate: ReturnType<VextValidator["compile"]>;

  constructor(app: VextApp) {
    this.validate = app.getValidator().compile({ name: z.string().min(1) });
  }

  async accept(input: unknown) {
    const result = this.validate(input);
    if (!result.valid) {
      throw new VextValidationError(result.errors ?? []);
    }
    return result.data;
  }
}
```

---

#### `app.getValidator()`

Get the current global verification engine instance.

```typescript
getValidator(): VextValidator;
```

The default validator is implemented based on schema-dsl. Plug-ins can replace it with Zod, Yup, etc. implementations through `app.setValidator()`, so `getValidator()` is not equivalent to a fixed schema-dsl, but always returns the currently valid validator.

```typescript
const validator = app.getValidator();
const validate = validator.compile({ name: "string:1-50" });
const result = validate({ name: "Alice" });
// { valid: true, data: { name: 'Alice' } }
```

It can also be reused when handling non-HTTP input in the service:

```typescript
import { VextValidationError, type VextApp, type VextValidator } from "vextjs";

export default class UserService {
  private validateCreateUser: ReturnType<VextValidator["compile"]>;

  constructor(private app: VextApp) {
    this.validateCreateUser = app.getValidator().compile({
      name: "string:1-50!",
      email: "email!",
    });
  }

  async createFromMessage(input: unknown) {
    const result = this.validateCreateUser(input);
    if (!result.valid) {
      throw new VextValidationError(result.errors ?? []);
    }
    return result.data;
  }
}
```

---

#### `app.setThrow(wrapper)`

Wraps or replaces the implementation of `app.throw` (**Plugin-specific**).

```typescript
setThrow(wrapper: (original: VextApp['throw']) => VextApp['throw']): void;
```

Receives the original `throw` implementation and returns one preserving every overload and the `never` behavior. The example logs calls and forwards every argument. Wrapping only four positional arguments would break the i18n shortcut and object form. The error handler still determines the response body.

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "error-tracking",
  setup(app) {
    const logger = app.logger;
    app.setThrow(
      (originalThrow) =>
        new Proxy(originalThrow, {
          apply(target, thisArg, args) {
            logger.debug("app.throw called");
            return Reflect.apply(target, thisArg, args);
          },
        }),
    );
  },
});
```

---

#### `app.setLogger(wrapper)`

Wraps or replaces the implementation of `app.logger` (**Plugin-specific**).

```typescript
setLogger(wrapper: (original: VextRuntimeLogger) => VextLoggerLike): void;
```

Receives the full runtime logger and returns a full or partial replacement. Missing methods fall back to the original logger. If you do not customize `child`, the framework reapplies the wrapper to the original child logger, retaining bindings and wrapping behavior. The wrapper factory may run multiple times; do not create connections repeatedly inside it.

```typescript
import { definePlugin } from "vextjs";
export default definePlugin({
  name: "info-log-counter",
  setup(app) {
    let infoCalls = 0;
    const logger = app.logger;
    app.setLogger((original) => ({
      info(...args: unknown[]) {
        infoCalls += 1;
        Reflect.apply(original.info, original, args);
      },
    }));
    app.onClose(() => logger.info({ infoCalls }, "info call count"));
  },
});
```

:::tip
This counts calls to the wrapped `info`, not log entries actually written (level filtering still applies). To forward to an external log system, use a real client and handle flushing and shutdown. Explicitly returning `child: bindings => original.child(bindings)` does not automatically reapply your forwarding methods to child loggers.
:::

---

#### `app.setRateLimiter(limiter)`

Replaces global rate limiting implementation (**plugin-specific**).

```typescript
setRateLimiter(limiter: VextRateLimiter): void;
```

This replaces the implementation but **does not enable rate limiting**; configure `rateLimit.enabled: true` too. The default `flex-rate-limit` implementation already supports a Redis store. If you only need shared rate-limit storage, use the [rate-limit configuration](/guide/rate-limit). The following fragment integrates an application-owned implementation exported from `src/shared/rate-limiter.ts`; that module must satisfy `VextRateLimiter`, and the application owns connection shutdown.

```typescript
import { definePlugin } from "vextjs";
import { distributedLimiter } from "../shared/rate-limiter.js";

export default definePlugin({
  name: "custom-rate-limit",
  setup(app) {
    app.setRateLimiter(distributedLimiter);
  },
});
```

**VextRateLimiter interface**:

```typescript
interface VextRateLimiter {
  check(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number; // Absolute Unix timestamp in seconds.
  }>;
}
```

`resetAt` is neither milliseconds nor seconds remaining. Middleware calculates the remaining seconds for `RateLimit-Reset` and `Retry-After` from it. A custom `check` receives only the key, not the route max/window, so the application must define its own quota policy. The framework middleware still decides whether the route disables limiting, generates the key, and sends response headers; `RateLimit-Limit` comes from the effective configuration.

---

#### `app.setRequestIdGenerator(generate)`

Override requestId generation algorithm (**Plugin-specific**).

```typescript
setRequestIdGenerator(generate: () => string): void;
```

The default is `crypto.randomUUID()`. The generator runs only when there is no nonempty inbound requestId. Precedence is the plugin generator, `config.requestId.generate`, then the default UUID. It is not called when requestId is disabled.

```typescript
import { definePlugin } from "vextjs";
import { randomUUID } from "node:crypto";

export default definePlugin({
  name: "prefixed-request-id",
  setup(app) {
    app.setRequestIdGenerator(() => `api-${randomUUID()}`);
  },
});
```

It can also be set statically through the configuration file:

```typescript
// src/config/default.ts
import { randomUUID } from "node:crypto";

export default {
  requestId: {
    generate: () => `api-${randomUUID()}`,
  },
};
```

Generated values and forwarded inbound headers must be strings of 1–512 characters without control characters, or validation throws. To use Nano ID or Snowflake, install and wire in the corresponding implementation. This API does not create an APM trace automatically.

---

### Life cycle hook

#### `app.onReady(handler)`

Register a readiness hook. In standard HTTP startup it runs after listening begins. Register it before readiness processing starts; custom test orchestration controls when it runs.

```typescript
onReady(handler: () => Promise<void> | void): void;
```

Suitable for: preheating cache, checking external dependencies, printing startup information, etc.

```typescript
const logger = app.logger;
app.onReady(async () => {
  // warmupCache is provided by the application.
  await warmupCache();
  logger.info("Cache warm-up completed");
});

app.onReady(() => {
  logger.info("Application initialization completed");
});
```

**Execution Rules**:

- All `onReady` hooks are executed **sequentially** in the order in which they were registered (not in parallel)
- Automatically clear the hooks array and release the closure reference after execution is completed
- Errors thrown in a hook are caught and logged without stopping the service.
- Registering after readiness starts throws; a never-settling Promise blocks later readiness steps.
- Listening has already started, so initialization required before serving traffic belongs in an earlier stage such as setup.

---

#### `app.onClose(handler)`

Register a shutdown hook. Standard shutdown executes hooks in **LIFO** order. SIGTERM/SIGINT, manual shutdown, and cleanup after failed initialization can all start it. If user plugin setup fails or times out, hooks registered by that setup attempt are rolled back; the plugin must release external resources created during that attempt itself. Previously initialized resources retain their own cleanup paths. See [Plugin lifecycle](/guide/plugins).

```typescript
onClose(handler: () => Promise<void> | void): void;
```

Applicable to: closing application-owned connections, refreshing log buffers, canceling scheduled tasks, etc. Vext's built-in database plugin closes `app.db` automatically.

```typescript
// Fragment inside the plugin that created this timer.
const healthCheckTimer = setInterval(() => {}, 30_000);
app.onClose(() => {
  clearInterval(healthCheckTimer);
});

// For an application-owned Redis connection, register async () => { await redis.quit(); }.
// The plugin must create or obtain that connection by contract; avoid closing a shared resource twice.
```

**Execution Rules**:

- Executed in **LIFO** (last in, first out) order - hooks registered later are executed first
- Each hook has an independent try/catch, and the failure of a single hook does not affect other hooks
- Automatically clear the hooks array and release resource references after execution is completed
- Registration after shutdown begins fails; all closing steps share one `shutdown.timeout` deadline, so a callback cannot block forever.

**LIFO sequential design reasons**:

Resources should be destroyed in the reverse order of creation. For example: connect to the database first, and then create a cache based on the database. When closing, you should first close the cache and then close the database.

```typescript
//Registration order
app.onClose(closeDatabase); // first registration
app.onClose(closeCache); // Second registration

// Execution order (LIFO)
// 1. closeCache() ← The ones registered later are executed first.
// 2. closeDatabase() ← Register first and then execute
```

---

## AppInternals

The internal methods returned by `createApp()` are used by framework startup, development mode, and test orchestration. Ordinary application code uses public lifecycle methods. Custom orchestration takes responsibility for initialization and cleanup.

```typescript
interface AppInternals {
  lockUse(): void;
  enterPluginSetup(): void;
  exitPluginSetup(): void;
  runReady(): Promise<void>;
  getGlobalMiddlewares(): VextMiddleware[];
  getRateLimiter(): VextRateLimiter | null;
  getRequestIdGenerator(): (() => string) | null;
  shutdown(
    serverHandle?: VextServerHandle,
    options?: { skipExit?: boolean },
  ): Promise<void>;
}
```

| Method                                     | Description                                                      |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `lockUse()`                                | Lock `app.use()`, called after routing registration is completed |
| `enterPluginSetup()` / `exitPluginSetup()` | Enter/exit the setup window for registering global middleware    |
| `runReady()`                               | Execute all `onReady` hooks                                      |
| `getGlobalMiddlewares()`                   | Get the global middleware list                                   |
| `getRateLimiter()`                         | Get a custom rate limiter                                        |
| `getRequestIdGenerator()`                  | Get custom requestId generator                                   |
| `shutdown()`                               | Trigger graceful shutdown process                                |

### shutdown process

```typescript
async shutdown(
  serverHandle?: VextServerHandle,
  options?: { skipExit?: boolean },
): Promise<void>;
```

1. **Idempotence**: An in-progress shutdown shares one Promise; calls after shutdown has completed return immediately.
2. **One deadline**: Start a single absolute deadline of `config.shutdown.timeout` seconds and emit the `app:close` before notification.
3. **Server**: If a server handle exists, stop accepting requests and wait for in-flight requests.
4. **Cleanup**: Run `onClose` in LIFO order, close the response cache, emit the `app:close` after notification, then close the logger.
5. **Timeout and exit**: After the deadline, still invoke cleanup that has not started but do not wait indefinitely. Normal completion exits with code 0; `_testMode` and `skipExit` skip exit. A server-close failure is thrown to the caller after other cleanup; the signal handler treats it as exit code 1.

---

## DEFAULT_CONFIG

The framework has built-in default configuration constants that can be used for reference or quick start:

```typescript
import { DEFAULT_CONFIG } from "vextjs";
```

See [Configuration API — DEFAULT_CONFIG](/api/config) for complete details.

---

## setupShutdown

Independent signal processing registration function, automatically called internally by `bootstrap`.

```typescript
import { setupShutdown } from "vextjs";

const cleanupSignals = setupShutdown({
  internals,
  serverHandle,
  logger: app.logger,
  testMode: app.config._testMode,
});
```

This is a fragment for custom startup orchestration: `internals`, `serverHandle`, and `app` must come from an existing startup flow. Do not register it again after standard `bootstrap`. The returned `cleanupSignals()` removes this registration; it does not shut down the server or resources. Test mode does not register signals. When an IPC channel exists, it also listens for shutdown messages to support Windows child processes.

---

## Auxiliary factory function

### definePlugin

Recommended way to create a `VextPlugin`. Use `defineAppExtensions` for static declarations of extension properties; see the [Plugin API](/api/plugin-api).

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "my-plugin",
  async setup(app) {
    // ...
  },
});
```

### defineRoutes

Core function to create routing files. See [route-definition](/api/route-definition).

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/hello", {}, async (_req, res) => {
    res.json({ message: "Hello!" });
  });
});
```

### defineMiddleware / defineMiddlewareFactory

Helpers for middleware. The following fragments represent two separate files, each with one default export. See the [Plugin API](/api/plugin-api#definemiddleware).

```typescript
import { defineMiddleware, defineMiddlewareFactory } from "vextjs";

// Middleware without configuration.
export default defineMiddleware(async (req, res, next) => {
  // ...
  await next();
});

// Configurable middleware factory.
export default defineMiddlewareFactory((options) => {
  return async (req, res, next) => {
    // Use options...
    await next();
  };
});
```

---

## Type import

```typescript
import type {
  VextApp,
  VextConfig,
  VextUserConfig,
  VextServices,
  VextLogger,
  VextRuntimeLogger,
  VextLoggerLike,
  VextCacheStats,
  VextFetch,
  VextHooks,
  VextRateLimiter,
  VextValidator,
} from "vextjs";

import type { AppInternals, BootstrapResult } from "vextjs";
```

---

## Complete usage example

This example uses a plugin for in-memory storage, a service for user operations, and routes consuming validated input. It needs no database or third-party plugin. Data is lost when the process exits and the endpoints are public; add persistence and authorization for production as described in the respective guides.

Start with the TypeScript project in [Quick start](/guide/quick-start), retaining its dev/build/start scripts and `.vext/types` in `tsconfig`. The following four files form a standalone example; do not stack them on top of another `user` service or `users` route.

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: "native",
  frontend: { enabled: false },
  logger: { level: "info" },
} satisfies VextUserConfig;
```

### Plugin development

```typescript
// src/plugins/demo-users.ts
import { defineAppExtensions, definePlugin } from "vextjs";

export type DemoUser = { id: string; name: string; email: string };

export const appExtensions = defineAppExtensions<{
  demoUsers: Map<string, DemoUser>;
}>();

export default definePlugin({
  name: "demo-users",
  setup(app) {
    const users = new Map<string, DemoUser>([
      ["1", { id: "1", name: "Alice", email: "alice@example.com" }],
    ]);
    const logger = app.logger;
    app.extend("demoUsers", users);
    app.onReady(() => {
      logger.info({ count: users.size }, "User store ready");
    });
    app.onClose(() => {
      users.clear();
      logger.info({ count: users.size }, "User store cleared");
    });
  },
});
```

### Service Development

```typescript
// src/services/user.ts
import { randomUUID } from "node:crypto";
import type { VextApp } from "vextjs";

export default class UserService {
  constructor(private app: VextApp) {}

  async findAll({ page, limit }: { page: number; limit: number }) {
    return [...this.app.demoUsers.values()].slice(
      (page - 1) * limit,
      page * limit,
    );
  }

  async findById(id: string) {
    const user = this.app.demoUsers.get(id);
    if (!user) {
      return this.app.throw(404, "User not found");
    }

    return user;
  }

  async create(data: { name: string; email: string }) {
    const existing = [...this.app.demoUsers.values()].some(
      (user) => user.email === data.email,
    );
    if (existing) {
      return this.app.throw(409, "Email already registered", 10001);
    }

    const user = { id: randomUUID(), ...data };
    this.app.demoUsers.set(user.id, user);
    return user;
  }
}
```

### Routing development

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/list",
    {
      validate: {
        query: { page: "number:1-", limit: "number:1-100" },
      },
      docs: {
        summary: "User list",
      },
    },
    async (req, res) => {
      const { page = 1, limit = 20 } = req.valid("query");
      const users = await app.services.user.findAll({ page, limit });
      res.json(users);
    },
  );

  app.get(
    "/:id",
    {
      validate: { param: { id: "string:1-!" } },
      docs: { summary: "Get user details" },
    },
    async (req, res) => {
      const user = await app.services.user.findById(req.valid("param").id);
      res.json(user);
    },
  );

  app.post(
    "/",
    {
      validate: {
        body: { name: "string:1-50!", email: "email!" },
      },
      docs: { summary: "Create user" },
    },
    async (req, res) => {
      const user = await app.services.user.create(req.valid("body"));
      res.json(user, 201);
    },
  );
});
```

### Run and observe

```bash
npm run dev
```

The CLI generates extension and service types. Once ready and the listening address appear, make requests from another terminal. The plugin logs its initial count of 1 during `onReady`; a CLI startup summary may collapse that log, so confirm availability with the responses:

```bash
curl -i http://127.0.0.1:3000/users/list
curl -i http://127.0.0.1:3000/users/1
curl -i http://127.0.0.1:3000/users/missing
curl -i "http://127.0.0.1:3000/users/list?page=0"
curl -i -X POST http://127.0.0.1:3000/users/ -H "Content-Type: application/json" -d '{"name":"Bob","email":"bob@example.com"}'
```

The first two return 200, the missing user 404, and invalid page 422. Creation returns 201; repeating the same email returns 409 with business code 10001. Omitting `name` or `email` returns 422. Successful data is in `data`, and the list defaults to page 1 with limit 20. On Windows PowerShell, use `curl.exe` for GET; for creation you can run:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/users/' -ContentType 'application/json' -Body '{"name":"Bob","email":"bob@example.com"}'
```

After Ctrl+C, the store-cleared log should report count 0. Run `npm run build` and `npm start`, then repeat the requests to check the built entry point. Stop any existing example process on port 3000 or change the port and request URLs. Each process has its own in-memory data.

If extension types are missing, check CLI type generation and the `.vext/types/**/*.d.ts` entry in `tsconfig`. If a business route returns 404, check its file directory and `/users` prefix. Continue with [Services](/guide/services), [Plugins](/guide/plugins), [Database](/guide/database), and [Security](/guide/security) for a real application.

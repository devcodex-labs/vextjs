# Request Context

`requestContext` shares small values such as request ID, locale, and an authentication snapshot through a single request's call chain. By default, a VextJS adapter creates an independent `AsyncLocalStorage` scope for each incoming request. Middleware, handlers, and services called in that scope can read its data.

This association follows an async call chain, not a class or module. A service constructor or plugin setup normally has no request context. Business authorization, database filtering, and cross-process transport are separate responsibilities.

## Run a concurrent example first

Prerequisite: the TypeScript API-only project from “Manual setup” in [Quick Start](/guide/quick-start), retaining its package.json, tsconfig.json, and startup scripts. Merge this configuration and add three files. No database, external service, or auth plugin is needed.

```typescript
// src/config/default.ts
export default {
  port: 3000,
  host: "127.0.0.1",
  frontend: { enabled: false },
  logger: { level: "info", pretty: false },
  requestContext: { enabled: true },
  locale: { default: "en-US", supported: ["en-US", "zh-CN"] },
  fetch: { propagateHeaders: ["x-demo-tag"] },
};
```

```typescript
// src/types/request-context.d.ts
import "vextjs";

declare module "vextjs" {
  interface RequestContextStore {
    demoLabel?: string;
  }
}
```

```typescript
// src/services/context.ts
import { setImmediate } from "node:timers/promises";
import { requestContext, type VextApp } from "vextjs";

export default class ContextService {
  constructor(private readonly app: VextApp) {}

  async inspect() {
    const before = requestContext.getStore()?.requestId;
    await setImmediate();
    const store = requestContext.getStore();
    if (!store) this.app.throw(500, "Request context is unavailable");
    this.app.logger.info({ demoLabel: store.demoLabel }, "context inspected");
    return {
      before,
      after: store.requestId,
      locale: store.locale,
      demoLabel: store.demoLabel,
      forwardedTag: store.propagatedHeaders?.["x-demo-tag"],
      authenticated: store.auth?.isAuthenticated ?? false,
    };
  }
}
```

```typescript
// src/routes/context.ts
import { defineRoutes, requestContext } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", async (req, res) => {
    const store = requestContext.getStore();
    if (!store) return app.throw(500, "Request context is unavailable");
    const label = req.headers["x-demo-label"];
    store.demoLabel = (Array.isArray(label) ? label[0] : label) ?? "unlabeled";
    res.json(await app.services.context.inspect());
  });
});
```

`demoLabel` is ordinary input used to observe isolation; it does not establish identity or permission. Run `npm run dev`; dev startup generates service type mappings. In another terminal, run this complete Node command from the project root:

```bash
node --input-type=module -e 'const rows = await Promise.all(["a", "b"].map(async label => { const response = await fetch("http://127.0.0.1:3000/context", { headers: { "x-request-id": "req-" + label, "x-demo-label": label, "x-demo-tag": "tag-" + label, "accept-language": label === "a" ? "zh-CN" : "en-US" } }); return { status: response.status, requestId: response.headers.get("x-request-id"), body: await response.json() }; })); console.log(JSON.stringify(rows, null, 2));'
```

Both responses should be 200. The first `body.data` has `before` and `after` equal to `req-a`, locale `zh-CN`, label `a`, forwarded tag `tag-a`, and `authenticated: false`; the second has `req-b`, `en-US`, `b`, `tag-b`, and false. Each response header and server JSON log should carry its corresponding request ID.

Without `x-request-id`, Vext generates an ID; without the language header, it uses the configured default. Stop dev, run `npm run build` and `npm start`, and repeat the requests. Stop the server with Ctrl+C afterward.

:::tip Log display
This example uses `pretty: false` to inspect full JSON. Default pretty output hides the displayed requestId; absence from the terminal view alone does not prove lost context.
:::

## Core concepts

### What is AsyncLocalStorage?

Node.js is a single-threaded event loop but handles multiple concurrent requests at the same time. The traditional global variable method (such as `global.currentRequestId`) will be overwritten by later requests, causing race conditions.

`AsyncLocalStorage` maintains independent storage space for each asynchronous execution context, which can safely isolate data even in concurrent scenarios:

```
Request A (requestId: "aaa")─┐
                           ├─ Concurrent execution without interfering with each other
Request B (requestId: "bbb")─┘

Call requestContext.getStore() → { requestId: "aaa" } in request A
Call requestContext.getStore() → { requestId: "bbb" } in request B
```

### Life cycle

```text
Adapter receives a request (when requestContext.enabled is not false)
  → run(new store, callback): initialize requestId, locale, auth snapshot
  → request metadata middleware: write locale and selected inbound headers
  → requestId middleware (if enabled): generate or read ID
  → auth-context synchronization, other middleware, handler
  → native Promises/timers created in the chain may still access this store
```

A response ending does not immediately clear its store; collection depends on the lifetime of related async resources and references. Do not call global `requestContext.disable()` per request; that can affect other requests. See the [Node.js AsyncLocalStorage docs](https://nodejs.org/download/release/v20.19.0/docs/api/async_context.html#class-asynclocalstorage).

`requestContext.enabled: false` skips the framework-created HTTP scope. `requestId.enabled: false` only disables ID generation and its response header; an otherwise enabled context still contains locale and configured inbound header snapshots. Manual `run()` remains available, and code called inside a manual outer scope may still see that outer store.

## Basic usage

### Read requestId

To explicitly correlate business records in the request chain, read the current store. Do not cache a store once at module initialization and reuse it across requests:

```typescript
import { requestContext } from "vextjs";

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
```

Default `app.logger` and `app.fetch` usually read the ID automatically. Read it yourself when handing it to a business system. An inbound request ID is a correlation identifier; it is not guaranteed globally unique and is not a user identity.

### Read locale

Independent request metadata middleware chooses locale from `Accept-Language`, `locale.supported`, and `locale.default`, regardless of whether request ID generation is enabled. With no match, it uses the configured default, which is `en-US` by default.

```typescript
import { requestContext } from "vextjs";

export function currentLocale(): string | undefined {
  return requestContext.getStore()?.locale;
}
```

Default `app.throw()` uses the current app's language catalog and an applicable request locale; it does not borrow a locale from a store owned by another app. A manually created store does not run HTTP metadata or authentication middleware. See [i18n](/guide/i18n) and [Error Handling](/guide/error-handling).

## RequestContextStore type

These are the public fields; import `RequestContextStore` from `vextjs` when using it. All fields are optional because a manually created store may contain only some values.

```typescript
import type { VextAuthContextSnapshot } from "vextjs";

interface RequestContextStore {
  requestId?: string;
  locale?: string;
  propagatedHeaders?: Record<string, string>;
  auth?: VextAuthContextSnapshot;
  traceId?: string;
  spanId?: string;
}
```

| Field                | Writer                                               | Purpose and boundary                                                                                                    |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `requestId`          | Adapter initialization, requestId middleware         | Logging and outbound correlation; usually empty when IDs are disabled                                                   |
| `locale`             | Request metadata middleware                          | Current request language, which application code can update within the chain                                            |
| `propagatedHeaders`  | Request metadata middleware                          | Captured via `config.fetch.propagateHeaders`; lowercase keys, first value for array headers                             |
| `auth`               | Adapter initialization, auth-context synchronization | Snapshot of `req.auth` with isAuthenticated, subject, userId, roles, scopes, scheme, provider; no claims or credentials |
| `traceId` / `spanId` | User tracing integration                             | Default logger maps them to `trace_id` / `span_id`; Vext does not create spans                                          |

`getStore()` returns the same mutable store in this call chain; it does not copy or freeze it. Mutating `store.auth` is not authenticating a request or replacing route guards. Use `req.auth` for full authentication state; see [Security](/guide/security).

## Advanced usage

### Write custom data in middleware

The route above writes `demoLabel`. To share that logic among routes, move it into middleware using the type extension already defined:

```typescript
// src/middlewares/context-label.ts
import { defineMiddleware, requestContext } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  const store = requestContext.getStore();
  const label = req.headers["x-demo-label"];
  if (store) {
    store.demoLabel = (Array.isArray(label) ? label[0] : label) ?? "unlabeled";
  }
  await next();
});
```

A file's existence does not execute it. Following [Middleware](/guide/middleware), declare `context-label` in `config.middlewares`, then reference it in routes that need it. For global execution, import and mount it with `app.use()` in a plugin. After enabling it, remove the duplicate write in the earlier route. A business service reads the store in each method call rather than caching it on a singleton instance.

### Extend the Store type

Add fields to the earlier `src/types/request-context.d.ts`. Keep `import "vextjs"` at the top so the declaration augments the existing module; ensure tsconfig includes the file:

```typescript
// Merge into src/types/request-context.d.ts; no second declaration file needed.
import "vextjs";

declare module "vextjs" {
  interface RequestContextStore {
    demoLabel?: string;
    tenantId?: string;
    startTime?: number;
  }
}
```

Then `requestContext.getStore()?.tenantId` has type `string | undefined` without `as any`. Read authentication from `store.auth` rather than creating another source of truth for user ID or roles.

### Multi-tenant data isolation

The context may carry a tenant ID whose ownership has **already been verified**. It does not authorize a request or automatically rewrite database queries. Copying `x-tenant-id` directly to the store and then using it as a database filter lets the caller choose any tenant; that is not isolation.

The business flow is:

1. Identify the user through authentication middleware.
2. Check the user's right to the selected tenant; reject on failure.
3. Write the verified tenant ID to the current store.
4. Explicitly use that tenant for every read, update, deletion, and insertion; reject if it is missing.

This helper belongs in `src/utils`, where the service loader will not mistake it for a service class. It only supplies a query condition; it **does not perform steps 1 or 2**:

```typescript
// src/utils/tenant-filter.ts
import { requestContext } from "vextjs";

export function tenantFilter(
  filter: Record<string, unknown> = {},
): Record<string, unknown> {
  const tenantId = requestContext.getStore()?.tenantId;
  if (!tenantId) throw new Error("Verified tenant context is required");
  return { ...filter, tenantId };
}
```

The final tenant ID overwrites a same-named caller filter. See [Database](/guide/database) for actual integration and CRUD. Cover every business query path; this helper is not an automatic isolation plugin.

### Performance tracking

This middleware depends on the `startTime` type extension above and must be mounted explicitly. It measures `await next()` including downstream middleware and handler; it does not mean all network bytes have reached the client.

```typescript
// src/middlewares/performance.ts
import { defineMiddleware, requestContext } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  const store = requestContext.getStore();
  if (store) store.startTime = performance.now();

  try {
    await next();
  } finally {
    const startTime = store?.startTime;
    if (startTime !== undefined) {
      const duration = Math.round(performance.now() - startTime);
      req.app.logger.info(
        { url: req.url, method: req.method, duration },
        "middleware chain finished",
      );
    }
  }
});
```

`finally` also records downstream failures; the explicit undefined check retains a zero-valued start time. See the [Access Log API](/api/access-log) and [Hooks](/guide/hooks) for logging and streaming lifecycle.

### Keep context across async work

Native Promises, `setTimeout`, and `setImmediate` created inside the request chain usually retain its context; the service in the first example checks after one async wait. Here is an independent language-mechanism example:

```typescript
import { setTimeout as delay } from "node:timers/promises";
import { requestContext } from "vextjs";

export async function inspectAsyncContext() {
  return requestContext.run({ requestId: "async-demo" }, async () => {
    return Promise.all(
      [1, 2].map(async () => {
        await delay(1);
        return requestContext.getStore()?.requestId;
      }),
    );
  });
}
// await inspectAsyncContext() returns ["async-demo", "async-demo"]
```

Workers, processes, and queue consumers do not inherit an inbound HTTP store. Pass selected data explicitly and establish a new scope at the consumer. A timer created during a request can still read the old store after the response, so “scheduled work” alone does not prove the context is absent.

Custom thenables, callback libraries, or events triggered on a different chain may lose or change context. Inspect `getStore()` on both sides of that boundary. Use native Promises or `AsyncResource` as described in [Node's context-loss guide](https://nodejs.org/download/release/v20.19.0/docs/api/async_context.html#troubleshooting-context-loss) when needed.

### Create a context manually

This function can be called from an existing task entry; it does not create an auto-running task. It requires an initialized `app` and no extra business service:

```typescript
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { requestContext, type VextApp } from "vextjs";

export async function runBackgroundTask(app: VextApp) {
  return requestContext.run(
    { requestId: `task-${randomUUID()}`, locale: "zh-CN" },
    async () => {
      await setImmediate();
      app.logger.info("background task started");
      return requestContext.getStore()?.requestId;
    },
  );
}
```

`run()` returns the callback result, so await its Promise for an async callback. Manual run creates a store scope only; it does not run HTTP middleware, add auth, capture inbound headers, or schedule a task. [Jobs](/guide/jobs) covers discovery, execution, and queues.

## Relationship with the built-in functions of the framework

| Feature                   | Data used                       | Current behavior                                                                                                                      |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Default `app.logger`      | requestId, traceId, spanId      | Correlates logs; disabling framework requestContext also disables default logger ALS reads; a custom logger needs its own integration |
| `app.fetch`               | requestId, propagatedHeaders    | Uses the header named by `config.requestId.header`; explicit outbound headers take precedence                                         |
| Default `app.throw()`     | locale and app language catalog | Selects a locale available to this app; custom throw implementations own their behavior                                               |
| Authentication middleware | `req.auth`                      | Synchronizes a reduced snapshot to `store.auth`; authorization still uses auth workflow and route rules                               |

The default access log also gets request ID through logger context. If only one service loses the ID, inspect the async chain that calls it.

## requestContext API

### requestContext.getStore()

Returns the `RequestContextStore` reference for the current scope, or `undefined` if none exists. A store may also come from a manual run, so its existence does not imply an HTTP request is being processed.

```typescript
import { requestContext } from "vextjs";

export function inspectStore() {
  return requestContext.getStore();
}
// Return type: RequestContextStore | undefined
```

### requestContext.run(store, callback)

Runs a callback under the supplied store and returns its result. Nested runs do not merge store fields; after the inner scope, the outer scope is restored. The caller handles exceptions or Promise rejection from the callback.

```typescript
import { requestContext } from "vextjs";

export function inspectNestedStore() {
  return requestContext.run({ requestId: "outer" }, () => {
    const inner = requestContext.run({ requestId: "inner" }, () => {
      return requestContext.getStore()?.requestId;
    });
    return { inner, restored: requestContext.getStore()?.requestId };
  });
}
// inspectNestedStore() returns { inner: "inner", restored: "outer" }
```

The adapter normally establishes HTTP scopes. For manual runs, create a separate store object each time; do not reuse a global mutable store.

## Relationship with distributed tracing (traceId)

### requestId vs traceId

A request ID correlates logs and service requests; it may come from an inbound header or be generated by Vext. A tracing SDK normally supplies traceId/spanId with real span lifecycles. Storing those fields in Vext does not create, sample, or export spans.

### Mode 1: requestId as a correlation ID

If a shared correlation ID is sufficient, change the request ID header to `x-trace-id`. Merge this into existing configuration; omitting `generate` keeps the framework UUID generator:

```typescript
// requestId configuration in src/config/default.ts
export default {
  requestId: {
    header: "x-trace-id",
    responseHeader: "x-trace-id",
  },
};
```

The default logger field remains `requestId`; `app.fetch` uses the `x-trace-id` header. Renaming it does not generate W3C traceparent or an APM span, and does not ensure the ID satisfies an external tracing format.

### Mode 2: requestId alongside an APM traceId

For APM, initialize and configure inbound/outbound instrumentation and exports for the chosen tracing SDK first, then associate current-span fields with logs. Passing ordinary headers only passes values; it does not create parent-child spans.

This bridge writes values returned by an **already configured SDK** into context. The integration supplies `readActiveSpan`:

```typescript
import { requestContext } from "vextjs";

type ActiveSpan = { traceId: string; spanId: string };

export function bindActiveSpan(readActiveSpan: () => ActiveSpan | undefined) {
  const store = requestContext.getStore();
  const span = readActiveSpan();
  if (!store || !span) return;
  store.traceId = span.traceId;
  store.spanId = span.spanId;
}
```

Call it where both an HTTP context and target span are active. The default logger reads these fields, though a custom logger mixin can override `trace_id` and `span_id`; the built-in requestId rule differs. Update or clear fields when the span changes; one copy does not track the SDK afterward. See the [OpenTelemetry example](/examples/opentelemetry).

### How propagateHeaders works

Merge this into the existing `fetch` configuration:

```typescript
// fetch configuration in src/config/default.ts
export default {
  fetch: {
    propagateHeaders: ["traceparent", "tracestate"],
  },
};
```

1. Request metadata middleware captures allowlisted inbound headers in `store.propagatedHeaders`.
2. `app.fetch` reads that snapshot while building an outbound request.
3. It fills same-named headers that were not explicitly set; explicit outbound values win.
4. The downstream tracing integration decides how to create spans. Copying an inbound traceparent does not create this service's outbound span.

Currently, per-call `propagateRequestId: false` only stops automatic ID injection; other captured headers still propagate. Per-call `propagateHeaders: []` is not a switch that clears the captured snapshot. If the ID header is itself in the global capture list, it may still leave through the snapshot. Choose the global capture list according to outbound destinations; when a separate request must inherit nothing, use native `fetch` with explicit headers.

This fragment requires an existing app and known URL supplied by the caller:

```typescript
import type { VextApp } from "vextjs";

export async function callDownstream(app: VextApp, url: string, tag: string) {
  const response = await app.fetch.get(url, {
    headers: { "x-demo-tag": tag },
  });
  return response.json();
}
```

Ordinary `app.fetch` header propagation and proxy forwarding are distinct entry points; see the [HTTP client guide](/guide/fetch) for proxy behavior.

## Best Practices

### 1. Prefer built-in behavior

Default logger and fetch cover common ID correlation. For failures, inspect adapter scope, metadata writes, business reads/writes, and consumers in order instead of adding another global ID.

### 2. Store only request-scoped data

Keep small IDs, locale, and verified business identifiers. Avoid complete requests, large query results, or long-lived connections. Async resources that run after the response can extend the lifetime of referenced objects.

### 3. Handle undefined stores

Use optional chaining and explicit defaults for optional observability data. Fail when essential business context is missing; do not substitute a default tenant to bypass isolation. Startup, standalone tasks, and callbacks that lose context can lack a store.

### 4. Extend the Store with types

Use the module augmentation above and import `requestContext` at the call site. A type declaration does not make the framework write a new field automatically.

### 5. Avoid mutable shared objects in the store

Separate stores can still reference the same object. `{ ...shared }` copies only one level; nested objects remain shared. Create independent values or use immutable data as needed. Do not cache a store or request data on a singleton service instance.

## Troubleshooting

| Symptom                                        | Check                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `getStore()` is undefined in a service         | Was it called from this request chain? Is requestContext disabled, was it read in a constructor, or did a custom async boundary lose scope? |
| Logs do not display requestId                  | Check `prettyIgnore`, requestId enablement, the default logger context switch, and custom logger behavior                                   |
| Locale always uses default                     | Check `Accept-Language`, supported locales, and any write after metadata middleware                                                         |
| Headers propagate even with requestId disabled | Metadata capture is independent and `app.fetch` reads `propagatedHeaders`                                                                   |
| Concurrent request values overwrite each other | Inspect module/service field caches, nested shared objects, and manual reuse of a store                                                     |
| APM spans are absent after forwarding headers  | Propagation does not initialize an SDK, create spans, or export them                                                                        |

## Next step

- Mount context-writing logic with [Middleware](/guide/middleware).
- See [Logger](/guide/logger), [HTTP Client](/guide/fetch), and [i18n](/guide/i18n) for consumers.
- Use [Security](/guide/security) to establish authentication and authorization before carrying business identity.
- For background work across requests, read [Jobs](/guide/jobs); for tracing, see the [OpenTelemetry example](/examples/opentelemetry).

# Request Context (Request Context)

VextJS implements request-level context storage `requestContext` based on Node.js `AsyncLocalStorage`, maintaining independent context data for each request. There is no need to manually pass parameters, and the context information of the current request can be accessed in any deep code of routing, middleware, services, and plug-ins.

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

```
Adapter receives the request
  → requestContext.run(store, callback) ← Create request scope
  → requestId middleware writes store.requestId
  → Middleware chain execution
  → handler execution
  → When the request ends, the store automatically GCs (no need to manually clean up)
```

## Basic usage

### Read requestId

The most common usage is to get the `requestId` of the current request anywhere:

```typescript
import { requestContext } from "vextjs";

export class OrderService {
  constructor(private app: any) {}

  async createOrder(data: any) {
    const store = requestContext.getStore();
    const requestId = store?.requestId;

    this.app.logger.info(
      { requestId, orderId: data.id },
      "Start creating order",
    );

    // ... business logic
  }
}
```

:::tip
In most cases you don't need to read the `requestId` manually - `app.logger` and `app.fetch` already read and inject it from the `requestContext` automatically. Manual reading is only required if the `requestId` needs to be passed to an external system.
:::

### Read locale

`requestContext` also stores the locale of the current request, written by the i18n middleware:

```typescript
import { requestContext } from "vextjs";

function getCurrentLocale(): string {
  const store = requestContext.getStore();
  return store?.locale ?? "zh-CN";
}
```

`I18nError.create()` inside `app.throw()` obtains the locale through `requestContext` to ensure that each request is translated independently.

## RequestContextStore type

```typescript
interface RequestContextStore {
  /** The unique identifier of the current request (generated/transparently transmitted by the requestId middleware) */
  requestId?: string;

  /**
   * The locale of the current request
   * Parsed and written by middleware from the Accept-Language request header or custom logic
   */
  locale?: string;

  /**
   * Snapshot of inbound request headers that need to be transparently transmitted to downstream services
   *
   * By requestId middleware based on config.fetch.propagateHeaders list,
   * Extract the corresponding header value from the current inbound request and write it.
   * app.fetch automatically reads from this field and injects it when building outbound requests.
   *
   * Key names are uniformly lowercase (such as `x-trace-id`, `x-tenant-id`).
   */
  propagatedHeaders?: Record<string, string>;

  /**
   * OpenTelemetry link tracing ID (follows OTEL semantic convention field name `trace_id`)
   *
   * Written by the user's tracing middleware at the beginning of the request.
   * The logger built-in mixin automatically injects `trace_id` into each log output when this field exists.
   * Realize the correlation between logs and link tracking system. The framework itself is not responsible for writing this field.
   */
  traceId?: string;

  /**
   * OpenTelemetry Span ID (follows OTEL semantic convention field name `span_id`)
   *
   * Written by the user's tracing middleware at the beginning of the request.
   * The logger built-in mixin automatically injects `span_id` into each log output when this field is present.
   * The framework itself is not responsible for writing this field.
   */
  spanId?: string;
}
```

| Field               | Writing time              | Writer                  | Purpose                                                                                                               |
| ------------------- | ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `requestId`         | When the request comes in | requestId middleware    | Log tracking, outbound request propagation                                                                            |
| `locale`            | When request comes in     | i18n middleware         | Error message internationalization                                                                                    |
| `propagatedHeaders` | When a request comes in   | requestId middleware    | Distributed tracing headers, multi-tenant headers, etc. are automatically transparently transmitted to the downstream |
| `traceId`           | When the request comes in | User tracing middleware | The logger built-in mixin automatically reads and injects `trace_id` into the log (OTEL semantic convention)          |
| `spanId`            | When the request comes in | User tracing middleware | The logger built-in mixin automatically reads and injects `span_id` into the log (OTEL semantic convention)           |

## Advanced usage

### Write custom data in middleware

You can write additional data to the `requestContext` store in custom middleware:

```typescript
import { defineMiddleware } from "vextjs";
import { requestContext } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  const store = requestContext.getStore();
  if (store) {
    //Extract user information from JWT token and write it into context
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      const decoded = verifyToken(token);
      (store as any).userId = decoded.userId;
      (store as any).tenantId = decoded.tenantId;
    }
  }

  await next();
});
```

Read in subsequent handlers or services:

```typescript
import { requestContext } from "vextjs";

export class AuditService {
  async log(action: string, resource: string) {
    const store = requestContext.getStore() as any;

    await this.app.db.collection("audit_logs").insertOne({
      action,
      resource,
      userId: store?.userId,
      tenantId: store?.tenantId,
      requestId: store?.requestId,
      timestamp: new Date(),
    });
  }
}
```

### Extend Store type

To provide type safety for custom fields, create a type declaration file:

```typescript
// src/types/request-context.d.ts
declare module "vextjs" {
  interface RequestContextStore {
    /** JWT decoded user ID */
    userId?: string;

    /** Multi-tenant ID */
    tenantId?: string;

    /** User role list */
    roles?: string[];

    /** Request start time (performance tracking) */
    startTime?: number;
  }
}
```

After extension, the return value of `requestContext.getStore()` will contain type hints for the custom field:

```typescript
const store = requestContext.getStore();
store?.userId; // string | undefined — IDE has type hints
store?.tenantId; // string | undefined
```

### Multi-tenant data isolation

Use `requestContext` to implement multi-tenant automatic data isolation:

```typescript
// src/middlewares/tenant.ts
import { defineMiddleware } from "vextjs";
import { requestContext } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  const tenantId = req.headers["x-tenant-id"] as string;
  if (!tenantId) {
    req.app.throw(400, "Missing X-Tenant-ID header");
  }

  const store = requestContext.getStore();
  if (store) {
    (store as any).tenantId = tenantId;
  }

  await next();
});
```

```typescript
// src/services/base.ts — base class for all Services
import { requestContext } from "vextjs";

export class TenantAwareService {
  constructor(protected app: any) {}

  /** Get the current tenant ID (automatically read from requestContext) */
  protected getTenantId(): string {
    const store = requestContext.getStore() as any;
    const tenantId = store?.tenantId;
    if (!tenantId) {
      throw new Error("Tenant ID not found in request context");
    }
    return tenantId;
  }

  /** Automatically inject tenant filter conditions into queries */
  protected tenantFilter(
    filter: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return { ...filter, tenantId: this.getTenantId() };
  }
}
```

```typescript
// src/services/order.ts — Use tenant-aware base classes
export class OrderService extends TenantAwareService {
  async findAll(options: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = options;

    // Automatically inject tenantId filtering - different tenants can only see their own data
    return this.app.db
      .collection("orders")
      .find(this.tenantFilter(), { skip: (page - 1) * limit, limit });
  }

  async create(data: any) {
    return this.app.db.collection("orders").insertOne({
      ...data,
      tenantId: this.getTenantId(),
      createdAt: new Date(),
    });
  }
}
```

### Performance Tracking

Record the request start time in requestContext for performance monitoring:

```typescript
// src/middlewares/performance.ts
import { defineMiddleware } from "vextjs";
import { requestContext } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  const store = requestContext.getStore();
  if (store) {
    (store as any).startTime = performance.now();
  }

  await next();

  // Calculate the time taken after the request is completed
  const startTime = (store as any)?.startTime;
  if (startTime) {
    const duration = Math.round(performance.now() - startTime);
    // Slow request alert
    if (duration > 1000) {
      req.app.logger.warn(
        {
          url: req.url,
          method: req.method,
          duration,
        },
        `Slow request: ${req.method} ${req.url} ${duration}ms`,
      );
    }
  }
});
```

### Maintain context across asynchronous tasks

The `AsyncLocalStorage` store is automatically propagated to all asynchronous operations (`Promise`, `setTimeout`, `setImmediate`, etc.). As long as the asynchronous operation is initiated within the request processing chain, the store can be read correctly:

```typescript
export class NotificationService {
  constructor(private app: any) {}

  async sendWelcomeEmail(userId: string) {
    const store = requestContext.getStore();

    // ✅ requestContext can also be read in setTimeout
    setTimeout(() => {
      const currentStore = requestContext.getStore();
      console.log(currentStore?.requestId); // Correct: still the requestId of the original request
    }, 1000);

    // ✅ Can also be read in Promise.all
    await Promise.all([
      this.sendEmail(userId),
      this.createNotification(userId),
    ]);
  }
}
```

:::warning note
If you use `worker_threads` or manually create an asynchronous context outside the request processing chain (such as a scheduled task), `requestContext.getStore()` will return `undefined`. This is expected behavior - these operations are not part of any request.
:::

### Manually create request context

In some special scenarios (such as scheduled tasks, message queue consumers), you may need to manually create a request context:

```typescript
import { requestContext } from "vextjs";
import { randomUUID } from "node:crypto";

// Manually create context in scheduled tasks
async function scheduledTask(app: any) {
  const store = {
    requestId: `scheduled-${randomUUID()}`,
    locale: "zh-CN",
  };

  await requestContext.run(store, async () => {
    // Inside this callback, all code can read the store
    app.logger.info("Scheduled task begins execution");
    // requestId will be automatically injected into the log

    await app.services.report.generateDaily();

    // app.fetch will also automatically propagate requestId
    await app.fetch.post("https://webhook.example.com/notify", {
      type: "daily-report",
    });
  });
}
```

## Relationship with the built-in functions of the framework

| Function              | Fields read | Description                                                                |
| --------------------- | ----------- | -------------------------------------------------------------------------- |
| `app.logger`          | `requestId` | Automatically injected into each log through logger mixin                  |
| `app.fetch`           | `requestId` | Automatically injected into the `x-request-id` header of outbound requests |
| `app.throw()`         | `locale`    | I18nError translate error message according to locale                      |
| Access log middleware | `requestId` | Record the requestId of inbound requests                                   |

## requestContext API

### requestContext.getStore()

Get the store of the current asynchronous execution context. Returns a `RequestContextStore` object within the request processing chain and `undefined` outside the request.

```typescript
const store = requestContext.getStore();
// RequestContextStore | undefined
```

### requestContext.run(store, callback)

Create a new request scope and execute the callback. The store can be accessed through `getStore()` inside the callback and all subsequent asynchronous operations.

```typescript
requestContext.run({ requestId: "abc-123", locale: "en-US" }, async () => {
  // This and all subsequent asynchronous operations can read the store
  const store = requestContext.getStore();
  console.log(store?.requestId); // 'abc-123'
});
```

:::info
Normally you don't need to call `run()` manually - the framework's Adapter layer does it automatically on every request.
:::

## Relationship with distributed tracing (traceId)

### requestId vs traceId: conceptual distinction

VextJS has `requestId` built-in, but you may also have heard of `traceId`. Both solve problems at different levels:

```
requestId (vext built-in)
  ├─ Automatically generated by the framework (crypto.randomUUID or customized)
  ├─ Each HTTP request is independent and can be transparently transmitted from the inbound header (default x-request-id)
  ├─ Automatically inject each log into app.logger
  ├─ Automatically propagated to app.fetch outbound requests
  └─ Suitable for: log correlation, request link tracking between internal services

traceId (generated by APM/link tracking system, vext is not built-in)
  ├─ Generated by APM systems such as Jaeger / Zipkin / OpenTelemetry / Datadog etc.
  ├─ Comply with W3C Trace Context standard (traceparent / tracestate header)
  │ or B3 standard (x-b3-traceid header)
  └─ Suitable for: cross-system full-link tracking, APM system integration
```

### Mode 1: requestId acts as traceId (simple scenario)

If your system does not use professional APM tools, you can directly change the request header name of `requestId` to `x-trace-id` and use `requestId` as the link tracking ID:

```typescript
// src/config/default.ts
export default {
  requestId: {
    header: "x-trace-id", // Read from x-trace-id (gateway injection)
    responseHeader: "x-trace-id", // Write back the response header
    generate: () => nanoid(), // Can be replaced by a shorter ID generator
  },
};
```

In this way, all logs and outbound requests will automatically carry `x-trace-id`, and calls between services form a complete tracing chain.**Suitable scenarios**: Internal microservice system, not dependent on external APM tools, only simple request link tracking.

### Mode 2: requestId + APM traceId coexist (enterprise-level scenario)

If you are connected to an APM system such as OpenTelemetry/Jaeger, you need to retain both `requestId` (log correlation) and APM's `traceparent` (distributed link tracking):

**Step 1**: Configure `config.fetch.propagateHeaders` and declare the tracking headers that need to be automatically transparently transmitted:

```typescript
// src/config/default.ts
export default {
  // requestId reserved (for log correlation)
  requestId: {
    header: "x-request-id",
    responseHeader: "x-request-id",
  },
  // The statement needs to be transparently transmitted to the downstream APM tracking header
  fetch: {
    propagateHeaders: [
      "traceparent", // W3C Trace Context main header (including traceId + spanId)
      "tracestate", // W3C Trace Context additional state
      // or B3 format: 'x-b3-traceid', 'x-b3-spanid', 'x-b3-sampled'
    ],
  },
};
```

**Step 2**: After the configuration takes effect, when the inbound request carries the `traceparent` header, `app.fetch` will automatically inject the header into all outbound requests without manual processing:

```
Client → [Service A: traceparent=00-abc123-...] → app.fetch → [Service B: traceparent=00-abc123-...]
                                                                        ↓
                                                              APM system recognizes the same trace
```

**Step 3** (optional): Inject `traceId` into the log through OpenTelemetry SDK to associate the log with the APM link:

```typescript
// src/plugins/otel-log-correlation.ts
// See examples/opentelemetry for complete example
export default definePlugin({
  name: "otel-log-correlation",
  setup(app) {
    // OpenTelemetry SDK automatically injects trace_id into Vext logger
    // Log output: { requestId: '...', trace_id: 'abc123', msg: '...' }
  },
});
```

**Suitable scenarios**: Accessing OpenTelemetry / Jaeger / Zipkin / Datadog, requiring full-link observability of the APM system.

### How propagateHeaders work

Full working link to `config.fetch.propagateHeaders`:

```
1. Inbound requests carry the traceparent header
        ↓
2. The requestId middleware reads the header from the inbound request and writes it to store.propagatedHeaders
        ↓
3. When app.fetch makes an outbound request, read it from store.propagatedHeaders and inject it into the request header.
        ↓
4. The downstream service receives the traceparent header, and the APM system establishes the span association.
```

:::tip
`propagatedHeaders` only captures headers declared in `config.fetch.propagateHeaders`.
If you need to temporarily transparently transmit undeclared headers, just manually set `headers` when calling `app.fetch`:

```typescript
await app.fetch.get(downstreamUrl, {
  headers: { "x-custom-header": req.headers["x-custom-header"] as string },
});
```

:::

## Best Practices

### 1. Give priority to using the built-in capabilities of the framework

In most scenarios, `app.logger` (automatically injects requestId) and `app.fetch` (automatically propagates requestId) have covered common needs, and there is no need to manually operate `requestContext`.

### 2. Only store request-level data

`requestContext` is suitable for storing request-level data (such as userId, tenantId, traceId). Do not store large amounts of data or long-lived objects.

```typescript
// ✅ Good — lightweight request-level data
(store as any).userId = "user-123";
(store as any).tenantId = "tenant-456";

// ❌ Bad — large objects, waste of memory
(store as any).fullUserProfile = {
  /* A large number of fields */
};
(store as any).queryResults = [
  /* A lot of data */
];
```

### 3. Handle the situation when store is undefined

In non-request context (startup phase, scheduled tasks, worker threads), `getStore()` returns `undefined`. Always do safety checks:

```typescript
const store = requestContext.getStore();

// ✅ Safe access
const requestId = store?.requestId ?? "unknown";
const locale = store?.locale ?? "zh-CN";

// ❌ May throw an error
const requestId = store!.requestId; // An error occurs in non-request context
```

### 4. Extend Store using type declarations

If you need to add custom fields to the store, use the `declare module` extension type instead of `as any`:

```typescript
// src/types/request-context.d.ts
declare module "vextjs" {
  interface RequestContextStore {
    userId?: string;
    tenantId?: string;
  }
}

// No need to use as any
const store = requestContext.getStore();
store?.userId; // There is a type prompt
```

### 5. Do not store mutable shared objects in the store

```typescript
// ❌ Danger - if sharedCache is modified elsewhere, it will affect the current request
(store as any).cache = sharedCache;

// ✅ SAFE — Make a copy
(store as any).cache = { ...sharedCache };
```

## Next step

- Learn how [middleware](/guide/middleware) writes context during the request lifecycle
- View the implementation principle of automatic injection of requestId in [Log](/guide/logger)
- Learn how [app.fetch built-in HTTP client](/guide/fetch) automatically propagates requestId and propagatedHeaders
- Explore the relationship between locale and requestContext in [Internationalization](/guide/i18n)
- See [OpenTelemetry Integration Examples](/examples/opentelemetry) for a complete scenario of correlating APM traceId with logs

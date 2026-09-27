# Built-in HTTP client (app.fetch)

VextJS includes `app.fetch`, an enhanced client built on Node.js native `fetch`. It adds request ID propagation, timeouts, retries, structured logs, a `create()` factory and config-driven proxying without requiring a third-party HTTP library.

Run the local outbound request in [Basic usage](#basic-usage) first, then consult configuration, proxy and retry behavior. Later standalone call snippets belong in a route, Service or plugin that already has an `app`. Replace example domains with actual service addresses.

## Function overview

Production and development initialize `app.fetch` before user-plugin setup, Service constructors and route factories. Plugin setup, Service constructors and `onReady` callbacks registered on a real app can use `app.fetch.create()`. The route factory argument has the bound-method limitation described below, so handlers should use `req.app.fetch`. Later outbound calls also use logger wrappers installed through `app.setLogger()`.

`req.signal` is cancelled on an interrupted request, a premature disconnect, or a route timeout. Receiving a complete POST body and completing a normal response do not cancel it; `req.onClose()` still performs cleanup on completion or disconnect. For ordinary `app.fetch()`, `timeout` covers obtaining response headers, not the subsequent `response.text()` or `response.json()` call. Proxy and streaming calls follow their own cancellation and timeout contracts.

| Capabilities              | Description                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **requestId propagation** | Automatically read `requestId` from `requestContext` and inject it into the `x-request-id` header of outbound requests to achieve cross-service request tracking                   |
| **Timeout Control**       | Based on `AbortController` + `setTimeout`, supports global default + single request override                                                                                       |
| **AUTO-RETRY**            | Automatically retry on 5xx or network error only for idempotent methods (GET/HEAD/OPTIONS/PUT/DELETE)                                                                              |
| **Structured Log**        | Automatically record outbound requests to method/url/status/duration/requestId, unified with `app.logger`                                                                          |
| **Shortcut methods**      | `get` / `post` / `put` / `patch` / `delete` shortcut calls                                                                                                                         |
| **create() factory**      | Create a preconfigured sub-client (fixed baseURL + default headers), suitable for docking multiple microservices                                                                   |
| **proxy proxy**           | Configure the upstream target through `config.fetch.proxy[]`, and directly transparently transmit the response through `app.fetch.proxy.userService(req, res, options)` in routing |

## Basic usage

Start with the TypeScript API-only project from [Quick Start](/guide/quick-start). Keep its package.json, tsconfig.json and scripts, merge this config and add the route. A separate route in the same process simulates an upstream without an external test API. For deployment, replace `fetchDemoBaseURL` with the internal service URL.

```typescript
// src/config/default.ts
export default {
  host: "127.0.0.1",
  port: 3000,
  frontend: { enabled: false },
  logger: { level: "debug", pretty: false },
  fetchDemoBaseURL: "http://127.0.0.1:3000",
  fetch: { timeout: 3000, retry: 0, propagateHeaders: ["x-tenant-id"] },
};
```

```typescript
// src/routes/fetch-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/upstream/:id", async (req, res) => {
    if (req.params.id === "missing") {
      res.json({ message: "user not found" }, 404);
      return;
    }
    res.json({
      id: req.params.id,
      requestId: req.requestId,
      tenant: req.headers["x-tenant-id"] ?? null,
    });
  });

  app.get("/users/:id", async (req, res) => {
    const response = await req.app.fetch.get(
      `${app.config.fetchDemoBaseURL}/fetch-demo/upstream/${encodeURIComponent(req.params.id!)}`,
      { signal: req.signal },
    );
    if (!response.ok) {
      await response.body?.cancel();
      app.throw(
        response.status === 404 ? 404 : 502,
        "Upstream user query failed",
      );
    }
    const payload = (await response.json()) as {
      data: { id: string; requestId: string; tenant: string | null };
    };
    res.json({ user: payload.data });
  });
});
```

Run `npm run dev`, then request these URLs in another terminal (use `curl.exe` in PowerShell):

```bash
curl -H "x-request-id: fetch-demo-1" -H "x-tenant-id: tenant-a" http://127.0.0.1:3000/fetch-demo/users/u-1
curl -i http://127.0.0.1:3000/fetch-demo/users/missing
```

The first request returns 200 with `data.user.id: "u-1"`, `requestId: "fetch-demo-1"` and `tenant: "tenant-a"`; the terminal shows a GET log with `type: "outbound"`. The second returns 404, showing that the caller checks HTTP errors rather than accepting an error response as success.

Stop dev, run `npm run build` and `npm start`, repeat both requests, then stop with Ctrl+C. If the port changes, update `fetchDemoBaseURL` too. This tenant header demonstrates propagation only, not tenant authentication.

The general call accepts `string | URL | Request` and extended `RequestInit`, but timeout, retry and logging defaults differ from native fetch. It returns a standard `Response`: HTTP 4xx/5xx do not throw automatically. The caller must read the body and check `response.ok`.

:::warning Current route factory boundary
The factory argument of `defineRoutes((app) => ...)` binds functions and currently does not retain attached methods such as `fetch.get/create/proxy`. Use `req.app.fetch` in a handler for the complete client; direct `app.fetch(url, init)` still works. Plugin setup and Service constructors receive a real app and are unaffected. In later shortcut examples, `app` means a real application instance; use `req.app` inside handlers.
:::

## Fetch Hooks

`app.fetch` and `app.fetch.proxy` will trigger outbound life cycle hooks, which are suitable for uniform header injection, recording third-party call time or reporting failures:

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "fetch-observer",
  setup(app) {
    app.hooks.on("fetch:before", ({ headers }) => {
      headers.set("x-client", "billing-service");
    });

    app.hooks.on("fetch:error", ({ url, error }) => {
      app.logger.error({ url, err: error }, "outbound request failed");
    });

    app.hooks.on("proxy:after", ({ target, status, requestId }) => {
      app.logger.info({ target, status, requestId }, "proxy response");
    });
  },
});
```

`fetch:before` and `proxy:before` can modify outbound headers; throwing stops the outbound request. An ordinary `fetch:before` runs outside the request loop, so its exception propagates directly without a later `fetch:error`. A proxy before-hook error enters proxy error handling and normally returns a local 502.

`fetch:after/error` and `proxy:after/error` use safe dispatch: listener errors are logged without replacing the main result. Before fires once per call; after fires when the final Response arrives, including the final attempt. HTTP 5xx still produces after, and a later body-read failure does not add `fetch:error`. Argument parsing and retry-delay evaluation also do not guarantee an error hook; see [Hooks](/guide/hooks).

## Shortcut method

In addition to calling `app.fetch(url, init)` directly, shortcuts to commonly used HTTP methods are also provided:

### GET

```typescript
const response = await app.fetch.get("https://api.example.com/users");
const users = await response.json();
```

### POST

A non-null second argument to `post`, `put` or `patch` is `JSON.stringify`-encoded. The shortcut adds `application/json` only if no Content-Type is set. For FormData, binary or streams, use the general call and supply the body yourself:

```typescript
const response = await app.fetch.post("https://api.example.com/users", {
  name: "Zhang San",
  email: "zhangsan@example.com",
});
const newUser = await response.json();
```

### PUT

```typescript
const response = await app.fetch.put(`https://api.example.com/users/${id}`, {
  name: "Li Si",
  email: "lisi@example.com",
});
```

### PATCH

```typescript
const response = await app.fetch.patch(`https://api.example.com/users/${id}`, {
  name: "Wang Wu",
});
```

### DELETE

```typescript
const response = await app.fetch.delete(`https://api.example.com/users/${id}`);
```

### List of method signatures

| Method                                    | Signature                                                                      | Description                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `app.fetch(input, init?)`                 | `(input: string \| URL \| Request, init?: VextFetchInit) => Promise<Response>` | Universal call (compatible with native fetch)                       |
| `app.fetch.get(url, init?)`               | `(url: string, init?: VextFetchInit) => Promise<Response>`                     | GET request                                                         |
| `app.fetch.post(url, body?, init?)`       | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>`     | POST request, body automatically serialized                         |
| `app.fetch.put(url, body?, init?)`        | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>`     | PUT request, body is automatically serialized                       |
| `app.fetch.patch(url, body?, init?)`      | `(url: string, body?: unknown, init?: VextFetchInit) => Promise<Response>`     | PATCH request, body automatically serialized                        |
| `app.fetch.delete(url, init?)`            | `(url: string, init?: VextFetchInit) => Promise<Response>`                     | DELETE request                                                      |
| `app.fetch.create(options)`               | `(options: VextFetchClientOptions) => VextFetchClient`                         | Create subclient (without proxy)                                    |
| `app.fetch.proxy.<name>(req,res,options)` | `(req, res, options) => Promise<void>`                                         | Configure the request proxy and transparently transmit the response |

## Configuration

### Global configuration (config.fetch)

Configure global defaults in `src/config/default.ts`:

```typescript
// src/config/default.ts
export default {
  port: 3000,
  fetch: {
    timeout: 10000, // Global default timeout (milliseconds), default 10000
    retry: 2, //Default number of retries (idempotent methods only), default 0
    retryDelay: 1000, //Default retry interval (milliseconds), default 1000
    propagateHeaders: [
      // Automatically transparently transmit headers from inbound requests to outbound requests except x-request-id
      "traceparent", // W3C Trace Context (APM distributed tracing)
      "tracestate", // W3C Trace Context additional state
      // Or 'x-trace-id', 'x-tenant-id' and other custom headers
    ],
    proxy: [
      {
        name: "userService",
        baseURL: "http://user-service:3001/api",
        forwardHeaders: ["x-tenant-id", "traceparent"],
        headers: { "x-source": "gateway" },
        timeout: 5000,
        retry: 1,
      },
    ],
  },
};
```

| Configuration item | Type                            | Default value | Description                                                                                                    |
| ------------------ | ------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| `timeout`          | `number`                        | `10000`       | Global default request timeout (milliseconds)                                                                  |
| `retry`            | `number`                        | `0`           | Default number of retries (only idempotent methods take effect)                                                |
| `retryDelay`       | `number \| (attempt) => number` | `1000`        | Default retry interval (milliseconds), supports function form                                                  |
| `propagateHeaders` | `string[]`                      | `[]`          | A list of header names that need to be automatically passed through from inbound requests to outbound requests |
| `proxy`            | `VextFetchProxyTargetConfig[]`  | `[]`          | List of upstream targets for `app.fetch.proxy.<name>()`                                                        |

:::warning Timer bounds
`retry` must be a non-negative integer counting extra attempts. `timeout` must be a finite positive number no greater than `2147483647` milliseconds. `retryDelay` must be finite and non-negative, also no greater than `2147483647` milliseconds. Function-form return values are checked before each native timer is created; invalid values fail fast.
:::

:::tip propagateHeaders working principle
The independent request metadata middleware reads configured names from inbound headers and writes them to `requestContext.store.propagatedHeaders`. `app.fetch` reads and injects them on outbound requests.

**No need to manually pass these headers on every `app.fetch` call** - the framework does the entire chain automatically.
:::

### Single request configuration (VextFetchInit)

Global configuration can be overridden per request via the `init` parameter:

```typescript
//Set a 5-second timeout + 3 retries for a single request
const response = await app.fetch.get("https://api.example.com/data", {
  timeout: 5000,
  retry: 3,
  retryDelay: 500,
});
```

#### All VextFetchInit fields

`VextFetchInit` inherits from the standard `RequestInit` and adds:

| Field                | Type                                    | Default Value                    | Description                                                                                                                      |
| -------------------- | --------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `timeout`            | `number`                                | Global `config.fetch.timeout`    | Request timeout in milliseconds                                                                                                  |
| `retry`              | `number`                                | Global `config.fetch.retry`      | Number of retries for idempotent methods                                                                                         |
| `retryDelay`         | `number \| (attempt: number) => number` | Global `config.fetch.retryDelay` | Retry interval; a function can implement exponential backoff                                                                     |
| `propagateRequestId` | `boolean`                               | `true`                           | Whether to inject `x-request-id` automatically; configured `propagatedHeaders` are still forwarded when this is disabled         |
| `propagateHeaders`   | `string[]`                              | —                                | Type-only field; the current implementation does not read this per-request option, so it cannot add or filter propagated headers |

:::tip priority
Single request `init.timeout` > `options.timeout` of `create()` > Global `config.fetch.timeout`
:::

## create() factory

For repeated calls to one downstream service, `create()` provides a preconfigured client with a baseURL and default headers:

```typescript
import { definePlugin, type VextFetchClient } from "vextjs";

declare module "vextjs" {
  interface VextApp {
    clients: {
      userService: VextFetchClient;
      payment: VextFetchClient;
    };
  }
}

export default definePlugin({
  name: "api-clients",

  setup(app) {
    // Create the user-service client.
    const userServiceClient = app.fetch.create({
      baseURL: "http://user-service:3001/api/v1",
      headers: {
        "x-service-name": "order-service",
        Authorization: `Bearer ${app.config.serviceToken}`,
      },
      timeout: 5000,
      retry: 2,
    });

    // Create the payment-service client.
    const paymentClient = app.fetch.create({
      baseURL: "http://payment-service:3002/api/v1",
      headers: {
        "x-service-name": "order-service",
      },
      timeout: 15000, // Allow a longer payment timeout.
    });

    // Attach for application use.
    app.extend("clients", {
      userService: userServiceClient,
      payment: paymentClient,
    });
  },
});
```

This order route fragment requires the plugin above and two upstream services. `userId` comes from a validated body solely to show call organization; a real system should derive identity from authenticated context:

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/orders",
    {
      validate: {
        body: {
          userId: "string!",
          productId: "string!",
          quantity: "number:1-99!",
        },
      },
    },
    async (req, res) => {
      const body = req.valid("body");

      // Use the preconfigured client: join baseURL and merge headers.
      const userResp = await app.clients.userService.get(
        `/users/${encodeURIComponent(body.userId)}`,
        { signal: req.signal },
      );
      if (!userResp.ok) {
        await userResp.body?.cancel();
        app.throw(502, "User service call failed");
      }
      const user = (await userResp.json()) as { id: string };

      const payResp = await app.clients.payment.post("/charges", {
        userId: user.id,
        amount: body.quantity * 100,
      });
      if (!payResp.ok) {
        await payResp.body?.cancel();
        app.throw(502, "Payment service call failed");
      }
      const charge = (await payResp.json()) as { orderId: string };

      res.json({ orderId: charge.orderId }, 201);
    },
  );
});
```

These upstream examples read unwrapped JSON such as `{ id }`. If an upstream enables VextJS response wrapping, read its `data`. Supply `serviceToken` in your application config; see [Plugins](/guide/plugins) for `app.extend()` typing.

### VextFetchClientOptions

| Field        | Type                                    | Required | Description                                     |
| ------------ | --------------------------------------- | -------- | ----------------------------------------------- |
| `baseURL`    | `string`                                | ✅       | Base URL joined with request paths              |
| `headers`    | `Record<string, string>`                | ❌       | Default headers merged with per-request headers |
| `timeout`    | `number`                                | ❌       | Subclient default timeout                       |
| `retry`      | `number`                                | ❌       | Subclient default retry count                   |
| `retryDelay` | `number \| (attempt: number) => number` | ❌       | Subclient default retry delay                   |

:::info Nested create
A subclient can call `create()` again, but the current implementation reuses its parent factory. Do not assume it inherits that subclient's headers, timeout, retry or baseURL. Pass values that must be retained explicitly:

```typescript
const apiClient = app.fetch.create({ baseURL: "https://api.example.com" });
const v2Client = apiClient.create({ baseURL: "https://api.example.com/v2" });
```

:::

String paths join as `baseURL + / + path`; `/users` keeps `/api/v1` in the baseURL. Even a full URL passed as a string is joined. To bypass baseURL, use root `app.fetch` or pass a `URL` or `Request` object to the callable subclient.

## app.fetch.proxy request proxy

`app.fetch.proxy` is suitable for gateway, BFF or "forward the current request to an internal service" scenario. Its positioning is different from `app.fetch.create()`: `create()` returns a standard `Response` for the business code to process by itself; `proxy` receives the current `req/res` and writes the upstream response directly back to the client.

```typescript
export default defineRoutes((app) => {
  app.get("/users/:id", async (req, res) => {
    await app.fetch.proxy.userService(req, res, {
      path: `/users/${req.params.id}`,
      query: { includeProfile: true },
    });
  });
});
```

The upstream response will be transparently transmitted directly: 2xx / 3xx / 4xx / 5xx will not be packaged into `{ code, data, requestId }`. Only proxy-local errors will be responded to with vext-style errors, such as missing `path/url`, target does not exist, Authorization passthrough is prohibited, upstream network error 502, or timeout 504.

### Header merging and Authorization

The request header priority is:

```text
target.headers
  < forwardHeaders
  < target.defaultInjectHeaders
  < options.headers
  < options.injectHeaders
```

Target and call-level `forwardHeaders` combine into a whitelist read from current `req.headers`; an empty call-level array does not clear the target whitelist. Proxy does not reuse ordinary fetch's ALS automatic propagation. To forward request ID, explicitly whitelist its header or inject `req.requestId`. Raw `Authorization` is not forwarded by default; target or call config must set `allowAuthorizationForward: true` and whitelist `authorization`.

```typescript
await app.fetch.proxy.userService(req, res, {
  path: "/profile",
  forwardHeaders: ["authorization"],
  allowAuthorizationForward: true,
});
```

### Direct URL pattern

If you are only temporarily proxying to a full URL, you do not need to configure the target:

```typescript
await app.fetch.proxy(req, res, {
  url: "https://partner.example.com/status",
});
```

### proxy retry rules

Proxy `retry` counts extra attempts, for `retry + 1` total. Priority is `options.retry > target.retry > config.fetch.retry > 0`, likewise for `retryDelay`. Only GET / HEAD / OPTIONS / PUT / DELETE retry on upstream 5xx or network error; POST / PATCH do not. The body must be replayable; streamed bodies do not retry automatically. Timeouts do not retry. A timeout before response headers can return a local 504; after body streaming starts, the stream aborts and cannot be replaced with a complete JSON 504. Proxy timing covers the upstream response stream, and a client disconnect cancels upstream.

By default, proxy preserves the inbound method, merges inbound query with `options.query` taking priority (null/undefined removes a key), and reads the raw body for non-GET/HEAD calls without `options.body`. It uses manual redirects to preserve 3xx, strips hop-by-hop headers, Content-Length and Content-Encoding, and retains multiple Set-Cookie headers. This is not byte-for-byte copying of the HTTP message. See [Fetch API](/api/fetch) for all options.

## requestId automatically propagates

With request context enabled and an ID in its store, ordinary `app.fetch` can propagate that ID. The requestId middleware accepts a valid inbound header or creates an ID and writes it to `requestContext` (based on `AsyncLocalStorage`). The client then:

1. Read the current `requestId` from `requestContext.getStore()`
2. Add the ID only if the outbound header is not already set. Its name follows `config.requestId.header`, default `x-request-id`.

```
Client → [VextJS A: requestId=abc123] → app.fetch → [VextJS B: x-request-id=abc123]
                                                        ↓
                                                   requestId middleware reads and retains abc123
```

### Disable requestId propagation

Some external APIs do not support custom headers and propagation can be disabled:

```typescript
const response = await app.fetch.get("https://third-party-api.com/data", {
  propagateRequestId: false, // Do not inject x-request-id
  // Note: propagatedHeaders (such as x-trace-id) will still be transparently transmitted
});
```

## Forward selected request headers (propagateHeaders)

In addition to `requestId`, `app.fetch` can forward selected inbound request headers to downstream services. Typical examples are a tracing header (`traceparent`) and an application-specific tenant header (`x-tenant-id`).

### Configuration method

Declare the header names that need to be transparently transmitted in `config.fetch.propagateHeaders`:

```typescript
// src/config/default.ts
export default {
  fetch: {
    propagateHeaders: [
      "traceparent", // W3C Trace Context (OpenTelemetry / Jaeger / Zipkin)
      "tracestate", // W3C Trace Context additional state
      "x-tenant-id", // Multi-tenant ID
    ],
  },
};
```

### Working principle

The framework handles this chain for each inbound request:

```text
① Inbound traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
         ↓
② Request metadata middleware stores it in store.propagatedHeaders, independently of requestId.enablement
         ↓
③ app.fetch reads that store and adds it to outbound headers
         ↓
④ Downstream receives the same traceparent
         ↓
⑤ Downstream can read the header; creating an APM span still requires instrumentation
```

Ordinary fetch adds captured store headers unless explicit `init.headers` or subclient defaults take priority. Capture requires request context; disabled context or a call outside its scope has no automatic propagation. `init.propagateHeaders` currently has no runtime filter or addition effect. The local example above demonstrates the path with `x-tenant-id`.

### Forward a header for one request

If a header is not listed in the global `propagateHeaders` but one request needs it, set it explicitly in `init.headers`:

```typescript
const token = req.headers["x-partner-token"];
await app.fetch.get("https://partner-api.com/data", {
  headers: token ? { "x-partner-token": token } : {},
  signal: req.signal,
});
```

:::tip requestId vs traceId

- **requestId** (vext built-in): automatically generated for log correlation and internal inter-service tracking
- **traceId** (APM system): generated by OpenTelemetry / Jaeger, etc., transparently transmitted through `propagateHeaders`

See [Request Context and distributed tracing](/guide/request-context#relationship-with-distributed-tracing-traceid).
:::

## Timeout control

`app.fetch` uses `AbortController` to implement timeout control. Throw an `Error` with explicit information after the timeout:

```typescript
try {
  const response = await app.fetch.get("https://slow-api.example.com/data", {
    timeout: 3000, // 3 seconds timeout
  });
  const data = await response.json();
  res.json(data);
} catch (err) {
  if (err instanceof Error && err.name === "TimeoutError") {
    app.throw(504, "Downstream service timeout");
  }
  throw err; // Preserve network and body-parsing errors.
}
```

Pass `{ signal: req.signal }` explicitly to propagate inbound cancellation; ordinary fetch does not read the current `req.signal` automatically. The caller signal combines with the internal timeout and retains its cancellation reason, stopping a request or retry wait. Ordinary timeout is per attempt and covers response headers only. Body reading still observes the caller signal. Total time also includes retries, retry waits and body consumption.

`init.timeout`, `create({ timeout })`, `config.fetch.timeout`, and proxy `timeout` follow the same boundary: a finite positive number no greater than `2147483647` milliseconds. `retryDelay` may be `0`, but it must also be finite and no greater than `2147483647` milliseconds; function return values are validated before every retry.

## Automatic retry

Retry requires an idempotent method (GET / HEAD / OPTIONS / PUT / DELETE), a replayable body and remaining attempts. POST / PATCH do not retry. A Request with an original body not replaced by replayable `init.body`, or a streaming body, does not retry. The upstream service still determines whether the business operation is truly idempotent.

### List of idempotent methods

The following methods are considered idempotent and allow automatic retries:

| Method  | Idempotent | Retryable |
| ------- | :--------: | :-------: |
| GET     |     ✅     |    ✅     |
| HEAD    |     ✅     |    ✅     |
| OPTIONS |     ✅     |    ✅     |
| PUT     |     ✅     |    ✅     |
| DELETE  |     ✅     |    ✅     |
| POST    |     ❌     |    ❌     |
| PATCH   |     ❌     |    ❌     |

### Trigger conditions

| Condition                                                        | Whether to retry | Description                                            |
| ---------------------------------------------------------------- | :--------------: | ------------------------------------------------------ |
| HTTP 5xx response                                                |        ✅        | Server error, retry may restore                        |
| Network error (connection failure, DNS resolution failure, etc.) |        ✅        | Transient network problem, retry may succeed           |
| HTTP 4xx response                                                |        ❌        | Client error, retrying is meaningless                  |
| Internal timeout (`TimeoutError`)                                |        ❌        | Throw `Error` directly without retrying                |
| Non-idempotent method (POST / PATCH)                             |        ❌        | Do not retry any errors to avoid repeated side effects |

### Retry decision process

```
request issued
  │
  ├── Success (2xx/3xx/4xx)
  │ └── Return directly to Response ✅
  │
  ├── 5xx response
  │ ├── Is it an idempotent method?
  │ │ ├── YES + There are still retry times → Wait for retryDelay → Retry
  │ │ ├── YES + last retry → return original Response ⚠️ (no error thrown)
  │ │ └── NO → Return Response directly
  │ └──
  │
  ├── Network errors (connection failure, DNS, etc.)
  │ ├── It is an idempotent method + there are retry times → wait for retryDelay → retry
  │ └── The last or non-idempotent → throws Error ❌
  │
  └── Internal timeout (`TimeoutError`)
        └── Throw Error directly ❌ (without retrying)
```

### Behavior when the final retry fails

This is the most important detail - the final behavior of 5xx and network errors is different:

| Scenario                              | Final Action        | Description                                                                             |
| ------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| 5xx + all retries are exhausted       | **Return Response** | The caller needs to check `response.ok` or `response.status` to handle errors by itself |
| Network error + all retries exhausted | **Throw Error**     | The caller needs to try/catch to capture                                                |
| Timeout                               | **Throws Error**    | `[app.fetch] GET /api/xxx timed out after 10000ms`                                      |

```typescript
// 5xx ultimately fails → returns Response (does not throw)
const response = await app.fetch.get("https://api.example.com/data", {
  retry: 2,
});
if (!response.ok) {
  // 3 attempts (1 + 2 retry) all return 5xx
  app.logger.error(
    { status: response.status },
    "API request failed after retries",
  );
}

// Network error eventually fails → throw Error
try {
  await app.fetch.get("https://unreachable.example.com/data", { retry: 2 });
} catch (err) {
  // Failed to connect after 3 attempts
  app.logger.error({ err }, "API unreachable after retries");
}
```

### Retry log

Each retry will record a `debug` level log, including the current number of retries and the maximum number of retries:

```json
{"level":20,"type":"outbound","method":"GET","url":"https://api.example.com/data","attempt":1,"maxRetries":3,"msg":"→ GET https://api.example.com/data RETRY attempt 1/3"}
{"level":20,"type":"outbound","method":"GET","url":"https://api.example.com/data","attempt":2,"maxRetries":3,"msg":"→ GET https://api.example.com/data RETRY attempt 2/3"}
```

The retry log is not recorded for the first request, and is only output when `attempt >= 1`. In the production environment, `logger.level: 'info'` will not output the retry log (the debug level is silenced).

### Exponential backoff

`retryDelay` supports functional form to implement exponential backoff strategy:

```typescript
const response = await app.fetch.get("https://api.example.com/data", {
  retry: 3,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  // attempt 1: 2000ms
  // attempt 2: 4000ms
  //attempt 3: 8000ms
});
```

The default `retryDelay` is fixed `1000ms` (1 second).

## Structured log

Each actual outbound attempt records a structured log; retry waits produce separate debug logs. Argument validation and a failing before-hook may happen before any attempt, so those paths do not guarantee this log. Fields include:

| Field       | Description                               |
| ----------- | ----------------------------------------- |
| `type`      | Fixed to `"outbound"`                     |
| `method`    | HTTP method                               |
| `url`       | Request URL                               |
| `status`    | Response status code (when successful)    |
| `duration`  | Time taken (milliseconds)                 |
| `requestId` | requestId of the current request          |
| `error`     | Error message (on failure)                |
| `attempt`   | Current number of retries (when retrying) |

Log levels automatically adjust based on response status:

| Conditions                         | Log Level |
| ---------------------------------- | --------- |
| 2xx (`response.ok`)                | `debug`   |
| 3xx / 4xx                          | `warn`    |
| 5xx                                | `error`   |
| Network error / internal timeout   | `error`   |
| Caller cancellation during request | `debug`   |

Example of log output:

```
[14:23:05.123] DEBUG → GET https://api.example.com/users 200 45ms
[14:23:06.456] WARN → POST https://api.example.com/login 401 12ms
[14:23:07.789] ERROR → GET https://api.example.com/data TIMEOUT 10003ms (limit: 10000ms)
[14:23:08.012] DEBUG → GET https://api.example.com/data RETRY attempt 1/3
```

`duration` is the time for a single attempt to obtain response headers, excluding retry wait and body consumption. Ordinary fetch follows redirects by default; only a 3xx actually returned is logged as warn. Logger thresholds still control output.

## Replace fetch implementation

The current version does not expose the `app.setFetch()` public API, so it does not support directly replacing the framework's built-in `app.fetch` in the plug-in.

If your application already uses another HTTP SDK, mount it as a separate client with plugin `app.extend()` and follow that SDK's own installation and configuration instructions. Keep built-in `app.fetch` so framework behavior depending on it remains available.

```typescript
// In a plugin that has installed and configured its chosen SDK:
app.extend("otherHttpClient", configuredClient);
```

:::warning
If you bypass the built-in `app.fetch`, requestId propagation, timeouts, retries and structured logging will all need to be implemented yourself. In most scenarios, it is recommended to use the built-in `app.fetch` directly, or mount a dedicated client based on `app.fetch.create()`.
:::

## Advanced example: organizing microservice clients

The two-file example above directly verifies outbound calls. This section shows business organization with a plugin and Service. To run it, supply user and inventory services, an order route calling this Service, and persistence. The three upstream contracts are GET `/api/users/:id` returning `{ id }`, GET `/api/stock/:id` returning `{ available }`, and POST `/api/stock/:id/deduct` accepting `{ quantity, orderId }` with 2xx on success. Read `data` instead if an upstream wraps responses.

```typescript
// src/plugins/service-clients.ts
import { definePlugin, type VextFetchClient } from "vextjs";

declare module "vextjs" {
  interface VextApp {
    userClient: VextFetchClient;
    inventoryClient: VextFetchClient;
  }
}

export default definePlugin({
  name: "service-clients",

  setup(app) {
    app.extend(
      "userClient",
      app.fetch.create({
        baseURL: process.env.USER_SERVICE_URL ?? "http://user-service:3001",
        timeout: 5000,
        retry: 2,
      }),
    );

    app.extend(
      "inventoryClient",
      app.fetch.create({
        baseURL:
          process.env.INVENTORY_SERVICE_URL ?? "http://inventory-service:3002",
        timeout: 8000,
        retry: 1,
      }),
    );
  },
});
```

```typescript
// src/services/order.ts
import { randomUUID } from "node:crypto";
import type { VextApp } from "vextjs";

export default class OrderService {
  constructor(private app: VextApp) {}

  async createOrder(userId: string, productId: string, quantity: number) {
    // 1. Query the user.
    const userResp = await this.app.userClient.get(
      `/api/users/${encodeURIComponent(userId)}`,
    );
    if (!userResp.ok) {
      await userResp.body?.cancel();
      this.app.throw(
        userResp.status === 404 ? 404 : 502,
        "User service query failed",
      );
    }
    const user = (await userResp.json()) as { id: string };

    // 2. Check inventory.
    const stockResp = await this.app.inventoryClient.get(
      `/api/stock/${encodeURIComponent(productId)}`,
    );
    if (!stockResp.ok) {
      await stockResp.body?.cancel();
      this.app.throw(502, "Inventory service unavailable");
    }
    const stock = (await stockResp.json()) as { available: number };

    if (stock.available < quantity) {
      this.app.throw(400, "Insufficient inventory");
    }

    // 3. Deduct inventory.
    const orderId = randomUUID();
    const deducted = await this.app.inventoryClient.post(
      `/api/stock/${encodeURIComponent(productId)}/deduct`,
      { quantity, orderId },
    );
    if (!deducted.ok) {
      await deducted.body?.cancel();
      this.app.throw(502, "Inventory deduction failed");
    }
    await deducted.arrayBuffer();

    // 4. Create the order record.
    return {
      orderId,
      userId: user.id,
      productId,
      quantity,
      status: "created",
    };
  }
}
```

The caller should validate userId, productId and quantity and derive identity from authentication context. Inventory deduction must be atomic and idempotent by orderId; the business must implement compensation if order creation fails. A request ID correlates outbound calls when context exists but does not provide transactions, compensation or a full distributed Trace.

## Next step

- Learn how [requestId and request context](/guide/request-context) generate and manage request IDs
- See [plugins](/guide/plugins) how to mount a custom client through `app.extend()`
- Explore global configuration items related to `fetch` in [Configuration](/guide/configuration)
- Learn how to mock `app.fetch` for unit testing in [Testing](/guide/testing)

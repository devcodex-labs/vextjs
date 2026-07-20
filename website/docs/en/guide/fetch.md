# Built-in HTTP client (app.fetch)

VextJS has a built-in enhanced HTTP client `app.fetch`, which is based on the Node.js 20+ native `fetch` package and provides capabilities such as **requestId automatic propagation**, **timeout control**, **automatic retry**, **structured log**, **create() factory** and **config driver agent**. There is no need to install any third-party HTTP libraries to make inter-service calls.

## Function overview

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

The signature of `app.fetch` is fully compatible with native `fetch` and can be replaced seamlessly:

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/users/:id/posts",
    {
      validate: { param: { id: "string!" } },
    },
    async (req, res) => {
      const { id } = req.valid("param");

      // Use app.fetch to call downstream services
      const response = await app.fetch(
        `https://api.example.com/users/${id}/posts`,
      );
      const posts = await response.json();

      res.json(posts);
    },
  );
});
```

:::tip
`app.fetch` will automatically inject the `requestId` of the current request into the `x-request-id` header of the outbound request. If downstream services also use VextJS, they will automatically receive and continue this tracking ID to implement distributed link tracking.
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

`fetch:before` and `proxy:before` are propagable hooks. Throwing an error will prevent this outbound request; `fetch:after/error` and `proxy:after/error` are safe hooks, which only record failures and do not change the main process.

## Shortcut method

In addition to calling `app.fetch(url, init)` directly, shortcuts to commonly used HTTP methods are also provided:

### GET

```typescript
const response = await app.fetch.get("https://api.example.com/users");
const users = await response.json();
```

### POST

The second parameter of the `post` / `put` / `patch` method is the request body object, which will automatically `JSON.stringify` and set `Content-Type: application/json`:

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

Configure global defaults through the `fetch` field in `vext.config.ts`:

```typescript
// vext.config.ts
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
`timeout` must be a finite positive number no greater than `2147483647` milliseconds. `retryDelay` must be a finite non-negative number no greater than `2147483647` milliseconds. Function-form `retryDelay` return values are checked before each native timer is created.
:::

:::tip propagateHeaders working principle
After configuration, the `requestId` middleware will read the header value specified in the list from the inbound request header when each request comes in.
Write to `requestContext.store.propagatedHeaders`. `app.fetch` automatically reads and injects from the store during outbound requests.

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

#### VextFetchInit complete field

| `VextFetchInit` inherits from the standard `RequestInit` and extends the following fields: | Field                                   | Type                             | Default Value                                                                                                                                      | Description |
| ------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `timeout`                                                                                  | `number`                                | Global `config.fetch.timeout`    | Request timeout (milliseconds)                                                                                                                     |
| `retry`                                                                                    | `number`                                | global `config.fetch.retry`      | Number of retries (idempotent methods only)                                                                                                        |
| `retryDelay`                                                                               | `number \| (attempt: number) => number` | Global `config.fetch.retryDelay` | Retry interval, supports exponential backoff in functional form                                                                                    |
| `propagateRequestId`                                                                       | `boolean`                               | `true`                           | Whether to automatically inject the `x-request-id` header (`propagatedHeaders` will still be transparently transmitted when disabled)              |
| `propagateHeaders`                                                                         | `string[]`                              | —                                | Additional headers that need to be transparently transmitted in this request (must be declared in `config.fetch.propagateHeaders` to have a value) |

:::tip priority
Single request `init.timeout` > `options.timeout` of `create()` > Global `config.fetch.timeout`
:::

## create() factory

When you need to call the same downstream service frequently, use `create()` to create a preconfigured subclient to avoid repeatedly passing in `baseURL` and public headers:

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "api-clients",

  setup(app) {
    //Create user service client
    const userServiceClient = app.fetch.create({
      baseURL: "http://user-service:3001/api/v1",
      headers: {
        "x-service-name": "order-service",
        Authorization: `Bearer ${app.config.serviceToken}`,
      },
      timeout: 5000,
      retry: 2,
    });

    // Create payment service client
    const paymentClient = app.fetch.create({
      baseURL: "http://payment-service:3002/api/v1",
      headers: {
        "x-service-name": "order-service",
      },
      timeout: 15000, // Set the payment service timeout to be longer
    });

    //Mount to app for global use
    app.extend("clients", {
      userService: userServiceClient,
      payment: paymentClient,
    });
  },
});
```

Use in a route or service:

```typescript
export default defineRoutes((app) => {
  app.post(
    "/orders",
    {
      validate: {
        body: {
          productId: "string!",
          quantity: "number:1-99!",
        },
      },
    },
    async (req, res) => {
      const body = req.valid("body");

      // Use pre-configured subclient - automatically concatenate baseURL + merge headers
      const userResp = await app.clients.userService.get(
        `/users/${req.userId}`,
      );
      const user = await userResp.json();

      const payResp = await app.clients.payment.post("/charges", {
        userId: user.id,
        amount: body.quantity * 100,
      });
      const charge = await payResp.json();

      res.json({ orderId: charge.orderId }, 201);
    },
  );
});
```

### VextFetchClientOptions

| Field     | Type                     | Required | Description                                                  |
| --------- | ------------------------ | -------- | ------------------------------------------------------------ |
| `baseURL` | `string`                 | ✅       | Base URL, all request paths are automatically spliced        |
| `headers` | `Record<string, string>` | ❌       | Default request headers (merged with single request headers) |
| `timeout` | `number`                 | ❌       | Subclient default timeout                                    |
| `retry`   | `number`                 | ❌       | The default number of retries for subclients                 |

:::info nested create
Subclients also support calling `create()` again to create more fine-grained clients:

```typescript
const apiClient = app.fetch.create({ baseURL: "https://api.example.com" });
const v2Client = apiClient.create({ baseURL: "https://api.example.com/v2" });
```

:::

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

`forwardHeaders` reads from the current `req.headers` whitelist. The original `Authorization` is not passed through by default; it will only be passed through if the target configuration or single call explicitly sets `allowAuthorizationForward: true` and the whitelist contains `authorization`.

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

The agent's retry represents "extra attempts", and the total number of attempts is `retry + 1`. The priority is `options.retry > target.retry > config.fetch.retry > 0`, the same is true for `retryDelay`. Only idempotent methods such as GET / HEAD / OPTIONS / PUT / DELETE will automatically retry in the event of upstream 5xx or network errors; POST / PATCH does not retry by default. There is no retry after timeout, and a local 504 is returned directly.

## requestId automatically propagates

This is one of the core capabilities of `app.fetch`. When an HTTP request comes into VextJS, the `requestId` middleware generates a unique ID for it and writes it to the `requestContext` (based on `AsyncLocalStorage`). When you use `app.fetch` to call a downstream service, the framework automatically:

1. Read the current `requestId` from `requestContext.getStore()`
2. Inject the `x-request-id` header into the outbound request

```
Client → [VextJS A: requestId=abc123] → app.fetch → [VextJS B: x-request-id=abc123]
                                                        ↓
                                                   requestId middleware reads and inherits abc123
```

### Disable requestId propagation

Some external APIs do not support custom headers and propagation can be disabled:

```typescript
const response = await app.fetch.get("https://third-party-api.com/data", {
  propagateRequestId: false, // Do not inject x-request-id
  // Note: propagatedHeaders (such as x-trace-id) will still be transparently transmitted
});
```

## Custom header transparent transmission (propagateHeaders)

In addition to `requestId`, `app.fetch` also supports automatic transparent transmission of other inbound request headers to downstream - typical uses are distributed link tracing headers (`traceparent`) and multi-tenant identification (`x-tenant-id`).

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

The framework automatically completes the transparent transmission link when processing each inbound request, **without any manual operation**:

```
① Inbound requests carry traceparent: 00-abc123-def456-01
         ↓
② requestId middleware reads and writes store.propagatedHeaders
         ↓
③ app.fetch reads from the store during outbound requests and injects them into the request header.
         ↓
④ The downstream service receives traceparent: 00-abc123-def456-01
         ↓
⑤ The APM system identifies the same trace and establishes a span association.
```

```typescript
// No additional code is required in routing, the framework automatically handles transparent transmission
export default defineRoutes("/orders", [
  {
    method: "POST",
    handler: async (req, res) => {
      // traceparent has automatically been transparently passed from inbound request to inventory-service
      const stock = await app.fetch.get("http://inventory-service/check");
      // Also automatically transparently transmitted to payment-service
      const payment = await app.fetch.post(
        "http://payment-service/charge",
        req.body,
      );

      res.json({ orderId: "new-id" });
    },
  },
]);
```

### Manual transparent transmission (temporary solution)

If a header is not declared in the global `propagateHeaders`, but this request requires transparent transmission, set it manually in `init.headers`:

```typescript
await app.fetch.get("https://partner-api.com/data", {
  headers: {
    "x-partner-token": req.headers["x-partner-token"] as string,
  },
});
```

:::tip requestId vs traceId

- **requestId** (vext built-in): automatically generated for log correlation and internal inter-service tracking
- **traceId** (APM system): generated by OpenTelemetry / Jaeger, etc., transparently transmitted through `propagateHeaders`

For details, see [Request Context → Relationship with Distributed Tracing](/guide/request-context#Relationship with Distributed Tracing traceId) for complete instructions.
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
  // err.message: "[app.fetch] GET https://slow-api.example.com/data timed out after 3000ms"
  app.throw(504, "Downstream service timeout");
}
```

If the request is passed in `signal` at the same time (such as manual cancellation by the user), `app.fetch` will merge the two signals - either trigger will abort the request.

`init.timeout`, `create({ timeout })`, `config.fetch.timeout`, and proxy `timeout` follow the same boundary: a finite positive number no greater than `2147483647` milliseconds. `retryDelay` may be `0`, but it must also be finite and no greater than `2147483647` milliseconds; function return values are validated before every retry.

## Automatic retry

Retry only takes effect for **idempotent methods** (GET / HEAD / OPTIONS / PUT / DELETE), POST / PATCH will not be retried (to avoid repeated execution of side effects).

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
| Timeout (AbortError)                                             |        ❌        | Throw `Error` directly without retrying                |
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
  └── Timeout (AbortError)
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

Structured logs are automatically recorded for each outbound request, containing the following fields:

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

| Conditions            | Log Level |
| --------------------- | --------- |
| 2xx / 3xx             | `debug`   |
| 4xx                   | `warn`    |
| 5xx                   | `error`   |
| Network error/timeout | `error`   |

Example of log output:

```
[14:23:05.123] DEBUG → GET https://api.example.com/users 200 45ms
[14:23:06.456] WARN → POST https://api.example.com/login 401 12ms
[14:23:07.789] ERROR → GET https://api.example.com/data TIMEOUT 10003ms (limit: 10000ms)
[14:23:08.012] DEBUG → GET https://api.example.com/data RETRY attempt 1/3
```

## Replace fetch implementation

The current version does not expose the `app.setFetch()` public API, so it does not support directly replacing the framework's built-in `app.fetch` in the plug-in.

If you need to use axios or other HTTP clients, it is recommended to mount the independent client through `app.extend()` in the plugin instead of overriding the built-in implementation:

```typescript
import { definePlugin } from "vextjs";
import axios from "axios";

export default definePlugin({
  name: "axios-fetch",

  setup(app) {
    app.extend(
      "axios",
      axios.create({
        baseURL: process.env.API_BASE_URL,
        timeout: 5000,
      }),
    );
  },
});
```

:::warning
If you bypass the built-in `app.fetch`, requestId propagation, timeouts, retries and structured logging will all need to be implemented yourself. In most scenarios, it is recommended to use the built-in `app.fetch` directly, or mount a dedicated client based on `app.fetch.create()`.
:::

## Complete example: calls between microservices

Here is a complete example of an order service calling a user service and an inventory service:

```typescript
// src/plugins/service-clients.ts
import { definePlugin } from "vextjs";

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
export class OrderService {
  constructor(private app: VextApp) {}

  async createOrder(userId: string, productId: string, quantity: number) {
    // 1. Query user information
    const userResp = await this.app.userClient.get(`/api/users/${userId}`);
    if (!userResp.ok) {
      this.app.throw(400, "User does not exist");
    }
    const user = await userResp.json();

    // 2. Check inventory
    const stockResp = await this.app.inventoryClient.get(
      `/api/stock/${productId}`,
    );
    if (!stockResp.ok) {
      this.app.throw(500, "Inventory service is not available");
    }
    const stock = await stockResp.json();

    if (stock.available < quantity) {
      this.app.throw(400, "Insufficient Stock", "INSUFFICIENT_STOCK");
    } // 3. Deduct inventory
    await this.app.inventoryClient.post(`/api/stock/${productId}/deduct`, {
      quantity,
      orderId: `order-${Date.now()}`,
    });

    // 4. Create order record
    return {
      orderId: `order-${Date.now()}`,
      userId: user.id,
      productId,
      quantity,
      status: "created",
    };
  }
}
```

Throughout the call chain, `requestId` is automatically propagated from inbound requests to all outbound requests, enabling complete distributed tracing.

## Next step

- Learn how the [requestId and request context](/guide/middleware) middleware generates and manages requestIds
- See [plugins](/guide/plugins) how to mount a custom client through `app.extend()`
- Explore global configuration items related to `fetch` in [Configuration](/guide/configuration)
- Learn how to mock `app.fetch` for unit testing in [Testing](/guide/testing)

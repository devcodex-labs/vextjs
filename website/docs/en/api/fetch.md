# Fetch API

This page is the API reference for the built-in `app.fetch` HTTP client. See the [Built-in HTTP Client Guide](/guide/fetch) for full usage and examples.

Here, `app` means a real application instance from plugin setup, a service, or `req.app`. The current `defineRoutes` factory parameter is a bound function that does not retain fetch shortcuts, create, or proxy. In a handler use `req.app.fetch`; directly calling factory `app.fetch(url, init)` still works. See the [basic guide example](/guide/fetch#basic-usage).

## app.fetch(input, init?)

Send an HTTP request. Signatures are compatible with native `fetch`, with additional support for timeouts, retries and requestId propagation.

```typescript
type FetchCall = (
  input: string | URL | Request,
  init?: VextFetchInit,
) => Promise<Response>;
```

**Parameters**

| Parameters | Type                       | Description                                                 |
| ---------- | -------------------------- | ----------------------------------------------------------- |
| `input`    | `string \| URL \| Request` | Request URL or Request object                               |
| `init`     | `VextFetchInit`            | Optional, request configuration (see type definition below) |

**Return value:** `Promise<Response>`, a standard Fetch Response. HTTP 4xx/5xx returns a Response for the caller to check via `ok/status`. Network failures, internal timeout, and cancellation reject. The caller consumes the body.

Outbound lifecycles include `fetch:before/after/error` and proxy `proxy:before/after/error`. Before runs once per operation; after receives the final Response, including HTTP 5xx. Error does not cover every pre-parse, before-hook, or body-consumption failure. An ordinary before-hook error rejects directly; proxy before-hook errors enter local proxy error handling. See [Hooks Guide](/guide/hooks) for payload, attempt, and error boundaries.

---

## Shortcut method

### app.fetch.get(url, init?)

```typescript
app.fetch.get(url: string, init?: VextFetchInit): Promise<Response>
```

Send a GET request.

### app.fetch.post(url, body?, init?)

```typescript
app.fetch.post(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

Send POST. Non-null/undefined body is JSON-stringified; `application/json` is added only when no Content-Type was explicitly supplied. Null/undefined creates no body or default Content-Type but retains explicit headers. Use the generic call for FormData, binary, or streams.

### app.fetch.put(url, body?, init?)

```typescript
app.fetch.put(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

Send PUT. Non-null body JSON serialization and explicit Content-Type preservation match `post`.

### app.fetch.patch(url, body?, init?)

```typescript
app.fetch.patch(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

Send PATCH. Non-null body JSON serialization and explicit Content-Type preservation match `post`.

### app.fetch.delete(url, init?)

```typescript
app.fetch.delete(url: string, init?: VextFetchInit): Promise<Response>
```

Send a DELETE request.

---

## app.fetch.create(options)

Create a preconfigured subclient with baseURL, default headers, timeout, retry count, and delay. Unspecified timeout/retry/retryDelay inherit from the factory that created it.

```typescript
app.fetch.create(options: VextFetchClientOptions): VextFetchClient
```

The subclient also has all shortcuts and `create()`, but no `proxy`. Proxy exists only on root `app.fetch.proxy`.

```typescript
const client = app.fetch.create({
  baseURL: "http://user-service:3001/api/v1",
  headers: { "x-service-name": "order-service" },
  timeout: 5000,
  retry: 2,
});

// Automatically splice baseURL
const response = await client.get("/users/123");
// Actual request: GET http://user-service:3001/api/v1/users/123
```

String input is appended to the baseURL with trailing slash removed; a leading `/` does not discard `/api/v1`. Even an absolute URL string is appended. Use the root client to bypass baseURL, or pass a URL/Request object to the subclient. Per-call headers override subclient headers, and both override headers propagated automatically from AsyncLocalStorage.

Nested `create()` currently reuses the parent factory that created the subclient; it does not accumulate each subclient's baseURL/headers/timeout. Pass retained settings explicitly.

---

## app.fetch.proxy

`app.fetch.proxy` is used to proxy the current request to the upstream service in the routing handler, and transparently transmit the upstream response directly to the client. It does not wrap 2xx / 3xx / 4xx / 5xx upstream responses as `{ code, data, requestId }`; only proxy-local errors such as local parameter errors, target non-existence, upstream network errors, or timeouts return vext-style error responses.

### Named Target Proxy

Named targets come from `config.fetch.proxy[]`:

```typescript
// src/config/default.ts
export default {
  fetch: {
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

`name` will be mapped to `app.fetch.proxy.<name>`, the reserved name `then` cannot be used.

Put this registration fragment inside `defineRoutes((app) => { ... })`. In its handler, use the real instance at `req.app.fetch.proxy.<name>(req, res, options)`:

```typescript
app.get("/users/:id", async (req, res) => {
  await req.app.fetch.proxy.userService(req, res, {
    path: `/users/${req.params.id}`,
    query: { includeProfile: true },
    injectHeaders: { "x-route": "users-proxy" },
  });
});
```

### Direct URL proxy

Without a named target, call `req.app.fetch.proxy(req, res, { url })` directly:

```typescript
app.get("/health/upstream", async (req, res) => {
  await req.app.fetch.proxy(req, res, {
    url: "https://api.example.com/health",
  });
});
```

### header priority

Proxy request headers are merged in the following order, with the latter overriding the former:

```text
target.headers
  < forwardHeaders (passthrough from the current req.headers whitelist)
  < target.defaultInjectHeaders
  < options.headers
  < options.injectHeaders
```

`Authorization` will not passthrough from the current request by default. Passthrough of the original Authorization is only allowed if the target configuration or this call sets `allowAuthorizationForward: true` and `forwardHeaders` explicitly contains `authorization`.

The effective whitelist is the union of target and call lists; an empty call list does not clear target entries. Dynamic injection supports synchronous/async functions with `{ req, target, options }`. Null/undefined injected values are ignored rather than deleting existing headers.

Proxy does not use ordinary fetch AsyncLocalStorage propagation. Forward the incoming requestId header explicitly, or inject `{ "x-request-id": req.requestId }`. Either target or call-level Authorization permission can enable forwarding; call-level false does not revoke target-level true.

### retry contract

Agent retry configuration priority:

```text
options.retry > target.retry > config.fetch.retry > 0
options.retryDelay > target.retryDelay > config.fetch.retryDelay > 1000
```

`retry` counts extra attempts, so total attempts equal `retry + 1`. Only idempotent GET/HEAD/OPTIONS/PUT/DELETE methods are auto-retried, never POST/PATCH by default. Retry conditions are upstream 5xx or network failures such as DNS/connection errors. 2xx/3xx/4xx, timeout, and client cancellation do not retry. Proxy returns a local 504 only before response headers begin; timeout during body forwarding interrupts transfer and cannot be replaced with a complete JSON error. The request body must also be replayable; a stream is not made replayable just because the method is idempotent.

### Parameter and Response Boundaries

- A named target requires a nonempty path; direct proxy requires an absolute URL. Method defaults to req.method. GET/HEAD ignore body; other methods without an explicit body read the raw request body subject to maxBodySize.
- Query merges existing URL query, req.query, then options.query; null/undefined option values remove matching keys.
- Manual redirect preserves upstream 3xx. Forwarding filters hop-by-hop, Content-Length, and Content-Encoding headers while retaining multiple Set-Cookie headers. Response handling applies no-body semantics for HEAD, 204, and 304.
- Local proxy errors have `{ code, message, requestId }` JSON. Parameter errors are usually 400, missing targets 500, network failures 502, and timeout before headers 504. Once streaming starts, handle failure as part of stream lifecycle.

---

## Type definition

### VextFetchInit

Inherited from standard `RequestInit`, extending the following fields:

```typescript
interface VextFetchInit extends RequestInit {
  /** Request timeout (milliseconds), global config.fetch.timeout is used by default */
  timeout?: number;

  /**
   * Number of retries (only valid for idempotent methods GET/HEAD/OPTIONS/PUT/DELETE)
   * @default 0
   */
  retry?: number;

  /**
   * Retry interval (milliseconds) or exponential backoff function
   * @default 1000
   */
  retryDelay?: number | ((attempt: number) => number);

  /**
   * Whether to automatically inject the x-request-id header
   * @default true
   */
  propagateRequestId?: boolean;

  /** Reserved type field; this per-call option is not read at runtime. */
  propagateHeaders?: string[];
}
```

| Field                | Type                                    | Default Value                    | Description                                                                                                                           |
| -------------------- | --------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `timeout`            | `number`                                | `config.fetch.timeout` (10000)   | Request timeout (milliseconds)                                                                                                        |
| `retry`              | `number`                                | `config.fetch.retry` (0)         | Number of retries (idempotent methods only)                                                                                           |
| `retryDelay`         | `number \| (attempt: number) => number` | `config.fetch.retryDelay` (1000) | Retry interval, supports exponential backoff function                                                                                 |
| `propagateRequestId` | `boolean`                               | `true`                           | Whether to automatically inject the `x-request-id` header (`propagatedHeaders` will still be transmitted transparently when disabled) |
| `propagateHeaders`   | `string[]`                              | —                                | Current runtime does not read this per-call option; capture comes from inbound metadata middleware.                                   |

### VextFetchClientOptions

Configuration options for the `create()` factory method.

```typescript
interface VextFetchClientOptions {
  /** Basic URL, all request paths are automatically spliced */
  baseURL: string;

  /** Default request headers (merged with single request headers) */
  headers?: Record<string, string>;

  /** Subclient default timeout (milliseconds) */
  timeout?: number;

  /** Default retry times for sub-clients */
  retry?: number;

  /** Subclient default retry interval (milliseconds) or exponential backoff function */
  retryDelay?: number | ((attempt: number) => number);
}
```

| Field        | Type                                    | Required | Description                                                     |
| ------------ | --------------------------------------- | :------: | --------------------------------------------------------------- |
| `baseURL`    | `string`                                |    ✅    | Base URL, the request path is automatically spliced to this URL |
| `headers`    | `Record<string, string>`                |    ❌    | Default request headers                                         |
| `timeout`    | `number`                                |    ❌    | Override global timeout                                         |
| `retry`      | `number`                                |    ❌    | Override global retry                                           |
| `retryDelay` | `number \| (attempt: number) => number` |    ❌    | Override the global retry interval                              |

### VextFetch

Type definition for root `app.fetch`. It is not only a callable function, but also has shortcut methods, `create()` and `proxy` mounted.

```typescript
interface VextFetchClient {
  (input: string | URL | Request, init?: VextFetchInit): Promise<Response>;
  get(url: string, init?: VextFetchInit): Promise<Response>;
  post(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  put(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  patch(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  delete(url: string, init?: VextFetchInit): Promise<Response>;
  create(options: VextFetchClientOptions): VextFetchClient;
}

interface VextFetch extends VextFetchClient {
  proxy: VextFetchProxy;
  create(options: VextFetchClientOptions): VextFetchClient;
}
```

### VextFetchProxyOptions

```typescript
interface VextFetchProxyOptions {
  path?: string;
  url?: string;
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Exclude<RequestInit["body"], null | undefined> | Buffer | Uint8Array;
  maxBodySize?: number;
  headers?: Record<string, string>;
  forwardHeaders?: string[];
  injectHeaders?: VextFetchProxyHeaders;
  allowAuthorizationForward?: boolean;
  timeout?: number;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
}
```

Named target mode uses `path`; direct URL mode uses `url`. See [Parameter and Response Boundaries](#parameter-and-response-boundaries) for merging and body rules.

### VextFetchProxyTargetConfig

```typescript
interface VextFetchProxyTargetConfig {
  name: string;
  baseURL: string;
  headers?: Record<string, string>;
  forwardHeaders?: string[];
  defaultInjectHeaders?: VextFetchProxyHeaders;
  allowAuthorizationForward?: boolean;
  timeout?: number;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
}
```

### VextFetchProxyHeaders / HeaderContext

```typescript
interface VextFetchProxyHeaderContext {
  req: VextRequest;
  target?: VextFetchProxyTargetConfig;
  options: VextFetchProxyOptions;
}

type VextFetchProxyHeaders =
  | Record<string, string | number | boolean | null | undefined>
  | ((
      ctx: VextFetchProxyHeaderContext,
    ) =>
      | Record<string, string | number | boolean | null | undefined>
      | Promise<Record<string, string | number | boolean | null | undefined>>);
```

### VextFetchProxy / Handler

```typescript
type VextFetchProxyHandler = (
  req: VextRequest,
  res: VextResponse,
  options: VextFetchProxyOptions,
) => Promise<void>;

type VextFetchProxy = ((
  req: VextRequest,
  res: VextResponse,
  options: VextFetchProxyOptions,
) => Promise<void>) &
  Record<string, VextFetchProxyHandler>;
```

---

## Global configuration

Configure global defaults through `fetch` in `src/config/default.ts`:

```typescript
// src/config/default.ts
export default {
  fetch: {
    timeout: 10000,
    retry: 0,
    retryDelay: 1000,
    propagateHeaders: [],
    proxy: [],
  },
};
```

| Configuration item | Type                                    | Default value | Description                                                                                                                                                                       |
| ------------------ | --------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeout`          | `number`                                | `10000`       | Global default timeout (milliseconds)                                                                                                                                             |
| `retry`            | `number`                                | `0`           | Global default number of retries                                                                                                                                                  |
| `retryDelay`       | `number \| (attempt: number) => number` | `1000`        | Global default retry interval (milliseconds), supports exponential backoff function                                                                                               |
| `propagateHeaders` | `string[]`                              | `[]`          | Declares a list of header names that need to be automatically captured from inbound requests and transparently passed to outbound requests (such as `traceparent`, `x-tenant-id`) |
| `proxy`            | `VextFetchProxyTargetConfig[]`          | `[]`          | List of configured upstream targets for `app.fetch.proxy.<name>()`                                                                                                                |

:::tip propagateHeaders working principle
The framework captures listed incoming headers in request metadata middleware and writes `requestContext.store.propagatedHeaders`. Ordinary `app.fetch` reads and injects them on outbound calls. Capture depends on request context, not on the requestId switch; explicit outbound headers win. Proxy has its own whitelist.
**No need to pass it manually on every call**.

- Global configuration `config.fetch.propagateHeaders`: declare which headers need to be captured and transparently transmitted
- Headers not declared in the global configuration: manually set in `init.headers`
- See [Request Context](/guide/request-context) for the trace relationship.

:::

### Priority

```
Ordinary outbound request: single request init > create() options > global config.fetch

Proxy request: options > target (config.fetch.proxy[] single item) > global config.fetch
```

---

## Behavior description

Timeout must be a finite number in `(0, 2147483647]`, retry a nonnegative integer, and retryDelay or each function result a finite number in `[0, 2147483647]`. A delay callback's attempt starts at 1.

### Timeout

Ordinary `app.fetch` clears its timeout when response headers arrive, allowing a slow body to finish. The caller's `init.signal` or `Request.signal` continues to cancel body consumption. Each retry has a new attempt timer. The `app.fetch.proxy` timeout also covers forwarding the upstream body, and a disconnected client cancels the upstream request.

- Implemented using `AbortController` + `setTimeout`
- Internal ordinary-fetch timeout rejects with an Error named `TimeoutError`, message `[app.fetch] GET https://... timed out after 10000ms`.
- If `init.signal` is passed in at the same time, it will be merged with the timeout signal - any trigger will abort the request

### Retry

- **Only idempotent methods with replayable bodies** retry: GET/HEAD/OPTIONS/PUT/DELETE.
- **POST / PATCH does not retry** (to avoid repeated execution of side effects)
- Trigger condition: HTTP 5xx response or network error
- Not triggered by internal timeout, caller cancellation, or 4xx; a Request body without a replayable init replacement and streaming bodies do not retry.
- Exhausted 5xx returns a Response; exhausted network errors reject. Cancellation interrupts retry waits and preserves reason.
- Ordinary fetch does not automatically read `req.signal`; a handler must pass `{ signal: req.signal }` explicitly.
- `retryDelay` supports exponential backoff in functional form: `(attempt) => Math.min(1000 * 2 ** attempt, 10000)`

### requestId propagation

- Automatically read the `requestId` of the current request from `requestContext` (AsyncLocalStorage)
- Adds it only when present in the store and not already set on outbound headers. Header name follows `config.requestId.header`, default `x-request-id`.
- `propagateRequestId: false` disables only automatic requestId insertion, not an explicit header or other propagated headers.

### Structured log

Each actual attempt can log outbound activity; prevalidation or before-hook failures do not guarantee a log. Logger threshold still filters levels:

| Conditions                         | Log Level |
| ---------------------------------- | --------- |
| 2xx (`response.ok`)                | `debug`   |
| Actual 3xx/4xx                     | `warn`    |
| 5xx response                       | `error`   |
| Network error/timeout              | `error`   |
| Caller cancellation during request | `debug`   |

Log fields: `type: "outbound"` / `method` / `url` / `status` / `duration` / `requestId`

Proxy handling uses `type: "proxy"`.

---

## Replacement implementation

The current version does not expose the `app.setFetch()` public API, so direct replacement of the built-in implementation is not supported here.

If you need a different HTTP client strategy, it is recommended to keep `app.fetch` as the default implementation of the framework, and then additionally mount the custom client through a plug-in:

```typescript
app.extend(
  "customFetch",
  app.fetch.create({
    baseURL: "https://api.example.com",
    timeout: 5000,
  }),
);
```

:::warning
If `app.fetch` is completely bypassed, requestId propagation, timeouts, retries, and structured logging capabilities all need to be completed by yourself.
:::

---

## Type import

```typescript
import type {
  VextFetch,
  VextFetchClient,
  VextFetchConfig,
  VextFetchInit,
  VextFetchClientOptions,
  VextFetchProxyOptions,
  VextFetchProxyTargetConfig,
  VextFetchProxyHeaders,
  VextFetchProxyHeaderContext,
  VextFetchProxyHandler,
  VextFetchProxy,
} from "vextjs";
```

## Next step

- Read the [Built-in HTTP Client Guide](/guide/fetch) for complete usage and best practices
- View the mounting location of `app.fetch` in [Application Instance](/api/app)
- Understand the global configuration related to `fetch` in [Configuration Items](/api/config)

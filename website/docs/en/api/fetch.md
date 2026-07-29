# FetchAPI

This page provides a simplified API reference for the `app.fetch` built-in HTTP client. Complete usage guidelines, examples, and best practices are available in the [Built-in HTTP Client Guide](/guide/fetch).

## app.fetch(input, init?)

Send an HTTP request. Signatures are compatible with native `fetch`, with additional support for timeouts, retries and requestId propagation.

```typescript
const response: Promise<Response> = app.fetch(
  input: string | URL | Request,
  init?: VextFetchInit,
);
```

**Parameters**

| Parameters | Type                       | Description                                                 |
| ---------- | -------------------------- | ----------------------------------------------------------- |
| `input`    | `string \| URL \| Request` | Request URL or Request object                               |
| `init`     | `VextFetchInit`            | Optional, request configuration (see type definition below) |

**Return value**: `Promise<Response>` — standard Fetch API Response object

`app.fetch` will trigger `fetch:before`, `fetch:after`, `fetch:error` hook; `app.fetch.proxy` will trigger `proxy:before`, `proxy:after`, `proxy:error` hook. For the complete payload and execution strategy, see [Application instance hooks](/api/app#apphooks).

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

Send a POST request. When `body` is not `null`/`undefined`, `JSON.stringify` will be automatically set and `Content-Type: application/json` will be set; when `body` is empty, `Content-Type` will not be set and the request body will not be sent.

### app.fetch.put(url, body?, init?)

```typescript
app.fetch.put(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

Send a PUT request. `body` handling behaves the same as `post` (only sets `Content-Type` when `body != null`).

### app.fetch.patch(url, body?, init?)

```typescript
app.fetch.patch(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>
```

Send a PATCH request. `body` handling behaves the same as `post` (only sets `Content-Type` when `body != null`).

### app.fetch.delete(url, init?)

```typescript
app.fetch.delete(url: string, init?: VextFetchInit): Promise<Response>
```

Send a DELETE request.

---

## app.fetch.create(options)

Create a preconfigured subclient instance. Subclients have independent `baseURL`, default headers, timeout and retry configuration.

```typescript
app.fetch.create(options: VextFetchClientOptions): VextFetchClient
```

Complete shortcut methods (`get` / `post` / `put` / `patch` / `delete`) and `create()` are also mounted on the sub-client, but `proxy`\*\* will not be exposed. The proxy capability is only hung on the root `app.fetch.proxy` to avoid additional mental burden caused by `app.fetch.create().proxy`.

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

---

## app.fetch.proxy

`app.fetch.proxy` is used to proxy the current request to the upstream service in the routing handler, and transparently transmit the upstream response directly to the client. It does not wrap 2xx / 3xx / 4xx / 5xx upstream responses as `{ code, data, requestId }`; only proxy-local errors such as local parameter errors, target non-existence, upstream network errors, or timeouts return vext-style error responses.

### Name the target agent

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

Use `app.fetch.proxy.<name>(req, res, options)` when calling:

```typescript
app.get("/users/:id", async (req, res) => {
  await app.fetch.proxy.userService(req, res, {
    path: `/users/${req.params.id}`,
    query: { includeProfile: true },
    injectHeaders: { "x-route": "users-proxy" },
  });
});
```

### Direct URL proxy

When not using a named target, you can call `app.fetch.proxy(req, res, { url })` directly:

```typescript
app.get("/health/upstream", async (req, res) => {
  await app.fetch.proxy(req, res, {
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

### retry contract

Agent retry configuration priority:

```text
options.retry > target.retry > config.fetch.retry > 0
options.retryDelay > target.retryDelay > config.fetch.retryDelay > 1000
```

`retry` represents an additional number of attempts, so the total number of attempts is `retry + 1`. Only `GET` / `HEAD` / `OPTIONS` / `PUT` / `DELETE` these idempotent methods will automatically retry; `POST` / `PATCH` will not retry by default. Retryable conditions are network errors such as upstream 5xx or DNS/connection; 2xx/3xx/4xx does not retry, does not retry when timeout and returns local 504, and no longer writes a response when the client is disconnected.

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

  /**
   * This request additionally needs to be transparently transmitted to the header name list of the outbound request.
   *
   * The values of these headers will be read from requestContext.store.propagatedHeaders (provided by the requestId middleware
   * Capture writes during the inbound phase based on the config.fetch.propagateHeaders list).
   *
   * If you want to transparently transmit headers that are not declared in the global config.fetch.propagateHeaders,
   * Please set it manually in init.headers directly.
   *
   * @example ['traceparent', 'tracestate']
   */
  propagateHeaders?: string[];
}
```

| Field                | Type                                    | Default Value                    | Description                                                                                                                            |
| -------------------- | --------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `timeout`            | `number`                                | `config.fetch.timeout` (10000)   | Request timeout (milliseconds)                                                                                                         |
| `retry`              | `number`                                | `config.fetch.retry` (0)         | Number of retries (idempotent methods only)                                                                                            |
| `retryDelay`         | `number \| (attempt: number) => number` | `config.fetch.retryDelay` (1000) | Retry interval, supports exponential backoff function                                                                                  |
| `propagateRequestId` | `boolean`                               | `true`                           | Whether to automatically inject the `x-request-id` header (`propagatedHeaders` will still be transmitted transparently when disabled)  |
| `propagateHeaders`   | `string[]`                              | —                                | Additional transparent headers for this request (must be declared in `config.fetch.propagateHeaders` to read the value from the store) |

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
  body?: RequestInit["body"] | Buffer | Uint8Array;
  maxBodySize?: number;
  headers?: Record<string, string>;
  forwardHeaders?: string[];
  injectHeaders?: Record<string, string> | ((ctx) => Record<string, string>);
  allowAuthorizationForward?: boolean;
  timeout?: number;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
}
```

Use `path` for named target mode; use `url` for direct URL mode. If `method` is not passed, the current `req.method` will be used by default. When `body` is not passed, non-GET/HEAD requests will read the original body Buffer of the current `req` and forward it.

---

## Global configuration

Configure global defaults through the `fetch` field in `vext.config.ts`:

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
Once configured, the framework reads the headers specified in the list from the inbound request headers during the `requestId` middleware stage of each request.
Write to `requestContext.store.propagatedHeaders`. `app.fetch` automatically reads and injects from the store when outgoing.
**No need to pass it manually on every call**.

- Global configuration `config.fetch.propagateHeaders`: declare which headers need to be captured and transparently transmitted
- Headers not declared in the global configuration: manually set in `init.headers`
- For details, see [Request context → Relationship with distributed tracing](/guide/request-context#Relationship with distributed tracing traceId)
  :::

### Priority

```
Ordinary outbound request: single request init > create() options > global config.fetch

Proxy request: options > target (config.fetch.proxy[] single item) > global config.fetch
```

---

## Behavior description

### Timeout

- Implemented using `AbortController` + `setTimeout`
- `Error` is thrown after timeout, message format: `[app.fetch] GET https://... timed out after 10000ms`
- If `init.signal` is passed in at the same time, it will be merged with the timeout signal - any trigger will abort the request

### Try again

- **Impotent methods only** Retry: `GET` / `HEAD` / `OPTIONS` / `PUT` / `DELETE`
- **POST / PATCH does not retry** (to avoid repeated execution of side effects)
- Trigger condition: HTTP 5xx response or network error
- Not triggered: timeout (throw error directly), 4xx response
- `retryDelay` supports exponential backoff in functional form: `(attempt) => Math.min(1000 * 2 ** attempt, 10000)`

### requestId propagation

- Automatically read the `requestId` of the current request from `requestContext` (AsyncLocalStorage)
- Injected into the `x-request-id` header of outbound requests
- Set `propagateRequestId: false` to disable

### Structured log

Structured logging is automatically logged for every outbound request:

| Conditions            | Log Level |
| --------------------- | --------- |
| 2xx/3xx responses     | `debug`   |
| 4xx response          | `warn`    |
| 5xx response          | `error`   |
| Network error/timeout | `error`   |

Log fields: `type: "outbound"` / `method` / `url` / `status` / `duration` / `requestId`

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
} from "vextjs";
```

## Next step

- Read the [Built-in HTTP Client Guide](/guide/fetch) for complete usage and best practices
- View the mounting location of `app.fetch` in [Application Instance](/api/app)
- Understand the global configuration related to `fetch` in [Configuration Items](/api/config)

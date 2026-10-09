# Request and response

This page details the complete API of VextJS's request object `VextRequest` and response object `VextResponse`.

For a first endpoint, read [Routing](/guide/routing); use this page to look up members. Unless a file path is shown, `app.get/post/...` examples belong inside `defineRoutes((app) => { ... })`, and req/res fragments belong in the corresponding handler or middleware. They are not standalone entry files. [Standard CRUD Response](#standard-crud-response) below provides a complete route and config for checking combined usage.

## VextRequest

`VextRequest` is the unified request interface supplied by adapters. Public members support reusable business code; for TLS, raw requests, and extension fields, check the selected adapter's behavior.

### Public member list

| Properties    | Type                                    | Description                                                                                                                                                                 |
| ------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`      | `string`                                | HTTP method (uppercase, such as `'GET'`, `'POST'`)                                                                                                                          |
| `url`         | `string`                                | Request path plus query string; not guaranteed to contain protocol or host.                                                                                                 |
| `path`        | `string`                                | Path part (excluding query string)                                                                                                                                          |
| `route`       | `string`                                | The route template matched by the current request (such as `/users/:id`); the static route is the same as `path`; it is an empty string when no route is matched (404) `''` |
| `params`      | `Record<string, string>`                | Path dynamic parameters                                                                                                                                                     |
| `query`       | `Record<string, string>`                | URL query parameters (parsed)                                                                                                                                               |
| `body`        | `unknown`                               | Request body (populated by body-parser middleware)                                                                                                                          |
| `headers`     | `Record<string, string \| undefined>`   | Request headers (all lowercase keys)                                                                                                                                        |
| `locale`      | `string \| undefined`                   | Request-negotiated language for frontend inherit, independent of the requestId switch                                                                                       |
| `app`         | `VextApp`                               | The application instance to which the current request belongs                                                                                                               |
| `signal`      | `AbortSignal`                           | Aborts when the client connection closes or the route deadline expires; pass it to cancellable downstream work                                                              |
| `requestId`   | `string`                                | Request unique identifier                                                                                                                                                   |
| `ip`          | `string`                                | Client IP                                                                                                                                                                   |
| `protocol`    | `'http' \| 'https'`                     | Request protocol                                                                                                                                                            |
| `cookies`     | `VextCookieJar`                         | Parsed request cookies                                                                                                                                                      |
| `cookie()`    | `(name: string) => string \| undefined` | Read one request cookie                                                                                                                                                     |
| `csrfToken()` | `() => string`                          | Return the current CSRF token; requires the CSRF middleware                                                                                                                 |
| `auth`        | `VextAuthContext`                       | Authentication context; anonymous until populated by auth middleware                                                                                                        |
| `session`     | `VextSession \| undefined`              | Session state when session middleware is enabled                                                                                                                            |
| `t`           | `Function \| undefined`                 | i18n translation function (plug-in injection)                                                                                                                               |
| `files`       | `ParsedFile[] \| undefined`             | File upload list (populated by built-in multipart parsing or a custom upload plugin)                                                                                        |
| `valid()`     | Inferred by location/schema             | Read validated locations; undefined when undeclared or not yet validated.                                                                                                   |
| `onClose()`   | `(handler: () => void) => void`         | Clean up when a response completes or a connection closes early.                                                                                                            |

---

### `method`

HTTP request method, always an uppercase string.

```typescript
app.get("/info", async (req, res) => {
  console.log(req.method); // 'GET'
});
```

---

### `url`

The request path and query string, such as `/users?page=1`; do not treat it as an absolute URL with scheme and host.

```typescript
// Request: GET /users?page=1&limit=10
console.log(req.url); // '/users?page=1&limit=10'
```

---

### `path`

The path portion of the URL, excluding the query string.

```typescript
// Request: GET /users?page=1
console.log(req.path); // '/users'
```

---

### `route`

The route registration template matched by the current request is automatically injected by each Adapter after the route is matched. The difference from `path` is that `path` is the actual request path (high cardinality), and `route` is the routing template (low cardinality).

This is a key property in solving the **high cardinality problem** of metrics systems like Prometheus - metrics should be aggregated by routing templates, not actual paths.

```typescript
// Route registration: app.get('/users/:id', ...)
// Request: GET /users/abc-123

console.log(req.path); // '/users/abc-123' (actual path, high base)
console.log(req.route); // '/users/:id' (route template, low cardinality)✅

// Use req.route as http.route tag in OpenTelemetry / Prometheus
```

| Scenario                                           | `req.path`      | `req.route`         |
| -------------------------------------------------- | --------------- | ------------------- |
| Parameter route `/users/:id`, request `/users/123` | `/users/123`    | `/users/:id`        |
| Static route `/health`, request `/health`          | `/health`       | `/health`           |
| Route not matched (404)                            | `/unknown/path` | `''` (empty string) |

---

### `params`

Path dynamic parameters. Automatically parsed by the route matching engine.

```typescript
// Route: /users/:id/posts/:postId
// Request: GET /users/42/posts/7

app.get("/users/:id/posts/:postId", async (req, res) => {
  console.log(req.params.id); // '42'
  console.log(req.params.postId); // '7'
});
```

:::tip
The value of `params` is always of type string. If a numeric type is required, use `validate` + `req.valid('param')` to obtain the value after automatic type conversion.
:::

---

### `query`

Parsed URL query key-value pairs. For repeated keys such as `?tag=a&tag=b`, the first value wins (`{ tag: "a" }`); parse the query part of `req.url` explicitly if multiple values are required.

```typescript
// Request: GET /search?keyword=hello&page=2
app.get("/search", async (req, res) => {
  console.log(req.query.keyword); // 'hello'
  console.log(req.query.page); // '2' (string)
});
```

:::tip
The value of `query` is always of type string. After using `validate` to configure `query` verification, the value after automatic type conversion (such as string `'2'` → number `2`) can be obtained through `req.valid('query')`.
:::

---

### `body`

The request body data is parsed and filled by the built-in `body-parser` middleware.

- Before `body-parser` middleware is executed, `body` is `undefined`
- Supports `application/json` and `application/x-www-form-urlencoded` formats
- You can limit the request body size through `config.bodyParser.maxBodySize`

Successful JSON parsing does not validate fields against a schema. Business handlers should declare `validate.body` and read `req.valid("body")`. Multipart files are in `req.files`; see [files](#files) and the [Uploads Guide](/guide/uploads) for enablement and limits.

```typescript
app.post("/users", async (req, res) => {
  console.log(req.body); // { name: 'Alice', email: 'alice@example.com' }
});
```

---

### `headers`

Request header object, all keys are **lowercase**.

```typescript
app.get("/info", async (req, res) => {
  const auth = req.headers.authorization; // 'Bearer eyJ...'
  const ct = req.headers["content-type"]; // 'application/json'
  const custom = req.headers["x-custom"]; // Custom request headers
});
```

---

### `app`

The `VextApp` application instance to which the current request belongs.

Route handlers usually access `app` directly through the closure of `defineRoutes`. But **routing-level middleware** does not have closures, and the framework capabilities must be accessed through `req.app`:

```typescript
//Access through req.app in middleware
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  req.app.logger.info("Middleware is executing");

  if (!req.headers.authorization) {
    req.app.throw(401, "Authentication token not provided");
  }

  await next();
});
```

Capabilities accessible via `req.app`:

| Properties/Methods | Description               |
| ------------------ | ------------------------- |
| `req.app.logger`   | Structured log            |
| `req.app.throw()`  | Throw HTTP error          |
| `req.app.config`   | Runtime configuration     |
| `req.app.services` | Injected service instance |
| `req.app.fetch`    | Built-in HTTP client      |

---

### `signal`

An `AbortSignal` bound to the request lifecycle. It is aborted when the client disconnects while the request is still pending. Reading the complete request body or completing the response normally does not abort it. When the route timeout middleware is active, its deadline signal is combined with the connection signal, so downstream work observes either cancellation source.

Pass the signal to APIs that support cancellation and still stop mutating application or response state after it is aborted:

```typescript
app.get("/report", async (req, res) => {
  const upstream = await fetch("https://example.com/report", {
    signal: req.signal,
  });
  res.json(await upstream.json());
});
```

---

### `requestId`

Request unique identifier for log correlation and distributed link tracing.

Generate rules:

1. When enabled, a nonempty incoming header named by `config.requestId.header` (default `x-request-id`) takes precedence over custom generators.
2. Otherwise use the generator from `app.setRequestIdGenerator()`, then `config.requestId.generate`, then a default UUID v4.
3. The final ID must be 1–512 characters without control characters or an error is thrown. With `requestId.enabled: false`, the value is `""` and no requestId response header is written.

The default response header is also `x-request-id`, configurable through `requestId.responseHeader`. A client-supplied ID is a correlation marker, not a framework-guaranteed globally unique value.

```typescript
app.get("/info", async (req, res) => {
  console.log(req.requestId); // '550e8400-e29b-41d4-a716-446655440000'

  // The log automatically carries requestId (through AsyncLocalStorage)
  req.app.logger.info("Processing request");
  // → { requestId: '550e8400-...', msg: 'Processing request' }
});
```

---

### `ip`

Client IP address.

| `config.trustProxy` | Behavior                                                    |
| ------------------- | ----------------------------------------------------------- |
| `false` (default)   | Read from the underlying socket's `remoteAddress`           |
| `true`              | Read the first IP from the `X-Forwarded-For` request header |

```typescript
app.get("/info", async (req, res) => {
  console.log(req.ip); // '192.168.1.100'
});
```

:::warning
Enable `trustProxy: true` only when the trusted ingress proxy overwrites forwarding headers correctly; otherwise a client can influence the value. With it off, the address is that of the direct peer. Hono falls back to `127.0.0.1` when a Node socket address is unavailable; other Node adapters also use that fallback when the address is missing.
:::

---

### `protocol`

Request protocol.

| `config.trustProxy` | Behavior                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `false` (default)   | Native/Express/Fastify/Koa inspect socket TLS (`https` if encrypted); current Hono returns `http`. |
| `true`              | Returns `https` only when `X-Forwarded-Proto` is exactly `https`, otherwise `http`.                |

```typescript
app.get("/info", async (req, res) => {
  console.log(req.protocol); // 'https'
});
```

---

### `valid(location)`

Get the data after `validate` verification and type conversion.

```typescript
type VextValidationLocation = "query" | "body" | "param" | "header" | "cookie";

interface VextRequest<
  TValidated extends Record<VextValidationLocation, unknown>,
> {
  valid<
    TOverride = never,
    TLocation extends VextValidationLocation = VextValidationLocation,
  >(
    location: TLocation,
  ): [TOverride] extends [never] ? TValidated[TLocation] : TOverride;
}
```

`TValidated` is generated from the `validate` object on the current route.
The public API also keeps an explicit generic override for dynamic or external
schemas, but ordinary route code should rely on the inferred contract.

**Parameters**:

| Parameters | Type                                                   | Description                |
| ---------- | ------------------------------------------------------ | -------------------------- |
| `location` | `'query' \| 'body' \| 'param' \| 'header' \| 'cookie'` | Verification data location |

**`location` and data source mapping**:

| location   | data source   | description             |
| ---------- | ------------- | ----------------------- |
| `'query'`  | `req.query`   | URL query parameters    |
| `'body'`   | `req.body`    | Request body            |
| `'param'`  | `req.params`  | Path dynamic parameters |
| `'header'` | `req.headers` | Request headers         |
| `'cookie'` | `req.cookies` | Parsed Cookie values    |

:::tip
Note that `location` uses the **singular** `'param'` (consistent with the key configured in `validate`), but the underlying data source is the **plural** `req.params`. The framework maps them correctly.
:::

**Basic Usage**:

```typescript
app.get(
  "/users",
  {
    validate: {
      query: { page: "number:1-!", limit: "number:1-100!" },
    },
  },
  async (req, res) => {
    const { page, limit } = req.valid("query");
    // page: number (automatically converted from string '1' to number 1)
    // limit: number
  },
);
```

**Automatic inference**:

```typescript
const query = req.valid("query");
// query.page  → number
// query.limit → number
```

If a route does not declare the requested location, its inferred result is
`undefined`. Chainable field builders are inferred as `unknown`; use a runtime
type guard or an explicit override only when the application owns that dynamic
contract.

**Multiple location verification**:

```typescript
app.put(
  "/users/:id",
  {
    validate: {
      param: { id: "string:1-" },
      body: { name: "string:1-50", email: "email" },
      query: { notify: "boolean?" },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const body = req.valid("body");
    const { notify } = req.valid("query");
  },
);
```

:::warning
Only a location declared in `options.validate` and already validated has a result. An undeclared location, or a preceding route middleware that has not reached validation, gets `undefined`. Explicit generics change types only, not runtime validation. Header results contain only declared fields with lowercase keys; conversion and extra-field behavior for other locations depend on the validator. See [Validation](/guide/validation).
:::

---

### `onClose(handler)`

Register a request close hook that runs once when the response completes or the client disconnects early. Hooks registered after the request ends run immediately. A hook running after normal completion does not mean that `req.signal` was aborted.

```typescript
function onClose(handler: () => void): void;
```

Use this for stream resources on normal completion or early disconnect:

```typescript
import { Readable } from "node:stream";

app.get("/sse", async (req, res) => {
  const stream = new Readable({ read() {} });
  const timer = setInterval(() => stream.push("data: ping\n\n"), 1000);

  req.onClose(() => {
    clearInterval(timer);
    stream.destroy();
    console.log("Request ended; stream resources released");
  });

  res.stream(stream, "text/event-stream");
});
```

:::tip
The callback type is synchronous `() => void`; the framework does not await async cleanup. It releases registered callback references afterward. Your callback still must clear its own timers, listeners, and other resources.
:::

---

### `t(key, params?)`

Optional translation-function extension. Built-in locale loading and request negotiation do not automatically inject `t` onto req. Use it only if an application plugin explicitly sets it; merely configuring locale or adding `src/locales` is insufficient. See [I18n](/guide/i18n).

```typescript
function t(key: string, params?: Record<string, unknown>): string;
```

**Usage**:

```typescript
app.get("/greeting", async (req, res) => {
  const message = req.t?.("welcome", { name: "Alice" }) ?? "Welcome, Alice";
  res.json({ message });
});
```

---

### `files`

File upload list, initially `undefined`. Vext populates it when built-in multipart parsing is enabled globally through `config.multipart.enabled` or for one route through `multipart.enabled: true`. A route may set `multipart.enabled: false` to opt out even when global parsing is enabled. Built-in parsing keeps the request body and each `buffer` in memory; it does not create framework-managed temporary files, a temp directory, TTL, or periodic cleanup job. Custom upload plugins can also populate this field when they need streaming writes, durable storage, or third-party parsers.

```typescript
interface ParsedFile {
  fieldname: string; // form field name
  filename: string; // Upload file name
  mimetype: string; // MIME type, such as 'image/png'
  buffer: Buffer; //Original content of the file
  size: number; //The number of bytes in the file
}
```

```typescript
app.post(
  "/upload",
  {
    multipart: {
      enabled: true,
      maxFileSize: 10 * 1024 * 1024,
      files: {
        file: { description: "Document file", required: true },
      },
    },
  },
  async (req, res) => {
    const file = req.files?.find((item) => item.fieldname === "file");
    res.json({ filename: file?.filename, size: file?.size });
  },
);
```

`multipart.files` also drives OpenAPI `multipart/form-data` requestBody generation and required-file runtime checks. Uploads still obey `maxFiles`, `maxFileSize`, and `allowedMimeTypes`.

A per-file limit does not enlarge the whole-request limit. For a 10 MB file, set `bodyParser.maxBodySize` reasonably above it to account for multipart boundaries.

---

### `cookies` and `cookie(name)`

`cookies` is a read-only `Readonly<Record<string, string>>` parsed from the Cookie header without needing Session. For repeated names the first wins. Values are decoded with `decodeURIComponent`; failed decoding retains the raw value. Reserved names `__proto__`, `constructor`, and `prototype` are dropped. `cookie(name)` returns one value or undefined.

```typescript
app.get("/preferences", async (req, res) => {
  res.json({ theme: req.cookie("theme") ?? "system" });
});
```

Reading a Cookie does not authenticate a user. Use response `res.cookie()` / `res.clearCookie()` to write or expire one; see [Cookies and Session](/guide/cookies-session).

### `csrfToken()`

Returns the token for this request only when `config.csrf.enabled` or a manually registered `csrf()` middleware has run; otherwise it throws. Repeated reads within the request use one token. Generation sets `Cache-Control: no-store`. Automatic storage mode depends on Session presence; signed-cookie mode needs a secret. Calling this function does not replace token submission and validation for protected requests.

```typescript
// Route fragment after CSRF middleware and storage/secret configuration.
app.get("/csrf-token", async (req, res) => {
  res.json({ token: req.csrfToken() });
});
```

See [Security](/guide/security) for enablement, submission headers, and failure behavior.

### `auth`

Every request starts with anonymous `VextAuthContext`: `isAuthenticated: false` and empty roles/scopes/claims. Authentication middleware fills identity after calling an app-provided verifier; route `auth` guards then enforce access. `docs.security` does not establish identity.

| Field                 | Type/meaning                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| `isAuthenticated`     | Boolean established identity state.                                              |
| `subject` / `userId`  | Optional strings from authentication result.                                     |
| `roles` / `scopes`    | `string[]`.                                                                      |
| `claims`              | `Record<string, unknown>`.                                                       |
| `scheme` / `provider` | Optional source such as bearer/apiKey/session/custom and provider name.          |
| `can` / `assert`      | Optional sync/async permission functions; check presence and await when calling. |
| `error`               | Optional `VextAuthErrorCode` from identity processing.                           |

See [Security](/guide/security) for auth plus guard. Presence of `req.auth` does not mean the request is logged in.

### `session`

With Session middleware, `req.session` is `VextSession`; otherwise undefined. Besides business fields, it exposes read-only id/isNew/isDestroyed and async save(), regenerate(), destroy().

```typescript
// Route fragment with Session enabled.
app.post("/visit", async (req, res) => {
  const session = req.session;
  if (!session) return app.throw(500, "Session is disabled");
  session.visits = typeof session.visits === "number" ? session.visits + 1 : 1;
  await session.save();
  res.json({ visits: session.visits });
});
```

See [Cookies and Session](/guide/cookies-session) for automatic commit and Store settings. Save before starting a stream or download so persistence and Cookie commit occur before headers; do not attempt to save after streaming has begun.

---

### Extended fields

Middleware and plugins can mount custom fields on `req`. Type hints are available through the `declare module` extension interface:

```typescript
// types/vext.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextRequest {
    user?: {
      id: string;
      role: "admin" | "user";
    };
  }
}
```

Include that declaration in the project's TypeScript config; see [Project Structure](/guide/project-structure). Types do not assign runtime values. The `verifyToken` below is an app-owned function whose implementation must be imported, and `load-user` must be in the middleware allowlist.

```typescript
// Set in middleware
export default defineMiddleware(async (req, _res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  req.user = await verifyToken(token);
  await next();
});

// used in handler
app.get("/profile", { middlewares: ["load-user"] }, async (req, res) => {
  res.json(req.user ?? null); // Still handle an anonymous runtime request.
});
```

---

## VextResponse

`VextResponse` is the unified response object interface of the framework. Provides JSON response, text response, streaming response, redirection and other capabilities.

### List of methods

| Method                                       | Return Value | Description                                                |
| -------------------------------------------- | ------------ | ---------------------------------------------------------- |
| `json(data, status?)`                        | `void`       | Returns a JSON response (wrapped for export)               |
| `render(page, props?, options?)`             | `void`       | Render a built-in frontend page                            |
| `renderError(error?, page?, options?)`       | `void`       | Render the configured frontend error page                  |
| `text(content, status?)`                     | `void`       | Return plain text response                                 |
| `stream(readable, contentType?)`             | `void`       | Streaming response                                         |
| `download(readable, filename, contentType?)` | `void`       | File download                                              |
| `redirect(url, status?)`                     | `void`       | Redirect                                                   |
| `status(code)`                               | `this`       | Set status code (chain call)                               |
| `setHeader(name, value)`                     | `this`       | Set response header (chain call)                           |
| `cookie(name, value, options?)`              | `this`       | Append a `Set-Cookie` response header                      |
| `clearCookie(name, options?)`                | `this`       | Expire a response cookie                                   |
| `statusCode`                                 | `number`     | Current status code (read-only)                            |
| `headersSent`                                | `boolean`    | Whether the terminal response flow has started (read-only) |
| `sse()`                                      | `unknown`    | Optional SSE plugin extension                              |
| `upgrade()`                                  | `unknown`    | Optional WebSocket/upgrade plugin extension                |

`render()` and `renderError()` are bound by the built-in frontend renderer. `sse()` and `upgrade()` are optional extension points and are available only when the corresponding plugin installs them. Cookie methods append separate `Set-Cookie` headers and preserve multiple cookies.

---

### `json(data, status?)`

Returns a JSON response. This is the most common response method.

```typescript
function json(data: unknown, status?: number): void;
```

**Parameters**:

| Parameters | Type      | Default value                             | Description               |
| ---------- | --------- | ----------------------------------------- | ------------------------- |
| `data`     | `unknown` | —                                         | Business data             |
| `status`   | `number`  | Current `res.statusCode`, initially `200` | Optional HTTP status code |

**Export Packaging**:

When `config.response.wrap` is `true` (default), `res.json(data)` is automatically wrapped:

```typescript
res.json({ id: 1, name: "Alice" });
// Actual response:
// {
// "code": 0,
// "data": { "id": 1, "name": "Alice" },
// "requestId": "550e8400-e29b-41d4-a716-446655440000"
// }
```

When `config.response.wrap` is `false`, send raw data directly:

```typescript
res.json({ id: 1, name: "Alice" });
// Actual response:
// { "id": 1, "name": "Alice" }
```

**Specify status code**:

```typescript
// 201 Created
res.json(newUser, 201);

// You can also use chain calls
res.status(201).json(newUser);
```

**204 No Content**：

Regardless of whether the wrapper is opened or not, the `204` status code does not send the message body (conforming to RFC 9110 §15.3.5):

```typescript
res.status(204).json(null);
// Response: 204 No Content (no body)
```

HEAD also sends no body. If a route declares runtime `responses`, JSON serialization chooses an exact status schema, then status family, then `default`; the schema describes business data, while the framework applies the output wrapper. Without a matching schema, ordinary JSON behavior remains. `docs.responses` documents but does not validate runtime output. See the [response contract](/api/route-definition#responses--runtime-response-schema).

**Error response** (usually handled automatically by the framework error-handler):

```json
{
  "code": 10001,
  "message": "User does not exist",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### `text(content, status?)`

Returns a plain text response, **without export wrapping**.

```typescript
function text(content: string, status?: number): void;
```

```typescript
app.get("/health", async (_req, res) => {
  res.text("OK");
});

app.get("/version", async (_req, res) => {
  res.text("v1.0.0", 200);
});
```

Automatically set `Content-Type: text/plain; charset=utf-8`.

Omitting status uses the current `res.statusCode`, initially 200.

---

### `render(page, props?, options?)`

Renders a built-in frontend page when `config.frontend.enabled` and the matching page and build/dev output exist. `page` is a page ID under `src/frontend/pages`, such as `dashboard`, not a URL or absolute file path. URLs still come from route files. Calling it with frontend disabled throws.

```typescript
import type { VextRenderOptions } from "vextjs";
// render(page: string, props?: Record<string, unknown>, options?: VextRenderOptions): void

// Route fragment after creating the dashboard page.
app.get("/dashboard", async (_req, res) => {
  res.render(
    "dashboard",
    { greeting: "Hello" },
    { head: { title: "Dashboard" } },
  );
});
```

`VextRenderOptions` includes status, headers, head, seo, nonce, locale, messages, ssr, layout, and layoutData. Status uses the current response status by default. Props, layoutData, and messages must be safely JSON serializable. See [Routing and Pages](/frontend/routing-and-pages), [Rendering Modes](/frontend/rendering-modes), and [SEO](/frontend/seo-sitemap). This HTML response does not use the JSON `{ code, data, requestId }` wrapper.

### `renderError(errorOrStatus?, pageOrOptions?, options?)`

The frontend renderer creates an error page. The first argument can be Error, HTTP status, or error-code string; the second can be a page ID or `VextRenderErrorOptions`, with the third supplying more options. Without a matching custom error page, Vext uses its built-in error document. Frontend must be enabled.

```typescript
app.get("/missing-page", async (_req, res) => {
  res.renderError(404, { message: "Page not found" });
});
```

`VextRenderErrorOptions` adds page, props, code, message, details, and expose. A compatibility signature also accepts a plain object or array in the second argument. An object without render-option keys, or an array, is treated as error details, not as props. See [Errors and Document](/frontend/errors-and-document) for page selection and exposure.

---

### `stream(readable, contentType?)`

Streaming responses for large file transfers or real-time data streaming.

Streams and downloads start the send flow immediately. Set status/headers and save any required Session changes first. An asynchronous read failure after sending starts cannot be rewritten as an ordinary JSON error. `await next()` returning does not mean the entire stream finished; use `req.onClose()` for cleanup.

```typescript
function stream(readable: NodeJS.ReadableStream, contentType?: string): void;
```

**Parameters**:

| Parameters    | Type                    | Default value                | Description             |
| ------------- | ----------------------- | ---------------------------- | ----------------------- |
| `readable`    | `NodeJS.ReadableStream` | —                            | Node.js readable stream |
| `contentType` | `string`                | `'application/octet-stream'` | MIME type               |

```typescript
import { createReadStream } from "node:fs";

app.get("/large-file", async (_req, res) => {
  const stream = createReadStream("/path/to/large-file.csv");
  res.stream(stream, "text/csv");
});
```

**SSE (Server-Sent Events)**:

```typescript
import { Readable } from "node:stream";

app.get("/events", async (req, res) => {
  const stream = new Readable({ read() {} });
  const interval = setInterval(() => {
    stream.push(`data: ${JSON.stringify({ time: Date.now() })}\n\n`);
  }, 1000);

  req.onClose(() => {
    clearInterval(interval);
    stream.destroy();
  });

  res.stream(stream, "text/event-stream");
});
```

---

### `download(readable, filename, contentType?)`

In file download responses, the `Content-Disposition: attachment` header is automatically set. ASCII-safe filenames keep the plain `filename` output; filenames containing non-ASCII characters, quotes, path separators, or control characters get a safe fallback plus a UTF-8 `filename*` value.

```typescript
function download(
  readable: NodeJS.ReadableStream,
  filename: string,
  contentType?: string,
): void;
```

**Parameters**:

| Parameters    | Type                    | Default value                | Description                                                                       |
| ------------- | ----------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `readable`    | `NodeJS.ReadableStream` | —                            | File stream                                                                       |
| `filename`    | `string`                | —                            | Download file name (displayed by browser and safely encoded for response headers) |
| `contentType` | `string`                | `'application/octet-stream'` | MIME type                                                                         |

```typescript
import { createReadStream } from "node:fs";

app.get("/export", async (_req, res) => {
  const stream = createReadStream("/path/to/report.xlsx");
  res.download(
    stream,
    "report-2026.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});
```

The browser handles this according to its own download settings; a dialog is not guaranteed.

---

### `redirect(url, status?)`

HTTP redirect.

```typescript
function redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): void;
```

**Parameters**:

| Parameters | Type                              | Default value | Description          |
| ---------- | --------------------------------- | ------------- | -------------------- |
| `url`      | `string`                          | —             | Target URL           |
| `status`   | `301 \| 302 \| 303 \| 307 \| 308` | `302`         | Redirect status code |

```typescript
// Temporary redirect (302)
res.redirect("/new-page");

// Permanent redirect (301)
res.redirect("/new-permanent-page", 301);

// See Other after a submission (303)
res.redirect("/result", 303);

// Temporary redirection retention method (307)
res.redirect("/api/v2/users", 307);

// Permanent redirection retention method (308)
res.redirect("/api/v2/users", 308);
```

**Redirect status code description**:

| Status code | Description                  | Whether to keep the HTTP method    |
| ----------- | ---------------------------- | ---------------------------------- |
| `301`       | Permanent redirect           | No (may become GET)                |
| `302`       | Temporary redirect (default) | No (may become GET)                |
| `303`       | See Other                    | Usually GET (HEAD may remain HEAD) |
| `307`       | Temporary redirection        | Yes                                |
| `308`       | Permanent redirect           | Yes                                |

Non-ASCII Location bytes are encoded; CR/LF/NUL are rejected. A runtime value outside the allowed status union falls back to 302.

---

### `status(code)`

Set HTTP status code and support chain calls.

```typescript
function status(code: number): this;
```

```typescript
//Chain call
res.status(201).json(newUser);
res.status(204).json(null);
res.status(404).json({ message: "Not found" });
```

If `status()` is not called, the default status code is `200`. It can also be set directly through the second parameter of `json(data, status)`.

---

### `setHeader(name, value)`

Set response headers to support chain calls.

```typescript
function setHeader(name: string, value: string | string[]): this;
```

```typescript
res
  .setHeader("X-Custom-Header", "custom-value")
  .setHeader("Cache-Control", "no-cache")
  .json(data);
```

**Common response headers**:

```typescript
// cache control
res.setHeader("Cache-Control", "public, max-age=3600");

//Content processing
res.setHeader("Content-Disposition", 'inline; filename="preview.pdf"');

// route-specific response metadata
res.setHeader("X-Request-Scope", "public");

// Use config.securityHeaders for standard browser security headers.

// Custom business header
res.setHeader("X-RateLimit-Remaining", "95");
```

Array values can set multiple `Set-Cookie` headers; do not comma-join them into one Cookie. Prefer the dedicated methods below for normal Cookie operations.

### `cookie(name, value, options?)` and `clearCookie(name, options?)`

Both return `this` and append a valid or expired `Set-Cookie` header. Multiple calls remain multiple headers. They do not mutate this request's `req.cookies`.

```typescript
res.cookie("theme", "dark", { path: "/", maxAge: 3600, sameSite: "lax" });
res.clearCookie("old-theme", { path: "/" });
res.json({ saved: true });
```

`CookieSerializeOptions` includes domain, path, expires: Date, maxAge (seconds), httpOnly, secure, sameSite (boolean or lax/strict/none), priority, partitioned, and encode. No options means no automatic path or security attributes; value encoding defaults to `encodeURIComponent`. To clear a Cookie, use its original path/domain; the method sets expires to Unix epoch and maxAge to zero. See [Cookies and Session](/guide/cookies-session) for a full browser round trip.

### `headersSent` (read-only)

This means the framework response entered a terminal send flow, useful for avoiding duplicate response choices. A buffered JSON/text response may show true before socket write; a stream sends immediately. It does not mean the client received every byte.

Buffered responses commit as the onion stack unwinds, so after middleware can still add headers with `setHeader()`. Once streaming starts, do not rely on that. Choose status and business content before a response outlet; use `statusCode` for current framework status and `req.onClose()` for completion.

### `sse()` and `upgrade()`

These are optional extension points, with signatures `sse?(): unknown` and `upgrade?(): unknown`. Core does not implement them or promise another return type. Confirm that a plugin installed them; its contract defines connection handling. The `stream()` SSE example above does not require an extension method.

---

### `statusCode` (read-only)

Get the current HTTP status code.

```typescript
readonly statusCode: number;
```

Mainly used for **onion model after-middleware**, reading the response status code after `await next()`:

```typescript
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  const start = Date.now();

  await next(); // handler execution completed

  const duration = Date.now() - start;
  console.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  // GET /users → 200 (12ms)
});
```

---

## VextPublicResponse

User-visible response type that omits `rawJson()` and every underscore-prefixed internal method:

```typescript
type VextPublicResponse = Omit<
  VextResponse,
  "rawJson" | Extract<keyof VextResponse, `_${string}`>
>;
```

Route handlers currently receive `VextResponse`, which includes internal methods. Application code normally does not need those APIs; `VextPublicResponse` is intended for wrappers and extensions that expose only the stable public response surface.

---

## Internal Methods (Not Recommended for Direct Use)

<a id="_getrawbodybuffer"></a>

### `_getRawBodyBuffer()` and `_getRawBody()`

These internal request readers serve framework code and parser plugins. Public signatures accept an optional byte limit:

```typescript
_getRawBodyBuffer(maxBytes?: number): Promise<Buffer>;
_getRawBody(maxBytes?: number): Promise<string>;
```

Results are cached and the raw stream consumed once. GET/HEAD/OPTIONS return empty results. `maxBytes` enforces a limit with 413 on excess, including when rereading cached data. The Buffer method preserves bytes; the string method decodes UTF-8.

```typescript
import type { VextRequest } from "vextjs";

async function readUploadBytes(req: VextRequest): Promise<Buffer> {
  return req._getRawBodyBuffer(1024 * 1024);
}
```

A custom multipart parser must implement parsing, file/field limits, persistence, and ordering against built-in parsing. This Buffer API reads into memory; it is not streaming disk storage. Prefer built-in [files](#files) for standard uploads.

### `rawJson(data, status?)`

Returns raw JSON without output wrapping, for framework error handling, rate limiting, and other internal response flows.

```typescript
function rawJson(data: unknown, status?: number): void;
```

```typescript
//Use error-handler inside the framework
res.rawJson(
  {
    code: -1,
    message: "Internal Server Error",
    requestId: req.requestId,
  },
  500,
);
```

:::warning
User code should not call `rawJson()` directly. To bypass egress wrapping, set `config.response.wrap: false` and then use standard `res.json()`.
:::

### `_enableWrap()`

Turn on the export packaging sign. Only called by the built-in `response-wrapper` middleware.

```typescript
function _enableWrap(): void;
```

After the call, subsequent `json()` calls will automatically wrap the response body into the `{ code: 0, data, requestId }` format.

---

## Usage Patterns

### Standard CRUD Response

This two-file example uses the package, TypeScript, and scripts from [Quick Start](/guide/quick-start). Data is in process memory and resets on restart; it demonstrates response and validation behavior.

```typescript
// src/config/default.ts
export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: "native",
  frontend: { enabled: false },
};
```

```typescript
// src/routes/items.ts
import { randomUUID } from "node:crypto";
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  const items = new Map<string, { id: string; name: string }>();

  app.get("/", async (_req, res) => {
    res.json([...items.values()]);
  });

  app.post(
    "/",
    { validate: { body: { name: "string:1-50!" } } },
    async (req, res) => {
      const item = { id: randomUUID(), name: req.valid("body").name };
      items.set(item.id, item);
      res.setHeader("Location", `/items/${item.id}`).json(item, 201);
    },
  );

  app.get(
    "/:id",
    { validate: { param: { id: "uuid!" } } },
    async (req, res) => {
      const item = items.get(req.valid("param").id);
      if (!item) return app.throw(404, "Item not found");
      res.json(item);
    },
  );

  app.put(
    "/:id",
    { validate: { param: { id: "uuid!" }, body: { name: "string:1-50!" } } },
    async (req, res) => {
      const { id } = req.valid("param");
      if (!items.has(id)) return app.throw(404, "Item not found");
      const item = { id, name: req.valid("body").name };
      items.set(id, item);
      res.json(item);
    },
  );

  app.delete(
    "/:id",
    { validate: { param: { id: "uuid!" } } },
    async (req, res) => {
      if (!items.delete(req.valid("param").id)) {
        return app.throw(404, "Item not found");
      }
      res.status(204).json(null);
    },
  );
});
```

Run `npm run dev` and check in order:

```powershell
$createdItem = Invoke-RestMethod http://127.0.0.1:3000/items -Method Post -ContentType 'application/json' -Body '{"name":"First"}'
$itemId = $createdItem.data.id
Invoke-RestMethod "http://127.0.0.1:3000/items/$itemId"
Invoke-RestMethod "http://127.0.0.1:3000/items/$itemId" -Method Put -ContentType 'application/json' -Body '{"name":"Updated"}'
Invoke-WebRequest "http://127.0.0.1:3000/items/$itemId" -Method Delete
```

Expect 201 with Location, 200 for read/update, and 204 without body on delete; reading the deleted ID returns 404. Missing name returns 422 and a non-UUID path parameter returns 400. Default JSON wrapping puts the new ID at `data.id`. Stop dev, run `npm run build -- --typecheck`, start with `npm start`, and repeat from creation. See [Services](/guide/services) and [Database](/guide/database) for persistence and service separation.

### Error handling

This fragment assumes an existing `user` service with `findById`. The complete in-memory 404 path is in the CRUD example above.

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", async (req, res) => {
    const user = await app.services.user.findById(req.params.id);

    if (!user) {
      // Automatically captured by the framework and converted to standard error response
      app.throw(404, "User does not exist");
    }

    res.json(user);
  });
});
```

Errors thrown by `app.throw()` are uniformly captured by the framework `error-handler` middleware and converted into standard error responses:

```json
{
  "code": 404,
  "message": "User does not exist",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

If you need to actively return an explicit HTTP error, use `app.throw(...)`. If there is an unexpected runtime failure, you can also directly `throw new Error("...")`, and the framework will capture it as 500; when `response.hideInternalErrors = false`, the JSON 500 response in the development environment will be additionally accompanied by `stack`.

### Custom Response Header and Status

```typescript
app.post(
  "/inspect-upload",
  { multipart: { enabled: true, files: { file: { required: true } } } },
  async (req, res) => {
    const file = req.files?.find((entry) => entry.fieldname === "file");
    if (!file) return app.throw(422, "File missing");
    res.setHeader("X-File-Size", String(file.size)).json({ size: file.size });
  },
);
```

This only inspects an upload, so it returns 200. The complete CRUD example shows creating a resource with 201 and Location.

### Streaming file download

```typescript
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

// App-controlled allowed files; the file must exist and be readable.
const downloads = new Map([["report", resolve("public/report.csv")]]);

app.get("/download/:key", async (req, res) => {
  const filepath = downloads.get(req.params.key ?? "");
  if (!filepath) return app.throw(404, "File not found");
  let file: FileHandle;
  try {
    file = await open(filepath, "r");
  } catch {
    return app.throw(404, "File missing or unreadable");
  }
  const stream = file.createReadStream();
  req.onClose(() => stream.destroy());
  res.download(stream, "report.csv", "text/csv");
});
```

Choose files through an app-owned key map, not by joining arbitrary user paths to a directory. The FileHandle stream closes the file on finish/destroy. A disk error after streaming starts cannot be converted to 404 by the completed open catch.

### Conditional response

Add this fragment inside the CRUD `defineRoutes` callback above, reusing `items`. It illustrates an exact `Accept: text/plain` match, not full HTTP content negotiation.

```typescript
app.get(
  "/:id/summary",
  { validate: { param: { id: "uuid!" } } },
  async (req, res) => {
    const item = items.get(req.valid("param").id);
    if (!item) return app.throw(404, "Item not found");
    res.setHeader("Vary", "Accept");
    if (req.headers.accept === "text/plain") {
      res.text(`Item: ${item.name}`);
    } else {
      res.json(item);
    }
  },
);
```

---

## Requests and responses in middleware

### Onion model

Middleware implements the onion model through `await next()`, which can handle requests and responses before and after the handler is executed:

A downstream throw skips ordinary after code; put work that must run on both success and failure in `finally`. Timing ends when the stack unwinds, not when a stream finishes. See [Middleware](/guide/middleware) for registration and allowlists.

```typescript
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  // ── before handler ──
  const start = Date.now();
  req.app.logger.info({ method: req.method, path: req.path }, "Request starts");

  await next(); // Execute handler (and subsequent middleware)

  // ── after handler ──
  const duration = Date.now() - start;
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

### Modify request

Middleware can modify the request object before `next()`:

The `verifyJWT` function below must be implemented and imported by the app; `req.user` uses the declaration merge above. See [Security](/guide/security) for actual authentication and guard wiring.

```typescript
export default defineMiddleware(async (req, _res, next) => {
  // Parse JWT and inject user information
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    req.user = await verifyJWT(token);
  }
  await next();
});
```

### Short circuit response

Middleware can return the response directly without calling `next()` (short circuit):

```typescript
import { defineMiddleware } from "vextjs";

const blockedIps = new Set(["192.0.2.10"]); // Replace with the app's list.
export default defineMiddleware(async (req, res, next) => {
  if (blockedIps.has(req.ip)) return req.app.throw(403, "Access denied");
  await next();
});
```

You may also send a response and return. For a standard error body use `app.throw()`; `res.status(403).json(...)` still follows normal business JSON wrapping and does not automatically become the error contract.

---

## Type import

```typescript
import type { VextRequest, VextResponse, VextPublicResponse } from "vextjs";
```

These types usually do not need to be imported explicitly - the types of `req` and `res` are automatically inferred by TypeScript in the callbacks of `defineRoutes` and `defineMiddleware`. Explicitly imported types are only necessary when writing stand-alone utility functions:

```typescript
import type { VextRequest } from "vextjs";

function extractUser(req: VextRequest) {
  return req.user;
}
```

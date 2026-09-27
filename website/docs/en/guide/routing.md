# Routing

VextJS combines **convention-based file routing** with route declarations inside `defineRoutes()`. A route file maps to a URL prefix; its factory declares the methods and paths beneath that prefix.

Start with a runnable route, then learn file mapping, request validation, and business integration. For the full fields and defaults, see the [Route Definition API](/api/route-definition); for binding rules, see the [HTTP and Routing Specification](/specification/http-and-routing).

The `route-demo.ts` below is a complete, standalone file for an existing VextJS project. Other snippets that mention `app`, `req`, `res`, or `handler` belong inside their respective factory or handler. The business example declares its service and authentication prerequisites separately.

## Run a route first

### 1. Create the route file

Prerequisite: a VextJS project created according to [Quick Start](/guide/quick-start), with dependencies installed and `npm run dev` working. Create this file; it needs no database, custom service, or authentication middleware.

```typescript
// src/routes/route-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/:id",
    { validate: { param: { id: "integer:1-!" } } },
    (req, res) => {
      const { id } = req.valid("param");
      res.json({ id, valueType: typeof id });
    },
  );

  app.post(
    "/",
    { validate: { body: { name: "string:1-50!" } } },
    (req, res) => {
      const { name } = req.valid("body");
      res.json({ name }, 201);
    },
  );
});
```

### 2. Verify paths and validation

Run `npm run dev` from the project root. In another terminal, use the actual port shown on startup. Save these two request files in the project root so that JSON quoting works consistently across shells:

`route-valid.json`:

```json
{ "name": "Alice" }
```

`route-invalid.json`:

```json
{}
```

Run these commands from the same directory. In Windows PowerShell, use `curl.exe` in place of `curl`:

```bash
curl -i http://localhost:3000/route-demo/42
curl -i http://localhost:3000/route-demo/not-a-number
curl -i -X POST http://localhost:3000/route-demo -H "Content-Type: application/json" --data-binary @route-valid.json
curl -i -X POST http://localhost:3000/route-demo -H "Content-Type: application/json" --data-binary @route-invalid.json
```

| Request                        | Expected result                                                             |
| ------------------------------ | --------------------------------------------------------------------------- |
| GET `/route-demo/42`           | 200; with default wrapping, `data` is `{ "id": 42, "valueType": "number" }` |
| GET `/route-demo/not-a-number` | 400; path validation fails before the handler runs                          |
| POST with a valid name         | 201; with default wrapping, `data.name` is `Alice`                          |
| POST with an empty object      | 422; the required body field is missing and the handler does not run        |

The file prefix is `/route-demo`, so write `"/"` or `"/:id"` inside the file; do not add `/route-demo` again. The response wrapper depends on app configuration, and exact validation messages can vary with the validator and locale.

### 3. Integrate business logic

After the minimal route works, pass business operations to a [service](/guide/services). Add validation, middleware, authentication, and response declarations as needed.

The local `app.get(...)` snippets below belong inside `defineRoutes((app) => { ... })`. Names such as `handler`, `user`, `data`, and `app.services.*` stand for application code; VextJS does not create those business capabilities automatically.

The factory must be synchronous; handlers may be async. Register routes with direct top-level statements in the factory body, not inside loops, conditionals, or async callbacks. Statically resolvable function bindings and default re-exports are supported; see the [factory rules](/specification/http-and-routing#vext-http-002).

## Basic concepts

### File routing mapping

Route files under `src/routes/` that pass the loader rules map to URL prefixes. The table shows alternative layouts: `users.ts` and `users/index.ts` cannot coexist.

| File path                  | URL prefix        |
| -------------------------- | ----------------- |
| `routes/index.ts`          | `/`               |
| `routes/users.ts`          | `/users`          |
| `routes/users/index.ts`    | `/users`          |
| `routes/users/[id].ts`     | `/users/:id`      |
| `routes/admin/settings.ts` | `/admin/settings` |
| `routes/api/v1/index.ts`   | `/api/v1`         |

### Three-stage definition

VextJS routing is defined using **three-part** `(path, options, handler)` or **two-part** `(path, handler)`:

```typescript
// Three-part form: path + options + handler
app.get(
  "/list",
  {
    validate: { query: { page: "number:1-", limit: "number:1-100" } },
    middlewares: ["audit-log"],
    docs: { summary: "User List" },
  },
  async (req, res) => {
    const { page, limit } = req.valid("query");
    res.json(await app.services.user.findAll({ page, limit }));
  },
);

// Two-part form: path + handler (no options)
app.get("/health", async (_req, res) => {
  res.json({ status: "ok" });
});
```

The second parameter, `options`, is a declarative configuration object. Common fields follow; for response, cache, upload, and other fields, see [RouteOptions](/api/route-definition#routeoptions).

| Field         | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| `validate`    | Validation rules (query / body / param / header / cookie)     |
| `middlewares` | Route-level middleware reference                              |
| `auth`        | Route protection contract; inline or same-file final `const`  |
| `session`     | Route-level Session opt-in, opt-out, or behavior override     |
| `csrf`        | Route-level CSRF opt-out                                      |
| `docs`        | OpenAPI documentation configuration                           |
| `override`    | Route-level runtime override (`rateLimit`, `timeout`, `cors`) |

## How to write routing files

Each route file default-exports the result of `defineRoutes()`. Verify the path and validation with the standalone example above before moving business operations into a service. Do not put the database connection, authentication implementation, and an entire CRUD application into your first route.

Use the two-part form for a simple endpoint such as a health check. Use the three-part form for validation, middleware, access protection, or response declarations. A factory can declare multiple methods, but each registration must be a direct statement in its body. For loading rules, see “Route loading priority” and “Exclusion rules” below. For the exact signature, see the [defineRoutes API](/api/route-definition#defineroutes).

To create, read, update, and delete a resource, see [Business route composition](#complete-example). That section names the service and authentication prerequisites explicitly.

## Route loading priority

When routes might conflict, `router-loader` applies these rules:

1. **Static paths take precedence over dynamic paths**: `/users/list` before `/users/:id`.
2. **Files sort alphabetically** for deterministic loading.
3. **Both file prefixes and final route identities are checked**: the static index rejects `routes/users.ts` alongside `routes/users/index.ts`. Runtime checks also reject duplicate normalized HTTP method and full path pairs, including case and trailing-slash variants. Different final paths do not bypass the file-prefix restriction.
4. **HEAD precedes GET at the same path, and specific paths precede wildcard paths**. Do not rely on filename order to override an existing route.

## Exclusion rules

Supported route sources are `.ts`, `.js`, and `.mjs`. A `.cjs` route source fails loading; it is neither supported nor silently excluded. The loader skips:

- Test files: `*.test.ts` and `*.spec.ts`
- Type declarations: `*.d.ts`
- Files or directories starting with `_` or `.`
- `node_modules` directories
- Generated temporary files containing `.__vext_compiled__`

These skipped files are not startup errors. Runtime loading, route diagnostics, and manifest generation use the same exclusion policy. The `_` prefix can hold shared route utilities:

```
src/routes/
├── _utils.ts          # not loaded as a route
├── _types.ts          # shared types
├── users.ts
└── orders.ts
```

## HTTP method

The `app` object in the `defineRoutes()` callback supports these HTTP methods:

| Method          | Usage                  | Common scenarios                                               |
| --------------- | ---------------------- | -------------------------------------------------------------- |
| `app.get()`     | Query resources        | List queries and detail retrieval                              |
| `app.post()`    | Create resources       | Form submission and resource creation                          |
| `app.put()`     | Full update            | Resource replacement                                           |
| `app.patch()`   | Partial update         | Field-level updates                                            |
| `app.delete()`  | Delete resources       | Resource deletion                                              |
| `app.head()`    | Get header information | Resource existence checks                                      |
| `app.options()` | Preflight request      | CORS preflight, usually handled automatically by the framework |

## Dynamic routing parameters

### File-level dynamic parameters

Use `[paramName]` as the file name or directory name to automatically convert it to a routing dynamic parameter:

```
src/routes/users/[id].ts → /users/:id
src/routes/posts/[slug].ts → /posts/:slug
src/routes/[category]/[id].ts → /:category/:id
```

```typescript
// src/routes/users/[id].ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /users/:id — file-level parameter :id is included in the prefix
  app.get(
    "/",
    {
      validate: { param: { id: "string!" } },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);
      res.json(user);
    },
  );

  // GET /users/:id/orders — file-level parameters + subpath
  app.get(
    "/orders",
    {
      validate: { param: { id: "string!" } },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const orders = await app.services.order.findByUserId(id);
      res.json(orders);
    },
  );
});
```

### Dynamic parameters within the route

The `:paramName` syntax can also be used in routing paths inside files:

```typescript
// src/routes/users.ts
export default defineRoutes((app) => {
  // GET /users/:id/posts/:postId
  app.get(
    "/:id/posts/:postId",
    {
      validate: {
        param: { id: "string!", postId: "string!" },
      },
    },
    async (req, res) => {
      const { id, postId } = req.valid("param");
      // ...
      res.json({ userId: id, postId });
    },
  );
});
```

## Request object (req)

Handlers read HTTP input through `req`. For business input, prefer `req.valid()` for locations declared in the validation schema: it contains validated, converted values. Raw `req.params/query/body/headers/cookies` remain available.

<a id="common-attributes"></a>
<a id="reqvalid--get-the-verified-data"></a>

| Data             | Declaration       | Handler read          |
| ---------------- | ----------------- | --------------------- |
| Path parameters  | `validate.param`  | `req.valid("param")`  |
| Query parameters | `validate.query`  | `req.valid("query")`  |
| Request headers  | `validate.header` | `req.valid("header")` |
| Cookies          | `validate.cookie` | `req.valid("cookie")` |
| Request body     | `validate.body`   | `req.valid("body")`   |

Only declared locations produce validation results; an undeclared location returns `undefined`. Field optionality comes from the schema; a TypeScript generic cannot substitute for runtime validation. The `id` example above converts a string into a number. A handler can apply business defaults to optional fields:

```typescript
// Inside a handler with validate.query declared
const { page = 1, limit = 20 } = req.valid("query");
```

For method, URL, raw input, request ID, IP, protocol, cookies, session, and app instance, see [request members](/api/context#public-member-list). See [req.valid()](/api/context#validlocation) for signatures and inferred types. Enable Session before accessing it. See [Uploads](/guide/uploads) for file reads and regular field limits.

<a id="reqonclose--connection-close-hook"></a>

Use [req.onClose()](/api/context#onclosehandler) to clean up timers and other resources for long connections or streams. It runs on normal response completion **or** early connection closure, at most once per callback. Registering after completion runs the callback immediately. A callback does not imply an abnormal disconnect, and normal completion does not abort `req.signal`. Check [signal](/api/context#signal) separately when cancelling downstream work.

## Response object (res)

Call `res.json(data)` in a handler to send ordinary JSON business data. Pass 201 for creation and use 204 for a successful deletion with no body. Merely returning `data` does not send a response.

<a id="resjson--json-response"></a>
<a id="chain-call"></a>

```typescript
res.json({ name: "Alice" }); // Default 200
res.status(201).setHeader("X-Custom-Header", "value").json(data);
// After successful deletion: res.status(204).json(null);
```

Each line is an alternative for a different request; do not send them in sequence for one request. By default, `config.response.wrap: true` wraps JSON as `{ code: 0, data, requestId }`; a 204 response has no body. See [JSON response](/api/context#jsondata-status) for fields, defaults, and behavior with wrapping disabled.

<a id="restext--plain-text-response"></a>
<a id="resstream--streaming-response"></a>
<a id="resdownload--file-download"></a>
<a id="resredirect--redirect"></a>
<a id="resstatuscode--read-status-code"></a>

Choose other response methods according to the task; the request and response API has exact parameters and examples:

| Task                      | Method and consideration                                                                          | Reference                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Return text               | `res.text(content, status?)`                                                                      | [Text](/api/context#textcontent-status)                                          |
| Send a file stream or SSE | `res.stream()` takes a Node.js readable stream; set Content-Type and clean up resources as needed | [Stream](/api/context#streamreadable-contenttype)                                |
| Offer an attachment       | `res.download()` sets a safe Content-Disposition and supports UTF-8 filenames                     | [Download](/api/context#downloadreadable-filename-contenttype)                   |
| Redirect                  | `res.redirect()` defaults to 302; choose another supported status when appropriate                | [Redirect](/api/context#redirecturl-status)                                      |
| Set status and headers    | Call before sending; methods can chain                                                            | [status](/api/context#statuscode), [setHeader](/api/context#setheadername-value) |
| Observe the result        | Read-only `res.statusCode` after `await next()` in middleware                                     | [Status code](/api/context#statuscode-read-only)                                 |

To constrain JSON output fields, see top-level `responses` under “OpenAPI documentation configuration.” Use `app.throw()` for errors; do not pass error responses as successful data to `res.json()`.

## Parameter validation

VextJS integrates [schema-dsl](https://github.com/devcodex-labs/schema-dsl), declares validation rules in the route `options.validate`, and the framework automatically performs validation and generates OpenAPI documents.

### DSL syntax at a glance

The introduction uses `integer:1-!` and `string:1-50!`: `!` makes a field required, and the range constrains its value or length. Use `?` (or omit the required marker) for an optional field. Declare the rule in route options and read the converted result in the handler.

For strings, numbers, email, URL, booleans, dates, and enums, see the [DSL syntax guide](/guide/validation#detailed-explanation-of-dsl-syntax) and [route validation reference](/api/route-definition#dsl-syntax-quick-check). A schema does not decide whether an email is already registered or whether a user owns a resource; implement those business and authorization checks separately.

| DSL expression         | Meaning                                  |
| ---------------------- | ---------------------------------------- |
| `'string!'`            | Required string                          |
| `'string?'`            | Optional string                          |
| `'string:1-50'`        | String, length 1-50                      |
| `'string:1-50!'`       | Required string, length 1-50             |
| `'number!'`            | Required number                          |
| `'number:1-'`          | Number, minimum value 1 (no upper limit) |
| `'number:1-100'`       | Number, range 1-100                      |
| `'email!'`             | Required, email format                   |
| `'url?'`               | Optional, URL format                     |
| `'boolean!'`           | Required Boolean value                   |
| `'admin\|user\|guest'` | Enumeration value                        |
| `'date!'`              | Required date string                     |

### Validation locations

```typescript
app.post(
  "/users/:id/settings",
  {
    validate: {
      param: {
        id: "string!",
      },
      query: {
        format: "json|xml",
      },
      header: {
        "x-api-key": "string!",
      },
      body: {
        nickname: "string:1-30!",
        avatar: "url?",
        notifications: "boolean!",
      },
    },
  },
  handler,
);
```

Validation runs in this order: `param` → `query` → `header` → `cookie` → `body`. An invalid path `param` returns HTTP 400 immediately; failure at another location returns HTTP 422 immediately.

### Validation error response

When validation fails, the framework returns a structured error response:

```json
{
  "code": 422,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "must be a valid email address" },
    { "field": "name", "message": "length must be between 1 and 50" }
  ],
  "requestId": "xxx"
}
```

## Routing level middleware

Use `options.middlewares` to attach middleware to a route. This is a composition snippet: first create the `audit-log` and `response-label` files described in [Define middleware](/guide/middleware#define-middleware), then allowlist them in configuration. `handler` represents your own business handler.

```typescript
// src/config/default.ts
export default {
  middlewares: [
    "audit-log",
    { name: "response-label", options: { value: "configured" } },
  ],
};
```

```typescript
// src/routes/admin.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // String reference
  app.get(
    "/dashboard",
    {
      middlewares: ["audit-log"],
    },
    handler,
  );

  // Object reference overrides configured default options
  app.delete(
    "/users/:id",
    {
      middlewares: [
        "audit-log",
        { name: "response-label", options: { value: "admin" } },
      ],
    },
    handler,
  );
});
```

Custom route middleware runs in declaration order, before automatic route validation. Before `next()`, do not assume `req.valid()` has validation results. An authentication middleware must establish `req.auth` before a route's `auth` guard can enforce protection.

The factory argument here comes from the `response-label` definition. Route options replace that middleware's configured default options as a whole. Configure built-in rate limiting with global `rateLimit.enabled` and route `override.rateLimit`; `window` is measured in seconds. See [override](/api/route-definition#override).

## OpenAPI document configuration

OpenAPI documentation information for configuring routing via `options.docs`:

```typescript
app.post(
  "/users",
  {
    validate: {
      body: { name: "string:1-50!", email: "email!" },
    },
    responses: {
      201: {
        schema: { id: "string", name: "string", email: "email" },
      },
    },
    docs: {
      summary: "Create user",
      description: "Create a new user, the email address must be unique.",
      operationId: "createUser",
      deprecated: false,
      responses: {
        201: {
          description: "Created successfully",
        },
        409: {
          description: "Email already exists",
        },
      },
    },
  },
  handler,
);
```

Top-level `responses` is the runtime contract used for compiled JSON
serialization, OpenAPI, and generated client types. Keep descriptions and
examples in `docs.responses`; do not repeat the schema there for the same
status selector.

### Hidden route

To omit a route from generated OpenAPI documentation, set `docs.hidden: true`. This does not block HTTP access; use authentication and authorization for access control:

```typescript
app.get(
  "/internal/metrics",
  {
    docs: { hidden: true },
  },
  handler,
);
```

## Access the `app` object

The `app` argument to `defineRoutes()` gives access to services, logging, errors, and configuration:

```typescript
export default defineRoutes((app) => {
  app.get("/example", async (req, res) => {
    // Access a service
    const data = await app.services.user.findAll();

    // use logger
    app.logger.info("Fetching users");

    // throw HTTP error
    if (!data) app.throw(404, "not_found");

    // Read configuration
    const port = app.config.port;

    res.json(data);
  });
});
```

:::tip req.app and closure app

A route handler can access `app` in either way:

- **Closure `app`**: the argument to `defineRoutes((app) => ...)`.
- **`req.app`**: the real runtime application reference on the request.

The factory's `app` is a Proxy facade backed by the real application. Reads of `app.config`, `app.services`, and extension properties forward to the real application; these are not property snapshots copied into a collector. `req.app` points to the real application.

Use `req.app.fetch` in a handler for attached methods such as `fetch.get()` and `fetch.create()`; see the [HTTP client guide](/guide/fetch).

If you assign `const config = app.remoteConfig` outside request handling, that variable retains the value read at that moment. For the latest value, read `app.remoteConfig` or `req.app.remoteConfig` inside the handler. This is ordinary JavaScript reference capture, regardless of which app entry point you choose.

The factory's HTTP registration methods close after collection. Calling `app.get()` from a handler fails.
:::

## Error handling

### `app.throw()` — throw HTTP error

When using `app.throw()` in a route or service to throw an error, the framework will handle it uniformly and return a structured response:

```typescript
// Basic usage
app.throw(404, "User does not exist");
// → { "code": 404, "message": "User does not exist", "requestId": "..." }

// Use i18n key (with locales/ language pack)
app.throw(404, "user.not_found");
// → Automatically translate the message into the current request language

// With a business error code
app.throw(400, "Email has been registered", 10001);
// → { "code": 10001, "message": "Email has been registered", "requestId": "..." }

// With interpolation parameters
app.throw(400, "balance.insufficient", { balance: 50 });
// → code comes from the locale's business code if present; otherwise 400.
//   The message comes from translation and interpolation.

// With interpolation parameters + business error code
app.throw(400, "balance.insufficient", { balance: 50 }, 20001);
```

`app.throw()` will terminate the current request processing flow (function signature returns `never`), no need to add `return` after it.

If an unexpected exception is thrown here, you can also directly:

```typescript
throw new Error("Database connection lost");
```

The framework will catch it as well, but this path represents an "unknown runtime error" and will ultimately return a `500 Internal Server Error`. In the development environment, when `response.hideInternalErrors = false`, the JSON 500 response will be accompanied by `stack`; if your goal is to actively return a clear `4xx/5xx` HTTP result, you should still use `app.throw(...)` first.

<a id="complete-example"></a>

## Business route composition

This article-creation example connects HTTP input to business operations and an HTTP response. Before running it, implement a `post` service and provide an allowlisted `auth` middleware that sets `req.auth.userId`. It is a business wiring snippet; without those prerequisites, start with `route-demo.ts` above.

```typescript
// src/routes/posts.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      validate: {
        body: {
          title: "string:1-200!",
          content: "string:1-50000!",
          tags: "string?",
        },
      },
      middlewares: ["auth"],
      auth: { required: true, security: "bearerAuth" },
      docs: { summary: "Create a post" },
    },
    async (req, res) => {
      const post = await app.services.post.create({
        ...req.valid("body"),
        authorId: req.auth.userId,
      });
      res.json(post, 201);
    },
  );
});
```

For a full CRUD resource, keep the same responsibilities:

| Operation      | Route and input                                                                                   | Handler and service responsibility                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Paginated list | `GET /`; declare `page`, `limit`, and a status enum in query                                      | Apply business defaults such as `page=1` and `limit=20` after `req.valid("query")`, then call `post.findAll()` |
| Read details   | `GET /:id`; require `id` in param                                                                 | Call `post.findById()`; use `app.throw(404, "post.not_found")` if missing                                      |
| Create         | `POST /` above; keep body separate from auth context                                              | Enforce business rules in `post.create()` and return 201                                                       |
| Update         | `PATCH /:id`, or PUT when appropriate; require param and declare editable body fields as optional | Check ownership and status in `post.update()`; do not permit arbitrary client field overwrite                  |
| Delete         | `DELETE /:id`; require param and authentication                                                   | Check permissions in `post.delete()`, then send `res.status(204).json(null)` without a body                    |

A status enum can use `draft|published|archived`. Validation constrains declared input. `auth.required` does not automatically check ownership, status, or database uniqueness. See [Services](/guide/services) and [Security](/guide/security) for implementation, and [CRUD API](/examples/crud-api) for an example with its application dependencies.

## Next step

- Understand how the [service layer](/guide/services) organizes business logic
- Learn the onion model of [middleware](/guide/middleware)
- Explore the advanced usage of [Parameter Validation](/guide/validation)
- View [OpenAPI Documentation](/guide/openapi) automatically generated
- Check stable Rule IDs in the [HTTP and Routing Specification](/specification/http-and-routing)

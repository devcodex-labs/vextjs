# Test tools

This page documents `createTestApp`, `TestApp`, `TestRequest`, `TestRequestBuilder`, `TestResponse`, and `createTestJobRunner`. See the [Testing guide](/guide/testing) for a complete business fixture and execution steps; use this page for signatures, defaults, and execution boundaries.

## Overview

Import runtime values and types through `vextjs/testing`:

```typescript
import {
  createTestApp,
  createTestJobRunner,
  type CreateTestAppOptions,
  type TestApp,
  type TestRequest,
  type TestRequestBuilder,
  type TestResponse,
  type TestResponseHeaderValue,
  type CreateTestJobRunnerOptions,
  type TestJobRunner,
} from "vextjs/testing";
```

ESM `import` and CommonJS `require()` are supported, and the root and subpath exports share runtime identity. For example, errors can be checked with `require("vextjs").HttpError`. The root exports only five of the HTTP testing types additionally; see [Type import](#type-import).

- **In-memory request**: Builds an adapter handler and simulates Node request/response without listening on TCP. Plugins, dictionary scripts, services, and outbound fetch may still perform real I/O.
- **Test defaults**: Silent logger, disabled rate limiting and access logs, and a one-second shutdown budget; all can be overridden.
- **Execution timing**: A builder is PromiseLike; `await` or `.then()` dispatches the request.
- **Cleanup**: `_testMode` is forced to true, so shutdown does not call `process.exit`; call `close()` even after successful creation.
- **Scope**: This does not equal CLI bootstrap, real HTTP, frontend rendering/hydration, or database integration.

---

## createTestApp

`createTestApp` creates a test app and request handler. It does not supply `/health`, business routes, or a database automatically.

Application dictionaries load before plugins, services, and routes. The default `rootDir/src/locales` can be overridden with `config.locale.directory`; module subdirectories, JSON, and script dictionaries are supported. Missing directories give an empty dictionary, invalid formats fail initialization, and scripts execute as modules. This does not read project configuration files, run a configuration provider, or automatically connect a database. To reload explicitly, call the root export `loadI18n(testApp.app, directory)`; see [Internationalization](/guide/i18n).

### Function signature

```typescript
async function createTestApp(options?: CreateTestAppOptions): Promise<TestApp>;
```

### Basic usage

This standalone example needs no business route. Save it as `test/testing-api.mjs` and run `node test/testing-api.mjs` from a project with `vextjs` installed:

```javascript
// test/testing-api.mjs
import assert from "node:assert/strict";
import { createTestApp } from "vextjs/testing";

const testApp = await createTestApp({
  routes: false,
  services: false,
  middlewares: false,
  config: { adapter: "native" },
});
try {
  const res = await testApp.request.get("/missing");
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 404);
  assert.equal(typeof res.body.requestId, "string");
} finally {
  await testApp.close();
}
```

It should exit without assertion failures. The option and request fragments below are independent: import their needed types/assertion tools and prepare their routes first. `/users` is not built in. Close each created app; do not overwrite a variable repeatedly and lose an earlier instance.

### Return value

Returns `Promise<TestApp>`, containing three members: `app`, `request` and `close`.

---

## CreateTestAppOptions

Configuration options for `createTestApp`. All fields are optional.

```typescript
interface CreateTestAppOptions {
  config?: VextConfigOverride;
  plugins?: boolean;
  setupPlugins?: (app: VextApp) => Promise<void> | void;
  services?: boolean;
  mockServices?: Partial<VextServices>;
  routes?: boolean;
  middlewares?: boolean;
  rootDir?: string;
  devOverlay?: (error: unknown) => string;
}
```

### Field description

| Field          | Type                         | Default Value   | Description                                                                    |
| -------------- | ---------------------------- | --------------- | ------------------------------------------------------------------------------ |
| `config`       | `VextConfigOverride`         | `{}`            | Later-layer patch merged over framework and test defaults                      |
| `plugins`      | `boolean`                    | `false`         | Whether to load `src/plugins/` (not loaded by default in the test environment) |
| `setupPlugins` | `Function`                   | `undefined`     | Manually register plugins (replacing automatic scanning)                       |
| `services`     | `boolean`                    | `true`          | Whether to load `src/services/`                                                |
| `mockServices` | `Partial<VextServices>`      | `undefined`     | Manually inject mock services                                                  |
| `routes`       | `boolean`                    | `true`          | Whether to load `src/routes/`                                                  |
| `middlewares`  | `boolean`                    | `true`          | Whether to load `src/middlewares/`                                             |
| `rootDir`      | `string`                     | `process.cwd()` | Project root directory (used to locate the `src/` subdirectory)                |
| `devOverlay`   | `(error: unknown) => string` | `undefined`     | Optional HTML error renderer when the request accepts `text/html`              |

---

### `config`

Patch framework and test defaults using the same path-aware deep-merge semantics
as profile/local configuration. Nested plain objects already present in those
defaults may be partial; atomic adapters, stores, callbacks, and arrays remain
complete values. `createTestApp()` does not load the project's
`src/config/default.ts`, and its built-in defaults do not include `database`, so
adding that optional section requires a complete database configuration rather
than a partial patch. This helper still does not start the built-in MonSQLize plugin; `plugins: true` scans only user plugins. See the [Database guide](/guide/database) for real database verification.

```typescript
testApp = await createTestApp({
  config: {
    adapter: "fastify", // Requires its installed Fastify peer.
    response: { wrap: false }, // Disable export wrapping
    cors: { enabled: false }, // Disable CORS
  },
});
```

**Effective test defaults** (unlisted fields inherit framework defaults; `session.enabled: false` comes from the framework layer):

```typescript
{
  port: 0, // Isolated test configuration; TestRequest does not listen
  host: '127.0.0.1',
  logger: { level: 'silent' }, // Log silently
  rateLimit: {
    enabled: false, // disable current limiting
    max: 100,
    window: 60,
    message: 'Too Many Requests',
    keyBy: 'ip',
  },
  accessLog: { enabled: false }, // Disable request log noise
  session: { enabled: false }, // Same opt-in default as the app runtime
  shutdown: { timeout: 1 }, // Quick shutdown (1 second)
  _testMode: true, // prevent process.exit()
}
```

`_testMode` is forced true after merging and cannot be disabled through options. Merge priority from lowest to highest is `DEFAULT_CONFIG` → `test defaults` → `config parameters`. Explicitly setting `rateLimit.enabled`, `accessLog.enabled`, or `session.enabled` to `true` registers the same built-in runtime used by production and development.

`TestRequest` invokes the built handler directly, so its requests never bind or connect to this port.

---

### `plugins`

Controls whether to automatically scan the `src/plugins/` directory to load plugins.

```typescript
// Plugins are not loaded by default.
testApp = await createTestApp(); // plugins: false

// Integration tests may need real plugins.
testApp = await createTestApp({ plugins: true });
```

---

### `setupPlugins`

Run a manual setup callback instead of automatic plugin scanning. It can extend the app, register global middleware, and register lifecycle hooks. Injected resources are not automatically given a close handler.

```typescript
testApp = await createTestApp({
  setupPlugins: async (app) => {
    const cache = new Map<string, unknown>();
    app.extend("testCache", cache);
    app.onClose(() => {
      cache.clear();
    });
  },
});
```

:::tip
`setupPlugins` is used to replace automatic scanning: when `setupPlugins` is passed in, the test tool only executes this function and no longer reads the file system scan triggered by `plugins: true`. If you need real plug-ins, please use `plugins: true`; if you need precise control of test dependencies, please only use `setupPlugins`.
:::

---

### `services`

Controls whether to automatically load services in the `src/services/` directory.

```typescript
//Load the real service (default, recommended for integration testing)
testApp = await createTestApp(); // services: true

// Do not load the service (unit testing recommendation: use mockServices instead)
testApp = await createTestApp({
  services: false,
  mockServices: {
    user: {
      findAll: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: vi.fn().mockResolvedValue({ id: "1", name: "Test User" }),
    },
  },
});
```

#### TypeScript service file loading mechanism

Service and user-middleware TypeScript modules use a shared module loader that compiles local dependencies and maps `.js` imports to `.ts` source. npm dependencies still resolve from the project. Temporary products have a project owner and are cleaned afterward. The working directory must be writable; missing modules and invalid exports fail initialization.

Route files instead load through Node's direct `import(fileURL)`. Do not assume that Service compilation automatically compiles routes. On Node 20, an installed package plus Vitest may report `Unknown file extension ".ts"`; use JavaScript routes, a compatible test loader, or a Node environment satisfying native TS type stripping as described in [Testing: Quick start](/guide/testing#quick-start). The real CLI dev/build path has its own compilation flow.

Multiple test processes sharing the same or overlapping `rootDir` may contend for the owner and report `VEXT_OWNER_BUSY`. Run a shared fixture serially or use separate, nonoverlapping projects. Lack of a TCP port conflict does not imply unconditional parallel safety.

---

### `mockServices`

Manually inject the mock service and overwrite the `service-loader` scan results.

```typescript
const mockUserService = {
  findAll: vi.fn().mockResolvedValue([
    { id: "1", name: "Alice" },
    { id: "2", name: "Bob" },
  ]),
  findById: vi.fn().mockResolvedValue({ id: "1", name: "Alice" }),
  create: vi.fn().mockImplementation(async (data: { name: string }) => ({
    id: "3",
    ...data,
  })),
  update: vi.fn().mockResolvedValue({ id: "1", name: "Updated" }),
  delete: vi.fn().mockResolvedValue(undefined),
};

testApp = await createTestApp({
  mockServices: {
    user: mockUserService,
  },
});
```

This leaves `services` at its default `true`. Add `services: false` when only the mock should run, avoiding construction of the real Service first. A mock does not automatically implement missing business methods; it must satisfy the methods your routes use.

**Merge Logic**:

| `services` | `mockServices` | behavior                                                                                         |
| :--------: | :------------: | ------------------------------------------------------------------------------------------------ |
|   `true`   |     Valid      | Load the real service first, then use `mockServices` to overwrite the service with the same name |
|   `true`   |    No value    | Only use real services                                                                           |
|  `false`   |   has value    | only use `mockServices`                                                                          |
|  `false`   |    No value    | No automatic load/injection; a plugin can still explicitly provide a service                     |

---

### `routes`

Controls whether to load `rootDir/src/routes/`. The request chain is prepared from final configuration and middleware allowlist before loading; file prefixes still apply. `routes: false` does not register a test route.

```typescript
//Load the real route (default, integration test)
testApp = await createTestApp(); // routes: true

// Do not load routes (routing is not required when unit testing the service layer)
testApp = await createTestApp({ routes: false });
```

---

### `middlewares`

Controls loading user middleware from `rootDir/src/middlewares/` according to `config.middlewares`. Default `true` does not enable the whole directory; an empty allowlist loads none, and routes referring to undeclared names fail.

```typescript
//Load user middleware (default)
testApp = await createTestApp(); // middlewares: true

// Skip user middleware loading (when testing does not involve routing-level middleware)
testApp = await createTestApp({ middlewares: false });
```

:::tip
This option controls only the user-middleware directory. Built-in requestId, CORS, bodyParser, response wrapper, Session, CSRF, and rate limiting follow their own configuration; they are not all unconditionally registered.
:::

---

### `rootDir`

The project root directory is used to locate `src/routes`, `src/services`, `src/plugins` and other directories.

```typescript
import { fileURLToPath } from "node:url";

// For a file at test/http.test.ts:
const rootDir = fileURLToPath(new URL("./fixtures/http/", import.meta.url));
testApp = await createTestApp({ rootDir });
```

---

### `devOverlay`

Pass `(error: unknown) => string` to render an HTML error when request Accept includes `text/html`. If the callback throws, normal error handling takes over. This does not start frontend builds, Fast Refresh, or a browser, and it does not affect JSON requests. Test error hiding with an explicit Accept header and `response.hideInternalErrors` setting.

### Initialization and resource boundary

Order: configuration merge → app / i18n / Session / rateLimit runtime / adapter / fetch → plugins → user middleware → Services → mock override → routes → built-in request chain and error handling → onReady → handler / TestRequest.

`onReady` is awaited, but an individual hook error is logged by the app and execution continues; do not assume initialization rejects. Assert readiness side effects directly. This helper omits production bootstrap's config files, providers, preload, built-in DB, frontend artifact checks, and process signal flow.

On initialization failure, no `close()` has been returned. Custom setup that fails after allocating resources must clean up what it acquired; do not assume every failure path was rolled back as a whole.

---

## TestApp

The test application instance returned by `createTestApp`.

```typescript
interface TestApp {
  app: VextApp;
  request: TestRequest;
  close(): Promise<void>;
}
```

### `app`

The underlying `VextApp` instance, which can be used to directly access application capabilities:

```typescript
// Assume testApp exists and is closed in finally/teardown.
// Access configuration.
console.log(testApp.app.config.port);

// Access a service.
const user = await testApp.app.services.user.findById("1");

// Access the logger.
testApp.app.logger.info("under testing");
```

### `request`

HTTP request simulator, similar to `supertest` style API. See [TestRequest](#testrequest) for details.

### `close()`

Close the test application, trigger the `onClose` hook, and clean up resources.

```typescript
close(): Promise<void>;
```

:::warning
**Be sure to call `close()`** in `afterEach` or `afterAll`, otherwise it will cause resource leaks (database connections, timers, etc.) and the test process cannot exit.
:::

```typescript
import { afterEach } from "vitest";
import type { TestApp } from "vextjs/testing";

let testApp: TestApp | undefined;

afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});
```

`close()` waits for app shutdown. The default one-second budget applies to the whole shutdown, not each hook. Closing an already closed instance does not repeat cleanup. It does not reset all process-level module caches or delete external test data.

---

## TestRequest

HTTP request simulator, providing a chained API similar to `supertest` style.

```typescript
interface TestRequest {
  get(path: string): TestRequestBuilder;
  post(path: string): TestRequestBuilder;
  put(path: string): TestRequestBuilder;
  patch(path: string): TestRequestBuilder;
  delete(path: string): TestRequestBuilder;
  options(path: string): TestRequestBuilder;
  head(path: string): TestRequestBuilder;
}
```

### Supported HTTP methods

| Method                  | Description          |
| ----------------------- | -------------------- |
| `request.get(path)`     | Send GET request     |
| `request.post(path)`    | Send POST request    |
| `request.put(path)`     | Send PUT request     |
| `request.patch(path)`   | Send PATCH request   |
| `request.delete(path)`  | Send DELETE request  |
| `request.options(path)` | Send OPTIONS request |
| `request.head(path)`    | Send HEAD request    |

Each method returns `TestRequestBuilder`, which supports chain configuration and execution of requests through `await`.

:::note HEAD responses
`request.head(path)` follows HTTP HEAD semantics. The response status and headers are preserved, but `TestResponse.text` and `TestResponse.body` are empty even when the route handler writes a body. Use the matching `GET` route when you need to assert the response body.
:::

### Basic usage

```typescript
// GET request
const res1 = await testApp.request.get("/users/list");

// POST request
const res2 = await testApp.request.post("/users").send({
  name: "Alice",
  email: "alice@example.com",
});

// PUT request
const res3 = await testApp.request.put("/users/1").send({
  name: "Alice Updated",
});

// DELETE request
const res4 = await testApp.request.delete("/users/1");

// OPTIONS request; a real preflight also needs Origin and Access-Control-Request-Method.
const res5 = await testApp.request.options("/users");
```

---

## TestRequestBuilder

The chained request constructor supports setting request headers, query parameters, request bodies, etc., and finally executes the request through `await` or `.then()`.

```typescript
interface TestRequestBuilder extends PromiseLike<TestResponse> {
  set(key: string, value: string): this;
  headers(headers: Record<string, string>): this;
  query(params: Record<string, string | number | boolean>): this;
  send(body: unknown): this;
  type(contentType: string): this;
}
```

:::tip
`TestRequestBuilder` is PromiseLike, so `await` executes a request without `.execute()`. Each `await` or `.then()` runs a new request; the builder does not cache a Promise result and does not provide the full Promise `catch`/`finally` interface.
:::

---

### `set(key, value)`

Set one request header. Names are lowercased, and setting the same name again replaces its previous value.

```typescript
set(key: string, value: string): this;
```

```typescript
const res = await testApp.request
  .get("/profile")
  .set("Authorization", "Bearer eyJ...")
  .set("Accept-Language", "zh-CN");

expect(res.status).toBe(200);
```

---

### `headers(headers)`

Set multiple request headers (in object form).

```typescript
headers(headers: Record<string, string>): this;
```

```typescript
const res = await testApp.request.get("/profile").headers({
  Authorization: "Bearer eyJ...",
  "Accept-Language": "zh-CN",
  "X-Custom-Header": "custom-value",
});
```

:::tip
`set()` and `headers()` can be used together, and the value set later will overwrite the request header with the same name set first.
:::

---

### `query(params)`

Set URL query parameters.

```typescript
query(params: Record<string, string | number | boolean>): this;
```

Parameter values are automatically converted to strings and URL encoded.

```typescript
const res = await testApp.request
  .get("/users/list")
  .query({ page: 1, limit: 10, active: true });
// Equivalent to GET /users/list?page=1&limit=10&active=true

expect(res.status).toBe(200);
expect(res.body.data).toHaveLength(10);
```

Calling `query()` again **replaces** the previous object:

```typescript
const res = await testApp.request
  .get("/search")
  .query({ keyword: "hello" })
  .query({ page: 1 });
// Equivalent to GET /search?page=1; keyword was replaced.
```

An existing query string in `path` remains and the new query object is appended with `&`; duplicate keys may result and are parsed by application rules. The type does not accept arrays; encode them in the path yourself. Multiple `query()` calls do not create multi-value parameters.

---

### `send(body)`

Set or replace the request body. Strings are sent as-is; other non-undefined values use `JSON.stringify`. If no Content-Type is supplied, the default is `application/json`. Buffer, Stream, and FormData are not automatically encoded as uploads; use a real HTTP client for those transports.

```typescript
send(body: unknown): this;
```

```typescript
// JSON object
const res = await testApp.request
  .post("/users")
  .send({ name: "Alice", email: "alice@example.com" });

expect(res.status).toBe(201);
expect(res.body.data.name).toBe("Alice");
```

```typescript
// Nested objects
const res = await testApp.request.post("/orders").send({
  items: [
    { productId: "p1", quantity: 2 },
    { productId: "p2", quantity: 1 },
  ],
  shippingAddress: {
    city: "Beijing",
    street: "xxx Road, Chaoyang District",
  },
});
```

```typescript
// String (send directly without JSON serialization)
const res = await testApp.request
  .post("/webhook")
  .type("text/plain")
  .send("raw text body");
```

---

### `type(contentType)`

Set the `Content-Type` request header.

```typescript
type(contentType: string): this;
```

```typescript
// send form-urlencoded
const res = await testApp.request
  .post("/login")
  .type("application/x-www-form-urlencoded")
  .send("username=alice&password=secret");

//Send XML
const res = await testApp.request
  .post("/xml-endpoint")
  .type("application/xml")
  .send("<user><name>Alice</name></user>");
```

:::tip
`send()` defaults to `Content-Type: application/json` if unset. `type()` works before or after `send()` and takes precedence over Content-Type set through `set()` or `headers()` when executing. If `send()` created the default type, a later `set()` does not override that separate type value; use `type()`. A Content-Type declaration does not encode an object as form-urlencoded or XML.
:::

---

### Chain combination

All methods support chained calls, and the request is ultimately executed through `await`:

```typescript
const res = await testApp.request
  .post("/users")
  .set("Authorization", "Bearer eyJ...")
  .set("X-Request-Id", "test-req-001")
  .query({ notify: "true" })
  .type("application/json")
  .send({
    name: "Alice",
    email: "alice@example.com",
    role: "admin",
  });

expect(res.status).toBe(201);
expect(res.body.code).toBe(0);
expect(res.body.data.name).toBe("Alice");
expect(res.headers["x-request-id"]).toBe("test-req-001");
```

---

## TestResponse

Simulates an HTTP response object, including status code, response headers and parsed response body.

```typescript
interface TestResponse {
  status: number;
  headers: Record<string, string | string[]>;
  cookies: string[];
  header(name: string): string | undefined;
  headerValues(name: string): string[];
  body: any;
  text: string;
}
```

### `status`

HTTP status code.

```typescript
status: number;
```

```typescript
const res = await testApp.request.get("/users/list");
expect(res.status).toBe(200);

const res2 = await testApp.request.get("/users/nonexistent");
expect(res2.status).toBe(404);

const res3 = await testApp.request
  .post("/users")
  .send({ name: "Alice", email: "alice@example.com" });
expect(res3.status).toBe(201);
```

---

### `headers`

Response header object, all keys are lowercase.

```typescript
headers: Record<string, string | string[]>;
```

```typescript
const res = await testApp.request.get("/users/list");

// Check Content-Type
expect(res.header("content-type")).toContain("application/json");

// Check custom response headers
expect(res.headers["x-request-id"]).toBeDefined();

// To check CORS, enable it and supply an allowed Origin; then assert the expected header value.
```

Multiple `Set-Cookie` values are preserved without comma splitting. The following two-cookie assertion assumes that the route actually sets two cookies. Prefer `res.cookies` or `res.headerValues("set-cookie")`:

```typescript
expect(res.cookies).toHaveLength(2);
expect(res.headerValues("set-cookie")).toEqual(res.cookies);
expect(res.header("content-type")).toContain("application/json");
```

### `cookies` / `header(name)` / `headerValues(name)`

| Member                              | Return                                              | When missing |
| ----------------------------------- | --------------------------------------------------- | ------------ |
| `cookies: string[]`                 | All Set-Cookie values                               | `[]`         |
| `header(name): string \| undefined` | First value, case-insensitive                       | `undefined`  |
| `headerValues(name): string[]`      | All values, including single-valued header as array | `[]`         |

These helpers do not maintain a session automatically. To continue one, send the relevant Set-Cookie `name=value` pairs in a later Cookie request header and keep test sessions isolated.

---

### `body`

When Content-Type includes `application/json` or `+json`, JSON parsing is attempted; the result can also be a primitive or null. For other types or parse failure, `body` retains the same string as `text`, not undefined. HEAD and 204 empty bodies are usually `""`.

```typescript
body: any;
```

```typescript
const res = await testApp.request.get("/users/list");

//Export packaging format
expect(res.body).toEqual({
  code: 0,
  data: expect.any(Array),
  requestId: expect.any(String),
});

// Directly access business data
expect(res.body.data).toHaveLength(2);
expect(res.body.data[0].name).toBe("Alice");
```

**Error response**:

```typescript
const res = await testApp.request.get("/users/nonexistent-id");

expect(res.body).toEqual({
  code: 404,
  message: "User does not exist",
  requestId: expect.any(String),
});
```

**With business error code**:

```typescript
const res = await testApp.request.post("/users").send({
  email: "existing@example.com",
});

expect(res.body.code).toBe(10001);
expect(res.body.message).toBe("Email has been registered");
```

---

### `text`

Raw response text. For a JSON response, `text` is the JSON string; for a text response, `text` is the raw text content.

```typescript
text: string;
```

```typescript
// Raw text of JSON response
const res = await testApp.request.get("/users/list");
console.log(res.text);
// '{"code":0,"data":[...],"requestId":"..."}'

// text response
// Assume /plain has a handler calling res.text("OK").
const res2 = await testApp.request.get("/plain");
expect(res2.text).toBe("OK");
```

---

## createTestJobRunner

```typescript
function createTestJobRunner(
  options: CreateTestJobRunnerOptions,
): Promise<TestJobRunner>;

interface CreateTestJobRunnerOptions extends Omit<
  CreateTestAppOptions,
  "routes"
> {
  jobs: Record<string, VextJobDefinition> | VextJobDefinition[];
}

interface TestJobRunner {
  app: VextApp;
  registry: VextJobRegistry;
  run(jobName: string, options?: VextJobRunOptions): Promise<VextJobRunResult>;
  close(): Promise<void>;
}
```

| Member/rule        | Behavior                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `jobs`             | Required input definitions; does not scan `src/jobs`                                                   |
| Names              | Object uses `definition.name` first, then object key; unnamed array jobs use `job1`, `job2`, and so on |
| Duplicates         | Registry creation throws for duplicate names                                                           |
| Other options      | Follow `CreateTestAppOptions` but force `routes: false`; Services/plugins can still have side effects  |
| `app` / `registry` | Test app and jobs; registry supports `list/get/has/toJSON`                                             |
| `run()`            | Executes a job, validates payload, applies retry/timeout; does not start scheduler or worker           |
| `close()`          | Closes the test app; await in-flight runs and handle cancellation first                                |

`run` options include payload, signal, runId, trigger, scheduledAt, and idempotencyKey. Results include jobName, runId, status, attempts, durationMs, and optional result/error. Status is success, failed, cancelled, or timeout. Check result status; unknown jobs may still reject directly. Cancellation and timeout cooperate through AbortSignal rather than forcibly interrupting a handler that ignores it. `close()` does not cancel every running job. See [Jobs API](/api/jobs#runjobapp-registry-name-options).

Save this separately as `test/job-api.mjs` and run it with Node:

```javascript
// test/job-api.mjs
import assert from "node:assert/strict";
import { defineJob } from "vextjs";
import { createTestJobRunner } from "vextjs/testing";

const runner = await createTestJobRunner({
  services: false,
  middlewares: false,
  config: { adapter: "native" },
  jobs: { ping: defineJob({ handler: () => ({ ok: true }) }) },
});
try {
  const result = await runner.run("ping");
  assert.equal(result.status, "success");
  assert.deepEqual(result.result, { ok: true });
} finally {
  await runner.close();
}
```

This helper does not create a real scheduler process, write persistent run records, or verify Store leases. Test scheduling, distributed claiming, and recovery separately using the [Jobs guide](/guide/jobs).

## Usage mode

| Goal                                        | Configuration and assertions                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Real routes and Services                    | Keep relevant scanning and supply dependencies; this is not full production bootstrap                                                   |
| Mock Service                                | Set `services: false`, provide a mock matching the business interface, and assert arguments/results                                     |
| Auth/middleware                             | Declare `config.middlewares` allowlist and route references; test valid, missing, and invalid credentials                               |
| Different adapters                          | Select an installed adapter with `config.adapter`; Koa also needs its router peer; see [Adapters](/guide/adapters)                      |
| Custom plugin                               | Use `setupPlugins` with a contract-compliant object and close resources through `onClose`; a Map mock does not verify Redis integration |
| Business, validation, internal errors       | Trigger each path explicitly and assert HTTP status, code, message, and errors; set `hideInternalErrors` and Accept explicitly          |
| `response.wrap`                             | Create separate apps with wrap true and false; errors do not become success envelopes                                                   |
| Session/Cookie                              | Extract relevant Set-Cookie `name=value` and set Cookie explicitly on the next request; there is no automatic cookie jar                |
| Logs, rate limiting, CSRF, security headers | Explicitly enable features disabled by test defaults, then test positive/negative requests and headers                                  |

Runnable CRUD, middleware, mock, and Service unit tests are in [Testing examples](/guide/testing#practical-example). Adapter transport, SSE, WebSocket, uploads, socket disconnects, and real TLS need separate network verification.

---

## Best Practices

- Close a successfully created app in `finally` or `afterEach`/`afterAll`. Use `TestApp | undefined` to handle creation failure.
- Give stateful tests independent data. Read-only cases can share an instance, but serialize module loading for a shared `rootDir`.
- Constrain mocks to real public interfaces. A plain Error's valid `status`/`statusCode` can also be normalized; use `HttpError` or `app.throw` for business codes and type identity.
- Assert the target branch explicitly. “Status is not 401” can misread a 500 as success. State input conditions and expected results in test names.
- Use [real CLI verification](/guide/testing#4-complete-production-path-checks-with-the-real-cli) for production config, preload, DB, frontend, and build/start.

## Common issues

| Symptom                                    | What to check                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Route returns 404                          | Does `rootDir/src/routes` exist, is scanning disabled, is the file prefix duplicated? This helper adds no health route. |
| Unknown file extension `.ts`               | Native TS route import prerequisites; Service compilation does not imply route compilation.                             |
| `VEXT_OWNER_BUSY`                          | Concurrent loads of the same or parent/child `rootDir`; serialize or isolate fixtures.                                  |
| Real dependency connects before mock       | `services` is still true by default, so real services load before the mock override.                                    |
| DB or project config does not apply        | The helper does not load project config/providers/built-in DB; supply dependencies explicitly or use the real CLI.      |
| Query argument disappeared                 | Repeated `query()` replaces; provide one complete object.                                                               |
| Text body is not undefined                 | Non-JSON or parse failure keeps text; HEAD/204 gives an empty string.                                                   |
| Test hangs                                 | Await/close, response completion, and external resources; the builder has no separate network-request timeout.          |
| In-memory request passes, production fails | Real port/proxy/upload/long connection/config/frontend are outside this result's scope.                                 |

---

## Type import

```typescript
// Runtime values.
import { createTestApp, createTestJobRunner } from "vextjs/testing";

// Type (imported from main entrance)
import type {
  CreateTestAppOptions,
  TestApp,
  TestRequest,
  TestRequestBuilder,
  TestResponse,
} from "vextjs";
```

:::tip
Import runtime testing values through `vextjs/testing`. The five HTTP types above may come from the main `vextjs` entry. Import `TestResponseHeaderValue`, `CreateTestJobRunnerOptions`, and `TestJobRunner` from `vextjs/testing`; do not import the `createTestApp` or `createTestJobRunner` runtime values from the root entry.
:::

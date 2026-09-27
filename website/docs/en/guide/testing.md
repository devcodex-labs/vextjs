# Testing

`createTestApp()` from `vextjs/testing` runs route, middleware, and Service request chains in memory. It does not listen on TCP or run the full CLI startup flow. Database connections, config providers, production builds, and frontend hydration need their own real integration checks.

Both ESM `import` and CommonJS `require()` work. The package root and public subpaths share runtime identity; for example, an HttpError thrown by a test app can satisfy `instanceof require("vextjs").HttpError`. See [Testing API](/api/testing-api) for the full return types.

## Quick Start

Prerequisite: use the TypeScript API-only project from [Quick Start](/guide/quick-start), retaining the scaffold's `/health` route in `src/routes/index.ts` and its Service. Install Vitest if it is not already present:

```bash
npm install -D vitest
```

The TS route example on this page requires Node.js 22.18+ or a newer version with equivalent default type stripping, plus `"type": "module"` in `package.json`. Route loading uses Node import directly: installing Vitest alone does not make Node 20 load `.ts` routes. Native type stripping neither remaps `.js` to `.ts` at runtime nor reads path aliases, and it does not support every TypeScript syntax form. See the [Node TypeScript documentation](https://nodejs.org/api/typescript.html). For complex route dependencies, configure a compatible test loader or test real CLI build output.

Create this test file and run it from the **project root**. Check the current Vitest Node requirement in its [official installation guide](https://vitest.dev/guide/), and use a Node version supported by both tools.

```typescript
// test/health.test.ts
import { it, expect } from "vitest";
import { createTestApp } from "vextjs/testing";

it("GET /health returns healthy status", async () => {
  const t = await createTestApp({ config: { adapter: "native" } });
  try {
    const res = await t.request.get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok" });
  } finally {
    await t.close();
  }
});
```

```bash
npx vitest run test/health.test.ts
```

Expect the test to pass; removing or renaming the route should make it fail, and restoring it should pass again. The full-stack scaffold uses `/api/health`, so do not copy the API-only path there. This test uses the Native adapter. An application using another adapter must also verify its installed, actual adapter.

The helper is independent of Vitest and can be used with Node's test runner or Jest. Standalone cases below close resources; small API snippets assume an existing `t: TestApp` that is closed with `await t.close()` at the end of its test.

## `createTestApp()`

`createTestApp()` creates a test application, loads explicitly selected modules, and constructs an in-memory request handler. It returns `{ app, request, close }`: `t.app` is a VextApp, `t.request` sends requests, and `t.close()` releases resources. There is no `app.inject()`.

### Basic usage

```typescript
const t = await createTestApp({
  rootDir: process.cwd(), // Locates src/; does not load project config automatically
  config: { adapter: "native" },
});

try {
  const res = await t.request.get("/health");
  expect(res.status).toBe(200);
} finally {
  await t.close();
}
```

By default, routes and services under this root load; middleware also needs a configured allowlist. Locales load before initialization, and the helper awaits `onReady` before returning. Plugins, Services, locale scripts, and `app.fetch` can still contact external systems. No HTTP listening does not mean no I/O or side effects.

### Configuration options

```typescript
interface CreateTestAppOptions {
  /** Later-layer patch merged over framework and test defaults */
  config?: VextConfigOverride;

  /** Whether to load plug-ins in the src/plugins/ directory (default false) */
  plugins?: boolean;

  /** Custom plug-in setup function (replacing file system scanning) */
  setupPlugins?: (app: VextApp) => Promise<void> | void;

  /** Explicit development HTML error display; does not start frontend */
  devOverlay?: (error: unknown) => string;

  /** Whether to load services in the src/services/ directory (default true) */
  services?: boolean;

  /** Mock services (override same-name instances after automatic loading) */
  mockServices?: Partial<VextServices>;

  /** Whether to load routes in the src/routes/ directory (default true) */
  routes?: boolean;

  /** Whether to load middleware in the src/middlewares/ directory (default true) */
  middlewares?: boolean;

  /** Project root directory (default process.cwd()) */
  rootDir?: string;
}
```

`CreateTestAppOptions.config` is an override layer, not a standalone base
configuration. `VextConfigOverride` lets a test patch nested fields already
present in the framework/test defaults. Atomic adapters, stores, callbacks, and
arrays still have to be supplied as complete values.

`createTestApp()` does not load the project's `src/config/default.ts`. The built-in test defaults do not define `database`, so a test that adds that optional section must provide complete database configuration, including required connection `config`; a partial database section has no earlier layer to complete it. Even with complete config, this helper does **not** automatically run the built-in database plugin. Check real database behavior through the CLI path described below.

Dictionaries load before plugins, services, and routes. The default is `rootDir/src/locales`; set `config.locale.directory` for a custom directory using the normal startup resolver. Module subdirectories, JSON, and script dictionaries are supported; scripts execute. A missing directory gives an empty dictionary, while an invalid dictionary fails test application initialization. This step does not load project configuration files, execute a configuration provider, or automatically connect a database.

If `setupPlugins` is supplied, its callback replaces directory scanning even when `plugins: true`; both do not run. With `services: true` and `mockServices`, real Services are constructed before the mocks replace them, so constructor side effects have already happened. Use `services: false` to bypass real loading.

### Common configuration scenarios

#### Test defaults and log level

```typescript
const t = await createTestApp({
  config: {
    port: 0, // The helper does not listen; this does not open a random port
    logger: { level: "silent" },
  },
});
```

#### Skip plugin loading

```typescript
const t = await createTestApp({
  plugins: false, // Default: do not load src/plugins/
});
```

#### Simulation service

```typescript
const t = await createTestApp({
  services: false, // Avoid real service constructor side effects
  mockServices: {
    user: {
      findAll: async () => [{ id: "1", name: "Alice" }],
      findById: async (id: string) => ({ id, name: "Alice" }),
      create: async (data: any) => ({ id: "99", ...data }),
    },
  },
});
```

#### Custom plugin

```typescript
const t = await createTestApp({
  setupPlugins: async (app) => {
    //Inject mock objects for testing
    app.extend("testCache", new Map());
    app.extend("mailer", {
      send: async () => ({ messageId: "test-123" }),
    });
  },
});
```

These are option snippets; close every TestApp you create. `mockServices` only overrides service objects: it does not create routes, authentication, or a database. Supply every method the route actually uses. In a project with generated Service types, implement the public mock interface rather than hiding missing methods with `as any`.

## Send test request

The object returned by `createTestApp()` contains the `request` attribute and supports all HTTP methods:

```typescript
// Assume t was created by createTestApp(). Method availability does not imply a route exists.
// GET
const res1 = await t.request.get("/users");

// POST
const res2 = await t.request.post("/users");

// PUT
const res3 = await t.request.put("/users/1");

// PATCH
const res4 = await t.request.patch("/users/1");

// DELETE
const res5 = await t.request.delete("/users/1");

// OPTIONS
const res6 = await t.request.options("/users");

// HEAD
const res7 = await t.request.head("/users");
```

### Chained build requests

Each HTTP method returns a `TestRequestBuilder` for configuring the request. The request runs only when you `await` it or call `.then()`. Awaiting the same builder twice sends two requests; it does not reuse a response:

```typescript
const res = await t.request
  .post("/users")
  .set("Authorization", "Bearer test-token") // Set a single header
  .headers({
    // Set headers in batches
    "X-Custom": "value",
    "Accept-Language": "zh-CN",
  })
  .query({ page: "1", limit: "10" }) // Set query parameters
  .type("application/json") //Set Content-Type
  .send({ name: "Alice", email: "alice@example.com" }); // Set the request body
```

#### `.set(name, value)` — Set a single request header

```typescript
await t.request
  .get("/profile")
  .set("Authorization", "Bearer my-token")
  .set("Accept-Language", "en-US");
```

#### `.headers(obj)` — Set request headers in batches

```typescript
await t.request.get("/data").headers({
  Authorization: "Bearer token",
  "X-Request-Id": "test-req-001",
});
```

#### `.query(obj)` — Set URL query parameters

```typescript
await t.request
  .get("/search")
  .query({ keyword: "vext", page: "1", limit: "20" });
// Actual request URL: /search?keyword=vext&page=1&limit=20
// Calling query() again replaces the prior query object; it does not merge them.
```

#### `.send(body)` — Set the request body

```typescript
//Send JSON (default Content-Type: application/json)
await t.request
  .post("/users")
  .send({ name: "Alice", email: "alice@example.com" });

// send string
await t.request.post("/raw").type("text/plain").send("Hello World");
```

#### `.type(contentType)` — Set Content-Type

```typescript
await t.request
  .post("/upload")
  .type("application/x-www-form-urlencoded")
  .send("name=Alice&email=alice@example.com");
```

`.send()` passes a string through unchanged and JSON-stringifies other values. Setting Content-Type does not encode forms or multipart automatically. The builder has no file attachment, Cookie jar, or automatic redirect following. Verify binary, streaming, disconnect, and full upload behavior over real HTTP.

### `TestResponse` response object

A `TestResponse` object is returned after the request is completed:

```typescript
interface TestResponse {
  /** HTTP status code */
  status: number;

  /** Response headers (lowercase key, Set-Cookie may be string[]) */
  headers: Record<string, string | string[]>;

  /** Set-Cookie response headers */
  cookies: string[];

  /** Read the first value of a response header */
  header(name: string): string | undefined;

  /** Read all values of a response header */
  headerValues(name: string): string[];

  /** Parsed response body (JSON is automatically parsed into an object) */
  body: any; // Parsed only when Content-Type includes application/json or +json

  /** Original response body text */
  text: string;
}
```

```typescript
// With the /items fixture below, these assertions match a real response.
const res = await t.request.get("/items");

// Assert status code
expect(res.status).toBe(200);

// Assert response body (JSON automatically parsed)
expect(res.body).toEqual({
  code: 0,
  data: { items: [{ id: "1", name: "initial" }] },
  requestId: expect.any(String),
});

// Assert response header
expect(res.header("content-type")).toContain("application/json");
expect(res.headers["x-request-id"]).toBeDefined();
expect(res.headerValues("set-cookie")).toEqual(res.cookies);

// Assert the original text
expect(res.text).toContain('"code":0');
```

Read multiple Set-Cookie values with `cookies` or `headerValues()`; do not split on commas. Set the `Cookie` header manually for the next request. HEAD has an empty `text`, so it cannot be asserted to have the same body as GET.

## Test mode features

The application created by `createTestApp()` is in test mode (`_testMode: true`), which has the following differences from production mode:

| Features         | Test Mode           | Production Mode             |
| ---------------- | ------------------- | --------------------------- |
| HTTP Listening   | ❌ Not Starting     | ✅ Listening Port           |
| `process.exit()` | ❌ Not called       | ✅ Called on shutdown       |
| Log level        | Default `silent`    | Determined by configuration |
| Rate limiting    | Disabled by default | Determined by configuration |
| Shutdown timeout | Default 1 second    | Determined by configuration |

The helper forces `_testMode: true` and does not register production signal or fatal-error handlers. Test defaults disable access logs, and rate limiting must be enabled explicitly to exercise a 429 path. Its config merge differs from CLI file loading, provider, validation, and preload, so passing a helper test does not prove production config works.

## Practical example

### Prepare isolated routes and services

These independent fixtures live under `test/fixtures/http/src/` and do not mix with application routes. Service data is in memory per instance. The token is test input, not a production authentication design.

```typescript
// test/fixtures/http/src/services/item.ts
export interface Item {
  id: string;
  name: string;
}

export default class ItemService {
  private items = new Map<string, Item>([["1", { id: "1", name: "initial" }]]);
  private nextId = 2;

  list() {
    return [...this.items.values()];
  }

  find(id: string) {
    return this.items.get(id) ?? null;
  }

  create(name: string) {
    const item = { id: String(this.nextId++), name };
    this.items.set(item.id, item);
    return item;
  }

  remove(id: string) {
    return this.items.delete(id);
  }
}
```

```typescript
// test/fixtures/http/src/middlewares/token.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  if (req.headers.authorization !== "Bearer test-token") {
    req.app.throw(401, "token_required");
  }
  await next();
});
```

```typescript
// test/fixtures/http/src/routes/items.ts
import { defineRoutes } from "vextjs";
import type ItemService from "../services/item.js";

export default defineRoutes((app) => {
  const service: Pick<ItemService, "list" | "find" | "create" | "remove"> =
    app.services.item;

  app.get("/", async (_req, res) => {
    res.json({ items: service.list() });
  });

  app.get("/:id", async (req, res) => {
    const item = service.find(req.params.id!);
    if (!item) app.throw(404, "item_not_found");
    res.json(item);
  });

  app.post(
    "/",
    { middlewares: ["token"], validate: { body: { name: "string!" } } },
    async (req, res) => {
      res.json(service.create(req.valid("body").name), 201);
    },
  );

  app.delete("/:id", { middlewares: ["token"] }, async (req, res) => {
    if (!service.remove(req.params.id!)) app.throw(404, "item_not_found");
    res.status(204).json(null);
  });
});
```

The filename prefix gives `/items` and `/items/:id`. Configure the middleware allowlist below: creating `token.ts` alone does not enable it. A real application's Service types should normally be generated by typegen; this fixture explicitly constrains the four methods used by its route.

### Test CRUD routes, middleware, and errors

```typescript
// test/http.test.ts
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestApp, type TestApp } from "vextjs/testing";

const rootDir = fileURLToPath(new URL("./fixtures/http/", import.meta.url));
let t: TestApp | undefined;

beforeEach(async () => {
  t = await createTestApp({
    rootDir,
    config: { adapter: "native", middlewares: ["token"] },
  });
});
afterEach(async () => {
  await t?.close();
  t = undefined;
});

it("creates, reads, and deletes an item, then returns 404", async () => {
  const created = await t!.request
    .post("/items")
    .set("Authorization", "Bearer test-token")
    .send({ name: "book" });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({
    id: expect.any(String),
    name: "book",
  });
  const id = created.body.data.id;

  const found = await t!.request.get("/items/" + id);
  expect(found.status).toBe(200);
  expect(found.body.data.name).toBe("book");

  const removed = await t!.request
    .delete("/items/" + id)
    .set("Authorization", "Bearer test-token");
  expect(removed.status).toBe(204);
  expect(removed.text).toBe("");
  expect((await t!.request.get("/items/" + id)).status).toBe(404);
});

it("returns 401 for a missing or incorrect token", async () => {
  const absent = await t!.request.post("/items").send({ name: "book" });
  expect(absent.status).toBe(401);
  const wrong = await t!.request
    .post("/items")
    .set("Authorization", "Bearer wrong")
    .send({ name: "book" });
  expect(wrong.status).toBe(401);
});

it("returns 422 for a missing required field with a valid token", async () => {
  const res = await t!.request
    .post("/items")
    .set("Authorization", "Bearer test-token")
    .send({});
  expect(res.status).toBe(422);
  expect(res.body.code).toBe(422);
  expect(res.body.errors).toBeInstanceOf(Array);
});

it("propagates request ID, response shape, and JSON header", async () => {
  const res = await t!.request.get("/items").set("X-Request-Id", "test-list-1");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    code: 0,
    data: { items: [{ id: "1", name: "initial" }] },
    requestId: "test-list-1",
  });
  expect(res.header("content-type")).toContain("application/json");
});

it("returns 404 with requestId for an unknown route", async () => {
  const res = await t!.request.get("/missing");
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({
    code: 404,
    message: expect.any(String),
    requestId: expect.any(String),
  });
});
```

```bash
npx vitest run test/http.test.ts
```

Expect five passing cases. Each gets a fresh Service instance, so the delete case does not pollute later lists. `afterEach` closes every successfully created TestApp. The 401 assertions send valid bodies, while the 422 assertion sends a valid token; this isolates the intended rejection instead of mistaking an earlier rejection for coverage.

### Test with mock services

Reuse the fixture above, replacing only its Service in a separate test file:

```typescript
// test/http-mock.test.ts
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { createTestApp } from "vextjs/testing";
import ItemService from "./fixtures/http/src/services/item.js";

it("routes to the supplied mock and keeps 404 semantics", async () => {
  const mock = {
    list: vi.fn(() => [{ id: "mock-1", name: "mock" }]),
    find: vi.fn(() => null),
    create: vi.fn((name: string) => ({ id: "mock-2", name })),
    remove: vi.fn(() => false),
  } satisfies Pick<ItemService, "list" | "find" | "create" | "remove">;
  const t = await createTestApp({
    rootDir: fileURLToPath(new URL("./fixtures/http/", import.meta.url)),
    services: false,
    mockServices: { item: mock },
    config: { adapter: "native", middlewares: ["token"] },
  });
  try {
    const list = await t.request.get("/items");
    expect(list.body.data.items[0].id).toBe("mock-1");
    expect(mock.list).toHaveBeenCalledOnce();

    const missing = await t.request.get("/items/999");
    expect(missing.status).toBe(404);
    expect(mock.find).toHaveBeenCalledWith("999");
  } finally {
    await t.close();
  }
});
```

Use real `app.throw(...)` or public `HttpError` for business errors. Error normalization may also read a valid `status` or `statusCode` on an ordinary Error, but that object lacks HttpError type, name, and business-code contracts; an error without a valid HTTP status defaults to 500. A passing mock test checks the route-to-mock contract, not the real database or Service implementation.

### Unit-test the service layer

This fixture's Service has no app dependency and can be instantiated directly:

```typescript
// test/item.test.ts
import { expect, it } from "vitest";
import ItemService from "./fixtures/http/src/services/item.js";

it("keeps data separate for each Service instance", () => {
  const first = new ItemService();
  const second = new ItemService();
  const item = first.create("book");
  expect(first.find(item.id)).toEqual(item);
  expect(second.find(item.id)).toBeNull();
  expect(first.remove(item.id)).toBe(true);
  expect(first.find(item.id)).toBeNull();
});
```

For a business Service that depends on `VextApp`, obtain a real base app from a TestApp with scanning disabled or provide a typed mock for its actual dependencies. Do not use `as any` to conceal missing app capabilities.

## Project configuration

### TypeScript service files and ESM loading

With `services: true`, the helper scans `rootDir/src/services/`. The shared module loader compiles TypeScript before import, handling type stripping and local `.js` imports pointing to `.ts` sources. npm dependencies still resolve from the project. The project must permit temporary compiled outputs to be created and cleaned up; a missing dependency or a default export that cannot be constructed fails initialization.

This does not mean every Node/Vite version cannot load TS, nor does it guarantee compatibility with dynamically assembled paths or all third-party loaders. For route-only contracts, `services: false` with `mockServices` bypasses Service loading. Keep the real chain when checking construction, cross-Service dependencies, or production artifacts.

### Vitest configuration

When multiple test files use overlapping `rootDir` paths, module loading contends for the same project owner. Add this `vitest.config.ts` before running all examples to keep those files serial. Restore parallelism only for genuinely separate fixtures with nonoverlapping roots:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/types/**"],
    },
  },
});
```

Coverage needs a compatible `@vitest/coverage-v8`; see [official coverage guidance](https://vitest.dev/guide/coverage.html). Vitest normally transforms code rather than type-checking the full project. Run type checking separately and include `test/` in its dedicated tsconfig. For modules compiled through the additional filesystem loader, check whether coverage paths map back to sources instead of trusting only an aggregate percentage.

### Test directory structure

A suggested layout is:

```text
test/
├── unit/                    # Unit tests
│   ├── services/
│   │   ├── user.test.ts
│   │   └── order.test.ts
│   ├── middlewares/
│   │   └── auth.test.ts
│   └── lib/
│       └── config-loader.test.ts
│
├── integration/             # Integration tests
│   ├── routes/
│   │   ├── users.test.ts
│   │   └── orders.test.ts
│   └── plugins/
│       └── redis.test.ts
│
└── e2e/                     # End-to-end tests
    └── api.test.ts
```

### package.json scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run test/unit",
    "test:int": "vitest run test/integration",
    "test:e2e": "vitest run test/e2e",
    "test:cov": "vitest run --coverage"
  }
}
```

## Best Practices

### 1. Choose a level for the subject under test

| Goal                                            | Approach                                                  | Does not prove                                                   |
| ----------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| Pure Service algorithms and state               | Instantiate directly with isolated data                   | HTTP and config loading work                                     |
| Routes, validation, errors, middleware          | createTestApp with explicit fixture/mocks                 | Production startup, external dependencies, and network path work |
| Real Services with plugins                      | Explicitly load them in the helper with real dependencies | CLI config provider, preload, and built-in DB ran                |
| dev/build/start, database, uploads/streams, SSR | Real CLI plus TCP/browser or deployment environment       | Every business scenario is covered                               |

### 2. Close resources and isolate state

Test logs are silent by default. A read-only suite can create an app in `beforeAll` and close it in `afterAll`. For mutable state, prefer `beforeEach`/`afterEach` or a fresh mock per test so results do not depend on order. Each TestApp's `onClose` hooks release its resources; the default timeout is one second, so explicitly adjust it for longer cleanup.

Do not share an app, Store, or database collection with mutable data across concurrent tests. Loads from the same or overlapping `rootDir` also share a project owner and may report `VEXT_OWNER_BUSY`; serialize as above or use truly separate project roots. Pass Cookies manually per test session. External databases, Redis, pools, and background Jobs are not isolated automatically by `_testMode`.

### 3. Verify the intended branch and side effect

Check response shape, headers, mock arguments, and important side effects as well as status. Negative inputs should pass earlier authentication or validation before reaching the target branch. For example, an invalid body without a token does not prove Schema validation ran. Check the intended error instead of merely asserting that some error occurred; a load failure or 500 is not the expected business result.

### 4. Complete production-path checks with the real CLI

From the business project root, start the real service:

```bash
npx vextjs dev --port 3000
```

From another terminal, request actual business URLs and check success, invalid input, unauthenticated access, dependency failure, and recovery. Stop dev, then:

```bash
npx vextjs build --typecheck
npx vextjs start --port 3000
```

Repeat business requests and inspect the config profile, dependency connections, and logs. A JavaScript API-only project does not need a backend build; follow [Build](/guide/build) for its path. The `test/fixtures` above are only for the helper and do not automatically become the CLI project's `src`.

For external MongoDB integration, prepare an isolated database and verification profile using [Database](/guide/database). Check frontend SSR, hydration, and refresh using [Frontend Overview](/frontend/overview). Stop services you started for testing and clean up data you created; preserve existing user services and data of unknown ownership.

## Testing Jobs

`vextjs/testing` also exports `createTestJobRunner()`. Supply Job definitions, call `run()`, and `close()` in a finally block or teardown. This alone does not verify a separate scheduler or Worker's persistence, claiming, heartbeat, or cross-process scheduling. See [Jobs API](/api/jobs) for the complete example and boundaries.

## Next step

- Learn how [routing](/guide/routing) defines a testable API
- Learn the unit testing pattern of [Service Layer](/guide/services)
- See [CLI Commands](/guide/cli) to learn about `dev` / `build` / `start` and other running commands
- Explore testing tips for [middleware](/guide/middleware)

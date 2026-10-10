# Adapter architecture

VextJS uses an Adapter architecture to replace the underlying HTTP processing layer. Routes and services written against VextJS `req` / `res` can generally retain their interfaces; framework-specific middleware, plugins, and features still require an integration check. This page first verifies installation, configuration, startup, and switching, then explains the custom Adapter interface.

## Working principle

```
User code (routing/middleware/service)
        ↕ VextRequest / VextResponse (framework unified interface)
    Adapter layer (Adapter)
        ↕ Underlying framework native objects
  HTTP Server (Node.js)
```

Adapter is responsible for:

1. **Start HTTP service** — Use the underlying framework to create a server and listen on the port
2. **Request Conversion** — Convert the native request object of the underlying framework into `VextRequest`
3. **Response conversion** — Map the operations of `VextResponse` to the response object of the underlying framework
4. **Route Registration** — Register the routes collected by the framework to the underlying routing system
5. **Middleware execution** — Collect global middleware and compose the route execution chain under VextJS conventions

## Built-in Adapter

VextJS has 5 built-in Adapters, covering the mainstream Node.js HTTP framework:

| Adapter              | Underlying implementation                  | Current project peer range          | Install separately                      |
| -------------------- | ------------------------------------------ | ----------------------------------- | --------------------------------------- |
| **Native** (default) | Node.js HTTP + `route-core`                | No additional HTTP framework peer   | None; `route-core` installs with VextJS |
| **Hono**             | Hono routing with a Node.js request bridge | `hono ^4.0.0`                       | `hono`                                  |
| **Fastify**          | Fastify routing and HTTP service           | `fastify ^5.0.0`                    | `fastify`                               |
| **Express**          | Express routing and Node.js HTTP           | `express ^5.0.0`                    | `express`                               |
| **Koa**              | Koa + `@koa/router`                        | `koa ^3.0.0`, `@koa/router ^15.6.0` | `koa @koa/router`                       |

These ranges come from the current VextJS package declaration; use the installed version's peer requirements when upgrading. Selecting an Adapter does not automatically expose that framework's native plugin registration API.

### Performance comparison

This page does not keep a separate numeric snapshot. The public benchmark uses the same lightweight Vext Normal application and changes only the five supported Adapters. It compares Vext Adapter integration paths; it does not measure each underlying framework's independent Raw performance or Vext overhead percentages against Raw baselines.

See [Performance benchmarks](/benchmark) for the retained results, methodology, limitations, and reproduction commands. The public sample is from 2026-08-15 at a specified Vext 1.0.1 commit; it is not a performance baseline for the current 2.0.0 source. After choosing an adapter, validate it with your real middleware, authentication, logging, and I/O workload.

## How to use

### Verify one route first

Prerequisites: prepare Node.js, ESM package.json, TypeScript configuration, and dev/build/start scripts using [Quick Start's manual setup](/guide/quick-start#method-2-manual-creation). This API-only example needs no database or external service. Merge configuration into an existing project and avoid a route filename collision.

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
// src/routes/adapter-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", {}, async (req, res) => {
    res.json({ id: req.params.id, adapter: req.app.adapter.name });
  });
  app.post(
    "/",
    { validate: { body: { name: "string!" } } },
    async (req, res) => {
      const { name } = req.valid<{ name: string }>("body");
      res.json({ name, adapter: req.app.adapter.name }, 201);
    },
  );
});
```

The filename contributes `/adapter-demo`; use only `/:id` and `/` inside to avoid duplicating that prefix. Run `npm run dev`, then from another terminal (use `curl.exe` in PowerShell):

```bash
curl -i http://127.0.0.1:3000/adapter-demo/u-1
curl -i -X POST http://127.0.0.1:3000/adapter-demo -H 'Content-Type: application/json' --data '{"name":"Alice"}'
curl -i -X POST http://127.0.0.1:3000/adapter-demo -H 'Content-Type: application/json' --data '{}'
curl -i http://127.0.0.1:3000/adapter-demo-missing
```

Expect 200 with `data: { "id": "u-1", "adapter": "native" }`, then 201 with `data.name: "Alice"`, then a 422 validation error, then 404. Successful responses also have `code: 0` and `requestId` by default. Stop dev with Ctrl+C; run `npm run build` and `npm start`, repeat all four requests against production output, then stop the service to release the port. Configuration fragments below show Adapter options only; merge them with your other fields.

### Native Adapter (default)

No additional dependencies need to be installed, and no explicit configuration is required - the default is Native Adapter:

```typescript
// src/config/default.ts
export default {
  port: 3000,
  // adapter defaults to 'native', no need to specify
};
```

For explicit declaration:

```typescript
import { nativeAdapter } from "vextjs/adapters/native";

export default {
  adapter: nativeAdapter(),
  port: 3000,
};
```

The Native adapter uses Node.js `http.createServer` with `route-core`. It is the default path and has no third-party HTTP framework dependency. Performance varies by workload, so use the current benchmark and your application tests when making a decision.

### Hono Adapter

```bash
npm install hono
```

**Recommended method (string identification):**

```typescript
// src/config/default.ts
export default {
  adapter: "hono",
  port: 3000,
};
```

**Advanced usage (factory function):**

```typescript
// src/config/default.ts
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

Hono is an ultra-lightweight web framework based on the Web Standards API (`Request` / `Response`). The current built-in Hono Adapter is a Node.js HTTP server adapter. It depends only on `hono`; Vext owns the `node:http` request/response bridge used to expose Hono routing inside a Node.js service. `@hono/node-server` is not a runtime dependency of this adapter.

This does not represent official Edge / Serverless adapter support. Cloudflare Workers, Deno Deploy, Bun edge, and other non-Node.js runtimes require a dedicated Edge / Serverless adapter or ecosystem plugin. Do not treat the current `vextjs/adapters/hono` package as an Edge runtime guarantee.

### Fastify Adapter

```bash
npm install fastify
```

**Recommended method (string identification):**

```typescript
// src/config/default.ts
export default {
  adapter: "fastify",
  port: 3000,
};
```

**Advanced usage (factory function, options can be passed in):**

```typescript
// src/config/default.ts
import { fastifyAdapter } from "vextjs/adapters/fastify";

export default {
  adapter: fastifyAdapter(),
  port: 3000,
};
```

VextJS uses Fastify to host routes and the HTTP server, while Vext's own pipeline handles validation and JSON serialization. `res.json()` is serialized by Vext before sending; selecting Fastify does not automatically adopt Fastify route schemas or plugins. To set supported options, use a factory such as `fastifyAdapter({ caseSensitive: true })`; it accepts `FastifyAdapterOptions`, not arbitrary Fastify configuration.

### Express Adapter

```bash
npm install express
```

**Recommended method (string identification):**

```typescript
// src/config/default.ts
export default {
  adapter: "express",
  port: 3000,
};
```

**Advanced usage (factory function, options can be passed in):**

```typescript
// src/config/default.ts
import { expressAdapter } from "vextjs/adapters/express";

export default {
  adapter: expressAdapter(),
  port: 3000,
};
```

The current implementation uses Express v5. Business logic independent of HTTP objects can be reused in a migration; native Express routes and `(req, res, next)` middleware need adaptation to Vext interfaces. `ExpressAdapterOptions` exposes a string `bodyLimit`, not an entire Express application instance.

:::tip Express v5
An existing Express v4 dependency does not satisfy this Adapter's peer range. Check the application's dependencies and migration impact before installing a compatible version; changing only the `adapter` string does not complete a migration.
:::

### Koa Adapter

```bash
npm install koa @koa/router
```

**Recommended method (string identification):**

```typescript
// src/config/default.ts
export default {
  adapter: "koa",
  port: 3000,
};
```

**Advanced usage (factory function, options can be passed in):**

```typescript
// src/config/default.ts
import { koaAdapter } from "vextjs/adapters/koa";

export default {
  adapter: koaAdapter(),
  port: 3000,
};
```

The current implementation uses Koa v3 with `@koa/router` for route matching; install both packages. `KoaAdapterOptions` exposes a string `bodyLimit`. Vext middleware receives the unified request/response objects, not Koa `ctx`.

## Switch Adapter

Stop the current service, install the target peer dependency (`npm install hono` for Hono), then update `src/config/default.ts`:

```diff
// Switch from Native to Hono
  export default {
-   adapter: "native",
+   adapter: "hono",
    port: 3000,
  };
```

Run `npm run dev` and the four requests above again: successful responses should now have `data.adapter: "hono"`, with status, parameters, and validation results otherwise matching. Stop dev, rebuild, start production, and repeat so production cannot keep old output. Install other Adapters from the peer table and use the same checks.

Handlers and services based on `VextRequest` / `VextResponse` can generally be reused. Also test your application's case sensitivity, trailing slashes, query parameters, uploads, streams, cancellation, and errors. Four introductory requests do not prove a complete business migration.

## How to choose Adapter

### Select Native (recommended by default)

- Start with the framework's default path
- Do not require capabilities from another HTTP framework
- Build a new project without adapter migration constraints
- Keep additional dependencies to a minimum

### Select Hono

- Your team knows Hono and wants its routing with the Web Request/Response bridge
- The deployment target is a supported Node.js environment
- Required behavior is available through Vext's public interface; native Hono middleware needs separate adaptation

### Select Fastify

- You need Fastify routing or options actually exposed by this Adapter
- Your team has Fastify operations and debugging experience
- You have validated the business workload; native Fastify plugins and automatic serialization do not arrive merely by switching

### Select Express

- Migrate existing Express projects to VextJS
- You can adapt native HTTP middleware to Vext middleware
- The team is most familiar with Express

### Select Koa

- Your team knows Koa and `@koa/router`
- You can install both peers and have checked route matching
- You have an adaptation plan for native Koa middleware you need

## VextAdapter interface

All Adapters implement the unified `VextAdapter` interface:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  VextAdapter as PublicAdapter,
  VextMiddleware,
  VextErrorMiddleware,
  VextServerHandle,
  RouteOptions,
} from "vextjs";

// Derive listen options from the public interface, not an internal path.
type VextAdapterListenOptions = Parameters<PublicAdapter["listen"]>[2];

interface VextAdapter {
  /** Adapter name */
  readonly name: string;

  /** Register global middleware */
  registerMiddleware(middleware: VextMiddleware): void;

  /** Register route */
  registerRoute(
    method: string,
    path: string,
    chain: VextMiddleware[],
    options?: RouteOptions,
  ): void;

  /** Register error handler */
  registerErrorHandler(handler: VextErrorMiddleware): void;

  /** Register 404 handler */
  registerNotFound(handler: VextMiddleware): void;

  /** Start listening */
  listen(
    port: number,
    host?: string,
    options?: VextAdapterListenOptions,
  ): Promise<VextServerHandle>;

  /** Build a Node.js request handler without starting a server */
  buildHandler(): (req: IncomingMessage, res: ServerResponse) => void;
}
```

OpenAPI / Docs routes are registered by the framework through `registerRoute()`. Adapters no longer expose a separate `registerOpenAPIRoutes()` method.

### Custom Adapter

Configuration accepts a built-in name, a synchronous factory `(app: VextApp) => VextAdapter`, or an already constructed Adapter. The factory receives the current app during initialization. The resolver checks name and required method presence; it does not prove correct middleware, error, or shutdown behavior.

If you only need to add behavior around an existing implementation, compose a built-in Adapter first. This runnable delegate preserves Native behavior while adding a name; it does not implement a different HTTP framework:

```typescript
// src/adapters/custom.ts
import { nativeAdapter } from "vextjs/adapters/native";
import type { VextAdapter, VextApp } from "vextjs";

export function myCustomAdapter(): (app: VextApp) => VextAdapter {
  return (app) => {
    const base = nativeAdapter()(app);
    return {
      name: "my-custom",
      registerMiddleware: (middleware) => base.registerMiddleware(middleware),
      registerRoute: (method, path, chain, options) =>
        base.registerRoute(method, path, chain, options),
      registerErrorHandler: (handler) => base.registerErrorHandler(handler),
      registerNotFound: (handler) => base.registerNotFound(handler),
      buildHandler: () => base.buildHandler(),
      listen: (port, host, options) => base.listen(port, host, options),
    };
  };
}
```

Replace only the existing adapter field in configuration, preserving other settings:

```typescript
// src/config/default.ts
import { myCustomAdapter } from "../adapters/custom.js";

export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: myCustomAdapter(),
  frontend: { enabled: false },
};
```

Repeat the dev/build/start and four requests above. Successful responses should report `data.adapter: "my-custom"`. To integrate a genuinely different HTTP implementation, implement these contracts rather than leaving registration empty or returning 501 for every request:

- Convert input to `VextRequest`, including route templates, params, raw body reads, and lifecycle signals; map output to the required `VextResponse`.
- Preserve global and route-chain ordering, the return path of `await next()`, error/404 handling, and supplied `RouteOptions`.
- `buildHandler()` returns a Node.js request handler without listening, for dev handler replacement. `listen()` handles listen failures and server options and returns the actual port and an awaitable `close()`.
- Verify normal/error/validation responses, headers and Cookies, uploads, streams, disconnects, and shutdown over real HTTP. Test both development and production startup. Framework-installed frontend rendering cannot be assumed complete from the interface shape alone.

## Request/response conversion

Business code should use the unified interfaces with any Adapter. The following is a member summary, omitting full generics and internal response hooks; see [Request and Response](/api/context) for precise public signatures and behavior. Do not copy this summary as a complete custom Adapter implementation.

### VextRequest (unified request object)

```typescript
import type {
  VextApp,
  VextAuthContext,
  VextCookieJar,
  VextSession,
  ParsedFile,
} from "vextjs";

interface VextRequest {
  method: string; // HTTP method
  url: string; // Original request URL, usually a relative path with query string
  path: string; // Path part
  route: string; // Matched route template, empty string for 404
  query: Record<string, string>; // Query parameters
  body: unknown; // Request body
  params: Record<string, string>; // Path parameters
  headers: Record<string, string | undefined>; // Lowercase request headers
  cookies: VextCookieJar; // Parsed cookies
  cookie(name: string): string | undefined; // Read one cookie
  csrfToken(): string; // Available after CSRF middleware is active
  auth: VextAuthContext; // Authentication context
  requestId: string; // Filled by requestId middleware; may be empty if disabled
  signal: AbortSignal; // Cancelled on request timeout or early disconnect
  ip: string; // Client IP
  protocol: "http" | "https"; // Protocol
  app: VextApp; // Application instance
  valid<T>(location: "query" | "body" | "param" | "header" | "cookie"): T;
  onClose(handler: () => void): void; // Cleanup on normal completion or early disconnect
  files?: ParsedFile[]; // Filled by built-in multipart or a custom upload plugin
  session?: VextSession; // Available when Session is enabled
  _getRawBody(maxBytes?: number): Promise<string>; // Raw request body text
  _getRawBodyBuffer(maxBytes?: number): Promise<Buffer>; // Raw request body bytes
}
```

`_getRawBody()` / `_getRawBodyBuffer()` are injected by adapters and primarily used by framework middleware and plugins such as multipart parsers. Application handlers should usually use `req.body`, `req.files`, and `req.valid()`.

### VextResponse (unified response object)

```typescript
import type {
  CookieSerializeOptions,
  VextHeaderValue,
  VextRenderErrorOptions,
  VextRenderOptions,
} from "vextjs";

interface VextResponse {
  json(data: unknown, status?: number): void; // JSON response
  text(content: string, status?: number): void; // Text response
  render(
    page: string,
    props?: Record<string, unknown>,
    options?: VextRenderOptions,
  ): void; // Render a frontend page
  renderError(
    errorOrStatus?: Error | number | string,
    pageOrOptions?: string | VextRenderErrorOptions,
    options?: VextRenderErrorOptions,
  ): void; // Render an error page
  stream(readable: NodeJS.ReadableStream, type?: string): void; // Node.js streaming response
  download(
    readable: NodeJS.ReadableStream,
    filename: string,
    type?: string,
  ): void; // File download
  redirect(url: string, status?: 301 | 302 | 307 | 308): void; // Redirect
  status(code: number): this; // Set status code
  setHeader(name: string, value: VextHeaderValue): this; // Set response header
  cookie(name: string, value: string, options?: CookieSerializeOptions): this; // Append Set-Cookie
  clearCookie(name: string, options?: CookieSerializeOptions): this; // Clear cookie
  readonly statusCode: number; // Current status code
}
```

`stream()` / `download()` accept Node.js `Readable` / `NodeJS.ReadableStream`, not Web `ReadableStream`. `rawJson()` and underscore-prefixed response methods are framework internals; application code should use the public methods visible through `VextPublicResponse`.

This design means:

- Public interfaces give routes and middleware a reuse boundary.
- Every Adapter must implement the framework's request, response, and middleware contracts; native framework objects are outside that contract.
- Pure business unit tests may be reusable, while HTTP integration tests should run against the actual selected Adapter.

## Switch Adapter according to environment

The configuration loader allows environment overrides. Use separate Adapters only when needed and verified in both environments; using the same one in development and production usually makes failures easier to reproduce. This example only shows the override mechanism; install Hono first:

```typescript
// src/config/default.ts — Use Native by default
export default {
  port: 3000,
  // adapter default native
};
```

```typescript
// src/config/development.ts — Hono in development
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
};
```

```typescript
// src/config/production.ts — Keep the default Native adapter in production
export default {
  // Do not set adapter, inherit the default native of default.ts
};
```

## FAQ

### Do I need to modify the code after switching the Adapter?

Code using only public interfaces can generally be reused. Code reading native objects or relying on framework-specific plugins or route behavior needs adaptation and regression testing against the target Adapter. There is no guarantee that all business code is unchanged.

### Can Adapter be switched dynamically at runtime?

Can't. Adapter is determined by configuration at startup and cannot be switched during runtime. If you need to use different Adapters depending on the environment, please use the configuration file override mechanism (such as `development.ts` / `production.ts`).

### Where does the performance difference mainly come from?

Performance differences come from each framework's HTTP parsing, routing, and serialization and Vext's Adapter integration path. The public historical sample compares Adapters under the same Vext Normal workload and provides no overhead percentages against individual Raw baselines. Leading one scenario does not imply leading every scenario. Review the version and methodology in [Performance benchmarks](/benchmark), then test your actual middleware and I/O workload.

### Can the native middleware of the underlying framework be used?

Do not pass native middleware directly as Vext middleware. `defineMiddleware` / `defineMiddlewareFactory` use unified request, response, and next contracts with different signatures and lifecycles. Logic independent of native HTTP objects can be wrapped in Vext middleware or a plugin. Extensions depending on native instances need a bridge or custom Adapter; a thin function wrapper alone does not prove compatibility.

### What should I do if peer dependencies report a warning?

Optional means you do not need peers for Adapters you do not select. The selected Adapter needs compatible peers: Hono needs `hono`, and Koa needs both `koa` and `@koa/router`. Distinguish an unused optional package from a missing selected peer or incompatible version rather than ignoring all installation warnings.

The current Hono Adapter is a Node.js runtime capability: it receives requests through a Node.js HTTP server and bridges them into Hono's Web `Request` / `Response` flow. Edge / Serverless runtimes should not use these Node adapter installation instructions as a support claim.

### How do I diagnose startup or switching failures?

| Symptom                              | Check and fix                                                                                                    | Recheck                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Unknown adapter                      | Use a lowercase built-in name from the table, or a synchronous factory/complete object                           | Restart and inspect adapter name in a successful response |
| Requires package                     | Install the selected peer from the application's package.json directory; check both Koa packages                 | Run `npm ls` for the peer, then start                     |
| Incompatible or failed while loading | Inspect the original cause, peer range, and package entry; loading failure may also be an Adapter internal error | Fix the specific cause instead of only reinstalling       |
| Custom Adapter missing a member      | Provide name and six required methods from `VextAdapter`                                                         | Type check and exercise dev/production HTTP               |
| Response still shows old name        | Check environment override, working directory, and old process; rebuild/start                                    | Recheck four requests and actual port                     |
| EADDRINUSE                           | Stop the instance you started earlier or change port and request URL                                             | Confirm the new instance listens before retrying          |

## Cluster source IP affinity and custom adapters

All five built-in adapters share a Node HTTP receiver for `cluster.sticky: "ip"`, retaining their routing, request, and shutdown lifecycles. Fastify uses its official `serverFactory` and continues through ready/listen/close.

The public `VextAdapterFactory` type is `(app, context?: VextAdapterRuntimeContext) => VextAdapter`. The second argument is per-instance runtime context. Only an actual Cluster Worker with affinity enabled receives `context.socketHandoff`; its host/port describe Master's bound public endpoint. A custom factory must not change runtime mode solely because the project config contains sticky.

Custom adapters keep their original required interface by default. To support this mode, declare `supportsSocketHandoff: true`, consume the factory context, and return a `VextServerHandle` with `receiveSocket(socket)` and synchronous `forceClose()` from `listen()`. The Worker binds neither a public nor a private TCP port in this mode. receiveSocket accepts a committed, paused socket, registers ownership, and then resumes reading. close waits for in-flight connections; forceClose releases every owned socket, including upgrades, within the framework's absolute shutdown deadline. Missing capability fails before listening; claiming support without returning the controls fails startup.

Existing one-argument factories remain valid in ordinary mode. Wrappers around built-in factories must forward context, for example `(app, context) => nativeAdapter()(app, context)`. Injecting `buildHandler()` into an unlistened server does not by itself provide Node timeout, connection-counting, and shutdown contracts.

## Next step

- Understand the Adapter-related configuration items in [Configuration](/guide/configuration)
- View the performance of [OpenAPI Documentation](/guide/openapi) under different Adapters
- Explore the cooperation between [Cluster multi-process](/guide/cluster) and Adapter
- Read benchmark data related to [Performance Benchmark](/benchmark)

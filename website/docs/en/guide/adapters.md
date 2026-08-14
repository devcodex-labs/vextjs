# Adapter architecture

One of the core designs of VextJS is the Adapter architecture - the underlying HTTP processing layer is completely replaceable. Your business code (routing, middleware, services, plug-ins) operates on the `req` / `res` objects encapsulated by VextJS, rather than the native objects of the underlying framework. Switching the Adapter only requires modifying one line of configuration, with **zero changes to the business code**.

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
5. **Middleware Registration** — Register global middleware to the underlying framework

## Built-in Adapter

VextJS has 5 built-in Adapters, covering the mainstream Node.js HTTP framework:

| Adapter              | Underlying framework               | Features                                                       | Applicable scenarios            | Additional dependencies |
| -------------------- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------- | ----------------------- |
| **Native** (default) | `http.createServer` + `route-core` | Zero external HTTP framework dependencies, highest performance | Pursuing ultimate performance   | None                    |
| **Hono**             | Hono                               | Web Standards API, lightweight                                 | Node.js full-stack HTTP service | `hono`                  |
| **Fastify**          | Fastify                            | Rich ecology, JSON serialization optimization                  | Large-scale projects            | `fastify`               |
| **Express**          | Express v5                         | The largest middleware ecosystem                               | Migration project               | `express`               |
| **Koa**              | Koa v3                             | Lightweight and elegant                                        | Small and medium-sized projects | `koa`                   |

### Performance comparison

Historical benchmark snapshot (JSON response scenario, median of 5 rounds):

| Adapter | Raw RPS | Vext RPS | Framework overhead |
| ------- | ------: | -------: | -----------------: |
| Native  |  44,932 |   36,819 |              18.1% |
| Express |  29,868 |   30,974 |              -3.7% |
| Fastify |  45,619 |   29,203 |              36.0% |
| Koa     |  31,833 |   22,488 |              29.4% |
| Hono    |  20,703 |   15,684 |              24.2% |

> Vext overhead includes: body parser, response wrapper, request/response abstraction, AsyncLocalStorage context, middleware chain executor, etc. **complete functions**.
>
> **Test environment**: Node.js v24.14.0 / Windows x64 / Intel i7-9700 / autocannon (50 connections, 10 pipelining, 10s × 5 rounds median, 2026-03-23). The actual reproduction test of the current version is subject to the benchmark in the warehouse, and distinguishes between `chain` and `middleware-chain`.

## How to use

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

Native Adapter uses Node.js native `http.createServer` to process HTTP, and cooperates with `route-core` for route matching, with optimal performance and zero dependence on external HTTP frameworks.

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

Fastify is a high-performance Node.js web framework with a rich plug-in ecosystem and built-in JSON Schema verification + serialization optimization.

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

Express is the most mature web framework in the Node.js ecosystem and has the largest middleware ecosystem. VextJS supports Express v5. Suitable for migrating from existing Express projects.

:::tip Express v5
VextJS's Express Adapter is based on Express v5. If you are using Express v4, you need to upgrade first. Compared with v4, the main changes in v5 include: routing processing supports `async`/`await`, improved `req.query` parsing, etc.
:::

### Koa Adapter

```bash
npm install koa
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

Koa is a next-generation web framework built by the Express team and is known for its lightweight and elegance. VextJS supports Koa v3.

## Switch Adapter

To switch Adapter, you only need to modify the `adapter` field in `src/config/default.ts`:

```typescript
// Switch from Native to Hono
- // adapter default native
+ import { honoAdapter } from 'vextjs/adapters/hono';

  export default {
+ adapter: honoAdapter(),
    port: 3000,
  };
```

**No changes are required to the business code. ** Route definition, middleware, service layer, plug-in - all user code operates on the `VextRequest` / `VextResponse` interface and is completely decoupled from the underlying framework.

## How to choose Adapter

### Select Native (recommended by default)

- Pursue maximum performance
- An ecosystem that does not rely on other frameworks
- New project, no historical baggage
- Hope zero extra dependencies

### Select Hono

- Requires middleware or tools from the Hono ecosystem
- Want Hono routing inside a Node.js service; future Edge / Serverless deployment requires a dedicated adapter
- Prefer Web Standards API style

### Select Fastify

- Requires use of Fastify’s rich plug-in ecosystem
- Large projects that value Fastify’s maturity and community support
- Requires `fast-json-stringify` serialization optimization

### Select Express

- Migrate existing Express projects to VextJS
- Need to reuse a lot of Express middleware
- The team is most familiar with Express

### Select Koa

- Prefer Koa's lightweight design
- Small and medium-sized projects
- Requires Koa specific middleware

## VextAdapter interface

All Adapters implement the unified `VextAdapter` interface:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";

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

If the five built-in Adapters cannot meet your needs, you can implement a custom Adapter:

```typescript
// src/config/default.ts
import { createServer } from "node:http";
import type { VextAdapter, VextApp } from "vextjs";

function myCustomAdapter(): (app: VextApp) => VextAdapter {
  return (app) => {
    const adapter: VextAdapter = {
      name: "my-custom",

      registerMiddleware(middleware) {
        // Register global middleware
      },

      registerRoute(method, path, chain, options) {
        // Register route
      },

      registerErrorHandler(handler) {
        // Register error handling
      },

      registerNotFound(handler) {
        // Register 404 processing
      },

      buildHandler() {
        return (req, res) => {
          // Convert Node.js req/res into the underlying framework request
          // and execute the middleware chain.
          res.statusCode = 501;
          res.end("custom adapter bridge not implemented");
        };
      },

      async listen(port, host = "0.0.0.0") {
        const server = createServer(adapter.buildHandler());

        await new Promise<void>((resolve) => {
          server.listen(port, host, resolve);
        });

        const address = server.address();
        const actualPort =
          typeof address === "object" && address ? address.port : port;

        return {
          port: actualPort,
          host,
          close: () =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => {
                if (error) reject(error);
                else resolve();
              });
            }),
        };
      },
    };

    return adapter;
  };
}

export default {
  adapter: myCustomAdapter(),
  port: 3000,
};
```

When implementing a custom Adapter, the core work is to perform bidirectional conversion between `VextRequest` / `VextResponse` and the native objects of the underlying framework, and correctly execute the middleware chain.

## Request/response conversion

Regardless of which Adapter is used, user code always operates on the unified `VextRequest` and `VextResponse` interfaces.

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
  url: string; // Full URL
  path: string; // Path part
  route: string; // Matched route template, empty string for 404
  query: Record<string, string>; // Query parameters
  body: unknown; // Request body
  params: Record<string, string>; // Path parameters
  headers: Record<string, string | undefined>; // Lowercase request headers
  cookies: VextCookieJar; // Parsed cookies
  cookie(name: string): string | undefined; // Read one cookie
  csrfToken(): string; // Current request CSRF token
  auth: VextAuthContext; // Authentication context
  requestId: string; // Request unique identifier
  ip: string; // Client IP
  protocol: "http" | "https"; // Protocol
  app: VextApp; // Application instance
  valid<T>(location: "query" | "body" | "param" | "header" | "cookie"): T;
  onClose(handler: () => void): void; // Connection closing hook
  files?: ParsedFile[]; // Parsed uploaded files, filled by multipart plugins
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

- **Switching Adapter does not affect any business code**
- **Middleware behaves consistently across all Adapters**
- **Test code has nothing to do with Adapter**

## Switch Adapter according to environment

You can use different Adapters in different environments:

```typescript
// src/config/default.ts — Use Native by default
export default {
  port: 3000,
  // adapter default native
};
```

```typescript
// src/config/development.ts — development environment using Hono (leveraging its DevTools)
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
};
```

```typescript
// src/config/production.ts — Keep the production environment Native (highest performance)
export default {
  // Do not set adapter, inherit the default native of default.ts
};
```

## FAQ

### Do I need to modify the code after switching the Adapter?

unnecessary. All business code (routing, middleware, services, plug-ins) operates the `VextRequest` / `VextResponse` interface and is completely decoupled from the underlying Adapter.

### Can Adapter be switched dynamically at runtime?

Can't. Adapter is determined by configuration at startup and cannot be switched during runtime. If you need to use different Adapters depending on the environment, please use the configuration file override mechanism (such as `development.ts` / `production.ts`).

### Where does the performance difference mainly come from?

The performance difference mainly comes from the HTTP parsing, route matching and serialization efficiency of the underlying framework itself. The overhead of the VextJS layer (middleware chain, request/response packaging, etc.) is basically the same across all Adapters. Native Adapter has the highest performance because it uses the lowest level `http.createServer`, eliminating the need for additional abstractions at the framework layer.

### Can the native middleware of the underlying framework be used?

Not recommended for direct use. VextJS has its own middleware system (`defineMiddleware` / `defineMiddlewareFactory`). The native middleware signature of the underlying framework is different and cannot be directly compatible. If you need to use the middleware function of an underlying framework, it is recommended to encapsulate it as VextJS middleware or plug-in.

### What should I do if peer dependencies report a warning?

VextJS declares all underlying frameworks as optional `peerDependencies`. You only need to install the framework package corresponding to the Adapter you actually use. For example, the Hono Adapter requires only `hono`; peer dependency warnings from other unused frameworks can be safely ignored.

The current Hono Adapter is a Node.js runtime capability: it receives requests through a Node.js HTTP server and bridges them into Hono's Web `Request` / `Response` flow. Edge / Serverless runtimes should not use these Node adapter installation instructions as a support claim.

## Next step

- Understand the Adapter-related configuration items in [Configuration](/guide/configuration)
- View the performance of [OpenAPI Documentation](/guide/openapi) under different Adapters
- Explore the cooperation between [Cluster multi-process](/guide/cluster) and Adapter
- Read benchmark data related to [Performance Benchmark](/benchmark)

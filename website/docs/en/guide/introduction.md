# Introduction

## What is VextJS?

VextJS is a full-stack Node.js framework for applications that need APIs, server-rendered React pages, or both. `src/routes/**` remains the URL authority while services, validation, security, cache, OpenAPI, and typed clients share the same request contracts. You can begin with the default full-stack starter or keep an API-only application without adopting a second routing model.

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/hello",
    {
      docs: { summary: "Greeting Interface" },
    },
    async (_req, res) => {
      res.json({ message: "Hello VextJS!" });
    },
  );
});
```

The same route file can call `res.render()` to produce an SSR page from the same services and lifecycle. See [Frontend getting started](/frontend/getting-started) for that path and [Frontend boundaries](/frontend/boundaries-and-roadmap) for the intentional exclusions.

## Core Features

### 🔌 Adapter architecture

VextJS's underlying HTTP handling layer is replaceable. Built-in 5 kinds of Adapters:

| Adapter              | Underlying framework               | Features                                                       | Applicable scenarios            |
| -------------------- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| **Native** (default) | `http.createServer` + `route-core` | Zero external HTTP framework dependencies, highest performance | Pursuing ultimate performance   |
| **Hono**             | Hono + `@hono/node-server`         | Web Standards API on Node.js                                   | Node.js applications            |
| **Fastify**          | Fastify                            | Rich ecology, serialization optimization                       | Large-scale projects            |
| **Express**          | Express                            | The largest middleware ecosystem                               | Migration project               |
| **Koa**              | Koa                                | Lightweight and elegant                                        | Small and medium-sized projects |

Switching the Adapter only requires modifying one line of configuration, with **zero changes to the business code**:

```typescript
// src/config/default.ts
import { nativeAdapter } from "vextjs/adapters/native";
// import { honoAdapter } from 'vextjs/adapters/hono';
// import { fastifyAdapter } from 'vextjs/adapters/fastify';

export default {
  adapter: nativeAdapter(),
  port: 3000,
};
```

### ⚡ Ultimate performance

Historical benchmark snapshot (JSON response scenario, median of 5 rounds):

| Frame   | Raw RPS | Vext RPS | Frame Overhead |
| ------- | ------: | -------: | -------------: |
| Native  |  44,932 |   36,819 |          18.1% |
| Fastify |  45,619 |   29,203 |          36.0% |
| Hono    |  20,703 |   15,684 |          24.2% |
| Express |  29,868 |   30,974 |          -3.7% |

> The overhead of Vext includes: body parser, response wrapper, request/response abstraction, AsyncLocalStorage context, middleware chain executor, etc. **complete functions**.

> ⚠️ **Test environment description**: The above table is a historical snapshot of 2026-03-23, measured based on Node.js v24.14.0 / Windows x64 / Intel i7-9700 / autocannon (50 connections, 10 pipelining, 10s × 5 rounds median). The current version reproduces the actual test based on `test/benchmark/run-benchmark.mjs` in the warehouse, and distinguishes between `chain` and `middleware-chain`. For complete details, see [Performance Benchmark](/benchmark).

### 🛡️ Declarative parameter verification

Integrate [schema-dsl](https://github.com/devcodex-labs/schema-dsl), declare verification rules in routing `options`, automatically verify + automatically generate OpenAPI documents:

```typescript
app.post(
  "/users",
  {
    validate: {
      body: {
        name: "string!", // required string
        email: "email!", // Required email format
        age: "number?", // optional number
        role: "admin|user", // enumeration
      },
    },
    docs: { summary: "Create user" },
  },
  async (req, res) => {
    // req.body has passed verification and is type safe
    const user = await app.services.user.create(req.body);
    res.json(user);
  },
);
```

### 🧩 Plug-in system

Extend the framework capabilities through `definePlugin()` to support complete life cycle hooks:

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "user-cache-plugin",

  async setup(app) {
    //Register capabilities on the app
    const cache = new Map();
    app.extend("userCache", {
      get: (key: string) => cache.get(key),
      set: (key: string, value: unknown, ttl?: number) => {
        cache.set(key, value);
        if (ttl) setTimeout(() => cache.delete(key), ttl);
      },
    });
  },

  async onReady(app) {
    app.logger.info("Cache plugin ready");
  },

  async onClose(app) {
    // Clean up resources
  },
});
```

### 🧱 Module system and decorator strategy

VextJS uses ESM + conventional directories as the module system: `src/config/`, `src/plugins/`, `src/middlewares/`, `src/services/`, `src/routes/` will be automatically scanned at startup and loaded in the order of configuration → plug-ins → middleware definition → services → routes.VextJS currently does not provide decorator APIs such as `@Controller` / `@Get` / `@Inject` / `@Service`, nor does it rely on `reflect-metadata`. Routes use `defineRoutes()`, plugins use `definePlugin()`, and services are injected into `app` through the `new ServiceClass(app)` constructor. If you are migrating from a decorator framework such as NestJS, please migrate controller decorators to `src/routes/*.ts` file routes and constructor dependency injection to `app.services` delayed access.

### 🔥 Development experience

- **`vext dev`** — File monitoring + smart hot reload (Soft Reload Tier 1/2 + Cold Restart Tier 3)
- **`vext build`** — esbuild extremely fast build, TypeScript zero configuration
- **`vext create`** — interactive scaffolding that supports 5 Adapter choices
- **OpenAPI/Vext Docs** — Automatically generated from route `docs` + `validate`; visit `/docs` for API and standard JSDoc documentation, or use `/openapi.json` with external tools

### 🏢 Enterprise-level features

- **Cluster multi-process** — `ClusterMaster` + Worker heartbeat + Rolling Restart + Graceful shutdown
- **Internationalization (i18n)** — Language packs are loaded automatically, error messages are in multiple languages
- **Built-in rate limit** — based on `flex-rate-limit`, supports IP / user dimension
- **Request Tracking** — AsyncLocalStorage runs through route → service and automatically injects requestId
- **MonSQLize plugin** — Built-in connection/model lifecycle, loaded only when `config.database` is present

## Design concept

### 1. Convention is better than configuration

Following fixed project structure conventions (`src/routes/`, `src/services/`, `src/config/`), the framework automatically scans and loads without manual registration.

### 2. Layered architecture

```
Routing layer (routes) ← Parameter extraction + response return
   ↓
Service layer (services) ← Business logic (pure data, not aware of HTTP)
   ↓
Data layer (models) ← Data access (provided through plugins)
```

- The routing handler is only responsible for parameter extraction and response return
- Business logic is concentrated in the service layer, accessed through `app.services.xxx`
- The service is not aware of the HTTP protocol, making it easy to reuse and test

### 3. The bottom layer is replaceable

Through the Adapter architecture, the core of the framework is completely decoupled from underlying HTTP processing. All business code (routing, middleware, services, plug-ins) operates on the `req` / `res` objects encapsulated by VextJS, rather than the native objects of the underlying framework.

## Compare with other frameworks

| Features                        | VextJS                           | Fastify                | Express                | NestJS             |
| ------------------------------- | -------------------------------- | ---------------------- | ---------------------- | ------------------ |
| The bottom layer is replaceable | ✅ 5 types of Adapters           | ❌                     | ❌                     | ✅ Express/Fastify |
| Conventional routing            | ✅ File-level automatic scanning | ❌ Manual registration | ❌ Manual registration | ✅ Decorator       |
| Parameter validation            | ✅ Declarative schema-dsl        | ✅ JSON Schema         | Requires middleware    | ✅ class-validator |
| OpenAPI generation              | ✅ Automatic                     | Plug-in required       | Middleware required    | ✅ Decorator       |
| Hot Reload                      | ✅ Soft + Cold                   | ❌                     | ❌                     | ❌                 |
| Cluster Management              | ✅ Built-in                      | ❌                     | ❌                     | ❌                 |
| Volume                          | Lightweight                      | Lightweight            | Lightweight            | Weight             |

## Environmental requirements

- **Node.js** >= 20.19.0
- **TypeScript** 5.x (recommended, pure JavaScript is also supported)

## Next step

Ready to start? [Create your first VextJS project](/guide/quick-start).

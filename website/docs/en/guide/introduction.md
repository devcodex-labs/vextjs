# Introduction

## What is VextJS?

VextJS is an AI-first full-stack Node.js framework for APIs, server-rendered React pages, or both. The API and SSR pages define their routes in `src/routes/**`. A handler can call services, return JSON, or render a page. Route validation and response declarations can generate OpenAPI and typed clients; authorization, business rules, and caching policies still require their respective configuration. You can start with the default full-stack scaffold or keep an API-only application.

AI-first describes a development surface designed for AI-assisted development: explicit conventions, scaffolding, typed contracts, OpenAPI, and machine-readable documentation give coding assistants grounded inputs. It does not mean VextJS bundles an LLM, Agent, RAG system, or inference runtime.

This example shows the basic shape of a route file. Create a project using [Quick Start](/guide/quick-start) before running it. If `src/routes/index.ts` already exists, merge the registration into its callback.

```typescript
// src/routes/index.ts
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

The same route file can call `res.render()` so an SSR page uses the same services and request lifecycle. See [Frontend Getting Started](/frontend/getting-started) for the complete path and [Frontend Boundaries and Roadmap](/frontend/boundaries-and-roadmap) for deliberate exclusions.

## Core Features

### 🔌 Adapter architecture

VextJS has a replaceable HTTP layer with five built-in adapters:

| Adapter              | Underlying framework               | Characteristics                             | Good starting point for             |
| -------------------- | ---------------------------------- | ------------------------------------------- | ----------------------------------- |
| **Native** (default) | `http.createServer` + `route-core` | No third-party HTTP framework; default path | New projects and fewer dependencies |
| **Hono**             | Hono + Vext's `node:http` bridge   | Web Standards APIs on Node.js               | Node.js applications                |
| **Fastify**          | Fastify                            | Fastify through a Vext Adapter              | Teams familiar with Fastify         |
| **Express**          | Express                            | Express 5 through a Vext Adapter            | Teams familiar with Express         |
| **Koa**              | Koa                                | Koa 3 through a Vext Adapter                | Teams familiar with Koa             |

Route handlers written against VextJS `req` / `res` generally need no rewrite when switching adapters. Adapter-specific middleware or plugins still need an integration review. Install the corresponding framework dependency before selecting a non-Native Adapter; see [Adapters](/guide/adapters). Once installed, select it in configuration:

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

### ⚡ Performance and tradeoffs

The site benchmark compares the same Vext Normal application across five adapters; it is not a Raw Native versus Raw Fastify cross-framework ranking. The results page identifies its source version, environment, and measurement date. A historical sample is not a performance promise for this version or an arbitrary production application.

See [Performance Benchmarks](/benchmark) for current measurements, methodology, adapter guidance, and reproduction commands. Include your authentication, logging, middleware, I/O, and deployment environment in production benchmarks.

### 🛡️ Declarative parameter verification

The built-in schema-dsl validation adapter accepts rules in route `options`. It validates request input at runtime and, when OpenAPI is enabled, can project the same declarations into API documentation.

The following fragment belongs inside a `defineRoutes` callback and assumes the application has a user service. For a runnable walkthrough, see [Validation](/guide/validation).

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
    // Read the validation result; do not assume the validator mutates the input.
    const body = req.valid("body");
    const user = await app.services.user.create(body);
    res.json(user);
  },
);
```

### 🧩 Plug-in system

Extend framework capabilities through `definePlugin()` with setup, ready, and close hooks. This file registers an in-process cache and clears it when the application closes:

```typescript
// src/plugins/user-cache.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "user-cache-plugin",

  async setup(app) {
    // Register a capability on app.
    const cache = new Map<string, unknown>();
    app.extend("userCache", {
      get: (key: string) => cache.get(key),
      set: (key: string, value: unknown) => {
        cache.set(key, value);
      },
    });
    app.onClose(() => {
      cache.clear();
    });
  },

  async onReady(app) {
    app.logger.info("Cache plugin ready");
  },
});
```

This Map has no TTL or capacity limit and is not shared among workers. Choose persistence, expiry, and sharing for your application storage; see [Plugins](/guide/plugins). The framework's [route response cache](/guide/cache) has a separate configuration and lifecycle from this `userCache`. Add close logic for any timer or connection your plugin introduces. For `app.userCache` in other TypeScript files, add the extension type declaration described in the Plugins guide; runtime attachment does not guarantee static type inference.

### 🧱 Module system and decorator strategy

VextJS uses ESM and conventional directories as its module system. Startup loads configuration, language packs, plugins, middleware definitions, services, and routes. Their entry rules differ: for example, middleware is looked up by name from `config.middlewares`, so placing it in a directory does not execute it globally. See [Project Structure](/guide/project-structure).

VextJS currently provides no `@Controller`, `@Get`, `@Inject`, or `@Service` decorator API and does not depend on `reflect-metadata`. Routes use `defineRoutes()`, plugins use `definePlugin()`, and services receive `app` through `new ServiceClass(app)`. When migrating from a decorator framework such as NestJS, move controller routes into `src/routes/*.ts` and constructor dependency injection toward deferred access through `app.services`.

### 🔥 Development experience

- **`vext dev`** — File monitoring + smart hot reload (Soft Reload Tier 1/2 + Cold Restart Tier 3)
- **`vext build`** — esbuild build; run type checking separately, and account for project configuration of special assets and output
- **`vext create`** — interactive scaffolding that supports 5 Adapter choices
- **OpenAPI / Vext Docs** — Generate API documentation from route `docs`, `validate`, and `responses`. When enabled, `/docs` is the default documentation URL, `/openapi.json` is available to external tools, and JSDoc can be displayed from configured source ranges

### 🏢 Enterprise-level features

- **Cluster multi-process** — `ClusterMaster` + Worker heartbeat + Rolling Restart + Graceful shutdown
- **Internationalization (i18n)** — Language packs are loaded automatically, error messages are in multiple languages
- **Built-in rate limiting** — based on `flex-rate-limit` and disabled by default; see [Rate Limiting](/guide/rate-limit) for user identity and authentication timing
- **Request Tracking** — AsyncLocalStorage runs through route → service and automatically injects requestId
- **MonSQLize plugin** — Built-in connection and model lifecycle triggered by a nonempty `config.database`. An absent value, `null`, or an empty object does not initialize it. There is currently no `database.enabled` off switch; see [Database](/guide/database)

## Design concept

### 1. Convention is better than configuration

For typical applications, the framework loads `src/routes/`, `src/services/`, `src/config/`, and their respective entry points without manual registration. See [Project Structure](/guide/project-structure) for helper modules and optional capabilities.

### 2. Layered architecture

```
Routing layer (routes) ← Parameter extraction + response return
   ↓
Service layer (services) ← Business logic (pure data, not aware of HTTP)
   ↓
Data layer (models) ← Data access (provided through plugins)
```

- A route handler extracts validated parameters, calls services, and sends the response.
- Concentrate business logic in services accessed through `app.services.xxx`.
- Keeping services independent of `req`/`res` allows reuse by HTTP and Jobs. The framework does not automatically prohibit cross-layer access.

### 3. The bottom layer is replaceable

Adapters unify the request and response contract, so business code written against Vext APIs can generally be reused. Code that uses native objects, adapter-specific plugins, or transport features still needs a compatibility check; arbitrary plugins cannot be assumed to switch without changes.

## Compare with other frameworks

Compare concrete versions, plugins, and deployment tools. Do not label an entire ecosystem unsupported because one framework core does not ship a particular tool. Check these VextJS entry points and the application conditions you must verify:

| Dimension                    | Current VextJS entry                             | Application condition to verify                         |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| HTTP layer                   | Five adapters                                    | Native plugins and transport feature compatibility      |
| Routing and input            | File routes and `validate`                       | Whether existing URLs and schemas fit a static contract |
| OpenAPI and client           | Route projection and typed client tools          | Whether dynamic definitions can be analyzed completely  |
| Development reload           | Soft Reload and Cold Restart in `dev`            | Whether module changes require a cold restart           |
| Multiple processes           | Cluster and graceful shutdown                    | Whether in-process state needs external sharing         |
| Dependencies and performance | Package declarations and reproducible benchmarks | Chosen adapter, plugins, and actual request workload    |

For migration examples, review [Routing](/guide/routing), [Plugins](/guide/plugins), and [Deployment](/guide/deployment). Labels such as “lightweight” cannot replace measuring actual dependencies and operational cost.

## Environmental requirements

- Requires Node.js **`^20.19.0 || >=22.12.0`**
- **TypeScript** 5.x (recommended, pure JavaScript is also supported)

## Next step

Create a project with [Quick Start](/guide/quick-start). In a working application, merge this page's `src/routes/index.ts` hello route into the existing route file and configuration, run `npm run dev`, and request `GET http://127.0.0.1:3000/hello`. Expect HTTP 200 with `data.message: "Hello VextJS!"`. Merge with any existing index callback instead of replacing it. If you get 404, check the file prefix and actual port.

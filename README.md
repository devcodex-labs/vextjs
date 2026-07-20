# VextJS

[Documentation](https://vextjs.github.io)

VextJS is a high-performance full-stack Node.js framework for building maintainable applications. It combines a convention-based backend runtime, file-system routing, typed services, plugins, middleware, validation, OpenAPI generation, route-level caching, an esbuild-powered React frontend pipeline, and a CLI workflow that keeps projects productive from the first command.

## Why VextJS

- Convention-based structure for routes, services, middleware, plugins, config, locales, generated types, and preload scripts.
- File-system routing with dynamic params, nested routes, validation, middleware, OpenAPI metadata, and response helpers.
- Adapter support for Native Node.js, Hono, Fastify, Express, and Koa.
- Automatic service injection through `app.services`.
- Plugin lifecycle hooks with app extension support.
- Runtime `app.hooks` for request, validation, response, error, fetch, service, cache, plugin, OpenAPI, and server lifecycle points.
- Built-in request context, request id, access logging, body limit, structured error handling with `app.throw` details, i18n, and OpenAPI endpoints.
- Built-in `app.fetch` with timeout/retry/requestId propagation and config-driven `app.fetch.proxy` response passthrough.
- Route-level response cache powered by `response-cache-kit` / `cache-hub`, with memory, Redis, and multi-level modes.
- Built-in React frontend integration for `src/frontend/pages/**`, route-driven `res.render()`, SSR, hydration telemetry, route-specific modulepreload, Vext JSCSS/CSS assets, scoped SPA fallback, and generated API contract files.
- Lightweight `vextjs/frontend` runtime helpers for page i18n, generated API contract artifacts, and future external frontend adapters.
- Hot development workflow with route hot swap, service/i18n reload, and cold restart only when required.
- Type generation for service and plugin app extensions.
- Process-level preload support for OpenTelemetry, APM, polyfills, and startup bridges.

## Quick Start

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

Open `http://localhost:3000`. The default scaffold is a full-stack React app rendered from Vext routes. It includes a React page, a shared layout, default error page, `/api/hello`, and `/api/health` so the project is runnable immediately.

Create a project with another adapter:

```bash
npx vextjs create my-app --adapter hono
```

Create a JavaScript project:

```bash
npx vextjs create my-app --js
```

Create an API-only project:

```bash
npx vextjs create my-api --template api --frontend none
```

Skip dependency installation:

```bash
npx vextjs create my-app --skip-install
```

## Installation

Manual setup is also supported:

```bash
npm install vextjs
```

`package.json`:

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "dev": "vext dev",
    "build": "vext build",
    "start": "vext start"
  },
  "dependencies": {
    "vextjs": "^0.3.26"
  }
}
```

VextJS projects use ESM. Keep `"type": "module"` in application packages.

## Project Structure

The scaffold creates the convention directories that the runtime knows how to scan:

```text
my-app/
|-- preload/                    # Optional process-level preload scripts
|   `-- README.md
|-- public/
|   `-- favicon.svg             # Static assets copied into the frontend build
|-- src/
|   |-- frontend/
|   |   |-- pages/
|   |   |   |-- _document.html   # HTML document with {vext.*} slots
|   |   |   |-- index.tsx        # Page rendered by res.render("index")
|   |   |   |-- layout.tsx       # Shared layout chain entry
|   |   |   `-- error/
|   |   |       `-- default.tsx  # Default HTML error page
|   |   |-- components/
|   |   |   `-- AppShell.tsx
|   |   |-- locales/
|   |   |   `-- en-US.ts
|   |   |-- styles/
|   |   |   |-- index.css
|   |   |   `-- card.style.ts
|   |   `-- assets/
|   |-- config/
|   |   |-- default.ts          # Required base config
|   |   |-- development.ts      # Development override
|   |   |-- production.ts       # Production override
|   |   |-- local.example.ts    # Copy to local.ts for private local overrides
|   |   `-- bootstrap.example.ts # Copy to bootstrap.ts for startup providers
|   |-- routes/
|   |   `-- index.ts
|   |-- services/
|   |   `-- example.ts
|   |-- middlewares/
|   |   `-- README.md
|   |-- plugins/
|   |   `-- README.md
|   |-- locales/
|   |   `-- README.md
|   `-- types/
|       `-- generated/
|           `-- .gitkeep        # vext typegen writes index.d.ts here
|-- package.json
`-- tsconfig.json
```

JavaScript projects use `.js` files and do not create `src/types/generated/`.
Generated TypeScript declarations are stored under `.vext/types/`; `src/types/generated/index.d.ts` is a small reference shim created by `vext typegen`. Frontend generated source lives under `.vext/generated/frontend/`; browser and SSR output is written under `.vext/client/` in development and `dist/client/` during production build.

`local.example.ts` and `bootstrap.example.ts` are examples, not active config files. Copy them when you need the feature:

```bash
cp src/config/local.example.ts src/config/local.ts
cp src/config/bootstrap.example.ts src/config/bootstrap.ts
```

`src/config/local.ts` and `src/config/local.js` are ignored by the generated `.gitignore` because they may reference private local infrastructure.

## CLI

```bash
vext dev              # Development mode with hot reload
vext build            # Build TypeScript projects
vext start            # Start the production server from dist/
vext create <name>    # Create a new project
vext typegen          # Generate service and app extension types
vext stop             # Stop cluster workers
vext reload           # Rolling restart for cluster workers
vext status           # Inspect cluster status
```

`vext dev` prints a minimal ready log by default: listening URL(s) plus total startup time. Add `--startup-profile` to print startup timings grouped by stable phases such as `main/preflight`, `main/preload`, `pre-worker-bootstrap`, `compile`, `database`, `plugins`, `routes`, `openapi`, `listen`, and `onReady`. Use `--startup-profile-json .vext/inspect/startup-profile.json` to write the same phase names and `gap.*` events to JSON without enabling human-readable profile details.

`vext start` keeps production output minimal too: start mode, listening URL(s), and total startup time. Add `--startup-profile` or `--startup-profile-json <path>` when you need cold-start phase timings from the production bootstrap path.

`vext create` options:

```bash
vext create my-app
vext create my-app --js
vext create my-app --adapter hono
vext create my-app --adapter fastify
vext create my-app --adapter express
vext create my-app --adapter koa
vext create my-app --adapter native
vext create my-api --template api --frontend none
vext create my-app --skip-install
vext create my-app --force
```

`vext create` accepts exactly one project name. Extra positional arguments are rejected before the target directory is written. If the automatic `npm install` step fails, the command exits non-zero but keeps the generated project so you can enter it and run `npm install` again. TypeScript full-stack projects include NodeNext-compatible mappings for `@frontend`, `@pages`, `@components`, `@styles`, and `@assets`.

## Configuration

Configuration is loaded and merged in this order:

```text
framework defaults -> default -> config profile -> local -> bootstrap provider patch -> CLI override
```

`src/config/default.ts`:

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 3000,
  adapter: "native",
  logger: {
    level: "info",
    pretty: true,
    prettyColor: "auto",
  },
  server: {
    requestTimeout: 120_000,
    headersTimeout: 60_000,
    keepAliveTimeout: 5_000,
  },
  openapi: {
    enabled: true,
  },
  securityHeaders: {
    enabled: true,
    preset: "basic",
  },
  frontend: {
    enabled: true,
    framework: "react",
    publicDir: "public",
    publicPath: "/",
    i18n: {
      enabled: true,
      defaultLocale: "en-US",
    },
    dev: {
      renderRefresh: "prompt",
    },
  },
};

export default config;
```

Config profile files can return partial config. `vext start`, `vext build`, and `vext deploy assets` default to the `production` profile; `vext dev` defaults to `development`. Use `--config <name>` or `VEXT_CONFIG=<name>` to load a custom profile such as `src/config/sg-sit.ts`:

```bash
vext start --config sg-sit
VEXT_CONFIG=sg-sit vext start
vext deploy assets --config sg-sit --dry-run
```

Profile files can return partial config:

```ts
// src/config/production.ts
import type { VextUserConfig } from "vextjs";

const config: Partial<VextUserConfig> = {
  port: 3001,
  logger: {
    level: "info",
    pretty: false,
  },
};

export default config;
```

Use `src/config/local.ts` for machine-specific overrides and keep it out of Git.

`app.logger` uses Vext's built-in structured logger by default. It outputs JSON in production, uses an internal pretty formatter in development, colors pretty level labels in TTY terminals or with `FORCE_COLOR=1` through `logger.prettyColor: "auto"`, supports `trace()`, runtime `getLevel()` / `setLevel()`, and exact key/path redaction through `logger.redactKeys` / `logger.redactPaths`. JSON output never contains ANSI color codes. Plugins can wrap it through `app.setLogger()` for external log bridges.

Use `config.server` for inbound Node.js HTTP server settings such as request, headers, keep-alive, socket timeout, request header size, max requests per socket, and incomplete-request checking interval. It applies to the built-in Native, Hono, Fastify, Express, Koa adapters and the dev server; omitted fields keep the current Node.js defaults. This is separate from `config.fetch.timeout`, which only controls outbound `app.fetch` calls.

## Frontend

The default `vext create` template enables `config.frontend` and creates `src/frontend/**`. URL entry still lives in `src/routes/**`; a route renders a page by calling `res.render(page, props, options)`:

```ts
app.get("/", {}, async (req, res) => {
  const greeting = await app.services.example.greeting("Vext");
  res.render("index", { greeting });
});
```

`vext dev` builds the browser app into `.vext/client/`, watches `src/frontend/**` and `public/**`, and uses the dev event bus for CSS/JSCSS updates, React Fast Refresh, and optional render-data refresh prompts after backend soft reloads.

Component styles can use the default `vextjs/style` facade. Files such as `src/frontend/styles/card.style.ts` are scanned during build, extracted into generated CSS, and merged into the final CSS asset without adding Emotion or styled-components as default runtime dependencies.

`vext build` compiles server code and then bundles the browser client and SSR renderer into `dist/client/`. Browser pages, layouts, error pages, and locale entries are split through dynamic imports; shared React runtime packages go through the Vext-managed vendor entry. `vext start` serves static frontend assets and HTML rendering while leaving API paths such as `/api/**`, `/openapi.json`, and `/docs/**` to the backend runtime.

Production builds also write `dist/client/deploy-manifest.json` for CDN or static asset publishing and `dist/client/size-report.json` for raw/gzip/brotli size evidence, route initial assets, and app-owned/external runtime groups. `vext deploy assets` and `vext build --upload-assets` upload only changed JS/CSS/images/fonts and copied `public/**` files by sha256 state; server-rendered `index.html` is not uploaded by default.

For React hydration performance budgets, set fields such as `frontend.build.budgets.maxInitialJsBrotliBytes`, `maxRouteInitialJsBrotliBytes`, or `maxAppOwnedInitialJsBrotliBytes`. The default frontend i18n mode uses `frontend.i18n.clientLoad: "current"` so the browser loads only the SSR locale during hydration; use `"all"` only when a page needs no-reload locale switching. Advanced React CDN/import-map usage remains opt-in through `frontend.build.client.external` plus `externalRuntime`; React-related externals must provide runtime mappings.

For the frontend user guide, start with [Frontend Overview](https://vextjs.github.io/frontend/overview). The Frontend section has its own navigation for getting started, routing/pages, SSR, hydration, CSR fallback, render data cache, Fast Refresh, code splitting, static assets/CDN, performance budgets, configuration, and troubleshooting.

When `frontend.apiClient` is enabled, Vext also emits `client-contract.json` and `api.generated.ts` next to the frontend output for tooling or advanced external frontend integrations. Normal page code does not need to hand-write route contracts; for first-screen data, prepare services in the route handler and pass props through `res.render()`.

For API-only projects, use:

```bash
npx vextjs create my-api --template api --frontend none
```

## Startup Config Providers

Use `src/config/bootstrap.ts` when configuration must be fetched before the final app config is validated and frozen:

```ts
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      async load({ configProfile, signal }) {
        const response = await fetch(
          `https://config.example.com/${configProfile}.json`,
          { signal },
        );
        return await response.json();
      },
    },
  ],
});
```

This is the right place for startup config centers and early infrastructure patches. Use `preload/` instead for APM, OpenTelemetry, polyfills, or anything that must execute before application modules are imported.

## Preload

VextJS supports two preload sources:

- Application-level scripts in the project root `preload/` directory.
- Package-level scripts declared through `package.json` `vext.preload`.

Application preload example:

```text
preload/
|-- 01-otel.ts
`-- 02-polyfill.mjs
```

Supported application preload files include `.js`, `.mjs`, `.ts`, and `.mts`. TypeScript preload files are compiled before injection. `vext dev` watches the root `preload/` directory and performs a cold restart when preload files change.

## Routes

Routes live in `src/routes/` and are mapped from file paths to URL prefixes:

```text
src/routes/index.ts          -> /
src/routes/users.ts          -> /users
src/routes/admin/index.ts    -> /admin
src/routes/admin/settings.ts -> /admin/settings
src/routes/users/[id].ts     -> /users/:id
```

Example:

```ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      docs: { summary: "Home" },
    },
    async (_req, res) => {
      const greeting = await app.services.example.greeting("Vext");
      res.json(greeting);
    },
  );

  app.get(
    "/health",
    {
      docs: { summary: "Health check" },
    },
    async (_req, res) => {
      res.json({ status: "ok", timestamp: Date.now() });
    },
  );
});
```

## Validation

Route validation uses `schema-dsl` style declarations:

```ts
app.post(
  "/users",
  {
    validate: {
      body: {
        name: "string!",
        age: "number|min:0",
        email: "email!",
      },
    },
  },
  async (req, res) => {
    const body = req.valid("body");
    res.json({ created: true, user: body });
  },
);
```

Validation errors use HTTP `422` by default and can be localized through `src/locales/`.

With the v1 source adaptation, `?` means that a property may be absent; it does
not make the value nullable. Use `types:string|null` or raw JSON Schema
`{ type: ["string", "null"] }` when `null` is explicitly allowed. Field
descriptions use the side-effect-free builder instead of a global String method:

```ts
import { schemaAdapter } from "vextjs";

const userSchema = {
  name: schemaAdapter.compileField("string!").description("User name"),
  nickname: "string?",
};
```

See [Preparing for vextjs v1](./MIGRATION.md) for the complete schema-dsl v3 and
monsqlize 3.1 migration contract. The repository remains on `0.3.26` during
source validation; no intermediate vextjs version is published.

## Cookies and Sessions

Vext parses the request `Cookie` header for every adapter and exposes it through readonly `req.cookies` and `req.cookie(name)` with first-wins duplicate semantics. Responses can append multiple cookies without collapsing them into a comma-joined header:

```ts
app.get("/preferences", {}, async (req, res) => {
  const theme = req.cookie("theme") ?? "system";
  res.cookie("theme", theme, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  res.json({ theme });
});
```

Enable session support through configuration. Vext auto-registers the built-in
runtime in production, development, tests, and soft reloads:

```ts
// src/config/default.ts
export default {
  session: {
    enabled: true,
  },
};

app.post("/login", {}, async (req, res) => {
  req.session!.userId = "u_123";
  res.json({ ok: true });
});
```

The default session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` is enabled automatically for HTTPS requests. The built-in memory store is suitable for development, tests, and single-process deployments. For shared production stores, pass a cache-like backend through the official adapter:

```ts
import { createCacheSessionStore } from "vextjs";
import { createRedisCacheAdapter } from "cache-hub/redis";

const sessionCache = createRedisCacheAdapter("redis://localhost:6379");

export default {
  session: {
    enabled: true,
    store: createCacheSessionStore(sessionCache, {
      prefix: "my-app:sess:",
      close: () => sessionCache.close?.(),
    }),
  },
};
```

`createCacheSessionStore()` accepts a structural cache with `get`, `set`, and `del`, converts session TTL seconds to cache milliseconds, and stores JSON strings by default. Vext closes a configured store during app shutdown. Install `cache-hub` and the selected backend client, such as `ioredis`, in the consuming app. `config.cache.cacheHub` and `app.cache` are for route response cache only; they are not a Session Store shortcut. Advanced users can still implement `VextSessionStore` directly when they need a custom persistence contract. Routes can use `session: false` to opt out, or `session: true` to opt in when the global runtime is disabled. The explicit `session()` middleware remains available for scoped/manual registration; do not combine it with `config.session.enabled: true`. Routes that receive a `Cookie` header are not cached by default, and responses with `Set-Cookie` are never written to route cache.

## CSRF Protection

Vext includes a zero-dependency CSRF middleware that uses the configured Session runtime by default and can fall back to signed double-submit cookies when `config.csrf.secret` is provided.

```ts
// src/config/default.ts
export default {
  session: { enabled: true },
  csrf: {
    enabled: true,
  },
};

app.get("/csrf-token", {}, async (req, res) => {
  res.json({ token: req.csrfToken() });
});
```

Set `config.csrf.enabled: true` to auto-register CSRF globally after body parsing and plugin global middleware, or register `csrf()` manually when you need a scoped path. Unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) must submit a token through `x-csrf-token`, `x-xsrf-token`, or body field `_csrf`. Route options can opt out with `{ csrf: false }`.

## Security Headers

Vext can write common browser security response headers from configuration without adding Helmet or a custom plugin. The feature is disabled by default; `basic` adds only the low-impact baseline headers.

```ts
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  securityHeaders: {
    enabled: true,
    preset: "basic",
  },
};

export default config;
```

`basic` sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: SAMEORIGIN`. `strict` also opts into HTTPS-only HSTS, a minimal `Permissions-Policy`, COOP, and CORP; CSP and COEP remain explicit because they depend on each app's assets and cross-origin resource model. Routes can opt out with `{ securityHeaders: false }`, and handlers can still override individual headers with `res.setHeader()`.

## Auth Guard and Context

Every request has an anonymous `req.auth` context by default. Register the first-party `auth()` middleware to populate identity metadata, then protect routes through small local helpers that map your business policy to `RouteOptions.auth`:

```ts
// src/middlewares/auth.ts
import { auth, defineMiddleware } from "vextjs";

export default defineMiddleware(
  auth({
    provider: "app",
    async verify(token) {
      if (token !== "demo-token") return false;

      return {
        subject: "user:1",
        userId: "1",
        roles: ["admin"],
        scopes: ["posts:write"],
        claims: { tier: "internal" },
        can(action, resource) {
          return action === "post:update" && resource === "post-1";
        },
      };
    },
  }),
);
```

```ts
import type { RouteOptions } from "vextjs";

function requireAuth(options: RouteOptions = {}): RouteOptions {
  return {
    ...options,
    middlewares: ["auth"],
    auth: { required: true, security: "bearerAuth" },
  };
}

function requirePostUpdate(options: RouteOptions = {}): RouteOptions {
  return {
    ...options,
    middlewares: ["auth"],
    auth: {
      roles: ["admin"],
      scopes: ["posts:write"],
      permissions: [
        { action: "post:update", resource: (req) => req.params.id },
      ],
      mode: "all",
      security: "bearerAuth",
    },
  };
}

app.get("/me", requireAuth(), async (req, res) => {
  res.json({ userId: req.auth.userId, roles: req.auth.roles });
});

app.post("/posts/:id", requirePostUpdate(), handler);
```

`auth()` identifies a request but does not protect routes by itself. `auth: true` requires an authenticated request; object form can require roles, scopes, permissions, or a custom `check`. Most applications should wrap those route options in helpers like `requireAuth()` / `requirePostUpdate()` so middleware names, security schemes, and permission resources stay in one place. `auth: false` marks a route as explicitly public and disables legacy OpenAPI security inference from `middlewares`.

Stable guard error codes are `AUTH_REQUIRED` (401), `AUTH_INVALID` (401), `AUTH_FORBIDDEN` (403), `AUTH_CONFIG_ERROR` (500), and `AUTH_PROVIDER_ERROR` (500). `requestContext.getStore()?.auth` contains only safe metadata such as `userId`, roles, scopes, scheme, and provider; raw credentials and claims stay out of the request context snapshot.

## Error Handling

VextJS catches exceptions thrown from routes, services, and middleware through a built-in global `error-handler`.

- Use `app.throw(...)` when you want to return a structured HTTP error such as `404`, `409`, or a custom business code.
- Throw `new VextValidationError(errors)` when you want to return a `422` response with field-level validation details.
- Throw `new Error("...")` for unexpected runtime failures. VextJS will convert it to a `500 Internal Server Error`.

`app.throw` also supports optional business details for cases such as upstream API errors:

```ts
app.throw(
  502,
  "payment.failed",
  { orderId },
  {
    provider: "stripe",
    providerCode: "card_declined",
  },
);

app.throw({
  status: 502,
  message: "payment.failed",
  code: "PAYMENT_FAILED",
  details: { provider: "stripe", providerCode: "card_declined" },
});
```

`details` is sanitized before it is written to the JSON response, so circular references and unsupported values cannot break error serialization.

See the full guide in [Error Handling](https://vextjs.github.io/guide/error-handling) and the [App API](https://vextjs.github.io/api/app).

For unexpected runtime errors, detailed stack traces are intended for development and diagnostics:

- In development, you can expose `stack` in JSON by setting `response.hideInternalErrors = false`.
- Browser requests in dev mode can also render the built-in HTML error overlay with stack frames and source context.
- In production, keep `hideInternalErrors` enabled so clients receive a safe `500` response instead of internal details.

## Services

Services live in `src/services/` and are injected into `app.services` by filename:

```ts
// src/services/example.ts
import type { VextApp } from "vextjs";

export default class ExampleService {
  constructor(private app: VextApp) {}

  async greeting(name: string) {
    this.app.logger.info("Generating greeting", { name });
    return { message: `Hello, ${name}! Welcome to VextJS.` };
  }
}
```

Use it from a route:

```ts
const result = await app.services.example.greeting("Vext");
```

Run type generation after changing services or app extensions:

```bash
npx vext typegen
```

Generated declarations are written to `.vext/types/`, with `src/types/generated/index.d.ts` referencing them for TypeScript projects.

## Middleware

Middleware files live in `src/middlewares/` and are referenced by name from route config or global configuration.

```ts
// src/middlewares/auth.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  if (!req.headers.get("authorization")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
});
```

## Plugins

Plugins live in `src/plugins/` and can register lifecycle hooks, resources, and app extensions:

```ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "redis",
  async setup(app) {
    app.extend("redis", {
      async ping() {
        return "PONG";
      },
    });
  },
});
```

For precise app extension typing, export `appExtensions = defineAppExtensions<{ ... }>()` with an inline object generic from the plugin file. Legacy `app.extend()` calls are still scanned automatically as a best-effort fallback. After adding app extensions, run `vext typegen` so TypeScript consumers see the new fields.

## Runtime Hooks

Use `app.hooks.on(name, handler)` to observe or patch framework lifecycle points without replacing core middleware:

```ts
app.hooks.on("validation:success", ({ req, route }) => {
  app.logger.info({ requestId: req.requestId, route: route.path }, "validated");
});

app.hooks.on("response:before", ({ headers }) => ({
  headers: { ...headers, "x-powered-by": "vext" },
}));

app.hooks.on("service:beforeCall", ({ service, method }) => {
  app.logger.debug({ service, method }, "service call");
});
```

Available lifecycle families include request/route, validation, handler, response, error, fetch/proxy, service, cache, plugin, routes, OpenAPI, server, ready, and close. `app.hooks` is a reserved app property and cannot be overwritten with `app.extend("hooks", ...)`.

See the full guide in [Runtime Hooks](https://vextjs.github.io/guide/hooks) and the [App API](https://vextjs.github.io/api/app).

## Adapters

The default adapter is Native Node.js:

```ts
const config = {
  adapter: "native",
};
```

Other adapters are available through package subpaths:

```ts
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
};
```

Install the matching peer dependency before using a non-native adapter:

```bash
npm install hono @hono/node-server
npm install fastify
npm install express
npm install koa @koa/router@^15.6.0
```

## Response Cache

Response cache is enabled at route level:

```ts
app.get(
  "/articles",
  {
    cache: {
      ttl: 60_000,
      key: "articles:list",
    },
  },
  async (_req, res) => {
    res.json(await app.services.article.list());
  },
);
```

The runtime delegates response caching to `response-cache-kit`, backed by `cache-hub`. Vext captures successful JSON responses from GET or HEAD routes, stores them with millisecond TTLs, and serves later hits before validation and handler execution. Cache keys can be static strings or request-based functions; use `partitionKey` for user or tenant isolation.

Configure the runtime in `config.cache`. The legacy Memory shorthand still works:

```ts
export default {
  cache: {
    defaultTtl: 60_000,
    maxEntries: 1000,
    maxMemory: 50 * 1024 * 1024,
  },
};
```

For Redis or multi-level response cache, use the `cacheHub` runtime config:

```ts
export default {
  cache: {
    defaultTtl: 2_000,
    cacheHub: {
      mode: "redis",
      url: "redis://localhost:6379",
      lease: { waitForOwner: 1_000, onTimeout: "fetch" },
      distributed: { channel: "vext:response-cache" },
    },
  },
};
```

## OpenAPI

Enable OpenAPI in config:

```ts
export default {
  openapi: {
    enabled: true,
    title: "My API",
    version: "1.0.0",
    docs: {
      path: "/docs",
      code: {
        enabled: "auto",
      },
    },
  },
};
```

Then visit:

- `http://localhost:3000/docs` for the built-in Vext Docs page.
- `http://localhost:3000/openapi.json` for the generated OpenAPI document.

Route metadata is collected from `docs`, validation declarations, parameters, responses, and route registration data. The default docs UI is served by Vext's first-party HTML + vanilla JavaScript renderer under `/_vext/docs`.

The default renderer focuses on these surfaces:

- HTTP API, Pages, Services, Utils, Models, and discovered Components / Plugins / Middlewares are top-level sections.
- HTTP API and Pages use recursive navigation from OpenAPI path segments.
- Stable resource segments such as `/api/v1/info` stay as categories.
- Each operation leaf prefers `summary`, then falls back to the endpoint path.
- Dynamic path parameters such as `{id}` are visually weakened instead of treated as business categories.
- Middle dynamic segments are preserved when they lead to child resources.
- Built-in docs assets are version-tagged so browser cache does not hide renderer updates.

When a project exposes at least two versioned source groups such as `/api/v1/**`, `/api/v2/**`, `/api/beta/**`, `/v1/**`, `/v2/**`, or `/beta/**`, Vext Docs automatically adds an ordered `All / API v1 / API v2 / API Beta` style source switcher. Numbered versions are listed before named release channels such as `alpha`, `beta`, or `rc`.

Each source loads source-aware `/_vext/docs/openapi.json?source=...`, `code.json?source=...`, and `search.json?source=...` data so search, Overview counts, navigation, deep links, and access-filtered operations stay isolated. Non-`All` sources return only OpenAPI entries by default; Code JSDoc items are included for a source only when that source explicitly defines `code.include` / `code.exclude`.

Projects can override or add source definitions with `openapi.docs.sources`; source `access`, including `source.access.visible`, is also respected by the docs source list and source-aware data endpoints. Every explicit source still needs a `match` pattern because it scopes OpenAPI data. For a code-only source, use a stable non-API namespace such as `/sdk/**` and opt into Code JSDoc with `code.include` / `code.exclude`.

The operation view includes parameters, request bodies, horizontal response status tabs without repeated status headings, resolved schema fields without artificial root rows, search entries, auth/deprecated/Try it out state badges, collapsed operation Metadata, a global Authorize control for OpenAPI security schemes, same-origin Try it out, and Code JSDoc usage recipes.

The Try it out console is organized as tabs for Params, Headers, Body, Samples, History, and Response. It includes server selection that prefers OpenAPI `servers[]`, OpenAPI `servers[].variables` controls, optional same-origin fallback, an optional per-request Custom server input, full resolved URL preview and Copy URL, structured query/header rows generated from OpenAPI parameters including `validate.header`, raw fallbacks, auth status and effective header previews inside the Headers tab, optional browser-side request/response hooks through `openapi.docs.tryItOut.hookScript` / `hookGlobal`, diagnostics, cURL/browser fetch/Node fetch/Axios code samples, request history, and a fixed response viewer with pretty/raw body modes plus the actual request and response headers for the last send.

`hookGlobal` is only the browser lookup name; hook notes and sample diagnostics are shown only when a `hookScript` is configured or the runtime global exposes `beforeRequest` / `afterResponse`.

The UI also supports:

- `openapi.docs.ui.theme` and `openapi.docs.ui.density`;
- keyboard search shortcuts and category search filters;
- a desktop outline on wide screens;
- auto/sidebar resize with persisted manual width;
- a mobile drawer with synchronized search/filter controls;
- responsive field tables on narrow screens;
- incremental rendering for long operation lists;
- copy actions, old single-source hash links, and multi-source `#source=<id>&view=<view>&id=<anchor>` deep links;
- an Overview workspace with counts, source metadata, and package startup / build / verification commands.

Route-level `docs.tags` is deprecated and ignored with a warning; operation tags are inferred automatically from route path/source. Vext no longer auto-generates `x-tagGroups`; explicit `openapi.tagGroups` is only passed through as an OpenAPI vendor extension and is not used by the built-in docs navigation.

`docs.code.enabled` surfaces standard JSDoc and lightweight runtime metadata from `src/services/`, `src/utils/`, the configured models directory, `src/frontend/components/`, `src/plugins/`, and `src/middlewares/` as Services / Utils / Models / Components / Plugins / Middlewares with recursive namespace/source navigation.

Locales / Config / Styles / Preload static source scanning remains available only when explicitly enabled through `openapi.docs.code.*`; it is not part of the default top-level documentation surface.

Models are listed from recognizable model files even when no JSDoc is present. Root-level models are shown directly under Models, nested model files are grouped by source directory, and the default UI statically reads model definitions to show registry key, name, collection, connection, schema fields, enums, options, indexes, methods, hooks, and usage without importing or executing model code.

Plugins and middlewares show bootstrap/lifecycle, app extension, middleware type, route usage, and source links when they can be inferred from source text.

On local loopback docs pages, code docs entries can show an `Open source` link that redirects to `vscode://file/...`; non-local access hides that link. In `vext start`, Code JSDoc prefers `<project>/src` when source files are present and falls back to the runtime directory when only built output is available. External documentation tools should consume `/openapi.json` directly instead of using a Vext renderer hook.

Custom source surfaces can be configured when the automatic version selector is not enough:

```ts
export default {
  openapi: {
    docs: {
      sources: [
        {
          id: "public-v1",
          label: "Public v1",
          match: ["/api/v1/**"],
          default: true,
        },
        {
          id: "admin-v1",
          label: "Admin v1",
          match: ["/admin/v1/**"],
          access: "admin",
        },
        {
          id: "internal-v1",
          label: "Internal v1",
          match: ["/internal/v1/**"],
          access: { visible: false },
        },
        {
          id: "sdk",
          label: "SDK",
          match: ["/sdk/**"],
          code: {
            include: ["services/sdk", "models/*"],
            exclude: ["*internal*"],
          },
        },
      ],
    },
  },
};
```

`source.access` is passed to `openapi.docs.access.resolver` as a `kind: "source"` descriptor. `source.access.visible: false` hides a source before resolver execution. `source.code.include` / `source.code.exclude` opt a non-`All` source into Code JSDoc items. Code filters match each item's id, title, and source file, so path-like patterns such as `models/*` and `services/sdk/**` can be used for common source-file scopes.

`openapi.docs.assetsPath` is the internal route prefix registered by Vext for docs assets and source-aware data endpoints. `openapi.docs.assetsPublicPath` can be different when a reverse proxy strips a public prefix, so the browser fetches `/admin/_vext/docs/*` while Vext still registers `/_vext/docs/*`. `openapi.jsonPublicPath` remains the public canonical `/openapi.json` path for external tools and metadata; the built-in source-aware docs UI fetches `openapi.docs.assetsPublicPath` endpoints.

Try it out request hooks run only in the browser docs page. A minimal hook script looks like this:

```js
// public/docs-hook.js
window.VextDocsHooks = {
  beforeRequest({ request, path }) {
    return {
      headers: {
        ...request.headers,
        "x-docs-signature": "demo-" + path,
      },
    };
  },
  afterResponse({ response }) {
    return {
      diagnostics: ["status: " + response.status],
    };
  },
};
```

Enable it with `openapi.docs.tryItOut.hookScript = "/docs-hook.js"` and optionally change the lookup name with `hookGlobal`.

Try it out server behavior can be tuned separately from the OpenAPI `servers[]` metadata:

```ts
export default {
  openapi: {
    servers: [
      {
        url: "http://127.0.0.1:3000",
        description: "Local development server",
      },
      { url: "https://api.example.com", description: "Production" },
    ],
    docs: {
      tryItOut: {
        defaultServer: "first", // "first", "same-origin", "custom", or an exact server URL
        sameOrigin: "auto", // auto shows Same origin only when no OpenAPI servers exist
        customServer: true,
        customServerUrl: "http://127.0.0.1:3000",
      },
    },
  },
};
```

For fixed local or deployed endpoints, prefer a complete server URL including its port. Reserve OpenAPI `servers[].variables` for genuinely variable parts such as environment names, regions, tenants, or API versions.

## i18n

Put locale files in `src/locales/`:

```ts
// src/locales/en-US.ts
export default {
  validation: {
    required: "This field is required.",
  },
};
```

The runtime automatically loads locale files during bootstrap. In development, locale changes trigger the service/i18n reload path.

## Development Hot Reload

`vext dev` chooses the smallest safe reload strategy:

| Change type                                    | Strategy              |
| ---------------------------------------------- | --------------------- |
| Route files                                    | Hot route replacement |
| Service or locale files                        | Service/i18n reload   |
| Frontend files or public assets                | Frontend rebuild      |
| Config, plugin, preload, env, or package files | Cold restart          |

TypeScript projects are compiled into `.vext/dev/` during development.

## Build And Start

```bash
npm run build
npm start
```

`vext build` refreshes generated types and manifest files before compiling TypeScript source and project-level preload files. When `frontend.enabled` is true, it also bundles the browser client and writes `dist/client/manifest.json`, `dist/client/render-manifest.json`, `dist/client/deploy-manifest.json`, `dist/client/size-report.json`, `dist/client/index.html`, and API contract artifacts. The render manifest includes route initial assets used by SSR modulepreload; production `vext start` fails fast when that schema is missing and asks you to rebuild instead of serving stale frontend output. `vext start` runs the production bootstrap path, can read compiled preload files from `dist/preload/`, and serves the frontend build when present.

For TypeScript projects, run `vext build` before `vext start`. Development should use `vext dev`; production start does not fall back to a TypeScript runtime.

## Testing Utilities

VextJS exports testing helpers through `vextjs/testing`:

```ts
import { createTestApp } from "vextjs/testing";
```

Use the testing entry for integration tests that need the framework runtime without starting a real production process. Rate limiting, access logs, and Session are quiet/disabled by default, but explicit `config.*.enabled: true` values run the same built-in middleware contracts as production and development.

## Documentation

- Documentation site: <https://vextjs.github.io/vext/>
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Detailed release notes: [changelogs/](./changelogs/)
- Issues: <https://github.com/vextjs/vext/issues>

## Requirements

- Node.js `>=20.19.0`
- ESM application packages

## License

Apache-2.0

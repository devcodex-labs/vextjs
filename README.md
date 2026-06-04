# VextJS

VextJS is a high-performance Node.js framework for building maintainable backend services. It combines a convention-based project structure, file-system routing, typed services, plugins, middleware, validation, OpenAPI generation, route-level caching, and a CLI workflow that keeps projects productive from the first command.

## Why VextJS

- Convention-based structure for routes, services, middleware, plugins, config, locales, generated types, and preload scripts.
- File-system routing with dynamic params, nested routes, validation, middleware, OpenAPI metadata, and response helpers.
- Adapter support for Native Node.js, Hono, Fastify, Express, and Koa.
- Automatic service injection through `app.services`.
- Plugin lifecycle hooks with app extension support.
- Built-in request context, request id, access logging, body limit, error handling, i18n, and OpenAPI endpoints.
- Built-in `app.fetch` with timeout/retry/requestId propagation and config-driven `app.fetch.proxy` response passthrough.
- Route-level response cache with LRU memory storage.
- Hot development workflow with route hot swap, service/i18n reload, and cold restart only when required.
- Type generation for service and plugin app extensions.
- Process-level preload support for OpenTelemetry, APM, polyfills, and startup bridges.

## Quick Start

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

Open `http://localhost:3000`. The scaffold includes a root route and a health check so the project is runnable immediately.

Create a project with another adapter:

```bash
npx vextjs create my-app --adapter hono
```

Create a JavaScript project:

```bash
npx vextjs create my-app --js
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
    "vextjs": "^0.3.16"
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
|-- src/
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
|           `-- .gitkeep
|-- package.json
`-- tsconfig.json
```

JavaScript projects use `.js` files and do not create `src/types/generated/`.

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
vext start            # Start the production server
vext create <name>    # Create a new project
vext typegen          # Generate service and app extension types
vext stop             # Stop cluster workers
vext reload           # Rolling restart for cluster workers
vext status           # Inspect cluster status
```

`vext create` options:

```bash
vext create my-app
vext create my-app --js
vext create my-app --adapter hono
vext create my-app --adapter fastify
vext create my-app --adapter express
vext create my-app --adapter koa
vext create my-app --adapter native
vext create my-app --skip-install
vext create my-app --force
```

## Configuration

Configuration is loaded and merged in this order:

```text
framework defaults -> default -> NODE_ENV file -> local -> bootstrap provider patch -> CLI override
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
  },
  server: {
    requestTimeout: 120_000,
    headersTimeout: 60_000,
    keepAliveTimeout: 5_000,
  },
  openapi: {
    enabled: true,
  },
};

export default config;
```

Environment files can return partial config:

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

Use `config.server` for inbound Node.js HTTP server settings such as request, headers, keep-alive, socket timeout, request header size, max requests per socket, and incomplete-request checking interval. It applies to the built-in Native, Hono, Fastify, Express, Koa adapters and the dev server; omitted fields keep the current Node.js defaults. This is separate from `config.fetch.timeout`, which only controls outbound `app.fetch` calls.

## Startup Config Providers

Use `src/config/bootstrap.ts` when configuration must be fetched before the final app config is validated and frozen:

```ts
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      async load({ env, signal }) {
        const response = await fetch(`https://config.example.com/${env}.json`, {
          signal,
        });
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

Generated declarations are written to `src/types/generated/`.

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

After adding app extensions, run `vext typegen` so TypeScript consumers see the new fields.

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
npm install koa @koa/router
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
  },
};
```

Then visit:

- `http://localhost:3000/docs`
- `http://localhost:3000/openapi.json`

Route metadata is collected from `docs`, validation declarations, parameters, responses, and route registration data.

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
| Config, plugin, preload, env, or package files | Cold restart          |

TypeScript projects are compiled into `.vext/dev/` during development.

## Build And Start

```bash
npm run build
npm start
```

`vext build` compiles TypeScript source and project-level preload files. `vext start` runs the production bootstrap path and can read compiled preload files from `dist/preload/` when the root `preload/` directory is not present.

## Testing Utilities

VextJS exports testing helpers through `vextjs/testing`:

```ts
import { createTestApp } from "vextjs/testing";
```

Use the testing entry for integration tests that need the framework runtime without starting a real production process.

## Documentation

- Documentation site: <https://vextjs.github.io/vext/>
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Detailed release notes: [changelogs/](./changelogs/)
- Issues: <https://github.com/vextjs/vext/issues>

## Requirements

- Node.js `>=18.0.0`
- ESM application packages

## License

Apache-2.0

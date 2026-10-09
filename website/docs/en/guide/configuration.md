# Configuration

This page explains where configuration is loaded, how layers merge, and how
to verify the effective values. For your first project, see
[Quick Start](/guide/quick-start). Work through the complete example below
without external services before reading the loading mechanism and individual
settings. See [Configuration API](/api/config) for exact signatures and all
nested fields. Each later code block is an independent fragment to merge into
existing configuration, not a replacement for the entire file.

## Complete example

Start with a TypeScript project from [Quick Start](/guide/quick-start).
It needs `dev`, `build` (including `--typecheck`), and `start` npm scripts.
Merge the following configs into the corresponding files and add the
diagnostic route. To reproduce these results, use an isolated practice
project with the scaffold's empty `bootstrap.ts`, so an existing provider
or other profile does not alter the example.

Only fields needed for this verification are explicit; the rest use framework
defaults. No external service is connected. See the sections below and
[Configuration API](/api/config) for the full field reference.

```typescript
// src/config/default.ts
export default {
  port: Number(process.env.PORT) || 3000,
  host: "0.0.0.0",
  logger: { level: "info" },
  openapi: { enabled: true, title: "My App API", version: "1.0.0" },
  frontend: { enabled: false },
  // Custom field demonstrates merging; Vext does not connect to Redis.
  redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
};
```

```typescript
// src/config/production.ts
export default {
  logger: { level: "warn" },
  cors: { origins: ["https://myapp.com"], credentials: true },
  openapi: { enabled: false },
  // The logger's warn level suppresses ordinary info/debug access logs;
  // 5xx logs are still promoted to error.
  accessLog: { level: "info", warnOn4xx: true },
  cluster: {
    enabled: false, // Single process for this example; see Cluster below.
  },
};
```

```typescript
// src/config/local.ts
export default {
  port: 8080,
  redis: {
    url: "redis://localhost:6380",
  },
};
```

```typescript
// src/routes/config-info.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    res.json({
      port: app.config.port,
      logLevel: app.config.logger.level,
      docsEnabled: app.config.openapi.enabled,
    });
  });
});
```

1. Clear prior PORT, VEXT_PORT/VEXT_HOST, VEXT_CONFIG, and similar overrides
   in the terminal, or use a clean one. Run `npm run dev`. Request
   `http://127.0.0.1:8080/config-info`: expect 200 and `data` containing
   `port=8080`, `logLevel=info`, and `docsEnabled=true`. This proves
   `local.ts` applies in development.
2. Stop dev, run `npm run build`, then `npm start`. Request
   `http://127.0.0.1:3000/config-info`: expect 200 with `port=3000`,
   `logLevel=warn`, and `docsEnabled=false`. This proves the production
   override applies and `local.ts` does not.
3. Stop the service and run `npm start -- --port 3100`. Request port 3100
   and expect `port=3100`, verifying CLI override priority. Stop this service
   after verification.

Expose only these three non-sensitive diagnostic fields. Do not return the
whole `app.config` as an application endpoint. The listening host may be
`0.0.0.0` or `::`; it is not the public base URL. Deployment behind a
proxy or CDN determines that address, which cannot be inferred from host and
port alone.

VextJS merges multiple configuration layers to support environment-specific
overrides and built-in framework settings.

## Configuration loading mechanism

When the framework starts, `config-loader` loads configuration files and merges them deeply in the following order:

```
Framework built-in defaults → default.ts → {configProfile}.ts → local.ts (development/test only) → bootstrap provider patch → CLI override
```

Runtime merging lets later layers declare only the fields they override. TypeScript intentionally distinguishes the project base from those later patches: `default.ts` uses `VextUserConfig`, while environment profile and local config files use `VextConfigOverride`; `createTestApp()` applies the same override contract. Bootstrap providers keep their JSON-like `Record<string, unknown>` patch contract and runtime validation.

When loading TypeScript config sources directly, the framework compiles them without requiring an additional TS loader. Modules execute in the current application process, support top-level `await`, and their exported provider functions retain access to that process's state. Evaluation of the same TS config module is reused within one process. `import.meta.url` / `filename` / `dirname` identify the module's source location. The framework manages temporary execution files and cleans them after successful or failed loading; externally modified files are preserved and reported as conflicts. Compiled production mode continues to load config artifacts from the selected build output.

### Configuration file

| File                        | Purpose                                                                           | Is it necessary |
| --------------------------- | --------------------------------------------------------------------------------- | --------------- |
| `src/config/default.ts`     | Basic configuration for all environments                                          | ✅ Required     |
| `src/config/development.ts` | Development profile override (`vext dev` default)                                 | Optional        |
| `src/config/production.ts`  | Production profile override; build default, start fallback without build metadata | Optional        |
| `src/config/test.ts`        | Test profile override                                                             | Optional        |
| `src/config/local.ts`       | Local development coverage (should be added to `.gitignore`)                      | Optional        |
| `src/config/bootstrap.ts`   | Startup provider registration entrance                                            | Optional        |

Explicit profile selection follows `--config <name>` → `VEXT_CONFIG=<name>` → the legacy nonstandard `NODE_ENV` value (with a warning). Without an explicit selection, `vext build` defaults to `production` and `vext dev` to `development`. `vext start` and `vext deploy assets` first inherit the profile recorded in the selected successful build output, falling back to `production` only when no profile is recorded.

For example, after `npm run build -- --config sg-sit` in a clean terminal, `npm start` inherits `sg-sit` while still running in production mode. To use another profile, select it explicitly and confirm its configuration file is included in the output. See [CLI](./cli) for commands and build identity checks.

An explicit CLI profile takes priority over `VEXT_CONFIG`. A nonstandard
`NODE_ENV` name still has a legacy compatibility route with a warning; use
an explicit profile instead. Standard `NODE_ENV` does not replace each
command's default mode. A profile name may contain only letters, digits,
underscores, and hyphens; `default`, `local`, and `bootstrap` are reserved.
Do not pass a file path.

Profile names can represent custom deployment environments, for example:

- `src/config/sg-sit.ts`
- `src/config/us-uat.ts`
- `src/config/us-prod.ts`

Pass the profile name at startup:

```bash
npm start -- --config sg-sit
VEXT_CONFIG=sg-sit npm start
```

The second line uses POSIX shell syntax. In PowerShell, set
`$env:VEXT_CONFIG = "sg-sit"` before the command, or use the cross-shell
`--config` option. The examples use `.ts`; the loader also supports `.js`,
`.mjs`, and `.cjs`.

This production start uses `default -> sg-sit -> bootstrap provider patch -> CLI override`. `local.ts` is loaded only in development/test runtime modes. Production build and start, for both JS sources and compiled TS, do not implicitly evaluate it. Use an explicit profile or bootstrap provider for deployment overrides; a custom profile does not change the runtime mode.

:::warning Build, Runtime, and Config Profile semantics
`vext build` statically injects `process.env.NODE_ENV` in user source code as `"production"`, and `vext start` runs with production runtime mode. Config profile selection is independent and is controlled by `--config` / `VEXT_CONFIG`.

Therefore, it is recommended to put the environmental differences into:

- `src/config/<env>.ts`
- `src/config/bootstrap.ts`
- Other explicit business environment variables

Instead of relying on the `process.env.NODE_ENV` conditional branch in the source code after build.
:::

### Merge rules

- **Plain object fields**: deep merge; later layers declare only overrides. Class instances and runtime capabilities are atomic and cannot be recursively patched.
- **`middlewares` array**: smart patch by `name` instead of replacing the whole array.
- **Other arrays**: later layers replace earlier arrays.
- **Bootstrap provider patch**: participates in merge, validation, and freezing after `local.ts` and before the CLI override.
- **Final result**: plain config objects and arrays are deeply frozen. Runtime-capability instances retain their internal mutable state and are not recursively frozen.

### TypeScript base and override layers

- **Base config (`default.ts`)**: use `VextUserConfig`. Its top-level fields are optional, but a nested object you provide is not automatically a deep partial. For example, a `database` value in `default.ts` must satisfy the complete `MonSQLizeDatabaseConfig`, including its required `config` connection object.
- **Override layers**: use `VextConfigOverride` in `development.ts`, `production.ts`, custom profiles, and `local.ts`. It mirrors runtime deep-merge semantics, so a later layer may patch only `database.findLimit` or `logger.level` while inheriting the rest from the complete base.
- **Atomic capabilities**: adapters, stores, callbacks, arrays, and registered runtime-capability paths remain complete values rather than being recursively weakened.

Do not split a required base object across files and expect TypeScript to wait for a later merge. A half `database` in `default.ts` is invalid even if `development.ts` supplies its `uri`; put a complete database connection in the base, then patch only environment differences in later layers. See [Database configuration](./database#multiple-environment-configuration).

### Bootstrap Config Provider

If you need to pull the remote configuration (such as Nacos/Configuration Center/Startup Key Distribution) before finalizing the configuration, you can add `src/config/bootstrap.ts`:

```typescript
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      timeoutMs: 10_000,
      async load({ configProfile, baseConfig, signal }) {
        const response = await fetch(
          `https://config.example.com/${configProfile}`,
          { signal },
        );

        const remote = await response.json();
        return {
          database: remote.database,
          logger: {
            lifecycleLevel: baseConfig.logger?.lifecycleLevel ?? "concise",
          },
        };
      },
    },
  ],
});
```

Provider context fields:

| Field                   | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `mode`                  | Current runtime mode: development, production, or test.                          |
| `configProfile`         | Selected config profile; it can differ from `mode`.                              |
| `env`                   | Deprecated compatibility alias; use `mode` or `configProfile` to express intent. |
| `baseConfig`            | Read-only merged default/profile/local config available when computing a patch.  |
| `signal`                | `AbortSignal` aborted on timeout or cancellation.                                |
| `rootDir` / `configDir` | Current project and config directory paths.                                      |
| `command` / `isBuilt`   | Current command and whether compiled output is in use.                           |

`dev` and `build` evaluate configuration once from `src/config` before backend compilation so custom frontend paths are known in advance. Their provider context uses the source configuration directory and `isBuilt=false`. Backend compilation, frontend builds, and development watching reuse that configuration instead of calling providers again for paths. A compiled `start` still uses the output configuration directory and `isBuilt=true`; `isBuilt` does not mean that the current command is `build`.

Constraints:

- provider must return **plain object patch** or `null`
- patch only supports JSON-like structure; **does not support** functions, class instances, and adapter factory
- Default priority: `local < provider < CLI`
- When `required` is not declared: `production` defaults to fail-fast, `development/test` defaults to continue after warning
- In Cluster mode, the Master will pass the current round of provider patches to the Worker for reuse to avoid configuration drift in the same startup cycle.

Timeout aborts the signal but cannot forcibly terminate arbitrary user async
work. Pass that signal to network operations inside providers. Replace the
placeholder remote URL with a real service; it is not required by the opening
complete example.

### Configuration file format

Export one object per configuration file using `export default`:

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 3000,
  host: "0.0.0.0",
  logger: {
    level: "info",
    lifecycleLevel: "concise",
  },
  cors: {
    origins: ["*"],
  },
  openapi: {
    enabled: true,
  },
  session: {
    name: "vext.sid",
    ttl: 86400,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: "auto",
    },
  },
  csrf: {
    enabled: false,
  },
  securityHeaders: {
    enabled: false,
    preset: "basic",
  },
};

export default config;
```

```typescript
// src/config/production.ts — only overwrite the fields that need to be changed
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  logger: {
    level: "warn", //Reduce log output in production environment
  },
  cors: {
    origins: ["https://myapp.com"], // Production environment restricted origins
  },
  openapi: {
    enabled: false, // Close the document in production environment
  },
};

export default config;
```

```typescript
// src/config/local.ts — special configuration for local development (do not submit to Git)
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  port: 8080, // Use other ports locally
};

export default config;
```

`config.session.enabled: true` auto-registers Session across production, development, testing, and soft reload. It defaults to `false`; the built-in memory store is suitable for single-process deployments. Shared deployments should set `config.session.store` to `createCacheSessionStore(cacheLike)` or a custom `VextSessionStore`. Route options can use `session: false` to opt out or `session: true` to opt in while the global runtime is disabled. The explicit `session()` middleware remains available for scoped/manual registration.

`config.csrf.enabled: true` auto-registers the built-in CSRF middleware after body parsing and plugin global middleware. Keep it disabled and register `csrf()` manually when you need scoped protection for selected paths.

`config.securityHeaders.enabled: true` auto-registers low-impact browser security response headers. Use `preset: "basic"` for the default baseline, and opt into `strict` or explicit CSP/COEP only after checking your frontend, CDN, iframe, and OAuth popup flows.

### Middlewares Patch Strategy

The `middlewares` array merges by middleware `name`:

Each layer may declare a middleware name only once. A duplicate in one file
fails startup. A later profile/local layer may patch an earlier declaration.
`{ name, enabled: false }` keeps the name registered as a no-op and does not
look up or run the original middleware file. The disabled name remains
referenceable, but a route must not pass `options` to it: the no-op is plain
middleware, not a factory.

Declarations with the same name merge shallowly: a later `options` value
replaces the whole earlier `options` object. An empty array does not delete
the inherited whitelist; use `enabled: false` for an existing item. The
`auth`, `check-role`, and `rate-limit-api` names below require actual
implementations. A whitelist declaration does not create middleware.

```typescript
// src/config/default.ts
export default {
  middlewares: [
    "auth",
    { name: "check-role", options: { roles: ["user"] } },
    { name: "rate-limit-api", options: { max: 100 } },
  ],
};
```

```typescript
// src/config/development.ts
export default {
  middlewares: [
    // Just declare the middleware to be overridden and leave the rest
    { name: "check-role", options: { roles: [] } }, // Factory defines what an empty roles array means.
    { name: "rate-limit-api", options: { max: 10000 } }, // Relax the rate limit
  ],
};
```

Merged result:

```typescript
middlewares: [
  "auth", // reserved
  { name: "check-role", options: { roles: [] } }, // overridden
  { name: "rate-limit-api", options: { max: 10000 } }, // overridden
];
```

## Use Adapter

Native Adapter (`http.createServer` + `route-core`) is the default. To use
another Adapter, install its optional dependency as described in the
[Adapter guide](/guide/adapters), then merge one of the following four
alternative snippets into `default.ts`:

```typescript
// src/config/default.ts — using Hono Adapter
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — using Fastify Adapter
import { fastifyAdapter } from "vextjs/adapters/fastify";

export default {
  adapter: fastifyAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — using Express Adapter
import { expressAdapter } from "vextjs/adapters/express";

export default {
  adapter: expressAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — using Koa Adapter
import { koaAdapter } from "vextjs/adapters/koa";

export default {
  adapter: koaAdapter(),
  port: 3000,
};
```

:::tip
When `adapter` is omitted, Vext uses the Native adapter, which has no third-party HTTP framework dependency. Switch when you need another framework's capabilities or a migration path. Throughput varies by workload, so review the [current benchmarks](/benchmark) and test your application before deciding.
:::

## Frontend configuration (`frontend`)

`frontend` controls the built-in browser pipeline. It can be `true`, `false`,
or an object. The following combination of optional features assumes pages,
styles, and locale resources from the [Frontend guide](/frontend/overview).
The `admin/app/shell` page must actually exist. To enable only defaults, use
`frontend: true` instead of copying the entire snippet.

```typescript
export default {
  frontend: {
    enabled: true,
    framework: "react",
    root: "src/frontend",
    publicDir: "public",
    publicPath: "/",
    styles: {
      jscss: {
        enabled: true,
      },
    },
    i18n: {
      enabled: true,
      defaultLocale: "en-US",
    },
    spaFallback: {
      scopes: [
        {
          basePath: "/admin/app",
          page: "admin/app/shell",
          exclude: ["/admin/api/**"],
        },
      ],
    },
    apiClient: {
      enabled: true,
    },
    build: {
      target: "es2022",
      minify: true,
      sourcemap: false,
      client: {
        external: [],
        externalRuntime: {},
      },
      vendorChunks: {
        enabled: true,
      },
      budgets: {
        maxTotalBytes: 5_000_000,
      },
    },
    deploy: {
      integrity: true,
      upload: {
        enabled: false,
        adapter: "filesystem",
        targetDir: ".vext/deploy/frontend-assets",
        prefix: "my-app",
        exclude: ["**/*.map"],
      },
    },
  },
};
```

| Configuration item                      | Type                 | Default value                                      | Description                                                              |
| --------------------------------------- | -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| `frontend.enabled`                      | `boolean`            | `false`                                            | Enable built-in frontend integration                                     |
| `frontend.framework`                    | `string`             | `'react'`                                          | Frontend framework label                                                 |
| `frontend.root`                         | `string`             | `'src/frontend'`                                   | Frontend source directory                                                |
| `frontend.entry`                        | `string`             | `'.vext/generated/frontend/browser-entry.tsx'`     | Generated browser entry; usually not written by hand                     |
| `frontend.indexHtml`                    | `string`             | `'src/frontend/pages/_document.html'`              | HTML document template                                                   |
| `frontend.outDir`                       | `string`             | `.vext/client` in dev, `dist/client` in production | Frontend output directory                                                |
| `frontend.styles.jscss`                 | `boolean \| object`  | `{ enabled: true }`                                | Vext JSCSS build-time CSS extraction and dynamic CSS variables           |
| `frontend.publicDir`                    | `string`             | `'public'`                                         | Static asset directory copied into output and deploy manifest            |
| `frontend.publicPath`                   | `string`             | `'/'`                                              | Public asset path prefix                                                 |
| `frontend.spaFallback`                  | `boolean \| object`  | `{ scopes: [] }`                                   | Serve fallback only for explicitly declared client-router sub-app scopes |
| `frontend.apiClient`                    | `boolean \| object`  | `true`                                             | Generate client contract artifacts                                       |
| `frontend.build.target`                 | `string \| string[]` | `'es2022'`                                         | Browser build target                                                     |
| `frontend.build.minify`                 | `boolean`            | Production `true`                                  | Minify frontend output                                                   |
| `frontend.build.sourcemap`              | `boolean`            | Development `true`                                 | Generate frontend source maps                                            |
| `frontend.build.server.minify`          | `boolean`            | `false`                                            | SSR renderer minification; intentionally independent from browser output |
| `frontend.build.server.sourcemap`       | `boolean`            | Development `true`                                 | SSR renderer source-map setting                                          |
| `frontend.build.diagnostics.sizeReport` | `boolean`            | `true`                                             | Write `size-report.json` under the effective `frontend.outDir`           |
| `frontend.build.client.external`        | `string[]`           | `[]`                                               | Browser bundle external modules                                          |
| `frontend.build.client.externalRuntime` | `object`             | `{}`                                               | Import map URL mapping for externalized browser modules                  |
| `frontend.build.vendorChunks`           | `boolean \| object`  | `{ enabled: true }`                                | Shared dependency chunk management                                       |
| `frontend.build.budgets`                | `object`             | All `0`                                            | Build size budgets; `0` disables a budget                                |
| `frontend.build.assets.inlineLimit`     | `number`             | `0`                                                | Imported image/font inline limit                                         |
| `frontend.build.css.modules`            | `boolean`            | `true`                                             | Supports the `.module.css` CSS Modules convention                        |
| `frontend.deploy.assetBaseUrl`          | `string`             | None                                               | Absolute CDN prefix for frontend static assets                           |
| `frontend.deploy.integrity`             | `boolean`            | `false`                                            | Inject SRI integrity for JS/CSS tags                                     |
| `frontend.deploy.upload`                | `boolean \| object`  | `{ enabled: false, exclude: ["**/*.map"] }`        | Static asset upload and incremental deployment configuration             |
| `frontend.deploy.upload.adapter`        | `string \| object`   | `'filesystem'`                                     | Built-in local staging adapter, `mock`, or an explicit custom adapter    |
| `frontend.deploy.upload.stateFile`      | `string`             | `.vext/deploy/frontend-assets-state.json`          | Incremental upload history; keep it outside `frontend.outDir`            |

By default `spaFallback.scopes` is empty, so unknown HTML paths are not swallowed into the SPA. For mixed SSR + client-router sub-apps, declare each `basePath` in `scopes[]`. `spaFallback: true` is kept only as a compatibility shorthand and is not recommended for enterprise mixed projects.

When `frontend.deploy.upload` is enabled, `vext deploy assets` reads the
deploy manifest from the effective selected frontend output (by default
`dist/client/deploy-manifest.json`) and uploads changed assets by `uploadKey`
and sha256. The built-in `filesystem` adapter writes to `targetDir` for CDN
sync staging; a custom adapter handles a real cloud provider. By default,
upload excludes `index.html` and `**/*.map`: Vext still renders HTML on the
server, while source maps can remain on the server for debugging instead of
being published as CDN assets.

This table is a general-configuration overview. For an exact nested field, resolved default, build-output topology, or CDN/upload decision, use [Frontend Configuration](/frontend/configuration) and the canonical [VextFrontendConfig API reference](/api/config#vextfrontendconfig). For creating the app, changing pages, adding components, CSS/JSCSS, assets, API calls, HTML templates, and troubleshooting, see the [Frontend guide](/frontend/overview).

## Complete configuration item reference

This section lists common fields and defaults. For cache, fetch, locale,
Session/CSRF, and other nested options, use [Configuration API](/api/config)
as the complete reference. Setting an individual parameter does not
necessarily enable its feature.

### Basic configuration

| Configuration item | Type                                | Default value        | Description                                                    |
| ------------------ | ----------------------------------- | -------------------- | -------------------------------------------------------------- |
| `port`             | `number`                            | `3000`               | HTTP listening port                                            |
| `host`             | `string`                            | `'0.0.0.0'`          | HTTP listening address                                         |
| `adapter`          | `string \| Function \| VextAdapter` | `'native'`           | Low-level adapter                                              |
| `trustProxy`       | `boolean`                           | `false`              | Whether to trust the proxy (affects `req.ip` / `req.protocol`) |
| `frontend`         | `boolean \| object`                 | `{ enabled: false }` | Built-in frontend build and static serving configuration       |

```typescript
export default {
  port: 3000,
  host: "0.0.0.0",
  trustProxy: false,
};
```

In production or containers, `host: "0.0.0.0"` listens on all IPv4
interfaces, while `host: "::"` listens on all IPv6 interfaces. For `::`,
the ready log also displays `http://[::1]:PORT` and a bracketed IPv6
network URL. A specific IPv6 host is shown as `http://[IPv6]:PORT`.

Production or container deployments can use `host: "0.0.0.0"` for IPv4 all interfaces, or `host: "::"` for IPv6 all interfaces. When `host: "::"` is used, the ready log also prints `http://[::1]:PORT` and bracketed IPv6 Network URLs; explicit IPv6 hosts are printed as `http://[IPv6]:PORT`.

### CORS configuration (`cors`)

| Configuration item | Type       | Default value                                            | Description                           |
| ------------------ | ---------- | -------------------------------------------------------- | ------------------------------------- |
| `cors.enabled`     | `boolean`  | `true`                                                   | Whether to enable CORS middleware     |
| `cors.origins`     | `string[]` | `['*']`                                                  | List of allowed origins               |
| `cors.methods`     | `string[]` | `['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']` | Allowed HTTP methods                  |
| `cors.headers`     | `string[]` | `['Content-Type','Authorization','X-Request-Id']`        | Allowed request headers               |
| `cors.credentials` | `boolean`  | `false`                                                  | Whether to allow carrying credentials |

```typescript
export default {
  cors: {
    origins: ["https://myapp.com"], // Production environment restriction origins (array format)
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
};
```

### Rate limiting configuration (`rateLimit`)

| Configuration item  | Type                 | Default value         | Description                                            |
| ------------------- | -------------------- | --------------------- | ------------------------------------------------------ |
| `rateLimit.enabled` | `boolean`            | `false`               | Whether to install global throttling                   |
| `rateLimit.max`     | `number`             | `100`                 | Maximum number of requests within the time window      |
| `rateLimit.window`  | `number`             | `60`                  | Time window (seconds)                                  |
| `rateLimit.message` | `string`             | `'Too Many Requests'` | Rate limiting response message                         |
| `rateLimit.keyBy`   | `string \| function` | `'ip'`                | Built-in dimension or synchronous request key function |
| `rateLimit.store`   | `string \| object`   | `'memory'`            | Memory or Redis store                                  |

```typescript
export default {
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60, // 1 minute (unit: seconds)
    message: "Too many requests, please try again later",
    keyBy: "ip",
  },
};
```

When disabled or omitted, Vext does not install the middleware and emits no
rate-limit headers or HTTP 429 responses. `app.setRateLimiter()` replaces the
implementation only; it does not change this opt-in setting.

`keyBy: "user"` reads `req.user.id` and falls back to IP when unavailable.
Global rate limiting runs before ordinary authentication middleware, so it
does not automatically isolate quotas by `req.auth`. For Redis, route
overrides, and custom implementations, see [Rate limiting](/guide/rate-limit).

:::tip Route-level rate limit overrides
With global rate limiting enabled, a route can set
`options.override.rateLimit`. The following snippet belongs inside a
`defineRoutes` callback; `handler` stands for an existing handler:

```typescript
app.post(
  "/login",
  {
    override: {
      rateLimit: { max: 5, window: 60 }, // The login interface is more strict (window unit: seconds)
    },
  },
  handler,
);

app.get(
  "/health",
  {
    override: {
      rateLimit: false, // Health check does not limit the flow
    },
  },
  handler,
);
```

:::

### Security Headers configuration (`securityHeaders`)

| Configuration item                      | Type                              | Default value    | Description                                  |
| --------------------------------------- | --------------------------------- | ---------------- | -------------------------------------------- |
| `securityHeaders.enabled`               | `boolean`                         | `false`          | Whether to auto-register security headers    |
| `securityHeaders.preset`                | `"basic" \| "strict" \| "custom"` | `"basic"`        | Header preset                                |
| `securityHeaders.hsts`                  | `false \| object`                 | `false` in basic | HTTPS-only HSTS configuration                |
| `securityHeaders.contentSecurityPolicy` | `false \| string \| object`       | `false`          | CSP or CSP report-only configuration         |
| `securityHeaders.permissionsPolicy`     | `false \| string \| object`       | `false` in basic | Permissions-Policy configuration             |
| `securityHeaders.headers`               | `Record<string, string>`          | `{}`             | Custom headers merged after preset fields    |
| `securityHeaders.skipPaths`             | `string[]`                        | `[]`             | Exact paths or trailing-`*` prefixes to skip |

```typescript
export default {
  securityHeaders: {
    enabled: true,
    preset: "basic",
    headers: {
      "X-App-Security": "vext",
    },
  },
};
```

`basic` sends `X-Content-Type-Options`, `Referrer-Policy`, and `X-Frame-Options`. `strict` additionally enables HTTPS-only HSTS, minimal `Permissions-Policy`, COOP, and CORP; CSP and COEP remain explicit. Routes can opt out with `{ securityHeaders: false }`.

### Request ID configuration (`requestId`)

| Configuration item         | Type           | Default value       | Description                                |
| -------------------------- | -------------- | ------------------- | ------------------------------------------ |
| `requestId.enabled`        | `boolean`      | `true`              | Whether to enable request ID               |
| `requestId.header`         | `string`       | `'x-request-id'`    | Header used to read a forwarded request ID |
| `requestId.responseHeader` | `string`       | `'x-request-id'`    | Header used to return the request ID       |
| `requestId.generate`       | `() => string` | `crypto.randomUUID` | Custom ID generation function              |

```typescript
export default {
  requestId: {
    enabled: true,
    header: "x-request-id",
  },
};
```

By default, the framework reads `X-Request-Id`, calls the generator when
the value is missing or empty, and writes the ID into the response header.
An incoming or generated ID must be a string of 1–512 characters without
control characters or an error is thrown. For an array-valued header, only
the first value is used. This correlates requests; it is not automatically
a distributed tracing traceId.

### Log configuration (`logger`)

| Configuration item        | Type                            | Default value                  | Description                                                                                                                                             |
| ------------------------- | ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logger.level`            | `string`                        | `'info'`                       | Log level                                                                                                                                               |
| `logger.lifecycleLevel`   | `'concise' \| 'verbose'`        | `'concise'`                    | Framework life cycle log detail level: startup, loader, hot reload, cluster and other system logs                                                       |
| `logger.pretty`           | `boolean`                       | Development environment `true` | Whether to use the built-in pretty formatter to output a readable format; the production environment is turned off by default (output JSON)             |
| `logger.prettyColor`      | `'auto' \| 'always' \| 'never'` | `'auto'`                       | Whether to add ANSI to the level label in pretty mode; the production JSON does not contain ANSI                                                        |
| `logger.prettySingleLine` | `boolean`                       | `true`                         | In pretty mode, compress extra fields in JSON inline form into the same line of the message; `false` uses multi-line expansion format                   |
| `logger.prettyIgnore`     | `string`                        | `'pid,hostname,requestId'`     | Fields to ignore in pretty mode (comma separated); `requestId` is hidden by default to avoid mixin injected fields from expanding into multi-line noise |
| `logger.redactKeys`       | `string[]`                      | `[]`                           | Desensitize structured log fields by exact key at any level                                                                                             |
| `logger.redactPaths`      | `string[]`                      | `[]`                           | Desensitize structured log fields by dot notation exact path                                                                                            |
| `logger.redactValue`      | `string`                        | `'[Redacted]'`                 | Desensitized replacement value                                                                                                                          |
| `logger.mixin`            | `function`                      | `undefined`                    | Synchronously return custom structured fields; `requestId` cannot be overridden, `trace_id` / `span_id` can be overridden by user fields                |

Supported log levels (from low to high): `'trace'` → `'debug'` → `'info'` → `'warn'` → `'error'` → `'fatal'` → `'silent'`

```typescript
export default {
  logger: {
    level: "info", // Recommended for production environment 'warn'
    lifecycleLevel: "concise", // If you need to troubleshoot, set it to 'verbose'
    pretty: true, // Enable readable formatting in the development environment (disabled by default in the production environment)
    // prettyColor: 'auto', // Add color to level label when TTY or FORCE_COLOR=1
    // prettySingleLine: true, // Extra fields are compressed to the same line (default)
    // prettyIgnore: 'pid,hostname,requestId', // Hidden fields by default
    // redactKeys: ['password', 'token'], // redact matching keys
    // redactPaths: ['headers.authorization'], // redact this exact path
    // mixin: () => ({ service_name: 'my-app' }), // Custom structured fields
  },
};
```

VextJS has a built-in logger kernel with zero runtime dependency, and the `pretty` mode uses the built-in formatter to output readable logs. The default logger supports `trace()`, `getLevel()` / `setLevel()` and exact key/path redaction; see [Log Document](/guide/logger) for complete description.

### Graceful shutdown configuration (`shutdown`)

| Configuration item | Type     | Default value | Description                                                                                     |
| ------------------ | -------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `shutdown.timeout` | `number` | `10`          | Full-pipeline deadline (seconds); invoke remaining cleanup without further waiting after expiry |

```typescript
export default {
  shutdown: {
    timeout: 15, // 15 seconds timeout (unit: seconds)
  },
};
```

On `SIGTERM` / `SIGINT`, a normal HTTP process enters bounded shutdown: it
stops accepting requests, handles in-flight requests, then runs `onClose`
hooks in reverse registration order. The entire pipeline shares a deadline.
After it expires, remaining cleanup is invoked without further waiting.
The test helper's close does not call `process.exit`; an unfinished async
cleanup must not be reported as complete.

### HTTP Server Configuration (`server`)

`server` controls the inbound Node.js HTTP server layer for the built-in Native, Hono, Fastify, Express, and Koa adapters, including the development server created by `vext dev`. Unconfigured fields retain the current Node.js defaults.

| Configuration item                   | Type     | Default value   | Description                                                 |
| ------------------------------------ | -------- | --------------- | ----------------------------------------------------------- |
| `server.requestTimeout`              | `number` | Node.js default | Maximum time to receive a complete request; `0` disables it |
| `server.headersTimeout`              | `number` | Node.js default | Maximum time to receive complete HTTP headers               |
| `server.keepAliveTimeout`            | `number` | Node.js default | Keep-alive idle wait after a response completes             |
| `server.socketTimeout`               | `number` | Node.js default | Socket inactivity timeout; `0` disables it                  |
| `server.maxHeaderSize`               | `number` | Node.js default | Maximum request header size in bytes                        |
| `server.maxRequestsPerSocket`        | `number` | Node.js default | Maximum requests per socket; `0` means unlimited            |
| `server.connectionsCheckingInterval` | `number` | Node.js default | Outstanding-request timeout check interval                  |

```typescript
export default {
  server: {
    requestTimeout: 120_000,
    headersTimeout: 60_000,
    keepAliveTimeout: 5_000,
    socketTimeout: 0,
    maxHeaderSize: 16 * 1024,
    maxRequestsPerSocket: 0,
    connectionsCheckingInterval: 30_000,
  },
};
```

:::tip
`config.server` only affects inbound service requests; the timeout for outbound `app.fetch` / `app.fetch.proxy` is still controlled by `config.fetch.timeout` or options when calling.
:::

### Response configuration (`response`)

| Configuration item                 | Type      | Default value | Description                                                                                                               |
| ---------------------------------- | --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `response.wrap`                    | `boolean` | `true`        | Whether to enable export packaging (`res.json(data)` is automatically wrapped as `{ code, data, requestId }`)             |
| `response.hideInternalErrors`      | `boolean` | `true`        | Whether to hide 500 error details (it is recommended to enable it in production environment and not expose stack trace)   |
| `response.logErrors.unknownErrors` | `boolean` | `true`        | Whether to log unknown 500 errors (including complete err object and stack trace)                                         |
| `response.logErrors.http5xx`       | `boolean` | `true`        | Whether to log HttpError 5xx (error level)                                                                                |
| `response.logErrors.http4xx`       | `boolean` | `false`       | Whether to log HttpError 4xx (warn level, it is recommended to turn it off in high traffic scenarios to reduce log noise) |

```typescript
export default {
  response: {
    wrap: true,
    hideInternalErrors: true,
    logErrors: {
      unknownErrors: true, // Unknown errors must be logged
      http5xx: true, // 5xx is the responsibility of the server
      http4xx: false, // 4xx is not recorded by default (to avoid noise in high traffic scenarios)
    },
  },
};
```

The `response.hideInternalErrors` here is aimed at the 500 path of "unknown exceptions", such as `throw new Error("...")` directly in the code. If you use `app.throw(...)` to actively throw `404`, `409` and other structured HTTP errors, the framework will still return the status code and message you specify, regardless of this configuration.

Actual output of `res.json(data)` with `wrap: true` enabled:

```json
{
  "code": 0,
  "data": { "name": "Alice" },
  "requestId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Set `wrap: false` to turn off wrapping, and `res.json(data)` will output the original data directly.

### Body Parser configuration (`bodyParser`)

| Configuration item       | Type               | Default value | Description                    |
| ------------------------ | ------------------ | ------------- | ------------------------------ |
| `bodyParser.enabled`     | `boolean`          | `true`        | Whether to enable body parsing |
| `bodyParser.maxBodySize` | `string \| number` | `'1mb'`       | Maximum request body size      |

```typescript
export default {
  bodyParser: {
    enabled: true,
    maxBodySize: "5mb", // Allow larger request body
  },
};
```

`maxBodySize` accepts strings such as `'1mb'` or `'500kb'`, or a number of
bytes. This bounds the entire request and does not rise automatically when
`multipart.maxFileSize` rises. An Adapter or reverse proxy may have a lower
limit.

### Multipart / File upload configuration (`multipart`)

| Configuration item           | Type       | Default value | Description                                                                                          |
| ---------------------------- | ---------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `multipart.enabled`          | `boolean`  | `false`       | Whether to enable built-in multipart parsing (`req.files` will be automatically filled when enabled) |
| `multipart.maxFileSize`      | `number`   | `10485760`    | Maximum size of a single file (bytes, default 10MB)                                                  |
| `multipart.maxFiles`         | `number`   | `10`          | Maximum number of files in a single request                                                          |
| `multipart.allowedMimeTypes` | `string[]` | `undefined`   | Whitelist of allowed MIME types (no restriction if not set)                                          |

```typescript
export default {
  multipart: {
    enabled: true, // Enable built-in parsing
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
  },
};
```

### Access Log Configuration (`accessLog`)

Built-in multipart parsing is memory-only and does not write files to disk.
Ordinary multipart text fields do not automatically appear in `req.body`,
and a route override cannot rescue a file rejected by the earlier global
limit. See [File uploads](/guide/uploads) for a complete example and error
checks.

| Configuration item           | Type       | Default value | Description                                          |
| ---------------------------- | ---------- | ------------- | ---------------------------------------------------- |
| `accessLog.enabled`          | `boolean`  | `true`        | Whether to enable access log                         |
| `accessLog.level`            | `string`   | `'info'`      | Basic log level, only supports `'info'` or `'debug'` |
| `accessLog.skipPaths`        | `string[]` | `[]`          | Exact match skipped path list                        |
| `accessLog.skipPathPrefixes` | `string[]` | `[]`          | List of paths skipped by prefix matching             |
| `accessLog.slowThreshold`    | `number`   | `0`           | Slow request threshold, `0` means not enabled        |
| `accessLog.warnOn4xx`        | `boolean`  | `false`       | Whether to promote 4xx responses to `warn`           |
| `accessLog.logResponseSize`  | `boolean`  | `false`       | Whether to append the response body size             |

```typescript
export default {
  accessLog: {
    enabled: true,
    level: "info",
    skipPaths: ["/health", "/ready"],
    skipPathPrefixes: ["/internal"],
    slowThreshold: 1000,
    warnOn4xx: false,
    logResponseSize: false,
  },
};
```

When enabled, requests are logged at completion according to log level and
path filters. This is an illustrative pretty-mode line:

```
GET /api/users 200 12ms | 127.0.0.1
```

### OpenAPI configuration (`openapi`)

| Configuration item                      | Type                     | Default value         | Description                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openapi.enabled`                       | `boolean`                | `false`               | Whether to enable OpenAPI documentation                                                                                                                                                                                         |
| `openapi.title`                         | `string`                 | `'VextJS API'`        | OpenAPI spec `info.title`; `docs.ui.title` may set the UI title separately, and without either the UI uses Vext API Docs.                                                                                                       |
| `openapi.description`                   | `string`                 | `''`                  | Document description                                                                                                                                                                                                            |
| `openapi.version`                       | `string`                 | `'1.0.0'`             | API version number                                                                                                                                                                                                              |
| `openapi.docs.path`                     | `string`                 | `'/docs'`             | Vext Docs path                                                                                                                                                                                                                  |
| `openapi.docs.assetsPath`               | `string`                 | `'/_vext/docs'`       | Internal Vext route prefix for built-in docs assets and source-aware data endpoints, including app.js / style.css / favicon.svg                                                                                                 |
| `openapi.docs.assetsPublicPath`         | `string`                 | Same as `assetsPath`  | Browser-facing docs asset/data prefix. HTML uses this public prefix for app.js / style.css / favicon.svg; use it when a reverse proxy strips a public path prefix                                                               |
| `openapi.docsPath`                      | `string`                 | `'/docs'`             | Compatibility field; prefer `openapi.docs.path` in new projects                                                                                                                                                                 |
| `openapi.jsonPath`                      | `string`                 | `'/openapi.json'`     | OpenAPI JSON endpoint path (vext internal route registration path)                                                                                                                                                              |
| `openapi.jsonPublicPath`                | `string`                 | Same as `jsonPath`    | Public canonical spec path for links and external tools. Built-in source-aware docs data uses `openapi.docs.assetsPublicPath` / `assetsPath`; see [Reverse Proxy Deployment](/guide/openapi#reverse-proxy-path-prefix-scenario) |
| `openapi.docs.renderer`                 | `'vext'`                 | `'vext'`              | Built-in Vext Docs renderer. Third-party renderer objects are no longer supported; external tools should consume `/openapi.json`                                                                                                |
| `openapi.docs.code`                     | `object`                 | `{ enabled: 'auto' }` | services / utils / models / components / plugins / middlewares docs source configuration                                                                                                                                        |
| `openapi.docs.code.scan`                | `'lazy' \| 'background'` | `'lazy'`              | Code docs scan lifecycle. `lazy` scans on each docs data request; `background` warms one in-process snapshot at docs registration and reuses it for later requests                                                              |
| `openapi.docs.sources`                  | `Array`                  | `[]`                  | Optional source surfaces for Public/Admin/Internal or versioned docs. Each source requires `match`; non-`All` code docs need explicit `code.include` / `code.exclude`                                                           |
| `openapi.docs.tryItOut.hookScript`      | `string`                 | `undefined`           | Optional browser script loaded by Vext Docs before using `hookGlobal` for request/response hooks                                                                                                                                |
| `openapi.docs.tryItOut.hookGlobal`      | `string`                 | `'VextDocsHooks'`     | Browser global lookup name for Try it out `beforeRequest` / `afterResponse` hooks                                                                                                                                               |
| `openapi.docs.tryItOut.defaultServer`   | `string`                 | `undefined`           | Initial Try it out server: `"first"`, `"same-origin"`, `"custom"`, or an exact OpenAPI server URL                                                                                                                               |
| `openapi.docs.tryItOut.sameOrigin`      | `boolean \| 'auto'`      | `'auto'`              | Whether to show the Same origin server option. `auto` shows it only when no OpenAPI servers are configured                                                                                                                      |
| `openapi.docs.tryItOut.customServer`    | `boolean`                | `true`                | Whether visitors can temporarily enter a Try it out base URL in the browser                                                                                                                                                     |
| `openapi.docs.tryItOut.customServerUrl` | `string`                 | `undefined`           | Optional default value for the Custom server input                                                                                                                                                                              |
| `openapi.docs.access.openapiJson`       | `'filtered' \| 'public'` | `'filtered'`          | Whether canonical `/openapi.json` follows docs access filtering or stays public                                                                                                                                                 |
| `openapi.scalar`                        | `object`                 | `undefined`           | Deprecated compatibility field. It only triggers a warning when explicitly configured and does not affect the built-in Vext Docs page                                                                                           |
| `openapi.servers`                       | `Array`                  | `[]`                  | List of API servers                                                                                                                                                                                                             |
| `openapi.tags`                          | `Array`                  | `[]`                  | Tag definition                                                                                                                                                                                                                  |
| `openapi.securitySchemes`               | `object`                 | `{}`                  | Security schemes                                                                                                                                                                                                                |
| `openapi.contact`                       | `object`                 | `{}`                  | Contact information                                                                                                                                                                                                             |
| `openapi.license`                       | `object`                 | `{}`                  | License information                                                                                                                                                                                                             |

`openapi.docs.access.cacheKey` is not supported in this release and is rejected by config validation. Add a resolver directly; a future docs caching layer should define its own explicit cache contract.

For fixed local or deployed API targets, configure `openapi.servers[].url` as the complete base URL including its port, for example `http://127.0.0.1:3000`. Reserve `openapi.servers[].variables` for truly variable URL segments such as environment, region, tenant, or API version. `openapi.docs.tryItOut.defaultServer` selects the initial Try it out server, and `openapi.docs.tryItOut.customServer` allows a temporary browser-side override without changing project config.

```typescript
export default {
  openapi: {
    enabled: true,
    title: "My App API",
    description: "My App API Documentation",
    version: "1.0.0",
    docs: {
      path: "/docs",
      renderer: "vext",
      code: {
        enabled: "auto",
      },
    },
    jsonPath: "/openapi.json",
    servers: [
      { url: "http://localhost:3000", description: "Local development" },
      { url: "https://api.myapp.com", description: "Production environment" },
    ],
    tags: [
      { name: "User", description: "User management related interface" },
      { name: "Order", description: "Order management related interface" },
    ],
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    contact: {
      name: "API Support",
      email: "support@myapp.com",
    },
    license: {
      name: "Apache-2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0",
    },
  },
};
```

### Database configuration (`database`)

Providing a nonempty `database` object activates Vext's built-in MonSQLize
lifecycle. There is no `database.enabled` off switch: omission, `null`, or
an empty object skips it. The repository currently checks MonSQLize 3.3.0;
this does not pin the Vext installation version. The lifecycle includes
connection normalization, logger bridging, model loading, raw `app.db`
mounting, and shutdown cleanup. Use the first-class fields for
those owned concerns. `database.monsqlizeOptions` is a typed, runtime-validated
escape hatch for the documented advanced allowlist; protected or unknown keys
fail before the upstream constructor runs.

```typescript
export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },
    maxTimeMS: 2_000,
    monsqlizeOptions: {
      findMaxLimit: 2_000,
      transaction: { enableRetry: true, maxRetries: 2 },
      writePathPolicy: { default: "model-only" },
    },
  },
};
```

See [Database (MonSQLize)](./database.md#controlled-advanced-monsqlize-options)
for the full allowlist, ownership boundary, raw-instance API, Vector Search,
and relation-protected deletion prerequisites.

### Request context configuration (`requestContext`)

| Configuration item       | Type      | Default value | Description                                         |
| ------------------------ | --------- | ------------- | --------------------------------------------------- |
| `requestContext.enabled` | `boolean` | `true`        | Whether to enable AsyncLocalStorage request context |

```typescript
export default {
  requestContext: {
    enabled: true,
  },
};
```

:::warning performance tips
Disabling `requestContext` removes request-context lifecycle capabilities and may reduce their overhead, but the benefit depends on the workload and must be measured in your application. The following features will be disabled:

- `app.logger` automatically carries `requestId`
- `app.throw()` automatically parses the request locale
- `app.fetch` automatically propagates `requestId`

Consider disabling it only after confirming that these capabilities are unnecessary and application-level measurements show a benefit.
:::

### Cluster configuration (`cluster`)

| Configuration item               | Type               | Default value | Description                                                  |
| -------------------------------- | ------------------ | ------------- | ------------------------------------------------------------ |
| `cluster.enabled`                | `boolean`          | `false`       | Whether to enable Cluster mode                               |
| `cluster.workers`                | `number \| string` | `'auto'`      | Number of Workers (`'auto'` = number of CPU cores)           |
| `cluster.autoRestart`            | `boolean`          | `true`        | Automatically restart Worker when it crashes                 |
| `cluster.maxRestarts`            | `number`           | `5`           | Maximum number of restarts within the time window            |
| `cluster.restartWindow`          | `number`           | `60000`       | Restart count window (milliseconds)                          |
| `cluster.restartBaseDelay`       | `number`           | `1000`        | Restart base delay (milliseconds)                            |
| `cluster.restartMaxDelay`        | `number`           | `30000`       | Maximum restart delay (milliseconds)                         |
| `cluster.healthCheck.enabled`    | `boolean`          | `true`        | Whether to enable Worker heartbeat detection                 |
| `cluster.healthCheck.interval`   | `number`           | `15000`       | Heartbeat detection interval (milliseconds)                  |
| `cluster.healthCheck.timeout`    | `number`           | `30000`       | Heartbeat timeout (milliseconds)                             |
| `cluster.reload.workerDelay`     | `number`           | `2000`        | Time to wait before replacing the next Worker (milliseconds) |
| `cluster.reload.readyTimeout`    | `number`           | `30000`       | Worker ready timeout (milliseconds)                          |
| `cluster.reload.shutdownTimeout` | `number`           | `10000`       | Worker shutdown timeout (milliseconds)                       |
| `cluster.pidFile`                | `string`           | `'.vext.pid'` | PID file path                                                |

```typescript
export default {
  cluster: {
    enabled: true,
    workers: "auto", // Automatically detect the number of CPU cores
    autoRestart: true,
    maxRestarts: 5,
    healthCheck: { enabled: true },
    reload: { workerDelay: 2000 },
  },
};
```

You can also turn on Cluster mode through the environment variable `VEXT_CLUSTER=1` without modifying the configuration file.

### Jobs configuration

`config.jobs` controls job discovery, scheduler, worker, store, leases, and
default execution policies for the Job runtime. It does not make HTTP startup
run Jobs automatically. Test helpers use explicitly supplied Job definitions.
Vext Docs has its own Job source directory configuration; changing
`jobs.dir` does not automatically update every documentation or tooling
entry point. See the guides and API below for each entry point's scope.

```ts
export default {
  jobs: {
    enabled: true,
    dir: "jobs",
    runner: "inline",
    store: { type: "file", dir: ".vext/jobs" },
    scheduler: { enabled: true, mode: "inline" },
    worker: { enabled: true, concurrency: 4 },
  },
};
```

See [Jobs](/guide/jobs) and [Jobs API](/api/jobs).

### Dev mode configuration (`dev`)

| Configuration item           | Type                | Default value | Description                                                                                                               |
| ---------------------------- | ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `dev.errorOverlay.enabled`   | `boolean`           | `true`        | Whether to enable the Dev error overlay (the HTML error page will be displayed when the browser accesses the error route) |
| `dev.errorOverlay.theme`     | `'dark' \| 'light'` | `'dark'`      | Error overlay theme                                                                                                       |
| `dev.errorOverlay.maxFrames` | `number`            | `25`          | The maximum number of stack frames to display                                                                             |

```typescript
export default {
  dev: {
    errorOverlay: {
      enabled: true, // Set to false to disable HTML error overlay
      theme: "dark",
      maxFrames: 25,
    },
  },
};
```

:::tip only takes effect in development mode
`dev` configuration items are only read in `vext dev` development mode, production mode (`vext start`) automatically ignores all fields.

The Dev error overlay is based on **Accept content negotiation**, not the HTTP method:

- `Accept: text/html` (Browser address bar GET, HTML form POST) → Return to HTML error page
- `Accept: application/json` (frontend fetch / axios / curl) -> always returns JSON.

Console logging is **not affected by overlay** - logging configured with `logErrors` behaves exactly the same whether the response returns HTML or JSON.
:::

### Middleware whitelist (`middlewares`)

| Configuration item | Type                                            | Default value | Description                      |
| ------------------ | ----------------------------------------------- | ------------- | -------------------------------- |
| `middlewares`      | `Array<string \| { name, options?, enabled? }>` | `[]`          | Route-level middleware whitelist |

```typescript
export default {
  middlewares: [
    // Ordinary middleware - string declaration
    "auth",
    "timing",

    // Factory middleware — object declaration (with default parameters)
    { name: "check-role", options: { roles: ["user"] } },
    { name: "cache-control", options: { maxAge: 3600 } },
  ],
};
```

Only middleware declared in the whitelist can be referenced in the route's `options.middlewares`.

## Access configuration in code

### Routing

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/info", {}, async (_req, res) => {
    res.json({
      port: app.config.port,
      openapi: app.config.openapi.enabled,
    });
  });
});
```

### In service

```typescript
import type { VextApp } from "vextjs";

export default class MyService {
  constructor(private app: VextApp) {}

  getListenAddress() {
    const { host, port } = this.app.config;
    const address = host.includes(":") ? `[${host}]` : host;
    return `http://${address}:${port}`;
  }
}
```

### In plug-in

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "my-plugin",
  setup(app) {
    const myConfig = app.config.myPlugin ?? { enabled: false };
    if (!myConfig.enabled) return;
    // ...
  },
});
```

:::tip configuration read-only
Plain objects and arrays in `app.config` are deeply frozen after loading.
Writing a frozen property in strict ESM code throws a `TypeError`.
Explicit non-plain class instances are not recursively frozen, so this
mechanism does not freeze a Redis client's internal state.
:::

## Custom configuration fields

The `VextConfig` interface allows extending custom fields. Plug-ins and business code can add arbitrary fields in the configuration:

```typescript
// src/config/default.ts
export default {
  port: 3000,

  // Custom fields
  redis: {
    url: "redis://localhost:6379",
    db: 0,
  },
  mailer: {
    smtp: "smtp://localhost:1025",
    from: "noreply@myapp.com",
  },
};
```

Use with `declare module` to get type hints:

```typescript
// src/types/config.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextConfig {
    redis?: {
      url: string;
      db?: number;
    };
    mailer?: {
      smtp: string;
      from: string;
    };
  }
}
```

## Environment variables

In addition to configuration files, some settings can also be controlled through environment variables:

VextJS does not automatically parse `.env` files. A value visible through
`process.env` must already have been injected by the OS, shell, process manager,
container/CI platform, secret manager, or a loader explicitly owned by the
application. Use `--config` or `VEXT_CONFIG` to select a Vext config profile;
an `.env` file is not another built-in Vext profile layer.

| Environment variables  | Description                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `VEXT_CONFIG`          | Select the config profile to load                                           |
| `NODE_ENV`             | Runtime mode; `vext start` runs as production                               |
| `PORT`                 | Can be referenced in `default.ts` as `process.env.PORT`                     |
| `VEXT_PORT`            | Internal pass variable of CLI `--port`, higher priority than provider patch |
| `VEXT_HOST`            | CLI `--host` internal pass variable, higher priority than provider patch    |
| `VEXT_PORT_CONFLICT`   | Port conflict policy: `error` / `prompt` / `kill` / `next`                  |
| `VEXT_LIFECYCLE_LEVEL` | Lifecycle log level: `concise` / `verbose`                                  |
| `VEXT_CLUSTER`         | Enables Cluster mode when set to `1`                                        |

```typescript
// src/config/default.ts — use environment variables
export default {
  port: Number(process.env.PORT) || 3000,
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
};
```

:::tip Choosing a configuration source
Deployment values can come from project-selected config files, platform
injection, or a provider. Vext does not require one universal source. For
example:

- Read an environment variable with `process.env.DB_PASSWORD`.
- Use `local.ts` (listed in `.gitignore`) for local development secrets.

Production mode does not load `local.ts`; supply production values through
the selected profile, provider, or explicit environment inputs.
:::

## Configuration verification

`config-loader` checks configuration after merging. These are common checks,
not an exhaustive list of all fields and business values:

- `port` must be a positive integer from 1 to 65535.

- `adapter` must be a known built-in identifier or a valid adapter object/function
- Each element in the `middlewares` array must be a string or a `{ name: string }` object
- `rateLimit.max` and `rateLimit.window` currently check for number type and a value of at least 1; the checker does not fully enforce finiteness or integer values. Applications should use finite positive numbers, an integer `max`, and seconds for `window`.
- `logger.level` must be a legal log level
- `logger.redactKeys` / `logger.redactPaths` must be a string array, `logger.redactValue` must be a string
- `shutdown.timeout` must be a non-negative number (unit: seconds)
- `server.requestTimeout`, `server.headersTimeout`, `server.keepAliveTimeout`, `server.socketTimeout` must be non-negative finite numbers (unit: milliseconds)
- `server.maxHeaderSize`, `server.connectionsCheckingInterval` must be positive integers, `server.maxRequestsPerSocket` must be non-negative integers
- `cluster.workers` must be a positive integer or `'auto'` / `'auto-1'`

Existing validators report errors during startup. Applications must still
check custom fields, external service availability, and business constraints
outside those validators. Successful config loading alone does not prove the
application works.

## Troubleshooting and verification

| Symptom                                | What to check                                                                                                       | Verification                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Profile seems ineffective              | Compare CLI/env selection, profile filename, and actual build output. A missing optional profile provides no patch. | Use the diagnostic fields above.                |
| Local values appear in production      | Distinguish environment variables, providers, and the local layer; a custom profile does not change runtime mode.   | Retry build/start in a clean environment.       |
| Middleware options are missing fields  | Same-name `options` replace the whole value rather than deep-merging it.                                            | Inspect effective config and request the route. |
| Startup fails after a provider timeout | Production is required by default; check the remote dependency and signal handling.                                 | Restart after restoring the dependency.         |
| Modifying config throws `TypeError`    | Plain config was frozen; edit source config and restart as needed.                                                  | Read effective values in a new process.         |

## Next step

- Understand the detailed configuration and switching methods of [Adapter Architecture](/guide/adapters)
- Learn how to configure whitelist in [Middleware](/guide/middleware)
- See [OpenAPI Documentation](/guide/openapi) for advanced configuration
- Explore configuration options for [Cluster Multiprocess](/guide/cluster)

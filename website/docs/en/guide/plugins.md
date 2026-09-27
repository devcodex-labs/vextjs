# Plugins

VextJS plugins extend application capabilities during startup. They can attach custom capabilities to `app`, register global middleware, replace selected built-in implementations and manage resource lifecycles. Routes, Services, Adapters and build tooling have their own entry points; see [Architecture](/specification/architecture) for their responsibilities.

Run the complete plugin example below first; it needs no external service. Later examples explain individual interfaces. Redis, database, monitoring SDKs and business Services must be supplied by your application. Do not copy all snippets into the plugin directory at once.

## Basic concepts

Plugins live under `src/plugins/` and are scanned by `plugin-loader`. Each plugin uses `definePlugin()` with a name, optional dependencies and a `setup()` initializer.

Recursive scanning supports `.ts`, `.js`, `.mjs` and `.cjs`. It excludes names beginning with `_` or `.`, test/spec files and `.d.ts`. Put ordinary helper modules outside the scanned tree or at explicitly excluded paths. Installing an npm package does not automatically register it as a user plugin; export a plugin from this directory.

### Complete example and verification

Use these four files in a separate TypeScript practice project from [Quick Start](/guide/quick-start). Keep its npm scripts and tsconfig, merge the base config, and place only these two plugins in the plugin directory. The example verifies dependency order, extension, global middleware, ready and close without Redis or a database. If local/provider config overrides the port, check the actual listen address first.

```typescript
// src/config/default.ts
export default { port: 3000, adapter: "native", frontend: { enabled: false } };
```

```typescript
// src/plugins/store.ts
import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  demoState: {
    requests: number;
    ready: boolean;
    events: string[];
  };
}>();

export default definePlugin({
  name: "demo-store",
  setup(app) {
    const state = { requests: 0, ready: false, events: [] as string[] };
    app.extend("demoState", state);
    app.onClose(() => {
      state.events.push("store");
      app.logger.info({ events: [...state.events] }, "Demo plugin close order");
    });
  },
});
```

```typescript
// src/plugins/consumer.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "demo-consumer",
  dependencies: ["demo-store"],
  setup(app) {
    const state = app.demoState as {
      requests: number;
      ready: boolean;
      events: string[];
    };
    app.use(async (_req, res, next) => {
      state.requests += 1;
      res.setHeader("x-demo-plugin", "active");
      await next();
    });
    app.onReady(() => {
      state.ready = true;
    });
    app.onClose(() => {
      state.events.push("consumer");
    });
  },
});
```

```typescript
// src/routes/plugin-info.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    const state = app.demoState as { requests: number; ready: boolean };
    res.json({ requests: state.requests, ready: state.ready });
  });
});
```

1. Run `npm run dev`. In another terminal, request `http://127.0.0.1:3000/plugin-info` twice with `curl -i` (or `curl.exe -i` in PowerShell).
2. With no other requests, both responses should be 200 with `x-demo-plugin: active`; `data.ready=true` and `data.requests` should be 1 then 2. A browser may request a favicon, so use the command above for exact counts.
3. Press Ctrl+C in the server terminal. Check the `Demo plugin close order` log for `events: ["consumer", "store"]`: the later registered consumer closes first. The log level must include info; forced termination does not guarantee close hooks.
4. Run `npm run build` (the Quick Start build script includes `--typecheck`), then `npm start`. Repeat requests and graceful shutdown; a new process starts its count at zero.

A test helper can retain `app.app.demoState`, call `await app.close()`, and check the same event order. That verifies application cleanup but does not replace a CLI signal test.

`appExtensions` provides an explicit declaration to type generation. The `app.extend()` call in setup actually creates and attaches state; a type declaration alone creates no runtime capability.

Temporarily change the consumer dependency to a missing name: startup should report the missing dependency. Restore it and retry. Duplicate plugin names also fail instead of silently overriding. Test helpers need explicit `plugins: true`; see [Testing API](/api/testing-api).

### Optional Redis integration

This optional integration requires an installed `ioredis` package and a reachable Redis service. Creating a client does not prove connection success; the plugin owns cleanup on setup failure or cancellation. This is separate from the four-file example above.

```typescript
// src/plugins/redis.ts
import { definePlugin } from "vextjs";
import Redis from "ioredis";

export default definePlugin({
  name: "redis",

  async setup(app) {
    const redis = new Redis(app.config.redis?.url ?? "redis://localhost:6379");

    // Attach a custom capability to app.
    app.extend("redis", redis);

    // Register a graceful shutdown hook.
    app.onClose(async () => {
      app.logger.info("Closing Redis connection...");
      await redis.quit();
    });

    app.logger.info("Redis plugin initialized");
  },
});
```

## Plug-in interface

```typescript
interface VextPlugin {
  /** Plug-in name (unique identifier) */
  readonly name: string;

  /** List of other dependent plug-in names */
  readonly dependencies?: string[];

  /** Plug-in initialization function */
  setup(
    app: VextPluginContext,
    context: VextPluginSetupContext,
  ): Promise<void> | void;

  /** Readiness hook executed after HTTP starts listening (optional) */
  onReady?(app: VextPluginContext): Promise<void> | void;

  /** Cleanup hooks executed during graceful shutdown (optional, in LIFO order) */
  onClose?(app: VextPluginContext): Promise<void> | void;
}
```

These types can be imported from `vextjs`. `VextPluginSetupContext` provides a read-only `signal: AbortSignal`. `VextPluginContext` does not expose route registration; routes belong in `defineRoutes()`.

### `name` — unique identifier

The plugin name appears in logs, errors and dependency declarations. Duplicate user-plugin names fail before any setup runs; later files do not override earlier ones. Built-in MonSQLize initializes in a separate phase and is not a node in the user-plugin dependency graph. Do not try to replace or depend on it with a same-name file or `dependencies: ["monsqlize"]`.

### `dependencies` — dependency declaration

Declare other **user plugin names**, not file paths or npm package names. `plugin-loader` topologically sorts them so dependencies run `setup()` first. Missing or cyclic dependencies fail fast. A dependency whose setup returns early may still lack the expected capability; the consumer must match its enablement conditions.

```typescript
export default definePlugin({
  name: "user-cache",
  dependencies: ["redis"], // Make sure the redis plug-in is initialized first

  async setup(app) {
    // At this time app.redis (injected by the redis plug-in) is available
    const redis = (app as any).redis;
    // ...
  },
});
```

### `setup()` — initialization function

The core logic of a plugin runs during bootstrap and supports async work. Its second argument is `{ signal: AbortSignal }`; pass `signal` to cancellable I/O. Each setup has a hard timeout (30 seconds in current standard entry points, provided the event loop runs the timer). On failure or timeout, the signal aborts, managed framework mutations are rolled back and the controlled setup facade is revoked. A late continuation cannot use it to call managed methods or write top-level properties. This does not stop changes to captured nested objects or undo external I/O.

```typescript
async setup(app, { signal }) {
  const response = await fetch(app.config.remotePluginUrl, { signal });
  if (!response.ok) throw new Error(`Remote plugin configuration: HTTP ${response.status}`);
  app.extend("remotePluginData", await response.json());
}
```

### `onReady()` / `onClose()` — life cycle hook

Plug-ins can also declare `onReady(app)` and `onClose(app)` directly. `plugin-loader` will register them into the application life cycle after `setup()` is completed:

- `onReady(app)`: Executed after HTTP starts listening, suitable for warming up cache, checking external dependencies, and printing startup information.
- `onClose(app)`: Executed during graceful shutdown. All shutdown hooks clean up resources in last-registration-first-execution (LIFO) order.

The setup mutation facade is also revoked after successful setup. Do not call setters or `extend` through a retained setup parameter in a later task. Registered callbacks can read the app or use captured clients. Rollback covers managed framework state only; it does not undo network writes or close an external resource whose hook was never registered. A timeout cannot forcibly stop arbitrary JavaScript or I/O. Application shutdown has its own overall deadline.

## Plug-in capabilities

### `app.extend()` — Mount custom properties

Attach custom properties or methods to `app` during plugin setup. Names must be valid JavaScript identifiers and cannot replace existing, reserved or inherited properties. Use the relevant setter to replace a validator or logger.

```typescript
export default definePlugin({
  name: "mailer",

  async setup(app) {
    const mailer = {
      async send(to: string, subject: string, body: string) {
        //Send email logic...
        app.logger.info({ to, subject }, "Email sent");
      },
    };

    app.extend("mailer", mailer);
  },
});
```

When using:

```typescript
// In a route or service
await (app as any).mailer.send("user@example.com", "Welcome", "Hello!");
```

:::tip type tip
If you want to automatically generate plugin extension declarations, export `appExtensions = defineAppExtensions<{ ... }>()` in the plugin file and run:

```bash
npm exec -- vext typegen
```

Currently, lightweight scanners prioritize inline object generics:

```typescript
import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  mailer: {
    send(to: string, subject: string, body: string): Promise<void>;
  };
}>();

export default definePlugin({
  name: "mailer",
  setup(app) {
    app.extend("mailer", {
      async send(to: string, subject: string, body: string) {
        app.logger.info({ to, subject }, "Email sent");
      },
    });
  },
});
```

The command will also best-effort scan `app.extend("...")` calls in the `setup` / `onReady` / `onClose` life cycle of `definePlugin()`, and write the results into `.vext/types/app-extensions.generated.d.ts`, and then access the TypeScript project through `src/types/generated/index.d.ts`. Complex types, imported type alias or dynamic expansion are not suitable for relying on automatic scanning. It is recommended to use handwritten `declare module`:

```typescript
// src/types/extensions.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextApp {
    mailer: {
      send(to: string, subject: string, body: string): Promise<void>;
    };
  }
}
```

When extended `app.mailer.send()` will get IDE auto-completion without the need for `as any` assertion.
:::

### `app.use()` — Register global middleware

Plugin middleware runs after global base layers such as request metadata, parsing and response wrapping, and before explicitly enabled CSRF and route chains. It does not run if an earlier layer short-circuits or throws. See the [global middleware order](/guide/middleware#global-middleware).

```typescript
import { definePlugin, securityHeaders } from "vextjs";

export default definePlugin({
  name: "security-headers",

  setup(app) {
    app.use(securityHeaders({ preset: "strict" }));
  },
});
```

For application-wide browser security headers, prefer `config.securityHeaders` so errors, 404 responses, testing helpers, and dev soft reload use the same behavior. The plugin form is useful for scoped or migration-only stacks.

:::warning note
`app.use()` can only be called in `setup()`. Calling after route registration is complete will throw an error.
:::

### `app.hooks.on()` — Register runtime lifecycle hooks

Plugins can also observe the framework life cycle through `app.hooks.on(name, handler)`. It is suitable for cross-cutting logic such as request auditing, outbound call monitoring, service call tracking, response header patch, OpenAPI document patch, etc.

```typescript
export default definePlugin({
  name: "runtime-observer",

  setup(app) {
    app.hooks.on("handler:error", ({ route, error, requestId }) => {
      app.logger.error({ route: route.path, err: error, requestId });
    });

    app.hooks.on("response:before", ({ headers }) => ({
      headers: { ...headers, "x-runtime": "vext" },
    }));
  },
});
```

`app.hooks` is a framework reserved property and cannot be overridden with `app.extend("hooks", ...)`. The plugin `setup()` itself will also trigger `plugin:beforeSetup/afterSetup/error`, but a plugin cannot observe its own `beforeSetup`, it can only be observed by previously loaded plugins.

### `app.onClose()` — Graceful closing hook

Register a graceful shutdown hook. On SIGTERM or SIGINT, hooks run in reverse registration order (LIFO). Use them to close database connections, flush logs or cancel timers. Here `createDatabaseConnection` must be implemented by the application and return a client with `disconnect()`. A separate `sqlDatabase` config and `sql` extension avoid replacing built-in `app.db`.

```typescript
export default definePlugin({
  name: "database",

  async setup(app) {
    const db = await createDatabaseConnection(app.config.sqlDatabase);
    try {
      app.extend("sql", db);
      app.onClose(async () => {
        app.logger.info("Closing database connection...");
        await db.disconnect();
      });
    } catch (error) {
      // A name conflict may occur before the close hook is registered.
      await db.disconnect();
      throw error;
    }
  },
});
```

### `app.onReady()` — Ready hook

Register ready hook. Triggered after all plug-ins are loaded and HTTP starts listening. Suitable for: warming up cache, checking external dependencies, printing startup information.

```typescript
export default definePlugin({
  name: "warmup",

  setup(app) {
    app.onReady(async () => {
      // HTTP has started listening and can perform preheating operations
      app.logger.info("Warming up caches...");
      await app.services.product.warmupCache();
      app.logger.info("Cache warmup complete");
    });
  },
});
```

### `app.setValidator()` — Replacement validation engine

Replace the synchronous parameter validator. The default is schema-dsl. This adapter preserves its result contract. For a Zod implementation, use the DSL translation example in [Validation](/guide/validation#replace-verification-engine); do not put Zod instances directly in `RouteOptions.validate`.

```typescript
import { definePlugin } from "vextjs";
import type { VextValidator } from "vextjs";

export default definePlugin({
  name: "validator-wrapper",

  setup(app) {
    const originalValidator = app.getValidator();

    const validator: VextValidator = {
      compile(schema) {
        const validate = originalValidator.compile(schema);
        return (input) => validate(input);
      },
    };

    app.setValidator(validator);
  },
});
```

Replace the validator before route registration and Service schema compilation. Preserve the `valid/data/errors` result contract. Replacing the runtime engine does not expand the static route syntax used by build, Doctor, OpenAPI and generated clients.

### `app.setThrow()` — Wrap error throwing

Wrap or replace `app.throw()`. The wrapper receives the original implementation and must preserve all overloads and its `never` return semantics, including i18n shorthand, positional arguments and object arguments. This Proxy forwards all arguments without narrowing them to four positions:

```typescript
export default definePlugin({
  name: "error-tracker",

  setup(app) {
    const logger = app.logger;
    app.setThrow(
      (originalThrow) =>
        new Proxy(originalThrow, {
          apply(target, thisArg, args) {
            logger.warn("app.throw called");
            return Reflect.apply(target, thisArg, args);
          },
        }),
    );
  },
});
```

### `app.setRateLimiter()` — Replace rate limiting

Prefer the built-in Redis store for ordinary distributed rate limiting; see [Rate Limit](/guide/rate-limit). This fixed-window in-memory example uses global `max/window`. A custom `check` receives only a key; route-level quota overrides are not passed automatically. Enable `rateLimit` in configuration first.

```typescript
export default definePlugin({
  name: "custom-rate-limit",

  setup(app) {
    const counters = new Map<string, { count: number; expires: number }>();
    const { max, window: windowSeconds } = app.config.rateLimit;
    app.setRateLimiter({
      async check(key: string) {
        const now = Date.now();
        let entry = counters.get(key);
        if (!entry || entry.expires <= now) {
          entry = { count: 0, expires: now + windowSeconds * 1000 };
          counters.set(key, entry);
        }
        entry.count += 1;
        return {
          allowed: entry.count <= max,
          remaining: Math.max(0, max - entry.count),
          resetAt: Math.ceil(entry.expires / 1000), // Absolute Unix seconds.
        };
      },
    });
    app.onClose(() => counters.clear());
  },
});
```

This Map removes an expired window only when the same key is accessed again. It has no global capacity or expiry sweep and is not shared across processes. Do not use it unchanged as a production store for an unbounded client set; production implementations must handle those resource limits.

### `app.setRequestIdGenerator()` — Custom request ID

Override the request ID generation algorithm. By default `crypto.randomUUID()` is used.

```typescript
export default definePlugin({
  name: "custom-request-id",

  setup(app) {
    let counter = 0;

    app.setRequestIdGenerator(() => {
      // Use custom format: timestamp + counter
      return `${Date.now()}-${++counter}`;
    });
  },
});
```

## Plug-in loading process

### Startup timing

In the `bootstrap` startup process, plugins are executed in the following stages:

```
1. config → load and merge configuration
2. locales / built-in database / fetch and other enabled startup capabilities → initialize
3. plugins → ⭐ topological sort + execute setup() (here)
4. middlewares → Scan middleware definition
5. services → instantiated services
6. routes → Register routes
7. HTTP listening → onReady hook triggered
```

This means:

- ✅ `app.config` can be accessed in `setup()` (already loaded)
- ✅ `app.logger` can be accessed in `setup()` (already initialized)
- ✅ `app.extend()` / `app.use()` / `app.onClose()` / `app.onReady()` can be called in `setup()`
- ❌ `app.services` cannot be accessed in `setup()` (the service has not been loaded yet)
- ❌ `setup()` **cannot** assume that the route is registered

To perform an operation after all modules have been loaded, use `app.onReady()`.

### Topological sorting

`plugin-loader` performs topological sorting based on `dependencies` declarations:

```typescript
// plugins/database.ts — no dependencies, executed first
definePlugin({ name: 'database', setup: ... });

// plugins/query-cache.ts — depends on database
definePlugin({ name: 'query-cache', dependencies: ['database'], setup: ... });

// plugins/session.ts — depends on query-cache and database
definePlugin({ name: 'session', dependencies: ['query-cache', 'database'], setup: ... });
```

Execution order: `database` → `query-cache` → `session`

If there is a circular dependency (A → B → A), the framework will report a Fail Fast error at startup.

### Timeout protection

Current standard dev, production and test entry points use a 30,000 ms Plugin Loader timeout. Although internal loader options and error messages mention `setupTimeout`, the standard entry points do not pass `config.plugin.setupTimeout`; writing that config cannot change the actual deadline.

On timeout, the framework aborts `context.signal`, rolls back managed setup mutations and revokes controlled writes through that setup parameter. The plugin still owns external resources created before cancellation. Pass the signal to cancellable operations and close partially initialized clients in its own failure/cancellation path. This mechanism cannot interrupt synchronous code blocking the event loop or forcibly stop arbitrary async I/O, and does not automatically cover the separately initialized built-in database plugin.

## Practical example

### Database plug-in

This only illustrates a pool interface and close hook; `createPool` is a stub and does not verify real transactions. Built-in MonSQLize uses `config.database` and `app.db`. A custom SQL plugin should use its own config and extension names to avoid conflicts.

```typescript
// src/plugins/database.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "database",

  async setup(app) {
    //Read database connection information from configuration
    const dbConfig = app.config.sqlDatabase ?? {
      host: "localhost",
      port: 5432,
      database: "myapp",
    };

    // Create database connection (example)
    const pool = await createPool(dbConfig);

    //Inject into app
    app.extend("sql", {
      query: (sql: string, params?: unknown[]) => pool.query(sql, params),
      transaction: (fn: Function) => pool.transaction(fn),
    });

    //Close gracefully
    app.onClose(async () => {
      app.logger.info("Closing database pool...");
      await pool.end();
    });

    //readiness check
    app.onReady(async () => {
      try {
        await pool.query("SELECT 1");
        app.logger.info("Database connection verified");
      } catch (err) {
        app.logger.error({ err }, "Database health check failed");
      }
    });

    app.logger.info("Database plugin initialized");
  },
});
async function createPool(config: any) {
  //In actual implementation, pg, mysql2 and other drivers are used
  return {
    query: async (sql: string, params?: unknown[]) => ({ rows: [] }),
    transaction: async (fn: Function) => fn(),
    end: async () => {},
  };
}
```

### Sentry error monitoring plug-in

This is an integration location only: SDK calls are commented out, so no event is actually reported. Middleware `catch` covers only errors propagated from its `next()`. It does not cover startup, background work or all errors handled by inner layers; see [Hooks](/guide/hooks) for runtime observation.

```typescript
// src/plugins/sentry.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "sentry",

  setup(app) {
    const dsn = app.config.sentry?.dsn;
    if (!dsn) {
      app.logger.warn("Sentry DSN not configured, skipping initialization");
      return;
    }

    //Initialize Sentry
    // Sentry.init({ dsn });

    //Register global error catching middleware
    app.use(async (req, res, next) => {
      try {
        await next();
      } catch (err) {
        //Report to Sentry
        // Sentry.captureException(err, { extra: { requestId: req.requestId } });
        app.logger.error(
          { err, requestId: req.requestId },
          "Error captured by Sentry",
        );

        // Rethrow and let the framework's error-handler handle the response
        throw err;
      }
    });

    app.logger.info("Sentry plugin initialized");
  },
});
```

### Scheduled task plug-in

This `setInterval` is a per-process illustration. Runs can overlap, multiple Workers execute duplicates, and clearing a timer does not cancel work already started. Use [Jobs](/guide/jobs) for durable scheduling, leases and concurrency limits.

```typescript
// src/plugins/scheduler.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "scheduler",

  setup(app) {
    const timers: NodeJS.Timeout[] = [];

    app.extend("scheduler", {
      every(ms: number, name: string, fn: () => Promise<void>) {
        const timer = setInterval(async () => {
          try {
            await fn();
          } catch (err) {
            app.logger.error({ err, task: name }, "Scheduled task failed");
          }
        }, ms);
        timers.push(timer);
        app.logger.info({ name, intervalMs: ms }, "Scheduled task registered");
      },
    });

    //Clear all timers on graceful shutdown
    app.onClose(() => {
      for (const timer of timers) {
        clearInterval(timer);
      }
      app.logger.info(`Cleared ${timers.length} scheduled task(s)`);
    });

    //Register the scheduled task when ready
    app.onReady(async () => {
      (app as any).scheduler.every(
        60_000,
        "cleanup-expired-sessions",
        async () => {
          // await app.services.session.cleanupExpired();
          app.logger.debug("Expired sessions cleaned up");
        },
      );
    });
  },
});
```

## Built-in plug-ins

VextJS has the following built-in plugins:

| Plug-in name  | Description                        | Conditional loading                                                                       |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| **monsqlize** | MonSQLize database ORM integration | Initialize when `config.database` is a nonempty object; skip absent, null or empty config |

The built-in plugin uses `shouldLoadMonSQLize()` to inspect database config and needs no manual registration. It skips absent config. If enabled but a runtime dependency is missing or config is invalid, fix the startup error rather than expecting a silent skip. See [Database](/guide/database).

There is no `database.enabled` off switch. `database: { enabled: false }` is still a nonempty object and enters initialization, then fails without `database.config`.

## File upload

VextJS has built-in `multipart/form-data` parsing, based on Node.js 20+ native `Request.formData()` API, with zero external dependencies. Just turn it on in configuration.

### Enable built-in parsing

```typescript
// src/config/default.ts
export default {
  multipart: {
    enabled: true, // Enable built-in parsing
    maxFileSize: 10 * 1024 * 1024, // The upper limit of a single file is 10MB (default)
    maxFiles: 10, // Maximum number of files at a time (default)
    // allowedMimeTypes: ['image/jpeg', 'image/png'], // Optional: MIME whitelist
  },
};
```

When enabled, built-in parsing fills `req.files` (`ParsedFile[]`) for `multipart/form-data` requests. Plain text parts are not automatically added to `req.body`. When disabled, the built-in multipart branch is skipped.

### Used in routing

```typescript
// src/routes/upload.ts
import { defineRoutes } from "vextjs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      multipart: {
        enabled: true,
        files: {
          avatar: "User avatar",
          resume: { description: "Resume file", required: true },
        },
      },
    },
    async (req, res) => {
      const avatarFile = req.files?.find((f) => f.fieldname === "avatar");
      if (!avatarFile) {
        res.json({ code: 400, message: "File not uploaded" }, 400);
        return;
      }

      // Validate the declared file type.
      if (!avatarFile.mimetype.startsWith("image/")) {
        res.json(
          { code: 400, message: "Only image formats are supported" },
          400,
        );
        return;
      }

      // Save the file (avatarFile.buffer ensures binary integrity)
      const filename = randomUUID();
      const uploadDir = path.resolve("uploads");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, filename), avatarFile.buffer);

      res.json({ filename, size: avatarFile.size });
    },
  );
});
```

Use `multipart.enabled: true` for route-level opt-in when global parsing is disabled. When global parsing is enabled, a route can set `multipart.enabled: false` to skip built-in parsing. The `files` map also feeds OpenAPI `multipart/form-data` generation and required-file runtime checks.

The filename prefix makes this route `/upload`. This snippet requires both `avatar` and `resume` multipart fields. MIME is supplied by the client, not content detection. A request rejected by global parsing cannot be restored by a route override. Non-multipart requests do not trigger `files.required`, so the handler still checks for a file. See [Uploads](/guide/uploads) for full config, curl and 413/415 checks.

### ParsedFile structure

| Field       | Type     | Description                                           |
| ----------- | -------- | ----------------------------------------------------- |
| `fieldname` | `string` | Form field name (`avatar` of `<input name="avatar">`) |
| `filename`  | `string` | Client original file name                             |
| `mimetype`  | `string` | MIME type (such as `image/jpeg`)                      |
| `buffer`    | `Buffer` | Complete binary content of file                       |
| `size`      | `number` | File size (bytes)                                     |

:::tip Fastify users
`multipart.maxFileSize` only limits the size of a single file; the total request body read limit is controlled by `bodyParser.maxBodySize`. When using Fastify, if adapter `bodyLimit` is additionally configured, the actual read boundary will be the smaller of the overall upper limit of adapter `bodyLimit` and body-parser.
:::

### Custom parsing (advanced)

For finer control, a plugin can use a third-party parser such as [busboy](https://github.com/mscdex/busboy). The fragment below reads the entire raw buffer and collects files in memory; **it is not a streaming disk-write solution**. Install busboy and its types first.

Two usage modes are supported:

- **Exclusive mode**: Keep `multipart.enabled` as `false` (default), and the plugin is solely responsible for parsing
- **Coexistence mode**: When `multipart.enabled: true` is used, the global body-parser parses first, and the plug-in detects and exits early through `req.files !== undefined` to avoid double parsing.

It is recommended to add guard at the beginning of the plug-in in coexistence mode so that it can be used safely in both scenarios:

```typescript
// src/plugins/upload-custom.ts
import { definePlugin } from "vextjs";
import type { ParsedFile } from "vextjs";
import busboy from "busboy";

export default definePlugin({
  name: "upload-custom",

  setup(app) {
    app.use(async (req, _res, next) => {
      const ct = req.headers["content-type"] ?? "";
      if (!ct.startsWith("multipart/form-data")) {
        await next();
        return;
      }

      // guard: skip directly when the global body-parser has been parsed to avoid double processing
      if (req.files !== undefined) {
        await next();
        return;
      }

      const rawBuffer = await req._getRawBodyBuffer();

      req.files = await new Promise<ParsedFile[]>((resolve, reject) => {
        const bb = busboy({ headers: { "content-type": ct } });
        const collected: ParsedFile[] = [];

        bb.on("file", (fieldname, stream, info) => {
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            const buffer = Buffer.concat(chunks);
            collected.push({
              fieldname,
              filename: info.filename,
              mimetype: info.mimeType,
              buffer,
              size: buffer.byteLength,
            });
          });
        });

        bb.on("finish", () => resolve(collected));
        bb.on("error", reject);
        bb.write(rawBuffer);
        bb.end();
      });

      await next();
    });
  },
});
```

:::tip file size limit
`app.config.multipart.maxFileSize` is enforced only by the built-in parser. A custom parser must implement its own limits, truncated checks and error cleanup; the wiring above does not do so. Total body reading still obeys bodyParser and adapter limits. `maxFileSize` does not expand that total limit.
:::

## Plug-ins vs middleware vs services

| Aspects               | Plugins                                  | Middleware                                | Services                        |
| --------------------- | ---------------------------------------- | ----------------------------------------- | ------------------------------- |
| Placement directory   | `src/plugins/`                           | `src/middlewares/`                        | `src/services/`                 |
| Definition method     | `definePlugin()`                         | `defineMiddleware()`                      | `export default class`          |
| Execution time        | At startup (one-time)                    | Each request                              | Each method call                |
| Visit `app`           | `setup(app)`                             | `req.app`                                 | `constructor(app)`              |
| Main responsibilities | Extended framework capabilities          | Request interception/processing           | Business logic                  |
| Typical use cases     | Database connection, caching, monitoring | Authentication, logging, current limiting | CRUD, calculation, external API |

**Selection Guide:**

- Need to initialize resources (such as database connections) at startup → **Plug-in**
- Need to intercept every request (like authentication check) → **Middleware**
- Need to encapsulate reusable business logic → **Service**
- Need to add new capabilities to `app` → **plugin** (`app.extend()`)
- Need to replace framework built-in behavior → **plug-in** (`app.setValidator()`, etc.)

## Best Practices

### 1. Conditional initialization

Decide whether to initialize the plug-in based on the configuration to avoid wasting resources when they are not needed:

```typescript
export default definePlugin({
  name: "redis",

  async setup(app) {
    if (!app.config.redis?.enabled) {
      app.logger.info("Redis not configured, skipping");
      return;
    }

    //Initialize...
  },
});
```

### 2. Always register shutdown hooks

If a plugin opens an external connection (database, queue or Redis), register `app.onClose()` or the plugin's `onClose` for normal shutdown without registering the same resource twice. Cleanup remains subject to the app's overall shutdown deadline. Setup failure or timeout rolls back registered hooks, so the plugin must also release resources created during that setup; normal-close hooks alone are insufficient:

```typescript
app.extend("mq", messageQueue);
app.onClose(async () => {
  await messageQueue.close();
});
```

### 3. Explicitly declare dependencies

If a plugin depends on the injection capabilities of other plugins, be sure to declare it in `dependencies` instead of assuming load order:

```typescript
// ✅ Correct — explicit declaration
definePlugin({
  name: "session",
  dependencies: ["redis"],
  setup(app) {
    /* ... */
  },
});

// ❌ Danger — relies on filename ordering
definePlugin({
  name: "session",
  // There are no dependencies. It is assumed that redis will be loaded first because the alphabetical order is in front.
  setup(app) {
    /* ... */
  },
});
```

### 4. Use `app.onReady()` to perform post-processing operations

Operations that need to wait until all modules are loaded (such as warming up the cache) should be placed in `app.onReady()` instead of `setup()`:

```typescript
setup(app) {
  // ❌ services have not been loaded yet during setup
  // await app.services.user.warmupCache();

  // ✅ Everything is ready when onReady
  app.onReady(async () => {
    await app.services.user.warmupCache();
  });
},
```

### 5. Error tolerance

Only optional capabilities that can truly degrade should catch initialization failure and provide a no-op implementation. Required database or auth capabilities should fail startup. The application provides `initAnalytics` below and must also clean up a client that is only partially created:

```typescript
export default definePlugin({
  name: "analytics",

  async setup(app) {
    try {
      const client = await initAnalytics(app.config.analytics);
      app.extend("analytics", client);
    } catch (err) {
      app.logger.warn(
        { err },
        "Analytics plugin init failed, continuing without analytics",
      );
      // Provide an empty implementation to prevent other code from crashing because app.analytics does not exist
      app.extend("analytics", {
        track: () => {},
        identify: () => {},
      });
    }
  },
});
```

## Troubleshooting and verification

| Symptom                                  | Fix                                                                        | Verify                                              |
| ---------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| Plugin did not load                      | Check the real `src` root, extension, exclusion rules and default export   | Inspect startup logs and the `plugin-info` response |
| Already registered or missing dependency | Make `name` unique and use user-plugin names in `dependencies`             | Restart after correction                            |
| `setup context is closed`                | Keep framework mutations within setup; capture external clients separately | Wait for the async task and inspect logs            |
| Connection remains after timeout         | Propagate the signal and close partial clients in `catch`/`finally`        | Confirm release after cancellation                  |
| Services unavailable in setup            | Put later work in `onReady`; keep resource initialization in setup         | Run after ready                                     |
| `extend` conflicts                       | Use an independent extension name or the setter for built-in capabilities  | Verify startup and a call                           |

## Next step

- Understand the [Preload](/guide/preload) mechanism to allow the plug-in package to automatically inject pre-launch scripts (such as OpenTelemetry SDK)
- Learn about the declarative DSL syntax of [Parameter Validation](/guide/validation)
- Learn how to use [middleware](/guide/middleware) with plug-ins
- View plug-in related configuration items in [Configuration](/guide/configuration)
- Explore [Testing](/guide/testing) How to write tests for plugins

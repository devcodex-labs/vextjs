# Database (MonSQLize)

VextJS includes a [MonSQLize](https://github.com/devcodex-labs/monSQLize) database integration for MongoDB. Configuring `database` enables connection management, Model loading and resource cleanup. The application must still supply a reachable database and a valid configuration.

## Read by task

| Goal                                                          | Start here                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Connect, write data, and verify uniqueness for the first time | [Quick Start](#quick-start): configuration, Model, startup plugin, Service, and routes                                               |
| Configure profiles, connection pools, or cache                | [Configuration details](#configuration-details), checking the installed MonSQLize version                                            |
| Identify model names, collection names, and directory scopes  | [Model definition](#model-definition); distinguish raw collection operations from Model behavior                                     |
| Test, modify models, or release resources                     | [Used in testing](#used-in-testing), [Model hot reload](#model-hot-reload-development-mode), [Graceful shutdown](#graceful-shutdown) |
| Migrate existing database code                                | [Compatibility boundary](#compatibility-of-older-code-with-the-current-api)                                                          |

A Collection exposes real collection operations; a Model is a registered model with schema/hooks behavior. Scope selects pool/database and does not rewrite model keys. Ownership means the framework cleans up only model registrations and connections owned by the current application. Complete one CRUD verification before reading advanced upstream APIs as needed.

## Quick Start

First prepare the TypeScript project from [Quick Start](/guide/quick-start) with npm scripts `dev: vext dev`, `build: vext build` and `start: vext start`. Vext includes the MonSQLize runtime dependency; this path needs no second installation.

The following five files form a complete user CRUD example. Prepare a reachable MongoDB, or follow [In-memory database](#use-an-in-memory-database) to add a verification profile and dependency, then start with `npm run dev -- --config database-check`. It uses a separate database name and UUID string `_id`, without ObjectId conversion. This illustrates data access; real account management also needs authentication and authorization.

### 1. Add database config

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  database: {
    databaseName: "vext_docs_database",
    config: { uri: "mongodb://127.0.0.1:27017/vext_docs_database" },
    // The startup plugin waits for indexes before accepting requests.
    monsqlizeOptions: { autoIndex: false },
  },
} satisfies VextUserConfig;
```

### 2. Define a Model

`collection: "users"` selects both the registration key and collection name here. The interface describes query result types, the schema validates at runtime, and the unique index constrains concurrent writes. Put `unique` beside `key`; `options: { unique: true }` does not create the intended unique constraint.

```typescript
// src/models/user.ts
import type { VextModelDefinition } from "vextjs";

export type UserRole = "admin" | "editor" | "viewer";

export interface UserDocument {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export default {
  collection: "users",
  schema: {
    _id: "uuid!",
    name: "string:1-50!",
    email: "email!",
    role: "admin|editor|viewer",
  },
  indexes: [{ key: { email: 1 }, unique: true }],
  options: { timestamps: true },
} satisfies VextModelDefinition;
```

### 3. Wait for the unique index

The built-in database connects and registers Models before user plugins. This plugin waits for index creation before HTTP listens; a failure stops startup. Checking whether an email exists before insertion alone cannot prevent duplicate concurrent writes.

`VextPluginContext` currently treats extension properties as `unknown`. Based on the built-in initialization contract, this example narrows `db` to `VextDatabase | undefined` and checks it. `VextApp.db` in Services is already typed.

```typescript
// src/plugins/database-indexes.ts
import { definePlugin, type VextDatabase } from "vextjs";

export default definePlugin({
  name: "database-indexes",
  async setup(app) {
    const db = app.db as VextDatabase | undefined;
    if (!db) throw new Error("Database is not configured");
    await db.model("users").ensureIndexes({ throwOnError: true });
  },
});
```

<a id="2-in-service"></a>

### 4. Use it in a Service

A Service must be the default export. Select input fields to avoid writing extra request properties. Handle unique conflicts on create and update, and propagate other errors.

```typescript
// src/services/user.ts
import { randomUUID } from "node:crypto";
import type { VextApp } from "vextjs";
import type { UserDocument, UserRole } from "../models/user.js";

type UserInput = { name: string; email: string; role?: UserRole };

export default class UserService {
  constructor(private app: VextApp) {}

  private get users() {
    if (!this.app.db) throw new Error("Database is not configured");
    return this.app.db.model<UserDocument>("users");
  }

  private rethrowWriteError(error: unknown): never {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === 11000 || code === "DUPLICATE_KEY") {
      this.app.throw(409, "User ID or email already exists");
    }
    throw error;
  }

  async findById(id: string) {
    const user = await this.users.findOne({ _id: id });
    if (!user) this.app.throw(404, "User not found");
    return user;
  }

  async findAll({
    page = 1,
    limit = 20,
    role,
  }: {
    page?: number;
    limit?: number;
    role?: UserRole;
  } = {}) {
    const filter = role ? { role } : {};
    const { data, total } = await this.users.findAndCount(filter, {
      skip: (page - 1) * limit,
      limit,
      sort: { _id: 1 },
    });
    return {
      items: data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(input: UserInput) {
    const doc = {
      _id: randomUUID(),
      name: input.name,
      email: input.email,
      role: input.role ?? "viewer",
    };
    try {
      await this.users.insertOne(doc);
    } catch (error) {
      this.rethrowWriteError(error);
    }
    return this.findById(doc._id);
  }

  async update(id: string, input: Partial<UserInput>) {
    const changes: Partial<UserInput> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.email !== undefined) changes.email = input.email;
    if (input.role !== undefined) changes.role = input.role;
    if (Object.keys(changes).length === 0)
      this.app.throw(400, "No fields to update");
    try {
      const result = await this.users.updateOne({ _id: id }, { $set: changes });
      if (result.matchedCount === 0) this.app.throw(404, "User not found");
    } catch (error) {
      this.rethrowWriteError(error);
    }
    return this.findById(id);
  }

  async delete(id: string) {
    const result = await this.users.deleteOne({ _id: id });
    if (result.deletedCount === 0) this.app.throw(404, "User not found");
  }
}
```

### 5. Register routes

The `src/routes/users.ts` filename provides the `/users` prefix. Register `"/"` and `"/:id"` inside it. Pagination accepts bounded integers and partial updates use PATCH. Validate inputs when calling these methods directly from background work or another Service too.

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: {
        query: {
          page: "integer:1-1000",
          limit: "integer:1-100",
          role: "admin|editor|viewer",
        },
      },
    },
    async (req, res) => {
      res.json(await app.services.user.findAll(req.valid("query")));
    },
  );
  app.get(
    "/:id",
    { validate: { param: { id: "uuid!" } } },
    async (req, res) => {
      res.json(await app.services.user.findById(req.valid("param").id));
    },
  );
  app.post(
    "/",
    {
      validate: {
        body: {
          name: "string:1-50!",
          email: "email!",
          role: "admin|editor|viewer",
        },
      },
    },
    async (req, res) => {
      const user = await app.services.user.create(req.valid("body"));
      res.setHeader("Location", `/users/${user._id}`);
      res.json(user, 201);
    },
  );
  app.patch(
    "/:id",
    {
      validate: {
        param: { id: "uuid!" },
        body: {
          name: "string:1-50",
          email: "email",
          role: "admin|editor|viewer",
        },
      },
    },
    async (req, res) => {
      res.json(
        await app.services.user.update(
          req.valid("param").id,
          req.valid("body"),
        ),
      );
    },
  );
  app.delete(
    "/:id",
    { validate: { param: { id: "uuid!" } } },
    async (req, res) => {
      await app.services.user.delete(req.valid("param").id);
      res.json(null, 204);
    },
  );
});
```

### 6. Start and verify

Run `npx vext typegen` to generate Service types, then `npm run dev`. For a temporary database, select `--config database-check` as described in testing below. Create a record with a new email: the response is 201, and `data._id` is the ID used for later requests:

```powershell
$body = @{ name = "Alice"; email = "alice@example.com" } | ConvertTo-Json
$created = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/users -ContentType "application/json" -Body $body
$userId = $created.data._id
Invoke-RestMethod "http://127.0.0.1:3000/users/$userId"
Invoke-RestMethod "http://127.0.0.1:3000/users?page=1&limit=20"
$change = @{ name = "Alice Updated" } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:3000/users/$userId" -ContentType "application/json" -Body $change
Invoke-WebRequest -Method Delete -Uri "http://127.0.0.1:3000/users/$userId"
```

After creating, POST the same email again and expect 409. An invalid email or fractional page returns 422; an invalid path UUID returns 400. DELETE succeeds with an empty 204 body; a later GET returns 404. Restart after changing environment or config. Stop dev, run `npm run build -- --typecheck` and `npm start`, and repeat. With a temporary database, pass `--config database-check` to both commands as described below; data does not survive restart.

## Working principle

### Conditional loading

MonSQLize initializes only when `config.database` is a **nonempty object**. Absent or empty config skips setup, connection and hooks; the package remains a Vext runtime dependency.

```
bootstrap()
  → Check whether config.database is a nonempty object
  → Yes → Create MonSQLize instance → Connect → Load Model → Mount app.db
  → No → Skip plugin setup
```

### Loading time

MonSQLize is loaded before user plugins, ensuring that `app.db` can be used safely in `setup()` of user plugins:

```
CLI bootstrap
  → Built-in MonSQLize plugin setup() ← here
  → User plugin plugin-loader ← app.db is available
  → middleware-loader
  → service-loader
  → router-loader
```

### Fail Fast

When the database connection fails, the plug-in will directly throw an error and terminate the startup - it will not let the application run in a state where the database is unavailable:

```
[monsqlize] connected successfully ← normal
[monsqlize] plugin ready

[monsqlize] Error: connect ECONNREFUSED 127.0.0.1:27017 ← Connection failed, startup terminated
```

## Configuration details

### Basic connection

The built-in integration currently uses MongoDB. Put the connection string in `config.uri`; `config.url` is a compatibility alias. An explicit `databaseName` takes priority; otherwise Vext tries to extract it from the URI path. Set it explicitly for tests and multi-node URIs.

```typescript
// src/config/default.ts
export default {
  database: {
    // Connection configuration.
    config: {
      uri: "mongodb://localhost:27017/myapp",
    },
  },
};
```

### Replica set connection

Put node addresses, authentication and replica-set options in the MongoDB URI:

```typescript
export default {
  database: {
    databaseName: "myapp",
    config: {
      uri: "mongodb://admin:secret@mongo1:27017,mongo2:27017,mongo3:27017/myapp?replicaSet=rs0&authSource=admin",
    },
  },
};
```

### SRV connection (MongoDB Atlas)

```typescript
export default {
  database: {
    databaseName: "myapp",
    config: {
      uri: "mongodb+srv://admin:secret@cluster0.abc123.mongodb.net/myapp",
    },
  },
};
```

Percent-encode URI reserved characters in usernames or passwords. Driver options can go in `config.options`. Legacy `database.type` values `url/replica/srv` remain in compatibility types, but the current plugin creates a MongoDB instance for each and does not assemble an address from that field. Separate `host`, `hosts` or `username` fields cannot replace `config.uri`.

### Complete configuration items

| Configuration item    | Type                          | Default value                       | Description                                                                                |
| --------------------- | ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `type`                | `'url' \| 'replica' \| 'srv'` | `'url'`                             | Compatibility field; URI determines the actual connection method                           |
| `config`              | `object`                      | —                                   | `uri` connection string and driver `options`; `url` is compatibility-only                  |
| `maxTimeMS`           | `number`                      | `2000`                              | Global query timeout (milliseconds)                                                        |
| `findLimit`           | `number`                      | `10`                                | `find` returns the number of items by default                                              |
| `findPageMaxLimit`    | `number`                      | `500`                               | Maximum paging limit                                                                       |
| `slowQueryMs`         | `number`                      | `500`                               | Slow query threshold (milliseconds)                                                        |
| `autoConvertObjectId` | `boolean \| object`           | Enabled by upstream MongoDB default | Common cases use a boolean; the UUID example does not depend on conversion                 |
| `namespace`           | `{ scope: string }`           | `{ scope: 'database' }`             | cache namespace                                                                            |
| `cursorSecret`        | `string`                      | —                                   | Deep-pagination cursor signing key; signing does not hide cursor content                   |
| `useMemoryServer`     | `boolean`                     | `false`                             | Start a temporary MongoDB process for tests; extra dependency required                     |
| `memoryServerOptions` | `object`                      | —                                   | Options passed to `MongoMemoryServer.create()`, such as binary version                     |
| `logger`              | `'app' \| false`              | `'app'`                             | Log bridging (`'app'` uses app.logger)                                                     |
| `cache`               | `object`                      | —                                   | Cache configuration (see below)                                                            |
| `models`              | `object`                      | —                                   | Model loading configuration (see below)                                                    |
| `databaseName`        | `string`                      | Attempt URI extraction              | Explicit value takes priority; set it for temporary servers and multi-node URIs            |
| `pools`               | `array`                       | —                                   | Multiple connection pool configuration                                                     |
| `poolStrategy`        | `string`                      | `'auto'`                            | Connection pool selection strategy                                                         |
| `slowQueryLog`        | `object`                      | —                                   | Slow query persistence configuration                                                       |
| `monsqlizeOptions`    | `VextMonSQLizeOptions`        | —                                   | Controlled advanced MonSQLize options; connection and Vext lifecycle keys remain protected |

### Controlled advanced MonSQLize options

Use `database.monsqlizeOptions` when an application needs an upstream
constructor capability that does not replace a Vext-owned connection or
lifecycle setting:

```typescript
import type { VextUserConfig } from "vextjs";

export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },
    monsqlizeOptions: {
      findMaxLimit: 2_000,
      findMaxSkip: 20_000,
      transaction: { enableRetry: true, maxRetries: 2 },
      autoIndex: { enabled: true, emitEvents: true },
      cacheAutoInvalidate: true,
      writePathPolicy: { default: "model-only" },
    },
  },
} satisfies VextUserConfig;
```

The public `VextMonSQLizeOptions` type is picked directly from the pinned
`monsqlize@3.3.0` `MonSQLizeOptions`. The runtime uses the same allowlist:

- `schemaDsl`
- `poolFallback`, `maxPoolsCount`
- `sync`, `transaction`
- `findMaxLimit`, `findMaxSkip`
- `requireCursorSecret`, `cursorSecretWarning`, `cursorTypes`,
  `cursorValueNormalizer`
- `log`, `countQueue`, `autoIndex`, `cacheAutoInvalidate`, `writePathPolicy`

Vext rejects unknown keys and these Vext-owned keys before the MonSQLize
constructor runs: `type`, `databaseName`, `database`, `config`, `cache`,
`logger`, `pools`, `poolStrategy`, `maxTimeMS`, `findLimit`,
`findPageMaxLimit`, `slowQueryMs`, `slowQueryLog`, `autoConvertObjectId`,
`namespace`, `cursorSecret`, and `models`. Configure those through their
first-class `database.*` fields so connection normalization, logging, model
loading, and shutdown remain deterministic.

### Cache configuration

MonSQLize supports L1 memory LRU and optional L2 Redis. Configuring storage does not automatically cache every query; pass a TTL in milliseconds, such as `users.findOne(filter, { cache: 5_000 })`. Write invalidation does not provide cross-process transaction consistency.

```typescript
export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },

    cache: {
      // L1 memory cache (enabled by default)
      memory: {
        enabled: true,
        maxSize: 1000, // Maximum number of cached items
        ttl: 300_000, // Default TTL in milliseconds (5 minutes)
      },

      // L2 Redis cache (optional)
      redis: {
        enabled: true,
        uri: "redis://localhost:6379",
        prefix: "myapp:cache:",
        ttl: 600_000, // Milliseconds, 10 minutes
      },
    },
  },
};
```

Use `uri` as the Redis cache connection field. `url` is kept only as a compatibility alias for older configs; new projects should use `uri`.

The TTLs above are explicit values. When a `cache` object is supplied without disabling memory, Vext currently fills missing `memory.ttl` with **300 milliseconds** and `maxSize` with 1000; set TTL explicitly. `memory.enabled: false` only prevents Vext from passing that branch; upstream may still create its default L1. Without query caching, do not pass a positive query `cache` option. Likewise, `logger: false` disables only the Vext logger bridge and does not guarantee upstream silence.

### Multiple environment configuration

Runtime deep merge supports environment-specific database patches, but the TypeScript files have different responsibilities. `default.ts` is the complete base and uses `VextUserConfig`; profile files are later patches and use `VextConfigOverride`.

:::warning Do not split a half database across layers
Do not put only `findLimit` / `models` in `default.ts` and leave the required `config.uri` for `development.ts`. The `database` object written in `default.ts` must satisfy `MonSQLizeDatabaseConfig` by itself; TypeScript does not postpone that check until runtime merging. Put a complete connection in the base, then override only environment differences later.
:::

`MonSQLizeDatabaseConfig` requires a `config` object, but its compatibility-typed `uri/url` fields are optional. Type checking alone therefore does not prove a connection string exists or is reachable; verify with an actual startup.

There are two sound layouts. Either keep one complete `database` in
`default.ts` and use `VextConfigOverride` for partial profile differences, as
below, or omit `database` entirely from `default.ts` and make every profile that
enables it supply a complete `MonSQLizeDatabaseConfig`. In the second layout,
validate the profile's database value against `MonSQLizeDatabaseConfig`; do not
use the looser override type to hide a missing connection when no earlier
database layer exists.

#### Layout A — complete database in the base

```typescript
// src/config/default.ts — complete base
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },
    findLimit: 10,
    models: { dir: "models" },
    slowQueryMs: 500,
  },
};

export default config;
```

```typescript
// src/config/development.ts — a valid partial database patch
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  database: {
    findLimit: 25,
    models: { validation: "strict" },
  },
};

export default config;
```

```typescript
// src/config/production.ts — patch the environment-specific connection URI
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  database: {
    config: {
      uri: "mongodb://prod-db:27017/myapp",
    },
    slowQueryMs: 200, // The slow query threshold in the production environment is lower
  },
};

export default config;
```

```typescript
// src/config/database-check.ts — Temporary database for verification.
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  database: {
    databaseName: "vext_docs_database_test",
    useMemoryServer: true, // use mongodb-memory-server-core
  },
};

export default config;
```

#### Layout B — database starts in a profile

If the base deliberately omits `database`, the first profile that enables it
must own a complete value. Validate that value with the strict database type,
then place it in the profile override:

```typescript
// src/config/development.ts — no earlier database layer exists
import type { MonSQLizeDatabaseConfig, VextConfigOverride } from "vextjs";

const database = {
  config: { uri: "mongodb://localhost:27017/myapp" },
  findLimit: 25,
  models: { dir: "models", validation: "strict" },
} satisfies MonSQLizeDatabaseConfig;

const config = { database } satisfies VextConfigOverride;

export default config;
```

Repeat the complete `MonSQLizeDatabaseConfig` in every independently selectable
profile that can be the first layer to enable the database.

## app.db — raw MonSQLize instance

After initialization, `app.db` is the exact raw `MonSQLize` instance created by
the built-in plugin. Vext does not put it behind a facade or Proxy. It only
decorates that same object with a read-only `client` getter and narrow
soft-delete result compatibility, so upstream instance methods such as
`withTransaction()`, `on()`, `sync()`, `pool()`, and `scopedModel()` remain
available from the single `app.db` entry point.

The following snippets assume the database is configured and `app` comes from
a Service or plugin. In TypeScript, first check
`if (!app.db) throw new Error("Database is not configured")`. Supply IDs,
amounts, and vectors from application inputs; these snippets are not additional
complete project files.

### collection(name)

Get a collection operation object. Direct collection writes bypass Model
schemas, hooks, and timestamps. Use `model()` when those semantics are needed;
`writePathPolicy` can restrict the write path:

```typescript
// Get the users collection
const usersCol = app.db.collection("users");

// Query
const user = await usersCol.findOne({ email: "test@example.com" });
const users = await usersCol.find({ role: "admin" });

// insert
const result = await usersCol.insertOne({
  name: "Zhang San",
  email: "zhangsan@example.com",
});

// update
await usersCol.updateOne({ _id: userId }, { $set: { name: "Li Si" } });

// delete
await usersCol.deleteOne({ _id: userId });

// aggregation
const stats = await usersCol.aggregate([
  { $group: { _id: "$role", count: { $sum: 1 } } },
]);

// count
const total = await usersCol.countDocuments({ role: "admin" });
```

### model(name)

Get the registered Model operation object (you need to define the Model first, see the Model chapter below):

```typescript
// src/models/user.ts exports { collection: "users", ... }, so the root key is
// exactly "users". The lookup does not singularize or PascalCase it.
const User = app.db.model("users");

// Model provides more advanced API (paging, caching, verification, etc.)
const result = await User.findPage({
  query: { role: "admin" },
  page: 1,
  limit: 20,
  sort: { createdAt: -1, _id: -1 },
  totals: { mode: "sync" },
});
const { items, pageInfo, totals } = result;
```

`findPage(options)` takes one options object with a `query` filter. It returns `items`, `pageInfo`, and optional `totals/meta`; do not pass two arguments or read `result.data`. Cursor pagination uses `after` / `before` with consistent filters and stable ordering.

`findAndCount(query, options)` returns `{ data, total }`; `find(query, options)` is also a valid native API. Use native pagination instead of fetching a fixed number of documents and filtering, counting, or slicing them in a service. Validate page, limit, cursor, and limit-exceeded behavior with request and database tests.

TypeScript consumers use `app.db.model<PostDocument>(registeredKey)` for native query result types. Domain documents may live in `src/types/server/models/`, while service input/output contracts belong in `src/types/server/services/`; project conventions can override these defaults. Do not duplicate Collection or Repository interfaces. Some write inputs accept `unknown`, so input types, request schemas, and model schemas remain necessary.

Query `cache`, `cache.memory.ttl`, and `cache.redis.ttl` values are milliseconds. Session store `ttlSeconds` uses seconds and is converted by its adapter. Configuration values are forwarded unchanged; this documentation correction does not convert runtime values.

<a id="pagination-and-validation-boundaries"></a>

### Pagination totals and caching

In current MonSQLize, totals from `findPage({ totals: { mode: "sync" } })` can
still come from a separate cache; `totals.ttlMs` defaults to 600000 ms.
`cache: 0` does not force a recount. Do not display a count failure returned as
`null/error` as zero. For numbered pagination that needs a direct count, use
`findAndCount()` from the Quick Start and consume `data/total`. Its two reads
are not a transaction snapshot. See Model definition and Services for array
fields and unique error codes.

### use(dbName)

Switch to the specified database (default connection pool), suitable for single connection and multiple database scenarios:

```typescript
//Access the invoices collection of the billing database
const billing = app.db.use("billing");
const invoice = await billing.collection("invoices").findOne({ _id: id });

// Can also be called directly in a chain
const anotherInvoice = await app.db
  .use("billing")
  .collection("invoices")
  .findOne({ _id: id });

// use() changes the database scope; it does not rewrite the registry key.
// A depth-1 file such as models/billing/invoice.ts is registered as BillingInvoice.
const Invoice = app.db.use("billing").model("BillingInvoice");
```

### pool(poolName)

First configure pool names and reachable addresses, for example by merging
this fragment into the application's `database` configuration:

```typescript
// Inside database; prepare these two MongoDB instances first.
pools: [
  { name: "cn", config: { uri: "mongodb://127.0.0.1:27018/myapp" } },
  { name: "billing", config: { uri: "mongodb://127.0.0.1:27019/billing" } },
],
poolStrategy: "auto",
```

Put pool driver options in `options` alongside `name/config`. A Model lookup
below also requires a registered definition or alias; configuring a database
connection alone does not create a Model.

Switch to the specified connection pool and return accessors containing `collection` / `model` / `use`:

```typescript
//Access the orders collection of cn pool
const order = await app.db.pool("cn").collection("orders").findOne({ _id: id });

// Direct Model access in a pool still uses the exact registered key.
const Invoice = app.db.pool("billing").model("BillingInvoice");
// A short key works only when the Model explicitly declares key: "Invoice".
const InvoiceAlias = app.db.pool("billing").model("Invoice");

// cn pool + billing library (collection)
const invoice = await app.db
  .pool("cn")
  .use("billing")
  .collection("invoices")
  .findOne({});

// cn pool + billing database + exact Model registry key
const InvoiceCn = app.db.pool("cn").use("billing").model("BillingInvoice");

// Depth-2 model directory (models/cn/billing/order.ts): Registration key = CnBillingOrder
// Scope accessors do not add prefixes or fall back to another key.
const Order1 = app.db.model("CnBillingOrder"); // Complete key
const Order2 = app.db.pool("cn").use("billing").model("CnBillingOrder");
// Order1 and Order2 resolve the same registered Model in different explicit scopes.
```

> ⚠️ `pool()` will immediately check whether the connection pool exists before returning an accessor. If no pool manager is configured, it throws `NO_POOL_MANAGER`. If the named pool cannot be found, it throws `POOL_NOT_FOUND` (`err.available` contains the list of available pools). Model / collection / use are only reachable after this check succeeds.

> ℹ️ **The `dbName` in `pool().use(dbName)` will overwrite the value of `connection.database` in the Model definition**. For example, Model defines `connection.database: "billing"`, and when accessed through `pool("cn").use("archive")`, the actual query will use the `archive` database instead of `billing`.
> To resolve an exact key while overriding the database/connection pool explicitly, use `app.db.scopedModel(key, { pool, database })`.

### client

The read-only `client` getter points to the default connection's raw MongoDB
Client. This transaction example requires a replica set or sharded cluster;
a standalone temporary instance cannot validate it. `fromId`, `toId`, and
`amount` come from application input. Pass the same `session` to operations in
one transaction, and do not use it across pools belonging to another Client:

```typescript
const session = app.db.client.startSession();
try {
  await session.withTransaction(async () => {
    await app.db
      .collection("accounts")
      .updateOne({ _id: fromId }, { $inc: { balance: -amount } }, { session });
    await app.db
      .collection("accounts")
      .updateOne({ _id: toId }, { $inc: { balance: amount } }, { session });
  });
} finally {
  await session.endSession();
}
```

## Full MonSQLize API on app.db

`app.db` is the raw `MonSQLize` instance, not a reduced Vext wrapper. There is
no separate `app.monsqlize` entry point in v2.

```typescript
const monsqlize = app.db;
if (!monsqlize) throw new Error("Database is not configured");

// Full instance APIs stay available from app.db.
await monsqlize.withTransaction(async (transaction) => {
  // ...
});
monsqlize.on("slow-query", (info) => {
  app.logger.warn({ ...info }, "Slow query detected");
});

// app.db returns upstream Collection / Model instances.
const hits = await monsqlize.collection("products").vectorSearch({
  index: "product_embedding",
  path: "embedding",
  queryVector: embedding,
  numCandidates: 100,
  limit: 10,
});

const Product = monsqlize.model("Product");
const usage = await Product.checkRelationUsage({ _id: productId });
await Product.deleteOneWithRelations({ _id: productId });
```

:::tip
Use the single `app.db` entry point for collections, Models, transactions,
pools, sync, events, diagnostics, and management APIs. Vector Search requires a
compatible MongoDB deployment and a pre-created index. Relation-protected
deletion only covers registered, declared relations; inspect the returned
coverage before treating it as complete.
:::

Vext's root package exports Vext-owned integration types such as
`VextMonSQLizeOptions`; it does not mirror every upstream symbol. Import
MonSQLize-specific classes and types from `monsqlize` when you need them.

### Typed descriptors for manual registration (3.3.0)

MonSQLize 3.3.0 can infer a Model document type from an object-literal schema.
If application code imports this package-level API, declare a compatible
`monsqlize` version as a direct application dependency and confirm that it
resolves to the same Model registry as Vext, instead of relying on accidental
dependency hoisting. Version 3.3.0 identifies the upstream version checked in
this repository; it does not pin the Vext installation version. Register the
descriptor once before resolving it from the raw instance:

```typescript
import { defineModel, Model } from "monsqlize";
import type { VextApp } from "vextjs";

const UserDescriptor = defineModel("manual_users", {
  schema: {
    email: "email!",
    age: "number?",
  },
});

Model.define(UserDescriptor);

export async function findUser(app: VextApp, email: string) {
  const User = app.db?.model(UserDescriptor);
  return User?.findOne({ email }); // email: string; age?: number
}
```

This is an explicit upstream registration path. Do not export the descriptor
as the default value of a `src/models/*` file: Vext's automatic Model loader
continues to accept definition objects and derives the registry key using the
rules below. Because `app.db` is the raw instance, manual code may pass either
an exact string key or an upstream typed descriptor to `app.db.model()`.
Manual registration is outside Vext's automatic loader ownership and hot
reload plan. The application must arrange one-time registration, conflict
handling, and cleanup. Do not run `Model.define()` for every request or module
reload.

## Model definition

Model is an encapsulation of collection operations and provides advanced capabilities such as field verification, hooks, and virtual fields.

### Create Model file

> The MonSQLize Model layer integrates **schema-dsl**, and the schema field supports DSL concise syntax.

#### Recommended writing method: schema-dsl concise syntax + options.timestamps

This reference snippet shows fields and compound indexes. If combining it
with the UUID Quick Start, retain the original `_id` schema and result types.

```typescript
// src/models/user.ts
export default {
  collection: "users",

  // schema-dsl concise syntax
  schema: {
    name: "string:1-50!", // Required string, 1~50 characters
    email: "email!", // required, email format
    role: "admin|editor|viewer", // enumeration value
    avatar: "string", // optional string
  },

  // index
  indexes: [
    { key: { email: 1 }, unique: true },
    { key: { role: 1, createdAt: -1 } },
  ],

  // Use options.timestamps to automatically manage createdAt/updatedAt
  options: {
    timestamps: true,
  },
};
```

#### Object format (complex cases)

Fields can use JSON Schema objects. Mark required fields with a `!` suffix on
their names. Put dynamic defaults in top-level Model `defaults`; enforce
uniqueness with `indexes` rather than a field-level `unique: true`. This
example uses a separate `members` registry key and can coexist with the
`users` Model in the Quick Start.

```typescript
// src/models/member.ts
import { randomUUID } from "node:crypto";
import type { VextModelDefinition } from "vextjs";

export default {
  collection: "members",
  schema: {
    "_id!": { type: "string", format: "uuid" },
    "name!": { type: "string", minLength: 1, maxLength: 50 },
    "email!": { type: "string", format: "email" },
    role: { type: "string", enum: ["admin", "editor", "viewer"] },
    tags: { type: "array", items: { type: "string" } },
    slug: { type: "string" },
  },
  defaults: { _id: () => randomUUID(), role: "viewer" },
  indexes: [{ key: { email: 1 }, unique: true }],
  hooks: {
    beforeInsert(context) {
      const doc = context.data;
      if (typeof doc !== "object" || doc === null || !("name" in doc)) return;
      if (typeof doc.name === "string") {
        Object.assign(doc, {
          slug: doc.name.toLowerCase().replace(/\s+/g, "-"),
        });
      }
    },
  },
  options: { timestamps: true },
} satisfies VextModelDefinition;
```

For arrays, use explicit `{ type: "array", items: { type: "string" } }` or
the `array<string>` DSL. The current schema-dsl 3.0.4 does not compile the
`["string"]` shorthand correctly; static candidate checks also require an
explicit structure. Validate schema behavior with a real write; TypeScript
alone cannot prove runtime validation.

### Model options

| Options      | Type                | Default     | Description                                   |
| ------------ | ------------------- | ----------- | --------------------------------------------- |
| `timestamps` | `boolean \| object` | `undefined` | Automatic management createdAt/updatedAt      |
| `softDelete` | `boolean \| object` | `undefined` | Soft delete support                           |
| `version`    | `boolean \| object` | `undefined` | Optimistic locking version number             |
| `validate`   | `boolean`           | `true`      | Schema validation switch during insert/update |

Object-style `hooks` follow monSQLize and receive a `context` argument; write payloads are commonly available from `context.data`. Use the `(model) => ({ ... })` factory form when the hook needs access to the Model instance.

#### timestamps configuration

```typescript
// Simple mode: automatically add createdAt + updatedAt
options: { timestamps: true }

//Custom field name
options: { timestamps: { createdAt: 'created_time', updatedAt: 'updated_time' } }

// Only enable createdAt (log class collection)
options: { timestamps: { createdAt: true, updatedAt: false } }
```

### `key` alias (quick access across connection pools)

When the Model collection name contains a prefix (such as `BillingInvoice`), you can define a `key` alias and access it quickly through the short name:

```typescript
// src/models/billing-invoice.ts
export default {
  collection: "BillingInvoice", // MongoDB actual collection name
  key: "Invoice", // short name alias (optional)

  schema: {
    amount: "number!",
    currency: "CNY|USD|EUR",
    status: "draft|pending|paid",
  },

  // Bind to the specified connection pool + database (make app.db.model() routing correct)
  connection: {
    pool: "billing",
    database: "billing",
  },
};
```

After registration, both keys can be used:

```typescript
app.db.model("BillingInvoice"); // By collection name (full path)
app.db.model("Invoice"); // By alias (short name)

// Scope changes do not transform either exact key.
app.db.pool("billing").model("BillingInvoice");
app.db.pool("billing").model("Invoice");
```

> **Note**: The primary key and `key` alias are checked as one Model registration group. A conflict fails loading under the default `validation: "strict"`; explicit `"lenient"` warns and skips the invalid group. It does not promise to discard only the alias while retaining the primary.

Model files are placed in the `src/models/` directory, and the plug-in will automatically scan and register:

```
src/
├── models/
│ ├── user.ts → Model name: 'User'
│ ├── order.ts → Model name: 'Order'
│ ├── product-item.ts → Model Name: 'ProductItem'
│ └── index.ts → Model name: 'Index' unless collection/name overrides it
```

Rules for inferring Model names from file names:

- `user.ts` → `'User'` (first letter is capitalized)
- `order-item.ts` → `'OrderItem'` (kebab-case → PascalCase)
- `user_role.ts` → `'UserRole'` (snake_case → PascalCase)
- `.test.ts` / `.spec.ts` / `.d.ts` → skip
- files prefixed with `_` → skip
- `index.ts` is a normal Model file; at root it infers `'Index'`

### Directory routing (automatically binds connection pool/database)

Placing the Model file in a subdirectory of `models/` allows vext to automatically infer the connection pool and database it belongs to, without having to manually fill in the `connection` field in each file.

**Directory depth rules:**

| Directory structure              | Registration key name                                     | Automatic injection                                 |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `models/order.ts`                | `Order` (or `def.collection` / `def.name`)                | None (no change in behavior)                        |
| `models/billing/invoice.ts`      | `BillingInvoice`                                          | `connection: { database: 'billing' }`               |
| `models/main/billing/invoice.ts` | `MainBillingInvoice`                                      | `connection: { pool: 'main', database: 'billing' }` |
| `models/a/b/c/invoice.ts`        | ❌ depth exceeds 2: strict fails; lenient warns and skips | —                                                   |

> 💡 An explicit `connection` does not relax the maximum scan depth. For more complex database routing, keep files within the supported depth and specify connection details, or organize definitions in a shared Model package.

**Example: Split Model by Business Area**

```
src/models/
├── order.ts → Register as 'Order' (default database)
├── billing/
│ ├── invoice.ts → registered as 'BillingInvoice', database: 'billing'
│ └── payment.ts → Registered as 'BillingPayment', database: 'billing'
└── main/
    └── billing/
        └── invoice.ts → Registered as 'MainBillingInvoice', pool: 'main', database: 'billing'
```

```typescript
// src/models/billing/invoice.ts
import type { VextModelDefinition } from "vextjs";

// No need to manually write connection - automatically inferred from directory path
export default {
  schema: {
    amount: "number!",
    currency: "CNY|USD|EUR",
    status: "draft|pending|paid",
  },
} satisfies VextModelDefinition;

// The effect is equivalent to explicit configuration:
// export default {
// name: "invoice",
// connection: { database: "billing" },
// schema: { ... },
// };
```

**Three names and injection priority:** At root, the primary registration key is `collection ?? name ?? PascalCase(file)`. At directory depths one and two, the primary always comes from the full relative path, such as `BillingInvoice`. `collection` / `name` determines the actual collection; without either, directory routing uses the raw filename `invoice`, not `BillingInvoice`. `key` adds a separate exact alias without changing the primary. An explicit `connection` wins as a whole; directory routing does not fill or override its fields. `app.db.model()` accepts exact registration keys; `app.db.collection()` directly addresses a collection.

### Model loading configuration

```typescript
export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },

    models: {
      // Model definition file directory (relative to src/, default 'models')
      dir: "models",

      // Whether to automatically register (default true)
      autoRegister: true,

      // Discovery policy: strict (default) or lenient
      validation: "strict",

      // External shared Model package (microservice scenario)
      sharedPackage: "@myproject/shared-models",
    },
  },
};
```

`validation: "strict"` completes discovery, imports, resolution, and validation before mutating the global Model registry. Any invalid definition, collision, or commit failure aborts startup and rolls back the whole registration plan. Explicit `"lenient"` mode warns and skips invalid discovery inputs only; registry collisions and commit failures still fail closed. Registrations are owned by the application and released on close without clearing another application's Models.

### Shared Model package (microservice scenario)

In a microservice architecture, multiple services may share the same set of Model definitions. Loading from npm package via `sharedPackage`:

```typescript
//Loading order: shared package first → then local models/
// A local Model can override a shared Model with the same primary key.
models: {
  sharedPackage: '@myproject/shared-models',
  dir: 'models', // Local Models
}
```

Local overriding applies only to the same primary registration key. Alias
and other registration group conflicts still follow discovery and
registration rules.

The shared package must default-export a model-definition object such as `{ User: { schema: ... } }`. Callback-style `registerModels()` packages are rejected because Vext cannot preflight, attribute ownership, or roll back keys registered through an opaque callback.

Shared packages resolve from the service root, including hoisted monorepo dependencies and pnpm links. Resolution uses the Node `node` / `import` export conditions and accepts ESM defaults, CommonJS `module.exports`, and compiled `__esModule`/default wrappers. Development output directories do not change the dependency owner. Private export paths and missing compiled files produce errors; build the shared package before starting its consumers.

## Used in services

### Basic CRUD service

The [Quick Start](#quick-start) contains this page's complete
`src/services/user.ts`: a default-exported class, explicit input and result
types, Model validation and timestamps, conversion of unique index conflicts,
bounded pagination, and 404 handling. The Service obtains the Model through a
getter so a long-lived object does not retain a stale Model instance.

`findAndCount(query, { skip, limit, sort })` returns `data/total`. Do not
first fetch a fixed number of documents and then filter or `slice` the array.
The two reads are not a transaction snapshot and can differ under concurrent
writes. Request validation bounds page and limit; other callers must enforce
the same constraints.

### Use with routes

Reuse `src/routes/users.ts` from the Quick Start: GET/POST `/users` and
GET/PATCH/DELETE `/users/:id`. Do not register `"/users"` a second time in
this page. The default JSON response wrapper places the result in `data`; a
204 response has no body.

A MongoDB unique key error may have numeric code `11000` or an upstream
normalized code `"DUPLICATE_KEY"`. The Service maps the unique user ID and
email constraints in this example to 409 and propagates other errors. Do not
swallow failures by searching for a word in error text. Validate both request
and Model schemas; a TypeScript pass does not prove a database write is valid.

## Used in plugins

Built-in MonSQLize initializes before user plugins as part of bootstrap. User
plugins do not need to name the built-in plugin in `dependencies`. The
`database-indexes` plugin in the Quick Start is a complete example of waiting
for database work in `setup`.

You can initialize data in `setup`, but every process runs it. Checking
whether the count is zero before inserting an admin is not safe under
concurrency. Initialize accounts according to application authentication,
idempotency keys, and unique constraints, and handle multi-process races.
The `dependencies` field orders user plugins that actually exist.

## Used in testing

### Use an in-memory database

Install `mongodb-memory-server-core` to run a test database without an
external MongoDB instance:

```bash
npm install -D mongodb-memory-server-core
```

Vext uses the core package so the `mongodb-memory-server` wrapper does not
download a binary during `npm install`. The first test start may still
download a MongoDB binary. In CI, set
`MONGOMS_DOWNLOAD_DIR=.cache/mongodb-binaries` and
`MONGOMS_PREFER_GLOBAL_PATH=false`, and cache that directory. After a cache
hit, use `MONGOMS_RUNTIME_DOWNLOAD=false` to confirm that no new download is
needed.

The partial `database-check.ts` profile below is valid only when an earlier layer already owns
the complete database config. If `default.ts` omits
`database`, this profile must supply a complete
`MonSQLizeDatabaseConfig` instead.

```typescript
// src/config/database-check.ts
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  database: {
    databaseName: "vext_docs_database_test",
    useMemoryServer: true,
  },
};

export default config;
```

Vext creates the temporary instance on startup and stops it on shutdown. It
is a real `mongod` child process with a local temporary data directory. The
built-in option replaces the original URI; specify the test database name.
From the project directory, run:

```bash
npm run dev -- --config database-check
```

Press Ctrl+C when done. Select a profile with `--config` or `VEXT_CONFIG`;
`NODE_ENV=test` does not select it. To verify a production build, run
`npm run build -- --typecheck --config database-check`, then
`npm start -- --config database-check`. Select the application's own profile
for normal startup.

The custom name `database-check` is intentional. Build excludes
`config/development.*`, `config/local.*`, and `config/test.*`, so a
development `test.ts` profile cannot be assumed to exist in production output.
Confirm the selected config is present before startup.

### Test example

Run database end-to-end tests against the CLI application already started
above with `--config database-check`. `createTestApp()` does not load the
project configuration or initialize built-in MonSQLize automatically. It
returns `{ app, request, close }`, not an object with `app.inject()`.
You may inject a mock for route or Service tests, but those results do not
prove database integration.

This example uses Node's built-in test runner and needs no extra test
dependency. In another terminal, save and run
`node --test test/database.test.mjs`:

```javascript
// test/database.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("creates a user, rejects a duplicate email, and cleans up", async () => {
  const base = "http://127.0.0.1:3000";
  const body = { name: "Alice", email: `reader-${randomUUID()}@example.com` };
  const create = () =>
    fetch(`${base}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const created = await create();
  assert.equal(created.status, 201);
  const { data } = await created.json();
  try {
    assert.equal(data.name, "Alice");
    const duplicate = await create();
    assert.equal(duplicate.status, 409);
    await duplicate.text();
  } finally {
    const removed = await fetch(`${base}/users/${data._id}`, {
      method: "DELETE",
    });
    assert.equal(removed.status, 204);
  }
});
```

This tests real HTTP, framework loading, the Model, and the unique index.
Transactions, replica sets, multiple pools, and Redis caching need their
respective test environments; a single-instance CRUD test cannot prove them.

## Slow query monitoring

MonSQLize has built-in slow query detection. Automatically print a warning log when the query takes more than the `slowQueryMs` threshold:

```typescript
export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },
    slowQueryMs: 200, // Queries exceeding 200ms will generate a warning

    // Optional: persist slow query records to a dedicated collection
    slowQueryLog: {
      enabled: true,
      collection: "_slow_queries",
    },
  },
};
```

Example of log output:

```
[14:23:05.123] WARN [monsqlize] Slow query: users.find({role:"admin"}) 523ms
```

## Model hot reload (development mode)

In `vext dev` mode, changing a Model definition under `src/models/`
triggers a soft reload marked `T1:code`. The framework reloads the changed
definition without a manual server restart.

### Working principle

```
Edit src/models/item.ts
  ↓
esbuild recompiles → .vext/dev/models/item.js
  ↓
model-reloader sees the invalidated file
  ↓
Build and validate the complete replacement plan
  ↓
Atomically replace this application's affected definitions with a rollback journal
  ↓
Newly acquired Models use the new definition
```

### Reload behavior

| Scenario                                    | Behavior                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Change schema or hooks                      | Newly acquired Models use the new definition; existing long-lived instances do not turn into new instances.                                            |
| Change indexes                              | A definition change does not prove a database migration completed. Verify automatic index policy and any explicit `ensureIndexes()` result separately. |
| Replacement plan validation or commit fails | The registration plan rolls back and reports the error. A validation error only triggered by a runtime write is not proof that reload was rejected.    |
| Concurrent requests                         | Operations already holding an old Model may continue using it. Do not promise an atomic switch for all in-flight requests.                             |

Existing data and unique constraints make index changes sensitive. A cold
restart alone does not prove index synchronization. The Quick Start disables
automatic index creation and waits explicitly in a startup plugin; hot
reloading a Model does not rerun that plugin. After an index change, repeat
the index check under the deployment procedure, handle conflicts, and
validate writes.

### Example log output

After saving `src/models/item.ts`, the terminal may show:

```
[vext dev] 1 file(s) changed:
  🟢 src/models/item.ts (modify)
[vext dev] source change detected → soft reload [T1:code]...
[hot-reload] model "items" reloaded
[hot-reload] [OK] 48ms [T1:code] (compile:3ms cache:2ms i18n:0ms mw:5ms svc:8ms model:3ms route:25ms swap:2ms) [12 modules evicted] #3
```

The `model:3ms` segment records Model reload time.

:::tip Rollback guarantee
Discovery, preflight, or registration commit failure rolls back. Not every
field semantic error appears at that stage, so also verify the corresponding
database write. Saving a fix triggers reload again.
:::

:::info Framework internals
`Model.redefine()` and `Model.undefine()` are native MonSQLize Model APIs.
Vext calls them during hot reload; application code need not call them.
:::

## Graceful shutdown

The MonSQLize plugin registers a connection close hook with `app.onClose()`.
When the application receives `SIGTERM` or `SIGINT`:

1. Stop accepting new requests.
2. Wait for in-flight requests.
3. Run `onClose` hooks in LIFO order.
4. Close MonSQLize connections.
5. Exit the process.

Built-in connections, this application's owned Model registrations, and a
temporary MongoDB started by the plugin are cleaned up together. Do not
manually close `app.db`; manage any other connections and manually
registered Models yourself. Shutdown has a timeout and does not wait forever.

<a id="older-code-compatibility"></a>

## Compatibility of older code with the current API

<a id="app-db-db-and-use"></a>

### B1: `app.db.db()` and `use()`

The current raw MonSQLize instance exposes `db(name?)`, so it is incorrect
to claim that `db()` was removed or always throws. `db()` gives database
collection access. For a scope that handles both collections and Models,
this guide uses `use(dbName)`:

```typescript
const logsDb = app.db.use("logs");
const logsCollection = app.db.db("logs").collection("events");
// To select both pool and database:
const regionalLogs = app.db.pool("cn").use("logs");
```

### B2: `app.db.use()` takes one argument

The current signature is `use(dbName)`. Do not pass pool and database
as two arguments. Compose `app.db.pool("cn").use("billing")` explicitly.
When migrating older extensions, check the actual upstream version and
return type used there.

## Next step

- Read [Configuration](/guide/configuration) for base config, environment profiles, and overlays.
- See [Plugins](/guide/plugins) for setup ordering and resource management.
- Read [Testing](/guide/testing) to distinguish mocks, HTTP, and database integration tests.
- Use [Data access specification](/specification/data-access) for Model, pagination, and write boundaries.
- Explore the [built-in app.fetch HTTP client](/guide/fetch) for service calls.

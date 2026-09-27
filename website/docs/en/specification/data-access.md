# Data Access Specifications

This page defines the entry points, models, and data consistency boundaries of VextJS's built-in MonSQLize integration. See the [Database Guide](/guide/database) for connection configuration and complete usage, and the [Cache Guide](/guide/cache) for HTTP response caching.

## Database entry point and ownership

<a id="vext-data-001"></a>

### VEXT-DATA-001 [MUST] Use app.db only after successful database initialization

The built-in database plugin is enabled conditionally by `config.database`. An absent setting, `null`, or an empty object does not initialize a database. A present, nonempty configuration is not necessarily valid: a connection or model-loading failure can still stop startup.

After successful initialization, `app.db` is the same raw MonSQLize instance, retaining upstream instance capabilities. Vext adds narrow compatibility behavior such as a read-only `client` property. Do not rely on the old, separate `app.monsqlize` alias or assume `app.db` is a reduced Repository wrapper.

The built-in database loads before user plugins, so a user plugin's `setup()` can use an `app.db` that has initialized successfully. A project without the database enabled must handle the entry point being absent. On shutdown, the framework releases this application's model registrations and database connection. Do not close the shared instance at the end of each HTTP request. Other database clients created by the application remain its responsibility to close.

This describes the built-in application bootstrap lifecycle. `createTestApp()` does not automatically read project configuration or initialize the built-in database. To verify database integration, actually start the corresponding CLI application or prepare a connection and test double explicitly, and state the verification scope. Registrations made by manually calling upstream `Model.define()` do not automatically enter Vext's loading, hot reload, or ownership plan.

## Collections, Models, and names

<a id="vext-data-002"></a>

### VEXT-DATA-002 [MUST] Distinguish real collection names from model registration keys

`app.db.collection(name)` accesses a Collection by its real collection name; `app.db.model(key)` looks up a registered model. Similar-looking names do not make these entry points interchangeable.

| Model source file                  | Default primary registration key                     | Default inferred connection                 |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `src/models/user.ts`               | First available of `collection`, `name`, then `User` | No directory-derived connection information |
| `src/models/billing/invoice.ts`    | `BillingInvoice`                                     | `database: "billing"`                       |
| `src/models/cn/billing/invoice.ts` | `CnBillingInvoice`                                   | `pool: "cn", database: "billing"`           |

For one or two directory levels, the primary registration key comes from the full relative path. An explicit `collection` / `name` sets the collection name; otherwise the original filename, such as `invoice`, is used. `key` may add an exact alias but does not change the primary key. An explicit `connection` takes complete precedence: directory inference does not fill or overwrite its fields. Definitions more than two directories deep are outside this loading contract.

`database.models.dir` configures the model directory; `autoRegister` also controls automatic registration. The default `validation: "strict"` fails on invalid imports or definitions. Explicit `lenient` mode can skip some invalid files but cannot permit registration-key conflicts. Models are planned as a complete set before registration; do not depend on a failed scan leaving some usable models behind.

See the [Database Guide's Model definition](/guide/database#model-definition) for definition forms, shared model packages, aliases, and types.

<a id="vext-data-003"></a>

### VEXT-DATA-003 [SHOULD] Choose a data access entry point based on required model behavior

When validation, hooks, soft deletion, or other Model behaviors are needed, use the relevant Model API and verify that the options are enabled. Raw Collection operations do not automatically inherit every constraint or lifecycle of a Model. Do not mix the entry points within one business operation and then assume identical behavior.

Vext neither requires a Repository layer nor forbids a route from accessing the database directly. If several entry points share business rules, transactions, and error mapping, organize them in a Service or explicit data access module. See the [Validation specification](/specification/validation-and-contracts#vext-contract-001) for the distinction between input Schemas and persistence constraints.

Check the actual return contract for lists and pagination: `findPage(options)` returns `items/pageInfo/totals`, while `findAndCount(query, options)` returns `data/total`. Do not read a fixed number of rows and then filter, count, or slice them in memory. Page numbers and limits need integer and range constraints; cursors must be valid and use the same filtering and stable order. Querying and counting also do not automatically share one transactional snapshot.

## Multiple databases and transactions

<a id="vext-data-004"></a>

### VEXT-DATA-004 [MUST] Verify connection pools, databases, and model scope explicitly

`use(dbName)` selects a database scope; `pool(poolName)` selects a connection-pool scope. They do not rewrite a short name into Vext's directory-derived primary registration key. Model lookup still needs the correct key. When the exact Model and database/pool must be specified together, use the upstream `scopedModel()` contract.

Explicit Model connection settings, directory inference, and caller scope are separate sources. For work spanning databases or pools, check the actual target. Access through the same `app.db` does not place every operation in one transaction automatically. See the [Database Guide](/guide/database) for pool configuration and scope examples.

<a id="vext-data-005"></a>

### VEXT-DATA-005 [SHOULD] Establish transactions and concurrency constraints at business boundaries

When consistency spans multiple writes, choose a transaction or atomic operation supported by the current MonSQLize version and database deployment. Queries and writes participating in `withTransaction()` must carry its `session`; being inside the same JavaScript callback does not automatically give an ordinary query transaction semantics.

Transaction support and limits depend on the database deployment and driver. Vext documentation must not promise global atomicity across arbitrary connection pools. A transaction retry may execute its callback again. External payments, messages, and other side effects in that callback need separate idempotency or post-commit handling.

Use persistence constraints for uniqueness, concurrent decrements, and state transitions. A read-before-write sequence alone is not concurrency safe. Preserve a diagnosable cause when catching database errors, then let the application map it to suitable business and HTTP errors.

Declaring a unique index is not the same as creating it. In current Model index options, `unique` is a sibling of `key`. Applications relying on uniqueness should confirm the real index and duplicate/concurrent write outcomes. A startup sequence that must wait for indexes can explicitly await `ensureIndexes({ throwOnError: true })`. Hot reloading a definition or restarting a process does not resolve conflicts in existing indexes.

## Caches and consistency

<a id="vext-data-006"></a>

### VEXT-DATA-006 [MUST] Distinguish database query caches from HTTP response caches

| Cache                 | Owning contract                            | What to check                                                                                |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| MonSQLize query cache | `database.cache` plus query/write options  | Query cache enablement, write invalidation, transaction behavior, cross-instance consistency |
| HTTP response cache   | `config.cache`, route `cache`, `app.cache` | Response keys, identity separation, TTL, tag invalidation, shared or broadcast configuration |

A database write does not thereby invalidate every Vext HTTP response cache. After a successful business update, explicitly call `app.cache.invalidate(tag)` for relevant tagged responses or use an application-verified invalidation method. Do not describe database commit and response-cache invalidation as one atomic transaction.

The current MonSQLize query cache is opt-in, and write invalidation needs the corresponding options. A transaction created by the MonSQLize transaction manager, with writes explicitly carrying its session, can record invalidation intent for processing after a successful commit. A session created directly through the raw MongoClient does not automatically gain the same cache coordination. Distributed cache invalidation still has failure and propagation boundaries and cannot guarantee globally strong-consistent reads. For strict freshness, select an appropriate read strategy and verify failure cases.

Check TTL units for each cache API. The Vext response cache and the current database query `cache`, `cache.memory.ttl`, and `cache.redis.ttl` use milliseconds; Session Store `ttlSeconds` uses seconds. Also check defaults forwarded from Vext to upstream rather than inferring runtime values from a field name or type comment alone.

The count cache used by `findPage()` is a different path from the query cache; `cache: 0` does not force a recount. Configuring a cache store does not mean queries use it. With current configuration forwarding, `memory.enabled: false` does not guarantee disabling upstream L1. See the [Database Guide](/guide/database) for specific behavior, verifiable usage, pagination count caches, and cache configuration.

## Verification and troubleshooting

Investigate in this order: database enablement and connection errors → model scan path and registration key → actual pool/database → Model versus Collection choice → session propagation → write result and both types of cache invalidation. Tests should cover successful and failed initialization, invalid Models/key collisions, and rejected writes for enabled features. Verify rollback when using transactions, expiry and invalidation when enabling caches, and cross-instance visibility in multi-instance deployments.

First confirm that the desired configuration profile was explicitly selected and reached the runtime artifact. A readable `config/test.ts` in development mode is excluded from a production build. To verify a build artifact, use a separate distributable profile; do not call a connection made after configuration fallback a passing result for the target environment. Each conclusion covers only capabilities actually enabled and tested.

Vext integration tests and simulated connections do not prove behavior in every production MongoDB topology or every upstream extension. A project should run relevant integration tests against its installed MonSQLize version and deployment. Record the package version range, lockfile-resolved version, and installed version separately.

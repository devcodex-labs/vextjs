# Migrating to vextjs v2

This guide covers application changes when moving from vextjs v1.x to the
2.0.0 line. The current repository is a 2.0.0 package candidate; publishing is
a separate release action.

## Upgrade checklist

1. Replace every `app.monsqlize` access with `app.db` and remove assumptions
   that `app.db` is a reduced facade.
2. Audit every Model lookup for its exact registered key.
3. If the application relied on implicit global rate limiting, add
   `rateLimit: { enabled: true, ... }` to `src/config/default.ts`.
4. Update assertions for path-parameter validation failures from HTTP 422 to
   HTTP 400; body/query/header/cookie validation remains HTTP 422.
5. Run typecheck, build, runtime, OpenAPI, SEO/sitemap, and no-hydration probes
   in a real consumer project before deploying.

For the published release, the framework upgrade command is:

```bash
npm install vextjs@2.0.0
```

When validating this repository before publication, install the one generated
`.tgz` candidate in the consumer instead of using a workspace/source link.

## Breaking changes

### app.db is the only database surface

v2 removes `app.monsqlize`. When `config.database` exists, `app.db` is the
same raw MonSQLize instance created and connected by Vext, with a read-only
`client` getter and narrow soft-delete result compatibility installed on that
same object. It is not a facade or Proxy.

```ts
// v1
await app.monsqlize.withTransaction(async (transaction) => {
  // ...
});

// v2
await app.db.withTransaction(async (transaction) => {
  // ...
});
```

Collections, Models, transactions, pools, `scopedModel()`, sync, events,
diagnostics, and management APIs now share the one `app.db` entry point. Vext
still owns connection cleanup; do not add a second application `onClose` hook
that closes `app.db` again.

### Model lookups use exact registry keys

Database and pool scope no longer imply a registry-key transformation:

```ts
// models/billing/invoice.ts registers BillingInvoice
app.db.use("billing").model("BillingInvoice");

// models/cn/billing/order.ts registers CnBillingOrder
app.db.pool("cn").use("billing").model("CnBillingOrder");
```

`use()` and `pool()` select the database/pool scope only. They do not prepend a
scope name, search a short name, or fall back to a different key. At the root,
an explicit `collection` or `name` becomes the registry key; otherwise Vext
uses the PascalCase filename. At directory depth 1 or 2, Vext uses the
PascalCase path key. A short key works only when the Model explicitly declares
that `key` alias.

### Global rate limiting is opt-in

The default is now disabled. Vext installs no rate-limit middleware, headers,
or HTTP 429 behavior unless configuration explicitly contains:

```ts
export default {
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60,
  },
};
```

`app.setRateLimiter()` still replaces the limiter implementation but does not
enable the global middleware. Once enabled, route-level
`override: { rateLimit: false }` and route-level limit objects keep their v1
semantics. Direct use of the exported `createRateLimitMiddleware()` factory is
also unchanged.

### Path validation failures use HTTP 400

An invalid or missing path parameter now produces HTTP 400, matching malformed
URL input. Body, query, header, and cookie validation failures remain HTTP 422.
The public `VextValidationError` status, runtime error handler, and generated
OpenAPI responses use the same source-specific rule.

## Additive v2 capabilities

- `frontend.seo` configures framework-level metadata, canonical URLs, robots,
  build/runtime sitemaps, provider-generated entries, explicit deployment
  origins, and per-page route/render overrides.
- A rendered route can set `hydration: "none"` to return server HTML without a
  client entry, page payload, or React runtime. This is route-level pure HTML,
  not selective hydration, Islands, or PPR.
- OpenAPI Docs now uses the same Vext mark geometry, favicon, teal/cyan
  light/dark tokens, and green/amber mark accents as the project frontend.
- The Hello World and MongoDB CRUD examples are executable fixtures with
  install, typecheck, build, runtime, and OpenAPI assertions.

### Frontend route build projection

For a three-argument route declaration, the route-options argument and its
`frontend` value must be `inline object literal` values. The build index does
not execute imported variables or helper functions. A dynamic reference that
could previously be omitted from the build manifest now fails with the route
file, method, and path instead of silently applying frontend defaults. Keep
request-dependent SEO in `res.render(..., { seo })`.

## Scaffold compatibility

Only newly created TypeScript projects receive the clearer type layout:

```text
src/types/
├── shared/       # browser/server-safe application contracts (full-stack)
├── frontend/     # browser-facing declarations (full-stack)
└── generated/    # owned by vext typegen
```

TypeScript API-only projects create only `src/types/generated/`; JavaScript
projects create no `src/types/`. The TypeScript templates declare
`@types/node`, so Node globals are available without relying on transitive
dependency hoisting. Existing project directories are not moved, renamed, or
deleted, and `vext typegen` continues to own only `src/types/generated/`.
Runtime configuration for both frontend and backend remains in `src/config/`.

---

## Historical: migrating to vextjs v1

This guide describes the migration required by stable `schema-dsl@3.0.0` and
`monsqlize@3.1.0` when upgrading to `vextjs@1.0.0`.

> The source line later moved to `schema-dsl@3.0.4` and `monsqlize@3.3.0`.
> That backward-compatible dependency update does not alter
> the original v1 migration order below. It adds the optional
> `database.monsqlizeOptions` controlled escape hatch; existing first-class
> `database.*` configuration remains valid.

### v1 upgrade order

The release order is fixed because vextjs consumes both packages directly:

1. `schema-dsl@3.0.0`
2. `monsqlize@3.1.0`, pinned to `schema-dsl@3.0.0`
3. `vextjs@1.0.0`, pinned to both stable versions

Install the GA upstream packages before upgrading the framework:

```bash
npm install schema-dsl@3.0.0 monsqlize@3.1.0 vextjs@1.0.0
```

### String extensions are no longer implicit

Importing vextjs or `schema-dsl` no longer installs
`String.prototype.description`. Replace the legacy global chain:

```ts
const name = "string!".description("User name");
```

with the explicit, side-effect-free builder:

```ts
import { schemaAdapter } from "vextjs";

const name = schemaAdapter.compileField("string!").description("User name");
```

Vext does not expose `isRequired()` or `isOptional()`. Complete object schemas
already expose required fields through standard JSON Schema `required[]`, so a
second field-state API would duplicate the public contract.

### Optional and nullable are different

The `?` suffix means that a property may be absent. It does not allow `null` and
does not produce OpenAPI `nullable: true`:

```ts
const optionalOnly = { nickname: "string?" };
```

Declare null explicitly when it is part of the value domain:

```ts
const nullableDsl = { nickname: "types:string|null" };
const nullableJsonSchema = { nickname: { type: ["string", "null"] } };
```

Vext projects these lossless two-branch unions to OpenAPI 3.0 as the concrete
type plus `nullable: true`. Complex unions that cannot be represented without
losing meaning fail with a clear conversion error.

### Frontend runtime additions

The v1 frontend runtime continues to use the existing Route plus
`res.render()` model. Streaming SSR is opt-in through
`frontend.render.streaming: "auto"`; the default remains `"buffered"`.
Same-route navigation, page envelopes, static/revalidate freshness, and local
`Image` / `defineFont` media output are additive public capabilities.

No migration to file routes, loader/action routes, React Server Components,
Server Functions, Server Actions, PPR, or a Webpack/Vite/Rollup/Rolldown plugin
ecosystem is required. Existing document navigation remains the fallback when a
page-envelope response cannot be used.

### Validation data and errors

Successful `schema-dsl` validation returns `data`, which contains the value
after coercion, defaults, and other configured normalization. Vext continues to
store that value for `req.valid(source)` and validation-success hooks; using the
raw request value would silently discard conversions such as query strings to
numbers.

At the upstream boundary Vext now reads only canonical
`errors[].path` and `errors[].message`. It maps them to Vext's existing public
HTTP shape `{ field, message }`, so application error responses do not change.
Deprecated upstream aliases such as `field`, `type`, and `expected` are not
required by Vext.

### v1 release verification

`npm run release:preflight` is the non-publishing source gate.
`npm run release:preflight:final` requires a stable v1 package identity, exact
stable upstream dependencies, a clean `main` worktree, `changelogs/v1.0.0.md`,
and identity-bound external consumer evidence at
`release/v1-external-validation.json`.

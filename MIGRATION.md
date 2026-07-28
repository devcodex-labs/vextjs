# Migrating to vextjs v1

This guide describes the migration required by stable `schema-dsl@3.0.0` and
`monsqlize@3.1.0` when upgrading to `vextjs@1.0.0`.

## Upgrade order

The release order is fixed because vextjs consumes both packages directly:

1. `schema-dsl@3.0.0`
2. `monsqlize@3.1.0`, pinned to `schema-dsl@3.0.0`
3. `vextjs@1.0.0`, pinned to both stable versions

Install the GA upstream packages before upgrading the framework:

```bash
npm install schema-dsl@3.0.0 monsqlize@3.1.0 vextjs@1.0.0
```

## String extensions are no longer implicit

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

## Optional and nullable are different

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

## Validation data and errors

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

## Release verification

`npm run release:preflight` is the non-publishing source gate.
`npm run release:preflight:final` requires a stable v1 package identity, exact
stable upstream dependencies, a clean `main` worktree, `changelogs/v1.0.0.md`,
and identity-bound external consumer evidence at
`release/v1-external-validation.json`.

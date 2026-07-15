# Preparing for vextjs v1

This guide describes the source-level migration required by the stable
`schema-dsl@3.0.0` and `monsqlize@3.1.0` releases. It is not a vextjs 1.0
release announcement: the source now pins both GA dependencies, while the
package version remains `0.3.26` until the final external-consumer gate has
passed and a later v1 release is explicitly authorized.

## Upgrade order

The release order is fixed because vextjs consumes both packages directly:

1. `schema-dsl@3.0.0`
2. `monsqlize@3.1.0`, pinned to `schema-dsl@3.0.0`
3. `vextjs@1.0.0`, pinned to both stable versions

Do not publish a vextjs intermediate version for this dependency transition;
the next public vextjs release remains the separately validated v1 release.

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

## Final v1 release gate

`npm run release:preflight` is a non-publishing source-validation gate and runs
against the pinned stable upstream releases. `npm run release:preflight:final`
additionally requires a stable v1 package identity, exact stable upstream
dependencies, a clean `main` worktree, synchronized migration/changelog files,
the full test/coverage/docs/package suite, and isolated packed installation.

The final `vextjs@1.0.0` tarball must then pass an identity-bound external
consumer run before the separately authorized publish step. If the tarball,
lockfile, commit, or dependency identity changes, that external result is stale
and must be rerun.

The accepted run is recorded as `release/v1-external-validation.json` using
`release/v1-external-validation.example.json` as its schema. Final preflight
re-packs the source and requires its SHA256 to match the attested artifact.

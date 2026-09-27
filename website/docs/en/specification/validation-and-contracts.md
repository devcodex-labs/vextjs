# Validation and Data Contract Specifications

This page defines the boundaries between input validation, types, JSON response contracts, and business constraints. For route-authoring steps, see [Validation](/guide/validation); for every route option, see the [Route Definition Reference](/api/route-definition).

## Decisions validation cannot replace

<a id="vext-contract-001"></a>

### VEXT-CONTRACT-001 [MUST NOT] Do not treat Schema validation as authorization, business invariants, or database constraints

A Schema and `VextValidator` determine whether data matches a declared structure and format. A passing check does not mean the caller has permission, inventory is sufficient, a state transition is legal, a record is absent, or a database uniqueness constraint has been met.

| Question                                                              | Responsible layer                                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Are input fields, types, lengths, and formats valid?                  | Input Schema and the current validation engine                                |
| Who is the current user, and may they access this endpoint or object? | Auth Provider / Guard and application authorization logic                     |
| May an order be paid, or may its current state change?                | Service or an explicit business-rule function                                 |
| Can concurrent writes preserve uniqueness and consistency?            | Database constraints, atomic operations, or an appropriate transaction design |
| Which JSON data is exposed externally?                                | Handler return value and the `RouteOptions.responses` contract                |

For example, checking that an email is absent before inserting a user can still race under concurrent requests. Input validation and one query do not replace a persistence constraint. Authorization and business validation may be needed at multiple entry points, so do not rely solely on an HTTP route's `validate` option.

`src/validators` is only an optional ordinary module directory; there is no automatic `app.validators` injection. `app.getValidator()` returns the Schema validation engine. It does not discover or execute that directory automatically. See [Architecture and Responsibilities](/specification/architecture).

## When input contracts take effect

<a id="vext-contract-002"></a>

### VEXT-CONTRACT-002 [MUST] Declare runtime validation at supported input locations

A route declares inputs using `validate.param`, `validate.query`, `validate.header`, `validate.cookie`, and `validate.body`; `param` is singular. Only declared input locations are compiled and validated.

Each location's Schema is compiled during route registration. In a request, validation middleware evaluates `param → query → header → cookie → body` and stops at the first failing location without entering the handler. An invalid path parameter returns HTTP 400; the other listed locations return HTTP 422. See [Error Handling](/guide/error-handling) for error response format and content negotiation. A syntactically invalid Schema may fail during registration rather than as an ordinary request parameter error.

If a response cache hits or earlier middleware ends the request, subsequent validation and the handler do not run. The response cache runs after route middleware and the Auth Guard but before validation. Design cache keys and access protection separately using the [Response Cache Guide](/guide/cache).

TypeScript interfaces, type assertions, and OpenAPI descriptions do not create runtime validation on their own. Body parsing is not business validation either; body size, Content-Type, and other parsing failures may occur before Schema validation.

<a id="vext-contract-003"></a>

### VEXT-CONTRACT-003 [SHOULD] Business handlers should use validated data and check conversion semantics

After a declared input location passes validation, read the result through `req.valid(location)`. It returns stored, validated data and may include type conversions; do not assume it equals raw `req.query` or `req.body`. For `header`, the framework also retains only Schema-declared fields and lowercases keys. Declare header fields with lowercase keys.

An undeclared or not-yet-validated location returns `undefined`. A type assertion alone cannot make unvalidated data trustworthy. Route middleware runs before Schema validation, so earlier middleware that needs parameters must handle raw inputs itself rather than assuming `req.valid()` is ready.

Required/optional fields, extra fields, conversion, and defaults are governed by the Schema and engine in use. Do not apply one custom engine's behavior to every interface. Preserve valid `false`, `0`, and empty-string results; a fallback such as `result.data || rawInput` would discard them.

## Static types and reusable Schemas

<a id="vext-contract-004"></a>

### VEXT-CONTRACT-004 [SHOULD] Express types and documentation from the same runtime contract

Import reusable Schemas as ordinary modules into routes or explicit validation code. Current route types can infer the shape of `req.valid()` data from supported DSL strings, nested objects, and field-level JSON Schema. If a dynamic builder cannot be recovered statically, inference produces `unknown`. Type-level inference of a single-element array shorthand does not mean runtime compilation and static projection support it. Routes should currently use explicit `{ type: "array", items: ... }` or supported array DSL and verify types, projection, and behavior together.

An explicit `req.valid<T>()` overrides inference but does not change the runtime Schema; maintainers must keep them consistent. Type declarations impose compile-time constraints only; they do not perform database queries or authorization.

Schemas and types shared with the browser must respect [frontend/backend dependency boundaries](/specification/architecture#vext-arch-007). Do not initialize a database, read server-only configuration, or cause other startup effects at the top level of a shared Schema module.

## Replacing the validation engine

<a id="vext-contract-005"></a>

### VEXT-CONTRACT-005 [MUST] A custom validation engine implements the synchronous compilation and result contract

`app.setValidator()` accepts an object implementing `VextValidator`. Its `compile(schema)` returns a synchronous validation function, which returns `valid`, optional `errors: { field, message }[]`, and `data`. Provide the `data` a handler should read on success and explanatory field errors on failure.

A route acquires the current engine during registration and retains the compiled function. To replace the engine, set it during plugin initialization before route loading. Replacing it after registration does not automatically recompile existing routes. Put asynchronous authorization, database queries, and external requests in their respective business lifecycle instead of disguising them as this synchronous validation result.

A custom engine must also state which Schemas it accepts and check whether OpenAPI and client generation can still understand those declarations. Replacing the input engine does not replace the response serializer or automatically convert arbitrary third-party Schemas into OpenAPI. For an integration example, see [Replacing the Validation Engine](/guide/validation#replace-verification-engine).

Each location in the public `RouteOptions.validate` currently accepts a field map whose fields have type `VextSchemaField`; the parameter type of `VextValidator.compile` is `Record<string, unknown>`. `setValidator()` does not extend those TypeScript types or change the build-time static extractor. An engine's ability to recognize, say, a Zod object in JavaScript does not make passing a third-party Schema directly to a route a supported TypeScript usage. Even when translating the same supported declaration format into a replacement engine, verify required fields, extra fields, conversions, and error semantics.

## Response contracts and API documentation

<a id="vext-contract-006"></a>

### VEXT-CONTRACT-006 [MUST] Declare runtime JSON response Schemas in responses

Endpoints needing a runtime JSON response contract use `RouteOptions.responses`. Selectors support an exact status code, a status family, and `default`. The same selector cannot declare a Schema in both `responses` and `docs.responses`.

Legacy Schema compatibility under `docs.responses` affects documentation only; it does not establish runtime field projection. Text, files, streams, redirects, page rendering, HEAD, and 204 responses are not ordinary JSON serialization paths. See the [Route Definition Reference](/api/route-definition) and [HTTP response rule](/specification/http-and-routing#vext-http-008) for selection order, bypasses, and error semantics.

OpenAPI descriptions and `docs.security` do not enforce access control either; the server still needs real authentication and authorization.

## Verify that the contract holds

Cover valid inputs, missing/invalid inputs, the actual types of validated results, undeclared locations, error status codes, and authorization and business rejections. Also check actual output against the published Schema. Changes to custom engines and shared Schemas require reviewing runtime requests, TypeScript consumers, and OpenAPI/client results together.

Record dependency versions separately as the package's compatibility range, the version actually resolved in a lockfile, and the version installed by the application. Do not describe the framework's dependency range as if every consumer installed the same version; verify each project against its lockfile and installation.

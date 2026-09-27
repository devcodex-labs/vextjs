# HTTP and Routing Specifications

This page explains how route modules are loaded, which declarations the runtime and static tools can both recognize, and the responsibilities of each request-handling layer. For steps, see the [Routing Guide](/guide/routing); for parameters and types, see the [Route Definition API](/api/route-definition).

## Scope

These rules apply to business routes loaded by the router loader from the route directory (by default `src/routes/`) and to static consumers such as Doctor and the route manifest. `MUST` / `MUST NOT` state required routing contracts; `SHOULD` states recommended practice. The range of declarations a static tool can parse differs from the range of expressions JavaScript can execute.

The routing layer declares HTTP methods, paths, input/output contracts, and request-handling entry points. Middleware handles cross-cutting request behavior; services perform business operations. Validation, authentication, authorization, and business-state checks have separate responsibilities and cannot replace each other.

## Route modules

<a id="vext-http-001"></a>

### VEXT-HTTP-001 [MUST] A route module must provide a supported default export

A loaded route module must default-export the `RouteDefinition` returned by `defineRoutes(...)`. Static tools also require that the default export can be resolved through source bindings to a `defineRoutes` call imported from `vextjs`.

Direct default exports, assignments followed by default exports, and fully resolvable default re-exports are supported. With a re-export, the route-directory entry file still owns the URL prefix, while the declaration is parsed in the defining module's context. A missing default export, unresolvable target, or opaque helper used to construct the definition causes a diagnostic. Do not classify all re-exports as unsupported.

<a id="vext-http-002"></a>

### VEXT-HTTP-002 [MUST] A route factory must collect routes synchronously during loading

The factory must be a synchronous, non-generator arrow function or function expression with one ordinary identifier parameter and a `{ ... }` block body. It may be inline or refer to a binding that static tools can resolve to such a function, such as `const register = (app) => { ... }; defineRoutes(register)`.

HTTP registration must be a direct, top-level statement in the factory body: `app.method(path, handler)` or `app.method(path, options, handler)`. Registration inside conditions, loops, or nested helpers is unsupported; bracket access and destructuring or extracting HTTP methods are also unsupported. The factory cannot be `async` or return a Promise, thenable, or any value other than `undefined`; the handler may be `async`.

Calling `defineRoutes()` only creates a definition and checks the factory form. After acquiring the application instance, the loader executes the factory, collects routes, and prepares registration. The registration entry point closes when collection ends. A collection failure clears the routes collected in that attempt instead of retaining partial results.

<a id="vext-http-003"></a>

### VEXT-HTTP-003 [SHOULD] Handlers should use validated and normalized data

After declaring `validate` for a route, a handler should read results through the relevant `req.valid("param" | "query" | "header" | "cookie" | "body")` location to obtain data normalized by conversions. Raw inputs such as `req.query` remain available. The framework does not forbid reading them, and a generic type annotation does not add runtime validation.

Automatic validation runs after route-level middleware and before the handler. Middleware cannot assume route validation has completed before it calls `next()`. An undeclared location cannot be treated as validated. Invalid path parameters return HTTP 400; invalid query, header, cookie, and body inputs return HTTP 422.

<a id="vext-http-004"></a>

### VEXT-HTTP-004 [MUST] Route middleware must use declared names

The `middlewares` route option refers to names declared in the configuration allowlist, as strings or `{ name, options }` objects. It cannot contain functions directly. The loader checks references before registering routes; an undeclared name fails loading.

Custom middleware executes in array order before subsequent steps such as the route `auth` guard and cache. Enabled route timeout, CORS, Session, and multipart wrappers may run before it. An `auth` declaration does not implement credential authentication. Custom authentication middleware must establish `req.auth` before the guard. See the [Middleware Guide](/guide/middleware) for the complete flow.

<a id="vext-http-005"></a>

### VEXT-HTTP-005 [MUST NOT] Business code must not bypass the route-definition lifecycle to register HTTP methods

Declare business routes inside a `defineRoutes()` factory so the loader can collect and validate them and register them with the adapter under the file-owned prefix. Do not keep using the factory's HTTP registration entry point from an asynchronous callback or request handler: it closes after collection. Do not call `RouteDefinition.register()` manually or manipulate the adapter to bypass this flow.

The factory's `app` is a facade backed by the real application's capabilities. Request handling may continue to access `app.services`, `app.config`, and other capabilities. That does not mean routes may still be registered or that application properties have been copied into a static snapshot.

<a id="vext-http-006"></a>

### VEXT-HTTP-006 [SHOULD] Implement input validation separately from authorization and business constraints

`validate` checks the shape and values of declared input locations and stores the results. The business layer must still check whether a resource exists, the current user has permission, and the current state permits a change. Database uniqueness and concurrency constraints belong to the appropriate data operations. A passing schema does not authorize the request or guarantee a database write will succeed.

<a id="vext-http-007"></a>

### VEXT-HTTP-007 [MUST] A route's normalized method and full path must be unique

The full path combines the entry file's prefix with the declared child path. An `index` file omits its filename, and `[id]` segments become `:id`. Differences only in case or trailing slash can still constitute a duplicate for the same HTTP method; the loader rejects it before adapter registration.

The static index also rejects different route entry files that map to the same file prefix, such as `users.ts` alongside `users/index.ts`, even if methods or child paths differ. Merge them into one entry or change the file paths so both runtime registration and the build index pass. File discovery supports `.ts`, `.js`, and `.mjs`; `.cjs` route source is explicitly rejected and must not be used as a supported example.

## Responses, documentation, and overrides

<a id="vext-http-008"></a>

### VEXT-HTTP-008 [SHOULD] Declare runtime JSON response schemas separately from documentation details

For a response serialization contract, declare the business-data Schema in top-level `responses`. Put descriptions, examples, response headers, and other documentation in `docs.responses`. The same normalized status selector cannot declare a Schema in both locations; route registration rejects the conflict. `docs.responses.schema` is a documentation compatibility path, not a substitute for the top-level runtime contract.

Top-level Schemas are compiled at registration. JSON output chooses one by final status in this order: exact status, status family, then `default`. They process the business data passed to `res.json()`; the framework handles the unified response wrapper. Undeclared fields are removed, and missing required values fail before bytes are committed. HEAD, exact 204, raw JSON, text, redirects, files/downloads, streams, and render/SSR bypass this JSON serialization path. Do not extend this contract to every response mode. See [Runtime Response Schema](/api/route-definition#responses--runtime-response-schema).

<a id="vext-http-009"></a>

### VEXT-HTTP-009 [MUST NOT] OpenAPI metadata must not be used as runtime access protection

`docs.security` describes OpenAPI security requirements; it does not authenticate or authorize. `docs.hidden` hides an entry from documentation; it does not prevent request access. To protect a route, establish `req.auth` with authentication middleware and then check access through a route `auth` guard or explicit business permission logic.

OpenAPI security descriptions resolve explicit `docs.security` before route `auth` and then legacy middleware mappings; this documentation priority does not change the runtime guard. Every `operationId`, whether explicit or generated, must be unique in the generated OpenAPI document, and conflicts fail. See [Route Documentation Options](/api/route-definition#docs) for fields and defaults.

<a id="vext-http-010"></a>

### VEXT-HTTP-010 [MUST] Route overrides must respect each setting's enablement conditions and units

`override` applies per setting; it is not a general feature-enablement switch. The built-in rate limiter is registered when global `rateLimit.enabled: true`; only then can `override.rateLimit` adjust that route's settings, while `false` bypasses rate limiting. Its `window` is measured in seconds. A user-defined factory middleware has its own options contract and must not be confused with the built-in limiter.

Top-level route `timeout` takes precedence over the compatibility field `override.timeout`: a positive integer enables a request deadline in milliseconds, while `false` explicitly disables route timeout. `override.maxBodySize` controls request body size; `override.cors` controls route CORS. Session, CSRF, Security Headers, and multipart each have their own options and enablement conditions and cannot be inferred from `override`. See [override](/api/route-definition#override) and the options table on the same page.

## Topic ownership and usage boundaries

This page owns rules for route declarations, loading, input/response contracts, middleware/auth, OpenAPI, and overrides. A handler connects HTTP inputs and outputs; services and other business layers implement operations and invariants. The Routing Guide covers file mapping, obtaining a successful response from an empty route, and business composition. The Route Definition API owns exact parameters and defaults; the Error Handling page owns error diagnosis. A rule level states a contract or recommendation, not that every rule already has an automatic checker.

## Related reading

- [Routing](/guide/routing): file routes, handlers, and a complete example.
- [Middleware](/guide/middleware): onion model, factories, and configuration.
- [Error Handling](/guide/error-handling): diagnosis of HTTP and validation errors.
- [Route Definition](/api/route-definition): `defineRoutes`, Route Options, and types.

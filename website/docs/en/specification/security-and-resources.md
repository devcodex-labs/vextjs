# Security and Resource Specifications

This page defines responsibilities for authentication, authorization, Sessions, CSRF, security response headers, rate limiting, response caches, and upload resources, along with the lifecycle and isolation contracts for long-lived resources. Establish access protection first, then verify state, execution order, and resource budgets. See the [Configuration API](/api/config) for fields and the [Route Definition API](/api/route-definition) for the full route contract.

For a first integration, follow the complete [Authentication and Security Guide](/guide/security). Rule levels here describe constraints an application should observe; they do not mean the framework automatically enforces every requirement.

## Identity and access protection

<a id="vext-sec-001"></a>

### VEXT-SEC-001 [MUST] Connect identity verification to route authorization explicitly

`createAuthMiddleware()` calls the application's `verify()` and writes the authentication result to `req.auth`. It identifies the request; the absence of credentials alone does not make every route protected automatically. Set `auth` on routes or perform application access checks.

`auth: true` requires an authenticated identity. The object form can declare roles, scopes, permissions, and `check`. Defaults are `required: true` and `mode: "any"`. `mode` matches within a category of requirements; it does not mean any one of roles, scopes, permissions, or `check` is enough across categories. Even with `required: false`, anonymous requests must be rejected when nonempty roles/scopes/permissions or `check` are present. Empty arrays do not impose an authorization requirement.

On the ordinary Guard path, a missing or invalid identity returns 401; an authenticated but unauthorized identity returns 403. Exceptions from `verify`, `can`, or `check` take the 500 error path. When only `assert` performs a permission judgment, its exception is treated as denial and returns 403. `auth: false` does not create a Guard, but it cannot undo access protection already performed by global or earlier middleware.

The framework's anonymous context is not a login feature. The application supplies credential verification, user lookup, and permission computation through `verify()`. Do not trust a role or user ID submitted by a client as authorization fact without trusted verification. See the complete [permission-core Authentication Example](/examples/permission-core-auth).

<a id="vext-sec-002"></a>

### VEXT-SEC-002 [MUST NOT] Do not treat documentation, input validation, or CORS as authorization

`docs.security` describes OpenAPI security requirements; it does not identify a user or check permissions. A passing input Schema proves only that data meets the declared contract. CORS controls cross-origin reads in browsers; it is not server-side object authorization.

When accessing a record, verify ownership or resource permissions against a trusted identity. Permissions that need resource context should use real business data; see the [validation/business boundary](/specification/validation-and-contracts#vext-contract-001).

## Sessions, CSRF, and response headers

<a id="vext-sec-003"></a>

### VEXT-SEC-003 [MUST] Configure each protection according to its enablement conditions

| Mechanism        | Enablement and boundary in ordinary framework startup                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Session          | Global `session.enabled: true`, a supported route `session` override, or explicitly registered Session middleware             |
| CSRF             | Global `csrf.enabled: true` or explicitly registered middleware; route `csrf: false` can bypass a registered CSRF check       |
| Security Headers | `securityHeaders.enabled: true` enables global processing; check a manual factory's default behavior against its own API      |
| Rate Limit       | The built-in limiter registers after global `rateLimit.enabled: true`; a route override alone does not enable global limiting |

These mechanisms differ in defaults, route overrides, and manual middleware behavior. One `enabled` field does not determine all of them. Do not register the same Session feature unintentionally a second time when global configuration already registers it.

Session, CSRF, Security Headers, and Rate Limit are all disabled by default in current ordinary startup. Enabling one does not enable the others. Defaults of manual factories or test helpers are not the final configuration of ordinary startup.

Automatic CSRF mode uses an available Session first; otherwise it needs a signed Cookie secret. Without either, configuration fails. CSRF tokens, Origin/Fetch Metadata checks, and authentication address different problems. A route bypass needs a specific purpose and rejection tests.

Built-in global Session and plugin global middleware execute before global CSRF; route Session comes afterward. Enabling only route Session therefore cannot automatically provide a Session backend for the earlier global CSRF check. Route `csrf: true` does not register global protection by itself. Verify actual chain order for tokens, write requests, and bypass rules rather than checking only whether a final handler can read a Session.

`secure: "auto"` in Session/CSRF Cookie settings depends on the framework's recognized request protocol; ordinary `res.cookie()` accepts only a boolean `secure`. Behind a proxy, verify protocol detection and trust configuration. See [Cookies and Sessions](/guide/cookies-session) for Cookie attributes and Session storage. Check security headers on successes, errors, 404s, and cached responses; manually added middleware does not imply every bypass receives identical headers.

<a id="vext-sec-004"></a>

### VEXT-SEC-004 [SHOULD] Check rate-limit keys and cross-process state at the actual execution point

The built-in global limiter runs before plugin global middleware and the route Guard. An identity-based key must already be available when the limiter runs; it cannot assume later authentication middleware has populated identity.

Default in-memory storage belongs to one process. Multiple workers or instances require shared storage and a consistent namespace chosen for the actual deployment. Verify window units, route overrides, custom limiters, and storage error behavior from actual configuration; a per-process allowance is not a cluster-wide allowance.

`keyBy: "user"` uses `req.user.id` at that point and falls back to IP when absent; it does not automatically use `req.auth.subject`. An exception in the current built-in algorithm/Store check may log an error and allow the request through. Do not promise denial on every storage failure. A custom limiter throwing, returning a rejection, and a Redis initialization without a target are different paths; see [Rate Limiting](/guide/rate-limit#storage-failures-and-allow-policy).

<a id="vext-sec-005"></a>

### VEXT-SEC-005 [SHOULD] Partition response caches by access identity and data differences

The route Auth Guard runs before response caching, but authorization does not make one response safe to share between users. For user-specific data, disable caching or choose a key that sufficiently distinguishes user, tenant, permissions, and necessary request dimensions, and verify that entries cannot cross identities.

Do not decide whether a response containing Session data or a CSRF token is shareable from its URL alone. Current `allowCookieCache: false` does not guarantee bypassing an existing cache. Avoiding a storage write also does not guarantee that requests avoid concurrent coalescing. `private`, `no-store`, and `Set-Cookie` cannot be the sole safeguards against cross-request sharing. For Session writes, private data, or requests that must execute every time, use `cache: false` or an explicit `condition` before entering the cache; see [concurrent response-cache boundaries](/guide/cache#concurrent-origin-fetches).

A server-side `partitionKey` does not control browser, proxy, or CDN caches. For queries that really must be partitioned by trusted identity, also inspect HTTP cache headers and deployment policy. Do not treat default `public` response headers as suitable for personalized content.

## Resource creation and release

<a id="vext-resource-001"></a>

### VEXT-RESOURCE-001 [SHOULD] Assign a creator and cleanup responsibility to each long-lived resource

Connections, subscriptions, timers, and file handles created by a plugin need matching failure cleanup and close paths. Plugins can use `onClose` or `app.onClose()`; close callbacks execute in reverse registration order. Shutdown has a deadline, so arbitrary hanging tasks cannot be promised completion.

The second argument of `setup(app, context)` supplies `context.signal`. Pass cancellation to I/O that supports it and clean up already created resources on failure. A plugin object's `onClose` is registered only after successful setup; it cannot clean up connections left behind when setup fails halfway through. The framework may roll back controlled extensions or stop waiting, but cannot cancel every external side effect created by the application. See [Plugin Lifecycle](/guide/plugins).

When features share a resource, identify who may close the underlying client. The runtime manages a rate-limit Redis client it creates, while the caller remains responsible for an externally supplied client. Session Store cleanup follows the Store contract; `createCacheSessionStore()` closes its underlying resource only when a close callback was explicitly supplied. Passing a client to an integration does not give every integration the same ownership semantics.

<a id="vext-resource-002"></a>

### VEXT-RESOURCE-002 [MUST] Extension names and storage namespaces follow their owning contracts

`app.extend()` cannot overwrite existing application properties or reserved names. A custom cache client cannot occupy built-in `app.cache`. Database, Session, rate-limit, and HTTP response caches also cannot share unisolated key spaces just because they use the same Redis server.

To share a particular state across instances, align that module's namespace/prefix explicitly. Distinguish different applications, environments, or uses when isolation is needed. Matching names do not make data structures compatible, and different names do not automatically synchronize instances.

Choose isolation according to each module: the Session adapter's default prefix does not include the environment automatically; rate limiting can derive a prefix from project/profile/runtime mode; the response-cache namespace is fixed at `vext-route-cache` and has no public `config.cache.namespace`. Do not invent one universal namespace setting to isolate every module in shared Redis. Cross-instance response-cache invalidation also requires checking distributed connections and broadcast scope; see [Cache Configuration and Invalidation](/guide/cache#lease-and-distributed).

<a id="vext-resource-003"></a>

### VEXT-RESOURCE-003 [SHOULD] Set resource budgets and parsing placement before accepting uploads

Built-in multipart parsing reads the entire form into memory before producing file buffers. It does not stream files to disk or external storage. Total request body size, file count, and per-file size serve different purposes; configure and test all relevant limits rather than checking only file size in a handler.

The global body parser runs before global rate limiting, route authentication, and the Guard. Route upload parsing also runs before user route middleware and the Guard. If a large body must be rejected before it is received, implement the appropriate policy at an earlier entry point. When global parsing has already happened, route upload middleware reuses the result and applies route limits; it cannot undo the earlier read.

MIME comes from the client declaration; `allowedMimeTypes` does not prove file contents are trustworthy. Business code chooses the name, path, and storage system for persistence. Large or streaming uploads need explicitly chosen custom parsing and failure/close cleanup. See [File Uploads](/guide/uploads) for operation and 413/415 rechecks.

## Verification checklist

Cover anonymous requests, invalid credentials, authenticated users without permission, authorized requests, and Provider exceptions. Then verify actual Session/CSRF enablement and bypass, security headers on error paths, cross-identity caching, Cookie requests after anonymous cache population, concurrent requests for non-storable responses, rate-limit quotas, and storage failure. Upload checks include size/count/MIME rejection and parsing placement; resource checks include mid-initialization failure, normal and repeated close, and ownership of shared clients.

These checks apply to the application's real configuration. Specification rules do not automatically install an Auth Provider, configure production storage, or implement object-level authorization for a project.

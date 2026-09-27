# Authentication and Security

This page first builds a runnable Bearer identity and role-protected route, then explains how Sessions, CSRF, security headers, and caches interact. See [Security and Resource Specifications](/specification/security-and-resources) for responsibility boundaries and [Route Definition](/api/route-definition) for complete options.

## Understand the two steps

1. **Identify the caller:** `createAuthMiddleware({ verify })` reads credentials. The application's `verify()` validates them and returns user information, which the framework stores in `req.auth`.
2. **Protect the route:** Route `auth` checks authentication, roles, scopes, permissions, or a custom `check` before entering the handler.

An identity middleware without an access rule may still allow anonymous calls. `docs.security` describes OpenAPI only; it does not verify a token or reject a request for you.

## Minimal runnable example

Prerequisite: prepare a TypeScript project using [Quick Start](/guide/quick-start), with npm scripts `dev: vext dev`, `build: vext build`, and `start: vext start`. Add these three files; merge fields into an existing configuration if needed.

`demo-member` and `demo-admin` are fixed demonstration credentials for checking the request path. For a real identity system, replace `verify()` with trusted server-side signature/expiry validation or credential lookup, then return the user and permissions.

### 1. Declare middleware

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  middlewares: ["demo-auth"],
  securityHeaders: { enabled: true, preset: "basic" },
} satisfies VextUserConfig;
```

### 2. Identify Bearer credentials

```typescript
// src/middlewares/demo-auth.ts
import { createAuthMiddleware, defineMiddleware } from "vextjs";

export default defineMiddleware(
  createAuthMiddleware({
    source: "bearer",
    provider: "demo",
    verify(credential) {
      if (credential === "demo-provider-error") {
        throw new Error("Demo identity provider unavailable");
      }
      if (credential === "demo-admin") {
        return {
          subject: "admin-1",
          roles: ["admin"],
          scopes: ["account:read"],
        };
      }
      if (credential === "demo-member") {
        return {
          subject: "member-1",
          roles: ["member"],
          scopes: ["account:read"],
        };
      }
      return null;
    },
  }),
);
```

Without Bearer credentials, the request remains anonymous. Credentials rejected by `verify()` become an invalid identity and are then rejected by the Guard. An exception in `verify()` takes the `AUTH_PROVIDER_ERROR` / HTTP 500 path; do not classify an identity-provider outage as an ordinary permission denial. `demo-provider-error` specifically exercises this failure path.

The framework does not check JWT signatures, expiry, or role authenticity for you. Any object returned from `verify()` (including `{}`) creates an authenticated context. Return `null` or `false` on failed verification, and provide a trusted identity and permissions when appropriate. Do not pass client-supplied roles/claims straight through as verified facts.

### 3. Define protected routes

```typescript
// src/routes/account.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", { middlewares: ["demo-auth"], auth: true }, async (req, res) => {
    res.json({ subject: req.auth.subject, roles: req.auth.roles });
  });

  app.get(
    "/admin",
    { middlewares: ["demo-auth"], auth: { roles: ["admin"] } },
    async (req, res) => {
      res.json({ subject: req.auth.subject, area: "admin" });
    },
  );

  app.get(
    "/public",
    { middlewares: ["demo-auth"], auth: false },
    async (req, res) => {
      res.json({ authenticated: req.auth.isAuthenticated });
    },
  );
});
```

The filename supplies the `/account` prefix. `config.middlewares` declares a name; route `middlewares` selects that middleware for execution. Declaring the name alone does not identify callers on every request. `/public` has `auth: false` and therefore creates no Guard: anonymous and invalid-credential requests can both return 200. An exception from the earlier `verify()` still returns 500. Whether a public production endpoint accepts invalid credentials is a product policy decision.

### 4. Verify requests

Run `npm run dev`. These calls use the example's `http://127.0.0.1:3000`. In Windows PowerShell, use `curl.exe` to avoid the older PowerShell `curl` alias:

```bash
curl -i http://127.0.0.1:3000/account
curl -i -H "Authorization: Bearer invalid" http://127.0.0.1:3000/account
curl -i -H "Authorization: Bearer demo-member" http://127.0.0.1:3000/account
curl -i -H "Authorization: Bearer demo-member" http://127.0.0.1:3000/account/admin
curl -i -H "Authorization: Bearer demo-admin" http://127.0.0.1:3000/account/admin
curl -i http://127.0.0.1:3000/account/public
curl -i -H "Authorization: Bearer invalid" http://127.0.0.1:3000/account/public
curl -i -H "Authorization: Bearer demo-provider-error" http://127.0.0.1:3000/account
curl -i http://127.0.0.1:3000/missing
```

| Request                               | Expected result                                              |
| ------------------------------------- | ------------------------------------------------------------ |
| `/account`, no credential             | 401, `AUTH_REQUIRED`                                         |
| `/account`, invalid credential        | 401, `AUTH_INVALID`                                          |
| `/account`, member                    | 200, default response wrapper's `data.subject` is `member-1` |
| `/account/admin`, member              | 403, `AUTH_FORBIDDEN`                                        |
| `/account/admin`, admin               | 200, `data.area` is `admin`                                  |
| `/account/public`, anonymous          | 200, `data.authenticated` is `false`                         |
| `/account/public`, invalid credential | 200, `data.authenticated` is `false`                         |
| `/account`, provider error            | 500, `AUTH_PROVIDER_ERROR`                                   |
| `/missing`                            | 404, still has the configured basic security headers         |

Configuration may change the response wrapper. The table assumes the framework default, with error identifiers in the JSON `code` field. The example enables basic security headers; check `X-Content-Type-Options: nosniff` on success, error, and 404 responses. Stop the development service, run `npm run build -- --typecheck` and `npm start`, then repeat the requests.

## Choose a credential source

`createAuthMiddleware()` defaults to `bearer`. All sources below only extract credentials; application code still validates them through `verify(credential, req)`:

| `source`  | Extraction and prerequisites                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bearer`  | Reads Authorization by default and requires Bearer format; `header` selects another header                                                            |
| `apiKey`  | Reads x-api-key by default; `header` changes its name. If `cookie` is configured, that Cookie is used only when the header is empty                   |
| `session` | Session middleware must run first. Reads `sessionKey` (default `userId`), accepts nonempty strings or finite numbers, and converts numbers to strings |
| `custom`  | Extracts nothing automatically and calls `verify` with `undefined` on each request, leaving extraction and verification to the application            |

For non-custom sources, missing credentials leave the caller anonymous without invoking `verify`. Malformed or supplied-but-rejected credentials become invalid. `optional: true` only affects anonymous handling for a custom source when there are no automatic credentials and `verify` returns no identity. It does not replace route access rules.

## Connect real permissions

| Need                                           | Integration point                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Validate JWTs, API Keys, or other credentials  | `verify()`, returning trusted `subject/userId/roles/scopes/claims`     |
| Match roles and scopes                         | Route `auth.roles` / `auth.scopes`                                     |
| Check actions against resources                | Return `can` / `assert` and use `auth.permissions`                     |
| Check object permissions against business data | `auth.check(req, auth)` or explicit authorization in a handler/service |
| Use an identity in Session                     | Enable Session; use `source: "session"` and the right `sessionKey`     |

`mode: "any"` (default) or `"all"` matches requirements within one category; multiple nonempty categories must each pass. `required: false` allows anonymous bypass only when there are no additional authorization rules. Nonempty roles/scopes/permissions or a `check` still require identity. This setting retains a Guard, so credentials already marked invalid receive 401 first. `auth: false` skips the Guard entirely.

If both `can` and `assert` exist, `can` takes precedence. `can` returning false gives 403; throwing gives 500. A normal `assert` return permits access, while any throw counts as denial and gives 403. Use the distinction between boolean return and exception in `can` when an identity-service failure must differ from business denial. Do not assume all `assert` exceptions propagate as 500. `check` returning false gives 403 and throwing gives 500. Nonempty `permissions` without `can` or `assert` gives 500, `AUTH_CONFIG_ERROR`.

The Guard runs before route Schema validation, so `check` cannot assume `req.valid()` is ready. If a permission decision needs complex validated input, do it at the start of the handler or in a business service, before the protected operation. See the [permission-core Authentication Example](/examples/permission-core-auth) for an external permission bridge and dependency compatibility conditions.

For a route requiring identity, the Auth contract projects `bearerAuth` into OpenAPI by default unless `auth.security` is explicitly selected. Switching the middleware source to API Key or Session does not rewrite this description automatically. Check `auth.security`, higher-priority `docs.security`, and the actual security scheme. These fields still affect documentation only, not runtime verification or authorization. See [Route Auth Reference](/api/route-definition#auth).

## Combine other security mechanisms

- **Session:** Provides session state, not automatic logged-in identity. Construct auth from a trusted session explicitly. Avoid duplicate registration through global configuration plus manual middleware; use a suitable Store for distributed deployment.
- **CSRF:** Enable it for the application's credential transport and interactions. Auto mode chooses an attached Session first; otherwise it needs `config.csrf.secret` for a signed Cookie. Route `csrf: false` only bypasses an already registered check. See [Cookies and Sessions](/guide/cookies-session) for token acquisition and submission.
- **Security response headers:** Configure `securityHeaders` and ensure CSP, HSTS, and other settings fit real frontend resources, protocol, and proxy. Verify successes, errors, and 404s.
- **CORS:** Check cross-origin behavior in browsers. The Guard and business rules still own server-side authorization.
- **Response cache:** Authorization does not make a response shareable across users. Use suitable isolation keys or disable caching for user or tenant data; see [Response Cache](/guide/cache).
- **Rate limiting:** Framework global rate limiting precedes plugin authentication and defaults to IP. `keyBy: "user"` reads `req.user.id`, not `req.auth.subject`, and falls back to IP when unavailable. Check actual execution order when choosing a rate-limit dimension.

### When security headers actually apply

Automatic registration needs `securityHeaders.enabled: true`. The basic preset adds nosniff, Referrer-Policy, and X-Frame-Options. The strict preset adds some permission and cross-origin policies but does not generate CSP automatically. Configure `contentSecurityPolicy` for application assets. HSTS is emitted by default only when `req.protocol === "https"`; setting `hsts.force` explicitly overrides that condition. Behind a reverse proxy, first check `trustProxy` and actual protocol detection.

Route `securityHeaders: false` or configured `skipPaths` may skip these headers. Global configuration also applies headers to error/404 handling. If you only register an ordinary middleware manually, do not infer that responses bypassing it are covered. See the [Configuration Reference](/api/config) for fields.

## Common problems

| Symptom                                  | Check and response                                                                                                         | Recheck                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Token supplied but still 401             | Is middleware declared and referenced by the route? Are Bearer format and `verify` result correct?                         | Use the member request above and inspect its `req.auth` result          |
| Ordinary user can access admin route     | Was only `docs.security` set? Does Route actually have roles/permissions/check?                                            | Member must get 403; admin must get 200                                 |
| Provider exception returns 500           | Keep diagnostic logs inside verify/provider; framework maps to `AUTH_PROVIDER_ERROR` without exposing the original message | Restore the dependency and retry; do not turn 500 into false success    |
| Authorization cannot read validated data | Guard runs before Schema validation                                                                                        | After moving the check, test both invalid input and unauthorized access |
| Sessions differ across instances         | Are instances still using in-process Stores? Do prefixes match?                                                            | Call across instances and check one Session's result                    |

Maintenance checks should cover anonymous, invalid credential, unauthorized, authorized, and identity-provider failure paths; an admin success request alone is insufficient.

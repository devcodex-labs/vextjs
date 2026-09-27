# permission-core Auth integration

This page explains how to bridge
[permission-core](https://github.com/devcodex-labs/permission-core) to VextJS
Auth and its prerequisites. The external-package snippets are **integration
references after compatibility is confirmed**, not a verified installation
tutorial for the current framework. For a runnable auth flow, use the
complete example in [Authentication and security](/guide/security).

Vext separates authentication from route authorization:

- `auth()` parses a Bearer token and fills `req.auth`.
- `permission-core` decides authorization for resources such as
  `invoke + api:GET:/api/posts`.
- Each route keeps its final `RouteOptions.auth` inline or in a same-file
  `const`, so build indexing, runtime guards, and OpenAPI read one contract.

## 1. Confirm dependency compatibility first

The npm release `permission-core@3.0.4`, checked on 2026-09-25, declares
`vextjs: 0.3.26` and `monsqlize: 3.1.0` as peers; this repository uses
Vext 2.0.0 and MonSQLize 3.3.0. The upstream main branch's version
declarations are not the npm release's declarations. These numbers record a
compatibility check; they do not instruct users to pin an old Vext install.

In the application directory, check the versions actually resolved:

```bash
npm view permission-core version peerDependencies peerDependenciesMeta --json
npm ls vextjs monsqlize permission-core
```

Only when a published upstream package declares compatible dependencies and
the application's integration tests pass should you use the ordinary install
command:

```bash
npm install permission-core
```

Do not force an install to hide a peer conflict. This page does not claim
that the conflict is resolved or that current Vext and the older
permission-core database combination has been fully verified. The security
guide provides immediately runnable identity and role protection. An external
authorization system can connect through the `can` returned by
`auth().verify`.

The current upstream API accepts a host-connected MonSQLize instance and
uses MongoDB with transaction support. It does not use the old
`MemoryAdapter` integration. See [Database](/guide/database) for database
preparation and the
[published package information](https://www.npmjs.com/package/permission-core)
for upstream lifecycle and API details.

## 2. Initialize and prepare authorization data

**Use these snippets only after compatibility is confirmed.** Enable the
database first and ensure `app.db` is available, then initialize the
authorization core. Vext owns the database connection; closing the
authorization core must not also close the host connection.

```typescript
// src/plugins/permission.ts
import { defineAppExtensions, definePlugin, type VextDatabase } from "vextjs";
import { PermissionCore } from "permission-core";

export const appExtensions = defineAppExtensions<{
  permission: PermissionCore;
}>();

export default definePlugin({
  name: "permission",
  async setup(app) {
    const db = app.db as VextDatabase | undefined;
    if (!db) throw new Error("Database is not configured");
    const core = new PermissionCore({ monsqlize: db });
    await core.init();
    app.onClose(() => core.close());
    app.extend("permission", core);
  },
});
```

Create authorization data in an administrative workflow, not on every app
startup. The following is one-time preparation using an **already initialized
`core`**. The administrative identity and tenant come from a trusted server:

```typescript
const scope = { tenantId: "demo" };
const scoped = core.scope(scope, {
  actorId: "demo-setup",
  requestId: "demo-permission-setup",
});
await scoped.roles.create({ id: "viewer", label: "Read-only user" });
await scoped.roles.allow("viewer", {
  action: "invoke",
  resource: "api:GET:/api/posts",
});
await scoped.userRoles.assign("u-viewer", "viewer");
```

Handle administrative write results and failures according to the upstream
API. Viewer only receives GET permission; POST/DELETE are not granted.
Admin and editor roles also require creation and grants through an
administrative workflow. Listing a role in a token does not grant it
automatically. Keep resource strings identical across authorization data,
routes, and dynamic checks.

## 3. Bridge `auth()` to permission-core

```typescript
// src/middlewares/permission-core-auth.ts
import { auth, defineMiddleware } from "vextjs";
import type { VextRequest } from "vextjs";
import type { PermissionCore } from "permission-core";

const tokenUsers: Record<string, { userId: string; roles: string[] }> = {
  "pc-admin-token": { userId: "u-admin", roles: ["admin"] },
  "pc-editor-token": { userId: "u-editor", roles: ["editor"] },
  "pc-viewer-token": { userId: "u-viewer", roles: ["viewer"] },
};

function getPermissionCore(req: VextRequest) {
  const core = (req.app as typeof req.app & { permission?: PermissionCore })
    .permission;
  if (!core) {
    throw new Error("permission-core plugin is not available");
  }
  return core;
}

export default defineMiddleware(
  auth({
    provider: "permission-core",
    verify(token, req) {
      const user =
        token && Object.hasOwn(tokenUsers, token)
          ? tokenUsers[token]
          : undefined;
      if (!user) return false;

      const core = getPermissionCore(req);

      return {
        subject: `user:${user.userId}`,
        userId: user.userId,
        roles: user.roles,
        scopes: ["permission:invoke"],
        provider: "permission-core",
        can(action, resource) {
          if (!resource) return false;
          return core
            .forSubject({ userId: user.userId, scope: { tenantId: "demo" } })
            .can(action, resource);
        },
        async assert(action, resource) {
          if (!resource) {
            throw new Error("permission-core resource is required");
          }
          const allowed = await core
            .forSubject({ userId: user.userId, scope: { tenantId: "demo" } })
            .can(action, resource);
          if (!allowed) req.app.throw(403, "Forbidden", "AUTH_FORBIDDEN");
        },
      };
    },
  }),
);
```

Fixed tokens only demonstrate identity mapping and are not JWT. A production
application must verify real credentials and obtain the tenant from trusted
identity. Providing `can` preserves the distinction between denial and a
provider failure.

Register the middleware name and enable OpenAPI in `src/config/default.ts`.
Merge this into the existing database config:

```typescript
export default {
  middlewares: [{ name: "permission-core-auth" }],
  openapi: {
    enabled: true,
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "demo-token",
      },
    },
  },
};
```

## 4. Declare statically projectable route guards

The route index does not execute imported or local helper functions. Keep each final guard shape in the route file as a same-file `const`; this makes the complete middleware, permission, security, and docs contract visible before runtime:

```typescript
// src/routes/api/posts.ts
import { defineRoutes } from "vextjs";
import type { RouteOptions } from "vextjs";

const listPostsOptions = {
  middlewares: ["permission-core-auth"],
  auth: {
    permissions: [{ action: "invoke", resource: "api:GET:/api/posts" }],
    security: "bearerAuth",
  },
  docs: { summary: "List posts", tags: ["Posts"] },
} satisfies RouteOptions;

const createPostOptions = {
  middlewares: ["permission-core-auth"],
  auth: {
    permissions: [{ action: "invoke", resource: "api:POST:/api/posts" }],
    security: "bearerAuth",
  },
  docs: { summary: "Create post", tags: ["Posts"] },
} satisfies RouteOptions;
```

Keep related route constants together in their route module. Shared runtime behavior remains centralized in the `permission-core-auth` middleware and permission provider; the route contract itself stays statically visible.

## 5. Protect routes with the final option constants

```typescript
export default defineRoutes((app) => {
  app.get("/", listPostsOptions, async (req, res) => {
    res.json({ ok: true, userId: req.auth.userId });
  });

  app.post("/", createPostOptions, async (req, res) => {
    res.json({ ok: true, userId: req.auth.userId }, 201);
  });
});
```

Combine the two route snippets in one file. Its directory supplies the
`/api/posts` prefix. These handlers return authorization success only; they
do not implement post CRUD. The middleware listed in config runs only when
a route references it.

`RouteOptions.auth` remains the guard contract. Route-options helper calls are rejected by the finite static grammar; use an inline final object or a same-file final `const`. The older `openapi.guardSecurityMap` fallback still exists only for legacy middleware-only routes.

## 6. Call `assert()` directly in a handler

Only use an explicit handler check when an object-level dynamic decision is
needed. Put this route in the same `defineRoutes` callback above. The
application also needs permission data for `api:GET:/api/posts/<id>`:

```typescript
app.get(
  "/:id/access",
  {
    middlewares: ["permission-core-auth"],
    auth: { required: true, security: "bearerAuth" },
    validate: { param: { id: "string!" } },
    docs: { summary: "Check post access", tags: ["Posts"] },
  },
  async (req, res) => {
    const assertPermission = req.auth.assert;
    if (!assertPermission) {
      app.throw(
        500,
        "Permission provider is not configured",
        "AUTH_CONFIG_ERROR",
      );
      return;
    }
    const { id } = req.valid("param");
    await assertPermission("invoke", `api:GET:/api/posts/${id}`);
    res.json({ id, allowed: true });
  },
);
```

This example's `assert` explicitly throws 403 when `can` returns false.
Provider failures continue to propagate; catching all failures and rewriting
them as denial would hide outages. A direct handler call to `assert` does
**not** pass through the Auth guard's exception conversion. If the Guard has
only an upstream `assert` and no `can`, it treats every exception as
denial; keep `can` when failures need to remain distinct.

## 7. Verify

First verify the complete application in the security guide. Then, after
dependency compatibility is confirmed and the database and authorization data
are prepared, run `npm run build -- --typecheck` and `npm start` in the
integration project. For the default port 3000:

```bash
curl -i http://127.0.0.1:3000/api/posts
curl -i -H "Authorization: Bearer unknown" http://127.0.0.1:3000/api/posts
curl -i -H "Authorization: Bearer pc-viewer-token" http://127.0.0.1:3000/api/posts
curl -i -X POST -H "Authorization: Bearer pc-viewer-token" http://127.0.0.1:3000/api/posts
```

| Case                                     | Expected result and owner                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| No credential                            | Guard returns 401 and `AUTH_REQUIRED`.                                                                              |
| Malformed Bearer or unknown credential   | Guard returns 401 and `AUTH_INVALID`.                                                                               |
| Viewer granted GET                       | 200; default-wrapped `data.userId` is `u-viewer`.                                                                   |
| Viewer not granted POST                  | 403 and `AUTH_FORBIDDEN`.                                                                                           |
| `can` throws due to a dependency failure | Guard returns 500 and `AUTH_PROVIDER_ERROR`.                                                                        |
| Dynamic object denial                    | This example's `assert` explicitly throws 403; business work belongs after authorization.                           |
| OpenAPI                                  | GET/POST paths are `/api/posts` in `/openapi.json` and reference `bearerAuth`.                                      |
| Lifecycle                                | Failed initialization aborts startup; normal close releases the authorization core, while Vext closes the database. |

Also verify that the request context identity snapshot excludes token,
`can`, and `assert` functions, along with cross-tenant denial, role changes,
and revocation. These are application and upstream integration checks; passing
Vext Auth tests alone does not prove them.

## Related documentation

- [Authentication and security](/guide/security): runnable Vext identity and role protection.
- [Route definition](/api/route-definition): auth, static declarations, and OpenAPI contract.
- [Plugins](/guide/plugins) and [Database](/guide/database): initialization, type extension, and resource ownership.
- [Security and resources specification](/specification/security-and-resources): responsibilities for authentication, authorization, and business operations.

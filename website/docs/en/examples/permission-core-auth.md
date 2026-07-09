# permission-core Auth

This example shows how to connect [permission-core](https://vextjs.github.io/permission-core/) to VextJS Auth. Vext keeps authentication and route guards separate:

- `auth()` parses the Bearer token and fills `req.auth`.
- `permission-core` owns authorization decisions such as `invoke + GET:/api/posts`.
- A small route helper maps business permissions to `RouteOptions.auth` so each route does not repeat the auth middleware and resource strings.

The verified consumer project is `vext-test`: `src/plugins/permission.ts`, `src/middlewares/permission-core-auth.ts`, `src/routes/auth-context.ts`, and `verify.mjs` cases `#246-#250`.

## 1. Install

```bash
npm install permission-core
```

For a demo or test project, `MemoryAdapter` is enough. For production, follow permission-core's production guide and use a persistent storage adapter with the `cache-hub + monsqlize` stack recommended by permission-core.

## 2. Create the permission plugin

```typescript
// src/plugins/permission.ts
import { defineAppExtensions, definePlugin } from "vextjs";
import { MemoryAdapter, PermissionCore } from "permission-core";

export const appExtensions = defineAppExtensions<{
  permission: PermissionCore;
}>();

export default definePlugin({
  name: "permission",

  async setup(app) {
    const core = new PermissionCore({ storage: new MemoryAdapter() });
    await core.init();

    await core.roles.create("admin", { label: "Admin" });
    await core.roles.create("editor", { label: "Editor" });
    await core.roles.create("viewer", { label: "Viewer" });

    await core.roles.allow("admin", "invoke", "GET:/api/posts");
    await core.roles.allow("admin", "invoke", "POST:/api/posts");
    await core.roles.allow("admin", "invoke", "DELETE:/api/posts");
    await core.roles.allow("editor", "invoke", "GET:/api/posts");
    await core.roles.allow("editor", "invoke", "POST:/api/posts");
    await core.roles.deny("editor", "invoke", "DELETE:/api/posts");
    await core.roles.allow("viewer", "invoke", "GET:/api/posts");

    await core.users.setUserRoles("u-admin", ["admin"]);
    await core.users.setUserRoles("u-editor", ["editor"]);
    await core.users.setUserRoles("u-viewer", ["viewer"]);

    app.extend("permission", core);
  },

  async onClose(app) {
    await app.permission.close();
  },
});
```

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
      const user = token ? tokenUsers[token] : undefined;
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
          return core.can(user.userId, action, resource);
        },
        async assert(action, resource) {
          if (!resource) {
            throw new Error("permission-core resource is required");
          }
          await core.assert(user.userId, action, resource);
        },
      };
    },
  }),
);
```

Register the middleware name in `src/config/default.ts`:

```typescript
export default {
  middlewares: [{ name: "permission-core-auth" }],
  openapi: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
};
```

## 4. Centralize route guard helpers

Do not repeat `middlewares: ["permission-core-auth"]` and raw resource strings in every route. Keep the bridge middleware registered once, then put the route guard shape in a small policy helper:

```typescript
// src/auth/permission-policies.ts
import type { RouteDocsConfig, RouteOptions } from "vextjs";

const postPermissionResources = {
  read: "GET:/api/posts",
  create: "POST:/api/posts",
  delete: "DELETE:/api/posts",
} as const;

type PostPermission = keyof typeof postPermissionResources;

export function permissionCoreAuth(docs: RouteDocsConfig): RouteOptions {
  return {
    middlewares: ["permission-core-auth"],
    auth: { required: true, security: "bearerAuth" },
    docs,
  };
}

export function requirePostPermission(
  permission: PostPermission,
  docs: RouteDocsConfig,
): RouteOptions {
  return {
    middlewares: ["permission-core-auth"],
    auth: {
      permissions: [
        {
          action: "invoke",
          resource: postPermissionResources[permission],
          context: (req) => ({ route: req.route }),
        },
      ],
      security: "bearerAuth",
    },
    docs,
  };
}
```

This keeps the policy vocabulary in one place. If your project has multiple resource families, create helpers such as `requireUserPermission()` and `requireBillingPermission()` instead of copying raw permission tuples across handlers.

## 5. Protect routes with the policy helper

```typescript
// src/routes/posts.ts
import { defineRoutes } from "vextjs";
import { requirePostPermission } from "../auth/permission-policies";

export default defineRoutes((app) => {
  app.get(
    "/posts",
    requirePostPermission("read", {
      summary: "List posts",
      tags: ["Posts"],
    }),
    async (req, res) => {
      res.json({ ok: true, userId: req.auth.userId });
    },
  );

  app.post(
    "/posts",
    requirePostPermission("create", {
      summary: "Create post",
      tags: ["Posts"],
    }),
    async (req, res) => {
      res.json({ ok: true, userId: req.auth.userId }, 201);
    },
  );
});
```

`RouteOptions.auth` remains the guard contract, but most applications should route through local helpers so middleware names, security schemes, and permission resources do not drift. The older `openapi.guardSecurityMap` fallback still exists for legacy middleware-only routes, but new code should put security on `auth.security` inside the helper so runtime protection and OpenAPI output share the same source.

## 6. Direct `assert()` in handlers

Use `req.auth.assert()` only when a route has additional runtime decisions that are easier to express inside the handler:

```typescript
import { permissionCoreAuth } from "../auth/permission-policies";

app.delete(
  "/posts/:id",
  permissionCoreAuth({ summary: "Delete post", tags: ["Posts"] }),
  async (req, res) => {
    const assertPermission = req.auth.assert;
    if (!assertPermission) {
      req.app.throw(500, "Permission provider is not configured", "AUTH_CONFIG_ERROR");
      return;
    }

    try {
      await assertPermission("invoke", "DELETE:/api/posts");
    } catch {
      req.app.throw(403, "Forbidden", "AUTH_FORBIDDEN");
      return;
    }

    await app.services.posts.delete(req.params.id);
    res.status(204).json(null);
  },
);
```

If permission-core denies the operation, Vext returns `AUTH_FORBIDDEN` through the Auth guard path.

## 7. Verify

The same flow is covered by `vext-test`:

```bash
cd ../vext-test
npm run build
npm run verify:core
```

The relevant assertions are:

- `#246` identity and safe request context snapshot
- `#247` permission-core `can()` allow
- `#248` permission-core `can()` deny
- `#249` missing, malformed, and unknown credential errors
- `#250` `req.auth.assert()` plus OpenAPI `bearerAuth`

# permission-core Auth 接入

本示例展示如何把 [permission-core](https://vextjs.github.io/permission-core/) 接入 VextJS Auth。Vext 的认证与路由保护是分层的：

- `auth()` 负责解析 Bearer token，并填充 `req.auth`。
- `permission-core` 负责 `invoke + GET:/api/posts` 这类授权判断。
- 一个轻量 route helper 负责把业务权限映射为 `RouteOptions.auth`，避免每个路由重复写认证中间件和资源字符串。

已验证的外部消费者项目是 `vext-test`：对应 `src/plugins/permission.ts`、`src/middlewares/permission-core-auth.ts`、`src/routes/auth-context.ts`，以及 `verify.mjs` 的 `#246-#250`。

## 1. 安装

```bash
npm install permission-core
```

演示或测试项目可以使用 `MemoryAdapter`。生产环境请按 permission-core 生产部署文档选择持久化 storage adapter，并接入 permission-core 推荐的 `cache-hub + monsqlize` 栈。

## 2. 创建 permission 插件

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

    await core.roles.create("admin", { label: "管理员" });
    await core.roles.create("editor", { label: "编辑者" });
    await core.roles.create("viewer", { label: "只读用户" });

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

## 3. 用 `auth()` 连接 permission-core

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

在 `src/config/default.ts` 注册中间件名：

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

## 4. 集中封装路由权限策略

不要在每个 route 里重复写 `middlewares: ["permission-core-auth"]` 和裸资源字符串。认证桥接中间件只注册一次，然后把路由保护形状集中到一个策略 helper：

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

这样权限词汇和资源命名只有一个真相源。项目里如果还有用户、账单等资源族，继续扩展 `requireUserPermission()`、`requireBillingPermission()`，而不是把裸 permission tuple 散落到 handler 周围。

## 5. 用策略 helper 保护路由

```typescript
// src/routes/posts.ts
import { defineRoutes } from "vextjs";
import { requirePostPermission } from "../auth/permission-policies";

export default defineRoutes((app) => {
  app.get(
    "/posts",
    requirePostPermission("read", {
      summary: "文章列表",
      tags: ["Posts"],
    }),
    async (req, res) => {
      res.json({ ok: true, userId: req.auth.userId });
    },
  );

  app.post(
    "/posts",
    requirePostPermission("create", {
      summary: "创建文章",
      tags: ["Posts"],
    }),
    async (req, res) => {
      res.json({ ok: true, userId: req.auth.userId }, 201);
    },
  );
});
```

`RouteOptions.auth` 仍然是路由保护契约，但大多数应用应通过本地 helper 间接使用它，避免 middleware 名称、安全方案和权限资源漂移。旧的 `openapi.guardSecurityMap` 仍可兼容只靠 middleware 名称推断 security 的历史路由，但新代码应把 security 写在 helper 内的 `auth.security`，让运行时保护和 OpenAPI 输出共用同一个真相源。

## 6. 在 handler 内直接 `assert()`

只有当某条路由需要在 handler 内做额外动态判断时，才使用 `req.auth.assert()`：

```typescript
import { permissionCoreAuth } from "../auth/permission-policies";

app.delete(
  "/posts/:id",
  permissionCoreAuth({ summary: "删除文章", tags: ["Posts"] }),
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

如果 permission-core 拒绝该操作，Vext 会沿 Auth guard 路径返回 `AUTH_FORBIDDEN`。

## 7. 验证

同一接入链路已经由 `vext-test` 覆盖：

```bash
cd ../vext-test
npm run build
npm run verify:core
```

相关断言如下：

- `#246` 身份填充与安全 request context 快照
- `#247` permission-core `can()` 放行
- `#248` permission-core `can()` 拒绝
- `#249` 缺失、malformed、unknown token 错误码
- `#250` `req.auth.assert()` 与 OpenAPI `bearerAuth`

# permission-core Auth 接入

本示例展示如何把 [permission-core](https://vextjs.github.io/permission-core/) 接入 VextJS Auth。Vext 的认证与路由保护是分层的：

- `auth()` 负责解析 Bearer token，并填充 `req.auth`。
- `permission-core` 负责 `invoke + GET:/api/posts` 这类授权判断。
- `RouteOptions.auth` 声明某条路由需要 Vext 执行的保护规则。

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

## 4. 使用 `RouteOptions.auth` 保护路由

```typescript
// src/routes/posts.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/posts",
    {
      middlewares: ["permission-core-auth"],
      auth: {
        permissions: [{ action: "invoke", resource: "GET:/api/posts" }],
        security: "bearerAuth",
      },
      docs: { summary: "文章列表", tags: ["Posts"] },
    },
    async (req, res) => {
      res.json({ ok: true, userId: req.auth.userId });
    },
  );

  app.post(
    "/posts",
    {
      middlewares: ["permission-core-auth"],
      auth: {
        permissions: [{ action: "invoke", resource: "POST:/api/posts" }],
        security: "bearerAuth",
      },
      docs: { summary: "创建文章", tags: ["Posts"] },
    },
    async (req, res) => {
      res.json({ ok: true, userId: req.auth.userId }, 201);
    },
  );
});
```

`RouteOptions.auth` 是推荐的路由保护契约。旧的 `openapi.guardSecurityMap` 仍可兼容只靠 middleware 名称推断 security 的历史示例，但新代码应把 security 写在 `auth.security`，让运行时保护和 OpenAPI 输出共用同一个真相源。

## 5. 在 handler 内直接 `assert()`

当某条路由还需要在 handler 内做额外判断时，可以使用 `req.auth.assert()`：

```typescript
app.delete(
  "/posts/:id",
  {
    middlewares: ["permission-core-auth"],
    auth: true,
    docs: { summary: "删除文章", tags: ["Posts"] },
  },
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

## 6. 验证

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

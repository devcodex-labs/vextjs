# permission-core Auth 接入

本页说明 [permission-core](https://github.com/devcodex-labs/permission-core) 与 VextJS Auth 的桥接方式和接入前提。外部包片段属于**兼容版本确认后的接入参考**，不能直接作为当前框架的已验证安装教程。首次验证认证流程，请运行[认证与安全](/zh/guide/security)中的完整示例。

Vext 的认证与路由保护是分层的：

- `auth()` 负责解析 Bearer token，并填充 `req.auth`。
- `permission-core` 负责 `invoke + api:GET:/api/posts` 这类授权判断。
- 每条路由把最终 `RouteOptions.auth` 内联或保存为同文件 `const`，让构建索引、运行时保护与 OpenAPI 读取同一份合同。

## 1. 先确认依赖兼容性

2026-09-25 核对的 npm 发布包 `permission-core@3.0.4` 声明 `vextjs: 0.3.26`、`monsqlize: 3.1.0` 为 peer；当前 Vext 仓库使用框架 2.0.0、MonSQLize 3.3.0。上游 main 的版本声明不等同于 npm 发布包。这些数字是核对记录，不是要求固定安装旧版 Vext。

先在应用目录检查实际解析结果：

```bash
npm view permission-core version peerDependencies peerDependenciesMeta --json
npm ls vextjs monsqlize permission-core
```

只有上游发布包声明与应用依赖相容，并通过应用自己的集成测试后，才执行通常的安装命令：

```bash
npm install permission-core
```

不要用强制安装掩盖 peer 冲突。本页没有宣称该冲突已修复，也没有验证当前 Vext 与旧版 permission-core 的完整数据库组合。立即可运行的身份与角色保护见前述安全指南；外部授权系统可通过 `auth().verify` 返回的 `can` 接入。

当前上游 API 接收宿主已连接的 MonSQLize 实例，使用支持事务的 MongoDB，没有原文的 `MemoryAdapter` 接入方式。数据库准备见[数据库指南](/zh/guide/database)，上游生命周期与 API 以[发布包说明](https://www.npmjs.com/package/permission-core)为准。

## 2. 初始化与授权数据准备

**以下片段仅供确认兼容后的项目使用。** 先启用数据库，确保 `app.db` 可用，再初始化授权核心。数据库连接由 Vext 管理，授权核心关闭时不应额外关闭宿主连接。

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

授权数据由管理流程写入，不要在每次应用启动时重复创建角色。以下是对**已初始化的 `core`**进行一次性数据准备的片段；管理身份与租户来自可信服务端：

```typescript
const scope = { tenantId: "demo" };
const scoped = core.scope(scope, {
  actorId: "demo-setup",
  requestId: "demo-permission-setup",
});
await scoped.roles.create({ id: "viewer", label: "只读用户" });
await scoped.roles.allow("viewer", {
  action: "invoke",
  resource: "api:GET:/api/posts",
});
await scoped.userRoles.assign("u-viewer", "viewer");
```

管理写入结果与失败处理遵循上游 API。viewer 仅获 GET 权限，未授予 POST/DELETE；admin/editor 也需通过管理流程创建并赋权，不会因为 token 中列出角色而自动获得权限。资源字符串由应用统一约定，授权数据、路由和动态判断必须完全一致。

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

固定 token 只用于演示身份映射，不是 JWT。生产项目需验证真实凭据，租户也必须来自可信身份。这里优先提供 can，保留授权拒绝与服务异常的区别。

在 `src/config/default.ts` 注册中间件名并启用 OpenAPI；合并到已有数据库配置中：

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

## 4. 声明可静态投影的路由保护

路由索引不会执行导入或本地 helper 函数。请把每个最终保护形状保留在路由文件的同文件 `const` 中，让 middleware、permission、security 与 docs 合同都能在运行前完整读取：

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
  docs: { summary: "文章列表", tags: ["Posts"] },
} satisfies RouteOptions;

const createPostOptions = {
  middlewares: ["permission-core-auth"],
  auth: {
    permissions: [{ action: "invoke", resource: "api:POST:/api/posts" }],
    security: "bearerAuth",
  },
  docs: { summary: "创建文章", tags: ["Posts"] },
} satisfies RouteOptions;
```

同一资源族的路由常量可以集中放在对应 route 模块中。可复用的运行时行为仍由 `permission-core-auth` middleware 与 permission provider 统一承担；路由合同本身保持静态可见。

## 5. 用最终 options 常量保护路由

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

以上两段合并为同一个路由文件，目录提供 `/api/posts` 前缀；handler 只返回授权成功结果，未实现文章 CRUD。配置中的中间件声明必须配合路由引用才会执行。

`RouteOptions.auth` 仍然是路由保护契约。有限静态语法会拒绝 route-options helper 调用；请使用最终内联对象或同文件最终 `const`。旧的 `openapi.guardSecurityMap` 只继续兼容 middleware-only 历史路由。

## 6. 在 handler 内直接 `assert()`

只有需要对象级动态判断时才在 handler 中显式授权。以下路由放入上面同一 `defineRoutes` 回调；应用还需为 `api:GET:/api/posts/<id>` 准备权限：

```typescript
app.get(
  "/:id/access",
  {
    middlewares: ["permission-core-auth"],
    auth: { required: true, security: "bearerAuth" },
    validate: { param: { id: "string!" } },
    docs: { summary: "检查文章访问权限", tags: ["Posts"] },
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

本例 assert 通过 can 的 false 显式抛403；服务异常继续传播，不能全部 catch 后改成无权限。handler 直接调用 assert **不经过 Auth guard 的异常转换**。若只给 Guard 提供上游 assert 而没有 can，Guard 会把其所有异常视为拒绝；需区分故障时应保留 can。

## 7. 验证

先验证安全指南的完整应用，再在兼容性已确认、数据库与授权数据已准备的集成项目中执行 `npm run build -- --typecheck`、`npm start`。以默认端口3000为例：

```bash
curl -i http://127.0.0.1:3000/api/posts
curl -i -H "Authorization: Bearer unknown" http://127.0.0.1:3000/api/posts
curl -i -H "Authorization: Bearer pc-viewer-token" http://127.0.0.1:3000/api/posts
curl -i -X POST -H "Authorization: Bearer pc-viewer-token" http://127.0.0.1:3000/api/posts
```

| 场景                      | 预期与责任                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| 无凭据                    | Guard 返回401、`AUTH_REQUIRED`                                     |
| Bearer 格式错误或未知凭据 | Guard 返回401、`AUTH_INVALID`                                      |
| viewer 已授予 GET         | 200，默认包装的 `data.userId` 为 `u-viewer`                        |
| viewer 未授予 POST        | 403、`AUTH_FORBIDDEN`                                              |
| can 抛出依赖故障          | Guard 返回500、`AUTH_PROVIDER_ERROR`                               |
| 动态对象拒绝              | 本例 assert 显式抛403；业务操作应放在授权之后                      |
| OpenAPI                   | `/openapi.json` 中 GET/POST 的路径为 `/api/posts`，引用 bearerAuth |
| 生命周期                  | 初始化失败终止启动；正常关闭释放授权核心，宿主负责数据库关闭       |

另外验证 request context 的安全身份快照不含 token/can/assert 函数，以及跨租户拒绝、角色变更和权限撤销；这些属于应用与上游的集成验证，单独通过 Vext Auth 测试不代表它们通过。

## 相关文档

- [认证与安全](/zh/guide/security)：可直接运行的 Vext 身份与角色保护。
- [路由定义](/zh/api/route-definition)：auth、静态声明与 OpenAPI 合同。
- [插件](/zh/guide/plugins)与[数据库](/zh/guide/database)：初始化、类型扩展和资源所有权。
- [安全与资源规范](/zh/specification/security-and-resources)：认证、授权与业务操作职责。

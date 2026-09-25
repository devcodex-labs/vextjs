# 认证与安全

本页先完成一个可运行的 Bearer 身份识别与角色保护流程，再说明 Session、CSRF、安全头和缓存的组合边界。职责约束见[安全与资源规范](/zh/specification/security-and-resources)，完整选项见[路由定义](/zh/api/route-definition)。

## 先理解两个步骤

1. **识别身份**：`createAuthMiddleware({ verify })` 读取凭据，应用的 `verify()` 验证后返回用户信息，框架将结果写入 `req.auth`。
2. **保护路由**：Route `auth` 检查认证状态、角色、scope、权限或自定义 `check`，决定是否进入 handler。

只有身份中间件而没有访问规则的路由仍可能允许匿名请求。`docs.security` 只描述 OpenAPI；它不会替你验证 token 或拒绝请求。

## 最小可运行示例

前置条件：按[快速开始](/zh/guide/quick-start)准备 TypeScript 项目，npm scripts 为 `dev: vext dev`、`build: vext build`、`start: vext start`。把下面三个文件放入项目；已有配置时合并字段。

示例的 `demo-member` / `demo-admin` 是固定演示凭据，用于验证请求链。接入真实身份系统时，替换 `verify()`，在可信服务端验证签名/有效期或查询凭据，再返回用户与权限信息。

### 1. 声明中间件

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

### 2. 识别 Bearer 凭据

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

没有 Bearer 凭据时保持匿名；无法通过 `verify()` 的凭据会记录为无效身份，随后由 Guard 拒绝。`verify()` 抛错走 `AUTH_PROVIDER_ERROR` / HTTP 500，不能把身份服务故障当作正常的“无权限”。`demo-provider-error` 专门用于验证这条失败路径。

框架不会替你验证 JWT 签名、有效期或角色真实性。`verify()` 返回对象（包括 `{}`）就会创建已认证上下文；验证失败应返回 `null` 或 `false`，按应用需要返回可信的身份标识及权限信息。不要直接把客户端提交的 roles/claims 当作验证结果。

### 3. 定义受保护路由

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

文件名提供 `/account` 前缀。`config.middlewares` 声明名称，Route `middlewares` 选择执行该中间件；只声明名称不会自动对所有请求识别身份。`/public` 的 `auth: false` 不创建 Guard，因此匿名或无效凭据都可返回200；但前面的 verify 抛错仍会返回500。生产公开接口是否接受无效凭据，应由你的产品策略决定。

### 4. 发请求验证

执行 `npm run dev`。以下请求对应上面配置的 `http://127.0.0.1:3000`；Windows PowerShell 可使用 `curl.exe`，避免旧版 PowerShell 的 curl 别名：

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

| 请求                        | 预期                                             |
| --------------------------- | ------------------------------------------------ |
| `/account`，无凭据          | 401，`AUTH_REQUIRED`                             |
| `/account`，无效凭据        | 401，`AUTH_INVALID`                              |
| `/account`，member          | 200，默认响应包装的 `data.subject` 为 `member-1` |
| `/account/admin`，member    | 403，`AUTH_FORBIDDEN`                            |
| `/account/admin`，admin     | 200，`data.area` 为 `admin`                      |
| `/account/public`，匿名     | 200，`data.authenticated` 为 `false`             |
| `/account/public`，无效凭据 | 200，`data.authenticated` 为 `false`             |
| `/account`，provider-error  | 500，`AUTH_PROVIDER_ERROR`                       |
| `/missing`                  | 404，仍带配置的基础安全头                        |

响应包装可以由配置改变；上表使用框架默认包装，错误标识位于 JSON 的 `code` 字段。示例还启用了基础安全头，可检查成功、错误和404响应中的 `X-Content-Type-Options: nosniff`。停止开发服务，再执行 `npm run build -- --typecheck` 与 `npm start`，复验相同请求。

## 选择凭据来源

`createAuthMiddleware()` 的默认来源是 `bearer`。以下入口都只负责提取凭据，最终仍由应用的 `verify(credential, req)` 验证：

| source    | 读取规则与前提                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------- |
| `bearer`  | 默认读取 Authorization，要求 Bearer 格式；可用 `header` 指定其他头                                 |
| `apiKey`  | 默认读取 x-api-key，可用 `header` 改名；配置 `cookie` 时，仅在头中无值时回退读取该 Cookie          |
| `session` | Session 中间件须先执行；读取 `sessionKey`（默认 userId），接受非空字符串或有限数字，数字转为字符串 |
| `custom`  | 不自动读取凭据，每次都以 undefined 调用 verify，由应用从 req 读取并验证                            |

非 custom 来源缺少凭据时直接保持匿名，不调用 verify。格式错误或已提供但验证失败的凭据标为无效。`optional: true` 只影响 custom 在没有自动凭据且 verify 返回空结果时的匿名处理，不能代替 Route 的访问规则。

## 接入真实权限

| 需求                             | 接入点                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| 校验 JWT、API Key 或其他身份凭据 | `verify()`，验证后返回可信 `subject/userId/roles/scopes/claims` |
| 角色、scope 匹配                 | Route `auth.roles` / `auth.scopes`                              |
| 对动作与资源进行权限判断         | 返回 `can` / `assert`，配合 `auth.permissions`                  |
| 需要业务数据的对象权限           | `auth.check(req, auth)` 或 handler/service 中的显式授权         |
| 使用 Session 中的身份            | 启用 Session，并使用 `source: "session"` 与正确 `sessionKey`    |

`mode: "any"`（默认）或 `"all"` 用于同一组要求的匹配；多个非空类别仍各自需要通过。`required: false` 只在没有额外授权规则时允许匿名跳过；配置非空 roles/scopes/permissions 或 check 函数后仍要求身份。它仍保留 Guard，所以已标为无效的凭据会先得到401；这与 `auth: false` 完全跳过 Guard 不同。

`can` 和 `assert` 同时存在时优先调用 can。can 返回 false 为403，抛错为500；assert 正常返回表示允许，任何抛错都视为拒绝并形成403。需要区分身份服务故障与业务拒绝时，可用 can 的布尔返回与抛错语义；不要假定 assert 的所有异常都会作为500传播。check 返回 false 为403，抛错为500；非空 permissions 已配置却没有 can/assert 时为500、`AUTH_CONFIG_ERROR`。

Guard 执行在路由 Schema 校验之前，因此 `check` 不能假定 `req.valid()` 已可用；如果权限判断依赖校验后的复杂输入，可以在 handler 开始时或业务服务中执行，并确保它先于受保护操作。外部权限桥接与依赖兼容前提见[permission-core 认证示例](/zh/examples/permission-core-auth)。

对要求身份的路由，未显式选择 `auth.security` 时，Auth 合同默认投影为 OpenAPI 的 `bearerAuth`；改用 API Key 或 Session 不会根据中间件 source 自动改写这个声明。应核对 `auth.security`、优先级更高的 `docs.security` 与实际安全方案；它们仍只影响文档，不改变运行时验证或授权。详见[路由 Auth 参考](/zh/api/route-definition#auth)。

## 与其他安全机制组合

- **Session**：提供会话状态，不会自动等于已登录身份；需显式从可信会话构造 auth。全局配置与手动中间件避免重复注册，分布式部署使用适合的 Store。
- **CSRF**：按应用凭据携带方式和交互流程启用。auto 模式先选择已挂载的 Session，否则需要 `config.csrf.secret` 使用签名 Cookie；路由 `csrf: false` 仅跳过已注册检查。token 获取和提交见[Cookies 与 Sessions](/zh/guide/cookies-session)。
- **安全响应头**：配置 `securityHeaders`，核对 CSP、HSTS 等设置与真实前端资源、协议和代理相容；成功、错误和 404 都要验证。
- **CORS**：核对浏览器跨域行为；服务端授权仍由 Guard/业务规则负责。
- **响应缓存**：授权通过不意味着用户之间可共用响应。用户或租户数据需要合适的隔离键或关闭缓存，见[响应缓存](/zh/guide/cache)。
- **限流**：框架全局限流发生在插件认证之前，默认按 IP。`keyBy: "user"` 分支读取 `req.user.id`，不会自动读取 `req.auth.subject`，身份键不成立时会回退到 IP；选择限流维度时必须核对实际执行位置。

### 安全头的实际生效条件

配置自动注册需 `securityHeaders.enabled: true`。basic 提供 nosniff、Referrer-Policy 和 X-Frame-Options；strict 还提供部分权限与跨源策略，但不会自动生成 CSP。CSP 必须按应用资源配置 `contentSecurityPolicy`；HSTS 默认只在 `req.protocol === "https"` 时输出，明确设置 `hsts.force` 才会越过这个条件。反向代理部署应先核对 `trustProxy` 和实际协议。

Route `securityHeaders: false` 或配置 `skipPaths` 可跳过这些头。全局配置的错误/404处理也会应用头；若只手动注册一个普通中间件，不要据此推断所有绕过该中间件的响应也受覆盖。相关字段见[配置参考](/zh/api/config)。

## 常见问题

| 症状                   | 检查与处理                                                                            | 如何复验                                 |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------- |
| 有 token 仍 401        | 中间件是否声明并在路由引用；Bearer 格式和 verify 返回是否正确                         | 用上述 member 请求检查 req.auth 对应结果 |
| 普通用户能访问管理接口 | 是否只写了 docs.security；Route 是否确有 roles/permissions/check                      | member 必须403，admin必须200             |
| Provider 异常返回500   | 在verify或provider内部保留诊断日志；框架归一为AUTH_PROVIDER_ERROR，不保留原始异常消息 | 恢复依赖后重试；不要把500改成假成功      |
| 授权函数读不到校验数据 | Guard 在 Schema 校验前执行                                                            | 调整职责位置后同时验证非法输入与越权请求 |
| 多实例会话不一致       | 是否仍使用进程内 Store、prefix 是否一致                                               | 跨实例重复访问并检查同一会话结果         |

后续维护应同时验证匿名、非法凭据、无权限、正常身份和身份服务故障路径，不能只测试 admin 成功请求。

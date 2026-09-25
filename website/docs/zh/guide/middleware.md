# 中间件

VextJS 的中间件采用 **洋葱模型**（Onion Model），支持前置和后置逻辑。框架提供 `defineMiddleware` 和 `defineMiddlewareFactory` 两种定义方式，按配置白名单从约定目录加载。本页先用无业务依赖的完整例子验证定义、配置与路由引用，再说明认证、错误处理和生命周期。

路由对中间件的引用、注册顺序与边界约束以 [HTTP 与路由规范](/zh/specification/http-and-routing) 为准。

前置条件：已有按 [快速开始](/zh/guide/quick-start) 创建并能启动的项目。按“定义两个文件 → 配置白名单 → 路由引用 → 启动验证”完成第一条接入流程；后面的认证、API Key、缓存头等按需要选用，并补齐各自的配置或业务服务。

## 洋葱模型

中间件通过 `await next()` 调用下一个中间件。`next()` 返回后可以执行后置逻辑，形成洋葱状的调用流程。handler 可能已经发送或开始发送响应，后置代码不保证还能修改响应头：

```
请求 →  [中间件A-前] → [中间件B-前] → [Handler] → [中间件B-后] → [中间件A-后]
```

```typescript
import type { VextMiddleware } from "vextjs";

const timing: VextMiddleware = async (req, res, next) => {
  // ── 前置逻辑（请求进入时执行）──
  const start = Date.now();

  await next(); // 执行下一个中间件 / 最终 handler

  // ── 后置逻辑（响应返回时执行）──
  const ms = Date.now() - start;
  req.app.logger.info(
    `${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`,
  );
};
```

## 中间件签名

```typescript
type VextMiddleware = (
  req: VextRequest,
  res: VextResponse,
  next: () => Promise<void>,
) => Promise<void> | void;
```

| 参数   | 说明                                                            |
| ------ | --------------------------------------------------------------- |
| `req`  | 框架统一的请求对象（与 Adapter 解耦）                           |
| `res`  | 框架统一的响应对象                                              |
| `next` | 调用下一个中间件；用 `await` 等待后置逻辑，或直接返回其 Promise |

## 定义中间件

中间件文件放在 `src/middlewares/` 目录下，由 `middleware-loader` 按白名单查找。文件名对应中间件名称，仅放入文件并不会自动启用。

### 普通中间件 — `defineMiddleware`

不需要参数时，用 `defineMiddleware` 标记。以下完整文件设置响应头并记录执行耗时：

```typescript
// src/middlewares/audit-log.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  res.setHeader("X-Audit", "visited");
  const start = Date.now();
  try {
    await next();
  } finally {
    req.app.logger.info(
      { path: req.path, elapsedMs: Date.now() - start },
      "Request finished",
    );
  }
});
```

### 工厂中间件 — `defineMiddlewareFactory`

需要参数时，用 `defineMiddlewareFactory` 返回中间件。以下完整文件由配置决定响应头的值：

```typescript
// src/middlewares/response-label.ts
import { defineMiddlewareFactory } from "vextjs";

interface LabelOptions {
  value?: string;
}

export default defineMiddlewareFactory<LabelOptions>((options) => {
  const value = options?.value ?? "default";
  return async (_req, res, next) => {
    res.setHeader("X-Route-Label", value);
    await next();
  };
});
```

响应头在 `next()` 前设置；后置逻辑适合记录结果或清理资源，不能假定响应尚未发送，尤其是流式响应。

:::tip 为什么需要显式标记？
`defineMiddleware` 和 `defineMiddlewareFactory` 通过 Symbol 标记让中间件类型显式化。`middleware-loader` 通过 `isMiddleware()` / `isMiddlewareFactory()` 检测标记，零歧义地区分普通中间件和工厂中间件。

未标记函数仍有兼容推断路径，但会产生弃用警告，且推断依赖默认 options 是否存在。新代码应使用显式标记，避免普通函数与工厂的歧义。
:::

## 注册与使用

中间件的使用分为两步：**配置白名单** → **路由引用**。

### Step 1: 在配置中声明白名单

先创建上面的两个中间件文件，再在已有项目的配置中加入白名单：

```typescript
// src/config/default.ts
export default {
  middlewares: [
    "audit-log",
    { name: "response-label", options: { value: "configured" } },
  ],
};
```

白名单声明可用中间件和工厂默认参数，不会自动作用于所有路由。普通中间件不接受 `options`；需要参数时必须定义为工厂。

### Step 2: 在路由中引用

```typescript
// src/routes/middleware-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    { middlewares: ["audit-log", "response-label"] },
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.get(
    "/custom",
    {
      middlewares: [
        "audit-log",
        { name: "response-label", options: { value: "route" } },
      ],
    },
    (_req, res) => {
      res.json({ ok: true });
    },
  );
});
```

### Step 3: 启动并验证

保留项目原有配置，只把白名单合入 `src/config/default.ts`，然后在项目根目录运行 `npm run dev`。另开终端执行以下请求，端口以启动输出为准；Windows PowerShell使用 `curl.exe`：

```bash
curl -i http://localhost:3000/middleware-demo
curl -i http://localhost:3000/middleware-demo/custom
```

| 请求                      | 预期状态与响应头                                     | 说明                       |
| ------------------------- | ---------------------------------------------------- | -------------------------- |
| `/middleware-demo`        | 200，`X-Audit: visited`，`X-Route-Label: configured` | 使用白名单中的工厂默认参数 |
| `/middleware-demo/custom` | 200，`X-Audit: visited`，`X-Route-Label: route`      | 使用本路由的工厂参数       |

两次响应的默认包装中均有 `data.ok: true`，服务终端还会输出 `Request finished`。若配置了环境覆盖，先核对下文“环境级中间件配置覆盖”。

再做一次失败验证：停止开发进程，从白名单删除 `response-label`，保留路由引用并重新运行 `npm run dev`。应出现包含 `response-label` 的未声明中间件诊断，路由加载失败。恢复白名单、重新启动，再执行上面的两条请求。不要把“文件已存在”当作“已在配置声明”。

认证场景使用 `auth()` 建立 `req.auth`，再通过 [`RouteOptions.auth`](/zh/api/route-definition#auth) 保护路由。最终选项可以内联或使用可静态投影的同文件 `const`；不要通过 route-options helper 调用隐藏最终声明。业务集成见 [permission-core Auth 示例](/zh/examples/permission-core-auth)。

### 参数优先级

当工厂中间件同时在配置和路由中指定了参数时，**路由级 options 整体替换配置级默认 options（不做逐字段合并）**：

```
配置默认参数 (config/default.ts)  →  路由覆盖参数 (options.middlewares)
{ roles: ['user'] }              →  { roles: ['superadmin'] }
```

### 环境级中间件配置覆盖

可以在环境配置文件中覆盖中间件的默认参数：

```typescript
// src/config/default.ts（接续上面的完整示例）
export default {
  middlewares: [
    "audit-log",
    { name: "response-label", options: { value: "configured" } },
  ],
};
```

```typescript
// src/config/development.ts — 开发环境覆盖参数
export default {
  middlewares: [{ name: "response-label", options: { value: "development" } }],
};
```

配置的 `middlewares` 数组使用智能 patch 策略：按 `name` 匹配并合并，不会简单地替换整个数组。

这是环境配置合并；路由引用中传入 `options` 时采用前文所述的整体替换。配置声明 `enabled: false` 会保留名称并加载为空操作，不执行中间件正文。此时按普通中间件处理，路由应只引用名称；若仍传 `options`，会因“不接受参数”在注册时失败。

## 中间件执行顺序

### 全局中间件

生产启动时，请求按已启用的功能依次进入以下层次；配置关闭的项不会安装：

1. 请求元数据、requestId、认证上下文与 request hooks。
2. security headers、CORS、body parser、显式启用的 rate limit。
3. response wrapper、前端 renderer、access log、全局 Session。
4. 插件通过 `app.use()` 注册的全局中间件。
5. 显式启用的 CSRF，再进入匹配的路由链。

错误处理器由 adapter 单独注册，用于处理链中传播出来的异常；它不是 handler 后必然执行的普通一环。中间件直接返回响应、缓存命中或抛错时，后续步骤可能不会执行。

内置全局中间件通过配置控制。限流仅在 `rateLimit.enabled === true` 时启用：省略 `rateLimit`，或
`rateLimit.enabled` 不严格等于 `true` 时，Vext 不安装限流中间件，因此不会产生
限流响应头或 HTTP 429。

```typescript
// src/config/default.ts
export default {
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60,
    store: { type: "redis", url: "redis://127.0.0.1:6379" }, // 可选共享 store
  },
};
```

全局限流启用后，路由可通过 `override: { rateLimit: false }` 跳过，也可传入
路由级对象覆盖 `max`、`window` 或 `keyBy`。内置 limiter 默认使用 memory；cluster
或多实例计数应配置 `rateLimit.store: { type: "redis", url }`，或配置
`rateLimit.store: "redis"` 并通过 `VEXT_REDIS_URL` / `REDIS_URL` 提供连接。
Vext 会为 RateLimit 创建一个共享 Redis store，并默认按项目、profile、运行模式和
`rate-limit` 模块生成 key 前缀；只有需要显式共享或隔离 key 时才设置 `namespace`
或 `keyPrefix`。`app.setRateLimiter()` 只替换 limiter 实现，不会隐式开启应用限流；
导出的 `createRateLimitMiddleware()` 工厂也仍可用于显式手动组合。

### 路由级中间件

路由链在 route:matched hook 后，依次为启用的 timeout/CORS/Session 包装、multipart、自定义中间件、auth guard、响应缓存与页面 freshness、自动 validate、handler。自定义中间件按 `options.middlewares` 数组顺序执行；其前置逻辑不能依赖尚未执行的自动校验：

```typescript
app.post(
  "/sensitive-action",
  {
    middlewares: ["auth", "check-role", "audit-log"],
    //            ↑ 1st    ↑ 2nd        ↑ 3rd
  },
  handler,
);
```

## 全局中间件（插件注册）

插件可以通过 `app.use()` 注册全局中间件。它们位于前述全局基础层之后、显式启用的CSRF与路由链之前；前面的中间件若已短路或抛错，插件中间件不会被执行：

```typescript
// src/plugins/request-timing.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "request-timing",
  setup(app) {
    app.use(async (req, res, next) => {
      const startedAt = Date.now();
      await next();
      app.logger.info(
        { elapsedMs: Date.now() - startedAt },
        "Request finished",
      );
    });
  },
});
```

浏览器安全响应头请优先使用内置 `config.securityHeaders`。它会一致覆盖普通响应、错误响应、404、测试辅助和 dev soft reload：

```typescript
export default {
  securityHeaders: {
    enabled: true,
    preset: "basic",
  },
};
```

:::warning 注意
`app.use()` 只能在插件的 `setup()` 中调用。路由注册完成后再调用将抛出错误。
:::

## 常见中间件示例

### 认证中间件

以下业务片段需要项目实现 `identity.verifyAccessToken` service：校验失败返回 `null`，成功返回用户标识和角色。框架不提供该业务身份库。

```typescript
// src/middlewares/auth.ts
import { auth, defineMiddleware } from "vextjs";

export default defineMiddleware(
  auth({
    source: "bearer",
    async verify(credential, req) {
      if (!credential) return null;
      const user =
        await req.app.services.identity.verifyAccessToken(credential);
      if (!user) return null;
      return { subject: user.id, userId: user.id, roles: user.roles };
    },
  }),
);
```

`auth()` 建立身份上下文；缺失或无效凭据会记录在 `req.auth`，受保护路由的 guard 再决定是否拒绝。不要用“返回固定用户”的占位函数作为凭据校验。

### 角色检查中间件

常规角色保护直接声明在路由选项中，先执行认证中间件，再执行框架 guard：

```typescript
// 在同文件路由的 app.get(path, adminOptions, handler) 中使用
const adminOptions = {
  middlewares: ["auth"],
  auth: { required: true, roles: ["admin"], security: "bearerAuth" },
};
```

自定义中间件可以读取 `req.auth.isAuthenticated` 和 `req.auth.roles`。写入私有 `req.user` 不会自动同步到 `req.auth`。完整字段与错误码见 [路由 API](/zh/api/route-definition#auth)。

### 请求耗时记录

```typescript
// src/middlewares/timing.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  const start = performance.now();

  await next();

  const duration = (performance.now() - start).toFixed(2);

  req.app.logger.info(
    {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
    },
    "Request completed",
  );
});
```

### API Key 验证

```typescript
// src/middlewares/api-key.ts
import { defineMiddlewareFactory } from "vextjs";

interface ApiKeyOptions {
  header?: string;
  keys?: string[];
}

export default defineMiddlewareFactory<ApiKeyOptions>((options) => {
  const headerName = (options?.header ?? "x-api-key").toLowerCase();
  const validKeys = new Set(options?.keys ?? []);

  return async (req, res, next) => {
    if (validKeys.size === 0) {
      req.app.throw(500, "API key middleware requires configured keys");
    }

    const apiKey = req.headers[headerName];
    if (!apiKey || !validKeys.has(apiKey)) {
      req.app.throw(401, "Invalid API key");
    }

    await next();
  };
});
```

### 缓存控制

```typescript
// src/middlewares/cache-control.ts
import { defineMiddlewareFactory } from "vextjs";

interface CacheOptions {
  maxAge?: number; // 秒
  directive?: string; // 'public' | 'private' | 'no-cache' | 'no-store'
}

export default defineMiddlewareFactory<CacheOptions>((options) => {
  const maxAge = options?.maxAge ?? 0;
  const directive = options?.directive ?? "public";
  const value = maxAge > 0 ? `${directive}, max-age=${maxAge}` : "no-store";

  return async (req, res, next) => {
    res.setHeader("Cache-Control", value);
    await next();
  };
});
```

## 错误处理中间件

全局错误处理由框架内置的 `error-handler` 负责，处理中间件请求链中抛出或 await 到的异常；脱离该链的后台 Promise 或定时器错误不属于这个保证：

- `HttpError`（由 `app.throw()` 抛出）→ 保留声明的 HTTP 状态和业务错误字段
- `VextValidationError`（参数校验失败）→ 路径参数 400，其他位置 422，均包含 errors 数组
- 普通 `Error` → 没有有效的 `status` / `statusCode` 时默认 HTTP 500；显式附带有效 HTTP 状态时归一化会采用该状态，例如 `Object.assign(new Error("Conflict"), { statusCode: 409 })` 返回 409

JSON API 排查时明确请求 `Accept: application/json`。浏览器请求 HTML 时，开发覆盖层或页面错误渲染可能返回 HTML；完整的格式、消息隐藏和 `details` 边界见 [错误处理](/zh/guide/error-handling#与普通-error-的区别)。

### 什么时候用哪种抛错方式

- 需要明确的 HTTP 语义时，优先使用 `app.throw(...)`。例如 `404`、`401`、`409`，或需要附带业务错误码的场景。
- 需要返回字段级校验详情时，抛出 `VextValidationError`。
- 发生真正的未预期异常时，可以直接 `throw new Error("...")`，框架会自动捕获并转成 `500`。

```typescript
// 结构化 HTTP 错误
req.app.throw(404, "user.not_found");

// 第四参数为对象/数组时作为 details 输出，适合透出三方业务详情
req.app.throw(
  502,
  "payment.failed",
  { orderId },
  {
    provider: "stripe",
    providerCode: "card_declined",
  },
);

// 字段级校验错误
throw new VextValidationError([{ field: "email", message: "邮箱格式不正确" }]);

// 未预期的运行时错误
throw new Error("Database connection lost");
```

要注意，`throw new Error("...")` 并不表示客户端一定会看到完整错误详情。它的用途是让框架捕获“未知异常”：

- 默认情况下，客户端会收到安全的 `500 Internal Server Error`
- 当 `response.hideInternalErrors = false` 时，JSON 500 响应会附带 `stack`
- 浏览器在 dev 模式访问出错页面时，还可能看到内置的 HTML error overlay

因此，若你的目标是“返回一个明确的 4xx/5xx HTTP 结果给调用方”，应使用 `app.throw(...)`，而不是依赖普通 `Error`

如果只想在“路由参数校验通过后”记录请求，可使用 `app.hooks.on("validation:success", ...)`。该 hook 在 `validate` 全部通过后触发，校验失败的请求不会进入它：

```typescript
export default definePlugin({
  name: "validated-access-log",
  setup(app) {
    app.hooks.on("validation:success", ({ req, route }) => {
      app.logger.info(
        { requestId: req.requestId, route: route.path },
        "validated request",
      );
    });
  },
});
```

你**不需要**手动编写框架错误处理器。需要观察插件中间件下游传播的异常时，可用 `app.use()` 注册 try-catch；它捕获不到排在它之前的解析、限流等步骤的异常。下例演示记录并重新抛出；接入Sentry时，在注释位置调用已安装和初始化的SDK：

```typescript
// src/plugins/sentry.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "sentry",
  setup(app) {
    app.use(async (req, res, next) => {
      try {
        await next();
      } catch (err) {
        // 上报错误到 Sentry
        // Sentry.captureException(err);
        app.logger.error({ err }, "Captured by Sentry plugin");

        // 重新抛出，让框架的 error-handler 处理响应
        throw err;
      }
    });
  },
});
```

## 中间件中的 `req.app`

路由级中间件没有 `defineRoutes` 的闭包 `app`，因此通过 `req.app` 访问框架能力：

```typescript
export default defineMiddleware(async (req, res, next) => {
  // 通过 req.app 访问各种框架能力
  req.app.logger.info("Middleware executing"); // 日志
  // req.app.throw(403, "Forbidden"); // 需要拒绝时调用；调用后不再继续
  const config = req.app.config; // 读取配置
  const userSvc = req.app.services.user; // 访问服务

  await next();
});
```

## 内置中间件

常用内置中间件及配置如下；完整装配顺序见上文，前端 renderer 仅在前端功能启用时安装：

| 中间件              | 配置项                   | 说明                                             |
| ------------------- | ------------------------ | ------------------------------------------------ |
| **requestId**       | `config.requestId`       | 生成/透传请求唯一标识                            |
| **authContext**     | `config.requestContext`  | 同步认证上下文快照，不负责验证凭据               |
| **securityHeaders** | `config.securityHeaders` | 显式启用浏览器安全响应头                         |
| **cors**            | `config.cors`            | CORS 跨域处理                                    |
| **bodyParser**      | `config.bodyParser`      | 请求体解析（JSON / URL-encoded）                 |
| **rateLimit**       | `config.rateLimit`       | 显式启用的全局限流；仅 `enabled: true` 时安装    |
| **accessLog**       | `config.accessLog`       | 访问日志（method / path / status / duration）    |
| **responseWrapper** | `config.response`        | 响应出口包装 `{ code, data, requestId }`         |
| **session**         | `config.session`         | 全局启用或由路由单独启用                         |
| **csrf**            | `config.csrf`            | 显式启用 CSRF 防护                               |
| **errorHandler**    | —                        | 全局错误处理；暴露与日志行为由 response 配置控制 |

详见 [配置](/zh/guide/configuration) 章节了解各项配置选项。

`req.auth` 在适配器创建请求对象时已初始化为匿名上下文。`requestContext.enabled: false` 会跳过上表的 authContext 中间件及框架请求 ALS 作用域，不会删除 `req.auth`，也不会禁用显式注册的 `auth()` 认证或路由 guard。

## TypeScript 类型扩展

如果中间件在 `req` 上挂载了自定义属性（如 `req.user`），推荐通过 `declare module` 扩展类型：

```typescript
// src/types/extensions.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextRequest {
    user?: {
      id: string;
      email: string;
      role: string;
    };
  }
}
```

扩展后，所有路由和中间件中访问 `req.user` 都会获得类型提示，无需 `as any` 断言。

## 最佳实践

### 1. 保持中间件职责单一

尽量让中间件职责单一。认证由中间件建立身份，常规授权可由 `RouteOptions.auth` guard 承担；确需自定义授权逻辑时，也可再引用一个中间件：

```typescript
// ✅ 正确 — 职责单一
middlewares: ["auth", "check-role"];

// ❌ 避免 — 一个中间件做太多事
middlewares: ["auth-and-role-check"];
```

<a id="2-始终-await-next"></a>

### 2. 等待或返回 `next()`

需要执行后置逻辑时使用 `await next()`；没有后置逻辑时也可 `return next()`，将 Promise 交给上层等待。不要调用后丢弃 Promise：

```typescript
// ✅ 正确
export default defineMiddleware(async (req, res, next) => {
  console.log("before");
  await next(); // 等待后续中间件和 handler 完成
  console.log("after");
});

// ❌ 错误 — 忘记 await，后置逻辑可能在异步 handler 完成前执行
export default defineMiddleware(async (req, res, next) => {
  console.log("before");
  next(); // 没有 await！
  console.log("after — 此处没有等待下游完成");
});
```

### 3. 短路响应

某些中间件需要短路请求（如认证失败）：先调用 `res.json()` 等方法发送响应，再返回；也可以用 `app.throw()` 抛出错误，由框架发送错误响应。两种情况都不再调用 `next()`；仅 `return` 不会自动生成响应：

```typescript
export default defineMiddleware(async (req, res, next) => {
  if (!isAllowed(req)) {
    // 直接抛出错误，不调用 next() — 请求在此终止
    req.app.throw(403, "Access denied");
  }

  await next();
});
```

由于 `app.throw()` 的返回类型是 `never`，它会自动终止执行流程。

### 4. 在配置中管理，而非硬编码

避免在中间件内部硬编码配置值。使用工厂模式接收参数，在配置文件中统一管理：

```typescript
// ✅ 正确 — 参数由配置管理
export default defineMiddlewareFactory<{ maxAge: number }>((options) => {
  const maxAge = options?.maxAge ?? 3600;
  return async (req, res, next) => {
    res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
    await next();
  };
});

// ❌ 避免 — 硬编码
export default defineMiddleware(async (req, res, next) => {
  res.setHeader("Cache-Control", "public, max-age=3600"); // 无法按环境变更
  await next();
});
```

## 下一步

- 学习 [插件](/zh/guide/plugins) 如何通过 `app.use()` 注册全局中间件
- 了解 [参数校验](/zh/guide/validation) 中间件的自动生成
- 查看 [配置](/zh/guide/configuration) 中内置中间件的完整选项
- 探索 [测试](/zh/guide/testing) 如何测试中间件逻辑
- 核对 [HTTP 与路由规范](/zh/specification/http-and-routing) 中的中间件规则

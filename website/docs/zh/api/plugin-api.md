# 插件 API

本页用于查询插件定义、中间件定义辅助函数和相关类型的签名、参数与边界。第一次编写插件，请先完成[插件指南的完整示例](/zh/guide/plugins#完整示例与验证)；配置白名单并引用中间件的完整流程见[中间件指南](/zh/guide/middleware)。

## 概述

插件用于在启动阶段集中注册应用扩展。通过插件可以：

- 向 `app` 挂载自定义属性（`app.extend()`）
- 注册全局中间件（`app.use()`）
- 注册优雅关闭钩子（`app.onClose()`）
- 注册就绪钩子（`app.onReady()`）
- 注册运行时生命周期 hook（`app.hooks.on()`）
- 替换内置实现（`app.setValidator()` / `app.setThrow()` / `app.setLogger()` / `app.setRateLimiter()` / `app.setRequestIdGenerator()`），各方法合同见[应用实例](/zh/api/app)

插件文件放在 `src/plugins/` 目录下，`plugin-loader` 在启动时自动扫描加载。本页按定义 → 生命周期 → 加载 → 中间件辅助函数 → 类型与资源边界排列；局部示例不组成同一个项目。

---

## definePlugin

`definePlugin` 是创建插件的推荐方式，提供类型推断和 IDE 自动补全支持。

### 函数签名

```typescript
function definePlugin(plugin: VextPlugin): VextPlugin;
```

接收一个 `VextPlugin` 对象，原样返回（仅用于类型标注）。

### 基本用法

```typescript
// src/plugins/demo-cache.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "demo-cache",
  setup(app) {
    const cache = new Map<string, string>();
    app.extend("demoCache", cache);
    app.onClose(() => {
      cache.clear();
    });
  },
});
```

该示例只展示插件定义与关闭注册，Map 没有 TTL、容量限制和持久化。接入 Redis 等外部资源的前提与示例见[插件指南](/zh/guide/plugins)。

### defineAppExtensions

为插件通过 `app.extend()` 暴露的属性提供显式类型生成声明：

```typescript
function defineAppExtensions<T extends Record<string, unknown>>(): T;
```

在插件文件顶层导出名为 `appExtensions` 的值：

```typescript
import { defineAppExtensions } from "vextjs";

export const appExtensions = defineAppExtensions<{
  demoCache: Map<string, string>;
}>();
```

该函数运行时返回空对象，不会创建 Map、调用 `app.extend()` 或验证实际扩展值。`npm exec -- vext typegen` 读取此声明并生成应用类型；声明必须与 `setup()` 实际挂载的值一致。生成文件与 TypeScript 接入见[项目结构](/zh/guide/project-structure)。

---

## VextPlugin

插件接口定义。

```typescript
interface VextPlugin {
  readonly name: string;
  readonly dependencies?: string[];
  setup(
    app: VextPluginContext,
    context: VextPluginSetupContext,
  ): Promise<void> | void;
  onReady?(app: VextPluginContext): Promise<void> | void;
  onClose?(app: VextPluginContext): Promise<void> | void;
}
```

`VextPluginContext` 提供 config、logger、hooks、services、adapter、cache、fetch 以及扩展/替换/生命周期方法；具体可用性取决于生命周期阶段。类型不提供 `app.get/post/...` 路由注册合同，请在 `defineRoutes()` 中定义路由。自定义属性使用字符串索引，必要时结合类型声明或明确收窄使用。

`VextPluginSetupContext` 的公开字段是 `readonly signal: AbortSignal`，只作为 `setup()` 的第二个参数传入。`onReady` / `onClose` 不接收这个取消上下文。

### `name`

插件名称，全局唯一标识。

```typescript
readonly name: string;
```

用于日志输出、错误信息和依赖声明。用户插件扫描结果中出现同名插件会在执行 setup 前报错，不支持后加载覆盖。替换框架能力应使用对应的 `app.set*()` 接口；自定义资源也不要占用内置扩展名称。

```typescript
export default definePlugin({
  name: "my-plugin", // 唯一标识
  setup(app) {
    /* ... */
  },
});
```

### `dependencies`

依赖的其他插件名称列表（可选）。

```typescript
readonly dependencies?: string[];
```

`plugin-loader` 根据此字段进行**拓扑排序**，确保依赖的用户插件先于当前插件执行 `setup()`。依赖名必须存在于本轮扫描的用户插件中；缺失或循环依赖都会导致启动失败。

下面是依赖声明片段：假定已定义名为 `redis` 和 `sql-database` 的两个用户插件，分别挂载 `app.redis` / `app.sql`，并由应用提供 `UserCacheService` 类。

```typescript
export default definePlugin({
  name: "user-cache",
  dependencies: ["redis", "sql-database"],
  async setup(app) {
    // 已完成依赖的 setup；外部连接是否就绪仍取决于依赖实现
    const userCache = new UserCacheService(app.redis, app.sql);
    app.extend("userCache", userCache);
  },
});
```

:::warning
循环依赖会导致启动失败：

```
[vextjs] Circular dependency detected in plugins: redis → sql-database → redis
```

:::

### `setup(app, context)`

插件初始化函数，在 `bootstrap` 的步骤②被 `plugin-loader` 调用。

```typescript
setup(
  app: VextPluginContext,
  context: VextPluginSetupContext,
): Promise<void> | void;
```

**参数**：

| 参数      | 类型                     | 说明                                                                  |
| --------- | ------------------------ | --------------------------------------------------------------------- |
| `app`     | `VextPluginContext`      | 可撤销的 setup facade；此时 `app.use()` 可用，`app.services` 尚未注入 |
| `context` | `VextPluginSetupContext` | setup 生命周期上下文，包含供可取消 I/O 使用的 `signal: AbortSignal`   |

**关键说明**：

- 可以是同步或异步函数
- `plugin-loader` 为每个 `setup()` 设置**硬超时**（默认 30 秒）；失败或超时会中止 `context.signal`、回滚 setup 阶段的受控框架变更并撤销 setup facade，然后抛出错误。依赖事件循环调度，不能强行打断同步阻塞代码
- 成功完成后 setup facade 同样被撤销；迟到的异步 continuation 不能再调用 `extend`、`use`、生命周期注册等受控方法或写入 app 顶层属性。该保护不阻止嵌套对象修改，也不取消外部 I/O；插件仍须处理取消并清理自己创建的资源
- 执行顺序由 `dependencies` 拓扑排序决定
- `setup()` 执行时 `app.services` 尚未注入（`service-loader` 在 `plugin-loader` 之后执行），不能访问服务
- 如果插件对象声明了 `onReady(app)` / `onClose(app)`，`plugin-loader` 会在 `setup()` 成功后自动注册这两个生命周期钩子
- `app.hooks.on()` 可用于注册 request/validation/response/fetch/service/plugin/OpenAPI 等运行时 hook，详见 [应用实例 hooks](/zh/api/app#apphooks)

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "demo-state",
  setup(app) {
    const state = { requests: 0 };
    app.extend("demoState", state);
    app.use(async (_req, _res, next) => {
      state.requests += 1;
      await next();
    });
    app.onReady(() => {
      app.logger.info("demo-state ready");
    });
    app.onClose(() => {
      app.logger.info({ requests: state.requests }, "demo-state closed");
    });
  },
});
```

### `onReady(app)` / `onClose(app)`

插件生命周期钩子为可选字段，等价于在 `setup()` 中手动调用 `app.onReady()` / `app.onClose()`，但语义更明确。

```typescript
export default definePlugin({
  name: "warmup",
  setup(app) {
    app.extend("warmupState", new Map());
  },
  async onReady(app) {
    app.logger.info("warmup plugin is ready");
  },
  async onClose(app) {
    app.logger.info("warmup plugin closed");
  },
});
```

- `onReady(app)`：正常 CLI 启动时 HTTP 开始监听后执行，适合预热缓存或记录就绪信息；不能依靠它在监听前阻止请求。测试辅助入口的触发条件见[测试指南](/zh/guide/testing)。
- `onClose(app)`：优雅关闭时执行；多个关闭钩子按 LIFO 顺序执行。

同一清理动作在对象钩子与 `app.onClose()` 中选择一种注册方式，避免重复执行。setup 失败/超时会回滚该阶段的注册，不能只依赖 onClose 清理失败阶段的资源；详见下方资源清理。

---

## 插件加载机制

### 自动扫描

`plugin-loader` 递归扫描 `src/plugins/` 下的 `.ts` / `.js` / `.mjs` / `.cjs` 文件；跳过 `_` / `.` 开头的文件和目录，以及 `.test.` / `.spec.` 文件与 `.d.ts`。每个被加载文件的 `default export` 应为 `VextPlugin` 对象。编译产物模式从实际构建输出的 `plugins/` 加载，默认是 `dist/plugins/`；JavaScript 源码模式仍从源码目录加载。

```
src/plugins/
  ├── database.ts     → definePlugin({ name: 'database', ... })
  ├── redis.ts        → definePlugin({ name: 'redis', ... })
  └── auth.ts         → definePlugin({ name: 'auth', ... })
```

### 拓扑排序

根据 `dependencies` 字段自动计算执行顺序：

```typescript
// database.ts — 无依赖，最先执行
definePlugin({ name: 'database', setup(app) { ... } })

// redis.ts — 无依赖，与 database 并列
definePlugin({ name: 'redis', setup(app) { ... } })

// auth.ts — 依赖 database 和 redis
definePlugin({
  name: 'auth',
  dependencies: ['database', 'redis'],
  setup(app) { ... },
})
```

本例执行顺序：`database` → `redis` → `auth`。无依赖的候选按名称排序；需要先后关系时应声明 dependencies，不要依赖文件名或偶然的扫描顺序。

### 超时保护

用户插件的每个 `setup()` 默认限制为 30 秒，超时处理范围见上文。当前标准 dev/start/testing 入口未将 `config.plugin.setupTimeout` 传入 loader，因此设置该字段不会改变实际期限。耗时资源初始化应使用自身支持的超时与取消机制。

### 内置插件

VextJS 内置 `monsqlize` 插件；标准启动在检测到 `config.database` 时，在用户插件之前加载它，并挂载原始 `app.db`。通常通过[数据库配置](/zh/guide/database)启用，无需在用户插件中再次创建。

```typescript
import { createMonSQLizePlugin } from "vextjs";
```

该工厂虽为公开导出，内置插件不进入用户 plugins 目录的依赖图：不要仅因启用了内置数据库，就在用户插件声明 `dependencies: ["monsqlize"]`。自定义 SQL 连接池使用独立配置名与扩展名，例如 `sqlDatabase` / `sql`。

---

## defineMiddleware

创建无配置中间件的辅助函数。原函数被附加 `__tag` Symbol 值后返回，供 loader 识别；该标记不验证业务逻辑或输入数据。

### 函数签名

```typescript
function defineMiddleware(middleware: VextMiddleware): TaggedMiddleware;
```

### 基本用法

下面是认证逻辑片段：`verifyJWT` 由应用实现并负责签名、有效期等验证；`req.user` 需要按本页“类型声明”扩展。若使用框架 `RouteOptions.auth`，还应建立 `req.auth`，写入私有 `req.user` 不会自动同步身份。

```typescript
// src/middlewares/auth.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return req.app.throw(401, "未提供认证令牌");
  }

  try {
    const decoded = await verifyJWT(token);
    req.user = decoded;
  } catch {
    req.app.throw(401, "认证令牌无效或已过期");
  }

  await next();
});
```

### VextMiddleware 类型

```typescript
type VextMiddleware = (
  req: VextRequest,
  res: VextResponse,
  next: () => Promise<void>,
) => Promise<void> | void;
```

三个参数：

| 参数   | 类型                  | 说明                       |
| ------ | --------------------- | -------------------------- |
| `req`  | `VextRequest`         | 请求对象                   |
| `res`  | `VextResponse`        | 响应对象                   |
| `next` | `() => Promise<void>` | 调用下一个中间件 / handler |

### 洋葱模型

中间件通过 `await next()` 实现洋葱模型，可以在 handler 执行前后分别处理：

```typescript
export default defineMiddleware(async (req, res, next) => {
  // ── before handler（请求进入阶段）──
  const start = Date.now();
  console.log(`→ ${req.method} ${req.path}`);

  await next(); // 执行 handler 及后续中间件

  // ── after handler（响应返回阶段）──
  const duration = Date.now() - start;
  console.log(`← ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
});
```

执行流程：

```
请求 → 中间件A(before) → 中间件B(before) → handler → 中间件B(after) → 中间件A(after)
```

这是调用栈顺序，不是响应缓冲保证。handler 可能已发送或开始发送响应；需要影响响应头时，应在 `await next()` 前设置。抛错时普通后置语句可能跳过，需要无论成功失败都执行的日志可放入 `finally`。

### 短路响应

不调用 `next()` 可以短路请求，handler 不会执行：

```typescript
const blockedIPs = new Set(["192.0.2.10"]); // 示例地址集合

export default defineMiddleware(async (req, res, next) => {
  // IP 黑名单检查
  if (blockedIPs.has(req.ip)) {
    res.status(403).json({ message: "访问被拒绝" });
    return; // 不调用 next()
  }

  await next();
});
```

### 错误处理

请求链中抛出或 await 到的错误会交给框架 `error-handler`；脱离该链的后台 Promise、定时器错误不在此保证内：

```typescript
export default defineMiddleware(async (req, _res, next) => {
  if (!req.headers.authorization) {
    // 使用 app.throw 抛出标准 HTTP 错误
    req.app.throw(401, "未提供认证令牌");
    // 等价于 throw new HttpError(401, '未提供认证令牌')
  }

  await next();
});
```

如果中间件遇到的是“我要主动返回给调用方的 HTTP 错误”，推荐使用 `req.app.throw(...)`。如果是未预期的运行时失败，也可以直接 `throw new Error("...")`，框架会将其转成 500；若需要返回字段级校验详情，则应抛出 `VextValidationError`。

---

## defineMiddlewareFactory

创建**带配置的中间件工厂**。接收配置参数，返回中间件函数。

### 函数签名

```typescript
function defineMiddlewareFactory<TOptions = unknown>(
  factory: (options?: TOptions) => VextMiddleware,
): TaggedMiddlewareFactory<TOptions>;
```

### 基本用法

```typescript
// src/middlewares/role.ts
import { defineMiddlewareFactory } from "vextjs";

interface RoleOptions {
  required: string | string[];
}

export default defineMiddlewareFactory<RoleOptions>((options) => {
  if (!options) throw new Error("role 中间件需要 required 配置");
  const requiredRoles = Array.isArray(options.required)
    ? options.required
    : [options.required];

  return async (req, _res, next) => {
    const user = req.user;
    if (!user) {
      return req.app.throw(401, "未认证");
    }

    if (!requiredRoles.includes(user.role)) {
      req.app.throw(403, "权限不足", {
        required: requiredRoles.join(", "),
        current: user.role,
      });
    }

    await next();
  };
});
```

### 配置传递

中间件工厂的配置通过 `config.middlewares` 白名单传递：

```typescript
// src/config/default.ts
export default {
  middlewares: [
    { name: "auth" }, // 无配置中间件
    { name: "role", options: { required: "admin" } }, // 工厂中间件 + 配置
    { name: "client-cache", options: { maxAge: 300 } }, // 工厂中间件 + 配置
  ],
};
```

路由中引用时可以覆盖默认配置。路由 `options` **整体替换**白名单默认值，不逐字段合并；两处都未传参数时，工厂收到 `undefined`，应自行提供默认值或明确报错：

```typescript
app.get(
  "/admin/users",
  {
    middlewares: [
      "auth",
      { name: "role", options: { required: ["admin", "superadmin"] } },
    ],
  },
  handler,
);
```

### 更多示例

**客户端缓存头中间件**：

```typescript
// src/middlewares/client-cache.ts
import { defineMiddlewareFactory } from "vextjs";

interface ClientCacheOptions {
  maxAge: number; // Cache-Control max-age，单位秒
}

export default defineMiddlewareFactory<ClientCacheOptions>((options) => {
  if (!options) throw new Error("client-cache 中间件需要 maxAge 配置");
  return async (_req, res, next) => {
    res.setHeader("Cache-Control", `public, max-age=${options.maxAge}`);
    await next();
  };
});
```

该片段只用于适合公开缓存的响应；带身份或用户私有内容的接口应采用符合业务隔离要求的缓存策略。它只设置 HTTP 缓存头，不保存服务端响应。

:::tip
路由级响应缓存不需要自定义中间件。请直接使用 route options 的 `cache` 字段；其 TTL 配置单位是毫秒。`app.cache` 是响应缓存控制面，只用于 `invalidate()`、`delete()`、`clear()` 和 `stats()`。
:::

**限速：使用内建限流器**：

不要在中间件工厂中复制一套永久驻留的进程级 `Map`。应启用 Vext 内建限流，并用路由覆盖表达更严格的配额：

```typescript
// src/config/default.ts
export default {
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60, // 秒
    keyBy: "ip",
  },
};

// 单个路由使用更严格的限流；设为 false 可关闭该路由的限流。
app.post(
  "/login",
  { override: { rateLimit: { max: 5, window: 60 } } },
  handler,
);
```

内建默认存储是单进程的，因此不同 worker 或应用实例会独立计数。共享配额可配置 `rateLimit.store: { type: "redis", url }`；需要自定义 limiter 实现时才使用 `app.setRateLimiter()`，该调用本身不会启用限流。key 选择、路由覆盖、响应头和 429 处理仍由内建中间件负责，详见[配置](/zh/guide/configuration)。

---

## isMiddleware / isMiddlewareFactory

类型检查辅助函数，用于判断一个值是否为 `defineMiddleware` / `defineMiddlewareFactory` 创建的中间件。

### 函数签名

```typescript
function isMiddleware(value: unknown): value is TaggedMiddleware;
function isMiddlewareFactory(value: unknown): value is TaggedMiddlewareFactory;
```

### 用法

```typescript
import {
  defineMiddleware,
  defineMiddlewareFactory,
  isMiddleware,
  isMiddlewareFactory,
} from "vextjs";

const plain = defineMiddleware(async (_req, _res, next) => next());
const factory = defineMiddlewareFactory(() => plain);

console.log(isMiddleware(plain)); // true
console.log(isMiddlewareFactory(factory)); // true
console.log(isMiddleware(factory)); // false
```

:::tip
这两个函数通常由框架内部的 `middleware-loader` 使用，用户代码很少需要直接调用。
:::

---

## VextErrorMiddleware

错误中间件类型（框架内部使用）。

```typescript
type VextErrorMiddleware = (
  err: unknown,
  req: VextRequest,
  res: VextResponse,
) => void;
```

它接收错误、请求、响应三个参数，没有 `next`，返回合同为 `void`。框架内置 `error-handler` 使用此类型并由 adapter 单独注册；不能把它当作普通中间件传给 `app.use()`。业务抛错与字段级校验错误见[错误处理](/zh/guide/error-handling)。

---

## TaggedMiddleware / TaggedMiddlewareFactory

被 Symbol 标记的中间件类型，用于 `middleware-loader` 区分普通函数和框架中间件。

```typescript
type TaggedMiddleware = VextMiddleware & {
  readonly __tag: typeof MIDDLEWARE_SYMBOL;
};

type TaggedMiddlewareFactory<TOptions = unknown> = ((
  options?: TOptions,
) => VextMiddleware) & {
  readonly __tag: typeof MIDDLEWARE_FACTORY_SYMBOL;
};
```

### Symbol 常量

```typescript
import { MIDDLEWARE_SYMBOL, MIDDLEWARE_FACTORY_SYMBOL } from "vextjs";
```

辅助函数把对应 Symbol 值放在函数的 `__tag` 属性上；用户代码不需要手动设置。另有导出的 `VextDefinedMiddleware` / `VextMiddlewareFactory` / `VextMiddlewareExport` 类型，其 Symbol 键结构不同，不是上述 helper 的返回类型；不要据此手工构造对象交给当前 loader，它要求默认导出为函数。

---

## 中间件文件组织

### 目录结构

```
src/middlewares/
  ├── auth.ts           → defineMiddleware(...)      // 认证中间件
  ├── role.ts           → defineMiddlewareFactory(...) // 角色校验（带配置）
  ├── client-cache.ts   → defineMiddlewareFactory(...) // 客户端缓存头中间件（带配置）
  └── request-logger.ts → defineMiddleware(...)      // 请求日志
```

### 中间件注册流程

1. `middleware-loader` 遍历 `config.middlewares` 白名单，校验名称与重复声明
2. 按名称查找 `src/middlewares/` 中的 `.ts` / `.js` / `.mjs` / `.cjs` 文件（按此优先级）
3. 使用 `isMiddleware()` / `isMiddlewareFactory()` 区分类型
4. 保存函数、kind、defaultOptions 到按名称索引的注册表
5. 路由注册时解析名称引用；普通中间件直接使用，工厂以路由覆盖或默认参数调用后使用
6. 路由引用未声明名称、普通中间件收到 options 等情况在启动时失败

### 配置白名单

只有在 `config.middlewares` 中声明的中间件才能在路由 `options.middlewares` 中引用：

```typescript
// src/config/default.ts
export default {
  middlewares: [
    { name: "auth" },
    { name: "role", options: { required: "user" } },
  ],
};
```

未在白名单中声明的中间件在路由中引用会抛出启动错误。白名单仅允许路由引用，不会自动作用于全部路由；全局中间件由插件调用 `app.use()`。声明 `enabled: false` 会保留名称并注册为空操作，不查找或执行原文件。该条目的 kind 为普通中间件，因此禁用后应只按名称引用；即使原文件是工厂，路由继续传 `options` 也会报“不接受参数”。

---

## 内置中间件

VextJS 按配置安装内置中间件；下面列出常见项。函数名用于定位实现，并不表示它们都默认启用或都需要用户手动调用：

| 中间件           | 函数                           | 说明              |
| ---------------- | ------------------------------ | ----------------- |
| Request ID       | `createRequestIdMiddleware()`  | 请求 ID 生成/透传 |
| CORS             | `createCorsMiddleware()`       | 跨域资源共享      |
| Body Parser      | `createBodyParserMiddleware()` | 请求体解析        |
| Rate Limit       | `createRateLimitMiddleware()`  | 速率限制          |
| Response Wrapper | `responseWrapper`              | 出口包装          |
| Access Log       | `createAccessLogMiddleware()`  | 访问日志          |
| Error Handler    | `createErrorHandler()`         | 错误处理          |

请求元数据、认证上下文、request hooks、安全头、前端 renderer、Session 和 CSRF 也参与请求处理，完整用途与配置见[中间件指南](/zh/guide/middleware#内置中间件)。限流需 `rateLimit.enabled === true`，Session/CSRF/安全头等也有各自启用条件。通常通过[配置项](/zh/api/config)控制；避免手动重复注册已启用的内置中间件，这不是所有工厂均有重复注册检测的保证。

### 执行顺序

生产启动的全局装配顺序如下，禁用项跳过，任意阶段短路或抛错都可能不进入后续步骤：

```
请求进入
  → 请求元数据 / requestId / 认证上下文 / request hooks
  → 安全头 / CORS / body parser / rate limit
  → response wrapper / 前端 renderer / access log / 全局 Session
  → 插件通过 app.use() 注册的全局中间件
  → CSRF
  → 匹配路由的处理链
```

路由链还包含按选项启用的 timeout/CORS/Session、multipart、自定义中间件、auth guard、缓存、页面 freshness、自动校验与 handler，见[中间件执行顺序](/zh/guide/middleware#中间件执行顺序)。错误处理器通过 adapter 单独注册；response wrapper 在发送方法上包装数据，不能理解为 handler 后才统一发送响应。

---

## 插件开发最佳实践

### 1. 命名规范

- 建议插件 `name` 使用 kebab-case：`'my-plugin'`
- 建议文件名与插件名一致：`src/plugins/my-plugin.ts`；依赖判断使用 name，不使用文件名

### 2. 类型声明

应用扩展优先使用前述 `defineAppExtensions` 与类型生成。以下展示另一种手写声明方式，以及私有请求字段/自定义配置声明；相同属性不要同时维护不兼容的生成声明与手写声明：

```typescript
// types/vext.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextApp {
    demoCache: Map<string, string>;
  }

  interface VextRequest {
    user?: {
      id: string;
      role: string;
    };
  }

  interface VextConfig {
    sqlDatabase?: {
      connectionString: string;
    };
  }
}
```

将 `types/**/*.d.ts` 包含在应用 tsconfig 中。声明不会创建运行时属性；`database` / `db` 已有内置含义，不要把它们改声明为不兼容的 SQL 配置或连接池。

### 3. 资源清理

成功初始化后的资源注册 onClose；初始化失败或超时阶段还要自行清理。下面是资源管理片段：`createPool` 是应用提供的工厂，接收 `sqlDatabase` 与 `AbortSignal`、在内部失败时负责释放已创建的部分资源，成功返回支持 `end(): Promise<void>` 的池。它不是 Vext 内置 API。

```typescript
export default definePlugin({
  name: "sql-database",
  async setup(app, { signal }) {
    const pool = await createPool(app.config.sqlDatabase, { signal });
    try {
      signal.throwIfAborted();
      app.extend("sql", pool);
      app.onClose(async () => {
        await pool.end();
      });
    } catch (error) {
      await pool.end();
      throw error;
    }
  },
});
```

### 4. 错误处理

`setup()` 中的错误会导致启动失败。需要补充日志时，记录后重新抛出错误；不能吞掉错误并让不完整的插件启动。下面沿用上述应用提供的 createPool，并保留两个阶段的清理：

```typescript
export default definePlugin({
  name: "sql-database",
  async setup(app, { signal }) {
    try {
      const pool = await createPool(app.config.sqlDatabase, { signal });
      try {
        signal.throwIfAborted();
        app.extend("sql", pool);
        app.onClose(async () => {
          await pool.end();
        });
      } catch (error) {
        await pool.end();
        throw error;
      }
    } catch (err) {
      app.logger.fatal({ error: err }, "数据库连接失败");
      throw err; // 重新抛出，阻止启动
    }
  },
});
```

### 5. 可选依赖

当前 dependencies 只有必需依赖，没有“存在时参与排序、不存在则跳过”的可选声明。setup 中仅检查 `app.redis` 是否存在，不能区分“未配置”和“尚未初始化”。若要在所有插件加载后检测，可在 onReady 中更新 setup 已创建的状态：

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "optional-cache-status",
  setup(app) {
    const availability = { checked: false, redisPresent: false };
    app.extend("cacheAvailability", availability);
    app.onReady(() => {
      availability.redisPresent = app.redis !== undefined;
      availability.checked = true;
    });
  },
});
```

这里只检测扩展是否存在，不证明 Redis 连接健康，也不实现缓存。onReady 在监听后执行，消费者必须能处理 checked=false；需要 setup 阶段保证资源存在时，应明确安装所需插件并声明必需依赖，或将可选接入集中在同一个插件内处理。

---

## 类型导入

```typescript
import {
  definePlugin,
  defineAppExtensions,
  defineMiddleware,
  defineMiddlewareFactory,
  isMiddleware,
  isMiddlewareFactory,
  MIDDLEWARE_SYMBOL,
  MIDDLEWARE_FACTORY_SYMBOL,
} from "vextjs";

import type {
  VextPlugin,
  VextPluginContext,
  VextPluginSetupContext,
  VextMiddleware,
  VextErrorMiddleware,
  VextHandler,
  VextDefinedMiddleware,
  VextMiddlewareFactory,
  VextMiddlewareExport,
  TaggedMiddleware,
  TaggedMiddlewareFactory,
} from "vextjs";
```

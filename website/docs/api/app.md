# 应用实例

本页详细介绍 VextJS 的应用实例 `VextApp` 的完整 API，包括内置模块、扩展方法、生命周期钩子和启动函数。

## 概述

`VextApp` 是整个 VextJS 应用的核心对象，通过 `createApp(config)` 创建。它挂载了配置、服务、日志、错误抛出等内置能力，并通过 `extend()` / `use()` 等方法支持插件扩展。

在大多数场景中，你不需要直接调用 `createApp()` —— `bootstrap()` 内部会自动调用它。你通过以下方式访问 `app`：

- **路由 handler**：`defineRoutes((app) => { ... })` 的闭包参数
- **中间件**：`req.app`
- **插件 setup**：`setup(app)` 的参数
- **服务**：通过 `app.services` 互相访问

---

## 生命周期

`VextApp` 从创建到销毁经历以下阶段：

```
createApp(config)
  → resolveAdapter()        // 解析底层 HTTP 适配器
  → plugin-loader            // 加载插件，执行 setup()（app.use() 可用）
  → middleware-loader         // 加载中间件定义
  → service-loader            // 加载服务（app.services 注入）
  → mount app.fetch           // 挂载内置 HTTP 客户端（requestId 传播 + 结构化日志）
  → router-loader             // 加载路由文件，注册路由
  → lockUse()                 // 禁止 app.use()
  → 注册内置中间件            // requestId / cors / bodyParser / responseWrapper / accessLog / errorHandler
  → adapter.listen()          // HTTP 开始监听
  → onReady 钩子              // 就绪回调执行
  → 运行中...
  → SIGTERM / SIGINT          // 收到信号
  → shutdown()                // 优雅关闭
    → 停止接受新请求
    → 等待飞行中请求完成
    → onClose 钩子（LIFO）
    → process.exit(0)
```

---

## bootstrap

`bootstrap()` 是框架的标准启动函数，编排完整的启动流程。

```typescript
import { bootstrap } from "vextjs";

bootstrap();
```

### 函数签名

```typescript
function bootstrap(options?: { rootDir?: string }): Promise<BootstrapResult>;

interface BootstrapResult {
  app: VextApp;
  serverHandle: VextServerHandle;
}
```

### 参数

| 参数      | 类型     | 默认值          | 说明       |
| --------- | -------- | --------------- | ---------- |
| `rootDir` | `string` | `process.cwd()` | 项目根目录 |

### 启动流程

`bootstrap()` 内部执行以下步骤（按顺序）：

| 步骤 | 操作                | 说明                                                        |
| ---- | ------------------- | ----------------------------------------------------------- |
| ①    | `loadConfig()`      | 三层配置合并（default → env → local）                       |
| ②    | `createApp(config)` | 创建 app 实例                                               |
| ③    | `resolveAdapter()`  | 解析并实例化底层适配器                                      |
| ④    | `loadPlugins()`     | 扫描 `src/plugins/`，按拓扑排序执行 `setup()`               |
| ⑤    | `loadMiddlewares()` | 扫描 `src/middlewares/`，注册中间件定义                     |
| ⑥    | `loadServices()`    | 扫描 `src/services/`，注入到 `app.services`                 |
| ⑥+   | 挂载 `app.fetch`    | 封装 Node.js fetch，自动传播 requestId + 结构化日志         |
| ⑦    | `loadRoutes()`      | 扫描 `src/routes/`，注册路由到 adapter                      |
| ⑧    | `lockUse()`         | 锁定 `app.use()`，禁止后续注册全局中间件                    |
| ⑨    | 注册内置中间件      | requestId → cors → bodyParser → accessLog → responseWrapper |
| ⑩    | 注册错误处理        | errorHandler + 404 兜底                                     |
| ⑪    | `adapter.listen()`  | HTTP 开始监听                                               |
| ⑫    | `setupShutdown()`   | 注册信号处理（SIGTERM / SIGINT）                            |
| ⑬    | `runReady()`        | 执行所有 `onReady` 钩子                                     |

### 典型入口文件

```typescript
// src/index.ts
import { bootstrap } from "vextjs";

bootstrap().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
```

### 返回值

```typescript
const { app, serverHandle } = await bootstrap();

// app: VextApp 实例
// serverHandle: HTTP 服务器句柄（用于获取监听地址等）
console.log(`服务器运行在 http://${app.config.host}:${app.config.port}`);
```

---

## createApp

`createApp()` 是底层工厂函数，创建 `VextApp` 实例和框架内部方法集合。

```typescript
import { createApp, DEFAULT_CONFIG } from "vextjs";

const { app, internals } = createApp(config);
```

### 函数签名

```typescript
function createApp(config: VextConfig): {
  app: VextApp;
  internals: AppInternals;
};
```

### 返回值

| 字段        | 类型           | 说明                              |
| ----------- | -------------- | --------------------------------- |
| `app`       | `VextApp`      | 用户可见的应用实例                |
| `internals` | `AppInternals` | 框架内部方法（仅 bootstrap 使用） |

:::tip
通常不需要直接调用 `createApp()`。`bootstrap()` 和 `createTestApp()` 内部已经封装了完整的初始化流程。只有需要完全自定义启动流程时才使用此函数。
:::

---

## VextApp 接口

### 内置模块

#### `app.logger`

结构化日志实例，基于 `pino` 实现。

```typescript
logger: VextLogger;
```

自动携带 `requestId`（通过 AsyncLocalStorage），支持 `.child()` 创建子 logger。

```typescript
// 基本使用
app.logger.info("服务器启动成功");
app.logger.error({ userId: "123" }, "用户查询失败");
app.logger.debug("调试信息");

// 结构化日志（对象 + 消息）
app.logger.info({ event: "user_created", userId: "abc" }, "用户创建成功");

// 子 logger（携带额外上下文）
const serviceLogger = app.logger.child({ service: "UserService" });
serviceLogger.info("查询用户列表");
// → { service: 'UserService', requestId: '...', msg: '查询用户列表' }
```

**日志级别方法**：

| 方法                | 级别  | 说明                   |
| ------------------- | ----- | ---------------------- |
| `logger.fatal(...)` | fatal | 致命错误，应用即将崩溃 |
| `logger.error(...)` | error | 运行时错误             |
| `logger.warn(...)`  | warn  | 警告信息               |
| `logger.info(...)`  | info  | 一般信息（默认级别）   |
| `logger.debug(...)` | debug | 调试信息               |

每个方法支持两种签名：

```typescript
// 纯消息
logger.info(msg: string, ...args: unknown[]): void;

// 对象 + 消息
logger.info(obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;
```

**`child(bindings)`**：

```typescript
child(bindings: Record<string, unknown>): VextLogger;
```

创建子 logger，携带额外的上下文字段。所有通过子 logger 输出的日志都会自动附加 `bindings` 中的字段。

```typescript
// 在服务中创建专属 logger
class UserService {
  private logger: VextLogger;

  constructor(app: VextApp) {
    this.logger = app.logger.child({ service: "UserService" });
  }

  async findById(id: string) {
    this.logger.info({ userId: id }, "查询用户");
    // → { service: 'UserService', userId: '123', requestId: '...', msg: '查询用户' }
  }
}
```

---

#### `app.throw(status, message, paramsOrCode?, code?)`

抛出 HTTP 错误，框架统一转为标准错误响应。支持三种调用形式。

**函数签名**：

```typescript
// 快捷方式（i18n key，status 从 i18n 配置读取，默认 400）
throw(messageKey: string): never;
throw(messageKey: string, params: Record<string, unknown>): never;

// 标准调用（显式指定 HTTP 状态码）
throw(
  status: number,
  message: string,
  paramsOrCode?: Record<string, unknown> | number | string,
  code?: number | string,
): never;
```

---

##### 快捷方式（推荐用于 i18n 场景）

当第一个参数为 **字符串** 时，视为 i18n key 快捷调用。HTTP 状态码从 i18n 语言包配置的 `statusCode` 字段读取，未配置则默认 `400`：

```typescript
// 最简写法 — status 从 i18n 配置读取，默认 400
app.throw("balance.insufficient");

// 带 i18n 插值参数
app.throw("balance.insufficient", { balance: 50, required: 100 });

// i18n 配置中指定了 statusCode: 404 → 自动使用 404
app.throw("user.not_found");
```

**快捷方式的 status 解析规则**：

| 优先级 | 来源                         | 说明                                         |
| :----: | ---------------------------- | -------------------------------------------- |
|   1    | i18n 语言包中的 `statusCode` | 如 `user.not_found` 配置了 `statusCode: 404` |
|   2    | 默认值 `400`                 | 未配置 `statusCode` 时的兜底值               |

**快捷方式的业务错误码**：如果 i18n 语言包中为该 key 配置了独立的 `code`（与 key 本身不同），会自动附加到响应中。

---

##### 标准调用

当第一个参数为 **数字** 时，作为 HTTP 状态码，行为与之前完全一致：

```typescript
// 简单错误
app.throw(404, "用户不存在");

// 带业务错误码（number）
app.throw(400, "邮箱已注册", 10001);

// 带业务错误码（string）
app.throw(401, "缺少认证令牌", "UNAUTHORIZED");

// 带 i18n 参数
app.throw(400, "balance.insufficient", { balance: 50 });

// 同时带 i18n 参数和业务码
app.throw(400, "balance.insufficient", { balance: 50 }, 20001);
```

**标准调用参数**：

| 参数           | 类型                                          | 说明                                         |
| -------------- | --------------------------------------------- | -------------------------------------------- |
| `status`       | `number`                                      | HTTP 状态码（400/401/403/404/409/500…）      |
| `message`      | `string`                                      | 错误描述（同时作为 i18n key 查找）           |
| `paramsOrCode` | `Record<string, unknown> \| number \| string` | i18n 插值参数对象 或 业务错误码              |
| `code`         | `number \| string`                            | 业务错误码（当第三参数为 params 对象时使用） |

---

##### i18n 联动

`message`（或快捷方式的 `messageKey`）同时作为 i18n key 进行语言包查找。框架通过 AsyncLocalStorage 获取当前请求的 `locale`，自动翻译错误消息：

```typescript
// 标准调用
app.throw(404, "user.not_found");

// 快捷方式（效果相同，前提是 i18n 配置中 statusCode: 404）
app.throw("user.not_found");

// 中文环境 → { code: 404, message: '用户不存在' }
// 英文环境 → { code: 404, message: 'User not found' }
```

无 i18n 语言包时，退化为原始 message 直接传递。

**错误响应格式**：

```json
{
  "code": 10001,
  "message": "邮箱已注册",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

:::tip
`app.throw()` 返回类型为 `never`，意味着它会中断当前函数执行。无需在调用后添加 `return` 语句。TypeScript 类型系统会正确识别后续代码为不可达。
:::

---

#### `app.config`

最终合并后的运行时配置（只读）。

```typescript
config: Readonly<VextConfig>;
```

由 `loadConfig()` 加载 `default → env → local` 三层合并并 `Object.freeze()` 深度冻结。

```typescript
app.get("/info", async (_req, res) => {
  res.json({
    port: app.config.port,
    adapter: typeof app.config.adapter,
    corsEnabled: app.config.cors.enabled,
  });
});
```

:::warning
`app.config` 在运行时是冻结的，任何修改尝试都会抛出错误（严格模式）或静默失败。如需动态配置，请使用 `app.extend()` 挂载可变状态。
:::

---

#### `app.services`

`service-loader` 注入的所有服务实例。

```typescript
services: VextServices;
```

通过 `app.services.<name>` 方式访问。`service-loader` 在 `router-loader` 之前执行，因此在 handler 中访问 `app.services` 是安全的。

```typescript
// src/services/user.ts
export default class UserService {
  constructor(private app: VextApp) {}

  async findById(id: string) {
    // ...
  }
}

// src/routes/users.ts
export default defineRoutes((app) => {
  app.get("/:id", async (req, res) => {
    const user = await app.services.user.findById(req.params.id);
    res.json(user);
  });
});
```

**类型扩展**：

```typescript
// types/vext.d.ts
declare module "vextjs" {
  interface VextServices {
    user: import("../src/services/user").default;
    order: import("../src/services/order").default;
  }
}
```

---

#### `app.cache`

路由缓存管理 API。在 `createApp` 阶段初始化，提供缓存失效、删除、清空、统计等操作。

```typescript
cache: {
  invalidate(tag: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): { entries: number; hits: number; misses: number; hitRate: number };
};
```

| 方法              | 说明                                             |
| ----------------- | ------------------------------------------------ |
| `invalidate(tag)` | 按标签批量失效所有关联缓存条目                   |
| `delete(key)`     | 删除指定 key 的缓存                              |
| `clear()`         | 清空所有缓存条目                                 |
| `stats()`         | 返回缓存统计（条目数、命中数、未命中数、命中率） |

```typescript
// 商品更新后失效相关缓存
app.post("/products", {}, async (req, res) => {
  await db.createProduct(req.body);
  await app.cache.invalidate("products");
  res.json({ created: true }, 201);
});

// 查看缓存统计
app.get("/admin/cache-stats", {}, async (req, res) => {
  res.json(app.cache.stats());
});
```

详见 [路由缓存指南](/guide/cache)。

---

#### `app.adapter`

底层适配器实例（由 `resolveAdapter()` 解析后挂载）。

```typescript
adapter: VextAdapter;
```

:::warning
这是框架内部属性，用户代码通常不需要直接操作 adapter。框架通过 adapter 注册中间件、路由、错误处理等。
:::

---

### HTTP 方法

`VextApp` 上的 HTTP 方法（`get/post/put/patch/delete/head/options`）是**占位方法**，不能直接调用。实际路由注册通过 `defineRoutes` 完成。

```typescript
// ❌ 直接在 app 上调用会抛出错误
app.get("/hello", handler);
// Error: [vextjs] app.get() cannot be called directly on the app instance.
// Use defineRoutes(app => { app.get(...) }) in route files.

// ✅ 通过 defineRoutes 注册
export default defineRoutes((app) => {
  app.get("/hello", handler); // OK — 这里的 app 是 collector
});
```

支持**三段式**和**两段式**两种语法：

```typescript
// 三段式：(path, options, handler)
app.get(
  "/users",
  {
    validate: { query: { page: "number:1-" } },
  },
  handler,
);

// 两段式：(path, handler)
app.get("/health", handler);
```

支持的方法：`get` / `post` / `put` / `patch` / `delete` / `head` / `options`

---

### 框架扩展 API

#### `app.extend(key, value)`

向 app 挂载自定义属性（**插件专用**）。

```typescript
extend<K extends string, V>(key: K, value: V): void;
```

```typescript
// 在插件中挂载
import { definePlugin } from "vextjs";
import Redis from "ioredis";

export default definePlugin({
  name: "redis",
  async setup(app) {
    const redis = new Redis(app.config.redis);
    app.extend("cache", redis);
    app.onClose(() => redis.quit());
  },
});
```

配合 `declare module` 获得类型提示：

```typescript
// types/vext.d.ts
declare module "vextjs" {
  interface VextApp {
    cache: import("ioredis").Redis;
  }
}

// 使用时有类型提示
app.cache.get("key"); // ✅ IDE 知道是 Redis 实例
```

---

#### `app.use(middleware)`

注册全局 HTTP 中间件（**插件专用**）。

```typescript
use(middleware: VextMiddleware): void;
```

对所有路由生效，在路由级 middlewares 之前执行。只能在插件 `setup()` 中调用，路由注册完成后调用将抛出错误。

```typescript
import { definePlugin, defineMiddleware } from "vextjs";

const securityHeaders = defineMiddleware(async (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  await next();
});

export default definePlugin({
  name: "security",
  setup(app) {
    app.use(securityHeaders);
  },
});
```

:::warning
`app.use()` 在路由注册（`router-loader`）完成后会被锁定。此后调用将抛出错误：

```
[vextjs] app.use() is locked after route registration.
Global middleware must be registered in plugin setup().
```

:::

---

#### `app.setValidator(validator)`

替换全局校验引擎（**插件专用**）。

```typescript
setValidator(validator: VextValidator): void;
```

默认使用 `schema-dsl`，可替换为 Zod、Yup 等第三方校验库。

```typescript
import { definePlugin } from "vextjs";
import { z } from "zod";

export default definePlugin({
  name: "zod-validator",
  setup(app) {
    app.setValidator({
      compile(schema) {
        const zodSchema = z.object(schema);
        return (data) => {
          const result = zodSchema.safeParse(data);
          if (result.success) {
            return { valid: true, data: result.data };
          }
          return {
            valid: false,
            errors: result.error.issues.map((issue) => ({
              field: issue.path.join("."),
              message: issue.message,
            })),
          };
        };
      },
    });
  },
});
```

---

#### `app.getValidator()`

获取当前校验引擎实例。

```typescript
getValidator(): VextValidator;
```

```typescript
const validator = app.getValidator();
const validate = validator.compile({ name: "string:1-50" });
const result = validate({ name: "Alice" });
// { valid: true, data: { name: 'Alice' } }
```

---

#### `app.setThrow(wrapper)`

包装或替换 `app.throw` 的实现（**插件专用**）。

```typescript
setThrow(wrapper: (original: VextApp['throw']) => VextApp['throw']): void;
```

接收原始 `throw` 实现，返回新实现。可用于拦截错误、添加日志、修改错误格式等。

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "error-tracking",
  setup(app) {
    app.setThrow((originalThrow) => {
      return (status, message, paramsOrCode, code) => {
        // 上报错误到监控平台
        if (status >= 500) {
          errorTracker.captureError(new Error(message), { status });
        }
        // 调用原始实现
        return originalThrow(status, message, paramsOrCode, code);
      };
    });
  },
});
```

---

#### `app.setRateLimiter(limiter)`

替换全局速率限制实现（**插件专用**）。

```typescript
setRateLimiter(limiter: VextRateLimiter): void;
```

默认使用 `flex-rate-limit`。可替换为 Redis 实现以支持分布式限流。

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "redis-rate-limit",
  async setup(app) {
    const redis = app.cache; // 假设 redis 插件已先加载

    app.setRateLimiter({
      async check(key) {
        const current = await redis.incr(`rl:${key}`);
        if (current === 1) {
          await redis.expire(`rl:${key}`, app.config.rateLimit.window);
        }
        const max = app.config.rateLimit.max;
        return {
          allowed: current <= max,
          remaining: Math.max(0, max - current),
          resetAt: Date.now() + app.config.rateLimit.window * 1000,
        };
      },
    });
  },
});
```

**VextRateLimiter 接口**：

```typescript
interface VextRateLimiter {
  check(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }>;
}
```

---

#### `app.setRequestIdGenerator(generate)`

覆盖 requestId 生成算法（**插件专用**）。

```typescript
setRequestIdGenerator(generate: () => string): void;
```

默认使用 `crypto.randomUUID()`。常见替换：APM traceId、Snowflake ID 等。

```typescript
import { definePlugin } from "vextjs";
import { nanoid } from "nanoid";

export default definePlugin({
  name: "nanoid-request-id",
  setup(app) {
    app.setRequestIdGenerator(() => nanoid(21));
  },
});
```

也可通过配置文件静态设置：

```typescript
// src/config/default.ts
import { nanoid } from "nanoid";

export default {
  requestId: {
    generate: () => nanoid(),
  },
};
```

---

### 生命周期钩子

#### `app.onReady(handler)`

注册就绪钩子，在 HTTP 监听开始后执行。

```typescript
onReady(handler: () => Promise<void> | void): void;
```

适用于：预热缓存、检查外部依赖、打印启动信息等。

```typescript
app.onReady(async () => {
  await warmupCache();
  app.logger.info("缓存预热完成");
});

app.onReady(() => {
  app.logger.info(`服务器运行在 http://${app.config.host}:${app.config.port}`);
});
```

**执行规则**：

- 所有 `onReady` 钩子按注册顺序**依次执行**（非并行）
- 执行完毕后自动清空 hooks 数组，释放闭包引用
- 钩子中抛出的错误会被捕获并记录日志，不影响服务运行

---

#### `app.onClose(handler)`

注册优雅关闭钩子，SIGTERM/SIGINT 信号触发时按 **LIFO** 顺序执行。

```typescript
onClose(handler: () => Promise<void> | void): void;
```

适用于：关闭数据库连接、刷新日志缓冲区、取消定时任务等。

```typescript
// 数据库连接清理
app.onClose(async () => {
  await app.db.disconnect();
  app.logger.info("数据库连接已关闭");
});

// 定时任务取消
app.onClose(() => {
  clearInterval(healthCheckTimer);
});

// Redis 连接关闭
app.onClose(async () => {
  await app.cache.quit();
});
```

**执行规则**：

- 按 **LIFO**（后进先出）顺序执行 —— 后注册的钩子先执行
- 每个钩子独立 try/catch，单个钩子失败不影响其他钩子
- 执行完毕后自动清空 hooks 数组，释放资源引用

**LIFO 顺序设计原因**：

资源的销毁顺序应与创建顺序相反。例如：先连接数据库，再基于数据库创建缓存。关闭时应先关闭缓存，再关闭数据库。

```typescript
// 注册顺序
app.onClose(closeDatabase); // 第一个注册
app.onClose(closeCache); // 第二个注册

// 执行顺序（LIFO）
// 1. closeCache()   ← 后注册的先执行
// 2. closeDatabase() ← 先注册的后执行
```

---

## AppInternals

`createApp()` 返回的内部方法集合，仅供 `bootstrap` 使用，用户代码不应直接调用。

```typescript
interface AppInternals {
  lockUse(): void;
  runReady(): Promise<void>;
  getGlobalMiddlewares(): VextMiddleware[];
  getRateLimiter(): VextRateLimiter | null;
  getRequestIdGenerator(): (() => string) | null;
  shutdown(
    serverHandle?: VextServerHandle,
    options?: { skipExit?: boolean },
  ): Promise<void>;
}
```

| 方法                      | 说明                                 |
| ------------------------- | ------------------------------------ |
| `lockUse()`               | 锁定 `app.use()`，路由注册完成后调用 |
| `runReady()`              | 执行所有 `onReady` 钩子              |
| `getGlobalMiddlewares()`  | 获取全局中间件列表                   |
| `getRateLimiter()`        | 获取自定义速率限制器                 |
| `getRequestIdGenerator()` | 获取自定义 requestId 生成器          |
| `shutdown()`              | 触发优雅关闭流程                     |

### shutdown 流程

```typescript
async shutdown(
  serverHandle?: VextServerHandle,
  options?: { skipExit?: boolean },
): Promise<void>;
```

1. **防重复**：内部 `_shuttingDown` 标志防止 SIGTERM + SIGINT 重复触发
2. **步骤 1**：停止接受新请求 + 等待飞行中请求完成（受 `config.shutdown.timeout` 超时保护）
3. **步骤 2**：按 LIFO 顺序执行所有 `onClose` 钩子（每个钩子独立 try/catch）
4. **步骤 3**：退出进程（`_testMode` 或 `skipExit` 时跳过 `process.exit()`）

---

## DEFAULT_CONFIG

框架内置默认配置常量，可用于参考或快速启动：

```typescript
import { DEFAULT_CONFIG } from "vextjs";
```

完整内容参见 [配置项 — DEFAULT_CONFIG](/api/config#default_config)。

---

## setupShutdown

独立的信号处理注册函数，`bootstrap` 内部自动调用。

```typescript
import { setupShutdown } from "vextjs";

setupShutdown(app, serverHandle, internals);
```

注册 `SIGTERM` 和 `SIGINT` 信号处理器，收到信号时触发 `internals.shutdown()`。

---

## 辅助工厂函数

### definePlugin

创建 `VextPlugin` 的推荐方式。参见 [插件 API](/api/plugin-api)。

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "my-plugin",
  async setup(app) {
    // ...
  },
});
```

### defineRoutes

创建路由文件的核心函数。参见 [路由定义](/api/route-definition)。

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/hello", async (_req, res) => {
    res.json({ message: "Hello!" });
  });
});
```

### defineMiddleware / defineMiddlewareFactory

创建中间件的辅助函数。参见 [插件 API](/api/plugin-api#definemiddleware)。

```typescript
import { defineMiddleware, defineMiddlewareFactory } from "vextjs";

// 无配置中间件
export default defineMiddleware(async (req, res, next) => {
  // ...
  await next();
});

// 带配置的中间件工厂
export default defineMiddlewareFactory((options) => {
  return async (req, res, next) => {
    // 使用 options...
    await next();
  };
});
```

---

## 类型导入

```typescript
import type {
  VextApp,
  VextConfig,
  VextUserConfig,
  VextServices,
  VextLogger,
  VextRateLimiter,
  VextValidator,
} from "vextjs";

import type { AppInternals, BootstrapResult } from "vextjs";
```

---

## 完整使用示例

### 插件开发

```typescript
// src/plugins/database.ts
import { definePlugin } from "vextjs";
import { createPool } from "./db";

export default definePlugin({
  name: "database",
  async setup(app) {
    // 1. 创建数据库连接池
    const pool = await createPool(app.config.database);

    // 2. 挂载到 app
    app.extend("db", pool);

    // 3. 注册就绪钩子
    app.onReady(async () => {
      const result = await pool.query("SELECT 1");
      app.logger.info("数据库连接验证成功");
    });

    // 4. 注册关闭钩子
    app.onClose(async () => {
      await pool.end();
      app.logger.info("数据库连接池已关闭");
    });
  },
});
```

### 服务开发

```typescript
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  private logger;

  constructor(private app: VextApp) {
    this.logger = app.logger.child({ service: "UserService" });
  }

  async findById(id: string) {
    this.logger.info({ userId: id }, "查询用户");
    const user = await this.app.db.query("SELECT * FROM users WHERE id = ?", [
      id,
    ]);

    if (!user) {
      this.app.throw(404, "user.not_found");
    }

    return user;
  }

  async create(data: { name: string; email: string }) {
    this.logger.info({ email: data.email }, "创建用户");

    const existing = await this.app.db.query(
      "SELECT id FROM users WHERE email = ?",
      [data.email],
    );
    if (existing) {
      this.app.throw(409, "邮箱已注册", 10001);
    }

    return this.app.db.query("INSERT INTO users (name, email) VALUES (?, ?)", [
      data.name,
      data.email,
    ]);
  }
}
```

### 路由开发

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/list",
    {
      validate: {
        query: { page: "number:1-", limit: "number:1-100" },
      },
      docs: {
        summary: "用户列表",
        tags: ["用户"],
      },
    },
    async (req, res) => {
      const { page, limit } = req.valid("query");
      const users = await app.services.user.findAll({ page, limit });
      res.json(users);
    },
  );

  app.get(
    "/:id",
    {
      validate: { param: { id: "string:1-" } },
      docs: { summary: "获取用户详情" },
    },
    async (req, res) => {
      const user = await app.services.user.findById(req.valid("param").id);
      res.json(user);
    },
  );

  app.post(
    "/",
    {
      validate: {
        body: { name: "string:1-50", email: "email" },
      },
      middlewares: ["auth"],
      docs: { summary: "创建用户" },
    },
    async (req, res) => {
      const user = await app.services.user.create(req.valid("body"));
      res.json(user, 201);
    },
  );
});
```

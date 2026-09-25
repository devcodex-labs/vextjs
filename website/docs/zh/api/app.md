# 应用实例

本页详细介绍 VextJS 的应用实例 `VextApp` 的完整 API，包括内置模块、扩展方法、生命周期钩子和启动函数。

## 概述

`VextApp` 是整个 VextJS 应用的核心对象，通过 `createApp(config)` 创建。它挂载了配置、服务、日志、错误抛出等内置能力，并通过 `extend()` / `use()` 等方法支持插件扩展。

常规项目通过 [快速开始](/zh/guide/quick-start) 中的 `npm run dev`、`npm run build`、`npm start` 启动，由 CLI 编排初始化。只有自定义启动流程才需要直接调用 `bootstrap()` 或底层 `createApp()`。本页用于查询接口；组合使用方式见文末完整示例。

你通过以下方式访问 `app`：

- **路由 handler**：`defineRoutes((app) => { ... })` 的闭包参数
- **中间件**：`req.app`
- **插件 setup**：`setup(app)` 的参数，类型为 `VextPluginContext`
- **服务**：构造函数 `constructor(app: VextApp)` 接收应用实例

---

## 生命周期

标准 HTTP `bootstrap()` 的主要阶段如下。CLI 开发模式和测试辅助各自编排生命周期，不能把底层 `createApp()` 当成已经完成全部阶段的应用。

```
加载、校验并冻结配置
  → createApp(config)         // 创建基础模块及运行时
  → resolveAdapter()          // 解析底层 HTTP 适配器
  → i18n、内置数据库插件      // 按配置初始化
  → 挂载 app.fetch            // 用户插件 setup 前已可用
  → plugin-loader             // 执行用户插件 setup（app.use 可用）
  → middleware-loader         // 校验白名单并加载中间件定义
  → service-loader            // 加载服务到 app.services
  → router-loader             // 注册业务路由
  → 前端、OpenAPI/Docs        // 按配置注册相关端点
  → lockUse()                 // 锁定 app.use
  → 全局中间件、错误与404处理 // 具体链见路由规范
  → server:beforeListen
  → adapter.listen()          // HTTP 开始监听
  → 注册关闭/致命错误处理
  → runReady()                // 就绪回调执行
  → 运行中...
  → SIGTERM / SIGINT          // 收到信号
  → shutdown()                // 优雅关闭
    → 停止接受新请求
    → 等待飞行中请求完成
    → onClose 钩子（LIFO）、缓存与日志清理
    → 正常关闭退出；测试或 skipExit 跳过退出
```

---

## bootstrap

`bootstrap()` 是框架的标准启动函数，编排完整的启动流程。

```typescript
import { bootstrap } from "vextjs";

await bootstrap();
```

### 函数签名

```typescript
function bootstrap(rootDir?: string): Promise<BootstrapResult>;

interface BootstrapResult {
  app: VextApp;
  serverHandle: VextServerHandle;
  internals: AppInternals;
}
```

### 参数

| 参数      | 类型     | 默认值          | 说明       |
| --------- | -------- | --------------- | ---------- |
| `rootDir` | `string` | `process.cwd()` | 项目根目录 |

### 启动流程

`bootstrap()` 内部执行以下步骤（按顺序）：

| 顺序 | 操作                               | 说明                                                                                                    |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1    | 配置加载与最终化                   | `default → 环境配置 → local → provider patch → CLI override`；local 仅开发/测试加载，最终校验并深度冻结 |
| 2    | `createApp(config)` 及运行时初始化 | 创建 logger、hooks、validator、响应缓存等，按配置准备会话与限流运行时                                   |
| 3    | `resolveAdapter()`、i18n           | 解析适配器、加载语言包并更新错误翻译能力                                                                |
| 4    | 内置数据库插件、`app.fetch`        | 配置了 database 才初始化 MonSQLize；fetch 在用户插件前挂载                                              |
| 5    | `loadPlugins()`                    | 按用户插件依赖排序执行 setup；生产构建使用构建目录中的文件                                              |
| 6    | 中间件与服务                       | 检查中间件白名单，加载定义，再实例化服务                                                                |
| 7    | 路由及可选端点                     | 加载业务路由，随后处理前端、OpenAPI/Docs 端点                                                           |
| 8    | `lockUse()` 与全局处理链           | 锁定全局插件中间件注册，装配内置中间件、错误处理和 404 兜底                                             |
| 9    | `server:beforeListen`、监听        | 事件完成后调用 `adapter.listen()`                                                                       |
| 10   | 关闭与就绪                         | 注册信号及致命错误处理，执行 `runReady()`，返回启动结果                                                 |

配置条件见 [配置指南](/zh/guide/configuration)，请求链见 [HTTP 与路由规范](/zh/specification/http-and-routing)。启动的注册顺序与每次请求的执行顺序需分别理解。

### 典型入口文件

以下是自行编排启动的入口片段。CLI 项目无需额外创建此文件；直接运行 TypeScript 源码还需要相应的加载环境，生产运行应使用已经构建的项目。

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
const { app, serverHandle, internals } = await bootstrap();

// port 是实际监听端口；标准配置要求端口在 1–65535 之间
app.logger.info(
  { host: serverHandle.host, port: serverHandle.port },
  "HTTP 已监听",
);
// 需要手动结束时：await internals.shutdown(serverHandle, { skipExit: true });
```

`serverHandle` 提供只读 `host`、`port` 和异步 `close()`。监听地址可能是 `0.0.0.0` 或 `::`，不等同于用户访问的公网 URL。手动结束完整应用应使用 `internals.shutdown(serverHandle, { skipExit: true })`，单独 `close()` 只处理服务器。

---

## createApp

`createApp()` 是底层工厂函数，创建 `VextApp` 实例和框架内部方法集合。

```typescript
import { createApp, DEFAULT_CONFIG } from "vextjs";

const { app, internals } = createApp(DEFAULT_CONFIG);
app.logger.info("仅创建了基础应用，尚未监听 HTTP");
await internals.shutdown(undefined, { skipExit: true });
```

### 函数签名

```typescript
function createApp(config: VextConfig): {
  app: VextApp;
  internals: AppInternals;
};
```

### 返回值

| 字段        | 类型           | 说明                               |
| ----------- | -------------- | ---------------------------------- |
| `app`       | `VextApp`      | 用户可见的应用实例                 |
| `internals` | `AppInternals` | 启动、开发和测试编排使用的内部方法 |

:::tip
通常不需要直接调用 `createApp()`。`bootstrap()` 和 `createTestApp()` 内部已经封装了完整的初始化流程。只有需要完全自定义启动流程时才使用此函数。
:::

它接收完整的 `VextConfig`，不会替你加载/合并配置、加载插件与服务或启动 HTTP。此时 adapter 尚未解析，fetch 也未挂载为可用客户端；调用者负责后续初始化及资源清理。

---

## VextApp 接口

### 内置模块

#### `app.logger`

结构化日志实例，基于 Vext 内置 logger kernel 实现。

```typescript
logger: VextRuntimeLogger;
```

请求上下文启用且日志发生在其作用域内时，自动携带 `requestId`（通过 AsyncLocalStorage）；启动日志等作用域外日志没有该请求字段。运行时保证提供 `trace()`、`getLevel()` / `setLevel()` 和 `.child()`。

```typescript
// 基本使用
app.logger.info("服务器启动成功");
app.logger.error({ userId: "123" }, "用户查询失败");
app.logger.debug("调试信息");
app.logger.trace("详细排障信息");

// 运行时调整后续日志阈值
app.logger.getLevel(); // 当前配置/运行时设置的级别，默认 "info"
app.logger.setLevel("debug");

// 结构化日志（对象 + 消息）
app.logger.info({ event: "user_created", userId: "abc" }, "用户创建成功");

// 子 logger（携带额外上下文）
const serviceLogger = app.logger.child({ service: "UserService" });
serviceLogger.info("查询用户列表");
// → { service: 'UserService', requestId: '...', msg: '查询用户列表' }
```

**日志级别方法**：

| 方法                | 级别  | 说明                                   |
| ------------------- | ----- | -------------------------------------- |
| `logger.fatal(...)` | fatal | 最高严重级别日志；调用本身不会退出进程 |
| `logger.error(...)` | error | 运行时错误                             |
| `logger.warn(...)`  | warn  | 警告信息                               |
| `logger.info(...)`  | info  | 一般信息（默认级别）                   |
| `logger.debug(...)` | debug | 调试信息                               |
| `logger.trace(...)` | trace | 最细粒度排障信息                       |

各级别均支持消息或对象形式，以下以 info 为例；error/fatal 还接受 Error 对象：

```typescript
// 纯消息
logger.info(msg: string, ...args: unknown[]): void;

// 对象 + 消息
logger.info(obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;

logger.error(err: Error, msg?: string, ...args: unknown[]): void;
logger.fatal(err: Error, msg?: string, ...args: unknown[]): void;
```

**`getLevel()` / `setLevel(level)`**：

```typescript
getLevel(): "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
setLevel(level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent"): void;
```

`setLevel()` 只影响后续日志；已创建的 child logger 与父 logger 共享当前 runtime level。默认 logger 不提供可写的 `app.logger.level` 属性。

**`child(bindings)`**：

```typescript
child(bindings: Record<string, unknown>): VextRuntimeLogger;
```

创建子 logger，携带额外的上下文字段。所有通过子 logger 输出的日志都会自动附加 `bindings` 中的字段。

```typescript
// 在服务中创建专属 logger
import type { VextApp, VextLogger } from "vextjs";

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

#### `app.throw(status, message, paramsOrCode?, codeOrDetails?)`

抛出 HTTP 错误，框架统一转为标准错误响应。支持三种调用形式。

:::info 何时使用 `app.throw()`
`app.throw()` 适用于“我要主动返回一个明确的 HTTP 错误给调用方”的场景，例如 `401`、`404`、`409` 或附带业务错误码的响应。

如果只是发生了未预期的运行时异常，也可以直接 `throw new Error("...")`，框架同样会捕获，但这类错误会进入未知异常路径并最终转成 `500 Internal Server Error`。若需要返回字段级校验详情，则应抛出 `VextValidationError`。
:::

**函数签名**：

```typescript
// 快捷方式（i18n key，status 从 i18n 配置读取，默认 400）
throw(messageKey: string): never;
throw(messageKey: string, params: Record<string, unknown>): never;

// 对象式完整入口
throw(options: {
  status: number;
  message: string;
  params?: Record<string, unknown>;
  code?: number | string;
  details?: unknown;
}): never;

// 标准调用（显式指定 HTTP 状态码）
throw(
  status: number,
  message: string,
  paramsOrCode?: Record<string, unknown> | number | string,
  codeOrDetails?: number | string | Record<string, unknown> | unknown[],
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

当第一个参数为 **数字** 时，它显式指定 HTTP 状态码：

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

// 第四参数为对象或数组时，作为 details 输出
app.throw(
  502,
  "payment.failed",
  { orderId },
  {
    provider: "stripe",
    providerCode: "card_declined",
  },
);

// 同时需要 code + details 时，使用对象式入口
app.throw({
  status: 502,
  message: "payment.failed",
  code: "PAYMENT_FAILED",
  details: { provider: "stripe", providerCode: "card_declined" },
});
```

**标准调用参数**：

| 参数            | 类型                                                       | 说明                                                                |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `status`        | `number`                                                   | HTTP 状态码（400/401/403/404/409/500…）                             |
| `message`       | `string`                                                   | 错误描述（同时作为 i18n key 查找）                                  |
| `paramsOrCode`  | `Record<string, unknown> \| number \| string`              | i18n 插值参数对象或业务错误码                                       |
| `codeOrDetails` | `number \| string \| Record<string, unknown> \| unknown[]` | 第四参数为 number/string 时是业务码；为 object/array 时是 `details` |

`details` 适合放三方接口返回的业务详情，例如上游错误码、原始 message、trace id 或可展示给调用方的字段。框架会在响应前做 JSON-safe 清洗：循环或重复对象引用会变成 `"[Circular]"`，`Date` 输出 ISO 字符串，`Error` 只输出 `name/message`；对象中的函数和 `undefined` 属性会省略，数组中的这些值会替换为 `null`。

推荐通过 `HttpError` 或 `app.throw` 显式提供 details。归一化也会读取普通异常上显式附加的 `details` 字段并清洗，但不会自动把整个异常对象作为详情公开。`hideInternalErrors` 不会过滤任意自定义 details；其他转换与省略边界见 [错误详情排查](/zh/guide/error-handling#details)。

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
  "details": {
    "provider": "stripe",
    "providerCode": "card_declined"
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

:::tip
`app.throw()` 的返回类型为 `never`，运行时会抛错并中断当前流程。TypeScript 对嵌套属性调用的控制流收窄存在限制；例如判断用户不存在时可写 `return this.app.throw(404, "用户不存在")`，让后续代码明确只处理存在的用户。
:::

---

#### `app.config`

最终合并后的运行时配置（只读）。

```typescript
config: Readonly<VextConfig>;
```

标准启动由配置流程加载 `default → 环境配置 → local → bootstrap provider patch → CLI override` 并在最终化时深度冻结；生产不加载 local。直接调用 `createApp(config)` 不会替任意传入对象补做这些步骤。

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/info", {}, async (_req, res) => {
    res.json({
      port: app.config.port,
      adapter: typeof app.config.adapter,
      corsEnabled: app.config.cors.enabled,
    });
  });
});
```

:::warning
标准启动的 `app.config` 在运行时是冻结的，修改会抛错（严格模式）或静默失败。如需应用自有动态状态，可在插件 setup 中用 `app.extend()` 挂载独立对象。
:::

---

#### `app.services`

`service-loader` 注入的所有服务实例。

```typescript
services: VextServices;
```

通过 `app.services.<name>` 访问已加载的服务。正常启动时服务先于路由加载，handler 可以使用已注册的服务；插件 setup 此时尚无全部服务，服务构造函数也不能假定其他服务已实例化。跨服务调用应放到方法或 onReady 中。

```typescript
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  constructor(private app: VextApp) {}

  async findById(id: string) {
    // ...
  }
}

// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", async (req, res) => {
    const user = await app.services.user.findById(req.params.id);
    res.json(user);
  });
});
```

上例展示调用位置，完整业务实现见文末。CLI 的类型生成会为可解析的服务补全 `VextServices`；自定义加载等无法自动生成的场景才手工声明，且应将声明文件纳入 tsconfig：

```typescript
// types/vext.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextServices {
    user: import("../src/services/user.js").default;
  }
}
```

---

#### `app.hooks`

框架生命周期 hook 管理器，用于注册运行期观测、轻量 patch 和跨模块集成逻辑。

```typescript
hooks: VextHooks;

type Off = () => void;

app.hooks.on(name, handler): Off;
app.hooks.has(name): boolean;
```

`app.hooks.on()` 返回注销函数。`app.hooks` 是保留属性，不能通过 `app.extend("hooks", ...)` 覆盖。

```typescript
const off = app.hooks.on("validation:success", ({ req, route }) => {
  app.logger.info(
    { requestId: req.requestId, route: route.path },
    "validated request",
  );
});

app.hooks.on("response:before", ({ headers }) => ({
  headers: { ...headers, "x-powered-by": "vext" },
}));

off(); // 演示注销：之后不再收到 validation:success，另一个监听器仍保留
```

**执行策略**：

| Hook 类型                                                                                                                                                                         | Promise  | 监听器异常                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| `request:start`（matched=true）、`route:matched`、`validation:success`、`handler:before`、`fetch:before`、`proxy:before`、用户 `plugin:beforeSetup`、`server:beforeListen`        | 可 await | 传播并阻止后续步骤         |
| `response:before`、`service:beforeCall`                                                                                                                                           | 不允许   | 传播并阻止后续步骤         |
| `request:start`（404 的 matched=false）、`route:notFound`、`validation:error`、`handler:after/error`、`fetch:after/error`、`proxy:after/error`、`routes:ready`、`app:ready/close` | 可 await | safe：记录异常，继续原流程 |
| `response:after`、`error:beforeResponse/afterResponse`、`service:loaded/reloaded/afterCall/error`、`cache:*`、`plugin:afterSetup/error`、`openapi:*`                              | 不允许   | safe 同步通知              |

表中的 `/` 表示多个事件的缩写，注册时使用完整事件名。内置 MonSQLize 的 `plugin:beforeSetup` 由独立初始化流程 safe 同步触发。safe 不代表不等待异步监听器，也不保证业务本身成功；同步事件禁止返回 Promise。多监听器、patch 和错误边界详见 [Hooks 指南](/zh/guide/hooks#执行策略)。

**可用 hook**：

| 名称                                                      | 触发点                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `request:start`                                           | 全局 request-hook 位置，在请求元数据/requestId/认证上下文之后；404 兜底也触发，`matched=false`      |
| `route:matched`                                           | adapter 匹配路由后、执行校验和 handler 前                                                           |
| `route:notFound`                                          | 没有路由匹配，404 响应发送前                                                                        |
| `validation:success`                                      | 路由 `validate` 全部通过，`next()` 前                                                               |
| `validation:error`                                        | 路由 `validate` 失败，抛出 `VextValidationError` 前                                                 |
| `handler:before`                                          | 业务 handler 调用前                                                                                 |
| `handler:after`                                           | handler 成功返回并等待框架记录的响应发送流程后；流响应等待收束，不等同于客户端确认接收              |
| `handler:error`                                           | 业务 handler 抛错后、进入全局错误处理前                                                             |
| `response:before`                                         | `json/rawJson/text/html/render/stream/download/redirect` 发送前，可同步 patch `data/status/headers` |
| `response:after`                                          | 响应发送后                                                                                          |
| `error:beforeResponse`                                    | `error-handler` 写 JSON 错误响应前，可同步 patch `body/status`                                      |
| `error:afterResponse`                                     | 错误响应发送后                                                                                      |
| `fetch:before`                                            | `app.fetch` 出站前，可修改 `Headers`                                                                |
| `fetch:after`                                             | `app.fetch` 返回 `Response` 后                                                                      |
| `fetch:error`                                             | 实际请求/重试流程因网络错误、超时或取消而终止时；HTTP 错误状态仍通过 `fetch:after` 通知             |
| `proxy:before`                                            | `app.fetch.proxy` 解析上游请求后、发送前                                                            |
| `proxy:after`                                             | `app.fetch.proxy` 收到上游响应后、透传前                                                            |
| `proxy:error`                                             | `app.fetch.proxy` 本地错误、超时或上游网络失败时                                                    |
| `service:loaded`                                          | service 冷启动加载并挂载后                                                                          |
| `service:reloaded`                                        | dev soft reload 重新实例化 service 后                                                               |
| `service:beforeCall`                                      | 框架包装的 service 原型方法调用前；不覆盖实例箭头函数或 getter                                      |
| `service:afterCall`                                       | service 方法成功返回后                                                                              |
| `service:error`                                           | service 方法抛错或 reject 后                                                                        |
| `cache:hit`、`cache:miss`、`cache:write`、`cache:error`   | 路由级响应缓存读写生命周期                                                                          |
| `plugin:beforeSetup`、`plugin:afterSetup`、`plugin:error` | 插件 `setup()` 前后和失败；插件不能观察自己的 `beforeSetup`                                         |
| `routes:ready`                                            | 路由扫描和注册完成后                                                                                |
| `openapi:beforeGenerate`、`openapi:afterGenerate`         | OpenAPI 文档生成前后；`afterGenerate` 可同步替换 document                                           |
| `server:beforeListen`                                     | HTTP server 开始监听前                                                                              |
| `app:ready`                                               | `onReady` 执行前后                                                                                  |
| `app:close`                                               | `onClose`/shutdown 执行前后                                                                         |

`app:ready` / `app:close` 用 `phase: "before" | "after"` 区分两个阶段。监听器只接收注册之后发生的事件，无法回看已完成的内置插件初始化；在 onClose 中注销的监听器也不会再收到关闭的 after 阶段。

:::tip
如果只想记录“参数校验通过后的请求”，使用 `validation:success`。这样校验失败的请求不会进入该 hook，比在普通全局中间件中手动排除 `VextValidationError` 更直接。
:::

---

#### `app.cache`

路由级响应缓存管理 API。在 `createApp` 阶段初始化，提供标签失效、指定 key 删除、清空、统计等操作。

```typescript
cache: {
  invalidate(tag: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): VextCacheStats;
};
```

| 方法              | 说明                                             |
| ----------------- | ------------------------------------------------ |
| `invalidate(tag)` | 按标签批量失效所有关联缓存条目                   |
| `delete(key)`     | 删除指定 key 的缓存                              |
| `clear()`         | 清空当前 vext 响应缓存 namespace 的所有条目      |
| `stats()`         | 返回缓存统计（条目数、命中数、未命中数、命中率） |

```typescript
// defineRoutes 内的片段，商品写入逻辑由应用实现
app.post("/products", {}, async (req, res) => {
  // 先完成商品写入，再失效相关缓存
  await app.cache.invalidate("products");
  res.json({ created: true }, 201);
});

// 查看缓存统计
app.get("/admin/cache-stats", {}, async (req, res) => {
  res.json(app.cache.stats());
});
```

`VextCacheStats` 包含 `entries`、`hits`、`misses`、`hitRate` 及底层统计字段。`app.cache` 是 Vext 对 `response-cache-kit` 的控制面包装；业务代码不需要直接操作底层 Store。Redis/MultiLevel 模式下，`clear()` 不会清空 Redis 全库，只会清理当前 vext 响应缓存 namespace。应用 shutdown 时，Vext 会在用户 `onClose` 钩子执行后关闭响应缓存运行时资源。详见 [响应缓存指南](/zh/guide/cache)。

---

#### `app.db`

框架内置数据库的唯一数据库入口。存在 `config.database` 时，Vext 会把同一个原始 `MonSQLize` 实例
挂载到这里；未配置数据库时，该属性不可用。

```typescript
db?: VextDatabase; // MonSQLize + Vext 补充的只读 client getter
```

`app.db` 不是 facade 或 Proxy，因此可以直接使用完整上游实例能力：
`collection()`、`model()`、`use()`、`pool()`、`scopedModel()`、
`withTransaction()`、`sync()`、事件、诊断和管理方法。Vext v2 不再暴露第二个
`app.monsqlize` 属性。

```typescript
const users = app.db?.collection("users");
const User = app.db?.model("users");
const Invoice = app.db?.use("billing").model("BillingInvoice");
const session = app.db?.client.startSession();
```

Model 注册键是精确键。`use()` 和 `pool()` 只选择数据库或连接池 scope，不会自动
添加 scope 前缀，也不会回落到变换后的键；只有 Model 显式注册 `key` 别名时短名
才有效。优雅关闭时由 Vext 负责清理数据库连接，应用不应在另一个 `onClose` 中再次
关闭 `app.db`。自有 SQL 等资源应使用独立扩展名称，不要覆盖此属性。详见[数据库指南](/zh/guide/database)。

---

#### `app.fetch`

内置 HTTP 客户端，类型为 `VextFetch`。标准启动在用户插件 setup 前挂载，支持出站请求、requestId 传播、结构化日志及代理能力。底层 `createApp()` 单独返回时尚未完成挂载。

```typescript
// 在插件、服务方法或 handler 中，按业务需要发起请求
const response = await app.fetch("https://example.com/api/status");
if (!response.ok) {
  app.throw(502, "上游请求失败");
}
```

调用参数、超时/重试、便捷方法和 `proxy` 见 [Fetch API](/zh/api/fetch)，实际接入流程见 [Fetch 指南](/zh/guide/fetch)。示例 URL 需替换成业务上游。

当前 `defineRoutes` 工厂参数上的 fetch 函数经过绑定，`app.fetch(url, init)` 可调用，但附加的 `get/create/proxy` 等方法未保留。handler 内需要这些方法时使用 `req.app.fetch`；插件 setup 和 Service 中的真实 app 不受影响。

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
// 框架会提示改用路由文件中的 defineRoutes

// ✅ 通过 defineRoutes 注册
export default defineRoutes((app) => {
  app.get("/hello", handler); // OK — 这里的 app 是 collector
});
```

支持**三段式**和**两段式**两种语法。下面的 app 指 `defineRoutes` 的参数；本站完整示例统一用三段式以明确 options 的位置：

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

这些方法应集中在插件 setup 中配置。`app.use()` 有明确的 setup 窗口和锁定检查；不要把这一规则泛化成所有 `set*` 都有同样的运行时检查。插件拿到的是受生命周期约束的上下文，setup 结束后应通过已注册的回调工作，避免异步继续修改该上下文。

#### `app.extend(key, value)`

向 app 挂载自定义属性，通常在插件 setup 中调用。

```typescript
extend<K extends keyof VextApp>(key: K, value: VextApp[K]): void;
extend<K extends string, V>(key: K extends keyof VextApp ? never : K, value: V): void;
```

```typescript
// 在插件中挂载
import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  featureFlags: Map<string, boolean>;
}>();

export default definePlugin({
  name: "feature-flags",
  setup(app) {
    const flags = new Map<string, boolean>([["search", true]]);
    app.extend("featureFlags", flags);
    app.onClose(() => flags.clear());
  },
});
```

`defineAppExtensions` 提供显式静态声明，CLI 类型生成后可获得 `app.featureFlags` 的类型。自定义加载且无法自动生成时，可手工做模块扩展；不要对同一属性同时维护互相冲突的声明：

```typescript
// types/vext.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextApp {
    featureFlags: Map<string, boolean>;
  }
}

// 业务文件中：app.featureFlags.get("search")
```

键必须是非空的合法 JavaScript 标识符，不能使用框架保留键、遮蔽继承属性或覆盖已有属性。重复 `extend` 不会覆盖前值。已有声明的键还会检查 value 类型；类型声明本身不会创建运行时属性。

---

#### `app.use(middleware)`

注册全局 HTTP 中间件（**插件专用**）。

```typescript
use(middleware: VextMiddleware): void;
```

对所有路由生效，在路由级 middlewares 之前执行。只能在插件 `setup()` 中调用，路由注册完成后调用将抛出错误。

```typescript
import { definePlugin, securityHeaders } from "vextjs";

export default definePlugin({
  name: "security",
  setup(app) {
    app.use(securityHeaders({ preset: "strict" }));
  },
});
```

应用级浏览器安全响应头请优先使用 `config.securityHeaders`，因为它也覆盖错误响应、404、测试辅助和 dev soft reload。手动 `app.use(securityHeaders())` 是局部插件入口。

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

默认使用 `schema-dsl`。下面以 Zod 为例：先在应用中安装 `npm install zod`，再添加此插件。Vext 的 compile/校验函数是同步接口，不支持需要 `safeParseAsync()` 的异步 refinement/transform。Zod 基础用法见 [官方文档](https://zod.dev/basics)。

```typescript
import { definePlugin } from "vextjs";
import { z } from "zod";

export default definePlugin({
  name: "zod-validator",
  setup(app) {
    const originalValidator = app.getValidator();

    app.setValidator({
      compile(schema) {
        const toVextResult = (result: ReturnType<z.ZodType["safeParse"]>) =>
          result.success
            ? { valid: true, data: result.data }
            : {
                valid: false,
                errors: result.error.issues.map((issue) => ({
                  field: issue.path.join("."),
                  message: issue.message,
                })),
              };

        if (schema instanceof z.ZodType) {
          return (data) => toVextResult(schema.safeParse(data));
        }

        const fields = Object.entries(schema);
        const zodFields = fields.filter(
          ([, value]) => value instanceof z.ZodType,
        );
        if (zodFields.length > 0 && zodFields.length !== fields.length) {
          throw new Error("同一个字段对象不能混用 Zod 与 schema-dsl 定义");
        }
        if (zodFields.length > 0) {
          const zodShape = Object.fromEntries(zodFields) as Record<
            string,
            z.ZodType
          >;
          const zodSchema = z.object(zodShape);
          return (data) => toVextResult(zodSchema.safeParse(data));
        }

        return originalValidator.compile(schema);
      },
    });
  },
});
```

直接调用 compile 时，按公开 `Record<string, unknown>` 签名使用字段对象：全部字段为 Zod 时交给 Zod，纯 DSL 定义交给原引擎，混合字段在编译阶段报错，避免静默漏校验。适配器还保留收到完整 Zod schema 时的运行时处理分支。替换引擎只影响之后的 compile 调用，已缓存的校验函数不会自动重新编译。

`setValidator()` 不会扩展 `RouteOptions.validate` 的公开类型，当前直接把 Zod 字段放入路由 validate 会产生类型错误。下面演示公开接口支持的服务输入校验；HTTP 路由可继续使用 DSL 字段，由此插件回退到原引擎。不要把运行时兼容误认为已经具备路由类型推导支持。

```typescript
// 使用上述插件的应用：src/services/message.ts
import { VextValidationError, type VextApp, type VextValidator } from "vextjs";
import { z } from "zod";

export default class MessageService {
  private validate: ReturnType<VextValidator["compile"]>;

  constructor(app: VextApp) {
    this.validate = app.getValidator().compile({ name: z.string().min(1) });
  }

  async accept(input: unknown) {
    const result = this.validate(input);
    if (!result.valid) {
      throw new VextValidationError(result.errors ?? []);
    }
    return result.data;
  }
}
```

---

#### `app.getValidator()`

获取当前全局校验引擎实例。

```typescript
getValidator(): VextValidator;
```

默认 validator 基于 schema-dsl 实现。插件可以通过 `app.setValidator()` 将其替换为 Zod、Yup 等实现，因此 `getValidator()` 不等同于固定的 schema-dsl，而是始终返回当前生效的 validator。

```typescript
const validator = app.getValidator();
const validate = validator.compile({ name: "string:1-50" });
const result = validate({ name: "Alice" });
// { valid: true, data: { name: 'Alice' } }
```

service 中处理非 HTTP 输入时也可以复用它：

```typescript
import { VextValidationError, type VextApp, type VextValidator } from "vextjs";

export default class UserService {
  private validateCreateUser: ReturnType<VextValidator["compile"]>;

  constructor(private app: VextApp) {
    this.validateCreateUser = app.getValidator().compile({
      name: "string:1-50!",
      email: "email!",
    });
  }

  async createFromMessage(input: unknown) {
    const result = this.validateCreateUser(input);
    if (!result.valid) {
      throw new VextValidationError(result.errors ?? []);
    }
    return result.data;
  }
}
```

---

#### `app.setThrow(wrapper)`

包装或替换 `app.throw` 的实现（**插件专用**）。

```typescript
setThrow(wrapper: (original: VextApp['throw']) => VextApp['throw']): void;
```

接收原始 `throw` 实现，返回保持所有重载及 `never` 语义的新实现。下例增加调用日志并原样转发参数；不能只包装四个位置参数，否则会破坏 i18n 快捷方式和对象式调用。响应体结构仍由错误处理器决定。

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "error-tracking",
  setup(app) {
    const logger = app.logger;
    app.setThrow(
      (originalThrow) =>
        new Proxy(originalThrow, {
          apply(target, thisArg, args) {
            logger.debug("app.throw called");
            return Reflect.apply(target, thisArg, args);
          },
        }),
    );
  },
});
```

---

#### `app.setLogger(wrapper)`

包装或替换 `app.logger` 的实现（**插件专用**）。

```typescript
setLogger(wrapper: (original: VextRuntimeLogger) => VextLoggerLike): void;
```

接收完整运行时 logger，返回完整或部分新 logger。未返回的方法回退到原始 logger；不自定义 child 时，框架会对原始子 logger 重新应用 wrapper，保留 bindings 和包装行为。wrapper 可能执行多次，不要在工厂中重复创建连接。

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "info-log-counter",
  setup(app) {
    let infoCalls = 0;
    const logger = app.logger;
    app.setLogger((original) => ({
      info(...args: unknown[]) {
        infoCalls += 1;
        Reflect.apply(original.info, original, args);
      },
    }));
    app.onClose(() => logger.info({ infoCalls }, "info 调用次数"));
  },
});
```

:::tip
上例统计包装后的 info 调用次数，不等于最终写出条数（仍受级别过滤等影响）。转发外部日志系统时，应使用该系统实际的客户端，并处理缓冲和关闭；不要显式返回 `child: bindings => original.child(bindings)` 后又假定子 logger 仍自动经过你的转发方法。
:::

---

#### `app.setRateLimiter(limiter)`

替换全局速率限制实现（**插件专用**）。

```typescript
setRateLimiter(limiter: VextRateLimiter): void;
```

调用此方法只替换实现，**不会启用限流**。需同时配置 `rateLimit.enabled: true`。默认实现基于 `flex-rate-limit`，已支持 Redis store；仅需要共享限流存储时，优先使用 [限流配置](/zh/guide/rate-limit)。

下面是对接应用自有实现的片段：`src/shared/rate-limiter.ts` 需由应用提供并导出满足 `VextRateLimiter` 的对象，其连接也由应用负责关闭。

```typescript
import { definePlugin } from "vextjs";
import { distributedLimiter } from "../shared/rate-limiter.js";

export default definePlugin({
  name: "custom-rate-limit",
  setup(app) {
    app.setRateLimiter(distributedLimiter);
  },
});
```

**VextRateLimiter 接口**：

```typescript
interface VextRateLimiter {
  check(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number; // 重置时刻的绝对 Unix 时间戳，单位秒
  }>;
}
```

`resetAt` 不是毫秒，也不是剩余秒数。中间件会用它计算 `RateLimit-Reset` 和超限时的 `Retry-After` 剩余秒数。自定义 `check` 只收到 key，不接收路由的 max/window；因此其配额策略必须由应用自行保证，不能假定自动继承每条路由的额度。路由是否关闭限流、key 的生成及响应头仍由框架中间件处理，其中 `RateLimit-Limit` 来自有效配置。

---

#### `app.setRequestIdGenerator(generate)`

覆盖 requestId 生成算法（**插件专用**）。

```typescript
setRequestIdGenerator(generate: () => string): void;
```

默认使用 `crypto.randomUUID()`。仅在未取得非空入站 requestId 时调用生成器；优先级为插件设置的生成器、`config.requestId.generate`、默认 UUID。禁用 requestId 时不调用。

```typescript
import { definePlugin } from "vextjs";
import { randomUUID } from "node:crypto";

export default definePlugin({
  name: "prefixed-request-id",
  setup(app) {
    app.setRequestIdGenerator(() => `api-${randomUUID()}`);
  },
});
```

也可通过配置文件静态设置：

```typescript
// src/config/default.ts
import { randomUUID } from "node:crypto";

export default {
  requestId: {
    generate: () => `api-${randomUUID()}`,
  },
};
```

生成值和透传头均须为 1–512 个字符的字符串，不能含控制字符，否则会抛错。需要 Nano ID、Snowflake 等算法时，安装并接入对应实现即可；该接口不会自动创建 APM trace。

---

### 生命周期钩子

#### `app.onReady(handler)`

注册就绪钩子，标准 HTTP 启动在监听开始后执行。应在就绪流程开始前注册；测试等自定义编排的执行时机由调用者控制。

```typescript
onReady(handler: () => Promise<void> | void): void;
```

适用于：预热缓存、检查外部依赖、打印启动信息等。

```typescript
const logger = app.logger;
app.onReady(async () => {
  // warmupCache 是应用提供的预热函数
  await warmupCache();
  logger.info("缓存预热完成");
});

app.onReady(() => {
  logger.info("应用已完成初始化");
});
```

**执行规则**：

- 所有 `onReady` 钩子按注册顺序**依次执行**（非并行）
- 执行完毕后自动清空 hooks 数组，释放闭包引用
- 钩子中抛出的错误会被捕获并记录日志，不影响服务运行
- 就绪开始后再注册会抛错；返回永不结束的 Promise 会阻塞后续就绪步骤
- 服务已经开始监听，因此必须完成后才能接流量的初始化应放在此前的 setup 等阶段

---

#### `app.onClose(handler)`

注册关闭钩子，标准关闭按 **LIFO** 顺序执行。SIGTERM/SIGINT、手动 shutdown，以及初始化失败清理都可能进入关闭流程。用户插件 setup 失败或超时时，会回滚本次 setup 登记的关闭钩子；插件必须自行释放该次初始化创建的外部资源，不能依赖这些被回滚的钩子。此前已成功初始化的资源仍由各自的关闭逻辑清理，详见 [插件生命周期](/zh/guide/plugins)。

```typescript
onClose(handler: () => Promise<void> | void): void;
```

适用于：关闭应用自有连接、刷新日志缓冲区、取消定时任务等。内置数据库插件会自动关闭 `app.db`。

```typescript
// 插件内的资源清理片段，定时器由本插件创建
const healthCheckTimer = setInterval(() => {}, 30_000);
app.onClose(() => {
  clearInterval(healthCheckTimer);
});

// 自有 Redis 连接可注册 async () => { await redis.quit(); }
// redis 应由本插件创建或按约定取得，避免重复关闭共享资源
```

**执行规则**：

- 按 **LIFO**（后进先出）顺序执行 —— 后注册的钩子先执行
- 每个钩子独立 try/catch，单个钩子失败不影响其他钩子
- 执行完毕后自动清空 hooks 数组，释放资源引用
- shutdown 开始后不能继续注册；全部关闭步骤共享一个 `shutdown.timeout` 期限，超时不会无限等待某个回调

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

`createApp()` 返回的内部方法集合，由框架启动、开发模式和测试编排使用。普通业务代码应使用公开生命周期接口；自行编排时必须承担初始化与清理责任。

```typescript
interface AppInternals {
  lockUse(): void;
  enterPluginSetup(): void;
  exitPluginSetup(): void;
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

| 方法                                       | 说明                                     |
| ------------------------------------------ | ---------------------------------------- |
| `lockUse()`                                | 锁定 `app.use()`，路由注册完成后调用     |
| `enterPluginSetup()` / `exitPluginSetup()` | 进入/退出允许注册全局中间件的 setup 窗口 |
| `runReady()`                               | 执行所有 `onReady` 钩子                  |
| `getGlobalMiddlewares()`                   | 获取全局中间件列表                       |
| `getRateLimiter()`                         | 获取自定义速率限制器                     |
| `getRequestIdGenerator()`                  | 获取自定义 requestId 生成器              |
| `shutdown()`                               | 触发优雅关闭流程                         |

### shutdown 流程

```typescript
async shutdown(
  serverHandle?: VextServerHandle,
  options?: { skipExit?: boolean },
): Promise<void>;
```

1. **防重复**：进行中的关闭共享同一个 Promise；已关闭时重复调用直接完成。
2. **整体期限**：从关闭开始建立 `config.shutdown.timeout`（秒）的单一绝对期限，先发出 `app:close` 的 before 通知。
3. **服务器**：有 serverHandle 时停止接受新请求并等待飞行中请求完成。
4. **清理**：LIFO 执行 `onClose`，再关闭响应缓存、发送 `app:close` after 通知，最后关闭 logger。
5. **超时与退出**：期限到达后仍调用尚未启动的清理，但不再无限等待。正常完成时退出 0；`_testMode` 或 `skipExit` 跳过退出。服务器关闭失败会在其他清理后向调用方抛出，信号处理器将其作为退出 1 处理，不能把所有关闭都理解为成功退出。

---

## DEFAULT_CONFIG

框架内置默认配置常量，可用于参考或快速启动：

```typescript
import { DEFAULT_CONFIG } from "vextjs";
```

完整内容参见 [配置 API — DEFAULT_CONFIG](/zh/api/config)。

---

## setupShutdown

独立的信号处理注册函数，`bootstrap` 内部自动调用。

```typescript
import { setupShutdown } from "vextjs";

const cleanupSignals = setupShutdown({
  internals,
  serverHandle,
  logger: app.logger,
  testMode: app.config._testMode,
});
```

上例是自定义启动编排片段，`internals`、`serverHandle`、`app` 来自已有启动过程。不要在标准 bootstrap 之后重复注册。函数返回 `cleanupSignals()` 用于移除本次监听；它本身不会关闭服务器或资源。测试模式不注册信号；有 IPC 通道时也监听 shutdown 消息以支持 Windows 子进程关闭。

---

## 辅助工厂函数

### definePlugin

创建 `VextPlugin` 的推荐方式。扩展属性的静态声明使用 `defineAppExtensions`，参见 [插件 API](/zh/api/plugin-api)。

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

创建路由文件的核心函数。参见 [路由定义](/zh/api/route-definition)。

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/hello", {}, async (_req, res) => {
    res.json({ message: "Hello!" });
  });
});
```

### defineMiddleware / defineMiddlewareFactory

创建中间件的辅助函数。下列是两个独立文件的示意，单个文件只保留一个默认导出。参见 [插件 API](/zh/api/plugin-api#definemiddleware)。

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
  VextRuntimeLogger,
  VextLoggerLike,
  VextCacheStats,
  VextFetch,
  VextHooks,
  VextRateLimiter,
  VextValidator,
} from "vextjs";

import type { AppInternals, BootstrapResult } from "vextjs";
```

---

## 完整使用示例

这个例子用插件提供内存存储、服务处理用户逻辑、路由读取校验结果，展示 app 各模块如何协作。它不需要数据库或第三方插件；数据随进程退出丢失，接口公开，生产的持久化与权限应按对应指南接入。

以 [快速开始](/zh/guide/quick-start) 的 TypeScript 项目为基础，保留 dev/build/start scripts 和 `.vext/types` 的 tsconfig include。以下四个文件构成独立示例，不要叠加同名 user 服务或 users 路由。

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: "native",
  frontend: { enabled: false },
  logger: { level: "info" },
} satisfies VextUserConfig;
```

### 插件开发

```typescript
// src/plugins/demo-users.ts
import { defineAppExtensions, definePlugin } from "vextjs";

export type DemoUser = { id: string; name: string; email: string };

export const appExtensions = defineAppExtensions<{
  demoUsers: Map<string, DemoUser>;
}>();

export default definePlugin({
  name: "demo-users",
  setup(app) {
    const users = new Map<string, DemoUser>([
      ["1", { id: "1", name: "Alice", email: "alice@example.com" }],
    ]);
    const logger = app.logger;
    app.extend("demoUsers", users);
    app.onReady(() => {
      logger.info({ count: users.size }, "用户存储已就绪");
    });
    app.onClose(() => {
      users.clear();
      logger.info({ count: users.size }, "用户存储已清理");
    });
  },
});
```

### 服务开发

```typescript
// src/services/user.ts
import { randomUUID } from "node:crypto";
import type { VextApp } from "vextjs";

export default class UserService {
  constructor(private app: VextApp) {}

  async findAll({ page, limit }: { page: number; limit: number }) {
    return [...this.app.demoUsers.values()].slice(
      (page - 1) * limit,
      page * limit,
    );
  }

  async findById(id: string) {
    const user = this.app.demoUsers.get(id);
    if (!user) {
      return this.app.throw(404, "用户不存在");
    }

    return user;
  }

  async create(data: { name: string; email: string }) {
    const existing = [...this.app.demoUsers.values()].some(
      (user) => user.email === data.email,
    );
    if (existing) {
      return this.app.throw(409, "邮箱已注册", 10001);
    }

    const user = { id: randomUUID(), ...data };
    this.app.demoUsers.set(user.id, user);
    return user;
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
      },
    },
    async (req, res) => {
      const { page = 1, limit = 20 } = req.valid("query");
      const users = await app.services.user.findAll({ page, limit });
      res.json(users);
    },
  );

  app.get(
    "/:id",
    {
      validate: { param: { id: "string:1-!" } },
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
        body: { name: "string:1-50!", email: "email!" },
      },
      docs: { summary: "创建用户" },
    },
    async (req, res) => {
      const user = await app.services.user.create(req.valid("body"));
      res.json(user, 201);
    },
  );
});
```

### 运行与观察

```bash
npm run dev
```

CLI 会生成扩展/服务类型；看到 ready 和监听地址后，在另一个终端请求。插件在 onReady 记录初始 count=1，CLI 的启动摘要可能收起该阶段日志，以实际请求结果确认可用性：

```bash
curl -i http://127.0.0.1:3000/users/list
curl -i http://127.0.0.1:3000/users/1
curl -i http://127.0.0.1:3000/users/missing
curl -i "http://127.0.0.1:3000/users/list?page=0"
curl -i -X POST http://127.0.0.1:3000/users/ -H "Content-Type: application/json" -d '{"name":"Bob","email":"bob@example.com"}'
```

前两个请求返回 200，第三个返回 404，第四个校验失败返回 422；创建返回 201，再提交同一邮箱返回 409 且业务 code 为 10001，省略 name 或 email 返回 422。成功数据位于 `data`；列表默认 page=1、limit=20。Windows PowerShell 的 GET 使用 `curl.exe`；创建可用：

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/users/' -ContentType 'application/json' -Body '{"name":"Bob","email":"bob@example.com"}'
```

Ctrl+C 后应看到“用户存储已清理”且 count 为 0。再运行 `npm run build` 和 `npm start`，重复请求，验证构建后的入口；若已有终端占用 3000，先结束示例进程或修改端口及请求地址。不同进程各有独立内存数据。

遇到属性类型缺失，先确认 CLI 类型生成输出及 tsconfig 是否包含 `.vext/types/**/*.d.ts`；遇到业务路由 404，检查文件目录和 `/users` 前缀。继续阅读 [服务](/zh/guide/services)、[插件](/zh/guide/plugins)、[数据库](/zh/guide/database) 和 [安全指南](/zh/guide/security) 以扩展实际应用。

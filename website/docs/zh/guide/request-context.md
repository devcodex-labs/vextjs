# 请求上下文 (Request Context)

`requestContext` 用于在同一请求的调用链中共享少量数据，例如 requestId、语言、认证快照。VextJS 的 Adapter 默认为每个入站请求建立独立的 `AsyncLocalStorage` 作用域；在这个作用域中调用的中间件、handler 和 Service 可以直接读取数据。

它按异步调用链关联数据，不按类或模块关联。Service 构造函数、插件 setup 等启动代码通常没有请求上下文；业务鉴权、数据库过滤和跨进程传输仍需由对应功能完成。

## 先运行一个并发示例

前置：完成[快速开始](/zh/guide/quick-start)中「方式二：手动创建」的 TypeScript API-only 项目，保留其 package.json、tsconfig.json 和启动脚本。下面合并配置，并新增三个文件；没有数据库、外部服务或认证插件依赖。

```typescript
// src/config/default.ts
export default {
  port: 3000,
  host: "127.0.0.1",
  frontend: { enabled: false },
  logger: { level: "info", pretty: false },
  requestContext: { enabled: true },
  locale: { default: "en-US", supported: ["en-US", "zh-CN"] },
  fetch: { propagateHeaders: ["x-demo-tag"] },
};
```

```typescript
// src/types/request-context.d.ts
import "vextjs";

declare module "vextjs" {
  interface RequestContextStore {
    demoLabel?: string;
  }
}
```

```typescript
// src/services/context.ts
import { setImmediate } from "node:timers/promises";
import { requestContext, type VextApp } from "vextjs";

export default class ContextService {
  constructor(private readonly app: VextApp) {}

  async inspect() {
    const before = requestContext.getStore()?.requestId;
    await setImmediate();
    const store = requestContext.getStore();
    if (!store) this.app.throw(500, "Request context is unavailable");
    this.app.logger.info({ demoLabel: store.demoLabel }, "context inspected");
    return {
      before,
      after: store.requestId,
      locale: store.locale,
      demoLabel: store.demoLabel,
      forwardedTag: store.propagatedHeaders?.["x-demo-tag"],
      authenticated: store.auth?.isAuthenticated ?? false,
    };
  }
}
```

```typescript
// src/routes/context.ts
import { defineRoutes, requestContext } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", async (req, res) => {
    const store = requestContext.getStore();
    if (!store) return app.throw(500, "Request context is unavailable");
    const label = req.headers["x-demo-label"];
    store.demoLabel = (Array.isArray(label) ? label[0] : label) ?? "unlabeled";
    res.json(await app.services.context.inspect());
  });
});
```

`demoLabel` 是用于观察隔离的普通输入，不参与身份或权限判断。运行 `npm run dev`；开发启动会生成 Service 类型映射。另开终端，在项目根目录用 Node 执行以下完整命令：

```bash
node --input-type=module -e 'const rows = await Promise.all(["a", "b"].map(async label => { const response = await fetch("http://127.0.0.1:3000/context", { headers: { "x-request-id": "req-" + label, "x-demo-label": label, "x-demo-tag": "tag-" + label, "accept-language": label === "a" ? "zh-CN" : "en-US" } }); return { status: response.status, requestId: response.headers.get("x-request-id"), body: await response.json() }; })); console.log(JSON.stringify(rows, null, 2));'
```

两项都应为 200。第一项 `body.data` 的 before/after 均为 `req-a`，locale 为 `zh-CN`、demoLabel 为 `a`、forwardedTag 为 `tag-a`、authenticated 为 false；第二项对应 `req-b`、`en-US`、`b`、`tag-b`、false。响应头 requestId 与各自数据一致，服务端 JSON 日志的 `requestId` 也应分别对应两个请求。

去掉 `x-request-id` 后会生成 ID；去掉语言头后使用配置默认语言。停止开发服务，再执行 `npm run build`、`npm start`，重复请求应得到相同的隔离结果。结束后用 Ctrl+C 停止服务。

:::tip 观察日志
本例使用 `pretty: false` 便于查看完整 JSON。默认 pretty 输出会忽略 `requestId` 的显示，终端没显示该字段不一定代表上下文丢失。
:::

## 核心概念

### 什么是 AsyncLocalStorage？

Node.js 是单线程事件循环，但同时处理多个并发请求。传统的全局变量方式（如 `global.currentRequestId`）会被后到的请求覆盖，导致竞态问题。

`AsyncLocalStorage` 为每个异步执行上下文维护独立的存储空间，即使在并发场景下也能安全隔离数据：

```
请求 A（requestId: "aaa"）─┐
                           ├─ 并发执行，互不干扰
请求 B（requestId: "bbb"）─┘

请求 A 中调用 requestContext.getStore() → { requestId: "aaa" }
请求 B 中调用 requestContext.getStore() → { requestId: "bbb" }
```

### 生命周期

```text
Adapter 收到请求（requestContext.enabled 不为 false）
  → run(新 store, callback)：初始化 requestId、locale、auth 快照
  → 请求元数据中间件：写入 locale 和选定的入站头
  → requestId 中间件（启用时）：生成或读取 ID
  → 认证上下文同步、其他中间件和 handler
  → 在链内创建的普通 Promise/计时器仍可访问该 store
```

请求结束不代表 store 立即清空；其可回收时间与关联异步资源和引用的生命周期有关。不要为每个请求调用全局 `requestContext.disable()`，否则会影响其他请求。详见 [Node.js AsyncLocalStorage 文档](https://nodejs.org/download/release/v20.19.0/docs/api/async_context.html#class-asynclocalstorage)。

`requestContext.enabled: false` 会跳过框架自动建立 HTTP 作用域；`requestId.enabled: false` 只关闭 ID 生成/响应头，正常启用的上下文仍有 locale 和配置的入站头快照。手动 `run()` 不受前一个开关禁止，且在手动外层作用域中调用代码仍可能读到该外层 store。

## 基本用法

### 读取 requestId

在请求链中需要显式关联业务记录时，读取当前 store。不要在模块初始化时保存一次 store，再供所有请求使用。

```typescript
import { requestContext } from "vextjs";

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
```

通常默认 `app.logger` 和 `app.fetch` 已自动读取 ID；显式返回给业务系统时才需要上述访问。请求 ID 是关联标识，来自入站头时不保证全局唯一，也不能用作用户身份。

### 读取 locale

独立的请求元数据中间件根据 `Accept-Language`、`locale.supported` 和 `locale.default` 写入 locale，不依赖是否启用 requestId。没有匹配时使用配置默认语言；框架默认是 `en-US`。

```typescript
import { requestContext } from "vextjs";

export function currentLocale(): string | undefined {
  return requestContext.getStore()?.locale;
}
```

`app.throw()` 的默认错误实现使用当前 app 的语言目录和适用的请求 locale。若 store 属于另一个 app，不会借用其请求语言；手动创建的 store 没有自动执行 HTTP 元数据和认证中间件。语言目录和错误翻译见[国际化](/zh/guide/i18n)与[错误处理](/zh/guide/error-handling)。

## RequestContextStore 类型

以下是公开字段概览；使用时从 `vextjs` 导入 `RequestContextStore`。字段均可选，因为用户可手动创建只含部分信息的 store。

```typescript
import type { VextAuthContextSnapshot } from "vextjs";

interface RequestContextStore {
  requestId?: string;
  locale?: string;
  propagatedHeaders?: Record<string, string>;
  auth?: VextAuthContextSnapshot;
  traceId?: string;
  spanId?: string;
}
```

| 字段                 | 写入者                           | 用途与边界                                                                                                      |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `requestId`          | Adapter 初始化、requestId 中间件 | 日志及出站关联；禁用 ID 时通常为空字符串                                                                        |
| `locale`             | 请求元数据中间件                 | 当前请求语言，可由业务在当前链内更新                                                                            |
| `propagatedHeaders`  | 请求元数据中间件                 | 按 `config.fetch.propagateHeaders` 捕获，键小写；数组头取首值                                                   |
| `auth`               | Adapter 初始化、认证上下文同步   | `req.auth` 的快照，提供 isAuthenticated、subject、userId、roles、scopes、scheme、provider；不包含 claims 或凭证 |
| `traceId` / `spanId` | 用户的 tracing 集成              | 默认 logger 分别映射为 `trace_id` / `span_id`；框架不会自行创建 tracing span                                    |

当前调用链返回同一个可变 store 对象；`getStore()` 不会复制或冻结它。修改 `store.auth` 不等同于认证成功，也不会替代路由鉴权。需要完整认证状态时使用 `req.auth`，参见[安全指南](/zh/guide/security)。

## 高级用法

### 在中间件中写入自定义数据

前面的路由已经演示写入 `demoLabel`。若多条路由需要相同逻辑，可移入中间件。以下文件复用前面的类型扩展：

```typescript
// src/middlewares/context-label.ts
import { defineMiddleware, requestContext } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  const store = requestContext.getStore();
  const label = req.headers["x-demo-label"];
  if (store) {
    store.demoLabel = (Array.isArray(label) ? label[0] : label) ?? "unlabeled";
  }
  await next();
});
```

文件存在不会自动执行。按[中间件指南](/zh/guide/middleware)先在 `config.middlewares` 声明 `context-label`，再由需要它的路由 `middlewares` 引用；需要全局执行时，在插件中导入该中间件并用 `app.use()` 挂载。启用后可删除前面路由里重复的写入语句。业务 Service 在每次方法调用中读取 store，而不是缓存到单例的实例属性。

### 扩展 Store 类型

在前面的 `src/types/request-context.d.ts` 中增加字段。文件开头保留 `import "vextjs"`，使声明扩展已有模块；并确保 tsconfig 的 include 覆盖此文件。

```typescript
// 合并到 src/types/request-context.d.ts，不必另建第二份声明
import "vextjs";

declare module "vextjs" {
  interface RequestContextStore {
    demoLabel?: string;
    tenantId?: string;
    startTime?: number;
  }
}
```

之后 `requestContext.getStore()?.tenantId` 为 `string | undefined`，无需 `as any`。认证字段优先读取 `store.auth`，不要另建同名 userId/roles 真相源。

### 多租户数据隔离

上下文可携带**已经验证过归属关系**的 tenantId，但不会执行授权或自动改写数据库查询。直接把 `x-tenant-id` 放进 store，再用于数据库过滤，允许调用者选择任意租户，不构成隔离。

业务流程应是：

1. 通过认证中间件确定当前用户。
2. 验证该用户是否有权访问所选租户，失败时拒绝请求。
3. 将通过验证的 tenantId 写入当前 store。
4. 每次读、更新、删除和插入都显式使用该租户；缺少 tenantId 时拒绝执行。

下面是供已有授权流程调用的业务工具，放在 `src/utils`，避免被 Service 扫描器当作服务类加载。它只负责查询条件，**不完成第 1、2 步授权**：

```typescript
// src/utils/tenant-filter.ts
import { requestContext } from "vextjs";

export function tenantFilter(
  filter: Record<string, unknown> = {},
): Record<string, unknown> {
  const tenantId = requestContext.getStore()?.tenantId;
  if (!tenantId) throw new Error("Verified tenant context is required");
  return { ...filter, tenantId };
}
```

最后写入的 tenantId 覆盖调用方 filter 中的同名值。数据库接入和 CRUD 示例见[数据库指南](/zh/guide/database)；业务仍需覆盖所有查询路径，不能把本工具当作自动隔离插件。

### 性能追踪

以下中间件依赖上一节的 `startTime` 类型声明，也需要显式挂载。计量对象是 `await next()` 的执行耗时，包含其下游中间件与 handler；不代表网络数据已全部发给客户端。

```typescript
// src/middlewares/performance.ts
import { defineMiddleware, requestContext } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  const store = requestContext.getStore();
  if (store) store.startTime = performance.now();

  try {
    await next();
  } finally {
    const startTime = store?.startTime;
    if (startTime !== undefined) {
      const duration = Math.round(performance.now() - startTime);
      req.app.logger.info(
        { url: req.url, method: req.method, duration },
        "middleware chain finished",
      );
    }
  }
});
```

`finally` 使下游抛错时也能记录；`!== undefined` 不会漏掉值为 0 的起点。访问日志的配置参见[Access Log API](/zh/api/access-log)；流式响应生命周期参见[Hooks](/zh/guide/hooks)。

### 在异步任务中保持上下文

请求链中创建的原生 Promise、`setTimeout`、`setImmediate` 通常会延续当前上下文；前面的 Service 已验证一次异步等待后的 ID。下面是独立的语言机制示例：

```typescript
import { setTimeout as delay } from "node:timers/promises";
import { requestContext } from "vextjs";

export async function inspectAsyncContext() {
  return requestContext.run({ requestId: "async-demo" }, async () => {
    return Promise.all(
      [1, 2].map(async () => {
        await delay(1);
        return requestContext.getStore()?.requestId;
      }),
    );
  });
}
// await inspectAsyncContext() 得到 ["async-demo", "async-demo"]
```

跨 Worker、跨进程和队列消费者不会自动继承入站 HTTP store；需要显式传递选定的数据，再在执行端创建作用域。一个在请求内创建的计时器可能在响应后仍读到原 store，不能仅凭“它是定时任务”判断上下文一定不存在。

自定义 thenable、回调库、在另一条链中触发的事件可能丢失或使用不同上下文。排查时在边界前后检查 `getStore()`；必要时按 [Node 官方上下文丢失说明](https://nodejs.org/download/release/v20.19.0/docs/api/async_context.html#troubleshooting-context-loss)使用原生 Promise 或 `AsyncResource`。

### 手动创建请求上下文

以下是可供现有任务入口调用的函数；不是新增一个会自动执行的任务。它依赖已初始化的 `app`，不依赖额外业务 Service：

```typescript
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { requestContext, type VextApp } from "vextjs";

export async function runBackgroundTask(app: VextApp) {
  return requestContext.run(
    { requestId: `task-${randomUUID()}`, locale: "zh-CN" },
    async () => {
      await setImmediate();
      app.logger.info("background task started");
      return requestContext.getStore()?.requestId;
    },
  );
}
```

`run()` 返回回调的返回值，异步回调返回 Promise，因此调用方应 `await`。手动 run 只建立存储作用域，不执行 HTTP 中间件，不自动补充 auth、捕获请求头或调度任务；[Jobs 指南](/zh/guide/jobs)负责任务的发现、执行与队列。

## 与框架内置功能的关系

| 功能               | 使用的信息                   | 当前行为                                                                                            |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| 默认 `app.logger`  | requestId、traceId、spanId   | 自动关联日志；关闭框架 requestContext 配置也会关闭默认 logger 的 ALS 读取，自定义 logger 需自行接入 |
| `app.fetch`        | requestId、propagatedHeaders | ID 使用 `config.requestId.header` 指定的头名；已显式设置的出站头优先                                |
| 默认 `app.throw()` | locale 与 app 语言目录       | 选择当前 app 可用的语言；重设 throw 实现时由自定义实现负责                                          |
| 认证中间件         | `req.auth`                   | 同步精简快照到 store.auth；授权仍基于认证流程和路由规则                                             |

默认访问日志也通过 logger 的上下文读取关联 requestId。若只有某个 Service 丢失 ID，应继续检查该方法所在的异步调用链。

## requestContext API

### requestContext.getStore()

返回当前作用域中的 `RequestContextStore` 引用；没有作用域时返回 `undefined`。它也可能来自用户手动 run，因此“有 store”并不等于“正在处理 HTTP 请求”。

```typescript
import { requestContext } from "vextjs";

export function inspectStore() {
  return requestContext.getStore();
}
// 返回类型：RequestContextStore | undefined
```

### requestContext.run(store, callback)

在指定 store 下执行回调并返回结果。嵌套 run 不会合并 store 字段，回到外层后恢复外层作用域；回调中的异常或 Promise 拒绝应由调用方处理。

```typescript
import { requestContext } from "vextjs";

export function inspectNestedStore() {
  return requestContext.run({ requestId: "outer" }, () => {
    const inner = requestContext.run({ requestId: "inner" }, () => {
      return requestContext.getStore()?.requestId;
    });
    return { inner, restored: requestContext.getStore()?.requestId };
  });
}
// inspectNestedStore() 得到 { inner: "inner", restored: "outer" }
```

默认 HTTP 请求由 Adapter 建立作用域，通常不用手动 run。手动建立时每次创建独立对象，不要复用全局可变 store。

## 与分布式追踪（traceId）的关系

### requestId vs traceId：概念区分

requestId 用于关联日志和服务间请求，可来自入站头，也可由框架生成。traceId/spanId 则通常由 tracing SDK 随真实 span 生命周期提供。VextJS 存储这些字段并不等于创建、采样或上报 span。

### 模式一：requestId 充当 traceId（简单场景）

只需共享关联 ID 时，可以把头名改为 `x-trace-id`。以下配置合入已有配置；省略 generate 时继续使用框架 UUID 生成器：

```typescript
// src/config/default.ts 中的 requestId 配置
export default {
  requestId: {
    header: "x-trace-id",
    responseHeader: "x-trace-id",
  },
};
```

默认 logger 的字段名仍是 `requestId`；`app.fetch` 自动注入的头改为 `x-trace-id`。改名不会生成 W3C traceparent 或 APM span，也不意味着该 ID 满足外部追踪系统的格式要求。

### 模式二：requestId + APM traceId 并存（企业级场景）

需要 APM 时，先完成所选 tracing SDK 的初始化、入站/出站 instrumentation 和导出配置，再把当前 span 的字段关联到日志。普通请求头透传只能传值，不会自动创建父子 span。

以下只展示将**已经配置的 SDK 所返回的数据**写入上下文的桥接函数；获取当前 span 的适配函数由该 SDK 的集成提供：

```typescript
import { requestContext } from "vextjs";

type ActiveSpan = { traceId: string; spanId: string };

export function bindActiveSpan(readActiveSpan: () => ActiveSpan | undefined) {
  const store = requestContext.getStore();
  const span = readActiveSpan();
  if (!store || !span) return;
  store.traceId = span.traceId;
  store.spanId = span.spanId;
}
```

在已经建立 HTTP 上下文且目标 span 活跃的位置调用。默认 logger 自动读取这两个字段，但 logger 自定义 mixin 可覆盖 trace_id/span_id；requestId 的内置保护规则不同。span 变化后需更新或清除对应字段，单次复制不会跟踪 SDK 后续状态。具体集成路径见[OpenTelemetry 示例](/zh/examples/opentelemetry)。

### propagateHeaders 工作原理

合并到现有配置的 `fetch` 中：

```typescript
// src/config/default.ts 中的 fetch 配置
export default {
  fetch: {
    propagateHeaders: ["traceparent", "tracestate"],
  },
};
```

执行顺序：

1. 请求元数据中间件捕获清单中的入站头，写入 store.propagatedHeaders。
2. `app.fetch` 构建出站请求时读取该快照。
3. 未显式设置的同名头被填入，显式出站头优先。
4. 下游如何建立 span 取决于其 tracing 集成；单纯复制入站 traceparent 不会生成当前服务的出站 span。

当前实现中，单次 `propagateRequestId: false` 只关闭自动 ID 注入，其他捕获的头仍会传播；单次 `propagateHeaders: []` 也不能作为清空快照的开关。若把 ID 头本身列入全局捕获清单，它仍可能通过该快照被带出。应按出站目标选择全局捕获清单，独立请求需要完全不继承时可使用原生 `fetch` 并明确传头。

以下是已有 app 和已知目标 URL 的调用片段；函数参数明确由调用方提供：

```typescript
import type { VextApp } from "vextjs";

export async function callDownstream(app: VextApp, url: string, tag: string) {
  const response = await app.fetch.get(url, {
    headers: { "x-demo-tag": tag },
  });
  return response.json();
}
```

普通 `app.fetch` 的头传播和代理转发策略并非同一入口；代理专用行为见[内置 HTTP 客户端](/zh/guide/fetch)。

## 最佳实践

### 1. 优先使用框架内置能力

默认 logger/fetch 已覆盖常见 ID 关联需求。出现异常时按“Adapter 作用域→元数据写入→业务读写→消费者”逐层检查，而不是先增加另一份全局 ID。

### 2. 只存储请求级数据

适合存放小型 ID、locale、经过验证的业务标识；避免把完整请求、大型查询结果或长期连接放进 store。响应后仍运行的异步资源可能延长相关对象的存活时间。

### 3. 处理 store 为 undefined 的情况

可选观测信息用可选链和明确默认值；必需的业务上下文应报错，不要用默认租户绕过隔离。启动代码、独立任务或丢失上下文的回调都可能没有 store。

### 4. 使用类型声明扩展 Store

沿用前面的模块扩展，并在调用位置导入 requestContext。新增字段的类型声明不代表框架会自动写入该字段。

### 5. 不要在 store 中存储可变共享对象

每个 store 独立不意味着其中引用的对象独立。`{ ...shared }` 只复制第一层，嵌套对象仍共享；按业务需要创建独立数据或采用不可变对象。不要将 store 或请求数据保存在单例 Service 的成员变量中。

## 常见问题

| 现象                               | 检查方向                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Service 内 getStore() 为 undefined | 是否从当前请求链调用、是否关闭 requestContext、是否在构造阶段读取、是否穿过自定义异步边界 |
| 日志没显示 requestId               | 检查 prettyIgnore、requestId 开关、默认 logger 的上下文开关及自定义 logger                |
| 语言总是默认值                     | 检查 Accept-Language、supported 和元数据中间件之后是否改写 locale                         |
| 关闭 requestId 后仍有透传头        | 元数据捕获独立运行，且 app.fetch 仍读取 propagatedHeaders                                 |
| 并发请求的数据相互覆盖             | 检查模块/Service 成员缓存、共享嵌套对象和手动 run 是否复用 store                          |
| 增加头透传后仍看不到 APM span      | 头传播不负责 SDK 初始化、span 创建或导出                                                  |

## 下一步

- 用[中间件](/zh/guide/middleware)挂载上下文写入逻辑。
- 查看[日志](/zh/guide/logger)、[HTTP 客户端](/zh/guide/fetch)和[国际化](/zh/guide/i18n)了解消费者配置。
- 用[安全指南](/zh/guide/security)建立认证和授权，再携带业务身份快照。
- 跨请求后台处理继续阅读[Jobs](/zh/guide/jobs)；专业追踪参考[OpenTelemetry 集成示例](/zh/examples/opentelemetry)。

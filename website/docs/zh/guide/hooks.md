# 运行时 Hooks

`app.hooks.on(name, handler)` 用来观察或轻量 patch 框架运行时生命周期。它适合做请求审计、校验通过后的请求记录、响应 header patch、出站调用监控、service 调用追踪、OpenAPI 文档补丁等横切逻辑。

在插件 setup 中注册，先完成下方“三文件完整示例”，再按需组合各主题片段。Hook 有各自的错误和同步约束；调用者会按事件策略等待或同步执行监听器，耗时逻辑会影响原流程。

## 三文件完整示例

前置条件：[快速开始](/zh/guide/quick-start)中的 API 项目、TypeScript 配置及 dev/build/start 三个 npm scripts。下面替换基础配置并创建两个文件，不依赖外部数据库或监控服务；在独立示例项目运行，若保留环境覆盖文件，确保最终端口是 3000、日志级别允许 info。

```typescript
// src/config/default.ts
export default { port: 3000, adapter: "native", frontend: { enabled: false } };
```

```typescript
// src/plugins/hook-observer.ts
import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  hookStats: {
    validated: number;
    rejected: number;
    handled: number;
    errors: number;
  };
}>();

export default definePlugin({
  name: "hook-observer",
  setup(app) {
    const hooks = app.hooks;
    const logger = app.logger;
    const stats = { validated: 0, rejected: 0, handled: 0, errors: 0 };
    app.extend("hookStats", stats);
    const removers = [
      app.hooks.on("validation:success", () => {
        stats.validated += 1;
      }),
      app.hooks.on("validation:error", () => {
        stats.rejected += 1;
      }),
      app.hooks.on("handler:after", () => {
        stats.handled += 1;
      }),
      app.hooks.on("handler:error", () => {
        stats.errors += 1;
      }),
      app.hooks.on("response:before", ({ headers }) => ({
        headers: { ...headers, "x-hook-example": "active" },
      })),
    ];
    app.onClose(() => {
      for (const off of removers) off();
      logger.info(
        {
          stats: { ...stats },
          validationListenerPresent: hooks.has("validation:success"),
        },
        "Hook example stopped",
      );
    });
  },
});
```

```typescript
// src/routes/hooks.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/hello",
    { validate: { query: { name: "string:1-20!" } } },
    async (req, res) => {
      const { name } = req.valid("query");
      res.json({ message: `Hello, ${name}!` });
    },
  );
  app.get("/plain", {}, async (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/boom", {}, async () => {
    throw new Error("demonstration failure");
  });
});
```

运行 `npm run dev`，在另一个终端按顺序请求（Windows PowerShell 使用 `curl.exe`）：

```bash
curl -i "http://127.0.0.1:3000/hooks/hello?name=Alice"
curl -i "http://127.0.0.1:3000/hooks/hello"
curl -i "http://127.0.0.1:3000/hooks/plain"
curl -i "http://127.0.0.1:3000/hooks/boom"
```

预期状态依次为 **200 / 422 / 200 / 500**，第一条响应的 `data.message` 是 `Hello, Alice!`，响应均带 `x-hook-example: active`。缺少 query 的请求没有进入 handler；plain 没有 validate，不触发 `validation:success`；boom 的错误默认隐藏内部 message。

完成四条请求后，在服务终端按 Ctrl+C 正常关闭。`Hook example stopped` 日志中的 stats 应为 `validated=1、rejected=1、handled=2、errors=1`，`validationListenerPresent=false`。这是独立项目、没有其他请求或监听器时的预期；重复访问会改变计数，其他插件注册同一事件时 has 仍可能为 true。强制结束进程不能验证关闭回调。

再运行 `npm run build`（快启脚本含 `vext build --typecheck`），然后 `npm start`，重复四个请求与 Ctrl+C，核对构建后运行、响应和清理结果。显式 `appExtensions` 为类型生成提供 hookStats 的形状，不会创建运行时状态。

## 注册与注销

以下为插件 setup 内的 API 用法片段：

```ts
const off = app.hooks.on("validation:success", ({ req, route }) => {
  app.logger.info(
    { requestId: req.requestId, route: route.path },
    "validated request",
  );
});

app.hooks.on("response:before", ({ headers }) => ({
  headers: { ...headers, "x-powered-by": "vext" },
}));

off();
```

`app.hooks.on()` 返回注销函数。`app.hooks` 是保留属性，不能用 `app.extend("hooks", ...)` 覆盖。上面的 `off()` 只注销 validation:success 监听器，不影响另一个 response:before 监听器；立即调用后，它不会接收后续事件。长期注册可将各自的 off 交给 `app.onClose()`；临时监听结束时主动注销。

`app.hooks.has(name)` 检查当前是否有监听器。公开接口是 on/has，emit 系列由框架内部使用。关闭或重新加载插件时，应释放该插件自己注册的监听器。

## 常见场景

### 只记录校验通过的请求

如果你想在中间件里记录请求，但排除被参数校验拒绝的请求，不需要手动捕获 `VextValidationError`。使用 `validation:success` 更直接：

只在配置了有效validate且请求实际到达校验中间件时触发；它不能统计所有成功请求。认证拒绝、前置短路或缓存命中可能跳过校验；此时成功校验也不保证后续handler成功。

```ts
app.hooks.on("validation:success", ({ req, route }) => {
  app.logger.info(
    { requestId: req.requestId, method: req.method, route: route.path },
    "request validated",
  );
});
```

### 响应发送前补 header

```ts
app.hooks.on("response:before", ({ headers }) => ({
  headers: {
    ...headers,
    "x-service": "billing",
  },
}));
```

`response:before` 是同步生命周期，不能返回 Promise。

### 追踪 service 调用

```ts
app.hooks.on("service:beforeCall", ({ service, method }) => {
  app.logger.debug({ service, method }, "service call");
});

app.hooks.on("service:error", ({ service, method, error }) => {
  app.logger.warn({ service, method, error }, "service failed");
});
```

service hook也是同步生命周期。beforeCall抛错会阻止方法调用；afterCall/error采用safe同步通知，不替换业务结果。只覆盖框架包装的原型方法，不覆盖实例箭头函数或getter。异步上报交给有容量/失败处理/关闭flush约定的队列，不能把async handler直接挂到同步事件上。

### 监控出站请求和 proxy

```ts
app.hooks.on("fetch:before", ({ headers }) => {
  headers.set("x-client", "vext");
});

app.hooks.on("proxy:after", ({ target, status, requestId }) => {
  app.logger.info({ target, status, requestId }, "proxy response");
});
```

### 修改 OpenAPI 文档

```ts
app.hooks.on("openapi:afterGenerate", ({ document }) => {
  const spec = document as { info?: Record<string, unknown> };

  return {
    document: {
      ...spec,
      info: {
        ...(spec.info ?? {}),
        title: "Internal API",
      },
    },
  };
});
```

## 执行策略

| 事件                                                                                                                                                                            | 异步    | 错误策略                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------ |
| `request:start`（matched=true）、`route:matched`、`validation:success`、`handler:before`、`fetch:before`、`proxy:before`、用户`plugin:beforeSetup`、`server:beforeListen`       | 可await | 向调用者传播，阻止后续步骤     |
| `response:before`、`service:beforeCall`                                                                                                                                         | 不允许  | 同步抛出，调用失败             |
| `request:start`（404的matched=false）、`route:notFound`、`validation:error`、`handler:after/error`、`fetch:after/error`、`proxy:after/error`、`routes:ready`、`app:ready/close` | 可await | safe：记录hook异常，继续原流程 |
| `response:after`、`error:beforeResponse/afterResponse`、`service:loaded/reloaded/afterCall/error`、`cache:*`、`plugin:afterSetup/error`、`openapi:*`                            | 不允许  | safe同步：记录异常，继续原流程 |

表中使用`a/b`缩写表示分别的事件名，不能把缩写传给on。内置MonSQLize的plugin:beforeSetup由独立启动流程safe同步触发，不应套用用户插件的传播策略。

所有标注同步的事件都是同步生命周期，不允许返回 Promise；部分公开泛型目前不能在 TypeScript 层阻止 async，运行时仍会按上述策略抛错或记录异常。检测到返回 Promise 不等于取消已开始的异步操作。safe 只表示监听器异常被记录，不代表异步 handler 不耗时、不被等待，也不保证业务本身成功。不要在 hook 中返回永不结束的 Promise。

### 多监听器与patch

监听器按注册顺序执行，同一函数引用由Set去重。带返回值的事件取最后一个非undefined结果，**不会合并多个监听器返回的patch**，也不会将前一个返回值自动作为后一个payload。需要统一改data/status/headers时集中返回一个patch；不要假定两个返回不同字段的hook会累积生效。直接修改可变payload是另一种行为，应明确协作边界。

OpenAPI支持同步返回`{ document }`或含openapi字段的完整文档；仅返回局部info对象不构成完整替换。钩子不会替代静态路由合同，更多字段见[app.hooks API](/zh/api/app#apphooks)。

## 可用 Hook

| 名称                                                      | 触发点                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `request:start`                                           | 全局 request-hook 位置（在请求元数据/requestId/认证上下文之后）；404 兜底也会触发，`matched=false`  |
| `route:matched`                                           | adapter 匹配路由后、执行校验和 handler 前                                                           |
| `route:notFound`                                          | 没有路由匹配，404 响应发送前                                                                        |
| `validation:success`                                      | 路由 `validate` 全部通过，`next()` 前                                                               |
| `validation:error`                                        | 路由 `validate` 失败，抛出 `VextValidationError` 前                                                 |
| `handler:before`                                          | 业务 handler 调用前                                                                                 |
| `handler:after`                                           | handler 成功返回并等待框架记录的响应发送流程后；流响应会等待收束，不等于客户端确认接收              |
| `handler:error`                                           | handler内部抛错/reject后；不覆盖所有前置中间件/校验错误                                             |
| `response:before`                                         | `json/rawJson/text/html/render/stream/download/redirect` 发送前，可同步 patch `data/status/headers` |
| `response:after`                                          | 响应发送流程结束；stream/download等待流结束/关闭/错误收束，不等于客户端确认收到全部字节             |
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
| `service:beforeCall`                                      | service 方法调用前                                                                                  |
| `service:afterCall`                                       | service 方法成功返回后                                                                              |
| `service:error`                                           | service 方法抛错或 reject 后                                                                        |
| `cache:hit`、`cache:miss`、`cache:write`、`cache:error`   | 路由级响应缓存读写生命周期                                                                          |
| `plugin:beforeSetup`、`plugin:afterSetup`、`plugin:error` | 插件 `setup()` 前后和失败；插件不能观察自己的 `beforeSetup`                                         |
| `routes:ready`                                            | 路由扫描和注册完成后                                                                                |
| `openapi:beforeGenerate`、`openapi:afterGenerate`         | OpenAPI 文档生成前后；`afterGenerate` 可同步替换 document                                           |
| `server:beforeListen`                                     | HTTP server 开始监听前                                                                              |
| `app:ready`                                               | `phase=before/after` 区分 onReady 执行前后；正常 CLI 启动在监听后触发                               |
| `app:close`                                               | `phase=before/after` 区分 shutdown 关闭处理前后；受整体关闭期限限制                                 |

监听器只能观察注册之后触发的事件。例如用户插件无法观察已经完成的内置 MonSQLize 初始化，也不能在 setup 内回看自己的 plugin:beforeSetup。`app:ready` / `app:close` 每次正常生命周期有 before 与 after 两个阶段，统计时按 phase 区分；在 onClose 中注销 app:close 监听器后，它不再接收随后触发的 after。

## 排查与复验

| 症状                   | 判断与处理                                  | 复验                           |
| ---------------------- | ------------------------------------------- | ------------------------------ |
| validation成功计数少   | 检查是否有validate、是否被认证/缓存提前短路 | 对照hello与plain请求           |
| must be synchronous    | 同步事件误用了async/Promise                 | 改为同步处理后重试             |
| patch只剩一部分        | 多监听器返回值不会自动合并                  | 集中一个patch并检查实际响应    |
| hook异常日志但请求成功 | 事件采用safe通知；检查原业务状态            | 用执行策略表与请求结果分别判断 |
| 监听重复/占用资源      | 闭包函数重复注册、缺少off/清理              | 关闭或注销后用has检查          |

## 更多参考

- [`app.hooks` API](/zh/api/app#apphooks)
- [插件中注册运行时 hooks](/zh/guide/plugins)
- [Fetch / Proxy hooks](/zh/guide/fetch)
- [OpenAPI hooks](/zh/guide/openapi)

# 运行时 Hooks

`app.hooks.on(name, handler)` 用来观察或轻量 patch 框架运行时生命周期。它适合做请求审计、校验通过后的请求记录、响应 header patch、出站调用监控、service 调用追踪、OpenAPI 文档补丁等横切逻辑。

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

`app.hooks.on()` 返回注销函数。`app.hooks` 是保留属性，不能用 `app.extend("hooks", ...)` 覆盖。

## 常见场景

### 只记录校验通过的请求

如果你想在中间件里记录请求，但排除被参数校验拒绝的请求，不需要手动捕获 `VextValidationError`。使用 `validation:success` 更直接：

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

service hook 也是同步生命周期。如需异步上报，建议写入队列或使用不阻塞主调用的日志传输。

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

| Hook 类型                                                                                                                                                                                    | 策略                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `request:start`、`validation:success`、`handler:before`、`fetch:before`、`proxy:before`、`plugin:beforeSetup`、`server:beforeListen`                                                         | handler 抛错会向上传播，可阻止后续流程     |
| `response:before`、`error:beforeResponse`、`service:beforeCall`、`service:afterCall`、`service:error`、`openapi:*`                                                                           | 同步生命周期，不允许返回 Promise           |
| `handler:after`、`handler:error`、`response:after`、`error:afterResponse`、`fetch:after/error`、`proxy:after/error`、`cache:*`、`plugin:afterSetup/error`、`routes:ready`、`app:ready/close` | safe emit，hook 抛错会被记录但不改变主流程 |

## 可用 Hook

| 名称                                                      | 触发点                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `request:start`                                           | requestId 生成后、进入全局中间件链；404 兜底也会触发，`matched=false`                               |
| `route:matched`                                           | adapter 匹配路由后、执行校验和 handler 前                                                           |
| `route:notFound`                                          | 没有路由匹配，404 响应发送前                                                                        |
| `validation:success`                                      | 路由 `validate` 全部通过，`next()` 前                                                               |
| `validation:error`                                        | 路由 `validate` 失败，抛出 `VextValidationError` 前                                                 |
| `handler:before`                                          | 业务 handler 调用前                                                                                 |
| `handler:after`                                           | 业务 handler 成功返回后                                                                             |
| `handler:error`                                           | 业务 handler 抛错后、进入全局错误处理前                                                             |
| `response:before`                                         | `json/rawJson/text/html/render/stream/download/redirect` 发送前，可同步 patch `data/status/headers` |
| `response:after`                                          | 响应发送后                                                                                          |
| `error:beforeResponse`                                    | `error-handler` 写 JSON 错误响应前，可同步 patch `body/status`                                      |
| `error:afterResponse`                                     | 错误响应发送后                                                                                      |
| `fetch:before`                                            | `app.fetch` 出站前，可修改 `Headers`                                                                |
| `fetch:after`                                             | `app.fetch` 返回 `Response` 后                                                                      |
| `fetch:error`                                             | `app.fetch` 最终失败时                                                                              |
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
| `app:ready`                                               | `onReady` 执行前后                                                                                  |
| `app:close`                                               | `onClose` / shutdown 执行前后                                                                       |

## 更多参考

- [`app.hooks` API](/api/app#apphooks)
- [插件中注册运行时 hooks](/guide/plugins#apphookson--注册运行时生命周期-hook)
- [Fetch / Proxy hooks](/guide/fetch)
- [OpenAPI hooks](/guide/openapi)

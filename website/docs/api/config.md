# 配置项

本页详细列出 VextJS 的所有配置字段、类型、默认值及使用说明。

## 配置加载机制

VextJS 使用**多层配置合并**策略，按优先级从低到高：

```
DEFAULT_CONFIG（框架内置默认值）
  ↓ 深度合并
src/config/default.ts（项目默认配置）
  ↓ 深度合并
src/config/${NODE_ENV}.ts（环境配置，如 production.ts）
  ↓ 深度合并
src/config/local.ts（本地覆盖，可选）
  ↓ provider patch
src/config/bootstrap.ts（启动期远程配置，可选）
  ↓ CLI override
vext start/dev --port --host ...
```

合并后的配置通过 `deepFreeze()` 深冻结，运行时不可修改。

### 配置文件清单

| 文件                        | 用途                       | 是否必须 |
| --------------------------- | -------------------------- | :------: |
| `src/config/default.ts`     | 所有环境的基础配置         |    ✅    |
| `src/config/development.ts` | 开发环境覆盖               |   可选   |
| `src/config/production.ts`  | 生产环境覆盖               |   可选   |
| `src/config/test.ts`        | 测试环境覆盖               |   可选   |
| `src/config/local.ts`       | 本地覆盖（通常不提交 Git） |   可选   |
| `src/config/bootstrap.ts`   | 启动期 provider 注册入口   |   可选   |

### `src/config/bootstrap.ts`

当数据库、密钥或配置中心 patch 需要在配置冻结前完成注入时，可新增：

```typescript
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      timeoutMs: 10_000,
      async load({ env, signal, baseConfig }) {
        const response = await fetch(`https://config.example.com/${env}.json`, {
          signal,
        });
        const remote = await response.json();
        return {
          database: remote.database,
          logger: {
            lifecycleLevel: baseConfig.logger?.lifecycleLevel ?? "concise",
          },
        };
      },
    },
  ],
});
```

约束：

- provider 必须返回 plain object patch 或 `null`
- patch 只支持 JSON-like 结构
- `required` 未声明时：`production` 默认 fail-fast，`development / test` 默认 warning 后继续
- Cluster 模式下，同一启动周期会复用同一份 provider patch，避免 Master / Worker 看到不同结果

### 配置文件示例

```typescript
// src/config/default.ts
export default {
  port: 3000,
  adapter: "native",
  cors: {
    enabled: true,
    origins: ["http://localhost:3000"],
  },
  logger: {
    level: "debug",
  },
};
```

```typescript
// src/config/production.ts
export default {
  port: 8080,
  cors: {
    origins: ["https://api.example.com"],
  },
  logger: {
    level: "warn",
  },
  response: {
    hideInternalErrors: true,
  },
};
```

---

## 完整配置参考

### `VextConfig`

| 字段             | 类型                                                    | 默认值      | 说明               |
| ---------------- | ------------------------------------------------------- | ----------- | ------------------ | --- | ----------- | --------------------------------------------- | ----------- | ------------ | --- | ----------- | --------------------------------------------- | ------ | ------------ |
| `port`           | `number`                                                | `3000`      | HTTP 监听端口      |
| `host`           | `string`                                                | `'0.0.0.0'` | HTTP 监听地址      |
| `adapter`        | `string \| Function \| VextAdapter`                     | `'native'`  | 底层适配器         |
| `trustProxy`     | `boolean`                                               | `false`     | 是否信任代理       |
| `middlewares`    | `VextMiddlewareConfig[]`                                | `[]`        | 路由级中间件白名单 |
| `cors`           | [`VextCorsConfig`](#vextcorsconfig)                     | 见下方      | CORS 配置          |
| `rateLimit`      | [`VextRateLimitConfig`](#vextratelimitconfig)           | 见下方      | 速率限制配置       |
| `requestId`      | [`VextRequestIdConfig`](#vextrequestidconfig)           | 见下方      | 请求 ID 配置       |
| `logger`         | [`VextLoggerConfig`](#vextloggerconfig)                 | 见下方      | 日志配置           |
| `shutdown`       | [`VextShutdownConfig`](#vextshutdownconfig)             | 见下方      | 优雅关闭配置       |
| `response`       | [`VextResponseConfig`](#vextresponseconfig)             | 见下方      | 响应配置           |
| `bodyParser`     | [`VextBodyParserConfig`](#vextbodyparserconfig)         | 见下方      | Body 解析配置      |     | `multipart` | [`VextMultipartConfig`](#vextmultipartconfig) | `undefined` | 文件上传配置 |     | `accessLog` | [`VextAccessLogConfig`](#vextaccesslogconfig) | 见下方 | 访问日志配置 |
| `openapi`        | [`VextOpenAPIConfig`](#vextopenapiconfig)               | 见下方      | OpenAPI 文档配置   |
| `requestContext` | [`VextRequestContextConfig`](#vextrequestcontextconfig) | 见下方      | 请求上下文配置     |
| `cluster`        | [`Partial<VextClusterConfig>`](#vextclusterconfig)      | `undefined` | Cluster 多进程配置 |

---

### `adapter`

底层 HTTP 适配器，支持三种传参方式：

```typescript
// 方式一：字符串标识（内置 adapter）
export default {
  adapter: "native", // 'native' | 'hono' | 'fastify' | 'express' | 'koa'
};

// 方式二：工厂函数（传入自定义选项）
import { fastifyAdapter } from "vextjs/adapters/fastify";

export default {
  adapter: fastifyAdapter({ bodyLimit: 5 * 1024 * 1024 }),
};

// 方式三：自定义 adapter 实例（实现 VextAdapter 接口）
export default {
  adapter: myCustomAdapter,
};
```

### `trustProxy`

当设置为 `true` 时：

- `req.ip` 从 `X-Forwarded-For` 请求头读取第一个 IP
- `req.protocol` 从 `X-Forwarded-Proto` 请求头读取

部署在 Nginx / 云负载均衡器之后时需开启此选项。

### `middlewares`

路由级中间件白名单声明。只有在此处声明的中间件才能在路由 `options.middlewares` 中引用。

```typescript
export default {
  middlewares: [
    { name: "auth" },
    { name: "admin", options: { role: "admin" } },
    { name: "cache", options: { ttl: 60 } },
  ],
};
```

:::tip
全局中间件（如 CORS、body-parser）由框架自动注册，无需在此声明。此处只声明**路由级可选中间件**。
:::

---

## VextCorsConfig

跨域资源共享配置。

| 字段          | 类型       | 默认值                                                         | 说明                   |
| ------------- | ---------- | -------------------------------------------------------------- | ---------------------- |
| `enabled`     | `boolean`  | `true`                                                         | 是否启用 CORS          |
| `origins`     | `string[]` | `['*']`                                                        | 允许的来源域名         |
| `methods`     | `string[]` | `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']` | 允许的 HTTP 方法       |
| `headers`     | `string[]` | `['Content-Type', 'Authorization', 'X-Request-Id']`            | 允许的请求头           |
| `credentials` | `boolean`  | `false`                                                        | 是否允许携带凭证       |
| `maxAge`      | `number`   | `undefined`                                                    | 预检请求缓存时间（秒） |

```typescript
export default {
  cors: {
    enabled: true,
    origins: ["https://app.example.com", "https://admin.example.com"],
    credentials: true,
    maxAge: 86400,
  },
};
```

:::warning
`origins: ['*']` 与 `credentials: true` 不能同时使用。需要携带凭证时必须指定具体域名。
:::

---

## VextRateLimitConfig

全局速率限制配置，基于 `flex-rate-limit` 实现。

| 字段      | 类型                 | 默认值                | 说明                 |
| --------- | -------------------- | --------------------- | -------------------- |
| `enabled` | `boolean`            | `true`                | 是否启用速率限制     |
| `max`     | `number`             | `100`                 | 时间窗口内最大请求数 |
| `window`  | `number`             | `60`                  | 时间窗口（秒）       |
| `message` | `string`             | `'Too Many Requests'` | 超限错误消息         |
| `keyBy`   | `string \| Function` | `'ip'`                | 请求来源标识         |

```typescript
export default {
  rateLimit: {
    max: 200,
    window: 120,
    // 按用户 ID 限流（需要 auth 中间件先解析用户）
    keyBy: (req) => req.user?.id ?? req.ip,
  },
};
```

### `keyBy` 选项

| 值                | 说明                     |
| ----------------- | ------------------------ |
| `'ip'`            | 按客户端 IP 限流（默认） |
| `'user'`          | 按 `req.user?.id` 限流   |
| `(req) => string` | 自定义函数，返回唯一标识 |

:::tip
路由级可通过 `options.override.rateLimit` 覆盖全局配置，或设为 `false` 禁用限流。
:::

---

## VextRequestIdConfig

请求 ID 追踪配置，用于日志关联和分布式链路追踪。

| 字段             | 类型           | 默认值                | 说明                         |
| ---------------- | -------------- | --------------------- | ---------------------------- |
| `enabled`        | `boolean`      | `true`                | 是否启用请求 ID              |
| `header`         | `string`       | `'x-request-id'`      | 从哪个请求头读取（网关透传） |
| `responseHeader` | `string`       | `'x-request-id'`      | 写入响应头的名称             |
| `generate`       | `() => string` | `crypto.randomUUID()` | 自定义 ID 生成函数           |

### requestId vs traceId

`requestId` 是 vext 内置的请求唯一标识，`traceId` 通常指 APM 链路追踪系统（如 OpenTelemetry / Jaeger）生成的追踪 ID。两者有不同的使用场景：

**模式一：requestId 充当 traceId（简单场景）**

将 `requestId` 的请求头名改为 `x-trace-id`，使其与链路追踪头统一，适合不依赖外部 APM 的系统：

```typescript
import { nanoid } from "nanoid";

export default {
  requestId: {
    header: "x-trace-id", // 从 x-trace-id 读取（网关注入）
    responseHeader: "x-trace-id", // 写回响应头
    generate: () => nanoid(), // 可替换为更短的 ID 生成器
  },
};
```

**模式二：requestId + APM traceId 并存（企业级场景）**

保留 `requestId`（日志关联），同时通过 `config.fetch.propagateHeaders` 透传 APM 的 `traceparent` 头，适合接入 OpenTelemetry / Jaeger 等系统：

```typescript
export default {
  // requestId 保留默认配置（用于日志关联）
  requestId: {
    header: "x-request-id",
    responseHeader: "x-request-id",
  },
  // APM 追踪头通过 propagateHeaders 自动透传到下游服务
  fetch: {
    propagateHeaders: ["traceparent", "tracestate"],
  },
};
```

:::tip 选择建议

- 内部系统、简单追踪 → 模式一（改 header 名为 `x-trace-id`）
- 接入 OpenTelemetry / Jaeger / Datadog → 模式二（保留 requestId，配置 propagateHeaders）
- 详见 [请求上下文 → 与分布式追踪的关系](/guide/request-context#与分布式追踪traceId的关系)
  :::

也可通过插件动态替换生成器：

```typescript
app.setRequestIdGenerator(() => myCustomId());
```

---

## VextLoggerConfig

结构化日志配置，基于 `pino` 实现。

| 字段               | 类型                                                                       | 默认值                     | 说明                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`            | `'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug' \| 'trace' \| 'silent'` | `'info'`                   | 日志级别                                                                                                                                                                                                       |
| `pretty`           | `boolean`                                                                  | 开发环境 `true`            | 是否美化输出（彩色格式）                                                                                                                                                                                       |
| `prettyIgnore`     | `string`                                                                   | `'pid,hostname,requestId'` | pino-pretty 模式下忽略的字段（逗号分隔）。默认隐藏 `requestId` 避免 mixin 注入的字段被展开为多行噪音，生产环境 JSON 输出不受影响                                                                               |
| `prettySingleLine` | `boolean`                                                                  | `true`                     | pino-pretty 模式下是否将额外字段以 JSON 内联形式压缩到消息同一行。设为 `false` 恢复多行展开格式。仅影响 pretty 模式，生产环境 JSON 输出不受影响                                                                |
| `mixin`            | `() => Record<string, unknown>`                                            | `undefined`                | 自定义日志 mixin 函数，返回值与内置 `requestId` 字段合并注入每条日志（用户字段优先）。典型用途：注入 OpenTelemetry `trace_id` / `span_id`，实现日志与链路追踪关联。不配置时行为与之前完全一致（零 overhead）。 |

```typescript
export default {
  logger: {
    level: "debug",
    pretty: true, // 开发环境美化输出
    // prettySingleLine: true,                   // 默认值，额外字段压缩到消息同一行
    // prettySingleLine: false,                  // 恢复多行展开格式
    // prettyIgnore: 'pid,hostname,requestId',   // 默认值，隐藏 requestId
    // prettyIgnore: 'pid,hostname',             // 如需在 pretty 模式下显示 requestId
  },
};
```

**日志级别优先级**（从高到低）：

```
fatal > error > warn > info > debug > trace
```

设置某个级别后，只输出该级别及更高级别的日志。设为 `'silent'` 完全静默。

---

## VextShutdownConfig

优雅关闭配置。

| 字段      | 类型     | 默认值 | 说明           |
| --------- | -------- | ------ | -------------- |
| `timeout` | `number` | `10`   | 关闭超时（秒） |

收到 `SIGTERM` / `SIGINT` 信号后，框架会：

1. 停止接受新请求
2. 等待飞行中请求完成（不超过 `timeout` 秒）
3. 按 LIFO 顺序执行所有 `onClose` 钩子
4. 退出进程

```typescript
export default {
  shutdown: {
    timeout: 30, // 容器环境建议 30 秒
  },
};
```

---

## VextResponseConfig

响应格式配置。

| 字段                 | 类型      | 默认值 | 说明                  |
| -------------------- | --------- | ------ | --------------------- |
| `hideInternalErrors` | `boolean` | `true` | 是否隐藏 500 错误详情 |
| `wrap`               | `boolean` | `true` | 是否启用出口包装      |

### 出口包装

启用 `wrap: true` 时，`res.json(data)` 自动包装：

```json
{
  "code": 0,
  "data": { "id": 1, "name": "Alice" },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

错误响应格式：

```json
{
  "code": 10001,
  "message": "用户不存在",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

禁用 `wrap: false` 时，`res.json(data)` 直接发送原始 `data`。

### 隐藏内部错误

`hideInternalErrors: true` 时，500 错误不暴露 stack trace：

```json
// hideInternalErrors: true
{ "code": -1, "message": "Internal Server Error" }

// hideInternalErrors: false（仅开发环境使用）
{ "code": -1, "message": "Cannot read properties of undefined (reading 'id')", "stack": "..." }
```

---

## VextBodyParserConfig

请求体解析配置。

| 字段          | 类型               | 默认值  | 说明               |
| ------------- | ------------------ | ------- | ------------------ |
| `enabled`     | `boolean`          | `true`  | 是否启用 body 解析 |
| `maxBodySize` | `string \| number` | `'1mb'` | 最大请求体大小     |

```typescript
export default {
  bodyParser: {
    maxBodySize: "5mb", // 支持 'kb', 'mb', 'gb' 单位
  },
};
```

禁用后 `req.body` 始终为 `undefined`，适用于纯 GET 服务或自定义 body 解析场景。

`maxBodySize` 支持的格式：

| 格式   | 示例                         | 说明               |
| ------ | ---------------------------- | ------------------ |
| 字符串 | `'1mb'`, `'512kb'`, `'10mb'` | 支持 kb/mb/gb 单位 |
| 数字   | `1048576`                    | 直接指定字节数     |

---

## VextMultipartConfig

Multipart / 文件上传全局配置。

| 字段               | 类型       | 默认值      | 说明                                                                                   |
| ------------------ | ---------- | ----------- | -------------------------------------------------------------------------------------- |
| `enabled`          | `boolean`  | `false`     | 是否启用内置 multipart 解析。设为 `true` 后 body-parser 自动填充 `req.files`，无需插件 |
| `maxFileSize`      | `number`   | `10485760`  | 单个文件最大大小（字节，默认 10MB）                                                    |
| `maxFiles`         | `number`   | `10`        | 单次请求最多文件数                                                                     |
| `allowedMimeTypes` | `string[]` | `undefined` | 允许的 MIME 类型白名单（不设置则不限制）                                               |

```typescript
export default {
  multipart: {
    enabled: true, // 开启内置解析
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "application/pdf",
    ],
  },
};
```

:::tip Fastify 联动
配置 `multipart.maxFileSize` 后，Fastify adapter 会自动将 `bodyLimit` 设置为 `max(maxFileSize, 1MB)`，无需单独配置 adapter 的 `bodyLimit`。
:::

---

## VextAccessLogConfig

访问日志配置，基于洋葱模型 after-middleware 实现。

| 字段        | 类型       | 默认值   | 说明               |
| ----------- | ---------- | -------- | ------------------ |
| `enabled`   | `boolean`  | `true`   | 是否启用访问日志   |
| `level`     | `string`   | `'info'` | 日志级别           |
| `skipPaths` | `string[]` | `[]`     | 跳过记录的路径列表 |

```typescript
export default {
  accessLog: {
    enabled: true,
    level: "info",
    skipPaths: ["/health", "/readiness", "/metrics"],
  },
};
```

访问日志输出示例：

```
POST /api/users 201 12ms req-abc-123 192.168.1.1
```

记录字段包括：HTTP 方法、路径、状态码、响应时间（ms）、请求 ID、客户端 IP。

---

## VextOpenAPIConfig

OpenAPI 文档自动生成配置。

| 字段                   | 类型                         | 默认值              | 说明                                                                                                                                                            |
| ---------------------- | ---------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`              | `boolean`                    | dev 启用，prod 关闭 | 是否启用                                                                                                                                                        |
| `title`                | `string`                     | `undefined`         | 文档标题                                                                                                                                                        |
| `version`              | `string`                     | `undefined`         | 文档版本号                                                                                                                                                      |
| `description`          | `string`                     | `undefined`         | 文档描述                                                                                                                                                        |
| `docsPath`             | `string`                     | `'/docs'`           | Scalar 文档路径                                                                                                                                                 |
| `jsonPath`             | `string`                     | `'/openapi.json'`   | OpenAPI JSON 路径                                                                                                                                               |
| `jsonPublicPath`       | `string`                     | 同 `jsonPath`       | OpenAPI spec 的公开访问路径（仅影响 Scalar HTML 中引用 spec 的 URL，不影响路由注册）。用于反向代理剥离前缀场景，[详见指南](/guide/openapi#反向代理路径前缀场景) |
| `contact`              | `object`                     | `undefined`         | 联系信息                                                                                                                                                        |
| `license`              | `object`                     | `undefined`         | 许可证信息                                                                                                                                                      |
| `servers`              | `array`                      | `undefined`         | 服务器地址列表                                                                                                                                                  |
| `tags`                 | `array`                      | `undefined`         | 全局标签定义                                                                                                                                                    |
| `guardSecurityMap`     | `Record<string, string>`     | `undefined`         | Guard → Security Scheme 映射                                                                                                                                    |
| `securitySchemes`      | `object`                     | `undefined`         | 安全方案定义                                                                                                                                                    |
| `scalar`               | `object`                     | `{}`                | Scalar API Reference UI 配置（主题、深色模式、布局、favicon 等）                                                                                                |
| `scalar.theme`         | `string`                     | `'default'`         | 主题：`'default'` \| `'moon'` \| `'purple'` \| `'solarized'` \| `'bluePlanet'` \| `'saturn'` \| `'kepler'` \| `'mars'` \| `'deepSpace'` \| `'none'`             |
| `scalar.darkMode`      | `boolean`                    | `false`             | 是否启用深色模式                                                                                                                                                |
| `scalar.layout`        | `string`                     | `'modern'`          | 布局模式：`'modern'`（三栏） \| `'classic'`（双栏）                                                                                                             |
| `scalar.favicon`       | `string`                     | `undefined`         | 文档页面 favicon URL（如 `'/favicon.svg'`）                                                                                                                     |
| `scalar.sources`       | `array`                      | `undefined`         | 多 OpenAPI 文档源（[详见指南](/guide/openapi#导入外部-openapi)）。每项含 `title`、`url` 或 `content`、`slug`                                                    |
| `scalar.cdnUrl`        | `string`                     | jsDelivr CDN        | 自定义 Scalar JS 加载地址（[详见指南](/guide/openapi#自定义-cdn--本地资产)）。适用于内网/离线/版本锁定                                                          |
| `scalar.showSidebar`   | `boolean`                    | `true`              | 是否显示侧边栏                                                                                                                                                  |
| `scalar.hideModels`    | `boolean`                    | `false`             | 是否隐藏 Models/Schemas 面板                                                                                                                                    |
| `scalar.hiddenClients` | `string[]`                   | `undefined`         | 隐藏的客户端语言列表（如 `['php', 'ruby']`）                                                                                                                    |
| `scalar.searchHotKey`  | `string`                     | `'k'`               | 搜索热键（Ctrl+K / Cmd+K）                                                                                                                                      |
| `scalar.proxyUrl`      | `string`                     | `undefined`         | 代理 URL（Try it out 请求避免 CORS）                                                                                                                            |
| `scalar.customCss`     | `string`                     | `undefined`         | 自定义 CSS                                                                                                                                                      |
| ~~`tryItOutEnabled`~~  | `boolean`                    | `true`              | ~~已废弃~~ Scalar 内置 Try it out，无需单独配置                                                                                                                 |
| ~~`docExpansion`~~     | `'none' \| 'list' \| 'full'` | `'list'`            | ~~已废弃~~ 请使用 `scalar.layout` 替代                                                                                                                          |

```typescript
export default {
  openapi: {
    enabled: true,
    title: "My API",
    version: "1.0.0",
    description: "我的 API 文档",
    scalar: {
      theme: "default",
      darkMode: false,
      layout: "modern",
      favicon: "/favicon.svg",
    },
    servers: [
      { url: "http://localhost:3000", description: "开发环境" },
      { url: "https://api.example.com", description: "生产环境" },
    ],
    tags: [
      { name: "用户", description: "用户管理接口" },
      { name: "订单", description: "订单管理接口" },
    ],
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    guardSecurityMap: {
      auth: "bearerAuth",
    },
  },
};
```

### `guardSecurityMap`

将路由中间件名称自动映射为 OpenAPI Security Scheme：

```typescript
// 路由声明中使用 auth 中间件
app.get("/profile", { middlewares: ["auth"] }, handler);
// ↑ OpenAPI 自动推断该路由需要 bearerAuth 认证
```

### `securitySchemes`

支持的安全方案类型：

| `type`          | 说明           | 必填字段                                      |
| --------------- | -------------- | --------------------------------------------- |
| `http`          | HTTP 认证      | `scheme`（`bearer` / `basic`）                |
| `apiKey`        | API Key        | `name`, `in`（`header` / `query` / `cookie`） |
| `oauth2`        | OAuth 2.0      | —                                             |
| `openIdConnect` | OpenID Connect | —                                             |

---

## VextRequestContextConfig

AsyncLocalStorage 请求上下文配置。

| 字段      | 类型      | 默认值 | 说明               |
| --------- | --------- | ------ | ------------------ |
| `enabled` | `boolean` | `true` | 是否启用请求上下文 |

```typescript
export default {
  requestContext: {
    enabled: false, // 禁用后可提升 3-8% RPS
  },
};
```

:::warning
禁用后以下功能失效：

- Logger 自动注入 `requestId`
- `app.throw()` 自动解析请求级 `locale`
- `app.fetch()` 自动传播 `requestId`
  :::

---

## VextClusterConfig

Cluster 多进程配置。完整接口定义见 `src/types/app.ts` `VextClusterConfig`。

### 基础字段

| 字段               | 类型                           | 默认值        | 说明                                                                                                   |
| ------------------ | ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------ |
| `enabled`          | `boolean`                      | `false`       | 是否启用 Cluster 模式（也可通过 `VEXT_CLUSTER=1` 开启）                                                |
| `workers`          | `'auto' \| 'auto-1' \| number` | `'auto'`      | Worker 数量（`'auto'` = CPU 核心数；`'auto-1'` = CPU 核心数 - 1；number = 固定数量，clamp 到 [1, 64]） |
| `autoRestart`      | `boolean`                      | `true`        | Worker 崩溃后自动重启                                                                                  |
| `maxRestarts`      | `number`                       | `5`           | 快速重启检测窗口内允许的最大重启次数                                                                   |
| `restartWindow`    | `number`                       | `60000`       | 快速重启检测窗口（毫秒）                                                                               |
| `restartBaseDelay` | `number`                       | `1000`        | 重启间隔退避基数（毫秒）                                                                               |
| `restartMaxDelay`  | `number`                       | `30000`       | 重启间隔上限（毫秒）                                                                                   |
| `pidFile`          | `string`                       | `'.vext.pid'` | PID 文件路径（供 `vext stop` / `vext reload` 定位进程）                                                |
| `titlePrefix`      | `string`                       | `'vext'`      | Worker 进程标题前缀                                                                                    |
| `sticky`           | `'none' \| 'ip'`               | `'none'`      | 粘性会话模式（`'ip'` 基于客户端 IP 分配固定 Worker，适用于 WebSocket / SSE）                           |

### `healthCheck` — 心跳检测

| 字段                   | 类型      | 默认值  | 说明                                        |
| ---------------------- | --------- | ------- | ------------------------------------------- |
| `healthCheck.enabled`  | `boolean` | `true`  | 是否启用 Worker 心跳检测                    |
| `healthCheck.interval` | `number`  | `15000` | Master 发送心跳探测的间隔（毫秒）           |
| `healthCheck.timeout`  | `number`  | `30000` | Worker 心跳超时阈值（毫秒），超时则强制重启 |

### `reload` — 零停机滚动重启

| 字段                     | 类型     | 默认值  | 说明                                   |
| ------------------------ | -------- | ------- | -------------------------------------- |
| `reload.workerDelay`     | `number` | `2000`  | 替换下一个 Worker 前的等待时间（毫秒） |
| `reload.readyTimeout`    | `number` | `30000` | 新 Worker 就绪超时（毫秒）             |
| `reload.shutdownTimeout` | `number` | `10000` | 旧 Worker 关闭超时（毫秒）             |

```typescript
export default {
  cluster: {
    enabled: true,
    workers: "auto", // 充分利用所有 CPU 核心
    autoRestart: true,
    maxRestarts: 5,
    healthCheck: {
      enabled: true,
      interval: 15000,
      timeout: 30000,
    },
    reload: {
      workerDelay: 2000,
      readyTimeout: 30000,
      shutdownTimeout: 10000,
    },
  },
};
```

也可通过环境变量启用（无需修改配置文件）：

```bash
VEXT_CLUSTER=1 vext start
```

---

## VextCacheConfig

路由级响应缓存全局配置。

| 字段         | 类型      | 默认值     | 说明                            |
| ------------ | --------- | ---------- | ------------------------------- |
| `enabled`    | `boolean` | `true`     | 是否启用路由缓存                |
| `defaultTtl` | `number`  | `60`       | 路由未指定 TTL 时的默认值（秒） |
| `maxEntries` | `number`  | `1000`     | LRU 最大缓存条目数              |
| `maxMemory`  | `number`  | `52428800` | 最大内存占用 bytes（默认 50MB） |

```typescript
export default {
  cache: {
    enabled: true,
    defaultTtl: 120,
    maxEntries: 2000,
  },
};
```

路由级缓存通过 `RouteOptions.cache` 配置，详见 [路由缓存指南](/guide/cache)。

---

## DEFAULT_CONFIG

框架内置默认配置的完整值：

```typescript
import { DEFAULT_CONFIG } from 'vextjs';

// DEFAULT_CONFIG 的完整内容：
{
  port: 3000,
  host: '0.0.0.0',
  adapter: 'native',
  trustProxy: false,
  middlewares: [],
  cors: {
    enabled: true,
    origins: ['*'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false,
  },
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60,
    message: 'Too Many Requests',
    keyBy: 'ip',
  },
  requestId: {
    enabled: true,
    header: 'x-request-id',
    responseHeader: 'x-request-id',
  },
  logger: {
    level: 'info',
  },
  shutdown: {
    timeout: 10,
  },
  response: {
    hideInternalErrors: true,
    wrap: true,
  },
  bodyParser: {
    enabled: true,
    maxBodySize: '1mb',
  },
  accessLog: {
    enabled: true,
    level: 'info',
    skipPaths: [],
  },
  openapi: {
    enabled: false,
  },
  requestContext: {
    enabled: true,
  },
}
```

---

## VextUserConfig

用户配置的输入类型，所有字段均为可选。由 `loadConfig()` 合并默认值后生成完整的 `VextConfig`。

```typescript
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 8080,
  logger: { level: "debug" },
};

export default config;
```

---

## loadConfig

配置加载函数，执行三层合并。

```typescript
import { loadConfig } from "vextjs";

const config = await loadConfig({
  rootDir: process.cwd(),
  env: process.env.NODE_ENV ?? "development",
});
// config: VextConfig（已合并、已冻结）
```

通常不需要手动调用，`bootstrap()` 内部会自动调用 `loadConfig()`。

---

## 环境变量覆盖

部分配置支持通过环境变量覆盖：

| 环境变量       | 对应配置          | 说明                     |
| -------------- | ----------------- | ------------------------ |
| `PORT`         | `port`            | HTTP 监听端口            |
| `HOST`         | `host`            | HTTP 监听地址            |
| `NODE_ENV`     | —                 | 决定加载哪个环境配置文件 |
| `VEXT_CLUSTER` | `cluster.enabled` | 设为 `1` 启用集群        |

```bash
PORT=8080 NODE_ENV=production node dist/index.js
```

---

## 类型声明扩展

插件可通过 `declare module` 为 `VextConfig` 添加自定义字段：

```typescript
// types/vext.d.ts
declare module "vextjs" {
  interface VextConfig {
    redis?: {
      host: string;
      port: number;
      password?: string;
    };
  }
}
```

之后在配置文件中使用将获得完整的类型提示：

```typescript
// src/config/default.ts
export default {
  redis: {
    host: "localhost",
    port: 6379,
  },
};
```

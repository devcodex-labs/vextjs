# Access Log 中间件

VextJS 内置 Access Log 中间件，自动记录每个 HTTP 请求的方法、路径、状态码、响应时间和客户端 IP。该中间件基于洋葱模型（after-middleware 模式），在请求处理完成后输出一行紧凑的访问日志。

## 基本行为

Access Log 中间件默认启用，无需任何配置即可工作：

```typescript
// 无需手动注册，框架自动挂载
// 每个请求完成后自动输出一行日志
```

请求完成后，终端输出类似：

```
[17:53:26.174] INFO: GET /api/users 200 3ms | 127.0.0.1
```

## 日志格式

Access Log 采用**紧凑单行格式**，在开发和生产环境下呈现不同的输出样式：

### 开发模式（Pretty）

当 `logger.pretty` 为 `true`（开发环境默认值）时，内置 pretty formatter 会对日志进行着色和格式化：

```
[17:53:26.174] INFO: GET / 200 1ms | 127.0.0.1
[17:53:26.891] INFO: POST /api/users 201 45ms | 127.0.0.1
[17:53:27.003] INFO: GET /api/users/123 404 2ms | 192.168.1.10
[17:53:28.120] INFO: DELETE /api/users/456 500 312ms | 10.0.0.5
```

日志消息本身始终是紧凑的单行文本，格式为：

```
METHOD PATH STATUS TIMEms | IP
```

### 生产模式（JSON）

当 `logger.pretty` 为 `false`（生产环境默认值）时，Vext logger 输出结构化 JSON：

```json
{"level":30,"time":"2026-03-06T09:33:26.174Z","requestId":"req-1","msg":"GET / 200 1ms | 127.0.0.1"}
{"level":30,"time":"2026-03-06T09:33:26.891Z","requestId":"req-2","msg":"POST /api/users 201 45ms | 127.0.0.1"}
```

每条日志是一行完整的 JSON 对象，便于 ELK、Loki 等日志收集系统解析。

> **注意**：`requestId` 字段由 logger mixin + AsyncLocalStorage 自动注入（见下文），无需在 access-log 中间件中手动传入。

## requestId 自动注入

### 工作原理

VextJS 使用 `AsyncLocalStorage`（Node.js 内置的异步上下文传播机制）为每个请求维护独立的上下文。requestId 中间件在请求进入时生成唯一 ID 并存入 `AsyncLocalStorage`，后续所有日志输出都会自动携带该 ID。

```
请求进入
  ↓
requestId 中间件：生成 req-N，存入 AsyncLocalStorage
  ↓
... 其他中间件 ...
  ↓
access-log 中间件：调用 logger.info("GET / 200 1ms | 127.0.0.1")
  ↓
logger mixin：从 AsyncLocalStorage 读取 requestId，自动注入到日志对象
  ↓
输出：{"level":30,"requestId":"req-1","msg":"GET / 200 1ms | 127.0.0.1"}
```

### 跨服务追踪

在微服务架构中，requestId 可以通过 HTTP 头传递，实现跨服务的请求链路追踪：

```typescript
// 框架自动处理：
// 1. 如果请求头包含 X-Request-Id，使用该值
// 2. 否则生成新的唯一 ID
// 3. 响应头自动包含 X-Request-Id
```

## 中间件执行位置

Access Log 位于内置中间件链的第 6 位（response-wrapper 之后），确保：

1. `requestId` 已在之前的中间件中生成（`req.requestId` 可用）
2. 洋葱回程时 handler 已执行完毕（`res.statusCode` 已确定）

```
requestId → cors → body-parser → rateLimit → response-wrapper → 【access-log】
  → 插件全局中间件 → 路由级中间件 → validate → handler
```

## 配置项

通过 `config.accessLog` 进行配置：

```typescript
// src/config/default.ts
export default {
  accessLog: {
    // 是否启用（默认 true）
    enabled: true,

    // 日志级别（默认 'info'）
    // 设为 'debug' 可通过 logger.level 统一控制
    level: "info",

    // 跳过记录的路径列表（精确匹配）
    skipPaths: ["/health", "/ready", "/metrics"],

    // 跳过记录的路径前缀（前缀匹配）
    skipPathPrefixes: ["/internal"],

    // 慢请求阈值（毫秒，默认 0，表示不启用）
    // 超过此阈值的请求自动提升为 warn 级别
    slowThreshold: 3000,

    // 是否将 4xx 响应提升为 warn（默认 false）
    warnOn4xx: false,

    // 是否记录响应体大小（默认 false）
    // 启用后在日志消息末尾追加 Content-Length
    logResponseSize: false,
  },
};
```

### `enabled`

| 类型      | 默认值 | 说明                       |
| --------- | ------ | -------------------------- |
| `boolean` | `true` | 是否启用 access-log 中间件 |

设为 `false` 时，中间件直接调用 `next()`，零开销跳过。

```typescript
// src/config/development.ts — 开发环境关闭 access log 减少噪音
export default {
  accessLog: { enabled: false },
};
```

### `level`

| 类型     | 默认值   | 可选值                | 说明         |
| -------- | -------- | --------------------- | ------------ |
| `string` | `'info'` | `'info'` \| `'debug'` | 日志输出级别 |

设为 `'debug'` 后，可以在生产环境通过 `logger.level` 统一控制是否输出普通访问日志。5xx 响应始终提升为 `error`；4xx 仅在 `warnOn4xx: true` 时提升为 `warn`。

### `skipPaths`

| 类型       | 默认值 | 说明                     |
| ---------- | ------ | ------------------------ |
| `string[]` | `[]`   | 不记录访问日志的路径列表 |

内部使用 `Set` 实现 O(1) 精确查找。

常见用途：排除健康检查、Kubernetes 探针、Prometheus metrics 等高频路径：

```typescript
export default {
  accessLog: {
    skipPaths: ["/health", "/ready", "/metrics", "/favicon.ico"],
  },
};
```

### `skipPathPrefixes`

| 类型       | 默认值 | 说明                         |
| ---------- | ------ | ---------------------------- |
| `string[]` | `[]`   | 不记录访问日志的路径前缀列表 |

与 `skipPaths` 的精确匹配互补，适用于跳过整棵内部路径树：

```typescript
export default {
  accessLog: {
    skipPathPrefixes: ["/api/internal", "/_next"],
  },
};
```

### `slowThreshold`

| 类型     | 默认值 | 说明                               |
| -------- | ------ | ---------------------------------- |
| `number` | `0`    | 慢请求阈值（毫秒），`0` 表示不启用 |

响应时间超过此阈值的请求，日志级别自动提升为 `warn`，并在消息中追加 `[SLOW]` 标记：

```
[17:53:30.500] WARN: GET /api/reports 200 5231ms | 10.0.0.1 [SLOW]
```

### `logResponseSize`

| 类型      | 默认值  | 说明                       |
| --------- | ------- | -------------------------- |
| `boolean` | `false` | 是否在日志中包含响应体大小 |

启用后，日志消息会在 IP 之后追加 `Content-Length`（如果响应头中存在）：

```
[17:53:26.174] INFO: GET /api/users 200 3ms | 127.0.0.1 [1.2kB]
```

### `warnOn4xx`

| 类型      | 默认值  | 说明                         |
| --------- | ------- | ---------------------------- |
| `boolean` | `false` | 是否将 4xx 响应提升为 `warn` |

级别映射：

| 状态码范围      | 日志级别                                              | 说明                 |
| --------------- | ----------------------------------------------------- | -------------------- |
| 1xx / 2xx / 3xx | 配置的 `level`（默认 `info`）                         | 正常请求             |
| 4xx             | `warnOn4xx: true` 时为 `warn`，否则使用配置的 `level` | 客户端错误           |
| 5xx             | `error`                                               | 服务端错误，始终提升 |

```
[17:53:27.003] WARN: GET /api/users/999 404 2ms | 192.168.1.10
[17:53:28.120] ERROR: POST /api/payment 500 312ms | 10.0.0.5
```

这对生产环境的告警监控非常有用——可以在日志系统中针对 `error` 级别设置告警规则，自动捕获 5xx 错误。

## 性能优化

Access Log 中间件在内部做了多项性能优化：

1. **Set 预计算** — `skipPaths` 在初始化时转换为 `Set`，查找复杂度 O(1)
2. **方法预绑定** — `logger.info.bind(logger)` 在初始化时绑定，避免每次请求的动态查找
3. **快速跳过** — `enabled: false` 时立即 `return next()`，无任何额外开销
4. **单行消息** — 使用字符串拼接而非结构化对象，避免 pretty 模式将字段展开为多行

## TypeScript 类型

```typescript
interface VextAccessLogConfig {
  /** 是否启用 access-log（默认 true） */
  enabled?: boolean;

  /** 日志输出级别（默认 'info'） */
  level?: "info" | "debug";

  /** 跳过记录的路径列表 */
  skipPaths?: string[];

  /** 跳过记录的路径前缀列表 */
  skipPathPrefixes?: string[];

  /** 慢请求阈值（毫秒，默认 0，表示不启用） */
  slowThreshold?: number;

  /** 是否将 4xx 响应提升为 warn（默认 false） */
  warnOn4xx?: boolean;

  /** 是否记录响应体大小（默认 false） */
  logResponseSize?: boolean;
}
```

## 与日志存储的关系

Access Log 的输出走框架统一的 `app.logger`（Vext logger），因此所有在 [日志文档](/guide/logger) 中描述的存储方案都适用：

- **stdout → Cloud** — 云原生日志管道
- **PM2 / systemd + logrotate** — 单机部署时落盘并轮转
- **Filebeat / Fluent Bit → ELK** — 采集 JSON 日志到 Elasticsearch
- **Docker → Loki** — 容器日志驱动或 Agent 推送
- **app.setLogger 桥接** — 插件层同步转发到外部 SDK

如需将 access log 单独存储到独立文件，推荐在日志采集层按 `msg`、路径或级别过滤后分流；应用内需要同步转发时可使用 `app.setLogger()` 包装当前 logger。

## 下一步

- 了解 [日志系统](/guide/logger) 的完整配置和存储方案
- 查看 [配置文档](/guide/configuration) 了解环境覆盖机制
- 了解 [requestId 与请求上下文](/api/context) 的工作原理

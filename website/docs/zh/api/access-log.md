# Access Log 中间件

Access Log 通过 `app.logger` 记录进入该中间件的请求方法、路径、状态码、下游处理耗时和客户端 IP。本页用于查询 `config.accessLog` 的七个配置字段及其边界；业务日志的写法见[日志指南](/zh/guide/logger)。

## 基本行为

生产启动与开发启动默认自动注册，无需 `app.use()`。请求没有被排除、且 `await next()` 正常返回时，输出一条访问日志：

```
[17:53:26.174] INFO: GET /api/users 200 3ms | 127.0.0.1
```

记录范围需要区分：

- CORS、请求体解析、限流等前置中间件若提前返回或抛错，请求可能不会进入 Access Log。
- 下游错误若继续抛出到 Access Log 的 `await next()`，该条访问日志不会产生；错误处理日志应结合[错误处理](/zh/guide/error-handling)查看。下游正常返回的 5xx 响应才会走本页的级别提升逻辑。
- 耗时从进入 Access Log 后开始计时，到下游中间件正常返回为止；不包含更早的处理，也不代表客户端收完响应或流式传输结束。
- 路径取 `req.path`，不包含查询字符串；IP 取 `req.ip`，受 Adapter 和 `trustProxy` 配置影响，不能直接作为身份凭证。

## 日志格式

Access Log 采用**紧凑单行格式**，在开发和生产环境下呈现不同的输出样式：

### 开发模式（Pretty）

当 `logger.pretty` 为 `true`（开发环境默认值）时，内置 pretty formatter 会输出可读格式；若 `logger.prettyColor` 解析为启用，仅 level label 会着色：

```
[17:53:26.174] INFO: GET / 200 1ms | 127.0.0.1
[17:53:26.891] INFO: POST /api/users 201 45ms | 127.0.0.1
[17:53:27.003] INFO: GET /api/users/123 404 2ms | 192.168.1.10
[17:53:28.120] ERROR: DELETE /api/users/456 500 312ms | 10.0.0.5
```

日志消息本身始终是紧凑的单行文本，格式为：

```
METHOD PATH STATUS TIMEms | IP
```

### 生产模式（JSON）

当 `logger.pretty` 为 `false`（生产环境默认值）时，Vext logger 输出结构化 JSON。下面省略了 `pid` 和 `hostname`；`req-1`、`req-2` 是示例传入的请求 ID，内置默认生成器使用 UUID：

```json
{"level":30,"time":"2026-03-06T09:33:26.174Z","requestId":"req-1","msg":"GET / 200 1ms | 127.0.0.1"}
{"level":30,"time":"2026-03-06T09:33:26.891Z","requestId":"req-2","msg":"POST /api/users 201 45ms | 127.0.0.1"}
```

每条日志是一行完整的 JSON 对象，便于 ELK、Loki 等日志收集系统解析。

> **注意**：内置 logger 通过 context provider 从 AsyncLocalStorage 读取 `requestId`；这是框架行为，不要求用户配置 `logger.mixin`。日志阈值和输出格式仍由 logger 统一控制。

## requestId 自动注入

### 工作原理

默认启用请求上下文和 requestId 时，Adapter 创建 `AsyncLocalStorage` 作用域，requestId 中间件将接收或生成的 ID 写入该作用域，内置 logger 再读取它。关闭 `requestContext`、关闭 requestId 或在请求作用域外写日志时，不应预期自动获得该字段；pretty 默认会隐藏 requestId，JSON 输出便于查看。

```
请求进入
  ↓
requestId 中间件：接收有效请求头或生成 UUID，写入当前上下文
  ↓
... 其他中间件 ...
  ↓
access-log 中间件：调用 logger.info("GET / 200 1ms | 127.0.0.1")
  ↓
logger context provider：从 AsyncLocalStorage 读取 requestId，写入日志对象
  ↓
输出：{"level":30,"requestId":"req-1","msg":"GET / 200 1ms | 127.0.0.1"}
```

### 跨服务追踪

默认读取 `x-request-id`，非空时优先使用请求头；否则调用插件注册的生成器、配置的 `generate()` 或默认 `crypto.randomUUID()`，并写入响应头。ID 必须是 1–512 字符的字符串，且不能包含控制字符，无效值会抛错。请求头和响应头名称均可配置。

出站传播由 [app.fetch](/zh/guide/fetch) 负责；这只关联请求 ID，不等于已经接入完整分布式 Trace。配置及作用域边界见[请求上下文](/zh/guide/request-context)。

## 中间件执行位置

Access Log 注册在响应包装和启用的前端渲染中间件之后、Session 与插件全局中间件之前。启用的模块会改变链条长度，因此不使用固定序号描述其位置。

```text
请求元数据 / requestId / 认证上下文 / request hook
  → 安全响应头 / CORS / 请求体解析 / 限流 / 响应包装 / 前端渲染
  → Access Log
  → Session / 插件全局中间件 / CSRF / 路由处理链
```

上图中的可选中间件仅在相应配置启用时出现；具体阶段和短路规则见[中间件指南](/zh/guide/middleware)。Access Log 在回程读取当前状态码，位于它外层的后置处理尚未完成。

## 配置项

通过 `config.accessLog` 配置，将下面字段合并到已有的 `src/config/default.ts`。示例按常见运维需求设置了排除路径和慢请求阈值，表格中的默认值才是未配置时的行为：

```typescript
// src/config/default.ts
export default {
  accessLog: {
    // 是否启用（默认 true）
    enabled: true,

    // 日志级别（默认 'info'）
    // 设为 'debug' 可通过 logger.level 初始阈值或 app.logger.setLevel() 统一控制
    level: "info",

    // 跳过记录的路径列表（精确匹配）
    skipPaths: ["/health", "/ready", "/metrics"],

    // 跳过记录的路径前缀（前缀匹配）
    skipPathPrefixes: ["/internal"],

    // 慢请求阈值（毫秒，默认 0，表示不启用）
    // 非 5xx 请求超过此阈值时提升为 warn 级别
    slowThreshold: 3000,

    // 是否将 4xx 响应提升为 warn（默认 false）
    warnOn4xx: false,

    // 是否记录响应体大小（默认 false）
    // 尝试读取可访问的 Content-Length，不测量实际传输字节
    logResponseSize: false,
  },
};
```

### `enabled`

| 类型      | 默认值 | 说明                       |
| --------- | ------ | -------------------------- |
| `boolean` | `true` | 是否启用 access-log 中间件 |

设为 `false` 时，Vext 在 bootstrap 阶段不会注册内置 access-log 中间件，因此它不会进入请求中间件链。

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

设为 `'debug'` 后，可以在生产环境通过 `logger.level` 初始阈值或运行时 `app.logger.setLevel()` 统一控制是否输出普通访问日志。已记录的 5xx 使用 `error`；非 5xx 慢请求使用 `warn`，其他 4xx 仅在 `warnOn4xx: true` 时使用 `warn`。这些级别均受 logger 阈值过滤，例如 `silent` 会关闭全部输出。

### `skipPaths`

| 类型       | 默认值 | 说明                     |
| ---------- | ------ | ------------------------ |
| `string[]` | `[]`   | 不记录访问日志的路径列表 |

按 `req.path` 区分大小写、精确匹配，不匹配查询字符串或自动包含子路径。内部使用 `Set` 查找。

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

按字符串 `startsWith()` 匹配，区分大小写，不支持 glob，也不检查路径段边界。例如 `/api/internal` 同时匹配 `/api/internal/users` 和 `/api/internal-tools`。只排除指定目录时，组合根路径精确匹配和带 `/` 的前缀：

```typescript
export default {
  accessLog: {
    skipPaths: ["/api/internal", "/_next"],
    skipPathPrefixes: ["/api/internal/", "/_next/"],
  },
};
```

### `slowThreshold`

| 类型     | 默认值 | 说明                               |
| -------- | ------ | ---------------------------------- |
| `number` | `0`    | 慢请求阈值（毫秒），`0` 表示不启用 |

阈值大于 0 且下游耗时**严格大于**阈值时，非 5xx 请求提升为 `warn` 并追加 `[SLOW]`；等于阈值不会命中。5xx 优先使用 `error`，即使超时也不会追加 `[SLOW]`：

```
[17:53:30.500] WARN: GET /api/reports 200 5231ms | 10.0.0.1 [SLOW]
```

### `logResponseSize`

| 类型      | 默认值  | 说明                       |
| --------- | ------- | -------------------------- |
| `boolean` | `false` | 是否在日志中包含响应体大小 |

启用后尝试从响应对象读取 `Content-Length`，在 IP 之后追加可读大小：

```
[17:53:26.174] INFO: GET /api/users 200 3ms | 127.0.0.1 [1.2kB]
```

当前实现只探测响应对象的 `getHeader()` 或底层 `_serverResponse.getHeader()`；Native 暴露了后一通道，其他内置 Adapter 的 VextResponse 包装对象未提供这两个读取入口，因此不能承诺跨 Adapter 都有大小字段。即使 Native 也需要该时刻已有响应头。

没有读取入口或没有该响应头时不追加大小；读取到 0 或无法解析为正数时显示 `[-]`。单位按 1024 换算，超过 1 kB / 1 MB 保留一位小数。它不是网络字节计数器，不能据此计算完整流式下载的实际传输量。

### `warnOn4xx`

| 类型      | 默认值  | 说明                         |
| --------- | ------- | ---------------------------- |
| `boolean` | `false` | 是否将 4xx 响应提升为 `warn` |

按下面优先级选择，命中第一项后不再检查后续项：

| 优先级 | 条件                           | 日志级别与标记              |
| ------ | ------------------------------ | --------------------------- |
| 1      | 状态码 ≥ 500                   | `error`，不加 `[SLOW]`      |
| 2      | 非 5xx，正数阈值且耗时超过阈值 | `warn`，追加 `[SLOW]`       |
| 3      | 其他 4xx，且 `warnOn4xx: true` | `warn`                      |
| 4      | 其余情况                       | 配置的 `level`，默认 `info` |

```
[17:53:27.003] WARN: GET /api/users/999 404 2ms | 192.168.1.10
[17:53:28.120] ERROR: POST /api/payment 500 312ms | 10.0.0.5
```

可在采集系统按级别设置告警，但需同时采集错误处理日志；仅靠 Access Log 无法覆盖前面列出的短路和异常传播场景。

## 性能优化

Access Log 中间件在内部做了多项性能优化：

1. **Set 预计算** — `skipPaths` 在初始化时转换为 `Set`，查找复杂度 O(1)
2. **方法预绑定** — `logger.info.bind(logger)` 在初始化时绑定，避免每次请求的动态查找
3. **快速跳过** — 正常启动时禁用即不注册；排除路径在计时与构造消息之前跳过
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

Access Log 的输出走框架统一的 `app.logger`（Vext logger），日志存储需要部署侧或插件接入；框架不会仅凭 `accessLog` 配置自动创建日志文件或云端连接。可结合[日志文档](/zh/guide/logger)选择：

- **stdout → Cloud** — 云原生日志管道
- **PM2 / systemd + logrotate** — 单机部署时落盘并轮转
- **Filebeat / Fluent Bit → ELK** — 采集 JSON 日志到 Elasticsearch
- **Docker → Loki** — 容器日志驱动或 Agent 推送
- **app.setLogger 桥接** — 插件层同步转发到外部 SDK

如需将 access log 单独存储到独立文件，推荐在日志采集层按 `msg`、路径或级别过滤后分流；应用内需要同步转发时可在插件 `setup()` 中使用 `app.setLogger()` 包装当前 logger；应保留 logger 的级别控制、child 与原有输出语义。

## 下一步

- 了解 [日志系统](/zh/guide/logger) 的完整配置和存储方案
- 查看 [配置文档](/zh/guide/configuration) 了解环境覆盖机制
- 了解 [requestId 与请求上下文](/zh/guide/request-context) 的工作原理

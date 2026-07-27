# OpenTelemetry 可观测性

本文档只介绍 **VextJS** 场景下如何接入 `@devcodex/opentelemetry`。

> 其他框架（Egg.js / Koa / Express / Hono / Fastify）的接入说明，请直接查看 GitHub 仓库：
> [`vextjs/vextjs-plugins`](https://github.com/devcodex-labs/opentelemetry)

---

## 目录速览（VextJS-only）

- [快速开始（VextJS 框架）](#快速开始vextjs-框架)
- [先理解：VextJS 双入口优先级](#先理解vextjs-双入口优先级)
- [本地测试（无需 Docker）](#本地测试无需-docker)
- [`/_otel/status` 状态检查接口](#_otelstatus-状态检查接口)
- [配置方式（VextJS）](#配置方式vextjs)
- [声明式采集（`capture`）](#声明式采集capture)
- [完整配置参考](#完整配置参考)
- [生产最佳实践](#生产最佳实践)
- [常见问题](#常见问题)

> 本页只保留 **VextJS** 的正式接入路径；如果你正在查 Egg.js / Koa / Express / Hono / Fastify，请直接跳转到 GitHub README 获取对应框架版本的说明。

---

## 快速开始（VextJS 框架）

### 1. 安装

```bash
npm install @devcodex/opentelemetry
```

> `@devcodex/opentelemetry` 已内置 `@opentelemetry/api`、`@opentelemetry/sdk-node`、常用 OTLP exporter 与自动检测依赖；
> 对于 **VextJS 默认接入**，不需要再重复安装这些包。
> 只有当你的应用代码要**直接 import** 某个 OTel 包时，才建议把它声明成应用自己的直接依赖。

### 2. 创建插件

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";
export default opentelemetryPlugin({ serviceName: "my-app" });
```

> **注意**：`opentelemetryPlugin` 通过 `@devcodex/opentelemetry/vextjs` 子路径导入（VextJS 专属）。
> 主入口 `@devcodex/opentelemetry` 只导出框架无关工具（`createWithSpan`、`getOtelStatus`）。

### 3. 启动

```bash
vext start    # 生产模式
vext dev      # 开发模式
```

> `vext start` / `vext dev` 自动运行 OTel SDK 初始化脚本（`@devcodex/opentelemetry` 已在其 `package.json` 声明 `"vext.preload": "./dist/instrumentation.js"`，VextJS CLI 自动扫描并以 `--import` 注入，无需手动配置）。
> **默认不上报**——SDK 初始化脚本在启动时读取**项目自身 `package.json`** 的 `vext.otel.endpoint` 字段来决定上报地址，未配置时安全 noop（数据被丢弃，不会发送到任何地址）。

### 4. 验证

```bash
curl http://localhost:3000/_otel/status
```

```json
{
  "sdk": "initialized",
  "serviceName": "my-app",
  "exportMode": "otlp-http",
  "exportTarget": "http://otel-collector.internal:4318",
  "protocol": "http",
  "autoInstrumentation": true,
  "samplingRatio": 1
}
```

**Done.** 所有遥测功能已自动启用。

---

## 先理解：VextJS 双入口优先级

VextJS 下的 OpenTelemetry 配置分为两个正式入口，但职责不同：

| 入口                                            | 生效阶段               | 最适合放什么                                                                                        | 不建议放什么                                     |
| ----------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `package.json` → `vext.otel`                    | preload / 进程启动前   | `serviceName`、`endpoint`、`protocol`、`headers`、`sampling` 等“SDK 一开始就要知道”的默认导出配置   | `ignorePaths`、`capture`、日志桥接、请求级副作用 |
| `src/plugins/otel.ts` → `opentelemetryPlugin()` | plugin setup + request | `tracing`、`metrics`、`lifecycle`、`logs.bridgeAppLogger`，以及 setup 阶段对 exporter 的补充 / 覆盖 | 指望它回写 preload 阶段已经启动好的 SDK Resource |

### 推荐顺序

1. **先在 `package.json vext.otel` 固化默认导出目标**：让 CLI preload、启动日志和 `/_otel/status` 从一开始就一致。
2. **再在 `opentelemetryPlugin()` 中补请求侧行为**：例如 `ignorePaths`、`capture`、日志桥接和运行期附加标签。
3. **如果两处都写了 `endpoint / protocol / headers`，尽量保持一致**：避免“启动时一个地址、运行时另一个地址”的认知偏差。

### `endpoint` / `protocol` 速查

| 目标                | 推荐配置                                | `protocol`       | 结果                         |
| ------------------- | --------------------------------------- | ---------------- | ---------------------------- |
| 不导出任何数据      | 不写 `endpoint`，或显式写 `"none"`      | —                | SDK 安全 noop / 不上报       |
| 本地文件调试        | `"./otel-data"`                         | —                | 按 `pid` 写入 `*.jsonl` 文件 |
| OTLP HTTP Collector | `"http://otel-collector.internal:4318"` | `"http"`（默认） | 通过 OTLP/HTTP 上报          |
| OTLP gRPC Collector | `"otel-collector.internal:4317"`        | `"grpc"`         | 通过 gRPC h2c 上报           |

---

## 不配置上报地址会怎样？

| 场景                          | endpoint 值 | 行为                                                                  |
| ----------------------------- | ----------- | --------------------------------------------------------------------- |
| 未配置任何 endpoint           | `"none"`    | **SDK 启动但不导出数据**（auto-instrumentation 仍生效，但无遥测输出） |
| 配置了地址但 Collector 不可达 | 配置值      | SDK 内部 batch 超时后丢弃，控制台无错误                               |
| `enabled: false`              | —           | 完全 no-op，不初始化 SDK                                              |

> ✅ **安全默认值**——未配置 endpoint 时不会向任何地址发送数据，也不会写入本地文件。
> 要启用上报，可以：
>
> - 在 `package.json` `vext.otel.*` 中配置（推荐，预加载阶段即生效）
> - 或在 `opentelemetryPlugin({...})` 中配置（setup 阶段追加/覆盖导出器）

---

## 本地测试（无需 Docker）

不想装 Jaeger/Collector？可以将数据导出到**本地文件**，直接看原始数据格式。

### 方案一：导出到本地文件（推荐）

在项目 `package.json` 中配置上报地址（由 SDK 初始化脚本读取，控制实际导出）：

```json
{
  "vext": {
    "otel": {
      "endpoint": "./otel-data"
    }
  }
}
```

> `package.json vext.otel.endpoint` 是 VextJS 模式下**推荐的预加载配置源**，能让启动阶段和运行阶段从一开始就保持一致。
> 如果在 `opentelemetryPlugin({...})` 里再次传入 `endpoint / protocol / headers`，会在 setup 阶段继续追加或覆盖导出配置。相对路径仍基于 `process.cwd()` 解析。

创建插件（保持 `serviceName` 与 `package.json` 一致即可）：

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({ serviceName: "my-app" });
```

```bash
vext dev
# 发起几个请求后查看文件（文件名会带当前进程 pid）
cat ./otel-data/traces.*.jsonl
cat ./otel-data/metrics.*.jsonl
cat ./otel-data/logs.*.jsonl
```

插件自动创建目录；为避免 cluster / 多 worker 进程并发写同一文件，当前实现会按 `process.pid` 分文件写入：

- `traces.<pid>.jsonl`
- `metrics.<pid>.jsonl`
- `logs.<pid>.jsonl`

每行均为一条 JSON 记录，可通过 glob 合并查看。

**`traces.<pid>.jsonl` 示例（每行一条 Span）：**

```json
{
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "parentId": null,
  "name": "GET /users/:id",
  "id": "00f067aa0ba902b7",
  "kind": 1,
  "timestamp": 1743431641234000,
  "duration": 45230,
  "attributes": {
    "http.method": "GET",
    "http.route": "/users/:id",
    "http.status_code": 200,
    "http.request_id": "my-app-a1b2c3d4",
    "vext.service": "my-app",
    "http.url": "http://localhost:3000/users/42",
    "net.peer.ip": "127.0.0.1"
  },
  "status": { "code": 0 },
  "events": [],
  "resource": {
    "service.name": "my-app",
    "service.version": "1.0.0",
    "deployment.environment": "development"
  }
}
```

**`metrics.<pid>.jsonl` 示例（每行一批指标）：**

```json
{
  "timestamp": "2026-04-02T10:30:00.000Z",
  "metrics": [
    {
      "descriptor": { "name": "http.server.duration", "unit": "ms" },
      "dataPointType": "HISTOGRAM",
      "dataPoints": [
        {
          "attributes": {
            "http.method": "GET",
            "http.route": "/users/:id",
            "http.status_code": 200
          },
          "count": 5,
          "sum": 225,
          "min": 12,
          "max": 89
        }
      ]
    },
    {
      "descriptor": { "name": "http.server.request.total" },
      "dataPointType": "SUM",
      "dataPoints": [
        {
          "attributes": {
            "http.method": "GET",
            "http.route": "/users/:id",
            "http.status_code": 200
          },
          "value": 5
        }
      ]
    }
  ]
}
```

### 方案二：本地 Jaeger（有 Docker 时）

```bash
docker run -d --name jaeger -p 4318:4318 -p 16686:16686 \
  -e COLLECTOR_OTLP_ENABLED=true jaegertracing/all-in-one:latest
```

在项目 `package.json` 中配置本地 Jaeger：

```json
{
  "vext": {
    "otel": {
      "endpoint": "http://localhost:4318"
    }
  }
}
```

插件保持最简即可：

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({ serviceName: "my-app" });
```

```bash
vext dev
curl http://localhost:3000/users
open http://localhost:16686
```

---

## 其他框架接入

Vext 官网只保留 **VextJS** 场景的接入说明。

如果你需要查看以下内容：

- Egg.js / Koa / Express / Hono / Fastify 的接入方式
- `initOtel()` 的 CJS 预加载模式
- 多框架 `HttpOtelOptions` / `startAttributes` / `endAttributes` / `metrics.labels` / `createEggMiddleware` 说明
- 完整的发布记录与版本差异

请直接查看 GitHub 仓库：

- [`vextjs/vextjs-plugins`](https://github.com/devcodex-labs/opentelemetry)

建议优先阅读仓库中的：

- `@devcodex/opentelemetry/README.md`
- `@devcodex/opentelemetry/changelogs/`

## `/_otel/status` 状态检查接口

用于验证 OTel SDK 当前运行状态：

```bash
curl http://localhost:3000/_otel/status
```

```json
{
  "sdk": "initialized",
  "serviceName": "my-app",
  "exportMode": "otlp-grpc",
  "exportTarget": "otel-collector.internal:4317",
  "protocol": "grpc",
  "autoInstrumentation": true,
  "samplingRatio": 1
}
```

| 字段                  | 说明                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `sdk`                 | `"initialized"` = SDK 正常 / `"noop"` = SDK 未初始化                                           |
| `serviceName`         | 当前生效的服务名                                                                               |
| `exportMode`          | `"otlp-grpc"` = h2c gRPC / `"otlp-http"` = HTTP OTLP / `"file"` = 本地文件 / `"none"` = 未配置 |
| `exportTarget`        | 当前生效的上报目标（未配置时为 `"none"`）                                                      |
| `protocol`            | 当前导出协议（`"http"` / `"grpc"`）                                                            |
| `autoInstrumentation` | 是否启用了自动检测（MongoDB/Redis/MySQL 等）                                                   |
| `samplingRatio`       | 当前采样率                                                                                     |

**VextJS**：启动后自动注册，无需手动配置。

**生产环境**建议在网关层限制内网访问。

---

## 上报的数据内容

### Traces（链路追踪）

每个 HTTP 请求产生一条 Span，包含：

| 属性               | 示例值                             | 说明                                 |
| ------------------ | ---------------------------------- | ------------------------------------ |
| `http.method`      | `"GET"`                            | HTTP 方法                            |
| `http.route`       | `"/users/:id"`                     | 路由模板（低基数，安全用于指标聚合） |
| `http.status_code` | `200`                              | 响应状态码                           |
| `http.request_id`  | `"my-app-a1b2c3d4"`                | vext 请求 ID                         |
| `vext.service`     | `"my-app"`                         | 服务名称                             |
| `http.url`         | `"http://localhost:3000/users/42"` | 完整请求 URL                         |
| `net.peer.ip`      | `"127.0.0.1"`                      | 客户端 IP                            |

安装 `@opentelemetry/auto-instrumentations-node` 后，数据库操作、HTTP 外部调用等会自动产生子 Span。

### Metrics（指标监控）

| 指标名                        | 类型               | 标签                       | 说明                                        |
| ----------------------------- | ------------------ | -------------------------- | ------------------------------------------- |
| `http.server.duration`        | Histogram（ms）    | method, route, status_code | 请求耗时分布                                |
| `http.server.request.total`   | Counter            | method, route, status_code | 请求总数                                    |
| `http.server.active_requests` | UpDownCounter      | method                     | 当前并发请求数                              |
| `http.server.request.size`    | Histogram（bytes） | method, route              | 请求体大小分布（Content-Length 存在时记录） |
| `http.server.response.size`   | Histogram（bytes） | method, status_code        | 响应体大小分布（Content-Length 存在时记录） |

> **`ignorePaths` 同时抑制 Trace 和 Metrics**——被忽略路径（如 `/health`）不会产生任何 Span 或指标数据，不会在监控面板产生噪声。

**Node.js Runtime 指标**（通过 `@opentelemetry/instrumentation-runtime-node` 自动上报）：

| 指标名                                   | 说明                            |
| ---------------------------------------- | ------------------------------- |
| `process.cpu.usage`                      | 进程 CPU 使用率                 |
| `process.memory.usage`                   | 堆内存使用量（heap_used / rss） |
| `nodejs.eventloop.lag`                   | 事件循环延迟                    |
| `nodejs.gc.duration` / `nodejs.gc.count` | GC 耗时和次数                   |

### Logs（日志关联）

每条请求日志自动注入 `trace_id` + `span_id`：

```json
{
  "msg": "GET /users/42 200 45ms | 127.0.0.1",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "requestId": "my-app-a1b2c3d4"
}
```

通过 `trace_id` 可在 Grafana Loki / ELK 中关联日志与链路。

**结构化日志（Schema A + Schema B）**

当日志需同时落地（Schema A）并上报至 OTLP Collector（Schema B）时，使用 `@devcodex/opentelemetry/log` 提供的两个工厂函数：

- `createStructuredLogFormatter` — Schema A 结构化 JSON 格式化器（固定字段顺序）
- `createOtelLogBridge` — Schema B OTel LogRecord 桥接（通过 `globalThis._otelLogger`）

**Schema A — 落地日志 JSON（完整字段）**

```json
{
  "timestamp": "2026-04-03 10:00:00",
  "level": "INFO",
  "message": "用户创建成功",
  "service_name": "my-app",
  "env": "production",
  "host": "pod-abc123",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span": "POST /users",
  "endpoint": "/users",
  "latency_ms": 45,
  "user_id": "u_123",
  "feature_flag": "new-checkout",
  "exception.type": "",
  "exception.message": "",
  "exception.stacktrace": ""
}
```

**VextJS 推荐写法**

在 VextJS 中，通常不需要照搬其他框架的 logger formatter / middleware 拼装方式。更推荐：

1. 在 `opentelemetryPlugin()` 中开启 `logs.bridgeAppLogger`
2. 在 `config.logger.mixin` 中补稳定字段

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({
  serviceName: "my-app",
  logs: {
    bridgeAppLogger: true,
    globalAttributes: { "app.version": "1.0.0" },
  },
});
```

```typescript
// src/config/default.ts
import os from "node:os";

export default {
  logger: {
    mixin() {
      return {
        service_name: "my-app",
        env: process.env.NODE_ENV ?? "development",
        host: os.hostname(),
      };
    },
  },
};
```

> 如果你需要 Egg.js / Koa / Express / Hono / Fastify 的日志桥接写法，请直接查看 GitHub README；官网这里不再展开多框架分支。

---

## 配置方式（VextJS）

VextJS 的 OTel 配置分两层，目的不同：

### 第一层：预加载阶段默认导出配置（`package.json`，推荐）

由 SDK 初始化脚本（`instrumentation.ts`，通过 `vext.preload` 在应用代码前执行）优先读取，决定**进程启动时的默认导出配置**。
如果后续又在 `opentelemetryPlugin({...})` 里传入 `endpoint / protocol / headers`，插件阶段会继续追加或覆盖 exporter。

配置读取优先级（高 → 低）：

1. `package.json` `vext.otel.*`
2. OpenTelemetry 标准环境变量（如 `OTEL_SERVICE_NAME`、`OTEL_EXPORTER_OTLP_ENDPOINT`）
3. 项目 `package.json.name`（仅用于 `serviceName` 回退）
4. 内置默认值（`serviceName: "vext-app"`、`protocol: "http"`、`endpoint: "none"`）

```json
{
  "vext": {
    "otel": {
      "endpoint": "http://otel-collector.internal:4318",
      "headers": { "api-key": "YOUR_KEY" },
      "sampling": { "ratio": 1.0 }
    }
  }
}
```

### 第二层：运行期插件行为（`src/plugins/otel.ts`）

插件层负责运行期 tracer / meter / logger 行为，例如 `ignorePaths`、指标桶、日志桥接，以及在 setup 阶段追加/覆盖 exporter。

```typescript
export default opentelemetryPlugin({
  serviceName: "my-app",
  endpoint: "http://otel-collector.internal:4318",
  protocol: "http",
  headers: { "api-key": "YOUR_KEY" },
  tracing: {
    ignorePaths: ["/health", "/_otel/status"],
  },
  logs: {
    bridgeAppLogger: true,
  },
});
```

> 插件层的 `endpoint/protocol/headers` 建议与 `package.json vext.otel` 保持一致，方便 `/_otel/status` 与实际导出目标统一。

---

## 声明式采集（`capture`）

如果你只想补充少量 headers / query / params / body 字段，不想为每个字段都手写 `startAttributes` / `endAttributes` resolver，可以直接使用 `capture`：

```typescript
export default opentelemetryPlugin({
  serviceName: "my-app",
  capture: {
    headers: ["x-request-id", "x-tenant-id"],
    query: ["page", "limit"],
    params: true,
    body: ["orderNo", "customer.id"],
  },
  metrics: {
    labels: (_ctx, req) => ({
      "tenant.id": req.headers["x-tenant-id"] ?? "default",
    }),
  },
});
```

生成的属性前缀固定为：

- `http.request.header.*`
- `http.request.query.*`
- `http.request.param.*`
- `http.request.body.*`

关键约束：

- `query: true` / `params: true` 表示**显式开启全量模式**；默认并不会自动采全量。
- `headers` / `body` 仍建议只做白名单采集，不提供默认全量模式，避免误采 `authorization`、`cookie`、密码、手机号等敏感字段。
- `capture` 生成的是 **Span attributes**，不会自动进入 `metrics.labels`；指标维度仍应单独通过 `metrics.labels` 提供，并保持低基数。

---

## 完整配置参考

### opentelemetryPlugin() 选项

```typescript
opentelemetryPlugin({
  // ── 基础 ───────────────────────────────────────────
  serviceName: "my-app",
  endpoint: "http://collector:4318",
  protocol: "http",
  headers: { "api-key": "KEY" },

  // ── 追踪 ───────────────────────────────────────────
  tracing: {
    enabled: true,
    ignorePaths: ["/health", "/_otel/status", /^\/internal\//],
    spanNameResolver: (req) => `${req.method} ${req.route ?? req.path}`,
    startAttributes: (_ctx, req) => ({
      "user.id": req.headers["x-user-id"] ?? "",
      "tenant.id": req.headers["x-tenant-id"] ?? "",
    }),
    endAttributes: (_ctx, req) => ({
      "http.request_id_present": Boolean(req.requestId),
    }),
  },

  // ── 指标 ───────────────────────────────────────────
  metrics: {
    enabled: true,
    durationBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    labels: (_ctx, req) => ({
      "tenant.id": req.headers["x-tenant-id"] ?? "default",
    }),
  },

  // ── 声明式采集 ─────────────────────────────────────────
  capture: {
    headers: ["x-request-id", "x-tenant-id"],
    query: ["page", "limit"],
    params: true,
    body: ["orderNo", "customer.id"],
  },

  // ── 生命周期 ─────────────────────────────────────────
  lifecycle: {
    onStart: (_ctx, req) => {
      req.logger.info({ requestId: req.requestId }, "request started");
    },
    onEnd: (ctx, req, info) => {
      if (info.statusCode >= 500) {
        req.logger.error(
          { traceId: info.traceId },
          `${ctx.method} ${ctx.route ?? ctx.path} failed in ${info.latencyMs}ms`,
        );
      }
    },
  },

  // ── 日志 ─────────────────────────────────────────────
  logs: {
    bridgeAppLogger: true,
  },
});
```

> 当前统一公开模型是 `startAttributes / endAttributes / metrics.labels / lifecycle`。
> VextJS 适配器的 `raw` 参数就是 `req`；其他框架则会透传各自的原始上下文（如 Express 的 `{ req, res }`、Koa/Egg 的 `ctx`）。

### package.json `vext.otel`

```json
{
  "name": "my-app",
  "vext": {
    "otel": {
      "serviceName": "my-app",
      "endpoint": "http://collector:4318",
      "protocol": "http",
      "headers": { "api-key": "KEY" },
      "sampling": { "ratio": 1.0 }
    }
  }
}
```

### 环境变量

> 以下环境变量由 OpenTelemetry SDK 原生支持，但 VextJS 场景推荐优先通过 `package.json vext.otel` 固化导出配置。

| 变量                          | 默认值                    | 说明                     |
| ----------------------------- | ------------------------- | ------------------------ |
| `OTEL_TRACES_SAMPLER`         | `"parentbased_always_on"` | 采样策略                 |
| `OTEL_TRACES_SAMPLER_ARG`     | `"1"`                     | 采样率（如 `0.1` = 10%） |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000`                   | 指标导出间隔（毫秒）     |
| `OTEL_LOG_LEVEL`              | `"info"`                  | SDK 日志级别             |

---

## 接入后端

### 本地开发

| 后端               | 启动方式                                                                                            | endpoint 配置                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **无（文件导出）** | 不需要 Docker                                                                                       | `package.json vext.otel.endpoint: "./otel-data"`           |
| **Jaeger**         | `docker run -d -p 4318:4318 -p 16686:16686 -e COLLECTOR_OTLP_ENABLED=true jaegertracing/all-in-one` | `package.json vext.otel.endpoint: "http://localhost:4318"` |
| **Grafana LGTM**   | `docker run -d -p 3000:3000 -p 4318:4318 grafana/otel-lgtm`                                         | `package.json vext.otel.endpoint: "http://localhost:4318"` |

### 云厂商

| 厂商              | endpoint                                    | headers                              |
| ----------------- | ------------------------------------------- | ------------------------------------ |
| **New Relic**     | `https://otlp.nr-data.net:4318`             | `{ "api-key": "LICENSE_KEY" }`       |
| **Grafana Cloud** | `https://otlp-gateway-....grafana.net/otlp` | `{ "Authorization": "Basic TOKEN" }` |
| **Datadog**       | `http://dd-agent-host:4318`                 | —                                    |
| **阿里云 ARMS**   | 参考阿里云 OTLP 接入文档                    | 参考文档                             |

> 云厂商 token 建议通过环境变量注入（K8s Secret），不要硬编码到代码中。

---

## 自动检测（Auto-Instrumentation）

默认接入下，`@devcodex/opentelemetry` 已自带 `@opentelemetry/auto-instrumentations-node`，SDK 会自动 patch 常见库，**无需修改任何业务代码**即可获得数据库查询、HTTP 外调、消息队列等的链路追踪。

### 安装

默认使用 `vext start` / `vext dev` 启动后即可自动生效。

如果你的**应用代码**需要直接 `import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"` 做深度定制，再把它声明为应用自己的直接依赖即可。

### 支持的库

| 类别         | 库                                | 自动追踪内容                 |
| ------------ | --------------------------------- | ---------------------------- |
| **数据库**   | MongoDB（`mongodb` / `mongoose`） | 查询操作、集合名、耗时       |
|              | PostgreSQL（`pg`）                | SQL 语句、表名、耗时         |
|              | MySQL（`mysql` / `mysql2`）       | SQL 语句、表名、耗时         |
|              | Redis（`ioredis` / `redis`）      | 命令、key、耗时              |
| **HTTP**     | Node.js `http` / `https`          | 外部 HTTP 调用、URL、状态码  |
|              | `undici` / `fetch`                | 同上，Node.js 20+ 内置 fetch |
| **消息队列** | `amqplib`（RabbitMQ）             | 队列名、消息发送/消费        |
|              | `kafkajs`                         | Topic、消息发送/消费         |
| **缓存**     | `memcached`                       | 操作命令、key                |
| **RPC**      | `@grpc/grpc-js`                   | 方法名、状态码               |
| **其他**     | `dns`                             | DNS 解析                     |
|              | `net`                             | TCP 连接                     |

> 完整列表见 [@opentelemetry/auto-instrumentations-node](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node)。

### 效果示例

安装后，一次 `GET /users/:id` 请求在 Jaeger 中可能产生如下 Span 树：

```
GET /users/:id                     (http, 45ms)
├── mongodb.find users             (db, 12ms)
├── redis.GET user:cache:42        (cache, 2ms)
└── HTTP GET https://api.xxx/verify (http, 28ms)
```

**无需任何代码改动**——SDK 在进程启动时（`--import`）自动 patch 了 `mongodb`、`ioredis`、`http` 等模块。

### 禁用特定检测

如果某个自动检测引起问题或不需要，可在插件中覆盖 instrumentation.ts 配置：

```typescript
// src/instrumentation.ts（自定义，替代内置版本）
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  instrumentations: getNodeAutoInstrumentations({
    // 禁用 fs 检测（日志噪音大）
    "@opentelemetry/instrumentation-fs": { enabled: false },
    // 禁用 dns 检测
    "@opentelemetry/instrumentation-dns": { enabled: false },
  }),
});
sdk.start();
export {};
```

然后在 `package.json` 中指向自定义的 instrumentation：

```json
{ "vext": { "preload": "./dist/instrumentation.js" } }
```

### 未安装时的行为

如果未安装 `@opentelemetry/auto-instrumentations-node`：

- 控制台输出一行 warning 提示
- HTTP 中间件层的追踪（Span 属性标注、指标统计、日志关联）**仍然正常**
- 仅缺失数据库 / 外部 HTTP 等深层 Span（不影响应用运行）

```
[vextjs-opentelemetry/instrumentation] @opentelemetry/auto-instrumentations-node is not installed.
  npm install @opentelemetry/auto-instrumentations-node
```

---

## 高级用法

### 手动追踪业务操作（withSpan）

`withSpan()` 是追踪自定义业务操作的推荐方式。它对 `tracer.startActiveSpan()` 做了 try/catch/finally 封装，自动处理 `span.end()`、`span.recordException()`、`span.setStatus()` 三件最容易遗漏的事。

#### VextJS 插件（通过 `app.otel.withSpan`）

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post("/payments", async (req, res) => {
    // ① 最简：完全不接触 span（仅追踪生命周期）
    const resultBasic = await req.app.otel!.withSpan("payment.process", () =>
      processPayment(req.body.id),
    );

    // ② 带静态初始属性
    const resultWithAttrs = await req.app.otel!.withSpan(
      "payment.process",
      () => processPayment(req.body.id),
      {
        attributes: { "payment.provider": "stripe", "payment.currency": "USD" },
      },
    );

    // ③ 动态属性（依赖执行结果时，通过回调参数访问 span）
    const resultWithDynamicAttrs = await req.app.otel!.withSpan(
      "payment.process",
      async (span) => {
        const res = await processPayment(req.body.id);
        span.setAttribute("payment.result", res.status);
        return res;
      },
    );

    res.json(resultWithDynamicAttrs);
  });
});
```

**行为说明**：

| 场景         | 自动行为                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| 回调正常返回 | `span.end()` 自动调用                                                           |
| 回调抛出异常 | `span.recordException(err)` + `span.setStatus(ERROR)` + `span.end()` + re-throw |
| SDK 未初始化 | Noop span，零 overhead（OTel API 契约保证）                                     |

### 底层 API（自定义 SpanKind / Processor 等高级场景）

需要精细控制 span 类型或自定义处理时，可直接使用 `tracer`：

```typescript
import { SpanStatusCode } from "@opentelemetry/api";
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/users/:id",
    { validate: { param: { id: "string" } } },
    async (req, res) => {
      const span = req.app.otel!.tracer.startSpan("db.user.findById", {
        attributes: {
          "db.system": "mongodb",
          "user.id": req.valid("param").id,
        },
      });
      try {
        const user = await app.services.user.findById(req.valid("param").id);
        span.setStatus({ code: SpanStatusCode.OK });
        res.json(user);
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
});
```

### 自定义业务指标

```javascript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "business-metrics",
  dependencies: ["opentelemetry"],
  setup(app) {
    const meter = app.otel.meter;
    app.extend("businessMetrics", {
      orderCreated: meter.createCounter("business.order.created"),
      orderAmount: meter.createHistogram("business.order.amount", {
        unit: "cents",
      }),
    });
  },
});
```

### 采样（降低开销）

**方式一：`package.json` 代码级配置（推荐）**

instrumentation 在 SDK 初始化时读取 `vext.otel.sampling.ratio`，
自动使用 `ParentBasedSampler(TraceIdRatioBasedSampler(ratio))`：

```json
{
  "vext": {
    "otel": {
      "endpoint": "http://collector:4318",
      "sampling": { "ratio": 0.1 }
    }
  }
}
```

**方式二：环境变量（运行时覆盖）**

```bash
# 无需改代码，可在 CI/CD 或部署脚本中注入
OTEL_TRACES_SAMPLER=traceidratio OTEL_TRACES_SAMPLER_ARG=0.1 vext start
```

### Cluster 多进程

```bash
VEXT_CLUSTER=1 vext start  # vext 自动为每个 Worker 注入 OTel
```

### 自定义 instrumentation

完全替换内置 SDK 初始化：

```typescript
// src/instrumentation.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-node";

const sdk = new NodeSDK({
  sampler: new TraceIdRatioBasedSampler(0.1),
  // ... 自定义配置
});
sdk.start();
export {};
```

```json
{ "vext": { "preload": "./dist/instrumentation.js" } }
```

---

## 日志字段规划

VextJS + @devcodex/opentelemetry 支持两层日志输出，各有侧重：

- **A. 落地日志（stdout / file JSON）**：业务字段清晰可读，便于人工排查和日志聚合（ELK/Loki）
- **B. OTel Logs（LogRecord → Collector）**：轻量级，通过 `trace_id` 关联完整链路

### A. 落地日志字段（stdout / file JSON）

通过 `config.logger.mixin` 注入 Resource 级和 Span 级上下文：

```typescript
// src/config/default.ts
import os from "node:os";

let getActiveSpan: (() => unknown) | undefined;
try {
  const api = await import("@opentelemetry/api");
  getActiveSpan = api.trace.getActiveSpan.bind(api.trace);
} catch {}

export default {
  logger: {
    level: "info",
    mixin() {
      const fields: Record<string, unknown> = {
        // Resource 级字段（每条日志都有）
        service_name: "my-app",
        env: process.env.NODE_ENV ?? "development",
        host: os.hostname(),
      };

      // Span 级字段（请求上下文中有值时注入）
      if (getActiveSpan) {
        const span = getActiveSpan() as
          | { isRecording?: () => boolean; name?: string }
          | undefined;
        if (span?.isRecording?.()) {
          fields.span = span.name; // "GET", "mongodb.find", "redis.GET" 等
        }
      }

      return fields;
    },
  },
};
```

输出示例：

```json
{
  "level": 30,
  "time": 1743431641234,
  "service_name": "my-app",
  "env": "production",
  "host": "web-pod-a1b2c3",
  "requestId": "my-app-19f8d0dd",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "span": "GET",
  "msg": "→ GET /users/42 200 45ms"
}
```

> `requestId`、以及写入 `requestContext` 的 `traceId` / `spanId` 会由框架内置 provider 自动注入为 `requestId`、`trace_id`、`span_id`；不需要在用户 mixin 中重复配置。

#### 字段对照表

| 字段           | 来源                           | 配置方式                                      |
| -------------- | ------------------------------ | --------------------------------------------- |
| `timestamp`    | Vext logger 自动               | 无需配置                                      |
| `level`        | Vext logger 自动               | 无需配置                                      |
| `msg`          | `logger.info("...")`           | 无需配置                                      |
| `requestId`    | 框架 ALS → mixin 自动          | 无需配置                                      |
| `trace_id`     | otel 中间件 → ALS → mixin 自动 | 无需配置                                      |
| `span_id`      | otel 中间件 → ALS → mixin 自动 | 无需配置                                      |
| `service_name` | `config.logger.mixin`          | 用户 mixin 注入                               |
| `env`          | `config.logger.mixin`          | 用户 mixin 注入                               |
| `host`         | `config.logger.mixin`          | 用户 mixin 注入                               |
| `span`         | `trace.getActiveSpan().name`   | 用户 mixin 注入                               |
| `endpoint`     | access log 中的 `req.route`    | 自动包含在请求日志 msg 中                     |
| `latency_ms`   | access log                     | 自动包含在请求日志 msg 中                     |
| `user_id`      | 业务代码                       | `logger.info({ user_id: "..." }, msg)`        |
| `feature.flag` | 业务代码                       | `logger.info({ "feature.flag": "..." }, msg)` |
| `exception.*`  | `logger.error(err)`            | Vext logger serializer 自动展开               |

### B. OTel Logs（LogRecord → Collector）

Vext 默认 logger 不依赖第三方 logger，因此 logger-specific auto instrumentation 不会自动捕获 `app.logger`。如需输出 OTel Logs，可通过 `@devcodex/opentelemetry` 的 `app.setLogger()` 桥接，或自定义插件包装当前 logger：

- **`trace_id` / `span_id`**：从 `requestContext` 或 active span 写入 LogRecord
- **`severity_text`**：从 Vext logger level 映射
- **`body`**：日志消息内容
- **`service.name`**：来自 Resource（instrumentation.ts 已配置）
- **`attributes`**：结构化日志字段映射为 LogRecord attributes

用户 mixin 注入的字段（如 `service_name`、`host`、`span`）会**自动出现在 LogRecord.attributes** 中。

::: tip OTel Logs 最佳实践
避免在 LogRecord attributes 中放入所有落地日志字段。OTel Logs 通过 `trace_id` 关联 Trace 即可看到 `endpoint`、`latency_ms`、`user.id` 等完整上下文。保持 LogRecord 轻量有助于控制 Collector 流量。
:::

### C. 深层字段（自动出现在子 Span 中）

以下字段由 `@opentelemetry/auto-instrumentations-node` 自动采集，无需手动配置：

```
GET /users/:id                        (http, 45ms)  ← user.id, tenant.id 在此
├── mongodb.find users                (db, 12ms)    ← db.statement 自动
├── redis.GET user:cache:42           (cache, 2ms)  ← cache.system 自动
└── HTTP GET https://api.xxx/verify   (http, 28ms)  ← 自动
```

| 字段           | 来源                                 | 出现位置                   |
| -------------- | ------------------------------------ | -------------------------- |
| `db.statement` | DB instrumentation 自动              | 数据库子 Span attributes   |
| `db.system`    | DB instrumentation 自动              | 数据库子 Span attributes   |
| `cache.system` | Redis/Memcached instrumentation 自动 | 缓存子 Span attributes     |
| `http.url`     | HTTP instrumentation 自动            | 外部调用子 Span attributes |

> 通过 `trace_id` 在 Jaeger / Grafana Tempo 中查看完整调用链路即可关联这些深层字段。

---

## 生产最佳实践

1. **配置上报地址** — 未配置时不会上报（安全默认值），但也意味着无可观测性数据
2. **`shutdown.timeout: 60`** — 确保 SDK 有足够时间 flush 数据
3. **限制 `/_otel/status`** — 当前 VextJS 适配器会自动注册该路由，生产环境请在网关层限制为内网访问
4. **不要在 Span 中记录敏感信息** — 密码、Token、身份证号等
5. **采样** — 高并发服务用 `OTEL_TRACES_SAMPLER=traceidratio`
6. **部署 Collector** — 应用 → Collector → 后端，解耦 + 缓冲

```
应用（N 个） ──OTLP──► Collector ──► Jaeger / Prometheus / Grafana
```

---

## 常见问题

### Q: `/_otel/status` 返回 `"sdk": "noop"`

① 使用 `vext start/dev` 启动 ② `@devcodex/opentelemetry` 在 dependencies 中 ③ SDK 包已安装 ④ `package.json vext.otel` 配置已生效。

### Q: endpoint 显示 localhost 但我配了其他地址

① 检查 `package.json` `vext.otel.endpoint` ② 确认插件里的 `endpoint/protocol/headers` 与 `package.json` 保持一致 ③ 确认用 `vext start/dev` 启动

### Q: 日志没有 trace_id

先确认 `/_otel/status` 返回 `"sdk": "initialized"`。VextJS 场景下，`trace_id` 依赖 preload 阶段 SDK 初始化 + 插件正常接入，两者缺一不可。

### Q: 后端收不到数据

① `/_otel/status` 确认 `sdk: "initialized"` + `endpoint` 正确 ② 服务日志中确认 `[otel] ... export SUCCESS (grpc-status:0)` ③ 等 30 秒（批量上报延迟）④ 用接 Jaeger/LGTM 本地调试确认数据格式

### Q: `[otel] ... export FAILED: grpcSend timeout`

服务器到采集器的 h2c gRPC 连接受阻。检查：① 采集器地址和端口可达 ② 采集器服务正常运行 ③ 网络防火墙/安全组规则 ④ 如在 Docker/K8s 内，使用 Service DNS 而非 localhost

### Q: 我直接用 `node dist/server.js` 启动，为什么 SDK 没生效？

因为 VextJS 的“零配置接入”依赖 CLI 在启动前自动扫描依赖包里的 `vext.preload` 并注入 `--import`。

可选做法：

1. **推荐**：继续使用 `vext dev` / `vext start`
2. **自定义 Node 启动命令**：手动补上 `--import @devcodex/opentelemetry/instrumentation`

```bash
node --import @devcodex/opentelemetry/instrumentation dist/server.js
```

### Q: 测试环境如何禁用

```json
{
  "vext": {
    "otel": {
      "endpoint": "none"
    }
  }
}
```

或在测试环境不加载该插件。

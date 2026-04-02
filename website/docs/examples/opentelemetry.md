# OpenTelemetry 可观测性

`vextjs-opentelemetry` 是 VextJS 官方 OpenTelemetry 插件，**1 文件 2 行**即可获得 Traces + Metrics + Logs 三大支柱。

---

## 快速开始

### 1. 安装

```bash
npm install vextjs-opentelemetry @opentelemetry/api \
            @opentelemetry/sdk-node \
            @opentelemetry/exporter-trace-otlp-http \
            @opentelemetry/exporter-metrics-otlp-http
```

### 2. 创建插件

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "vextjs-opentelemetry";
export default opentelemetryPlugin({ serviceName: "my-app" });
```

### 3. 启动

```bash
vext start    # 生产模式
vext dev      # 开发模式
```

> `vext start` / `vext dev` 自动注入 SDK（通过 [`vext.preload` 机制](/guide/preload)，无需手动配置 `--import`）。
> **默认不上报、不存文件**——需在插件参数或 `vext.config.ts` 中显式配置 `otlpEndpoint`，
> 数据才会发送到指定后端。

### 4. 验证

```bash
curl http://localhost:3000/_otel/status
```

```json
{
  "sdk": "initialized",
  "serviceName": "my-app",
  "exportMode": "otlp",
  "endpoint": "http://otel-collector.internal:4318",
  "autoInstrumentation": true
}
```

**Done.** 所有遥测功能已自动启用。

---

## 不配置上报地址会怎样？

| 场景 | endpoint 值 | 行为 |
|------|------------|------|
| 未配置任何 endpoint | `"none"` | **SDK 启动但不导出数据**（auto-instrumentation 仍生效，但无遥测输出）|
| 配置了地址但 Collector 不可达 | 配置值 | SDK 内部 batch 超时后丢弃，控制台无错误 |
| `enabled: false` | — | 完全 no-op，不初始化 SDK |

> ✅ **安全默认值**——未配置 endpoint 时不会向任何地址发送数据，也不会写入本地文件。要启用上报，请在插件配置或 `package.json` `vext.otel.endpoint` 中显式指定上报地址。

---

## 本地测试（无需 Docker）

不想装 Jaeger/Collector？可以将数据导出到**本地文件**，直接看原始数据格式。

### 方案一：导出到本地文件（推荐）

```typescript
// src/plugins/otel.ts
import { join } from "node:path";
import { opentelemetryPlugin } from "vextjs-opentelemetry";

export default opentelemetryPlugin({
  serviceName: "my-app",
  otlpEndpoint: join(process.cwd(), "otel-data"),  // 存储到项目下 otel-data/ 目录
});
```

同时在 `package.json` 中配置（供 instrumentation.ts 在 SDK 初始化时读取）：

```json
{
  "vext": {
    "otel": {
      "endpoint": "./otel-data"
    }
  }
}
```

> `package.json` 中使用相对路径 `./otel-data`（JSON 无法使用 JS 表达式，插件自动基于 `process.cwd()` 解析）。
> 插件代码中推荐使用 `join(process.cwd(), "otel-data")` 获得更好的可读性。

```bash
vext dev
# 发起几个请求后查看文件
cat ./otel-data/traces.jsonl
cat ./otel-data/metrics.jsonl
```

插件自动创建目录，每次请求的 Span 追加到 `traces.jsonl`（每行一个 JSON），指标定期追加到 `metrics.jsonl`。

**traces.jsonl 示例（每行一条 Span）：**

```json
{
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "parentId": undefined,
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

**metrics.jsonl 示例（每行一批指标）：**

```json
{
  "timestamp": "2026-04-02T10:30:00.000Z",
  "metrics": [
    {
      "descriptor": { "name": "http.server.duration", "unit": "ms" },
      "dataPointType": "HISTOGRAM",
      "dataPoints": [
        {
          "attributes": { "http.method": "GET", "http.route": "/users/:id", "http.status_code": 200 },
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
          "attributes": { "http.method": "GET", "http.route": "/users/:id", "http.status_code": 200 },
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

在插件中配置上报地址为本地 Jaeger：

```typescript
// src/plugins/otel.ts
export default opentelemetryPlugin({
  serviceName: "my-app",
  otlpEndpoint: "http://localhost:4318",
});
```

同时在 `package.json` 中配置：

```json
{ "vext": { "otel": { "endpoint": "http://localhost:4318" } } }
```

```bash
vext dev
curl http://localhost:3000/users
open http://localhost:16686  # Jaeger UI
```

---

## `/_otel/status` 状态检查接口

启动后自动注册，用于验证 OTel 状态。

```bash
curl http://localhost:3000/_otel/status
```

| 字段 | 说明 |
|------|------|
| `sdk` | `"initialized"` = SDK 正常 / `"noop"` = SDK 未初始化 |
| `serviceName` | 当前生效的服务名 |
| `exportMode` | `"otlp"` = 网络上报 / `"file"` = 本地文件 / `"none"` = 未配置上报（默认） |
| `endpoint` | 当前生效的上报目标（未配置时为 `"none"`） |
| `autoInstrumentation` | 是否启用了自动检测（HTTP/DB 等） |

**生产环境**建议在网关层限制内网访问，或 `statusEndpoint: false` 禁用。

---

## 上报的数据内容

### Traces（链路追踪）

每个 HTTP 请求产生一条 Span，包含：

| 属性 | 示例值 | 说明 |
|------|--------|------|
| `http.method` | `"GET"` | HTTP 方法 |
| `http.route` | `"/users/:id"` | 路由模板（低基数，安全用于指标聚合） |
| `http.status_code` | `200` | 响应状态码 |
| `http.request_id` | `"my-app-a1b2c3d4"` | vext 请求 ID |
| `vext.service` | `"my-app"` | 服务名称 |
| `http.url` | `"http://localhost:3000/users/42"` | 完整请求 URL |
| `net.peer.ip` | `"127.0.0.1"` | 客户端 IP |

安装 `@opentelemetry/auto-instrumentations-node` 后，数据库操作、HTTP 外部调用等会自动产生子 Span。

### Metrics（指标监控）

| 指标名 | 类型 | 标签 | 说明 |
|--------|------|------|------|
| `http.server.duration` | Histogram（毫秒） | method, route, status_code | 请求耗时分布 |
| `http.server.request.total` | Counter | method, route, status_code | 请求总数 |
| `http.server.active_requests` | UpDownCounter | method | 当前并发请求数 |

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

---

## 配置方式（二选一，可叠加）

### 方式一：插件参数（推荐）

```typescript
// src/plugins/otel.ts
export default opentelemetryPlugin({
  serviceName: "my-app",
  otlpEndpoint: "http://otel-collector.internal:4318",
  otlpHeaders: { "api-key": "YOUR_KEY" },
});
```

### 方式二：vext.config.ts

```typescript
// src/config/default.ts
export default {
  otel: {
    serviceName: "my-app",
    enabled: true,
    endpoint: "http://otel-collector:4318",
    headers: { "api-key": "KEY" },
  },
};
```

**优先级**：插件参数 > vext.config.ts > 默认值（无上报）

> **注意**：`package.json` 的 `vext.otel.endpoint` 字段供 SDK 初始化时读取（早于插件 setup），
> 建议与插件参数保持一致。不再支持通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 环境变量覆盖。

---

## 完整配置参考

### opentelemetryPlugin() 选项

```typescript
opentelemetryPlugin({
  // ── 基础 ───────────────────────────────────────────
  serviceName: "my-app",           // 服务名称
  enabled: true,                    // false 时完全 no-op

  // ── 上报 ───────────────────────────────────────────
  otlpEndpoint: "http://collector:4318",  // OTLP 地址
  // 或 join(process.cwd(), "otel-data")  // 存储到项目下 otel-data/ 目录
  otlpHeaders: { "api-key": "KEY" },      // 鉴权请求头

  // ── 状态检查 ───────────────────────────────────────
  statusEndpoint: "/_otel/status",  // 自定义路径，false 禁用

  // ── 追踪 ───────────────────────────────────────────
  tracing: {
    enabled: true,
    extraAttributes: (req) => ({    // 自定义 Span 属性
      "user.id": req.headers["x-user-id"] ?? "",
      "tenant.id": req.headers["x-tenant-id"] ?? "",
    }),
  },

  // ── 指标 ───────────────────────────────────────────
  metrics: {
    enabled: true,
    durationBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    customLabels: (req) => ({       // 自定义指标标签（避免高基数！）
      "tenant.id": req.headers["x-tenant-id"] ?? "default",
    }),
  },
});
```

### vext.config.ts

```typescript
// src/config/default.ts
export default {
  otel: {
    serviceName: "my-app",
    enabled: true,
    endpoint: "http://collector:4318",
    headers: { "api-key": "KEY" },
  },
};

// src/config/test.ts
export default {
  otel: { enabled: false },
};
```

### 环境变量

> 以下环境变量由 OpenTelemetry SDK 原生支持，**但本插件不再自动读取 endpoint/headers 相关的环境变量**。
> 上报地址和鉴权请求头请统一通过插件参数或 `package.json vext.otel` 配置。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OTEL_TRACES_SAMPLER` | `"parentbased_always_on"` | 采样策略 |
| `OTEL_TRACES_SAMPLER_ARG` | `"1"` | 采样率（如 `0.1` = 10%） |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` | 指标导出间隔（毫秒） |
| `OTEL_LOG_LEVEL` | `"info"` | SDK 日志级别 |

---

## 接入后端

### 本地开发

| 后端 | 启动方式 | endpoint 配置 |
|------|---------|---------------|
| **无（文件导出）** | 不需要 Docker | `otlpEndpoint: join(process.cwd(), "otel-data")` |
| **Jaeger** | `docker run -d -p 4318:4318 -p 16686:16686 -e COLLECTOR_OTLP_ENABLED=true jaegertracing/all-in-one` | `otlpEndpoint: "http://localhost:4318"` |
| **Grafana LGTM** | `docker run -d -p 3000:3000 -p 4318:4318 grafana/otel-lgtm` | `otlpEndpoint: "http://localhost:4318"` |

### 云厂商

| 厂商 | endpoint | headers |
|------|----------|---------|
| **New Relic** | `https://otlp.nr-data.net:4318` | `{ "api-key": "LICENSE_KEY" }` |
| **Grafana Cloud** | `https://otlp-gateway-....grafana.net/otlp` | `{ "Authorization": "Basic TOKEN" }` |
| **Datadog** | `http://dd-agent-host:4318` | — |
| **阿里云 ARMS** | 参考阿里云 OTLP 接入文档 | 参考文档 |

> 云厂商 token 建议通过环境变量注入（K8s Secret），不要硬编码到代码中。

---

## 自动检测（Auto-Instrumentation）

安装 `@opentelemetry/auto-instrumentations-node` 后，SDK 自动 patch 常见库，**无需修改任何业务代码**即可获得数据库查询、HTTP 外调、消息队列等的链路追踪。

### 安装

```bash
npm install @opentelemetry/auto-instrumentations-node
```

使用 `vext start` / `vext dev` 启动后，自动生效。

### 支持的库

| 类别 | 库 | 自动追踪内容 |
|------|----|------------|
| **数据库** | MongoDB（`mongodb` / `mongoose`） | 查询操作、集合名、耗时 |
| | PostgreSQL（`pg`） | SQL 语句、表名、耗时 |
| | MySQL（`mysql` / `mysql2`） | SQL 语句、表名、耗时 |
| | Redis（`ioredis` / `redis`） | 命令、key、耗时 |
| **HTTP** | Node.js `http` / `https` | 外部 HTTP 调用、URL、状态码 |
| | `undici` / `fetch` | 同上，Node.js 18+ 内置 fetch |
| **消息队列** | `amqplib`（RabbitMQ） | 队列名、消息发送/消费 |
| | `kafkajs` | Topic、消息发送/消费 |
| **缓存** | `memcached` | 操作命令、key |
| **RPC** | `@grpc/grpc-js` | 方法名、状态码 |
| **其他** | `dns` | DNS 解析 |
| | `net` | TCP 连接 |

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

### 手动创建 Span

```typescript
import { SpanStatusCode } from "@opentelemetry/api";
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/users/:id", { validate: { param: { id: "string" } } }, async (req, res) => {
    const span = req.app.otel!.tracer.startSpan("db.user.findById", {
      attributes: { "db.system": "mongodb", "user.id": req.valid("param").id },
    });
    try {
      const user = await app.services.user.findById(req.valid("param").id);
      span.setStatus({ code: SpanStatusCode.OK });
      res.json(user);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
});
```

### 自定义业务指标

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "business-metrics",
  dependencies: ["opentelemetry"],
  setup(app) {
    const meter = app.otel!.meter;
    app.extend("businessMetrics", {
      orderCreated: meter.createCounter("business.order.created"),
      orderAmount: meter.createHistogram("business.order.amount", { unit: "cents" }),
    });
  },
});
```

### 采样（降低开销）

```bash
# 环境变量方式，无需改代码
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

## 生产最佳实践

1. **配置上报地址** — 未配置时不会上报（安全默认值），但也意味着无可观测性数据
2. **`shutdown.timeout: 60`** — 确保 SDK 有足够时间 flush 数据
3. **限制 `/_otel/status`** — 网关层限内网，或 `statusEndpoint: false`
4. **不要在 Span 中记录敏感信息** — 密码、Token、身份证号等
5. **采样** — 高并发服务用 `OTEL_TRACES_SAMPLER=traceidratio`
6. **部署 Collector** — 应用 → Collector → 后端，解耦 + 缓冲

```
应用（N 个） ──OTLP──► Collector ──► Jaeger / Prometheus / Grafana
```

---

## 常见问题

### Q: `/_otel/status` 返回 `"sdk": "noop"`

SDK 未初始化。检查：①使用 `vext start/dev` 启动 ②`vextjs-opentelemetry` 在 dependencies 中 ③SDK 包已安装

### Q: endpoint 显示 localhost 但我配了其他地址

①检查插件参数 `otlpEndpoint` 配置 ②确认 `package.json` `vext.otel.endpoint` 与插件参数一致 ③确认用 `vext start/dev` 启动

### Q: 日志没有 trace_id

先确认 `/_otel/status` 返回 `"sdk": "initialized"`。SDK 必须正常才有 trace。

### Q: 后端收不到数据

①`/_otel/status` 确认 sdk + endpoint ②`curl ${endpoint}/v1/traces` 确认可达 ③等 5 秒（batch 延迟）④用 `join(process.cwd(), "otel-data")` 确认本地有数据输出

### Q: 测试环境如何禁用

```typescript
// src/config/test.ts
export default { otel: { enabled: false } };
```

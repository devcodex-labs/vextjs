# OpenTelemetry 可观测性

`vextjs-opentelemetry` 是 VextJS 的官方 OpenTelemetry 集成插件，将原本需要手写的 ~200 行样板代码压缩为 **1 文件 2 行**，开箱即得完整的可观测性三大支柱：**Traces（链路追踪）**、**Metrics（指标监控）** 和 **Logs（日志关联）**。

:::tip 后端无关设计
本插件基于 **OTLP（OpenTelemetry Protocol）**，不绑定任何具体后端。只需配置 `OTEL_EXPORTER_OTLP_ENDPOINT`，即可将数据发送到 Jaeger、Grafana Tempo、Prometheus、Datadog、New Relic、阿里云 ARMS、腾讯云 APM 等任意支持 OTLP 的后端。
:::

## 概览：接入后能获得什么

| 能力                       | 说明                                                   | 是否需要 SDK |
| -------------------------- | ------------------------------------------------------ | :----------: |
| **HTTP Span 自动标注**     | 每个请求自动记录路由、状态码、请求 ID、耗时            |     需要     |
| **请求时长直方图**         | `http.server.duration`（毫秒，含分桶）                 |     需要     |
| **请求总数计数**           | `http.server.request.total`（按路由/状态码分组）       |     需要     |
| **活跃请求数**             | `http.server.active_requests`（实时并发数）            |     需要     |
| **日志 trace 关联**        | 每条请求日志自动注入 `trace_id` / `span_id`            |    不需要    |
| **手动 Span / 自定义指标** | 通过 `req.app.otel.tracer` / `req.app.otel.meter` 扩展 |     需要     |
| **Noop 优雅降级**          | SDK 未安装时零报错、零 overhead，正常运行              |      —       |

> **"需要 SDK"** 指需要通过 `--import vextjs-opentelemetry/instrumentation` 启动应用（见[第二步](#第二步可选启用-sdk--将数据发送到后端)）。日志关联功能无需 SDK，仅安装插件即可生效。

---

## 安装

```bash
# 第一步：安装插件本体（必须）
npm install vextjs-opentelemetry @opentelemetry/api

# 第二步：安装 SDK + 导出器（需要实际发送遥测数据时安装）
npm install @opentelemetry/sdk-node \
            @opentelemetry/exporter-trace-otlp-http \
            @opentelemetry/exporter-metrics-otlp-http

# 可选：自动检测（自动追踪 HTTP、fetch、数据库等三方库操作）
npm install @opentelemetry/auto-instrumentations-node
```

---

## 快速开始（3 步接入）

### 第一步：创建插件文件

在 `src/plugins/` 目录下新建任意 `.ts` 文件（文件名即插件标识）：

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "vextjs-opentelemetry";

export default opentelemetryPlugin({
  serviceName: "my-app", // 服务名，在追踪后端中展示
});
```

这一步完成后，`app.otel` 已挂载，HTTP 指标统计中间件已注册。**日志关联功能（`trace_id` / `span_id` 注入日志）在 SDK 接入并产生真实 Span 后才会生效**——无 SDK 时，由于没有 active span，这两个字段不会出现在日志中（字段缺失，而非全零）。

---

### 第二步：（可选）启用 SDK — 将数据发送到后端

若需要在 Jaeger / Grafana 等后端中查看实际链路和指标数据，需要启用 SDK。

**使用 `vext start` / `vext dev`（推荐 — 零配置）：**

```bash
# 无需额外配置！vext CLI 自动检测 vextjs-opentelemetry 并注入 --import
vext start
vext dev
```

> `vext start` / `vext dev` 会自动扫描 `package.json` 依赖中的 `vext.preload` 字段，发现 `vextjs-opentelemetry` 后自动注入 `--import vextjs-opentelemetry/instrumentation`，无需手动配置。

**自定义启动脚本（手动添加 `--import`）：**

```json
{
  "scripts": {
    "start": "node --import vextjs-opentelemetry/instrumentation dist/server.js"
  }
}
```

:::tip 开发环境如何使用 --import？
使用 `vext dev` 时，`--import` 会**自动注入**，无需手动配置。

如果使用自定义启动方式，可通过 `NODE_OPTIONS` 注入：

```bash
NODE_OPTIONS="--import vextjs-opentelemetry/instrumentation" vext dev
```

日常开发中无需此步骤，Noop 模式（不传 `--import`）运行更轻量，仅在调试链路数据时使用。
:::

:::warning 为什么必须用 --import 而不是普通 import？
OpenTelemetry SDK 需要在 Node.js **模块系统初始化之前**完成注册，才能对 `http`、`net`、数据库驱动等原生模块打补丁（monkey-patch）。普通 `import` 是模块级执行，时机已晚。`--import` 是 Node.js 18.19+ 提供的预加载机制，保证 SDK 最先运行。
:::

---

### 第三步：启动并验证

```bash
# 启动本地 Jaeger（用于查看 Traces）
docker run -d --name jaeger \
  -p 4318:4318 \
  -p 16686:16686 \
  -e COLLECTOR_OTLP_ENABLED=true \
  jaegertracing/all-in-one:latest

# 带 SDK 启动应用
OTEL_SERVICE_NAME=my-app \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
npm start

# 访问任意接口，然后打开 Jaeger UI 查看链路
curl http://localhost:3000/users
open http://localhost:16686
```

---

## 接入后效果详解

### 启动日志

应用启动时，控制台会依次输出两行插件日志：

```
[vextjs-opentelemetry] SDK initialized (with auto-instrumentation)
[vextjs-opentelemetry] initialized (service: my-app)
```

- 第一行来自 `--import` 加载的 instrumentation 模块，表示 SDK 启动成功
- 第二行来自插件的 `setup()` 阶段，表示中间件和 `app.otel` 均已就位
- 若未使用 `--import`，仅出现第二行（Noop 模式，插件正常运行但不发送数据）

---

### 请求日志：trace_id / span_id 自动注入

插件通过 VextJS 内置的 ALS（AsyncLocalStorage）机制，在每个请求生命周期内将 `traceId` / `spanId` 写入上下文。之后该请求产生的**所有日志**都会自动携带这两个字段，无需任何手动传递。

**开发模式（pino-pretty）下的日志样例：**

```
[22:34:01.234] INFO: GET /users/42 200 45ms | 127.0.0.1 trace_id="4bf92f3577b34da6a3ce929d0e0e4736" span_id="00f067aa0ba902b7"
```

vext 的 access log 采用**紧凑单行格式**：`METHOD PATH STATUS TIMEms | IP`，`trace_id` 和 `span_id` 以键值对追加在同一行末尾。

> `requestId` 在 pretty 模式下默认被隐藏（由 `logger.prettyIgnore` 配置控制，默认值 `"pid,hostname,requestId"`）。若需要在 pretty 输出中显示 requestId，可设置 `logger: { prettyIgnore: "pid,hostname" }`。

**生产模式（JSON）下的日志样例：**

```json
{
  "level": 30,
  "time": 1743431641234,
  "pid": 1234,
  "hostname": "server-01",
  "requestId": "my-app-a1b2c3d4",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "msg": "GET /users/42 200 45ms | 127.0.0.1"
}
```

生产 JSON 格式中：`requestId`、`trace_id`、`span_id` 均为独立 JSON 字段，`msg` 为紧凑单行的访问日志字符串（含 method、path、status、耗时、客户端 IP）。

:::tip 日志与链路双向关联
有了 `trace_id`，你可以：

- 在 **Grafana Loki / ELK** 中按 `trace_id` 过滤日志，查看某条链路的完整日志流
- 在 **Jaeger / Tempo** 中点击 Trace，直接跳转到 Grafana Loki 中对应时间段的日志（需配置数据源关联）
  :::

---

### 链路追踪（Traces）

接入 SDK 并触发请求后，在 Jaeger / Grafana Tempo 中可以看到每个 HTTP 请求对应的 Trace 记录。

**Jaeger UI 中的 Span 结构：**

```
▶ GET /users/:id  (my-app)           45ms
  ├─ Attributes
  │    http.method          GET
  │    http.route           /users/:id         ← vext 注入的语义化路由模板
  │    http.status_code     200
  │    http.request_id      my-app-a1b2c3d4    ← vext 请求 ID
  │    vext.service         my-app
  │    http.url             http://localhost:3000/users/42
  │    net.peer.ip          127.0.0.1
  └─ Events
       (无异常时为空)
```

若安装了 `@opentelemetry/auto-instrumentations-node` 并使用了数据库，会出现子 Span：

```
▶ GET /users/:id  (my-app)           45ms
  └─ mongodb.find  (users)           32ms    ← 数据库操作子 Span
       db.system       mongodb
       db.name         mydb
       db.operation    find
```

:::tip http.route 而不是 http.url
插件将 `req.route`（如 `/users/:id`）而非实际 URL（`/users/42`）注入 Span。这样 Jaeger 中同一个接口的所有请求都归到同一个 Span 名称下，便于统计和对比性能。
:::

---

### 指标监控（Metrics）

插件内置 3 个标准 HTTP 指标，使用 OpenTelemetry 语义约定命名。接入 Prometheus 后，可按路由、状态码、方法分组查询。

**Prometheus 中的指标样例（OTel SDK 自动转换 `.` 为 `_`）：**

```text
# 请求时长分布（直方图）
http_server_duration_milliseconds_bucket{http_method="GET",http_route="/users/:id",http_status_code="200",le="50"}  15
http_server_duration_milliseconds_bucket{http_method="GET",http_route="/users/:id",http_status_code="200",le="100"} 42
http_server_duration_milliseconds_count{http_method="GET",http_route="/users/:id",http_status_code="200"}           50
http_server_duration_milliseconds_sum{http_method="GET",http_route="/users/:id",http_status_code="200"}             2341

# 请求总数
http_server_request_total{http_method="GET",http_route="/users/:id",http_status_code="200"} 50
http_server_request_total{http_method="POST",http_route="/users",http_status_code="201"}    12
http_server_request_total{http_method="GET",http_route="/users/:id",http_status_code="404"} 3

# 当前活跃请求数
http_server_active_requests{http_method="GET"} 2
```

**常用 PromQL 查询：**

```text
# P99 请求延迟（按路由）
histogram_quantile(0.99,
  sum(rate(http_server_duration_milliseconds_bucket[5m])) by (le, http_route)
)

# 每秒请求数（QPS）
sum(rate(http_server_request_total[1m])) by (http_route)

# 错误率（4xx + 5xx）
sum(rate(http_server_request_total{http_status_code=~"[45].."}[5m])) by (http_route)
/ sum(rate(http_server_request_total[5m])) by (http_route)

# 当前并发请求数
sum(http_server_active_requests) by (http_method)
```

---

## 配置详解

### opentelemetryPlugin() 完整选项

```typescript
import { opentelemetryPlugin } from "vextjs-opentelemetry";

export default opentelemetryPlugin({
  // ── 基础配置 ────────────────────────────────────────────

  /**
   * 服务名称
   * 优先级：OTEL_SERVICE_NAME 环境变量 > 此选项 > config.otel.serviceName > "vext-app"
   */
  serviceName: "my-app",

  /**
   * 是否启用插件（默认 true）
   * false 时不注册中间件、不挂载 app.otel，完全 no-op。
   * 适合通过环境变量在测试环境动态关闭遥测。
   */
  enabled: true,

  // ── 追踪配置 ────────────────────────────────────────────
  tracing: {
    /**
     * 是否启用追踪中间件（默认 true）
     * false 时跳过 Span 标注和 ALS 写入，但仍统计 HTTP 指标。
     */
    enabled: true,

    /**
     * 为每个请求的 Span 添加额外自定义属性（可选）
     * 支持静态对象或函数（从 req 动态读取）两种形式。
     *
     * 常用场景：注入用户 ID、租户 ID、API 版本等业务维度，
     * 方便在 Jaeger 中按业务字段过滤链路。
     */
    extraAttributes: (req) => ({
      "user.id": req.headers["x-user-id"] ?? "",
      "tenant.id": req.headers["x-tenant-id"] ?? "",
      "api.version": req.headers["x-api-version"] ?? "v1",
    }),
  },

  // ── 指标配置 ────────────────────────────────────────────
  metrics: {
    /**
     * 是否启用 HTTP 指标统计（默认 true）
     * false 时跳过所有 httpRequestDuration / httpRequestTotal / httpActiveRequests 统计。
     */
    enabled: true,

    /**
     * 请求时长直方图分桶边界（单位：毫秒）
     * 默认：[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
     *
     * 调整建议：
     * - 低延迟内部服务（SLO < 50ms）：[1, 5, 10, 25, 50, 100, 250]
     * - 含外部 IO 的接口（SLO ~ 1s）： [10, 25, 50, 100, 250, 500, 1000, 2000]
     * - 批处理/长任务：               [100, 500, 1000, 5000, 10000, 30000]
     */
    durationBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],

    /**
     * 为 HTTP 指标附加自定义业务标签（合并到 httpRequestTotal / httpRequestDuration）
     *
     * 支持静态对象或函数形式（函数形式可从 req 动态读取）。
     *
     * ⚠️ 避免高基数字段（如 user.id、session.id），高基数会导致
     * 时间序列数据库资源消耗剧增。
     *
     * 注：不合并到 httpActiveRequests（该指标仅使用 http.method，符合 OTEL 语义约定）。
     */
    customLabels: (req) => ({
      "tenant.id": req.headers["x-tenant-id"] ?? "default",
    }),
    // 也支持静态对象形式：customLabels: { "env": "production" }
  },
});
```

---

### 通过 vext.config.ts 配置

插件读取 `vext.config.ts` 中的 `otel` 字段，优先级低于工厂函数参数。适合将服务名统一管理在框架配置中：

```typescript
// src/config/default.ts
export default {
  port: 3000,

  otel: {
    serviceName: "my-app", // 被 OTEL_SERVICE_NAME 环境变量覆盖
    enabled: true,
  },
};
```

```typescript
// src/config/test.ts — 测试环境关闭遥测
export default {
  otel: {
    enabled: false,
  },
};
```

---

### 环境变量完整参考

所有环境变量均作用于 `vextjs-opentelemetry/instrumentation` 模块（通过 `--import` 加载的 SDK 初始化部分）。

| 变量                                  | 默认值                    | 说明                                                |
| ------------------------------------- | ------------------------- | --------------------------------------------------- |
| `OTEL_SERVICE_NAME`                   | `"vext-app"`              | 服务名称（同时影响插件和 SDK 的 Resource）          |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | `"http://localhost:4318"` | OTLP 基础地址（Traces + Metrics 共用）              |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | `${ENDPOINT}/v1/traces`   | Traces 专用导出地址，覆盖基础地址                   |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `${ENDPOINT}/v1/metrics`  | Metrics 专用导出地址，覆盖基础地址                  |
| `OTEL_METRIC_EXPORT_INTERVAL`         | `15000`                   | 指标导出间隔（毫秒），建议生产环境设为 `60000`      |
| `npm_package_version`                 | `"0.0.0"`                 | 由 npm 自动注入，写入 Resource 的 `service.version` |
| `NODE_ENV`                            | `"development"`           | 写入 Resource 的 `deployment.environment`           |

**优先级关系（高→低）：**

```
OTEL_SERVICE_NAME（环境变量）
  > opentelemetryPlugin({ serviceName })（工厂函数参数）
    > vext.config.ts otel.serviceName（框架配置）
      > "vext-app"（内置默认值）
```

---

## SDK 初始化详解（--import instrumentation）

`vextjs-opentelemetry/instrumentation` 是 SDK 的标准初始化入口，负责：

1. 创建 `NodeSDK` 实例（配置 Trace Exporter + Metric Reader + Resource）
2. 注册自动检测（HTTP、fetch、数据库驱动等，可选）
3. 注册 `SIGTERM` 处理器（应用关闭时 flush 未发送的数据）

### 在不同场景下配置 package.json

```json
{
  "scripts": {
    "start": "node --import vextjs-opentelemetry/instrumentation dist/server.js",
    "dev": "vext dev",
    "dev:otel": "NODE_OPTIONS=\"--import vextjs-opentelemetry/instrumentation\" vext dev",
    "start:prod": "OTEL_SERVICE_NAME=my-app OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 node --import vextjs-opentelemetry/instrumentation dist/server.js"
  }
}
```

:::tip 开发模式建议
日常开发中（`vext dev`）无需 `--import`，Noop 模式运行更轻量。需要调试真实链路数据时，切换到 `npm run dev:otel`（通过 `NODE_OPTIONS` 注入 `--import`，对 vext dev 内部的 TypeScript 编译过程无影响）并启动本地 Jaeger。
:::

### 自定义 instrumentation（高级）

若需要在默认基础上调整 SDK 配置（如自定义采样策略、关闭特定自动检测），可以替换为自己的初始化文件：

```typescript
// src/instrumentation.ts — 自定义 SDK 初始化
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  // 生产环境采样率：仅保留 10% 的请求
  sampler: new TraceIdRatioBasedSampler(0.1),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
    }),
  ],
});

// ⚠️ 本示例仅展示 Trace 采样配置，未包含 metricReader。
// 若需要同时导出指标数据，请补充：
//   metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })
// 参考内置 instrumentation.ts 获取完整配置。
sdk.start();

process.on("SIGTERM", async () => {
  await sdk.shutdown();
});

export {};
```

```json
// package.json
{
  "scripts": {
    "start": "node --import ./dist/instrumentation.js dist/server.js"
  }
}
```

---

## 接入可观测性后端

### Jaeger（本地开发首选）

Jaeger `all-in-one` 镜像内置 OTLP 接收器和 UI，是本地调试的最快选择。

```bash
docker run -d --name jaeger \
  -p 4318:4318 \    # OTLP HTTP 接收端口
  -p 16686:16686 \  # Jaeger UI
  -e COLLECTOR_OTLP_ENABLED=true \
  jaegertracing/all-in-one:latest
```

```bash
OTEL_SERVICE_NAME=my-app \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
npm start
```

打开 **http://localhost:16686**，在 "Service" 下拉框中选择 `my-app`，点击 "Find Traces" 即可查看链路。

**Jaeger 界面导航：**

| 功能     | 路径                                | 说明                                        |
| -------- | ----------------------------------- | ------------------------------------------- |
| 链路列表 | Search → 选择 Service → Find Traces | 按时间/耗时/操作名筛选                      |
| 链路详情 | 点击任意 Trace 行                   | 展开 Span 树、查看 Attributes / Events      |
| 服务拓扑 | 顶部菜单 → System Architecture      | 服务间调用关系图（多服务时有用）            |
| 指标概览 | 顶部菜单 → Monitor                  | 基于 Span 数据计算的 RED 指标（需开启 SPM） |

---

### Grafana LGTM Stack（推荐：一站式方案）

`grafana/otel-lgtm` 是 Grafana 官方的本地开发镜像，内置：

- **Loki** — 日志存储
- **Grafana** — 可视化面板
- **Tempo** — 链路追踪后端
- **Mimir** — 指标存储（Prometheus 兼容）

```bash
docker run -d --name lgtm \
  -p 3000:3000 \   # Grafana UI
  -p 4318:4318 \   # OTLP HTTP
  grafana/otel-lgtm:latest
```

```bash
OTEL_SERVICE_NAME=my-app \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
npm start
```

打开 **http://localhost:3000**（账号/密码：`admin` / `admin`）：

| Grafana 功能     | 菜单路径                                | 说明                       |
| ---------------- | --------------------------------------- | -------------------------- |
| 链路追踪         | Explore → 数据源选 Tempo                | 按 TraceID 或 Service 搜索 |
| 指标查询         | Explore → 数据源选 Prometheus           | 输入 PromQL 查询指标       |
| 日志查询         | Explore → 数据源选 Loki                 | 按 `trace_id` 关联日志     |
| Trace → Log 跳转 | Tempo 链路详情页 → "Logs for this span" | 一键跳转到对应时段日志     |

---

### Docker Compose 完整示例

适合在本地或 CI 环境中一键启动完整的可观测性基础设施：

```yaml
# docker-compose.yml
version: "3.8"

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - OTEL_SERVICE_NAME=my-app
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - NODE_ENV=production
    command: node --import vextjs-opentelemetry/instrumentation dist/server.js
    depends_on:
      - otel-collector

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4318:4318" # OTLP HTTP（供应用发送数据）
      - "8889:8889" # Prometheus 指标暴露端口
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
    environment:
      - COLLECTOR_OTLP_ENABLED=true

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1000

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true
  prometheus:
    endpoint: 0.0.0.0:8889

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "vext-app"
    static_configs:
      - targets: ["otel-collector:8889"]
```

启动所有服务：

```bash
docker compose up -d
npm start

# 查看
open http://localhost:16686  # Jaeger
open http://localhost:9090   # Prometheus
open http://localhost:3001   # Grafana
```

---

### 云厂商（生产环境）

大多数云厂商 APM 产品均已支持 OTLP，直接配置 endpoint 即可：

**Datadog：**

```bash
# 需要启动 Datadog Agent 并开启 OTLP Receiver
OTEL_SERVICE_NAME=my-app \
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-dd-agent-host:4318 \
npm start
```

**New Relic：**

```bash
OTEL_SERVICE_NAME=my-app \
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.nr-data.net:4318 \
OTEL_EXPORTER_OTLP_HEADERS="api-key=YOUR_LICENSE_KEY" \
npm start
```

**Grafana Cloud：**

```bash
OTEL_SERVICE_NAME=my-app \
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp \
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic YOUR_BASE64_TOKEN" \
npm start
```

**阿里云 ARMS / 腾讯云 APM：** 参考各云厂商的 OTLP 接入文档，配置对应 endpoint 和 token header 即可。

---

## 高级用法

### 在 Handler / Service 中手动创建 Span

通过 `req.app.otel.tracer` 为关键业务操作创建子 Span，在链路图中可视化操作耗时：

```typescript
import { SpanStatusCode } from "@opentelemetry/api";
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/users/:id",
    {
      validate: { param: { id: "string" } },
    },
    async (req, res) => {
      const { tracer } = req.app.otel!;

      // 创建数据库查询子 Span
      const span = tracer.startSpan("db.user.findById", {
        attributes: {
          "db.system": "mongodb",
          "db.operation": "findOne",
          "user.id": req.valid("param").id,
        },
      });

      try {
        const user = await app.services.user.findById(req.valid("param").id);

        span.setAttributes({ "user.found": !!user });
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
        span.end(); // 必须调用 end()，否则 Span 不会被导出
      }
    },
  );
});
```

---

### 自定义业务指标

通过 `req.app.otel.meter` 创建业务维度的自定义指标：

```typescript
// src/plugins/business-metrics.ts — 业务指标初始化插件
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "business-metrics",
  dependencies: ["opentelemetry"], // 确保在 otel 插件之后初始化

  setup(app) {
    const meter = app.otel!.meter;

    // 订单创建计数器
    const orderCreated = meter.createCounter("business.order.created", {
      description: "Total number of orders created",
    });

    // 订单金额直方图（单位：分，避免浮点精度问题）
    const orderAmount = meter.createHistogram("business.order.amount", {
      description: "Order amount in cents",
      unit: "cents",
    });

    // 活跃用户数（UpDownCounter，可增可减）
    const activeUsers = meter.createUpDownCounter("business.users.active", {
      description: "Number of active users",
    });

    // 挂载到 app，供 Service 层使用
    app.extend("businessMetrics", { orderCreated, orderAmount, activeUsers });
  },
});
```

在 Service 层使用：

```typescript
// src/services/order.ts
export class OrderService {
  async create(data: CreateOrderInput, app: VextApp) {
    const order = await app.db.orders.create(data);

    // 记录指标（带业务维度标签）
    app.businessMetrics.orderCreated.add(1, {
      "order.type": data.type,
      "payment.method": data.paymentMethod,
    });
    app.businessMetrics.orderAmount.record(data.amountCents, {
      "order.type": data.type,
    });

    return order;
  }
}
```

---

### 动态注入 Span 属性（extraAttributes）

`extraAttributes` 支持函数形式，可从请求上下文中读取任意信息注入到每个请求的 Span：

```typescript
export default opentelemetryPlugin({
  serviceName: "my-app",
  tracing: {
    extraAttributes: (req) => {
      // 从 JWT 或请求头读取用户/租户信息
      const userId = req.headers["x-user-id"] as string | undefined;
      const tenantId = req.headers["x-tenant-id"] as string | undefined;
      const region = req.headers["x-region"] as string | undefined;

      return {
        ...(userId && { "user.id": userId }),
        ...(tenantId && { "tenant.id": tenantId }),
        ...(region && { "cloud.region": region }),
        "app.version": process.env.npm_package_version ?? "unknown",
      };
    },
  },
});
```

注入后，在 Jaeger 中可以按 `user.id` 或 `tenant.id` 过滤链路，快速定位某个用户或租户的请求。

---

### 按需开关功能

通过配置可以精细控制哪些遥测功能开启：

```typescript
// 场景 1：只要指标，不要追踪（追踪开销较高时）
opentelemetryPlugin({
  serviceName: "my-app",
  tracing: { enabled: false },
  metrics: { enabled: true },
});

// 场景 2：通过环境变量动态控制开关
opentelemetryPlugin({
  serviceName: "my-app",
  enabled: process.env.OTEL_ENABLED !== "false",
});

// 场景 3：测试环境完全关闭
// src/config/test.ts
export default {
  otel: { enabled: false },
};
```

---

## Cluster 多进程模式

Node.js Cluster 模式下，每个 Worker 进程都需要独立加载 instrumentation。通过 `cluster.setupPrimary()` 为所有 Worker 统一注入 `execArgv`（`cluster.fork()` 只接受 env 参数，不能用于传递启动参数）：

```javascript
// cluster.js（入口文件）
import cluster from "node:cluster";
import { cpus } from "node:os";

if (cluster.isPrimary) {
  const workerCount = cpus().length;

  // ✅ 正确：通过 setupPrimary 为所有 Worker 统一注入 execArgv
  cluster.setupPrimary({
    execArgv: ["--import", "vextjs-opentelemetry/instrumentation"],
  });

  for (let i = 0; i < workerCount; i++) {
    cluster.fork(); // 无需再传 execArgv，已从 setupPrimary 继承
  }

  cluster.on("exit", (worker, code) => {
    if (code !== 0) {
      console.error(
        `Worker ${worker.id} exited with code ${code}, restarting...`,
      );
      cluster.fork(); // setupPrimary 设置对所有后续 fork 均生效
    }
  });
} else {
  // Worker 进程：通过 setupPrimary 继承的 execArgv 加载 instrumentation，直接启动应用
  await import("./dist/server.js");
}
```

:::warning OTel Collector 聚合多 Worker 数据
Cluster 模式下，每个 Worker 独立发送遥测数据到 Collector。这是正常行为：

- **Traces**：每个 Worker 处理的请求独立上报，Collector 按 traceId 聚合（适用于跨进程追踪）
- **Metrics**：每个 Worker 独立上报指标，在 Prometheus 端通过 `sum()` 聚合

无需在应用层做任何额外处理，Collector / Prometheus 会自动处理多实例聚合。
:::

---

## 生产最佳实践

### 1. 配置采样率（降低高并发下的 Trace 开销）

高并发服务无需采集 100% 的请求，按比例采样可大幅降低存储和传输开销：

```typescript
// src/instrumentation.ts — 自定义采样
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-node";

const sdk = new NodeSDK({
  // 生产环境采集 10% 的请求（基于 Trace ID 的固定比例采样，不自动保留错误请求）
  sampler: new TraceIdRatioBasedSampler(0.1),
  // ... 其他配置
});
```

### 2. 延长 shutdown timeout（防止最后一批数据丢失）

vext 的 `shutdown.timeout` 单位为**秒**，默认值为 `10`（10 秒）。SDK flush 可能需要更长时间，生产环境建议调大：

```typescript
// vext.config.ts
export default {
  shutdown: {
    timeout: 60, // 60 秒（单位：秒），确保 SDK 有足够时间 flush 遥测数据
  },
};
```

> ⚠️ 注意：`shutdown.timeout` 的单位是**秒**，不是毫秒。`timeout: 60` 表示 60 秒，`timeout: 60_000` 将设置为 60,000 秒（约 16.7 小时）。

### 3. 过滤敏感信息

不要将用户密码、Token、身份证等敏感信息写入 Span Attributes：

```typescript
tracing: {
  extraAttributes: (req) => ({
    "user.id": req.headers["x-user-id"] ?? "",
    // ❌ 不要这样做：
    // "auth.token": req.headers["authorization"],
    // "user.password": req.body?.password,
  }),
},
```

### 4. 生产环境推荐部署架构

```
应用实例（N 个）
    │  OTLP HTTP (4318)
    ▼
OpenTelemetry Collector（独立部署）
    ├── Traces  ──► Jaeger / Grafana Tempo
    ├── Metrics ──► Prometheus / Grafana Mimir
    └── Logs    ──► Loki（若应用日志也走 OTLP）

Grafana（统一可视化入口）
    ├── 数据源：Tempo（Traces）
    ├── 数据源：Prometheus（Metrics）
    └── 数据源：Loki（Logs）← 通过 trace_id 关联
```

应用直接推送到 Collector（而非直接到 Jaeger/Prometheus）的优势：

- 解耦：后端切换不影响应用配置
- 聚合：多实例数据统一处理
- 缓冲：Collector 的 batch processor 可防止后端压力过大时丢数据

---

## 常见问题

### Q: 不安装 SDK 也可以使用吗？

**A**: 可以。仅安装 `@opentelemetry/api`（不使用 `--import`）时，插件以 Noop 模式运行：

- 日志中**不会出现** `trace_id` / `span_id` 字段（无 active span，middleware 不写入 ALS store）
- `tracer.startSpan()` 返回 `NoopSpan`，所有 Span 操作为空操作，不抛错
- 指标方法调用被静默忽略，不统计数据
- **零性能开销**

只有当你需要在 Jaeger / Grafana 中查看实际链路和指标数据时，才需要安装 SDK 并使用 `--import`。

---

### Q: 日志中没有 trace_id / span_id 字段？

**A**: 字段缺失通常有以下原因：

1. **未使用 `--import` 启动**：SDK 未初始化，无 active span，middleware 不写入 ALS store，字段不出现在日志中
2. **SDK 初始化失败**：查看启动日志中是否有 `[vextjs-opentelemetry/instrumentation] Failed to initialize SDK` 警告
3. **请求未被 auto-instrumentation 捕获**：确认已加载 `getNodeAutoInstrumentations()` 或对应的 instrumentation 包

解决方法：确保通过 `node --import vextjs-opentelemetry/instrumentation` 启动应用，并在启动日志中看到 `SDK initialized` 字样。

---

### Q: Jaeger 中看不到数据？

**A**: 按以下步骤排查：

1. 确认启动日志中有 `[vextjs-opentelemetry] SDK initialized` ✅
2. 确认 `OTEL_EXPORTER_OTLP_ENDPOINT` 地址可访问：`curl -v http://localhost:4318/v1/traces`
3. 发起至少一个 HTTP 请求，等待 ~5s（SDK 有 batch 延迟）
4. 在 Jaeger UI 中选择正确的 Service 名称（和 `OTEL_SERVICE_NAME` 一致）
5. 若使用 OTel Collector，检查 Collector 容器日志确认已收到数据

---

### Q: app.otel 为 undefined，但 enabled 没有设置为 false？

**A**: 检查以下几点：

- `vext.config.ts` 中的 `otel.enabled` 是否被测试/特定环境配置覆盖为 `false`
- `OTEL_ENABLED` 等自定义环境变量是否影响了 `enabled` 判断逻辑
- 确认插件文件位于 `src/plugins/` 目录，且 `export default` 是 `opentelemetryPlugin(...)` 的返回值

`enabled: true`（默认）时，`app.otel` 在 `setup()` 完成后始终有值，可安全访问。

---

### Q: SIGTERM 时 SDK shutdown 与 vext 的 shutdown 会冲突吗？

**A**: 不冲突，两者并发执行，互不阻塞：

- **vext shutdown**：完成 `onClose` 钩子（如数据库连接关闭）→ 调用 `process.exit(0)`
- **SDK shutdown**：异步 flush 未发送的 Span/Metric 数据

注意：若 vext 的 shutdown timeout（默认 **10 秒**）比 SDK flush 时间短，最后一批遥测数据可能丢失。生产环境建议将 `shutdown.timeout` 设为 `60`（单位：秒，即 60 秒）。

---

### Q: 如何在单元测试中禁用遥测？

**A**: 推荐通过测试环境配置或直接禁用插件：

```typescript
// src/config/test.ts
export default {
  otel: { enabled: false },
};
```

或在测试文件中：

```typescript
// 无需 mock，插件在 enabled: false 时完全 no-op
const app = await createTestApp({ otel: { enabled: false } });
```

---

## 下一步

- 📖 [插件 API 参考](/guide/plugins) — 了解 VextJS 插件系统的完整 API
- 📖 [请求上下文](/guide/request-context) — 深入了解 ALS 日志关联机制
- 📖 [Cluster 多进程](/guide/cluster) — VextJS Cluster 模式完整指南
- 📦 [npm: vextjs-opentelemetry](https://www.npmjs.com/package/vextjs-opentelemetry) — 插件 npm 页面

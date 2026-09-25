# OpenTelemetry 可观测性

本页介绍 VextJS 的 OpenTelemetry 接入：先确认插件可用，再用本地文件验证 Traces / Metrics / Logs，最后连接 Collector。前置条件是已按[快速开始](/zh/guide/quick-start)创建 TypeScript API 项目。2026-09-25 核对的发布包为 `@devcodex/opentelemetry@2.1.17`，Vext peer 范围 `>=0.2.5`；版本信息用于说明验证范围，安装命令不固定框架版本。

> 其他框架（Egg.js / Koa / Express / Hono / Fastify）的接入说明，请直接查看 GitHub 仓库：
> [`devcodex-labs/opentelemetry`](https://github.com/devcodex-labs/opentelemetry)

---

## 目录速览（VextJS-only）

- [快速开始（VextJS 框架）](#快速开始vextjs-框架)
- [先理解：VextJS 配置入口与初始化顺序](#先理解vextjs-配置入口与初始化顺序)
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
> 主入口 `@devcodex/opentelemetry` 提供框架无关工具（例如 `createWithSpan`、`getOtelStatus`）。

### 3. 添加可验证路由并启动

合并配置：

```typescript
// src/config/default.ts
export default { host: "127.0.0.1", port: 3000, adapter: "native" };
```

下面路由只执行一次本地演示操作，不访问外部支付或数据库；它以本页插件保持启用为前提：

```typescript
// src/routes/otel-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (req, res) => {
    const result = await req.app.otel!.withSpan("demo.work", async (span) => {
      span.setAttribute("demo.kind", "local");
      req.app.logger.info({ demo: true }, "otel demo completed");
      return { ok: true };
    });
    res.json(result);
  });
});
```

```bash
npm run dev
```

生产流程是先停止开发服务，再执行 `npm run build -- --typecheck` 和 `npm start`。不要并行启动两者占用同一端口。

CLI 会从已安装依赖的 `vext.preload` 发现并注入 instrumentation 入口。当前包的默认自动预加载只准备入口，SDK 可以延后至 plugin setup；未配置导出目标且未强制预加载 SDK 时，不初始化 SDK。要在应用模块加载前启用自动检测，按下文设置 `preloadSdk: true`。

### 4. 验证默认状态

在没有其他 OTel 环境配置的情况下：

```bash
curl -i http://127.0.0.1:3000/_otel/status
curl -i http://127.0.0.1:3000/otel-demo
```

状态的关键字段应为 `sdk: "noop"`、`exportMode: "none"`，业务请求仍返回200。此时没有导出遥测，不能据此声称 Collector 已收到数据。要验证真实输出，继续下面的文件导出流程。

---

<a id="先理解vextjs-双入口优先级"></a>

## 先理解：VextJS 配置入口与初始化顺序

配置有三个读取位置，SDK 生命周期和请求观测职责要分别理解：

| 入口                         | 当前作用                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| package.json 的 vext.otel    | 预加载配置；支持 enabled、preloadSdk、serviceName、endpoint、protocol、headers、sampling.ratio、metricIntervalMs |
| app.config.otel              | 插件的 enabled、serviceName、endpoint、protocol、headers、insecure 回退配置                                      |
| opentelemetryPlugin(options) | 插件显式参数优先；配置 tracing、metrics、capture、lifecycle、日志桥接和尚未配置的导出器                          |

### 推荐顺序

1. 在 package.json 一处设置 serviceName 和默认导出目标；需要早期自动检测时设置 preloadSdk:true。
2. 插件补充请求观测行为，导出地址与 package 保持一致。
3. **已配置的导出器不会被后续调用覆盖**。当前 attachExporterToSdk 只给未配置的 delegate 赋值，但状态展示环境变量可能随后改变；因此状态接口不是实际投递目标的完整证据。变更目标或采样后应重启，再检查输出文件或 Collector。
4. 默认延迟模式下，插件 exporter 参数依次读取 options → app.config.otel → package；它不会完整重读所有 OTel 环境变量。仅依赖环境变量时，要显式启用早期 SDK，并核对实际输出。

### `endpoint` / `protocol` 速查

| 目标                | 推荐配置                                | `protocol`       | 结果                                                  |
| ------------------- | --------------------------------------- | ---------------- | ----------------------------------------------------- |
| 不导出任何数据      | 不写 endpoint，或显式 none              | —                | 默认不启动 SDK；显式 preloadSdk:true 时可启动但不导出 |
| 本地文件调试        | `"./otel-data"`                         | —                | 按 `pid` 写入 `*.jsonl` 文件                          |
| OTLP HTTP Collector | `"http://otel-collector.internal:4318"` | `"http"`（默认） | 通过 OTLP/HTTP 上报                                   |
| OTLP gRPC Collector | `"otel-collector.internal:4317"`        | `"grpc"`         | 初始化路径影响具体 exporter，见下方限制               |

当前包的 gRPC 有两条实现路径：早期 SDK 的 Trace/Metrics 使用 gRPC exporter，而 Logs 仍构造 HTTP exporter；插件补充导出器时默认 insecure:true 使用 h2c，false 使用 TLS。h2c 分支没有转发配置 headers。需要三个信号统一接入或鉴权时，优先验证本页 OTLP/HTTP 路径；不能只根据 protocol:grpc 或状态字段推断各信号都成功。

---

## 不配置上报地址会怎样？

| 场景                                                      | 当前行为                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| 没有 endpoint，默认 CLI 自动预加载                        | 延后/跳过 SDK 初始化，插件扩展可用，但没有遥测输出                         |
| endpoint:none + preloadSdk:true                           | SDK 可以初始化，导出器仍为 none                                            |
| 有地址，Collector 不可达                                  | 请求服务与投递是两回事；导出可能失败或丢弃，需检查实际后端和 exporter 诊断 |
| package vext.otel.enabled:false 或 OTEL_SDK_DISABLED=true | 关闭 SDK 与插件接入；不会注册状态接口，业务路由不得假定 app.otel 存在      |
| 仅插件 options.enabled:false                              | 跳过插件；若别处已启动 SDK，不会倒退撤销那次初始化                         |

默认不发送到任何 Collector，也不写本地文件。设置 none 不是可靠的运行期关闭开关：若导出器已由其他入口初始化，必须统一配置并重启。

## 本地测试（无需 Docker）

不想装 Jaeger/Collector？可以将数据导出到**本地文件**，直接看原始数据格式。

### 方案一：导出到本地文件（推荐）

在项目 `package.json` 中配置上报地址（由 SDK 初始化脚本读取，控制实际导出）：

```json
{
  "vext": {
    "otel": {
      "serviceName": "my-app",
      "preloadSdk": true,
      "endpoint": "./otel-data"
    }
  }
}
```

> `package.json vext.otel.endpoint` 是 VextJS 模式下**推荐的预加载配置源**，能让启动阶段和运行阶段从一开始就保持一致。
> 插件只能补充未配置的导出器，不能覆盖已初始化的目标。相对路径基于 process.cwd()，从应用根目录启动。将片段合并到现有 package.json，保留 scripts 与 dependencies。

创建插件（保持 `serviceName` 与 `package.json` 一致即可）：

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({ serviceName: "my-app" });
```

修改 package.json 后，先停止已有服务再重启，使早期 SDK 读取新配置。

```bash
npm run dev
# 在另一终端请求上面的真实演示路径
curl -i http://127.0.0.1:3000/otel-demo
curl -i http://127.0.0.1:3000/_otel/status
```

插件自动创建目录；为避免 cluster / 多 worker 进程并发写同一文件，当前实现会按 `process.pid` 分文件写入：

- `traces.<pid>.jsonl`
- `metrics.<pid>.jsonl`
- `logs.<pid>.jsonl`

等待批处理和指标周期（默认15秒）后查看；仅启用插件但没有业务请求不保证三个文件都有记录。PowerShell 使用 `Get-Content ./otel-data/traces.*.jsonl`，并分别查看 metrics/logs；类 Unix 终端可用 cat。确认业务 span demo.work、HTTP 指标和 otel demo completed 日志均存在。文件仅用于调试，轮转与保留由应用管理。

**实际文件格式**

- traces：每行一个 span，使用 traceId / spanId / name / attributes，时间与 duration 为 SDK 的高精度时间数组；不是旧示例的 id / timestamp 微秒结构。
- metrics：每行包含 timestamp 和 SDK ResourceMetrics 对象，指标位于 metrics.scopeMetrics[].metrics；不是顶层指标数组。
- logs：每行序列化一个 SDK LogRecord，字段和 Resource 表达跟随已安装 SDK；不应把调试 JSONL 当作固定 OTLP 网络协议。
- 父 span、resource 等可选字段可能缺失。用实际安装版本的输出建立读取器，查看三个文件而非只看状态接口。

### 方案二：本地 Jaeger（有 Docker 时）

按 [Jaeger 官方文档](https://www.jaegertracing.io/docs/)启动提供 OTLP/HTTP 接收端口的服务，并将4318映射到本机；镜像和配置以所用 Jaeger 版本为准。Jaeger 主要用于 Trace，Metrics/Logs 需要对应接收后端。

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

将 Jaeger 的 endpoint 与上面文件方案二选一，保留 serviceName / preloadSdk:true；启动后在 Jaeger UI 中查询该服务的 demo.work。插件保持最简即可：

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({ serviceName: "my-app" });
```

```bash
npm run dev
curl http://127.0.0.1:3000/otel-demo
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

- [`devcodex-labs/opentelemetry`](https://github.com/devcodex-labs/opentelemetry)

建议优先阅读仓库中的：

- `README.md`
- `changelogs/`

## `/_otel/status` 状态检查接口

用于验证 OTel SDK 当前运行状态：

```bash
curl http://localhost:3000/_otel/status
```

```json
{
  "sdk": "initialized",
  "serviceName": "my-app",
  "exportMode": "file",
  "exportTarget": "/absolute/path/otel-data",
  "protocol": "http",
  "autoInstrumentation": true,
  "samplingRatio": 1
}
```

| 字段                  | 说明                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| `sdk`                 | `"initialized"` = SDK 初始化标志 / `"noop"` = SDK 未初始化                             |
| `serviceName`         | 当前生效的服务名                                                                       |
| `exportMode`          | `"otlp-grpc"` / `"otlp-http"` / `"file"` / `"none"` 是导出模式展示，实际信号链路需另验 |
| `exportTarget`        | 状态展示的上报目标（实际输出需另验）                                                   |
| `protocol`            | 当前导出协议（`"http"` / `"grpc"`）                                                    |
| `autoInstrumentation` | 是否启用了自动检测（MongoDB/Redis/MySQL 等）                                           |
| `samplingRatio`       | 当前采样率                                                                             |

插件启用后通过 adapter 直接注册 GET /\_otel/status，早于普通全局中间件；不要依赖普通 Route auth 或后续中间件保护它，本页 native 默认响应包装下，上述字段位于响应的 data 中，路径仅作示意。关闭或自定义包装时按实际配置读取。字段来自状态变量，不能证明后端已经接收数据；samplingRatio 在当前包中遇到0会回退显示1，不能只用这个字段判断零采样。

**生产环境**建议在网关层限制内网访问。

---

## 上报的数据内容

### Traces（链路追踪）

HTTP 自动检测负责创建请求 span，插件负责补属性；需 SDK 已启用、目标库受支持且采样允许。以下是可能出现的属性：

| 属性               | 示例值                             | 说明                                 |
| ------------------ | ---------------------------------- | ------------------------------------ |
| `http.method`      | `"GET"`                            | HTTP 方法                            |
| `http.route`       | `"/users/:id"`                     | 路由模板（低基数，安全用于指标聚合） |
| `http.status_code` | `200`                              | 响应状态码                           |
| `http.request_id`  | `"my-app-a1b2c3d4"`                | vext 请求 ID                         |
| `vext.service`     | `"my-app"`                         | 服务名称                             |
| `http.url`         | `"http://localhost:3000/users/42"` | 完整请求 URL                         |
| `net.peer.ip`      | `"127.0.0.1"`                      | 客户端 IP                            |

默认包已依赖 auto-instrumentations-node，无需重复安装。早期初始化、模块加载顺序、具体库版本和采样共同决定是否产生子 span，不能仅凭已安装判断成功。

### Metrics（指标监控）

| 指标名                        | 类型               | 标签                       | 说明                                        |
| ----------------------------- | ------------------ | -------------------------- | ------------------------------------------- |
| `http.server.duration`        | Histogram（ms）    | method, route, status_code | 请求耗时分布                                |
| `http.server.request.total`   | Counter            | method, route, status_code | 请求总数                                    |
| `http.server.active_requests` | UpDownCounter      | method                     | 当前并发请求数                              |
| `http.server.request.size`    | Histogram（bytes） | method, route              | 请求体大小分布（Content-Length 存在时记录） |
| `http.server.response.size`   | Histogram（bytes） | method, status_code        | 响应体大小分布（Content-Length 存在时记录） |

> ignorePaths 抑制本插件对匹配路径的 span 属性处理与 HTTP 指标记录；不会删除 HTTP 自动检测已创建的 span，也不会跳过 lifecycle 回调。需完全过滤底层 span 时配置对应 instrumentation/exporter。request.size 当前使用原始 req.path 标签，其他指标优先使用匹配路由；高基数路径需要额外评估。

**Node.js Runtime 指标**

由随包安装的 runtime-node instrumentation 提供，具体名称随版本变化。例如当前包包含 nodejs.eventloop.delay.\*、nodejs.eventloop.utilization、v8js.memory.heap.used 等定义。CPU、RSS 与 GC 的名字不能从旧版示例推定；应在本地 metrics 文件或 Collector 中确认当前实际出现的指标。

### Logs（日志关联）

已采样且 active span 正在 recording 的请求，经插件写入 requestContext 后，框架日志可以包含 trace_id / span_id。无活跃上下文、被忽略路径或未采样请求不保证这些字段：

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
- `createOtelLogBridge` — Schema B OTel LogRecord 桥接（通过当前 OTel Logs API provider）

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
默认 CLI 会延迟 SDK；设置 preloadSdk:true 才按这个入口在应用模块前启动。插件只能补尚未配置的导出器，不能覆盖已有目标。

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

插件层负责运行期 tracer / meter / logger 行为，例如 `ignorePaths`、指标桶、日志桥接，以及在 setup 阶段补充尚未配置的 exporter。下面及 capture 小节的选项片段沿用快速开始中的导入，替换同一个插件的参数，不要同时注册多份插件。

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
    labels: () => ({
      "app.zone": process.env.APP_ZONE ?? "local",
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
- 当前版本 headers/body 同样支持显式全量模式；默认不采集，示例选择白名单。可用 fields、exclude、sensitiveKeys、maxValueLength、maxDepth、maxItems 与 output 调整采集范围、脱敏及快照。body 只读取已解析数据，不会重新消费请求流。
- `capture` 生成的是 **Span attributes**，不会自动进入 `metrics.labels`；指标维度仍应单独通过 `metrics.labels` 提供，并保持低基数。

---

## 完整配置参考

### opentelemetryPlugin() 选项

```typescript
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({
  // ── 基础 ───────────────────────────────────────────
  serviceName: "my-app",
  endpoint: "http://collector:4318",
  protocol: "http",
  headers: { "api-key": "KEY" },

  // ── 追踪 ───────────────────────────────────────────
  tracing: {
    enabled: true,
    ignorePaths: ["/health", "/_otel/status", /^\/internal\//],
    spanNameResolver: (ctx) => `${ctx.method} ${ctx.route ?? ctx.path}`,
    startAttributes: (_ctx, req) => ({
      "user.id": String(req.headers["x-user-id"] ?? ""),
      "tenant.id": String(req.headers["x-tenant-id"] ?? ""),
    }),
    endAttributes: (_ctx, req) => ({
      "http.request_id_present": Boolean(req.requestId),
    }),
  },

  // ── 指标 ───────────────────────────────────────────
  metrics: {
    enabled: true,
    durationBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    labels: () => ({
      "app.zone": process.env.APP_ZONE ?? "local",
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
      req.app.logger.info({ requestId: req.requestId }, "request started");
    },
    onEnd: (ctx, req, info) => {
      if (info.statusCode >= 500) {
        req.app.logger.error(
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

> 下表区分插件包和 SDK 读取的环境变量；VextJS 场景推荐优先通过 `package.json vext.otel` 固化导出配置。

| 变量                                                                                                       | 当前读取边界                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| OTEL_SERVICE_NAME / OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_PROTOCOL / OTEL_EXPORTER_OTLP_HEADERS | 早期 config reader 支持；对应 package 字段优先                                       |
| OTEL_TRACES_SAMPLER_ARG                                                                                    | package 未指定 ratio 时可读取0—1；默认1；插件延迟启动不完整复用该读取链              |
| OTEL_TRACES_SAMPLER                                                                                        | NodeSDK 的策略输入；包显式传 sampler 时不能承诺此变量覆盖                            |
| OTEL_METRIC_EXPORT_INTERVAL                                                                                | 早期配置默认15000ms；package.metricIntervalMs 优先；已创建的 reader 不能由插件改周期 |
| OTEL_SDK_DISABLED                                                                                          | 字符串 true 关闭 SDK 与插件                                                          |
| VEXT_OTEL_FORCE_SDK                                                                                        | 真值强制早期 SDK；package.preloadSdk:true 是对应显式入口                             |
| OTEL_NODE_ENABLED_INSTRUMENTATIONS / OTEL_NODE_DISABLED_INSTRUMENTATIONS                                   | 选择自动检测项；同时触发早期 SDK                                                     |
| OTEL_LOG_LEVEL                                                                                             | SDK 诊断配置，是否输出还取决于诊断 logger；本插件不保证默认控制台级别                |

插件额外选项：enabled 默认为启用；insecure 仅在插件配置 gRPC exporter 时使用；resourceAttributes 当前是兼容占位，package reader 也没有读取同名字段，需 SDK Resource 属性时使用已支持的 OTEL_RESOURCE_ATTRIBUTES 并在实际产物核实。statusEndpoint 不支持自定义路径。tracing/metrics 默认开启，ignorePaths 默认空，logs.bridgeAppLogger 在 endpoint 非 none 时默认开启。

lifecycle 回调应同步完成，异常会警告并继续，不会作为业务授权/事务钩子；抛错路径的观测状态按500记录，可能与后续业务错误转换出的 HTTP 状态不同。metrics.labels 只附加到 duration/total；capture 只补 span 属性。

---

## 接入后端

### 本地开发

| 后端               | 启动方式                                                    | endpoint 配置                                              |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------------------------- |
| **无（文件导出）** | 不需要 Docker                                               | `package.json vext.otel.endpoint: "./otel-data"`           |
| **Jaeger**         | 按对应版本官方部署文档启用 OTLP/HTTP，主要查看 Trace        | `package.json vext.otel.endpoint: "http://localhost:4318"` |
| **Grafana LGTM**   | `docker run -d -p 3001:3000 -p 4318:4318 grafana/otel-lgtm` | `package.json vext.otel.endpoint: "http://localhost:4318"` |

### 云厂商

以下是地址形态示例；实际区域、租户地址、接收协议和鉴权字段以厂商控制台及官方接入文档为准。表格不表示本页已验证这些远端服务。

| 厂商              | endpoint                                    | headers                              |
| ----------------- | ------------------------------------------- | ------------------------------------ |
| **New Relic**     | `https://otlp.nr-data.net:4318`             | `{ "api-key": "LICENSE_KEY" }`       |
| **Grafana Cloud** | `https://otlp-gateway-....grafana.net/otlp` | `{ "Authorization": "Basic TOKEN" }` |
| **Datadog**       | `http://dd-agent-host:4318`                 | —                                    |
| **阿里云 ARMS**   | 参考阿里云 OTLP 接入文档                    | 参考文档                             |

> 云厂商 token 建议通过环境变量注入（K8s Secret），不要硬编码到代码中。

---

## 自动检测（Auto-Instrumentation）

`@devcodex/opentelemetry` 自带 `@opentelemetry/auto-instrumentations-node`，提供常见库的自动检测。能否获得数据库查询、HTTP 外调或消息队列的链路追踪，取决于 SDK 初始化顺序、库版本兼容性、检测项和采样配置。

### 安装

需要自动检测时设置 package.json 的 vext.otel.preloadSdk:true，再使用 vext dev/start；确认 SDK 在目标业务库加载前初始化。仅插件阶段才启动时，已经加载的库不保证被补充检测。

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

上图是可能的业务调用链，前提是路由实际调用这些依赖且对应 instrumentation 成功启用；演示 /otel-demo 不会产生不存在的数据库/Redis操作。

### 禁用特定检测

优先使用 auto-instrumentations-node 支持的环境变量选择检测项，无需再创建第二个 NodeSDK。例如在 PowerShell 启动前设置：

```powershell
$env:OTEL_NODE_DISABLED_INSTRUMENTATIONS = "fs,dns"
npm run dev
```

这里使用不含包名前缀的名称。当前包已默认关闭 fs；该设置也会触发早期 SDK。完整配置见 [OpenTelemetry 官方配置说明](https://opentelemetry.io/docs/zero-code/js/configuration/)，并核对已安装 instrumentation 的支持范围。

### 未安装时的行为

如果未安装 `@opentelemetry/auto-instrumentations-node`：

- 控制台输出一行 warning 提示
- 手动 withSpan 与 SDK 指标仍可使用；插件只补充已有 active span，没有 HTTP 自动检测时不能保证请求 span 或日志 trace 关联
- 缺少相应自动产生的请求及数据库 / 外部 HTTP span；业务是否继续运行还取决于应用自身逻辑

```
[vextjs-opentelemetry/instrumentation] @opentelemetry/auto-instrumentations-node is not installed.
  npm install @opentelemetry/auto-instrumentations-node
```

---

## 高级用法

### 手动追踪业务操作（withSpan）

`withSpan()` 是追踪自定义业务操作的推荐方式。它对 `tracer.startActiveSpan()` 做了 try/catch/finally 封装，自动处理 `span.end()`、`span.recordException()`、`span.setStatus()` 三件最容易遗漏的事。

#### VextJS 插件（通过 `app.otel.withSpan`）

以下片段可放在 src/routes/index.ts：先按本页安装并注册 OTel 插件，实现业务服务 `src/services/payment.ts` 的 `process(id)` 方法，再运行 typegen。测试时用支付服务替身；一次请求只执行一次支付操作。

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/payments",
    { validate: { body: { id: "string!" } } },
    async (req, res) => {
      const payment = await req.app.otel!.withSpan(
        "payment.process",
        async (span) => {
          const result = await req.app.services.payment.process(
            req.valid("body").id,
          );
          span.setAttribute("payment.result", result.status);
          return result;
        },
        {
          attributes: {
            "payment.provider": "stripe",
            "payment.currency": "USD",
          },
        },
      );

      res.json(payment);
    },
  );
});
```

**行为说明**：

| 场景         | 自动行为                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| 回调正常返回 | `span.end()` 自动调用                                                           |
| 回调抛出异常 | `span.recordException(err)` + `span.setStatus(ERROR)` + `span.end()` + re-throw |
| SDK 未初始化 | Noop span；不会导出遥测数据                                                     |

### 底层 API（自定义 SpanKind / Processor 等高级场景）

以下进阶片段同样放在 src/routes/index.ts，需先实现 src/services/user.ts 的 findById(id) 并运行 typegen；直接导入 OTel API 时执行 `npm install @opentelemetry/api`。startSpan 不会自动把新 span 设为子调用的 active context，需传播上下文时优先使用 withSpan。

```typescript
import { SpanStatusCode } from "@opentelemetry/api";
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/users/:id",
    { validate: { param: { id: "string!" } } },
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

```typescript
// src/plugins/business-metrics.ts
import { definePlugin } from "vextjs";
import type { OtelAppExtension } from "@devcodex/opentelemetry/vextjs";

export default definePlugin({
  name: "business-metrics",
  dependencies: ["opentelemetry"],
  setup(app) {
    const otel = app.otel as OtelAppExtension | undefined;
    if (!otel)
      throw new Error("OpenTelemetry plugin is disabled or unavailable");
    const meter = otel.meter;
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
当有效 ratio 小于1时使用 ParentBasedSampler(TraceIdRatioBasedSampler(ratio))；没有已采样父上下文的根 span 按该比例采样。修改后重启：

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

**方式二：未指定 package 采样时使用环境变量**

```bash
# 无需改代码，可在 CI/CD 或部署脚本中注入
VEXT_OTEL_FORCE_SDK=1 OTEL_TRACES_SAMPLER_ARG=0.1 npm start
```

### Cluster 多进程

```bash
VEXT_CLUSTER=1 npm start  # POSIX shell；Windows 可在配置中启用 cluster
```

### 自定义 instrumentation

项目 src/preload/ 与直接依赖包声明的 vext.preload 会合并执行。应用自己的 package.json.vext.preload 不是项目脚本入口，更不会替换依赖包入口。不要在默认接入旁再创建一个未协调的 NodeSDK。

确需自己拥有 SDK 时，先阅读[预加载指南](/zh/guide/preload)，明确排除/禁用内置启动入口、初始化顺序、导出器和关闭所有权，再按上游自定义 SDK 文档实施。本页默认例程使用一个受插件管理的 SDK，不把额外入口当作现成替换方案。

---

## 日志字段规划

VextJS + @devcodex/opentelemetry 支持两层日志输出，各有侧重：

- **A. 落地日志（stdout / file JSON）**：业务字段清晰可读，便于人工排查和日志聚合（ELK/Loki）
- **B. OTel Logs（LogRecord → Collector）**：轻量级，通过 `trace_id` 关联完整链路

### A. 落地日志字段（stdout / file JSON）

通过 config.logger.mixin 添加稳定业务字段；日志 mixin 不等同于 SDK Resource 配置。以下替换前面的 logger 配置即可，无需顶层 await，也不读取非公开 Span.name：

```typescript
// src/config/default.ts
import os from "node:os";

export default {
  logger: {
    level: "info",
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

trace_id / span_id 由有活跃 recording span 的请求上下文提供；业务 span 名称可由业务日志显式记录。

输出字段片段示例：

```json
{
  "level": 30,
  "time": "2026-09-25T00:00:00.000Z",
  "service_name": "my-app",
  "env": "production",
  "host": "web-pod-a1b2c3",
  "requestId": "my-app-19f8d0dd",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "msg": "otel demo completed"
}
```

> `requestId`、以及写入 `requestContext` 的 `traceId` / `spanId` 会由框架内置 provider 自动注入为 `requestId`、`trace_id`、`span_id`；不需要在用户 mixin 中重复配置。

#### 字段对照表

| 字段           | 来源                             | 配置方式                                          |
| -------------- | -------------------------------- | ------------------------------------------------- |
| `time`         | Vext logger，默认 ISO 时间字符串 | 公共 logger 配置不提供 timestamp 开关             |
| `level`        | Vext logger 自动                 | 无需配置                                          |
| `msg`          | `logger.info("...")`             | 无需配置                                          |
| `requestId`    | 框架 ALS → mixin 自动            | 无需配置                                          |
| `trace_id`     | otel 中间件 → ALS → mixin 自动   | 无需配置                                          |
| `span_id`      | otel 中间件 → ALS → mixin 自动   | 无需配置                                          |
| `service_name` | `config.logger.mixin`            | 用户 mixin 注入                                   |
| `env`          | `config.logger.mixin`            | 用户 mixin 注入                                   |
| `host`         | `config.logger.mixin`            | 用户 mixin 注入                                   |
| `span`         | 业务显式字段                     | 不依赖非公开 Span.name；上面的 mixin 不注入该字段 |
| `endpoint`     | access log 中的 `req.route`      | 自动包含在请求日志 msg 中                         |
| `latency_ms`   | access log                       | 自动包含在请求日志 msg 中                         |
| `user_id`      | 业务代码                         | `logger.info({ user_id: "..." }, msg)`            |
| `feature.flag` | 业务代码                         | `logger.info({ "feature.flag": "..." }, msg)`     |
| `err`          | logger.error(err)                | 框架落地序列化；不自动等于 OTel exception.\*      |

### B. OTel Logs（LogRecord → Collector）

Vext 默认 logger 不依赖第三方 logger，因此 logger-specific auto instrumentation 不会自动捕获 `app.logger`。如需输出 OTel Logs，可通过 `@devcodex/opentelemetry` 的 `app.setLogger()` 桥接，或自定义插件包装当前 logger：

- **`trace_id` / `span_id`**：从 `requestContext` 或 active span 写入 LogRecord
- **`severity_text`**：从 Vext logger level 映射
- **`body`**：日志消息内容
- **`service.name`**：来自 Resource（instrumentation.ts 已配置）
- **`attributes`**：结构化日志字段映射为 LogRecord attributes

当前桥接读取 logger 调用参数，然后调用原 logger；原 logger 后续生成的 mixin 字段不会自动进入 LogRecord。需要两边都有的字段，应在日志参数中显式传入，或给 OTel 设置 logs.globalAttributes。bridge 默认在 endpoint 非 none 时启用，只包装 info/warn/error/debug/fatal，child logger 与 trace 方法不自动桥接；嵌套对象字段也不会完整透传。

::: tip OTel Logs 最佳实践
避免在 LogRecord attributes 中放入所有落地日志字段。OTel Logs 通过 `trace_id` 关联 Trace 即可看到 `endpoint`、`latency_ms`、`user.id` 等完整上下文。保持 LogRecord 轻量有助于控制 Collector 流量。
:::

### C. 深层字段（自动出现在子 Span 中）

以下是旧语义命名下的示意，实际字段取决于已安装 instrumentation、目标库、配置与采样；例如新版本可能使用 url.full 或 db.query.text，不能把此表当作所有请求必有的字段合同：

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
2. **关闭预算** — 插件 onClose 调用 SDK shutdown；按实际批处理/网络延迟设置 shutdown.timeout（秒）并验证。增大期限不能保证 Collector 成功接收
3. **限制 `/_otel/status`** — 当前 VextJS 适配器会自动注册该路由，生产环境请在网关层限制为内网访问
4. **不要在 Span 中记录敏感信息** — 密码、Token、身份证号等
5. **采样** — 统一 package sampling 或已核实的环境配置，重启后观察实际输出量
6. **部署 Collector** — 应用 → Collector → 后端，解耦 + 缓冲

```
应用（N 个） ──OTLP──► Collector ──► Jaeger / Prometheus / Grafana
```

---

## 常见问题

### Q: `/_otel/status` 返回 `"sdk": "noop"`

未配置 endpoint 时 noop 可能正是预期。需要输出时检查直接依赖、插件启用、package endpoint/preloadSdk 和 OTEL_SDK_DISABLED；完全禁用插件会使该接口404。

### Q: endpoint 显示 localhost 但我配了其他地址

① 检查 `package.json` `vext.otel.endpoint` ② 确认插件里的 `endpoint/protocol/headers` 与 `package.json` 保持一致 ③ 确认用 `vext start/dev` 启动

### Q: 日志没有 trace_id

检查 SDK、早期自动检测、插件接入及采样；还需 requestContext 已启用且该日志位于 recording span 请求上下文。状态 initialized 不足以证明当前请求有 active span。

### Q: 后端收不到数据

先确认 exportMode/exportTarget，再用本地文件区分“未产生数据”和“发送失败”。检查后端实际接收记录、鉴权、协议与网络；等待配置的批处理/指标周期。当前包不保证逐批打印 SUCCESS，gRPC 失败/恢复日志也不等于所有信号均已接收。

### Q: `[otel] ... export FAILED: grpcSend timeout`

服务器到采集器的 h2c gRPC 连接受阻。检查：① 采集器地址和端口可达 ② 采集器服务正常运行 ③ 网络防火墙/安全组规则 ④ 如在 Docker/K8s 内，使用 Service DNS 而非 localhost

### Q: 我直接用 `node dist/server.js` 启动，为什么 SDK 没生效？

因为 VextJS 的“零配置接入”依赖 CLI 在启动前自动扫描依赖包里的 `vext.preload` 并注入 `--import`。

可选做法：

1. **推荐**：通过项目 npm scripts 使用 vext dev / vext start
2. **自定义 Node 启动命令**：仅在你确实编写了完整应用启动入口时，手动补上 `--import @devcodex/opentelemetry/instrumentation`；标准 Vext build 不会凭空生成 dist/server.js

```bash
node --import @devcodex/opentelemetry/instrumentation dist/server.js
```

### Q: 测试环境如何彻底禁用

```json
{
  "vext": {
    "otel": {
      "enabled": false
    }
  }
}
```

或启动前设置 OTEL_SDK_DISABLED=true。关闭后也要停用依赖 app.otel 的演示路由；只写 endpoint:none 表示不导出，不能替代整个集成的关闭。

## 相关文档

- [预加载](/zh/guide/preload)：项目与依赖入口、开发/生产生命周期。
- [插件](/zh/guide/plugins)：setup、依赖顺序和关闭。
- [日志](/zh/guide/logger)与[访问日志](/zh/api/access-log)：落地字段、上下文与响应完成时机。
- [部署](/zh/guide/deployment)：启动、进程与关闭预算。

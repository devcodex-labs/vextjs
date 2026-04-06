# OpenTelemetry 可观测性

`vextjs-opentelemetry` 提供完整的 OpenTelemetry 可观测性支持，覆盖 **VextJS、Express、Koa、Egg.js、Hono、Fastify** 等主流框架，统一输出 Traces + Metrics + Logs 三大支柱。

---

## 快速开始（VextJS 框架）

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
import { opentelemetryPlugin } from "vextjs-opentelemetry/vextjs";
export default opentelemetryPlugin({ serviceName: "my-app" });
```

> **注意**：`opentelemetryPlugin` 通过 `vextjs-opentelemetry/vextjs` 子路径导入（VextJS 专属）。
> 主入口 `vextjs-opentelemetry` 只导出框架无关工具（`createWithSpan`、`getOtelStatus`）。

### 3. 启动

```bash
vext start    # 生产模式
vext dev      # 开发模式
```

> `vext start` / `vext dev` 自动运行 OTel SDK 初始化脚本（`vextjs-opentelemetry` 已在其 `package.json` 声明 `"vext.preload": "./dist/instrumentation.js"`，VextJS CLI 自动扫描并以 `--import` 注入，无需手动配置）。
> **默认不上报**——SDK 初始化脚本在启动时读取**项目自身 `package.json`** 的 `vext.otel.endpoint` 字段来决定上报地址，未配置时安全 noop（数据被丢弃，不会发送到任何地址）。

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

> `package.json vext.otel.endpoint` 是 VextJS 模式下**唯一控制实际导出**的配置。相对路径基于 `process.cwd()` 解析。

创建插件（保持 `serviceName` 与 `package.json` 一致，`otlpEndpoint` 可选，仅影响 `/_otel/status` 显示）：

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "vextjs-opentelemetry/vextjs";

export default opentelemetryPlugin({ serviceName: "my-app" });
```

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

## 多框架接入（非 VextJS）

不使用 VextJS 框架时，通过 `vextjs-opentelemetry/init` 子路径初始化 SDK，再按需选择框架适配器。

### 安装

```bash
npm install vextjs-opentelemetry @opentelemetry/api
```

如需上报到 OTLP Collector，以下包已内置于 `vextjs-opentelemetry/init`，**无需额外安装**：

```text
@opentelemetry/sdk-trace-node  @opentelemetry/sdk-metrics  @opentelemetry/sdk-logs
@opentelemetry/otlp-transformer（Protobuf 序列化）
```

### SDK 初始化（`vextjs-opentelemetry/init`）

`initOtel()` 封装了完整的三路 SDK（Trace / Metric / Log）初始化，以及 h2c gRPC 传输层（原生 `node:http2`，兼容自建采集器）。

```typescript
import { initOtel } from "vextjs-opentelemetry/init";

initOtel({
  serviceName: "my-app",
  endpoint: "otel-collector.internal:4317",   // host:port → h2c gRPC（推荐）
  // endpoint: "none",                         // 不上报（安全默认值）
  instrumentations: [],                        // 由调用方传入 Instrumentation 实例
  metricExportIntervalMs: 30_000,              // 指标上报间隔（默认 30s）
  globalLoggerKey: "_otelLogger",              // globalThis key，供 log bridge 使用
});
```

**endpoint 格式**：

| 格式 | 传输模式 | 说明 |
|------|---------|------|
| `"host:port"` | h2c gRPC（明文 HTTP/2）| 原生 `node:http2`，兼容自建采集器 |
| `"none"` / `""` | 不上报 | SDK 初始化，context propagation 生效，数据被丢弃 |

> **为什么用 h2c gRPC？** `@grpc/grpc-js` 与部分自建采集器的 h2c 握手不兼容。本实现直接用 `node:http2`，三路会话（Trace/Metric/Log）独立管理，断连自动重建。

---

### Express

```typescript
// app.ts（在 SDK 初始化之后执行）
import express from "express";
import { createExpressMiddleware } from "vextjs-opentelemetry/express";
import { createWithSpan, getOtelStatus } from "vextjs-opentelemetry";

const app = express();

// OTel 中间件（全局，越早越好）
app.use(createExpressMiddleware({
  serviceName: "my-express-app",
  tracing: {
    ignorePaths: ["/health"],
    extraAttributes: (req) => ({ "user.id": req.headers["x-user-id"] ?? "" }),
  },
}));

// /_otel/status 手动注册
app.get("/_otel/status", (_req, res) => {
  res.json(getOtelStatus({
    serviceName: "my-express-app",
    endpoint: process.env.OTEL_COLLECTOR_ENDPOINT || "otel-collector.internal:4317",
  }));
});

// 业务路由中使用 withSpan
const withSpan = createWithSpan("my-express-app");

app.get("/users/:id", async (req, res) => {
  const user = await withSpan("db.user.find", () => UserModel.findById(req.params.id));
  res.json(user);
});
```

运行时通过 `--import` 加载 SDK（ESM）或 `--require`（CJS），需在主入口前初始化：

```bash
# 方案一：单独的 esm preload 文件
node --import ./otel-init.mjs app.js

# 方案二：应用顶部同步初始化（CJS 时有效）
const { initOtel } = require("vextjs-opentelemetry/init");
initOtel({ serviceName: "my-express-app", endpoint: "..." });
```

---

### Koa

```typescript
// app.ts
import Koa from "koa";
import Router from "@koa/router";
import { createKoaMiddleware } from "vextjs-opentelemetry/koa";
import { createWithSpan, getOtelStatus } from "vextjs-opentelemetry";

const app = new Koa();
const router = new Router();

// OTel 中间件（最先注册）
app.use(createKoaMiddleware({
  serviceName: "my-koa-app",
  tracing: { ignorePaths: ["/health", /^\/internal\//] },
}));

// /_otel/status
router.get("/_otel/status", (ctx) => {
  ctx.body = getOtelStatus({
    serviceName: "my-koa-app",
    endpoint: process.env.OTEL_COLLECTOR_ENDPOINT || "otel-collector.internal:4317",
  });
});

// 业务路由
const withSpan = createWithSpan("my-koa-app");

router.get("/users/:id", async (ctx) => {
  ctx.body = await withSpan("db.user.find", () => UserModel.findById(ctx.params.id));
});

app.use(router.routes());
```

> **无 HTTP auto-instrumentation 时**，`createKoaMiddleware` 会自动创建 `SpanKind.SERVER` span；若已有 active span（如注册了 `@opentelemetry/instrumentation-http`）则不重复创建，直接标注已有 span。

---

### Egg.js

Egg.js 采用 `--require` CJS 模式初始化 SDK（必须在应用 Worker 加载任何模块前执行），并通过 Egg 扩展机制将 `withSpan` 注入到 `ctx`。

#### 步骤 1：otel-init.cjs

```javascript
// app/otel-init.cjs
'use strict';

const { initOtel } = require('vextjs-opentelemetry/init');
const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
const { MySQL2Instrumentation } = require('@opentelemetry/instrumentation-mysql2');

initOtel({
  serviceName: 'my-service',
  endpoint: process.env.OTEL_COLLECTOR_ENDPOINT || 'otel-collector.internal:4317',
  instrumentations: [
    new MongoDBInstrumentation(),
    new IORedisInstrumentation(),
    new MySQL2Instrumentation(),
  ],
});
```

在 `package.json` 的 `scripts` 中通过 `--require` 加载：

```json
{
  "scripts": {
    "dev": "egg-bin dev --require ./app/otel-init.cjs",
    "start": "egg-scripts start --require ./app/otel-init.cjs"
  }
}
```

#### 步骤 2：OTel 中间件

```typescript
// app/middleware/otel.ts
import { createKoaMiddleware } from 'vextjs-opentelemetry/koa';
import type { Application } from 'egg';

export default (_options: unknown, _app: Application) =>
  createKoaMiddleware({
    serviceName: 'my-service',
    tracing: {
      ignorePaths: ['/health', '/_otel/status', /^\/internal\//],
    },
  });
```

```typescript
// config/config.default.ts
config.middleware = ['otel', /* 其他中间件 */];
```

#### 步骤 3：ctx.withSpan 扩展

```typescript
// app/extend/context.ts
import { createWithSpan } from 'vextjs-opentelemetry';

const withSpan = createWithSpan('my-service');

export default { withSpan };
```

TypeScript 类型声明：

```typescript
// typings/index.d.ts
import 'egg';

declare module 'egg' {
  interface Context {
    withSpan: ReturnType<typeof import('vextjs-opentelemetry').createWithSpan>;
    // ... 其他扩展
  }
}
```

#### 步骤 4：注册 /_otel/status 路由

```typescript
// app/router.ts
import { Application } from 'egg';
import { getOtelStatus } from 'vextjs-opentelemetry';

export default (app: Application) => {
  const { router, controller } = app;

  // OTel 状态检查（生产环境建议网关层限制内网访问）
  router.get('/_otel/status', async (ctx) => {
    ctx.body = getOtelStatus({
      serviceName: 'my-service',
      endpoint: process.env.OTEL_COLLECTOR_ENDPOINT || 'otel-collector.internal:4317',
    });
  });

  // 业务路由
  router.get('/users/:id', controller.user.findById);
};
```

#### 步骤 5：在 Controller 中使用

```typescript
// app/controller/userController.ts
import { Controller } from 'egg';

export default class UserController extends Controller {
  async findById() {
    const { ctx } = this;
    const user = await ctx.withSpan('db.user.findById', async (span) => {
      span.setAttribute('user.id', ctx.params.id);
      return ctx.service.user.findById(ctx.params.id);
    });
    ctx.body = user;
  }
}
```

---

### Hono

```typescript
// app.ts
import { Hono } from "hono";
import { createHonoMiddleware } from "vextjs-opentelemetry/hono";
import { createWithSpan, getOtelStatus } from "vextjs-opentelemetry";

const app = new Hono();

app.use(createHonoMiddleware({
  serviceName: "my-hono-app",
  tracing: { ignorePaths: ["/health"] },
}));

app.get("/_otel/status", (c) =>
  c.json(getOtelStatus({
    serviceName: "my-hono-app",
    endpoint: process.env.OTEL_COLLECTOR_ENDPOINT || "otel-collector.internal:4317",
  })),
);

const withSpan = createWithSpan("my-hono-app");

app.get("/users/:id", async (c) => {
  const user = await withSpan("db.user.find", () =>
    UserModel.findById(c.req.param("id")),
  );
  return c.json(user);
});
```

---

### Fastify

```typescript
// app.ts
import Fastify from "fastify";
import { createFastifyPlugin } from "vextjs-opentelemetry/fastify";
import { createWithSpan, getOtelStatus } from "vextjs-opentelemetry";

const fastify = Fastify();

await fastify.register(createFastifyPlugin({
  serviceName: "my-fastify-app",
  tracing: { ignorePaths: ["/health"] },
}));

fastify.get("/_otel/status", () =>
  getOtelStatus({
    serviceName: "my-fastify-app",
    endpoint: process.env.OTEL_COLLECTOR_ENDPOINT || "otel-collector.internal:4317",
  }),
);

const withSpan = createWithSpan("my-fastify-app");

fastify.get("/users/:id", async (request) => {
  return withSpan("db.user.find", () =>
    UserModel.findById((request.params as any).id),
  );
});
```

---

## `/_otel/status` 状态检查接口

用于验证 OTel SDK 当前运行状态：

```bash
curl http://localhost:3000/_otel/status
```

```json
{
  "sdk": "initialized",
  "serviceName": "my-app",
  "exportMode": "grpc",
  "endpoint": "otel-collector.internal:4317",
  "autoInstrumentation": true
}
```

| 字段 | 说明 |
|------|------|
| `sdk` | `"initialized"` = SDK 正常 / `"noop"` = SDK 未初始化 |
| `serviceName` | 当前生效的服务名 |
| `exportMode` | `"grpc"` = h2c gRPC / `"otlp"` = HTTP OTLP / `"file"` = 本地文件 / `"none"` = 未配置 |
| `endpoint` | 当前生效的上报目标（未配置时为 `"none"`） |
| `autoInstrumentation` | 是否启用了自动检测（MongoDB/Redis/MySQL 等） |

**VextJS**：启动后自动注册，无需手动配置（可通过 `statusEndpoint: false` 禁用）。

**非 VextJS**：在路由层调用 `getOtelStatus()` 手动注册（见各框架接入示例）。

**生产环境**建议在网关层限制内网访问。

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

**结构化日志（Schema A + Schema B）**

当日志需同时落地（Schema A）并上报至 OTLP Collector（Schema B）时，使用 `vextjs-opentelemetry/log` 提供的两个工厂函数：

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

**Egg.js 配置示例（`config/config.default.ts`）**

```typescript
import {
  createStructuredLogFormatter,
  createOtelLogBridge,
} from 'vextjs-opentelemetry/log';

// Schema B 桥接：延迟求值，SDK 初始化前返回 null（noop）
const bridge = createOtelLogBridge(() => (globalThis as any)._otelLogger);

// Schema A 格式化器
const formatter = createStructuredLogFormatter({
  serviceName: 'my-service',
  getTraceFields: (meta: any) => ({
    trace_id:   meta.ctx?.trace_id  ?? '',
    span:        meta.ctx?.span      ?? '',
    endpoint:    meta.ctx?.endpoint  ?? '',
    latency_ms:  meta.ctx?.latency_ms ?? 0,
    user_id:     meta.ctx?.user_id   ?? '',
  }),
  getCustomFields: (meta: any) => ({
    'feature.flag': meta.ctx?.feature_flag ?? '',
  }),
});

// logger 配置
config.logger = {
  formatter(meta: any) {
    // Schema B — OTel LogRecord（trace_id/span_id 从 AsyncLocalStorage 自动注入）
    bridge.emit(meta.level ?? 'info', meta.message ?? '', {
      ...(meta.ctx?.endpoint  ? { endpoint:  meta.ctx.endpoint  } : {}),
      ...(meta.ctx?.user_id   ? { 'user.id': meta.ctx.user_id   } : {}),
    });
    // Schema A — 落地日志 JSON
    return formatter(meta);
  },
};
```

> `initOtel()` 已将 `LoggerProvider.getLogger(serviceName)` 写入 `globalThis._otelLogger`（默认 key），`createOtelLogBridge` 通过工厂函数延迟求值，SDK 初始化前调用时安全 noop。

---

## 配置方式（VextJS）

VextJS 的 OTel 配置分两层，目的不同：

### 第一层：实际上报地址（`package.json`，必须）

由 SDK 初始化脚本（`instrumentation.ts`，通过 `vext.preload` 在应用代码前执行）读取，**唯一控制遥测数据实际发往何处**。插件参数和 `vext.config.ts` 均不影响导出行为。

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

### 第二层：状态显示（插件参数 / vext.config.ts，可选）

仅影响 `/_otel/status` 的 `endpoint` 字段返回值，不控制实际导出。建议与第一层保持一致，方便运维核查。

```typescript
// src/plugins/otel.ts（otlpEndpoint 仅用于状态显示）
export default opentelemetryPlugin({
  serviceName: "my-app",
  otlpEndpoint: "http://otel-collector.internal:4318",  // 与 package.json 保持一致
  otlpHeaders: { "api-key": "YOUR_KEY" },
});
```

或通过 `vext.config.ts`：

```typescript
// src/config/default.ts
export default {
  otel: {
    serviceName: "my-app",
    enabled: true,
    endpoint: "http://otel-collector:4318",
  },
};
```

> 不再支持通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 环境变量覆盖上报地址，请统一通过 `package.json vext.otel` 配置。

---

## 完整配置参考

### opentelemetryPlugin() 选项

```typescript
opentelemetryPlugin({
  // ── 基础 ───────────────────────────────────────────
  serviceName: "my-app",           // 服务名称
  enabled: true,                    // false 时完全 no-op

  // ── 状态显示（不控制实际导出，仅影响 /_otel/status 响应）──────────
  otlpEndpoint: "http://collector:4318",  // 建议与 package.json vext.otel.endpoint 一致
  otlpHeaders: { "api-key": "KEY" },      // 同上

  // ── 状态检查 ───────────────────────────────────────
  statusEndpoint: "/_otel/status",  // 自定义路径，false 禁用

  // ── 追踪 ───────────────────────────────────────────
  tracing: {
    enabled: true,
    ignorePaths: ["/health", "/_otel/status", /^\/internal\//],  // 忽略的路径
    spanNameResolver: (req) => `${req.method} ${req.route ?? req.path}`,  // Span 名称
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
    headers: { "api-key": "KEY" },    sampling: { ratio: 1.0 },       // 采样率 0.0~1.0，默认全量  },
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
| **无（文件导出）** | 不需要 Docker | `package.json vext.otel.endpoint: "./otel-data"` |
| **Jaeger** | `docker run -d -p 4318:4318 -p 16686:16686 -e COLLECTOR_OTLP_ENABLED=true jaegertracing/all-in-one` | `package.json vext.otel.endpoint: "http://localhost:4318"` |
| **Grafana LGTM** | `docker run -d -p 3000:3000 -p 4318:4318 grafana/otel-lgtm` | `package.json vext.otel.endpoint: "http://localhost:4318"` |

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

### 手动追踪业务操作（withSpan）

`withSpan()` 是追踪自定义业务操作的推荐方式。它对 `tracer.startActiveSpan()` 做了 try/catch/finally 封装，自动处理 `span.end()`、`span.recordException()`、`span.setStatus()` 三件最容易遗漏的事。

#### VextJS 插件（通过 `app.otel.withSpan`）

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post("/payments", async (req, res) => {
    // ① 最简：完全不接触 span（仅追踪生命周期）
    const result = await req.app.otel!.withSpan(
      "payment.process",
      () => processPayment(req.body.id),
    );

    // ② 带静态初始属性
    const result = await req.app.otel!.withSpan(
      "payment.process",
      () => processPayment(req.body.id),
      { attributes: { "payment.provider": "stripe", "payment.currency": "USD" } },
    );

    // ③ 动态属性（依赖执行结果时，通过回调参数访问 span）
    const result = await req.app.otel!.withSpan("payment.process", async (span) => {
      const res = await processPayment(req.body.id);
      span.setAttribute("payment.result", res.status);
      return res;
    });

    res.json(result);
  });
});
```

#### 非 VextJS 框架（通过 `createWithSpan()` 工厂）

```typescript
import { createWithSpan } from "vextjs-opentelemetry";

// 应用启动时初始化（绑定 tracer 名称，通常与 serviceName 一致）
const withSpan = createWithSpan("payment");

// Express / Koa / Hono / Fastify 路由中使用
router.post("/charge", async (req, res) => {
  const result = await withSpan("payment.charge", async (span) => {
    span.setAttribute("payment.amount", req.body.amount);
    return await chargeService.run(req.body);
  });
  res.json(result);
});
```

#### Egg.js（通过 `ctx.withSpan`，由 `app/extend/context.ts` 注入）

```typescript
// app/controller/paymentController.ts
export default class PaymentController extends Controller {
  async charge() {
    const { ctx } = this;
    // ctx.withSpan 由 app/extend/context.ts 注入，直接调用
    const result = await ctx.withSpan("payment.charge", async (span) => {
      span.setAttribute("payment.amount", ctx.request.body.amount);
      return ctx.service.payment.charge(ctx.request.body);
    });
    ctx.body = result;
  }
}
```

**行为说明**：

| 场景 | 自动行为 |
|------|---------|
| 回调正常返回 | `span.end()` 自动调用 |
| 回调抛出异常 | `span.recordException(err)` + `span.setStatus(ERROR)` + `span.end()` + re-throw |
| SDK 未初始化 | Noop span，零 overhead（OTel API 契约保证） |

### 底层 API（自定义 SpanKind / Processor 等高级场景）

需要精细控制 span 类型或自定义处理时，可直接使用 `tracer`：

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

VextJS + vextjs-opentelemetry 支持两层日志输出，各有侧重：

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

> `requestId`、`trace_id`、`span_id` 由框架内置 mixin 自动注入，不需要在用户 mixin 中重复配置。

#### 字段对照表

| 字段 | 来源 | 配置方式 |
|------|------|---------|
| `timestamp` | pino 自动 | 无需配置 |
| `level` | pino 自动 | 无需配置 |
| `msg` | `logger.info("...")` | 无需配置 |
| `requestId` | 框架 ALS → mixin 自动 | 无需配置 |
| `trace_id` | otel 中间件 → ALS → mixin 自动 | 无需配置 |
| `span_id` | otel 中间件 → ALS → mixin 自动 | 无需配置 |
| `service_name` | `config.logger.mixin` | 用户 mixin 注入 |
| `env` | `config.logger.mixin` | 用户 mixin 注入 |
| `host` | `config.logger.mixin` | 用户 mixin 注入 |
| `span` | `trace.getActiveSpan().name` | 用户 mixin 注入 |
| `endpoint` | access log 中的 `req.route` | 自动包含在请求日志 msg 中 |
| `latency_ms` | access log | 自动包含在请求日志 msg 中 |
| `user_id` | 业务代码 | `logger.info({ user_id: "..." }, msg)` |
| `feature.flag` | 业务代码 | `logger.info({ "feature.flag": "..." }, msg)` |
| `exception.*` | `logger.error(err)` | pino serializer 自动展开 |

### B. OTel Logs（LogRecord → Collector）

由 `@opentelemetry/instrumentation-pino`（auto-instrumentations-node 包含）自动完成：

- **`trace_id` / `span_id`**：自动从 active span 注入到 LogRecord
- **`severity_text`**：从 pino level 自动映射
- **`body`**：日志消息内容
- **`service.name`**：来自 Resource（instrumentation.ts 已配置）
- **`attributes`**：pino 日志的自定义字段自动映射为 LogRecord attributes

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

| 字段 | 来源 | 出现位置 |
|------|------|---------|
| `db.statement` | DB instrumentation 自动 | 数据库子 Span attributes |
| `db.system` | DB instrumentation 自动 | 数据库子 Span attributes |
| `cache.system` | Redis/Memcached instrumentation 自动 | 缓存子 Span attributes |
| `http.url` | HTTP instrumentation 自动 | 外部调用子 Span attributes |

> 通过 `trace_id` 在 Jaeger / Grafana Tempo 中查看完整调用链路即可关联这些深层字段。

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

**VextJS**：① 使用 `vext start/dev` 启动 ② `vextjs-opentelemetry` 在 dependencies 中 ③ SDK 包已安装

**非 VextJS（`initOtel` 模式）**：确认 `--require ./app/otel-init.cjs` 在所有业务模块加载前执行。Egg.js 需在 `package.json` 的 `scripts` 中加入 `--require` 参数。

### Q: endpoint 显示 localhost 但我配了其他地址

① 检查插件参数 `otlpEndpoint` / `initOtel` 的 `endpoint` 配置 ② 确认 `package.json` `vext.otel.endpoint` 与插件参数一致 ③ 确认用 `vext start/dev` 启动

### Q: 日志没有 trace_id

先确认 `/_otel/status` 返回 `"sdk": "initialized"`，SDK 必须正常才有 trace。  
**非 VextJS 框架**：`createKoaMiddleware` / `createExpressMiddleware` 等适配器从 OTel active span 读取 trace_id，需确认中间件已注册且在路由之前执行。  
**Koa / Egg.js 未使用 HTTP auto-instrumentation**：`createKoaMiddleware` 会自动创建 SERVER span，无需额外安装 `@opentelemetry/instrumentation-http`。

### Q: 后端收不到数据

① `/_otel/status` 确认 `sdk: "initialized"` + `endpoint` 正确 ② 服务日志中确认 `[otel] ... export SUCCESS (grpc-status:0)` ③ 等 30 秒（批量上报延迟）④ 用接 Jaeger/LGTM 本地调试确认数据格式

### Q: `[otel] ... export FAILED: grpcSend timeout`

服务器到采集器的 h2c gRPC 连接受阻。检查：① 采集器地址和端口可达 ② 采集器服务正常运行 ③ 网络防火墙/安全组规则 ④ 如在 Docker/K8s 内，使用 Service DNS 而非 localhost

### Q: Egg.js 热重载后 SDK 不报数

Egg.js 文件监听触发 Worker 重启时，`--require` 会在新 Worker 进程中重新执行，SDK 会重新初始化。若 Worker 启动过程中因外部依赖（如 Nacos、MySQL）超时导致崩溃，是启动依赖问题，与 OTel 无关。

### Q: 测试环境如何禁用

```typescript
// VextJS —— src/config/test.ts
export default { otel: { enabled: false } };
```

```typescript
// 非 VextJS —— 测试入口不调用 initOtel()，或传入 endpoint: "none"
initOtel({ serviceName: "my-app", endpoint: "none" });
```

# OpenTelemetry 接入示例

本示例演示如何在 VextJS 中集成 [OpenTelemetry](https://opentelemetry.io/)（简称 OTEL），实现完整的可观测性三大支柱：**Traces（链路追踪）**、**Metrics（指标监控）** 和 **Logs（日志关联）**。

## 前置条件

- Node.js 18+
- VextJS 项目已初始化
- 可观测性后端（如 Jaeger / Zipkin / Grafana Tempo 用于 Traces，Prometheus 用于 Metrics）

## 安装依赖

```bash
# 核心 SDK
npm install @opentelemetry/sdk-node \
            @opentelemetry/api

# Traces 导出器（选择其一）
npm install @opentelemetry/exporter-trace-otlp-http
# 或 Jaeger: npm install @opentelemetry/exporter-jaeger

# Metrics 导出器
npm install @opentelemetry/exporter-metrics-otlp-http
# 或 Prometheus: npm install @opentelemetry/exporter-prometheus

# 自动检测（HTTP / fetch）
npm install @opentelemetry/auto-instrumentations-node

# 资源检测（进程、主机信息）
npm install @opentelemetry/resources \
            @opentelemetry/semantic-conventions
```

## 项目结构

```
src/
├── instrumentation.ts        # OTEL SDK 初始化（必须最先加载）
├── plugins/
│   └── opentelemetry.ts      # VextJS OTEL 插件
├── middlewares/
│   └── tracing.ts            # 链路追踪中间件
├── services/
│   └── user.ts               # 业务服务（演示 Span 创建）
├── routes/
│   └── users.ts              # 路由
└── vext.config.ts            # 配置文件
```

## 第一步：SDK 初始化

OpenTelemetry SDK 必须在应用所有其他模块之前初始化。创建一个独立的入口文件：

```typescript
// src/instrumentation.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const resource = new Resource({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'vext-app',
  [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
  'deployment.environment': process.env.NODE_ENV ?? 'development',
});

const sdk = new NodeSDK({
  resource,

  // Traces — 导出到 OTLP Collector
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      ?? 'http://localhost:4318/v1/traces',
  }),

  // Metrics — 定期导出到 OTLP Collector
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
        ?? 'http://localhost:4318/v1/metrics',
    }),
    exportIntervalMillis: 15000,  // 每 15 秒导出一次
  }),

  // 自动检测（HTTP 入站/出站、fetch、dns 等）
  instrumentations: [
    getNodeAutoInstrumentations({
      // 按需禁用不需要的检测
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();
console.log('[otel] OpenTelemetry SDK initialized');

// 优雅关闭
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[otel] SDK shut down'))
    .catch((err) => console.error('[otel] SDK shutdown error', err))
    .finally(() => process.exit(0));
});

export { sdk };
```

:::warning 加载顺序
`instrumentation.ts` 必须在应用入口最先导入。推荐使用 Node.js `--require` 或 `--import` 参数：

```bash
# 开发环境
node --import ./dist/instrumentation.js ./dist/index.js

# 或使用 vext.config.ts 中的 NODE_OPTIONS
NODE_OPTIONS="--import ./dist/instrumentation.js" vext start
```
:::

## 第二步：VextJS 插件

创建 OTEL 插件，将 Tracer 和 Meter 挂载到 `app` 上，供全局使用：

```typescript
// src/plugins/opentelemetry.ts
import { definePlugin } from 'vextjs';
import { trace, metrics, SpanStatusCode } from '@opentelemetry/api';
import type { Tracer, Meter } from '@opentelemetry/api';

export default definePlugin({
  name: 'opentelemetry',

  async setup(app) {
    const serviceName = app.config.otel?.serviceName ?? 'vext-app';

    // 获取 Tracer 和 Meter 实例
    const tracer: Tracer = trace.getTracer(serviceName);
    const meter: Meter = metrics.getMeter(serviceName);

    // ── 创建通用指标 ────────────────────────────────────

    const httpRequestDuration = meter.createHistogram('http.server.duration', {
      description: 'HTTP request duration in milliseconds',
      unit: 'ms',
    });

    const httpRequestTotal = meter.createCounter('http.server.request.total', {
      description: 'Total number of HTTP requests',
    });

    const httpActiveRequests = meter.createUpDownCounter('http.server.active_requests', {
      description: 'Number of active HTTP requests',
    });

    // 挂载到 app 上
    app.extend('otel', {
      tracer,
      meter,
      metrics: {
        httpRequestDuration,
        httpRequestTotal,
        httpActiveRequests,
      },
    });

    app.logger.info(`[otel] OpenTelemetry plugin initialized (service: ${serviceName})`);

    // ── 注册 onClose 清理 ───────────────────────────────

    app.onClose(async () => {
      app.logger.info('[otel] Flushing telemetry data...');
      // SDK 的 shutdown 在 instrumentation.ts 中处理
    });
  },
});
```

### 类型声明

```typescript
// src/types/otel.d.ts
import type { Tracer, Meter, Histogram, Counter, UpDownCounter } from '@opentelemetry/api';

declare module 'vextjs' {
  interface VextApp {
    otel: {
      tracer: Tracer;
      meter: Meter;
      metrics: {
        httpRequestDuration: Histogram;
        httpRequestTotal: Counter;
        httpActiveRequests: UpDownCounter;
      };
    };
  }

  interface VextConfig {
    otel?: {
      serviceName?: string;
      enabled?: boolean;
    };
  }
}
```

## 第三步：链路追踪中间件

创建中间件为每个 HTTP 请求自动创建 Span，并记录请求指标：

```typescript
// src/middlewares/tracing.ts
import { defineMiddleware } from 'vextjs';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

export default defineMiddleware(async (req, res, next) => {
  const app = req.app;

  // 如果未启用 otel 插件，直接跳过
  if (!app.otel) {
    return next();
  }

  const { tracer, metrics } = app.otel;
  const startTime = performance.now();

  // 活跃请求 +1
  metrics.httpActiveRequests.add(1, {
    'http.method': req.method,
  });

  // 创建 Span（通常自动检测已创建，这里添加业务属性）
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttributes({
      'http.route': req.route?.path ?? req.url,
      'http.request_id': req.requestId ?? '',
      'vext.service': app.config.otel?.serviceName ?? 'vext-app',
    });
  }

  try {
    await next();

    // 请求完成后记录指标
    const duration = Math.round(performance.now() - startTime);
    const statusCode = res.statusCode ?? 200;

    metrics.httpRequestTotal.add(1, {
      'http.method': req.method,
      'http.status_code': statusCode,
      'http.route': req.route?.path ?? req.url,
    });

    metrics.httpRequestDuration.record(duration, {
      'http.method': req.method,
      'http.status_code': statusCode,
      'http.route': req.route?.path ?? req.url,
    });

    // 设置 Span 状态
    if (activeSpan) {
      if (statusCode >= 400) {
        activeSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${statusCode}`,
        });
      }
      activeSpan.setAttribute('http.status_code', statusCode);
    }
  } catch (err) {
    // 记录错误
    const duration = Math.round(performance.now() - startTime);

    metrics.httpRequestTotal.add(1, {
      'http.method': req.method,
      'http.status_code': 500,
      'http.route': req.route?.path ?? req.url,
    });

    metrics.httpRequestDuration.record(duration, {
      'http.method': req.method,
      'http.status_code': 500,
      'http.route': req.route?.path ?? req.url,
    });

    if (activeSpan) {
      activeSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      activeSpan.recordException(err as Error);
    }

    throw err;
  } finally {
    // 活跃请求 -1
    metrics.httpActiveRequests.add(-1, {
      'http.method': req.method,
    });
  }
});
```

## 第四步：业务代码中使用

### 在 Service 中创建自定义 Span

```typescript
// src/services/user.ts
import { SpanStatusCode } from '@opentelemetry/api';

export class UserService {
  constructor(private app: any) {}

  async findById(userId: string) {
    // 创建自定义 Span — 跟踪数据库查询
    return this.app.otel.tracer.startActiveSpan('UserService.findById', async (span) => {
      span.setAttributes({
        'user.id': userId,
        'db.system': 'mongodb',
        'db.operation': 'findOne',
      });

      try {
        const user = await this.app.db.collection('users').findOne({ _id: userId });

        if (!user) {
          span.setAttributes({ 'user.found': false });
          span.setStatus({ code: SpanStatusCode.OK });
          return null;
        }

        span.setAttributes({ 'user.found': true });
        span.setStatus({ code: SpanStatusCode.OK });
        return user;
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  async create(data: { name: string; email: string }) {
    return this.app.otel.tracer.startActiveSpan('UserService.create', async (span) => {
      span.setAttributes({
        'user.email': data.email,
        'db.system': 'mongodb',
        'db.operation': 'insertOne',
      });

      try {
        // 检查邮箱是否已存在
        const existing = await this.app.db.collection('users').findOne({
          email: data.email,
        });

        if (existing) {
          span.addEvent('user.email_conflict', { email: data.email });
          this.app.throw(409, '邮箱已注册', 'EMAIL_EXISTS');
        }

        const result = await this.app.db.collection('users').insertOne(data);
        span.setAttributes({ 'user.id': String(result.insertedId) });
        span.setStatus({ code: SpanStatusCode.OK });

        return { id: result.insertedId, ...data };
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    });
  }
}
```

### 在路由中添加 Span 事件

```typescript
// src/routes/users.ts
import { defineRoutes } from 'vextjs';
import { trace } from '@opentelemetry/api';

export default defineRoutes((app) => {
  app.get('/users/:id', {
    validate: { param: { id: 'string!' } },
    docs: { summary: '获取用户详情' },
  }, async (req, res) => {
    const { id } = req.valid('param');

    // 在当前 Span 上添加事件
    const span = trace.getActiveSpan();
    span?.addEvent('user.lookup_start', { userId: id });

    const user = await app.services.user.findById(id);

    if (!user) {
      span?.addEvent('user.not_found', { userId: id });
      app.throw(404, '用户不存在');
    }

    span?.addEvent('user.found', { userId: id });
    res.json(user);
  });

  app.get('/users', {
    validate: {
      query: {
        page: 'number:1-',
        limit: 'number:1-100',
      },
    },
    docs: { summary: '获取用户列表' },
  }, async (req, res) => {
    const { page = 1, limit = 20 } = req.valid('query');

    // 手动创建子 Span
    const result = await app.otel.tracer.startActiveSpan(
      'handler.listUsers',
      async (span) => {
        span.setAttributes({ 'query.page': page, 'query.limit': limit });

        const users = await app.services.user.findAll({ page, limit });

        span.setAttribute('result.count', users.length);
        span.end();
        return users;
      },
    );

    res.json(result);
  });
});
```

## 自定义指标

### 业务指标示例

```typescript
// src/plugins/business-metrics.ts
import { definePlugin } from 'vextjs';

export default definePlugin({
  name: 'business-metrics',
  dependencies: ['opentelemetry'],

  async setup(app) {
    const { meter } = app.otel;

    // 订单相关指标
    const orderCreated = meter.createCounter('business.order.created', {
      description: 'Total orders created',
    });

    const orderAmount = meter.createHistogram('business.order.amount', {
      description: 'Order amount distribution',
      unit: 'CNY',
    });

    const activeUsers = meter.createObservableGauge('business.users.active', {
      description: 'Number of active users in the last 5 minutes',
    });

    // 异步指标回调 — 定期从数据库读取
    activeUsers.addCallback(async (result) => {
      try {
        const count = await app.db
          .collection('sessions')
          .countDocuments({
            lastActive: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
          });
        result.observe(count);
      } catch {
        // 静默失败，不影响业务
      }
    });

    // 挂载到 app 供业务使用
    app.extend('businessMetrics', {
      orderCreated,
      orderAmount,
    });
  },
});
```

在业务代码中记录指标：

```typescript
// src/services/order.ts
export class OrderService {
  constructor(private app: any) {}

  async create(data: { userId: string; items: any[]; total: number }) {
    const order = await this.app.db.collection('orders').insertOne(data);

    // 记录业务指标
    this.app.businessMetrics.orderCreated.add(1, {
      'order.type': data.items.length > 1 ? 'multi' : 'single',
    });

    this.app.businessMetrics.orderAmount.record(data.total, {
      'order.type': data.items.length > 1 ? 'multi' : 'single',
    });

    return { id: order.insertedId, ...data };
  }
}
```

## 日志关联

将 `app.logger` 的日志与 Traces 关联，实现日志和链路的联动查询：

```typescript
// src/plugins/log-correlation.ts
import { definePlugin } from 'vextjs';
import { trace, context } from '@opentelemetry/api';

export default definePlugin({
  name: 'log-correlation',
  dependencies: ['opentelemetry'],

  async setup(app) {
    // 通过 pino 的 mixin 注入 trace 上下文
    // 如果 app.logger 是 pino 实例，可以在 logger 配置中添加 mixin
    app.logger.info('[log-correlation] Log correlation enabled');
    app.logger.info('[log-correlation] Logs will include trace_id and span_id fields');
  },
});
```

在 `vext.config.ts` 中配置 logger 的 mixin 来自动注入 trace context：

```typescript
// vext.config.ts
import { trace, context } from '@opentelemetry/api';

export default {
  port: 3000,

  logger: {
    mixin() {
      const span = trace.getActiveSpan();
      if (span) {
        const spanContext = span.spanContext();
        return {
          trace_id: spanContext.traceId,
          span_id: spanContext.spanId,
          trace_flags: spanContext.traceFlags,
        };
      }
      return {};
    },
  },
};
```

关联后的日志输出示例：

```json
{
  "level": 30,
  "time": 1709625600000,
  "msg": "→ GET /api/users/123 200 45ms",
  "trace_id": "abc123def456789012345678abcdef12",
  "span_id": "1234567890abcdef",
  "trace_flags": 1,
  "requestId": "req-uuid-xxx"
}
```

在 Grafana Loki / Elasticsearch 中可以通过 `trace_id` 从日志跳转到对应的链路详情。

## 与 app.fetch 的集成

`app.fetch` 的出站请求会被 OTEL 的 `fetch` / `http` 自动检测捕获，自动创建 client span 并传播 trace context（通过 W3C Traceparent header）。无需额外配置：

```
Client Request
  └── Server Span (VextJS A)
        ├── [tracing middleware] 记录 http.route, requestId
        ├── UserService.findById (custom span)
        │     └── MongoDB findOne (auto-instrumented)
        └── app.fetch.get → User Service B (client span, auto-instrumented)
              └── Server Span (VextJS B, auto-instrumented)
                    └── ...
```

`app.fetch` 注入的 `x-request-id` 和 OTEL 的 `traceparent` 头会同时传播，两套追踪体系互不干扰：

| 头 | 来源 | 用途 |
|----|------|------|
| `x-request-id` | VextJS `app.fetch` | 业务层请求追踪 |
| `traceparent` | OpenTelemetry SDK | W3C 标准分布式追踪 |

## 部署配置

### Docker Compose（本地开发）

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - OTEL_SERVICE_NAME=vext-app
      - OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces
      - OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://otel-collector:4318/v1/metrics
    depends_on:
      - otel-collector

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - '4317:4317'   # gRPC
      - '4318:4318'   # HTTP
      - '8889:8889'   # Prometheus metrics
    volumes:
      - ./otel-config.yaml:/etc/otelcol/config.yaml

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - '16686:16686'  # Jaeger UI
      - '14250:14250'

  prometheus:
    image: prom/prometheus:latest
    ports:
      - '9090:9090'
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - '3001:3000'
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

### OTEL Collector 配置

```yaml
# otel-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

exporters:
  jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true

  prometheus:
    endpoint: 0.0.0.0:8889

  logging:
    loglevel: info

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [jaeger, logging]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus, logging]
```

## 生产环境建议

### 1. 采样策略

在生产环境中不需要记录每一个请求的 trace，使用采样来降低开销：

```typescript
// src/instrumentation.ts
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';

const sdk = new NodeSDK({
  // 采样 10% 的请求
  sampler: new TraceIdRatioBasedSampler(0.1),
  // ...
});
```

### 2. 敏感信息过滤

避免在 Span 属性中记录敏感数据：

```typescript
// ❌ 不要这样做
span.setAttribute('user.password', password);
span.setAttribute('auth.token', bearerToken);

// ✅ 正确做法
span.setAttribute('user.id', userId);
span.setAttribute('auth.method', 'bearer');
```

### 3. Span 命名规范

```typescript
// ✅ 好的命名 — 低基数、有意义
'UserService.findById'
'OrderService.create'
'HTTP GET /api/users/:id'

// ❌ 差的命名 — 高基数，会导致后端存储膨胀
`HTTP GET /api/users/${userId}`
`query-${Date.now()}`
```

### 4. 资源属性

在 `Resource` 中添加足够的上下文信息，便于在可观测性后端中过滤：

```typescript
const resource = new Resource({
  [ATTR_SERVICE_NAME]: 'order-service',
  [ATTR_SERVICE_VERSION]: '1.2.3',
  'deployment.environment': 'production',
  'service.namespace': 'ecommerce',
  'host.name': os.hostname(),
  'cloud.region': process.env.CLOUD_REGION ?? 'cn-hangzhou',
});
```

## 下一步

- 了解 [app.fetch 内置 HTTP 客户端](/guide/fetch) 如何与 OTEL 自动检测协同工作
- 查看 [Nacos 接入示例](/examples/nacos-integration) 实现服务注册发现
- 学习 [插件](/guide/plugins) 系统如何通过 `definePlugin()` 扩展框架
- 探索 [Cluster 多进程](/guide/cluster) 部署以获得更高可用性
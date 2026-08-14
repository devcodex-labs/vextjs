# OpenTelemetry Observability

This document only introduces how to access `@devcodex/opentelemetry` in the **VextJS** scenario.

> For access instructions to other frameworks (Egg.js/Koa/Express/Hono/Fastify), please check the GitHub repository directly:
> [`vextjs/vextjs-plugins`](https://github.com/devcodex-labs/opentelemetry)

---

## Directory overview (VextJS-only)

- [Quick Start (VextJS Framework)](#Quick Start vextjs-framework)
- [Understand first: VextJS dual-entry priority](#Understand vextjs-dual-entry priority first)
- [Local testing (without Docker)](#Local testing without-docker)
- [`/_otel/status` status check interface](#\_otelstatus-status check interface)
- [Configuration method (VextJS)](#Configuration method vextjs)
- [Declarative capture (`capture`)](#Declarative capture capture)
- [Complete Configuration Reference](#Complete Configuration Reference)
- [Production Best Practices](#production-best-practices)
- [FAQ](#faq)

> This page only retains the official access path of **VextJS**; if you are checking Egg.js / Koa / Express / Hono / Fastify, please jump directly to the GitHub README to get instructions for the corresponding framework version.

---

## Quick start (VextJS framework)

### 1. Installation

```bash
npm install @devcodex/opentelemetry
```

> `@devcodex/opentelemetry` has built-in `@opentelemetry/api`, `@opentelemetry/sdk-node`, commonly used OTLP exporters and automatic detection dependencies;
> For **VextJS default access**, there is no need to repeatedly install these packages.
> Only when your application code needs to **directly import** an OTel package, it is recommended to declare it as a direct dependency of the application itself.

### 2. Create plug-in

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";
export default opentelemetryPlugin({ serviceName: "my-app" });
```

> **Note**: `opentelemetryPlugin` is imported through the `@devcodex/opentelemetry/vextjs` subpath (VextJS specific).
> The main entrance `@devcodex/opentelemetry` only exports framework-independent tools (`createWithSpan`, `getOtelStatus`).

### 3. Start

```bash
vext start # production mode
vext dev # development mode
```

> `vext start` / `vext dev` automatically runs the OTel SDK initialization script (`@devcodex/opentelemetry` has declared `"vext.preload": "./dist/instrumentation.js"` in its `package.json`, VextJS CLI automatically scans and injects it with `--import`, no manual configuration is required).
> **Not reported by default** - The SDK initialization script reads the `vext.otel.endpoint` field of the **project's own `package.json`** at startup to determine the reporting address. When not configured, it is a safe noop (the data is discarded and will not be sent to any address).

### 4. Verification

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

**Done.** All telemetry features are automatically enabled.

---

## First understand: VextJS dual entry priority

OpenTelemetry configuration under VextJS is divided into two formal entrances, but with different responsibilities:

| Entrance                                        | Effective stage                  | What is most suitable to put                                                                                                               | What is not recommended                                                              |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `package.json` → `vext.otel`                    | preload / before process startup | `serviceName`, `endpoint`, `protocol`, `headers`, `sampling` and other "SDK needs to know from the beginning" default export configuration | `ignorePaths`, `capture`, log bridging, request-level side effects                   |
| `src/plugins/otel.ts` → `opentelemetryPlugin()` | plugin setup + request           | `tracing`, `metrics`, `lifecycle`, `logs.bridgeAppLogger`, and the addition/override of the exporter in the setup phase                    | Expect it to write back the SDK that has been started in the preload phase. Resource |

### Recommended order

1. **First solidify the default export target in `package.json vext.otel`**: Make CLI preload, startup log and `/_otel/status` consistent from the beginning.
2. **Add request-side behavior** in `opentelemetryPlugin()`: such as `ignorePaths`, `capture`, log bridging and runtime additional tags.
3. **If `endpoint/protocol/headers` is written in both places, try to keep it consistent**: avoid the cognitive bias of "one address at startup and another address at runtime".

### `endpoint` / `protocol` quick check

| Target                 | Recommended configuration                             | `protocol`         | Results                             |
| ---------------------- | ----------------------------------------------------- | ------------------ | ----------------------------------- |
| Do not export any data | Do not write `endpoint`, or explicitly write `"none"` | —                  | SDK security noop / Do not report   |
| Local file debugging   | `"./otel-data"`                                       | —                  | Press `pid` to write `*.jsonl` file |
| OTLP HTTP Collector    | `"http://otel-collector.internal:4318"`               | `"http"` (default) | Escalation via OTLP/HTTP            |
| OTLP gRPC Collector    | `"otel-collector.internal:4317"`                      | `"grpc"`           | Report via gRPC h2c                 |

---

## What will happen if the reporting address is not configured?

| scenario                                                   | endpoint value      | behavior                                                                                                   |
| ---------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| No endpoint configured                                     | `"none"`            | **SDK starts but does not export data** (auto-instrumentation still takes effect, but no telemetry output) |
| The address is configured but the Collector is unreachable | Configuration value | The SDK internal batch is discarded after timeout, and there is no error in the console                    |
| `enabled: false`                                           | —                   | Completely no-op, does not initialize the SDK                                                              |

> ✅ **Safe Default** - When the endpoint is not configured, data will not be sent to any address and will not be written to local files.
> To enable escalation, you can:
>
> - Configure in `package.json` `vext.otel.*` (recommended, it will take effect during the preloading phase)
> - or configured in `opentelemetryPlugin({...})` (setup phase appends/overwrites the exporter)

---

## Local testing (no Docker required)

Don’t want to install Jaeger/Collector? You can export data to **local files** and view the original data format directly.

### Solution 1: Export to local file (recommended)

Configure the reporting address in the project `package.json` (read by the SDK initialization script to control the actual export):

```json
{
  "vext": {
    "otel": {
      "endpoint": "./otel-data"
    }
  }
}
```

> `package.json vext.otel.endpoint` is the **recommended preloading configuration source** in VextJS mode, which can make the startup phase and running phase consistent from the beginning.
> If `endpoint / protocol / headers` is passed in again in `opentelemetryPlugin({...})`, the exported configuration will continue to be appended or overwritten in the setup phase. Relative paths are still resolved based on `process.cwd()`.

Create a plug-in (just keep `serviceName` consistent with `package.json`):

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({ serviceName: "my-app" });
```

```bash
vext dev
# Check the file after making several requests (the file name will have the current process pid)
cat ./otel-data/traces.*.jsonl
cat ./otel-data/metrics.*.jsonl
cat ./otel-data/logs.*.jsonl
```

The plug-in automatically creates a directory; in order to avoid cluster/multiple worker processes writing the same file concurrently, the current implementation will write files according to `process.pid`:

- `traces.<pid>.jsonl`
- `metrics.<pid>.jsonl`
- `logs.<pid>.jsonl`

Each row is a JSON record that can be viewed via glob merging.

**`traces.<pid>.jsonl` example (one span per line):**

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

**`metrics.<pid>.jsonl` example (batch of metrics per line):**

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

### Option 2: Local Jaeger (when Docker is available)

```bash
docker run -d --name jaeger -p 4318:4318 -p 16686:16686 \
  -e COLLECTOR_OTLP_ENABLED=true jaegertracing/all-in-one:latest
```

Configure local Jaeger in project `package.json`:

```json
{
  "vext": {
    "otel": {
      "endpoint": "http://localhost:4318"
    }
  }
}
```

Just keep the plugin as simple as possible:

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

## Access to other frameworks

The Vext official website only retains access instructions for the **VextJS** scenario.

If you need to check out the following:

- Access methods for Egg.js / Koa / Express / Hono / Fastify
- CJS preloading mode for `initOtel()`
- Multi-framework `HttpOtelOptions` / `startAttributes` / `endAttributes` / `metrics.labels` / `createEggMiddleware` Description
- Complete release history and version differences

Please check the GitHub repository directly:

- [`vextjs/vextjs-plugins`](https://github.com/devcodex-labs/opentelemetry)

It is recommended to read the following in the warehouse first:

- `@devcodex/opentelemetry/README.md`
- `@devcodex/opentelemetry/changelogs/`

## `/_otel/status` Status check interface

Used to verify the current running status of OTel SDK:

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

| Field                 | Description                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `sdk`                 | `"initialized"` = SDK OK / `"noop"` = SDK not initialized                                                |
| `serviceName`         | The currently effective service name                                                                     |
| `exportMode`          | `"otlp-grpc"` = h2c gRPC / `"otlp-http"` = HTTP OTLP / `"file"` = local file / `"none"` = not configured |
| `exportTarget`        | The currently effective reporting target (`"none"` when not configured)                                  |
| `protocol`            | Current export protocol (`"http"` / `"grpc"`)                                                            |
| `autoInstrumentation` | Whether automatic detection is enabled (MongoDB/Redis/MySQL, etc.)                                       |
| `samplingRatio`       | Current sampling rate                                                                                    |

**VextJS**: Automatically registered after startup, no manual configuration required.

**Production environment** It is recommended to restrict intranet access at the gateway layer.

---

## Reported data content

### Traces (link tracing)

Each HTTP request generates a span containing:

| Properties         | Example values                     | Description                                                   |
| ------------------ | ---------------------------------- | ------------------------------------------------------------- |
| `http.method`      | `"GET"`                            | HTTP method                                                   |
| `http.route`       | `"/users/:id"`                     | Route template (low cardinality, safe for metric aggregation) |
| `http.status_code` | `200`                              | Response status code                                          |
| `http.request_id`  | `"my-app-a1b2c3d4"`                | vext request ID                                               |
| `vext.service`     | `"my-app"`                         | Service name                                                  |
| `http.url`         | `"http://localhost:3000/users/42"` | Full request URL                                              |
| `net.peer.ip`      | `"127.0.0.1"`                      | Client IP                                                     |

After installing `@opentelemetry/auto-instrumentations-node`, database operations, HTTP external calls, etc. will automatically generate sub-Spans.

### Metrics (metric monitoring)

| Indicator name                | Type              | Label                      | Description                                                           |
| ----------------------------- | ----------------- | -------------------------- | --------------------------------------------------------------------- |
| `http.server.duration`        | Histogram (ms)    | method, route, status_code | Request time-consuming distribution                                   |
| `http.server.request.total`   | Counter           | method, route, status_code | Total number of requests                                              |
| `http.server.active_requests` | UpDownCounter     | method                     | Current number of concurrent requests                                 |
| `http.server.request.size`    | Histogram (bytes) | method, route              | Request body size distribution (recorded when Content-Length exists)  |
| `http.server.response.size`   | Histogram (bytes) | method, status_code        | Response body size distribution (recorded when Content-Length exists) |

> **`ignorePaths` suppresses both Trace and Metrics** - Ignored paths (such as `/health`) will not produce any span or metric data and will not cause noise in the monitoring panel.

**Node.js Runtime indicators** (automatically reported through `@opentelemetry/instrumentation-runtime-node`):

| Indicator name                           | Description                       |
| ---------------------------------------- | --------------------------------- |
| `process.cpu.usage`                      | Process CPU usage                 |
| `process.memory.usage`                   | Heap memory usage (heap_used/rss) |
| `nodejs.eventloop.lag`                   | Event loop delay                  |
| `nodejs.gc.duration` / `nodejs.gc.count` | GC time and times                 |

### Logs (log correlation)

Each request log is automatically injected with `trace_id` + `span_id`:

```json
{
  "msg": "GET /users/42 200 45ms | 127.0.0.1",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "requestId": "my-app-a1b2c3d4"
}
```

Logs and links can be correlated in Grafana Loki / ELK via `trace_id`.

**Structured Log (Schema A + Schema B) **

When the log needs to be landed (Schema A) and reported to the OTLP Collector (Schema B) at the same time, use the two factory functions provided by `@devcodex/opentelemetry/log`:

- `createStructuredLogFormatter` — Schema A structured JSON formatter (fixed field order)
- `createOtelLogBridge` — Schema B OTel LogRecord bridge (via `globalThis._otelLogger`)

**Schema A — Implementation log JSON (complete fields)**

```json
{
  "timestamp": "2026-04-03 10:00:00",
  "level": "INFO",
  "message": "User created successfully",
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

**VextJS recommended writing method**

In VextJS, there is usually no need to copy the logger formatter / middleware assembly methods of other frameworks. More recommended:

1. Enable `logs.bridgeAppLogger` in `opentelemetryPlugin()`
2. Add stable fields in `config.logger.mixin`

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

> If you need the log bridging method for Egg.js / Koa / Express / Hono / Fastify, please check the GitHub README directly; the multi-framework branch will no longer be expanded here on the official website.

---

## Configuration method (VextJS)

VextJS's OTel configuration is divided into two layers with different purposes:

### First layer: Default export configuration during preloading phase (`package.json`, recommended)

The SDK initialization script (`instrumentation.ts`, executed before application code through `vext.preload`) is read first and determines the default export configuration when the process starts.
If `endpoint / protocol / headers` is subsequently passed in `opentelemetryPlugin({...})`, the plugin phase will continue to append or overwrite the exporter.

Configure read priority (high → low):

1. `package.json` `vext.otel.*`
2. OpenTelemetry standard environment variables (such as `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`)
3. Project `package.json.name` (only for `serviceName` fallback)
4. Built-in default values (`serviceName: "vext-app"`, `protocol: "http"`, `endpoint: "none"`)

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

### Second layer: runtime plug-in behavior (`src/plugins/otel.ts`)

The plug-in layer is responsible for runtime tracer / meter / logger behavior, such as `ignorePaths`, indicator buckets, log bridging, and appending/overwriting exporters in the setup phase.

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

> It is recommended that the `endpoint/protocol/headers` of the plug-in layer be consistent with `package.json vext.otel` to facilitate the unification of `/_otel/status` with the actual export target.

---

## Declarative capture (`capture`)

If you only want to add a small number of headers / query / params / body fields and don’t want to hand-write the `startAttributes` / `endAttributes` resolver for each field, you can use `capture` directly:

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

The generated attribute prefix is fixed to:

- `http.request.header.*`
- `http.request.query.*`
- `http.request.param.*`
- `http.request.body.*`

Key constraints:

- `query: true` / `params: true` means **explicitly enable full mode**; by default, full mode will not be automatically taken.
- `headers` / `body` It is still recommended to only collect whitelists and not provide the default full mode to avoid accidentally collecting sensitive fields such as `authorization`, `cookie`, passwords, and mobile phone numbers.
- `capture` generates **Span attributes** and will not automatically go into `metrics.labels`; metric dimensions should still be provided separately through `metrics.labels` and keep the cardinality low.

---

## Complete configuration reference

### opentelemetryPlugin() options

```typescript
opentelemetryPlugin({
  // ── Basics ────────────────────────────────────────
  serviceName: "my-app",
  endpoint: "http://collector:4318",
  protocol: "http",
  headers: { "api-key": "KEY" },

  // ── Tracking ────────────────────────────────────────
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
  }, // ── Indicators ─────────────────────────────────────────
  metrics: {
    enabled: true,
    durationBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    labels: (_ctx, req) => ({
      "tenant.id": req.headers["x-tenant-id"] ?? "default",
    }),
  },

  //── Declarative collection ───────────────────────────────────────
  capture: {
    headers: ["x-request-id", "x-tenant-id"],
    query: ["page", "limit"],
    params: true,
    body: ["orderNo", "customer.id"],
  },

  // ── Life cycle ──────────────────────────────────────
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

  // ── Log ───────────────────────────────────────────
  logs: {
    bridgeAppLogger: true,
  },
});
```

> The current unified public model is `startAttributes / endAttributes / metrics.labels / lifecycle`.
> The `raw` parameter of the VextJS adapter is `req`; other frameworks will transparently transmit their own original context (such as Express's `{ req, res }`, Koa/Egg's `ctx`).

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

### Environment variables

> The following environment variables are natively supported by OpenTelemetry SDK, but in VextJS scenarios it is recommended to solidify and export the configuration through `package.json vext.otel`.

| variable                      | default value             | description                           |
| ----------------------------- | ------------------------- | ------------------------------------- |
| `OTEL_TRACES_SAMPLER`         | `"parentbased_always_on"` | Sampling strategy                     |
| `OTEL_TRACES_SAMPLER_ARG`     | `"1"`                     | Sampling rate (e.g. `0.1` = 10%)      |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000`                   | Metric export interval (milliseconds) |
| `OTEL_LOG_LEVEL`              | `"info"`                  | SDK log level                         |

---

## Access backend

### Local development

| Backend                | Startup method                                                                                      | endpoint configuration                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **None (file export)** | Docker not required                                                                                 | `package.json vext.otel.endpoint: "./otel-data"`           |
| **Jaeger**             | `docker run -d -p 4318:4318 -p 16686:16686 -e COLLECTOR_OTLP_ENABLED=true jaegertracing/all-in-one` | `package.json vext.otel.endpoint: "http://localhost:4318"` |
| **Grafana LGTM**       | `docker run -d -p 3000:3000 -p 4318:4318 grafana/otel-lgtm`                                         | `package.json vext.otel.endpoint: "http://localhost:4318"` |

### Cloud vendors

| Vendor                 | endpoint                                     | headers                              |
| ---------------------- | -------------------------------------------- | ------------------------------------ |
| **New Relic**          | `https://otlp.nr-data.net:4318`              | `{ "api-key": "LICENSE_KEY" }`       |
| **Grafana Cloud**      | `https://otlp-gateway-....grafana.net/otlp`  | `{ "Authorization": "Basic TOKEN" }` |
| **Datadog**            | `http://dd-agent-host:4318`                  | —                                    |
| **Alibaba Cloud ARMS** | Reference Alibaba Cloud OTLP access document | Reference document                   |

> Cloud vendor token is recommended to be injected through environment variables (K8s Secret) instead of hard-coded into the code.

---

## Auto-Instrumentation

Under default access, `@devcodex/opentelemetry` already comes with `@opentelemetry/auto-instrumentations-node`, and the SDK will automatically patch common libraries, and you can obtain link tracking for database queries, HTTP external calls, message queues, etc. without modifying any business code.

### Installation

By default, `vext start` / `vext dev` is used to take effect automatically after startup.

If your **application code** needs to directly `import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"` for in-depth customization, then declare it as a direct dependency of the application itself.

### Supported libraries

| Categories        | Library                          | Automatically track content                        |
| ----------------- | -------------------------------- | -------------------------------------------------- |
| **Database**      | MongoDB (`mongodb` / `mongoose`) | Query operation, collection name, time consumption |
|                   | PostgreSQL (`pg`)                | SQL statement, table name, time consumption        |
|                   | MySQL (`mysql` / `mysql2`)       | SQL statement, table name, time consumption        |
|                   | Redis (`ioredis` / `redis`)      | Command, key, time consumption                     |
| **HTTP**          | Node.js `http` / `https`         | External HTTP calls, URLs, status codes            |
|                   | `undici` / `fetch`               | Same as above, Node.js 20+ has built-in fetch      |
| **Message Queue** | `amqplib` (RabbitMQ)             | Queue name, message sending/consuming              |
|                   | `kafkajs`                        | Topic, message sending/consuming                   |
| **Cache**         | `memcached`                      | Operation command, key                             |
| **RPC**           | `@grpc/grpc-js`                  | Method name, status code                           |
| **Other**         | `dns`                            | DNS resolution                                     |
|                   | `net`                            | TCP connection                                     |

> See [@opentelemetry/auto-instrumentations-node](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) for a complete list.

### Effect example

After installation, a `GET /users/:id` request may produce the following Span tree in Jaeger:

```
GET /users/:id (http, 45ms)
├── mongodb.find users (db, 12ms)
├── redis.GET user:cache:42 (cache, 2ms)
└── HTTP GET https://api.xxx/verify (http, 28ms)
```

**No code changes required** - The SDK automatically patches `mongodb`, `ioredis`, `http` and other modules when the process is started (`--import`).

### Disable specific detection

If a certain automatic detection causes problems or is not needed, the instrumentation.ts configuration can be overridden in the plugin:

```typescript
// src/instrumentation.ts (custom, replaces the built-in version)
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  instruments: getNodeAutoInstrumentations({
    // Disable fs detection (noisy logs)
    "@opentelemetry/instrumentation-fs": { enabled: false },
    // Disable dns detection
    "@opentelemetry/instrumentation-dns": { enabled: false },
  }),
});
sdk.start();
export {};
```

Then point to the custom instrumentation in `package.json`:

```json
{ "vext": { "preload": "./dist/instrumentation.js" } }
```

### Behavior when not installed

If `@opentelemetry/auto-instrumentations-node` is not installed:

- The console outputs a line of warning prompts
- HTTP middleware layer tracking (Span attribute annotation, indicator statistics, log correlation) **still normal**
- Only deep spans such as database/external HTTP are missing (does not affect application operation)

```
[vextjs-opentelemetry/instrumentation] @opentelemetry/auto-instrumentations-node is not installed.
  npm install @opentelemetry/auto-instrumentations-node
```

---

## Advanced usage

### Manually track business operations (withSpan)`withSpan()` is the recommended way to track custom business operations. It encapsulates `tracer.startActiveSpan()` with try/catch/finally and automatically handles `span.end()`, `span.recordException()` and `span.setStatus()`, the three most easily missed things.

#### VextJS plugin (via `app.otel.withSpan`)

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post("/payments", async (req, res) => {
    // ① Simplest: no contact with span at all (only tracking life cycle)
    const resultBasic = await req.app.otel!.withSpan("payment.process", () =>
      processPayment(req.body.id),
    );

    // ② With static initial attributes
    const resultWithAttrs = await req.app.otel!.withSpan(
      "payment.process",
      () => processPayment(req.body.id),
      {
        attributes: { "payment.provider": "stripe", "payment.currency": "USD" },
      },
    );

    // ③ Dynamic attributes (when relying on execution results, access span through callback parameters)
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

**Behavioral Description**:

| Scenario                         | Automatic behavior                                                              |
| -------------------------------- | ------------------------------------------------------------------------------- |
| The callback returns normally    | `span.end()` is automatically called                                            |
| The callback throws an exception | `span.recordException(err)` + `span.setStatus(ERROR)` + `span.end()` + re-throw |
| SDK not initialized              | Noop span; no telemetry is exported                                             |

### Underlying API (customized SpanKind / Processor and other advanced scenarios)

When you need fine control over the span type or custom processing, you can use `tracer` directly:

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

### Custom business indicators

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

### Sampling (reduces overhead)

**Method 1: `package.json` code-level configuration (recommended)**

instrumentation reads `vext.otel.sampling.ratio` during SDK initialization,
Automatically use `ParentBasedSampler(TraceIdRatioBasedSampler(ratio))`:

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

**Method 2: Environment variables (runtime override)**

```bash
# No need to change the code, can be injected in CI/CD or deployment script
OTEL_TRACES_SAMPLER=traceidratio OTEL_TRACES_SAMPLER_ARG=0.1 vext start
```

### Cluster multi-process

```bash
VEXT_CLUSTER=1 vext start # vext automatically injects OTel into each Worker
```

### Custom instrumentation

Completely replaces built-in SDK initialization:

```typescript
// src/instrumentation.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-node";

const sdk = new NodeSDK({
  sampler: new TraceIdRatioBasedSampler(0.1),
  // ... custom configuration
});
sdk.start();
export {};
```

```json
{ "vext": { "preload": "./dist/instrumentation.js" } }
```

---

## Log field planning

VextJS + @devcodex/opentelemetry supports two levels of log output, each with its own emphasis:

- **A. Implementation log (stdout/file JSON)**: Business fields are clear and readable, which facilitates manual troubleshooting and log aggregation (ELK/Loki)
- **B. OTel Logs (LogRecord → Collector)**: lightweight, associated with complete links through `trace_id`

### A. Implementation log field (stdout/file JSON)

Inject Resource-level and Span-level contexts via `config.logger.mixin`:

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
        // Resource level fields (available in every log)
        service_name: "my-app",
        env: process.env.NODE_ENV ?? "development",
        host: os.hostname(),
      };

      // Span-level fields (injected when there is a value in the request context)
      if (getActiveSpan) {
        const span = getActiveSpan() as
          | { isRecording?: () => boolean; name?: string }
          | undefined;
        if (span?.isRecording?.()) {
          fields.span = span.name; // "GET", "mongodb.find", "redis.GET" etc.
        }
      }

      return fields;
    },
  },
};
```

Output example:

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

> `requestId`, and `traceId` / `spanId` written in `requestContext` will be automatically injected as `requestId`, `trace_id`, `span_id` by the framework’s built-in provider; there is no need to repeat configuration in the user mixin.

#### Field comparison table

| Field          | Source                                  | Configuration Method                          |
| -------------- | --------------------------------------- | --------------------------------------------- |
| `timestamp`    | Vext logger automatically               | No configuration required                     |
| `level`        | Vext logger automatically               | No configuration required                     |
| `msg`          | `logger.info("...")`                    | No configuration required                     |
| `requestId`    | Framework ALS → mixin automatic         | No configuration required                     |
| `trace_id`     | otel middleware → ALS → mixin automatic | No configuration required                     |
| `span_id`      | otel middleware → ALS → mixin automatic | no configuration required                     |
| `service_name` | `config.logger.mixin`                   | User mixin injection                          |
| `env`          | `config.logger.mixin`                   | User mixin injection                          |
| `host`         | `config.logger.mixin`                   | User mixin injection                          |
| `span`         | `trace.getActiveSpan().name`            | User mixin injection                          |
| `endpoint`     | `req.route` in access log               | Automatically included in request log msg     |
| `latency_ms`   | access log                              | Automatically included in request log msg     |
| `user_id`      | Business code                           | `logger.info({ user_id: "..." }, msg)`        |
| `feature.flag` | Business code                           | `logger.info({ "feature.flag": "..." }, msg)` |
| `exception.*`  | `logger.error(err)`                     | Vext logger serializer automatically expands  |

### B. OTel Logs (LogRecord → Collector)

Vext's default logger does not rely on third-party loggers, so logger-specific auto instrumentation will not automatically capture `app.logger`. If you need to output OTel Logs, you can bridge it through `app.setLogger()` of `@devcodex/opentelemetry`, or wrap the current logger with a custom plug-in:

- **`trace_id` / `span_id`**: Write LogRecord from `requestContext` or active span
- **`severity_text`**: mapped from Vext logger level
- **`body`**: Log message content
- **`service.name`**: from Resource (configured in instrumentation.ts)
- **`attributes`**: Structured log fields are mapped to LogRecord attributes

Fields injected by user mixin (such as `service_name`, `host`, `span`) will automatically appear in LogRecord.attributes\*\*.

::: tip OTel Logs Best Practices
Avoid putting all landing log fields in LogRecord attributes. OTel Logs associates Trace with `trace_id` to see the complete context of `endpoint`, `latency_ms`, `user.id`, etc. Keeping LogRecord lightweight helps control Collector traffic.
:::

### C. Deep fields (automatically appear in child Span)

The following fields are automatically collected by `@opentelemetry/auto-instrumentations-node` and do not require manual configuration:

```
GET /users/:id (http, 45ms) ← user.id, tenant.id here
├── mongodb.find users (db, 12ms) ← db.statement automatic
├── redis.GET user:cache:42 (cache, 2ms) ← cache.system automatic
└── HTTP GET https://api.xxx/verify (http, 28ms) ← Automatic
```

| Field          | Source                                    | Occurrence                        |
| -------------- | ----------------------------------------- | --------------------------------- |
| `db.statement` | DB instrumentation automatic              | Database sub-Span attributes      |
| `db.system`    | DB instrumentation automatic              | Database sub-Span attributes      |
| `cache.system` | Redis/Memcached instrumentation automatic | cache sub-Span attributes         |
| `http.url`     | HTTP instrumentation automatic            | External call sub-Span attributes |

> Correlate these deep fields by viewing the complete call chain in Jaeger / Grafana Tempo via `trace_id`.

---

## Production Best Practices

1. **Configure reporting address** - will not be reported if not configured (safe default value), but it also means no observability data
2. **`shutdown.timeout: 60`** — Make sure the SDK has enough time to flush data
3. **Restriction `/_otel/status`** — The current VextJS adapter will automatically register this route. In the production environment, please restrict access to the intranet at the gateway layer.
4. **Do not record sensitive information in Span** — passwords, tokens, ID numbers, etc.
5. **Sampling** — Use `OTEL_TRACES_SAMPLER=traceidratio` for high-concurrency services
6. **Deploy Collector** — Application → Collector → Backend, decoupling + buffering

```
Applications (N) ──OTLP──► Collector ──► Jaeger / Prometheus / Grafana
```

---

## FAQ

### Q: `/_otel/status` returns `"sdk": "noop"`

① Use `vext start/dev` to start ② `@devcodex/opentelemetry` in dependencies ③ The SDK package has been installed ④ `package.json vext.otel` configuration has taken effect.

### Q: The endpoint shows localhost but I assigned another address.

① Check `package.json` `vext.otel.endpoint` ② Confirm that `endpoint/protocol/headers` in the plug-in is consistent with `package.json` ③ Confirm to start with `vext start/dev`

### Q: The log has no trace_id

First confirm that `/_otel/status` returns `"sdk": "initialized"`. In the VextJS scenario, `trace_id` relies on SDK initialization in the preload stage + normal plug-in access, both of which are indispensable.

### Q: The backend cannot receive data

① `/_otel/status` Confirm that `sdk: "initialized"` + `endpoint` is correct ② Confirm in the service log `[otel] ... export SUCCESS (grpc-status:0)` ③ Wait for 30 seconds (batch reporting delay) ④ Use Jaeger/LGTM local debugging to confirm the data format

### Q: `[otel] ... export FAILED: grpcSend timeout`

The h2c gRPC connection from the server to the collector is blocked. Check: ① The collector address and port are reachable ② The collector service is running normally ③ Network firewall/security group rules ④ If in Docker/K8s, use Service DNS instead of localhost

### Q: I start directly with `node dist/server.js`, why does the SDK not take effect?

Because VextJS's "zero configuration access" relies on the CLI to automatically scan `vext.preload` in the dependency package and inject `--import` before starting.

Optional practices:

1. **Recommended**: Continue to use `vext dev` / `vext start`
2. **Customized Node startup command**: Manually add `--import @devcodex/opentelemetry/instrumentation`

```bash
node --import @devcodex/opentelemetry/instrumentation dist/server.js
```

### Q: How to disable the test environment

```json
{
  "vext": {
    "otel": {
      "endpoint": "none"
    }
  }
}
```

Or the plug-in is not loaded in the test environment.

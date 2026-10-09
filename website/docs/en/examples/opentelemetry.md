# OpenTelemetry Observability

This page covers VextJS OpenTelemetry integration: confirm the plugin works,
verify Traces, Metrics, and Logs with local files, then connect a Collector.
Start from a TypeScript API project in [Quick Start](/guide/quick-start).
The published package checked on 2026-09-25 was
`@devcodex/opentelemetry@2.1.17`, with a Vext peer range of `>=0.2.5`.
These versions describe the checked scope; the install command does not pin
the framework version.

> For access instructions to other frameworks (Egg.js/Koa/Express/Hono/Fastify), please check the GitHub repository directly:
> [`devcodex-labs/opentelemetry`](https://github.com/devcodex-labs/opentelemetry)

---

## Directory overview (VextJS-only)

- [Quick start (VextJS framework)](#quick-start-vextjs-framework)
- [VextJS configuration and initialization](#understand-vextjs-configuration-and-initialization-order)
- [Local testing without Docker](#local-testing-no-docker-required)
- [`/_otel/status` status endpoint](#_otelstatus-status-check-interface)
- [VextJS configuration](#configuration-method-vextjs)
- [Declarative capture](#declarative-capture-capture)
- [Complete configuration reference](#complete-configuration-reference)
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

### 3. Add a verifiable route and start

Merge this config into the project:

```typescript
// src/config/default.ts
export default { host: "127.0.0.1", port: 3000, adapter: "native" };
```

This route performs one local demo operation. It does not contact a payment
service or database and assumes this page's plugin remains enabled:

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

For production, stop dev first, then run `npm run build -- --typecheck` and
`npm start`. Do not run both servers on the same port simultaneously.

The CLI discovers `vext.preload` from installed dependencies and injects the
instrumentation entry. The current package's default preload prepares that
entry; SDK initialization may wait until plugin setup. With no export target
and no forced SDK preload, the SDK is not initialized. Set `preloadSdk: true`
as described below when auto-instrumentation must start before app modules.

### 4. Verify the default state

With no other OTel environment settings:

```bash
curl -i http://127.0.0.1:3000/_otel/status
curl -i http://127.0.0.1:3000/otel-demo
```

Expect `sdk: "noop"` and `exportMode: "none"` in status; the business route
still returns 200. No telemetry is exported, so this does not prove a
Collector received data. Use the local file workflow below to verify output.

---

<a id="understand-vextjs-configuration-and-initialization-order"></a>

## Understand VextJS configuration and initialization order

There are three configuration locations. Keep SDK lifecycle and request
observation responsibilities separate:

| Entry                          | Current responsibility                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` `vext.otel`     | Preload config: `enabled`, `preloadSdk`, `serviceName`, `endpoint`, `protocol`, `headers`, `sampling.ratio`, `metricIntervalMs`. |
| `app.config.otel`              | Plugin fallback for `enabled`, `serviceName`, `endpoint`, `protocol`, `headers`, `insecure`.                                     |
| `opentelemetryPlugin(options)` | Explicit plugin options take priority for tracing, metrics, capture, lifecycle, log bridging, and exporters not yet configured.  |

### Recommended order

1. Set `serviceName` and the default export target in `package.json`.
   Set `preloadSdk: true` if early auto-instrumentation is needed.
2. Add request observation behavior in the plugin. Keep its export target
   consistent with package config.
3. **An already configured exporter is not replaced by a later call.**
   Current `attachExporterToSdk` fills only an unconfigured delegate, even
   though the environment variables displayed by status may change later.
   The status endpoint is therefore not complete evidence of the actual
   delivery target. Restart after changing target or sampling, then inspect
   the output file or Collector.
4. In default delayed mode, plugin exporter options resolve in order:
   options → `app.config.otel` → package. They do not reread every OTel
   environment variable. If relying only on environment variables, enable
   early SDK initialization explicitly and verify actual output.

### `endpoint` and `protocol` quick reference

| Target              | Recommended configuration               | `protocol`         | Result                                                                             |
| ------------------- | --------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| Export nothing      | Omit endpoint or set `none`             | —                  | SDK stays off by default; explicit `preloadSdk: true` may start it without export. |
| Local file debug    | `"./otel-data"`                         | —                  | Write per-PID `*.jsonl` files.                                                     |
| OTLP HTTP Collector | `"http://otel-collector.internal:4318"` | `"http"` (default) | Export via OTLP/HTTP.                                                              |
| OTLP gRPC Collector | `"otel-collector.internal:4317"`        | `"grpc"`           | Exporter details depend on initialization path; see below.                         |

The current package has two gRPC paths. Early SDK Trace/Metrics use a gRPC
exporter, while Logs still construct an HTTP exporter. When the plugin
attaches an exporter, `insecure: true` uses h2c and `false` uses TLS; the
h2c branch does not forward configured headers. For all three signals or
authenticated delivery, verify the OTLP/HTTP path on this page. Do not
infer successful delivery from `protocol: "grpc"` or status alone.

## What happens without an export address?

| Scenario                                                       | Current behavior                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| No endpoint, default CLI preload                               | Delay or skip SDK initialization. Plugin extensions can work without telemetry output.                                  |
| `endpoint: none` and `preloadSdk: true`                        | SDK may initialize but exporters remain none.                                                                           |
| Address set but Collector unreachable                          | Requests and delivery are separate; export may fail or drop. Inspect backend and exporter diagnostics.                  |
| Package `vext.otel.enabled: false` or `OTEL_SDK_DISABLED=true` | SDK and plugin integration are disabled; no status route is registered, and business routes must not assume `app.otel`. |
| Only plugin `options.enabled: false`                           | Skip plugin; any SDK initialized elsewhere is not retroactively undone.                                                 |

By default, nothing is sent to a Collector or local file. Setting `none`
is not a reliable runtime off switch if another entry already initialized
an exporter. Coordinate config and restart.

## Local testing (no Docker required)

Don’t want to install Jaeger/Collector? You can export data to **local files** and view the original data format directly.

### Option 1: Export to local files (recommended)

Set the export address in the project's `package.json`. The SDK
initialization entry reads it to choose the actual export target:

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

`package.json vext.otel.endpoint` is the recommended preload source in
VextJS mode so startup and runtime agree from the beginning. Merge this
fragment into an existing `package.json`; keep scripts and dependencies.
A plugin can only fill exporters that have not already been configured.
Relative paths resolve from `process.cwd()`, so start in the app root.

Keep the plugin's service name aligned:

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({ serviceName: "my-app" });
```

After changing `package.json`, stop and restart the service so the early
SDK reads the new config:

```bash
npm run dev
# In another terminal, request the real demo route above.
curl -i http://127.0.0.1:3000/otel-demo
curl -i http://127.0.0.1:3000/_otel/status
```

The plugin creates the directory. To avoid multiple workers writing the same
file concurrently, the implementation uses per-process files:

- `traces.<pid>.jsonl`
- `metrics.<pid>.jsonl`
- `logs.<pid>.jsonl`

Wait for batching and the metric cycle (15 seconds by default). Enabling
the plugin without business requests does not guarantee records in all three
files. In PowerShell, use `Get-Content ./otel-data/traces.*.jsonl`, then
inspect metrics and logs; on Unix use `cat`. Confirm the `demo.work` span,
HTTP metrics, and `otel demo completed` log. These files are for debugging;
the application owns rotation and retention.

**Actual file structure:**

- Traces: one span per line with `traceId`, `spanId`, `name`, and
  `attributes`. Time and duration use SDK high-resolution arrays, not the
  old example's `id` and microsecond `timestamp`.
- Metrics: each line contains a `timestamp` and SDK `ResourceMetrics`;
  metrics live under `metrics.scopeMetrics[].metrics`, not a top-level array.
- Logs: each line serializes an SDK LogRecord. Field and Resource shape
  follow the installed SDK; debug JSONL is not a fixed OTLP wire protocol.
- Optional parent span and resource fields may be absent. Build a reader
  from the installed version's actual output, and inspect all three files
  rather than relying only on status.

### Option 2: Local Jaeger (when Docker is available)

Use the [official Jaeger docs](https://www.jaegertracing.io/docs/) to start
a version appropriate service with an OTLP/HTTP receiver and map port 4318
locally. Jaeger primarily verifies Traces; Metrics and Logs need their own
receiving backend.

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

Choose either this Jaeger endpoint or the file endpoint above. Keep
`serviceName` and `preloadSdk: true` from the file setup. Query
`demo.work` under that service in the Jaeger UI. The plugin stays minimal:

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

## Access to other frameworks

The Vext official website only retains access instructions for the **VextJS** scenario.

If you need to check out the following:

- Access methods for Egg.js / Koa / Express / Hono / Fastify
- CJS preloading mode for `initOtel()`
- Multi-framework `HttpOtelOptions` / `startAttributes` / `endAttributes` / `metrics.labels` / `createEggMiddleware` Description
- Complete release history and version differences

Please check the GitHub repository directly:

- [`devcodex-labs/opentelemetry`](https://github.com/devcodex-labs/opentelemetry)

It is recommended to read the following in the warehouse first:

- `README.md`
- `changelogs/`

## `/_otel/status` Status check interface

Used to verify the current running status of OTel SDK:

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

| Field                 | Description                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `sdk`                 | `"initialized"` means initialization was marked; `"noop"` means SDK not initialized.                         |
| `serviceName`         | The currently effective service name                                                                         |
| `exportMode`          | `"otlp-grpc"`, `"otlp-http"`, `"file"`, or `"none"` describe mode; verify actual signal delivery separately. |
| `exportTarget`        | Displayed target; verify actual output separately.                                                           |
| `protocol`            | Current export protocol (`"http"` / `"grpc"`)                                                                |
| `autoInstrumentation` | Whether automatic detection is enabled (MongoDB/Redis/MySQL, etc.)                                           |
| `samplingRatio`       | Current sampling rate                                                                                        |

When the plugin is enabled, the adapter registers GET `/_otel/status`
directly before ordinary global middleware. Do not rely on ordinary route
auth or later middleware to protect it. With this page's native default
response wrapper, the fields above are under `data`; custom or disabled
wrapping changes that shape. Status variables do not prove the backend
received anything. The current package displays `samplingRatio: 1` when
the value is zero, so this field alone cannot prove zero sampling.

**Production environment** It is recommended to restrict intranet access at the gateway layer.

---

## Reported data content

### Traces (link tracing)

HTTP auto-instrumentation creates request spans and the plugin adds
attributes when the SDK is enabled, the library is supported, and sampling
allows recording. Attributes may include:

| Properties         | Example values                     | Description                                                   |
| ------------------ | ---------------------------------- | ------------------------------------------------------------- |
| `http.method`      | `"GET"`                            | HTTP method                                                   |
| `http.route`       | `"/users/:id"`                     | Route template (low cardinality, safe for metric aggregation) |
| `http.status_code` | `200`                              | Response status code                                          |
| `http.request_id`  | `"my-app-a1b2c3d4"`                | vext request ID                                               |
| `vext.service`     | `"my-app"`                         | Service name                                                  |
| `http.url`         | `"http://localhost:3000/users/42"` | Full request URL                                              |
| `net.peer.ip`      | `"127.0.0.1"`                      | Client IP                                                     |

The package already depends on `auto-instrumentations-node`; do not install
it again solely for the default integration. Early initialization, module
load order, specific library versions, and sampling determine whether child
spans appear. Installation alone does not prove them.

### Metrics (metric monitoring)

| Indicator name                | Type              | Label                      | Description                                                           |
| ----------------------------- | ----------------- | -------------------------- | --------------------------------------------------------------------- |
| `http.server.duration`        | Histogram (ms)    | method, route, status_code | Request time-consuming distribution                                   |
| `http.server.request.total`   | Counter           | method, route, status_code | Total number of requests                                              |
| `http.server.active_requests` | UpDownCounter     | method                     | Current number of concurrent requests                                 |
| `http.server.request.size`    | Histogram (bytes) | method, route              | Request body size distribution (recorded when Content-Length exists)  |
| `http.server.response.size`   | Histogram (bytes) | method, status_code        | Response body size distribution (recorded when Content-Length exists) |

> `ignorePaths` suppresses this plugin's span attribute handling and HTTP
> metrics on matching paths. It does not remove a span already created by
> HTTP auto-instrumentation or skip lifecycle callbacks. Configure the
> underlying instrumentation/exporter for full filtering. Current
> `request.size` uses raw `req.path` as a label, while other metrics prefer
> a matched route; assess high-cardinality paths separately.

**Node.js runtime metrics** come from the bundled runtime-node
instrumentation and names may vary by version. The current package includes
definitions such as `nodejs.eventloop.delay.*`,
`nodejs.eventloop.utilization`, and `v8js.memory.heap.used`. Do not infer
CPU, RSS, or GC metric names from an older example; check the current local
metrics file or Collector.

### Logs (log correlation)

Framework logs can include `trace_id` and `span_id` after the plugin writes
a sampled, recording active span to requestContext. An inactive context,
ignored path, or unsampled request does not guarantee these fields:

```json
{
  "msg": "GET /users/42 200 45ms | 127.0.0.1",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "requestId": "my-app-a1b2c3d4"
}
```

Logs and links can be correlated in Grafana Loki / ELK via `trace_id`.

**Structured logs (Schema A + Schema B)**

When the log needs to be landed (Schema A) and reported to the OTLP Collector (Schema B) at the same time, use the two factory functions provided by `@devcodex/opentelemetry/log`:

- `createStructuredLogFormatter` — Schema A structured JSON formatter (fixed field order)
- `createOtelLogBridge` — Schema B OTel LogRecord bridge through the current OTel Logs API provider.

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

The SDK initialization script (`instrumentation.ts`, executed before app
code through `vext.preload`) reads the default export config. The CLI
delays SDK startup by default; `preloadSdk: true` starts it before app
modules. The plugin can only fill exporters not already configured and
cannot replace an existing target.

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

The plugin owns runtime tracer, meter, and logger behavior such as
`ignorePaths`, metric buckets, log bridging, and adding exporters not yet
configured during setup. The option snippets here and in capture replace
the **same plugin's options** from Quick Start; do not register multiple
copies.

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
    labels: () => ({
      "app.zone": process.env.APP_ZONE ?? "local",
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
- The current version also supports explicit full mode for headers and body;
  neither is collected by default, and this example uses allowlists. Use
  `fields`, `exclude`, `sensitiveKeys`, `maxValueLength`, `maxDepth`,
  `maxItems`, and `output` to bound, redact, and snapshot values. Body capture
  reads parsed data and does not consume the request stream again.
- `capture` generates **Span attributes** and will not automatically go into `metrics.labels`; metric dimensions should still be provided separately through `metrics.labels` and keep the cardinality low.

---

## Complete configuration reference

### opentelemetryPlugin() options

```typescript
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({
  // ── Basics ────────────────────────────────────────
  serviceName: "my-app",
  endpoint: "http://collector:4318",
  protocol: "http",
  headers: { "api-key": "KEY" },

  // ── Tracking ────────────────────────────────────────
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

  // ── Metrics ─────────────────────────────────────────
  metrics: {
    enabled: true,
    durationBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    labels: () => ({
      "app.zone": process.env.APP_ZONE ?? "local",
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

These variables have different readers in the package and SDK. For VextJS,
prefer `package.json vext.otel` for a stable export configuration.

| Variable                                                                                                           | Current reading boundary                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_PROTOCOL` / `OTEL_EXPORTER_OTLP_HEADERS` | Supported by the early config reader; corresponding package fields take priority.                                             |
| `OTEL_TRACES_SAMPLER_ARG`                                                                                          | Used for a 0–1 ratio when package config omits it; default 1. Delayed plugin startup does not fully reuse that reading chain. |
| `OTEL_TRACES_SAMPLER`                                                                                              | NodeSDK strategy input; it is not guaranteed to override a sampler explicitly set by the package.                             |
| `OTEL_METRIC_EXPORT_INTERVAL`                                                                                      | Early default is 15000 ms; `package.metricIntervalMs` wins. A plugin cannot change an already created reader's period.        |
| `OTEL_SDK_DISABLED`                                                                                                | String `true` disables SDK and plugin.                                                                                        |
| `VEXT_OTEL_FORCE_SDK`                                                                                              | Truthy value forces early SDK startup; `package.preloadSdk: true` is the explicit counterpart.                                |
| `OTEL_NODE_ENABLED_INSTRUMENTATIONS` / `OTEL_NODE_DISABLED_INSTRUMENTATIONS`                                       | Select auto-instrumentations and trigger early SDK startup.                                                                   |
| `OTEL_LOG_LEVEL`                                                                                                   | SDK diagnostics input; output also depends on the diagnostic logger. The plugin does not promise a default console level.     |

Additional plugin options: `enabled` defaults on. `insecure` only applies
when the plugin configures a gRPC exporter. `resourceAttributes` is currently
a compatibility placeholder, and the package reader does not read a same-name
field; use supported `OTEL_RESOURCE_ATTRIBUTES` for SDK Resource attributes
and verify actual output. `statusEndpoint` cannot set a custom path.
Tracing/metrics default on, `ignorePaths` defaults empty, and
`logs.bridgeAppLogger` defaults on when the endpoint is not `none`.

Lifecycle callbacks should finish synchronously. Exceptions warn and
continue, so they are not authorization or transaction hooks. An exception
path is observed as 500 and may differ from the HTTP status produced by
later business error conversion. `metrics.labels` applies only to
duration/total; capture only adds span attributes.

## Connect to a backend

### Local development

| Backend                | Startup method                                                                                                       | `endpoint` configuration                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **None (file export)** | No Docker required                                                                                                   | `package.json vext.otel.endpoint: "./otel-data"`           |
| **Jaeger**             | Enable OTLP/HTTP according to the official deployment instructions for your Jaeger version; primarily inspect traces | `package.json vext.otel.endpoint: "http://localhost:4318"` |
| **Grafana LGTM**       | `docker run -d -p 3001:3000 -p 4318:4318 grafana/otel-lgtm`                                                          | `package.json vext.otel.endpoint: "http://localhost:4318"` |

### Cloud vendors

These are example address shapes. Confirm the actual region, tenant endpoint, receiver protocol, and authentication fields in the vendor console and official integration documentation. This table does not imply that these remote services have been verified here.

| Vendor                 | `endpoint`                                         | `headers`                            |
| ---------------------- | -------------------------------------------------- | ------------------------------------ |
| **New Relic**          | `https://otlp.nr-data.net:4318`                    | `{ "api-key": "LICENSE_KEY" }`       |
| **Grafana Cloud**      | `https://otlp-gateway-....grafana.net/otlp`        | `{ "Authorization": "Basic TOKEN" }` |
| **Datadog**            | `http://dd-agent-host:4318`                        | —                                    |
| **Alibaba Cloud ARMS** | See Alibaba Cloud's OTLP integration documentation | See that documentation               |

> Supply cloud vendor tokens through environment variables, such as Kubernetes Secrets, rather than embedding them in application code.

---

## Auto-Instrumentation

`@devcodex/opentelemetry` includes `@opentelemetry/auto-instrumentations-node` for common libraries. Whether database queries, outgoing HTTP calls, and message queues produce spans depends on SDK initialization order, library compatibility, enabled instrumentations, and sampling.

### Installation

For automatic instrumentation, set `vext.otel.preloadSdk: true` in `package.json` and start with `vext dev` or `vext start`. Confirm that the SDK initializes before the business libraries you want to instrument are loaded. Starting it only in the plugin phase cannot reliably patch libraries that are already loaded.

If **application code** directly imports `getNodeAutoInstrumentations` from `@opentelemetry/auto-instrumentations-node` for deeper customization, declare that package as an application direct dependency.

### Supported libraries

| Category      | Library                          | Potentially captured operations                         |
| ------------- | -------------------------------- | ------------------------------------------------------- |
| **Database**  | MongoDB (`mongodb` / `mongoose`) | Queries, collections, duration                          |
|               | PostgreSQL (`pg`)                | SQL, tables, duration                                   |
|               | MySQL (`mysql` / `mysql2`)       | SQL, tables, duration                                   |
|               | Redis (`ioredis` / `redis`)      | Commands, keys, duration                                |
| **HTTP**      | Node.js `http` / `https`         | Outgoing calls, URLs, status                            |
|               | `undici` / `fetch`               | Outgoing calls, including built-in fetch on Node.js 20+ |
| **Messaging** | `amqplib` (RabbitMQ)             | Queue names and message operations                      |
|               | `kafkajs`                        | Topics and message operations                           |
| **Cache**     | `memcached`                      | Operations and keys                                     |
| **RPC**       | `@grpc/grpc-js`                  | Methods and status                                      |
| **Other**     | `dns`, `net`                     | DNS lookups and TCP connections                         |

See [@opentelemetry/auto-instrumentations-node](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) for the full list.

### Example result

A `GET /users/:id` request **might** produce this span tree in Jaeger:

```text
GET /users/:id                      (http, 45ms)
├── mongodb.find users              (db, 12ms)
├── redis.GET user:cache:42         (cache, 2ms)
└── HTTP GET https://api.xxx/verify (http, 28ms)
```

This illustrates a possible business call chain. The route must actually call these dependencies and their instrumentations must be active. The `/otel-demo` route does not create database or Redis operations.

### Disable selected instrumentations

Prefer the environment variable supported by `auto-instrumentations-node`; do not create a second `NodeSDK` for this. Set it **before** starting the process, for example in PowerShell:

```powershell
$env:OTEL_NODE_DISABLED_INSTRUMENTATIONS = "fs,dns"
npm run dev
```

Use names without package prefixes. This package already disables `fs` by default, and this setting also triggers early SDK initialization. See the [OpenTelemetry configuration guide](https://opentelemetry.io/docs/zero-code/js/configuration/) and check the supported range of the installed instrumentation versions.

### Behavior when auto-instrumentation is unavailable

If `@opentelemetry/auto-instrumentations-node` is unavailable:

- The console prints a warning.
- Manual `withSpan` operations and SDK metrics can still work. The plugin can only enrich an existing active span; without HTTP instrumentation, request spans and log trace correlation are not guaranteed.
- Automatically generated request, database, and outgoing HTTP spans are absent. Whether the application continues to run also depends on its own code.

```text
[vextjs-opentelemetry/instrumentation] @opentelemetry/auto-instrumentations-node is not installed.
  npm install @opentelemetry/auto-instrumentations-node
```

---

## Advanced usage

### Manually track business operations (withSpan)

`withSpan()` tracks custom business operations. It wraps `tracer.startActiveSpan()` with try/catch/finally and handles `span.end()`, `span.recordException()` and `span.setStatus()`.

#### VextJS plugin (via `app.otel.withSpan`)

This route fragment requires the OTel plugin setup described above, a business-owned `src/services/payment.ts` service exposing `process(id)`, and typegen. Use a payment-service test double for verification. Each request executes the payment operation exactly once.

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

**Behavioral Description**:

| Scenario                         | Automatic behavior                                                              |
| -------------------------------- | ------------------------------------------------------------------------------- |
| The callback returns normally    | `span.end()` is automatically called                                            |
| The callback throws an exception | `span.recordException(err)` + `span.setStatus(ERROR)` + `span.end()` + re-throw |
| SDK not initialized              | Noop span; no telemetry is exported                                             |

### Underlying API (custom SpanKind, Processor, and other advanced scenarios)

This advanced fragment also belongs in `src/routes/index.ts`. First implement `findById(id)` in `src/services/user.ts` and run typegen. Install `@opentelemetry/api` as a direct dependency when importing it. `startSpan` does not make the new span the active context for child calls; prefer `withSpan` when context propagation matters.

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

### Custom business metrics

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

### Sampling (reduce overhead)

**Option 1: `package.json` configuration (recommended)**

The instrumentation reads `vext.otel.sampling.ratio` when the SDK initializes. When a valid ratio is below 1, it uses `ParentBasedSampler(TraceIdRatioBasedSampler(ratio))`; root spans without a sampled parent are sampled at this ratio. Restart after changing it:

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

**Option 2: Environment variable when package sampling is absent**

```bash
# Set in CI/CD or a deployment script without changing application code.
VEXT_OTEL_FORCE_SDK=1 OTEL_TRACES_SAMPLER_ARG=0.1 npm start
```

### Cluster processes

```bash
VEXT_CLUSTER=1 npm start  # POSIX shell; Windows can enable cluster in config
```

### Custom instrumentation

Project `src/preload/` entries and direct dependency packages' `vext.preload` entries run together. An application's own `package.json vext.preload` is not a project script entry point and does not replace a dependency package's entry point. Do not create an uncoordinated second `NodeSDK` alongside the default integration.

If you need to own the SDK yourself, read the [preload guide](/guide/preload). Explicitly disable or exclude the built-in startup entry, and define initialization order, exporters, and shutdown ownership before implementing the upstream custom SDK instructions. This page's default example uses one plugin-managed SDK.

---

## Log field planning

VextJS and `@devcodex/opentelemetry` support two complementary log outputs:

- **A. Application logs (stdout / file JSON):** readable business fields for investigation and aggregation in ELK or Loki.
- **B. OTel Logs (LogRecord → Collector):** lightweight records linked to traces by `trace_id`.

### A. Application log fields (stdout / file JSON)

Add stable business fields with `config.logger.mixin`. A logger mixin is not the same as an SDK Resource configuration. You can replace the earlier logger configuration with this example; it needs neither top-level `await` nor the non-public `Span.name` field:

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

An active recording span in the request context supplies `trace_id` and `span_id`. Log a business span name explicitly when needed.

Example output fragment:

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

> The framework's built-in provider automatically injects `requestId`, and `traceId` / `spanId` written to `requestContext`, as `requestId`, `trace_id`, and `span_id`. Do not duplicate them in the user mixin.

#### Field reference

| Field          | Source                                       | Configuration                                                                                   |
| -------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `time`         | Vext logger; ISO time string by default      | Public logger config has no timestamp switch                                                    |
| `level`        | Vext logger                                  | Automatic                                                                                       |
| `msg`          | `logger.info("...")`                         | Automatic                                                                                       |
| `requestId`    | Framework ALS and built-in mixin             | Automatic                                                                                       |
| `trace_id`     | OTel middleware → ALS → built-in mixin       | Automatic when context exists                                                                   |
| `span_id`      | OTel middleware → ALS → built-in mixin       | Automatic when context exists                                                                   |
| `service_name` | `config.logger.mixin`                        | User mixin                                                                                      |
| `env`          | `config.logger.mixin`                        | User mixin                                                                                      |
| `host`         | `config.logger.mixin`                        | User mixin                                                                                      |
| `span`         | Explicit business field                      | This example's mixin does not inject it                                                         |
| `endpoint`     | Business code explicitly reads `req.route`   | Default access log msg uses the actual `req.path`; no endpoint field is generated automatically |
| `latency_ms`   | Explicit business field or parsed access log | Default duration is `Nms` text within msg, rather than a separate latency_ms field              |
| `user_id`      | Business code                                | `logger.info({ user_id: "..." }, msg)`                                                          |
| `feature.flag` | Business code                                | `logger.info({ "feature.flag": "..." }, msg)`                                                   |
| `err`          | `logger.error(err)`                          | Framework serialization; not automatically an OTel `exception.*` attribute                      |

The default request message looks like `GET /users/123 200 8ms | IP`. Aggregate metrics by route template so each user ID does not become a separate label. Record explicit fields in your own route middleware. This file does not replace the OTel initialization above:

```typescript
// src/middlewares/route-metrics.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  const startedAt = performance.now();
  req.onClose(() => {
    req.app.logger.info(
      {
        endpoint: req.route || "unmatched",
        latency_ms: performance.now() - startedAt,
        requestId: req.requestId,
      },
      "request closed",
    );
  });
  await next();
});
```

Add `route-metrics` to the `config.middlewares` whitelist and reference it in the target route's `middlewares`; see [Middleware registration and use](../guide/middleware#registration-and-use). A parameter route's endpoint should be `/users/:id`, rather than `/users/123`. This example uses `req.onClose()` to measure response completion or premature connection closure. A close event does not guarantee the client received the complete response and should not automatically count as a successful request.

### B. OTel Logs (LogRecord → Collector)

The default Vext logger does not depend on a third-party logger, so logger-specific auto-instrumentation does not automatically capture `app.logger`. To export OTel Logs, use the `app.setLogger()` bridge provided by `@devcodex/opentelemetry` or wrap the current logger in a custom plugin:

- **`trace_id` / `span_id`:** derived from `requestContext` or an active span for the LogRecord.
- **`severity_text`:** mapped from the Vext logger level.
- **`body`:** the log message.
- **`service.name`:** from the SDK Resource configured in `instrumentation.ts`.
- **`attributes`:** structured log arguments mapped to LogRecord attributes.

The current bridge reads the arguments passed to the logger and then calls the original logger. Fields added later by the original logger's mixin do **not** automatically enter the LogRecord. Pass fields needed in both outputs explicitly as log arguments, or set OTel `logs.globalAttributes`. The bridge is enabled by default when `endpoint` is not `none`; it wraps `info`, `warn`, `error`, `debug`, and `fatal`. Child loggers and `trace` are not bridged automatically, and nested object fields are not fully passed through.

::: tip OTel Logs practice
Avoid copying every application log field into LogRecord attributes. Use `trace_id` to connect the log to a trace and inspect the richer context there. Keeping LogRecords small helps control Collector traffic.
:::

### C. Deeper fields in child spans

This is an illustration using older semantic names. Actual fields depend on the installed instrumentation, target library, configuration, and sampling. Newer versions may use `url.full` or `db.query.text`; do not treat this table as a guarantee for every request.

```text
GET /users/:id                      (http, 45ms)  ← user.id, tenant.id here
├── mongodb.find users              (db, 12ms)    ← db.statement, if captured
├── redis.GET user:cache:42         (cache, 2ms)  ← cache.system, if captured
└── HTTP GET https://api.xxx/verify (http, 28ms)  ← outgoing call
```

| Field          | Source                          | Location                            |
| -------------- | ------------------------------- | ----------------------------------- |
| `db.statement` | Database instrumentation        | Database child span attributes      |
| `db.system`    | Database instrumentation        | Database child span attributes      |
| `cache.system` | Redis/Memcached instrumentation | Cache child span attributes         |
| `http.url`     | HTTP instrumentation            | Outgoing call child span attributes |

Follow `trace_id` in Jaeger or Grafana Tempo to inspect the complete call chain.

---

## Production best practices

1. **Configure an export endpoint.** Without one, no data is exported; this is the safe default.
2. **Budget for shutdown.** The plugin calls SDK shutdown in `onClose`. Set `shutdown.timeout` in seconds based on actual batching and network delay, then verify it. A larger timeout cannot guarantee Collector receipt.
3. **Restrict `/_otel/status`.** The VextJS adapter registers this route automatically. In production, restrict it to internal access at the gateway.
4. **Exclude sensitive data from spans.** Avoid passwords, tokens, and identity numbers.
5. **Set sampling deliberately.** Use one package sampling configuration or verified environment configuration, restart, and inspect the actual output volume.
6. **Use a Collector where appropriate.** Application → Collector → backend provides decoupling and buffering.

```text
Applications (N) ──OTLP──► Collector ──► Jaeger / Prometheus / Grafana
```

---

## FAQ

### Q: `/_otel/status` returns `"sdk": "noop"`

Without an endpoint, noop may be expected. To export data, check the direct dependency, plugin enablement, package `endpoint` and `preloadSdk`, and `OTEL_SDK_DISABLED`. Disabling the plugin entirely makes this endpoint return 404.

### Q: The endpoint shows localhost, but I configured another address

Check `package.json vext.otel.endpoint`, keep the plugin's `endpoint`, `protocol`, and `headers` aligned with package config, and confirm that you start with `vext start` or `vext dev`.

### Q: Logs have no `trace_id`

Check the SDK, early auto-instrumentation, plugin registration, and sampling. `requestContext` must be enabled, and the log must occur inside a request context with a recording span. An `initialized` status alone does not prove that this request has an active span.

### Q: The backend receives no data

Check `exportMode` and `exportTarget` first. Local file export can distinguish “no data produced” from “network export failed.” Inspect actual backend records, authentication, protocol, and connectivity; allow for the configured batching and metrics intervals. The package does not guarantee a `SUCCESS` log for each batch, and gRPC failure or recovery logs do not prove delivery of every signal.

### Q: `[otel] ... export FAILED: grpcSend timeout`

The server cannot complete an h2c gRPC connection to the Collector. Check the address and port, Collector health, network rules, and service DNS inside Docker or Kubernetes; `localhost` there refers to the current container or pod.

### Q: I start with `node dist/server.js`; why is the SDK inactive?

The zero-configuration VextJS integration depends on the CLI discovering dependency packages' `vext.preload` entries and injecting `--import` before startup.

1. **Recommended:** use `vext dev` or `vext start` through project npm scripts.
2. **Custom Node command:** only if you have actually built a complete application entry point, add `--import @devcodex/opentelemetry/instrumentation` yourself. A standard Vext build does not create `dist/server.js` automatically.

```bash
node --import @devcodex/opentelemetry/instrumentation dist/server.js
```

### Q: How do I disable the integration in tests?

```json
{
  "vext": {
    "otel": {
      "enabled": false
    }
  }
}
```

Alternatively set `OTEL_SDK_DISABLED=true` before startup. Also disable routes that depend on `app.otel`. Setting only `endpoint: "none"` stops export; it does not disable the entire integration.

## Related documentation

- [Preload](/guide/preload): project and dependency entries, development and production lifecycle.
- [Plugins](/guide/plugins): setup, dependency order, and shutdown.
- [Logger](/guide/logger) and [access log](/api/access-log): output fields, context, and response completion timing.
- [Deployment](/guide/deployment): startup, processes, and shutdown budget.

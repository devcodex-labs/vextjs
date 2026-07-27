# Logger

VextJS has a built-in Vext logger kernel with zero runtime dependency, which can be used anywhere in the framework through `app.logger`. By default, it provides capabilities such as structured JSON, pretty/JSON dual mode, pretty level color output, requestId automatic injection, child logger, runtime level control, and minimalist log desensitization.

## Basic usage

`app.logger` can be used directly in routes, services, plugins and middleware:

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/users", async (req, res) => {
    app.logger.info("Get user list");
    app.logger.debug({ page: 1, limit: 20 }, "query parameters");

    const users = await app.services.user.findAll();
    app.logger.info({ count: users.length }, "Query completed");

    res.json(users);
  });
});
```

## Log level

`app.logger` exposes 6 commonly used methods, ordered from lowest to highest severity:

| Level   | Method               | Description         | Typical Scenario                                          |
| ------- | -------------------- | ------------------- | --------------------------------------------------------- |
| `trace` | `app.logger.trace()` | Finest granularity  | Temporary troubleshooting, very detailed path information |
| `debug` | `app.logger.debug()` | Debug information   | Variable values, SQL queries, detailed processes          |
| `info`  | `app.logger.info()`  | General information | Service startup, request processing, business events      |
| `warn`  | `app.logger.warn()`  | Warning             | Performance degradation, deprecated API, retry            |
| `error` | `app.logger.error()` | Error               | Exception, failed operation                               |
| `fatal` | `app.logger.fatal()` | Fatal error         | The application cannot continue running                   |

`logger.level` accepts `trace` and `silent` as threshold configurations: `trace` will enable all logging methods, and `silent` will turn off all output.

### Configure log level

```typescript
// src/config/default.ts
export default {
  logger: {
    level: "debug", // The development environment outputs all levels
  },
};
```

```typescript
// src/config/production.ts
export default {
  logger: {
    level: "info", // The production environment only outputs info and above
  },
};
```

After setting a certain level, **logs lower than this level will not be output**. For example, with `level: 'info'`, calls to `debug()` are silently ignored (zero overhead).

### Adjust log level at runtime

The default logger supports adjusting subsequent log thresholds at runtime, which is suitable for online temporary troubleshooting:

```typescript
app.logger.getLevel(); // "info"
app.logger.setLevel("debug");
app.logger.debug({ orderId }, "debug detail");
app.logger.setLevel("warn");
```

- `setLevel()` only affects subsequent logs and does not review historical logs.
- The created child logger shares the current runtime level with the parent logger.
- `app.logger.level = "debug"` is not supported for this writable property compatibility; please use `setLevel()`.
- Illegal levels will throw an explicit error and will not downgrade silently.

## Life cycle log layering

In addition to the regular `logger.level`, VextJS also provides `logger.lifecycleLevel`, which specifically controls the framework's own **startup/loading/hot reload** system logs:

```typescript
export default {
  logger: {
    level: "info",
    lifecycleLevel: "concise", // "concise" | "verbose"
  },
};
```

- `concise` (default): only output single-line results of initialization start, aggregate load number, ready, cold restart / hot reload
- `verbose`: Additional output of per-plugin/per-service/watcher file list/reload phased time consumption

It can also be overridden via environment variables or CLI:

```bash
VEXT_LIFECYCLE_LEVEL=verbose vext start
VEXT_VERBOSE_LIFECYCLE=1 vext dev
```

## Structured log

The core concept of Vext logger is **structured logging** - each log is a JSON object, which is easy for machine parsing and query.

### Call signature

```typescript
// pure message
app.logger.info("Service Start");

// object + message (recommended)
app.logger.info({ port: 3000, adapter: "native" }, "Service startup");

// Object (no message)
app.logger.info({ event: "startup", port: 3000 });
```

:::tip Recommended writing method
Always use the form `logger.info(object, message)` - structured fields are easy for logging systems to index and filter, and messages are easy for humans to read.
:::

### JSON output format

In the production environment (`NODE_ENV=production`), the log output is in JSON format:

```json
{"level":30,"time":"2026-03-05T14:23:05.123Z","requestId":"abc-123","msg":"→ GET /api/users 200 45ms"}
{"level":30,"time":"2026-03-05T14:23:05.200Z","requestId":"abc-123","service":"UserService","msg":"Query completed","count":42}
```

### Pretty output format

In the development environment (default), the built-in pretty formatter is used to output formatted logs that are easy to read. Single-line mode is enabled by default (`prettySingleLine: true`), and structured fields are appended inline to the end of the message as JSON:

```
[2026-03-05 14:23:05.123] INFO: Service started {"port":3000,"adapter":"native"}
[2026-03-05 14:23:05.200] DEBUG: Query parameters {"page":1,"limit":20}
[2026-03-05 14:23:05.300] INFO: Seed data loaded {"count":3,"service":"UserService"}
```

If `prettySingleLine: false` is set, the multiline expansion format is used:

```
[2026-03-05 14:23:05.123] INFO service started
    port: 3000
    adapter: "native"
[2026-03-05 14:23:05.200] DEBUG query parameters
    page: 1
    limit: 20
```

> **Note**: `requestId` is excluded from the `ignore` list of the built-in pretty formatter by default (`prettyIgnore` configuration item) and will not be output in pretty mode. This makes the development log more compact. `requestId` is still present in the production JSON output. If you want to display requestId in pretty mode, you can remove it through the `prettyIgnore` configuration item (see configuration instructions below).

In the TTY terminal, the pretty formatter will add fixed ANSI colors to the level labels of `trace` / `debug` / `info` / `warn` / `error` / `fatal` by default, making it easier to scan during the development period. The color only wraps the level label and does not affect message, URL, extras, redaction replacement values ​​or JSON output.

### Configure Pretty mode

```typescript
// src/config/default.ts
export default {
  logger: {
    level: "debug",
    pretty: true, // The development environment uses pretty format (default behavior)
    prettyColor: "auto", // Automatically add color to level label in TTY
  },
};
```

```typescript
// src/config/production.ts
export default {
  logger: {
    level: "info",
    pretty: false, // The production environment uses JSON format (default behavior)
  },
};
```

`pretty` default value depends on `NODE_ENV`:

- `NODE_ENV !== 'production'` → `pretty: true`
- `NODE_ENV === 'production'` → `pretty: false`

### Color Pretty Level {#pretty-color}

`prettyColor` only affects pretty text output and supports three modes:

| value      | behavior                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"auto"`   | Default value. Enabled in TTY; `FORCE_COLOR=1` forces enable and takes precedence over `NO_COLOR`; `FORCE_COLOR=0`, `NO_COLOR` when `FORCE_COLOR` is not set, `TERM=dumb` or non-TTY disabled |
| `"always"` | Forces ANSI output in pretty mode, often used for local manual observation or automated verification                                                                                          |
| `"never"`  | disable pretty ANSI                                                                                                                                                                           |

```typescript
// src/config/development.ts
export default {
  logger: {
    pretty: true,
    prettyColor: "auto",
  },
};
```

Production JSON logs will not output ANSI, even if `prettyColor: "always"` is set, as long as `pretty: false` will still remain pure JSON.
Use `FORCE_COLOR=1` when you need to force observing colors in `npm run dev`, CI or redirect logs.

### Single line vs multi-line format {#pretty-single-line}

The `prettySingleLine` configuration item can be used to control how the built-in pretty formatter displays structured fields in development mode. The default value is `true` (single-line mode).

```typescript
// src/config/default.ts — Default behavior (single line output)
export default {
  logger: {
    pretty: true,
    // prettySingleLine default value: true
    // Output: [14:23:05] INFO: Seed data loaded {"count":3,"service":"UserService"}
  },
};
```

If a multi-line expansion format is preferred, this can be set to `false`:

```typescript
// src/config/development.ts — multi-line expansion
export default {
  logger: {
    pretty: true,
    prettySingleLine: false,
    //output:
    // [14:23:05] INFO Seed data loaded
    // count: 3
    // service: "UserService"
  },
};
```

> **Note**: `prettySingleLine` only affects pretty mode (development environment). The JSON output format for production environments is not affected.

### Custom Pretty ignore field {#pretty-ignore}

The `prettyIgnore` configuration item can be used to control which structured fields are hidden by the built-in pretty formatter in development mode. The default value is `"pid,hostname,requestId"`, which hides the process ID, hostname and request ID to avoid unnecessary field noise in the development log.

```typescript
// src/config/default.ts — Default behavior (requestId is hidden)
export default {
  logger: {
    pretty: true,
    // prettyIgnore default value: "pid,hostname,requestId"
  },
};
```

If you need to display the requestId in pretty mode (for example when debugging the request link), you can remove it from the ignore list:

```typescript
// src/config/development.ts — show requestId
export default {
  logger: {
    pretty: true,
    prettyIgnore: "pid,hostname", // no longer ignore requestId
  },
};
```

It is also possible to add additional ignored fields:

```typescript
//Hide requestId + custom field
export default {
  logger: {
    prettyIgnore: "pid,hostname,requestId,traceId,spanId",
  },
};
```

> **Note**: `prettyIgnore` only affects pretty mode (development environment). The production JSON output always includes all fields (including `requestId`) to ensure complete parsing by the log collection system.

## Log desensitization

The default logger provides a minimalist redaction that is turned off by default and is used to replace structured log fields before writing to stdout:

```typescript
// src/config/production.ts
export default {
  logger: {
    level: "info",
    redactKeys: ["password", "token"],
    redactPaths: ["user.email", "headers.authorization", "users.0.secret"],
    redactValue: "[Redacted]",
  },
};
```

Effect:

```typescript
app.logger.info(
  {
    user: { email: "ada@example.com", password: "secret" },
    headers: { authorization: "Bearer token" },
  },
  "login",
);
```

`user.email`, `password` and `headers.authorization` will be replaced with `"[Redacted]"` in the output.

Boundary:

- `redactKeys` is an exact key match at any level.
- `redactPaths` is dot notation exact path and supports array numeric subscripts.
- Desensitization occurs before pretty/JSON output, making both formats consistent.
- Desensitization will not modify the original object passed in by the caller.
- The top level `level` is the log protocol field and will not be overwritten by redaction.
- No support for wildcard, glob, regex, bracket notation, remove or function censor.

### Custom Pretty output {#custom-pretty-output}

VextJS does not expose `messageFormat` template configuration by default. Most development scenarios can directly use `prettySingleLine` and `prettyIgnore` to control output compactness:

- `prettySingleLine: true`: extra fields are inlined in the same line of the message as JSON
- `prettySingleLine: false`: extra fields multi-line expansion
- `prettyIgnore`: Hide structured fields that you don’t care about in the development log.

If you need to synchronize logs to an external system or completely take over the formatting logic, it is recommended to wrap the current logger in the plug-in through `app.setLogger()`. This does not affect the framework's default JSON fields, requestId injection, and child logger behavior.

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "custom-log-format",
  setup(app) {
    app.setLogger((original) => ({
      ...original,
      info(...args: unknown[]) {
        // This can be forwarded to an external SDK, or additional human-readable logs generated.
        original.info(...args);
      },
      child: (bindings) => original.child(bindings),
    }));
  },
});
```

## requestId automatic injection

This is one of the most important features of the VextJS logging system. **No need to manually pass in the requestId**, all logs automatically carry the requestId of the current request.

### Working principle

```
The request enters → requestId middleware generates ID → writes requestContext (AsyncLocalStorage)
                                              ↓
app.logger.info('xxx') ← logger mixin automatically reads requestId
                                              ↓
Output: {"requestId":"abc-123","msg":"xxx"}
```

Vext logger's `mixin` is called before each log is written, reading the `requestId` of the current request from `requestContext` (based on `AsyncLocalStorage`) and appending it to the log field. This means:

- **Log in handler**: automatically carry requestId ✅
- **Log in service**: automatically carry requestId ✅
- **Log in middleware**: automatically carry requestId ✅
- **Log of startup phase**: No requestId (non-request context)✅

```typescript
// No need to do this ❌
app.logger.info({ requestId: req.requestId }, "Processing request");

// Just do this ✅
app.logger.info("Processing request");
// Output automatically includes requestId
```

### Performance optimization

Vext logger's request field injection takes the synchronous provider link, and directly skips the corresponding merging step when there is no request context or the user `mixin` is not configured. VextJS has made two optimizations:

1. **Empty context returns quickly**: Non-request contexts such as startup phase and background tasks will not generate `requestId` / `trace_id` / `span_id` fields.
2. **ALS Disabled Detection**: When AsyncLocalStorage is disabled, skip the `getStore()` call

## Child Logger

The `child()` method creates a child logger. The child logger inherits all configurations (level, format, mixin) of the parent logger, and additionally carries the specified binding fields:

```typescript
//Create a sub-logger with service field
const serviceLogger = app.logger.child({ service: "UserService" });

serviceLogger.info("Initialization completed");
// Output: {"service":"UserService","msg":"Initialization completed"}

serviceLogger.info({ userId: "123" }, "Query user");
// Output: {"service":"UserService","userId":"123","msg":"Query User"}
```

### Used in Service

It is recommended to create the child logger in the Service constructor:

```typescript
export class UserService {
  private logger;

  constructor(private app: any) {
    //Create a child logger with service identifier
    this.logger = app.logger.child({ service: "UserService" });
  }

  async findById(userId: string) {
    this.logger.debug({ userId }, "Query user");

    const user = await this.app.db.collection("users").findOne({ _id: userId });

    if (!user) {
      this.logger.warn({ userId }, "The user does not exist");
      this.app.throw(404, "User does not exist");
    }

    this.logger.info({ userId, event: "user.found" }, "User query successful");
    return user;
  }
}
```

Output example:

```json
{"level":20,"time":"...","requestId":"abc-123","service":"UserService","userId":"u-001","msg":"Query User"}
{"level":30,"time":"...","requestId":"abc-123","service":"UserService","userId":"u-001","event":"user.found","msg":"User query successful"}
```

### Nested Child Logger

Child loggers can be created nested, and fields will accumulate:

```typescript
const dbLogger = app.logger.child({ module: "database" });
const queryLogger = dbLogger.child({ collection: "users" });

queryLogger.debug("Execute query");
// Output: {"module":"database","collection":"users","msg":"Execute query"}
```

## Error log

### Logging Error object

Vext logger automatically serializes Error objects (retains message, stack, name):

```typescript
try {
  await someOperation();
} catch (err) {
  app.logger.error({ err }, "Operation failed");
  // Vext logger will automatically serialize Error:
  // {"err":{"type":"Error","message":"xxx","stack":"..."},"msg":"Operation failed"}
}
```

:::tip Error calling method
Both direct Error and `{ err }` fields are supported. When additional business context is required, it is recommended to use `{ err, ...context }`:

```typescript
// ✅ Direct transmission Error
app.logger.error(error, "Operation failed");

// ✅ Add business context
app.logger.error({ err: error }, "Operation failed");
```

:::

### Log error context

```typescript
async function processPayment(orderId: string, amount: number) {
  try {
    const result = await paymentGateway.charge(amount);
    app.logger.info(
      { orderId, amount, chargeId: result.id },
      "Payment successful",
    );
    return result;
  } catch (err) {
    app.logger.error(
      { err, orderId, amount, gateway: "stripe" },
      "Payment failed",
    );
    throw err;
  }
}
```

## Extended Logger: setLogger()

`app.setLogger(wrapper)` is a plug-in-specific API that allows you to wrap all logging methods without replacing the default logger kernel - a common use is to forward framework logs to external systems (OTel Logs, Sentry, cloud logging platforms, etc.) simultaneously.

### Function signature

```typescript
setLogger(wrapper: (original: VextRuntimeLogger) => VextLoggerLike): void;
```

`wrapper` takes the current complete runtime logger (the default Vext logger or the normalized result of the previous wrapper) and returns a complete or partial `VextLoggerLike` implementation. Missing methods fall back to the original logger. This can be done in the new implementation:

- Call external SDK to report logs
- Filter or sample certain levels
- Inject global fields

### Typical usage: Bridge to OpenTelemetry Logs

When you use the `@devcodex/opentelemetry` plugin, it will call `app.setLogger()` in `setup()` to automatically forward all calls to `app.logger` to the OTel Logs SDK without additional configuration:

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({
  endpoint: "grpc://collector:4317",
  protocol: "grpc",
  logs: {
    bridgeAppLogger: true, //default true (automatically enabled when endpoint is valid)
    globalAttributes: {
      "app.version": "1.2.0",
    },
  },
});
// → app.logger.info("xxx") simultaneously reports to OTel Collector + outputs to stdout
```

### Custom Logger extension example

```typescript
import { definePlugin } from "vextjs";
import type { VextLogger } from "vextjs";

export default definePlugin({
  name: "sentry-logger",
  setup(app) {
    app.setLogger((original) => ({
      ...original,
      error(...args: unknown[]) {
        //Report error level logs to Sentry
        const msg =
          typeof args[0] === "string" ? args[0] : String(args[1] ?? "");
        Sentry.captureMessage(msg, "error");
        //The default logger output remains unchanged
        (original.error as (...a: unknown[]) => void)(...args);
      },
      // child logger maintains original logic
      child: (bindings) => original.child(bindings),
    }));
  },
});
```

:::tip is consistent with setThrow mode
`setLogger` adopts exactly the same wrapper pattern as `setThrow`: it receives the original implementation and returns the wrapped implementation. This means:

- Can be called multiple times (each time wrapping the previous result)
- Default logger functions (requestId injection, pretty format, child logger and runtime level control) are retained for methods that the wrapper does not override
- Exceptions thrown in the wrapper function will not affect the original logger
  :::

:::warning child logger fallback and bridging
When the wrapper does not return `child()`, child loggers fall back to the original logger. If child loggers should also be bridged, return a `child()` method from the wrapper and wrap the child logger there.
:::

---

## Log storage and collection

For production environments, it is recommended that VextJS output structured JSON to stdout/stderr, and then the process manager, container platform or log agent is responsible for persistence, rotation and reporting. In this way, the application process does not need additional log transport dependencies, and the log pipeline can be kept replaceable.

### Solution Overview

| Solution                        | Complexity | Applicable scenarios                  | Description                                                                    |
| ------------------------------- | :--------: | ------------------------------------- | ------------------------------------------------------------------------------ |
| **stdout → Cloud native**       |     ⭐     | K8s / Cloud Run / ECS                 | Platform automatically collects stdout                                         |
| **PM2/systemd file collection** |     ⭐     | Stand-alone deployment                | Process manager collects stdout/stderr to file                                 |
| **logrotate**                   |    ⭐⭐    | Stand-alone / needs automatic cutting | System-level log rotation, no need for application awareness                   |
| **Filebeat → ELK**              |   ⭐⭐⭐   | Medium and large projects             | File collection → Elasticsearch → Kibana                                       |
| **Docker → Loki**               |    ⭐⭐    | Containerized deployment              | Docker logging driver or Agent push                                            |
| **app.setLogger bridging**      |   ⭐⭐⭐   | Requires SDK direct connection        | The plug-in wraps the logger and forwards it to the external SDK synchronously |

### Recommended log directory structure

```
project/
├── Exclude in logs/ # .gitignore
│ ├── app.log # Current application log
│ ├── app.1.log # Historical log after rotation
│ ├── app.2.log
│ ├── error.log # Only error and above levels
│ └── access.log # Access log (optional)
├── src/
└── dist/
```

:::warning
Make sure `.gitignore` contains the `logs/` directory and do not submit log files to the repository.
:::

---

### Solution 1: stdout → Cloud native

In platforms such as Kubernetes / AWS ECS / Google Cloud Run, output directly to stdout, which is automatically collected by the platform:

```bash
# No additional configuration is required, JSON logs are output directly to stdout
vext start
```

| Platform                 | Log collection method                                    |
| ------------------------ | -------------------------------------------------------- |
| **Kubernetes**           | stdout → kubelet → Fluentd / Fluent Bit / Loki → Storage |
| **AWS ECS**              | stdout → CloudWatch Logs                                 |
| **Google Cloud Run**     | stdout → Cloud Logging                                   |
| **Azure Container Apps** | stdout → Azure Monitor                                   |

This is the simplest and most recommended cloud native solution - **don't do any log configuration** and let the platform handle everything.

---

### Solution 2: PM2/systemd file collection

When deploying on a single machine, you can ask the process manager to write stdout/stderr to a file, and then rotate it with `logrotate`.

#### PM2 Example

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "myapp",
      script: "node_modules/vextjs/dist/cli/index.js",
      args: "start",
      error_file: "/var/log/myapp/error.log",
      out_file: "/var/log/myapp/app.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      merge_logs: true,
    },
  ],
};
```

#### systemd example

```ini
# /etc/systemd/system/myapp.service
[Service]
ExecStart=/usr/bin/npm start
WorkingDirectory=/srv/myapp
StandardOutput=append:/var/log/myapp/app.log
StandardError=append:/var/log/myapp/error.log
Restart=always
```

---

### Solution 3: System-level logrotate (Linux)

If you use PM2 or systemd to manage the process, you can use the system's own `logrotate` to manage log rotation:

```bash
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

| Options         | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `daily`         | Rotate every day                                              |
| `rotate 30`     | Keep 30 historical files                                      |
| `compress`      | History file gzip compression                                 |
| `delaycompress` | The most recent file is not compressed (easy to view)         |
| `copytruncate`  | Truncate after copying (without interrupting process writing) |

---

### Solution 4: Filebeat → Elasticsearch → Kibana (ELK)

Complete ELK log analysis pipeline. Suitable for medium and large projects that require full-text search, aggregate analysis, and visualization panels.

#### Architecture

```
VextJS (JSON stdout)
  → PM2/systemd/container runtime (write or expose log stream)
    → Filebeat / Fluent Bit (Collection)
      → Elasticsearch (storage + index)
        → Kibana (visualization + query)
```

#### Filebeat collection

```yaml
# /etc/filebeat/filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/myapp/app.log
    json.keys_under_root: true # JSON fields are promoted to the top level
    json.overwrite_keys: true # Overwrite fields with the same name
    json.add_error_key: true # Add error field when JSON parsing fails
    fields:
      app: myapp
      env: production
    fields_under_root: true

  - type: log
    enabled: true
    paths: -/var/log/myapp/error.log
    json.keys_under_root: true
    json.overwrite_keys: true
    fields:
      app: myapp
      env: production
      log_type: error
    fields_under_root: true

output.elasticsearch:
  hosts: ["http://elasticsearch:9200"]
  index: "myapp-%{+yyyy.MM.dd}"
  username: "${ELASTIC_USER}"
  password: "${ELASTIC_PASSWORD}"

# Index template (optional, optimized mapping)
setup.template.name: "myapp"
setup.template.pattern: "myapp-*"
setup.template.settings:
  index.number_of_shards: 1
  index.number_of_replicas: 0
```

#### Kibana index mode

1. Open Kibana → Stack Management → Index Patterns
2. Create index mode: `myapp-*`
3. Select `time` for the time field (ISO timestamp of Vext logger)
4. Search logs in Discover

Common queries:

- Track by requestId: `requestId: "abc-123"`
- Filter by error level: `level: 50` (Vext logger level 50 = error)
- Filter by service: `service: "UserService"`

---

### Option 5: Docker → Loki

When deploying containers, use the Docker logging driver to push directly to Grafana Loki:

```yaml
# docker-compose.yml
services:
  app:
    build: .
    logging:
      driver: loki
      options:
        loki-url: "http://loki:3100/loki/api/v1/push"
        loki-batch-size: "400"
        loki-retries: "3"
        loki-external-labels: "app=myapp,env=production"
```

Add the Loki data source to Grafana to query the logs:

- Query by requestId: `{app="myapp"} |= "abc-123"`
- Filter by JSON field: `{app="myapp"} | json | level >= 50`

---

### Solution six: app.setLogger bridges external SDK

If you must call the external log SDK synchronously within the application, you can wrap the current logger through `app.setLogger()`. This method is suitable for plug-in encapsulation, and the default logger continues to output to stdout.

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "cloud-logger-bridge",
  setup(app) {
    app.setLogger((original) => ({
      ...original,
      info(...args: unknown[]) {
        cloudLogger.write("info", args);
        original.info(...args);
      },
      error(...args: unknown[]) {
        cloudLogger.write("error", args);
        original.error(...args);
      },
      child: (bindings) => original.child(bindings),
    }));
  },
});
```

This is not a replacement mechanism for the default logger, but a forwarding bridge at the plug-in layer. If you need official OTel Logs, Sentry, Loki/ELK plug-ins in the future, you can continue to expand on this wrapper contract.

## Logging and OpenTelemetry

Combined with OpenTelemetry, `trace_id` and `span_id` can be automatically injected into the log to associate the log with link tracking:

```typescript
// src/config/production.ts
import { trace } from "@opentelemetry/api";

export default {
  logger: {
    level: "info",
    mixin() {
      const span = trace.getActiveSpan();
      if (!span?.isRecording()) return {};
      const ctx = span.spanContext();
      return {
        trace_id: ctx.traceId, // injected into the trace_id field of each log (OTEL semantic convention)
        span_id: ctx.spanId, // Inject into the span_id field of each log
      };
    },
  },
};
```

**How it works**:

- `mixin()` is called before each log is written, and the return value will be merged and injected with the framework's built-in fields
- `requestId` is a framework protected field and cannot be overridden by user mixin; `trace_id` / `span_id` and other fields are given priority by user mixin
- When `mixin` is not configured, user mixin calls will not be executed and the default request field injection behavior remains unchanged
- The framework does not depend on `@opentelemetry/api`, which is introduced by the user during tracing initialization

**Relationship with F-03 (ALS automatic injection)**: If you write `traceId` / `spanId` to `requestContext` in the tracing middleware, the framework's built-in mixin will automatically inject it into the log - no need to configure the `mixin` option. The `mixin` configuration is suitable for scenarios where the currently active Span needs to be read directly from the OTEL Context API in real time.

For details, see the log correlation chapter in [OpenTelemetry Access Example](/examples/opentelemetry).

## VextLogger interface

```typescript
interface VextLogger {
  trace(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
  getLevel():
    | "trace"
    | "debug"
    | "info"
    | "warn"
    | "error"
    | "fatal"
    | "silent";
  setLevel(
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent",
  ): void;
  child(bindings: Record<string, unknown>): VextLogger;
}
```

`VextLogger` is the logging interface exposed by the framework. You can use this interface in type declarations:

```typescript
import type { VextLogger } from "vextjs";

class PaymentService {
  private logger: VextLogger;

  constructor(app: VextApp) {
    this.logger = app.logger.child({ service: "PaymentService" });
  }
}
```

## Differences in abilities from Pino

The goal of Vext's built-in logger is to override a stable subset of the framework's default logging requirements and remove the logger runtime dependency from the default installation path. It is not a complete compatibility layer for Pino, nor does it move all Pino extension points into the core.

| Pino capabilities                  | Vext current status                                                                             | Recommended expansion paths                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `logger.trace()` public method     | Supported                                                                                       | N/A                                                                                     |
| Modify the log level at runtime    | `getLevel()` / `setLevel()` is supported; the writable `logger.level` property is not supported | If sampling/complex strategies are required, the `app.setLogger()` wrapper is available |
| custom levels / level formatter    | Custom levels or renamed `level` fields are not supported                                       | External logging system side mapping numeric level                                      |
| `redact` path desensitization      | Exact key/path subset is supported                                                              | wildcard/remove/censor function can be processed on the wrapper/Agent side              |
| serializers/stdSerializers         | Only built-in Error and JSON-safe serialization                                                 | Business field preprocessing or processing in wrapper                                   |
| `messageKey` / `errorKey`          | Fixed use of `msg` / `err` semantics                                                            | Log collection side mapping field                                                       |
| `transport` / multistream / file   | No built-in worker transport, multi-target or file writing                                      | stdout → Agent/platform collection, or `app.setLogger()` bridge                         |
| pino-pretty complete options       | Only supports built-in pretty, `prettyColor`, `prettyIgnore`, `prettySingleLine`                | External formatter or custom wrapper can be connected during development                |
| browser API                        | Browser logger is not supported                                                                 | Vext is a Node.js server-side framework, an alternative on the browser side             |
| `hooks.logMethod` / merge strategy | Unexposed log call hook or mixin merge strategy                                                 | Use `app.setLogger()` to wrap the exposed method                                        |

These gaps do not affect the Vext default framework log, access log, requestId/trace field injection, child logger, Error serialization, and stdout-first collection. If official OTel Logs, Sentry, Loki/ELK plug-ins are needed in the future, priority should be based on `app.setLogger()` and external Agent extensions, rather than building the transport system back into the core.

## Configuration reference

| Configuration item        | Type       | Default value               | Description                                                                                                                                       |
| ------------------------- | ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logger.level`            | `string`   | `'info'`                    | Log thresholds: `'trace'` / `'debug'` / `'info'` / `'warn'` / `'error'` / `'fatal'` / `'silent'`                                                  |
| `logger.lifecycleLevel`   | `string`   | `'concise'`                 | Framework lifecycle log verbosity level: `'concise'` / `'verbose'`                                                                                |
| `logger.pretty`           | `boolean`  | `NODE_ENV !== 'production'` | Whether to use the built-in pretty formatter to output a readable format                                                                          |
| `logger.prettyColor`      | `string`   | `'auto'`                    | Whether to add ANSI to the level label in pretty mode: `'auto'` / `'always'` / `'never'`                                                          |
| `logger.prettyIgnore`     | `string`   | `'pid,hostname,requestId'`  | Fields to ignore in pretty mode (comma separated). Hide `requestId` by default to avoid multi-line noise, production JSON output is not affected  |
| `logger.prettySingleLine` | `boolean`  | `true`                      | Whether to compress extra fields in the same line of the message as JSON inline in pretty mode. Set to `false` to use multi-line expansion format |
| `logger.redactKeys`       | `string[]` | `[]`                        | Desensitize structured log fields by exact key at any level                                                                                       |
| `logger.redactPaths`      | `string[]` | `[]`                        | Desensitize structured log fields by dot notation exact path                                                                                      |
| `logger.redactValue`      | `string`   | `'[Redacted]''              | Desensitized replacement value                                                                                                                    |
| `logger.mixin`            | `function` | `undefined`                 | Synchronously return custom structured fields; `requestId` cannot be overridden, `trace_id` / `span_id` can be overridden by user fields          |

## Best Practices

### 1. Use structured fields instead of string concatenation

```typescript
// ✅ Structured fields — indexable, filterable
app.logger.info({ userId, action: "login", ip: req.ip }, "user login");

// ❌ String concatenation — difficult to parse and filter
app.logger.info(`User ${userId} logged in from ${req.ip}`);
```

### 2. Create Child Logger for each Service

```typescript
// ✅ Recommended — the log automatically carries the service logo
this.logger = app.logger.child({ service: 'OrderService' });

// ❌ Avoid — each log must be manually added with service
app.logger.info({ service: 'OrderService', ... }, 'xxx');
```

### 3. Do not output sensitive information in the log

```typescript
// ✅ SAFE
app.logger.info(
  { userId, action: "password_change" },
  "Password has been changed",
);

// ❌ DANGER — password leaked to logs
app.logger.info({ userId, newPassword }, "Password has been changed");

// ❌ Danger — token leaks to logs
app.logger.debug(
  { token: req.headers.authorization },
  "Authentication information",
);
```

### 4. Use log levels appropriately

```typescript
//debug — Detailed debugging information (not output in production environment)
app.logger.debug({ sql: query, params }, "Execute database query");

// info — important business events
app.logger.info({ orderId, total }, "Order created successfully");

// warn — requires attention but does not affect operation
app.logger.warn({ retryCount: 3, url }, "Request retry");

// error — something went wrong
app.logger.error({ err, orderId }, "Payment processing failed");

// fatal — the application cannot continue to run
app.logger.fatal(
  { err },
  "The database connection is disconnected and cannot be restored",
);
```

### 5. Use JSON format in production environment

JSON logs are the standard input format for log collection systems (ELK, Loki, Datadog, etc.). Ensure production environment `pretty: false` (default behavior).

## Next step

- Understand the log collection solutions in [Deployment and Production Environment](/guide/deployment)
- View [OpenTelemetry Access](/examples/opentelemetry) to associate logs with link tracking
- Learn how [middleware](/guide/middleware) generates logs during the request life cycle
- Explore the environment configuration override mechanism in [Configuration](/guide/configuration)

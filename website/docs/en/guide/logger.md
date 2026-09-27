# Logger

Use `app.logger` for structured business logs, child loggers for Service identity and request IDs for correlation. The built-in implementation supports JSON and pretty output, six log methods, a runtime threshold, Error serialization and optional field redaction without a third-party logging package in its default kernel.

Complete the request flow below first, then choose formatting and collection as needed. Later API snippets belong in a route or plugin that already has `app: VextApp`. Merge config fragments with your existing config rather than replacing the whole file each time.

## Basic usage

Prerequisite: the TypeScript API-only project from [Quick Start](/guide/quick-start). Keep its package.json, tsconfig.json and scripts, merge this config and add a Service and route:

```typescript
// src/config/default.ts
export default {
  host: "127.0.0.1",
  port: 3000,
  frontend: { enabled: false },
  logger: { level: "debug", pretty: false },
};
```

```typescript
// src/services/log-demo.ts
import type { VextApp, VextRuntimeLogger } from "vextjs";

export default class LogDemoService {
  private readonly logger: VextRuntimeLogger;

  constructor(app: VextApp) {
    this.logger = app.logger.child({ service: "LogDemoService" });
  }

  list() {
    this.logger.debug({ count: 2 }, "query started");
    const users = [{ id: "u-1" }, { id: "u-2" }];
    this.logger.info({ count: users.length }, "query completed");
    return users;
  }
}
```

```typescript
// src/routes/log-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/users", async (req, res) => {
    app.logger.trace("hidden at debug threshold");
    res.json(app.services.logDemo.list());
  });
  app.get("/error", async (_req, res) => {
    const err = new Error("demonstration error");
    app.logger.error({ err, operation: "demo" }, "caught example");
    // Logging does not set an HTTP status or throw an exception.
    res.json({ logged: true });
  });
});
```

Run `npm run dev`, then request these URLs in another terminal:

```bash
curl -H "x-request-id: log-demo-1" http://127.0.0.1:3000/log-demo/users
curl -H "x-request-id: log-demo-2" http://127.0.0.1:3000/log-demo/error
```

Use `curl.exe` in Windows PowerShell. The first request returns 200 and two users; JSON logs include levels 20/30, `service=LogDemoService` and `requestId=log-demo-1`. Trace is filtered by the debug threshold. The second returns 200 with `data.logged: true` and logs level 50, `requestId=log-demo-2`, and the Error's type/message/name/stack.

Stop dev, run `npm run build` and `npm start`, repeat both requests, then stop with Ctrl+C. Change the config level to info and restart: debug should disappear while info/error remain. Set `pretty: false` explicitly for production; application JSON logs and CLI startup notices may share one stream and need separating during collection.

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
    level: "debug", // Outputs debug and above; trace remains filtered.
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

After setting a certain level, **logs lower than this level will not be output**. For example, with `level: 'info'`, `debug()` calls are filtered by the logger threshold and produce no log record.

### Adjust log level at runtime

The default logger supports adjusting subsequent log thresholds at runtime, which is suitable for online temporary troubleshooting:

```typescript
app.logger.getLevel(); // "debug" in this page's complete example.
app.logger.setLevel("debug");
app.logger.debug({ orderId: "order-demo" }, "debug detail");
app.logger.setLevel("warn");
```

- `setLevel()` only affects subsequent logs and does not review historical logs.
- The created child logger shares the current runtime level with the parent logger.
- `app.logger.level = "debug"` is not supported for this writable property compatibility; please use `setLevel()`.
- Use supported levels; invalid values are outside the public contract.
- `fatal()` only records level 60; it does not itself exit the process or perform graceful shutdown.

## Lifecycle log levels

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

These are Bash forms. In PowerShell, set `$env:VEXT_LIFECYCLE_LEVEL="verbose"` before `npm start` and remove the temporary variable afterward. CLI `--verbose` also enables detail. Lifecycle verbosity is separate from the business log threshold. Some CLI startup notices use a separate output path and are not guaranteed to obey `logger.level`.

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

Without an explicit pretty override, production (`NODE_ENV=production`) uses JSON. These are two JSON Lines with pid/hostname omitted, not one JSON document containing both objects:

```jsonl
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

> **Note**: `requestId` is included in the pretty formatter's default ignore list, so pretty mode hides it. A request-scoped JSON log still contains it when context is active. Remove it from `prettyIgnore` to show it in pretty output.

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
    prettyIgnore: "pid,hostname,requestId,trace_id,span_id",
  },
};
```

> `prettyIgnore` controls only the display of extra pretty fields. It does not change JSON. JSON includes fields actually produced by that call, subject to level and redaction rules; a log outside request scope may have no requestId.

## Log field redaction

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
- Redaction occurs before pretty/JSON output, making both formats consistent.
- Redaction does not modify the original object passed in by the caller.
- The top level `level` is the log protocol field and will not be overwritten by redaction.
- No support for wildcard, glob, regex, bracket notation, remove or function censor.
- Redaction does not scan passwords or tokens inside a message string. Content embedded in `msg` or `err.message` is hidden only when that entire field is configured for replacement. `prettyIgnore` is display filtering, not redaction.

### Custom Pretty output {#custom-pretty-output}

The default logger has no `messageFormat` template option. Prefer `prettySingleLine`, `prettyIgnore` and `prettyColor`. For completely custom formatting or forwarding, use the `setLogger` wrapper below.

Calling `original` retains the default output path. Returning custom `info` or `error` methods alone does not automatically apply the default serializer, threshold or redaction. A wrapper must decide which behavior to delegate to `original`.

## requestId automatic injection

The default logger associates an ID when request context is enabled and the current chain has a nonempty requestId. Startup logs, independent tasks and logs after request context is disabled are not guaranteed to have one. Pretty output hides it by default.

### Working principle

```text
Inbound request → requestId middleware → requestContext (AsyncLocalStorage)
                                              ↓
app.logger.info("processing") ← logger mixin reads requestId
                                              ↓
Output: {"requestId":"abc-123","msg":"processing"}
```

After threshold filtering, the default logger reads current context and merges user mixin and call fields. Handlers, middleware and Services share the ID while still in that request chain.

Field merge order is child bindings → context fields → user mixin → per-call object; ordinary duplicate fields use the later value. Structured objects cannot override the top-level protocol fields level/time/msg. Special requestId protection prevents **mixin** spoofing only: a per-call object can still replace requestId, and child bindings can retain it when ALS is absent. Avoid conflicting manual IDs; see [Request Context](/guide/request-context).

### Performance

Below-threshold default calls skip serialization and mixin, though JavaScript still evaluates argument expressions before the call. User mixins must be synchronous and inexpensive. A returned Promise or thrown error is ignored, with at most one attempted warning that still depends on the log threshold.

With `requestContext.enabled: false`, the default logger skips ALS reads. If ordinary `getStore()` is undefined, context fields are omitted; a background task within a manual `run` may still retain context fields.

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

The complete `LogDemoService` above shows this pattern: bind only the static Service name in the constructor. When a method runs, the logger reads the current request context; do not cache one request's store in a Service field.

Top-level bindings are independent across child loggers. A nested child wins on a duplicate top-level binding, although nested object values may still share references. Runtime level control is shared. A logger reference saved before a wrapper is installed does not automatically become wrapped; install the wrapper during plugin setup before Services load.

### Nested Child Logger

Child loggers can be created nested, and fields will accumulate:

```typescript
const dbLogger = app.logger.child({ module: "database" });
const queryLogger = dbLogger.child({ collection: "users" });

queryLogger.debug("Execute query");
// Output: {"module":"database","collection":"users","msg":"Execute query"}
```

## Error log

### Log an Error object

Pass an Error directly to `error`/`fatal` or as a structured field. Built-in serialization keeps type, message, name and stack; arbitrary custom properties and cause chains are not fully expanded automatically.

```typescript
const err = new Error("example failure");
app.logger.error(err, "Operation failed");
app.logger.error({ err, operation: "demo" }, "Operation failed");
```

Ordinary BigInt becomes a string and circular references become `[Circular]`. Undefined, functions and symbols are omitted from objects and become null in arrays. Dates become ISO strings. This is a log serializer, not a complete storage format for arbitrary business objects.

### Log error context

The caller supplies the app and an implemented payment function. Logging does not swallow payment errors:

```typescript
import type { VextApp } from "vextjs";

export async function processPayment(
  app: VextApp,
  charge: (amount: number) => Promise<{ id: string }>,
  orderId: string,
  amount: number,
) {
  try {
    const result = await charge(amount);
    app.logger.info(
      { orderId, amount, chargeId: result.id },
      "Payment succeeded",
    );
    return result;
  } catch (err) {
    app.logger.error({ err, orderId, amount }, "Payment failed");
    throw err;
  }
}
```

## Extended Logger: setLogger()

Call `app.setLogger(wrapper)` during plugin setup to wrap the current app logger. A wrapper may return only selected methods; missing methods fall back to the original. Repeated calls wrap the preceding result in order.

### Signature

```typescript
import type { VextApp } from "vextjs";

type SetLogger = VextApp["setLogger"];
// (wrapper: (original: VextRuntimeLogger) => VextLoggerLike) => void
```

The wrapper factory must synchronously return a plain object whose provided log members are functions. If the factory throws or returns an invalid result, installation fails. **Exceptions thrown by log methods themselves propagate to callers**; the framework does not catch them automatically.

### Complete wrapper example

Add this plugin to the complete project above, restart and request both routes again. It needs no external SDK. It supplies only `info` and omits `child`, so the framework reapplies the factory to new child loggers:

```typescript
// src/plugins/logger-bridge.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "logger-bridge",
  setup(app) {
    let calls = 0;
    app.setLogger((original) => ({
      info(...args: unknown[]) {
        calls++;
        (original.info as (...values: unknown[]) => void)(...args);
      },
    }));
    app.onClose(() => {
      app.logger.info({ bridgeInfoCalls: calls }, "logger bridge closing");
    });
  },
});
```

Business info logs should still contain LogDemoService and the request ID; unchanged debug/error methods still output. On shutdown, inspect `bridgeInfoCalls`. This count includes framework info calls passing through the wrapper; it is not an HTTP request count.

### Child fallback and bridging

When `child` is omitted, setLogger runs its factory again for the original child, retaining bindings and wrapping it. The factory may therefore run many times; do not open connections or register duplicate close hooks in it.

Returning `child: bindings => original.child(bindings)` explicitly yields an unbridged child. Wrap that child if a custom child method is necessary. If a child factory fails, normalization may fall back to the original child; that tolerance does not apply to ordinary info/error methods.

### Bridging OpenTelemetry Logs

Initialization, endpoint, credentials, async queues and flushing belong to the external SDK integration. Prepare the environment with the [OpenTelemetry example](/examples/opentelemetry), then implement forwarding in your wrapper. Merely calling setLogger does not start a Collector or report logs.

If forwarding happens before `original` handles a call, it receives raw arguments; the default logger's threshold, redaction and formatting do not automatically apply to the SDK. Handle forwarding errors, filtering and field policy. Async writing must not leave unhandled Promise rejections in synchronous log methods. Close and flush the SDK through `app.onClose`; default logger shutdown does not flush it.

## Log storage and collection

The default logger writes **all levels**, including error and fatal, to stdout. Process failures, CLI or other libraries may write stderr. Process managers normally collect streams, so an stderr file is not an "all error-level logs" file. Collection options below require their own installed components, permissions and network. Verify persistence, rotation and remote delivery in the actual deployment; VextJS does not guarantee them.

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

```text
project/
├── logs/                 # Exclude in .gitignore
│   ├── app.log           # Current application stdout
│   ├── app.1.log         # Rotated history
│   ├── app.2.log
│   ├── stderr.log        # stderr stream, not every error-level log
│   └── access.log        # Only if collection routes access logs separately
├── src/
└── dist/
```

Keep `logs/` out of version control.

### Solution 1: stdout → Cloud native

VextJS outputs logs. Persistence and search depend on platform logging configuration:

| Platform             | Prerequisite                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes           | Runtime captures output; configure cluster storage/search separately, see [logging architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/)       |
| AWS ECS              | Configure awslogs or another task driver with permissions, see [ECS CloudWatch integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html) |
| Google Cloud Run     | Container output can reach Cloud Logging; see [Cloud Run logs](https://docs.cloud.google.com/run/docs/logging)                                                              |
| Azure Container Apps | Configure the environment's log destination and inspect console logs; see [application logs](https://learn.microsoft.com/en-us/azure/container-apps/logging)                |

Send a request with a known requestId and find its business log on the target platform. Local stdout alone does not prove remote collection.

### Solution 2: PM2/systemd file collection

These are Linux fragments. Install the chosen process manager, build the project and ensure directories exist with write permissions. Adjust paths for PM2 on Windows; systemd does not apply there.

#### PM2 example

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "myapp",
      cwd: "/srv/myapp",
      script: "node_modules/vextjs/dist/cli/index.js",
      args: "start",
      error_file: "/var/log/myapp/stderr.log",
      out_file: "/var/log/myapp/app.log",
      env: { NODE_ENV: "production" },
      merge_logs: true,
    },
  ],
};
```

PM2 out_file/error_file split stdout and stderr. Do not add a `log_date_format` or time prefix to JSON lines; see [PM2 log management](https://pm2.keymetrics.io/docs/usage/log-management/).

#### systemd example

```ini
# /etc/systemd/system/myapp.service
[Service]
ExecStart=/usr/bin/node /srv/myapp/node_modules/vextjs/dist/cli/index.js start
WorkingDirectory=/srv/myapp
Environment=NODE_ENV=production
StandardOutput=append:/var/log/myapp/app.log
StandardError=append:/var/log/myapp/stderr.log
Restart=always
```

Use a systemd version supporting append output. Adjust Node path, service account and directory permissions. This is only the Service fragment, not complete installation. See the [systemd source documentation](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml). After startup, send this page's requests and confirm business JSON in app.log, manager status and stderr.

---

### Solution 3: System-level logrotate (Linux)

If logrotate is installed and invoked by a scheduler, it can rotate files. `copytruncate` suits writers that cannot be coordinated to reopen files, but writes between copy and truncation can be lost. It is not a lossless guarantee; see the [logrotate manual](https://github.com/logrotate/logrotate/blob/main/logrotate.8.in):

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

| Options         | Description                                           |
| --------------- | ----------------------------------------------------- |
| `daily`         | Rotate every day                                      |
| `rotate 30`     | Keep 30 historical files                              |
| `compress`      | History file gzip compression                         |
| `delaycompress` | The most recent file is not compressed (easy to view) |
| `copytruncate`  | Copy then truncate; concurrent writes may be lost     |

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

The old `type: log` input was deprecated in Filebeat 7.16 and disabled in 9.0; see the [official migration note](https://www.elastic.co/docs/reference/beats/filebeat/filebeat-input-log). Use filestream with an ndjson parser. This is only an input fragment to merge into an existing Filebeat config; set output address, authentication, TLS and index/data-stream policy for your environment.

```yaml
# Merge into /etc/filebeat/filebeat.yml
filebeat.inputs:
  - type: filestream
    id: myapp-json
    enabled: true
    paths:
      - /var/log/myapp/app.log
    parsers:
      - ndjson:
          target: vext
          add_error_key: true
    fields:
      app: myapp
      env: production
```

`target: vext` separates application fields from collector metadata. The parser expects one JSON object per line. CLI text produces a parse error; container-wrapped logs may need their outer envelope parsed first. See [filestream parsers](https://www.elastic.co/docs/reference/beats/filebeat/filebeat-input-filestream).

Run Filebeat's own `test config` and `test output`, then send a request from this page and confirm `vext.requestId` and `vext.level` appear in the actual index. Passing config checks does not establish successful indexing. Configure rotated-file matching and deduplication for the collector version.

#### Kibana Data View

Create a [Data View](https://www.elastic.co/docs/explore-analyze/find-and-organize/data-views/create-data-view) for the index or data stream actually written. Choose a time field matching its mapping. Vext's `time` is an ISO string; map it to Elasticsearch date before selecting it as the time field. Filebeat reception time is not automatically business event time.

With the `vext` target above, query `vext.requestId: "log-demo-1"`, `vext.level >= 50` or `vext.service: "LogDemoService"`. Change queries if you choose another target or mapping.

---

### Option 5: Docker → Loki

Install the Loki driver on the Docker host and provide a Loki address reachable by the host/driver before configuring the service. The Compose service name `loki` is not guaranteed to resolve from the driver's network. This `127.0.0.1:3100` example assumes the port is published on the Docker host. See the [driver configuration](https://grafana.com/docs/loki/latest/send-data/docker-driver/configuration/).

```yaml
# docker-compose.yml
services:
  app:
    build: .
    logging:
      driver: loki
      options:
        loki-url: "http://127.0.0.1:3100/loki/api/v1/push"
        loki-batch-size: "400000"
        loki-retries: "3"
        loki-external-labels: "app=myapp,env=production"
```

Check Compose config before deployment and driver send errors and Loki receipt afterward. Then query from Grafana with a configured Loki data source. Batch size is in bytes; finite retries do not guarantee delivery:

- Query by requestId: `{app="myapp"} |= "abc-123"`
- Filter by JSON field: `{app="myapp"} | json | level >= 50`

---

### Solution six: app.setLogger bridges external SDK

Reuse the wrapper pattern above. The SDK writer is an application-provided dependency: create it once during plugin setup and close it in `app.onClose`; the wrapper factory only binds methods. Verify default stdout first, then the SDK's success/failure behavior, child loggers, filtering, redaction and queue flush on shutdown.

This page does not supply an individual cloud SDK's installation or credentials. Follow that integration's documentation. Undefined `cloudLogger` or `Sentry` objects are not built-in VextJS features.

## Logging and OpenTelemetry

With a configured tracing SDK, a synchronous mixin can read the current active span. Alternatively, put fields in request context within the correct request chain; see [Request Context](/guide/request-context).

This typed config factory receives `readActiveSpan` from an already initialized SDK adapter. It only creates logger config; it does not create a tracing SDK or span:

```typescript
import type { VextLoggerConfig } from "vextjs";

export function tracingLoggerConfig(
  readActiveSpan: () => { traceId: string; spanId: string } | undefined,
): VextLoggerConfig {
  return {
    level: "info",
    pretty: false,
    mixin() {
      const span = readActiveSpan();
      return span ? { trace_id: span.traceId, span_id: span.spanId } : {};
    },
  };
}
```

Merge the return value into `config.logger`. The SDK adapter decides whether unsampled traces still need log correlation; `isRecording` need not be the sole condition. A mixin may override ALS trace_id/span_id but not requestId; per-call fields have higher priority. See the [OpenTelemetry example](/examples/opentelemetry) for complete SDK setup.

## VextLogger interface

Import the public types from `vextjs` rather than copying a potentially stale interface:

| Type                | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `VextLogger`        | Base plugin-compatible interface; trace/getLevel/setLevel optional, child returns VextLogger            |
| `VextRuntimeLogger` | Complete `app.logger` interface; those three methods required, child returns complete runtime interface |
| `VextLoggerLike`    | Partial result of a setLogger factory, equivalent to `Partial<VextLogger>`                              |
| `VextLoggerConfig`  | Logger configuration fields                                                                             |

The complete `LogDemoService` above shows type usage. Public `app.logger` has no writable level property or public flush/close method. App lifecycle manages default kernel shutdown; external SDK resources still need plugin close hooks.

## Differences in abilities from Pino

The goal of Vext's built-in logger is to override a stable subset of the framework's default logging requirements and remove the logger runtime dependency from the default installation path. It is not a complete compatibility layer for Pino, nor does it move all Pino extension points into the core.

| Pino capabilities                  | Vext current status                                                                             | Recommended expansion paths                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `logger.trace()` public method     | Supported                                                                                       | N/A                                                                                     |
| Modify the log level at runtime    | `getLevel()` / `setLevel()` is supported; the writable `logger.level` property is not supported | If sampling/complex strategies are required, the `app.setLogger()` wrapper is available |
| custom levels / level formatter    | Custom levels or renamed `level` fields are not supported                                       | External logging system side mapping numeric level                                      |
| `redact` path redaction            | Exact key/path subset is supported                                                              | wildcard/remove/censor function can be processed on the wrapper/Agent side              |
| serializers/stdSerializers         | Only built-in Error and JSON-safe serialization                                                 | Business field preprocessing or processing in wrapper                                   |
| `messageKey` / `errorKey`          | Fixed use of `msg` / `err` semantics                                                            | Log collection side mapping field                                                       |
| `transport` / multistream / file   | No built-in worker transport, multi-target or file writing                                      | stdout → Agent/platform collection, or `app.setLogger()` bridge                         |
| pino-pretty complete options       | Only supports built-in pretty, `prettyColor`, `prettyIgnore`, `prettySingleLine`                | External formatter or custom wrapper can be connected during development                |
| browser API                        | Browser logger is not supported                                                                 | Vext is a Node.js server-side framework, an alternative on the browser side             |
| `hooks.logMethod` / merge strategy | Unexposed log call hook or mixin merge strategy                                                 | Use `app.setLogger()` to wrap the exposed method                                        |

This comparison defines Vext's current boundary; consult [Pino's official API](https://github.com/pinojs/pino/blob/main/docs/api.md) for its full options. For additional transports or formatting, integrate through a wrapper or collector and verify that external path separately.

## Configuration reference

| Configuration item        | Type       | Default value               | Description                                                                                                                                           |
| ------------------------- | ---------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logger.level`            | `string`   | `'info'`                    | Log thresholds: `'trace'` / `'debug'` / `'info'` / `'warn'` / `'error'` / `'fatal'` / `'silent'`                                                      |
| `logger.lifecycleLevel`   | `string`   | `'concise'`                 | Framework lifecycle log verbosity level: `'concise'` / `'verbose'`                                                                                    |
| `logger.pretty`           | `boolean`  | `NODE_ENV !== 'production'` | Whether to use the built-in pretty formatter to output a readable format                                                                              |
| `logger.prettyColor`      | `string`   | `'auto'`                    | Whether to add ANSI to the level label in pretty mode: `'auto'` / `'always'` / `'never'`                                                              |
| `logger.prettyIgnore`     | `string`   | `'pid,hostname,requestId'`  | Fields to ignore in pretty mode (comma separated). Hide `requestId` by default to avoid multi-line noise, production JSON output is not affected      |
| `logger.prettySingleLine` | `boolean`  | `true`                      | Whether to compress extra fields in the same line of the message as JSON inline in pretty mode. Set to `false` to use multi-line expansion format     |
| `logger.redactKeys`       | `string[]` | `[]`                        | Desensitize structured log fields by exact key at any level                                                                                           |
| `logger.redactPaths`      | `string[]` | `[]`                        | Desensitize structured log fields by dot notation exact path                                                                                          |
| `logger.redactValue`      | `string`   | `'[Redacted]'`              | Desensitized replacement value                                                                                                                        |
| `logger.mixin`            | `function` | `undefined`                 | Synchronously return custom fields; the mixin cannot override `requestId`, but a per-call object can; user fields can override `trace_id` / `span_id` |

## Best Practices

### 1. Use structured fields instead of string concatenation

For example, `app.logger.info({ userId: "u-1", action: "login" }, "User logged in")` keeps fields queryable. Put an Error in `err` rather than losing its stack in a concatenated message.

### 2. Create a child logger for each Service

As shown above, bind the static Service name in its constructor and pass business fields at call time. Read runtime context on each call rather than binding one request's identity to a long-lived logger.

### 3. Handle sensitive data according to project policy

Choose logged fields under your project's data policy. If redaction is required, configure it explicitly and verify JSON, pretty and external bridge outputs. Built-in redaction is off by default; field names are not automatically hidden.

### 4. Choose levels intentionally

Whether debug is emitted depends on the current threshold; it can also be enabled explicitly in production. Neither error nor fatal automatically throws or exits. Use the appropriate business or lifecycle mechanism when a request or process must change state.

### 5. Use JSON in production

Set `pretty: false` explicitly and parse JSON at the collector. Do not prefix JSON lines with another timestamp. CLI notices and third-party stdout may not be JSON; use a separate parser or retain parse-error events.

## Common questions

| Symptom                            | Check                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| debug/trace missing                | Current `getLevel()` threshold; debug does not include trace and children share the threshold |
| requestId invisible                | `prettyIgnore`, context enablement and call chain; check per-call overrides                   |
| error.log lacks `app.logger.error` | All default levels go to stdout; stderr files are not split by numeric level                  |
| Child not forwarded after wrapping | Whether `original.child` was returned explicitly or a pre-install logger was cached           |
| Logging method fails a request     | Whether wrapper/SDK threw; normal log methods have no universal error isolation               |
| Filebeat cannot parse JSON         | pretty mode, PM2 timestamp prefix, CLI text, container envelope, input type and parser        |
| trace_id without a trace           | Log correlation does not prove the SDK sampled, created a span or exported successfully       |

## Next step

- [Request Context](/guide/request-context): identify sources of IDs, locale and trace fields.
- [Access Log API](/api/access-log): configure HTTP request access logs.
- [Deployment](/guide/deployment): choose runtime and collection paths.
- [OpenTelemetry](/examples/opentelemetry): prepare an SDK and Collector.
- [Configuration](/guide/configuration): understand profile overrides and validation.

# Access Log middleware

Access Log uses `app.logger` to record the method, path, status, downstream processing time, and client IP for requests that reach the middleware. This page covers the seven `config.accessLog` fields and their boundaries. For business logs, see the [Logger Guide](/guide/logger).

## Basic behavior

Production and development bootstrap register it by default, without `app.use()`. A request that is not excluded and whose `await next()` returns normally produces a line such as:

```
[17:53:26.174] INFO: GET /api/users 200 3ms | 127.0.0.1
```

The recording scope matters:

- Earlier middleware such as CORS, body parsing, and rate limiting may return or throw before the request reaches Access Log.
- If downstream execution throws through Access Log's `await next()`, this access line is not produced. Inspect [Error Handling](/guide/error-handling) logs too. A 5xx response that returns normally follows the level-promotion rules below.
- Timing starts when Access Log runs and ends when downstream middleware returns normally. It excludes earlier processing and does not mean the client received an entire streamed response.
- The path is `req.path` without query string. IP is `req.ip`, affected by adapter and `trustProxy`; it is not an identity credential.

## Log format

Access Log uses **compact single-line format** and presents different output styles in development and production environments:

### Development mode (Pretty)

When `logger.pretty` is `true` (the default value in the development environment), the built-in pretty formatter will output a readable format; if `logger.prettyColor` is parsed to enabled, only the level label will be colored:

```
[17:53:26.174] INFO: GET / 200 1ms | 127.0.0.1
[17:53:26.891] INFO: POST /api/users 201 45ms | 127.0.0.1
[17:53:27.003] INFO: GET /api/users/123 404 2ms | 192.168.1.10
[17:53:28.120] ERROR: DELETE /api/users/456 500 312ms | 10.0.0.5
```

The log message itself is always a compact single line of text in the format:

```
METHOD PATH STATUS TIMEms | IP
```

### Production Mode (JSON)

When `logger.pretty` is `false` (production default), Vext logger outputs structured JSON. The examples omit `pid` and `hostname`. `req-1` and `req-2` are supplied request IDs; the built-in default generator uses UUIDs:

```json
{"level":30,"time":"2026-03-06T09:33:26.174Z","requestId":"req-1","msg":"GET / 200 1ms | 127.0.0.1"}
{"level":30,"time":"2026-03-06T09:33:26.891Z","requestId":"req-2","msg":"POST /api/users 201 45ms | 127.0.0.1"}
```

Each log is a complete line of JSON object, which is easy to parse by log collection systems such as ELK and Loki.

> **Note:** The built-in logger reads requestId from AsyncLocalStorage through its context provider. No user `logger.mixin` config is required. Logger thresholds and output formatting still apply.

## requestId automatic injection

### Working principle

With request context and requestId enabled, the adapter creates an AsyncLocalStorage scope, requestId middleware writes an accepted or generated ID to it, and the built-in logger reads it. No automatic field is promised when requestContext/requestId is disabled or logging occurs outside a request scope. Pretty output hides requestId by default; JSON exposes it.

```
Request entry
  ↓
requestId middleware: accept a valid header or generate UUID, then store it in scope
  ↓
... other middleware ...
  ↓
access-log middleware: call logger.info("GET / 200 1ms | 127.0.0.1")
  ↓
logger context provider: read requestId from AsyncLocalStorage into the log object
  ↓
Output: {"level":30,"requestId":"req-1","msg":"GET / 200 1ms | 127.0.0.1"}
```

### Cross-service tracking

The default incoming header is `x-request-id`. A nonempty value takes precedence; otherwise the plugin-registered generator, configured `generate()`, or default `crypto.randomUUID()` provides one. The response includes the ID. It must be a 1–512 character string without control characters; invalid values throw. Header names are configurable.

Outbound propagation belongs to [app.fetch](/guide/fetch). This correlates request IDs but is not a complete distributed trace. See [Request Context](/guide/request-context) for configuration and scope.

## Middleware execution location

Access Log is registered after response wrapping and enabled frontend rendering, before Session and plugin global middleware. Enabled modules change chain length, so there is no fixed position number.

```
request metadata / requestId / auth context / request hook
  → security headers / CORS / body parser / rate limit / response wrapper / frontend render
  → Access Log
  → Session / plugin global middleware / CSRF / route handling
```

Optional stages appear only when enabled; see the [Middleware Guide](/guide/middleware) for phases and short circuits. Access Log reads current status on the return path, before outer post-processing completes.

## Configuration items

Merge `config.accessLog` into the existing `src/config/default.ts`. This example selects common exclusions and a slow threshold; table defaults below describe unconfigured behavior:

```typescript
// src/config/default.ts
export default {
  accessLog: {
    // Whether to enable (default true)
    enabled: true,

    // Log level (default 'info')
    // Set to 'debug' and can be controlled uniformly through the logger.level initial threshold or app.logger.setLevel()
    level: "info",

    // List of paths to skip records (exact match)
    skipPaths: ["/health", "/ready", "/metrics"],

    // Skip the path prefix of the record (prefix matching)
    skipPathPrefixes: ["/internal"],

    // Slow request threshold (milliseconds, default 0, means not enabled)
    // A non-5xx request above this threshold is promoted to warn
    slowThreshold: 3000,

    // Whether to promote 4xx response to warn (default false)
    warnOn4xx: false,

    // Whether to record the response body size (default false)
    // Try to read accessible Content-Length, not actual transferred bytes
    logResponseSize: false,
  },
};
```

### `enabled`

| Type      | Default Value | Description                             |
| --------- | ------------- | --------------------------------------- |
| `boolean` | `true`        | Whether to enable access-log middleware |

When set to `false`, Vext does not register the built-in access-log middleware during bootstrap, so it is absent from the request middleware chain.

```typescript
// src/config/development.ts — Development environment closes access log to reduce noise
export default {
  accessLog: { enabled: false },
};
```

### `level`

| type     | default value | optional value        | description      |
| -------- | ------------- | --------------------- | ---------------- |
| `string` | `'info'`      | `'info'` \| `'debug'` | Log output level |

With `'debug'`, control ordinary access logs through `logger.level` or runtime `app.logger.setLevel()`. Recorded 5xx uses error, non-5xx slow requests use warn, and other 4xx uses warn only with `warnOn4xx: true`. Logger thresholds still filter all levels; `silent` suppresses all output.

### `skipPaths`

| Type       | Default Value | Description                                  |
| ---------- | ------------- | -------------------------------------------- |
| `string[]` | `[]`          | List of paths that do not record access logs |

Internally uses `Set` to implement O(1) exact search.

Matching is case-sensitive against `req.path`, without query strings or automatic child-path matching.

Common uses: exclude high-frequency paths such as health checks, Kubernetes probes, and Prometheus metrics:

```typescript
export default {
  accessLog: {
    skipPaths: ["/health", "/ready", "/metrics", "/favicon.ico"],
  },
};
```

### `skipPathPrefixes`

| Type       | Default Value | Description                                       |
| ---------- | ------------- | ------------------------------------------------- |
| `string[]` | `[]`          | Path prefix list that does not record access logs |

This uses case-sensitive string `startsWith()`, without glob or path-segment boundaries. `/api/internal` matches both `/api/internal/users` and `/api/internal-tools`. To exclude only one directory, combine an exact root path and a slash-terminated prefix:

```typescript
export default {
  accessLog: {
    skipPaths: ["/api/internal", "/_next"],
    skipPathPrefixes: ["/api/internal/", "/_next/"],
  },
};
```

### `slowThreshold`

| Type     | Default Value | Description                                                  |
| -------- | ------------- | ------------------------------------------------------------ |
| `number` | `0`           | Slow request threshold (milliseconds), `0` means not enabled |

For a positive threshold, a non-5xx downstream duration strictly greater than it is promoted to warn and gets `[SLOW]`; equality does not match. 5xx takes precedence as error and does not get the marker:

```
[17:53:30.500] WARN: GET /api/reports 200 5231ms | 10.0.0.1 [SLOW]
```

### `logResponseSize`

| Type      | Default Value | Description                                          |
| --------- | ------------- | ---------------------------------------------------- |
| `boolean` | `false`       | Whether to include the response body size in the log |

When enabled, log messages will append `Content-Length` after the IP (if present in the response header):

```
[17:53:26.174] INFO: GET /api/users 200 3ms | 127.0.0.1 [1.2kB]
```

The implementation probes `getHeader()` on the response or underlying `_serverResponse.getHeader()`. Native exposes the latter; other built-in adapter wrappers do not expose these read channels, so the size field is not guaranteed across adapters. Even Native needs a header at that moment. With no read channel or header, no size is appended; a parsed zero or nonpositive value shows `[-]`. Units use 1024 with one decimal above 1 kB/1 MB. This is not a network-byte counter or a complete streamed-download measure.

### `warnOn4xx`

| Type      | Default Value | Description                              |
| --------- | ------------- | ---------------------------------------- |
| `boolean` | `false`       | Whether to raise 4xx responses to `warn` |

The first matching rule determines level and marker:

| Priority | Condition                                     | Level/marker                       |
| -------- | --------------------------------------------- | ---------------------------------- |
| 1        | Status ≥ 500                                  | `error`, no `[SLOW]`               |
| 2        | Non-5xx, positive threshold, duration over it | `warn` and `[SLOW]`                |
| 3        | Other 4xx with `warnOn4xx: true`              | `warn`                             |
| 4        | Otherwise                                     | Configured `level`, default `info` |

```
[17:53:27.003] WARN: GET /api/users/999 404 2ms | 192.168.1.10
[17:53:28.120] ERROR: POST /api/payment 500 312ms | 10.0.0.5
```

Alerts can use collected levels, but also collect error-handling logs. Access Log alone misses the earlier short circuits and propagated errors described above.

## Performance optimization

Access Log middleware has made a number of performance optimizations internally:

1. **Set precomputation** — `skipPaths` is converted to `Set` during initialization, and the search complexity is O(1)
2. **Method pre-binding** — `logger.info.bind(logger)` is bound during initialization to avoid dynamic search for each request
3. **Quick skip** — Disabled middleware is not registered in normal bootstrap; excluded paths skip timing and message construction
4. **Single-line message** — Use string concatenation instead of structured objects to avoid pretty mode expanding fields into multiple lines

## TypeScript types

```typescript
interface VextAccessLogConfig {
  /** Whether to enable access-log (default true) */
  enabled?: boolean;

  /** Log output level (default 'info') */
  level?: "info" | "debug";

  /** Skip recorded path list */
  skipPaths?: string[];

  /** Skip the path prefix list of records */
  skipPathPrefixes?: string[];

  /** Slow request threshold (milliseconds, default 0, means not enabled) */
  slowThreshold?: number;

  /** Whether to promote 4xx response to warn (default false) */
  warnOn4xx?: boolean;

  /** Whether to record the response body size (default false) */
  logResponseSize?: boolean;
}
```

## Relationship with log storage

Access Log uses the unified `app.logger`. Storage requires deployment-side or plugin integration; `accessLog` alone does not create a log file or cloud connection. See the [Logger Guide](/guide/logger) for options:

- **stdout → Cloud** — cloud native logging pipeline
- **PM2 / systemd + logrotate** — drop and rotate during stand-alone deployment
- **Filebeat / Fluent Bit → ELK** — Collect JSON logs to Elasticsearch
- **Docker → Loki** — Container log driver or Agent push
- **app.setLogger bridging** — Plug-in layer is forwarded to external SDK synchronously

For a separate access-log store, filter by msg, path, or level in collection. If the app must forward synchronously, a plugin `setup()` can wrap the current logger with `app.setLogger()` while preserving level control, child loggers, and existing output semantics.

## Next step

- Understand the complete configuration and storage solution of [Log System](/guide/logger)
- See [Configuration Document](/guide/configuration) to learn about the environment coverage mechanism
- Understand [requestId and Request Context](/guide/request-context)

# Access Log middleware

VextJS has built-in Access Log middleware, which automatically records the method, path, status code, response time and client IP of each HTTP request. This middleware is based on the onion model (after-middleware mode) and outputs a compact line of access log after the request processing is completed.

## Basic behavior

Access Log middleware is enabled by default and does not require any configuration to work:

```typescript
// No need to register manually, the framework is automatically mounted
// Automatically output a line of log after each request is completed
```

After the request is completed, the terminal output is similar to:

```
[17:53:26.174] INFO: GET /api/users 200 3ms | 127.0.0.1
```

## Log format

Access Log uses **compact single-line format** and presents different output styles in development and production environments:

### Development mode (Pretty)

When `logger.pretty` is `true` (the default value in the development environment), the built-in pretty formatter will output a readable format; if `logger.prettyColor` is parsed to enabled, only the level label will be colored:

```
[17:53:26.174] INFO: GET / 200 1ms | 127.0.0.1
[17:53:26.891] INFO: POST /api/users 201 45ms | 127.0.0.1
[17:53:27.003] INFO: GET /api/users/123 404 2ms | 192.168.1.10
[17:53:28.120] INFO: DELETE /api/users/456 500 312ms | 10.0.0.5
```

The log message itself is always a compact single line of text in the format:

```
METHOD PATH STATUS TIMEMS | IP
```

### Production Schema (JSON)

When `logger.pretty` is `false` (the default value in production environments), Vext logger outputs structured JSON:

```json
{"level":30,"time":"2026-03-06T09:33:26.174Z","requestId":"req-1","msg":"GET / 200 1ms | 127.0.0.1"}
{"level":30,"time":"2026-03-06T09:33:26.891Z","requestId":"req-2","msg":"POST /api/users 201 45ms | 127.0.0.1"}
```

Each log is a complete line of JSON object, which is easy to parse by log collection systems such as ELK and Loki.

> **Note**: The `requestId` field is automatically injected by the logger mixin + AsyncLocalStorage (see below) and does not need to be passed in manually in the access-log middleware.

## requestId automatic injection

### Working principle

VextJS uses `AsyncLocalStorage` (Node.js's built-in asynchronous context propagation mechanism) to maintain an independent context for each request. The requestId middleware generates a unique ID when the request comes in and stores it in `AsyncLocalStorage`. All subsequent log output will automatically carry the ID.

```
Request entry
  ↓
requestId middleware: generate req-N and store it in AsyncLocalStorage
  ↓
... other middleware ...
  ↓
access-log middleware: call logger.info("GET / 200 1ms | 127.0.0.1")
  ↓
logger mixin: Read requestId from AsyncLocalStorage and automatically inject it into the log object
  ↓
Output: {"level":30,"requestId":"req-1","msg":"GET / 200 1ms | 127.0.0.1"}
```

### Cross-service tracking

In a microservice architecture, requestId can be passed through HTTP headers to achieve cross-service request link tracking:

```typescript
//Frame automatically handles:
// 1. If the request header contains X-Request-Id, use this value
// 2. Otherwise generate a new unique ID
// 3. The response header automatically contains X-Request-Id
```

## Middleware execution location

Access Log is located at position 6 of the built-in middleware chain (after response-wrapper), ensuring:

1. `requestId` has been generated in the previous middleware (`req.requestId` is available)
2. When the onion returns, the handler has been executed (`res.statusCode` has been determined)

```
requestId → cors → body-parser → rateLimit → response-wrapper → [access-log]
  → Plug-in global middleware → Routing-level middleware → validate → handler
```

## Configuration items

Configure via `config.accessLog`:

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
    // Requests exceeding this threshold are automatically elevated to warn level
    slowThreshold: 3000,

    // Whether to promote 4xx response to warn (default false)
    warnOn4xx: false,

    // Whether to record the response body size (default false)
    // Append Content-Length at the end of the log message after enabling it
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

After setting it to `'debug'`, you can uniformly control whether to output ordinary access logs through the `logger.level` initial threshold or runtime `app.logger.setLevel()` in the production environment. 5xx responses are always promoted to `error`; 4xx responses are only promoted to `warn` if `warnOn4xx: true`.

### `skipPaths`

| Type       | Default Value | Description                                  |
| ---------- | ------------- | -------------------------------------------- |
| `string[]` | `[]`          | List of paths that do not record access logs |

Internally uses `Set` to implement O(1) exact search.

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

Complementary to exact matching of `skipPaths`, suitable for skipping entire internal path trees:

```typescript
export default {
  accessLog: {
    skipPathPrefixes: ["/api/internal", "/_next"],
  },
};
```

### `slowThreshold`

| Type     | Default Value | Description                                                  |
| -------- | ------------- | ------------------------------------------------------------ |
| `number` | `0`           | Slow request threshold (milliseconds), `0` means not enabled |

For requests whose response time exceeds this threshold, the log level is automatically raised to `warn`, and a `[SLOW]` tag is appended to the message:

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

### `warnOn4xx`

| Type      | Default Value | Description                              |
| --------- | ------------- | ---------------------------------------- |
| `boolean` | `false`       | Whether to raise 4xx responses to `warn` |

Level mapping:

| Status code range | Log level                                                         | Description                      |
| ----------------- | ----------------------------------------------------------------- | -------------------------------- |
| 1xx / 2xx / 3xx   | Configured `level` (default `info`)                               | Normal request                   |
| 4xx               | `warn` if `warnOn4xx: true`, otherwise use the configured `level` | Client error                     |
| 5xx               | `error`                                                           | Server-side error, always raised |

```
[17:53:27.003] WARN: GET /api/users/999 404 2ms | 192.168.1.10
[17:53:28.120] ERROR: POST /api/payment 500 312ms | 10.0.0.5
```

This is very useful for alarm monitoring in production environments - you can set alarm rules for the `error` level in the logging system to automatically capture 5xx errors.

## Performance optimization

Access Log middleware has made a number of performance optimizations internally:

1. **Set precomputation** — `skipPaths` is converted to `Set` during initialization, and the search complexity is O(1)
2. **Method pre-binding** — `logger.info.bind(logger)` is bound during initialization to avoid dynamic search for each request
3. **Quick skip** — `return next()` immediately when `enabled: false`, without any additional overhead
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

The output of Access Log goes through the unified `app.logger` (Vext logger), so all the storage solutions described in [Log Document](/guide/logger) are applicable:

- **stdout → Cloud** — cloud native logging pipeline
- **PM2 / systemd + logrotate** — drop and rotate during stand-alone deployment
- **Filebeat / Fluent Bit → ELK** — Collect JSON logs to Elasticsearch
- **Docker → Loki** — Container log driver or Agent push
- **app.setLogger bridging** — Plug-in layer is forwarded to external SDK synchronously

If you need to store the access log separately in an independent file, it is recommended to filter by `msg`, path or level at the log collection layer and then divert the data. When synchronous forwarding is required within the application, `app.setLogger()` can be used to wrap the current logger.

## Next step

- Understand the complete configuration and storage solution of [Log System](/guide/logger)
- See [Configuration Document](/guide/configuration) to learn about the environment coverage mechanism
- Understand how [requestId and request context](/api/context) works

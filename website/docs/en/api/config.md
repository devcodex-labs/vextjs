# Configuration items

This page details all configuration fields, types, default values and usage instructions of VextJS.

## Configuration loading mechanism

VextJS uses a **multi-layer configuration merging** strategy, in order of priority from low to high:

```
DEFAULT_CONFIG (framework built-in default value)
  ↓ Deep merge
src/config/default.ts (project default configuration)
  ↓ Deep merge
src/config/${NODE_ENV}.ts (environment configuration, such as production.ts)
  ↓ Deep merge
src/config/local.ts (local override, optional)
  ↓ provider patch
src/config/bootstrap.ts (remote configuration during startup, optional)
  ↓ CLI override
vext start/dev --port --host ...
```

The merged configuration is deep-frozen through `deepFreeze()` and cannot be modified at runtime.

### Configuration file list

| File | Purpose | Is it necessary |
| -------------------------- | -------------------------- | :------: |
| `src/config/default.ts` | Basic configuration for all environments | ✅ |
| `src/config/development.ts` | Development environment overrides | Optional |
| `src/config/production.ts` | Production environment coverage | Optional |
| `src/config/test.ts` | Test environment coverage | Optional |
| `src/config/local.ts` | Local override (usually no Git commit) | Optional |
| `src/config/bootstrap.ts` | Startup provider registration entrance | Optional |

### `src/config/bootstrap.ts`

When the database, key or configuration center patch needs to be injected before the configuration is frozen, you can add:

```typescript
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      timeoutMs: 10_000,
      async load({ env, signal, baseConfig }) {
        const response = await fetch(`https://config.example.com/${env}.json`, {
          signal,
        });
        const remote = await response.json();
        return {
          database: remote.database,
          logger: {
            lifecycleLevel: baseConfig.logger?.lifecycleLevel ?? "concise",
          },
        };
      },
    },
  ],
});
```

Constraints:

- provider must return plain object patch or `null`
- patch only supports JSON-like structure
- When `required` is not declared: `production` defaults to fail-fast, `development/test` defaults to continue after warning
- In Cluster mode, the same provider patch will be reused in the same startup cycle to prevent Master / Worker from seeing different results.

### Configuration file example

```typescript
// src/config/default.ts
export default {
  port: 3000,
  adapter: "native",
  cors: {
    enabled: true,
    origins: ["http://localhost:3000"],
  },
  logger: {
    level: "debug",
  },
};
```

```typescript
// src/config/production.ts
export default {
  port: 8080,
  cors: {
    origins: ["https://api.example.com"],
  },
  logger: {
    level: "warn",
  },
  response: {
    hideInternalErrors: true,
  },
};
```

---

## Complete configuration reference

### `VextConfig`

| Field | Type | Default Value | Description |
|---------------- |---------------------------------------------------------------- | ----------- | ---------------------------- |
| `port` | `number` | `3000` | HTTP listening port |
| `host` | `string` | `'0.0.0.0'` | HTTP listening address |
| `adapter` | `string \| Function \| VextAdapter` | `'native'` | Low-level adapter |
| `trustProxy` | `boolean` | `false` | Whether to trust the proxy |
| `middlewares` | `VextMiddlewareConfig[]` | `[]` | Route-level middleware whitelist |
| `cors` | [`VextCorsConfig`](#vextcorsconfig) | See below | CORS configuration |
| `rateLimit` | [`VextRateLimitConfig`](#veextratelimitconfig) | See below | Rate limit configuration |
| `requestId` | [`VextRequestIdConfig`](#vextrequestidconfig) | See below | Request ID configuration |
| `logger` | [`VextLoggerConfig`](#vextloggerconfig) | See below | Log configuration |
| `shutdown` | [`VextShutdownConfig`](#vextshutdownconfig) | See below | Graceful shutdown configuration |
| `server` | [`VextServerConfig`](#vextserverconfig) | `{}` | Node.js HTTP server configuration |
| `response` | [`VextResponseConfig`](#vextresponseconfig) | See below | Response configuration |
| `bodyParser` | [`VextBodyParserConfig`](#vextbodyparserconfig) | See below | Body parsing configuration |
| `multipart` | [`VextMultipartConfig`](#vextmultipartconfig) | `undefined` | File upload configuration |
| `accessLog` | [`VextAccessLogConfig`](#vextaccesslogconfig) | See below | Access log configuration |
| `openapi` | [`VextOpenAPIConfig`](#vextopenapiconfig) | See below | OpenAPI documentation configuration |
| `requestContext` | [`VextRequestContextConfig`](#vextrequestcontextconfig) | See below | Request context configuration |
| `fetch` | [`VextFetchConfig`](#vextfetchconfig) | See below | Built-in HTTP client and proxy configuration |
| `frontend` | `boolean \| VextFrontendConfig` | `{ enabled: false }` | Built-in frontend build and static serving configuration |
| `cluster` | [`Partial<VextClusterConfig>`](#vextclusterconfig) | `undefined` | Cluster multi-process configuration |

---

### `adapter`

The underlying HTTP adapter supports three parameter passing methods:

```typescript
// Method 1: String identification (built-in adapter)
export default {
  adapter: "native", // 'native' | 'hono' | 'fastify' | 'express' | 'koa'
};

// Method 2: Factory function (pass in custom options)
import { fastifyAdapter } from "vextjs/adapters/fastify";

export default {
  adapter: fastifyAdapter({ bodyLimit: 5 * 1024 * 1024 }),
};

//Method 3: Custom adapter instance (implementing VextAdapter interface)
export default {
  adapter: myCustomAdapter,
};
```

### `trustProxy`

When set to `true`:

- `req.ip` reads the first IP from the `X-Forwarded-For` request header
- `req.protocol` is read from the `X-Forwarded-Proto` request header

This option needs to be enabled when deployed behind Nginx/cloud load balancer.

### `middlewares`

Route-level middleware whitelist declaration. Only middleware declared here can be referenced in routes `options.middlewares`.

```typescript
export default {
  middlewares: [
    { name: "auth" },
    { name: "admin", options: { role: "admin" } },
    { name: "client-cache", options: { maxAge: 60 } },
  ],
};
```

:::tip
Global middleware (such as CORS, body-parser) is automatically registered by the framework and does not need to be declared here. Only **routing-level optional middleware** is declared here.
:::

---

## VextCorsConfig

Cross-domain resource sharing configuration.| Field | Type | Default Value | Description |
| ------------- | ---------- | --------------------------------------------------------------- | ---------------------------- |
| `enabled` | `boolean` | `true` | Whether to enable CORS |
| `origins` | `string[]` | `['*']` | Allowed origin domain names |
| `methods` | `string[]` | `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']` | Allowed HTTP methods |
| `headers` | `string[]` | `['Content-Type', 'Authorization', 'X-Request-Id']` | Allowed request headers |
| `credentials` | `boolean` | `false` | Whether to allow carrying credentials |
| `maxAge` | `number` | `undefined` | CORS preflight result cache time (seconds) |

```typescript
export default {
  cors: {
    enabled: true,
    origins: ["https://app.example.com", "https://admin.example.com"],
    credentials: true,
    maxAge: 86400,
  },
};
```

:::warning
`origins: ['*']` and `credentials: true` cannot be used at the same time. When you need to carry credentials, you must specify a specific domain name.
:::

---

## VextRateLimitConfig

Global rate limit configuration, implemented based on `flex-rate-limit`.

| Field | Type | Default Value | Description |
| --------- | -------------------- | --------------------- | -------------------- |
| `enabled` | `boolean` | `true` | Whether to enable rate limiting |
| `max` | `number` | `100` | Maximum number of requests within the time window |
| `window` | `number` | `60` | Time window (seconds) |
| `message` | `string` | `'Too Many Requests'` | Overrun error message |
| `keyBy` | `string \| Function` | `'ip'` | Request source identifier |

```typescript
export default {
  rateLimit: {
    max: 200,
    window: 120,
    //Limit flow by user ID (requires auth middleware to parse the user first)
    keyBy: (req) => req.user?.id ?? req.ip,
  },
};
```

### `keyBy` option

| value | description |
| ------------------ | ---------------------------------- |
| `'ip'` | Limit flow by client IP (default) |
| `'user'` | Press `req.user?.id` to limit current |
| `(req) => string` | Custom function, returns unique identifier |

:::tip
The routing level can override the global configuration via `options.override.rateLimit`, or set it to `false` to disable rate limiting.
:::

---

## VextRequestIdConfig

Request ID tracing configuration for log correlation and distributed link tracing.

| Field | Type | Default Value | Description |
|---------------- | -------------- | -------------------------- | ---------------------------- |
| `enabled` | `boolean` | `true` | Whether to enable request ID |
| `header` | `string` | `'x-request-id'` | From which request header to read (gateway transparent transmission) |
| `responseHeader` | `string` | `'x-request-id'` | The name to write the response header |
| `generate` | `() => string` | `crypto.randomUUID()` | Custom ID generation function |

### requestId vs traceId

`requestId` is the unique identifier of the request built into vext, and `traceId` usually refers to the tracing ID generated by the APM link tracking system (such as OpenTelemetry / Jaeger). Both have different usage scenarios:

**Mode 1: requestId acts as traceId (simple scenario)**

Change the request header name of `requestId` to `x-trace-id` to unify it with the link tracking header, which is suitable for systems that do not rely on external APM:

```typescript
import { nanoid } from "nanoid";

export default {
  requestId: {
    header: "x-trace-id", // Read from x-trace-id (gateway injection)
    responseHeader: "x-trace-id", // Write back the response header
    generate: () => nanoid(), // Can be replaced by a shorter ID generator
  },
};
```

**Mode 2: requestId + APM traceId coexist (enterprise-level scenario)**

Keep `requestId` (log association), and transparently transmit APM's `traceparent` header through `config.fetch.propagateHeaders`, suitable for connecting to OpenTelemetry / Jaeger and other systems:

```typescript
export default {
  // requestId retains the default configuration (for log correlation)
  requestId: {
    header: "x-request-id",
    responseHeader: "x-request-id",
  },
  // APM tracking headers are automatically transparently transmitted to downstream services through propagateHeaders
  fetch: {
    propagateHeaders: ["traceparent", "tracestate"],
  },
};
```

:::tip Select suggestions

- Internal system, simple tracing → Mode 1 (rename header to `x-trace-id`)
- Access OpenTelemetry / Jaeger / Datadog → Mode 2 (retain requestId, configure propagateHeaders)
- For details, see [Request context → Relationship with distributed tracing](/guide/request-context#Relationship with distributed tracing traceId)
  :::

Generators can also be replaced dynamically via plugins:

```typescript
app.setRequestIdGenerator(() => myCustomId());
```

---

## VextFetchConfig

Built-in HTTP client and request proxy configuration.

| Field | Type | Default Value | Description |
| ------------------ | ----------------------------------------------- | ------- | -------------------------------------------------- |
| `timeout` | `number` | `10000` | `app.fetch` and `app.fetch.proxy` default timeouts |
| `retry` | `number` | `0` | The default number of retries, indicating the number of additional attempts |
| `retryDelay` | `number \| (attempt: number) => number` | `1000` | Default retry interval, supports function form |
| `propagateHeaders` | `string[]` | `[]` | Common `app.fetch` request header whitelist for automatic transparent transmission |
| `proxy` | `VextFetchProxyTargetConfig[]` | `[]` | List of upstream targets for `app.fetch.proxy.<name>()` |

```typescript
export default {
  fetch: {
    timeout: 10_000,
    retry: 1,
    retryDelay: 500,
    propagateHeaders: ["traceparent", "x-tenant-id"],
    proxy: [
      {
        name: "userService",
        baseURL: "http://user-service:3001/api",
        forwardHeaders: ["x-tenant-id"],
        headers: { "x-source": "gateway" },
        timeout: 5000,
        retry: 1,
      },
    ],
  },
};
```

### VextFetchProxyTargetConfig

| Field | Type | Required | Description |
| -------------------------- | --------------------------------------- | :--: | ---------------------------------------------------------------- |
| `name` | `string` | ✅ | Target name, corresponding to `app.fetch.proxy.<name>()`; reserved name `then` cannot be used |
| `baseURL` | `string` | ✅ | Upstream base URL |
| `headers` | `Record<string, string>` | ❌ | Target-level fixed request headers |
| `forwardHeaders` | `string[]` | ❌ | Whitelist of request headers transparently transmitted from the current `req.headers` |
| `defaultInjectHeaders` | `Record<string, string> \| Function` | ❌ | Target-level dynamic injection headers |
| `allowAuthorizationForward` | `boolean` | ❌ | Whether to allow transparent transmission of the original Authorization |
| `timeout` | `number` | ❌ | Target-level timeout |
| `retry` | `number` | ❌ | Number of target-level retries |
| `retryDelay` | `number \| (attempt: number) => number` | ❌ | Target-level retry interval |

Proxy request header priority: `target.headers < forwardHeaders < target.defaultInjectHeaders < options.headers < options.injectHeaders`. `Authorization` does not transmit transparently by default, and both whitelist and `allowAuthorizationForward: true` must be configured.Agent retry priority: `options.retry > target.retry > config.fetch.retry > 0`. Only GET / HEAD / OPTIONS / PUT / DELETE will automatically retry when upstream 5xx or network error occurs; POST / PATCH does not retry by default, does not retry when timeout and returns local 504.

---

## VextLoggerConfig

Structured log configuration, implemented based on Vext’s built-in logger kernel.| Field | Type | Default Value | Description |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level` | `'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug' \| 'trace' \| 'silent'` | `'info'` | log level |
| `lifecycleLevel` | `'concise' \| 'verbose'` | `'concise'` | Framework life cycle log detail level, control system log output such as startup, loader, hot reload, cluster, etc. |
| `pretty` | `boolean` | Development environment `true` | Whether to use the built-in pretty formatter to output readable format |
| `prettyIgnore` | `string` | `'pid,hostname,requestId'` | Fields to ignore in pretty mode (comma separated). Hiding `requestId` by default prevents mixin-injected fields from being expanded into multi-line noise, and the production environment JSON output is not affected |
| `prettySingleLine` | `boolean` | `true` | Whether to compress extra fields in the same line of the message as JSON inline in pretty mode. Set to `false` to use multi-line expansion format. Only affects pretty mode, production environment JSON output is not affected |
| `redactKeys` | `string[]` | `[]` | Desensitize structured log fields by exact key at any level. The top level `level` is the log protocol field and will not be overwritten |
| `redactPaths` | `string[]` | `[]` | Desensitize structured log fields by dot notation exact path, support array numeric subscript; do not support wildcard, bracket notation, remove or function censor || `redactValue` | `string` | `'[Redacted]'' | Desensitized replacement value |
| `mixin` | `() => Record<string, unknown>` | `undefined` | Customized log mixin function, the return value will be merged with the framework's built-in fields and injected into each log. `requestId` is a framework protected field and cannot be overridden by user mixin; other fields such as `trace_id` / `span_id` are given priority by user mixin. Typical use: Inject OpenTelemetry `trace_id` / `span_id` to associate logs with link tracking. User mixin calls will not be executed when not configured. |

```typescript
export default {
  logger: {
    level: "debug",
    pretty: true, // Development environment beautification output
    // prettySingleLine: true, // Default value, extra fields are compressed to the same line of the message
    // prettySingleLine: false, // Restore multi-line expansion format
    // prettyIgnore: 'pid,hostname,requestId', //Default value, hide requestId
    // prettyIgnore: 'pid,hostname', // To display requestId in pretty mode
    // redactKeys: ['password', 'token'],
    // redactPaths: ['user.email', 'headers.authorization'],
    // redactValue: '[Redacted]',
  },
};
```

**Log level priority** (from high to low):

```
fatal > error > warn > info > debug > trace
```

After setting a certain level, only logs of this level and higher will be output. Set to `'silent'` to be completely silent.

The default logger also supports runtime `app.logger.getLevel()` / `app.logger.setLevel(level)` to adjust subsequent log thresholds; the configuration object itself will still be frozen after startup and should not be dynamically changed by modifying `app.config.logger.level`.

---

## VextShutdownConfig

Graceful shutdown of configuration.

| Field | Type | Default Value | Description |
| --------- | -------- | ------ | --------------- |
| `timeout` | `number` | `10` | Shutdown timeout (seconds) |

After receiving the `SIGTERM` / `SIGINT` signal, the framework will:

1. Stop accepting new requests
2. Wait for the in-flight request to complete (no more than `timeout` seconds)
3. Execute all `onClose` hooks in LIFO order
4. Exit the process

```typescript
export default {
  shutdown: {
    timeout: 30, // Container environment recommends 30 seconds
  },
};
```

---

## VextServerConfig

Inbound Node.js HTTP server layer configuration. Applicable to built-in Native / Hono / Fastify / Express / Koa adapter, also applicable to development server created by `vext dev`. Unset fields retain the current Node.js default value.

| Field | Type | Default Value | Description |
| -------------------------- | -------- | ------------- | ----------------------------------------------- |
| `requestTimeout` | `number` | Node.js default value | Maximum time in milliseconds to receive a complete request, `0` means disabled |
| `headersTimeout` | `number` | Node.js default value | Maximum time to receive complete HTTP headers (milliseconds) |
| `keepAliveTimeout` | `number` | Node.js default value | Keep-alive idle wait time after response completes (milliseconds) |
| `socketTimeout` | `number` | Node.js default value | socket inactivity timeout (milliseconds), `0` means disabled |
| `maxHeaderSize` | `number` | Node.js default value | Maximum request header size (bytes) |
| `maxRequestsPerSocket` | `number` | Node.js default value | The maximum number of requests for a single socket, `0` means unlimited |
| `connectionsCheckingInterval` | `number` | Node.js default value | Outstanding request timeout check interval (milliseconds) |

```typescript
export default {
  server: {
    requestTimeout: 120_000,
    headersTimeout: 60_000,
    keepAliveTimeout: 5_000,
    socketTimeout: 0,
    maxHeaderSize: 16 * 1024,
    maxRequestsPerSocket: 0,
    connectionsCheckingInterval: 30_000,
  },
};
```

`config.server` only controls inbound service requests. The timeout for outbound `app.fetch` / `app.fetch.proxy` is controlled by `config.fetch.timeout`, the proxy target `timeout`, or options when calling.

---

## VextResponseConfig

Response format configuration.| Field | Type | Default Value | Description |
| -------------------- | --------- | ------ | --------------------- |
| `hideInternalErrors` | `boolean` | `true` | Whether to hide 500 error details |
| `wrap` | `boolean` | `true` | Whether to enable export packaging |

### Export packaging

When `wrap: true` is enabled, `res.json(data)` is automatically wrapped:

```json
{
  "code": 0,
  "data": { "id": 1, "name": "Alice" },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Error response format:

```json
{
  "code": 10001,
  "message": "User does not exist",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

When `wrap: false` is disabled, `res.json(data)` sends raw `data` directly.

### Hide internal errors

`hideInternalErrors` only affects the "unknown exception" 500 error path, such as the scenario where `throw new Error("...")` is directly used in routing, service, and middleware. It does not change the status code and response format of structured errors such as `app.throw(...)` or `VextValidationError`.

When `hideInternalErrors: true` is used, 500 errors are not exposed stack trace:

```json
//hideInternalErrors: true
{ "code": 500, "message": "Internal Server Error" }

// hideInternalErrors: false (for development environment only)
{ "code": 500, "message": "Internal Server Error", "stack": "..." }
```

---

## VextBodyParserConfig

Request body parsing configuration.

| Field | Type | Default Value | Description |
| ------------- | ------------------ | ------- | ------------------ |
| `enabled` | `boolean` | `true` | Whether to enable body parsing |
| `maxBodySize` | `string \| number` | `'1mb'` | Maximum request body size |

```typescript
export default {
  bodyParser: {
    maxBodySize: "5mb", // Supports 'kb', 'mb', 'gb' units
  },
};
```

After disabled, `req.body` is always `undefined`, which is suitable for pure GET service or custom body parsing scenarios.

`maxBodySize` supported formats:

| Format | Example | Description |
| ------ | ---------------------------- | ------------------ |
| String | `'1mb'`, `'512kb'`, `'10mb'' | Support kb/mb/gb unit |
| Number | `1048576` | Directly specify the number of bytes |

---

## VextMultipartConfig

Multipart/File upload global configuration.

| Field | Type | Default Value | Description |
| ------------------ | ---------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `false` | Whether to enable built-in multipart parsing. After setting to `true`, body-parser will automatically fill in `req.files` without plug-in |
| `maxFileSize` | `number` | `10485760` | Maximum size of a single file (bytes, default 10MB) |
| `maxFiles` | `number` | `10` | Maximum number of files in a single request |
| `allowedMimeTypes` | `string[]` | `undefined` | Whitelist of allowed MIME types (if not set, there will be no restriction) |

```typescript
export default {
  multipart: {
    enabled: true, // Enable built-in parsing
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "application/pdf",
    ],
  },
};
```

:::tip Fastify linkage
`multipart.maxFileSize` only limits the size of a single file; the total request body read limit is controlled by `bodyParser.maxBodySize`. When using Fastify, if `fastifyAdapter({ bodyLimit })` is additionally passed in, the actual read boundary will be the smaller value of the adapter `bodyLimit` and the overall upper limit of body-parser.
:::

---

## VextAccessLogConfig

Access log configuration, implemented based on onion model after-middleware.| Field | Type | Default Value | Description |
| ------------------ | ---------- | -------- | ----------------------------------------------- |
| `enabled` | `boolean` | `true` | Whether to enable access logs |
| `level` | `string` | `'info'` | Basic log level, only supports `'info'` or `'debug'` |
| `skipPaths` | `string[]` | `[]` | Exact match skipped path list |
| `skipPathPrefixes` | `string[]` | `[]` | List of paths skipped by prefix matching |
| `slowThreshold` | `number` | `0` | Slow request threshold, `0` means not enabled |
| `warnOn4xx` | `boolean` | `false` | Whether to promote 4xx responses to `warn` |
| `logResponseSize` | `boolean` | `false` | Whether to append the response body size at the end of the message |

```typescript
export default {
  accessLog: {
    enabled: true,
    level: "info",
    skipPaths: ["/health", "/readiness", "/metrics"],
    skipPathPrefixes: ["/internal"],
    slowThreshold: 1000,
    warnOn4xx: false,
    logResponseSize: false,
  },
};
```

Access log output example:

```
POST /api/users 201 12ms | 192.168.1.1
```

Message fields include HTTP method, path, status code, response time (ms) and client IP; `requestId` is automatically injected into the JSON record field by logger's AsyncLocalStorage mixin.

---

## VextOpenAPIConfig

OpenAPI documentation automatically generates configuration.| Field | Type | Default Value | Description |
| ----------------------- | ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled` | `boolean` | dev is enabled, prod is closed | Whether to enable |
| `title` | `string` | `undefined` | Document title |
| `version` | `string` | `undefined` | Document version number |
| `description` | `string` | `undefined` | Document description |
| `docsPath` | `string` | `'/docs'` | Scalar document path |
| `jsonPath` | `string` | `'/openapi.json'' | OpenAPI JSON path |
| `jsonPublicPath` | `string` | Same as `jsonPath` | Public access path of OpenAPI spec (only affects the URL referencing the spec in Scalar HTML, not routing registration). Used for reverse proxy stripping prefix scenarios, [see the guide for details](/guide/openapi#reverse proxy path prefix scenario) |
| `contact` | `object` | `undefined` | Contact information |
| `license` | `object` | `undefined` | License information |
| `servers` | `array` | `undefined` | Server address list |
| `tags` | `array` | `undefined` | Global tag definition |
| `guardSecurityMap` | `Record<string, string>` | `undefined` | Guard → Security Scheme mapping |
| `securitySchemes` | `object` | `undefined` | Security scheme definition || `scalar` | `object` | `{}` | Scalar API Reference UI configuration (theme, dark mode, layout, favicon, etc.) |
| `scalar.theme` | `string` | `'default'` | Theme: `'default'` \| `'moon'` \| `'purple'` \| `'solarized'` \| `'bluePlanet'` \| `'saturn'` \| `'kepler'` \| `'mars'` \| `'deepSpace'` \| `'none'` |
| `scalar.darkMode` | `boolean` | `false` | Whether to enable dark mode |
| `scalar.layout` | `string` | `'modern'` | Layout mode: `'modern'` (three columns) \| `'classic'` (two columns) |
| `scalar.favicon` | `string` | `undefined` | Document page favicon URL (such as `'/favicon.svg'`) |
| `scalar.sources` | `array` | `undefined` | Multiple OpenAPI documentation sources ([see guide for details](/guide/openapi#import external-openapi)). Each item contains `title`, `url` or `content`, `slug` |
| `scalar.cdnUrl` | `string` | jsDelivr CDN | Customize Scalar JS loading address ([see guide for details](/guide/openapi#Use custom address to override local service)). Applicable to intranet/offline/version locked |
| `scalar.showSidebar` | `boolean` | `true` | Whether to display the sidebar |
| `scalar.hideModels` | `boolean` | `false` | Whether to hide the Models/Schemas panel |
| `scalar.hiddenClients` | `string[]` | `undefined` | List of hidden client languages (e.g. `['php', 'ruby']`) |
| `scalar.searchHotKey` | `string` | `'k'` | Search hotkey (Ctrl+K / Cmd+K) |
| `scalar.proxyUrl` | `string` | `undefined` | Proxy URL (Try it out request to avoid CORS) |
| `scalar.customCss` | `string` | `undefined` | Custom CSS |
| ~~`tryItOutEnabled`~~ | `boolean` | `true` | ~~Deprecated~~ Scalar has built-in Try it out, no separate configuration is required |
| ~~`docExpansion`~~ | `'none' \| 'list' \| 'full'` | `'list'` | ~~Deprecated~~ Please use `scalar.layout` instead |

```typescript
export default {
  openapi: {
    enabled: true,
    title: "My API",
    version: "1.0.0",
    description: "My API Documentation",
    scalar: {
      theme: "default",
      darkMode: false,
      layout: "modern",
      favicon: "/favicon.svg",
    },
    servers: [
      { url: "http://localhost:3000", description: "Development environment" },
      { url: "https://api.example.com", description: "Production environment" },
    ],
    tags: [
      { name: "User", description: "User management interface" },
      { name: "Order", description: "Order Management Interface" },
    ],
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    guardSecurityMap: {
      auth: "bearerAuth",
    },
  },
};
```

### `guardSecurityMap`

Automatically map routing middleware names to OpenAPI Security Scheme:

```typescript
//Use auth middleware in route declaration
app.get("/profile", { middlewares: ["auth"] }, handler);
// ↑ OpenAPI automatically infers that this route requires bearerAuth authentication
```

### `securitySchemes`

Supported security scheme types:

| `type` | Description | Required fields |
| --------------- | --------------- | ----------------------------------------------- |
| `http` | HTTP authentication | `scheme` (`bearer` / `basic`) |
| `apiKey` | API Key | `name`, `in` (`header` / `query` / `cookie`) |
| `oauth2` | OAuth 2.0 | — |
| `openIdConnect` | OpenID Connect | — |

---

## VextRequestContextConfig

AsyncLocalStorage request context configuration.

| Field | Type | Default Value | Description |
| --------- | --------- | ------ | ------------------ |
| `enabled` | `boolean` | `true` | Whether to enable the request context |

```typescript
export default {
  requestContext: {
    enabled: false, // Disabled to increase RPS by 3-8%
  },
};
```

:::warning
After disabling, the following functions will be disabled:

- Logger automatically injects `requestId`
- `app.throw()` automatically parses request-level `locale`
- `app.fetch()` automatically propagates `requestId`
  :::

---

## VextFrontendConfig

Built-in frontend build and static serving configuration.

| Field | Type | Default Value | Description |
| -------------------- | -------------------- | ------------------------- | --------------------------------------------- |
| `enabled` | `boolean` | `false` | Whether to enable frontend integration |
| `framework` | `string` | `'react'` | Frontend framework label |
| `root` | `string` | `'src/client'` | Frontend source directory |
| `entry` | `string` | `'src/client/main.tsx'` | Browser entry file |
| `indexHtml` | `string` | `'src/client/index.html'` | HTML shell |
| `outDir` | `string` | `.vext/client` in dev, `dist/client` in production | Frontend output directory |
| `publicDir` | `string` | `'public'` | Static assets copied into the frontend output |
| `publicPath` | `string` | `'/'` | Public asset path prefix |
| `spaFallback` | `boolean \| object` | `true` | Serve `index.html` for non-API browser paths |
| `apiClient` | `boolean \| object` | `true` | Generate client contract artifacts |
| `build.target` | `string \| string[]` | `'es2022'` | Browser build target |
| `build.minify` | `boolean` | Production `true` | Minify frontend output |
| `build.sourcemap` | `boolean` | Development `true` | Generate frontend source maps |

```typescript
export default {
  frontend: {
    enabled: true,
    framework: "react",
    entry: "src/client/main.tsx",
    indexHtml: "src/client/index.html",
    publicDir: "public",
    publicPath: "/",
    spaFallback: {
      enabled: true,
      exclude: ["/api/**", "/openapi.json", "/docs/**"],
    },
  },
};
```

Default SPA fallback exclusions keep `/api/**`, `/openapi.json`, and `/docs/**` on the backend runtime path.

---

## VextClusterConfig

Cluster multi-process configuration. For the complete interface definition, see `src/types/app.ts` `VextClusterConfig`.

### Basic fields

| Field | Type | Default Value | Description |
| ------------------ | ---------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `false` | Whether to enable Cluster mode (can also be enabled by `VEXT_CLUSTER=1`) |
| `workers` | `'auto' \| 'auto-1' \| number` | `'auto'` | Number of Workers (`'auto'` = number of CPU cores; `'auto-1'` = number of CPU cores - 1; number = fixed number, clamped to [1, 64]) |
| `autoRestart` | `boolean` | `true` | Worker automatically restarts after crash |
| `maxRestarts` | `number` | `5` | The maximum number of restarts allowed within the fast restart detection window |
| `restartWindow` | `number` | `60000` | Fast restart detection window (milliseconds) |
| `restartBaseDelay` | `number` | `1000` | Restart interval backoff base (milliseconds) |
| `restartMaxDelay` | `number` | `30000` | Upper limit of restart interval (milliseconds) |
| `pidFile` | `string` | `'.vext.pid'` | PID file path (for `vext stop` / `vext reload` to locate the process) |
| `titlePrefix` | `string` | `'vext'` | Worker process title prefix |
| `sticky` | `'none' \| 'ip'` | `'none'` | Sticky session mode (`'ip'` allocates fixed Worker based on client IP, suitable for WebSocket/SSE) |

### `healthCheck` — heartbeat detection

| Field | Type | Default Value | Description |
| ---------------------- | --------- | ------- | ----------------------------------------------- |
| `healthCheck.enabled` | `boolean` | `true` | Whether to enable Worker heartbeat detection |
| `healthCheck.interval` | `number` | `15000` | The interval at which the Master sends heartbeat detections (milliseconds) |
| `healthCheck.timeout` | `number` | `30000` | Worker heartbeat timeout threshold (milliseconds), forced restart after timeout |

### `reload` — Zero-downtime rolling restart

| Field | Type | Default Value | Description |
| ------------------------ | -------- | ------- | ---------------------------------------- |
| `reload.workerDelay` | `number` | `2000` | Time to wait before replacing the next Worker (milliseconds) |
| `reload.readyTimeout` | `number` | `30000` | New Worker readiness timeout (milliseconds) |
| `reload.shutdownTimeout` | `number` | `10000` | Old Worker shutdown timeout (milliseconds) |

```typescript
export default {
  cluster: {
    enabled: true,
    workers: "auto", // Take full advantage of all CPU cores
    autoRestart: true,
    maxRestarts: 5,
    healthCheck: {
      enabled: true,
      interval: 15000,
      timeout: 30000,
    },
    reload: {
      workerDelay: 2000,
      readyTimeout: 30000,
      shutdownTimeout: 10000,
    },
  },
};
```

It can also be enabled through environment variables (no need to modify the configuration file):

```bash
VEXT_CLUSTER=1 vext start
```

---

## VextCacheConfig

Route-level response cache global configuration.| Field | Type | Default Value | Description |
| ------------------ | ---------- | ------- | ----------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `true` | Whether to enable route-level response caching. When set to `false`, the cache middleware will not be installed and the Redis/MultiLevel connection will not be opened |
| `defaultTtl` | `number` | `60000` | The default value when the route does not specify a TTL, in milliseconds |
| `maxEntries` | `number` | `1000` | Memory mode quick configuration: maximum number of cache entries |
| `maxMemory` | `number` | — | Memory mode quick configuration: maximum memory usage bytes |
| `cleanupInterval` | `number` | `0` | Memory mode quick configuration: periodic cleaning interval, `0` means only lazy cleaning |
| `cacheHub` | `object` | Memory | Underlying response cache runtime configuration |

```typescript
export default {
  cache: {
    enabled: true,
    defaultTtl: 120_000,
    maxEntries: 2000,
  },
};
```

Memory complete configuration:

```typescript
export default {
  cache: {
    defaultTtl: 60_000,
    cacheHub: {
      mode: "memory",
      maxEntries: 1000,
      maxMemory: 50 * 1024 * 1024,
      cleanupInterval: 30_000,
      enableStats: true,
    },
  },
};
```

Redis configuration:

```typescript
export default {
  cache: {
    defaultTtl: 2_000,
    cacheHub: {
      mode: "redis",
      url: "redis://localhost:6379",
      deleteCommand: "unlink",
      lease: {
        waitForOwner: 1_000,
        onTimeout: "fetch",
      },
      distributed: {
        channel: "vext:response-cache",
      },
    },
  },
};
```

MultiLevel configuration:

```typescript
export default {
  cache: {
    defaultTtl: 60_000,
    cacheHub: {
      mode: "multi-level",
      memory: { maxEntries: 1000 },
      redis: { url: "redis://localhost:6379" },
      writePolicy: "both",
      backfillOnRemoteHit: true,
      remoteTimeout: 50,
      lease: true,
    },
  },
};
```

`cacheHub` only accepts `response-cache-kit/cache-hub` configuration and does not accept custom Store. Route-level response caching is configured via `RouteOptions.cache`. The public configuration unit is in milliseconds; the `Cache-Control: max-age` in the response header will output seconds according to the HTTP standard. See the [Response Caching Guide](/guide/cache) for details.

---

## DEFAULT_CONFIG

The full value of the framework’s built-in default configuration:

```typescript
import { DEFAULT_CONFIG } from 'vextjs';

// Complete content of DEFAULT_CONFIG:
{
  port: 3000,
  host: '0.0.0.0',
  adapter: 'native',
  trustProxy: false,
  middlewares: [],
  cors: {
    enabled: true,
    origins: ['*'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false,
  },
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60,
    message: 'Too Many Requests',
    keyBy: 'ip',
  },
  requestId: {
    enabled: true,
    header: 'x-request-id',
    responseHeader: 'x-request-id',
  },
  logger: {
    level: 'info',
  },
  shutdown: {
    timeout: 10,
  },
  response: {
    hideInternalErrors: true,
    wrap: true,
  },
  bodyParser: {
    enabled: true,
    maxBodySize: '1mb',
  },
  accessLog: {
    enabled: true,
    level: 'info',
    skipPaths: [],
  },
  openapi: {
    enabled: false,
  },
  requestContext: {
    enabled: true,
  },
  frontend: {
    enabled: false,
  },
}
```

---

## VextUserConfig

User-configured input type, all fields are optional. The complete `VextConfig` is generated by `loadConfig()` merging the default values.

```typescript
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 8080,
  logger: { level: "debug" },
};

export default config;
```

---

## loadConfig

Configuration loading function, receives the configuration directory path and performs the complete configuration chain merge.

```typescript
import { loadConfig } from "vextjs";
import { join } from "node:path";

const config = await loadConfig(join(process.cwd(), "src/config"), {
  rootDir: process.cwd(),
  command: "start",
  isBuilt: false,
});
// config: VextConfig (merged, frozen)
```

Usually there is no need to call it manually, `bootstrap()` will automatically call `loadConfig()` internally. The merge order is: `DEFAULT_CONFIG < default < env < local < bootstrap provider patch < CLI override`.

---

## Environment variable override

Some configurations support overriding through environment variables:

| Environment variables | Corresponding configuration | Description |
| -------------- | ----------------- | -------------------------- |
| `PORT` | `port` | HTTP listening port |
| `HOST` | `host` | HTTP listening address |
| `NODE_ENV` | — | Determine which environment configuration file to load |
| `VEXT_CLUSTER` | `cluster.enabled` | Set to `1` to enable clustering |

```bash
PORT=8080 NODE_ENV=production vext start
```

---

## Type declaration extension

Plug-ins can add custom fields to `VextConfig` through `declare module`:

```typescript
// types/vext.d.ts
declare module "vextjs" {
  interface VextConfig {
    redis?: {
      host: string;
      port: number;
      password?: string;
    };
  }
}
```

Later use in the configuration file will get full type hints:

```typescript
// src/config/default.ts
export default {
  redis: {
    host: "localhost",
    port: 6379,
  },
};
```

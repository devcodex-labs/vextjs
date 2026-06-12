# Runtime Hooks

`app.hooks.on(name, handler)` is used to observe or lightweight patch framework runtime life cycle. It is suitable for cross-cutting logic such as request auditing, request records after verification, response header patch, outbound call monitoring, service call tracking, OpenAPI document patching, etc.

```ts
const off = app.hooks.on("validation:success", ({ req, route }) => {
  app.logger.info(
    { requestId: req.requestId, route: route.path },
    "validated request",
  );
});

app.hooks.on("response:before", ({ headers }) => ({
  headers: { ...headers, "x-powered-by": "vext" },
}));

off();
```

`app.hooks.on()` returns the logout function. `app.hooks` is a reserved property and cannot be overridden with `app.extend("hooks", ...)`.

## Common scenarios

### Only record requests that pass the verification

If you want to log requests in a middleware, but exclude requests that are rejected by parameter validation, there is no need to manually catch `VextValidationError`. Using `validation:success` is more straightforward:

```ts
app.hooks.on("validation:success", ({ req, route }) => {
  app.logger.info(
    { requestId: req.requestId, method: req.method, route: route.path },
    "request validated",
  );
});
```

### Add header before sending response

```ts
app.hooks.on("response:before", ({ headers }) => ({
  headers: {
    ...headers,
    "x-service": "billing",
  },
}));
```

`response:before` is a synchronous life cycle and cannot return Promise.

### Track service calls

```ts
app.hooks.on("service:beforeCall", ({ service, method }) => {
  app.logger.debug({ service, method }, "service call");
});

app.hooks.on("service:error", ({ service, method, error }) => {
  app.logger.warn({ service, method, error }, "service failed");
});
```

Service hook is also a synchronous life cycle. If you need asynchronous reporting, it is recommended to write to the queue or use log transmission that does not block the main call.

### Monitor outbound requests and proxies

```ts
app.hooks.on("fetch:before", ({ headers }) => {
  headers.set("x-client", "vext");
});

app.hooks.on("proxy:after", ({ target, status, requestId }) => {
  app.logger.info({ target, status, requestId }, "proxy response");
});
```

### Modify OpenAPI documentation

```ts
app.hooks.on("openapi:afterGenerate", ({ document }) => {
  const spec = document as { info?: Record<string, unknown> };

  return {
    document: {
      ...spec,
      info: {
        ...(spec.info ?? {}),
        title: "Internal API",
      },
    },
  };
});
```

## Execution strategy

| Hook Type | Strategy |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `request:start`, `validation:success`, `handler:before`, `fetch:before`, `proxy:before`, `plugin:beforeSetup`, `server:beforeListen` | Errors thrown by the handler will propagate upward and can prevent subsequent processes |
| `response:before`, `error:beforeResponse`, `service:beforeCall`, `service:afterCall`, `service:error`, `openapi:*` | Synchronous life cycle, return of Promise is not allowed |
| `handler:after`, `handler:error`, `response:after`, `error:afterResponse`, `fetch:after/error`, `proxy:after/error`, `cache:*`, `plugin:afterSetup/error`, `routes:ready`, `app:ready/close` | safe emit, hook errors will be recorded but will not change the main process |

## Available Hooks

| Name | Trigger Point |
|---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `request:start` | After requestId is generated, it enters the global middleware chain; 404 will also be triggered, `matched=false` |
| `route:matched` | After the adapter matches the route and before executing the checksum handler |
| `route:notFound` | No route matching, 404 response before sending |
| `validation:success` | Route `validate` all passed, before `next()` |
| `validation:error` | Route `validate` fails and throws `VextValidationError` before |
| `handler:before` | Before the business handler is called |
| `handler:after` | After the business handler returns successfully |
| `handler:error` | After the business handler throws an error and before entering global error handling |
| `response:before` | `res.json/rawJson/text/stream` can be synchronized before sending. patch `data/status/headers` |
| `response:after` | After the response is sent |
| `error:beforeResponse` | `error-handler` can synchronize patch `body/status` before writing JSON error response |
| `error:afterResponse` | After the error response is sent |
| `fetch:before` | `app.fetch` can be modified before leaving the website `Headers` |
| `fetch:after` | `app.fetch` returns `Response` after |
| `fetch:error` | `app.fetch` finally fails |
| `proxy:before` | `app.fetch.proxy` After parsing the upstream request and before sending it |
| `proxy:after` | `app.fetch.proxy` after receiving the upstream response and before transparent transmission |
| `proxy:error` | `app.fetch.proxy` on local error, timeout or upstream network failure |
| `service:loaded` | After service is loaded and mounted during cold start |
| `service:reloaded` | dev soft reload after re-instantiating service |
| `service:beforeCall` | Before the service method is called |
| `service:afterCall` | After the service method returns successfully |
| `service:error` | After the service method throws an error or rejects |
| `cache:hit`, `cache:miss`, `cache:write`, `cache:error` | Route-level response cache read and write life cycle |
| `plugin:beforeSetup`, `plugin:afterSetup`, `plugin:error` | Plugin `setup()` before and after and failure; plugins cannot observe their own `beforeSetup` || `routes:ready` | After route scanning and registration are completed |
| `openapi:beforeGenerate`, `openapi:afterGenerate` | Before and after OpenAPI document generation; `afterGenerate` can replace document synchronously |
| `server:beforeListen` | Before HTTP server starts listening |
| `app:ready` | `onReady` before and after execution |
| `app:close` | `onClose` / shutdown before and after execution |

## More references

- [`app.hooks` API](/api/app#apphooks)
- [Register runtime hooks in plug-ins](/guide/plugins#apphookson--Register runtime life cycle-hook)
- [Fetch / Proxy hooks](/guide/fetch)
- [OpenAPI hooks](/guide/openapi)
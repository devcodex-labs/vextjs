# Runtime Hooks

`app.hooks.on(name, handler)` is used to observe or lightweight patch framework runtime life cycle. It is suitable for cross-cutting logic such as request auditing, request records after verification, response header patch, outbound call monitoring, service call tracking, OpenAPI document patching, etc.

Register hooks in plugin setup. Run the three-file example first, then combine the topic fragments as needed. Each event has its own error and sync rules; callers await or synchronously execute listeners according to that rule, so slow listeners affect the original flow.

## Complete three-file example

Start from the API project, TypeScript configuration, and dev/build/start scripts in [Quick start](/guide/quick-start). Replace the base config and create the two files below. No database or monitoring service is required. Use an isolated example project; if you retain environment overrides, ensure the final port is 3000 and the log level permits info.

```typescript
// src/config/default.ts
export default { port: 3000, adapter: "native", frontend: { enabled: false } };
```

```typescript
// src/plugins/hook-observer.ts
import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  hookStats: {
    validated: number;
    rejected: number;
    handled: number;
    errors: number;
  };
}>();

export default definePlugin({
  name: "hook-observer",
  setup(app) {
    const hooks = app.hooks;
    const logger = app.logger;
    const stats = { validated: 0, rejected: 0, handled: 0, errors: 0 };
    app.extend("hookStats", stats);
    const removers = [
      app.hooks.on("validation:success", () => {
        stats.validated += 1;
      }),
      app.hooks.on("validation:error", () => {
        stats.rejected += 1;
      }),
      app.hooks.on("handler:after", () => {
        stats.handled += 1;
      }),
      app.hooks.on("handler:error", () => {
        stats.errors += 1;
      }),
      app.hooks.on("response:before", ({ headers }) => ({
        headers: { ...headers, "x-hook-example": "active" },
      })),
    ];
    app.onClose(() => {
      for (const off of removers) off();
      logger.info(
        {
          stats: { ...stats },
          validationListenerPresent: hooks.has("validation:success"),
        },
        "Hook example stopped",
      );
    });
  },
});
```

```typescript
// src/routes/hooks.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/hello",
    { validate: { query: { name: "string:1-20!" } } },
    async (req, res) => {
      const { name } = req.valid("query");
      res.json({ message: `Hello, ${name}!` });
    },
  );
  app.get("/plain", {}, async (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/boom", {}, async () => {
    throw new Error("demonstration failure");
  });
});
```

Run `npm run dev`, then issue these requests in order from another terminal (use `curl.exe` in Windows PowerShell):

```bash
curl -i "http://127.0.0.1:3000/hooks/hello?name=Alice"
curl -i "http://127.0.0.1:3000/hooks/hello"
curl -i "http://127.0.0.1:3000/hooks/plain"
curl -i "http://127.0.0.1:3000/hooks/boom"
```

Expected statuses are **200 / 422 / 200 / 500**. The first response has `data.message` equal to `Hello, Alice!`; all responses carry `x-hook-example: active`. The missing-query request never reaches a handler. `plain` has no validate option and does not emit `validation:success`; `boom` hides its internal message by default.

After four requests, stop the service normally with Ctrl+C. The `Hook example stopped` log should show `validated=1`, `rejected=1`, `handled=2`, `errors=1`, and `validationListenerPresent=false`. This assumes an isolated project with no other requests or listeners; repeated calls change counts, and another plugin could keep `has` true. Force-killing the process does not verify shutdown callbacks.

Run `npm run build` (the quick-start script includes `vext build --typecheck`), then `npm start`, repeat the requests, and stop normally to check the built app. `appExtensions` supplies the type-generation shape of `hookStats`; it does not create runtime state.

## Register and unsubscribe

The following fragment belongs inside plugin setup:

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

`app.hooks.on()` returns an unsubscribe function. `app.hooks` is reserved and cannot be overridden with `app.extend("hooks", ...)`. Here `off()` removes only the validation listener, so it receives no later event; the response listener remains. Register each long-lived remover with `app.onClose()`, and remove temporary listeners when done.

`app.hooks.has(name)` checks whether any listener currently exists. The public API is `on` and `has`; emission methods are framework internals. A plugin should release its own listeners on close or reload.

## Common scenarios

### Only record requests that pass the verification

If you want to log requests in a middleware, but exclude requests that are rejected by parameter validation, there is no need to manually catch `VextValidationError`. Using `validation:success` is more straightforward:

This event runs only when a route declares effective validation and the request reaches it. It does not count every successful request: auth rejection, earlier short-circuiting, or cache hits can bypass validation. Successful validation also does not guarantee the later handler succeeds.

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

Service hooks are synchronous. A `service:beforeCall` exception prevents the method call; `afterCall` and `error` are safe synchronous notifications that do not replace the business result. They cover framework-wrapped prototype methods, not instance arrow functions or getters. Use a bounded queue with failure and shutdown flushing policies for asynchronous reporting; do not attach an async listener to a synchronous event.

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

| Events                                                                                                                                                                        | Async       | Error strategy                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| `request:start` (matched=true), `route:matched`, `validation:success`, `handler:before`, `fetch:before`, `proxy:before`, user `plugin:beforeSetup`, `server:beforeListen`     | May await   | Propagate to caller and stop later steps            |
| `response:before`, `service:beforeCall`                                                                                                                                       | Not allowed | Synchronous error fails the call                    |
| `request:start` (404 matched=false), `route:notFound`, `validation:error`, `handler:after/error`, `fetch:after/error`, `proxy:after/error`, `routes:ready`, `app:ready/close` | May await   | Safe: log listener error and continue original flow |
| `response:after`, `error:beforeResponse/afterResponse`, `service:loaded/reloaded/afterCall/error`, `cache:*`, `plugin:afterSetup/error`, `openapi:*`                          | Not allowed | Safe synchronous notification                       |

Slash forms in the table abbreviate distinct event names; do not pass the abbreviation to `on`. Built-in MonSQLize `plugin:beforeSetup` is a safe synchronous notification in a separate startup flow, unlike user plugin setup.

All synchronous events reject Promise returns, even where the public TypeScript generic cannot yet prevent an `async` listener. Detecting a Promise does not cancel async work that already started. Safe means listener exceptions are logged, not that an async listener costs no time or is never awaited, nor that business work succeeded. Avoid never-settling Promises in hooks.

### Multiple listeners and patches

Listeners execute in registration order, and a Set deduplicates the same function reference. For events with a return value, the last non-undefined result wins: patches returned by multiple listeners are **not merged**, and an earlier return does not become the next listener's payload. Return one consolidated patch when changing data, status, and headers together. Mutating a mutable payload directly is a different behavior and needs an explicit coordination boundary.

OpenAPI accepts a synchronous `{ document }` result or a complete document containing an `openapi` field. Returning only an `info` fragment is not a full replacement. Hooks do not replace static route contracts; see the [app.hooks API](/api/app#apphooks).

## Available Hooks

| Name                                                      | Trigger Point                                                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `request:start`                                           | Global request-hook position after metadata/requestId/auth context; also for 404 with `matched=false`                       |
| `route:matched`                                           | After adapter matching, before validation and handler                                                                       |
| `route:notFound`                                          | No route matching, 404 response before sending                                                                              |
| `validation:success`                                      | Route `validate` all passed, before `next()`                                                                                |
| `validation:error`                                        | Route `validate` fails and throws `VextValidationError` before                                                              |
| `handler:before`                                          | Before the business handler is called                                                                                       |
| `handler:after`                                           | After successful handler return and framework-tracked response sending; streams wait for closure, not client acknowledgment |
| `handler:error`                                           | After a handler throws/rejects; not every preceding middleware or validation error                                          |
| `response:before`                                         | Runs before `json/rawJson/text/html/render/stream/download/redirect`; synchronously patches `data/status/headers`           |
| `response:after`                                          | After the sending flow ends; streams/downloads wait for end, close, or error, not confirmed client receipt                  |
| `error:beforeResponse`                                    | `error-handler` can synchronize patch `body/status` before writing JSON error response                                      |
| `error:afterResponse`                                     | After the error response is sent                                                                                            |
| `fetch:before`                                            | Before outbound `app.fetch`; can modify `Headers`                                                                           |
| `fetch:after`                                             | After `app.fetch` returns `Response`, including HTTP error statuses                                                         |
| `fetch:error`                                             | Network error, timeout, or cancellation ends the actual request/retry flow                                                  |
| `proxy:before`                                            | `app.fetch.proxy` After parsing the upstream request and before sending it                                                  |
| `proxy:after`                                             | `app.fetch.proxy` after receiving the upstream response and before passing it to the caller                                 |
| `proxy:error`                                             | `app.fetch.proxy` on local error, timeout or upstream network failure                                                       |
| `service:loaded`                                          | After service is loaded and mounted during cold start                                                                       |
| `service:reloaded`                                        | dev soft reload after re-instantiating service                                                                              |
| `service:beforeCall`                                      | Before the service method is called                                                                                         |
| `service:afterCall`                                       | After the service method returns successfully                                                                               |
| `service:error`                                           | After the service method throws an error or rejects                                                                         |
| `cache:hit`, `cache:miss`, `cache:write`, `cache:error`   | Route-level response cache read and write life cycle                                                                        |
| `plugin:beforeSetup`, `plugin:afterSetup`, `plugin:error` | Plugin `setup()` before and after and failure; plugins cannot observe their own `beforeSetup`                               |
| `routes:ready`                                            | After route scanning and registration are completed                                                                         |
| `openapi:beforeGenerate`, `openapi:afterGenerate`         | Before and after OpenAPI document generation; `afterGenerate` can replace document synchronously                            |
| `server:beforeListen`                                     | Before HTTP server starts listening                                                                                         |
| `app:ready`                                               | `phase=before/after` distinguishes onReady stages; standard CLI startup emits after listening                               |
| `app:close`                                               | `phase=before/after` distinguishes shutdown stages within one deadline                                                      |

Listeners observe only events after registration. User plugins cannot replay built-in MonSQLize initialization or their own already completed `plugin:beforeSetup`. Count `app:ready` and `app:close` by phase; a listener removed in `onClose` will not see the later close-after event.

## Troubleshooting and recheck

| Symptom                                 | Diagnosis/action                                                | Recheck                                |
| --------------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| Too few validated requests              | Check validate declaration and earlier auth/cache short-circuit | Compare hello and plain requests       |
| “must be synchronous”                   | An async/Promise listener was attached to a synchronous event   | Make it synchronous and retry          |
| Only part of a patch remains            | Listener return values do not merge                             | Consolidate patch and inspect response |
| Hook error logged but request succeeded | Safe notification; inspect business status separately           | Compare event strategy and response    |
| Repeated listener/resource use          | Re-registered closures or missing unsubscribe/cleanup           | Unsubscribe or close, then check `has` |

## More references

- [`app.hooks` API](/api/app#apphooks)
- [Register runtime hooks in plug-ins](/guide/plugins#apphookson--Register runtime life cycle-hook)
- [Fetch / Proxy hooks](/guide/fetch)
- [OpenAPI hooks](/guide/openapi)

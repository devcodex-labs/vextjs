# Render Data and Cache

Render data is the server-prepared payload used to produce HTML and hydrate the page.

Complete [Routing and Pages](/frontend/routing-and-pages) and [Data Flow](/frontend/data-flow) first. This page covers response caching for public pages, then distinguishes static/revalidation storage from the browser navigation cache. For personalized pages, establish isolation and bypass rules first.

## What Is Render Data

HTML and navigation envelopes at the same URL both vary on `Accept`, `Vext-Navigation`, and `Vext-Build-Id`, preserving existing Vary values. Pages with an authenticated identity or session use `Cache-Control: private, no-store`. Buffered HTML, streaming responses, error pages, and cache replay share this policy; custom public cache headers cannot override a private response.

These are rules for HTTP responses and the renderer. They do not mean route cache reads and concurrent origin fetches are automatically isolated for every business identity. Follow the Cookie-hit and concurrent-reuse boundaries of `RouteOptions.cache` in the [Response Cache guide](/guide/cache). Adding `no-store` only when returning a response cannot replace a decision before entering the cache.

For `res.render()`, render data can include:

- `props`
- `options.layoutData`
- `options.messages`
- `options.locale`
- `options.head`
- status and page id

It should be JSON-safe and free of database handles, request objects, secrets, or functions.

## Route Cache Reuse

Vext reuses the existing route response cache contract. JSON responses cache a JSON body; rendered pages cache their render payload.

This complete example fits an existing full-stack project and caches only public requests without identity, Session, Authorization, or Cookie. The TTL is in milliseconds. First confirm global `cache.enabled` has not been disabled.

```ts
// src/routes/cached-report.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  let generation = 0;
  app.get(
    "/",
    {
      cache: {
        ttl: 60_000,
        condition: (req) =>
          !req.auth.isAuthenticated &&
          !req.session &&
          !req.headers.authorization &&
          !req.headers.cookie,
      },
    },
    (_req, res) => {
      res.render("reports/cached", { generation: ++generation });
    },
  );
});
```

```tsx
// src/frontend/pages/reports/cached.tsx
export default function CachedReport(props: { generation: number }) {
  return <main>Generation: {props.generation}</main>;
}
```

On a cache hit, Vext re-renders HTML from the cached payload with the current frontend renderer and manifest. `generation` is only a single-process verification marker; it resets on server restart and is not a business data version strategy. A cache hit skips the handler, so do not put an authorization check that must run on every request inside it.

## Layout Data

If multiple layouts need server data, collect that data in the route handler or a service and pass it through `layoutData`.

The following is a handler snippet for an application that already has prepared user data and the [Layouts and Components](/frontend/layouts-and-components) example. `user` is filtered profile data; `menu` is an application menu. Do not put personalized data into the public cache route above:

```ts
res.render(
  "admin/dashboard",
  { totalUsers: 42 },
  {
    layoutData: {
      ".": { user },
      admin: { menu },
    },
  },
);
```

This avoids hidden service calls from layout components and keeps cache keys at the route boundary. Identity comes from `req.auth`; the framework does not automatically inject `req.user`. A layout consumes the matching ID's `props.data`.

## Cache Keys

Include every value that changes the rendered payload:

- path and query
- authenticated user or tenant
- locale
- feature flag or experiment
- data version

If HTML differs per locale, make sure response cache and CDN cache vary by locale.

The default route response cache includes method, normalized URL, and declared vary. It does not automatically include the business user, feature flag, or data version. Use `vary`, a trusted `partitionKey`, or a custom key. A custom key replaces the default URL composition, so include every input that actually affects the result. See the [Response Cache guide](/guide/cache) for default internal key format and concurrency limits; do not infer a deletable cache key from the render payload.

## Distinguish Three Caches

| Mechanism                 | Enablement                                            | Unit and scope                                                                                                                                        | Invalidation                                                 |
| ------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Route response cache      | `RouteOptions.cache`                                  | `ttl` is milliseconds; key, vary, partition, and condition control reuse                                                                              | `app.cache` API by tag or exact key                          |
| Server frontend freshness | `RouteOptions.frontend.mode` is `static`/`revalidate` | `revalidate` is seconds; public GET/HEAD, bypassed for authenticated or session requests; key includes route, path/query, locale, buildId, and policy | Server-side `invalidateFrontendFreshness`                    |
| Browser navigation cache  | Generated browser navigation runtime                  | Isolated by the current page contract, URL, locale/identity, and related inputs; private/no-store results do not enter a shared cache                 | Browser `revalidate()`; see [Data Flow](/frontend/data-flow) |

Do not stack two server caches on one page without assessing them: invalidating one does not invalidate the other. Build-time output for `mode: "static"` is also separate from runtime storage. The build passes `{ params }` directly to the page and does not execute the handler; see [Rendering Modes](/frontend/rendering-modes).

For server-side tag invalidation after a successful business write, `projectRoot` must be the actual Vext project root:

```ts
import { invalidateFrontendFreshness } from "vextjs/frontend";

await invalidateFrontendFreshness(projectRoot, { tag: "reports" });
```

This does not delete published static HTML from a CDN or call browser `revalidate()` for a client.

## What Not to Cache

Do not cache render payloads that include one-time tokens, secrets, or non-reusable user state. Sensitive fields should not be passed to the browser at all. Use `cache: false` for a non-reusable page and keep `frontend.mode: "dynamic"`. A shorter TTL does not make inappropriate data reusable.

## Verify Hits and Bypasses

Run `npm run build`, then `npm start -- --port 3000`. Send two GET requests to `/cached-report` without Cookie or Authorization: the first should be `X-Cache: MISS`, the second `HIT`, and both pages should have the same generation. A request with Cookie should bypass the cache condition and increment generation. Do not use a browser session with login cookies to verify a public hit. Stop the service afterward.

In a real application, separately test different locales, identity partitions, and output after invalidation. A good hit rate does not prove correct cache content. Development's default `no-store` may make production cache observations inapplicable, so this example uses production build/start.

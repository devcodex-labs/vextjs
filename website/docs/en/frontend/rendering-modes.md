# Rendering Modes

Vext supports a mixed full-stack frontend model without mixing server files into the browser bundle.

## Default: SSR plus Hydration

Most pages should use server rendering:

```text
route handler -> service data -> res.render() -> HTML -> hydration
```

Use this when the first screen needs data, SEO-friendly HTML, shared layouts, or authenticated server decisions.

The default `frontend.render.streaming: "buffered"` path uses `renderToString` and preserves the existing fallback behavior. `frontend.render.timeoutMs` is checked after the synchronous render returns or throws. With `fallback: "client"`, Vext returns the client shell; with `fallback: "error"`, the SSR error is surfaced to the normal error path.

## Opt-in Streaming SSR

Set `frontend.render.streaming: "auto"` when a page should flush its document shell and Suspense fallback before delayed boundaries finish:

```ts
export default {
  frontend: {
    render: {
      streaming: "auto",
      timeoutMs: 3000,
    },
  },
};
```

The streaming lifecycle is:

1. `res.render()` registers the page intent. Before the first byte, Vext freezes the status, headers, document head, nonce, initial assets, and hydration payload.
2. The generated React renderer starts `renderToPipeableStream` and waits for the shell.
3. When the shell is ready, Vext sends the document prefix and pipes the React body, so a Suspense fallback can reach the client before a delayed boundary completes.
4. When React finishes, Vext appends the document suffix and closes the response.

`frontend.render.timeoutMs` aborts unfinished streaming work. An error before the shell follows the existing error-response path; an error after headers or body bytes have been flushed terminates the stream because the HTTP status and headers can no longer be replaced. Closing the client connection also aborts the React renderer.

Native, Hono, Fastify, Express, and Koa support this path. It does not add React Server Components, Server Functions or Server Actions, partial prerendering (PPR), or a Webpack/Vite/Rollup/Rolldown plugin layer. The frontend build remains esbuild-based.

## Streaming SSR is not React Server Components

Streaming SSR improves **when HTML is sent**: a route can send its document
shell and a Suspense fallback before a delayed boundary completes. The browser
still hydrates the React tree from Vext's route-owned render payload.

[React Server Components](https://react.dev/reference/rsc/server-components)
are a different framework and bundler model. They require a server/client
component boundary, a server-component payload protocol, and framework support
for the associated module graph. [Server
Functions](https://react.dev/reference/rsc/server-functions) additionally need
the framework to create callable server references for client code. React notes
that the framework/bundler APIs behind those integrations do not yet follow the
same minor-version stability guarantee as ordinary React APIs.

Vext therefore keeps the current contract deliberately smaller and explicit:

- `src/routes/**` owns the URL and server data boundary.
- `res.render()` owns HTML generation, hydration data, headers, and streaming
  lifecycle.
- `src/frontend/**` remains a known browser-safe graph built with esbuild.
- Route services, SSR, hydration, Suspense, Streaming SSR, static/revalidate
  freshness, and same-route navigation remain available without a Flight
  payload, `"use client"`/`"use server"` partition, or action RPC contract.

This is not a claim that RSC is undesirable. It is a supported release boundary:
RSC must be evaluated as a whole framework contract across development,
production artifacts, cache semantics, security, the browser runtime, and all
five adapters. See [Frontend Boundaries and
Roadmap](/frontend/boundaries-and-roadmap) for the decision rule.

## Static, Revalidate, and Client-only Pages

Freshness remains a route option; it does not create a second page or route
DSL. The default is `mode: "dynamic"`. Use `mode: "static"` with concrete
`staticParams` to materialize known paths during the build:

```ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/posts/:slug",
    {
      frontend: {
        mode: "static",
        staticParams: [{ slug: "hello" }, { slug: "release-notes" }],
        tags: ["posts"],
        staticBudget: { maxParams: 20, maxBytes: 2 * 1024 * 1024 },
      },
    },
    async (_req, res) => res.render("posts/detail"),
  );
});
```

Use `mode: "revalidate"` with a positive `revalidate` interval in seconds
for a persisted freshness entry. Vext single-flights concurrent refreshes,
atomically replaces successful output, and keeps last-known-good output if a
refresh fails. `tags` allow explicit invalidation. `clientOnly: true`
preserves route, document, data, and asset behavior but intentionally omits the
server page body. These policies are not PPR.

## Hydrated Interactions

After SSR, the browser hydrates the React tree. The same props and locale messages written into the document are reused by the client entry.

Use [Hydration](/frontend/hydration) when you need to debug mismatches, measure hydration cost, or tune first-load JS.

## Scoped CSR Sub-apps

Client-router sub-apps are explicit. Configure `frontend.spaFallback.scopes[]` only for paths that should receive a browser shell.

```ts
frontend: {
  spaFallback: {
    scopes: [
      { basePath: "/app", page: "app/shell", ssr: false },
    ],
  },
}
```

Use this for highly interactive islands of the product, admin consoles with client routing, or embedded tools. It is not the default page model.

## Render Data Cache

Route response cache can cache the render payload for `res.render()`: props, layoutData, messages, head, and status. On a cache hit Vext re-renders HTML from that payload with the current frontend manifest.

Use [Render Data and Cache](/frontend/render-data-and-cache) for cache keys, invalidation, and layout data guidance.

## Choosing a Mode

| Need                              | Recommended mode                            |
| --------------------------------- | ------------------------------------------- |
| Server data on first screen       | Buffered SSR, or opt-in streaming SSR       |
| SEO or public content             | Buffered SSR, or opt-in streaming SSR       |
| Authenticated admin shell         | SSR for entry, optional scoped CSR inside   |
| Highly interactive client routing | `spaFallback.scopes[]` for that route range |
| API-only service                  | Disable frontend                            |

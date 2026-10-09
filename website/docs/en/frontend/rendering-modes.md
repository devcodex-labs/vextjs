# Rendering Modes

Vext supports a mixed full-stack frontend model without mixing server files into the browser bundle.

This page helps projects that have completed [Full-Stack Quick Start](/frontend/getting-started) choose a rendering strategy. All modes below require `frontend.enabled: true`. See [Routing and Pages](/frontend/routing-and-pages) for how route URLs relate to page files.

## Default: SSR plus Hydration

Most pages should use server rendering:

```text
route handler -> service data -> res.render() -> HTML -> hydration
```

Use this when the first screen needs data, SEO-friendly HTML, shared layouts, or authenticated server decisions.

The default `frontend.render.streaming: "buffered"` path uses `renderToString` and preserves the existing fallback behavior. `frontend.render.timeoutMs` is checked after the synchronous render returns or throws. With `fallback: "client"`, Vext returns the client shell; with `fallback: "error"`, the SSR error is surfaced to the normal error path.

This is the configuration parser's default; the full-stack scaffold explicitly sets `streaming: "auto"`. A timeout around synchronous rendering is not a hard timeout that can preempt CPU work.

## Opt-in Streaming SSR

Set `frontend.render.streaming: "auto"` when a page should flush its document shell and Suspense fallback before delayed boundaries finish:

```ts
export default {
  frontend: {
    enabled: true,
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
`staticParams`, an explicit `page`, and known public paths to materialize HTML and data files during the build. Create these two files:

```ts
// src/routes/posts.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/:slug",
    {
      validate: { param: { slug: "string" } },
      frontend: {
        mode: "static",
        page: "posts/detail",
        staticParams: [{ slug: "hello" }, { slug: "release-notes" }],
        tags: ["posts"],
        staticBudget: { maxParams: 20, maxBytes: 2097152 },
      },
    },
    (req, res) => res.render("posts/detail", { params: req.valid("param") }),
  );
});
```

```tsx
// src/frontend/pages/posts/detail.tsx
export default function PostPage(props: { params: { slug: string } }) {
  return <main>Post: {props.params.slug}</main>;
}
```

The builder renders the page directly with `{ params }`; it does not execute the route handler, authentication middleware, or service query. `frontend.page` specifies the static generation target. Do not assume it can be inferred from an arbitrary `res.render()` call. If the page depends on user data or database results injected by a handler, use dynamic SSR or provide public content as build input safe for the page to read. Build-time artifacts and runtime route freshness storage are separate paths; static generation is not an early request to the whole business API.

Use `mode: "revalidate"` with a positive `revalidate` interval in seconds for persisted runtime freshness entries. Vext single-flights concurrent refreshes, atomically replaces successful output, and keeps last-known-good output on refresh failure. This storage reuses only public GET/HEAD render payloads; authenticated or session-bearing requests bypass it. Server code can invalidate a tag with `invalidateFrontendFreshness(rootDir, { tag })`; browser `revalidate()` operates on the browser navigation cache. Do not confuse them. See [Render Data and Cache](/frontend/render-data-and-cache).

`clientOnly: true` preserves route, document, data, and asset behavior while omitting the server page body. The empty shell uses `createRoot`; completed SSR uses `hydrateRoot`. See [CSR mounting](./csr-and-spa-fallback#empty-shell-mounting-behavior). These policies are not PPR.

## Server-only HTML without Hydration

Use the existing route policy when an SSR page should ship HTML and CSS without
the Vext or React browser runtime:

This is a route snippet inside an existing `defineRoutes` factory. It assumes `src/frontend/pages/legal/terms.tsx` already default-exports a page component. The final URL also depends on the containing route file's prefix.

```ts
app.get(
  "/legal/terms",
  {
    frontend: {
      hydration: "none",
      seo: { title: "Terms", description: "Current service terms" },
    },
  },
  async (_req, res) => res.render("legal/terms"),
);
```

The response remains a full SSR document. It keeps the page body, managed SEO,
CSS, and scripts authored in `_document.html`, but omits hydration data, Vext
browser entry, React/Vext external-runtime imports, and route JS preloads.
Navigation to or from this route uses a full document request. Static mode
writes HTML without a `__vext.page.json` sidecar.

`hydration: "none"` requires SSR and cannot be combined with
`clientOnly: true`, global SSR disablement, or a per-render `ssr: false` override. It also disables streaming. It is a page-level policy, not Selective/Partial Hydration, an Islands architecture, or PPR.

## Hydrated Interactions

After SSR, the browser hydrates the React tree. The same props and locale messages written into the document are reused by the client entry.

Use [Hydration](/frontend/hydration) when you need to debug mismatches, measure hydration cost, or tune first-load JS.

## Scoped CSR Sub-apps

Client-router sub-apps are explicit. Configure `frontend.spaFallback.scopes[]` only for paths that should receive a browser shell.

Merge these fields into an existing configuration and create the `app/shell` page first. See [CSR and SPA Fallback](/frontend/csr-and-spa-fallback) for a complete path:

```ts
export default {
  frontend: {
    enabled: true,
    spaFallback: {
      scopes: [{ basePath: "/app", page: "app/shell", ssr: true }],
    },
  },
};
```

Use this for highly interactive product areas, admin consoles, or embedded tools. It is not the default page model. To try an empty shell, change `ssr` to `false` with the hydration-mismatch limitation above in mind.

## Render Data Cache

Route response cache can cache the render payload for `res.render()`: props, layoutData, messages, head, and status. On a cache hit Vext re-renders HTML from that payload with the current frontend manifest.

Use [Render Data and Cache](/frontend/render-data-and-cache) for cache keys, invalidation, and layout data guidance.

## Choosing a Mode

| Need                              | Recommended mode                            |
| --------------------------------- | ------------------------------------------- |
| Server data on first screen       | Buffered SSR, or opt-in streaming SSR       |
| SEO or public content with no JS  | SSR plus `hydration: "none"`                |
| SEO or interactive public content | Buffered SSR, or opt-in streaming SSR       |
| Authenticated admin shell         | SSR for entry, optional scoped CSR inside   |
| Highly interactive client routing | `spaFallback.scopes[]` for that route range |
| API-only service                  | Disable frontend                            |

## Verify the Selected Mode

For the static example, run `npm run build` and inspect `dist/client/posts/hello/index.html` and `dist/client/posts/release-notes/index.html` in the default output directory. Each should contain its slug. `static-manifest.json` should list both paths and their data files. If page mapping or dynamic parameters are absent, or `staticBudget` is exceeded, correct the configuration and rebuild. Then run `npm start -- --port 3000` and check `/posts/hello` at runtime. Stop the service afterward. For observations specific to first streaming bytes, no hydration, and CSR, see [SSR](/frontend/ssr), [Hydration Validation](/frontend/hydration-validation), and [CSR and SPA Fallback](/frontend/csr-and-spa-fallback).

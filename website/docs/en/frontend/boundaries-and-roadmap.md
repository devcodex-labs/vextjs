# Boundaries and Roadmap

This page separates current frontend targets from future capability tracks.

## Current Target

The current Vext frontend direction is:

- `src/frontend/**` as the user frontend source root
- `src/routes/**` as URL and server data entry
- `res.render(page, props?, options?)`
- React 19 SSR plus hydration
- route-level SSR HTML without Vext/React hydration through `frontend.hydration: "none"`
- framework SEO metadata plus build/runtime sitemap and robots through `frontend.seo`
- opt-in Streaming SSR with `frontend.render.streaming: "auto"`; `"buffered"` remains the default
- same-route page navigation with `Link`, `Form`, fetchers, revalidation, history, persistent common layouts, scroll/focus restoration, and document fallback
- route-side static, revalidate, and client-only freshness with `staticParams`, tags, single-flight, atomic replacement, and last-known-good recovery
- nested layout chain
- default error pages and `renderError()`
- Vext JSCSS plus CSS/CSS Modules
- frontend i18n with `useVextI18n(locale?)`
- Fast Refresh and render refresh in development
- esbuild-powered production build
- route assets, code splitting, size reports, budgets, deploy manifest, SRI, incremental static upload, and local image/font media closure

## Version Boundary

This section documents the current frontend capability in the Vext documentation set. For an installed package version, use that version's release notes and changelog to check exactly which frontend features are available.

## API-only Projects

API-only projects remain first-class:

```bash
npx vextjs create my-api --template api --frontend none
```

Or disable frontend in config:

```ts
export default {
  frontend: false,
};
```

## External Frontend Adapters

Vext can expose contracts for external frontend frameworks through `vextjs/frontend`, generated API artifacts, and stable HTTP boundaries. The default integrated experience remains Vext-owned full-stack React.

## Why RSC is not a current requirement

React Server Components (RSC) are not a synonym for SSR, Suspense, SEO, or
streaming HTML. Vext already supports route-owned server data, `res.render()`,
React SSR plus hydration, and opt-in `frontend.render.streaming: "auto"` with
Suspense fallbacks. Those capabilities are sufficient for the normal first-page
HTML, progressive rendering, and interactive browser-runtime path documented by
this release.

RSC would introduce a different framework-wide contract rather than a single
component feature:

1. A server/client component graph and a payload protocol must be built,
   versioned, cached, invalidated, and kept compatible with the browser entry.
2. Development, Fast Refresh/HMR, production manifests, code splitting,
   deployment output, and diagnostics must understand that graph and its
   boundaries.
3. Server Functions / Server Actions add callable server references, mutation
   semantics, CSRF/auth/error behavior, and an RPC-like transport boundary.
4. The same behavior must be observable across Native, Hono, Fastify, Express,
   and Koa without weakening Vext's route, adapter, or HTTP contracts.

The [React RSC reference](https://react.dev/reference/rsc/server-components)
describes this separate server/component environment, and React currently
advises framework authors to pin React or use Canary when implementing the
underlying bundler/framework APIs. That is evidence that RSC support must be a
deliberate, independently versioned program for Vext; it cannot be inferred
from the presence of React 19, SSR, or `renderToPipeableStream`.

Choosing not to support RSC now is therefore a valid product and operational
choice. It preserves one route-owned data path, one known browser-safe frontend
graph, stable HTTP semantics, the esbuild pipeline, and a smaller deployment
surface. Teams do not lose SSR, hydration, Suspense, streaming HTML, route-side
freshness, or same-route navigation. If a future RSC proposal is made, it must
define its payload, cache, security, development, package, adapter, and packed
consumer acceptance contracts before it can leave this non-goal list.

## Future Tracks

These are not first-phase commitments, but can be evaluated later:

- React Server Components
- Server Functions and Server Actions
- partial prerendering (PPR)
- Selective/Partial Hydration and an Islands architecture
- deeper external framework adapters

Each track needs separate requirements, performance evidence, and compatibility review before becoming default behavior.

## Current Non-goals

- hiding server imports in browser bundles
- making page files create routes automatically
- treating global SPA fallback as the default
- uploading SSR HTML as a static asset by default
- adding cloud-provider SDKs to core for asset upload
- implicitly fetching or proxying remote images, or downloading remote fonts
- treating Streaming SSR as React Server Components, Server Functions, Server Actions, or PPR
- describing page-level `hydration: "none"` as Selective Hydration, Islands, or PPR
- replacing the esbuild frontend pipeline with a Webpack/Vite/Rollup/Rolldown plugin ecosystem
- adding a parallel loader/action route DSL or function-action RPC transport

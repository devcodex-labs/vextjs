---
role: specification
---

# Boundaries and Roadmap

This page defines the current frontend capability boundaries and separates implemented features, explicitly enabled features, and directions still under consideration. It is for maintainers of frontend pages, server routes, builds, and deployments. For procedures, see [Frontend Quick Start](/frontend/getting-started); for diagnosis, see [Troubleshooting](/frontend/troubleshooting). Rule levels follow the [Specification overview](/specification/).

## Current Capabilities

The current implementation provides these capabilities, subject to the relevant configuration and route declarations:

- `src/frontend/**` as the default user frontend source root, adjustable through supported frontend configuration
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

### Conditions and Exclusions

| Capability                                    | Enablement and use                                                                                          | What it does not imply                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| React SSR and hydration                       | Enable frontend and provide a page and render route                                                         | A page file does not automatically register a URL.                                                 |
| Document without hydration                    | Set `frontend.hydration: "none"` on a route with SSR enabled                                                | This is not Islands or partial hydration; application-added scripts are not automatically removed. |
| Streaming SSR                                 | Set `frontend.render.streaming: "auto"` with effective SSR and full hydration; buffered remains the default | This is not RSC or Server Actions; `hydration: "none"` uses the non-streaming document path.       |
| Same-route client navigation                  | Use `Link`, `Form`, a compatible page protocol, and layouts                                                 | Navigation can fall back to a document request when the protocol cannot be satisfied.              |
| Static, revalidate, and client-only freshness | Declare the route and produce the corresponding build/runtime artifacts                                     | Arbitrary responses are not cached automatically; in-memory state is not shared across processes.  |
| Image and font handling                       | Provide local inputs and explicit media/deploy configuration                                                | Remote images and fonts are not downloaded by default.                                             |

Choose an implementation path with these verified limitations in mind:

- The browser entry for the [empty CSR shell](./csr-and-spa-fallback#current-limitation-of-an-empty-shell) still calls `hydrateRoot`. It may report a mismatch before recovering the display. Do not treat that as error-free CSR validation; prefer keeping shell SSR.
- [CSS Modules](./styles-and-assets#css-modules) can produce different class names in the default production SSR and browser builds. Prefer plain CSS or JSCSS for current SSR pages.
- The loader for [imported images](./styles-and-assets#imported-assets) is configured only in the browser build. SSR-registered pages should use a Public URL or a manifest-backed Image. Turning off runtime SSR does not eliminate the server bundle build.

## Route and Browser Responsibilities

<a id="vext-arch-008"></a>

### VEXT-ARCH-008 [MUST] Routes Explicitly Own URLs and Server Data

Page and layout files render content. HTTP entry points are registered under `src/routes/**`; route handlers bind a page and its data with `res.render()`. Do not equate page discovery with URL registration or assume a parallel loader/action route model. An external frontend consumes services through an explicit HTTP contract.

<a id="vext-arch-009"></a>

### VEXT-ARCH-009 [MUST NOT] Browser Dependencies Must Not Include Server-Only Modules

Database, filesystem, server configuration, and service work belongs in server consumers. The route passes the data needed by the page. Naming a directory “shared” does not make Node-only code browser-safe. The build boundary check is one verification method; it does not replace inspection of actual dependencies and transmitted data.

<a id="vext-arch-010"></a>

### VEXT-ARCH-010 [MUST] Verify Delivery Against the Actual Render and Deployment Mode

Verify the corresponding HTML, scripts, requests, and fallback behavior separately for buffered, streaming, `hydration: "none"`, and client navigation. Production must use assets and a manifest from the matching build. Enabling asset upload does not automatically upload every SSR page, and a CDN containing only static assets is not a server runtime. See [Build and Deploy](/frontend/build-and-deploy).

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

Those contracts and extension points make integration possible; they do not mean the framework includes every third-party frontend runtime adapter. For each adapter, verify the rendering, client routing, error, and deployment contracts.

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

These are neither implemented capabilities nor committed schedule items. They can be evaluated independently:

- React Server Components
- Server Functions and Server Actions
- partial prerendering (PPR)
- Selective/Partial Hydration and an Islands architecture
- deeper external framework adapters

Each track needs separate requirements, performance evidence, and compatibility review before becoming default behavior.

<a id="vext-arch-011"></a>

### VEXT-ARCH-011 [MUST NOT] Do Not Present Planned Directions as Current Usage Contracts

Release notes, operating guides, and machine-readable docs must distinguish implemented features from candidate directions. An API in React or an underlying tool does not imply that Vext provides the corresponding end-to-end capability. Before a new capability enters formal usage docs, verify its configuration, types, implementation, build artifacts, and consumer results.

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

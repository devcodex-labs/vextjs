---
role: troubleshooting
---

# Troubleshooting

First record whether the failure occurs in development or production, the current URL, status code, Content-Type, browser console and server errors, and the build version. After each correction, verify again in the same environment. Refreshing the browser alone cannot establish that production assets match the server manifest. The snippets below diagnose their respective locations; they assume the relevant pages, services, and data already exist.

## Table of Contents

- [Page Not Found](#page-not-found)
- [Server Code in Browser Bundle](#server-code-in-browser-bundle)
- [API Request Receives HTML](#api-request-receives-html)
- [Layout Data Missing](#layout-data-missing)
- [Hydration Mismatch](#hydration-mismatch)
- [Static Asset 404](#static-asset-404)
- [Large Initial JS](#large-initial-js)
- [Fast Refresh Falls Back](#fast-refresh-falls-back)
- [Current Boundaries](#current-boundaries)

## Page Not Found

If `res.render("dashboard")` cannot find a page, check:

- `src/frontend/pages/dashboard.tsx` exists.
- nested pages use the full id, such as `admin/dashboard`.
- the dev/build registry was regenerated after creating the file.

Also check `frontend.enabled`, the configured page root, and extensions. Do not guess a page ID from its filename outside the default directory. A page does not create a URL automatically; a backend route must call `res.render()`.

**Verify:** Rebuild or restart dev, request HTML at the actual route URL, and confirm the expected page appears without a page-lookup error. Distinguish an HTTP route 404 from a handler that runs but cannot find its render page; they require different fixes. See [Routing and Pages](/frontend/routing-and-pages).

## Server Code in Browser Bundle

If the build says a page crossed the server/client boundary, move server work back to the route handler.

Trace the import chain reported by the error to its source. Check `src/routes/**`, `src/services/**`, `src/config/**`, `node:*`, and `*.server.*`. Renaming a file “shared” does not remove its server dependency.

Bad:

```tsx
import { db } from "../../services/db";
```

Good:

```ts
app.get("/dashboard", {}, async (req, res) => {
  const data = await app.services.dashboard.load();
  res.render("dashboard", { data });
});
```

**Verify:** Rebuild to confirm the boundary check passes. Inspect the assets the browser actually loads and confirm the page still receives its data through the route. Removing an offending import alone may leave the page's data requirement unmet.

## API Request Receives HTML

Set `Accept: application/json` on API requests:

```ts
fetch("/api/profile", {
  headers: { accept: "application/json" },
});
```

If you use `spaFallback.scopes[]`, add API prefixes to `exclude` so the shell page never handles API URLs.

The Accept header prevents an unmatched path from being taken by an HTML fallback; it cannot turn a handler that explicitly returns HTML into JSON. Check that the real API route is registered, whether a proxy rewrites its path, and the global and scope exclusions. A broad `*/*` header can still accept HTML.

**Verify:** Request both the actual API and a nonexistent API path with `Accept: application/json`. Check their Content-Type and status against the API contract. Then request a valid SPA-scope path with `Accept: text/html` to confirm the page fallback still works. See [CSR and SPA Fallback](/frontend/csr-and-spa-fallback).

## Layout Data Missing

Pass layout data through the third render argument:

```ts
res.render("admin/dashboard", props, {
  layoutData: { admin: { menu } },
});
```

Do not import services directly from layout components.

Check that the layout is in the page's layout chain and inspect the effective global frontend.render.layout and per-render options.layout. layoutData keys resolve by actual layout ID or directory, not arbitrary component names.

**Verify:** Open the page directly and navigate to it through the client. Confirm that the corresponding layout receives its data and that the shared layout retains the expected state. See [Layouts and Components](/frontend/layouts-and-components).

## Hydration Mismatch

Make the first browser render use the same inputs as SSR:

- `props`
- `layoutData`
- `locale`
- initial `messages`

Avoid timestamps, random values, browser-only state, or locale decisions that differ between server and browser.

Check that server and browser assets came from the same build. Route `frontend.hydration: "none"` skips Vext hydration and cannot “fix” a page that needs browser interaction.

**Verify:** Clear stale caches for the page, load it directly, then navigate and interact. Confirm there are no new hydration errors in the console and that server data matches the initial client render. See [Hydration Validation](/frontend/hydration-validation).

## Static Asset 404

Check how each asset is referenced:

| File                           | Reference                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `public/logo.png`              | `/logo.png` under the default publicPath; use the actual mounted base URL if customized    |
| `src/frontend/assets/logo.png` | Direct imports are supported; check artifact URLs, inlineLimit, publicPath, and CDN prefix |

Supported image/font imports share URLs in SSR and browser builds. Type declarations only help TypeScript; missing files, unsupported formats, and deployment URL errors still require repair. See [Imported Assets](./styles-and-assets#imported-assets), [Public Assets](./styles-and-assets#public-assets), and [Media Image](./static-assets-and-cdn).

If production CDN URLs are wrong, check `frontend.deploy.assetBaseUrl`, `publicPath`, and `deploy-manifest.json`.

**Verify:** Copy real asset URLs from the generated HTML. Request JS, CSS, and images separately and check status 200, Content-Type, and content. If SRI is configured, check that the integrity value matches those same assets. With a custom outDir, inspect the actual output directory rather than an old `dist`. See [Static Assets and CDN](/frontend/static-assets-and-cdn).

## Large Initial JS

Check `size-report.json` in the actual frontend output, `dist/client/size-report.json` by default. Distinguish initial entry assets from assets loaded later on demand.

Common fixes:

- keep `frontend.i18n.clientLoad="current"`
- split large shared components
- avoid importing admin-only UI into root layout
- keep React external/CDN as opt-in with version-lock and SRI strategy
- inspect route initial assets before raising budgets

**Verify:** Compare this route's initial assets and compressed size using the same build options. Inspect the browser Network panel to see whether the first navigation really transfers less. Staying within a budget does not prove acceptable network or interaction performance. See [Performance Budgets](/frontend/performance-budgets).

## Fast Refresh Falls Back

Fast Refresh can fall back when the module is not refresh-safe.

Check:

- `frontend.dev.fastRefresh` is enabled.
- the component file does not import server modules.
- the file exports React components cleanly.
- `_document.html` or runtime-critical files did not change.

A full-page refresh can be the correct fallback. Do not bypass it solely to preserve component state.

**Verify:** Change only text or styling in an ordinary component, then change the document separately. Observe whether the refresh type and console diagnostics correspond to each change. See [Fast Refresh](/frontend/fast-refresh).

## Current Boundaries

Current default path:

- React 19 SSR + hydration
- esbuild frontend build
- route handler `res.render()`
- Vext JSCSS / CSS Modules / static assets
- route-specific modulepreload
- compressed size budgets
- client navigation and shared-layout persistence when the page protocol is compatible, with document-navigation fallback otherwise
- local Image/defineFont media handling; remote images require an explicit loader, and the framework does not download remote fonts automatically

Available but opt-in:

- Streaming SSR with `frontend.render.streaming: "auto"`; the default remains `"buffered"`.

Not currently provided as implemented end-to-end capabilities:

- React Server Components
- Server Functions and Server Actions
- partial prerendering (PPR)
- Selective/Partial Hydration and Islands

Do not mistake supported, configured features for roadmap ideas or equate Streaming SSR with RSC. See [Boundaries and Roadmap](/frontend/boundaries-and-roadmap) for the full rules.

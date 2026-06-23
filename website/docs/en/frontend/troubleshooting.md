# Troubleshooting

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

## Server Code in Browser Bundle

If the build says a page crossed the server/client boundary, move server work back to the route handler.

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

## API Request Receives HTML

Set `Accept: application/json` on API requests:

```ts
fetch("/api/profile", {
  headers: { accept: "application/json" },
});
```

If you use `spaFallback.scopes[]`, add API prefixes to `exclude` so the shell page never handles API URLs.

## Layout Data Missing

Pass layout data through the third render argument:

```ts
res.render("admin/dashboard", props, {
  layoutData: { admin: { menu } },
});
```

Do not import services directly from layout components.

## Hydration Mismatch

Make the first browser render use the same inputs as SSR:

- `props`
- `layoutData`
- `locale`
- initial `messages`

Avoid timestamps, random values, browser-only state, or locale decisions that differ between server and browser.

## Static Asset 404

Use the correct source:

| File | Reference |
|------|-----------|
| `public/logo.png` | `/logo.png` |
| `src/frontend/assets/logo.png` | `import logoUrl from "@assets/logo.png"` |

If production CDN URLs are wrong, check `frontend.deploy.assetBaseUrl`, `publicPath`, and `deploy-manifest.json`.

## Large Initial JS

Check `dist/client/size-report.json`.

Common fixes:

- keep `frontend.i18n.clientLoad="current"`
- split large shared components
- avoid importing admin-only UI into root layout
- keep React external/CDN as opt-in with version-lock and SRI strategy
- inspect route initial assets before raising budgets

## Fast Refresh Falls Back

Fast Refresh can fall back when the module is not refresh-safe.

Check:

- `frontend.dev.fastRefresh` is enabled.
- the component file does not import server modules.
- the file exports React components cleanly.
- `_document.html` or runtime-critical files did not change.

## Current Boundaries

Current default path:

- React 19 SSR + hydration
- esbuild frontend build
- route handler `res.render()`
- Vext JSCSS / CSS Modules / static assets
- route-specific modulepreload
- compressed size budgets

Not default in this phase:

- React Server Components
- Server Actions
- streaming SSR
- persistent client layout navigation
- built-in image/font optimization components

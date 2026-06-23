# Build, Deploy, and Performance

## Table of Contents

- [Styles](#styles)
- [Assets](#assets)
- [Development Refresh](#development-refresh)
- [Production Build](#production-build)
- [CDN and Incremental Upload](#cdn-and-incremental-upload)
- [SPA Fallback](#spa-fallback)
- [Performance Budgets](#performance-budgets)
- [Hydration Validation](#hydration-validation)
- [Boundaries](#boundaries)

## Styles

Vext supports ordinary CSS, CSS Modules, and Vext JSCSS.

```tsx
import styles from "@styles/dashboard.module.css";

export default function Dashboard() {
  return <main className={styles.page}>Dashboard</main>;
}
```

JSCSS is the default dynamic styling facade:

```ts
// src/frontend/styles/card.style.ts
import { style, vars } from "vextjs/style";

export const card = style({
  padding: 16,
  borderRadius: 8,
  color: vars.color.text,
});
```

JSCSS files are extracted during build and merged into the final CSS asset without adding Emotion or styled-components as default runtime dependencies.

## Assets

Use two asset locations:

| Location | Use for |
|----------|---------|
| `src/frontend/assets/**` | Imported images, fonts, and files that should go through the esbuild asset graph. |
| `public/**` | Public files addressed by URL, such as `/favicon.svg` or `/robots.txt`. |

Imported assets are content-hashed in production. `public/**` files are copied into the frontend output and included in the deploy manifest.

## Development Refresh

`vext dev` watches `src/frontend/**` and `public/**`.

| Change | Result |
|--------|--------|
| React page/component | Frontend rebuild with React Fast Refresh when possible |
| CSS/JSCSS only | CSS update path |
| Public asset | Frontend rebuild/copy |
| Route or service data used by SSR | Backend soft reload plus optional render refresh prompt |

Use `frontend.dev.renderRefresh` to control whether route/service changes trigger a browser prompt, automatic reload, or log-only behavior.

## Production Build

`vext build` compiles the server and the frontend. When frontend is enabled it writes:

```text
dist/client/
  index.html
  manifest.json
  render-manifest.json
  deploy-manifest.json
  size-report.json
  assets/
```

The browser client uses dynamic imports for pages, layouts, error pages, and locales. Vext-managed vendor chunks keep shared runtime packages out of every page chunk.

`vext start` requires a valid `dist/client/index.html` and a render manifest with route assets. If a stale production build is missing the B3 route asset schema, start fails fast and asks you to rebuild.

## CDN and Incremental Upload

Enable upload in `frontend.deploy.upload`:

```ts
export default {
  frontend: {
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      integrity: true,
      upload: {
        enabled: true,
        adapter: "filesystem",
        targetDir: ".vext/frontend-cdn",
        publicBaseUrl: "https://cdn.example.com/my-app/",
        prefix: "my-app",
        stateFile: ".vext/deploy/frontend-assets-state.json",
        exclude: ["**/*.map"],
      },
    },
  },
};
```

Then run:

```bash
vext build --upload-assets
vext deploy assets --dry-run
vext deploy assets
```

Upload uses `deploy-manifest.json`, sha256 state, content type, and SRI. Unchanged JS, CSS, images, fonts, and copied `public/**` assets are skipped. Server-rendered `index.html` is not uploaded by default.

## SPA Fallback

The default Vext page model is SSR. `spaFallback.scopes[]` is only for explicit client-router sub-apps.

```ts
frontend: {
  spaFallback: {
    scopes: [
      {
        basePath: "/app",
        page: "app/shell",
        ssr: false,
      },
    ],
  },
}
```

Only HTML navigations inside a configured scope receive the shell page. API requests, JSON requests, explicit routes, and static assets keep their normal behavior.

## Performance Budgets

Use compressed budgets for user-facing performance:

```ts
frontend: {
  build: {
    budgets: {
      maxInitialJsBrotliBytes: 60_000,
      maxRouteInitialJsBrotliBytes: 80_000,
      maxAppOwnedInitialJsBrotliBytes: 40_000,
    },
    diagnostics: {
      performanceReport: true,
      leakScan: true,
    },
  },
}
```

`size-report.json` includes raw, gzip, brotli, initial JS, route initial assets, app-owned assets, and external runtime groups. Budget failures tell you which route or asset crossed the threshold.

## Hydration Validation

Vext marks hydration with DOM and Performance API signals:

- `data-vext-hydration="hydrating"`
- `data-vext-hydration="done"`
- `performance.measure("vext:hydration")`

The `vext-test` consumer project verifies a real browser page with Playwright and checks:

- no failed frontend resources
- no bad HTTP responses
- no console errors
- route-specific `modulepreload`
- hydration marker reaches `done`
- `vext:hydration` measure exists
- `size-report.json` contains route metrics

## Boundaries

The current default route is React 19 SSR plus hydration.

Not default in this phase:

- Vite as the frontend builder
- React Server Components
- Server Actions
- Qwik or Astro architecture changes
- streaming SSR
- persistent client layout navigation
- built-in image/font optimization components

Those can be evaluated later as separate capability tracks. The current priority is to keep the esbuild + React hydration path fast, small, observable, and predictable.


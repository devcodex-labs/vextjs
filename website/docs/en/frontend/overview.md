# Frontend Overview

## Table of Contents

- [Current Capabilities](#current-capabilities)
- [What Vext Frontend Is](#what-vext-frontend-is)
- [Create a Full-stack Project](#create-a-full-stack-project)
- [Project Structure](#project-structure)
- [First Page](#first-page)
- [Reading Paths](#reading-paths)

## Current Capabilities

This Frontend guide documents the current built-in Vext frontend capability: route-driven React 19 pages, SSR, hydration, nested layouts, frontend i18n, Fast Refresh, render refresh, code splitting, static assets, CDN upload, performance budgets, and hydration validation.

## What Vext Frontend Is

Vext Frontend is the built-in full-stack React 19 experience for Vext projects. The URL still belongs to `src/routes/**`; the route handler prepares server data and calls `res.render()` to render a page from `src/frontend/pages/**`.

Use it when you want one Vext application to own API routes, services, SSR, hydration, frontend assets, and production static serving without adding a second application framework.

Use `--template api --frontend none` when the project is API-only.

## Create a Full-stack Project

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

The default scaffold is a full-stack React project. The frontend can still be disabled in config or created as API-only:

```bash
npx vextjs create my-api --template api --frontend none
```

## Project Structure

```text
src/
  routes/
    index.ts
    admin/
      dashboard.ts
  services/
    user.service.ts
  frontend/
    pages/
      index.tsx
      layout.tsx
      error/
        default.tsx
    components/
      UserCard.tsx
    styles/
      card.style.ts
      dashboard.module.css
    assets/
      logo.png
    locales/
      en-US.ts
      zh-CN.ts
public/
  favicon.svg
```

The important boundary is physical:

- `src/routes/**` and `src/services/**` run on the server.
- `src/frontend/pages/**` and `src/frontend/components/**` are bundled for the browser.
- Do not import services, database clients, secrets, or Node-only modules from frontend files.
- `public/**` is copied to the frontend output and can be published through the deploy manifest.

## First Page

Create a page:

```tsx
// src/frontend/pages/index.tsx
export default function HomePage(props: { greeting: string }) {
  return <main>{props.greeting}</main>;
}
```

Render it from a route:

```ts
// src/routes/index.ts
export default (app) => {
  app.get("/", {}, async (req, res) => {
    const greeting = await app.services.example.greeting("Vext");
    res.render("index", { greeting });
  });
};
```

`res.render(page, props?, options?)` has three arguments:

| Argument | Meaning |
|----------|---------|
| `page` | Page id under `src/frontend/pages/**`, without extension. `admin/dashboard.tsx` becomes `"admin/dashboard"`. |
| `props` | JSON-safe server data serialized into the SSR document and reused during hydration. |
| `options` | Rendering options such as `status`, `head`, `layoutData`, `messages`, `nonce`, or page-specific behavior. |

## Reading Paths

Use the left navigation as the main map. It is intentionally split into concept, task, and reference layers.

| Need | Start here |
|------|------------|
| First successful page | [Getting Started](/frontend/getting-started) |
| Understand URL and page ownership | [Routing and Pages](/frontend/routing-and-pages) |
| Choose SSR, hydration, or CSR | [Rendering Modes](/frontend/rendering-modes) |
| Pass service data to pages | [Data Flow](/frontend/data-flow) |
| Build nested shells | [Layouts and Components](/frontend/layouts-and-components) |
| Debug SSR output | [SSR](/frontend/ssr) |
| Debug browser attach/mismatch | [Hydration](/frontend/hydration) |
| Build a client-router sub-app | [CSR and SPA Fallback](/frontend/csr-and-spa-fallback) |
| Cache render data | [Render Data and Cache](/frontend/render-data-and-cache) |
| Tune development feedback | [Fast Refresh](/frontend/fast-refresh) and [Render Refresh](/frontend/render-refresh) |
| Ship frontend assets | [Build and Deploy](/frontend/build-and-deploy) and [Static Assets and CDN](/frontend/static-assets-and-cdn) |
| Keep JS small | [Code Splitting](/frontend/code-splitting) and [Performance Budgets](/frontend/performance-budgets) |
| Validate production hydration | [Hydration Validation](/frontend/hydration-validation) |
| Find config fields | [Configuration](/frontend/configuration) |
| Check current boundaries | [Boundaries and Roadmap](/frontend/boundaries-and-roadmap) |

The old [Frontend integration page](/guide/frontend) is kept only as a compatibility entry for existing links.

# Frontend Overview

## Table of Contents

- [Current Status](#current-status)
- [What Vext Frontend Is](#what-vext-frontend-is)
- [Create a Full-stack Project](#create-a-full-stack-project)
- [Project Structure](#project-structure)
- [First Page](#first-page)
- [Where to Go Next](#where-to-go-next)

## Current Status

This Frontend guide describes the target user experience for the in-development Vext built-in frontend capability. Treat the APIs here as the implementation target until the next stable release documents them as released features.

## What Vext Frontend Is

Vext Frontend is the built-in full-stack React 19 experience for Vext projects. It is not a separate frontend framework and it is not based on Vite. The URL still belongs to `src/routes/**`; the route handler prepares server data and calls `res.render()` to render a page from `src/frontend/pages/**`.

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

## Where to Go Next

- [Project Structure](/frontend/project-structure): where pages, components, layouts, styles, assets, locales, and generated files live.
- [Pages and Rendering](/frontend/pages-and-rendering): route-driven rendering, `res.render()`, SSR, hydration, and SPA fallback boundaries.
- [Data and API Calls](/frontend/data-and-api): service data, render props, render cache reuse, client API calls, and generated API contracts.
- [Layouts and Components](/frontend/layouts-and-components): nested layouts, layout data, admin shells, public components, and SSR-safe component rules.
- [Styles and Assets](/frontend/styles-and-assets): CSS, CSS Modules, Vext JSCSS, static files, imported assets, public files, and CDN URLs.
- [I18n](/frontend/i18n): locale resolution, frontend dictionaries, `useVextI18n(locale)`, switching language, and cache headers.
- [Errors and Document](/frontend/errors-and-document): default error pages, `renderError()`, `_document.html`, HTML tokens, head injection, and CSP nonce.
- [Dev Workflow](/frontend/dev-workflow): React Fast Refresh, CSS updates, route render refresh, full reload, and leak diagnostics.
- [Build, Deploy, and Performance](/frontend/build-deploy-performance): output files, code splitting, CDN upload, budgets, route assets, and hydration validation.
- [Configuration](/frontend/configuration): practical `frontend` config examples and field guide.
- [Troubleshooting](/frontend/troubleshooting): common setup, rendering, import, asset, hydration, and performance issues.
- [Legacy Frontend integration page](/guide/frontend): compatibility entry kept for existing links.

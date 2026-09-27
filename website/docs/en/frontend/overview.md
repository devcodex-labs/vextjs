# Frontend Overview

## Table of Contents

- [What Vext Frontend Is](#what-vext-frontend-is)
- [Create a Full-stack Project](#create-a-full-stack-project)
- [Project Structure](#project-structure)
- [First Page](#first-page)
- [Current Capabilities](#current-capabilities)
- [Reading Paths](#reading-paths)

## What Vext Frontend Is

Vext Frontend is the built-in full-stack React 19 experience for Vext projects. The URL still belongs to `src/routes/**`; the route handler prepares server data and calls `res.render()` to render a page from `src/frontend/pages/**`.

Use it when one app needs APIs, server-rendered pages, and browser interaction. A page request follows this path:

```text
Browser GET / → server route → prepare props → res.render("index", props)
              → React server HTML → browser hydration (when enabled)
```

Page components also run during SSR, so reading browser globals such as `window` while rendering can fail. Keep database and upstream calls in routes/services. Props are exposed to the browser and should contain only data the page needs.

Use `--template api --frontend none` when the project is API-only.

## Create a Full-stack Project

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

Install a Node.js and npm version satisfying the current Vext package; see the [general quick start](/guide/quick-start). The default command generates a TypeScript full-stack React app and runs `npm install` automatically. If installation fails or `--skip-install` is used, run `npm install` in the project before starting. Open the address printed by the terminal, normally `http://localhost:3000/`. For an API-only app:

```bash
npx vextjs create my-api --template api --frontend none
```

## Project Structure

These are the main files in the default TypeScript full-stack starter; see [Project Structure](/frontend/project-structure) for configuration, types, and generated output.

```text
src/
  config/
    default.ts
  routes/
    index.ts
  services/
    example.ts
  frontend/
    pages/
      index.tsx
      layout.tsx
      _document.html
      error/
        default.tsx
    components/
      AppShell.tsx
    styles/
      index.css
    locales/
      en-US.ts
public/
  vext-mark.svg
  favicon.svg
```

The important boundary is physical:

- `src/routes/**` and `src/services/**` run on the server.
- `src/frontend/pages/**` and `src/frontend/components/**` are UI sources used by SSR and browser builds according to render mode; a page file alone does not register a URL.
- Do not import services, database clients, secrets, or Node-only modules from frontend files.
- `public/**` holds fixed-path files copied into the frontend build and recorded in the deploy manifest; recording them does not upload them to a CDN.
- Add `src/frontend/assets/**`, other languages, and business pages as needed; they are not already in the default starter.

## First Page

In a newly created full-stack app, replace both the home page and its route with the complete examples below. Replacing the whole original route removes its starter API handlers; retain them if needed. No additional business service is required.

```tsx
// src/frontend/pages/index.tsx
export default function HomePage(props: { greeting: string }) {
  return <main>{props.greeting}</main>;
}
```

Render it from a route:

```ts
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => {
    res.render("index", { greeting: "Hello from Vext" });
  });
});
```

Visit `/` and expect `Hello from Vext` in the HTML. If the response is HTML without that text, inspect terminal errors, frontend enablement, and the page ID. See [Getting Started](/frontend/getting-started) for a complete walkthrough.

`res.render(page, props?, options?)` has three arguments:

| Argument  | Meaning                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`    | Page id under `src/frontend/pages/**`, without extension. `admin/dashboard.tsx` becomes `"admin/dashboard"`.                                                                 |
| `props`   | JSON-safe page data, written into the document and reused by the browser in normal hydration mode; do not pass database connections, functions, or private config.           |
| `options` | Per-render options such as `status`, `head`, `ssr`, `layout`, `layoutData`, `messages`, and `nonce`; see focused pages for route-level freshness and hydration declarations. |

## Current Capabilities

These features have separate conditions. React 19 or the default starter alone does not imply that every feature is enabled:

| Capability                                  | Main condition or boundary                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| SSR, hydration, layouts, error pages        | Enable frontend and bind an explicit render route; page files do not create URLs.                                                |
| Streaming SSR                               | Global default is `buffered`; the full-stack starter explicitly sets `streaming: "auto"`. No-hydration mode has separate limits. |
| Frontend i18n                               | Enable frontend i18n and provide dictionaries. The starter has only `en-US` and does not translate content automatically.        |
| Fast Refresh and Render Refresh             | Development-only, with separate settings and trigger scopes.                                                                     |
| Splitting, styles, assets, budgets          | The frontend build produces resources and reports; budgets need explicit thresholds.                                             |
| CDN upload and hydration validation         | Require a deployment target or an accessible running site; project creation does not perform them.                               |
| Same-route navigation and static generation | Require the matching page protocol, route declarations, and output; they do not imply RSC or Server Actions.                     |

See [Boundaries and Roadmap](/frontend/boundaries-and-roadmap) for details. Browser assets and server output must come from matching builds. Deploying static files does not replace the Vext server process.

## Reading Paths

Use the left navigation as the main map. It is intentionally split into concept, task, and reference layers.

| Need                                             | Start here                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| First successful page                            | [Getting Started](/frontend/getting-started)                                                                |
| Understand URL and page ownership                | [Routing and Pages](/frontend/routing-and-pages)                                                            |
| Choose SSR, hydration, or CSR                    | [Rendering Modes](/frontend/rendering-modes)                                                                |
| Pass service data to pages                       | [Data Flow](/frontend/data-flow)                                                                            |
| Build nested shells                              | [Layouts and Components](/frontend/layouts-and-components)                                                  |
| Debug SSR output                                 | [SSR](/frontend/ssr)                                                                                        |
| Style a component with variants or CSS variables | [Vext JSCSS](/frontend/jscss)                                                                               |
| Debug browser attach/mismatch                    | [Hydration](/frontend/hydration)                                                                            |
| Build a client-router sub-app                    | [CSR and SPA Fallback](/frontend/csr-and-spa-fallback)                                                      |
| Cache render data                                | [Render Data and Cache](/frontend/render-data-and-cache)                                                    |
| Tune development feedback                        | [Fast Refresh](/frontend/fast-refresh) and [Render Refresh](/frontend/render-refresh)                       |
| Ship frontend assets                             | [Build and Deploy](/frontend/build-and-deploy) and [Static Assets and CDN](/frontend/static-assets-and-cdn) |
| Keep JS small                                    | [Code Splitting](/frontend/code-splitting) and [Performance Budgets](/frontend/performance-budgets)         |
| Validate production hydration                    | [Hydration Validation](/frontend/hydration-validation)                                                      |
| Find config fields                               | [Configuration](/frontend/configuration)                                                                    |
| Check current boundaries                         | [Boundaries and Roadmap](/frontend/boundaries-and-roadmap)                                                  |

The [Frontend integration page](/guide/frontend) connects the backend guide to this section and retains older links.

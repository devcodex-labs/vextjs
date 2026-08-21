# Project Structure

## Table of Contents

- [Default Layout](#default-layout)
- [Frontend Source Boundary](#frontend-source-boundary)
- [Type Boundaries](#type-boundaries)
- [Generated Files](#generated-files)
- [Aliases](#aliases)
- [Static Files](#static-files)
- [API-only Projects](#api-only-projects)

## Default Layout

The default `vext create` scaffold is a full-stack project. Frontend source is grouped under `src/frontend/**` so server code and browser code stay physically separate.

```text
src/
  routes/
    index.ts
    api/
      users.ts
  services/
    user.service.ts
  types/
    generated/
    shared/
      greeting.d.ts
    frontend/
      home.d.ts
  frontend/
    pages/
      index.tsx
      layout.tsx
      _document.html
      admin/
        layout.tsx
        dashboard.tsx
      error/
        default.tsx
        404.tsx
    components/
      AppShell.tsx
      UserMenu.tsx
    styles/
      app.css
      dashboard.module.css
      card.style.ts
    assets/
      logo.png
      hero.avif
    locales/
      en-US.ts
      zh-CN.ts
public/
  favicon.svg
  robots.txt
```

Use the root `public/**` directory for URL-addressed files. Use `src/frontend/assets/**` for imported files that should be hashed and tracked by the frontend asset graph.

## Frontend Source Boundary

Server and browser files are intentionally separate.

| Location | Runs in | Use for |
|----------|---------|---------|
| `src/routes/**` | server | URL definitions, `res.render()`, API responses, auth checks, service calls |
| `src/services/**` | server | database access, upstream calls, business logic |
| `src/frontend/pages/**` | server SSR + browser hydration | React pages, layouts, error pages, document template |
| `src/frontend/components/**` | server SSR + browser hydration | reusable UI components |
| `src/frontend/styles/**` | build/browser | CSS, CSS Modules, JSCSS |
| `src/frontend/assets/**` | build/browser | imported images, fonts, and media |
| `src/frontend/locales/**` | server SSR + browser hydration | frontend page copy |

Do not import `src/services/**`, database clients, secrets, `node:*`, or route handlers from `src/frontend/**`. The build leak scanner blocks this because server code must never enter the browser bundle.

## Type Boundaries

The TypeScript full-stack starter makes type ownership visible without creating a second backend tree:

| Location                 | Owner            | Use for                                                                                                                                                                                  |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/generated/**` | Vext tooling     | Output refreshed by `vext typegen`. Do not hand-edit generated declarations.                                                                                                             |
| `src/types/shared/**`    | Your application | Serializable data contracts shared by server code and the UI. The starter's `GreetingDto` is one example.                                                                                |
| `src/types/frontend/**`  | Your application | Page and render contracts shared by a rendering route and `src/frontend/**`. The starter's `HomePageProps` is one example. Keep server-only implementation details out of this boundary. |

`vext typegen` writes only `src/types/generated/**`; it does not rewrite `shared/**` or `frontend/**`.

| Starter                                                | Initial type directories                       |
| ------------------------------------------------------ | ---------------------------------------------- |
| TypeScript full-stack (default)                        | `generated/**`, `shared/**`, and `frontend/**` |
| TypeScript API-only (`--template api --frontend none`) | `generated/**` only                            |
| JavaScript starter                                     | No `src/types` directory                       |

The scaffold does not reserve `src/types/server/**`. Keep a server-only type next to its route or service owner; introduce an application-specific server folder only after you have a real shared server boundary.

## Generated Files

Vext generates browser and SSR entries for you.

```text
.vext/
  generated/
    frontend/
      browser-entry.tsx
      render-entry.tsx
      page-registry.ts
      layout-registry.ts
      locale-registry.ts
  client/
    index.html
    manifest.json
    render-manifest.json
dist/
  client/
    index.html
    manifest.json
    render-manifest.json
    deploy-manifest.json
    size-report.json
    assets/
```

You normally edit `src/frontend/**`, not `.vext/generated/frontend/**`. Development output goes to `.vext/client/`; production output goes to `dist/client/`.

## Aliases

The frontend resolver provides stable aliases so imports do not depend on deep relative paths.

| Alias | Points to |
|-------|-----------|
| `@frontend` | `src/frontend` |
| `@pages` | `src/frontend/pages` |
| `@components` | `src/frontend/components` |
| `@styles` | `src/frontend/styles` |
| `@assets` | `src/frontend/assets` |

```tsx
import { UserMenu } from "@components/UserMenu";
import styles from "@styles/dashboard.module.css";
import logoUrl from "@assets/logo.png";
```

## Static Files

Use `public/**` when a file needs a stable URL:

```tsx
export function BrandIcon() {
  return <img src="/favicon.svg" alt="Vext" />;
}
```

Use `src/frontend/assets/**` when the file is part of a component and should be hashed by the build:

```tsx
import heroUrl from "@assets/hero.avif";

export function Hero() {
  return <img src={heroUrl} alt="" />;
}
```

## API-only Projects

Disable frontend at creation time:

```bash
npx vextjs create my-api --template api --frontend none
```

Or disable it in config:

```ts
export default {
  frontend: false,
};
```

When `frontend.enabled=false`, Vext should not build frontend assets, mount frontend static files, or add frontend watchers to pure API projects.

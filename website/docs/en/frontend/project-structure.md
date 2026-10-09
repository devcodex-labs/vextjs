# Project Structure

Use this page to decide who owns a file, where it runs, and which artifacts tools generate. Complete [Getting Started](/frontend/getting-started) first. Paths below reflect the default TypeScript full-stack template; see [Frontend Configuration](/frontend/configuration) for configurable paths.

## Table of Contents

- [Default Layout](#default-layout)
- [Frontend Source Boundary](#frontend-source-boundary)
- [Type Boundaries](#type-boundaries)
- [Generated Files](#generated-files)
- [Aliases](#aliases)
- [Static Files](#static-files)
- [API-only Projects](#api-only-projects)
- [Verify Directory Changes](#verify-directory-changes)

## Default Layout

`npx vextjs create my-app` creates a TypeScript full-stack project by default. This is its main source layout; environment and bootstrap configuration files also appear under `config`, as explained in [Server Project Structure](/guide/project-structure).

```text
src/
  config/
    default.ts
  routes/
    index.ts
  services/
    example.ts
  types/
    generated/
      .gitkeep
    shared/
      greeting.d.ts
    frontend/
      home.d.ts
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
  favicon.svg
  vext-mark.svg
```

Add business files as needed; the template does not create every directory below in advance:

| Task                      | Location and accompanying work                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a dashboard page      | `src/frontend/pages/admin/dashboard.tsx` and register `/` in `src/routes/admin/dashboard.ts`; the page does not create a URL                                                                               |
| Add reusable UI           | `src/frontend/components/UserMenu.tsx`, imported by a page or layout                                                                                                                                       |
| Add a shared admin layout | `src/frontend/pages/admin/layout.tsx`; see [Layouts and Components](/frontend/layouts-and-components) for inheritance and data                                                                             |
| Add page styles           | For default SSR, prefer `src/frontend/styles/card.style.ts` (JSCSS) or plain CSS, imported and used by UI; see [Styles and Assets](./styles-and-assets#css-modules) for production CSS Modules limitations |
| Add another locale        | `src/frontend/locales/zh-CN.ts`, with locale configuration and copy coverage checked                                                                                                                       |
| Add a 404 page            | `src/frontend/pages/error/404.tsx`, mapped as described in [Error Pages and Document](/frontend/errors-and-document)                                                                                       |

Put URL-addressed files under `public/**`. `src/frontend/assets/**` is for files in the browser build graph. Directly importing an image in a current SSR page has a build limitation; use the Public URL example below first. Inlining and hashing depend on the actual build configuration.

## Frontend Source Boundary

Server and browser files are intentionally separate.

| Location                     | Runs in                        | Use for                                                                    |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `src/routes/**`              | server                         | URL definitions, `res.render()`, API responses, auth checks, service calls |
| `src/services/**`            | server                         | database access, upstream calls, business logic                            |
| `src/frontend/pages/**`      | server SSR + browser hydration | React pages, layouts, error pages, document template                       |
| `src/frontend/components/**` | server SSR + browser hydration | reusable UI components                                                     |
| `src/frontend/styles/**`     | build/browser                  | CSS, CSS Modules, JSCSS                                                    |
| `src/frontend/assets/**`     | build/browser                  | imported images, fonts, and media                                          |
| `src/frontend/locales/**`    | server SSR + browser hydration | frontend page copy                                                         |

Do not import `src/services/**`, database clients, secrets, `node:*`, or route handlers from `src/frontend/**`. The default `frontend.build.diagnostics.leakScan` checks known server paths and Node module boundaries; it does not detect all private data or third-party side effects. Inspect real dependencies even in a shared directory. Disabling the scan does not make server code browser-safe.

The page/component runtime locations above assume SSR and hydration are enabled; disabling either changes the corresponding execution stage. During SSR, do not access `window` or `document` unconditionally. `pages/_document.html` is a document template, not a React page component.

## Type Boundaries

The TypeScript full-stack starter makes type ownership visible without creating a second backend tree:

| Location                 | Owner            | Use for                                                                                                                                                                                  |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/generated/**` | Vext tooling     | Generated declaration bridge for hidden type output; do not hand-edit.                                                                                                                   |
| `src/types/shared/**`    | Your application | Serializable data contracts shared by server code and the UI. The starter's `GreetingDto` is one example.                                                                                |
| `src/types/frontend/**`  | Your application | Page and render contracts shared by a rendering route and `src/frontend/**`. The starter's `HomePageProps` is one example. Keep server-only implementation details out of this boundary. |

The main `vext typegen` declarations are `.vext/types/services.generated.d.ts` and `.vext/types/app-extensions.generated.d.ts`. In TypeScript projects, `src/types/generated/index.d.ts` references them. Command options select which declarations are written; `--write-manifest` also writes `.vext/manifest/services.json`. Tooling does not rewrite application-owned `shared/**` or `frontend/**`, and placing a type there does not automatically make its data serializable.

| Starter                                                | Initial type directories                       |
| ------------------------------------------------------ | ---------------------------------------------- |
| TypeScript full-stack (default)                        | `generated/**`, `shared/**`, and `frontend/**` |
| TypeScript API-only (`--template api --frontend none`) | `generated/**` only                            |
| JavaScript starter                                     | No `src/types` directory                       |

The scaffold does not reserve `src/types/server/**`. Keep a server-only type next to its route or service owner; introduce an application-specific server folder only after you have a real shared server boundary.

## Generated Files

The frontend build generates browser and SSR entries and registries. These are the main artifacts in the default layout; optional features add files, so this is not a complete deployment inventory.

```text
.vext/
  generated/
    frontend/
      browser-entry.tsx
      server-renderer.ts
      page-registry.ts
      vext-runtime.tsx
  types/
    services.generated.d.ts
    app-extensions.generated.d.ts
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
    public-manifest.json
    client-contract.json
    route-contract.json
    server/
      renderer.cjs
    assets/
```

Application maintainers edit their routes, services, UI, configuration, types under `src`, and `public` assets. Do not hand-edit `.vext/generated/frontend/**` or generated declarations. Pages, layouts, and error pages are registered in `page-registry.ts`. When frontend i18n is enabled, dictionaries are scanned into that same registry. Separate `layout-registry.ts` and `locale-registry.ts` are not generated.

Frontend development output defaults to `.vext/client/`, production output to `dist/client/`; `frontend.outDir` may override it. See the [Build guide](/guide/build) for how CLI `--outdir` interacts with this setting. Deliver the SSR renderer and browser assets together; uploading only `assets/` does not publish server-rendered pages.

## Aliases

The frontend resolver provides these default aliases:

| Alias         | Points to                 |
| ------------- | ------------------------- |
| `@frontend`   | `src/frontend`            |
| `@pages`      | `src/frontend/pages`      |
| `@components` | `src/frontend/components` |
| `@styles`     | `src/frontend/styles`     |
| `@assets`     | `src/frontend/assets`     |

```tsx
import { Stat } from "@components/Stat";
```

This imports the component created in Getting Started. When you change `frontend.root`, `pages.dir`, `componentsDir`, `assetsDir`, or `styles.entry`, default aliases follow the resolved directories; `@styles` points to the style-entry directory. Custom `frontend.alias` values resolve relative to the frontend root and may override a default. Keep TypeScript editor `paths` in `tsconfig.json` aligned; the runtime resolver does not rewrite that configuration.

`root`, `publicDir`, and `entry` paths are relative to the project root, while page, component, style, and asset paths are usually relative to the frontend root. Check each field in [Frontend Configuration](/frontend/configuration) before moving directories.

## Static Files

Under the default `publicPath: "/"`, the template's existing `public/favicon.svg` can be referenced by this embeddable component:

```tsx
export function BrandIcon() {
  return <img src="/favicon.svg" alt="Vext" />;
}
```

To display the template mark, reference its existing Public asset as well:

```tsx
export function Hero() {
  return <img src="/vext-mark.svg" alt="Vext" />;
}
```

The current browser build has loaders for PNG, SVG, and similar resources, but the SSR build lacks the corresponding image loader. Directly importing an image into a page or its component can fail the build that includes that page. A type declaration or disabling runtime SSR does not supply that build step. This example uses a Public URL and does not ask readers to edit generated files or add a build plugin.

For an existing browser-only entry where importing an asset is supported, a missing TypeScript module declaration can be added in an application-owned type directory:

```ts
// src/types/frontend/assets.d.ts
declare module "*.svg" {
  const url: string;
  export default url;
}
```

The declaration only helps type checking; the file and build loader must still exist. It cannot solve the SSR limitation above. See [Styles and Assets](/frontend/styles-and-assets) for formats, CSS Modules, and media handling.

`public/**` is copied into frontend output and its static asset inventory. Do not place server configuration or other private files there. Local development and production servers serve it under the configured `publicPath`; see [Static Assets and CDN](/frontend/static-assets-and-cdn) for CDN rewriting.

## API-only Projects

Disable frontend at creation time:

```bash
npx vextjs create my-api --template api --frontend none
```

For an existing project, merge this configuration fragment into the default config:

```ts
export default {
  frontend: false,
};
```

Both `frontend: false` and `{ enabled: false }` disable built-in frontend build and static/page handling. Existing routes that call `res.render()` must be changed to API responses or removed, or they will report that frontend is disabled. Changing configuration does not automatically delete old build directories from disk.

## Verify Directory Changes

Run these existing commands in the application root:

```bash
npx vextjs typegen
npx vextjs typegen --check
npm run build
```

`typegen --check` checks that generated files match current source and runs its own diagnostics; it does not replace TypeScript type checking. The default TypeScript template's `npm run build` includes `--typecheck`; inspect a custom build script separately. Confirm a strict build passes and the adjusted page/imported resources are in this build, then start the app and request the changed URLs and assets. For an editor-only alias error, inspect tsconfig paths. For a browser boundary leak, inspect the UI's entire import chain. For a missing page, check its ID and `pages.dir` rather than editing a generated registry. Continue with [Getting Started](/frontend/getting-started) for a full running example.

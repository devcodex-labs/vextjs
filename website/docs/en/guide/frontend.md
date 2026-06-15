# Frontend integration

VextJS includes a first-party frontend pipeline for projects that want one package to own API routes, development reloads, production build, generated route contracts, template rendering, and static serving. The default scaffold uses React, while the public browser helpers live under `vextjs/frontend` so the backend runtime contract stays independent from any one UI framework. The current implementation is a frontend foundation: it can host one browser entry and a Vext API client, but it is not yet a complete application-level frontend framework layer.

## 目录导航 / Table of Contents

- [Create a full-stack project](#create-a-full-stack-project)
- [Implementation map](#implementation-map)
- [Current scope and application-layer roadmap](#current-scope-and-application-layer-roadmap)
- [Configuration](#configuration)
- [Configuration reference](#configuration-reference)
- [Runtime flow](#runtime-flow)
- [HTML template rendering](#html-template-rendering)
- [Client code examples](#client-code-examples)
- [API client helper](#api-client-helper)
- [Development, build, and start](#development-build-and-start)
- [External frontend adapters](#external-frontend-adapters)
- [Troubleshooting](#troubleshooting)
- [Next step](#next-step)

## Create a full-stack project

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

The default full-stack template creates the backend routes and the browser app in one project:

```text
my-app/
├── public/
│   └── favicon.svg
└── src/
    ├── client/
    │   ├── App.tsx
    │   ├── index.html
    │   ├── main.tsx
    │   └── styles.css
    ├── config/
    │   └── default.ts
    └── routes/
        └── index.ts
```

The generated route template exposes `/api/hello` and `/api/health`. The browser app is served from `/`, and frontend files are rebuilt through the Vext dev process.

For an API-only project, opt out explicitly:

```bash
npx vextjs create my-api --template api --frontend none
```

## Implementation map

The frontend integration is implemented inside Vext itself. This table maps each documented behavior to the source file that owns it:

| Behavior | Source of truth | What it does |
| --- | --- | --- |
| Public browser helper export | `src/frontend/index.ts` | Exposes `createVextApiClient()`, `isVextApiError()`, `defineFrontendAdapter()`, frontend config types, route contract types, and manifest types through `vextjs/frontend`. |
| Frontend config resolution | `src/frontend/tooling/config-resolver.ts` | Normalizes `frontend: true/false/object`, resolves paths inside the project root, applies dev/prod defaults, validates `publicPath`, and normalizes SPA fallback and API client options. |
| Client contract generation | `src/frontend/tooling/client-contract-writer.ts` | Reads `.vext/manifest/routes.json`, skips hidden or incomplete routes, writes `client-contract.json`, and renders `api.generated.ts`. |
| Browser build and template rendering | `src/frontend/tooling/client-build-compiler.ts` | Cleans `outDir`, copies `publicDir`, runs esbuild, writes `manifest.json`, `size-report.json`, route contract artifacts, and rendered `index.html`. |
| Static serving and SPA fallback | `src/frontend/runtime/static-mount.ts` | Serves assets from `outDir`, handles `ETag` / `Last-Modified` / `Cache-Control`, gates SPA fallback by method and `Accept`, and prevents path traversal. |
| Development build hook | `src/lib/dev/dev-bootstrap.ts` | Writes the dev route manifest, builds the frontend in development mode, and handles `frontend-rebuild` IPC messages from the watcher. |
| Development file classification | `src/lib/dev/change-classifier.ts` and `src/lib/dev/file-watcher.ts` | Classifies default `src/client/**` and `public/**` changes as client rebuilds instead of backend cold restarts. |
| Production build hook | `src/cli/build.ts` | Refreshes route manifest, builds server output, reloads built config, and runs the frontend compiler in production mode. |
| Production startup hook | `src/lib/bootstrap.ts` | Fails fast when frontend output is missing and registers the frontend-aware not-found handler before listening. |
| Scaffold generation | `src/cli/create.ts` | Generates the default React client files, frontend config block, `public/favicon.svg`, and API-only opt-out path. |
| Package boundary | `package.json`, `scripts/build-cjs.mjs`, `test/verify-package-exports.mjs` | Publishes `./frontend` for ESM, CJS, and `.d.ts`, and verifies the export surface. |

This is why the frontend feature does not require Vite or a separate frontend framework package. The browser bundle is compiled by Vext's own esbuild pipeline, while React is only added to generated full-stack projects.

## Current scope and application-layer roadmap

The current `Vext Frontend` release is the P0 foundation. It answers "can Vext build, serve, and connect a browser app by itself?" It does not yet answer "does Vext provide a complete framework layer for complex frontend applications?"

| Supported today | Not supported yet |
| --- | --- |
| One `frontend.entry` browser entry. | A Vext-controlled page route tree, file routing, or explicit page manifest. |
| esbuild client build, hashed JS/CSS, manifest, and size report. | Route-level code splitting, route prefetching, and a route asset graph. |
| HTML shell rendering and `%VEXT_ENTRY%` / `%VEXT_STYLES%` injection. | Route-level head/meta, preload, script, and style management. |
| Static serving, `ETag` / `Last-Modified`, and SPA fallback. | Loading/error/not-found boundaries and page lifecycle hooks. |
| `vextjs/frontend` API client helper. | Type generation for page params/search, loader data, and action results. |
| A minimal React 19 scaffold. | Nested routes, layouts, form actions, mutations, and auth/session/CSRF browser bridges. |
| `defineFrontendAdapter()` metadata extension point. | Adapter-specific build/render/route hooks. |

This means complex dashboards, account systems, multi-page content sites, form workflows, or applications that need route-level bundles should not treat the current P0 as the finished frontend framework layer. The next application layer needs:

- `src/client/pages/**` or an explicit page manifest that generates a route tree.
- Root layouts, nested layouts, route groups, dynamic params, and not-found routes.
- Route loaders/actions integrated with typed Vext APIs, validation errors, `HttpError`, abort signals, and prefetching.
- Type generation for params/search/loader/action/API contracts.
- Loading, error, and not-found boundaries with default recovery paths.
- Head/meta/link/script/preload management.
- Public runtime config, base path, build id, and feature flag injection.
- Auth/session/CSRF browser bridges and default 401/403 handling.
- Route-level splitting, prefetching, route asset manifests, and complex-app benchmarks.
- A dev overlay or inspector for route trees, loaders/actions, fallback hits, and bundle size.

SSR, streaming, React Server Components, Server Actions, and server functions are not part of the current P0 and should not be documented or coded as supported features. They need a separate technical design and benchmark pass after the application-layer boundary is stable.

## Configuration

Frontend support is controlled by `config.frontend`.

Use the default React layout:

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: true,
};

export default config;
```

Use an explicit production-friendly setup when you want to see every field:

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: {
    enabled: true,
    framework: "react",
    root: "src/client",
    entry: "src/client/main.tsx",
    indexHtml: "src/client/index.html",
    outDir: "dist/client",
    publicDir: "public",
    publicPath: "/",
    spaFallback: {
      enabled: true,
      exclude: ["/api/**", "/openapi.json", "/docs/**"],
    },
    apiClient: {
      enabled: true,
    },
    build: {
      target: ["es2022", "chrome115"],
      minify: true,
      sourcemap: false,
    },
  },
};

export default config;
```

Disable frontend behavior by omitting `frontend`, setting `frontend: false`, or setting `frontend.enabled: false`.

:::tip
Keep the default `src/client/**` and `public/**` paths when you want automatic client rebuilds in `vext dev`. The build compiler accepts custom `entry`, `indexHtml`, `outDir`, `publicDir`, and `publicPath`; the current dev change classifier is optimized for the default client and public folders.
:::

## Configuration reference

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `frontend` | `boolean \| object` | disabled | `true` enables defaults; `false` disables browser build and static serving. |
| `frontend.enabled` | `boolean` | `false` | Enables the built-in frontend pipeline. |
| `frontend.framework` | `string` | `"react"` | Framework label used by the config contract. React is the built-in scaffold target. |
| `frontend.root` | `string` | `"src/client"` | Frontend source directory recorded in the resolved config. The current compiler uses `entry` and `indexHtml` directly; dev rebuild classification is optimized for the default `src/client/**` path. |
| `frontend.entry` | `string` | `"src/client/main.tsx"` | Browser entry passed to esbuild. Missing files fail fast. |
| `frontend.indexHtml` | `string` | `"src/client/index.html"` | HTML shell used by the template renderer. If missing, Vext writes a minimal fallback shell. |
| `frontend.outDir` | `string` | `.vext/client` in dev, `dist/client` in production | Directory for browser assets, rendered HTML, route contract files, manifest, and size report. |
| `frontend.publicDir` | `string` | `"public"` | Static assets copied into `outDir` before the browser bundle is written. |
| `frontend.publicPath` | `string` | `"/"` | URL prefix for generated asset links. It must be a path, not a full URL. `app` normalizes to `/app/`. |
| `frontend.spaFallback` | `boolean \| object` | enabled | Serves `index.html` for browser navigation paths that accept HTML. |
| `frontend.spaFallback.exclude` | `string[]` | `["/api/**", "/openapi.json", "/docs/**"]` | Exact paths or `/**` prefix patterns that keep backend behavior. |
| `frontend.apiClient` | `boolean \| object` | enabled | Writes `client-contract.json` and `api.generated.ts` from the route manifest. |
| `frontend.build.target` | `string \| string[]` | `"es2022"` | esbuild browser target. |
| `frontend.build.minify` | `boolean` | `true` in production, `false` in development | Minifies frontend output. |
| `frontend.build.sourcemap` | `boolean` | `true` in development, `false` in production | Emits source maps. |
| `frontend.adapter` | `VextFrontendAdapter` | none | Extension point returned by `defineFrontendAdapter()`. Vext still owns the built-in build, manifest, contract, and static serving flow in this release. |

## Runtime flow

### Development flow

`vext dev` uses one Vext process tree for the backend runtime and the browser bundle:

1. The dev worker loads Vext config and registers backend routes.
2. The route collector writes `.vext/manifest/routes.json`.
3. `buildFrontendClient({ mode: "development" })` resolves `config.frontend`.
4. If frontend is disabled, the build is skipped.
5. If frontend is enabled, Vext writes `.vext/client/` by default.
6. The frontend compiler copies `public/`, writes client contract files, bundles the browser entry with esbuild, writes `manifest.json` and `size-report.json`, then renders `index.html`.
7. The not-found handler serves static frontend assets and browser navigation fallback through the same Vext server.
8. The watcher classifies default `src/client/**` and `public/**` changes as `client`.
9. The worker receives `frontend-rebuild` and reruns `buildFrontendClient()` without backend route reload or cold restart.

### Production build flow

`vext build` keeps server and browser output under the same build command:

1. Vext refreshes generated types and the route manifest.
2. TypeScript projects compile server code into the CLI `--outdir`, `dist` by default.
3. Vext reloads built config from `<outdir>/config` with `command: "build"`.
4. `buildFrontendClient({ mode: "production" })` runs after server build.
5. If the CLI `--outdir` is not `dist` and `frontend.outDir` is not explicitly set, the browser output becomes `<outdir>/client`.
6. If `frontend.outDir` is explicitly set, that explicit value wins.
7. JavaScript projects skip server compilation, but still build frontend assets when `frontend` is enabled.

The esbuild browser build uses `platform: "browser"`, `format: "esm"`, `jsx: "automatic"`, `splitting: false`, hashed `assets/[name]-[hash]` names, file loaders for common image/font assets, CSS bundling, and a `process.env.NODE_ENV` define based on development or production mode.

### Production serving flow

`vext start` only serves frontend output that already exists:

1. Bootstrap resolves frontend config in production mode.
2. `assertFrontendOutputReady()` checks `outDir/index.html` when `frontend.enabled` is true.
3. Missing output fails fast with a message telling you to run `vext build`.
4. Vext registers `createFrontendNotFoundHandler()` as the not-found path.
5. `GET` and `HEAD` requests first try to resolve a static asset under `frontend.publicPath`.
6. Static files receive content type, `ETag`, `Last-Modified`, and cache headers. `index.html` is `no-cache`; hashed assets are immutable.
7. SPA fallback only runs for extensionless paths that accept HTML and do not match `spaFallback.exclude`.
8. JSON/API clients continue to receive backend 404 or backend errors instead of `index.html`.

### Generated file provenance

| Output file | Created from |
| --- | --- |
| `assets/main-<hash>.js` | esbuild bundle from `frontend.entry`. |
| `assets/main-<hash>.css` | CSS imported by the browser entry and emitted by esbuild. |
| copied public assets | Files under `frontend.publicDir`, copied before bundling. |
| `client-contract.json` | `.vext/manifest/routes.json` visible routes. |
| `api.generated.ts` | The same client contract rendered as a small TypeScript module that exports `contract` and `api`. |
| `manifest.json` | esbuild metafile output normalized to public asset URLs. |
| `size-report.json` | Asset byte totals derived from `manifest.json`. |
| `index.html` | `frontend.indexHtml` rendered with generated style and script tags, or a minimal fallback shell when the template file is missing. |

## HTML template rendering

`frontend.indexHtml` is not copied blindly. Vext renders it into `outDir/index.html` after esbuild finishes, then injects the generated script and stylesheet URLs from `manifest.json`.

Use explicit placeholders when you want exact placement:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vext App</title>
    %VEXT_STYLES%
  </head>
  <body>
    <div id="root"></div>
    %VEXT_ENTRY%
  </body>
</html>
```

The renderer follows these rules:

| Placeholder or location | Rendered output |
| --- | --- |
| `%VEXT_STYLES%` | Replaced with one `<link rel="stylesheet" ... data-vext-style>` tag for each generated CSS asset. |
| `%VEXT_ENTRY%` | Replaced with the browser entry `<script type="module" ... data-vext-entry></script>`. |
| No `%VEXT_STYLES%`, but `</head>` exists | Style links are inserted before `</head>`. |
| No `%VEXT_ENTRY%`, but `</body>` exists | The entry script is inserted before `</body>`. |
| No `</body>` | Generated tags are appended to the end of the file. |
| Missing `indexHtml` file | Vext writes a minimal shell with `<div id="root"></div>`. |

Example rendered output after `vext build`:

```html
<link rel="stylesheet" href="/assets/main-ABCD1234.css" data-vext-style>
<script type="module" src="/assets/main-EFGH5678.js" data-vext-entry></script>
```

If `publicPath` is `/app/`, the same generated links become `/app/assets/...`.

## Client code examples

The generated React entry mounts into the template's `#root` element:

```tsx
// src/client/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

The default scaffold keeps the example self-contained by declaring a small route contract in the browser app:

```tsx
// src/client/App.tsx
import { useEffect, useState } from "react";
import { createVextApiClient, isVextApiError } from "vextjs/frontend";

type HelloResponse = { message: string };

const api = createVextApiClient({
  schemaVersion: 1,
  kind: "client-contract",
  source: "routes-manifest",
  generatedAt: "template",
  routes: [
    {
      method: "GET",
      path: "/api/hello",
      operationId: "getApiHello",
      response: { type: "unknown" },
    },
  ],
  warnings: [],
} as const);

export function App() {
  const [message, setMessage] = useState("Loading...");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .GET("/api/hello")
      .then((data) => {
        setMessage((data as HelloResponse).message);
        setError("");
      })
      .catch((err) => {
        setMessage("Request failed");
        setError(isVextApiError(err) ? err.message : String(err));
      });
  }, []);

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">vext full-stack</p>
        <h1>{message}</h1>
        {error ? <p className="error">{error}</p> : <p>React client served by vext.</p>}
      </section>
    </main>
  );
}
```

The build also writes `client-contract.json` and `api.generated.ts` into `.vext/client/` during development and `dist/client/` during production build. Those files describe the visible route manifest and are intended for tooling and output inspection. Do not treat `.vext/client/` or `dist/client/` as source files.

Generated contracts intentionally keep request and response schema references as `unknown` today. The contract preserves method, path, `operationId`, summary, and tags from the route manifest, but it does not yet infer rich body/query/response TypeScript shapes from runtime schema definitions.

## API client helper

`vextjs/frontend` exposes a small fetch wrapper that understands Vext route contracts:

```ts
import { createVextApiClient } from "vextjs/frontend";
import { contract } from "./api-contract";

const api = createVextApiClient(contract, {
  baseUrl: "/",
  headers: {
    "x-client": "web",
  },
});

const hello = await api.GET("/api/hello", {
  query: { locale: "en" },
});
```

The helper supports:

- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` shortcut methods.
- `request(method, path, options)` for any route method in the contract, including `HEAD` and `OPTIONS`.
- `params` replacement for path segments such as `/api/users/:id`.
- `query`, JSON `body`, request `headers`, `signal`, custom `fetch`, and `baseUrl`.
- `VextApiError` and `isVextApiError()` for non-2xx responses.
- Automatic unwrap of Vext's `{ code: 0, data }` response shape.

## Development, build, and start

`vext dev` builds the frontend into `.vext/client/` and serves it through the same Vext server. Changes under the default `src/client/**` or `public/**` paths trigger a frontend rebuild message instead of a backend cold restart. API, config, plugin, route, service, locale, and preload changes still use their existing reload strategy.

The development output is intentionally hidden under `.vext/` so generated browser assets do not become source-of-truth files.

`vext build` compiles server code first and then bundles the browser client with esbuild. When frontend is enabled, production artifacts include:

```text
dist/client/
├── assets/
│   ├── main-<hash>.css
│   └── main-<hash>.js
├── api.generated.ts
├── client-contract.json
├── index.html
├── manifest.json
└── size-report.json
```

`vext start` serves `dist/client/index.html`, static assets, and SPA fallback. The fallback excludes API and documentation paths by default, so `/api/**`, `/openapi.json`, and `/docs/**` continue to reach the backend runtime.

SPA fallback only applies to `GET` and `HEAD` requests that accept HTML. JSON clients keep the backend 404 or error path instead of receiving `index.html`, and fallback responses include `Vary: Accept`.

If `frontend.enabled` is true and `dist/client/index.html` is missing in production, startup fails fast and tells you to run `vext build`.

## External frontend adapters

The first built-in target is React. Future or userland integrations can expose a frontend adapter through `defineFrontendAdapter()`:

```ts
import { defineFrontendAdapter } from "vextjs/frontend";

export const customFrontend = defineFrontendAdapter({
  name: "custom",
  framework: "custom",
});
```

The adapter contract is intentionally small in this release. `defineFrontendAdapter()` returns typed metadata, and the config resolver carries `frontend.adapter`, but the current compiler does not invoke adapter-specific build hooks. Treat it as a reserved extension point: Vext still owns routing, manifest generation, esbuild bundling, static serving, and API client contracts in the current implementation.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `frontend entry not found` | Confirm `frontend.entry` points to an existing file inside the project root. |
| Production start says frontend output is missing | Run `vext build` before `vext start`, or disable `frontend.enabled` for API-only deployment. |
| API-like route returns the browser app | Send `Accept: application/json` from API clients and add the route prefix to `frontend.spaFallback.exclude`. |
| Asset URLs are missing a sub-path | Set `frontend.publicPath` to the mount path, for example `/app/`. |
| `publicPath` config throws | Use a path such as `/app/`, not a full URL such as `https://cdn.example.com/app/`. |
| Source path config throws | `root`, `entry`, `indexHtml`, `outDir`, and `publicDir` must resolve inside the project root. |

## Next step

- Review [Build](/guide/build) for production artifact behavior.
- Review [CLI Commands](/guide/cli) for `vext create` and `vext build` options.
- Review [Configuration](/guide/configuration) for the complete `frontend` field.

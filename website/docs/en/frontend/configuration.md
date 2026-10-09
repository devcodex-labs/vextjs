# Frontend Configuration

Use this page to change an existing full-stack app. Complete [Getting Started](/frontend/getting-started) first, then merge only needed fields into `src/config/default.ts` while retaining server settings. Start with defaults and configure behaviors the product actually changes; see the [VextFrontendConfig API reference](../api/config#vextfrontendconfig) for all type members.

## Table of Contents

- [Minimal Config](#minimal-config)
- [Choose What to Configure](#choose-what-to-configure)
- [Complete Example](#complete-example)
- [Production Delivery Profiles](#production-delivery-profiles)
- [Core Fields](#core-fields)
- [Render Fields](#render-fields)
- [Style Fields](#style-fields)
- [Build Fields](#build-fields)
- [Deploy Fields](#deploy-fields)
- [SEO Fields](#seo-fields)
- [I18n Fields](#i18n-fields)
- [Dev Fields](#dev-fields)
- [SPA Fallback Fields](#spa-fallback-fields)
- [Verify a Configuration Change](#verify-a-configuration-change)

## Minimal Config

Enable frontend in the default config; page files and routes still need to follow Getting Started:

```ts
import type { VextConfigOverride } from "vextjs";

export default {
  frontend: true,
} satisfies VextConfigOverride;
```

`frontend: true` uses the `src/frontend`, `pages`, `components`, `styles/index.css`, and `public` conventions. When using an object, set `enabled: true` explicitly; the object alone does not enable frontend. Production output defaults to `dist/client` with browser minification on and source maps off; the separate Node SSR bundle is unminified by default.

To disable frontend entirely, use `frontend: false` and remove or adapt handlers that call `res.render()`. Disabling the setting does not automatically delete old generated directories.

## Choose What to Configure

| If you need…                           | Start with           | Configure                                                        | What changes                                                                                          | Verify                                                     |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Server-rendered React pages            | `frontend: true`     | Nothing else                                                     | Vext discovers `src/frontend`, builds browser + SSR output, and serves both at the application origin | `vext build`, then `vext start`                            |
| A different source layout              | Built-in folders     | `root`, `pages`, `componentsDir`, `styles.entry`, or `assetsDir` | Only discovery paths change; generated entries remain Vext-owned                                      | Build and load one page plus its global style              |
| A browser-size or compatibility target | Production defaults  | `build.target`, `build.vendorChunks`, or `build.budgets`         | esbuild output, report thresholds, or browser support changes                                         | Inspect `size-report.json` and a production page           |
| CDN-hosted immutable assets            | Same-origin delivery | `deploy.assetBaseUrl` and optionally `deploy.upload`             | Generated JS/CSS URLs point at the CDN; Node still owns HTML/SSR                                      | Dry-run the upload and request an SSR page + hashed asset  |
| Search-visible public pages            | SEO disabled         | `seo`, plus route/render metadata                                | Canonical/meta output and optional sitemap/robots become framework-owned                              | Inspect two page canonicals and the selected SEO artifacts |
| A client-router island                 | No fallback capture  | `spaFallback.scopes`                                             | Only declared paths are served by the browser shell                                                   | Check an in-scope URL and an excluded `/api/**` URL        |
| Multilingual page copy                 | Disabled             | `i18n`                                                           | Request negotiation, HTML, page envelopes, and navigation share the effective language                | Build and verify two languages and cache isolation         |

Avoid adding a field merely because it exists. Global defaults use React and esbuild, SSR on, buffered streaming, browser splitting and production minification on, and no CDN URL or upload. The full-stack starter separately configures `streaming: "auto"` and frontend i18n; inspect the app's actual configuration.

## Complete Example

This same-origin object illustrates the field hierarchy for the default full-stack starter. Most values match defaults and do not all need to be written. Budget values are examples: gather a baseline with `warnOnly: true`. The starter has an `en-US` dictionary, so this example enables frontend i18n explicitly.

```ts
import type { VextConfigOverride } from "vextjs";

export default {
  frontend: {
    enabled: true,
    framework: "react",
    root: "src/frontend",
    publicDir: "public",
    publicPath: "/",
    styles: {
      jscss: { enabled: true },
    },
    dev: {
      hot: true,
      fastRefresh: true,
      renderRefresh: "prompt",
    },
    build: {
      target: "es2022",
      minify: true,
      sourcemap: false,
      client: {
        external: [],
        externalRuntime: {},
      },
      vendorChunks: {
        enabled: true,
        packages: ["react", "react-dom", "react-dom/client"],
      },
      assets: {
        inlineLimit: 0,
      },
      css: {
        modules: true,
      },
      budgets: {
        warnOnly: true,
        maxInitialJsBrotliBytes: 60_000,
        maxRouteInitialJsBrotliBytes: 80_000,
        maxAppOwnedInitialJsBrotliBytes: 40_000,
      },
      diagnostics: {
        leakScan: true,
        performanceReport: true,
      },
    },
    i18n: {
      enabled: true,
      defaultLocale: "en-US",
      clientLoad: "current",
    },
    spaFallback: {
      scopes: [],
    },
    apiClient: true,
  },
} satisfies VextConfigOverride;
```

## Production Delivery Profiles

### Same-origin (default)

Do not configure a CDN for the first production deployment:

```ts
export default {
  frontend: true,
};
```

`vext build` writes the frontend closure to `dist/client`; `vext start`
validates it and serves assets plus SSR from the same Node service. This is
the baseline to keep when a separate static origin provides no material value.

### CDN plus incremental upload

Add these optional delivery fields only when a working CDN is available. Replace the example domain with the real asset address before using it:

```ts
export default {
  frontend: {
    enabled: true,
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      integrity: true,
      upload: {
        enabled: true,
        adapter: "filesystem",
        targetDir: ".vext/frontend-cdn",
        stateFile: ".vext/deploy/frontend-assets-state.json",
        exclude: ["**/*.map"],
      },
    },
  },
};
```

`filesystem` stages selected assets locally; it does not publish them to the example domain. Use a custom adapter or existing release process for a cloud provider. Keep the state file outside `frontend.outDir`, build, inspect `vext deploy assets --dry-run`, then deploy the Node output from the same build once assets are available. See [Static Assets and CDN](./static-assets-and-cdn).

## Core Fields

| Field                    | Default                                                                 | Meaning                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend.enabled`       | `false`                                                                 | Enable built-in frontend pipeline                                                                                                               |
| `frontend.framework`     | `"react"`                                                               | Framework label for built-in React support                                                                                                      |
| `frontend.root`          | `"src/frontend"`                                                        | User frontend source root                                                                                                                       |
| `frontend.pages`         | Built-in page conventions                                               | Page, document, and error-page discovery settings                                                                                               |
| `frontend.componentsDir` | `"components"`                                                          | Shared component directory resolved from `frontend.root`                                                                                        |
| `frontend.assetsDir`     | `"assets"`                                                              | Imported image, font, and media source directory                                                                                                |
| `frontend.indexHtml`     | Resolved `pages.document` (default `src/frontend/pages/_document.html`) | Document template; explicit path is relative to the project root                                                                                |
| `frontend.outDir`        | `.vext/client` in dev, `dist/client` in build                           | Frontend output directory                                                                                                                       |
| `frontend.publicDir`     | `"public"`                                                              | Static public directory                                                                                                                         |
| `frontend.publicPath`    | `"/"`                                                                   | Public asset URL prefix                                                                                                                         |
| `frontend.alias`         | Built-in `@frontend/@pages/@components/@styles/@assets`                 | Frontend-safe import aliases; do not alias all of `src` into browser code                                                                       |
| `frontend.apiClient`     | `true`                                                                  | Emit route/client contract artifacts; set `false` only when no generated client artifact is wanted                                              |
| `frontend.errorPages`    | Built-in error page conventions                                         | Map default or status-specific SSR errors to pages                                                                                              |
| `frontend.adapter`       | none                                                                    | Reserved and deprecated extension field; resolver emits an ignored-setting diagnostic. Use `build.client` / `build.server` for compiler options |

Relative directory bases and TypeScript paths are covered in [Project Structure](./project-structure). Supported image/font imports share public URLs in browser and SSR builds; aliases only change path resolution.

## Render Fields

| Field                       | Default      | Meaning                                                                                                       |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `frontend.render.ssr`       | `true`       | SSR default; a render option can override it, and route `clientOnly` disables server page content.            |
| `frontend.render.streaming` | `"buffered"` | `auto` streams when conditions allow; not every adapter/response path guarantees streaming.                   |
| `frontend.render.fallback`  | `"client"`   | Fallback after buffered SSR failure; may be `"error"`.                                                        |
| `frontend.render.timeoutMs` | `3000`       | Render time budget in milliseconds.                                                                           |
| `frontend.render.layout`    | `true`       | Global layout default; an explicit render `options.layout` takes priority, including false to disable layouts |

See [SSR](./ssr) and [Rendering Modes](./rendering-modes). A synchronous SSR timeout is checked after rendering returns and cannot preempt synchronous JavaScript. Once a streamed response starts, a failure cannot be rewritten like a normal buffered response. Disabling SSR and disabling browser hydration are separate settings; see [Hydration](./hydration).

## Style Fields

| Field                                  | Default                                         | Meaning                                                                              |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `frontend.styles.entry`                | `styles/index.css`                              | Global CSS entry resolved from `frontend.root`                                       |
| `frontend.styles.jscss.enabled`        | `true`                                          | Enable Vext JSCSS extraction                                                         |
| `frontend.styles.jscss.files`          | `**/*.style.ts`, `**/*.style.js`, `**/*.css.ts` | JSCSS source globs                                                                   |
| `frontend.styles.jscss.runtimeAdapter` | `css-variables`                                 | Emit dynamic variables as CSS custom properties; `none`/`false` uses fallback values |
| `frontend.styles.jscss.dynamicVars`    | `true`                                          | Emit custom property declarations and `var(...)` references                          |
| `frontend.styles.jscss.recipes`        | `true`                                          | Emit recipe variant classes and rules                                                |

## Build Fields

| Field                                                            | Default                               | Meaning                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `frontend.build.target`                                          | `"es2022"`                            | Default browser target passed to esbuild; `build.client.target` overrides it                                                        |
| `frontend.build.minify`                                          | production `true`                     | Minify browser output; distinct from the server renderer setting                                                                    |
| `frontend.build.sourcemap`                                       | dev `true`                            | Emit browser source maps; production defaults to `false`                                                                            |
| `frontend.build.client.assetsDir`                                | `"assets"`                            | Browser bundle asset subdirectory                                                                                                   |
| `frontend.build.client.entryNames` / `chunkNames` / `assetNames` | `"[name]-[hash]"`                     | Hashed filename patterns; preserve hashing for immutable caching                                                                    |
| `frontend.build.client.splitting`                                | `true`                                | Enable browser code splitting                                                                                                       |
| `frontend.build.client.external`                                 | `[]`                                  | Browser external modules                                                                                                            |
| `frontend.build.client.externalRuntime`                          | `{}`                                  | Import-map URLs for browser externals                                                                                               |
| `frontend.build.server.outFile`                                  | `frontend.outDir/server/renderer.cjs` | SSR bundle; an explicit path resolves from the project root and must stay inside `frontend.outDir`; server minify defaults to false |
| `frontend.build.vendorChunks`                                    | enabled                               | Shared runtime chunk strategy; configure packages only for a measured reason                                                        |
| `frontend.build.budgets`                                         | all limits `0`                        | Enforce raw/gzip/brotli budget thresholds; use `warnOnly` while baselines settle                                                    |
| `frontend.build.assets.inlineLimit`                              | `0`                                   | Zero disables inlining; supported assets within the threshold use the same data URL in SSR and browser output                       |
| `frontend.build.css.modules`                                     | `true`                                | CSS Modules with shared SSR/browser class and composes mappings; see [Styles and Assets](./styles-and-assets#css-modules)           |
| `frontend.build.diagnostics.leakScan`                            | `true`                                | Block server-only imports from browser graph                                                                                        |
| `frontend.build.diagnostics.sizeReport`                          | `true`                                | Write `size-report.json`                                                                                                            |
| `frontend.build.diagnostics.performanceReport`                   | `true`                                | Include route-level performance metrics                                                                                             |

React-related browser externals must define `externalRuntime` mappings. Otherwise the build fails with a friendly diagnostic.

Browser output is directory-based and uses `frontend.outDir`; `frontend.build.client.outFile` is not supported. Vext always emits the frontend manifest family required by SSR, preload, deploy, and verification, so `build.client.manifest` / `build.server.manifest` are not configuration fields.

For a normal product, keep browser code splitting, hashed names, and the
Vext-managed vendor entry enabled. Start with budgets as warnings, inspect the
complete route closure in `size-report.json`, and only then turn the budget
into a release-blocking gate.

## Deploy Fields

| Field                                           | Default                                   | Meaning                                                                         |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `frontend.deploy.assetBaseUrl`                  | none                                      | CDN/public base URL for assets                                                  |
| `frontend.deploy.crossOrigin`                   | none                                      | `crossorigin` value for generated tags                                          |
| `frontend.deploy.integrity`                     | `false`                                   | Add SRI integrity for generated JS/CSS                                          |
| `frontend.deploy.upload.enabled`                | `false`                                   | Enable `vext build --upload-assets` / `vext deploy assets` upload               |
| `frontend.deploy.upload.adapter`                | `"filesystem"`                            | `filesystem`, `mock`, or custom adapter                                         |
| `frontend.deploy.upload.targetDir`              | enabled: `.vext/deploy/frontend-assets`   | Local staging destination for `filesystem`                                      |
| `frontend.deploy.upload.publicBaseUrl`          | none                                      | Optional public URL reported by upload; filesystem falls back to `assetBaseUrl` |
| `frontend.deploy.upload.prefix` / `concurrency` | `""` / `4`                                | Upload key namespace and parallelism                                            |
| `frontend.deploy.upload.stateFile`              | `.vext/deploy/frontend-assets-state.json` | Incremental upload state                                                        |
| `frontend.deploy.upload.exclude`                | `["**/*.map"]`                            | Files excluded from upload                                                      |

Glob configuration such as deploy include/exclude, media scans, and style includes is limited to 1024 patterns per group, 4096 characters per pattern, 100 nesting levels, and an estimated 4096 brace expansions per pattern. Excessive input fails before entering matchers. This input budget does not clear the upstream `braces` audit advisory.

`assetBaseUrl` must be an absolute URL. `deploy-manifest.json` describes deliverable JS, CSS, produced media, and selected public files; creating it does not upload anything. Source maps are excluded by default; SSR renderer and entry HTML are not CDN upload assets. Run `npx vextjs deploy assets --dry-run` before changing adapter, prefix, or include/exclude rules.

## SEO Fields

`frontend.seo` is the global SEO entry. When the object is present, `enabled` defaults to `true`. Without that object, explicit route/render SEO can still work; sitemap and robots need their own configuration. Explicit `enabled: false` disables structured SEO while legacy head stays independent.

```ts
import type { VextConfigOverride } from "vextjs";

export default {
  frontend: {
    enabled: true,
    seo: {
      publicOrigin: process.env.PUBLIC_ORIGIN ?? "https://www.example.com",
      titleTemplate: "%s | Example",
      defaults: { description: "Example application" },
      sitemap: {},
      robots: {},
    },
  },
} satisfies VextConfigOverride;
```

Replace `publicOrigin` with the real deployment origin. Without an explicit canonical override, Vext combines it with the request pathname. Use route-level `frontend.seo` for static metadata and `res.render(..., { seo })` for metadata derived from page data. Sitemap and robots can use `"build"` or `"runtime"` mode; empty objects default to build. Named `origins` support a finite multi-domain deployment.

See [SEO, Sitemap, and Robots](/frontend/seo-sitemap) for dynamic canonical,
provider, host-selection, output, and no-hydration examples. The exact nested
field list is in the [API reference](../api/config#vextfrontendconfig).

## I18n Fields

| Field                         | Default               | Meaning                                                                                                                   |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `frontend.i18n.enabled`       | `false`               | Scan and bundle frontend page copy when explicitly enabled                                                                |
| `frontend.i18n.source`        | `locales`             | Locale source directory resolved from `frontend.root`                                                                     |
| `frontend.i18n.defaultLocale` | `"inherit"`           | Prefer matching req.locale; a concrete default is the fallback after detection                                            |
| `frontend.i18n.detect`        | `["accept-language"]` | Ordered query.locale, header/X-Vext-Locale, cookie.locale, or accept-language detection; unsupported sources are rejected |
| `frontend.i18n.inject`        | `"used"`              | used is not trimmed per component and emits a diagnostic; the selected language's full messages are loaded                |
| `frontend.i18n.clientLoad`    | `"current"`           | Browser locale loading mode                                                                                               |
| `frontend.i18n.clientSwitch`  | `"reload"`            | Declared field; the app implements language choice and page navigation                                                    |
| `frontend.i18n.htmlLang`      | `true`                | Write request-aware `{vext.lang}` / `<html lang>`                                                                         |
| `frontend.i18n.vary`          | `true`                | Merge headers involved in detection into existing Vary; false leaves external cache isolation to the app                  |

See [Frontend I18n](./i18n) for locale priority, complete examples, SSR/browser loading, caching, and the reserved inject/clientSwitch behavior.

## Dev Fields

| Field                        | Default    | Meaning                                                                            |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `frontend.dev.hot`           | `true`     | Enable frontend dev events                                                         |
| `frontend.dev.fastRefresh`   | `true`     | Enable React Fast Refresh when possible                                            |
| `frontend.dev.transport`     | `"sse"`    | Vext development event-bus transport; this is not a user-selectable WebSocket mode |
| `frontend.dev.overlay`       | `true`     | Show browser UI for frontend rebuild errors and render refresh prompts             |
| `frontend.dev.debounceMs`    | `50`       | Coalesce rapid file-system changes before a rebuild                                |
| `frontend.dev.renderRefresh` | `"prompt"` | Browser behavior after render-data backend reload                                  |

`frontend.dev.overlay` only controls frontend browser development UI. Backend exception HTML overlays are configured separately through top-level `dev.errorOverlay`.

## SPA Fallback Fields

| Field                          | Default                                                      | Meaning                                                      |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `frontend.spaFallback.enabled` | `true`                                                       | Enables arbitration only; with no scopes it captures no page |
| `frontend.spaFallback.scopes`  | `[]`                                                         | Explicit client-router sub-app fallback scopes               |
| `frontend.spaFallback.exclude` | `["/api/**", "/openapi.json", "/docs/**", "/_vext/docs/**"]` | Global paths that fallback never captures                    |
| `scopes[].basePath`            | required                                                     | URL prefix handled by the shell                              |
| `scopes[].page`                | required                                                     | Shell page id from `src/frontend/pages/**`                   |
| `scopes[].ssr`                 | `false`                                                      | Whether the shell should be SSR-rendered                     |
| `scopes[].exclude`             | `[]`                                                         | Paths that must not be handled by fallback                   |
| `scopes[].status`              | `200`                                                        | HTTP status for matched fallback                             |

Declare individual scopes instead of a site-wide catch-all. API, OpenAPI, and
documentation routes stay excluded by default so a client-router shell cannot
hide an operational endpoint.

`spaFallback: true` creates a root `/` scope for page `index`; it differs from omission. A custom global `exclude` replaces defaults, so retain required exclusions. Method, Accept, and existing routes also constrain fallback; see [CSR and SPA Fallback](./csr-and-spa-fallback). Empty client shells use createRoot; completed SSR uses hydrateRoot.

## Verify a Configuration Change

```bash
# The default TypeScript starter runs typecheck and builds backend, browser, and SSR.
npm run build

# Only when upload is configured: inspect without uploading.
npx vextjs deploy assets --dry-run

# Start the matching production output.
npm start -- --port 3000
```

Stop a development server using the same port before this check, and skip dry run when upload is not configured. Same-origin output should retain page content and loadable resources from Getting Started. For build or budget changes, inspect `size-report.json` in the actual output directory; `warnOnly: true` permits budget warnings, while exceeding an enabled budget without it fails the build. For CDN changes, request an SSR page and the browser asset it actually references; real CDN reachability needs deployment-environment verification. For SPA fallback, request both an in-scope URL and an excluded API path. Stop the server with Ctrl+C. See the [API reference](../api/config#vextfrontendconfig) for less common nested fields.

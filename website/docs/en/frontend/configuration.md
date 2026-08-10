# Frontend Configuration

This page is a decision guide, not a second copy of every type member. Start
with the defaults, configure only the behavior that changes for your product,
and use the canonical [VextFrontendConfig API reference](../api/config#vextfrontendconfig)
when you need an exact field, default, or nested option.

## Table of Contents

- [Minimal Config](#minimal-config)
- [Choose What to Configure](#choose-what-to-configure)
- [Complete Example](#complete-example)
- [Production Delivery Profiles](#production-delivery-profiles)
- [Core Fields](#core-fields)
- [Build Fields](#build-fields)
- [Deploy Fields](#deploy-fields)
- [I18n Fields](#i18n-fields)
- [Dev Fields](#dev-fields)
- [SPA Fallback Fields](#spa-fallback-fields)
- [Verify a Configuration Change](#verify-a-configuration-change)

## Choose What to Configure

| If you need…                           | Start with           | Configure                                                        | What changes                                                                                          | Verify                                                    |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Server-rendered React pages            | `frontend: true`     | Nothing else                                                     | Vext discovers `src/frontend`, builds browser + SSR output, and serves both at the application origin | `vext build`, then `vext start`                           |
| A different source layout              | Built-in folders     | `root`, `pages`, `componentsDir`, `styles.entry`, or `assetsDir` | Only discovery paths change; generated entries remain Vext-owned                                      | Build and load one page plus its global style             |
| A browser-size or compatibility target | Production defaults  | `build`, `vendorChunks`, or `budgets`                            | esbuild output, report thresholds, or browser support changes                                         | Inspect `size-report.json` and a production page          |
| CDN-hosted immutable assets            | Same-origin delivery | `deploy.assetBaseUrl` and optionally `deploy.upload`             | Generated JS/CSS URLs point at the CDN; Node still owns HTML/SSR                                      | Dry-run the upload and request an SSR page + hashed asset |
| A client-router island                 | No fallback capture  | `spaFallback.scopes`                                             | Only declared paths are served by the browser shell                                                   | Check an in-scope URL and an excluded `/api/**` URL       |
| Localized page copy                    | Disabled             | `i18n`                                                           | Locale artifacts and request-aware document language are generated                                    | Build and request two locales                             |

Avoid adding a field merely because it exists. The defaults deliberately keep
the runtime small: React + esbuild, SSR on, buffered streaming, browser code
splitting on, production browser minification on, and no CDN/upload adapter.

## Minimal Config

```ts
export default {
  frontend: true,
};
```

Use `false` to disable frontend completely:

```ts
export default {
  frontend: false,
};
```

`frontend: true` uses `src/frontend`, `pages`, `components`,
`styles/index.css`, and `public` conventions. It creates `dist/client` in a
production build; browser minification is enabled and browser source maps are
disabled by default. The SSR renderer is a separate Node bundle and stays
unminified by default for diagnostics.

## Complete Example

```ts
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
        maxInitialJsBrotliBytes: 60_000,
        maxRouteInitialJsBrotliBytes: 80_000,
        maxAppOwnedInitialJsBrotliBytes: 40_000,
      },
      diagnostics: {
        leakScan: true,
        performanceReport: true,
      },
    },
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      crossOrigin: "anonymous",
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
};
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

Add only the delivery fields required by the CDN path:

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
        stateFile: ".vext/deploy/frontend-assets-state.json",
        exclude: ["**/*.map"],
      },
    },
  },
};
```

`filesystem` only stages a deploy tree. Use a custom adapter for a real
provider; no cloud SDK or bundler-plugin ecosystem is implicitly installed.
Keep the state file outside `frontend.outDir`, run `vext deploy assets --dry-run`,
then deploy the matching Node `dist/` output.

## Core Fields

| Field                    | Default                                                 | Meaning                                                                                            |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `frontend.enabled`       | `false`                                                 | Enable built-in frontend pipeline                                                                  |
| `frontend.framework`     | `"react"`                                               | Framework label for built-in React support                                                         |
| `frontend.root`          | `"src/frontend"`                                        | User frontend source root                                                                          |
| `frontend.pages`         | Built-in page conventions                               | Page, document, and error-page discovery settings                                                  |
| `frontend.componentsDir` | `"components"`                                          | Shared component directory resolved from `frontend.root`                                           |
| `frontend.assetsDir`     | `"assets"`                                              | Imported image, font, and media source directory                                                   |
| `frontend.indexHtml`     | `src/frontend/pages/_document.html`                     | Document template                                                                                  |
| `frontend.outDir`        | `.vext/client` in dev, `dist/client` in build           | Frontend output directory                                                                          |
| `frontend.publicDir`     | `"public"`                                              | Static public directory                                                                            |
| `frontend.publicPath`    | `"/"`                                                   | Public asset URL prefix                                                                            |
| `frontend.alias`         | Built-in `@frontend/@pages/@components/@styles/@assets` | Frontend-safe import aliases; do not alias all of `src` into browser code                          |
| `frontend.apiClient`     | `true`                                                  | Emit route/client contract artifacts; set `false` only when no generated client artifact is wanted |
| `frontend.errorPages`    | Built-in error page conventions                         | Map default or status-specific SSR errors to pages                                                 |
| `frontend.adapter`       | none                                                    | Advanced compatible adapter seam; not a general plugin loader                                      |

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

| Field                                                            | Default               | Meaning                                                                                 |
| ---------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `frontend.build.target`                                          | `"es2022"`            | Default browser target passed to esbuild; `build.client.target` overrides it            |
| `frontend.build.minify`                                          | production `true`     | Minify browser output; distinct from the server renderer setting                        |
| `frontend.build.sourcemap`                                       | dev `true`            | Emit browser source maps; production defaults to `false`                                |
| `frontend.build.client.assetsDir`                                | `"assets"`            | Browser bundle asset subdirectory                                                       |
| `frontend.build.client.entryNames` / `chunkNames` / `assetNames` | `"[name]-[hash]"`     | Hashed filename patterns; preserve hashing for immutable caching                        |
| `frontend.build.client.splitting`                                | `true`                | Enable browser code splitting                                                           |
| `frontend.build.client.external`                                 | `[]`                  | Browser external modules                                                                |
| `frontend.build.client.externalRuntime`                          | `{}`                  | Import-map URLs for browser externals                                                   |
| `frontend.build.server.outFile`                                  | `server/renderer.cjs` | SSR renderer bundle file under `frontend.outDir`; its default minify setting is `false` |
| `frontend.build.vendorChunks`                                    | enabled               | Shared runtime chunk strategy; configure packages only for a measured reason            |
| `frontend.build.budgets`                                         | all limits `0`        | Enforce raw/gzip/brotli budget thresholds; use `warnOnly` while baselines settle        |
| `frontend.build.assets.inlineLimit`                              | `0`                   | Inline imported assets below this byte size                                             |
| `frontend.build.css.modules`                                     | `true`                | Enable CSS Modules                                                                      |
| `frontend.build.diagnostics.leakScan`                            | `true`                | Block server-only imports from browser graph                                            |
| `frontend.build.diagnostics.sizeReport`                          | `true`                | Write `size-report.json`                                                                |
| `frontend.build.diagnostics.performanceReport`                   | `true`                | Include route-level performance metrics                                                 |

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

`assetBaseUrl` must be an absolute URL. `deploy-manifest.json` uploads JS,
CSS, imported media, and copied public files; it does not upload SSR HTML or
source maps by default. Use `vext deploy assets --dry-run` before every new
adapter, prefix, or include/exclude rule.

## I18n Fields

| Field                             | Default                    | Meaning                                                      |
| --------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `frontend.i18n.enabled`           | `false`                    | Scan and bundle frontend page copy when explicitly enabled   |
| `frontend.i18n.source`            | `locales`                  | Locale source directory resolved from `frontend.root`        |
| `frontend.i18n.defaultLocale`     | `"inherit"`                | Fallback frontend locale; inherits request locale by default |
| `frontend.i18n.detect` / `inject` | `accept-language` / `used` | SSR locale detection and message injection policy            |
| `frontend.i18n.clientLoad`        | `"current"`                | Browser locale loading mode                                  |
| `frontend.i18n.clientSwitch`      | `"reload"`                 | Browser behavior when the selected locale changes            |
| `frontend.i18n.htmlLang`          | `true`                     | Write request-aware `{vext.lang}` / `<html lang>`            |

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

## Verify a Configuration Change

```bash
# Compile the backend, browser, and SSR closure.
vext build

# Required only when configuring an upload path; inspect before writing.
vext deploy assets --dry-run

# Verify the production closure and start the Node runtime.
vext start
```

For a build or budget change, inspect `dist/client/size-report.json`. For a
CDN change, request one SSR page and one hashed browser asset and confirm they
belong to the same release. For SPA fallback, also request a deliberately
excluded API path. The [API reference](../api/config#vextfrontendconfig) is
the canonical source for less-common nested fields.

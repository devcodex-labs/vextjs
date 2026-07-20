# Frontend Configuration

## Table of Contents

- [Minimal Config](#minimal-config)
- [Complete Example](#complete-example)
- [Core Fields](#core-fields)
- [Build Fields](#build-fields)
- [Deploy Fields](#deploy-fields)
- [I18n Fields](#i18n-fields)
- [Dev Fields](#dev-fields)
- [SPA Fallback Fields](#spa-fallback-fields)

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

## Core Fields

| Field                 | Default                                       | Meaning                                    |
| --------------------- | --------------------------------------------- | ------------------------------------------ |
| `frontend.enabled`    | `false`                                       | Enable built-in frontend pipeline          |
| `frontend.framework`  | `"react"`                                     | Framework label for built-in React support |
| `frontend.root`       | `"src/frontend"`                              | User frontend source root                  |
| `frontend.indexHtml`  | `src/frontend/pages/_document.html`           | Document template                          |
| `frontend.outDir`     | `.vext/client` in dev, `dist/client` in build | Frontend output directory                  |
| `frontend.publicDir`  | `"public"`                                    | Static public directory                    |
| `frontend.publicPath` | `"/"`                                         | Public asset URL prefix                    |

## Build Fields

| Field                                          | Default               | Meaning                                          |
| ---------------------------------------------- | --------------------- | ------------------------------------------------ |
| `frontend.build.target`                        | `"es2022"`            | Browser target passed to esbuild                 |
| `frontend.build.minify`                        | production `true`     | Minify browser output                            |
| `frontend.build.sourcemap`                     | dev `true`            | Emit source maps                                 |
| `frontend.build.client.assetsDir`              | `"assets"`            | Browser bundle asset subdirectory                |
| `frontend.build.client.splitting`              | `true`                | Enable browser code splitting                    |
| `frontend.build.client.external`               | `[]`                  | Browser external modules                         |
| `frontend.build.client.externalRuntime`        | `{}`                  | Import-map URLs for browser externals            |
| `frontend.build.server.outFile`                | `server/renderer.cjs` | SSR renderer bundle file under `frontend.outDir` |
| `frontend.build.vendorChunks`                  | enabled               | Shared runtime chunk strategy                    |
| `frontend.build.assets.inlineLimit`            | `0`                   | Inline imported assets below this byte size      |
| `frontend.build.css.modules`                   | `true`                | Enable CSS Modules                               |
| `frontend.build.diagnostics.leakScan`          | `true`                | Block server-only imports from browser graph     |
| `frontend.build.diagnostics.performanceReport` | `true`                | Write raw/gzip/brotli size report                |

React-related browser externals must define `externalRuntime` mappings. Otherwise the build fails with a friendly diagnostic.

Browser output is directory-based and uses `frontend.outDir`; `frontend.build.client.outFile` is not supported. Vext always emits the frontend manifest family required by SSR, preload, deploy, and verification, so `build.client.manifest` / `build.server.manifest` are not configuration fields.

## Deploy Fields

| Field                              | Default            | Meaning                                                           |
| ---------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `frontend.deploy.assetBaseUrl`     | none               | CDN/public base URL for assets                                    |
| `frontend.deploy.crossOrigin`      | none               | `crossorigin` value for generated tags                            |
| `frontend.deploy.integrity`        | `false`            | Add SRI integrity for generated JS/CSS                            |
| `frontend.deploy.upload.enabled`   | `false`            | Enable `vext build --upload-assets` / `vext deploy assets` upload |
| `frontend.deploy.upload.adapter`   | none               | `filesystem`, `mock`, or custom adapter                           |
| `frontend.deploy.upload.stateFile` | `.vext/deploy/...` | Incremental upload state                                          |
| `frontend.deploy.upload.exclude`   | `["**/*.map"]`     | Files excluded from upload                                        |

## I18n Fields

| Field                         | Default                | Meaning                                           |
| ----------------------------- | ---------------------- | ------------------------------------------------- |
| `frontend.i18n.enabled`       | `true`                 | Scan and bundle frontend page copy                |
| `frontend.i18n.defaultLocale` | backend default locale | Fallback frontend locale                          |
| `frontend.i18n.clientLoad`    | `"current"`            | Browser locale loading mode                       |
| `frontend.i18n.htmlLang`      | `true`                 | Write request-aware `{vext.lang}` / `<html lang>` |

## Dev Fields

| Field                        | Default    | Meaning                                           |
| ---------------------------- | ---------- | ------------------------------------------------- |
| `frontend.dev.hot`           | `true`     | Enable frontend dev events                        |
| `frontend.dev.fastRefresh`   | `true`     | Enable React Fast Refresh when possible           |
| `frontend.dev.renderRefresh` | `"prompt"` | Browser behavior after render-data backend reload |

## SPA Fallback Fields

| Field                          | Default                                                      | Meaning                                        |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------- |
| `frontend.spaFallback.scopes`  | `[]`                                                         | Explicit client-router sub-app fallback scopes |
| `frontend.spaFallback.exclude` | `["/api/**", "/openapi.json", "/docs/**", "/_vext/docs/**"]` | Global paths that fallback never captures      |
| `scopes[].basePath`            | required                                                     | URL prefix handled by the shell                |
| `scopes[].page`                | required                                                     | Shell page id from `src/frontend/pages/**`     |
| `scopes[].ssr`                 | `false`                                                      | Whether the shell should be SSR-rendered       |
| `scopes[].exclude`             | `[]`                                                         | Paths that must not be handled by fallback     |
| `scopes[].status`              | `200`                                                        | HTTP status for matched fallback               |

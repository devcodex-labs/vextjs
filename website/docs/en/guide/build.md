# Build (vext build)

`vext build` compiles server source code into deployable JavaScript products and, when `frontend.enabled` is true, bundles the browser client into `dist/client/`. The current version of `vext build` is designed as a **production-target build**: it statically injects production mode into `process.env.NODE_ENV` in user source code; the runtime config profile is selected independently with `vext start --config <name>` or `VEXT_CONFIG=<name>`. Based on [esbuild](https://esbuild.github.io/) implementation, the compilation phase is optimized for fast local and CI feedback.

## Quick Start

```bash
# Compile the production product
vext build

# Run the built product (TypeScript project must have generated a valid dist/)
vext start

# Load a custom config profile (src/config/sg-sit.ts needs to exist)
vext start --config sg-sit
```

## Build pre-product refresh

When a TypeScript project executes `vext build`, it will first refresh the generated and manifest products required by the development tool chain, and then enter optional type checking and esbuild compilation:

1. `vext typegen` basic refresh: write `.vext/types/*.generated.d.ts`, `src/types/generated/index.d.ts` and `.vext/manifest/services.json`
2. `doctor routes --refresh --write-manifest`: Rescan routes and write `.vext/manifest/routes.json`
3. If `--typecheck` is passed in, execute `tsc --noEmit` at this time
4. esbuild outputs the server runtime into `dist/`
5. If `config.frontend.enabled` is true, esbuild bundles the browser client into `dist/client/`

This ensures that new scaffolding or projects that have just cleaned `.vext/` can also get the latest generated type in `vext build --typecheck` before entering TypeScript verification.

## Compilation strategy

### File-by-File Transform

`vext build` uses **file-by-file compilation** mode for server code instead of bundle mode - each source file is independently compiled into an output file, maintaining the directory structure mapping of `src/`. `src/frontend/**` is excluded from this server file-by-file step and is handled by the frontend bundler and SSR renderer build steps.

```
src/                          dist/
├── index.ts            →     ├── index.js        + index.js.map
├── config/                   ├── config/
│   ├── default.ts      →     │   ├── default.js   + default.js.map
│   └── production.ts   →     │   └── production.js + production.js.map
├── routes/                   ├── routes/
│   ├── users.ts        →     │   ├── users.js     + users.js.map
│   └── posts.ts        →     │   └── posts.js     + posts.js.map
├── services/                 ├── services/
│   ├── user.ts         →     │   ├── user.js      + user.js.map
│   └── auth.ts         →     │   └── auth.js      + auth.js.map
├── plugins/                  ├── plugins/
│   └── redis.ts        →     │   └── redis.js     + redis.js.map
├── middlewares/              └── middlewares/
│   └── auth.ts         →         └── auth.js       + auth.js.map
└── models/                   └── models/
    └── user.ts         →         └── user.js       + user.js.map
```

### Why not Bundle?

| Features              | File-by-file compilation                            | Bundle                           |
| --------------------- | --------------------------------------------------- | -------------------------------- |
| Directory structure   | Keep the original structure for easy debugging      | Merge into a single/few files    |
| Source Map            | Exact mapping to source file line numbers           | Mapping may be inaccurate        |
| Module loading        | Node.js native parsing `require()`                  | Need to customize runtime        |
| Hot reloading         | Single file replacement possible (development mode) | Full recompile required          |
| Dependency management | External dependencies are resolved by Node.js       | Externals needs to be configured |

## Compile options

### CLI parameters

`vext build` does not support positional arguments. Value options such as `--outdir` and `--config` must be followed by a non-option value, for example `--outdir dist`; `--outdir --minify` or `--config --clean` fails as a missing-value error.

| Parameters         | Description                                                           | Default value |
| ------------------ | --------------------------------------------------------------------- | ------------- |
| `--outdir <path>`  | Output directory                                                      | `dist`        |
| `--config <name>`  | Select the build-time config profile                                  | `production`  |
| `--clean`          | Clean the output directory before compilation                         | `false`       |
| `--sourcemap`      | Generate source map                                                   | `true`        |
| `--no-sourcemap`   | Disable source map                                                    | —             |
| `--minify`         | Compress output code (enabled by default; retained for compatibility) | `true`        |
| `--no-minify`      | Disable output compression                                            | —             |
| `--typecheck`      | Execute `tsc --noEmit` after refreshing generated / manifest          | `false`       |
| `--upload-assets`  | Upload frontend static assets after the frontend build                | `false`       |
| `--deploy-dry-run` | Print the frontend upload plan without writing assets                 | `false`       |

Production CLI builds minify backend output by default. Use `--no-minify` for a readable local inspection, or set `VEXT_BUILD_MINIFY=false` when that opt-out must be supplied by the environment. Frontend production minification continues to follow `frontend.build.minify`.

Normal repeated builds automatically remove stale backend `dist/**/*.js` and `dist/**/*.js.map` outputs left by deleted or renamed server source files while preserving `dist/client/` frontend assets. Use `--clean` when you want to clear the entire output directory before compilation.

## Frontend build

When `config.frontend.enabled` is true, the browser pipeline uses esbuild in bundle mode:

```text
.vext/generated/frontend/browser-entry.tsx → dist/client/assets/browser-entry-<hash>.js
.vext/generated/frontend/vendor-entry.tsx  → dist/client/assets/vext-vendor-<hash>.js (when enabled)
dynamic imports from src/frontend/pages/**  → dist/client/assets/<page-or-layout-chunk>-<hash>.js
src/frontend/pages/_document.html           → dist/client/index.html
src/frontend/styles/index.css                → dist/client/assets/browser-entry-<hash>.css
public/**                                    → dist/client/**
.vext/manifest/routes.json                  → client-contract.json + route-contract.json + api.generated.ts (when apiClient is enabled)
.vext/generated/frontend/server-renderer.ts → dist/client/server/renderer.cjs
```

The frontend build writes:

| File                                 | Description                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `dist/client/index.html`             | HTML entry served by `vext start`                                                                            |
| `dist/client/assets/*`               | Bundled JavaScript, CSS, and imported assets                                                                 |
| `dist/client/manifest.json`          | Frontend asset manifest                                                                                      |
| `dist/client/deploy-manifest.json`   | Uploadable static asset manifest with sha256, SRI, content type, and upload key                              |
| `dist/client/render-manifest.json`   | SSR page, layout, error page, and renderer manifest                                                          |
| `dist/client/messages-manifest.json` | Frontend i18n message manifest; it may contain no locale entries when i18n is disabled                       |
| `dist/client/media-manifest.json`    | Local image/font artifact manifest                                                                           |
| `dist/client/static-manifest.json`   | Static and freshness artifact manifest                                                                       |
| `dist/client/server/renderer.cjs`    | SSR renderer bundle                                                                                          |
| `dist/client/size-report.json`       | Size summary for generated frontend assets; written when `build.diagnostics.sizeReport` is enabled (default) |
| `dist/client/client-contract.json`   | Route contract generated from route manifest when `apiClient.enabled` is enabled (default)                   |
| `dist/client/route-contract.json`    | Route response-schema contract when `apiClient.enabled` is enabled (default)                                 |
| `dist/client/api.generated.ts`       | Lightweight typed API client module when `apiClient.enabled` is enabled (default)                            |

`size-report.json` reports top-level `initialJs*` values as the largest complete page first-load closure, including chunks imported by the browser entry. Deferred route and error-page chunks are excluded until the browser requests them. Inspect `routes[]` for each route's exact closure; this prevents direct entry-file bytes from understating the default performance budgets.

`vext start` fails fast when frontend is enabled but `dist/client/index.html` is missing. Run `vext build` before production start.

Browser pages, layouts, error pages, and locale entries are loaded through dynamic imports so page-level chunks are emitted by default. React and other shared packages are pulled into a Vext-managed vendor entry and split through esbuild. `frontend.build.client.external` can exclude a module from the browser bundle, but the browser must receive it through `frontend.build.client.externalRuntime`, which Vext writes into an import map.

When `frontend.deploy.integrity=true`, Vext injects build-time SRI into generated JS/CSS tags. `deploy-manifest.json` includes esbuild output and copied `public/**` files for `vext deploy assets`; it intentionally excludes `index.html` and source maps because HTML is rendered and cached by the Vext server path, while source maps should stay on the server debugging path unless explicitly published.

### Output format

| Options  | Values           | Description                                                               |
| -------- | ---------------- | ------------------------------------------------------------------------- |
| Format   | `cjs` (CommonJS) | Unified output of CommonJS to ensure that `require.cache` is controllable |
| Target   | `node20`         | Align with `engines.node >= 20.19.0`                                      |
| Platform | `node`           | Node.js runtime                                                           |
| Charset  | `utf8`           | Force UTF-8, avoid Chinese escaping                                       |

### Optimization options

| Options      | Default                     | Description                                                                                        |
| ------------ | --------------------------- | -------------------------------------------------------------------------------------------------- |
| Source Map   | `external` (`.js.map` file) | Error stack mapped back to TypeScript line numbers                                                 |
| Tree Shaking | Enable                      | Remove unused exports (dead code elimination)                                                      |
| Keep Names   | On                          | Keep function/class names (error stack readability)                                                |
| Minify       | On by default               | Minifies backend output; use `--no-minify` or `VEXT_BUILD_MINIFY=false` only for local diagnostics |
| packages     | `external`                  | External dependencies are not packaged and are resolved by Node.js at runtime                      |

This table describes the **backend CLI compiler**. Its production default is
minified output with external source maps. The frontend has independent
defaults: `frontend.build.client.minify` is `true` in production,
`frontend.build.client.sourcemap` is `false` in production, and the SSR
renderer keeps `frontend.build.server.minify` at `false` unless you opt in.
See [Build and Deploy](../frontend/build-and-deploy) before changing those
independent frontend settings.

### Automatic injection

The following definitions are automatically injected at compile time:

```typescript
define: {
  'process.env.NODE_ENV': '"production"'
}
```

This will cause the `process.env.NODE_ENV` branch in the user source code after build to be statically collapsed according to production semantics.

This injection does not mean the runtime can only load `config/production.ts`. The runtime config profile is selected by `vext start --config <name>` or `VEXT_CONFIG=<name>`, for example:

```bash
vext start --config sg-sit
```

Will try to load:

```text
dist/config/sg-sit.js
```

Therefore, the current recommended usage of `vext build` is:

- Use it to generate production-target artifact
- Use `vext start --config <profile>` or `VEXT_CONFIG=<profile>` to select the config profile
- Do not rely on the `process.env.NODE_ENV` conditional branch in the user source code after build to do sit/uat/prod switching

```json
{
  "scripts": {
    "start": "vext start",
    "start:sg-sit": "vext start --config sg-sit"
  }
}
```

## File scanning rules

### Included files

`vext build` scans the `src/` directory for all files matching the following patterns:

```
**/*.{ts,js,mjs,cjs}
```

Server file-by-file compilation ignores `src/frontend/**`; frontend files are handled by the browser bundle and SSR renderer build steps.

### Excluded files

Compilation automatically excludes the following files (two-level exclusion rules):

#### Universal exclusions (shared with development mode)

| Mode              | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `**/*.d.ts`       | TypeScript type declaration (type only, no runtime code) |
| `**/*.test.*`     | Test file                                                |
| `**/*.spec.*`     | Test files                                               |
| `**/__tests__/**` | Test directory                                           |

#### Additional exclusions for production compilation

| Mode                      | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `**/config/development.*` | Development environment configuration (meaningless for production) |
| `**/config/local.*`       | Local override configuration (never deployed)                      |
| `**/config/test.*`        | Test environment configuration (not required for production)       |
| `**/client/**`            | Browser client source, handled by the frontend bundler             |

:::tip
This means that development/test/local configuration files will not be included in `dist/`, preventing sensitive information from leaking into the production environment.
:::

## Source Map

### External Source Map

`vext build` generates an external `.js.map` file (unlike `vext dev`’s inline source map):

```
dist/
├── index.js # Compiled JavaScript
├── index.js.map # Source Map (maps back to src/index.ts)
├── routes/
│ ├── users.js
│ └── users.js.map
└──...
```

### Enable Source Map support

Enable source maps when running in Node.js so that error stacks show TypeScript line numbers:

```bash
NODE_OPTIONS=--enable-source-maps vext start
```

Error stack when not enabled:

```
Error: Something went wrong
    at UserService.findById (dist/services/user.js:23:11)
```

Error stack after enabling:

```
Error: Something went wrong
    at UserService.findById (src/services/user.ts:42:11)
```

### Source Map Purpose

| Scene       | Description                                            |
| ----------- | ------------------------------------------------------ |
| error stack | map back to original TypeScript line number            |
| APM tools   | Sentry / Datadog and other tools to locate source code |
| Debugging   | `node --inspect --enable-source-maps`                  |

:::warning
When deploying to a production environment, the `.js.map` file can remain on the server (not exposed by HTTP), but do not deploy to a CDN or static file serving.
:::

## Comparison with DevCompiler

`vext build` and `vext dev` share the same esbuild base configuration (`createBaseEsbuildConfig()`), ensuring consistent compilation behavior in development and production:

| Features                 | `vext dev` (DevCompiler)              | `vext build` (BuildCompiler)         |
| ------------------------ | ------------------------------------- | ------------------------------------ |
| **Output directory**     | `.vext/dev/` (temporary, gitignored)  | `dist/` (persistent, deployable)     |
| **Compilation mode**     | Incremental + single-file compilation | Full compilation                     |
| **Source Map**           | Inline (embedded in JS)               | External (`.js.map`)                 |
| **Hot reload**           | Supported (Tier 1/2/3)                | Not supported (one-time compilation) |
| **Extra exclusions**     | None                                  | config/development, local, test      |
| **NODE_ENV injection**   | None                                  | `"production"`                       |
| **MetaFile**             | None                                  | Yes (compile statistics)             |
| **Typical elapsed time** | ~23 ms (incremental)                  | ~500 ms (full)                       |

### Shared configuration

The esbuild configuration shared by both includes:

- `platform: 'node'` — Node.js runtime
- `target: 'node20'` — Minimum support for Node.js 20.19.0
- `format: 'cjs'` — CommonJS output
- `bundle: false` — compile file by file
- `treeShaking: true` — dead code elimination
- `keepNames: true` — keep function names
- `charset: 'utf8'` — UTF-8 encoding
- `loader` — `.ts`/`.js`/`.json` and other file type mappings

## Compilation results

After `vext build` is executed, a compilation report is output:

```
vext build

  ✓ Compiled 42 files in 487ms
  ✓ Output: dist/

  Files: 42 JS + 42 Source Maps
  Errors: 0
  Warnings: 0
```

### BuildResult structure

| Field        | Type        | Description                                            |
| ------------ | ----------- | ------------------------------------------------------ |
| `success`    | `boolean`   | Whether the compilation was successful (no errors)     |
| `fileCount`  | `number`    | Number of output JS files                              |
| `totalFiles` | `number`    | Total number of input source files                     |
| `elapsed`    | `number`    | Compilation time (milliseconds)                        |
| `outDir`     | `string`    | Output directory path                                  |
| `warnings`   | `Message[]` | esbuild warning message                                |
| `errors`     | `Message[]` | esbuild error message                                  |
| `metafile`   | `Metafile`  | esbuild compilation meta information (file size, etc.) |

## Run the compiled product

```bash
# Basic startup
vext start

# Enable source map (recommended)
NODE_OPTIONS=--enable-source-maps vext start

# Increase the memory limit
NODE_OPTIONS="--enable-source-maps --max-old-space-size=4096" vext start
```

If the TypeScript project lacks `dist/` or key build products, `vext start` will fail directly and prompt to execute `vext build` first. Please use `vext dev` to start the source code during the development period.

If frontend is enabled, `vext start` also checks `dist/client/index.html` and serves `dist/client/` with SPA fallback outside API/documentation paths.

There is no fixed `dist/index.js` startup entry for universal scaffolding projects; the direct `node dist/index.js` is only suitable for advanced scenarios where you maintain the entry file yourself and explicitly call the framework startup logic.

### VEXT_BUILT tag

When running a valid `dist/` build via `vext start`, the CLI sets the `VEXT_BUILT=1` environment variable. This affects:

- **Path parsing**: `src/routes/` → `dist/routes/`
- **Module loading**: Load routes, services, plugins, middlewares from the `dist/` directory
- **Model loading**: MonSQLize loads the Model definition from `dist/models/`

You don't need to set this variable manually, the framework handles it automatically when using `vext start`.

## Deployment manifest

Recommended steps for deploying to production using `vext build`:

```bash
# 1. Install dependencies
npmci

# 2. Compile
npx vext build

# 3. Install only production dependencies (optional, used in scenarios such as Docker)
npm ci --omit=dev

# 4. Start
NODE_OPTIONS=--enable-source-maps npx vext start
```

### Docker multi-stage build

```dockerfile
# Phase 1: Compilation
FROM node:22-alpine AS builder
WORKDIR/app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
RUN npx vext build

# Phase 2: Run
FROM node:22-alpine
WORKDIR/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
ENV NODE_OPTIONS=--enable-source-maps
CMD ["npm", "start"]
```

### .gitignore

Make sure the `dist/` directory is in `.gitignore` (the compiled product should not be committed to Git):

```
dist/
.vext/
node_modules/
```

## Troubleshooting

### Compilation failed

```
Error: [vextjs] No source files found in /project/src
```

Make sure the `src/` directory exists and contains `.ts` or `.js` files.

### Module not found during runtime

```
Error: Cannot find module './routes/users.js'
```

Possible reasons:

1. Dependencies are not reinstalled after `vext build` (`npm ci`)
2. Some files were skipped by exclusion rules (check whether they meet the exclusion rules)
3. Used dynamic `import()` to reference the `.d.ts` file

### Source Map does not take effect

Make sure to pass the `--enable-source-maps` parameter via `NODE_OPTIONS` when starting:

```bash
# ✅ Correct
NODE_OPTIONS=--enable-source-maps vext start

# ❌ Parameter position error
vext start --enable-source-maps
```

## Next step

- Learn about the complete deployment guide at [Deployment and Production](/guide/deployment)
- See [Hot Reload](/guide/hot-reload) to learn about development mode compilation strategies
- Learn the full parameters of `vext build` in [CLI Commands](/guide/cli)
- Explore [Cluster Multi-Processing](/guide/cluster) to take full advantage of multi-core CPUs

# Build (vext build)

`vext build` prepares application output for production. It compiles TypeScript backend code to JavaScript; a pure JavaScript backend runs from source. With frontend enabled, it also builds browser assets, the server renderer, and related manifests.

This page first builds, starts, and checks an application, then explains compilation rules, configuration, output, and deployment. See [CLI](/guide/cli) for commands and [Frontend Build and Deploy](/frontend/build-and-deploy) for frontend delivery.

## Quick Start

### Prerequisites and project types

Run commands in the application root containing `package.json` and `src/`, after installing project dependencies. `npx vextjs` invokes the installed Vext CLI; npm scripts can use `vext` directly. See [Quick Start](/guide/quick-start) to create a project.

| Project type             | Build behavior                                                            | Keep for deployment                                                        |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TypeScript API           | Refresh types and route manifest, then compile backend                    | Backend output, build identity, production dependencies, runtime resources |
| TypeScript with frontend | Compile backend, then build frontend                                      | Complete backend/frontend output, identity, production dependencies        |
| JavaScript API           | No backend compile step; can start from source                            | `src/`, production dependencies, runtime resources                         |
| JavaScript with frontend | Refresh route manifest and build frontend; backend still runs from source | `src/`, frontend output, build identity, production dependencies           |

For a TypeScript project, first stop its `vext dev` process to avoid a competing project writer, then run:

```bash
npx vextjs build --typecheck
npx vextjs start --port 3000
```

`--typecheck` requires TypeScript and a valid `tsconfig.json`. Without it, esbuild transpiles the code but does not prove TypeScript type checking passed.

If you used the [API scaffold in the CLI guide](/guide/cli#from-project-creation-to-production-startup), request these routes from a second terminal:

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/health
```

Both should return HTTP 200. The first returns a greeting; the second has `data.status: "ok"`. For your project, request its actual routes and verify business results. Stop the server with Ctrl+C afterward. This example explicitly sets the port; the scaffold's production profile defaults to 3001.

### Output directory and configuration profile

Output selection follows explicit `--outdir` → `VEXT_BUILD_OUTDIR` → last successful build record → `dist`. To inspect a specific output:

```bash
npx vextjs build --typecheck --outdir dist
npx vextjs start --outdir dist --port 3000
```

For a custom profile, first provide `src/config/<name>.ts` or another supported config file, then build and start:

```bash
npx vextjs build --config sg-sit
npx vextjs start --config sg-sit
```

Build profile precedence is `--config` → `VEXT_CONFIG` → compatibility fallback from a nonstandard `NODE_ENV` → `production`. Startup without an explicit profile prefers the build record, then production; see [Configuration](/guide/configuration). Backend compilation statically replaces `process.env.NODE_ENV` in user source with `"production"`. A config profile serves a different purpose; do not use compiled source's NODE_ENV branch to switch sit/uat/prod.

## Refresh generated files before building

For a TypeScript project, `vext build` first refreshes generated types and manifests, then runs optional type checking and esbuild compilation:

1. `vext typegen` basic refresh: write `.vext/types/*.generated.d.ts`, `src/types/generated/index.d.ts` and `.vext/manifest/services.json`
2. `doctor routes --refresh --write-manifest`: Rescan routes and write `.vext/manifest/routes.json`
3. If `--typecheck` is passed in, execute `tsc --noEmit` at this time
4. esbuild outputs the server runtime into the selected directory (`dist/` by default)
5. If `config.frontend.enabled` is true, the frontend build follows (`client/` under the backend output by default)

This ensures that new scaffolding or projects that have just cleaned `.vext/` can also get the latest generated type in `vext build --typecheck` before entering TypeScript verification.

## Compilation strategy

### File-by-File Transform

The backend retains a separate CommonJS `.js` output for each source module and its directory structure so runtime loaders can discover routes, services, plugins, middleware, and models. The mapping below illustrates paths; a project need not create every directory.

```
src/                          dist/
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

By default, the build also produces matching `.js.map` files, an output directory `package.json` declaring CommonJS, and build identity files. Business JSON retains its relative path; project preloads use a separate ESM build. When frontend is enabled, resolved frontend role paths are handled by browser/SSR builds and excluded from backend scanning. When it is disabled, a directory named `frontend` or `client` alone does not prove it is excluded.

### Why not Bundle?

“File by file” describes the final module boundaries. The implementation uses esbuild `bundle: true` to resolve and rewrite local references, while marking local modules and npm packages external so business modules are not combined into one backend bundle.

This preserves the directory and module identity needed by loaders and works with development module replacement. An ordinary bundle can also produce accurate source maps and does not necessarily require a custom runtime; debugging and hot reload cannot be reduced to a blanket claim that bundling makes them impossible.

## Compile options

### CLI parameters

`vext build` does not support positional arguments. Value options such as `--outdir` and `--config` must be followed by a non-option value, for example `--outdir dist`; `--outdir --minify` or `--config --clean` fails as a missing-value error.

| Parameters         | Description                                                            | Default value        |
| ------------------ | ---------------------------------------------------------------------- | -------------------- |
| `--outdir <path>`  | Explicit output directory                                              | See precedence above |
| `--config <name>`  | Select the build-time config profile                                   | `production`         |
| `--clean`          | Clean recorded stale outputs after successful compilation              | `false`              |
| `--sourcemap`      | Generate source map                                                    | `true`               |
| `--no-sourcemap`   | Disable source map                                                     | —                    |
| `--minify`         | Compress output code (enabled by default; retained for compatibility)  | `true`               |
| `--no-minify`      | Disable output compression                                             | —                    |
| `--typecheck`      | Execute `tsc --noEmit` after refreshing generated / manifest           | `false`              |
| `--upload-assets`  | Upload frontend static assets after the frontend build                 | `false`              |
| `--deploy-dry-run` | Simulate upload with `--upload-assets`; local build still writes files | `false`              |
| `-h, --help`       | Show build command help                                                | —                    |

Production CLI builds minify backend output by default. Use `--no-minify` for a readable local inspection, or set `VEXT_BUILD_MINIFY=false` when that opt-out must be supplied by the environment. Frontend production minification uses `frontend.build.client.minify`, falling back to `frontend.build.minify` only when unset. Backend source maps can also be disabled with `VEXT_BUILD_SOURCEMAP=false`; explicit CLI switches take precedence.

Repeated builds remove obsolete outputs only after candidate compilation succeeds, using `.vext/freshness/v1/artifacts.json`. Backend JavaScript, source maps, project preloads, and business JSON commit together; compilation failures preserve the previous files. `--clean` follows the same ownership records: it does not recursively empty the output before compilation or delete unrecorded files.

Nested JSON data, such as `src/locales/account/security/zh-CN.json`, keeps its directory and original bytes and supports backend imports. Frontend role directories, tests, and compilation metadata (`package.json` / `tsconfig*.json`) are excluded from business JSON copying. MCP structure and build guidance must use this same contract.

Externally edited outputs or conflicting legacy files without ownership evidence produce `VEXT_OUTPUT_CONFLICT` with the affected path. Preserve, move, or verify those files before retrying, or choose a fresh `--outdir`. Existing files identical to the generated candidate can be adopted without rewriting.

Growth, replacement, or deletion of ownership and build records during a read produces an unverified-state error, rather than being treated as an initially missing record. Wait for the modification to finish, then inspect or recover as directed. Single-file verification does not provide a simultaneous atomic snapshot of the entire directory tree.

After an interrupted process registration, the next registration recovers verifiable temporary records in bounded batches under the registry mutex. Partial writes, external changes, and legacy files are preserved with their paths in diagnostics; inspect those paths instead of clearing the registry directory. Temporary records never automatically replace the authoritative records.

One writer owns a service root and its nested roots at a time. Competing `build` or `typegen` commands while `dev` is running return `VEXT_OWNER_BUSY`; separate service roots can run concurrently. Recovery metadata supports interrupted processes. Per-file atomic replacement does not imply simultaneous atomic visibility across all files; consumers must wait for successful completion.

After configuration preparation, `.vext-build.json` inside the output records `building`. All artifact stages and optional upload must succeed before it and `.vext/build-location.json` commit together as `ready`. A failed generation becomes `failed`, blocking startup from that output. Startup rejects pending transactions and externally modified recorded identities. Producers retain their individual transaction boundaries: failure in the frontend or remote upload after a backend commit does not roll back every build file or remote resource. See [CLI build behavior](./cli.md) for identity and portable deployment details.

## Frontend build

The frontend first generates candidate sources and assets. Browser compilation, SSR, media, static pages, SEO, and budgets must all succeed before `.vext/generated/frontend/` and the configured `frontend.outDir` commit together. A failed rebuild preserves the previous generation; development keeps serving its valid static assets until a corrected rebuild succeeds. Identical candidates are not rewritten. Only recorded obsolete files are removed, and unrecorded files are not automatically served or uploaded.

JSCSS retains native ESM and top-level `await` in a disposable build worker. Its module directory keeps the final logical location for relative imports. The worker and temporary module are cleaned up after execution, including the worker's module cache; parent-process globals are not shared. Recovery uses receipts and content hashes for interrupted temporary files and preserves externally modified files as conflicts.

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

`vext start` fails fast when frontend is enabled but `index.html` is missing from the configured frontend output. Run `vext build` before production start.

Browser pages, layouts, error pages, and locale entries are loaded through dynamic imports so page-level chunks are emitted by default. React and other shared packages are pulled into a Vext-managed vendor entry and split through esbuild. `frontend.build.client.external` can exclude a module from the browser bundle, but the browser must receive it through `frontend.build.client.externalRuntime`, which Vext writes into an import map.

When `frontend.deploy.integrity=true`, Vext injects build-time SRI into generated JS/CSS tags. `deploy-manifest.json` includes esbuild output and copied `public/**` files for `vext deploy assets`; it intentionally excludes `index.html` and source maps because HTML is rendered and cached by the Vext server path, while source maps should stay on the server debugging path unless explicitly published.

## Backend output format and compiler options

| Options  | Values           | Description                                                               |
| -------- | ---------------- | ------------------------------------------------------------------------- |
| Format   | `cjs` (CommonJS) | Backend modules use CommonJS; project preloads separately emit ESM `.mjs` |
| Target   | `node20`         | Align with `engines.node ^20.19.0 \|\| >=22.12.0`                         |
| Platform | `node`           | Node.js runtime                                                           |
| Charset  | `utf8`           | Force UTF-8, avoid Chinese escaping                                       |

### Optimization options

| Options      | Default                     | Description                                                                                                                |
| ------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Source Map   | `external` (`.js.map` file) | Generates separate maps; runtime association has limits described below                                                    |
| Tree Shaking | Enable                      | Eliminate provably dead code; independent module exports are not all removed merely because other files do not import them |
| Keep Names   | On                          | Try to preserve function/class names                                                                                       |
| Minify       | On by default               | Minifies backend output; use `--no-minify` or `VEXT_BUILD_MINIFY=false` only for local diagnostics                         |
| packages     | `external`                  | External dependencies are not packaged and are resolved by Node.js at runtime                                              |

These tables describe the backend CLI compiler. Its production default is minified output with external source maps. Frontend defaults are separate: `frontend.build.client.minify` is true in production, client `sourcemap` is false, and SSR `frontend.build.server.minify` is false unless enabled. Browser output is an ESM bundle, unlike backend CJS. See [Frontend Build and Deploy](/frontend/build-and-deploy).

### Automatic injection

The backend compiler uses this definition:

```typescript
define: {
  'process.env.NODE_ENV': '"production"'
}
```

Branches in user source based on `process.env.NODE_ENV` may be folded during compilation. This does not force the runtime to load only the production profile. For example, `npx vextjs start --config sg-sit` loads `config/sg-sit.js` from the selected output directory. External npm dependencies are not rebuilt by this backend compilation step, so the static replacement cannot be promised for all dependency code.

Add a startup script for a profile when needed:

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
**/*.{ts,mts,cts,js,mjs,cjs}
```

This pattern applies to a TypeScript project's backend build. Ordinary business `.json` files are scanned, validated, and copied separately; other static files are not automatically copied into the output.

### Excluded files

Compilation automatically excludes the following files (two-level exclusion rules):

#### Universal exclusions (shared with development mode)

| Pattern                                                           | Description                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `**/*.d.ts`, `**/*.d.mts`, `**/*.d.cts`                           | Type declarations                                               |
| `**/*.test.*`, `**/*.spec.*`                                      | Test files                                                      |
| `**/__tests__/**`                                                 | Test directories                                                |
| `**/*.__vext_compiled__*`                                         | Tool-generated temporary modules                                |
| Resolved frontend role directories/files when frontend is enabled | Excluded by project layout, not by every directory named client |

#### Additional exclusions for production compilation

| Pattern                                              | Description                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `**/config/development.{ts,js,mts,mjs,cts,cjs,json}` | Development config is not emitted to production backend output |
| `**/config/local.{ts,js,mts,mjs,cts,cjs,json}`       | Local override is not emitted                                  |
| `**/config/test.{ts,js,mts,mjs,cts,cjs,json}`        | Test config is not emitted                                     |
| `preload/**`                                         | Project preload uses a separate ESM build into `preload/*.mjs` |

These exclusions do not scan for and remove all sensitive content, and they do not deploy an excluded profile. Include application-owned templates, files, or other runtime resources explicitly; the framework cannot infer copies from arbitrary `fs.readFile` expressions. See [Preload](/guide/preload).

## Source Map

### External Source Map

The backend production build creates a `.js.map` next to each `.js` by default:

```
dist/
└── services/
    ├── user.js
    └── user.js.map
```

The current esbuild `external` mode generates a map **without adding a `sourceMappingURL` comment** at the end of JavaScript. This differs from `linked` mode; see [esbuild Source Maps](https://esbuild.github.io/api/#sourcemap).

### Enable Source Map support

Node's [`--enable-source-maps`](https://nodejs.org/api/cli.html#--enable-source-maps) enables stack mapping only when the runtime can discover the map. **For current Vext backend production output, this flag alone does not guarantee TypeScript line numbers.** Use a debugger or APM with explicit map loading/upload, and verify against deployed output. These commands only show how to pass the Node option:

```bash
NODE_OPTIONS=--enable-source-maps npx vextjs start
```

```powershell
# PowerShell; remove this setting afterward when appropriate
$env:NODE_OPTIONS = "--enable-source-maps"
npx vextjs start
Remove-Item Env:NODE_OPTIONS
```

`vext start --enable-source-maps` is not a valid Vext option. Do not modify a recorded production JS file to append a comment: that changes its owned hash. For more readable output, rebuild with `npx vextjs build --no-minify`.

### Source Map Purpose

| Use             | Condition                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Error stack     | Map and JS come from the same build, and the runtime/tool associates them correctly               |
| APM analysis    | Upload and associate versions according to that platform; Vext does not set this up automatically |
| Local debugging | Use a debugger that supports external maps and verify actual breakpoint locations                 |

Backend maps are not automatically frontend static assets, but a reverse proxy or custom static server may expose them. Maps can contain source; define access boundaries when deploying.

## Comparison with DevCompiler

`vext build` and `vext dev` share base esbuild configuration (`createBaseEsbuildConfig()`) for module semantics, while development rebuilds and production delivery differ:

| Features               | `vext dev` (DevCompiler)                                | `vext build` (BuildCompiler)          |
| ---------------------- | ------------------------------------------------------- | ------------------------------------- |
| **Output directory**   | `.vext/dev/` (temporary, gitignored)                    | `dist/` (persistent, deployable)      |
| **Compilation mode**   | Incremental + single-file compilation                   | Full compilation                      |
| **Source Map**         | Linked on full compile; external on single-file compile | External (`.js.map`, no link comment) |
| **Hot reload**         | Supported (Tier 1/2/3)                                  | Not supported (one-time compilation)  |
| **Extra exclusions**   | None                                                    | config/development, local, test       |
| **NODE_ENV injection** | None                                                    | `"production"`                        |
| **MetaFile**           | None                                                    | Yes (compile statistics)              |

Elapsed time depends on project size, machine, cache, and frontend pipeline. This comparison concerns the TypeScript backend compiler.

### Shared configuration

The esbuild configuration shared by both includes:

- `platform: 'node'` — Node.js runtime
- `target: 'node20'` — Minimum support for Node.js 20.19.0
- `format: 'cjs'` — CommonJS output
- Each backend source retains its own CommonJS `.js` output. esbuild resolves local references and marks modules external so hot reload keeps separate module identities.
- Static local references, literal `import()`, and `require.resolve()` for `.ts/.js/.mts/.cts/.mjs/.cjs` map to their emitted `.js` files. Full and incremental compilation share JSONC, extends, and paths resolution.
- Imports of excluded frontend files, out-of-root sources, or files without independent backend outputs produce diagnostics. A supported source extension does not imply that arbitrary runtime path expressions can be rewritten.
- `treeShaking: true` — dead code elimination
- `keepNames: true` — keep function names
- `charset: 'utf8'` — UTF-8 encoding
- `loader` — `.ts`/`.js`/`.json` and other file type mappings

## Compilation results

On success, the command prints backend statistics and a final completion marker. This excerpt is from one API scaffold build; count, time, and path vary by project:

```text
[vextjs] backend compiled
[vextjs]    files:   5
[vextjs]    time:    134ms
[vextjs]    output:  <project>/dist/
[vextjs] ✅ build complete
```

With frontend enabled, frontend and optional upload stages follow the backend success log. Deploy only after the whole command exits successfully; `backend compiled` alone does not mean the complete build succeeded.

### BuildResult structure

This is the internal backend compiler result for understanding logs and implementation, **not a public call API exported from the `vextjs` package root**, and not the frontend upload result.

| Field                 | Type                    | Meaning                                                                         |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `success`             | `boolean`               | Whether this backend compile succeeded                                          |
| `fileCount`           | `number`                | Count of backend JS, copied business JSON, and project preloads, excluding maps |
| `totalFiles`          | `number`                | Count of backend source, business JSON, and preload inputs                      |
| `elapsed`             | `number`                | Backend compile time in milliseconds                                            |
| `outDir`              | `string`                | Output directory                                                                |
| `warnings` / `errors` | `Message[]`             | esbuild diagnostics                                                             |
| `metafile`            | `Metafile \| undefined` | Backend compile metadata, possibly absent on failure                            |

## Run the compiled product

```bash
npx vextjs start
# Explicitly select an output directory from a completed build
npx vextjs start --outdir dist
```

TypeScript startup rejects missing, failed, or identity-mismatched build output. Use `vext dev` for development source startup; a pure JavaScript backend continues to load source in production.

With frontend enabled, startup checks `index.html` in the configured frontend output and serves static files according to the public resource manifest. Page rendering depends on routes using `res.render()` and related configuration. **Without configured `spaFallback`, its default scopes are empty; non-API requests do not automatically fall back to the SPA home.** Enable `spaFallback: true` or set scopes explicitly; see [CSR and SPA Fallback](/frontend/csr-and-spa-fallback).

General scaffolds have no fixed `dist/index.js` startup entry. Use `vext start`; do not infer a directly executable entry from the directory mapping above.

### VEXT_BUILT tag

For a compiled backend, the CLI sets `VEXT_BUILT=1` and passes the actual build directory. Routes, services, plugins, middleware, and models load from that output; explicitly configured paths still follow each module's resolution rules. Pure JavaScript source mode continues using `src/`. The CLI owns these markers. Setting `VEXT_BUILT=1` manually does not replace a successful build or identity verification.

## Deployment manifest

In a build environment with an existing project and lockfile, run:

```bash
npm ci
npx vextjs build --typecheck --outdir dist
```

After a successful build, deliver the following to the runtime environment:

| Content                      | Purpose                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `package.json` and lockfile  | Install production dependencies; `vextjs` and runtime imports belong in dependencies                  |
| Complete `dist/`             | Backend output, `dist/package.json`, `.vext-build.json`, default frontend client output               |
| Custom frontend output       | Deploy it too when configured outside dist                                                            |
| `.vext/build-location.json`  | Keep when startup discovers output from the build record; `start --outdir dist` selects it explicitly |
| Additional runtime resources | Application-read files and host preloads according to actual paths                                    |
| `src/`                       | Needed in JavaScript source mode; usually not needed for a compiled backend                           |

In the runtime environment, run `npm ci --omit=dev` and `npx vextjs start --outdir dist`. Check health and key business routes before directing traffic. Do not remove build-time TypeScript before building; a build in place does not require reinstalling all dependencies each time.

### Docker multi-stage build

This template is for a **TypeScript API project** without extra runtime resources, with a `start` script of `vext start` and source/configuration under `src`. Frontend projects also need their public and other build inputs; projects extending tsconfig or using workspace packages need their own additional files.

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
RUN npx vextjs build --typecheck --outdir dist

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["npm", "start", "--", "--outdir", "dist"]
```

The runtime stage selects dist explicitly and retains its identity files, not just a few JS files. Choose base image, port, and mounted resources for the deployment. See [Deployment](/guide/deployment) for the complete release process.

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

Check the project root, source directory, language detection, and exclusion rules; a TypeScript backend needs actual compilable input. Fix specific type diagnostics instead of treating removal of `--typecheck` as a type fix.

### Module not found during runtime

```
Error: Cannot find module './routes/users.js'
```

Distinguish the missing module type:

1. Bare package name such as `redis`: check package.json production dependencies and runtime installation.
2. Relative module path: check exclusions, complete deployment, and whether the reference points to real output.
3. Dynamically constructed business path or extra file read: check the working directory and deployed resources; the compiler cannot infer arbitrary expressions.
4. Declaration-only `.d.ts`: reference a real runtime module instead of copying a type declaration as an implementation.

Do not attribute every missing module to a forgotten reinstall after build.

### Source Map does not take effect

Check that a map was generated, that JS has a discoverable link, and that map and JS match the deployed build. The backend production build uses external mode; `NODE_OPTIONS=--enable-source-maps` alone cannot automatically associate these maps. See [Source Map](#source-map) for the boundary and command syntax.

### Build succeeds but startup fails

Check the output directory and profile actually selected by start, build identity, and frontend directory. Carry complete output when switching machines. Failed build stages, unrecovered transactions, and externally modified recorded files cannot be fixed by editing a ready marker. Repair inputs or rebuild based on the reported path; see [CLI](/guide/cli).

## Next step

- Learn about the complete deployment guide at [Deployment and Production](/guide/deployment)
- See [Hot Reload](/guide/hot-reload) to learn about development mode compilation strategies
- Learn the full parameters of `vext build` in [CLI Commands](/guide/cli)
- Explore [Cluster Multi-Processing](/guide/cluster) to take full advantage of multi-core CPUs

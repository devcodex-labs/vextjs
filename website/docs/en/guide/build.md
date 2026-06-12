# Build (vext build)

`vext build` compiles TypeScript/JavaScript source code into deployable JavaScript products and outputs them to the `dist/` directory. The current version of `vext build` is designed according to **production-target build**: it will statically inject production mode into `process.env.NODE_ENV` in the user source code, but which environment configuration file is actually loaded during runtime is still determined by `NODE_ENV` at the time of `vext start`. Based on [esbuild](https://esbuild.github.io/) implementation, the pure compilation phase is extremely fast - the compilation time of a typical project (50+ source files) is usually within **1 second**.

## Quick Start

```bash
# Compile the production product
vext build

# Run the built product (TypeScript project must have generated a valid dist/)
NODE_ENV=production vext start

# Load custom environment configuration (src/config/sg-sit.ts needs to exist)
NODE_ENV=sg-sit vext start
```

## Build pre-product refresh

When a TypeScript project executes `vext build`, it will first refresh the generated and manifest products required by the development tool chain, and then enter optional type checking and esbuild compilation:

1. `vext typegen` basic refresh: write `.vext/types/*.generated.d.ts`, `src/types/generated/index.d.ts` and `.vext/manifest/services.json`
2. `doctor routes --refresh --write-manifest`: Rescan routes and write `.vext/manifest/routes.json`
3. If `--typecheck` is passed in, execute `tsc --noEmit` at this time
4. Finally, esbuild outputs `dist/`

This ensures that new scaffolding or projects that have just cleaned `.vext/` can also get the latest generated type in `vext build --typecheck` before entering TypeScript verification.

## Compilation strategy

### File-by-File Transform

`vext build` uses **file-by-file compilation** mode instead of bundle mode - each source file is independently compiled into an output file, maintaining the directory structure mapping of `src/`:

```
src/dist/
├── index.ts → ├── index.js + index.js.map
├── config/ ├── config/
│ ├── default.ts → │ ├── default.js + default.js.map
│ └── production.ts → │ └── production.js + production.js.map
├── routes/ ├── routes/
│ ├── users.ts → │ ├── users.js + users.js.map
│ └── posts.ts → │ └── posts.js + posts.js.map
├── services/ ├── services/
│ ├── user.ts → │ ├── user.js + user.js.map
│ └── auth.ts → │ └── auth.js + auth.js.map
├── plugins/ ├── plugins/
│ └── redis.ts → │ └── redis.js + redis.js.map
├── middlewares/ └── middlewares/
│ └── auth.ts → └── auth.js + auth.js.map
└── models/ └── models/
    └── user.ts → └── user.js + user.js.map
```

### Why not Bundle?

| Features | File-by-file compilation | Bundle |
| ---------- | ---------------------------- | ---------------------------- |
| Directory structure | Keep the original structure for easy debugging | Merge into a single/few files |
| Source Map | Exact mapping to source file line numbers | Mapping may be inaccurate |
| Module loading | Node.js native parsing `require()` | Need to customize runtime |
| Hot reloading | Single file replacement possible (development mode) | Full recompile required |
| Dependency management | External dependencies are resolved by Node.js | Externals needs to be configured |

## Compile options

### CLI parameters

| Parameters | Description | Default value |
| ------------------ | ----------------------------------------------- | ------- |
| `--outdir <path>` | Output directory | `dist` |
| `--clean` | Clean the output directory before compilation | `false` |
| `--sourcemap` | Generate source map | `true` |
| `--no-sourcemap` | Disable source map | — |
| `--minify` | Compress output code | `false` |
| `--typecheck` | Execute `tsc --noEmit` after refreshing generated / manifest | `false` |

### Output format

| Options | Values | Description |
| -------- | ------------- | ----------------------------------------------- |
| Format | `cjs` (CommonJS) | Unified output of CommonJS to ensure that `require.cache` is controllable |
| Target | `node20` | Align with `engines.node >= 20.19.0` |
| Platform | `node` | Node.js runtime |
| Charset | `utf8` | Force UTF-8, avoid Chinese escaping |

### Optimization options

| Options | Default | Description |
| -------------------------- | ---------------------------- | ------------------------------------- |
| Source Map | `external` (`.js.map` file) | Error stack mapped back to TypeScript line numbers |
| Tree Shaking | Enable | Remove unused exports (dead code elimination) |
| Keep Names | On | Keep function/class names (error stack readability) |
| Minify | Off | Optional on, reduce product volume |
| packages | `external` | External dependencies are not packaged and are resolved by Node.js at runtime |

### Automatic injection

The following definitions are automatically injected at compile time:

```typescript
define: {
  'process.env.NODE_ENV': '"production"'
}
```

This will cause the `process.env.NODE_ENV` branch in the user source code after build to be statically collapsed according to production semantics.

Note that this injection does not equal "fixed loading of `config/production.ts` at runtime". Which configuration file is actually loaded during runtime is still determined by `NODE_ENV` when `vext start`, for example:

```bash
NODE_ENV=sg-sit vext start
```

Will try to load:

```text
dist/config/sg-sit.js
```

Therefore, the current recommended usage of `vext build` is:

- Use it to generate production-target artifact
- Use `NODE_ENV` of `vext start` to select the environment configuration file
- Do not rely on the `process.env.NODE_ENV` conditional branch in the user source code after build to do sit/uat/prod switching

If you want to set `NODE_ENV` cross-platform in `package.json` scripts, it is recommended to use `cross-env`:

```json
{
  "scripts": {
    "start:sg-sit": "cross-env NODE_ENV=sg-sit vext start"
  }
}
```

## File scanning rules

### Included files

`vext build` scans the `src/` directory for all files matching the following patterns:

```
**/*.{ts,js,mjs,cjs}
```

### Excluded files

Compilation automatically excludes the following files (two-level exclusion rules):

#### Universal exclusions (shared with development mode)

| Mode | Description |
| ------------------ | ----------------------------------------------- |
| `**/*.d.ts` | TypeScript type declaration (type only, no runtime code) |
| `**/*.test.*` | Test file |
| `**/*.spec.*` | Test files |
| `**/__tests__/**` | Test directory |

#### Additional exclusions for production compilation

| Mode | Description |
|----------------------|--------------------------|
| `**/config/development.*` | Development environment configuration (meaningless for production) |
| `**/config/local.*` | Local override configuration (never deployed) |
| `**/config/test.*` | Test environment configuration (not required for production) |

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
NODE_OPTIONS=--enable-source-maps NODE_ENV=production vext start
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

| Scene | Description |
| -------- | ------------------------------------- |
| error stack | map back to original TypeScript line number |
| APM tools | Sentry / Datadog and other tools to locate source code |
| Debugging | `node --inspect --enable-source-maps` |

:::warning
When deploying to a production environment, the `.js.map` file can remain on the server (not exposed by HTTP), but do not deploy to a CDN or static file serving.
:::

## Comparison with DevCompiler

`vext build` and `vext dev` share the same esbuild base configuration (`createBaseEsbuildConfig()`), ensuring consistent compilation behavior in development and production environments:| Features | `vext dev` (DevCompiler) | `vext build` (BuildCompiler) |
| ------------------ | ---------------------------------- | ---------------------------------- |
| **Output directory** | `.vext/dev/` (temporary, gitignore) | `dist/` (persistent, deployable) |
| **Compilation mode** | Incremental compilation + single file compilation | Full compilation (full volume each time) |
| **Source Map** | inline (embedded JS file) | external (standalone `.js.map`) |
| **Hot reload** | Supported (Tier 1/2/3) | Not supported (one-time compilation) |
| **Extra Exclusions** | None | config/development, local, test |
| **NODE_ENV injection** | None | `"production"` |
| **MetaFile** | None | Yes (compile statistics) |
| **Typical time consuming** | ~23ms (incremental) | ~500ms (full) |

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

| Field | Type | Description |
| -------------------------- | ----------- | -------------------------------- |
| `success` | `boolean` | Whether the compilation was successful (no errors) |
| `fileCount` | `number` | Number of output JS files |
| `totalFiles` | `number` | Total number of input source files |
| `elapsed` | `number` | Compilation time (milliseconds) |
| `outDir` | `string` | Output directory path |
| `warnings` | `Message[]` | esbuild warning message |
| `errors` | `Message[]` | esbuild error message |
| `metafile` | `Metafile` | esbuild compilation meta information (file size, etc.) |

## Run the compiled product

```bash
# Basic startup
NODE_ENV=production vext start

# Enable source map (recommended)
NODE_OPTIONS=--enable-source-maps NODE_ENV=production vext start

# Increase the memory limit
NODE_OPTIONS="--enable-source-maps --max-old-space-size=4096" NODE_ENV=production vext start
```

If the TypeScript project lacks `dist/` or key build products, `vext start` will fail directly and prompt to execute `vext build` first. Please use `vext dev` to start the source code during the development period.

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
NODE_OPTIONS=--enable-source-maps NODE_ENV=production npx vext start
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
ENV NODE_ENV=production
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
NODE_OPTIONS=--enable-source-maps NODE_ENV=production vext start

# ❌ Parameter position error
vext start --enable-source-maps
```

## Next step

- Learn about the complete deployment guide at [Deployment and Production](/guide/deployment)
- See [Hot Reload](/guide/hot-reload) to learn about development mode compilation strategies
- Learn the full parameters of `vext build` in [CLI Commands](/guide/cli)
- Explore [Cluster Multi-Processing](/guide/cluster) to take full advantage of multi-core CPUs
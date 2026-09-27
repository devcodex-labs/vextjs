# CLI commands

:::tip Release and source scope
Published stable package: `v2.0.0`. This page also describes changes in the current repository source that may not yet be published. Check the installed package version before using a version-specific command; general installation commands do not pin a version.
:::

The `vext` CLI covers project creation, development, builds, production startup, and operations. This page starts with a verifiable lifecycle, then documents individual commands. Job and MCP extensions follow the core lifecycle.

Prerequisites: Node.js satisfying the installed package's `^20.19.0 || >=22.12.0` range and npm. Run `create` from the intended parent directory; run other commands from the directory containing the application's `package.json`. Only subcommands that declare `--root` accept it. Check the actual installed version with `npx vextjs --version`; sample output illustrates format, not a required pinned version.

## Installation

The `vext` CLI is installed with the `vextjs` package, no additional installation is required:

```bash
npm install vextjs
```

Examples using `NAME=value command` use Bash syntax. In PowerShell, set `$env:NAME = "value"` first, run the command, and restore the prior environment value afterward.

The `vext ...` commands below are written for package scripts. In a regular terminal, use `npx vextjs ...` without a global install. Use `--` to pass additional arguments through `npm run`, for example `npm run dev -- --port 8080`:

```bash
# via npx
npx vextjs <command>

# Via package.json scripts (recommended)
npm run dev    # → vext dev
npm start      # → vext start
npm run build  # → vext build
```

## Command overview

| Command                       | Purpose                                                 | Long-running process or file writes                               |
| ----------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `vext create <name>`          | Create a project                                        | Writes project files and installs dependencies by default         |
| `vext dev`                    | Develop and reload                                      | Starts a service and creates development outputs                  |
| `vext build`                  | Build production artifacts                              | Writes declarations, manifests, and build outputs                 |
| `vext start`                  | Start production                                        | Starts an application or Cluster                                  |
| `vext stop`                   | Stop Cluster                                            | Signals the process recorded in a PID file                        |
| `vext reload`                 | Request rolling Cluster replacement                     | Signals a process; unsupported on Windows                         |
| `vext status`                 | Query Cluster PID and health endpoint                   | Reads PID information and makes HTTP requests                     |
| `vext typegen`                | Generate types and diagnose dependencies (experimental) | Writes outputs by default; `--check` is read-only                 |
| `vext doctor routes / all`    | Static diagnostics (experimental)                       | Read-only by default; writes require explicit options             |
| `vext deploy assets`          | Upload frontend assets                                  | Uploads by default; `--dry-run` only produces a plan              |
| `vext job ...`                | Inspect or run background jobs                          | Depends on subcommand: inspect, enqueue, execute, or stay running |
| `vext mcp` / `sync` / `skill` | MCP server, host sync, Skill export                     | stdio server stays running; sync and skill write can write files  |

## From project creation to production startup

Choose a directory that does not exist yet. This TypeScript API-only example verifies the CLI lifecycle first:

```bash
npx vextjs create my-api --template api --frontend none
cd my-api
npm run dev
```

A successful create installs dependencies. If `--skip-install` was used or installation failed, run `npm install` in the generated directory. From another terminal, request both endpoints (use `curl.exe` on PowerShell):

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/health
```

Both should return 200. The home endpoint returns a greeting; health has `data.status` equal to `"ok"`. Stop dev with Ctrl+C, wait for the port to become free, then run:

```bash
npm run build
npm start -- --port 3000
```

The build should pass type checking and create valid artifacts. Repeat both requests against production startup. Port 3000 is explicit for this check; the scaffold's production configuration defaults to 3001. Stop this single-process service with Ctrl+C. A CLI exit code of 0 proves only that its stated phase completed; verify service availability with real requests.

The default full-stack template serves a React server-rendered home page, with APIs at `/api/hello` and `/api/health`; see [Quick Start](/guide/quick-start). The command examples below are independent use cases. Do not start multiple services by running each line in sequence.

## `vext create` — Create a project

Generate a project skeleton and configuration from a name and options. The CLI asks before replacing a nonempty target directory unless `--force` is given. The default template is `fullstack-react`; API-only scaffolding is available through `--template api --frontend none`. The full-stack starter opens with a server-rendered Vext launchpad that you can edit immediately, including a Vext Guide link and a local API documentation entry at `/docs`. Its default configuration enables OpenAPI, so the local entry works in both `vext dev` and production `vext start`; API-only projects remain opt-in.

### Usage

```bash
npx vextjs create <project-name> [options]
```

### Options

| Options             | Description                                                             | Default                                                 |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `--template <name>` | Project template (`fullstack-react` / `api`)                            | `fullstack-react`                                       |
| `--frontend <name>` | Frontend target (`react` / `none`)                                      | Depends on template: React for full-stack, none for API |
| `--adapter <name>`  | Specify Adapter (native/hono/fastify/express/koa)                       | `native`                                                |
| `--js`              | Create a JavaScript project (not TypeScript)                            | `false`                                                 |
| `--skip-install`    | Skip `npm install`                                                      | `false`                                                 |
| `--force`           | Skip confirmation, delete a nonempty target directory, then recreate it | `false`                                                 |
| `-h, --help`        | Show help                                                               | —                                                       |

### Example

```bash
# Create TypeScript full-stack project (default Native Adapter)
npx vextjs create my-app

# Specify Adapter
npx vextjs create my-app --adapter hono
npx vextjs create my-app --adapter fastify

# Create JavaScript full-stack project
npx vextjs create my-app --js

# Create API-only project
npx vextjs create my-api --template api --frontend none

# Skip dependency installation
npx vextjs create my-app --skip-install
```

The command accepts exactly one project name. Extra positional arguments fail before any target directory is created. If automatic dependency installation fails, `create` exits non-zero and keeps the generated files; run `cd <project-name>` followed by `npm install` to retry. Generated TypeScript full-stack projects include NodeNext-compatible mappings for the built-in `@frontend`, `@pages`, `@components`, `@styles`, and `@assets` aliases.

Project names must begin with a letter, number, or underscore and may contain only letters, numbers, underscores, hyphens, and periods. Path separators are invalid; change into the target parent directory first. The create examples above are alternatives, not sequential steps. Combining `--template api` with `--frontend react`, or `fullstack-react` with `none`, is rejected.

### Generated directory structure

```
my-app/
├── public/
│ ├── favicon.svg # Contrast-safe favicon variant of the V mark
│ └── vext-mark.svg # Transparent V mark used by the starter app shell
├── src/
│ ├── config/
│ │ ├── default.ts # Shared configuration (port: 3000)
│ │ ├── development.ts # Development profile
│ │ ├── production.ts # Production profile
│ │ ├── local.ts # Empty local override; ignored by Git
│ │ └── bootstrap.ts # Tracked startup entry with providers: []
│ ├── frontend/
│ │ ├── components/AppShell.tsx # Shared React shell
│ │ ├── locales/en-US.ts # Starter messages
│ │ ├── pages/ # React pages, layout, document, and error page
│ │ └── styles/index.css # Vext launchpad styles
│ ├── routes/index.ts # URL handler and server data
│ ├── services/example.ts # Example service
│ └── types/
│   ├── generated/.gitkeep # Vext-managed typegen output root (TS projects)
│   ├── shared/
│   │ └── greeting.d.ts # Application-owned data contract shared by server and UI
│   └── frontend/
│     └── home.d.ts # Application-owned page/render contract
├── package.json
├── tsconfig.json
└── .gitignore
```

#### Type directory boundaries

The tree above is the default **TypeScript full-stack** starter. Its `src/types/**` folders have separate owners:

| Location                 | Owner            | Use it for                                                                                                                                                                           |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types/generated/**` | Vext tooling     | Declarations refreshed by `vext typegen`; do not hand-edit generated files.                                                                                                          |
| `src/types/shared/**`    | Your application | Serializable data contracts shared by server code and the UI, such as `GreetingDto`.                                                                                                 |
| `src/types/frontend/**`  | Your application | Page and render contracts consumed by the route that renders a page and by `src/frontend/**`, such as `HomePageProps`. Keep server-only implementation details out of this boundary. |

In TypeScript projects, `vext typegen` writes only
`src/types/generated/**`; it does not replace application-owned files in
`shared/**` or `frontend/**`. JavaScript create/dev/typegen flows do not create
that public TypeScript tree; their tooling declarations remain under
`.vext/types`.

| Starter                                                | Initial `src/types/**` layout                  |
| ------------------------------------------------------ | ---------------------------------------------- |
| TypeScript full-stack (default)                        | `generated/**`, `shared/**`, and `frontend/**` |
| TypeScript API-only (`--template api --frontend none`) | `generated/**` only                            |
| JavaScript starter                                     | No `src/types` directory is created            |

The scaffold does not reserve `src/types/server/**`. Keep a type that is private to one route or service next to that server owner; create `src/types/server/services/**` only when your application has a real shared backend service boundary. Runtime enum/constant values belong owner-near or under `src/constants/services/**`, not under `src/types/**`; see [Project structure](/guide/project-structure).

The starter deliberately does not create root or directory-level placeholder `README.md` files. Generated user source is English-first in both TypeScript and JavaScript, for full-stack and API-only templates; files under explicit locale directories are the only language-content exception. Conventional directories such as `src/middlewares/`, `src/plugins/`, `src/locales/`, and the canonical `src/preload/` remain supported and are created when you add real source files. The legacy project-root `preload/` directory is not scaffolded.

For the default fullstack starter, `public/vext-mark.svg` is a transparent navigation mark and `public/favicon.svg` is a contrast-safe favicon variant. They share the same V geometry; the app shell uses the former, and both are copied with the rest of `public/` assets.

After creation is complete:

```bash
cd my-app
npm run dev
```

Visit `http://localhost:3000` and you should see a React server-rendered page with client interaction. API routes are available at `/api/hello` and `/api/health`.

`vext create` directly generates `src/config/local.ts` as an empty `VextConfigOverride` and `src/config/bootstrap.ts` with `providers: []`. The defaults have no logger, provider, external connection, or other business side effect. `local.ts` is excluded by `.gitignore` and may be absent after clone; `bootstrap.ts` is tracked and can later register a provider through `defineBootstrapConfig()`.

## `vext dev` — development mode

Start the project in development mode, supporting file monitoring and smart hot reloading.

### Usage

```bash
vext dev [options]
```

`vext dev` does not support positional arguments. Value options such as `--root`, `--port`, `--host`, `--config`, `--poll-interval`, `--debounce`, `--startup-profile-json`, and `--port-conflict` must be followed by a non-option value; numeric options require complete integers, so prefixes such as `3000x` and `50x` fail.

### Options

| Options                      | Description                                                       | Default                         |
| ---------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| `--root <path>`              | Specify the project root directory                                | Current directory               |
| `--config <name>`            | Select the development config profile                             | `development`                   |
| `--port <number>`            | Specify port                                                      | Value in configuration file     |
| `--host <address>`           | Specify the listening address                                     | Value in the configuration file |
| `--debounce <ms>`            | Debounce interval (milliseconds, 0 = disable)                     | `0`                             |
| `--poll`                     | Force polling mode (Docker/NFS environment)                       | `false`                         |
| `--poll-interval <ms>`       | Polling interval (milliseconds, only valid when `--poll` is used) | `1000`                          |
| `--no-hot`                   | Disable Soft Reload, all changes go to Cold Restart               | —                               |
| `--strict-preflight`         | Make TypeScript semantic diagnostics re-block startup/reloading   | —                               |
| `--port-conflict <strategy>` | Port conflict strategy (`error/prompt/kill/next`)                 | `error`                         |
| `--verbose-lifecycle`        | Output detailed lifecycle logs and complete watcher change list   | —                               |
| `--startup-profile`          | Output startup phase summary and detailed time consumption        | —                               |
| `--startup-profile-json <p>` | Write startup phase time to JSON file                             | —                               |
| `--clear`                    | Clear the console after each reload                               | —                               |
| `-h, --help`                 | Show help                                                         | —                               |

#### Port conflict policy

- `error`: direct failure (default)
- `prompt`: Ask the parent process how to handle it in TTY environment
- `kill`: Stop the unique process matching the local listening address and complete port, after rechecking ownership. Multiple owners, hidden PIDs, or an ownership change produce an error; inspect the conflict again before retrying.
- `next`: automatically selects the next available port

```bash
vext dev --port-conflict prompt
vext start --port-conflict next
```

In a monorepo, run commands from the specific service directory, or pass `--root` to `vext dev`. Start, dev, Cluster workers, package preloads, and TypeScript checks resolve dependencies for that service, including hoisted installs and pnpm links. If the startup entry is missing, rebuild or reinstall that framework version. Doctor and typegen can analyze source structure without requiring compiled framework startup artifacts.

Project language follows executable backend sources. A JavaScript project may retain a `tsconfig.json` for `allowJs`/`checkJs` and still use the JavaScript startup path. Backend TypeScript requires a production build even without a tsconfig. Declarations, tests, the default `src/client/` directory, and independently handled preloads do not trigger backend TypeScript detection. Config entry points are `default.ts`, `default.js`, `default.mjs`, or `default.cjs`; `default.mts`/`default.cts` produce an explicit unsupported-entry diagnostic.

#### Start log tiering

By default, `vext dev` prints the listening address and total startup time, then the necessary results of cold restarts or hot reloads. `vext dev --startup-profile` prints a human-readable summary and detailed events grouped by `main/preflight`, `main/preload`, `pre-worker-bootstrap`, `compile`, `config`, `i18n`, `database`, `plugins`, `middleware`, `services`, `routes`, `openapi`, `listen`, and `onReady`. Unnamed gaps above the threshold appear as `gap.*` in profile JSON.

`--startup-profile-json <path>` only writes JSON files and will not automatically print summary or details; if you need to output both at the same time, you can combine `--startup-profile --startup-profile-json <path>`.

If you need life cycle troubleshooting details, you can enable:

```bash
vext dev --verbose-lifecycle
VEXT_VERBOSE_LIFECYCLE=1 vext start
```

### Example

```bash
# Use default settings from configuration file
vext dev

# Specify port
vext dev --port 8080

# Specify address and port
vext dev --host 127.0.0.1 --port 8080

# Turn on 50ms anti-shake (merged into one reload when saving in quick succession)
vext dev --debounce 50

# Docker/NFS environment uses polling mode
vext dev --poll --poll-interval 2000

# Disable backend Soft Reload; frontend client updates remain independent
vext dev --no-hot

# Output the summary and detailed time consumption of the startup phase
vext dev --startup-profile

# Only write JSON, do not print summary/details
vext dev --startup-profile-json .vext/inspect/startup-profile.json
```

### Hot reload strategy

`vext dev` selects a path from the change and its dependencies. This is an overview; duration and state retention depend on the actual change and have no fixed millisecond guarantee:

| Path                | Typical changes                                                                | Behavior                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Backend Soft Reload | routes, services, middlewares, models, or other backend sources                | Compile the candidate and update affected services/models and handlers; a failure may retain the old generation or require a cold restart |
| Locale update       | Backend locale files                                                           | Load and validate the dictionary, then replace the application's translation runtime                                                      |
| Cold Restart        | config, plugins, preload, package/lockfile, tsconfig, and other startup inputs | Restart the worker; ports and connections are recreated                                                                                   |
| Frontend update     | frontend sources and public assets                                             | Rebuild the frontend; suitable React modules can Fast Refresh, while other changes may reload the page                                    |

See the [Hot Reload](/guide/hot-reload) chapter for details.

`--no-hot` changes backend soft reloads to cold restarts; frontend-only client changes still follow the frontend path. A worker that has exited must restart. Custom directories, dependency spread, `--no-hot`, and configured cold/ignore patterns can change classification; use the actual terminal result. Updating a frontend page does not necessarily refresh server request data; see [Frontend development workflow](/frontend/dev-workflow).

### package.json script

```json
{
  "scripts": {
    "dev": "vext dev"
  }
}
```

## `vext build` — Build the project

Compile TypeScript sources to JavaScript, defaulting to `dist/`, after refreshing typegen and route manifests. Build, start, and output inspection select `--outdir`, then `VEXT_BUILD_OUTDIR`, then `.vext/build-location.json`, and finally `dist`. `build --clean` cleans the same selected output. Unless `frontend.outDir` is explicit, frontend output follows its `client/` subdirectory.

After project detection and configuration evaluation, the build records a `building` identity. Only after the backend, frontend, and optional upload succeed does one transaction commit `ready` to both `.vext/build-location.json` and `.vext-build.json` inside the output, followed by the final success message. Their buildId, profile, backend, and directory must agree. A failed artifact stage marks only the current generation `failed` and leaves the successful location unchanged. Failure or interruption in the same output blocks startup; failure in a different output does not invalidate the previous successful directory. Preparation failures do not start an artifact build or change the previous identity.

Startup rejects pending transactions and externally modified recorded identities. The next build verifies and recovers interrupted transactions; older or failed generations cannot mark themselves successful. Deleting a recorded location does not fall back to starting or building `dist`; select the intended output explicitly. An explicit `vext build --outdir <directory>` can select output when the location record is missing or corrupt, but does not bypass recorded ownership conflicts. Inspect conflicting files or select a fresh output directory. Legacy `dist/` without records retains structural inspection without build identity guarantees. Identity validation does not verify every business artifact's contents.

### Usage

```bash
vext build [options]
```

### Options

| Options            | Description                                                           | Default                                     |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------- |
| `--outdir <path>`  | Output directory                                                      | Environment, successful record, then `dist` |
| `--config <name>`  | Load `src/config/<name>` for build-time configuration                 | `production`                                |
| `--clean`          | Remove owned stale outputs after successful candidate compilation     | `false`                                     |
| `--sourcemap`      | Generate source map                                                   | `true`                                      |
| `--no-sourcemap`   | Disable source map                                                    | —                                           |
| `--minify`         | Compress output code (enabled by default; retained for compatibility) | `true`                                      |
| `--no-minify`      | Disable output compression                                            | —                                           |
| `--typecheck`      | Execute `tsc --noEmit` after refreshing generated / manifest          | `false`                                     |
| `--upload-assets`  | Upload frontend static assets after the frontend build                | `false`                                     |
| `--deploy-dry-run` | Print the frontend upload plan without writing assets                 | `false`                                     |
| `-h, --help`       | Show help                                                             | —                                           |

The CLI flag remains opt-in for an existing project. New TypeScript starters set their generated `package.json` build script to `vext build --typecheck`, so `npm run build` includes semantic checking by default. JavaScript full-stack starters use `vext build`; JavaScript API-only starters do not generate a build script and can start from source.

`--deploy-dry-run` requires `--upload-assets` and only simulates the upload stage. The build still writes local artifacts.

Production CLI builds minify backend output by default. Use `--no-minify` for readable local output, or set `VEXT_BUILD_MINIFY=false` when the opt-out is controlled by the environment. Frontend production minification still follows `frontend.build.minify`.

### Example

```bash
# Build project
vext build

# Refresh generated / manifest and then perform type checking and build again
vext build --typecheck

# Build successfully, then remove owned stale outputs
vext build --clean

# Specify output directory
vext build --outdir build

# Keep readable output for a local inspection
vext build --no-minify

# Upload frontend static assets after building
vext build --upload-assets

# Print the frontend upload plan only
vext build --upload-assets --deploy-dry-run

# Start after building
vext build && vext start
```

### Build behavior

- For a TypeScript backend, refresh `.vext/types/*.generated.d.ts`, `.vext/manifest/services.json`, and `.vext/manifest/routes.json` first; TypeScript projects also refresh `src/types/generated/index.d.ts`
- For a TypeScript backend with `--typecheck`, execute the project-local `tsc --noEmit` after refreshing generated products; missing local TypeScript fails with an actionable error and never falls back to network resolution
- Compile TypeScript backend code with esbuild. A JavaScript-only backend stays in source mode rather than becoming a `dist` backend; build the frontend separately when enabled
- Positional arguments are not supported; value options such as `--outdir` and `--config` require a non-option value
- Without an explicit directory or successful build record, output defaults to `dist/`; the examples below use this default
- Maintain source code directory structure
- `.js` and `.js.map` files are generated by default; declaration files will not be generated in `dist/`
- Repeated builds remove owned stale backend outputs from deleted or renamed source files after a successful candidate. `--clean` also follows the ownership manifest and preserves unknown files. Compilation failure retains the previous successful generation; an unknown file occupying a target path causes a conflict.
- Destructive cleanup fails closed when the resolved output is the project root, source root, or their parent; frontend output, asset directory, naming patterns, and server outfile must also remain inside their declared build boundary
- When frontend is enabled, `dist/client/index.html`, `manifest.json`, `deploy-manifest.json`, `size-report.json`, static assets, and client contract artifacts are generated
- When `--upload-assets` is used, Vext reads `dist/client/deploy-manifest.json` and uploads only changed static assets by sha256 and `frontend.deploy.upload.stateFile`

### package.json script

```json
{
  "scripts": {
    "build": "vext build --typecheck",
    "prepublishOnly": "vext build --typecheck"
  }
}
```

:::tip development vs build

- **`vext dev`**: Load `.ts` files directly from `src/`, compile on-the-fly through esbuild, support hot reloading
- **`vext build`**: compile a TypeScript backend to the selected output; keep a JavaScript backend in source mode; build the frontend according to its configuration
  :::

## `vext start` — Start production mode

Start in production mode. TypeScript requires `vext build`; start loads the selected output and rejects invalid artifacts. Without `--config`, `VEXT_CONFIG`, or a legacy NODE_ENV profile, start uses the recorded build profile, falling back to production for legacy output.

A valid compiled deployment may omit `src/`: carry package.json, runtime dependencies, the output directory, and `.vext/build-location.json`, or select output with `--outdir`. Keep `.vext-build.json` inside the output. Plain JavaScript source mode, development, and rebuilding still require source files.

`.vext/freshness/` contains local ownership and recovery state bound to the project's real path. It is not a portable deployment manifest. When deploying elsewhere, copy the successful artifacts listed above instead of the entire `.vext/` directory. Recover any pending transaction and complete a successful build before assembling a deployment package.

### Usage

```bash
vext start [options]
```

`vext start` does not support positional arguments. Value options such as `--port`, `--host`, `--config`, `--port-conflict`, and `--startup-profile-json` must be followed by a non-option value.

### Options

| Options                      | Description                                                                       | Default                              |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| `--port <number>`            | Specify port                                                                      | Value in configuration file          |
| `--outdir <path>`            | Select compiled output                                                            | Environment, successful record, dist |
| `--host <address>`           | Specify the listening address                                                     | Value in the configuration file      |
| `--config <name>`            | Select a config profile, loaded from the output config directory in compiled mode | See profile selection below          |
| `--port-conflict <strategy>` | Port conflict strategy (`error/prompt/kill/next`)                                 | `error`                              |
| `--startup-profile`          | Output summary and detailed time consumption of production startup phase          | —                                    |
| `--startup-profile-json <p>` | Write the production startup phase time to a JSON file                            | —                                    |
| `--verbose-lifecycle`        | Output detailed lifecycle logs                                                    | —                                    |
| `-h, --help`                 | Show help                                                                         | —                                    |

### Example

```bash
# Build first, then start
vext build
vext start

# Specify port
vext start --port 8080

# Automatically switch to the next available port when there is a port conflict
vext start --port-conflict next

# Check the production cold-start phase time consumption
vext start --startup-profile
vext start --startup-profile-json .vext/inspect/start-profile.json

# Explicitly load the production profile and override the port
vext start --config production --port 8080

# Load a custom config profile (src/config/sg-sit.ts needs to exist)
vext start --config sg-sit
```

### Default command

When no command is passed, `vext` executes `start` by default:

```bash
# The following two methods are equivalent
vext
vext start
```

### Cluster mode

If `cluster` is enabled in the configuration, `vext start` will automatically enter Cluster mode, and the Master process will manage multiple Worker processes:

```typescript
// src/config/production.ts
export default {
  cluster: {
    enabled: true,
    workers: "auto", // The framework calculates the worker count from available CPUs
  },
};
```

Or enable via environment variable:

```bash
VEXT_CLUSTER=1 vext start
```

### Automatic preload injection

`vext start` and `vext dev` will automatically parse two types of preload sources:

1. `vext.preload` declared in the installed dependency package
2. canonical `src/preload/` in the application project

These scripts will be injected uniformly through `--import` before the child process is started. For example, `@devcodex/opentelemetry` can use the package-level `vext.preload` to automatically initialize the OpenTelemetry SDK before loading the application code; the application project itself can place a script in `src/preload/` to bridge the pre-launch environment. Project-level preload rules:

- The canonical directory is `src/preload/`
- Non-recursive scan
- Project-level preload is executed first, and package-level preload is executed later.
- `.mjs` / `.js` direct injection
- Dev and plain JavaScript source mode compile `.ts` / `.mts` to `.vext/preload/*.mjs` before startup; compiled start loads `preload/*.mjs` from the selected output
- Explicit external output directories follow the same rule: start validates build identity before bounding preload reads to that output root. Missing preloads do not fall back to source, and links escaping the output root are rejected. Dependencies still resolve from the service root, in both single-process and cluster mode.
- External backend output includes the owned `.vext-dependencies.cjs` helper. Project preload entries establish the dependency scope before loading compiled payloads from `.vext-preload/`. Deploy the complete output directory together with the service's `package.json` and runtime dependencies, preserving their relative locations; source files may be omitted. Do not move individual helper files or combine multiple services in one output directory.
- If the files in `src/preload/` change under `vext dev`, cold restart will be triggered.
- Project-root `preload/` is a temporary compatibility fallback that emits a migration warning. Do not place supported preload files in both directories: Vext fails fast rather than running scripts twice.

See [Preload](/guide/preload) for details.

### Configuring Provider during startup

If `src/config/bootstrap.ts` exists, `vext start` and `vext dev` run its bootstrap config providers before config validation and freezing, then merge their patches. Precedence is `default < config profile < local (development only) < provider < CLI`. Compiled start reads config from the selected output; see [Configuration](/guide/configuration) for JSON/JS entry formats and loading conditions.

In Cluster mode, the Master will pass the current round of provider patches to the Worker for reuse, preventing the Master/Worker from seeing different remote configurations in the same startup cycle.

### package.json script

```json
{
  "scripts": {
    "build": "vext build --typecheck",
    "start": "vext start",
    "start:sg-sit": "vext start --config sg-sit",
    "start:us-uat": "vext start --config us-uat",
    "deploy:assets:sg-sit": "vext deploy assets --config sg-sit --dry-run"
  }
}
```

:::tip Config profile selection
Explicit selection follows `--config > VEXT_CONFIG > compatibility profile from a nonstandard NODE_ENV`. Without an explicit selection, dev defaults to `development` and build to `production`; start and deploy assets first use the selected successful artifact's recorded profile, falling back to `production` only when no record exists. To select a custom profile:

- CLI argument: `vext start --config sg-sit`
- Environment variable: `VEXT_CONFIG=sg-sit vext start`

The profile name maps to `src/config/{profile}.ts` and, after build, the corresponding config file in the selected output directory.
Pass `--config` at most once per command. `start`, `dev`, `build`, and `deploy assets` reject duplicate occurrences instead of silently using the last value.
:::

## `vext stop` — stop the service

Stop a running Cluster service. The CLI reads its PID file, sends SIGTERM, and waits up to 30 seconds for the Master to exit. A timeout exits nonzero and does not prove the process stopped. Signal handling and connection draining depend on the platform and runtime; verify the process and port afterward.

### Usage

```bash
vext stop [options]
```

`vext stop` does not support positional arguments. `--pid-file` must be followed by a non-option path value.

### Options

| Options             | Description   | Default     |
| ------------------- | ------------- | ----------- |
| `--pid-file <path>` | PID file path | `.vext.pid` |
| `-h, --help`        | Show help     | —           |

### Example

```bash
# graceful stop
vext stop

# Specify PID file
vext stop --pid-file /var/run/myapp.pid
```

:::info
`vext stop` targets the Cluster PID file. For a single-process service, prefer Ctrl+C in its startup terminal; a process manager should request shutdown through its platform-supported method and verify that connections and resources are cleaned up.
:::

## `vext reload` — rolling restart

Send `SIGHUP` to a Cluster Master to request one-by-one Worker replacement. This is supported on Unix/macOS only; Windows exits nonzero and asks you to stop and start manually. A successfully sent signal does not prove every Worker was replaced.

### Usage

```bash
vext reload [options]
```

`vext reload` does not support positional arguments. `--pid-file` must be followed by a non-option path value.

### Options

| Options             | Description   | Default     |
| ------------------- | ------------- | ----------- |
| `--pid-file <path>` | PID file path | `.vext.pid` |
| `-h, --help`        | Show help     | —           |

### Example

```bash
# Rolling restart after deploying new version
vext build
vext reload
```

### Rolling restart process

```
1. Send SIGHUP to the Master process
2. Master restarts Workers one by one:
   a. Start a new Worker
   b. Wait for the new Worker to be ready
   c. Gracefully shut down the old Worker
   d. Repeat until all Workers are updated
3. If a new Worker is not ready, keep the old Worker and record the failure; inspect replaced/total and make real business requests.
```

:::tip Applicable scenarios
Confirm a successful build before requesting reload, then inspect Master logs and actual business responses. Availability depends on new Worker readiness, old connection draining, capacity, and business compatibility. Long connections may be terminated after shutdown timeout. Windows stop/start interrupts service and is not rolling replacement.
:::

## `vext status` — View running status

Read the PID file to determine whether its process is alive, then probe `/health` on the selected host and port. This command does not list all Workers, CPU use, or request counts. It prints PID, uptime, and memory from the HTTP response only if those fields are at the top level; it does not unpack business health data under `data`.

### Usage

```bash
vext status [options]
```

`vext status` does not support positional arguments. Value options such as `--pid-file`, `--port`, and `--host` must be followed by a non-option value.

### Options

| Options             | Description       | Default     |
| ------------------- | ----------------- | ----------- |
| `--pid-file <path>` | PID file path     | `.vext.pid` |
| `--port <number>`   | Health probe port | `3000`      |
| `--host <address>`  | Health probe host | `127.0.0.1` |
| `-h, --help`        | Show help         | —           |

### Example

```bash
vext status
vext status --port 8080
```

### Output example

```text
Status: 🟢 running
  Master PID: 12345
  PID file:   /srv/my-app/.vext.pid
  Health:     (endpoint unreachable at http://127.0.0.1:3000/health)
```

This illustrates a live process whose health endpoint is unreachable; PID and path are examples. Other states include `not running`, `stale`, and `invalid PID file`. A status exit code of 0 does not prove application health and cannot serve as a readiness probe. The command does not read the project's configured port automatically. The full-stack starter's health route is `/api/health`, while this command still probes `/health`; verify the actual health endpoint separately.

## `vext deploy assets` — Upload frontend static assets

Read the successful build record and the resolved `frontend.outDir/deploy-manifest.json`, then upload declared public JavaScript, CSS, images, fonts, and copied `public/**` resources. Built-in adapters are `filesystem` and `mock`; cloud vendors can use a custom deploy adapter.

### Usage

```bash
vext deploy assets [options]
```

`vext deploy assets` does not support positional arguments. Value options such as `--manifest`, `--adapter`, `--target-dir`, `--prefix`, and `--state-file` must be followed by a non-option value, for example `--manifest dist/client/deploy-manifest.json`; `--manifest --dry-run` fails as a missing-value error.

### Options

| Options               | Description                                     | Default                                         |
| --------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `--outdir <path>`     | Select backend build output                     | Successful build record, else `dist`            |
| `--config <name>`     | Select the deploy profile                       | Successful build profile                        |
| `--manifest <path>`   | Deploy manifest path                            | Resolved `frontend.outDir/deploy-manifest.json` |
| `--adapter <name>`    | Upload adapter, such as `filesystem` or `mock`  | Config value                                    |
| `--target-dir <path>` | Filesystem adapter target directory             | Config value                                    |
| `--prefix <path>`     | Upload key prefix                               | Config value                                    |
| `--state-file <path>` | Incremental upload state file                   | Config value                                    |
| `--dry-run`           | Print the upload plan without writing assets    | `false`                                         |
| `--json`              | Output JSON results or errors with asset status | `false`                                         |
| `-h, --help`          | Show help                                       | —                                               |

### Example

```bash
# Use the upload target from configuration
vext deploy assets

# Plan only
vext deploy assets --dry-run

# Override this upload target directory and key prefix
vext deploy assets --target-dir .deploy/cdn --prefix my-app/v1
```

On the second run, Vext reads `frontend.deploy.upload.stateFile` and compares each `uploadKey` sha256. Unchanged JavaScript, CSS, images, fonts, and stable public files are skipped instead of uploaded again. `index.html` and source maps are not part of the default deploy manifest because Vext still renders HTML from the server path and keeps source maps out of CDN publishing by default.

## `vext typegen` — Generate declarations and perform service dependency diagnostics (experimental)

Provide generated declarations for `app.services` and `app.extend()` / `defineAppExtensions<{ ... }>()` in plugins, and perform tooling-only service dependency checks.

### Usage

```bash
vext typegen [options]
```

`vext typegen` does not accept positional arguments. Unknown arguments fail fast with an actionable diagnostic. Value options such as `--root` / `-C` require a non-option value; `--root --json` is rejected instead of treating `--json` as a path.

### Options

| Options            | Description                                       | Default           |
| ------------------ | ------------------------------------------------- | ----------------- |
| `--services`       | Generate only `services.generated.d.ts`           | `false`           |
| `--app-extensions` | Generate only `app-extensions.generated.d.ts`     | `false`           |
| `--check`          | Only verify generated results, do not write files | `false`           |
| `--json`           | Output machine-readable JSON                      | `false`           |
| `--write-manifest` | Write `.vext/manifest/services.json`              | `false`           |
| `--root <path>`    | Specify the project root directory                | Current directory |
| `-C <path>`        | `--root` alias                                    | —                 |
| `--verbose`        | Reserved for subsequent detailed logging          | `false`           |
| `-h, --help`       | Show help                                         | —                 |

### Products

```text
.vext/types/services.generated.d.ts
.vext/types/app-extensions.generated.d.ts
src/types/generated/index.d.ts # TypeScript projects only; Vext-managed
.vext/manifest/services.json # Only with explicit --write-manifest
```

For TypeScript projects, `src/types/generated/**` is the only `src/types/**`
location written by `vext typegen`. JavaScript projects keep the hidden
`.vext/types` products but receive no public `.d.ts` shim. The full-stack
starter's `shared/**` and `frontend/**` folders are application-owned
contracts; see [Generated directory structure](#generated-directory-structure)
for their roles and template-specific availability.

### Example

```bash
vext typegen
vext typegen --check
vext typegen --write-manifest
vext typegen --services --root ./examples/hello-world
```

### Applicable Boundary

- A typegen invocation shares one sealed source capture across its service inventory, plugin extensions, dependency diagnostics, and generated candidates. Diagnosis does not reread files or execute project modules. Declaration files (`.d.ts`, `.d.mts`, `.d.cts`) are excluded as services; type imports for `.mts` / `.cts` sources use `.mjs` / `.cjs` respectively.
- Sources require valid UTF-8. Default budgets are 5000 files, 2MiB per file, 64MiB total, and 50000 entries during directory discovery. Override them with non-negative integers in `VEXT_SOURCE_MAX_FILES`, `VEXT_SOURCE_MAX_FILE_BYTES`, `VEXT_SOURCE_MAX_TOTAL_BYTES`, and `VEXT_SOURCE_MAX_SCAN_ENTRIES`; byte limits use bytes. Doctor, typegen, and build-time source collection share this policy, with explicit internal call options taking priority. Exceeding a budget reports incomplete analysis rather than an empty success. These budgets do not limit service execution or MCP response sizes.
- Directory links within the project retain their logical paths: a `src/routes/billing` link still contributes the `/billing` prefix. Cycles, links escaping a declared root, and file links report incomplete analysis instead of silently omitting routes. A sealed analysis is not an atomic directory-tree snapshot; sources must still be checked before committing outputs.
- Selected declarations, the shim, and the optional service manifest are committed together after dependency checks. Blocking diagnostics, unreadable outputs, or ownership conflicts preserve existing files. Unselected declarations remain, while the shim references only the selected declarations.
- `--check` compares actual files without writing outputs or ownership records and can run alongside a development service. Missing or different content is stale; read failures retain their diagnostic. Identical output is not rewritten. Review and resolve manual edits to generated files before regenerating.
- `typegen` as a whole still belongs to the **tooling-only** capability and will not enter the main runtime path of `vext start`;
- `vext dev` will automatically execute basic `typegen` in preflight, `vext build` will also refresh generated declarations and manifests before optional typecheck and compilation;
- TypeScript semantic diagnostics are output asynchronously after ready / reload by default; if you want to block startup or reload like the old behavior, you can use `--strict-preflight` or `VEXT_DEV_STRICT_PREFLIGHT=1`;
- TS projects give priority to output high-quality types, JS projects allow regression to `import(...).default` / `unknown`, but the command itself is still available;
- `--write-manifest` will write the service index, `app.extend()` / `defineAppExtensions<{ ... }>()` aggregation results and service dependency graph summary into `.vext/manifest/services.json`;
- More examples of generated declarations can be viewed in conjunction with the [Services](./services) and [Plugins](./plugins) documentation.

The service manifest records `sourceRevision`, `complete`, and `incompleteFiles` from the sealed source view. Generated files do not prove complete inference. Unknown plugin extensions or dependencies remain incomplete; current hashes are never attached to old manifests to fabricate freshness.

## `vext doctor routes` — Static routing diagnosis (experimental)

`vext doctor all` performs a separate aggregate analysis of routes, service dependencies and statically provable plugin extensions. JSON includes profile, valid, per-domain status and evidence. Effective runtime configuration and database connectivity remain unchecked without runtime evidence; `routes` is scoped to routes.

Scan the static route metadata in `src/routes/`, output diagnostics such as duplicate routes, missing `docs.summary`, automatic inference of `operationId`, etc., and save the results to the inspect/manifest product.

### Usage

```bash
vext doctor <target> [options]
```

Value options such as `--root` / `-C` require a non-option value; `--root --json` is rejected instead of treating `--json` as a path.

### Targets

| Target   | Description                                                                                  |
| -------- | -------------------------------------------------------------------------------------------- |
| `routes` | Scan static route metadata and OpenAPI related fields                                        |
| `all`    | Analyze route contracts, service dependencies and plugin extensions with per-domain evidence |

### Options

| Options            | Description                                                           | Default           |
| ------------------ | --------------------------------------------------------------------- | ----------------- |
| `--json`           | Output machine-readable JSON                                          | `false`           |
| `--write-inspect`  | Write `.vext/inspect/routes.json`                                     | `false`           |
| `--write-manifest` | Write `.vext/manifest/routes.json`                                    | `false`           |
| `--refresh`        | Compatibility option; current sources are already analyzed by default | `false`           |
| `--manifest-only`  | Explicitly read the existing manifest snapshot                        | `false`           |
| `--root <path>`    | Specify the project root directory                                    | Current directory |
| `-C <path>`        | `--root` alias                                                        | —                 |
| `-h, --help`       | Show help                                                             | —                 |

### Product positioning

| Products                     | Positioning                                                                          | Applicable objects                           |
| ---------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `.vext/inspect/routes.json`  | inspect / diagnostic middle layer, including diagnostic details and debugging fields | `doctor`, debug, in-depth analysis           |
| `.vext/manifest/routes.json` | Stable consumption layer, fields converge to routes-only manifest                    | Editor, CI, visualization, follow-up codemod |

### Example

```bash
vext doctor routes
vext doctor routes --write-inspect
vext doctor routes --write-inspect --write-manifest --json
```

### Current boundary

- `profile` is `static-routes` or `static-project`. Each entry in `domains` reports `checked`, `not-present`, `unsupported`, or `incomplete`. Dynamic service access and incomplete plugin projections retain their limitations. `valid` requires every mandatory check in that static profile to be complete and free of errors; `ok` only means there are no error diagnostics. Configuration, models, frontend and runtime execution checks are outside this static profile. Their unsupported status does not mean those capabilities are disabled.

- Doctor analyzes the route sources captured for this invocation. Route entries, the fingerprint, and the source-file inventory come from the same raw bytes; disk manifests are not reused as static-analysis caches. `--refresh` remains a compatibility option.
- CLI text, JSON, and inspect reports include `sourceFreshness`: `current` identifies this invocation's source analysis. `--manifest-only` preserves the historical snapshot's own source identity: a different fingerprint is `stale`; a missing or merely matching declared fingerprint is `unverified`. Missing fingerprints remain `null`; missing schema, freshness, or docsKind metadata remains unknown with a diagnostic. `ok` only means there are no blocking diagnostics; it does not attest to a historical snapshot or guarantee the disk has not changed after analysis.
- `--manifest-only` cannot be combined with `--refresh` or `--write-manifest`. Historical snapshots have size and format checks; corrupt data or out-of-bound source paths report errors.
- With both `--write-inspect --write-manifest`, the two outputs are committed together. An unreadable or externally modified output preserves existing files and reports an error. Ordinary diagnosis is read-only; writing shares ownership with dev/build for the same project.
- The development service also collects and generates the route manifest using the same ownership record as Doctor. A manifest is diagnostic or build input; its existence does not prove that the service has started, a reload generation has completed, or diagnostics contain no blocking issue.
- The current route manifest and services manifest are still maintained hierarchically and are not merged into a single overall manifest;
- When `docs.operationId` is missing, the doctor will give an `auto-operation-id` information prompt according to the runtime behavior instead of false warning;
- The routing side is still in charge of `doctor routes --write-manifest`; the service side is in charge of `typegen --write-manifest`.

## Job commands

Background jobs use `vext job list`, `vext job inspect <name>`, `vext job run <name>`, `vext job enqueue <name>`, `vext job scheduler`, `vext job worker`, `vext job runs`, and `vext job status <runId>`. These commands load the headless Job runtime without starting an HTTP server. See [Jobs](/guide/jobs).

```bash
vext job --help
vext job list --json
vext job inspect <name> --json
vext job runs --limit 10 --json
```

Replace `<name>` and `<runId>` with actual project Job names or run records. Common options include `--config <profile>`, `--outdir <dir>`, `--source`, and `--json`. Run and enqueue accept `--payload <json>` or `--payload-file <path>`; `runs --limit` requires a positive integer. Scheduler and worker stay running, while run and enqueue can have business side effects. Configure payloads, stores, workers/schedulers, and shutdown handling as described in Jobs before using them. Even list and inspect load the headless runtime; they are not purely static analysis that avoids evaluating project modules.

## MCP commands

### Entry points

| Command                                                      | Behavior                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `vext mcp --root .`                                          | Host-connected stdio server; runs until the connection closes                               |
| `vext mcp sync --root . --host codex --check --json`         | Reads and reports a plan without writing host config                                        |
| `vext mcp sync --root . --host codex --dry-run --json`       | Prints proposed managed config; cannot combine with `--check`                               |
| `vext mcp sync --root . --host codex --skill --json`         | Writes host config and optionally a project Skill; inspect check/dry-run first              |
| `vext mcp skill check` / `print`                             | Reads the bundled Skill summary or content                                                  |
| `vext mcp skill write --output .vext/skills/vextjs/SKILL.md` | Exports to a selected file; refuses different existing content unless `--force` is explicit |

`--root` defaults to the current directory. `sync --host` accepts codex, claude-code, cursor, vscode, or grok; when omitted, sync plans for declared hosts. Help is available through `vext mcp --help`, `vext mcp sync --help`, and `vext mcp skill --help`. The stdio server itself does not write host configuration; sync and skill write have the effects shown above. Its read-only boundary does not apply to every MCP subcommand.

### Server and host boundaries

`vext mcp --root <dir>` starts the bundled stdio MCP server bound to one Vext project root. It registers 7 Tools, 11 Resources, and 4 Prompts and provides bounded project inspection, built-in Vext knowledge search, create-only ChangeSet drafts for 17 Recipes, candidate validation, and host-side validation plans. The server does not run shell commands, start or restart services, apply file changes, run tests, or change host MCP configuration. It returns analysis, machine-checkable diagnostics, and steps for the host to execute.

`vext_knowledge_search` returns packaged knowledge, native API examples, and applicability. It distinguishes framework declaration scope, reviewed knowledge versions, and dependencies resolved separately for service and framework owners. Version mismatches and missing packages are explicit. MCP does not fetch online documentation or connect to databases. See [MCP generation and dependency knowledge](./mcp-generation) for directory overrides, all 17 Recipes, JS/TS contracts, comments, and integration.

`vext_validate_changes` checks content identity, source coverage, logical and physical directory boundaries, existing files, duplicate paths, UTF-8, digests, syntax, and imports. A shared overlay checks candidate interactions such as route conflicts. Results include file verdicts, directory provenance, and `requiredHostSteps`; unknown or incomplete evidence cannot yield `applyReady`. Default directories can be overridden, empty directories are not required, and line or function counts do not prove business correctness. The host checks project formatting and comment conventions.

`vext_project_check` runs bounded static diagnostics for missing directories, missing route response schemas, deprecated `docs.tags`, incomplete service dependency analysis, database `cursorSecret` choices, missing Redis stores or environment variables, SVG upload review, frontend form/API boundaries, and placeholder tests. It returns `diagnostics`, `totalBySeverity`, `affectedConsumers`, and `generatedState`; suggested commands remain host-executed. `vext_runtime_inspect` reads the framework-managed `.vext/runtime/snapshots/<instanceId>.json` snapshot. MCP does not start services, execute Jobs, or read raw logs; `vext mcp sync` owns host configuration writes.

The `jobs` section of `vext_project_inspect` statically reads `config.jobs` and Job sources and returns names, source files, queue and schedule information, payload schema presence, scheduler/worker/store summaries, host-run commands, and multi-process deployment notes. It does not execute Jobs, connect to queues, or read live queue state.

In monorepos, source ownership is checked against actual workspace members, shared package declarations, package exports/sourceExports, and consumer dependencies. Adjacent services are not read automatically. Explicit external models, locales, and frontend source directories are read-only when their paths can be proven. Names or shared declarations alone grant no cross-root write permission.

Regular CI runs focused MCP unit tests, `npm run verify:mcp`, and `npm run verify:public-surface`. Redis-backed capabilities use a separate CI lane with a real Redis service; local integration tests may report a skip when Redis is unavailable.

Before release, `npm run verify:pack-install` checks the packed installation across ESM/CJS, TypeScript contracts, runtime smoke, and MCP stdio smoke. It removes the temporary workspace on success and keeps evidence on failure. Set `VEXT_PREFLIGHT_KEEP_EVIDENCE=1` or `VEXT_PREFLIGHT_WORKSPACE=<dir>` only when evidence must remain after success. Real platform, database, browser, and five-host testing still belongs to release acceptance.

Host sync has a planning mode: `vext mcp sync --root <dir> --check --json` or `--dry-run` only prints a plan. Applying sync writes `.vext/mcp/launcher.cjs` and `.vext/mcp/hosts.json` in the project, the Codex user config (`CODEX_HOME/config.toml` first, otherwise the current user's `.codex/config.toml`), managed JSON/JSONC MCP entries for Claude Code, Cursor, and VS Code, and Vext-managed TOML blocks for hosts such as Grok. Apply reports per-target read-back `verified` results. An unmanaged same-key TOML table blocks the write and is preserved. When a launcher, host config, or Skill is written, `applied.nextSteps` gives host-specific reload, new-session, and read-only validation guidance. Real five-host runtime validation is still part of release acceptance; local file read-back cannot replace it.

The optional Skill ships with the package. Use `vext mcp skill check` for its summary, `vext mcp skill print` for Markdown, or `vext mcp skill write --output <file>` to export it. `vext mcp sync --skill` writes the official Skill to a selected host's project-local path. Different existing content returns blocked and remains intact.

## Global options

These options belong at the CLI entry point: `vext --help` and `vext --version`. Use `vext <command> --help` for a subcommand; do not assume that every subcommand accepts the entry-point version option.

| Options         | Description              |
| --------------- | ------------------------ |
| `-h, --help`    | Display help information |
| `-v, --version` | Display version number   |

```bash
# View version
vext --version
# Sample output from the current package: vextjs v2.0.0; check your installed version

# View help
vext --help
```

## Recommended package.json script

This example is for a TypeScript project. Merge it into your existing `package.json` and retain dependencies. Stop, reload, and status target Cluster mode. Configure Vitest and coverage dependencies as described in [Testing](/guide/testing) before using the test scripts. For JavaScript, remove inapplicable type checking and choose the build script according to whether the frontend is enabled.

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "dev": "vext dev",
    "build": "vext build --typecheck",
    "start": "vext start",
    "stop": "vext stop",
    "reload": "vext reload",
    "status": "vext status",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "typecheck": "tsc --noEmit"
  }
}
```

## FAQ

### `vext start` reports error "dist/ not found"

For a TypeScript backend, run `vext build` successfully first, then inspect the selected output directory (explicit option, environment, successful record, or default `dist`). A failed build or mismatched identity also prevents startup; directory existence alone is insufficient. When frontend is enabled, its complete output is required. The default frontend output is `client` under the selected directory; a custom `frontend.outDir` changes that path. A JavaScript-only backend remains in source mode; see [Build](/guide/build).

### Should I use `vext dev` or `vext start` when developing?

Daily development uses `vext dev`, which directly loads TypeScript files under `src/` and supports hot reloading without manual compilation. `vext start` is used in production environments.

### How to specify Node.js version?

VextJS requires Node.js **`^20.19.0 || >=22.12.0`**. Use a version in that range that your project has verified. Your chosen version manager can read `.node-version` or `.nvmrc`; the CLI itself does not install or switch Node. This is only an example file format:

```bash
echo "22" > .node-version
```

### `vext stop` / `vext reload` / `vext status` not working?

These commands use a Cluster PID file. Check how the service started, the working directory, and the actual PID file. If `cluster.pidFile` is customized, pass the same `--pid-file` to all three commands. Status needs the actual listening port explicitly; reload also requires Unix/macOS. Stop a single-process service with Ctrl+C in its startup terminal.

## Next step

- Learn change classification and reload boundaries in [Hot Reload](/guide/hot-reload)
- Configure the [Frontend guide](/frontend/overview)
- Learn the complete configuration of [Cluster multi-process](/guide/cluster)
- View options such as ports and logs in [Configuration](/guide/configuration)
- Explore the conventions of [Project Structure](/guide/project-structure)

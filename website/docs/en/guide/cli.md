# CLI commands

VextJS provides the `vext` command line tool, covering the complete life cycle of project creation, development, construction and deployment.

## Installation

The `vext` CLI is installed with the `vextjs` package, no additional installation is required:

```bash
npm install vextjs
```

After installation, it can be called in the following ways:

```bash
# via npx
npx vext <command>

# Via package.json scripts (recommended)
npm run dev # → vext dev
npm start # → vext start
npm run build # → vext build
```

## Command overview

| Command | Description | Common scenarios |
| -------------------- | ------------------------------------------------ | ------------------ |
| `vext create <name>` | Create a new project | Project initialization |
| `vext dev` | Start development mode | Daily development |
| `vext build` | Build project | Build before deployment |
| `vext typegen` | Generate declaration + service dependency diagnosis (experimental) | TS/JS project engineering assistance |
| `vext doctor routes` | Static route diagnosis + inspect / manifest (experimental) | OpenAPI / routing management |
| `vext start` | Start production mode | Production deployment |
| `vext stop` | Stop service | Cluster mode management |
| `vext reload` | Rolling restart | Zero-downtime updates |
| `vext status` | View running status | Cluster status monitoring |

## `vext create` — Create a project

Interactively create new VextJS projects and automatically generate project skeleton and configuration files. The default template is `fullstack-react`; API-only scaffolding remains available through `--template api --frontend none`.

### Usage

```bash
npx vextjs create <project-name> [options]
```

### Options

| Options | Description | Default |
| ------------------ | --------------------------------------------------------------- | -------- |
| `--template <name>` | Project template (`fullstack-react` / `api`) | `fullstack-react` |
| `--frontend <name>` | Frontend target (`react` / `none`) | `react` |
| `--adapter <name>` | Specify Adapter (native/hono/fastify/express/koa) | `native` |
| `--js` | Create a JavaScript project (not TypeScript) | `false` |
| `--skip-install` | Skip `npm install` | `false` |
| `--force` | Force overwriting if the target directory exists and is not empty | `false` |
| `-h, --help` | Show help | — |

### Example

```bash
# Create TypeScript full-stack project (default Native Adapter)
npx vextjs create my-app

#Specify Adapter
npx vextjs create my-app --adapter hono
npx vextjs create my-app --adapter fastify

# Create JavaScript full-stack project
npx vextjs create my-app --js

# Create API-only project
npx vextjs create my-api --template api --frontend none

# Skip dependency installation
npx vextjs create my-app --skip-install
```

### Generated directory structure

```
my-app/
├── preload/
│ └── README.md # Project-level preload script placeholder description
├── public/
│ └── favicon.svg # Static asset copied into the frontend build
├── src/
│ ├── client/
│ │ ├── App.tsx # React app
│ │ ├── index.html # HTML shell
│ │ ├── main.tsx # Browser entry
│ │ └── styles.css
│ ├── config/
│ │ ├── default.ts #Default configuration (port: 3000)
│ │ ├── development.ts # Development environment coverage
│ │ ├── production.ts # Production environment coverage (port: 3001)
│ │ ├── local.example.ts # Enable local coverage after copying to local.ts
│ │ └── bootstrap.example.ts # Copy to bootstrap.ts and enable startup provider
│ ├── routes/
│ │ └── index.ts # Example routing
│ ├── services/
│ │ └── example.ts # Example service
│ ├── middlewares/
│ │ └── README.md # Custom middleware placeholder description
│ ├── plugins/
│ │ └── README.md # Custom plug-in placeholder description
│ ├── locales/
│ │ └── README.md # i18n language pack placeholder description
│ └── types/
│ └── generated/
│ └── .gitkeep # typegen output directory placeholder (TS project)
├── package.json
├── tsconfig.json
└── .gitignore
```

After creation is complete:

```bash
cd my-app
npm run dev
```

Visit `http://localhost:3000` and you should see the React client. API routes are available at `/api/hello` and `/api/health`.

If you need to pull remote configuration (such as Nacos/bootstrap database configuration) before the configuration is frozen, you can copy `src/config/bootstrap.example.ts` to `src/config/bootstrap.ts` and register the provider through `defineBootstrapConfig()`. When local coverage is required, `src/config/local.example.ts` can be copied to `src/config/local.ts`, which is excluded by `.gitignore` by default.

## `vext dev` — development mode

Start the project in development mode, supporting file monitoring and smart hot reloading.

### Usage

```bash
vext dev [options]
```

### Options

| Options | Description | Default |
| ---------------------------- | ----------------------------------------------- | --------------- |
| `--port <number>` | Specify port | Value in configuration file |
| `--host <address>` | Specify the listening address | Value in the configuration file |
| `--debounce <ms>` | Debounce interval (milliseconds, 0 = disable) | `0` |
| `--poll` | Force polling mode (Docker/NFS environment) | `false` |
| `--poll-interval <ms>` | Polling interval (milliseconds, only valid when `--poll` is used) | `1000` |
| `--no-hot` | Disable Soft Reload, all changes go to Cold Restart | — |
| `--strict-preflight` | Make TypeScript semantic diagnostics re-block startup/reloading | — |
| `--port-conflict <strategy>` | Port conflict strategy (`error/prompt/kill/next`) | `error` |
| `--verbose-lifecycle` | Output detailed lifecycle logs and complete watcher change list | — |
| `--startup-profile` | Output startup phase summary and detailed time consumption | — |
| `--startup-profile-json <p>` | Write startup phase time to JSON file | — |
| `--clear` | Clear the console after each reload | — |
| `-h, --help` | Show help | — |

#### Port conflict policy

- `error`: direct failure (default)
- `prompt`: Ask the parent process how to handle it in TTY environment
- `kill`: Try to kill the process occupying the port
- `next`: automatically selects the next available port

```bash
vext dev --port-conflict prompt
vext start --port-conflict next
```

#### Start log tiering

By default, `vext dev` only prints the listening address and total startup time, and then prints the necessary results during cold restart / hot reload. `vext dev --startup-profile` will output a human-readable startup summary and detailed events; the summary is `main/preflight`, `main/preload`, `pre-worker-bootstrap`, `compile`, `config`, `i18n`, `database`, `plugins`, `middleware`, `services`, `routes`, `openapi`, `listen`, `onReady` Classification in other stages; unnamed empty windows that exceed the threshold will be entered into profile JSON in the form of `gap.*`.

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

#Specify port
vext dev --port 8080

#Specify address and port
vext dev --host 127.0.0.1 --port 8080

# Turn on 50ms anti-shake (merged into one reload when saving in quick succession)
vext dev --debounce 50

# Docker/NFS environment uses polling mode
vext dev --poll --poll-interval 2000

# Disable Soft Reload (all changes go to Cold Restart)
vext dev --no-hot

# Output the summary and detailed time consumption of the startup phase
vext dev --startup-profile

# Only write JSON, do not print summary/details
vext dev --startup-profile-json .vext/inspect/startup-profile.json
```

### Hot reload strategy

`vext dev` provides a three-layer hot reload strategy and automatically selects the optimal method:

| Level | Trigger Condition | Behavior | Speed |
| ----------------------- | ----------------------------------------- | ---------------------------- | ---------- |
| **Tier 1** — Hot route replacement | `src/routes/` file changes | Atomic replacement request handler, zero interruption | ⚡ Millisecond level |
| **Tier 2** — Service Reload | `src/services/` or `src/locales/` file changes | Rebuild affected service instances | ⚡ Milliseconds |
| **Tier 3** — Cold Reboot | `src/config/` or `src/plugins/` file changes | Full restart process | 🔄 Seconds |

See the [Hot Reload](/guide/hot-reload) chapter for details.

Frontend files under `src/client/**` and static assets under `public/**` trigger a frontend rebuild message. They do not require a backend cold restart unless mixed with backend changes.

### package.json script

```json
{
  "scripts": {
    "dev": "vext dev"
  }
}
```

## `vext build` — Build the project

Compile TypeScript source code into JavaScript to generate a production-usable `dist/` directory; tool products such as typegen and route manifest will be refreshed before building. When frontend is enabled, `vext build` also bundles the browser client into `dist/client/`.

### Usage

```bash
vext build [options]
```

### Options

| Options | Description | Default |
| ------------------ | ----------------------------------------------- | ------- |
| `--outdir <path>` | Output directory | `dist` |
| `--clean` | Clean the output directory before compilation | `false` |
| `--sourcemap` | Generate source map | `true` |
| `--no-sourcemap` | Disable source map | — |
| `--minify` | Compress output code | `false` |
| `--typecheck` | Execute `tsc --noEmit` after refreshing generated / manifest | `false` |
| `-h, --help` | Show help | — |

### Example

```bash
# Build project
vext build

# Refresh generated / manifest and then perform type checking and build again
vext build --typecheck

# Clean old dist and build
vext build --clean

#Specify output directory
vext build --outdir build

# Start after building
vext build && vext start
```

### Build behavior

- Refresh `.vext/types/*.generated.d.ts`, `src/types/generated/index.d.ts`, `.vext/manifest/services.json` and `.vext/manifest/routes.json` first
- When `--typecheck` is enabled, execute `tsc --noEmit` after refreshing the generated / manifest
- Use esbuild for server compilation and frontend bundling
- The output directory defaults to `dist/`
- Maintain source code directory structure
- `.js` and `.js.map` files are generated by default; declaration files will not be generated in `dist/`
- When frontend is enabled, `dist/client/index.html`, `manifest.json`, `size-report.json`, static assets, and client contract artifacts are generated

### package.json script

```json
{
  "scripts": {
    "build": "vext build",
    "prepublishOnly": "vext build"
  }
}
```

:::tip development vs build

- **`vext dev`**: Load `.ts` files directly from `src/`, compile on-the-fly through esbuild, support hot reloading
- **`vext build`**: compile `src/` to `dist/`, load production mode from `dist/`
  :::

## `vext typegen` — Generate declarations and perform service dependency diagnostics (experimental)

Provide generated declarations for `app.services` and `app.extend()` / `defineAppExtensions<{ ... }>()` in plugins, and perform tooling-only service dependency checks.

### Usage

```bash
vext typegen [options]
```

### Options

| Options | Description | Default |
| ------------------ | ----------------------------------------------- | -------- |
| `--services` | Generate only `services.generated.d.ts` | `false` |
| `--app-extensions` | Generate only `app-extensions.generated.d.ts` | `false` |
| `--check` | Only verify generated results, do not write files | `false` |
| `--json` | Output machine-readable JSON | `false` |
| `--write-manifest` | Write `.vext/manifest/services.json` | `false` |
| `--root <path>` | Specify the project root directory | Current directory |
| `-C <path>` | `--root` alias | — |
| `--verbose` | Reserved for subsequent detailed logging | `false` |
| `-h, --help` | Show help | — |

### Products

```text
.vext/types/services.generated.d.ts
.vext/types/app-extensions.generated.d.ts
src/types/generated/index.d.ts
.vext/manifest/services.json
```

### Example

```bash
vext typegen
vext typegen --check
vext typegen --write-manifest
vext typegen --services --root ./examples/hello-world
```

### Applicable Boundary

- `typegen` as a whole still belongs to the **tooling-only** capability and will not enter the main runtime path of `vext start`;
- `vext dev` will automatically execute basic `typegen` in preflight, `vext build` will also refresh generated declarations and manifests before optional typecheck and compilation;
- TypeScript semantic diagnostics are output asynchronously after ready / reload by default; if you want to block startup or reload like the old behavior, you can use `--strict-preflight` or `VEXT_DEV_STRICT_PREFLIGHT=1`;
- TS projects give priority to output high-quality types, JS projects allow regression to `import(...).default` / `unknown`, but the command itself is still available;
- `--write-manifest` will write the service index, `app.extend()` / `defineAppExtensions<{ ... }>()` aggregation results and service dependency graph summary into `.vext/manifest/services.json`;
- More examples of generated declarations can be viewed in conjunction with the [Services](./services) and [Plugins](./plugins) documentation.

## `vext doctor routes` — Static routing diagnosis (experimental)

Scan the static route metadata in `src/routes/`, output diagnostics such as duplicate routes, missing `docs.summary`, automatic inference of `operationId`, etc., and save the results to the inspect/manifest product.

### Usage

```bash
vext doctor <target> [options]
```

### Targets

| Target | Description |
| -------- | ----------------------------------------------- |
| `routes` | Scan static route metadata and OpenAPI related fields |
| `all` | Currently still an alias of `routes`, used to reserve subsequent extension bits |

### Options

| Options | Description | Default |
| ------------------ | ---------------------------------- | -------- |
| `--json` | Output machine-readable JSON | `false` |
| `--write-inspect` | Write `.vext/inspect/routes.json` | `false` |
| `--write-manifest` | Write `.vext/manifest/routes.json` | `false` |
| `--refresh` | Skip cache manifest and rescan routing diagnostics | `false` |
| `--root <path>` | Specify the project root directory | Current directory |
| `-C <path>` | `--root` alias | — |
| `-h, --help` | Show help | — |

### Product positioning

| Products | Positioning | Applicable objects |
| ---------------------------------- | -------------------------------------------------- | ---------------------------------- |
| `.vext/inspect/routes.json` | inspect / diagnostic middle layer, including diagnostic details and debugging fields | `doctor`, debug, in-depth analysis |
| `.vext/manifest/routes.json` | Stable consumption layer, fields converge to routes-only manifest | Editor, CI, visualization, follow-up codemod |

### Example

```bash
vext doctor routes
vext doctor routes --write-inspect
vext doctor routes --write-inspect --write-manifest --json
```

### Current boundary

- The current route manifest and services manifest are still maintained hierarchically and are not merged into a single overall manifest;
- When `docs.operationId` is missing, the doctor will give an `auto-operation-id` information prompt according to the runtime behavior instead of false warning;
- The routing side is still in charge of `doctor routes --write-manifest`; the service side is in charge of `typegen --write-manifest`.

## `vext start` — Start production mode

Start the project in production mode. TypeScript projects load compiled code from the `dist/` directory and need to execute `vext build` first; if there is no valid build product, the command will fail directly and prompt you to use `vext build` or use `vext dev` during development.

### Usage

```bash
vext start [options]
```

### Options

| Options | Description | Default |
| ---------------------------- | ---------------------------------- | --------------- |
| `--port <number>` | Specify port | Value in configuration file |
| `--host <address>` | Specify the listening address | Value in the configuration file |
| `--port-conflict <strategy>` | Port conflict strategy (`error/prompt/kill/next`) | `error` |
| `--startup-profile` | Output summary and detailed time consumption of production startup phase | — |
| `--startup-profile-json <p>` | Write the production startup phase time to a JSON file | — |
| `--verbose-lifecycle` | Output detailed lifecycle logs | — |
| `-h, --help` | Show help | — |

### Example

```bash
#Build first, then start
vext build
vext start

#Specify port
vext start --port 8080

# Automatically switch to the next available port when there is a port conflict
vext start --port-conflict next

# Check the production cold-start phase time consumption
vext start --startup-profile
vext start --startup-profile-json .vext/inspect/start-profile.json

# Load production configuration
PORT=8080 NODE_ENV=production vext start

# Load custom environment configuration (src/config/sg-sit.ts needs to exist)
NODE_ENV=sg-sit vext start
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
    workers: "auto", // Automatically detect the number of CPU cores
  },
};
```

Or enable via environment variable:

```bash
VEXT_CLUSTER=1 vext start
```

### Preload (Preload) automatic injection

`vext start` and `vext dev` will automatically parse two types of preload sources:

1. `vext.preload` declared in the installed dependency package
2. `preload/` in the root directory of the application project

These scripts will be injected uniformly through `--import` before the child process is started. For example, `vextjs-opentelemetry` can use the package-level `vext.preload` to automatically initialize the OpenTelemetry SDK before loading the application code; the application project itself can also directly place a script in the root directory `preload/` to bridge the pre-launch environment.First phase project-level preload rules:

- The directory is fixed to the project root `preload/`
- Non-recursive scan
- Project-level preload is executed first, and package-level preload is executed later.
- `.mjs` / `.js` direct injection
- `.ts` / `.mts` will be compiled into `.vext/preload/*.mjs` before startup and then injected
- If the files in `preload/` change under `vext dev`, cold restart will be triggered.

See [Preload](/guide/preload) for details.

### Configuring Provider during startup

If `src/config/bootstrap.ts` exists in the project, `vext start` / `vext dev` will execute the `bootstrap config provider` declared in it before configuring validate / freeze, and merge the patch returned by the provider into the final configuration. The priority is: `default < env < local < provider < CLI`.

In Cluster mode, the Master will pass the current round of provider patches to the Worker for reuse, preventing the Master/Worker from seeing different remote configurations in the same startup cycle.

### package.json script

It is recommended to use `cross-env` to set environment variables in cross-platform projects:

```bash
npm i -D cross-env
```

```json
{
  "scripts": {
    "build": "vext build",
    "start": "cross-env NODE_ENV=production vext start",
    "start:sg-sit": "cross-env NODE_ENV=sg-sit vext start",
    "start:us-uat": "cross-env NODE_ENV=us-uat vext start"
  }
}
```

Vext itself does not have built-in `cross-env`; it is just a recommended script layer compatibility tool for uniformly setting `NODE_ENV` under Windows, macOS, and Linux.

:::tip Environment file selection
Currently `vext start` does not have such a parameter as `--config <file>`. The selection mechanism for environment profiles is:

- Read runtime `NODE_ENV`
- Matches `src/config/{NODE_ENV}.ts` (corresponds to `dist/config/{NODE_ENV}.js` after build)

If you need custom environments such as `sg-sit.ts` and `us-uat.ts`, just set the corresponding `NODE_ENV` at startup.
:::

## `vext stop` — stop the service

Stop a running Cluster mode service. Send a stop signal by reading the PID file.

### Usage

```bash
vext stop [options]
```

### Options

| Options | Description | Default |
| ------------------- | ------------------- | ----------- |
| `--pid-file <path>` | PID file path | `.vext.pid` |
| `--force` | Forced termination (SIGKILL) | `false` |
| `-h, --help` | Show help | — |

### Example

```bash
# graceful stop
vext stop

# force stop
vext stop --force

#Specify PID file
vext stop --pid-file /var/run/myapp.pid
```

:::info
`vext stop` is only available in Cluster mode. In single-process mode, just use `Ctrl+C` or send `SIGTERM` signal to shut down gracefully.
:::

## `vext reload` — rolling restart

Triggers a zero-downtime rolling restart in Cluster mode. Restart Worker processes one by one to ensure that the service is always available.

### Usage

```bash
vext reload [options]
```

### Options

| Options | Description | Default |
| ------------------- | ----------- | ----------- |
| `--pid-file <path>` | PID file path | `.vext.pid` |
| `-h, --help` | Show help | — |

### Example

```bash
# Rolling restart after deploying new version
vext build
vext reload
```

### Rolling restart process

```
1. Send the SIGUSR2 signal to the Master process
2. Master restarts Workers one by one:
   a. Start a new Worker
   b. Wait for the new Worker to be ready
   c. Gracefully shut down the old Worker
   d. Repeat until all Workers are updated
3. There is always a Worker to process requests throughout the entire process, with zero downtime.
```

:::tip Applicable scenarios
After the code is updated, execute `vext build` + `vext reload` to complete the version update without downtime. Suitable for production environments requiring high availability.
:::

## `vext status` — View running status

View the service running status in Cluster mode, including information about the Master process and each Worker process.

### Usage

```bash
vext status [options]
```

### Options

| Options | Description | Default |
| ------------------- | ----------- | ----------- |
| `--pid-file <path>` | PID file path | `.vext.pid` |
| `-h, --help` | Show help | — |

### Example

```bash
vext status
```

### Output example

```
VextJS Cluster Status

Master PID: 12345
Workers: 4/4 running
Uptime: 2d 5h 32m

  PID State CPU Memory Requests
  12346 online 2.1% 48 MB 125,432
  12347 online 1.8% 52 MB 124,891
  12348 online 2.3% 47 MB 126,003
  12349 online 1.9% 50 MB 125,720
```

## Global options

All commands support the following global options:

| Options | Description |
| --------------- | ---------- |
| `-h, --help` | Display help information |
| `-v, --version` | Display version number |

```bash
# View version
vext --version
# Output: vextjs v0.3.25

# View help
vext --help
```

## Recommended package.json script

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "dev": "vext dev",
    "build": "vext build",
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

You need to execute `vext build` first to compile the TypeScript code. `vext start` loads compiled JavaScript files from `dist/`.

If frontend is enabled, `vext start` also requires `dist/client/index.html`.

### Should I use `vext dev` or `vext start` when developing?

Daily development uses `vext dev`, which directly loads TypeScript files under `src/` and supports hot reloading without manual compilation. `vext start` is used in production environments.

### How to specify Node.js version?

VextJS requires Node.js >= 20.19.0. It is recommended to create a `.node-version` or `.nvmrc` file in the project root directory to specify the version:

```bash
echo "22" > .node-version
```

### `vext stop` / `vext reload` / `vext status` not working?

These three commands are only available in Cluster mode. Make sure `cluster.enabled: true` is enabled in the configuration or the `VEXT_CLUSTER=1` environment variable is used, and the service is started via `vext start`.

## Next step

- Learn the details of the three-layer strategy of [Hot Reload](/guide/hot-reload)
- Configure [Frontend integration](/guide/frontend)
- Learn the complete configuration of [Cluster multi-process](/guide/cluster)
- View options such as ports and logs in [Configuration](/guide/configuration)
- Explore the conventions of [Project Structure](/guide/project-structure)

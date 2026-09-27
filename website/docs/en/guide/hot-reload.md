# Hot reload

VextJS provides development reload through `vext dev`. It watches file changes and, according to their role, runs a backend soft reload, frontend rebuild, or application Worker cold restart.

First verify a response change after saving with the example below. Then review reload scope, state retention, and failure recovery. Reload is for development feedback; for production process updates, see [Cluster](/guide/cluster).

## Quick Start

### 1. Prepare an application and route

Use an existing TypeScript API application, or create one through [the CLI walkthrough](/guide/cli#from-project-creation-to-production-startup) and install dependencies. Add this file at the project root:

```typescript
// src/routes/reload-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", async (_req, res) => {
    res.json({ message: "v1", pid: process.pid });
  });
});
```

The filename supplies the `/reload-demo` prefix automatically. Do not repeat it in the route's `"/"`. The PID is only for observing process changes in this example.

### 2. Start and record a baseline

```bash
npx vextjs dev --port 3000 --verbose-lifecycle
```

From another terminal:

```bash
curl -i http://127.0.0.1:3000/reload-demo
```

Expect HTTP 200 with `data.message` equal to `"v1"`. Record `data.pid`. If the project already has a `"dev": "vext dev"` script, you can instead run `npm run dev -- --port 3000 --verbose-lifecycle`.

### 3. Modify an existing file

Change `"v1"` above to `"v2"` and save. Wait for a successful reload result in the terminal, then repeat the request. Expect HTTP 200 and `data.message` equal to `"v2"`; under normal soft reload, the PID stays the same.

A detailed log may show the changed file and phase timing, for example:

```text
[hot-reload] [OK] 45ms [T1:code] #1
```

The timing is illustrative. `T1:code` describes this batch's modification of an existing backend file. An editor that saves by deleting and recreating the file may instead produce a structural event.

### 4. Check addition and cold restart

- Copy the example to `src/routes/reload-extra.ts`. A request to `/reload-extra` should work after the add, normally logged as `T2:structural`; after deleting the copy, that path should return 404.
- Add or change `logger: { level: "debug" }` in the existing config object in `src/config/default.ts`, retaining other settings. Wait until ready again and request `/reload-demo`. The response remains v2, but the PID should change.
- If the response differs, check for an error or recovery in the terminal. Detection of a file change alone does not prove completion.

Stop the development server with Ctrl+C. Interactive keys such as `h` and `r` require a foreground terminal and should not be relied upon in a background pipe.

### Logs and frontend updates

By default, the CLI prints the address, startup time, and reload results concisely. `--verbose-lifecycle` or `--startup-profile` shows detailed startup output; the former also prints the change list and reload phase timings.

With frontend enabled, pages, components, and static assets take a separate client rebuild path, outputting to `.vext/client/` by default. React Fast Refresh, CSS updates, and browser refresh after backend reload are controlled by frontend development settings. See [Fast Refresh](/frontend/fast-refresh) and [Render Refresh](/frontend/render-refresh). A successful backend request check does not guarantee browser state is preserved.

## Three-layer reloading strategy

Classify files by responsibility as cold, soft, client, or ignore. **Within soft, use modification type to choose T1 or T2.** A Service or Model file may take T1, and a new route may take T2.

### Tier 1 — Modify an existing backend file

A `modify` event for a soft-class file can cover routes, services, middlewares, models, and supported locale sources or resources.

```text
Compile changed files
  → Determine cache invalidation for modules and reverse dependencies
  → Update relevant locales, middleware definitions, and affected Services/Models
  → Create a new adapter and reassemble routes
  → Replace the HTTP handler reference
```

The final replacement is the request entry point, not one route object alone. The existing server socket keeps listening and new requests use the new handler. Requests already inside an old handler continue in its closure, but shared Services and other state it uses may have changed; do not assume in-flight requests are entirely unaffected.

Duration depends on dependencies and reassembly. Compiling a few files can still invalidate a broad dependency graph; reaching the cascade threshold upgrades to a cold restart.

### Tier 2 — Add, delete, or reload all sources

An `add` or `delete` event for a soft file, or a full source reload requested with `h`, rescans and compiles entry points before running the same runtime update sequence as T1.

| Example                                | Expected path                             |
| -------------------------------------- | ----------------------------------------- |
| Modify existing `src/services/user.ts` | T1                                        |
| Add `src/routes/orders.ts`             | T2                                        |
| Delete `src/services/unused.ts`        | T2, removing the loaded service reference |
| Modify `src/config/default.ts`         | Cold, outside T1/T2                       |

Renaming a file usually appears as deletion plus addition. Editor save behavior and other changes in the same batch can change the final event class.

### Tier 3 — Cold restart

Changes to config, plugins, preload, root `package.json`/lockfiles/`tsconfig.json`, and `.env*` require Worker reinitialization. The development parent waits for the old Worker to exit and the new one to become ready; service may be temporarily unavailable and requests can be interrupted.

```text
Detect change and run preflight
  → Stop old Worker
  → Refresh preload and start new Worker
  → Complete bootstrap and listen
  → Verify a request again after ready
```

Changing a middleware definition normally takes soft reload; changing the configured middleware assembly list takes cold restart because config changed. A dependency-file change does **not** automatically run `npm install`; install required dependencies yourself first.

### Services, Models, and shared state

Affected Services are re-instantiated; unaffected instances normally remain. The framework attempts to call an old instance's optional `dispose()`, logging a warning if it fails. Application code owns resource cleanup. In-process counters, timers, and long-lived caches should not be assumed to survive reload.

```typescript
// src/services/user.ts (independent example; modifying it normally takes T1)
import type { VextApp } from "vextjs";

export default class UserService {
  constructor(private app: VextApp) {}

  async findAll() {
    this.app.logger.debug("UserService.findAll");
    return { items: [], total: 0 };
  }
}
```

Read the current instance from `app.services` when needed. Another object's cached reference to an old service is not automatically updated when the property changes. Source import dependencies and dynamically held runtime references are not the same dependency graph.

When database and Model loading are enabled, affected Models attempt to replace registered definitions. This does not run a database migration or rewrite existing records. The following only illustrates a definition file; see [Database](/guide/database) for complete prerequisites and verification:

```typescript
// src/models/item.ts
import type { VextModelDefinition } from "vextjs";

export default {
  collection: "items",
  schema: { title: "string!", price: "number" },
} satisfies VextModelDefinition;
```

Restoring an old Service reference or Model definition cannot reverse external side effects already performed. If runtime updating fails, the overall process cold-restarts to recover a consistent state.

## Reload strategy decision table

This table uses the default layout. Resolved directories, event types, and failure recovery can change the actual action:

| Changed file                                                       | Normal action                  | Note                                                     |
| ------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------- |
| `src/routes/**`, `src/services/**`                                 | soft: modify T1, add/delete T2 | Reassemble routes and update affected services           |
| `src/middlewares/**`                                               | soft: modify T1, add/delete T2 | Reload middleware definitions                            |
| `src/models/**`                                                    | soft: modify T1, add/delete T2 | Replace affected definitions if database is enabled      |
| `src/locales/**` JSON or source                                    | soft: modify T1, add/delete T2 | Reload dictionaries                                      |
| Enabled frontend role directories and public assets                | client rebuild                 | React, CSS, and page behavior depends on frontend config |
| `src/config/**`, `src/plugins/**`                                  | cold                           | Reinitialize application                                 |
| `src/preload/**`, compatible root `preload/`                       | cold                           | Resolve and run preload again                            |
| Root `package.json`, supported lockfiles, `tsconfig.json`, `.env*` | cold                           | Dependencies or startup environment changed              |
| `src/types/generated/**`, generated output directories             | ignore                         | Avoid tool-generated reload loops                        |

Explicit external locale and Model read directories are registered separately by the layout, and their changes take the cold path. Watching is not limited to `src`.

## Relationship with `vext build`

`vext dev` compiles backend sources into `.vext/dev/`, and the Worker loads those development outputs. It does not require a prior `vext build`.

| Command      | Source                                                     | Compilation                                              | Reload                         |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------- | ------------------------------ |
| `vext dev`   | `src/`                                                     | esbuild on demand                                        | Three-layer development reload |
| `vext start` | Selected build output, or `src/` in JavaScript source mode | TypeScript needs build; JavaScript-only backend does not | None                           |
| `vext build` | `src/` to `dist/` by default                               | esbuild production build                                 | —                              |

The following uses a TypeScript project with the corresponding scripts. For JavaScript source mode and custom output, see [Build](/guide/build):

```bash
# During development
npm run dev          # vext dev, reload from src/

# When deploying
npm run build        # vext build, compile to dist/
npm start            # vext start, start from dist/
```

## CLI options

```bash
vext dev [options]

Options:
  --port <port> specifies the listening port (overrides the configuration file)
  --host <host> specifies the listening address
  --config <name> selects a config profile (default: development)
  --debounce <ms> debounce interval (milliseconds, default 0 is not enabled)
  --poll Force polling mode (Docker/NFS environment)
  --poll-interval <ms> Polling interval (milliseconds, default 1000)
  --no-hot use Cold Restart for backend changes; frontend-only updates remain separate
  --strict-preflight Make TypeScript semantic diagnostics re-block startup/reload
  --port-conflict <strategy>
                       Port conflict policy: error/prompt/kill/next
  --verbose-lifecycle Output detailed lifecycle logs and complete watcher change list
  --startup-profile Output startup phase summary and detailed time consumption
  --startup-profile-json <path>
                       Write startup phase time to JSON file
  --clear Clear the console after each reload
  -h, --help display help information
```

`--host ::` listens on IPv6 all interfaces; the ready log prints `http://[::1]:PORT` and bracketed IPv6 Network URLs. Explicit IPv6 hosts are printed as `http://[IPv6]:PORT`.

```bash
# Use custom port
vext dev --port 8080

# Specify the listening address
vext dev --host 127.0.0.1

# Turn on 50ms anti-shake (merged into one reload when saving in quick succession)
vext dev --debounce 50

# Docker/NFS environment uses polling mode
vext dev --poll --poll-interval 2000

# Automatically use the next available port in case of port conflict
vext dev --port-conflict next

# Check loader / hot reload details
vext dev --verbose-lifecycle

# Output startup summary and detailed time consumption, and write them into JSON
vext dev --startup-profile --startup-profile-json .vext/inspect/startup-profile.json
```

By default, `vext dev` only prints the listening address and total startup time; `--startup-profile-json <path>` only writes JSON and does not automatically print summary/details. When you need to see the time taken for each stage in the terminal, use `--startup-profile` explicitly.

## File monitoring rules

### Monitoring range

By default the watcher covers supported sources and resources under `src`, public assets, project preload, and specified root configuration/dependency files. With frontend enabled, it also watches resolved role directories such as pages, components, and `publicDir`, including project-local directories outside `src`.

Both native `fs.watch` and polling use snapshots to find additions and deletions. Static assets are not limited to JavaScript or CSS: `robots.txt` and PDFs can also trigger client rebuild. Backend layout registers custom locale and Model read directories separately.

### Ignore rules

Generated and dependency areas (`node_modules/`, `dist/`, `build/`, `.vext/`, `.git/`), `src/types/generated/`, framework temporary modules, and unrecognized file types normally do not enter reload. Root `.env*` has an explicit cold rule, so not every dot-prefixed file is ignored. Frontend public directories can also include ordinary text assets.

**Watch classification and compiler exclusion are separate rules.** An ordinary `src/**/*.test.ts` or `src/**/*.d.ts` may be classified as soft by the watcher but excluded from compilation. Changing one may produce a skip or compile diagnostic; it does not guarantee a business handler replacement. Put tests under project `test/` or `tests/` where appropriate, and use TypeScript checking for types.

`coldPatterns` and `ignorePatterns` are internal classifier extension points, not currently public `config.dev` options.

### Anti-shake processing

By default, anti-shake is not turned on (`debounce: 0`), and reloading is triggered immediately after file changes, with the fastest response. If you want to merge multiple changes into one reload when saving in quick succession, you can turn on the debounce window through `--debounce <ms>`.

For example: if `routes/users.ts` (Tier 1) and `config/default.ts` (Tier 3) are modified at the same time, the framework will perform a Tier 3 cold restart (including all changes).

## Reload coordination and failure recovery

Frontend watch targets come from the resolved configuration, including custom `frontend.root`, page/component directories, and `publicDir` inside the project but outside `src/`. Native watching and polling cover arbitrary public asset extensions such as `robots.txt` and PDF, as well as backend `.mts/.cts` additions and deletions. Restarting after configuration changes updates the watch targets. Mixed frontend/backend batches go to their respective build paths. The development parent receives directory data without executing configuration providers again.

The watcher establishes its baseline before initial checks and startup, so saves received during startup are processed afterward. Saves, manual restarts, and recovery run in sequence; repeated saves are coalesced by path while preserving the final add/delete state. Failed directory reads keep the last complete snapshot and retry with a diagnostic. Falling back to polling preserves pending changes.

Reload completion comes from the Worker's actual result. Compilation failures retain the last valid backend outputs; failures after runtime mutation, or an unconfirmed Worker result, require cold recovery. In an interactive terminal, `h` reloads all backend sources, `r` restarts the Worker, and `?` shows help. Cold restarts wait for the old Worker to exit and the replacement to finish initialization. Shutdown prevents queued tasks from starting.

Independent projects can run concurrently. Commands that write to the same real project root, including `dev`, `build`, and writing `typegen`, share ownership and report conflicts. `typegen --check` remains read-only. Each service still needs an available port; do not configure one service's directory as another service's output directory.

`vext dev` runs **dev preflight** before startup and reload or restart:

- Basic `typegen` refreshes `.vext/types/*.generated.d.ts`; TypeScript projects also refresh `src/types/generated/index.d.ts`.
- TypeScript semantic diagnostics run asynchronously by default, without delaying ready or reload.
- Blocking basic typegen issues skip the current reload/restart. Use `--strict-preflight` if TypeScript semantic diagnostics should also block it.

Route reloads use the compiler's actual project root, source directory, and output directory. A deeper custom output does not change source mapping or the manifest location. `.vext/manifest/routes.json` is committed only after handler construction and cache clearing succeed; a commit conflict prevents replacement and triggers cold recovery. During initial startup, the manifest is generated first as frontend build input. Use startup completion to establish readiness and the actual reload result to establish that a change took effect.

If soft reload fails before compilation and cache invalidation, the old handler continues serving. A failure after cache invalidation or while reloading locales, middleware, Services, Models, or routes may already have changed shared runtime state, so Vext requests a cold restart. Recovery stops the possibly mixed-state Worker first. If strict preflight blocks its replacement, service remains stopped until the issue is fixed and another save starts a clean process.

A failed frontend build retains the last valid output. A batch with both backend and frontend changes may complete only in part, requiring fuller recovery. Sending a terminal command successfully does not prove the Worker completed it; wait for the result and test an actual request.

## TypeScript support

The development backend is transpiled by esbuild. TypeScript semantic diagnostics use the project's local `tsc --noEmit`. Basic typegen runs first, then type diagnostics run asynchronously by default. The service can be ready before type checking finishes, or while errors are being reported.

- A blocking basic typegen issue stops the current startup or reload.
- Ordinary type errors produce diagnostics but do not block ready or reload by default.
- `--strict-preflight` waits for semantic diagnostics to pass before startup or reload.
- A project without tsconfig skips that TypeScript check; install resolvable local TypeScript for a configured project.

```bash
npx vextjs dev --strict-preflight
```

Alternatively set `VEXT_DEV_STRICT_PREFLIGHT=1` using the shell syntax in [CLI](/guide/cli). Type checking does not replace tests, lint, or production build verification. Run `npm run typecheck` explicitly before a commit or in CI if the script exists.

esbuild uses supported tsconfig compilation options; it does not implement every tsc emit option. Development and production Source Map forms also differ; see [Build Source Maps](/guide/build#source-map).

## FAQ

### No reloading is triggered after modification?

1. **Check the actual watched role and project root** — backend source, configured frontend/resource directories, and specified root files have separate rules; arbitrary files outside the roots are not watched.
2. **Separate watching from compiler exclusion** — generated, test, and declaration boundaries are described above; try `--poll` on Docker or NFS.
3. **Check the terminal output** — whether there is an error message (such as syntax error causing compilation failure)

### Behavior not as expected after hot reload?

1. **Try manual restart** — Press `Ctrl+C` to stop and then re-run `vext dev`
2. **Check whether replacement completed or recovery began** — do not delete `.vext/` or modify registered artifacts while the service is running. Use `r` or restart the command when a clean process is needed.
3. **Check object references and side effects** — affected services update according to module invalidation; cached old references and external side effects are not rolled back automatically. Cold-restart if needed.

### Cold restart too slow?

1. **Measure startup phases first** — use `--startup-profile`. Moving work to `onReady()` does not automatically remove the wait before ready; required dependencies must finish before accepting requests.
2. **Reduce optional initialization** — disable optional development features; whether a plugin can be disabled depends on its own implementation.
3. **Use `local.ts` to simplify configuration** — turn off unnecessary functions (such as current limiting, access logs, etc.) during local development

### What to do if the port is occupied?

VextJS no longer promises "internal automatic retries until recovery" if the port is still occupied during a cold restart. The current behavior is to enforce explicit policy by `--port-conflict` / `VEXT_PORT_CONFLICT`:

- `error` (default): fail directly
- `prompt`: interactive query `retry/kill/next/abort`
- `kill`: Try to terminate the occupying process
- `next`: automatically switch to the next available port

If accepting another port is appropriate, select it explicitly:

```bash
vext dev --port-conflict next
```

If you need to manually check the occupied process:

```bash
# Find the process occupying the port
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

## Relationship with Cluster mode

`vext dev` uses one development parent to manage one application Worker; it does not start multiple production Cluster request Workers. One application Worker does not mean the operating system has only one Node process.

If the production environment requires multiple processes, use `vext start` with Cluster configuration:

```bash
# Development — one application Worker and reload
vext dev

# Production — enable multiple Workers in configuration
vext start   # with cluster.enabled: true
vext reload  # request rolling replacement on supported platforms
```

On Windows, `vext reload` does not support the signal operation. Sending a reload signal successfully also does not prove every replacement completed; see [CLI reload](/guide/cli).

## Best Practices

### 1. Make full use of Tier 1/2

Keeping most application work in routes and services lets Vext use its targeted reload paths more often. Configuration and plugin changes are less frequent and can use the safer cold-restart path.

### 2. Cooperate with IDE real-time type checking

Although `vext dev` will output TypeScript semantic diagnostics, the IDE's live type checking is still the fastest source of feedback. It is recommended to enable IDE prompts and `npm run typecheck` at the same time; then enable strict mode when blocking preflight is required.

### 3. Simplified configuration of development environment

Use `development.ts` to turn off functions that are only needed in the production environment to speed up cold restart:

```typescript
// src/config/development.ts
export default {
  rateLimit: { enabled: false }, // Turn off current limit during development
  accessLog: { enabled: false }, // Reduce log noise
  logger: { level: "debug" }, // Use debug level during development
};
```

### 4. Use `_` prefix to share code

Files starting with `_` in route and service directories are not automatically loaded as routes or services. When these utility files change:

- Modifying an existing source normally takes T1; adding or deleting one normally takes T2.
- Modules that import it may enter the reverse-dependency invalidation set. Whether a Service rebuilds depends on that set, not merely on the utility file's directory.
- The `_` prefix is a loader naming convention; it does not make the compiler or watcher ignore the module.

```
src/routes/
├── _utils.ts # Trigger the reloading of the routing file that uses it when modified
├── users.ts # import { helper } from './_utils.js'
└── orders.ts
```

## Next step

- Learn the complete usage of [CLI command](/guide/cli)
- Learn the production environment deployment of [Cluster multi-process](/guide/cluster)
- View the environment coverage mechanism of [Configuration](/guide/configuration)
- Explore [Testing](/guide/testing) to ensure code correctness after hot reloading

# Hot reload

VextJS has a built-in intelligent hot reload mechanism and starts development mode through the `vext dev` command. The framework will monitor file changes and automatically select the optimal reload strategy based on the type of change, from millisecond-level hot replacement to complete process restart, covering all development scenarios.

Starting from `0.3.7`, `vext dev` will execute **dev preflight** once before each initial start, file change, manual reload / restart, and child process request cold restart:

- Automatically run basic `typegen`, synchronize `.vext/types/*.generated.d.ts` and `src/types/generated/index.d.ts`
- TypeScript semantic diagnosis is output asynchronously after ready / reload by default
- If the basic typegen finds a blocking issue, this round of reload / restart will be skipped; if you want TypeScript semantic diagnosis to also block, you can use `--strict-preflight`

## Quick Start

```bash
# Start development mode
npm run dev
# or
npx vext dev
```

After startup, the terminal will display a Banner box, including the current operating mode, monitoring mode, anti-shake interval, and three-layer Tier icon description:

```
╔═══════════════════════ ═══════════════════════╗
║ Vext Dev Server (Phase 2B) ║
╠═══════════════════════ ═══════════════════════╣
║ Mode: Soft Reload + Cold Restart ║
║Watch: fs.watch ║
║ Debounce: 0ms ║
╠═══════════════════════ ═══════════════════════╣
║ 🟢 T1 (code): soft reload (transform) ║
║ 🟡 T2 (struct): soft reload (rebuild) ║
║ 🔴 T3 (cold): cold restart ║
║ ⚪ ignored: skip ║
╠═══════════════════════ ═══════════════════════╣
║ r=restart h=reload c=clear ?=help ^C=quit║
╚═══════════════════════ ═══════════════════════╝
```

After modifying the files in the `src/` directory, the terminal will output the change details and reload results:

```
[vext dev] 1 file(s) changed:
  🟢 src/routes/users.ts (modify)
[vext dev] source change detected → soft reload [T1:code]...
[hot-reload] [OK] 45ms [T1:code] #1
```

After turning on `--verbose-lifecycle`, the time consumption of each stage and the number of cache evictions will be additionally output:

```
[hot-reload] [OK] 45ms [T1:code] (compile:3ms cache:2ms i18n:0ms mw:5ms svc:8ms model:0ms route:25ms swap:2ms) [12 modules evicted] #1
```

If the change involves the addition or deletion of files (structural changes), Tier 2 will be applied:

```
[vext dev] 2 file(s) changed:
  🟢 src/routes/orders.ts (add)
  🟢 src/routes/users.ts (modify)
[vext dev] source change detected → soft reload [T2:structural]...
[hot-reload] [OK] 82ms [T2:structural] #2
```

If the change involves configuration or plug-ins, a Tier 3 cold restart will be performed:

```
[vext dev] 1 file(s) changed:
  🔴 src/config/default.ts (modify)
[vext dev] config/plugin change detected → cold restart (Tier 3)...
[vext dev] cold restart complete
```

Frontend-only changes use a separate rebuild path:

```
[vext dev] 1 file(s) changed:
  🟢 src/frontend/pages/index.tsx (modify)
[vext dev] frontend client change detected -> rebuild...
[vextjs] frontend built: .vext/client
```

This path rebuilds `.vext/client/` and keeps the backend process running. React pages, layouts, and shared components use React Fast Refresh by default; CSS-only changes update stylesheet links; after backend soft reloads that affect render data, the browser action follows `frontend.dev.renderRefresh`.

Soft reload distinguishes compile failures from failures after runtime mutation. If compilation fails before cache invalidation, the framework keeps the previous handler running and prompts for repair:

```
[hot-reload] [FAIL] failed after 12ms: Cannot find module './missing.js'
[hot-reload] keeping previous version active. Fix the error and save again.
```

If an error occurs after cache invalidation or while reloading services, models, i18n, middleware, or routes, the current worker may hold mixed runtime state. VextJS requests a cold restart and stops that worker before running preflight checks. If strict preflight blocks the replacement, the worker remains stopped; fix the reported issue and save again to start a clean process.

## Three-layer reloading strategy

VextJS's hot reloading adopts a three-layer strategy and automatically selects the optimal method based on the type of changed file:

### Tier 1 — Route hot replacement ⚡

| Trigger conditions     | File changes under `src/routes/`                                  |
| ---------------------- | ----------------------------------------------------------------- |
| Behavior               | Atomic replacement request handler, zero interrupts               |
| Speed                  | Millisecond level (1-10ms)                                        |
| Impact                 | Only the routing files are changed, other routes are not affected |
| Connection interrupted | ❌ No interruption, the request being processed is not affected   |

```
Modify src/routes/users.ts
  ↓
Re-import the routing file
  ↓
Replace route processor (atomic operation)
  ↓
New requests use new processor
```

Tier 1 is the fastest way to reload. When you modify the business logic of the routing handler (such as modifying response data, adjusting query parameters), the changes take effect almost instantly, without waiting.

```typescript
// Modify this file → Tier 1 hot replacement
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", async (_req, res) => {
    // Modify the code here and it will take effect immediately after saving.
    res.json({ message: "Updated response!" });
  });
});
```

### Tier 2 — Service Reload ⚡

| Trigger conditions     | File changes under `src/services/`, `src/models/` or `src/locales/` |
| ---------------------- | ------------------------------------------------------------------- |
| Behavior               | Rebuild affected service instances                                  |
| Speed                  | Millisecond level (5-50ms)                                          |
| Impact                 | Changed services and their dependency chains                        |
| Connection interrupted | ❌ No interruption                                                  |

```
Modify src/services/user.ts
  ↓
Re-import the service file
  ↓
Re-instantiate UserService(app)
  ↓
Update app.services.user reference
  ↓
Subsequent requests use the new service instance
```

Tier 2 is suitable for business logic modifications in the service layer. Since services are accessed lazily through `app.services`, new requests after replacing the service instance will naturally use the new instance.

```typescript
// Modify this file → Tier 2 service reload
// src/services/user.ts
export default class UserService {
  constructor(private app: VextApp) {}

  async findAll() {
    // Modify the business logic, and new requests will automatically use the new logic after saving.
    return { items: [], total: 0 };
  }
}
```

Modifying the Model definition file in the `src/models/` directory also triggers Tier 2. The framework will atomically replace the Model definition through `Model.redefine()`, and automatically roll back to the old definition when it fails to ensure that the service continues to be available:

```typescript
// Modify this file → Tier 2 Model reload
// src/models/item.ts
export default {
  name: "Item",
  collection: "items",
  schema: {
    title: "string",
    description: "string",
    price: "number",
    // New field: schema verification for subsequent write operations will take effect immediately after saving
    tags: "string[]",
  },
};
```

### Tier 3 — Cold Reboot 🔄

| Trigger conditions     | File changes under `src/config/`, `src/plugins/`, `src/middlewares/` |
| ---------------------- | -------------------------------------------------------------------- |
| Behavior               | Full restart process                                                 |
| Speed                  | Second level (1-3s)                                                  |
| Impact                 | Entire application reinitialization                                  |
| Connection Interrupted | ✅ Requests being processed may be interrupted                       |

```
Modify src/config/default.ts
  ↓
Configuration/plugin/middleware changes detected
  ↓
Gracefully shut down the current process
  ↓
Rebootstrap the entire application
  ↓
Re-listen port
```

Modifications to configuration, plugins, and middleware affect the behavior of the entire application and therefore require a complete restart. The framework will complete the restart process as quickly as possible.

```typescript
// Modify this file → Tier 3 cold restart
// src/config/default.ts
export default {
  port: 3000,
  logger: { level: "debug" }, // Modifying the configuration requires a cold restart
};
```

## Reload strategy decision table

| Change files         | Reload strategy                 | Speed                | Description                                                                       |
| -------------------- | ------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `src/routes/**`      | Tier 1                          | ⚡ Millisecond level | Route processor atomic replacement                                                |
| `src/services/**`    | Tier 2                          | ⚡ Millisecond level | Service instance reconstruction                                                   |
| `src/models/**`      | Tier 2                          | ⚡ Millisecond level | Model definition re-registration, automatic rollback if failure                   |
| `src/locales/**`     | Tier 2                          | ⚡ Milliseconds      | Language pack reloading                                                           |
| `src/frontend/**`    | Frontend rebuild / Fast Refresh | ⚡ Fast              | Rebuild browser client; React pages try Fast Refresh without backend cold restart |
| `public/**`          | Frontend rebuild                | ⚡ Fast              | Copy static assets and rebuild frontend output                                    |
| `src/config/**`      | Tier 3                          | 🔄 Second level      | Configuration affects the whole world and needs to be restarted                   |
| `src/plugins/**`     | Tier 3                          | 🔄 Seconds           | The plug-in affects the global situation and needs to be restarted                |
| `src/middlewares/**` | Tier 3                          | 🔄 seconds           | Middleware definition changes require a restart                                   |
| `src/types/**`       | —                               | —                    | Type files do not trigger reloading                                               |
| `package.json`       | Tier 3                          | 🔄 Seconds           | Dependency changes require restarting                                             |

## Relationship with `vext build`

`vext dev` loads `.ts` files directly from `src/` in development mode (on-the-fly compilation via esbuild), without the need to execute `vext build` beforehand.

| Command      | Source code directory | Compilation method                       | Hot reloading                |
| ------------ | --------------------- | ---------------------------------------- | ---------------------------- |
| `vext dev`   | `src/`                | esbuild instant compilation              | ✅ Three-layer hot reloading |
| `vext start` | `dist/`               | Precompile (requires `vext build` first) | ❌ None                      |
| `vext build` | `src/` → `dist/`      | esbuild production compilation           | —                            |

Development process:

```bash
# During development
npm run dev # vext dev, hot reload directly from src/

# When deploying
npm run build # vext build, compile to dist/
npm start # vext start, start from dist/
```

## CLI options

```bash
vext dev [options]

Options:
  --port <port> specifies the listening port (overrides the configuration file)
  --host <host> specifies the listening address
  --debounce <ms> debounce interval (milliseconds, default 0 is not enabled)
  --poll Force polling mode (Docker/NFS environment)
  --poll-interval <ms> Polling interval (milliseconds, default 1000)
  --no-hot disable Soft Reload, all changes go to Cold Restart
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

`vext dev` monitors file changes in the `src/` directory and the project root `public/` directory by default:

```
src/
├── config/ → Tier 3
├── plugins/ → Tier 3
├── middlewares/ → Tier 3
├── routes/ → Tier 1
├── services/ → Tier 2
├── models/ → Tier 2
├── locales/ → Tier 2
├── client/ → frontend rebuild
└── types/ → ignore (types only)

public/ → frontend rebuild
```

### Ignore rules

Changes to the following files and directories will not trigger a reload:

- `node_modules/`
- `dist/`
- `.git/`
- Test files: `*.test.ts`, `*.spec.ts`
- Hidden files starting with `.`
- `*.d.ts` type declaration files

### Anti-shake processing

By default, anti-shake is not turned on (`debounce: 0`), and reloading is triggered immediately after file changes, with the fastest response. If you want to merge multiple changes into one reload when saving in quick succession, you can turn on the debounce window through `--debounce <ms>`.

For example: if `routes/users.ts` (Tier 1) and `config/default.ts` (Tier 3) are modified at the same time, the framework will perform a Tier 3 cold restart (including all changes).

## TypeScript support

`vext dev` uses esbuild for on-the-fly compilation and overlays a layer of development period preflight with the following features:

- **Extremely fast compilation** — esbuild compiles 10-100 times faster than tsc
- **Diagnosis layering during development** — typegen blocks reload/restart, TypeScript semantic diagnosis outputs asynchronously by default; strict mode can restore blocking
- **Automatic generated statement synchronization** — preflight will update `.vext/types/*.generated.d.ts` and `src/types/generated/index.d.ts` first
- **Zero configuration** — Automatically reads compilation options in `tsconfig.json`

:::warning type checking
`vext dev` does not perform a full `tsc --noEmit` style full link build check. In default mode, TypeScript semantic diagnostics will not block the first ready or reload; if you want the diagnostics to block development startup, you can use:

```bash
vext dev --strict-preflight
# or
VEXT_DEV_STRICT_PREFLIGHT=1 vext dev
```

The recommendation remains:

- Rely on real-time type checking of IDE (VS Code/WebStorm) during development
- Run `npm run typecheck` (`tsc --noEmit`) for full type checking before committing
- Execute `tsc --noEmit` in CI to ensure the type is correct
  :::

## FAQ

### No reloading is triggered after modification?

1. **Check whether the file is in the `src/` directory** — Only changes to files in the `src/` directory will trigger reloading
2. **Check whether it is an ignored file** — `*.test.ts`, `src/types/generated/**`, files starting with `.` will not trigger
3. **Check the terminal output** — whether there is an error message (such as syntax error causing compilation failure)

### Behavior not as expected after hot reload?

1. **Try manual restart** — Press `Ctrl+C` to stop and then re-run `vext dev`
2. **Clear module cache** — In rare cases, Node.js’s module cache may cause old code to remain
3. **Check inter-service dependencies** — Tier 2 overloading only rebuilds the changed service. If other services cache old references in the constructor, Tier 3 may be required

### Cold restart too slow?

1. **Reduce initialization operations at startup** — Avoid time-consuming operations (such as preheating a large amount of data) in the plug-in's `setup()` and change it to `onReady()`
2. **Development environment skips non-essential plug-ins** — Disable certain plug-ins through `development.ts` configuration conditions
3. **Use `local.ts` to simplify configuration** — turn off unnecessary functions (such as current limiting, access logs, etc.) during local development

### What to do if the port is occupied?

VextJS no longer promises "internal automatic retries until recovery" if the port is still occupied during a cold restart. The current behavior is to enforce explicit policy by `--port-conflict` / `VEXT_PORT_CONFLICT`:

- `error` (default): fail directly
- `prompt`: interactive query `retry/kill/next/abort`
- `kill`: Try to terminate the occupying process
- `next`: automatically switch to the next available port

If you want to automatically and smoothly continue when the port is occupied during the development period, it is recommended:

```bash
vext dev --port-conflict next
```

If you need to manually check the occupied process:

```bash
# Manually find and terminate the process occupying the port
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

## Relationship with Cluster mode

`vext dev` does not support Cluster multi-process mode. Always run as a single process during development to ensure predictable hot reload behavior.

If the production environment requires multiple processes, use `vext start` with Cluster configuration:

```bash
# Development — single process + hot reload
vext dev

# Production — multi-process + zero-downtime restart
vext start # with cluster.enabled: true
vext reload # Rolling restart Worker
```

## Best Practices

### 1. Make full use of Tier 1/2

Put most of the development work in the routing and service layer and enjoy millisecond-level hot reload experience. Configuration and plugin modifications are relatively minor, and occasional cold restarts are acceptable.

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

Files starting with `_` in the routes and services directories are not automatically loaded as routes/services. When modifying these tool files:- If referenced by the routing file → trigger Tier 1 (because the dependencies of the routing module have changed)

- If referenced by service file → trigger Tier 2

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

# Cluster multi-process

VextJS uses one Master to manage multiple HTTP Workers. Each Worker has its own application instance and listens on the same service port. The Master starts and replaces Workers, checks heartbeats, and coordinates rolling reloads.

First start two Workers and verify requests; then tune the count and recovery policy. For development reloads see [Hot Reload](/guide/hot-reload); for the production build prerequisite see [Build](/guide/build).

## Quick Start

### Enable in configuration

Use an installed TypeScript API project, such as [the CLI scaffold](/guide/cli#from-project-creation-to-production-startup). Merge these settings into your existing production config while retaining business settings:

```typescript
// src/config/production.ts
import type { VextConfigOverride } from "vextjs";

export default {
  port: 3000,
  cluster: {
    enabled: true,
    workers: 2,
  },
} satisfies VextConfigOverride;
```

Add a diagnostic route:

```typescript
// src/routes/worker-info.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", async (_req, res) => {
    res.json({ pid: process.pid, workerId: process.env.VEXT_WORKER_ID });
  });
});
```

Stop the same project's development server, then run from the project root:

```bash
npx vextjs build --typecheck
npx vextjs start --port 3000 --verbose-lifecycle
```

Expect two ready Workers and a final `workers=2/2` summary. Failure of the first Worker aborts startup; later failures may leave fewer Workers ready than requested. Check the actual ready count.

### Startup and request verification

From another terminal, open separate connections:

```bash
curl -i -H "Connection: close" http://127.0.0.1:3000/worker-info
curl -i -H "Connection: close" http://127.0.0.1:3000/worker-info
npx vextjs status --port 3000
```

The requests should return HTTP 200. `data.pid` and `data.workerId` identify the Worker serving each request. Confirm both ready Workers in the detailed startup logs; scheduling does not guarantee that two requests alternate between Workers.

Inspect `.vext.pid` in the project root. It records the Master PID, not an HTTP Worker PID. The status command has the limits described below. After verification, stop the foreground process with Ctrl+C; on Unix/macOS you may also run `npx vextjs stop` in another terminal. Verify the process, port, and PID file afterward. Keep or remove the diagnostic route as appropriate.

### Enable through an environment variable

`VEXT_CLUSTER=1` also enables Cluster. Configuration still controls the Worker count. Setting it to 0 does not disable an already configured `cluster.enabled: true`.

```bash
# Bash or another Unix-like shell
VEXT_CLUSTER=1 npx vextjs start
```

```powershell
$env:VEXT_CLUSTER = "1"
npx vextjs start
Remove-Item Env:VEXT_CLUSTER
```

:::tip Configuration consistency
The Master loads configuration and checks the port before starting Workers. It passes the current bootstrap config provider patch to the Workers for reuse. Each Worker still initializes its own application; plugin side effects do not thereby run only once.
:::

## Architecture Overview

```
                    ┌──────────────────┐
                    │ Master Process │
                    │ (ClusterMaster) │
                    └────────┬─────────┘
                             │
              ┌──────────────┼───────────────┐
              │ │ │
        ┌─────┴─────┐ ┌─────┴────┐ ┌─────┴─────┐
        │ Worker 1 │ │ Worker 2 │ │ Worker 3 │
        │ (HTTP App) │ │ (HTTP App) │ │ (HTTP App) │
        └───────────┘ └───────────┘ └────────────┘
```

- **Master process**: does not process HTTP requests and is responsible for managing the life cycle of the Worker process
- **Worker process**: Each Worker runs a complete VextJS application instance and handles HTTP requests independently
- **IPC communication**: Messages are exchanged between Master and Worker through Node.js’ built-in inter-process communication (IPC)

## Configuration options

Configure Cluster in the selected profile, such as `src/config/production.ts`. This example lists current defaults while enabling Cluster; usually you only need to override settings you intend to change:

```typescript
import type { VextConfigOverride } from "vextjs";

export default {
  cluster: {
    // Whether to enable Cluster mode
    enabled: true,

    // Worker quantity
    // 'auto' — detected available CPUs (default)
    // 'auto-1' — detected count minus one, at least one; no CPU affinity
    // number — fixed number
    workers: "auto",

    // Worker automatically restarts when it crashes
    autoRestart: true,

    // Restart budget shared by the entire Master; attempt N+1 is rate-limited
    maxRestarts: 5,

    //Restart counting window (milliseconds)
    restartWindow: 60000,

    //Restart base delay (milliseconds, exponential backoff)
    restartBaseDelay: 1000,

    // Maximum restart delay (milliseconds)
    restartMaxDelay: 30000,

    // Worker heap threshold (bytes; default 1 GiB)
    memoryThreshold: 1024 * 1024 * 1024,

    // Worker heartbeat detection configuration
    healthCheck: {
      enabled: true, // Whether to enable heartbeat detection
      interval: 15000, // Interval for Master to inspect lastHeartbeat (ms)
      timeout: 30000, // Heartbeat timeout (ms)
    },

    // Rolling replacement and Worker start/stop waits
    reload: {
      workerDelay: 2000, // Waiting time before replacing the next Worker (milliseconds)
      readyTimeout: 30000, // Worker ready timeout (milliseconds)
      shutdownTimeout: 10000, // Worker shutdown timeout (milliseconds)
    },

    // PID file path (used for vext stop / vext reload positioning process)
    pidFile: ".vext.pid",

    // Worker process title prefix
    titlePrefix: "vext",

    // sticky session mode ('none' | 'ip')
    // 'none' — not enabled (default)
    // 'ip' — currently selects a scheduling-policy branch, not IP affinity
    sticky: "none",
  },
} satisfies VextConfigOverride;
```

### Worker quantity strategy

| Value            | Actual rule                           | Considerations                                  |
| ---------------- | ------------------------------------- | ----------------------------------------------- |
| `"auto"`         | Detected available CPUs, capped at 64 | Check actual container and host results         |
| `"auto-1"`       | Detected count minus one, minimum one | Reduces process count; does not bind a CPU core |
| Positive integer | Limited to 1–64                       | Use 2 for the two-Worker verification           |

Use a valid positive integer rather than relying on out-of-range fallback. CPU detection first tries `os.availableParallelism()`. Only when it is unavailable, throws, or returns an invalid value does the fallback start from `os.cpus()` and try Linux cgroup v1 quotas. A valid quota constrains the detected count. When files are missing, detection cannot read cgroup limits, contents are invalid, or no finite quota is set, the fallback may reflect the host CPU count. Automatic detection does not necessarily match every container CPU quota exactly.

In containers, first use this page's worker-info route to check the actual process count, then set an explicit value such as `workers: 2` according to CPU, memory, and connection budgets. `"auto-1"` merely subtracts one from the detected count; it cannot repair failed quota detection.

Each Worker adds an application instance, database pool, cache, and heap. Choose a count based on request load, memory, and external connection limits, then verify under load; CPU multiples alone do not guarantee throughput.

### State and multi-process boundaries

Workers do not share ordinary variables, Service instances, or in-memory Stores. Use shared storage for data that must be globally consistent. For example, an in-memory rate limit counts separately in each Worker and is not a global quota; see [Rate Limiting](/guide/rate-limit). Sessions and caches likewise depend on their configured Stores.

Although `sticky: "ip"` is configurable, the current Master only uses it to select a Node scheduling-policy branch. It does not map client IPs to Workers. Do not rely on it for session consistency or state retention after WebSocket/SSE reconnection.

## CLI commands

VextJS CLI provides complete Cluster management commands:

### `vext start` — start

```bash
# Start in normal mode
npx vextjs start

# Start in Cluster mode (via environment variables)
VEXT_CLUSTER=1 npx vextjs start

# Specify port
npx vextjs start --port 8080
```

If `cluster.enabled: true` or `VEXT_CLUSTER=1` is set in the configuration, `vext start` will automatically start in Cluster mode.

### `vext stop` — stop

```bash
npx vextjs stop
# Use the same explicit path in control commands if the PID file was customized
npx vextjs stop --pid-file .vext/app.pid
```

The command reads the PID file, sends SIGTERM, and waits up to 30 seconds for the Master to exit. Normal Master shutdown asks Workers to stop accepting requests, waits for work and cleanup, then removes the PID file on exit. A nonzero timeout does not prove the process has stopped.

On Windows, externally terminating a process is not equivalent to Unix signal-driven cleanup. Ctrl+C in a foreground `vext start` lets the CLI request shutdown through parent-child IPC; a separate `vext stop` or operating-system force termination cannot guarantee `onClose` runs. See [Graceful shutdown](#cooperation-with-graceful-closing) for the timeout layers.

### `vext reload` — rolling restart

```bash
# Unix/macOS; point to the target Master's PID file
npx vextjs reload
```

The CLI returns after sending SIGHUP; successful delivery does not mean all Workers have been replaced. For each old Worker recorded at startup, the Master:

1. Starts a new Worker and waits for ready.
2. Asks the old Worker to shut down only after its replacement is ready.
3. Waits for the old Worker to exit, forcing termination after timeout.
4. Waits `workerDelay`, then processes the next pair.

```
Old Worker A: running ──────────→ drain/close
New Worker A:     start → ready → accept requests
                              ↓
                      replace the next pair
```

If a new Worker fails to start, the old Worker remains and failure is recorded while other replacements continue. Inspect `replaced/total` in the logs and make real requests; a `complete` message alone does not prove every replacement succeeded. Long connections, shutdown timeout, application errors, and insufficient resources can still interrupt traffic. Rolling replacement has no universal zero-downtime guarantee.

Reload does not recreate the Master. Worker count, Master heartbeat/backoff settings, and the provider patch captured at startup do not all refresh on a signal. Restart the complete service and shift traffic according to your deployment process when these settings change.

:::warning Prerequisites
Windows does not support this reload signal operation; the command fails. Build valid TypeScript artifacts before deploying an update. Omitting `cluster.reload` uses default waits rather than disabling reload. Update code, config, and artifacts so old and new Workers can each read a consistent version.
:::

### `vext status` — View status

```bash
# Check Cluster status
npx vextjs status
```

The command normally shows the Master PID and PID file, then probes `http://<host>:<port>/health` (default host `127.0.0.1`, port `3000`):

```text
Status: 🟢 running
  Master PID: 12345
  PID file:   <project>/.vext.pid
```

It appends PID, uptime, and memory details only when the health response contains those fields at the top level. It does not unpack the usual Vext response `data`, read the configured application port, or scan all Workers. The application must provide `/health`; a route at `/api/health` does not satisfy this fixed probe.

For example, if the target health route directly returns those top-level fields, one response could produce:

```text
Status: 🟢 running
  Master PID: 12345
  PID file:   .vext.pid
  Worker PID: 12346
  Uptime:     2h 35m 12s
  Heap Used:  64.0 MB
  RSS:        128.0 MB
```

These numbers illustrate one health request, not all Workers. The default wrapped response in this page's demo does not automatically provide them. `status` may exit 0 even for not running, stale, or unreachable results; do not use its exit code as a deployment health gate. Pass the actual `--host`, `--port`, and `--pid-file`, and independently check business health.

## Automatic failure recovery

### Worker crashes and restarts

With `autoRestart: true`, an unintentional Worker exit usually triggers replacement. Candidate failures before ready are handled by their startup or replacement flow. The new Worker gets a new ID and PID; the old process is not revived in place. These log values are illustrative:

```
[cluster] worker 3 (pid: 12348) exited: code 1
[cluster] restarting worker in 1000ms...
```

Worker memory, unfinished requests, and unpersisted state do not return automatically with the replacement.

### Exponential backoff

When crashes occur continuously, the restart delay gradually increases (exponential backoff) to avoid frequent restarts consuming system resources:

```
1st restart: delay 1s (restartBaseDelay)
2nd restart: delay 2s
3rd restart: delay 4s
4th restart: delay 8s
...
Maximum delay: 30s (restartMaxDelay)
```

### Crash loop protection

`restartWindow` defaults to 60,000 ms and `maxRestarts` to 5. The whole Master shares this budget; abnormal exits from different Workers consume it together. The sixth attempted restart within the window is paused:

```
[cluster] ❌ restart rate exceeded (5 in 60000ms), pausing auto-restart
```

The end of the time window does not schedule a task to restore missing capacity. Find the cause and deliberately recover the instance or capacity. A live Master does not imply all Workers are healthy. If all Workers disappear, the current implementation only emits an internal `all-workers-dead` event; do not assume it exits the Master so an outer supervisor can restart it. Check ready Worker count and business requests.

### Heartbeat detection

Workers send heartbeat messages spontaneously every 10 seconds by default. With `healthCheck.enabled: true`, the Master inspects ready Workers' last heartbeat every `interval` (default 15 seconds). After `timeout` (default 30 seconds), it forcibly terminates a timed-out Worker. Replacement still depends on `autoRestart` and the restart budget. This is not an HTTP `/health` request or an IPC health-check sent every 15 seconds. Interval-based inspection does not guarantee detection at exactly 30 seconds.

### Memory threshold

Every 60 seconds, a Worker checks its heap used against `cluster.memoryThreshold` (default 1 GiB, in bytes). On crossing it, that Worker sends a single `request-restart` asking the Master to start a replacement first. It does not exit immediately, and this is not an RSS or container-memory hard limit. If replacement fails, do not assume memory was freed; inspect logs and live processes.

## PID file

When started in Cluster mode, the Master process will write to the PID file (default `.vext.pid`), which is used for `vext stop` / `vext reload` / `vext status` commands to locate the process.

```
# .vext.pid content
12345
```

PID files are automatically managed at the following times:

- **Create**: when Master starts
- **Delete**: When Master exits normally
- **Detection**: Detect whether there is a running Cluster at startup

```typescript
// Merge into the existing cluster object in the selected profile
cluster: {
  pidFile: ".vext/app.pid";
}
```

Relative paths resolve from the startup working directory. Stop, reload, and status do not automatically read this path from application config; pass the same `--pid-file`. Forced termination may leave a stale file. Check the process behind its PID rather than deleting the file as a substitute for stopping the service.

:::tip
Add `.vext.pid` to `.gitignore` to avoid committing to version control.
:::

## Cooperation with graceful closing

Graceful shutdown process in Cluster mode:

```
SIGTERM/SIGINT
    ↓
Master receives signal
    ↓
Master sends shutdown message to all Workers
    ↓
Each Worker:
  1. Stop accepting new connections
  2. Wait for the pending request to complete
  3. Execute all onClose hooks (LIFO order)
     - Close database connection
     - Flush log buffer
     - Clean up temporary resources
  4. Worker exits
    ↓
After all Workers exit, the Master exits
PID files automatically deleted
```

There are separate timeout layers with different units:

| Setting                          | Unit             | Default | Scope                                                               |
| -------------------------------- | ---------------- | ------- | ------------------------------------------------------------------- |
| `shutdown.timeout`               | **seconds**      | 10      | Total budget for Worker application shutdown                        |
| `cluster.reload.shutdownTimeout` | **milliseconds** | 10,000  | Master wait for Worker exit during shutdown and rolling replacement |
| CLI stop wait                    | milliseconds     | 30,000  | Fixed maximum time the control command waits for the Master to exit |

When the Master's wait expires, it may SIGKILL a Worker, so application cleanup cannot be assumed to continue. Allow more time outside than inside the application, for example:

```typescript
// Merge into an existing production config
import type { VextConfigOverride } from "vextjs";

export default {
  shutdown: { timeout: 15 },
  cluster: {
    enabled: true,
    workers: 2,
    reload: { shutdownTimeout: 20000 },
  },
} satisfies VextConfigOverride;
```

See [Hooks](/guide/hooks) for shutdown ordering. A forced termination or timeout is not proof that cleanup hooks finished.

## Configure according to environment

```typescript
// src/config/default.ts — Cluster is not enabled by default
export default {
  port: 3000,
  // cluster is not configured and disabled by default
};
```

```typescript
// src/config/production.ts — production environment enabled
export default {
  cluster: {
    enabled: true,
    workers: "auto",
    autoRestart: true,
    healthCheck: { enabled: true },
    reload: { workerDelay: 2000 },
  },
};
```

```typescript
// src/config/development.ts — development environment explicitly disabled
export default {
  cluster: {
    enabled: false,
    // Development mode uses vext dev (hot reload), no Cluster is required
  },
};
```

:::tip
It is recommended to use `vext dev` (hot reload mode) instead of Cluster mode for development environment. Cluster is mainly used for multi-core utilization and high availability in production environments.
:::

## Inter-process communication

Master and Worker communicate through an internal IPC protocol. The table helps explain runtime behavior; it is not a stable package-root API for application plugins. Applications must not manually send `ready` to bypass real initialization.

When launched through `vext start`, the Windows CLI sends its shutdown request to the Master over the parent-child IPC channel. The Master uses the same graceful shutdown sequence to notify Workers, wait for exit, and remove its PID file. Terminating a process directly through the operating system does not guarantee that close hooks run.

The message types below are the exact string literals of the IPC payload `type` field, without direction prefixes.

### Worker → Master message

| Message type      | Description                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`           | Worker initialization is completed and starts accepting requests                                                                       |
| `heartbeat`       | Heartbeat response                                                                                                                     |
| `metrics`         | Memory and other snapshots every 30 seconds; without a request metrics provider, counts are placeholder zero with `metricsUnavailable` |
| `request-restart` | Worker requests itself to restart (if a memory leak is detected)                                                                       |

### Master → Worker message

| Message type   | Description                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `set-title`    | Set Worker process title                                                                                        |
| `shutdown`     | Notify Worker to shut down gracefully                                                                           |
| `health-check` | Immediate heartbeat response supported by Workers; scheduled inspection currently uses spontaneous heartbeats   |
| `broadcast`    | Currently only logs at debug level on receipt; it does not automatically trigger business events or config sync |

These messages are maintained by the framework. Placeholder request counts do not mean there was no traffic; production monitoring needs an actual request metrics provider.

When diagnosing internal process communication, message shapes include:

```typescript
// Internal protocol illustration, not commands for application code to send.
const workerReady = { type: "ready", pid: 1234, workerId: "1" };
const masterShutdown = { type: "shutdown", timeout: 10_000 };
```

The PID and workerId are illustrative values; timeout is in milliseconds. Manage Workers through the CLI and lifecycle APIs on this page rather than sending internal messages manually from routes.

## Deploying with Docker

### Dockerfile example

This runtime image assumes a TypeScript API project has already built `dist`, all config needed by start is in the output, and no other runtime resources are required. See [Build](/guide/build) for a complete multi-stage build. JavaScript source mode must also carry `src`.

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
STOPSIGNAL SIGTERM
ENV VEXT_CLUSTER=1
CMD ["./node_modules/.bin/vext", "start", "--outdir", "dist"]
```

### Suggestions

- Keep identity files inside `dist` and production dependencies. Carry custom frontend directories, workspace packages, and external resources separately.
- Check Worker count against actual container CPUs, memory, and connection quotas; choose an explicit number when needed.
- The PID path must be writable and unique to each instance.
- The container stop grace period must exceed the Master wait and application cleanup time.
- With an outer process manager or multiple container replicas, count total Workers to avoid unintended double scaling.

```yaml
# docker-compose.yml; application config or CLI must actually listen on 3000
services:
  api:
    build: .
    environment:
      - VEXT_CLUSTER=1
    ports:
      - "3000:3000"
    stop_grace_period: 30s
```

## Jobs and Cluster

HTTP Cluster Workers do not execute Jobs by default, so multiple HTTP Workers do not each fire the same schedule. Run HTTP, `vext job scheduler`, and `vext job worker` as separate processes. Cooperation between multiple schedulers or workers depends on a shared Job Store and leases. Process separation does not provide exactly-once execution or business idempotency; see [Jobs](/guide/jobs).

## FAQ

### What should we pay attention to when using WebSocket/SSE in Cluster mode?

An established long connection stays with the Worker holding it and can disconnect when that Worker exits. Design reconnection, cross-request state, broadcast, and shutdown timeouts explicitly. Current `sticky: "ip"` does not implement IP affinity and cannot guarantee that reconnection returns to the old Worker. Protocol support also depends on the adapter and application.

### What is the appropriate number of Workers?

Start with a controlled count, then adjust using CPU, memory, response latency, and total database connections. Every Worker initializes its own application and pools. `"auto-1"` only reduces process count; it does not reserve or pin a physical core for the Master.

### How to monitor the status of each Worker?

Use `vext status` to view the Master PID, PID file state, and single health endpoint details when `/health` is reachable. The current command does not emit a table for each Worker or per-worker request counts; production environments should use Prometheus or another monitoring system for richer multi-worker metrics.

### How is it different from PM2?

The built-in Master manages this framework's Workers. If an external process manager also supervises the app, decide whether it manages one Master or several independent application instances. Avoid two Cluster layers conflicting over Worker count, PID files, and shutdown. The outer supervisor still owns recovery when the Master itself exits.

## Next step

- Learn about the detailed explanation of Cluster-related commands in [CLI Commands](/guide/cli)
- View the complete configuration items of Cluster in [Configuration](/guide/configuration)
- Learn the relationship between [hot reload](/guide/hot-reload) and Cluster
- Explore Cluster-related testing methods in [Testing](/guide/testing)

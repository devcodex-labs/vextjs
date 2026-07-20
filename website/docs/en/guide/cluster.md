# Cluster multi-process

VextJS has built-in **Cluster multi-process management**, manages multiple Worker processes through `ClusterMaster`, makes full use of multi-core CPUs, and supports enterprise-level features such as zero-downtime rolling restart, heartbeat detection, and automatic fault recovery.

## Quick Start

### Enabled via configuration

```typescript
// src/config/default.ts
export default {
  port: 3000,
  cluster: {
    enabled: true,
    workers: "auto", // Automatically detect the number of CPU cores
  },
};
```

### Enable via environment variables

There is no need to modify the configuration file, just set `VEXT_CLUSTER=1` to enable Cluster mode:

```bash
VEXT_CLUSTER=1 vext start
```

:::tip Configuration consistency
In Cluster mode, the Master will first complete the configuration detection and port pre-check; the patch of `bootstrap config provider` will be passed to the Worker for reuse in the same startup cycle, preventing the Master and Worker and different Workers from seeing different remote configuration results.
:::

### Startup effect

```bash
$ vext start
[vextjs] start mode - built (node, from dist/)
[vextjs] ready on http://0.0.0.0:3000 (total=1842ms, workers=4/4)
```

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

Configure Cluster related options in `config/default.ts`:

```typescript
export default {
  cluster: {
    // Whether to enable Cluster mode
    enabled: true,

    // Worker quantity
    // 'auto' — equal to the number of CPU cores (default recommended)
    // 'auto-1' — equal to the number of CPU cores - 1 (one core is reserved for the Master)
    // number — fixed number
    workers: "auto",

    // Worker automatically restarts when it crashes
    autoRestart: true,

    //The maximum number of restarts within the time window (stop restarting if exceeded to prevent infinite crash loops)
    maxRestarts: 5,

    //Restart counting window (milliseconds)
    restartWindow: 60000,

    //Restart base delay (milliseconds, exponential backoff)
    restartBaseDelay: 1000,

    //Maximum restart delay (milliseconds)
    restartMaxDelay: 30000,

    // Worker heartbeat detection configuration
    healthCheck: {
      enabled: true, // Whether to enable heartbeat detection
      interval: 15000, // Detection interval (milliseconds)
      timeout: 30000, //Heartbeat timeout (milliseconds)
    },

    // Zero downtime rolling restart configuration
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
    // 'ip' — Allocate fixed Worker based on client IP (WebSocket / SSE scenario)
    sticky: "none",
  },
};
```

### Worker quantity strategy

| Value      | Meaning                 | Applicable scenarios                                          |
| ---------- | ----------------------- | ------------------------------------------------------------- |
| `'auto'`   | Number of CPU cores     | Production environment (default recommended)                  |
| `'auto-1'` | Number of CPU cores - 1 | Single-machine mixed deployment (reserve one core for Master) |
| `2`        | Fixed 2 Workers         | Development environment test Cluster                          |
| `1`        | Fixed 1 Worker          | Debugging Cluster logic                                       |

```typescript
// Production environment: fully utilize all CPU cores
cluster: {
  workers: "auto";
}

// Single-machine mixed deployment: reserve one core for the system/Master process
cluster: {
  workers: "auto-1";
}

// Development and testing: Fixed 2 Workers
cluster: {
  workers: 2;
}
```

## CLI commands

VextJS CLI provides complete Cluster management commands:

### `vext start` — start

```bash
# Start in normal mode
vext start

# Start in Cluster mode (via environment variables)
VEXT_CLUSTER=1 vext start

#Specify port
vext start --port 8080
```

If `cluster.enabled: true` or `VEXT_CLUSTER=1` is set in the configuration, `vext start` will automatically start in Cluster mode.

### `vext stop` — stop

```bash
# Stop the running Cluster
vext stop
```

`vext stop` finds the Master process by reading the PID file (default `.vext.pid`) and sends the `SIGTERM` signal to trigger graceful shutdown.

Close process:1. Master receives `SIGTERM` 2. Master sends shutdown instructions to all Workers 3. Each Worker executes the `onClose` hook (closes the database connection, etc.) 4. Worker stops accepting new requests and waits for existing requests to complete 5. Forced exit after timeout (controlled by `shutdown.timeout`) 6. After all Workers exit, the Master exits 7. PID files are automatically deleted

### `vext reload` — rolling restart

```bash
# Zero downtime rolling restart
vext reload
```

`vext reload` executes **zero-downtime rolling restart** (Rolling Restart):

1. Master receives reload signal
2. Restart Workers one by one (instead of restarting them all at once)
3. After the new Worker is started and ready, close the old Worker
4. Process all Workers in sequence
5. There is always a Worker serving requests throughout the process

```
Worker 1: [Running] → [Close] → [Restart] → [Ready] ✅
Worker 2: [Running] → [Close] → [Restart] → [Ready] ✅
Worker 3: [Running] → [Close] → [Restart] → [Ready] ✅
```

Applicable scenarios:

- After deploying a new version of the code, no downtime is required for the new code to take effect
- Reload after updating configuration
- Hot fix

:::warning Prerequisites
`vext reload` requires `cluster.reload` to be configured (enabled by default). To disable rolling restart, remove the `reload` configuration item.
:::

### `vext status` — View status

```bash
# Check Cluster running status
vext status
```

Output example:

```
Cluster Status
─────────────────────────────
Master PID: 12345
Workers: 4 / 4 (all healthy)
Uptime: 2h 35m 12s

Worker PID Status Uptime Requests
  1 12346 healthy 2h 35m 12s 45,230
  2 12347 healthy 2h 35m 11s 44,891
  3 12348 healthy 2h 35m 10s 45,102
  4 12349 healthy 2h 35m 09s 44,975
```

## Automatic failure recovery

### Worker crashes and restarts

When `autoRestart: true` (default), the Master will automatically restart after the Worker crashes:

```
[vextjs] Worker 3 (PID: 12348) exited unexpectedly (code: 1)
[vextjs] Restarting Worker 3... (restart 1/10 in 60s window)
[vextjs] Worker 3 (PID: 12350) ready
```

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

If the number of restarts reaches `maxRestarts` (default 5 times) within `restartWindow` (default 60 seconds), Master will stop restarting and output an alarm:

```
[vextjs] ⚠️ Worker 3 has restarted 5 times in 60s, stopping auto-restart
[vextjs] Please investigate the root cause before manually restarting
```

This prevents buggy code from causing infinite crash-restart loops.

### Heartbeat detection

When `healthCheck.enabled: true` (default), Master sends heartbeat detection to Worker every `healthCheck.interval` (default 15 seconds). If the Worker does not respond (may be deadlocked or blocked) within `healthCheck.timeout` (default 30 seconds), the Master will force kill and restart the Worker:

```
[vextjs] Worker 2 (PID: 12347) heartbeat timeout, killing...
[vextjs] Worker 2 (PID: 12347) force killed
[vextjs] Restarting Worker 2...
[vextjs] Worker 2 (PID: 12351) ready
```

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

```bash
# Customize PID file path
cluster: { pidFile: '/var/run/myapp.pid' }
```

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

Timeout control:

- Worker level timeout is controlled by `shutdown.timeout` (default 10 seconds)
- Worker is forcibly terminated after timeout (`SIGKILL`)

```typescript
export default {
  shutdown: {
    timeout: 15000, // 15 seconds timeout
  },
  cluster: {
    enabled: true,
    workers: "auto",
  },
};
```

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

Master and Worker communicate through IPC messages. VextJS defines a standardized messaging protocol:

The message types below are the exact string literals of the IPC payload `type` field, without direction prefixes.

### Worker → Master message

| Message type      | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `ready`           | Worker initialization is completed and starts accepting requests  |
| `heartbeat`       | Heartbeat response                                                |
| `metrics`         | Worker reports running metrics (number of requests, memory, etc.) |
| `request-restart` | Worker requests itself to restart (if a memory leak is detected)  |

### Master → Worker message

| Message type   | Description                           |
| -------------- | ------------------------------------- |
| `set-title`    | Set Worker process title              |
| `shutdown`     | Notify Worker to shut down gracefully |
| `health-check` | Heartbeat detection                   |
| `broadcast`    | Broadcast messages to all Workers     |

```typescript
process.send?.({ type: "ready", pid: process.pid, workerId: "1" });
worker.send({ type: "shutdown", timeout: 10000 });
```

## Deploying with Docker

Things to note when using Cluster mode in Docker containers:

### Dockerfile example

```dockerfile
FROM node:20-alpine

WORKDIR/app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/
COPY src/ ./src/

# Use SIGTERM signal (Docker default)
STOPSIGNAL SIGTERM

# Start Cluster mode
ENV VEXT_CLUSTER=1
CMD ["npm", "start"]
```

### Suggestions

- **Worker number**: In Docker containers, it is recommended to set `workers` according to the allocated CPU resources instead of using `'auto'` (`'auto'` will detect the total number of CPU cores of the host)
- **PID file**: No special configuration is required for the PID file path in the container, just use the default `.vext.pid`
- **Graceful shutdown**: Make sure Docker's `stop_grace_period` is greater than VextJS's `shutdown.timeout`
- **Single container, multiple processes**: Cluster mode is a reasonable approach to run multiple Workers in a single container, but if you use orchestration tools such as Kubernetes, you can also choose single-process mode + multiple Pod replicas

```yaml
# docker-compose.yml
services:
  api:
    build: .
    environment:
      - VEXT_CLUSTER=1
    ports:
      - "3000:3000"
    stop_grace_period: 30s # greater than shutdown.timeout
```

## FAQ

### What should we pay attention to when using WebSocket/SSE in Cluster mode?

Long connections (WebSocket, SSE) need to consider sticky session in Cluster mode to ensure that connections from the same client are routed to the same Worker as much as possible. Sticky allocation based on client IP can be enabled via `cluster.sticky: "ip"`; the default is `"none"`.

### What is the appropriate number of Workers?

- **CPU intensive**: set to the number of CPU cores (`'auto'`)
- **I/O intensive**: can be set to 1-2 times the number of CPU cores
- **Mixed load**: Start with the number of CPU cores and adjust based on actual monitoring data

### How to monitor the status of each Worker?

Use the `vext status` command to view the running status, PID, survival time and request count of each Worker. In a production environment, it is recommended to use Prometheus or other monitoring tools to collect more detailed indicators.

### How is it different from PM2?

VextJS's built-in Cluster management is deeply integrated with framework features (such as cooperation with `onClose` hooks, configuration systems, hot reloading), providing a zero-configuration out-of-the-box experience. PM2 is a general-purpose process manager with broader functionality but less integrated with the framework than the built-in solutions. The two can be used together (PM2 manages the Master process), but usually not required.

## Next step

- Learn about the detailed explanation of Cluster-related commands in [CLI Commands](/guide/cli)
- View the complete configuration items of Cluster in [Configuration](/guide/configuration)
- Learn the relationship between [hot reload](/guide/hot-reload) and Cluster
- Explore Cluster-related testing methods in [Testing](/guide/testing)

# Jobs

Vext Jobs provide background tasks, built-in scheduling, and worker runtimes. Declare a job with `defineJob({ handler })`, then choose manual execution, enqueueing, or scheduling explicitly. HTTP startup does not execute jobs or start a scheduler or worker. This page first runs a job and verifies its result, then covers business integration and deployment.

## Run a job first

Prerequisites: complete the TypeScript project in [Quick Start](/guide/quick-start), install `vextjs`, use `"type": "module"` in package.json, and have tsconfig and a `build` script. Run the commands below from that project root; no HTTP server is required. For a separate exercise, first create a new API-only project as described in Quick Start.

### 1. Create the configuration and job

Create `src/jobs` in your editor. Merge the following settings into your existing `src/config/default.ts`, preserving any other configuration you need. This example uses a local File Store and needs no database or Redis. If your project already enables external plugins, check their connection configuration first.

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  frontend: { enabled: false },
  logger: { level: "warn" },
  jobs: {
    store: { type: "file", dir: ".vext/jobs" },
    scheduler: { mode: "enqueue" },
    worker: { concurrency: 2 },
  },
} satisfies VextUserConfig;
```

```typescript
// src/jobs/greet.ts
import { defineJob } from "vextjs";

export default defineJob<{ name: string }, { message: string }>({
  name: "greet",
  payload: { name: "string!" },
  retry: false,
  handler: ({ payload, signal }) => {
    signal.throwIfAborted();
    return { message: `Hello, ${payload.name}!` };
  },
});
```

Create `greet.payload.json` at the project root:

```json
{ "name": "Vext" }
```

### 2. Execute and inspect the result

```bash
npx vext job list --source
npx vext job inspect greet --source --json
npx vext job run greet --source --payload-file greet.payload.json --json
npx vext job runs --source --limit 5 --json
```

The list should include `greet`; inspect should show `hasPayloadSchema: true`; run should return `status: "success"`, `attempts: 1`, and `result.message: "Hello, Vext!"`. Find the same run in the runs output. Copy its actual `runId` and substitute it below:

```bash
npx vext job status <runId> --source --json
```

Create `invalid.payload.json` containing `{}` and rerun with that file. Expect `status: "failed"`, a nonempty `error`, and exit code 1: runtime schema validation rejects the missing `name`. A TypeScript generic does not replace runtime input validation. Restore the valid input and the run should succeed again.

### 3. Enqueue and consume with a worker

```bash
npx vext job enqueue greet --source --payload-file greet.payload.json --json
```

The returned record has status `queued`. In a second terminal at the same project root, start:

```bash
npx vext job worker --source
```

In the first terminal, query the `id` returned by enqueue with the status command. After a poll, it should become `success` with the same greeting. Stop the worker with Ctrl+C when finished. Enqueue does not validate the payload; an invalid input becomes a failed record when the worker actually executes it.

### 4. Verify the built output

```bash
npm run build
npx vext job run greet --payload-file greet.payload.json --json
```

When a TypeScript project has a valid build, the Job CLI uses the built job without `--source`; the result should match the source run. Rebuild after changing a job, or explicitly use `--source` locally. The Job CLI loads configuration in production mode; `--source` selects source files, not development configuration. Even list and inspect initialize plugins and services, which may connect to configured external resources.

## Directory layout

```text
src/
  jobs/
    billing/close-invoice.ts
    emails/send-welcome.ts
```

`src/jobs/**` is the default convention, not a hard rule. Set `config.jobs.dir` when a service uses another directory. In a monorepo, each service root owns its own registry, so two services may use the same job name without conflicting.

Discovery includes `.ts/.js/.mjs/.cjs/.mts/.cts` files by default. Files beginning with `_`, `.d.ts`, `.test.*`, and `.spec.*` are excluded; `jobs.include/exclude` can adjust the scan. A scanned module must export at least one `defineJob()` value, as a default or named export. Keep helper modules outside the scan scope.

An explicit `name` takes precedence. Otherwise, the default export of `billing/close-invoice.ts` becomes `billing.close-invoice`, a named export appends its export name, and `billing/index.ts` becomes `billing`. Name collisions within one registry prevent startup. Explicit names allow Latin letters, digits, `_`, `.`, `:`, and `-`; Chinese names are not valid.

## Configuration entry point

Job configuration lives in `src/config/default.ts`, `src/config/production.ts`, or the profile selected with `--config <profile>`. The Job runtime initializes configuration, plugins, and services, but does not run the complete HTTP lifecycle: it does not listen for routes or trigger HTTP `onReady`. Each process initializes its own app and connections. Resources in `vext start`, `vext job scheduler`, and `vext job worker` cannot be assumed to be shared.

Merge the following fragment into `default.ts` when you need to adjust retries, leases, and concurrency. It changes the maximum attempts to 3 from the framework default of 1.

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  jobs: {
    dir: "jobs",
    store: { type: "file", dir: ".vext/jobs" },
    scheduler: {
      mode: "enqueue",
      timezone: "Asia/Shanghai",
      lease: { enabled: true, ttl: 30_000, renewInterval: 10_000 },
    },
    worker: {
      concurrency: 4,
      pollInterval: 1000,
      lease: { ttl: 30_000, renewInterval: 10_000 },
    },
    defaults: {
      timeout: 30_000,
      retry: { attempts: 3, delay: 1000, backoff: "exponential" },
      concurrency: 1,
    },
  },
};

export default config;
```

`config.jobs.dir` is resolved from `src/`; `store.dir` is resolved from the project root. When several VextJS services run on the same machine, each service should use its own project root or a separate `store.dir` so their `.vext/jobs` state does not overlap. If services need shared scheduling, use an explicit custom database/queue store and globally unique job names with service prefixes.

The default scheduler runs inline with a 1000 ms tick and UTC timezone. The default worker has total concurrency 4 and polls every 1000 ms; each job's in-process concurrency defaults to 1. A single attempt defaults to a 30000 ms timeout. Job-level timeout, retry, and concurrency override `jobs.defaults`. See [Jobs API](/api/jobs) for all fields.

`jobs.enabled: false` prevents jobs from loading, while `schedule.enabled: false` excludes one job from automatic scheduling. The typed fields `jobs.runner`, `scheduler.enabled`, `worker.enabled`, `worker.heartbeatInterval`, and `queue.enabled` are not currently used as switches by the corresponding execution paths. Do not rely on them to prevent an explicit run/enqueue or stop a running process. The worker writes a heartbeat from its polling loop.

## Define a job

The following business integration fragment can go in `src/jobs/billing/close-invoice.ts`. It requires an existing `billing` service whose `close(invoiceId, { signal })` returns a result containing `closed: boolean`; implement and type that service first using the [Services guide](/guide/services). If you have no billing service, use the runnable `greet` example above.

```ts
import { defineJob } from "vextjs";

export default defineJob<{ invoiceId: string }, { closed: boolean }>({
  name: "billing.closeInvoice",
  payload: { invoiceId: "string!" },
  description: "Close an overdue invoice.",
  tags: ["billing"],
  queue: {
    priority: 10,
  },
  timeout: 30_000,
  retry: { attempts: 3, delay: 1000, backoff: "exponential" },
  handler: async ({ app, payload, logger, signal }) => {
    const invoice = await app.services.billing.close(payload.invoiceId, {
      signal,
    });
    logger.info({ invoiceId: payload.invoiceId }, "invoice closed");
    return { closed: invoice.closed };
  },
});
```

This example is meant for `vext job run`, `vext job enqueue`, or explicit application enqueueing because it needs an `invoiceId`. The built-in scheduler creates scheduled runs without a business payload. Scheduled handlers should derive their own input, or split the design into a scheduled scanner that enqueues one run per discovered record.

The handler receives `app`, `payload`, `logger`, `signal`, `attempt`, `runId`, and the normalized job definition. It can use initialized services, `app.db`, `app.fetch`, i18n, logger, config, and plugin extensions. It does not receive an HTTP request or response object. For long-running jobs, check `signal` at entry and in loops, and pass it only to I/O APIs that support cancellation; not every database method accepts it.

Timeout is per attempt. It sends a cooperative abort signal and still waits for the handler to finish. The worker loop's shutdown signal is not automatically forwarded to a claimed handler. `retry.attempts` includes the first execution; retrying does not roll back side effects, and invalid payloads are revalidated and consume attempts. See [Jobs specification](/specification/jobs#vext-job-005) for states and idempotency boundaries.

## Scheduled jobs

Add a complete file to the example project above; it does not require a business service:

```typescript
// src/jobs/heartbeat.ts
import { defineJob } from "vextjs";

export default defineJob({
  name: "heartbeat",
  schedule: {
    interval: 5_000,
    startAt: new Date(),
    misfirePolicy: "skip",
    singleton: true,
  },
  handler: () => ({ checkedAt: new Date().toISOString() }),
});
```

Run `npx vext job scheduler --source`, wait at least 5 seconds, and stop it with Ctrl+C. `npx vext job runs --source --json` should include `heartbeat` with trigger `schedule` and status `queued`. Start `npx vext job worker --source`, query the same record from another terminal, confirm it becomes `success`, and stop the worker. These steps separately verify scheduling and consumption; enqueue mode remains queued without a worker.

For continuous operation, keep scheduler and worker online and verify concurrency and failure handling for the actual Store. `startAt` is determined when the module loads, making this suitable for a single-scheduler demonstration; a restart resets it.

`interval` is in milliseconds and needs a stable starting point. Change it to `30_000` for a 30-second period. Multiple replicas should use a consistent fixed starting point close to actual activation, or they may compute different periods. With no `startAt`, the current implementation uses `previousTick` as the start on each loop: intervals longer than the tick can fail to fire indefinitely. Do not omit the start point or treat it as a persistent timer.

Use `cron` for a calendar schedule instead of `interval`. The following six-field fragment, including seconds, represents 08:00 daily in Asia/Shanghai and can replace the schedule above:

```ts
const schedule = {
  cron: "0 0 8 * * *",
  timezone: "Asia/Shanghai",
};
```

`timezone` defaults to `jobs.scheduler.timezone`. The current cron due-time calculation and Croner's second-boundary handling do not align: the default one-second poll may miss a due time, and `skip`/`fire-once` may not select the latest occurrence in the window. Validate triggers and missed runs in the actual deployment before relying on calendar schedules for critical work. The first scheduling walkthrough uses an interval with an explicit starting point; assess a fix or an external scheduler for critical calendar tasks.

| Field           | Purpose                                                               |
| --------------- | --------------------------------------------------------------------- |
| `cron`          | Calendar expression for reports, billing, and cleanup                 |
| `interval`      | Millisecond interval for polling and flushes                          |
| `enabled`       | `false` skips automatic scheduling without disabling manual execution |
| `startAt/endAt` | Schedule time range; `startAt` also anchors an interval               |
| `timezone`      | Cron timezone, for example `Asia/Shanghai`                            |
| `misfirePolicy` | Missed-tick handling: `skip`, `fire-once`, or `catch-up`              |
| `maxCatchUp`    | Maximum catch-up runs under `catch-up`                                |
| `jitter`        | Random delay after due time                                           |
| `singleton`     | Idempotency key for the corresponding scheduled fire time             |

Current boundaries: `skip` and `fire-once` each select one occurrence from the in-process `previousTick` window, and a restart does not guarantee recovery of every missed time. Jitter only adjusts the recorded `runAt`; inline execution does not wait for a future time, and Memory/File Store may therefore refuse to claim it. Use enqueue plus a worker when random delay is needed. See [Jobs specification](/specification/jobs#vext-job-003).

## Run jobs from the CLI

```bash
vext job list
vext job inspect billing.closeInvoice
vext job run billing.closeInvoice --payload '{"invoiceId":"i_1"}'
vext job enqueue billing.closeInvoice --payload '{"invoiceId":"i_1"}'
vext job scheduler
vext job worker
vext job runs --limit 20
vext job status <runId>
```

These are command references for an installed CLI; prefix each with `npx` for a local installation. The billing commands require the corresponding job to exist, and `<runId>` must be replaced with a real ID. `--json` prints the command result as JSON, but plugin/framework logs may also appear, so the entire stdout is not guaranteed to be directly parseable as JSON. `--config <profile>` selects a configuration profile, `--outdir <dir>` specifies the build directory, and `--source` uses source even when a valid build exists. Both run and enqueue accept `--payload-file <path>`; an input file avoids JSON quoting differences between shells.

`vext job run` claims and executes a job, may retry according to its configuration, and writes a final run record; a result other than success exits with code 1. Enqueue creates a `queued` record, which a worker polls and executes when due. Scheduler calculates due jobs and runs them inline or enqueues them according to its mode. The CLI has no `--once` option; see [Jobs API](/api/jobs) for single-pass programmatic calls.

## Choosing a trigger mode

| Mode              | Entry                                               | Best for                                                    | Notes                                                                            |
| ----------------- | --------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Manual run        | `vext job run <name>`                               | Operational backfills, one-off scripts, local debugging     | Executes immediately and still writes a run record                               |
| Manual enqueue    | `vext job enqueue <name>`                           | Async work, load shedding, queued business actions          | Requires at least one `vext job worker`                                          |
| Scheduled inline  | `vext job scheduler` + `scheduler.mode = "inline"`  | Small projects, single process, low-frequency jobs          | Scheduler executes handlers itself; avoid it for heavy jobs or multi-instance HA |
| Scheduled enqueue | `vext job scheduler` + `scheduler.mode = "enqueue"` | Enterprise deployments, scalable workers, process isolation | Recommended for production; scheduler creates runs and workers execute them      |
| Test run          | `createTestJobRunner()`                             | Unit tests, service mocks, payload validation               | Uses a test app and does not open an HTTP port                                   |

Production deployments should prefer scheduled enqueue mode. The scheduler stays lightweight and workers can scale independently when jobs become expensive or bursty.

## Store and run records

The default store is `file`, stored under `.vext/jobs`. It records scheduler leases, worker heartbeats, run records, run leases, trigger, payload, status, attempts, duration, result, and error summary.

`memory` is for in-process tests and loses state when the process exits. Two CLI processes have separate memory, so it cannot connect an independent enqueue process and worker. `file` coordinates through files and directory locks in the same directory; verify locking and rename semantics for a container shared volume. `redis` shares records and leases across processes or nodes. Configure `jobs.store: { type: "redis", url: "redis://127.0.0.1:6379" }`, replacing the address for your deployment. `auto` still selects Redis and fails without a target; it does not fall back to File. A target can come from a client, URL/URI, or `VEXT_REDIS_URL`/`REDIS_URL`.

The default Redis key prefix includes package name, configuration profile, runtime mode, and module. Scheduler and worker must use the same target and prefix to see the same queue. Separate services need distinct prefixes; an explicit `keyPrefix` changes the default isolation. Built-in Store payloads and results should be JSON-serializable. Run records have no automatic retention period or cleanup API, so plan capacity management. The Store closes URL-created Redis connections; the caller owns an externally supplied client. Inject a custom Store through `bootstrapJobRuntime({ store })`; an arbitrary `store.type` string does not automatically load a custom adapter.

File Store write, lock, or rename failures propagate and can terminate a worker or scheduler; there is no guarantee of continuous automatic recovery. For `EPERM`, lock timeout, or a stalled queue, check whether the process is alive, directory permissions, and file use, then restore the process and inspect unfinished records. A previous ready message does not prove that jobs are still being consumed.

A nonempty idempotency key reused for the same job may reuse an existing non-failed/non-cancelled record, including success or timeout; an identical run ID is also reused. Reuse does not mean `runtime.run()` returns the prior successful result, because a terminal record may not be claimable again. `singleton` deduplicates a corresponding scheduled fire time, not all overlapping periods of a job.

All three built-in stores allow `completeRun()` only for the nonempty owner of the current running record. Completion clears the run lease; missing, queued, terminal, differently owned, or repeated completion returns `false` and leaves the stored record unchanged. If a lease expires, a new owner takes over, and the new owner completes the run, the old owner cannot overwrite the terminal state later. This protects the stored result, but external side effects are still at-least-once: payments, coupons, email, and third-party API calls still need business unique keys, database unique indexes, or external idempotency keys.

## Runtime boundaries

- `vext start` and HTTP cluster workers do not run jobs by default, so every HTTP worker does not create the same scheduled job.
- Scheduler starts explicitly with `vext job scheduler`; with its lease enabled and a shared Store, schedulers coordinate through the lease. A long inline job blocks subsequent scheduling and lease renewal, so validate recovery after losing the lease.
- Worker starts explicitly with `vext job worker`; shared Store run leases coordinate claims. A takeover after expiry may still overlap an old handler that ignores cancellation. Each worker honors total and per-job in-process concurrency; direct concurrent `runtime.run()` calls are not subject to worker limits.
- HTTP rolling restart does not restart job scheduler or workers. Manage HTTP, scheduler, and worker processes separately.
- Job runtime shutdown calls `Store.close` before closing the app; it does not guarantee that in-flight handlers have drained. On a CLI stop signal, `runtime.close` is called separately, and the worker wait period does not automatically postpone that close. See [shutdown boundaries](/specification/jobs#vext-job-005).

Recommended production topology:

```text
HTTP service:
  vext start

Scheduler:
  vext job scheduler

Worker:
  vext job worker
```

Small projects may run only `vext job scheduler` with the default `scheduler.mode = "inline"`. Enterprise deployments should prefer `scheduler.mode = "enqueue"` and one or more workers.

## Multi-process, cluster, and deployment notes

HTTP cluster handles inbound HTTP traffic and does not own jobs. Do not start a scheduler inside every HTTP worker, otherwise each worker may create the same job. On a single machine, use systemd, PM2, or Docker Compose to manage HTTP, scheduler, and worker separately. On Kubernetes, use separate Deployments for the three roles. The scheduler Deployment can have more than one replica only when every replica shares the same store and relies on the lease to elect the active scheduler.

Job handlers should be idempotent at the business level. Lease coordination cannot guarantee that an external side effect happens exactly once for payments, coupons, email, or third-party APIs. Use business unique keys, database unique indexes, or external idempotency keys, and handle the failure window where a side effect succeeds but completion of the run record has not been saved.

### Deployment templates

Single-machine systemd / PM2 / Docker Compose deployments can split jobs into three processes:

```bash
# HTTP
vext start

# Scheduler, prefer enqueue mode for enterprise deployments
vext job scheduler --config production

# Workers, scaled by CPU, IO, and downstream rate limits
vext job worker --config production
```

Kubernetes deployments should use three Deployments:

```text
vext-http      replicas: N   command: vext start
vext-scheduler replicas: 1+  command: vext job scheduler --config production
vext-worker    replicas: M   command: vext job worker --config production
```

The scheduler may run with more than one replica for availability only when all replicas share the same store and `jobs.scheduler.lease.enabled` remains enabled. Workers can scale horizontally, but first verify downstream connection pools, API rate limits, database locks, and job idempotency. The built-in `file` store is for same-machine or shared-volume use; multi-node HA should use Redis or a custom database/queue store. A higher-throughput queue still does not replace business-level idempotency.

## Testing

Use `createTestJobRunner` from `vextjs/testing` for unit tests. At the example project's root, create `test-greet.mjs` and run `node test-greet.mjs`; it exits with code 0 when assertions pass and nonzero when they fail:

```js
// test-greet.mjs
import assert from "node:assert/strict";
import { defineJob } from "vextjs";
import { createTestJobRunner } from "vextjs/testing";

const runner = await createTestJobRunner({
  services: false,
  jobs: {
    greet: defineJob({
      payload: { name: "string!" },
      handler: ({ payload }) => ({ message: `Hello, ${payload.name}!` }),
    }),
  },
});

try {
  const result = await runner.run("greet", { payload: { name: "Vext" } });
  assert.equal(result.status, "success");
  assert.deepEqual(result.result, { message: "Hello, Vext!" });
  const invalid = await runner.run("greet", { payload: {} });
  assert.equal(invalid.status, "failed");
} finally {
  await runner.close();
}
```

Pass `mockServices` when you need to isolate services; see [Testing](/guide/testing). This helper verifies execution and input validation. It does not create persistent run records or test worker/scheduler leases. Deployment acceptance should also cover retry side effects, concurrent claims, lease loss, shutdown timeouts, and actual Store failures.

## Troubleshooting

| Symptom                                | What to inspect                                                                                                  | Recovery check                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| List misses a job or executes old code | Scan directory, exports, exclusions; use `--source` to compare TypeScript source against the build               | List/inspect show the current source; rebuild and compare results              |
| Enqueue succeeds but stays queued      | Worker process and identical project root, profile, Store, and Redis prefix; rule out two separate Memory Stores | Status becomes running or success; inspect `error` as well as enqueue output   |
| Schedule never fires                   | Scheduler, `schedule.enabled`, time range, and explicit interval start                                           | Runs include the job name and schedule trigger                                 |
| Run reports cannot be claimed          | Terminal or claimed record, future `runAt`, idempotency key, and inline jitter                                   | Inspect original record; create a new run consistent with business idempotency |
| Work continues after timeout           | Timeout only aborts `signal`; handler and I/O must cooperate; process stop does not roll back side effects       | Test abort propagation, final record, and external result                      |

## Docs source

When `openapi.docs.code.jobs` is enabled, Vext Docs statically extracts Job documentation from `src/jobs` by default. If you change `jobs.dir`, check the Docs source directory separately. An entry may include name, source file, tags, timeout, concurrency, parts of schedule/queue, payload schema presence, and run usage.

Extraction reads source text and JSDoc; it cannot fully evaluate dynamic configuration and does not extract the complete retry runtime contract. Check named exports and computed names against the actual registry from `vext job list/inspect`. MCP and generation recipes have separate analysis entry points, so a static Docs entry does not prove a job was executed or deployed. See [MCP code generation](/guide/mcp-generation) and [Jobs specification](/specification/jobs).

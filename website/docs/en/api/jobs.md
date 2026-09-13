# Jobs API

## `defineJob(definition)`

Creates a job definition that can be discovered by `vext job`, tests, Vext Docs, and MCP tooling.

```ts
import { defineJob } from "vextjs";

export default defineJob({
  name: "emails.sendWelcome",
  description: "Send a welcome email.",
  tags: ["email"],
  schedule: {
    cron: "0 */5 * * * *",
    timezone: "Asia/Shanghai",
    singleton: true,
  },
  queue: { priority: 5 },
  timeout: 10_000,
  retry: { attempts: 3, delay: 500, backoff: "exponential" },
  handler: async ({ app, payload }) => {
    await app.services.email.sendWelcome(payload);
  },
});
```

The `name` field is optional. Without it, Vext infers the job name from the file path, for example `src/jobs/billing/close.ts` becomes `billing.close`.

## Core types

| Type                   | Purpose                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `VextJobDefinition`    | Normalized job definition returned by `defineJob`.                                                |
| `VextJobContext`       | Handler context with `app`, `payload`, `logger`, `signal`, `attempt`, and `runId`.                |
| `VextJobRegistry`      | Read-only registry used by CLI, testing, docs, and MCP.                                           |
| `VextJobRunnerAdapter` | Extension contract for external queues or runners.                                                |
| `VextJobRunRecord`     | Run record stored by the store, including trigger, status, attempts, duration, and error summary. |
| `VextJobStore`         | Store contract shared by scheduler, worker, and CLI.                                              |
| `VextJobRunResult`     | Result returned by `runJob` and testing helpers.                                                  |
| `VextJobsConfig`       | `config.jobs` shape.                                                                              |

## `bootstrapJobRuntime(options)`

Bootstraps a headless Vext runtime for jobs. It loads config, i18n, built-in database plugin, user plugins, services, job registry, and job store. It does not resolve an HTTP adapter, register routes, or listen on a port.

## `runJob(app, registry, name, options)`

Runs one job through the inline runner. Payload validation uses the app validator when the job declares a `payload` schema. The low-level `runJob()` does not create store run records by itself; CLI and the runtime returned by `bootstrapJobRuntime()` write store state before and after execution.

## `startJobScheduler(runtime, options)`

Starts the built-in scheduler. It filters jobs with `schedule`, calculates due times from cron or interval configuration, acquires the scheduler lease, and creates run records. With `config.jobs.scheduler.mode = "inline"`, due runs execute immediately. With `"enqueue"`, the scheduler only enqueues runs for workers.

## `startJobWorker(runtime, options)`

Starts the worker polling loop. The worker heartbeats, claims pending runs, executes jobs, and writes success, failed, timeout, or cancelled status back to the store. Multiple workers can run in parallel; run leases prevent the same run from being executed twice at the same time.

## `createJobStore(options)`

Creates the built-in store from `config.jobs.store`. `memory` is for tests. `file` is the default persistent store under `.vext/jobs`, suitable for same-machine multi-process and single-node deployments.

## Testing API

`vextjs/testing` exports `createTestJobRunner(options)`. It creates a test app, registers supplied job definitions, and exposes `run(name, options)` plus `close()`.

## Job definition fields

| Field            | Type                      | Default                            | Description                                       |
| ---------------- | ------------------------- | ---------------------------------- | ------------------------------------------------- |
| `name`           | `string`                  | Inferred from file path            | Unique job name inside one service root           |
| `description`    | `string`                  | `undefined`                        | Documentation summary                             |
| `tags`           | `string[]`                | `undefined`                        | Documentation and filtering tags                  |
| `docs`           | `object`                  | `undefined`                        | Extra metadata for Vext Docs / MCP                |
| `payload`        | `Record<string, unknown>` | `undefined`                        | schema-dsl payload validation                     |
| `schedule`       | `VextJobScheduleConfig`   | `undefined`                        | Built-in scheduler configuration                  |
| `queue`          | `VextJobQueueConfig`      | `undefined`                        | Queue metadata such as priority                   |
| `timeout`        | `number`                  | `config.jobs.defaults.timeout`     | Execution timeout in milliseconds                 |
| `retry`          | `false \| object`         | `config.jobs.defaults.retry`       | Retry attempts, delay, and backoff                |
| `concurrency`    | `number`                  | `config.jobs.defaults.concurrency` | Per-job concurrency limit for workers/runners     |
| `idempotencyKey` | `string \| function`      | `undefined`                        | Business idempotency key for manual/enqueued jobs |
| `handler`        | `function`                | Required                           | Job handler                                       |

## Schedule fields

| Field           | Type                                  | Default                               | Description                                          |
| --------------- | ------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `enabled`       | `boolean`                             | `true`                                | Enables scheduled firing for this job                |
| `cron`          | `string`                              | `undefined`                           | Second-level cron expression                         |
| `interval`      | `number`                              | `undefined`                           | Millisecond interval; cannot be combined with `cron` |
| `timezone`      | `string`                              | `config.jobs.scheduler.timezone`      | Cron timezone                                        |
| `startAt`       | `string \| Date`                      | `undefined`                           | Start time                                           |
| `endAt`         | `string \| Date`                      | `undefined`                           | End time                                             |
| `misfirePolicy` | `'skip' \| 'fire-once' \| 'catch-up'` | `config.jobs.scheduler.misfirePolicy` | How missed ticks are handled                         |
| `maxCatchUp`    | `number`                              | `config.jobs.scheduler.maxCatchUp`    | Maximum catch-up runs                                |
| `jitter`        | `number`                              | `config.jobs.scheduler.jitter`        | Random delay after due time in milliseconds          |
| `singleton`     | `boolean`                             | `false`                               | Allows one run for each scheduled fire time          |

## Configuration

```ts
export default {
  jobs: {
    enabled: true,
    dir: "jobs",
    include: ["**/*.{ts,js,mjs,cjs,mts,cts}"],
    exclude: ["**/*.test.*", "**/*.spec.*"],
    runner: "inline",
    store: {
      type: "file",
      dir: ".vext/jobs",
    },
    scheduler: {
      enabled: true,
      mode: "inline",
      tickInterval: 1000,
      timezone: "UTC",
      misfirePolicy: "skip",
      maxCatchUp: 10,
      jitter: 0,
      lease: {
        enabled: true,
        ttl: 30000,
        renewInterval: 10000,
      },
    },
    worker: {
      enabled: true,
      concurrency: 4,
      shutdownTimeout: 10000,
      pollInterval: 1000,
      heartbeatInterval: 10000,
      lease: { ttl: 30000 },
    },
    defaults: {
      timeout: 30000,
      retry: { attempts: 1, delay: 0, backoff: "fixed" },
      concurrency: 1,
    },
  },
};
```

| Field                         | Default        | Description                                            |
| ----------------------------- | -------------- | ------------------------------------------------------ |
| `jobs.enabled`                | `true`         | Enables job discovery                                  |
| `jobs.dir`                    | `'jobs'`       | Job directory relative to `src/`                       |
| `jobs.store.type`             | `'file'`       | `memory` or `file`                                     |
| `jobs.store.dir`              | `'.vext/jobs'` | File store data directory relative to project root     |
| `jobs.scheduler.mode`         | `'inline'`     | `inline` executes due runs, `enqueue` only queues them |
| `jobs.scheduler.tickInterval` | `1000`         | Scheduler tick interval in milliseconds                |
| `jobs.scheduler.lease.ttl`    | `30000`        | Scheduler lease TTL                                    |
| `jobs.worker.concurrency`     | `4`            | Worker global concurrency                              |
| `jobs.worker.pollInterval`    | `1000`         | Worker polling interval in milliseconds                |
| `jobs.worker.shutdownTimeout` | `10000`        | Time to wait for running jobs during shutdown          |
| `jobs.defaults`               | See example    | Default timeout/retry/concurrency for jobs             |

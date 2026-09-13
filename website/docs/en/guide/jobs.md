# Jobs

Vext Jobs provide framework-level background tasks, built-in scheduling, and worker runtimes. A job is a plain module under `src/jobs/**` that exports `defineJob({ handler })`. HTTP startup does not run jobs automatically; jobs are loaded only by `vext job ...`, testing helpers, or tools that explicitly inspect the job registry.

## Directory layout

```text
src/
  jobs/
    billing/close-invoice.ts
    emails/send-welcome.ts
```

`src/jobs/**` is the default convention, not a hard rule. Set `config.jobs.dir` when a service uses another directory. In a monorepo, each service root owns its own registry, so two services may use the same job name without conflicting.

## Configuration entry point

Job configuration lives in `src/config/default.ts`, `src/config/production.ts`, or the profile selected with `--config <profile>`. HTTP and jobs share the same Vext app lifecycle, but they run in separate processes: `vext start` serves HTTP, `vext job scheduler` creates due runs, and `vext job worker` consumes queued runs.

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
      lease: { ttl: 30_000 },
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

## Define a job

```ts
import { defineJob } from "vextjs";

export default defineJob<{ invoiceId: string }, { closed: boolean }>({
  name: "billing.closeInvoice",
  description: "Close an overdue invoice.",
  tags: ["billing"],
  schedule: {
    cron: "0 */5 * * * *",
    timezone: "Asia/Shanghai",
    singleton: true,
  },
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

The handler receives `app`, `payload`, `logger`, `signal`, `attempt`, `runId`, and the normalized job definition. It can use services, models, `app.fetch`, i18n, logger, config, and plugin-provided extensions. It does not receive an HTTP request or response object. Long-running jobs should pass `signal` to database calls, fetch calls, queues, or internal loops so timeout and graceful shutdown can interrupt work.

## Scheduled jobs

Jobs can declare built-in schedules:

```ts
export default defineJob({
  name: "reports.dailySummary",
  schedule: {
    cron: "0 0 8 * * *",
    timezone: "Asia/Shanghai",
    misfirePolicy: "skip",
    singleton: true,
  },
  handler: async ({ app, signal }) => {
    await app.services.reports.sendDailySummary({ signal });
  },
});
```

`cron` uses second-level cron expressions and inherits `config.jobs.scheduler.timezone` by default. Use `interval` for millisecond-based polling or flush tasks:

```ts
defineJob({
  name: "metrics.flush",
  schedule: {
    interval: 30_000,
    misfirePolicy: "fire-once",
  },
  handler: async ({ app }) => app.services.metrics.flush(),
});
```

| Field           | Purpose                                                               |
| --------------- | --------------------------------------------------------------------- |
| `cron`          | Cron expression for daily reports, billing, cleanup, and similar jobs |
| `interval`      | Millisecond interval for polling or flush jobs                        |
| `timezone`      | Cron timezone, for example `Asia/Shanghai`                            |
| `misfirePolicy` | How missed ticks are handled: `skip`, `fire-once`, or `catch-up`      |
| `maxCatchUp`    | Maximum catch-up runs                                                 |
| `jitter`        | Random delay after due time to spread load                            |
| `singleton`     | Creates an idempotency key for each scheduled fire time               |

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

Use `--json` for machine-readable output, `--config <profile>` for a config profile, `--outdir <dir>` for a custom build directory, and `--source` when you want to inspect source even if a valid build exists.

`vext job run` executes one job immediately and writes a run record. `vext job enqueue` creates a pending run for workers. `vext job scheduler` starts the built-in scheduler, scans jobs with `schedule`, and creates due runs. `vext job worker` polls the store, claims pending runs, and executes them.

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

`memory` is for tests and local demos and loses state on process exit. `file` supports same-machine multi-process and single-node production deployments; with a shared persistent volume it can also support simple multi-instance deployments. For multi-machine production, strict exactly-once, or high-throughput queues, connect a custom store/runner backed by a database, Redis, BullMQ, or a cloud queue.

## Runtime boundaries

- `vext start` and HTTP cluster workers do not run jobs by default, so every HTTP worker does not create the same scheduled job.
- Scheduler is started explicitly with `vext job scheduler`; when several schedulers exist, only the owner of the scheduler lease creates due runs.
- Worker is started explicitly with `vext job worker`; several workers can run in parallel, and run leases prevent the same run from being executed twice. Workers honor both the global `jobs.worker.concurrency` limit and each job's `concurrency` / `jobs.defaults.concurrency` limit.
- HTTP rolling restart does not restart job scheduler or workers. Manage HTTP, scheduler, and worker processes separately.
- Job runtime shutdown uses the same `app.onClose()` lifecycle as HTTP startup, releasing database, plugin, and logger resources.

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

Job handlers should still be idempotent at the business level. Vext can prevent the same run from being claimed by two workers at the same time, but it cannot make external side effects exactly-once for payments, coupons, email, or third-party APIs. Use business unique keys, database unique indexes, or external idempotency keys for those tasks.

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

The scheduler may run with more than one replica for availability only when all replicas share the same store and `jobs.scheduler.lease.enabled` remains enabled. Workers can scale horizontally, but first verify downstream connection pools, API rate limits, database locks, and job idempotency. The built-in `file` store is for same-machine or shared-volume use; multi-node HA and high-throughput workloads should use a custom database, Redis, or queue-backed store.

## Testing

Use `createTestJobRunner` from `vextjs/testing` for unit tests:

```ts
import { defineJob } from "vextjs";
import { createTestJobRunner } from "vextjs/testing";

const runner = await createTestJobRunner({
  services: false,
  mockServices: {
    billing: { close: async () => ({ closed: true }) },
  },
  jobs: {
    "billing.closeInvoice": defineJob({
      handler: async ({ app }) => app.services.billing.close(),
    }),
  },
});

const result = await runner.run("billing.closeInvoice");
await runner.close();
```

## Docs source

Vext Docs scans `src/jobs/**` when `openapi.docs.code.jobs` is enabled. Job docs include the name, source file, tags, timeout, retry, concurrency, schedule, queue, payload schema presence, and `vext job run` usage. These machine-readable entries are the source of truth for MCP tools and recipes.

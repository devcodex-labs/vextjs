# Jobs API

Use this page to look up Job definition, execution, scheduling, Store, and testing APIs. Except for the testing helper from `vextjs/testing`, the functions below are exported by the main `vextjs` entry. See the [Jobs Guide](/guide/jobs) for a first run and complete commands, and the [Jobs Specification](/specification/jobs) for behavioral limits.

| Layer                    | Entry points                                 | Responsibility                                                                |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------- |
| Definition and discovery | `defineJob`, `loadJobs`, `createJobRegistry` | Describe tasks, scan modules, index names.                                    |
| Execution                | `runJob`, `createJobRunner`                  | Validate input, invoke handlers, retry and cancel; no run record persistence. |
| App runtime              | `bootstrapJobRuntime`                        | Initialize dependencies and combine Store claim/renew/complete.               |
| Schedule and consumption | `startJobScheduler`, `startJobWorker`        | Create due records or claim queued runs; start explicitly.                    |

Defaults in the parameter tables mean effective defaults after normal app configuration merge. `defineJob()` does not copy every config default into the definition. Supply required configuration yourself when constructing a low-level app or registry directly.

## `defineJob(definition)`

Signature: `defineJob<TPayload = unknown, TResult = unknown>(definition: VextJobDefinitionInput<TPayload, TResult>): VextJobDefinition<TPayload, TResult>`.

This creates a marked, shallow-frozen definition. It does not run or enqueue the handler. Invalid handlers, names, field shapes, or mutually exclusive schedules throw synchronously. Payload DSL compiles at runtime, so successful definition creation does not prove its input contract is valid. Static Docs/MCP extraction does not execute this function.

This can be a standalone `src/jobs/greet.ts`:

```ts
import { defineJob } from "vextjs";

export default defineJob<{ name: string }, { message: string }>({
  name: "greet",
  description: "Return a greeting.",
  tags: ["example"],
  payload: { name: "string!" },
  queue: { priority: 5 },
  timeout: 10_000,
  retry: { attempts: 3, delay: 500, backoff: "exponential" },
  handler: ({ payload }) => ({ message: `Hello, ${payload.name}!` }),
});
```

The `name` field is optional. Without it, Vext infers the job name from the file path, for example `src/jobs/billing/close.ts` becomes `billing.close`.

`isVextJobDefinition(value: unknown): value is VextJobDefinition` checks only the object marker and handler function; it does not revalidate every field. Shallow freezing does not freeze nested schedule, payload, or retry objects.

Jobs with required business payloads should be run with `vext job run`, `vext job enqueue`, or explicit application enqueueing. The built-in scheduler creates scheduled runs without payload; scheduled jobs should query their own pending input or schedule only a scanner job.

## Core types

| Type                   | Purpose                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `VextJobDefinition`    | Definition returned by `defineJob`; generics describe payload/result but do not create a runtime schema. |
| `VextJobContext`       | Handler context with `app`, `job`, `payload`, `logger`, `signal`, `attempt`, and `runId`.                |
| `VextJobRegistry`      | Name index with list/get/has/toJSON; no add/remove API, but returned members are not deeply frozen.      |
| `VextJobRunnerAdapter` | Exported extension type; `jobs.runner` does not currently auto-register or load one.                     |
| `VextJobRunRecord`     | Run record stored by the store, including trigger, status, attempts, duration, and error summary.        |
| `VextJobStore`         | Store contract shared by scheduler, worker, and CLI.                                                     |
| `VextJobRunResult`     | Result returned by `runJob` and testing helpers.                                                         |
| `VextJobsConfig`       | `config.jobs` shape.                                                                                     |

`VextJobRunnerAdapter` has `name`, `start(runtime)`, optional `stop()` and `enqueue(name, payload, options)`. `start` receives a `VextJobWorkerRuntime` with app, registry, store, run, close, and signal. This is a type contract for explicit integration, not an automatically instantiated runtime registry.

### Discovery and Registry

| Function                                                     | Parameters and return                                                       | Boundary                                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `loadJobs(options)`                                          | `{ rootDir, srcDir, config?: VextJobsConfig }` → `Promise<VextLoadedJob[]>` | Returns empty if disabled; imports execute top-level code; import or missing export errors throw `VextJobDefinitionError`.    |
| `resolveJobsDirectory(sourceBase, directory?, projectRoot?)` | Paths, with `jobs` as default directory → `string`                          | Maps source/build directories by project contract when projectRoot is set; does not create a directory.                       |
| `createJobRegistry(jobs)`                                    | `VextLoadedJob[]` → `VextJobRegistry`                                       | Duplicate names throw `VextJobDuplicateNameError`; list is name-sorted and returns a new array with shared member references. |

`VextLoadedJob` includes name, definition, sourceFile, sourcePath, and exportName. Missing `registry.get` returns undefined and `has` returns a boolean. `toJSON` projects metadata without handlers; `hasPayloadSchema` means only that a payload field exists. See [Jobs Guide: Directory Layout](/guide/jobs#directory-layout) for discovery and inferred names.

### Handler Context

| Field     | Type and meaning                                                                            |
| --------- | ------------------------------------------------------------------------------------------- |
| `app`     | Current Job app, without HTTP request/response context.                                     |
| `job`     | Current definition; an inferred name lives in the registry, so `job.name` may be undefined. |
| `payload` | `TPayload`: validated data when a schema exists, otherwise original input.                  |
| `signal`  | Per-attempt `AbortSignal` for timeout/caller cancellation; handlers and I/O must cooperate. |
| `attempt` | Current attempt, starting at 1.                                                             |
| `runId`   | One execution ID shared by retries.                                                         |
| `logger`  | Child app logger with Job name and runId.                                                   |

## `bootstrapJobRuntime(options)`

Bootstraps a headless Vext runtime for jobs. It loads config, i18n, built-in database plugin, user plugins, services, job registry, and job store. It does not resolve an HTTP adapter, register routes, or listen on a port.

Signature: `bootstrapJobRuntime(options?: BootstrapJobRuntimeOptions): Promise<VextJobRuntime>`. The database plugin loads according to config; this does not trigger HTTP `onReady`.

| Option          | Default                   | Purpose                                                                             |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `rootDir`       | `process.cwd()`           | Project root.                                                                       |
| `built`         | `false`                   | Load build output when true; this API does not detect a valid `dist` automatically. |
| `outDir`        | Project build location    | Custom build output.                                                                |
| `configProfile` | undefined                 | Config profile, independent of mode.                                                |
| `mode`          | production                | production/development/test; CLI fixes production.                                  |
| `store`         | Created from `jobs.store` | Inject `VextJobStore`; runtime calls its init and optional close.                   |

| Runtime member              | Signature/return                                                   | Meaning                                                                                |
| --------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `app/config/registry/store` | App, config, index, Store                                          | Config is normalized and frozen.                                                       |
| `enqueue`                   | `(name, options?) → Promise<VextJobRunRecord>`                     | Checks name and enqueues, without validating business payload.                         |
| `run`                       | `(name, options?) → Promise<VextJobRunResult>`                     | Creates/reuses a record, claims, renews, executes, and commits.                        |
| `listRuns`                  | `(options?: VextJobListRunsOptions) → Promise<VextJobRunRecord[]>` | Filters by jobName/status/limit; built-in Store default limit 50, CLI runs default 20. |
| `getRun`                    | `(runId: string) → Promise<VextJobRunRecord \| undefined>`         | Missing ID returns undefined.                                                          |
| `close`                     | `() → Promise<void>`                                               | Store.close, then app shutdown; caller schedules it after stopping work.               |

With the `greet` definition above, create `run-greet.mjs` in the project root and run `node run-greet.mjs`. By default this loads source with production config:

```js
// run-greet.mjs
import { bootstrapJobRuntime } from "vextjs";

const runtime = await bootstrapJobRuntime({ rootDir: process.cwd() });
try {
  const result = await runtime.run("greet", { payload: { name: "Vext" } });
  console.log(result.status, result.result);
  if (result.status !== "success") process.exitCode = 1;
} finally {
  await runtime.close();
}
```

Expect success and a greeting object. Unknown jobs, claim failures, and Store errors reject; ordinary handler failures usually return in `result.status`. Handler return and Store acceptance of completion are separate; loss of ownership can reject completion and log a warning. `close` does not drain work; if Store.close throws, the current implementation does not continue app shutdown automatically. Initialization failure does not promise rollback of every opened external resource.

## `runJob(app, registry, name, options)`

Runs one job through the inline runner. Payload validation uses the app validator when the job declares a `payload` schema. The low-level `runJob()` does not create store run records by itself; CLI and the runtime returned by `bootstrapJobRuntime()` write store state before and after execution.

Signature: `runJob(app: VextApp, registry: VextJobRegistry, name: string, options?: VextJobRunOptions): Promise<VextJobRunResult>`. `createJobRunner({ app, registry })` returns `{ run(name, options?) }` by binding the first two arguments. It does not initialize the app, apply worker concurrency, or acquire a run lease.

### Run Options

| `VextJobRunOptions` field | Type                    | Boundary                                                                                                           |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `payload`                 | unknown                 | Generic type does not validate this entry; Runner validates against each Job schema.                               |
| `signal`                  | `AbortSignal`           | Cancellation while running; enqueue does not store it.                                                             |
| `runId`                   | string                  | Low-level Runner defaults to UUID; runtime uses record ID and may reuse an existing record.                        |
| `trigger`                 | manual/schedule/enqueue | Origin; runtime.run defaults manual, enqueue defaults enqueue.                                                     |
| `scheduledAt`             | Date/string             | Recorded planned time, not a future `runAt` setting.                                                               |
| `idempotencyKey`          | string                  | Runtime option takes precedence over Job definition for Store deduplication; low-level Runner does not process it. |
| `ownerId`                 | string                  | Internal claimed-run path; business callers normally omit it and cannot use it to bypass Store ownership.          |

`runtime.enqueue()` has no `runAt` option. Use low-level `Store.enqueueRun` for a future claimable time and accept its contract. `scheduledAt` is metadata only. Reusing a runId with runtime.run requires the same Job name.

### Results, Errors, and Cancellation

`VextJobRunResult<TResult>` includes jobName, runId, status, attempts, durationMs, and optional result/error. Duration includes attempts and retry waits. Store records hold a string error summary; Runner results hold an error object or wrapper. Records can also be queued/running, while execution results have four statuses:

| Status      | Current interpretation                                                      |
| ----------- | --------------------------------------------------------------------------- |
| `success`   | Handler returned and signal was not aborted.                                |
| `cancelled` | Signal aborted but handler returned normally; a result may still exist.     |
| `timeout`   | Signal aborted and execution threw; caller cancellation can also lead here. |
| `failed`    | Final error with signal not aborted.                                        |

Timeout applies to each attempt and does not forcibly terminate a handler. A pre-aborted signal does not guarantee the handler is skipped. Payload is revalidated each attempt; null/undefined becomes an empty object when a schema exists. `retry.attempts` includes the first run and `retry: false` gives one attempt. Numeric delay supports fixed/exponential (`2 ** (attempt - 1)`); a delay function receives failed attempt and error without an additional exponential factor.

A Job's retry object takes precedence as a whole over `jobs.defaults.retry`; fields are not merged. `defineJob` permits a function delay, but current app config validation accepts only a numeric `jobs.defaults.retry.delay` even though the type is shared. Payload failure includes `VextJobPayloadValidationError` and errors; ordinary execution errors are wrapped as `VextJobExecutionError` with jobName/runId/cause. Unknown names and a throwing retry-delay function can still reject directly. `VextJobShutdownError` is exported, but current shutdown does not automatically wrap every close failure with it.

## `startJobScheduler(runtime, options)`

Signature: `startJobScheduler(runtime: VextJobRuntime, options?: StartJobSchedulerOptions): Promise<void>`. It handles the scheduler lease first, then filters enabled schedules, computes due times, and creates records. With `config.jobs.scheduler.mode = "inline"`, due runs execute and are awaited; with `"enqueue"`, only workers execute them.

The scheduler lease uses `jobs.scheduler.lease.ttl` and `renewInterval`. Without the lease, a process does not advance its in-memory window. Its cursor is not persisted, so this does not guarantee catch-up across restarts. See [Jobs Specification VEXT-JOB-003](/specification/jobs#vext-job-003) for interval origin, cron-second boundaries, and jitter limits.

Options include `ownerId`, `signal`, and `once`; `once` runs one scheduling loop. Calling `tickJobScheduler()` directly does not replace lease coordination. Missing ownerId generates a PID/UUID identity. Polling, Store, or inline errors can reject the Promise. Renewal runs in the loop, so long work can delay it. Exceptional paths do not guarantee lease release; see the specification.

### Due-Time Calculation and One Tick

| Entry                                 | Parameters/return                                                                                              | Limit                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tickJobScheduler(runtime, options?)` | ownerId/now/previousTick → `Promise<number>`                                                                   | Count of processed due times, not necessarily new records; no scheduler lease.                                               |
| `resolveJobDueTimes(options)`         | required schedule, optional now/previousTick/defaultTimezone/defaultMisfirePolicy/defaultMaxCatchUp → `Date[]` | Pure calculation; disabled or out-of-range schedules return empty; window/cron/interval limits apply.                        |
| `getNextJobRunTime(options)`          | required schedule, optional from/defaultTimezone → Date or undefined                                           | Prediction; no valid or enabled schedule gives undefined; does not guarantee every startAt/endAt limit or actual scheduling. |

Scheduled runs have no business payload. Their IDs derive from Job name and due time; jitter moves runAt, and singleton adds an idempotency key for the same fire time. It is not a cross-cycle mutual exclusion lock.

## `startJobWorker(runtime, options)`

Starts a polling loop that heartbeats, claims due queued records, executes Jobs, and stores results. Run leases coordinate ownership; after expiry, takeover can overlap an old handler that ignores cancellation, so exactly-once external side effects are not guaranteed.

Signature: `startJobWorker(runtime: VextJobRuntime, options?: StartJobWorkerOptions): Promise<void>`. Missing ownerId generates a PID/UUID identity and `once` defaults false. A normal return means the loop and bounded wait ended, not that all external work ended; claim/heartbeat Store errors can reject.

Options include ownerId, signal, and once. Once makes one capacity-limited claim round and waits; it does not drain the queue. Signal stops the loop but does not automatically cancel already claimed handlers. `shutdownTimeout` bounds waiting, and the [shutdown boundary](/specification/jobs#vext-job-005) describes CLI resource order.

Workers enforce both per-process and per-job concurrency. The process-local limit comes from `jobs.worker.concurrency`; the per-job limit comes from `defineJob({ concurrency })`, falls back to `jobs.defaults.concurrency`, and is clamped to at least `1`.

## `createJobStore(options)`

Creates a built-in store from `config.jobs.store`. `memory` is process-local. `file` persists under `.vext/jobs` by default; sharing it requires validation of filesystem locking, renames, and errors. `redis` shares records and leases. `auto` still selects Redis, resolving a target from client, url/uri, or `VEXT_REDIS_URL`/`REDIS_URL`; a missing target fails instead of falling back to File.

Signature: `createJobStore(options: CreateJobStoreOptions): VextJobStore`. Options require rootDir and optionally take config (`VextJobsConfig`, not entire `VextConfig`), configProfile, and runtimeMode. The factory does not await store.init; bootstrapJobRuntime does. Unknown types throw; inject a custom implementation through bootstrap's store option.

| Direct factory                   | Options                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createMemoryJobStore(options?)` | Optional `now: () => Date`; lost on process exit.                                                                    |
| `createFileJobStore(options)`    | Required rootDir, optional dir/now; dir is relative to rootDir and defaults to `.vext/jobs`.                         |
| `createRedisJobStore(options?)`  | Optional rootDir/configProfile/runtimeMode/now plus client/url/uri/namespace/keyPrefix; must resolve a Redis target. |

Redis URL precedence is url → uri → `VEXT_REDIS_URL` → `REDIS_URL`, with an external client preferred. Store.close closes a self-created client but not an external one. Sharing a queue requires the same target and prefix. File/Redis records do not expire automatically; payload/result should be JSON serializable. File-lock/write or Redis connection errors throw at their actual calls, without a universal automatic recovery guarantee.

### Store Contract and Run Records

| Method                                      | Parameters/return                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Optional `init/close`                       | `() → void` or `Promise<void>`                                           |
| `acquireSchedulerLease/renewSchedulerLease` | `(ownerId, ttl, now?) → Promise<boolean>`                                |
| `releaseSchedulerLease`                     | `(ownerId) → Promise<void>`                                              |
| `enqueueRun`                                | `(input: VextJobStoreEnqueueInput) → Promise<VextJobRunRecord>`          |
| `claimNextRun`                              | `({ownerId, now?, leaseTtl?, jobNames?}) → Promise<record or undefined>` |
| `claimRun`                                  | `(runId, {ownerId, now?, leaseTtl?}) → Promise<record or undefined>`     |
| `renewRunLease`                             | `(runId, ownerId, leaseTtl, now?) → Promise<boolean>`                    |
| `completeRun`                               | `(runId, patch, {ownerId}?) → Promise<boolean>`                          |
| `getRun/listRuns`                           | Query with jobName/status/limit filters for list.                        |
| `heartbeatWorker`                           | `(ownerId, now?) → Promise<void>`                                        |

The Store also has a read-only type string. `enqueueRun` requires jobName and trigger and optionally accepts id, payload, runAt, scheduledAt, priority, idempotencyKey, and source. It does not check registry or payload schema. A completeRun patch may set status, attempts, durationMs, finishedAt, result, error, and updatedAt; business code should normally use runtime rather than assemble terminal state directly.

`VextJobRunRecord` includes id/jobName/status/trigger, runAt/createdAt/updatedAt, attempts, and optional payload/priority, scheduledAt/startedAt/finishedAt/durationMs, result/error, leaseOwner/leaseUntil, idempotencyKey/source. Timestamps are strings. Status includes queued/running and four execution outcomes. Built-in listRuns sorts newest createdAt first, defaults to limit 50, and has no cursor pagination or retention/delete API.

The same ID reuses a record. A nonempty idempotencyKey for the same Job reuses a nonfailed/noncancelled record, including success or timeout. Reuse does not guarantee runtime.run can claim it again or return its old result. Memory/File claimRun checks future runAt, while current Redis direct claimRun lacks the same future-time wait guarantee. Ordinary workers claim through claimNextRun; do not interchange the two methods.

Built-in stores accept `completeRun(runId, patch, { ownerId })` only for the nonempty owner of the current running record. Completion clears the lease; missing, queued, terminal, differently owned, or repeated completion returns `false` without overwriting the terminal record. Handlers should still be written for at-least-once execution, and external side effects need business idempotency.

## Testing API

`vextjs/testing` exports `createTestJobRunner(options)`. It creates a test app, registers supplied job definitions, and exposes `run(name, options)` plus `close()`.

Signature: `createTestJobRunner(options: CreateTestJobRunnerOptions): Promise<TestJobRunner>`. `jobs` is required as a name-to-definition object or definition array. Unnamed array entries become job1/job2, while object entries prefer the definition's own name. Other options follow CreateTestAppOptions excluding routes; the framework forces routes=false.

It returns app, registry, run, and close. It uses supplied definitions, without scanning `src/jobs`, writing run records, or testing Store leases. Use `services: false` with mockServices to isolate business dependencies, and close in `finally`. See [Jobs Guide: Testing](/guide/jobs#testing) for positive and negative assertions.

## Job definition fields

| Field            | Type                      | Default                            | Description                                                         |
| ---------------- | ------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `name`           | `string`                  | Inferred from file path            | Unique job name inside one service root                             |
| `description`    | `string`                  | `undefined`                        | Documentation summary                                               |
| `tags`           | `string[]`                | `undefined`                        | Documentation and filtering tags                                    |
| `docs`           | `object`                  | `undefined`                        | Extra metadata for Vext Docs / MCP                                  |
| `payload`        | `Record<string, unknown>` | `undefined`                        | Validated by current app Validator, default schema-dsl.             |
| `schedule`       | `VextJobScheduleConfig`   | `undefined`                        | Built-in scheduler configuration                                    |
| `queue`          | `VextJobQueueConfig`      | `undefined`                        | Queue metadata such as priority                                     |
| `timeout`        | `number`                  | `config.jobs.defaults.timeout`     | Per-attempt timeout in milliseconds, with cooperative cancellation. |
| `retry`          | `false &#124; object`     | `config.jobs.defaults.retry`       | Retry attempts, delay, and backoff                                  |
| `concurrency`    | `number`                  | `config.jobs.defaults.concurrency` | Per-Job limit within a worker, not a direct-run limit.              |
| `idempotencyKey` | `string &#124; function`  | `undefined`                        | Business idempotency key for manual/enqueued jobs                   |
| `handler`        | `function`                | Required                           | Job handler                                                         |

`docs` may contain summary/description/tags metadata. `queue` may contain priority and enabled; priority is a nonnegative integer, with higher numbers first subject to Store candidate scope, while enabled does not currently block enqueueing. An idempotencyKey function receives `{ jobName, payload }` and may return string/undefined/null; it does not replace a business unique constraint. Omit unused fields rather than using `timeout: 0` or `concurrency: 0`, which defineJob rejects.

## Schedule fields

| Field           | Type                                          | Default                               | Description                                          |
| --------------- | --------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `enabled`       | `boolean`                                     | `true`                                | Enables scheduled firing for this job                |
| `cron`          | `string`                                      | `undefined`                           | Second-level cron expression                         |
| `interval`      | `number`                                      | `undefined`                           | Millisecond interval; cannot be combined with `cron` |
| `timezone`      | `string`                                      | `config.jobs.scheduler.timezone`      | Cron timezone                                        |
| `startAt`       | `string &#124; Date`                          | `undefined`                           | Start time                                           |
| `endAt`         | `string &#124; Date`                          | `undefined`                           | End time                                             |
| `misfirePolicy` | `'skip' &#124; 'fire-once' &#124; 'catch-up'` | `config.jobs.scheduler.misfirePolicy` | How missed ticks are handled                         |
| `maxCatchUp`    | `number`                                      | `config.jobs.scheduler.maxCatchUp`    | Maximum catch-up runs                                |
| `jitter`        | `number`                                      | `config.jobs.scheduler.jitter`        | Random delay after due time in milliseconds          |
| `singleton`     | `boolean`                                     | `false`                               | Allows one run for each scheduled fire time          |

## Configuration

Merge this reference into `src/config/default.ts`. `runner`, `scheduler.enabled`, `worker.enabled`, and `worker.heartbeatInterval` currently have type/config validation but do not act as runner selection, loop switches, or an independent heartbeat interval in the corresponding execution paths. `enabled: true` does not auto-start Jobs with HTTP. Use explicit commands to start processes, signals/process management to stop them, `jobs.enabled` for discovery, and per-Job `schedule.enabled` for scheduling.

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
      lease: { ttl: 30000, renewInterval: 10000 },
    },
    defaults: {
      timeout: 30000,
      retry: { attempts: 1, delay: 0, backoff: "fixed" },
      concurrency: 1,
    },
  },
};
```

| Field                                | Default                            | Description                                                                                 |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `jobs.enabled`                       | `true`                             | Enables job discovery                                                                       |
| `jobs.dir`                           | `'jobs'`                           | Job directory relative to `src/`                                                            |
| `jobs.include`                       | Default six source extension globs | Replace discovery scope; export rules still apply.                                          |
| `jobs.exclude`                       | No extra rules                     | Adds to built-in underscore/declaration/test/spec exclusions.                               |
| `jobs.runner`                        | `'inline'`                         | Does not currently auto-select or load a runner.                                            |
| `jobs.store.type`                    | `'file'`                           | `memory`, `file`, `redis`, or `auto`                                                        |
| `jobs.store.url` / `uri`             | `undefined`                        | Redis connection for `redis` store                                                          |
| `jobs.store.client`                  | undefined                          | External Redis-compatible client, preferred over URL; provider owns its lifecycle.          |
| `jobs.store.namespace` / `keyPrefix` | auto                               | Redis key isolation; auto prefix uses project/profile/runtime/module                        |
| `jobs.store.dir`                     | `'.vext/jobs'`                     | File store data directory relative to project root                                          |
| `jobs.scheduler.mode`                | `'inline'`                         | `inline` executes due runs, `enqueue` only queues them                                      |
| `jobs.scheduler.enabled`             | true                               | Not currently a switch for startJobScheduler execution.                                     |
| `jobs.scheduler.tickInterval`        | `1000`                             | Scheduler tick interval in milliseconds                                                     |
| `jobs.scheduler.timezone`            | UTC                                | Default cron timezone for Jobs.                                                             |
| `jobs.scheduler.misfirePolicy`       | skip                               | In-process window policy; see specification 003.                                            |
| `jobs.scheduler.maxCatchUp`          | 10                                 | Default catch-up cap.                                                                       |
| `jobs.scheduler.jitter`              | 0                                  | Default random delay bound in milliseconds; see specification 003 for inline limits.        |
| `jobs.scheduler.lease.enabled`       | true                               | False skips scheduler lease coordination.                                                   |
| `jobs.scheduler.lease.ttl`           | `30000`                            | Scheduler lease TTL                                                                         |
| `jobs.scheduler.lease.renewInterval` | `10000`                            | Scheduler lease renewal interval; keep it no larger than the TTL                            |
| `jobs.worker.enabled`                | true                               | Not currently a switch for startJobWorker execution.                                        |
| `jobs.worker.concurrency`            | `4`                                | Per-worker-process concurrency                                                              |
| `jobs.worker.pollInterval`           | `1000`                             | Worker polling interval in milliseconds                                                     |
| `jobs.worker.shutdownTimeout`        | `10000`                            | Time to wait for running jobs during shutdown                                               |
| `jobs.worker.heartbeatInterval`      | 10000                              | Not used as a separate heartbeat cycle; actual heartbeat occurs in the worker polling loop. |
| `jobs.worker.lease.ttl`              | 30000                              | Run lease duration in milliseconds.                                                         |
| `jobs.worker.lease.renewInterval`    | `10000`                            | Run lease timer interval, bounded by TTL at runtime.                                        |
| `jobs.defaults`                      | See example                        | Default timeout/retry/concurrency for jobs                                                  |
| `jobs.defaults.concurrency`          | `1`                                | Default per-job concurrency limit enforced by workers by job name                           |

Scheduler/worker numerical times are milliseconds. App config validation requires positive integer tick/poll/shutdown/lease/concurrency values and nonnegative jitter. Valid fields alone do not prove Store connectivity, reliable cron delivery, or business idempotency. See the [Jobs Guide](/guide/jobs) for operation, observed limits, and recovery checks.

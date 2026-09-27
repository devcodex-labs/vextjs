# Jobs and Scheduling Specifications

This page defines the boundaries of Job definitions, execution, scheduling, queues, and run records. See [Jobs](/guide/jobs) for complete commands and configuration, and the [Jobs API](/api/jobs) for types and interfaces.

## Definition and execution entry points

<a id="vext-job-001"></a>

### VEXT-JOB-001 [MUST] Load and run Jobs through a job entry point

Declare a Job with `defineJob()`. Discovery uses `src/jobs` by default or the directory configured by `config.jobs.dir`. Default-exported and named-exported Jobs are supported; names in one registry must be unique.

Ordinary HTTP startup does not automatically execute these Jobs or start a scheduler just because a `schedule` field exists. Choose an execution mode explicitly through `vext job run`, `vext job enqueue`, `vext job scheduler`, `vext job worker`, or the corresponding programmatic API. The Job runtime initializes required configuration, plugins, services, and Store without starting ordinary HTTP route listening.

`runJob()` / `createJobRunner()` form the execution layer; they do not automatically write Store records or acquire a run lease. `runtime.run()` returned by `bootstrapJobRuntime()` combines queue records, claiming, lease renewal, and completion. `createTestJobRunner()` mainly tests execution and cannot establish that persistence or multiple workers behave correctly.

Even `list` and `inspect` CLI commands initialize the Job runtime and may open configured external connections. These commands currently load configuration in production mode. `--source` changes the choice between source and build artifacts; it does not switch runtime mode to development. Establish the project root, profile, real Store, and dependency targets before running them.

A handler receives `app`, `job`, `payload`, `signal`, `attempt`, `runId`, and `logger`. It has no HTTP request/response context. Reuse business logic through a Service or explicit function.

<a id="vext-job-002"></a>

### VEXT-JOB-002 [MUST] Handle payload validation separately from business results

When a `payload` Schema is declared, the Runner validates input with the application's current Validator before entering the handler. Without one, it adds no structural constraint automatically. A validation failure is a Job run failure, not an HTTP 400/422 response.

`runtime.enqueue()` does not validate the payload Schema on enqueue. A queued state does not prove the input is valid. Every retry validates again, so invalid payloads may consume configured attempts. The default scheduler does not provide a business payload automatically. Enqueue a Job with required input explicitly from business code, or make its scheduled handler scan pending data.

Passing validation still leaves authorization, business state, concurrency constraints, and external side effects to be checked. A handler's return value, run status, and final Store record each mean something different; monitoring cannot rely only on a returned value.

## Scheduling, queues, and storage

<a id="vext-job-003"></a>

### VEXT-JOB-003 [MUST] Distinguish schedulers, executors, and shared Stores

A Scheduler calculates due times from cron/interval settings. In default `inline` mode it runs Jobs directly; `enqueue` mode writes pending records for an explicitly started worker to claim. Without a worker, a successful enqueue does not mean execution occurred.

Multiple schedulers need the same shared Store and a scheduler lease for coordination. Disabling the lease changes multi-replica behavior. Check schedule time zones, missed-run policy (`skip` / `fire-once` / `catch-up`), `maxCatchUp`, and jitter against the actual deployment, not just one normal trigger.

Current catch-up uses an in-process `previousTick` window and does not persist a pre-shutdown scheduling cursor. Restart does not guarantee replay of the whole downtime. Both `skip` and `fire-once` currently choose one due trigger from that window, so `skip` must not be described as dropping every missed execution. `catch-up` is bounded by `maxCatchUp`.

Without `startAt`, the current interval calculation restarts from each `previousTick`; an interval longer than the polling period may never be due. Supply a stable start point and verify the real period when using intervals; use the same start point on replicas. Current cron due-time calculation does not match the Croner second-boundary behavior in use, so the default one-second tick may miss a trigger. Its return order also means `skip` / `fire-once` may not choose the latest time in a window. Accepting a `defineJob` configuration does not prove periodic behavior was verified; assess these boundaries before relying on critical calendar Jobs.

Inline mode waits for a Job to return before scheduling continues, and scheduler lease renewal also runs in that loop. A long Job can delay other Jobs and lease renewal. For continuous scheduling, prefer enqueue plus worker and verify lease loss and recovery. Jitter changes the record's `runAt` but does not make inline mode wait until that future time; Memory/File Stores may refuse to claim the record. Use enqueue with a worker for random delay instead of claiming every mode delays reliably.

| Store            | Current boundary                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `memory`         | In-process state, lost on exit; useful for tests and demonstrations                                                                       |
| `file` (default) | Defaults to `.vext/jobs`; depends on the same file store and its lock semantics                                                           |
| `redis` / `auto` | Needs an explicit Redis target and consistent key prefix; `auto` is not available without a target                                        |
| Custom           | Supply a Store implementation through the programmatic runtime API; an arbitrary `store.type` string does not load a plugin automatically |

Cross-host deployments need a verified shared-store solution. Two processes configured with `file` do not necessarily share run records.

Built-in Stores record payloads and results as JSON, so applications should supply serializable values. Records have no automatic retention or cleanup policy; plan capacity management. Directory locks and renames in the File Store depend on the underlying filesystem and are not general distributed transactions. A Redis client created from a URL closes with its Store; an externally supplied client is managed by its provider. `runtime.close()` still calls a custom injected Store's `close` when available.

<a id="vext-job-004"></a>

### VEXT-JOB-004 [MUST] Distinguish per-process concurrency limits from lease ownership

Worker `jobs.worker.concurrency` controls total concurrency within that worker. Job `concurrency` or `jobs.defaults.concurrency` limits the particular Job inside that worker. These are not cluster-wide totals.

The worker claim loop enforces these limits. They do not automatically cap concurrent direct calls to `runtime.run()` / `runJob()`. For a cross-process total, implement and verify a separate coordination policy.

The Store coordinates claiming through run leases. The runtime renews a lease and signals cancellation after losing ownership. A lease cannot stop an external side effect already performed or forcibly end a handler that ignores the signal. It is not a strict exactly-once guarantee.

For all three built-in Stores, `completeRun()` requires a currently running record and matching owner. Queued, finished, wrong-owner, missing-owner, or repeated completions return `false` without changing the record. A late completion from an old owner cannot overwrite a new owner's final state. The runtime warns about rejected completion records; a handler return value does not mean its completion record was accepted.

## Timeouts, retries, and idempotency

<a id="vext-job-005"></a>

### VEXT-JOB-005 [MUST] Treat timeout as a cooperative cancellation signal

Job `timeout` is measured in milliseconds. Each attempt gets its own timer; this is not one overall deadline covering every retry. On expiry, the Runner aborts the `signal` passed to the handler but still waits for it to return or throw; it does not forcibly kill a JavaScript function. Pass the signal to cancellable I/O and check it at entry and during long loops. A signal already aborted before invocation also does not guarantee the Runner will never enter the handler.

In current result classification, a normally returning handler after signal abortion is `cancelled`, while a throw after abortion is `timeout`. Caller cancellation can also produce such a state; the name alone does not establish a unique cause. An uncancelled final exception is `failed`.

After it stops claiming, a Worker waits for in-flight Jobs only for `shutdownTimeout`. Its stop-loop signal does not automatically become a cancellation signal for every claimed handler. Worker exit does not prove all external work has stopped; verify each Job's cancellation, connection cleanup, and business recovery.

That wait deadline describes the behavior of `startJobWorker()`. On a stop signal, the current CLI also calls `runtime.close()`; it does not guarantee every handler is finished before the Store closes. Programmatic integrations should define the sequence “stop claiming → wait for or cancel Jobs → close resources” and handle Jobs exceeding the deadline. Do not apply the ordinary HTTP shutdown procedure wholesale as a promise to drain Jobs.

<a id="vext-job-006"></a>

### VEXT-JOB-006 [SHOULD] Design business idempotency for retries and duplicate delivery

`retry.attempts` is the maximum number of attempts including the first; `retry: false` attempts once. Retry delay is measured in milliseconds and may be fixed, exponential, or calculated by a function. Job definitions or `jobs.defaults` determine the actual count and parameters.

A run record's `idempotencyKey` and scheduling `singleton` help Store deduplication but cannot replace business idempotency. Payments, coupon issuance, messages, and other side effects need business keys, persistence constraints, or an external system's idempotency mechanism. Account for the failure window in which a side effect succeeds but the completion record has not been committed.

Built-in Stores reuse an existing record for the same run ID. For the same Job, an identical nonempty `idempotencyKey` reuses a non-failed/non-cancelled record, including `success` and `timeout`. Reusing a record does not mean it can be claimed again or that another `runtime.run()` immediately returns the previous result. A scheduled run ID itself includes the Job name and due time; `singleton` is not a global mutex permitting only one executor across every due time for that Job.

Successful side effects are not rolled back automatically when the Job ultimately fails or a lease changes hands. Decide which steps may repeat and which need compensation or result lookup before enabling retries.

## Verify Job capabilities

Cover name conflicts, invalid payloads, success/failure/cancellation, retry counts, Store deduplication, concurrent claiming, lost lease renewal, late completion, and shutdown timeout. Also check time zones and catch-up for scheduling. A multi-node production Store needs verification in its real deployment; memory tests cannot represent all failure semantics of Redis or a shared filesystem.

For a first run and complete test example, see the [Jobs Guide](/guide/jobs). Resource ownership is in [Security and Resource Specifications](/specification/security-and-resources).

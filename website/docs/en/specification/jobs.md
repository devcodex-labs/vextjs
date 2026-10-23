# Scheduled Jobs contract

This page defines observable guarantees, prerequisites and limits. Use the [guide](/guide/jobs) for integration and the [API](/api/jobs) for precise fields.

## Runtime and execution guarantees

<a id="vext-job-001"></a>

### VEXT-JOB-001 [MUST] Application startup

Startup validates configuration, names, Cron, timezone, declarations and necessary Redis connectivity. With enabled Jobs, necessary onReady failure rejects and cleans up startup; otherwise existing logged isolation remains. Observational app:ready notifications are separate from necessary initialization. Local activates after necessary readiness.

In every built-in Cluster mode, Master completes Worker startup attempts and checks the actual ready-set manifests. A Worker registers future timers only on valid activation, then acknowledges. Master reports overall Jobs readiness after valid acknowledgements and a membership recheck. An activated Worker may schedule earlier; there is no second global release after all ACKs. Later coordination failure cannot roll back existing effects. Unactivated, stopped or timed-out Workers cannot regain eligibility through delayed messages. Partial startup failures follow existing capacity policy and are excluded from the ready set; no valid Worker means no startup success.

<a id="vext-job-002"></a>

### VEXT-JOB-002 [MUST] Schedule definitions

Every definition explicitly supplies a valid five/six/seven-field Cron or supported macro, rejecting interval, Date and one-off ISO dates. Timezone is task > jobs.timezone > UTC. Day/weekday defaults to OR, explicit +weekday means AND; calendar extensions and DST follow the installed Croner.

Tasks default to enabled. Disabled definitions still validate fields, declarations, TTL and names but need no future point. Global disable skips discovery, not config validation. Enabled tasks need strictly future points at preparation and activation; finite-year plans stop normally after their last point.

<a id="vext-job-003"></a>

### VEXT-JOB-003 [MUST] Execution and overlap

Startup, restart and recovery select strictly future points without immediate execution or catch-up. An armed point delivered within its window may run; a cross-period delay is skipped. Repeated, old and locally busy points are never queued for replay.

Same-name tasks skip overlap; different tasks may run concurrently. Handler errors are logged, with future periods and HTTP service continuing. Return values are not persisted. Logs distinguish planned/actual times, duration, mode, PID/Worker, outcomes and skip reasons; nextRunAt is diagnostic, never a successful-execution promise.

<a id="vext-job-004"></a>

### VEXT-JOB-004 [MUST] Replica configuration

Without jobs.redis, one application coordinates locally and one trusted built-in Cluster uses IPC within the current Master's Workers, without Redis. Ordinary environment flags or cluster.isWorker do not confer built-in authority. A failed trusted connection in declared built-in mode refuses admission without Local fallback.

Independent applications, PM2 processes, containers or hosts cannot discover each other automatically. Explicitly share a Redis target, effective prefix and consistent definitions when they need coordination. Only a jobs.redis object enables Redis; an environment URL alone does not. All built-in modes check initial ready-set effective names, switches, Cron, timezones, mode and critical configuration. Redis adds known target, prefix and TTL; documentation metadata is excluded. A supplied opaque client's real target and consistency between independent applications remain deployment responsibilities. Empty/all-disabled sets create no unnecessary timers, Jobs Redis connections or extra task channels.

<a id="vext-job-005"></a>

### VEXT-JOB-005 [MUST] Trigger deduplication

Within a healthy domain, a same-name task receives at most one execution qualification per scheduled point. Quick completion, lease expiry or process crash does not make a consumed point reclaimable. Lost responses and late/expired permits cannot duplicate or revive admission. Sending a permission message does not prove business completion; Workers lacking valid permission do not run.

A crash between qualification and business completion can lose an occurrence. This is scheduling deduplication, not guaranteed business success once. Partitions, Redis state loss and ignored cancellation require idempotency for side effects.

<a id="vext-job-006"></a>

### VEXT-JOB-006 [MUST] Running leases

Effective Redis TTL is Job.leaseTtl > jobs.redis.leaseTtl > 30000 milliseconds, a safe integer at least 1000, consistent for a task across replicas. Local/IPC validates the field without using Redis TTL. TTL does not change identity.

Execution renews using that task's TTL; it is not a business timeout and long handlers may exceed it. Renewal/release acts only on its owner. Ordinary shutdown/rolling drain maintains in-flight leases until settlement or the shared deadline. Jobs closes URL-owned connections; callers close supplied clients. Redis Cluster task keys share a hash slot.

<a id="vext-job-007"></a>

### VEXT-JOB-007 [MUST] Redis failures

Unavailable necessary Redis rejects startup without Local fallback. An ordinary failed/late claim skips its point; healthy instances that have not lost a lease may try future points. Failed/late renewal or validity exhaustion closes every new admission in that Worker, cancels pending claims, requests cooperative Abort and shuts down/replaces it. Reconnection cannot revive eligibility.

Redis server time validates the schedule window. Replicas keep clocks synchronized; skew is diagnostic and never automatically corrected. Recovery considers only future points; cancellation cannot forcibly stop arbitrary business work or undo effects.

<a id="vext-job-008"></a>

### VEXT-JOB-008 [MUST] Feature scope

Jobs provides application-started Cron tasks, without interval, queues, payload enqueueing, priority, automatic retry, downtime catch-up, immediate startup execution, run-now, execution history storage, independent Worker Threads or an administration panel. Unknown fields cannot enable them.

Reliable delivery, progress and history belong in a separate queue or business storage/monitoring. The framework promises neither business Exactly Once nor persistent coordination across independent Masters.

<a id="vext-job-009"></a>

### VEXT-JOB-009 [MUST] Shutdown and side effects

Shutdown closes new triggers/admissions, requests cancellation, waits within the entire application's shutdown.timeout budget, then cleans coordinator and dependencies. This setting uses seconds, not a separate wait per Job. Repeated close creates no new work. Uncooperative functions cannot be interrupted and completed effects cannot be rolled back.

Rolling replacement validates the candidate first; mismatch rejects replacement while keeping the old Worker. Old admissions close before a replacement is activated. With IPC, drain/disconnect does not prove the handler stopped: only exact settlement or confirmed process exit releases its in-flight ownership, while consumed points remain. Master channel loss closes admissions, cancels and shuts down without Local fallback. IPC state is not persistent across a new Master.

<a id="vext-job-010"></a>

### VEXT-JOB-010 [MUST] Testing and development

Ordinary createTestApp neither scans nor runs project Jobs. createTestJobScheduler prepares supplied definitions and a controlled clock before necessary onReady. Only tick drives it; no discovery, real timers or mandatory Redis are needed for Local scheduling tests.

Development runs Jobs by default. Task files or loaded dependencies cause cold restart after old scheduler closure, including custom directories; a development profile can disable tasks. The helper cannot replace real Master/Worker, Redis, crash and rolling tests.

<a id="vext-job-011"></a>

### VEXT-JOB-011 [MUST] Discovery and documentation selection

Default recursive selection includes ts/js/mjs/cjs/mts/cts, ignoring underscore filenames, declarations and test/spec files; underscore directories remain allowed. include replaces matching, exclude adds to built-in ignores, and actual extensions are not rewritten for production. Directories stay inside project boundaries.

Each selected file contains one finite default SDK Job. Ordinary helpers/types/constants, dynamic fields, recognizable default aliases, CommonJS module.exports and bounded project-source default re-exports are allowed. Factories/conditional defaults, extra SDK declarations including unused positions, Job-valued named aliases, user getters/Proxies and later export mutations are rejected. Explicit name wins, otherwise derive the relative path without changing camelCase; disabled definitions also check duplicates. Builds validate before optimization and production need not carry src. Task module top level must not run business work or create independent timers; finite declaration validation is not a general side-effect sandbox.

<a id="vext-job-012"></a>

### VEXT-JOB-012 [MUST] Static evidence and project state

With project Docs enabled, the Jobs source defaults on and inherits jobs.dir/include/exclude individually. Explicit openapi.docs.code.jobs fields affect only documentation selection; disabling that source does not stop tasks, and disabled definitions may appear.

Static scanning does not execute user config, task modules, getters or handlers to resolve dynamic values. Unknown/partial evidence retains reasons; inferred labels never substitute for unknown actual names. MCP Recipes generate explicit Cron, one default Job per file, with per-task TTL. Static checks identify expected coordination but runtimeVerified:false proves neither readiness, connectivity nor execution. Chinese, English, API, Recipe and capability descriptions must agree.

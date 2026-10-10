# Scheduled Jobs contract

<a id="vext-job-001"></a>

### VEXT-JOB-001 [MUST] Application startup

Startup discovers `defineJob()` exports in `src/jobs`. Configuration, names, cron, timezone and Redis connectivity are validated before HTTP listening. Future timers are registered only after plugins, services and readiness complete.

<a id="vext-job-002"></a>

### VEXT-JOB-002 [MUST] Schedule definitions

Each definition provides exactly one of cron or interval and defaults to enabled. Intervals align to the Unix epoch; cron defaults to UTC. Global or per-job disabling prevents execution. Disabled individual definitions are still imported, validated and included in unique-name checks; global disable skips discovery without bypassing configuration validation. Active tasks need a representable future point or startup fails.

<a id="vext-job-003"></a>

### VEXT-JOB-003 [MUST] Execution and overlap

Startup selects strictly future points; intervals align to Unix epoch. An armed point delayed within its period may run, but cross-period delay is skipped.

Same-job overlap is skipped; different jobs may run concurrently. Handler errors are logged without disrupting future periods or HTTP. Return values are not persisted.

<a id="vext-job-004"></a>

### VEXT-JOB-004 [MUST] Replica configuration

Active jobs in built-in Cluster require shared Redis. Empty directories and entirely disabled jobs do not. External replicas must explicitly share Redis and schedule definitions. Namespace is generated from package name, profile and runtime mode; matching replicas need no manual value. Override namespace / keyPrefix only for extra isolation.

<a id="vext-job-005"></a>

### VEXT-JOB-005 [MUST] Trigger deduplication

Atomic Redis scripts coordinate a per-job last-trigger timestamp and running lease. The marker survives completion and lease expiry. Equal or older points cannot be admitted again. Overlapping points are consumed rather than queued.

<a id="vext-job-006"></a>

### VEXT-JOB-006 [MUST] Running leases

Long tasks renew every leaseTtl/3. Renewal and release check ownership. A job's Redis Cluster keys share a hash slot. Jobs owns URL-created connections; supplied clients remain caller-owned.

<a id="vext-job-007"></a>

### VEXT-JOB-007 [MUST] Redis failures

Redis errors skip the current trigger without local fallback. Renewal failure requests cancellation. Recovery resumes only future periods. Server time rejects points that are still in the future or have crossed into their next period.

<a id="vext-job-008"></a>

### VEXT-JOB-008 [MUST] Feature scope

No queue, priority, payload enqueueing, automatic retries, downtime catch-up or immediate startup execution. A crash after admission may lose an occurrence. Use a dedicated queue module for reliable delivery.

<a id="vext-job-009"></a>

### VEXT-JOB-009 [MUST] Shutdown and side effects

Shutdown stops new triggers, aborts active handlers and waits within the application's total budget before releasing dependencies. Cancellation is cooperative; network partitions, Redis state loss and ignored signals prevent exactly-once side effects.

<a id="vext-job-010"></a>

### VEXT-JOB-010 [MUST] Testing and development

`createTestApp` does not schedule real jobs. `createTestJobScheduler` exercises the same rules with explicit ticks. Development job edits cold-restart without retaining old timers.

<a id="vext-job-011"></a>

### VEXT-JOB-011 [MUST] Discovery and documentation selection

Runtime defaults to six JS/TS module extensions, ignoring underscore filenames, declarations and tests while permitting underscore directories. Include matches actual files and replaces defaults; exclude appends built-in ignores. Source extensions are not automatically rewritten to emitted extensions. Every selected file requires a defineJob value; the loader determines inferred and explicit names.

Docs Jobs inherits jobs.dir/include/exclude by default. Explicit Docs fields override individually without changing scheduling selection; disabled definitions can still be documented.

<a id="vext-job-012"></a>

### VEXT-JOB-012 [MUST] Static evidence and project state

Static consumers require vextjs factory-binding provenance and resolve safe ESM imports/re-exports within declared source roots. Absent, known and unknown fields remain distinct. An inferred path label cannot substitute for an unknown actual name. Unresolved wrappers, cycles and boundary escapes report missing evidence without executing business modules or handlers.

Framework support does not prove project enablement. Empty/disabled projects, active Cluster without Redis and unknown configuration need conservative states and reasons; checks use the selected development/production configuration. Declarations and diagnostics do not prove startup, connectivity or execution; static tools preserve runtimeVerified=false.

See [Jobs API](/api/jobs) and the [Jobs guide](/guide/jobs).

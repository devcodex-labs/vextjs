# Scheduled Jobs contract

<a id="vext-job-001"></a>

### VEXT-JOB-001 [MUST] Application startup

Startup discovers finite default SDK Jobs in src/jobs. Configuration, names, Cron, timezone, declaration shape and required Redis connectivity are checked before listening. With enabled Jobs, a necessary onReady failure rejects and cleans up startup; without enabled Jobs, existing logged isolation remains. Local activates after readiness. In every built-in Cluster mode, Master first checks the actual ready-set manifests and sends activation; each Worker starts future timers on matching activation and acknowledges it. Master reports overall Jobs readiness only after all valid ACKs arrive and membership is rechecked. appReady is separate from JobsActive. A missing ACK does not roll back effects already performed by an activated Worker; failure closes admissions, and a stopped Worker must reject delayed activation.

<a id="vext-job-002"></a>

### VEXT-JOB-002 [MUST] Schedule definitions

Each definition requires a five/six/seven field Cron string or supported macro; reject interval, Date and ISO dates. Timezone is task > global > UTC. Disabled definitions still validate fields, TTL, cardinality and names, without needing a future point. Global disable skips discovery but not config validation. Enabled tasks need future points at prepare and activation; next=null after the final point ends normally.

<a id="vext-job-003"></a>

### VEXT-JOB-003 [MUST] Execution and overlap

Startup selects strictly future points. An armed point delayed within its window may run; cross-period delay is skipped. All modes consume repeated, older and busy points. Master validates canonical windows with the Croner successor cursor, without trusting worker timestamps to advance its high-water mark.

Same-job overlap is skipped; different jobs may run concurrently. Handler errors are logged without disrupting future periods or HTTP. Return values are not persisted.

<a id="vext-job-004"></a>

### VEXT-JOB-004 [MUST] Replica configuration

Auto selects Local for one app, Master IPC for trusted built-in Cluster without Redis, or Redis when configured. Actual Worker channels map privately to slot/generation and establish masterEpoch by handshake; environment variables and cluster.isWorker alone confer no IPC authority. Failed built-in handshake never falls back to Local. All built-in modes compare the actual ready-set manifests after initial fork attempts and wait for activation ACKs; membership changes require revalidation or failure. Independent replicas explicitly share Redis and definitions. Namespace derives from package/profile/mode.

<a id="vext-job-005"></a>

### VEXT-JOB-005 [MUST] Trigger deduplication

Redis scripts atomically coordinate per-job last-trigger and running lease; last survives completion and expiry. IPC follows CLAIM→OFFER→ACCEPT→PERMIT, committing ownership before final permission. A send callback does not prove admission or execution. After the last await, a synchronous gate checks identity, admission epoch, window and permit, then enters the handler. Late packets never revive abandoned requests. Repeated, older and busy points are consumed.

<a id="vext-job-006"></a>

### VEXT-JOB-006 [MUST] Running leases

Effective TTL is job > global Redis TTL > 30000ms, safe integer >=1000, used only by Redis. Renew approximately TTL/3 with a min(2000,TTL/3) operation budget and a conservative deadline measured before send using monotonic time. Renewal must finish before both its operation deadline and previous validity deadline. Renewal/release check owner; task keys share a hash slot. URL connections are Jobs-owned; supplied clients remain caller-owned. Ordinary drain preserves Held renewal until settlement or the shared shutdown deadline.

<a id="vext-job-007"></a>

### VEXT-JOB-007 [MUST] Redis failures

Redis errors never fall back to Local. Failed/late renewal, expiry or an exhausted conservative deadline permanently marks this Worker LeaseLost: close all admissions, cancel pending claims, Abort and shut down/replace. Reconnect cannot revive eligibility. Server TIME rejects premature or expired windows; network partitions and independent applications do not gain exactly-once business guarantees.

<a id="vext-job-008"></a>

### VEXT-JOB-008 [MUST] Feature scope

No queue, priority, payload enqueueing, automatic retries, downtime catch-up or immediate startup execution. A crash after admission may lose an occurrence. Use a dedicated queue module for reliable delivery.

<a id="vext-job-009"></a>

### VEXT-JOB-009 [MUST] Shutdown and side effects

Shutdown shares one absolute app deadline: close admissions/timers, Abort, wait for settlement, close coordinator, then dependencies. Do not prematurely DEL an unsettled Redis run. IPC committed ownership survives drain, slot changes and timeouts until exact settled/never-started or actual exit. Replacement first verifies the candidate, then obtains an old closed-admission receipt or actual exit before slot commit/new activation. A drain receipt is not settlement, and issuing SIGKILL is not an exit receipt.

<a id="vext-job-010"></a>

### VEXT-JOB-010 [MUST] Testing and development

createTestApp does not schedule real Jobs. createTestJobScheduler prepares/attaches the scheduler before necessary onReady hooks and shares a controlled clock across prepare/activation/tick, without discovery or real timers. Changes to Jobs and loaded default-reexport dependencies cold-restart; cold and repeated loads use the same declaration gate.

<a id="vext-job-011"></a>

### VEXT-JOB-011 [MUST] Discovery and documentation selection

Runtime selects six JS/TS extensions, ignores underscore filenames/declarations/tests and keeps underscore directories. Include matches actual files and replaces defaults; exclude appends built-in ignores, without extension rewriting. Each selected file has one default SDK Job. Ordinary helpers/types/constants are allowed; cardinality includes unexecuted functions and branches. Finite immutable default aliases, CJS module.exports and relative default reexports are allowed. Opaque factories, extra SDK declarations, Job-valued named aliases, user getters/Proxy and late export mutation are rejected. Validate every default shell and terminal source. Compiler projections require full structural proof, never marker trust.

Framework loading/building validates original selected inputs and the finite default closure before optimization. Input/selection drift prevents commit. Source-less deployment proves only current emitted-input, not historical source cardinality; no deployed src or permanent provenance manifest is required.

Docs Jobs inherits jobs.dir/include/exclude by default. Explicit Docs fields override individually without changing scheduling selection; disabled definitions can still be documented.

<a id="vext-job-012"></a>

### VEXT-JOB-012 [MUST] Static evidence and project state

Static consumers share finite declaration facts. Module shape/cardinality is independent of fieldStates, with known/unsupported/unknown and reasons. Complete fields do not prove valid shape; missing graphs/cycles/boundary escapes/budget failures remain unknown. Inferred names never replace unknown actual names. Do not evaluate config, modules, getters or handlers.

Framework support does not prove enablement. Empty/disabled projects and unknown config retain conservative states/reasons for the selected development/production target. Show effective timezone/Redis TTL, expected coordination and source-input/emitted-input scope. Actual handshake, activation, connectivity and execution remain runtimeVerified:false and require independent host verification.

See [Jobs API](/api/jobs) and the [Jobs guide](/guide/jobs).

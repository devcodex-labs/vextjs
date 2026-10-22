# Scheduled Jobs

Jobs perform scheduled application work such as expiring data, refreshing statistics and synchronizing business data. Put business logic in a Service and use the Job to call it on schedule; it shares the ready application, plugins and app.services.

Each task requires an explicit **Cron** expression, with one default SDK Job per selected file. Scheduling starts after application readiness and coordination activation, without a separate scheduler or Worker. Only future points run: no queue, automatic retry, downtime catch-up or immediate startup execution. See the [API field reference](/api/jobs) and [Jobs contract](/specification/jobs).

## Create your first task

Start with an existing Vext application that runs through its project scripts. Create src/jobs/heartbeat.ts:

```typescript
import { defineJob } from "vextjs";

export default defineJob({
  name: "heartbeat",
  cron: "* * * * *",
  async handler({ name, scheduledAt, signal, logger }) {
    signal.throwIfAborted();
    logger.info({ name, scheduledAt }, "heartbeat");
  },
});
```

Run the existing npm run dev script, or your build script followed by npx vext start. Plugins, services, routes and readiness finish before timers start; the first execution is the next whole-minute boundary. Framework logs include job, scheduledAt and completion duration. No task files means no scheduling resources.

Development also schedules tasks. To keep business work off development machines, merge jobs.enabled=false into the selected development profile; see [configuration precedence](/guide/configuration) for --config, local and provider overrides.

## Discovery, exports and names

Default discovery and naming:

```text
src/jobs/
├── heartbeat.ts            → heartbeat
├── cleanup.mjs             → cleanup
├── _helpers.ts             → ignored
├── types.d.ts              → ignored
├── cleanup.test.ts         → ignored
├── _internal/task.ts       → _internal.task (directory allowed)
└── billing/
    ├── close-invoice.ts    → billing.close-invoice
    └── index.ts           → billing
```

The six default module extensions are .ts/.js/.mjs/.cjs/.mts/.cts. Underscore **filenames**, declaration files and .test/.spec files are ignored; underscore directories are allowed. By default, .tsx/.jsx are not selected. Names remove the extension and trailing /index and replace slashes with dots; root index.ts becomes index. Unlike Services, names do not convert kebab-case to camelCase.

A selected file exports one default Job; ordinary helpers, types and constants may coexist:

```typescript
// src/jobs/billing/index.ts
import { defineJob } from "vextjs";
export default defineJob({ cron: "* * * * *", handler() {} });
export function helper(value: number) {
  return value + 1;
}
```

The name is billing. Explicit name overrides inference and allows nonempty ASCII letters, digits and `_ . : -`. Loaded names must be unique, including disabled definitions. Prefer stable business names so file moves do not change Redis identity. Put additional Jobs in separate files.

JavaScript/ESM uses the same exports; native CommonJS can use:

```javascript
// src/jobs/cleanup.cjs
const { defineJob } = require("vextjs");
module.exports = defineJob({ cron: "* * * * *", handler() {} });
// Ordinary local helpers are allowed; exports.daily = defineJob(...) is rejected.
```

Finite relative default reexports such as `export { default } from "../definitions/report.js"` are allowed. Both the shell and terminal definition are checked. Missing graphs, cycles, boundary escapes and exceeded budgets remain unknown and fail closed at startup. User getters/Proxy, dynamic exports and export-star are unsupported. A marker such as \_\_esModule alone never proves compiler transport.

Every selected file needs exactly one default SDK Job. Plain objects, named-only definitions, arrays and opaque default factories refuse startup. Keep helper-only modules outside Jobs or use ignored filenames such as \_helpers.ts. Disabled Jobs still validate fields, TTL, declaration cardinality and duplicate names, while not requiring a future point. Global jobs.enabled=false skips discovery. Avoid top-level business calls or timers; the framework is not a general JavaScript side-effect sandbox.

### Allowed and rejected declaration examples

```typescript
// Allowed: renamed SDK binding, immutable Job-value aliases and dynamic fields.
import { defineJob as task } from "vextjs";
const report = task({ cron: readCron(), handler() {} });
const alias = report;
export default alias;
```

`import * as sdk from "vextjs"; export default sdk.defineJob(...)` is also allowed. Dynamic fields remain unknown in Docs/MCP and are evaluated and validated during actual startup.

```typescript
// Each line independently illustrates a rejected default or additional form.
export default makeJob();
export default flag ? defineJob(a) : defineJob(b);
const job = defineJob(a);
export { job };
export default job;
export default defineJob(a);
function unused() {
  return defineJob(b);
}
```

A second SDK declaration inside an uncalled function also counts, including its own require binding. User named Job aliases, even \_\_esModule or "module.exports", are rejected. Native CJS synthetic fields and complete compiler projections require format/binding proof. Framework builds check original inputs before optimization; tree-shaking cannot erase an extra declaration before validation. Source-less deployment proves only current emitted-input, never unavailable historical sources.

### Custom directory and filters

```typescript
// Merge into src/config/default.ts
import type { VextUserConfig } from "vextjs";
export default {
  jobs: {
    dir: "tasks",
    include: ["**/*.{ts,js,mts,mjs,cts,cjs}"],
    exclude: ["experiments/**"],
    timezone: "UTC",
  },
} satisfies VextUserConfig;
```

Tasks maps to src/tasks and to tasks under the compiled root, such as dist/tasks. Do not add `src/`, absolute paths or `..`. Include replaces the defaults; exclude appends to built-in ignores. Globs are relative to the tasks directory; include=[] discovers nothing.

**Globs match actual files and are never automatically rewritten after compilation.** `include: ["**/*.ts"]` discovers source but misses emitted `task.js`. Use `**/*.{ts,js}` or other source/output pairs, or keep the defaults. MCP warns about obvious source-only globs for production, but you must still inspect build output.

## cron and timezone

### cron expressions

```typescript
import { defineJob } from "vextjs";
export default defineJob({
  name: "daily-summary",
  cron: "0 9 * * *",
  timezone: "Asia/Shanghai",
  async handler({ scheduledAt, signal, logger }) {
    signal.throwIfAborted();
    logger.info({ scheduledAt }, "daily summary");
  },
});
```

| Format      | Field order                               | Example                                                                                 |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Five fields | minute, hour, day, month, weekday         | `0 9 * * *`: daily at 09:00                                                             |
| Six fields  | second, minute, hour, day, month, weekday | `0 */5 * * * *`: every five minutes at second zero; `*/30 * * * * *`: every half-minute |
| Weekdays    | Five fields, weekdays 1–5                 | `0 9 * * 1-5`: Monday to Friday at 09:00                                                |

Croner parses expressions; consult the installed Croner version for its extended syntax. Timezone precedence is **task > jobs.timezone > UTC**, requiring a valid IANA timezone. Asia/Shanghai 09:00 corresponds to UTC 01:00; convert ISO log times ending in Z accordingly.

DST creates missing or repeated local times, resolved by Croner. With the current dependency, `America/New_York`, `30 1 * * *`, and origin `2026-11-01T05:29:59Z`, the next point is `05:30Z`; the following point is next day `06:30Z`, not the repeated second 01:30 that day. Spring behavior also depends on the calculation origin: `30 2 * * *` from `2026-03-07T08:00Z` yields next day `07:30Z` (local 03:30), while from `2026-03-08T07:00Z` it yields next day `06:30Z`. Use UTC for stable absolute times, and verify boundary dates in your chosen region rather than assuming exactly one execution each calendar day.

### Schedule category and future points

Accept five/six/seven field Cron or @yearly/@annually/@monthly/@weekly/@daily/@midnight/@hourly. Reject interval, Date and ISO date strings. Fixed-year Cron may naturally terminate after its last point. Enabled Jobs need a strictly future point at both preparation and activation; disabled definitions still need valid syntax.

For a minute Cron, readiness at 12:00:20 waits for 12:01:00, while readiness exactly at 12:01:00 waits for 12:02:00. An armed 12:01 point delayed to 12:01:02 may execute before its successor; cross-period delay is skipped. Startup/restart/recovery selects future points, without replaying points passed during onReady.

## Calling Services and cooperative cancellation

This example reads remote status endpoints and updates a Service memory snapshot. The external API returns JSON {"status":"..."}; STATUS_ENDPOINTS contains comma-separated URLs. Use your project's data layer inside the Service if durable state is needed; no database API is added to Job definitions.

```typescript
// src/services/remote-status.ts
import type { VextApp } from "vextjs";
export default class RemoteStatusService {
  private latest = new Map<string, string>();
  constructor(private app: VextApp) {}
  async refresh(signal: AbortSignal) {
    const endpoints = (process.env.STATUS_ENDPOINTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!endpoints.length) throw new Error("Set STATUS_ENDPOINTS");
    for (const endpoint of endpoints) {
      signal.throwIfAborted();
      const response = await fetch(endpoint, { signal });
      if (!response.ok) throw new Error(`Status HTTP ${response.status}`);
      const result: unknown = await response.json();
      signal.throwIfAborted();
      if (
        !result ||
        typeof result !== "object" ||
        !("status" in result) ||
        typeof result.status !== "string"
      ) {
        throw new Error("Invalid status response");
      }
      this.latest.set(endpoint, result.status);
    }
    this.app.logger.info(
      { count: this.latest.size },
      "Remote statuses refreshed",
    );
    return this.latest.size;
  }
  snapshot() {
    return Object.fromEntries(this.latest);
  }
}
```

Run npm exec -- vext typegen as described in [Service type generation](/guide/services) to type app.services.remoteStatus, then add:

```typescript
// src/jobs/refresh-status.ts
import { defineJob } from "vextjs";
export default defineJob({
  name: "refresh-status",
  cron: "* * * * *",
  async handler({ app, signal, scheduledAt, logger }) {
    const count = await app.services.remoteStatus.refresh(signal);
    logger.info({ count, scheduledAt }, "Status refresh completed");
  },
});
```

Context exposes app/name/scheduledAt/signal/logger, without req/res or a current user. scheduledAt is the planned point rather than the actual start; return values do not create execution records. HTTP routes can reuse the Service while owning request/response handling.

**Checking signal only at entry does not cancel a long handler.** Check each batch/loop, pass it to supported network/stream I/O and check after asynchronous steps. Unsupported drivers need their native cancellation/timeouts or smaller batches. The framework cannot interrupt code ignoring signal. Use business unique keys or transactions for important side effects; scheduling deduplication is not business idempotency.

## Cluster and multiple replicas

| Deployment                                          | Jobs Redis                | Your responsibility                                                                                                     |
| --------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| One application process                             | Optional                  | Local overlap protection; use shared Redis to coordinate with other replicas                                            |
| Built-in application Cluster with active tasks      | Optional                  | Master IPC without Redis; Redis when configured; both require trusted handshake, matching manifests and activation ACKs |
| Built-in Cluster with no tasks/all disabled         | Not required              | No Jobs Redis connection; configuration structure must remain valid                                                     |
| PM2/independent processes/containers/multiple hosts | Configure explicitly      | Framework cannot detect external replicas; without Redis every process executes independently                           |
| Any deployment using Redis Cluster                  | Compatible Cluster client | Application Cluster and Redis Cluster are separate concepts; Redis sharding does not enable application coordination    |

Minimal environment configuration:

```typescript
import type { VextUserConfig } from "vextjs";
export default {
  cluster: { enabled: true, workers: 2 },
  jobs: { redis: {} },
} satisfies VextUserConfig;
```

Set VEXT_REDIS_URL=redis://127.0.0.1:6379 in the startup environment or configure redis.url. Environment URL alone does not enable coordination. Precedence: valid client > url > uri > VEXT_REDIS_URL > REDIS_URL. Explicit empty URL prevents nullish fallback. See the [configuration table](/api/jobs#vextjobsconfig).

### Automatic namespace

**Matching replicas do not need explicit namespaces.** The default logical prefix is:

```text
vext:<normalized package name>:<VEXT_CONFIG or default>:<NODE_ENV or production>:job:
```

Standard CLI sets profile and mode. Package my-app, profile production and mode production yield vext:my-app:production:production:job:. No PID, random value or deployment directory enters the automatic identity.

Replicas need the same Redis, package/profile/mode, task names and schedules, and synchronized clocks. Override namespace only for extra isolation, such as separate businesses using the same package identity. KeyPrefix overrides the complete logical prefix and takes precedence. Unreadable package names fall back to vextjs-app; separate applications sharing that fallback need explicit isolation. Jobs does not borrow cache/Session/rate-limit connections.

### Supplied client and Redis Cluster

Clients need ioredis-compatible `ping()` and `eval(script, keyCount, ...args)`. Jobs owns URL connections; callers own supplied clients' options, error events and close.

Configuration is frozen before plugins run: do not mutate `app.config.jobs` in `setup`. Construct a lazy client in static configuration without opening a connection, then have a plugin obtain the final instance and own cleanup. Bootstrap providers accept JSON-like patches and cannot return client instances.

```typescript
// src/config/default.ts
import { Redis } from "ioredis";
import type { VextUserConfig } from "vextjs";

const url = process.env.VEXT_REDIS_URL;
if (!url) throw new Error("Set VEXT_REDIS_URL");
const client = new Redis(url, { lazyConnect: true });
client.on("error", () => {
  /* Use application monitoring; omit credentials */
});
export default { jobs: { redis: { client } } } satisfies VextUserConfig;
```

```typescript
// src/plugins/jobs-redis.ts
import { definePlugin } from "vextjs";
import { Redis, Cluster } from "ioredis";

export default definePlugin({
  name: "jobs-redis",
  setup(app) {
    const client = app.config.jobs?.redis?.client;
    if (!(client instanceof Redis) && !(client instanceof Cluster)) {
      throw new Error("Configure a managed Jobs Redis client");
    }
    app.onClose(() => {
      client.disconnect();
    });
  },
});
```

For sharded Redis Cluster, keep this lifecycle and import Cluster in configuration, replacing the client creation:

```typescript
import { Cluster } from "ioredis";

const client = new Cluster(
  [
    { host: "redis-node-1", port: 6379 },
    { host: "redis-node-2", port: 6379 },
  ],
  {
    lazyConnect: true,
    redisOptions: {
      /* TLS/authentication */
    },
  },
);
```

See [plugins](/guide/plugins) for lifecycle details. Prefer URL when manual ownership is unnecessary. Do not add an ioredis keyPrefix that transforms Jobs EVAL keys again; use jobs.redis.namespace/keyPrefix for isolation.

Initialization probes PING and EVAL; runtime scripts also require TIME, GET, SET, EXISTS, PEXPIRE and DEL with appropriate key permissions. A successful startup probe does not validate every complex ACL/TLS/Sentinel/failover scenario; test your deployment. Both keys for a task share a Redis Cluster hash slot.

### Leases, markers and operations

Effective leaseTtl is task > global jobs.redis.leaseTtl > 30000ms, a safe integer >=1000, used only by Redis. Renewal is approximately TTL/3; per-operation budget is min(2000,TTL/3), with a conservative deadline measured before send using a monotonic clock. Late/failed renewal or expiry permanently quarantines all Worker admissions, requests cancellation and shutdown/replacement; reconnect cannot revive eligibility. Ordinary drain keeps Held leases renewing until settlement or the shared deadline. Unsettled handlers are not prematurely DEL-released. Redis TIME remains authoritative; rate-limited clock-skew diagnostics show RTT and an offset interval without adjusting clocks.

The logical prefix differs from the **actual keys**:

```text
{<sha256 of logical-prefix + NUL + job-name>}:<logical-prefix><encoded-job-name>:last
{<same hash>}:<logical-prefix><encoded-job-name>:running
```

Last stores only the most recently accepted point per task without TTL. Running is the expiring lease. Completion/crash does not delete last, preventing repeat claims for a quick task and catch-up after recovery. There is no built-in history store or cleanup command.

SCAN MATCH vext:...\* misses these keys because they start with {hash}:. Verify the namespace and use a pattern including the internal tag; Redis Cluster needs scans on each primary. Avoid production KEYS.

Retired last markers may remain. Clean exact old task keys through your operations process only after all old replicas/tasks have stopped; never delete live coordination state. Changing name/namespace/prefix creates another coordination identity, so mixed old/new deployments can both trigger. Keep definitions consistent during rollout. Deleting Redis state loses deduplication evidence and cannot preserve exactly-once side effects.

## Overlap, failure and shutdown

| Situation                                | Behavior                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Previous invocation still runs           | Skip this point without queuing; other tasks can run concurrently                                   |
| Handler throws                           | Log scheduled job failed; next future cycle continues without retry                                 |
| Event loop delay across periods/downtime | Missed points are skipped, without catch-up                                                         |
| Redis claim errors                       | Log failure, without local fallback; next future point can attempt coordination                     |
| Renewal failure, lateness or expiry      | Permanently quarantine every Worker admission, Abort and shut down/replace; reconnect cannot revive |
| Shutdown                                 | Stop triggers, request cancellation, wait within total shutdown.timeout, then clean dependencies    |

A crash after acceptance can lose an invocation. Network partitions, Redis state loss and handlers ignoring cancellation do not guarantee exactly-once business effects. Reliable delivery belongs in a separate queue module. Keep history/alerts/progress in your business storage or monitoring; return values are not persisted.

Task file changes cold-restart development workers after old timers close. Changes affecting already loaded task dependencies upgrade soft reload to cold restart and reload handlers; custom directories follow the same rule.

## Documentation and MCP

### Generate project Jobs documentation

Merge into your existing OpenAPI configuration:

```typescript
export default {
  jobs: { dir: "tasks", exclude: ["experiments/**"] },
  openapi: { docs: { code: { jobs: true } } },
};
```

True inherits jobs.dir/include/exclude, selecting src/tasks above. An independent Docs selection can configure {dir:"documented-tasks",include:["**/*.{ts,js}"],exclude:[]} in openapi.docs.code.jobs; explicit fields override individually and do not alter scheduling. False only disables this documentation source. Disabled definitions may appear.

```typescript
import { defineJob } from "vextjs";
/**
 * Refresh the remote status summary.
 *
 * For operations views; each endpoint updates only after a successful read.
 */
export default defineJob({
  name: "refresh-status",
  cron: "* * * * *",
  description: "Read remote statuses periodically",
  tags: ["operations"],
  docs: {
    summary: "Remote status sync",
    description: "Call the remoteStatus Service",
    tags: ["maintenance"],
  },
  async handler({ app, signal }) {
    await app.services.remoteStatus.refresh(signal);
  },
});
```

Summary: JSDoc > docs.summary > docs.description > description > generated fallback. Description: JSDoc > docs.description > description. Tags merge definition tags, docs.tags and jobs, deduplicated. Re-exports retain discovery file and actual definition location.

Open /docs and select Jobs. Details show name, Cron, declared/effective timezone, task/effective Redis TTL, expected coordination, switches, module shape, declaration cardinality and field states. Unknown stays unknown; inferred labels do not replace actual names. Static results always retain runtimeVerified:false.

Static consumers verify vextjs defineJob import/require provenance and aliases, read literal/proven immutable values, and resolve finite dependencies within declared roots. Dynamic fields and opaque spreads retain field-level unknown. Opaque default factories, extra SDK declaration positions and Job-valued named aliases are unsupported. Missing graphs, cycles, boundary/budget failures or unstable effective values retain module-shape unknown and reasons. No business modules are executed to fill gaps. Documentation coverage, runtime discovery and live execution are verified separately.

### Check with MCP

Call vext_project_inspect with section=jobs from the connected host, then vext_capability_check with capability=C34. Use vext_project_check profile=standard, configTarget=production for the production configuration, or all to compare development/production.

Results distinguish framework support, project declarations, missing evidence and prerequisites. Empty/disabled projects are not reported enabled. Built-in Cluster without Redis expects Master IPC, with the actual handshake/barrier unverified. Invalid definitions/timezones and duplicate names produce diagnostics. Module known/unsupported/unknown is separate from fieldStates. RuntimeVerified:false never proves startup, connectivity or handler execution; perform real host acceptance.

## Testing and acceptance

Ordinary createTestApp does not load/run src/jobs. Normal application startup under NODE_ENV=test also disables real Jobs timers. Provide explicit definitions and clock through the helper:

```typescript
import { defineJob } from "vextjs";
import { createTestJobScheduler } from "vextjs/testing";
let runs = 0;
const scheduler = await createTestJobScheduler({
  services: false,
  middlewares: false,
  now: new Date(0),
  jobs: {
    sample: defineJob({
      cron: "* * * * * *",
      handler() {
        runs++;
      },
    }),
  },
});
try {
  await scheduler.tick(new Date(1000));
  await scheduler.tick(new Date(1000));
  if (runs !== 1) throw new Error("Unexpected duplicate trigger");
} finally {
  await scheduler.close();
}
```

The helper uses real scheduling/overlap logic, without discovery or real timers. See the [testing API](/api/testing-api#createtestjobscheduler).

| Verification layer  | What to check                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit tick       | One invocation per point; no missed-period replay; future cycle after exception; overlapping long handler skips next tick                                 |
| Cancellation/close  | Hold a handler with a controlled Promise, verify signal and exit, no new execution after close, and dependencies remain until completion                  |
| Real startup        | NODE_ENV is not test; confirm readiness precedes execution using handler/framework observations rather than a fixed sleep alone                           |
| Source/output       | Run development and compiled production using project scripts; verify custom directories, globs and default/named exports                                 |
| Real Redis replicas | One acceptance per point across two processes, quick-task deduplication, lease renewal, shutdown and failure behavior; mocks do not provide this evidence |
| Native Node modules | Validate ESM/CJS default/named exports on your Node version; test transforms can have different namespaces                                                |

Run existing project tests and build, then a real isolated startup. Observe at least one future point with scheduled job completed and planned time, then ensure shutdown prevents new triggers. Replica checks share Redis and identity. Redis validates real server time: do not use new Date(1000) for real Redis acceptance.

## Troubleshooting

| Symptom                                       | Likely cause                                                                            | Action                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Definition/name startup error                 | Missing defineJob export, invalid schedule/timezone, duplicate including disabled names | Follow file/field errors; move helpers or use underscore filenames                                              |
| Cluster Jobs not active                       | Failed handshake, mismatched manifests or missing activation ACK                        | Verify the actual built-in Master startup/logs; independent replicas explicitly share Redis                     |
| Redis initialization fails                    | Empty target, connection/auth/PING/EVAL failure                                         | Check precedence and target, Lua command permissions; keep credentials out of logs                              |
| Application runs but no job                   | Disabled switches, future point not reached, NODE_ENV=test, selection mismatch          | Check effective profile, directory, glob and timezone                                                           |
| Development works but production has no tasks | TypeScript-only include or missing output files                                         | Inspect emitted directory; include output extensions; globs match actual files                                  |
| Every replica executes                        | Redis absent/different target or identity/schedule, state loss                          | Compare configuration/versions/clocks and mixed old/new identities                                              |
| Some periods skip                             | Long preceding run, event loop delay, Redis failure or clock skew                       | Compare scheduledAt, duration and skip/failure logs; adjust workload batches or period                          |
| Task continues after renewal failure          | Cancellation ignored/unsupported I/O                                                    | Check signal in loops and pass it to I/O or use driver-native cancellation                                      |
| Shutdown times out                            | Handler ignores cancellation or dependency waits                                        | Inspect close/I/O logs, respect total shutdown budget; no forced interruption                                   |
| Helper changes do not take effect             | Dependency not loaded/tracked or custom loading                                         | Verify cold-restart logs and actual dependency-change behavior; restart if needed                               |
| Custom directory missing from Docs            | Source disabled, explicit override or source limits                                     | Enable source and check inheritance/parse notes; list is not runtime state                                      |
| MCP partial/unknown name                      | Dynamic values, wrappers, mutable or out-of-root dependencies                           | Inspect missing evidence, simplify declarations or verify host startup; never execute handlers to fill metadata |

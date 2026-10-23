# Scheduled Jobs

Jobs runs Cron tasks with your application, such as cleaning expired data, producing reports or synchronizing business data. A Job owns the schedule and calls a Service for business work. Starting the application discovers Jobs and waits for future scheduled points.

Jobs is enabled by default. One application process and one built-in Cluster do not need Redis. Configure shared Jobs Redis when independent applications need a common coordination domain. Jobs provides no queue, automatic retry, downtime catch-up or immediate startup execution.

## Create your first task

Prerequisite: an existing VextJS application that starts successfully. Create:

```typescript
// src/jobs/heartbeat.ts
import { defineJob } from "vextjs";

export default defineJob({
  cron: "*/5 * * * * *",
  handler({ scheduledAt, logger }) {
    logger.info({ scheduledAt }, "Heartbeat job executed");
  },
});
```

Only `cron` and `handler` are required. No additional global Jobs configuration is needed.

1. Run your existing development command, for example `npm run dev`.
2. Wait for necessary initialization and check the discovered/enabled counts and coordination mode in Jobs logs.
3. Wait for the next five-second point, then look for `Heartbeat job executed` and the framework completion log.

This six-field expression includes seconds. Jobs never executes immediately at startup; `scheduledAt` is the planned time, while actual execution may start slightly later. HTTP listening does not prove Jobs activation or handler execution. For production, use your existing `npm run build` and `npm start`; discovery maps into the build output.

Development also runs Jobs. Use the [environment switch](#environment-switches-and-global-configuration) to prevent development machines from running real business tasks.

## Calling Services and cooperative cancellation

A handler can call ready `app.services` directly. These two files demonstrate Service integration without a database or external API:

```typescript
// src/services/order.ts
import type { VextApp } from "vextjs";

export default class OrderService {
  constructor(private app: VextApp) {}

  async cleanup(signal: AbortSignal) {
    signal.throwIfAborted();
    this.app.logger.info("Order cleanup service invoked");
  }
}
```

The demonstration Service **only logs a successful call; it does not delete orders**. Replace it with your existing `order.cleanup()` implementation in a real project. The Service owns database operations, transactions and business idempotency.

Run `npm exec -- vext typegen` as described in [Service type generation](/guide/services), so generated project types include `app.services.order`. Then create:

```typescript
// src/jobs/order/cleanup.ts
import { defineJob } from "vextjs";

export default defineJob({
  cron: "0 3 * * *",
  timezone: "Asia/Shanghai",
  async handler({ app, signal, scheduledAt, logger }) {
    await app.services.order.cleanup(signal);
    logger.info({ scheduledAt }, "Order cleanup invocation completed");
  },
});
```

It calls the Service at 03:00 Shanghai time. The first run still waits for a future point. To verify integration, temporarily use `*/5 * * * * *`, observe both business log messages, then restore the business schedule.

Checking `signal` once at entry only cancels work that has not started. Long handlers must keep checking between batches and asynchronous steps, and pass it to I/O that supports cancellation. For other drivers, use their native cancellation facilities. The framework cannot interrupt an uncooperative function or undo completed side effects.

## Complete Job configuration

<a id="job-options"></a>

| Field         | Type       | Required | Default                             | Purpose and when to configure                                                                  |
| ------------- | ---------- | -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `name`        | `string`   | No       | Derived from the relative task path | Stable identity; an explicit name avoids Redis identity changes when moving files              |
| `description` | `string`   | No       | Absent                              | Business purpose and documentation summary/description fallback                                |
| `tags`        | `string[]` | No       | Absent                              | Documentation classification/search, merged with docs.tags                                     |
| `docs`        | `object`   | No       | Absent                              | Documentation metadata below; no scheduling effect                                             |
| `enabled`     | `boolean`  | No       | `true`                              | Per-task switch; disabled modules are still imported and definitions/names validated           |
| `cron`        | `string`   | Yes      | None                                | Explicit five/six/seven-field expression or supported macro; no implicit schedule              |
| `timezone`    | `string`   | No       | jobs.timezone or UTC                | Task business timezone, as a valid IANA timezone                                               |
| `leaseTtl`    | `number`   | No       | jobs.redis.leaseTtl or `30000`      | Redis lease in milliseconds, a safe integer at least `1000`; unused but validated in Local/IPC |
| `handler`     | `function` | Yes      | None                                | Sync/async business entry; return value is not stored; errors are logged without retry         |

<a id="job-docs"></a>

| Field              | Type       | Default | Documentation purpose                                             |
| ------------------ | ---------- | ------- | ----------------------------------------------------------------- |
| `docs.summary`     | `string`   | Absent  | Summary fallback, below JSDoc summary                             |
| `docs.description` | `string`   | Absent  | Overrides top-level description, below JSDoc description          |
| `docs.tags`        | `string[]` | Absent  | Merged and deduplicated with top-level tags and the jobs category |

This complete definition **replaces the task file above**; do not append a second Job to that file. It requires the registered `order` Service:

```typescript
// src/jobs/order/cleanup.ts
import { defineJob } from "vextjs";

export default defineJob({
  name: "order.cleanup",
  description: "Clean up expired orders",
  tags: ["orders"],
  docs: {
    summary: "Scheduled order cleanup",
    description: "Call the order Service cleanup operation",
    tags: ["maintenance"],
  },
  enabled: true,
  cron: "0 3 * * *",
  timezone: "Asia/Shanghai",
  leaseTtl: 60_000,
  async handler({ app, signal }) {
    await app.services.order.cleanup(signal);
  },
});
```

`leaseTtl` is not a handler timeout. Redis renews the lease during execution, so a task may run longer than its TTL. A task override replaces the global Redis default; set one only when its lease policy needs to differ.

### Handler context

<a id="job-context"></a>

| Field         | Meaning and use                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `app`         | Ready application, Services and plugin extensions; no HTTP req/res or current user                        |
| `name`        | Effective loaded task name, useful for logs or business identity                                          |
| `scheduledAt` | Planned point as a Date, not actual start time; useful for delay monitoring or a business idempotency key |
| `signal`      | Requests cooperative cancellation on shutdown or coordination loss; long handlers keep checking           |
| `logger`      | Application logger; the framework also records task status and duration                                   |

## cron and timezone

### cron expressions

| Format       | Field order                                     | Example and meaning                                                               |
| ------------ | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Five fields  | Minute, hour, day, month, weekday               | `0 3 * * *`: daily at 03:00; `*/5 * * * *`: every five minutes                    |
| Every minute | Five fields                                     | `* * * * *`: second 0 of every minute                                             |
| Six fields   | Second, minute, hour, day, month, weekday       | `*/5 * * * * *`: every five seconds; `0 */5 * * * *`: second 0 every five minutes |
| Seven fields | Second, minute, hour, day, month, weekday, year | `0 0 9 1 1 * 2027`: 09:00 on January 1, 2027                                      |
| Weekdays     | Five fields, weekday 1–5                        | `0 9 * * 1-5`: Monday–Friday at 09:00                                             |

Supported macros: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`. `@daily` means midnight in the effective timezone. The installed Croner parses calendar extensions such as `0 0 L * *` (last day of the month), `0 0 1W * *` (weekday nearest the first), and `0 9 * * MON#2` (second Monday). Weekday expressions are not a public-holiday calendar.

**Day-of-month and weekday use OR by default.** `0 0 1 * MON` matches the first of the month or Monday; `0 0 1 * +MON` uses explicit `+` for AND. From January 2, 2026 in UTC, their next points are January 5 and June 1 respectively.

Timezone precedence is **Job.timezone > jobs.timezone > UTC**. Shanghai 09:00 corresponds to UTC 01:00; `Z` in an ISO log timestamp means UTC.

DST can remove or repeat a local time; the installed Croner determines the actual plan. With the current dependency, New York `30 1 * * *` from `2026-11-01T05:29:59Z` returns `05:30Z`, then `06:30Z` the next day, without a second 01:30 that day. For the spring gap, `30 2 * * *` from `2026-03-07T08:00Z` returns `07:30Z` the next day (03:30 local), while a starting point of `2026-03-08T07:00Z` returns `06:30Z` the next day. Test the region, calculation start and boundary date for DST-sensitive business rules; choose UTC when you need fixed absolute time.

### Schedule category and future points

Only Cron strings are accepted. Reject interval, Date and one-off ISO dates; there is no millisecond fixed-delay schedule. Enabled tasks need a strictly future point both when prepared and activated. A finite-year schedule stops naturally after its final point. Disabled tasks still need valid Cron syntax, but not a future point.

A minute task ready at 12:00:20 waits for 12:01:00; one ready exactly at 12:01:00 waits for 12:02:00. An already armed 12:01 point delivered at 12:01:02 may run within its window; crossing the next period skips it. Startup, restart, recovery and time spent in onReady never replay historical points.

## Discovery, exports and names

Your task directory only needs real task files, for example:

```text
src/jobs/
├── heartbeat.ts          → heartbeat
└── order/
    ├── cleanup.ts        → order.cleanup
    └── daily-summary.ts  → order.daily-summary
```

Discovery recursively selects `.ts/.js/.mjs/.cjs/.mts/.cts`. Each selected file contains exactly one default `defineJob()`. Ordinary helpers, types and constants may coexist; business support modules normally live outside the task directory.

Ignore rules are separate: underscore-prefixed **filenames**, declaration files and `.test/.spec` modules are excluded. Underscore directories themselves are allowed. `.tsx/.jsx` are not included by default.

Explicit `name` wins; otherwise remove the relative task path extension and trailing `/index`, and replace path separators with dots. Root `index.ts` becomes `index`; `order/index.ts` becomes `order`. Kebab-case is not converted to camelCase. Names must be nonempty ASCII letters/digits or `_ . : -` and globally unique; disabled definitions also participate in duplicate checks.

<a id="allowed-and-rejected-declaration-examples"></a>

Multiple named Jobs cannot register tasks from one file. Arrays and opaque default factories are unsupported; ordinary helper exports remain legal. JavaScript/ESM uses the same default export. CommonJS uses:

```javascript
// src/jobs/heartbeat.cjs — CommonJS alternative; do not keep beside the TS file above
const { defineJob } = require("vextjs");
module.exports = defineJob({
  cron: "*/5 * * * * *",
  handler({ logger }) {
    logger.info("Heartbeat job executed");
  },
});
```

Finite relative default re-exports, aliases and precise declaration constraints are covered in the [API definition rules](/api/jobs#definition-rules). Put business work inside the handler, without top-level business calls or privately created timers.

### Custom directory and filters

Merge this fragment into your existing `src/config/default.ts`:

```typescript
export default {
  jobs: {
    dir: "tasks",
    include: ["**/*.{ts,js,mjs,cjs,mts,cts}"],
    exclude: ["experiments/**"],
  },
};
```

`dir` is relative to `src`, so this selects `src/tasks/**` and the corresponding `tasks` folder under the compiled root. Do not use `src/tasks`, absolute paths or `..`. `include` **replaces** the default; `exclude` **adds** to built-in ignores. Globs match actual filenames and do not rewrite `**/*.ts` to production `.js`. Include both source/output extensions when needed. `include: []` discovers nothing.

## Environment switches and global configuration

<a id="jobs-options"></a>

| Field           | Type       | Default                            | Purpose                                                                       |
| --------------- | ---------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| `jobs.enabled`  | `boolean`  | `true`                             | Disable all discovery and scheduling; configuration structure still validates |
| `jobs.dir`      | `string`   | `"jobs"`                           | Recursive task directory relative to src; cannot escape the project boundary  |
| `jobs.include`  | `string[]` | `["**/*.{ts,js,mjs,cjs,mts,cts}"]` | Replace include globs; account for emitted extensions; [] selects nothing     |
| `jobs.exclude`  | `string[]` | `[]`                               | Additional excludes; cannot re-enable built-in ignored files                  |
| `jobs.timezone` | `string`   | `"UTC"`                            | Valid shared IANA timezone, overridden per task                               |
| `jobs.redis`    | `object`   | Absent                             | Explicit shared Redis coordination; otherwise deployment selects Local/IPC    |

A full **configuration fragment** can look like this; merge into existing config and normally set only values that differ from defaults:

```typescript
// src/config/default.ts
export default {
  jobs: {
    enabled: true,
    dir: "jobs",
    include: ["**/*.{ts,js,mjs,cjs,mts,cts}"],
    exclude: ["experiments/**"],
    timezone: "Asia/Shanghai",
  },
};
```

Disable all development tasks:

```typescript
// src/config/development.ts
export default { jobs: { enabled: false } };
```

Disable one task with its own `enabled: false`. Global disable skips discovery and imports; per-task disable still imports the module and validates definitions, TTL and names. Neither bypasses configuration validation. The normal [profile merge rules](/guide/configuration) apply; a development override does not automatically disable production tasks.

## Cluster and multiple replicas

| Deployment                                                   | Minimum configuration                                                   | Coordination scope                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| One application process                                      | No Redis                                                                | Current process, skipping same-name overlap             |
| One built-in Cluster                                         | Configure cluster only                                                  | Workers managed by the current Master, using Master IPC |
| Independent processes, PM2 applications, containers or hosts | Explicit Jobs Redis in every replica when shared coordination is needed | Same Redis target, effective prefix and task identity   |

For example, one built-in Cluster with four Workers:

```typescript
// src/config/production.ts — merge into existing configuration
export default {
  cluster: { enabled: true, workers: 4 },
  jobs: { timezone: "Asia/Shanghai" },
};
```

No Redis, Worker ID or internal IPC settings are required. After necessary initialization, Master checks the actual ready-set manifests and activates Jobs in each Worker. Only an activated Worker may schedule tasks. Master reports overall readiness after valid activation acknowledgements arrive; one activated Worker may register timers earlier. Resolve startup/manifest errors rather than treating Workers as independent Local schedulers.

### Independent replicas sharing Redis

Multiple containers each running a built-in Cluster still count as independent applications. Merge the following into each replica when they need shared coordination:

```typescript
// src/config/production.ts
export default {
  jobs: {
    redis: { url: process.env.VEXT_REDIS_URL },
  },
};
```

Set `VEXT_REDIS_URL` in every startup environment to the same real shared service, for example `redis://redis.internal:6379/0`. Replace the illustrative `redis.internal` hostname. Loopback `127.0.0.1` is for testing on one machine, not sharing Redis across hosts. An environment URL alone does not activate coordination; `jobs.redis` must exist. With an environment URL, this is sufficient:

```typescript
export default { jobs: { redis: {} } };
```

<a id="redis-options"></a>

| Field                  | Type                      | Default/precedence                             | Purpose and scope                                                                   |
| ---------------------- | ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `jobs.redis.client`    | ioredis-compatible object | Absent; ahead of addresses                     | Borrow a caller-managed client; caller owns connection options, errors and shutdown |
| `jobs.redis.url`       | `string`                  | Absent; ahead of uri/environment               | Common URL configuration; Jobs owns and closes its connection                       |
| `jobs.redis.uri`       | `string`                  | Absent; below url                              | URL alias; normally choose one                                                      |
| `jobs.redis.namespace` | `string`                  | Project package name, profile and runtime mode | Usually omit for replicas of one app; set for deliberate business isolation         |
| `jobs.redis.keyPrefix` | `string`                  | Derived from namespace                         | Full logical-prefix override, ahead of namespace; usually unnecessary               |
| `jobs.redis.leaseTtl`  | `number`                  | `30000` milliseconds                           | Default Redis running lease, overridden per task; safe integer at least `1000`      |

Connection precedence is **client > url > uri > VEXT_REDIS_URL > REDIS_URL**. Invalid clients do not fall back to a URL. An explicitly empty url does not fall through to the environment. With active tasks, a missing usable Redis target or failed initialization rejects startup.

<a id="automatic-namespace"></a>

The default namespace combines package name, `VEXT_CONFIG` (default `default`) and `NODE_ENV` (default `production`); the standard CLI supplies profile/runtime mode. The default logical prefix is `vext:<namespace>:job:`. Ordinary replicas do not need to repeat these settings. Different package names, profiles or modes are isolated by default. To intentionally coordinate tasks across different projects, explicitly share a namespace:

```typescript
// Both apps need the same real Redis address and stable task name/definition
export default {
  jobs: {
    redis: {
      url: process.env.VEXT_REDIS_URL,
      namespace: "billing-production",
      leaseTtl: 30_000,
    },
  },
};
```

Replicas in one domain must share Redis target, effective prefix, task name, Cron, effective timezone and TTL. Moving files or changing a name/namespace/keyPrefix changes identity, so mixed deployments can run both versions. Jobs does not borrow cache, Session or rate-limit Redis configuration.

<a id="supplied-client-and-redis-cluster"></a>
<a id="leases-markers-and-operations"></a>

Supplied clients, Redis Cluster, ACLs and retired coordination keys are covered in [advanced deployment](/guide/deployment#jobs-with-a-supplied-client-or-redis-cluster).

### Per-task lease overrides

Effective lease precedence is **Job.leaseTtl > jobs.redis.leaseTtl > 30000 ms**. Set `leaseTtl: 60_000` in an existing definition to override the 30-second global example; other tasks keep inheriting it. Changing TTL does not require a new task name or prefix.

Execution renews the lease, so long tasks need not set TTL to their total duration. Local/IPC does not use Redis TTL but still validates it. TTL cannot force-stop a handler. `shutdown.timeout` is in **seconds**, shared across the whole application's shutdown, not a separate timeout for each Job.

## Overlap, failure and shutdown

| Situation                                | Framework behavior and business action                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Previous same-name task is still running | Skip this point without queuing; other tasks may run concurrently                                                               |
| Handler throws                           | Log failure; later future periods continue without retry                                                                        |
| Cross-period delay or downtime           | Skip old points, without catch-up                                                                                               |
| Redis claim fails                        | Skip the point without fallback; healthy instances that have not lost a lease may try future points                             |
| Renewal fails, arrives late or expires   | Quarantine all new admissions in that Worker, request cancellation and shut down/replace; reconnect cannot restore eligibility  |
| Application shutdown                     | Stop triggers/admissions, request cancellation, wait within one shared budget, then clean coordinator and business dependencies |
| Built-in Master channel disconnects      | Stop new tasks, request cancellation and close; no Local fallback                                                               |

In a healthy coordination domain, a same-name task receives at most one execution qualification per scheduled point. A crash after acceptance can lose work. Quick completion or lease expiry does not make a consumed point reclaimable. IPC state does not persist across a new Master. Network partitions, lost Redis state and handlers ignoring cancellation cannot promise exactly-once side effects. Use business unique keys/transactions for idempotency; reliable delivery, history and progress belong in business storage or a separate queue.

With enabled Jobs, necessary onReady failure rejects and cleans up startup so tasks cannot use unready dependencies. With no active Jobs, existing logged isolation remains. Observational app:ready callbacks are not necessary initialization. Development changes to task files or already loaded dependencies cold-restart the application after the old scheduler closes, including custom directories.

## Documentation and MCP

<a id="generate-project-jobs-documentation"></a>

When project Docs is enabled, open the Jobs group at `/docs`. The Jobs source is enabled by default; do not add `openapi.docs.code.jobs: true` as a mandatory step. Selection inherits `jobs.dir/include/exclude` individually.

To disable only Jobs documentation, merge:

```typescript
export default {
  openapi: { docs: { code: { jobs: false } } },
};
```

Optionally override the documentation directory without changing actual task discovery or execution eligibility:

```typescript
export default {
  openapi: {
    docs: { code: { jobs: { dir: "documented-jobs" } } },
  },
};
```

Only documentation `dir` changes; include/exclude still inherit individually. Disabled definitions may appear. Dynamic unknown values remain unknown; static entries never prove startup, connectivity or execution (`runtimeVerified: false`).

Summary precedence is JSDoc summary, docs.summary, docs.description, description, generated fallback. Description uses JSDoc description, docs.description, description. Tags merge definition tags, docs.tags and jobs.

<a id="check-with-mcp"></a>

MCP checks and Recipes provide static evidence, require an explicit Cron when generating a task, and never run handlers or start timers. Full source fields are in the [API](/api/jobs#documentation-source).

## Testing and acceptance

Use a controlled clock to test scheduling instead of waiting for real time:

```typescript
import assert from "node:assert/strict";
import { defineJob } from "vextjs";
import { createTestJobScheduler } from "vextjs/testing";

let executions = 0;
const scheduler = await createTestJobScheduler({
  now: new Date("2026-01-01T00:00:00Z"),
  jobs: {
    heartbeat: defineJob({
      cron: "* * * * * *",
      handler() {
        executions += 1;
      },
    }),
  },
});
try {
  await scheduler.tick(new Date("2026-01-01T00:00:01Z"));
  assert.equal(executions, 1);
} finally {
  await scheduler.close();
}
```

The helper takes explicit definitions and an initial clock, runs only through tick(), and creates no discovery or real timers. Ordinary createTestApp does not load Jobs either. See the [testing API](/api/testing-api#createtestjobscheduler).

Then verify at least one future point through real application startup. Built-in IPC requires real Master/Worker tests; independent replicas require real shared Redis tests. The helper cannot replace either. Use real scheduled time with real Redis, rather than a controlled 1970 timestamp.

Startup logs include discovered/enabled/disabled counts and mode. Execution logs include name, scheduledAt, PID/Worker, startedAt, duration, status and skipReason. nextRunAt is only the next calculated point, never a promise of successful execution. Redis clock-skew diagnostics report RTT and an offset interval without adjusting system clocks; keep replica clocks synchronized.

## Troubleshooting

| Symptom                                        | Checks and action                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| No tasks discovered                            | Check jobs.enabled, the src-relative directory, include/exclude and actual emitted extensions                                |
| Tasks found but not running                    | Check per-task switch, Cron/timezone, next future point, necessary initialization and activation errors                      |
| One built-in Cluster appears to need Redis     | Jobs does not require it; check explicit jobs.redis or whether there are independent applications                            |
| Independent replicas execute duplicates        | Check shared Redis/effective prefix, stable task names, profile/mode and mixed old definitions                               |
| Long task misses some points                   | Same-name overlap skips points; TTL renews and is not a handler deadline                                                     |
| Worker remains ineligible after Redis recovery | A Worker that lost a lease needs shutdown/replacement or restart; reconnection alone cannot revive it                        |
| Static Docs/MCP reports unknown                | Use a recognizable default definition and check dependencies/dynamic fields; unknown proves neither live failure nor success |
| Changes still use old task logic               | Check completion of development cold restart; rebuild and replace production processes                                       |

Continue with the [API](/api/jobs), [execution contract](/specification/jobs), [deployment](/guide/deployment) and [testing](/guide/testing#testing-jobs).

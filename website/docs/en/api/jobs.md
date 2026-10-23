# Scheduled Jobs API

This page is the reference for public signatures, validation and errors. The [Jobs guide](/guide/jobs) covers configuration, development, deployment and troubleshooting; the [contract](/specification/jobs) defines execution guarantees.

## defineJob

Import the functions and types you need from the public package entry:

```typescript
import { defineJob, isVextJobDefinition } from "vextjs";
import type {
  VextApp,
  VextJobDefinition,
  VextJobDefinitionInput,
  VextJobHandler,
  VextJobContext,
  VextJobDocsConfig,
  VextJobsConfig,
} from "vextjs";
```

These are signature references, not declarations to copy into a task file:

```typescript reference
declare function defineJob(input: VextJobDefinitionInput): VextJobDefinition;
declare function isVextJobDefinition(
  value: unknown,
): value is VextJobDefinition;

type VextJobDefinitionInput = {
  name?: string;
  description?: string;
  tags?: string[];
  docs?: VextJobDocsConfig;
  enabled?: boolean;
  cron: string;
  timezone?: string;
  leaseTtl?: number;
  handler: VextJobHandler;
};
type VextJobHandler = (ctx: VextJobContext) => unknown | Promise<unknown>;
interface VextJobContext {
  app: VextApp;
  name: string;
  scheduledAt: Date;
  signal: AbortSignal;
  logger: VextApp["logger"];
}
interface VextJobDocsConfig {
  summary?: string;
  description?: string;
  tags?: string[];
}
```

<a id="job-options"></a>

| Field         | Type                | Required | Default                                            | Validation and result                                                                                                       |
| ------------- | ------------------- | -------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`            | No       | Derived from the default task's relative file path | Nonempty ASCII letters/digits or `_ . : -`; loaded names are unique, including disabled definitions                         |
| `description` | `string`            | No       | Absent                                             | Business description and documentation fallback; no scheduling effect                                                       |
| `tags`        | `string[]`          | No       | Absent                                             | Documentation tags, each a string                                                                                           |
| `docs`        | `VextJobDocsConfig` | No       | Absent                                             | Metadata object, not null/array; see [documentation source](#documentation-source)                                          |
| `enabled`     | `boolean`           | No       | `true`                                             | false disables scheduling, while import, definition and name checks remain                                                  |
| `cron`        | `string`            | Yes      | None                                               | Valid nonempty five/six/seven-field Cron or supported macro; reject Date, ISO dates and interval                            |
| `timezone`    | `string`            | No       | jobs.timezone or UTC                               | Nonempty valid IANA timezone; Job.timezone > jobs.timezone > UTC                                                            |
| `leaseTtl`    | `number`            | No       | jobs.redis.leaseTtl or `30000`                     | Safe integer milliseconds at least `1000`; Job.leaseTtl > jobs.redis.leaseTtl > 30000 ms; unused but validated in Local/IPC |
| `handler`     | `VextJobHandler`    | Yes      | None                                               | Function returning any value or Promise; no result storage or automatic retry                                               |

`defineJob()` synchronously validates and returns a framework-marked definition, freezing its top-level object; nested docs/tags are not deeply frozen. Unknown top-level fields and invalid explicit values do not use defaults. `isVextJobDefinition()` recognizes a definition's type; it does not prove valid module declarations, successful loading, readiness or execution.

### Handler context

<a id="job-context"></a>

| Field         | Type                | Contract                                                                                                                        |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `app`         | `VextApp`           | Ready application, Services and plugins; no HTTP request, response or current user                                              |
| `name`        | `string`            | Effective loaded name                                                                                                           |
| `scheduledAt` | `Date`              | Planned point rather than actual start, useful for business idempotency/delay monitoring                                        |
| `signal`      | `AbortSignal`       | Requests cooperative cancellation on shutdown or coordination loss; business work keeps checking and passes it to supported I/O |
| `logger`      | `VextApp["logger"]` | Application logger; framework logs separately include planned/actual times, status and duration                                 |

## Definition rules

Default discovery recursively selects `.ts/.js/.mjs/.cjs/.mts/.cts` in src/jobs. Each selected file contains one finite default SDK Job; CommonJS uses equivalent module.exports. Ordinary helpers, types and constants are allowed. Named Jobs are not an additional registration entry.

Recognizable default aliases, dynamic fields and finite relative default re-exports within project source boundaries are supported; both entry and definition must satisfy the rules. Factories/conditional defaults, arrays, named-only Jobs, additional SDK declarations (including unused positions), Job-valued named aliases, user getters/Proxies and later export mutation are unsupported. This finite authoring grammar is not a whole-program side-effect sandbox. Do not run business work or create independent timers at module top level.

Explicit name wins; otherwise remove the relative path extension and trailing /index, then join with dots without changing camelCase. Disabled definitions participate in duplicate checks. Global disable skips discovery; per-task disable still validates fields, declaration count, TTL and names, only exempting scheduling and future-point requirements.

Build validation precedes optimization; production may contain only valid build output and need not deploy src for Jobs. See [discovery examples](/guide/jobs#discovery-exports-and-names).

## VextJobsConfig

Configure jobs in existing `src/config/default.ts` or the selected profile, using normal [configuration merge order](/guide/configuration). All fields are optional:

<a id="jobs-options"></a>

| Field           | Type       | Default                            | Constraints                                                                                                                         |
| --------------- | ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `jobs.enabled`  | `boolean`  | `true`                             | false skips discovery/scheduling, but configuration structure still validates                                                       |
| `jobs.dir`      | `string`   | `"jobs"`                           | Project directory relative to src; no absolute path, .. or escape; maps into the compiled root, such as dist/jobs                   |
| `jobs.include`  | `string[]` | `["**/*.{ts,js,mjs,cjs,mts,cts}"]` | Replaces include; matches actual files; [] selects nothing, without emitted-extension rewriting                                     |
| `jobs.exclude`  | `string[]` | `[]`                               | Additional ignores; cannot re-enable underscore filenames, declarations or test/spec modules; underscore directories remain allowed |
| `jobs.timezone` | `string`   | `"UTC"`                            | Valid IANA timezone, overridden per task                                                                                            |
| `jobs.redis`    | `object`   | Absent                             | Object explicitly enables Redis coordination; no Jobs connection with no enabled tasks                                              |

Unknown fields are rejected. Directory/array structure remains valid even with global disable; import differences between global and per-task switches are described above.

## Redis configuration

One process or one built-in Cluster needs no Redis. Configure jobs.redis when independent applications need shared coordination; an environment URL without this object does not enable it.

<a id="redis-options"></a>

| Field                  | Type                                  | Default/precedence                            | Constraints and ownership                                                                                       |
| ---------------------- | ------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `jobs.redis.client`    | `unknown` (ioredis-compatible object) | Absent; ahead of addresses                    | Compatible ping/eval; caller owns connection options, errors and shutdown; Jobs does not close borrowed clients |
| `jobs.redis.url`       | `string`                              | Absent; ahead of uri/environment              | Jobs owns the connection; an explicit empty URL does not fall through                                           |
| `jobs.redis.uri`       | `string`                              | Absent; below url                             | URL alias; normally set only one                                                                                |
| `jobs.redis.namespace` | `string`                              | Automatic package/profile/runtime combination | Usually omit for replicas in one domain; explicit values are normalized for isolation                           |
| `jobs.redis.keyPrefix` | `string`                              | Derived from namespace                        | Nonempty full logical-prefix override; trim and append a colon; whitespace means no override                    |
| `jobs.redis.leaseTtl`  | `number`                              | `30000` milliseconds                          | Safe integer at least `1000`, overridden by Job.leaseTtl; not a handler timeout                                 |

Connection precedence is **client > url > uri > VEXT_REDIS_URL > REDIS_URL**. Invalid clients, including null, never fall back to a URL. Undefined addresses allow fallback; explicit empty url does not. Active tasks require usable connectivity and initialization script capabilities; failure rejects startup. No enabled tasks means no unnecessary connection/probe, while configuration structure and TTL still validate.

The default namespace uses package name, VEXT_CONFIG (default default) and NODE_ENV (default production); an unreadable package name falls back to vextjs-app. The logical prefix is `vext:<namespace>:job:`. Namespace normalization removes leading @, converts path separators to dots, replaces unsupported characters with hyphens, collapses repeated separators and trims edge separators. For example, `@team/my-app:production:production` becomes `team.my-app:production:production`. An empty normalized namespace uses vextjs-app. Whitespace-only keyPrefix leaves an explicit or automatic namespace in effect.

A shared domain requires matching Redis target, effective prefix, task name and definition. Name/prefix changes create a different identity; TTL does not form identity. Jobs does not borrow cache, Session or rate-limit Redis configuration. Each task renews with its effective TTL, which must match across replicas. shutdown.timeout is in seconds and shares one application-wide shutdown budget.

## Documentation source

<a id="job-docs"></a>

| Field              | Type       | Default | Presentation                                                                         |
| ------------------ | ---------- | ------- | ------------------------------------------------------------------------------------ |
| `docs.summary`     | `string`   | Absent  | Summary: JSDoc, then docs.summary, docs.description, description, generated fallback |
| `docs.description` | `string`   | Absent  | Description: JSDoc, then docs.description, top-level description                     |
| `docs.tags`        | `string[]` | Absent  | Merged/deduplicated with top-level tags and jobs                                     |

### Project documentation selection

These settings affect static documentation only, not runtime discovery, eligibility or scheduling:

| Field                            | Type                         | Default                               | Purpose                                                           |
| -------------------------------- | ---------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `openapi.docs.code.jobs`         | boolean or object            | true                                  | Subject to overall Docs settings; false disables only this source |
| `openapi.docs.code.jobs.enabled` | boolean                      | true                                  | Source switch in object form                                      |
| `openapi.docs.code.jobs.dir`     | string                       | Inherit jobs.dir                      | Override only documentation directory                             |
| `openapi.docs.code.jobs.include` | string[]                     | Inherit jobs.include or default rules | Override only documentation include; [] selects nothing           |
| `openapi.docs.code.jobs.exclude` | string[]                     | Inherit jobs.exclude or []            | Override only documentation excludes; built-in ignores remain     |
| `openapi.docs.code.jobs.title`   | string (generic source type) | Unused by Jobs                        | Do not depend on it to rename the Jobs group or task titles       |

Fields inherit/override **individually**. openapi.docs.code.enabled:false disables overall code documentation without stopping tasks. Disabled definitions may appear. Unknown/partial evidence stays unresolved; runtimeVerified:false proves neither startup nor execution. See [default viewing and optional overrides](/guide/jobs#documentation-and-mcp).

## Errors and execution boundaries

| Trigger                                                        | Error/observable result and action                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid defineJob field, Cron, timezone or handler             | Synchronous VextJobDefinitionError; fix the field even for disabled definitions                                                                    |
| Duplicate loaded name                                          | VextJobDuplicateNameError, including disabled definitions; fix explicit/derived names                                                              |
| Unsupported declaration or enabled task without a future point | Refuse preparation/activation; fix the file, schedule or definition form                                                                           |
| Necessary onReady fails                                        | With enabled Jobs, reject and clean up startup; otherwise retain logged isolation; observational app:ready notifications remain separate           |
| Built-in Worker not activated or manifests conflict            | Unactivated Workers do not run; initial mismatch blocks activation, candidate mismatch rejects replacement and keeps the old Worker                |
| Redis initialization unavailable                               | Refuse startup without Local fallback                                                                                                              |
| Handler error, overlap or expired window                       | Log errors; skip overlaps/old points without retry, queue or catch-up                                                                              |
| Redis lease lost                                               | Close all new Worker admissions, Abort in-flight work and shut down/replace; reconnect does not restore eligibility                                |
| Shutdown                                                       | Stop new tasks, request cancellation, wait within one shared deadline, then clean coordinator/dependencies; cannot forcibly interrupt arbitrary JS |

Scheduling deduplication does not guarantee exactly-once business side effects. Partitions, state loss and ignored cancellation still require business idempotency; see the [contract](/specification/jobs).

## Testing entry point

Import createTestJobScheduler, CreateTestJobSchedulerOptions and TestJobScheduler from vextjs/testing. It takes explicit definitions and a controlled clock without discovery or real timers. Ordinary createTestApp does not load Jobs. See the [testing API](/api/testing-api#createtestjobscheduler) and [guide](/guide/jobs#testing-and-acceptance).

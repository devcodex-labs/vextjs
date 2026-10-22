# Scheduled Jobs API

Jobs schedule exported definitions automatically after application readiness. See the [Jobs guide](/guide/jobs) for setup, deployment and troubleshooting, and the [contract](/specification/jobs) for behavior rules. This page is the complete field reference.

## defineJob

```typescript
import { defineJob, isVextJobDefinition } from "vextjs";
import type {
  VextJobDefinition,
  VextJobDefinitionInput,
  VextJobHandler,
  VextJobContext,
  VextJobDocsConfig,
  VextJobsConfig,
} from "vextjs";

function defineJob(input: VextJobDefinitionInput): VextJobDefinition;
function isVextJobDefinition(value: unknown): value is VextJobDefinition;

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

| Definition field   | Type / default                          | Constraints and purpose                                                                                                                                         |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | `string` / derived from file and export | Nonempty ASCII letters, digits and `_ . : -`; loaded names must be unique, including disabled definitions. Prefer a stable explicit name for Redis coordination |
| `description`      | `string` / absent                       | Business description; fallback for Docs description/summary, without scheduling effects                                                                         |
| `tags`             | `string[]` / absent                     | Search tags; merged and deduplicated with `docs.tags` and `jobs`                                                                                                |
| `docs`             | `VextJobDocsConfig` / absent            | Documentation metadata object; no scheduling effects                                                                                                            |
| `docs.summary`     | `string` / absent                       | Summary fallback; JSDoc summary takes precedence                                                                                                                |
| `docs.description` | `string` / absent                       | Overrides definition `description`; JSDoc description still takes precedence                                                                                    |
| `docs.tags`        | `string[]` / absent                     | Merged with definition tags                                                                                                                                     |
| `enabled`          | `boolean` / `true`                      | Disabled tasks are not scheduled, but their modules are imported, definitions validated and names checked for duplicates                                        |
| `cron`             | `string` / required                     | Nonempty five/six/seven field Cron expression or supported macro, validated by Croner; Date, ISO date strings and interval are rejected                         |
| `leaseTtl`         | `number` / global Redis TTL or `30000`  | Safe integer milliseconds >=1000; affects only the Redis running lease, never task identity or planned points; inactive in Local/IPC                            |
| `timezone`         | `string` / global timezone or UTC       | Only valid with cron; nonempty valid IANA timezone, overriding `jobs.timezone`                                                                                  |
| `handler`          | `VextJobHandler` / required             | Sync or async function; return values are not stored, exceptions are logged without automatic retry                                                             |

Omitted optional fields can use defaults; invalid explicit values cannot. A disabled definition still requires a valid schedule and handler. Unknown top-level fields are rejected. `defineJob()` validates and freezes the top-level object, adding an internal recognition marker; plain objects do not substitute for definitions. Nested docs/tags are not deeply frozen.

### Handler context

| Field         | Meaning                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `app`         | Ready application, plugin extensions and services; not an HTTP request context                                              |
| `name`        | Effective loaded job name                                                                                                   |
| `scheduledAt` | Planned point as a Date, not actual start time; useful for business idempotency or delay monitoring                         |
| `signal`      | Cooperative cancellation on shutdown or Redis lease renewal failure; check throughout the handler and pass to supported I/O |
| `logger`      | Application logger; framework execution logs separately include job name, scheduled point and duration                      |

## VextJobsConfig

Configure `jobs` in `src/config/default.ts` or the selected profile. Application startup validates configuration; discovery and Redis initialization occur before HTTP listening. Normal [configuration merge order](/guide/configuration) applies.

```typescript
interface VextJobsConfig {
  enabled?: boolean;
  dir?: string;
  include?: string[];
  exclude?: string[];
  timezone?: string;
  redis?: {
    url?: string;
    uri?: string;
    client?: unknown;
    namespace?: string;
    keyPrefix?: string;
    leaseTtl?: number;
  };
}
```

| Configuration field | Type / default                                  | Scope, precedence and constraints                                                                                                                                                                             |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobs.enabled`      | `boolean` / `true`                              | Global disable skips discovery and scheduling, but does not bypass application configuration validation                                                                                                       |
| `jobs.dir`          | `string` / `"jobs"`                             | Project role path relative to src; tasks means src/tasks. No absolute paths, `..` or boundary escape; do not add a src prefix. Production maps it into the compiled root, such as dist/tasks                  |
| `jobs.include`      | `string[]` / `["**/*.{ts,js,mjs,cjs,mts,cts}"]` | Replaces default include; directory-relative globs match actual files. No automatic .ts-to-.js rewriting; an empty array discovers nothing. Include emitted extensions in production                          |
| `jobs.exclude`      | `string[]` / `[]`                               | Added to built-in ignores; cannot re-enable underscore files, declarations or test files. Underscore directories are allowed                                                                                  |
| `jobs.timezone`     | `string` / `"UTC"`                              | Valid nonempty IANA timezone; task > global > UTC                                                                                                                                                             |
| `jobs.redis`        | Object / disabled                               | Configured selects Redis. Otherwise a single app uses Local and trusted built-in Cluster uses Master IPC. Independent processes/containers/hosts explicitly share Redis. No active tasks means no connection  |
| `redis.client`      | ioredis-compatible object / absent              | A valid client takes precedence over URL, requires ping/eval(script, keyCount, ...args) and the Lua commands used. Caller owns its connection options, errors and close; Jobs does not close supplied clients |
| `redis.url`         | `string` / absent                               | Without a valid client: url > uri > VEXT_REDIS_URL > REDIS_URL. Nullish selection means explicit `""` prevents fallback and causes a missing-target error                                                     |
| `redis.uri`         | `string` / absent                               | URL alias, below url. Undefined permits environment fallback; null is not a valid configuration type                                                                                                          |
| `redis.namespace`   | `string` / automatic                            | Normalized package name + VEXT_CONFIG (default default) + NODE_ENV (default production). Matching replicas need no explicit value; override only for additional business isolation                            |
| `redis.keyPrefix`   | `string` / absent                               | Nonempty full logical-prefix override, ahead of namespace. Trim whitespace and append a missing colon; whitespace-only falls back to automatic namespace. Actual Redis keys also have an internal hash tag    |
| `redis.leaseTtl`    | `number` / `30000`                              | Milliseconds; safe integer >=1000. Renewed approximately every TTL/3; not schedule interval, business timeout or shutdown budget. Long handlers do not require a TTL equal to their full duration             |

Namespace normalization removes leading @, converts slash/backslash to dots, replaces unsupported characters with hyphens, collapses repeated separators and trims edge separators. It permits letters, digits and `_ . : -`. For example `@team/my-app:production:production` becomes `team.my-app:production:production`. Unreadable/invalid package name falls back to vextjs-app; an empty normalized namespace does too. Check for normalization collisions when separate applications share Redis.

The default logical prefix is `vext:<namespace>:job:`. See [multi-replica deployment](/guide/jobs#cluster-and-multiple-replicas) for actual keys, retained markers and Redis Cluster. Jobs does not borrow Session/cache/rate-limit configuration. Environment URL alone does not activate coordination; configure `redis: {}` to use it.

## Documentation source

`openapi.docs.code.jobs: true` inherits `jobs.dir/include/exclude`. Explicit Docs fields override their corresponding defaults; false only disables documentation scanning. Disabled definitions can still be documented. Jobs details show declared schedule, timezone fallback, switches and static parse state, not live runtime status. See [Docs and MCP](/guide/jobs#documentation-and-mcp) for configuration, JSDoc precedence and static boundaries.

## Errors and execution boundaries

- `VextJobDefinitionError`: invalid definition/import, selected file without a defineJob export, or no representable future point.
- `VextJobDuplicateNameError`: duplicate loaded names, including disabled definitions.
- Invalid configuration/declaration, failed built-in Master handshake, manifest disagreement or activation failure refuses startup. A necessary onReady failure rejects and cleans up startup when Jobs are enabled; without enabled Jobs, existing logged isolation remains.
- Configured Redis for active tasks is checked for connection, PING and Lua EVAL during initialization; failure refuses startup.
- Overlap skips; exceptions are logged. No queue, automatic retry, downtime catch-up or immediate startup execution.
- Close waits within the total shutdown.timeout budget and requests cancellation; it cannot interrupt a function that ignores signal.
- Shared healthy Redis coordinates a planned point; it does not guarantee exactly-once business effects.

Each selected file has exactly one default SDK Job. Ordinary helpers, dynamic fields, immutable default aliases and finite relative default reexports are allowed. Opaque default factories, additional SDK declarations (including unexecuted positions), Job-valued named aliases, user getters/Proxy and late export mutation are rejected. Complete compiler export transport requires structural proof. Framework builds check original inputs before optimization; source-less deployment proves only the current emitted-input, never unavailable historical declarations.

Built-in Cluster separates appReady from JobsActive. Master compares all loaded task manifests, then activates and waits for ACKs. Rolling replacement obtains the old generation's closed-admission receipt or actual exit before slot commit and new activation; a drain receipt does not prove handler settlement. Redis operations use a per-handle `min(2000, effectiveTtl / 3)` millisecond budget and a conservative deadline measured before send with a monotonic clock. Expired, late or failed renewal permanently quarantines Worker admissions and initiates shutdown; reconnect cannot revive eligibility.

## Testing entry point

Import `createTestJobScheduler`, `CreateTestJobSchedulerOptions` and `TestJobScheduler` from vextjs/testing. Explicit tick(Date) uses the real scheduling rules without timers or project discovery. Ordinary createTestApp does not load Jobs either. See the [testing API](/api/testing-api#createtestjobscheduler) and [acceptance workflow](/guide/jobs#testing-and-acceptance).

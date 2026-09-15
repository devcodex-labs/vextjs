# MCP generation and dependency knowledge

Vext MCP provides project facts, candidate files, and validation workflows. The host applies changes, runs commands, and verifies behavior. `ready` means a candidate can enter host review; `scaffold: true` identifies a scaffold, not completed business functionality. Exporting a Skill does not prove the host loaded or called it.

## Development workflow

1. Call `vext_project_inspect` for current identity, directories, configuration, and dependencies. Check analysis coverage.
2. Search relevant framework and dependency knowledge with `vext_knowledge_search`. Check exact versions, prerequisites, and limitations.
3. Express user conventions through `policyPatch`, then request `vext_generate_changes` with real inputs, outputs, and use cases.
4. Review files, `scaffold`, `prerequisites`, and `requiredHostSteps`. Validate the same identity with `vext_validate_changes`.
5. The host applies create-only files and incrementally integrates existing configuration and consumers. Inspect again after project changes; stale identities cannot authorize new candidates.
6. Run existing type checks, focused tests, formatting, builds, and runtime checks. Record commands, exit codes, and behavior evidence, then stop verification services and remove temporary artifacts.

Analysis JSON uses `schemaVersion: 2`; workspace/dev.mcp configuration remains version 1. Dependency ranges, content identity, loaded implementation identity, and runtime state describe separate facts.

## Default roles and project overrides

Directories are selected by responsibility and created only when needed. `server` denotes a server-only boundary; `services` identifies service contracts within it. The default is `src/types/server/services/`, not a collection of unrelated types directly under `server/`.

| Role                                       | Default location                                       | Consumption                                                      |
| ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| routes / services                          | `src/routes/` / `src/services/`                        | Runtime loaders and actual service keys                          |
| models                                     | `src/models/`                                          | Model loader; subdirectories select database/pool                |
| service-types                              | `src/types/server/services/`                           | Service input/output, TS import type or JS JSDoc imports         |
| server-model-types                         | `src/types/server/models/`                             | Domain documents; native query generics                          |
| shared-types / frontend-types              | `src/types/shared/` / `src/types/frontend/`            | Imports within the declared consumer boundary                    |
| schemas / validators                       | `src/schemas/` / `src/validators/`                     | Explicit imports and validation activation                       |
| server-utils / shared-utils                | `src/utils/server/` / `src/utils/shared/`              | Reusable stateless operations, no automatic app injection        |
| mock-data / mock-scenarios / mock-adapters | `mocks/data/` / `mocks/scenarios/` / `mocks/adapters/` | Separate data, scenarios, and explicit development/test adapters |
| fixtures / seeds                           | `test/fixtures/` / `scripts/seeds/`                    | Test inputs and explicit seed scripts, never implicit GET writes |
| frontend pages / components / layouts      | `src/frontend/pages/` / `components/` / `layouts/`     | Automatic page/layout entries versus imported components         |
| locales / frontend-locales                 | `src/locales/` / `src/frontend/locales/`               | `<module>/<submodule>/<locale>.json`                             |
| public                                     | `public/`                                              | Public static assets, not private source or data                 |
| generated-types / storage                  | `src/types/generated/` / `storage/`                    | Generated or runtime data, not normal business candidates        |

The effective roles returned by inspection are authoritative. Unambiguous existing layouts such as `src/mocks` and `tests` may be adopted. Explicit configuration and child-role overrides take precedence; parent overrides propagate to children without their own override.

A project may place service contracts in `src/types/service/` by setting the following policyPatch content (or workspace policyDefaults):

```json
{
  "outputLanguage": "en",
  "commentLanguage": "en",
  "roles": { "service-types": "src/types/service" }
}
```

This is a policy object, not a complete Tool request or workspace file. `server-service-types` is an alias of the same role; conflicting paths are rejected.

Moving implementation files does not change runtime loaders. Candidates include re-export entries in actual loader directories when required. Feature architecture may place implementation under `src/modules/<feature>/` while preserving those entries. Monorepo inspection reads the current service and declared, verified shared sources; it does not grant arbitrary writes outside the fixed root. Shared model packages share definitions, while each application owns its connections.

## Maintainable generated code

Routes own HTTP validation, authorization, responses, and use-case calls. Services own orchestration; models own persistence schema/hooks/indexes. Reused pure transformations belong in utils and domain validators in validators. Callbacks, short local expressions, and service private methods are valid. Do not use function counts as a quality rule or export cross-route helpers from loader-owned route files.

Only create reusable type contracts when needed. TS/TSX and JS/JSX are generated separately, with JSDoc contracts for JavaScript. Mixed target directories require `options.language`. Naming and architecture policy cannot invent loader behavior.

Comments explain non-obvious contracts, authorization, transactions, idempotency, cache failures, and time units. Explicit commentLanguage wins; auto considers existing comments and outputLanguage. Static formatter JSON/.editorconfig settings affect generation. The host executes dynamic formatter configuration and final formatting.

Route and page Recipes accept JSON-safe `routeOptions` plus top-level `auth`, `middlewares`, `cache`, `docs`, `operationId`, `security`, and `access`. Explicit `false`, empty arrays, and `null` are preserved. Function auth, runtime stores/clients, and dynamic checks cannot be serialized into MCP options; wire them in host code or existing modules. Protected pages and admin APIs should declare authorization or middleware boundaries before reading protected data.

Backend locale files describe error keys with code, message, and HTTP status semantics. Frontend locale files describe user-facing copy, actions, and states. Mock data, scenarios, and adapters stay in mock-data/mock-scenarios/mock-adapters rather than service seed data.

## Recipe inputs and integration

All 17 Recipes have independent options schemas in `vext://catalog/recipes`. Unknown fields and conflicting options are rejected.

| Recipe                    | Main inputs                                                         | Output and integration                                                                                                                |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| RCP-01 api-route          | method/path, RouteOptions, validate/responses, handler or service   | Route; custom results require responses                                                                                               |
| RCP-02 api-module         | serviceMethod, input/output, body, RouteOptions, validate/responses | Route calls generated service; default input comes from `req.valid("body")`                                                           |
| RCP-03 page-route         | page/path, props, RouteOptions                                      | Render route and matching page; serialize only authorized data                                                                        |
| RCP-04 page-and-api       | page/path, props, apiPath, routeOptions/apiRouteOptions             | Real API request with loading/error/cancellation                                                                                      |
| RCP-05 service            | body, input/output or parameters/imports                            | Use case and necessary contracts; declared input requires a body                                                                      |
| RCP-06 model              | collection/key, schema/document, indexes/connection                 | Native model definition; application-owned database setup                                                                             |
| RCP-07 middleware         | body, factory/options                                               | Handler or factory; explicitly register it                                                                                            |
| RCP-08 plugin             | setup/onReady/onClose, dependencies                                 | Lifecycle; close only owned resources                                                                                                 |
| RCP-09 locale             | target, module/submodule, locale/messages                           | Module messages; verify loader use and missing locale keys                                                                            |
| RCP-10 test               | target/exportName, kind, cases                                      | Real exported function unit/integration tests with distinct expectations                                                              |
| RCP-11 type-contract      | target, fields                                                      | Consumer-owned fields, reuse complex existing contracts                                                                               |
| RCP-12 utility            | description/body, parameters/returnType, target                     | Actual pure operation, no invented identity wrapper                                                                                   |
| RCP-13 frontend-component | title                                                               | Presentation scaffold; integrate real interaction, styles, and i18n                                                                   |
| RCP-14 frontend-layout    | page, reusable                                                      | Render children and connect reusable layouts to page entries                                                                          |
| RCP-15 reusable-schema    | fields, usage/consumer                                              | Valid DSL/schema fields; attach to the real validation boundary                                                                       |
| RCP-16 mock-scenario      | data, scenarios, target                                             | Separate data/scenarios and select an existing adapter                                                                                |
| RCP-17 job-handler        | payload, handler, queue/schedule, retry/timeout                     | Object queue; cron validation creates no timer; scheduler passes no business payload; configure real worker/scheduler/store processes |

api-module always calls its newly generated service; use api-route for an existing service or custom handler. Free-form parameters require serviceArgs. Explicit input requires validate.body unless serviceArgs selects another validated boundary. Standalone serviceArgs/serviceMethod require a target service.

These generators have explicit boundaries: RCP-10 does not invent browser E2E flows, RCP-13 does not invent business interactions, and RCP-16 does not install or guess third-party adapters. Missing inputs produce `incomplete`; unsupported combinations produce `unsupported`. Host integration and behavior validation remain required.

`vext_project_check` and `vext_validate_changes` accept `configTarget: "development" | "production" | "all"`. Specify it when Redis, rateLimit, session, Job, cache, or production startup may differ; `all` checks development and production static config. `vext_capability_check` returns catalog status, framework support, MCP coverage, and current project state separately. Do not promote `partial`, `planned`, `unknown`, or `unverified` surfaces to supported.

## Versioned dependency evidence

Knowledge is compiled into the framework package; project startup does not fetch the latest online documentation.

| Field or state                     | Meaning                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| dependency.declaredRange           | Declaration in the loaded framework manifest                                         |
| reviewedVersions / reviewedOn      | Exact reviewed versions and review date                                              |
| applicability.owners               | Separate service/framework declarations and resolved versions                        |
| reviewed-version                   | Documentation/type applicability, still requiring runtime checks                     |
| version-mismatch / unverified      | Different or unresolved installation; review the exact official API first            |
| evidence / examples / verification | Official references, package evidence, directly typechecked examples, and test index |

Coverage includes schema-dsl, monSQLize, response-cache-kit, cache-hub, flex-rate-limit, esbuild, croner, ioredis, React/ReactDOM, MCP SDK, and Oxc. Official main-branch documentation is not evidence for a different installed version. Advanced upstream features are not automatically verified Vext features.

Use native `app.db.model<Document>(key)` and `findPage({ query, ... })`. findPage returns items/pageInfo; findAndCount returns data/total. See [Database](./database). Response cache, database cache, rate limiting, Jobs, and session each own configuration and lifecycle; one Redis target does not enable or verify all consumers.

`domain` uses the same domains and aliases as project checks (for example database→models) and combines with kinds/ids. Unknown domains are input errors. `locale` selects the retrieval notice language; entries preserve packaged Chinese/English and API text. `localization.status: partial` explicitly reports that full per-entry translation is unavailable.

Every requirement, configuration, directory, dependency, or public API change must evaluate knowledge, Recipes, checks, documentation, and consumer tests. Record why an area is unaffected when no change is needed; changing a version string alone is insufficient.

## Verify host adoption

Run `vext mcp sync --root . --check --skill --json` from the service root. The adoption result separates configuration, launcher, and Skill files from host discovery, actual connection, and current-task usage. Codex retains user-level MCP configuration; its project Skill is `.agents/skills/vextjs/SKILL.md`, with YAML name/description. Custom content is preserved. To deliberately replace an old export after reviewing it, use `vext mcp skill write --output .agents/skills/vextjs/SKILL.md --force`.

Matching files do not prove host adoption. TOML evidence is managed-block text matching, not whole-file host parsing. Discovery, connection, and taskUsage remain unverified until actual host evidence exists. Call vext_project_inspect through the host and compare rootDir, projectId, and implementation.loadedDigest. Retain actual Tool results, candidate SHA values, host commands and outcomes. Missing task history cannot establish whether an earlier task used MCP.

The scaffolded `src/config/bootstrap.ts` defaults to `defineBootstrapConfig({ providers: [] })`. That zero-provider entry does not hide a static `dev.mcp` declaration or block `vext mcp sync` from writing host configuration. MCP keeps configuration facts unknown only when bootstrap providers are non-empty, dynamic, or not statically proven empty.

Managed builds publish `dist/.implementation.json` last. MCP captures its loaded digest; a changed manifest requires reconnecting, while missing/building/invalid evidence remains unverified and prevents apply-ready candidates. For framework development, npm run build emits ESM+CJS; build:esm and dev/watch emit ESM, and build:cjs requires current ESM inputs. Use build for complete local package behavior. Direct tsc execution does not publish a completed implementation manifest.

CLI sourceBuild checks source/build inputs only when framework sources exist. Changed inputs report build-required; installed production packages need no src directory. Normal MCP requests read only the small manifest. It records managed builds, rather than auditing manually modified dist files. Reconnect and compare the actual Tool's loaded digest; Vext does not terminate host processes.

## Multiple runtime instances

Each owner (development process, web, cluster master, independent Job worker/scheduler) records schemaVersion=2 under `.vext/runtime/snapshots/<instanceId>.json`. A random startup UUID separates instances even when a PID is reused. Real service roots/projectId separate services. Development child restarts append events to their owner's history; each cluster master aggregates its own workers.

Use vext_runtime_inspect with section summary to page through instances, then select the returned instanceId for summary/workers/reloads/events. Aggregate detail items carry instanceId. Cursors bind project, section, instance selection and snapshot contents; restart at the first page after a stale cursor.

Inspection visits at most 200 directory entries, reads at most 1 MiB per file and 8 MiB total. Events/reloads/workers retain 200/100/200 items. Responses also have a byte budget; reducing limit cannot turn incomplete collection into complete evidence. Unsafe links, invalid schema/ownership, concurrent changes and limits produce invalid/partial evidence with reasons.

updatedAt is not a heartbeat; liveness remains unverified. Source freshness requires a supplied revision with the same input contract. Current startup owners lack a revision covering the MCP input set, so sourceRevision remains null/unverified rather than performing a full source scan at startup. Neither presence nor absence proves process health or shutdown.

Updates for one owner are serialized and random temporary files are cleaned on success/failure. Graceful shutdown records stopped. Startup cleanup considers at most 200 records and removes only same-project snapshots stopped for at least 24 hours whose PID is absent; unknown ownership/liveness and abnormal exits are retained. At the inventory limit, the host must establish actual process state before manually removing specific records. Legacy snapshot.json is only a legacy/unverified notice. MCP does not start, restart, stop services or execute Jobs.

## Default request validation versus response schemas

The default `RouteOptions.validate.body/query/param` and `app.getValidator().compile()` consume DSL field maps, for example `{ "title!": { type: "string" }, featured: "boolean?" }`. Do not pass a whole `{ type: "object", properties: ..., required: [...] }` schema there: those keys become field names. `responses[status].schema` is a separate boundary that accepts full JSON Schema.

MCP asks for corrected inputs or explicit integration when it detects this root-object mix-up; project checks flag it for review. An explicitly replaced validator requires its own real request tests. Default validation allows coercion. Enforce strict JSON booleans, extra-field rules and business whitespace checks in request middleware and validators without changing application-wide query conversion.

## Additional boundaries verified by business consumers

- A Job payload field map produces one runtime schema and an inferred contract, by default in `src/schemas/<name>-payload.ts` and `src/types/server/jobs/<name>.ts`. The Job imports both. JavaScript uses JSDoc; user policy can override `job-types` or its parent. Jobs without payloads do not receive empty type files.
- Built-in scheduler-created runs do not carry business payload. Jobs with required payloads should be run/enqueued explicitly, or the scheduled handler should derive work from application data. Built-in stores allow `completeRun()` only for the current running owner and clear the lease; stale or repeated completion attempts do not overwrite terminal state.
- Field-level `{ type: "boolean" }` and `{ enum: ["draft", "published"] }` must retain the runtime meaning, rather than becoming objects with type/enum subfields. Each request location still receives a DSL field map, not a whole-object JSON Schema.
- Logout or 401 clears the token, legacy storage, data and editing state. Distinguish a committed save from a failed refresh. SSR images can fail before hydration; check the mounted native image's complete/naturalWidth in addition to onError.
- Consume the actual generated API client after it exists; do not invent a source import into absent output. Consumer evidence covers TS/JS, HTTP, OpenAPI, client types and browsers independently of static candidate acceptance.

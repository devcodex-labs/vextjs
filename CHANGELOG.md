# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 📂 **Detailed changelogs**: See the [`changelogs/`](./changelogs/) directory for full release notes per version.
> This file serves as a version overview index for quick browsing of release history.

---

## [Unreleased]

### Fixed
- **P0 BUG-012**: pino mixin `EMPTY_MIXIN` shared object pollution — `logger.ts` pre-allocated a shared `const EMPTY_MIXIN = {}` for "performance optimization" and returned it from the pino `mixin()` hook when no requestId was present. However, pino internally merges caller-provided structured fields (e.g. `logger.info({ count: 3 }, "msg")`) into the mixin return value via Object.assign semantics. This permanently mutated the shared object, causing **all subsequent log entries** to carry stale fields like `count: 3` — even unrelated framework logs (`[hello] Application is ready!`, `[vextjs] 59 route(s) loaded`, etc.). Fixed by returning a fresh `{}` on every mixin call instead of a shared constant.
- **P2 BUG-013**: CLI `--port` / `--host` arguments silently ignored — `vext start --port 8080` correctly set `VEXT_PORT=8080` in the forked child process environment, but `config-loader.ts` `loadConfig()` never read `VEXT_PORT` / `VEXT_HOST` environment variables. The user's port override was silently discarded and the server always started on `config.port` (default 3000). Fixed by adding a CLI environment variable override step in `loadConfig()` (priority: `DEFAULT_CONFIG < user default < env < local < CLI env vars`) that reads `VEXT_PORT` and `VEXT_HOST` after config merge but before validation and deep-freeze.
- **P1 BUG-014**: Windows graceful shutdown failure — `child.kill('SIGTERM')` on Windows does not trigger the child process's `process.on('SIGTERM')` handler. Node.js on Windows calls the Win32 `TerminateProcess` API instead, which immediately kills the process without executing `onClose` hooks (DB connection pool cleanup, cache flush, etc.). This affected `vext start` (CLI signal forwarding), `vext dev` (`ColdRestarter.safeKill()`), and `setupShutdown()`. Fixed by sending an IPC `{ type: 'shutdown' }` message on Windows (fork-created child processes have a built-in IPC channel) instead of `SIGTERM`. The child process (`bootstrap.ts` via `setupShutdown()`, `dev-bootstrap.ts` via `process.on('message')`) now listens for this IPC message and triggers the same graceful shutdown flow. Unix behavior (standard SIGTERM) is unchanged. A 15-second timeout guard force-kills the child if it doesn't exit after receiving the IPC message.
- **P0 BUG-011**: `requestContext.getStore()` returns `null` in user route handlers — ESM/CJS dual-package singleton bug. When framework adapter (ESM `dist/index.js`) calls `requestContext.run()` on instance A, but user route code compiled to CJS calls `require("vextjs")` which loads `dist/index.cjs` containing a separate `new AsyncLocalStorage()` instance B, `getStore()` on instance B returns `null`. Fixed by caching the singleton via `globalThis[Symbol.for("vextjs.requestContext")]` — both ESM and CJS now resolve to the same AsyncLocalStorage instance. This also fixes `propagateHeaders` end-to-end passthrough (#46) which relied on `store.propagatedHeaders` from the same ALS context.
- **P2**: E2E test port collision (intermittent EADDRINUSE) — `allocatePort()` in `test/e2e/helpers.ts` used a module-level counter starting at 19000, but vitest `pool:"forks"` runs each test file in a separate worker process with its own module scope, so `adapter-e2e.test.ts` and `cli-e2e.test.ts` both allocated from the same port range. Fixed by offsetting `portBase` using `VITEST_POOL_ID` (500-port segments per worker), eliminating cross-worker port collisions.

### Added
- **`prettySingleLine`** logger config option (`boolean`, default `true`) — enables pino-pretty `singleLine` mode in development, compressing structured fields (e.g. `count`, `service`) into a single inline JSON object at the end of the log message instead of expanding them as multi-line indented output. Set to `false` to restore the original pino-pretty multi-line format. Production JSON output is unaffected.
- **`prettyIgnore`** logger config option (`string`, default `"pid,hostname,requestId"`) — controls which fields pino-pretty hides in development mode. `requestId` is hidden by default to avoid mixin-injected fields appearing as extra noise; it remains present in production JSON logs for tracing and log collectors.
- **`vext dev --port/--host`** CLI options — `vext dev` now supports `--port <number>` and `--host <address>` arguments (matching `vext start`). Values are passed to the dev subprocess via `VEXT_PORT` / `VEXT_HOST` environment variables and picked up by `loadConfig()`. Previously these options were documented but not implemented.
- **Unit tests**: `test/unit/logger.test.ts` (19 tests) — mixin shared-object regression tests (BUG-012 prevention), `prettySingleLine` / `prettyIgnore` / `requestContextEnabled` config verification; `test/unit/config-loader.test.ts` +9 tests — `VEXT_PORT` / `VEXT_HOST` environment variable override integration tests (BUG-013 prevention).

### Changed
- **Pretty mode output format**: Development logs now default to single-line format with structured fields appended as `{"key":value}` (was multi-line with each field on its own indented line). This significantly reduces log noise during development. Users who prefer the original multi-line format can set `logger.prettySingleLine: false`.
- Test infrastructure: added `test/setup.ts` with `process.setMaxListeners(30)` to suppress `MaxListenersExceededWarning` during parallel test runs (cold-restarter / build-compiler / cluster tests fork multiple child processes that each register process event listeners, exceeding the default limit of 10).
- Test infrastructure: `cold-restarter.test.ts` worker script now handles IPC `{ type: 'shutdown' }` messages (mirrors real vext subprocess behavior on Windows). Fixed 2 previously flaky tests: timing tolerance increased for `safeKill` slow-shutdown test (`< 3000` → `< 3100`), and `onChildExit` guard now works correctly with IPC-based shutdown on Windows.

---

## [0.1.4] - 2026-03-06

> 📄 [Detailed changelog →](./changelogs/v0.1.4.md)

### Fixed
- **P0 BUG-007**: CLI entry resolution error — `resolveEntryFile()` incorrectly returned `<projectRoot>/dist/lib/bootstrap.js` when user project had `dist/`, but framework bootstrap always lives in `node_modules/vextjs/dist/lib/bootstrap.js`. Now always returns framework-internal bootstrap path.
- **P0 BUG-008**: CJS bundle re-entry — `dist/index.cjs` contained `bootstrap.js` module-level auto-execution code; when user plugins called `require("vextjs")`, the bundle detected `VEXT_MODE=start` and triggered a second `detectAndStart()` → `bootstrap()`, causing duplicate initialization (i18n key conflicts, plugin/service/route double-loading, EADDRINUSE). Fixed with `globalThis.__vext_bootstrap_started` re-entry guard.
- **P1 BUG-009**: `detectAndStart()` catch scope too broad — `try/catch` wrapped both `loadConfig()` and `bootstrap()` calls; runtime errors (e.g. `EADDRINUSE`) from `bootstrap()` were caught and triggered a fallback second `bootstrap()` call. Now `try/catch` only wraps `loadConfig()` pre-load phase.
- **P1 BUG-010**: `BuildCompiler` did not write `dist/package.json` — unlike `DevCompiler` which writes `{"type":"commonjs"}` to `.vext/dev/package.json`, `BuildCompiler` was missing this logic. When user root `package.json` declares `"type":"module"`, CJS output in `dist/` was parsed as ESM (`module is not defined`). Now writes `{"type":"commonjs"}` to outDir after successful build.

### Added
- `propagateHeaders` implementation — `app.fetch` now correctly propagates specified inbound request headers (e.g. `x-trace-id`) to outbound requests
- `RequestContextStore` gains `propagatedHeaders` field, captured from inbound requests by the request-id middleware
- Documentation for `requestId` vs `traceId` conceptual distinction and usage guide
- `app.throw('i18n.key')` string shortcut — omit status parameter, status is read from i18n config's `statusCode` (defaults to 400)
- `app.throw('i18n.key', params)` shortcut with template interpolation parameters
- `onFatalError` fatal error hook — registers `uncaughtException` / `unhandledRejection` handlers with webhook notification + 10s timeout graceful shutdown
- Documentation enhancements: fetch auto-retry semantics, logger 7 storage/collection strategies, deployment fatal error notification, database `use()` alias
- i18n subdirectory mode (Mode B) support in bootstrap — fallback to schema-dsl recursive directory scanning when no flat locale files are found

### Changed
- Dependency versions pinned: `schema-dsl` 1.2.4, `monsqlize` 1.1.7, `flex-rate-limit` 1.0.3 (exact versions, no `^` prefix)

### Previously Fixed (carried from Unreleased)
- **BUG-006 (P1)**: `config.fetch.propagateHeaders` and `VextFetchInit.propagateHeaders` had no effect in v0.1.3 (`void extraHeaders` empty implementation)
- `propagateRequestId: false` incorrectly blocked `propagatedHeaders` propagation — separated the two independent feature control paths
- `post()`/`put()`/`patch()` shortcut methods set `content-type: application/json` even when `body` was `undefined` — now only set when `body != null`
- `fetch.test.ts` log level assertions aligned with implementation (success → `debug`, 5xx → `error`)
- **BUG-001 (P1)**: i18n subdirectory mode (Mode B) locales not loaded at bootstrap — `loadI18n()` only handled flat files, added fallback to `schemaAdapter.configure({ i18n: path })` for recursive subdirectory scanning
- Documentation links pointing to wrong GitHub organizations (`nicx-next`, `yourusername`, etc.) corrected to `vextjs`

---

## [0.1.3] - 2026-03-05

> 📄 [Detailed changelog →](./changelogs/v0.1.3.md)

### Fixed
- **P0 BUG-004**: `config-loader` `deepMerge` skipped `middlewares` key, causing user middleware whitelist to be lost
- **P1 BUG-005**: `app.fetch` was `undefined` inside route handler closures (mount order issue)
- **P1 BUG-003**: Windows terminal hot-reload log emoji garbled → ASCII-safe markers

### Changed
- Access log switched to compact single-line format in development mode

---

## [0.1.2] - 2026-03-05

> 📄 [Detailed changelog →](./changelogs/v0.1.2.md)

### Fixed
- **P0 BUG-001**: `vext dev` CJS/ESM incompatibility (ERR_REQUIRE_ESM)
- **P1 BUG-002**: Documentation referenced `app.decorate()` instead of `app.extend()`

### Added
- Dual-package publishing (ESM + CJS), supports `require('vextjs')` usage
- `VextPlugin` gains `onReady` / `onClose` lifecycle hooks

### Changed
- `VextServices` index signature `unknown` → `any` (call service methods directly without type assertion)
- `app.throw()` third parameter now accepts `string` type for business error codes

---

## [0.1.1] - 2026-03-05

> 📄 [Detailed changelog →](./changelogs/v0.1.1.md)

### Added
- `vext create` interactive project scaffolding (supports TS/JS × 5 adapter types)
- Documentation site launched (39-page Rspress SSG: 22 Guide + 7 API + 7 Examples)
- GitHub Issues/PR templates + `CONTRIBUTING.md`
- `CHANGELOG.md` (this file)

### Security
- Fixed `@hono/node-server` authorization bypass vulnerability (GHSA-wc8c-qw6v-h7f6)
- Fixed `hono` Cookie injection / SSE injection / serveStatic arbitrary file access (GHSA-5pq2, GHSA-p6xx, GHSA-q5qw)

---

## [0.1.0] - 2026-03-04

> 📄 [Detailed changelog →](./changelogs/v0.1.0.md)

### 🎉 Initial Release — Phase 0 ~ Phase 3

**1,926 tests, zero regressions, TypeScript strict zero errors.**

| Phase | Content | Tests |
|-------|---------|:-----:|
| Phase 0 | Skeleton validation (core types + Hono Adapter + bootstrap) | — |
| Phase 1 | MVP (config / logger / 6 middlewares / services / plugins / routing / i18n / app.fetch) | 1,066 |
| Phase 2A | Developer experience (`vext dev` Cold Restart + `vext build` + OpenAPI/Swagger) | +258 |
| Phase 2B | Hot reload (Soft Reload Tier 1/2 + access-log + MemoryMonitor) | +183 |
| Phase 3 | Enterprise-grade (Cluster + Multi-Adapter 5 types + MonSQLize built-in plugin) | +420 |

**Performance (Native Adapter, JSON scenario)**: Raw 94K RPS → Vext 71K RPS (overhead 25%)

---

## Version History

| Version | Date | Type | Key Theme |
|---------|------|------|-----------|
| [Unreleased] | — | — | — |
| [0.1.4] | 2026-03-06 | Patch | CLI entry fix + CJS bundle re-entry guard + detectAndStart catch fix + BuildCompiler dist/package.json + dependency pinning |
| [0.1.3] | 2026-03-05 | Patch | BUG-004/005/003 critical bug fixes |
| [0.1.2] | 2026-03-05 | Patch | BUG-001 dev mode fix + dual-package + type enhancements |
| [0.1.1] | 2026-03-05 | Minor | CLI scaffolding + security fixes + documentation site |
| [0.1.0] | 2026-03-04 | Pre-release | Initial release (Phase 0~3, 1,926 tests) |

---

## Links

- [GitHub Repository](https://github.com/vextjs/vext)
- [Issues](https://github.com/vextjs/vext/issues)
- [Contributing Guide](./CONTRIBUTING.md)
- [Detailed Changelogs](./changelogs/)

[Unreleased]: https://github.com/vextjs/vext/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/vextjs/vext/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/vextjs/vext/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vextjs/vext/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vextjs/vext/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vextjs/vext/releases/tag/v0.1.0
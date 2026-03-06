# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 📂 **Detailed changelogs**: See the [`changelogs/`](./changelogs/) directory for full release notes per version.
> This file serves as a version overview index for quick browsing of release history.

---

## [Unreleased]

### Added
- `propagateHeaders` implementation — `app.fetch` now correctly propagates specified inbound request headers (e.g. `x-trace-id`) to outbound requests
- `RequestContextStore` gains `propagatedHeaders` field, captured from inbound requests by the request-id middleware
- Documentation for `requestId` vs `traceId` conceptual distinction and usage guide
- `app.throw('i18n.key')` string shortcut — omit status parameter, status is read from i18n config's `statusCode` (defaults to 400)
- `app.throw('i18n.key', params)` shortcut with template interpolation parameters
- `onFatalError` fatal error hook — registers `uncaughtException` / `unhandledRejection` handlers with webhook notification + 10s timeout graceful shutdown
- Documentation enhancements: fetch auto-retry semantics, logger 7 storage/collection strategies, deployment fatal error notification, database `use()` alias
- i18n subdirectory mode (Mode B) support in bootstrap — fallback to schema-dsl recursive directory scanning when no flat locale files are found

### Fixed
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
| [Unreleased] | — | — | BUG-006 propagateHeaders fix + BUG-001 i18n subdirectory fix + docs |
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

[Unreleased]: https://github.com/vextjs/vext/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/vextjs/vext/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vextjs/vext/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vextjs/vext/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vextjs/vext/releases/tag/v0.1.0
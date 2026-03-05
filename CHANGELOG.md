# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.2] - 2026-03-05

### Fixed

- **P0**: `vext dev` CJS/ESM 不兼容 — dev 编译器输出 CJS 但 vextjs 为 ESM-only，导致 `require('vextjs')` 失败（ERR_REQUIRE_ESM）。新增双包发布（ESM + CJS），通过 `scripts/build-cjs.mjs` 生成 `dist/index.cjs` 和 `dist/testing/index.cjs`
- **P1**: 文档 `app.decorate()` → `app.extend()`（`website/docs/guide/introduction.md`）
- 文档站版本号过时（cli.md、quick-start.md、导航栏）
- `.gitignore` 缺少 `.vext/` 编译产物和 `examples/*/package-lock.json`

### Changed

- `VextServices` 索引签名从 `unknown` 改为 `any`，允许 `app.services.user.findAll()` 直接调用（无需类型断言）
- `app.throw()` 第三参数支持 `string` 类型业务错误码（原仅支持 `number`）
- `HttpError.code` 类型扩展为 `number | string`
- `VextThrowFn` 签名增加 string 业务码智能参数识别

### Added

- `VextPlugin` 新增可选生命周期钩子 `onReady?(app)` 和 `onClose?(app)`，setup 完成后自动注册到 `app.onReady()` / `app.onClose()`
- `scripts/build-cjs.mjs` — esbuild CJS 构建脚本，支持双包发布
- `package.json` exports 添加 `"require"` 条件（`.` 和 `./testing`）

---

## [0.1.1] - 2026-03-05

### Added

- `vext create` CLI command — interactive project scaffolding with TS/JS support, 5 adapter choices (`--adapter hono|fastify|express|koa|native`), `--skip-install`, `--force` options (Phase 4.2)
- Security audit — fixed 2 high severity vulnerabilities in `@hono/node-server` and `hono` (Phase 4.4)
- GitHub Issues templates (Bug Report, Feature Request) and Pull Request template (Phase 4.6)
- `CONTRIBUTING.md` — contribution guide with development setup, code style, testing, and PR guidelines (Phase 4.6)
- `CHANGELOG.md` — this file (Phase 4.6)
- Documentation site — 39 pages SSG with Rspress v2, covering guide (16p), API reference (7p), examples (7p), benchmark
- `app.fetch` built-in HTTP client guide and API reference
- MonSQLize database plugin usage guide
- Logger, requestContext, build, deployment advanced guides
- Nacos and OpenTelemetry integration examples
- CI docs-build gate for PR checks
- Custom SVG favicon with gradient V design

---

## [0.1.0] - 2026-03-04

### 🎉 Initial Release — MVP through Phase 3

First pre-release of vextjs, covering Phase 0 through Phase 3 of the implementation plan.

### Added

#### Phase 0: Skeleton Verification

- Core type definitions (`VextApp`, `VextRequest`, `VextResponse`, `VextAdapter`, `VextMiddleware`)
- `HttpError` class and `requestContext` (AsyncLocalStorage)
- `createApp()` with `DEFAULT_CONFIG`
- Hono Adapter with `executeChain` onion model
- `defineRoutes()` route collection helper
- `vext start` CLI command — production mode startup
- Bootstrap entry point (`bootstrap.ts`)

#### Phase 1: MVP v0.1.0

- Config loader — `default` → `{NODE_ENV}` → `local` merge with environment variable overrides
- Logger — pino-based with `requestId` mixin via AsyncLocalStorage
- Body parser middleware — JSON/URL-encoded with size limits
- CORS middleware — configurable origins, methods, headers
- Rate limiter middleware — `flex-rate-limit` integration
- Request ID middleware — `X-Request-Id` generation
- Response wrapper middleware — `{ code, data, message, requestId }` format
- Error handler middleware — `HttpError` + validation error handling + i18n
- Validate middleware — `schema-dsl` integration for request validation
- Service loader — auto-scan `src/services/`, inject into `app.services`
- Middleware loader — named middleware registry, reference resolution
- Plugin system — `definePlugin()`, plugin lifecycle (`setup`, `onReady`, `onClose`)
- Router loader — file-based routing with prefix inference
- i18n loader — locale file auto-loading
- Graceful shutdown — signal handling + cleanup orchestration
- Built-in HTTP client — `app.fetch` with baseURL, timeout, interceptors
- `vext start` — project detection, TypeScript support via tsx

#### Phase 2A: Developer Experience v0.2.0-alpha

- `DevCompiler` — esbuild transform + rebuild for development
- `VextFileWatcher` — `fs.watch` zero-dependency file watching with Docker polling support
- `ColdRestarter` — cold restart on config/plugin changes
- `vext dev` — development mode with file watching
- `vext build` — production build via esbuild (CJS output to `dist/`)
- OpenAPI / Swagger — `SchemaConverter` + `OpenAPIGenerator` + `/docs` UI + `/openapi.json`

#### Phase 2B: Hot Reload v0.2.0

- `HotSwappableHandler` — atomic request handler replacement
- `CacheInvalidator` — reverse dependency graph + BFS cache eviction
- `MemoryMonitor` — heap snapshot tracking + growth trend detection
- `ServiceReloader` — selective service instance rebuild
- `RouteReloader` — Fresh Adapter strategy for route hot reload
- `I18nReloader` — locale file hot replacement
- `SoftReloader` — Tier 1/2 soft reload orchestrator with rollback
- Access log middleware — request timing, status code, path logging
- `vext dev` upgraded — Soft Reload Tier 1/2 + Cold Restart Tier 3

#### Phase 3: Enterprise v0.3.0

- Cluster mode — `ClusterMaster` with serial fork, exponential backoff, rolling restart
- Worker management — heartbeat, metrics reporting, memory threshold detection
- `vext stop` / `vext reload` / `vext status` — cluster management CLI commands
- Fastify Adapter — full `VextAdapter` implementation with `routerOptions` fix (FSTDEP022)
- Express Adapter — manual `collectRawBody`, delayed fallback registration
- Koa Adapter — built-in lightweight router matcher, `ctx.respond = false` bypass
- MonSQLize built-in plugin — conditional loading, model auto-scan, connection management

#### Phase 4: Release Preparation (partial)

- Performance benchmark suite — `run-benchmark.mjs` with autocannon, 3 scenarios × 5 adapters
- Performance optimization — conditional middleware registration, `dispatch(i)` recursion, lazy parsing
- Multi-round median benchmark — `--rounds` option, `selectMedian()`, CV statistics
- Native Adapter — `http.createServer` + `find-my-way` trie router, zero framework dependency
- AsyncLocalStorage configurable skip — `config.requestContext.enabled` toggle
- E2E test suite — 136 adapter tests + 16 CLI tests across 4 adapters
- CI/CD pipelines — `ci.yml` (Node 18/20/22 matrix) + `release.yml` (npm publish)

### Performance

- Native Adapter: **94,252 RPS** raw, **70,874 RPS** vext (JSON scene, 5-round median)
- Vext Native outperforms Vext Fastify by **15–18%** in JSON and Chain scenarios
- Average framework overhead: **19–25%** (full-featured framework with body parser, response wrapper, AsyncLocalStorage, middleware chain)

### Security

- Fixed `@hono/node-server` authorization bypass via encoded slashes (GHSA-wc8c-qw6v-h7f6)
- Fixed `hono` cookie attribute injection, SSE control field injection, arbitrary file access (GHSA-5pq2, GHSA-p6xx, GHSA-q5qw)

### Tests

- **1,926 tests** total (1,690 unit + 184 integration + 152 E2E + 95 CLI create)
- Zero regressions across all phases
- TypeScript strict mode — zero `tsc` errors

---

## Version History

| Version | Date | Milestone |
|---------|------|-----------|
| 0.1.2 | 2026-03-05 | Bug fixes (dev mode CJS/ESM), type enhancements, dual-package support |
| 0.1.1 | 2026-03-05 | CLI scaffolding, security fixes, docs site, community files |
| 0.1.0 | 2026-03-04 | MVP through Phase 3 |

---

## Links

- [GitHub Repository](https://github.com/vextjs/vext)
- [Issues](https://github.com/vextjs/vext/issues)
- [Contributing Guide](./CONTRIBUTING.md)

[Unreleased]: https://github.com/vextjs/vext/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/vextjs/vext/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vextjs/vext/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vextjs/vext/releases/tag/v0.1.0
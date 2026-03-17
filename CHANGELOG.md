# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 📂 **Detailed changelogs**: See the [`changelogs/`](./changelogs/) directory for full release notes per version.
> This file serves as a version overview index for quick browsing of release history.

---

## [Unreleased]

---

## [0.1.7] - 2026-03-17

> 📄 [Detailed changelog →](./changelogs/v0.1.7.md)

### Fixed
- **BUG-028**: `dev-bootstrap.ts` 缺失 monSQLize 插件加载 — dev 模式启动时未加载内置 monsqlize 插件，导致 `app.db` / `app.monsqlize` 为 undefined。修复为在 dev-bootstrap 中条件检测 `shouldLoadMonSQLize(config)` 并使用 `createMonSQLizePlugin` 加载（使用 `outDir` 路径）。
- **BUG-029**: `route-cache.ts` condition 返回 false 时未设置 `X-Cache` 头 — 当 `condition(req)` 返回 false（跳过缓存）时，中间件直接透传给 handler，响应头中缺少 `X-Cache: MISS`，客户端无法感知缓存被跳过。修复为在 condition 分支补充 `res.setHeader("X-Cache", "MISS")`。同步更新 `route-cache.test.ts` 断言对齐新行为。

### Added
- **DEV-001**: Model 热重载（monSQLize Hot Reload） — `vext dev` 模式下修改 `src/models/` 目录中的 model 定义文件时，自动触发选择性 Model 重载。
  - 新增 `model-reloader.ts` 模块，参照 `service-reloader.ts` 模式实现。
  - 使用 monSQLize v1.1.8 原生 `Model.redefine()` / `Model.undefine()` API（移除 `_registry` polyfill）。
  - 仅重载 invalidation set 中的 model 文件，其他保持不变。
  - 失败时全量回滚到旧定义，保证 Model 注册表一致性。
  - Soft Reload 日志新增 `model:Xms` 计时指标。

### Changed
- **DEP-001**: 升级 `monsqlize` 依赖 `^1.1.7` → `^1.1.8`，启用 `Model.redefine` / `Model.undefine` 静态方法；取消本地 `npm link`，安装正式 npm 包。

---

## [0.1.6] - 2026-03-12

> 📄 [Detailed changelog →](./changelogs/v0.1.6.md)

### Fixed
- **BUG-023**: `buildMonSQLizeConfig` type 字段映射错误 — 传递 `type: config.type ?? "url"` 给 MonSQLize，但 MonSQLize 只接受 `"mongodb"`。修复为硬编码 `type: "mongodb"`。
- **BUG-024**: `buildMonSQLizeConfig` 的 `config.url` → `config.uri` 映射缺失 — vext 使用 `config.url`，MonSQLize 期望 `config.uri`。新增字段名自动映射。
- **BUG-025**: `connection.ts` client getter 使用错误的属性路径 — `_client` 修正为 `_adapter?.client`。
- **BUG-026**: model-loader 使用错误的 API 注册 Model — `monsqlize.model(name, def)` 是 getter 不是 setter，修正为 `Model.define(collectionName, def)` 静态方法。
- **BUG-027**: model-loader CJS/ESM interop 双层嵌套 — esbuild CJS 输出的 `__esModule` 导致 `mod.default` 双层包装，新增自动解包逻辑。
- **FIX-019**: `plugin.test.ts` 死代码 `const originalImport = globalThis.importOriginal` 导致 TS 类型错误，已移除。

### Added
- **CACHE-001**: 路由级响应缓存（Route Cache Phase 1 MVP） — 声明式 `RouteOptions.cache` 配置，支持数字简写 / 完整对象，LRU 内存存储（MemoryCacheStore），`_onSend` 钩子拦截（5 个 adapter 统一支持），`app.cache` 运行时 API（invalidate/delete/clear/stats），Vary headers、条件缓存、标签失效、X-Cache/Cache-Control 响应头、auth+cache 安全警告。80 个单元测试，13 项端到端验证。
- **TEST-003**: MonSQLize 集成测试 — 新增 `test/integration/monsqlize/plugin-lifecycle.test.ts`（34 个测试），使用 `mongodb-memory-server` 覆盖生命周期、CRUD、Model 注册、配置传递、健康检查、聚合查询等场景。
- **TEST-004**: vext-test 验证项从 121 扩展至 131 — 新增 10 个 MonSQLize 端到端检查（#122-#131），覆盖插件加载、健康检查、insertOne/find/findOne/deleteOne、Model 自动加载。

---

## [0.1.5] - 2026-03-09

> 📄 [Detailed changelog →](./changelogs/v0.1.5.md)

### Added
- **OPENAPI-005**: ~~Redoc 页面顶部导航条~~ (已被 OPENAPI-008 替代)
- **OPENAPI-006**: OpenAPI 管道集成测试 — 新增 `test/integration/openapi-pipeline.test.ts`（37 个测试用例），覆盖 DSL→JSON Schema 端到端转换、BUG-021 枚举回归防护、OpenAPI 富化（description/example）全覆盖验证、schema-dsl `toJsonSchema()` 纯净输出验证、跨模块一致性检查。
- **OPENAPI-008**: Scalar API Reference 替换 Redoc + Swagger UI 双端点方案 — `/docs` 端点从 Redoc 切换为 [Scalar API Reference](https://github.com/scalar/scalar)，在单一页面同时提供文档阅读 + 内置 Try it out 交互式请求（无需跳转到 `/swagger`）。移除 `/swagger` 端点和 Redoc 导航条。新增 `ScalarConfig` 类型（支持 10+ 主题、深色模式、modern/classic 布局、搜索热键、代理 URL、隐藏客户端语言等）。`DocEndpointsConfig` 简化为 `specPath` + `docsPath` + `title` + `scalar`，移除 `ui: 'both' | 'redoc' | 'swagger'` 配置。`swagger-ui.ts` 保留为向后兼容桩（`registerOpenAPIRoutes` 委托给 `registerDocEndpoints`）。
- **OPENAPI-009**: Scalar 文档页面 favicon 支持 — `ScalarConfig` 新增 `favicon?: string` 字段，`generateScalarHTML()` 在 `<head>` 中根据配置输出 `<link rel="icon">` 标签（自动推断 SVG/PNG MIME type）。未配置时浏览器使用默认行为（请求 `/favicon.ico`）。使 `/docs` 页面可以与站点文档共用同一个图标。
- **OPENAPI-010**: 外部 OpenAPI 文档导入（多文档切换） — `ScalarConfig` 新增 `sources?: Array<{ title?, url?, content?, slug? }>` 字段，Scalar UI 顶部显示文档切换器。框架自动生成的 `/openapi.json` 作为第一个 source 注入（除非 sources 中已包含相同路径）。支持 URL（远程/本地端点）和 content（内联 JSON 字符串）两种方式提供规范。`guide/openapi.md` 新增「导入外部 OpenAPI」章节。
- **OPENAPI-011**: Scalar 本地资产 / 自定义 CDN 支持 — `ScalarConfig` 新增 `cdnUrl?: string` 字段，替代默认 jsDelivr CDN 地址。适用于内网/离线部署（自托管 JS 文件）、版本锁定（指定 `@scalar/api-reference` 特定版本）、企业内部 CDN 镜像等场景。`guide/openapi.md` 新增「自定义 CDN / 本地资产」章节。
- **CI-001**: schema-dsl 跨仓联动测试 — 新增 `vext/.github/workflows/schema-dsl-compat.yml`（`repository_dispatch` + `workflow_dispatch` + 每周定时触发），在 3 个 Node.js 版本（18/20/22）上升级 schema-dsl 到目标版本后执行 tsc + build + unit + integration 全流程验证。`schema-dsl/.github/workflows/ci.yml` 追加 `notify-vext` job，tests 通过后通过 `peter-evans/repository-dispatch@v3` 触发 vext 兼容性测试（需配置 `VEXT_REPO_TOKEN` secret）。
- **DOC-002**: 文档站 Swagger UI → Scalar 全面同步 — 将 `website/docs/` 下 8 个文件中所有 Swagger UI / Redoc 引用替换为 Scalar API Reference：`guide/openapi.md`（全文重写配置示例，`tryItOut`/`docExpansion` → `scalar` 配置块）、`guide/configuration.md`（配置表 + 示例）、`guide/quick-start.md`、`guide/introduction.md`、`guide/validation.md`、`examples/crud-api.md`、`examples/hello-world.md`、`api/config.md`（配置表 + 废弃标注）。同步更新 `src/types/app.ts` 中 `VextOpenAPIConfig.docsPath` JSDoc 及 `tryItOutEnabled`/`docExpansion` 添加 `@deprecated` 标记。
- **DEP-001**: `package.json` 锁定 schema-dsl `^1.2.5` — 从精确版本 `"1.2.4"` 更新为 `"^1.2.5"`，确保 `toJsonSchema()` 和枚举逗号解析修复在构建/部署环境中始终可用。

### Changed
- **OPENAPI-007**: SchemaConverter v2.1 — 使用 schema-dsl v1.2.5 的 `DslBuilder.toJsonSchema()` 替代 `toSchema()` + 手动 `cleanInternalMarkers()`。移除了 `SCHEMA_DSL_INTERNAL_KEYS` 常量和 `cleanInternalMarkers()` 私有方法，内部标记清理完全由 schema-dsl 上游负责。
- **TEST-001**: 单元测试适配 — `schema-converter.test.ts` 全部 74 个测试从精确匹配 `toEqual` 更新为部分匹配 `toMatchObject`，兼容 OpenAPI 富化字段（description/example）；修正 `date` format 预期为 `"date"`（schema-dsl 语义：`date` → `format: "date"`，`datetime` → `format: "date-time"`）；边界场景（空字符串、`!`、`?`）适配 schema-dsl 异常行为。
- **TEST-002**: `generator.test.ts` 3 个预存失败修复 — 路径/查询参数 `toEqual` → `toMatchObject`（兼容 toJsonSchema 富化字段 description/example）；多状态码响应测试改用 `arrayContaining`（兼容框架默认添加的 500 状态码）。

### Fixed
- **FIX-018**: Windows 终端乱码（em dash） — CLI 命令（`build.ts`、`reload.ts`、`start.ts`）中 `console.log` 使用的 em dash `—` (U+2014) 在 Windows cmd/PowerShell 默认编码下显示为方块乱码。统一替换为 ASCII 连字符 `-`。同步修复 `vext-test` 项目中 `stats.ts`、`default.ts` 的 em dash。

### Fixed
- **P0 BUG-012**: pino mixin `EMPTY_MIXIN` shared object pollution — `logger.ts` pre-allocated a shared `const EMPTY_MIXIN = {}` for "performance optimization" and returned it from the pino `mixin()` hook when no requestId was present. However, pino internally merges caller-provided structured fields (e.g. `logger.info({ count: 3 }, "msg")`) into the mixin return value via Object.assign semantics. This permanently mutated the shared object, causing **all subsequent log entries** to carry stale fields like `count: 3` — even unrelated framework logs (`[hello] Application is ready!`, `[vextjs] 59 route(s) loaded`, etc.). Fixed by returning a fresh `{}` on every mixin call instead of a shared constant.
- **P2 BUG-013**: CLI `--port` / `--host` arguments silently ignored — `vext start --port 8080` correctly set `VEXT_PORT=8080` in the forked child process environment, but `config-loader.ts` `loadConfig()` never read `VEXT_PORT` / `VEXT_HOST` environment variables. The user's port override was silently discarded and the server always started on `config.port` (default 3000). Fixed by adding a CLI environment variable override step in `loadConfig()` (priority: `DEFAULT_CONFIG < user default < env < local < CLI env vars`) that reads `VEXT_PORT` and `VEXT_HOST` after config merge but before validation and deep-freeze.
- **P1 BUG-014**: Windows graceful shutdown failure — `child.kill('SIGTERM')` on Windows does not trigger the child process's `process.on('SIGTERM')` handler. Node.js on Windows calls the Win32 `TerminateProcess` API instead, which immediately kills the process without executing `onClose` hooks (DB connection pool cleanup, cache flush, etc.). This affected `vext start` (CLI signal forwarding), `vext dev` (`ColdRestarter.safeKill()`), and `setupShutdown()`. Fixed by sending an IPC `{ type: 'shutdown' }` message on Windows (fork-created child processes have a built-in IPC channel) instead of `SIGTERM`. The child process (`bootstrap.ts` via `setupShutdown()`, `dev-bootstrap.ts` via `process.on('message')`) now listens for this IPC message and triggers the same graceful shutdown flow. Unix behavior (standard SIGTERM) is unchanged. A 15-second timeout guard force-kills the child if it doesn't exit after receiving the IPC message.
- **P0 BUG-011**: `requestContext.getStore()` returns `null` in user route handlers — ESM/CJS dual-package singleton bug. When framework adapter (ESM `dist/index.js`) calls `requestContext.run()` on instance A, but user route code compiled to CJS calls `require("vextjs")` which loads `dist/index.cjs` containing a separate `new AsyncLocalStorage()` instance B, `getStore()` on instance B returns `null`. Fixed by caching the singleton via `globalThis[Symbol.for("vextjs.requestContext")]` — both ESM and CJS now resolve to the same AsyncLocalStorage instance. This also fixes `propagateHeaders` end-to-end passthrough (#46) which relied on `store.propagatedHeaders` from the same ALS context.
- **P2**: E2E test port collision (intermittent EADDRINUSE) — `allocatePort()` in `test/e2e/helpers.ts` used a module-level counter starting at 19000, but vitest `pool:"forks"` runs each test file in a separate worker process with its own module scope, so `adapter-e2e.test.ts` and `cli-e2e.test.ts` both allocated from the same port range. Fixed by offsetting `portBase` using `VITEST_POOL_ID` (500-port segments per worker), eliminating cross-worker port collisions.
- **P1 BUG-015**: `vext dev` mode OpenAPI endpoints (`/docs`, `/openapi.json`) returned 404 — `dev-bootstrap.ts` was missing the entire OpenAPI initialization block that `bootstrap.ts` (production) correctly contains. No `RouteMetadataCollector` was created, none was passed to `loadRoutes()`, and neither `OpenAPIGenerator` nor `registerOpenAPIRoutes()` was called. Fixed by importing `RouteMetadataCollector`, `OpenAPIGenerator`, `registerOpenAPIRoutes` in `dev-bootstrap.ts` and adding the generation + registration steps after `loadRoutes()`, fully mirroring the production bootstrap flow.
- **P1 BUG-016**: Swagger UI at `/docs` displayed "No layout defined for 'StandaloneLayout'" — `swagger-ui.ts` `generateSwaggerHTML()` configured `layout: 'StandaloneLayout'` which requires the separate `swagger-ui-standalone-preset.js` bundle, but the HTML template only loads `swagger-ui-bundle.js`. Initially fixed by switching to `BaseLayout`, but this removed the navigation sidebar. Final fix: properly load `swagger-ui-standalone-preset.js` from CDN, include `SwaggerUIStandalonePreset` in presets, use `StandaloneLayout` with `DownloadUrl` plugin. Also added `filter: true` (search bar), `tagsSorter: 'alpha'`, `operationsSorter: 'alpha'` for better navigation. Topbar URL input hidden via CSS while preserving layout structure.
- **P3 BUG-017**: Swagger UI page `<title>` always showed "API Documentation" regardless of `openapi.title` config — both `bootstrap.ts` and `dev-bootstrap.ts` called `registerOpenAPIRoutes()` without passing `title: openapiConfig?.title`. Fixed by adding the `title` field to both call sites so the browser tab title now matches the configured API title.
- **DOC-001 (P2)**: `vext/README.md` OpenAPI configuration example used a nested `info: { title, version, description }` structure that does not match the framework's actual flat config API (`openapi.title`, `openapi.version`, `openapi.description`). Users following the README example had their title/version/description silently ignored (defaults used instead). Fixed by updating the README example to use the correct flat structure. Also updated `vext-test/src/config/default.ts` which had copied the incorrect nested form.

### Added
- **`prettySingleLine`** logger config option (`boolean`, default `true`) — enables pino-pretty `singleLine` mode in development, compressing structured fields (e.g. `count`, `service`) into a single inline JSON object at the end of the log message instead of expanding them as multi-line indented output. Set to `false` to restore the original pino-pretty multi-line format. Production JSON output is unaffected.
- **`prettyIgnore`** logger config option (`string`, default `"pid,hostname,requestId"`) — controls which fields pino-pretty hides in development mode. `requestId` is hidden by default to avoid mixin-injected fields appearing as extra noise; it remains present in production JSON logs for tracing and log collectors.
- **`vext dev --port/--host`** CLI options — `vext dev` now supports `--port <number>` and `--host <address>` arguments (matching `vext start`). Values are passed to the dev subprocess via `VEXT_PORT` / `VEXT_HOST` environment variables and picked up by `loadConfig()`. Previously these options were documented but not implemented.
- **Unit tests**: `test/unit/logger.test.ts` (19 tests) — mixin shared-object regression tests (BUG-012 prevention), `prettySingleLine` / `prettyIgnore` / `requestContextEnabled` config verification; `test/unit/config-loader.test.ts` +9 tests — `VEXT_PORT` / `VEXT_HOST` environment variable override integration tests (BUG-013 prevention).

- **P1 BUG-021** (schema-dsl): `enum:a,b,c` comma-separated format completely broken — `DslBuilder._parseSimple()` only checked for pipe `|` separator when detecting enums (`dsl.includes('|')`), so `enum:a,b,c` (comma-separated, the most common format in vext route definitions) was never recognized as an enum. Instead, `'enum'` was looked up in `_getBaseType()` (no match → defaulted to `{ type: 'string' }`), then `'a,b,c'` was passed to `_parseConstraint()` (no match → `{ exactLength: null }`). The resulting schema `{ type: 'string', exactLength: null }` caused all enum validation to silently fail (every value rejected). Same bug existed in `DslAdapter._parseType()`. Fixed by adding an `enum:` prefix handler before the `|` detection block in both `DslBuilder._parseSimple()` and `DslAdapter._parseType()`, supporting comma and pipe separators, with optional type prefix (`enum:number:1,2,3`). All 1003 existing schema-dsl tests pass with no regressions.
- **P2 BUG-018**: Swagger UI `/docs` page lacked table-of-contents navigation — previous BUG-016 fix switched from `StandaloneLayout` to `BaseLayout` which eliminated the navigation sidebar and topbar. Restored `StandaloneLayout` by loading `swagger-ui-standalone-preset.js` CDN script, adding `SwaggerUIStandalonePreset` to presets and `SwaggerUIBundle.plugins.DownloadUrl` to plugins. Added `filter: true` config option (default enabled) for search/filter bar. Topbar URL input hidden via targeted CSS (`.topbar .download-url-wrapper { display: none }`) while preserving overall layout structure.
- **P2 BUG-019**: OpenAPI response schemas lacked field-level descriptions and examples — `SchemaConverter.convertDSLString()` generated JSON Schema with type/constraints only, no `description` or `example`. Enhanced `SchemaConverter` to auto-generate human-readable descriptions from DSL semantics (e.g. `'string:1-50!'` → `"Required. String, 1-50 chars."`) and contextual example values for all base types (email → `"user@example.com"`, objectId → `"507f1f77bcf86cd799439011"`, date → `"2026-01-01T00:00:00Z"`, etc.).
- **P3 BUG-020**: Routes without `docs.responses` generated only a generic `$ref: SuccessResponse` — `OpenAPIGenerator.buildOperation()` now auto-infers response schema from `validate.body` for POST/PUT/PATCH routes (201 for POST, 200 for PUT/PATCH), with auto-generated example values extracted from schema properties. All routes with `validate` now also receive an automatic `400 Validation error` response. All routes receive an automatic `500 Internal server error` response.

### Changed
- **Pretty mode output format**: Development logs now default to single-line format with structured fields appended as `{"key":value}` (was multi-line with each field on its own indented line). This significantly reduces log noise during development. Users who prefer the original multi-line format can set `logger.prettySingleLine: false`.
- Test infrastructure: added `test/setup.ts` with `process.setMaxListeners(30)` to suppress `MaxListenersExceededWarning` during parallel test runs (cold-restarter / build-compiler / cluster tests fork multiple child processes that each register process event listeners, exceeding the default limit of 10).
- Test infrastructure: `cold-restarter.test.ts` worker script now handles IPC `{ type: 'shutdown' }` messages (mirrors real vext subprocess behavior on Windows). Fixed 2 previously flaky tests: timing tolerance increased for `safeKill` slow-shutdown test (`< 3000` → `< 3100`), and `onChildExit` guard now works correctly with IPC-based shutdown on Windows.
- **DEV-001**: Hot-reload file watcher debounce default changed from `100ms` to `0` (disabled by default). File changes now trigger reload immediately with no delay. Users who want to merge rapid consecutive saves into a single reload can re-enable debounce via `--debounce <ms>` CLI flag or the `VEXT_DEV_DEBOUNCE=<ms>` environment variable. Updated `file-watcher.ts`, `dev.ts`, `README.md`, and `website/docs/guide/hot-reload.md` to reflect the new default.
- **SCAFFOLD-001**: `vext create` project scaffold now generates `src/config/production.ts` in addition to `src/config/default.ts`. The production config sets `port: 3001`, separating the default dev port (3000) from the default production port (3001) to avoid accidental port conflicts when running both environments on the same machine.
- **OPENAPI-001**: `OpenAPIEndpointConfig` gains `filter?: boolean` option (default `true`). Both `bootstrap.ts` and `dev-bootstrap.ts` now pass `filter` from `config.openapi.filter` to `registerOpenAPIRoutes()`.
- **OPENAPI-002**: `vext-test/src/routes/users.ts` upgraded with comprehensive `docs.responses` definitions (schema + description + example) for all 6 endpoints — serves as best-practice reference for OpenAPI documentation in vext projects.
- **OPENAPI-003**: `SchemaConverter` refactored to delegate DSL→JSON Schema conversion to `schemaAdapter` (schema-dsl anti-corruption layer) — removed duplicated `parseDSLCore()` / `parseBaseType()` / `parseTypeWithRange()` private methods. Core type parsing, constraint mapping, and enum handling now use `schemaAdapter.compileField(dsl).toSchema()` with schema-dsl internal markers (`_required`, `_customMessages`, `_label`, `exactLength`, `alphanum`, etc.) automatically cleaned. OpenAPI-specific `description` and `example` enrichment retained as post-processing in `buildDescription()`, `humanTypeName()`, and `inferExample()`.
- **OPENAPI-004**: Dual documentation UI endpoints — `/docs` now serves Redoc (left-side multi-level TOC navigation, three-panel layout with code examples), `/swagger` serves Swagger UI (interactive "Try it out"). New `doc-endpoints.ts` module provides `registerDocEndpoints()` as unified entry point replacing `registerOpenAPIRoutes()`. New `redoc-ui.ts` module generates Redoc HTML with CDN loading (Redoc v2.1.5). New types: `RedocConfig`, `DocEndpointsConfig` with `ui: 'both' | 'redoc' | 'swagger'` option. Both `bootstrap.ts` and `dev-bootstrap.ts` updated to use `registerDocEndpoints()`.

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
| [0.1.5] | 2026-03-09 | Minor | Scalar API Reference + OpenAPI pipeline + multi-level routing docs + schema-dsl delegation + 12 bug fixes |
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

[Unreleased]: https://github.com/vextjs/vext/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/vextjs/vext/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/vextjs/vext/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/vextjs/vext/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vextjs/vext/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vextjs/vext/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vextjs/vext/releases/tag/v0.1.0
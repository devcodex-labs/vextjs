# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 📂 **Detailed changelogs**: See the [`changelogs/`](./changelogs/) directory for full release notes per version.
> This file serves as a version overview index for quick browsing of release history.

---

## Version History

| Version | Date | Type | Key Theme |
|---------|------|------|-----------|
| [Unreleased] | — | — | v1 source adaptation for side-effect-free schema-dsl v3 and monsqlize 3.1 [查看](./changelogs/unreleased.md) |
| [0.3.26] | 2026-06-15 | Patch | Built-in frontend runtime plus schema-dsl ESM/CJS custom type registry compatibility [查看](./changelogs/v0.3.26.md) |
| [0.3.25] | 2026-06-13 | Patch | Logger wrapper normalization, release-chain latest runtime dependencies, and documentation theme/version convergence [查看](./changelogs/v0.3.25.md) |
| [0.3.24] | 2026-06-11 | Patch | Logger pretty level labels can opt into ANSI color while JSON output stays color-free [查看](./changelogs/v0.3.24.md) |
| [0.3.23] | 2026-06-10 | Patch | Stabilize cold-restarter SIGKILL fallback and publish the startup log modes release [查看](./changelogs/v0.3.23.md) |
| [0.3.22] | 2026-06-10 | Patch | Startup log modes keep dev/start default output minimal while preserving opt-in profiling and cluster ready totals [查看](./changelogs/v0.3.22.md) |
| [0.3.21] | 2026-06-10 | Patch | Dev fast-ready tooling removes `ts-morph`, moves generated types under `.vext/`, and adds startup profiling / manifest cache paths [查看](./changelogs/v0.3.21.md) |
| [0.3.20] | 2026-06-09 | Patch | Direct runtime and development dependencies pinned to exact versions for deterministic consumer installs [查看](./changelogs/v0.3.20.md) |
| [0.3.19] | 2026-06-08 | Patch | Default logger moves to Vext internal zero-runtime-dependency kernel; direct logger package dependencies removed [查看](./changelogs/v0.3.19.md) |
| [0.3.18] | 2026-06-07 | Patch | Dependency cleanup: Node.js `>=20.19.0`, optional Koa router peer, and controlled MongoDB memory server test binaries [查看](./changelogs/v0.3.18.md) |
| [0.3.17] | 2026-06-05 | Patch | `app.throw` supports JSON-safe `details`; `app.hooks` adds request/validation/response/fetch/service/plugin/OpenAPI lifecycle hooks [查看](./changelogs/v0.3.17.md) |
| [0.3.16] | 2026-06-04 | Patch | `config.server` adds inbound Node.js HTTP server timeout/header controls [查看](./changelogs/v0.3.16.md) |
| [0.3.15] | 2026-06-04 | Patch | `app.fetch.proxy` adds config-driven upstream passthrough; package metadata remains Apache-2.0 [查看](./changelogs/v0.3.15.md) |
| [0.3.14] | 2026-06-04 | Patch | 响应缓存承接 `response-cache-kit@1.2.0` 的 `cacheHub` 运行时配置，支持 Redis/MultiLevel/lease/distributed 并补齐关闭生命周期 [查看](./changelogs/v0.3.14.md) |
| [0.3.13] | 2026-06-03 | Patch | 路由级响应缓存运行时接入 `response-cache-kit`，补齐标签失效、租户隔离和并发击穿保护 [查看](./changelogs/v0.3.13.md) |
| [0.3.12] | 2026-06-02 | Patch | OpenAPI schema fields now support business descriptions via schema-dsl `.description()` [查看](./changelogs/v0.3.12.md) |
| [0.3.11] | 2026-06-01 | Patch | 补齐 `vext create` 规范目录骨架，并将根 README 切换为英文主版本 [查看](./changelogs/v0.3.11.md) |
| [0.3.10] | 2026-06-01 | Patch | 文档与 runtime 契约同步：统一 validation `422`、补齐 `honoAdapter()` 导出，并校准 benchmark/middleware/config 文档口径 [查看](./changelogs/v0.3.10.md) |
| [0.3.9] | 2026-06-01 | Patch | Native adapter 接入 route-core 后继续收口 benchmark 口径与 params 热路径性能，并补充 release format gate 策略 [查看](./changelogs/v0.3.9.md) |
| [0.3.8] | 2026-05-31 | Patch | 发布前收口：补齐 adapter/body-limit/cluster 验证闭环，移除 npm 包 sourcemap 产物，并同步 vext-test 外部消费者验证 [查看](./changelogs/v0.3.8.md) |
| [0.3.7] | 2026-05-21 | Patch | `vext dev` 补齐 preflight 诊断与 typegen 自动生成：阻断 TS 错误热重载、补全 reload 堆栈，并移除脚手架静态 services 类型声明 [查看](./changelogs/v0.3.7.md) |
| [0.3.6] | 2026-05-16 | Patch | 项目级 `preload/` 目录正式落地：补齐 TS preload、`build` / built 模式联动、`fs.watch` 动态监听与消费者验收闭环 [查看](./changelogs/v0.3.6.md) |
| [0.3.5] | 2026-05-15 | Patch | README 与 OpenTelemetry 文档对齐当前 preload / exporter / capture 模型，并完成一轮发版前全链路验证 [查看](./changelogs/v0.3.5.md) |
| [0.3.4] | 2026-05-13 | Patch | 插件类型边界收口：新增 `VextPluginContext`，修复 linked workspace 下的重复类型冲突，并补齐 typegen/文档/验证链路 [查看](./changelogs/v0.3.4.md) |
| [0.3.3] | 2026-05-06 | Patch | ts-morph 开发辅助能力二期收口：新增 `services.manifest.json`，并完成 `typegen + doctor routes + inspect/manifest` 双轨稳定消费层 [查看](./changelogs/v0.3.3.md) |
| [0.3.2] | 2026-04-28 | Patch | 启动体验与远程配置优化：新增 bootstrap config provider、端口冲突策略、生命周期日志分层，并补齐 lint、测试与文档验证 [查看](./changelogs/v0.3.2.md) |
| [0.3.1] | 2026-04-27 | Patch | Plugin Loader ESM-only 兼容修复：支持 import-only 根包与 `pkg/subpath`，修复 `vextjs-nacos` 在 dev CJS 插件中的加载失败 [查看](./changelogs/v0.3.1.md) |
| [0.3.0] | 2026-04-26 | Minor | MonSQLize 链式访问 API：`app.db.pool(name)` / `app.db.use(db)` + Depth-2 目录路由 + 双键回落策略 + VextModelDefinition `key` 别名双注册 + **⚠️ Breaking: `db()` 已移除** [查看](./changelogs/v0.3.0.md) |
| [0.2.11] | 2026-04-24 | Minor | 内置 multipart/form-data 解析（zero-dep，Node.js `Request.formData()`）+ `req.files` + `_getRawBodyBuffer()` 正式类型 + OpenAPI multipart 生成 [查看](./changelogs/v0.2.11.md) |
| [0.2.10] | 2026-04-21 | Patch | dev 模式堆栈路径修复：移除 `sourceRoot` 配置，sourcemap 路径不再缺失项目目录段 [查看](./changelogs/v0.2.10.md) |
| [0.2.9] | 2026-04-13 | Patch | MonSQLize 依赖升级至 `^1.2.1`（msq.model() 实例缓存 + 索引去重）[查看](./changelogs/v0.2.9.md) |
| [0.2.8] | 2026-04-13 | Patch | dev 模式子目录 i18n 未加载修复（dev-bootstrap Mode B 回退缺失）[查看](./changelogs/v0.2.8.md) |
| [0.2.7] | 2026-04-13 | Patch | monsqlize 依赖升级至 `^1.2.0`，确保 `findPage` projection 在 vext 应用中正确生效 [查看](./changelogs/v0.2.7.md) |
| [0.2.6] | 2026-04-13 | Patch | GitHub Actions CI/CD + OpenTelemetry 文档全面重写 + setLogger API 文档 + 社区模板 [查看](./changelogs/v0.2.6.md) |
| [0.2.5] | 2026-04-13 | Patch | error-handler 日志注入 + dev-bootstrap 中间件条件注册对齐 + Dev Error Overlay + logErrors 配置文档 [查看](./changelogs/v0.2.5.md) |
| [0.2.4] | 2026-04-02 | Patch | vext.preload 自动注入：CLI start/dev/cluster 自动透传插件 --import 参数，零配置启动 [查看](./changelogs/v0.2.4.md) |
| [0.2.3] | 2026-03-31 | Patch | 原生 OpenTelemetry 支持：req.route / logger.mixin / ALS trace fields（208 项 E2E 验证）[查看](./changelogs/v0.2.3.md) |
| [0.2.2] | 2026-03-25 | Patch | Scalar JS 本地资产自动安装与本地服务（OPENAPI-013）+ exports 双策略解析修复（BUG-FIX-001）|
| [0.2.1] | 2026-03-21 | Patch | OpenAPI tagGroups 自动推断 + 多级目录路由支持 + Model softDelete/versioning |
| [0.2.0] | 2026-03-20 | Minor | MonSQLize 内置插件 + 路由级响应缓存 + Model CRUD API + 204 项 E2E 验证 |
| [0.1.9] | 2026-03-19 | Patch | Article Model + softDelete + versioning + 多轮审查修复 |
| [0.1.8] | 2026-03-19 | Patch | 脚手架版本硬编码修复 (BUG-030) + 发版流程漏洞堵塞 |
| [0.1.7] | 2026-03-17 | Minor | Model Hot Reload (DEV-001) + Route Cache Fix (BUG-029) |
| [0.1.6] | 2026-03-12 | Patch | MonSQLize 集成修复 (BUG-023~027) |
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

[Unreleased]: https://github.com/vextjs/vext/compare/v0.3.26...HEAD
[0.3.26]: https://github.com/vextjs/vext/compare/v0.3.25...v0.3.26
[0.3.25]: https://github.com/vextjs/vext/compare/v0.3.24...v0.3.25
[0.3.24]: https://github.com/vextjs/vext/compare/v0.3.23...v0.3.24
[0.3.23]: https://github.com/vextjs/vext/compare/v0.3.22...v0.3.23
[0.3.22]: https://github.com/vextjs/vext/compare/v0.3.21...v0.3.22
[0.3.21]: https://github.com/vextjs/vext/compare/v0.3.20...v0.3.21
[0.3.20]: https://github.com/vextjs/vext/compare/v0.3.19...v0.3.20
[0.3.19]: https://github.com/vextjs/vext/compare/v0.3.18...v0.3.19
[0.3.18]: https://github.com/vextjs/vext/compare/v0.3.17...v0.3.18
[0.3.17]: https://github.com/vextjs/vext/compare/v0.3.16...v0.3.17
[0.3.16]: https://github.com/vextjs/vext/compare/v0.3.15...v0.3.16
[0.3.15]: https://github.com/vextjs/vext/compare/v0.3.14...v0.3.15
[0.3.14]: https://github.com/vextjs/vext/compare/v0.3.13...v0.3.14
[0.3.13]: https://github.com/vextjs/vext/compare/v0.3.12...v0.3.13
[0.3.12]: https://github.com/vextjs/vext/compare/v0.3.11...v0.3.12
[0.3.11]: https://github.com/vextjs/vext/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/vextjs/vext/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/vextjs/vext/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/vextjs/vext/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/vextjs/vext/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/vextjs/vext/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/vextjs/vext/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/vextjs/vext/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/vextjs/vext/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/vextjs/vext/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/vextjs/vext/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/vextjs/vext/compare/v0.2.11...v0.3.0
[0.2.11]: https://github.com/vextjs/vext/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/vextjs/vext/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/vextjs/vext/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/vextjs/vext/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/vextjs/vext/compare/v0.2.6...v0.2.7
[0.2.5]: https://github.com/vextjs/vext/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/vextjs/vext/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/vextjs/vext/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/vextjs/vext/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/vextjs/vext/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/vextjs/vext/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/vextjs/vext/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/vextjs/vext/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/vextjs/vext/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/vextjs/vext/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/vextjs/vext/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/vextjs/vext/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/vextjs/vext/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vextjs/vext/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vextjs/vext/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vextjs/vext/releases/tag/v0.1.0

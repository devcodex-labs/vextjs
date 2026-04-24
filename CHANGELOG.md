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
| [Unreleased] | — | — | — |
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

[Unreleased]: https://github.com/vextjs/vext/compare/v0.2.11...HEAD
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

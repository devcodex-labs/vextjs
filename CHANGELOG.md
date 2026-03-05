# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 📂 **详细变更记录**：每个版本的完整说明请查看 [`changelogs/`](./changelogs/) 目录下对应文件。
> 本文件仅作版本概览索引，便于快速浏览版本历史。

---

## [Unreleased]

### Added
- `propagateHeaders` 功能实现 — `app.fetch` 现在正确透传入站请求中指定的自定义头（如 `x-trace-id`）到出站请求
- `RequestContextStore` 新增 `propagatedHeaders` 字段，由 request-id 中间件从入站请求捕获并写入
- 文档补充 `requestId` vs `traceId` 概念区分与使用指南

### Fixed
- **BUG-006 (P1)**：`config.fetch.propagateHeaders` 和 `VextFetchInit.propagateHeaders` 在 v0.1.3 中配置后不生效（`void extraHeaders` 空实现）

---

## [0.1.3] - 2026-03-05

> 📄 [详细变更记录 →](./changelogs/v0.1.3.md)

### Fixed
- **P0 BUG-004**: `config-loader` `deepMerge` 跳过 `middlewares` 键，用户中间件白名单丢失
- **P1 BUG-005**: `app.fetch` 在路由 handler 闭包中为 `undefined`（挂载顺序问题）
- **P1 BUG-003**: Windows 终端 hot-reload 日志 emoji 乱码 → ASCII 安全标记

### Changed
- Access log 开发模式改为紧凑单行格式

---

## [0.1.2] - 2026-03-05

> 📄 [详细变更记录 →](./changelogs/v0.1.2.md)

### Fixed
- **P0 BUG-001**: `vext dev` CJS/ESM 不兼容（ERR_REQUIRE_ESM）
- **P1 BUG-002**: 文档 `app.decorate()` → `app.extend()`

### Added
- 双包发布（ESM + CJS），支持 `require('vextjs')` 场景
- `VextPlugin` 新增 `onReady` / `onClose` 生命周期钩子

### Changed
- `VextServices` 索引签名 `unknown` → `any`（直接调用 service 方法，无需类型断言）
- `app.throw()` 第三参数支持 `string` 类型业务码

---

## [0.1.1] - 2026-03-05

> 📄 [详细变更记录 →](./changelogs/v0.1.1.md)

### Added
- `vext create` 交互式项目脚手架（支持 TS/JS × 5 种 adapter）
- 文档站上线（39 页 Rspress SSG：Guide 22 篇 + API 7 篇 + 示例 7 篇）
- GitHub Issues/PR 模板 + `CONTRIBUTING.md`
- `CHANGELOG.md`（本文件）

### Security
- 修复 `@hono/node-server` 授权绕过漏洞（GHSA-wc8c-qw6v-h7f6）
- 修复 `hono` Cookie 注入 / SSE 注入 / serveStatic 任意文件访问（GHSA-5pq2, GHSA-p6xx, GHSA-q5qw）

---

## [0.1.0] - 2026-03-04

> 📄 [详细变更记录 →](./changelogs/v0.1.0.md)

### 🎉 初始版本 — Phase 0 ~ Phase 3

**1,926 个测试，零回归，TypeScript strict 零错误。**

| Phase | 内容 | 测试数 |
|-------|------|:------:|
| Phase 0 | 骨架验证（核心类型 + Hono Adapter + bootstrap） | — |
| Phase 1 | MVP（配置 / 日志 / 中间件 6 个 / 服务 / 插件 / 路由 / i18n / app.fetch） | 1,066 |
| Phase 2A | 开发体验（`vext dev` Cold Restart + `vext build` + OpenAPI/Swagger） | +258 |
| Phase 2B | 热重载（Soft Reload Tier 1/2 + access-log + MemoryMonitor） | +183 |
| Phase 3 | 企业级（Cluster + Multi-Adapter 5 种 + MonSQLize 内置插件） | +420 |

**性能数据（Native Adapter，JSON 场景）**：Raw 94K RPS → Vext 71K RPS（overhead 25%）

---

## 版本历史速查

| 版本 | 日期 | 类型 | 核心主题 |
|------|------|------|---------|
| [Unreleased] | — | — | BUG-006 propagateHeaders 修复 + traceId 文档 |
| [0.1.3] | 2026-03-05 | Patch | BUG-004/005/003 关键 Bug 修复 |
| [0.1.2] | 2026-03-05 | Patch | BUG-001 dev 模式修复 + 双包 + 类型增强 |
| [0.1.1] | 2026-03-05 | Minor | CLI 脚手架 + 安全修复 + 文档站 |
| [0.1.0] | 2026-03-04 | Pre-release | 初始版本（Phase 0~3，1,926 测试） |

---

## 链接

- [GitHub Repository](https://github.com/vextjs/vext)
- [Issues](https://github.com/vextjs/vext/issues)
- [Contributing Guide](./CONTRIBUTING.md)
- [详细变更目录](./changelogs/)

[Unreleased]: https://github.com/vextjs/vext/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/vextjs/vext/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vextjs/vext/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vextjs/vext/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vextjs/vext/releases/tag/v0.1.0
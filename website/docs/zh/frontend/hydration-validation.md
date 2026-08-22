# Hydration 验证

Hydration 验证必须遵循 route policy。默认 `full` route 与 `hydration: "none"` route 都是有效页面，但它们预期的浏览器信号有意不同。

## 使用正确的检查方式

检查本仓库文档契约时，运行：

```bash
npm run verify:docs-contract
```

这个命令只检查文档一致性，不会启动应用，也不能证明浏览器行为。验证应用时，请使用应用支持的 build、start 和浏览器测试流程，分别访问一个 `full` route 与一个 `none` route。不要依赖仓库内部的 consumer 命令。

## 默认 `full` route

默认 policy 的生产 smoke 应检查：

- 页面返回 SSR HTML
- JS、CSS 和其他 assets 返回 2xx
- 没有浏览器 console 或 page errors
- 存在 route-specific `modulepreload`
- marker 到达 `data-vext-hydration="done"`
- 存在名为 `vext:hydration` 的 Performance entry
- 启用 `frontend.build.diagnostics.performanceReport` 时，`size-report.json` 包含 route metrics

## `hydration: "none"` route

`none` 页面应改为检查：

- 页面仍返回 SSR HTML、CSS 和 SEO metadata
- root 标记为 `data-vext-hydration="none"`
- 不输出 Vext browser entry、`__VEXT_DATA__` 或 `data-vext-route-preload`
- 普通 `<a>` 链接与普通 HTML `<form>` 使用普通 document navigation 或提交
- 测试不应期待 `done` marker、`vext:hydration` Performance entry、React 事件、Vext Form、fetcher 或框架管理的客户端导航

## Runtime Signals

默认 policy 的期望客户端信号：

```text
data-vext-hydration="done"
performance.measure("vext:hydration")
```

`hydration: "none"` 的有意信号是：

```text
data-vext-hydration="none"
```

这些信号用于测试和诊断，生产日志中应保持低噪音。

## 常见失败

| 失败                                 | 可能原因                                     |
| ------------------------------------ | -------------------------------------------- |
| 默认 route 的 JS 404                 | asset public path 或 static mount 不一致。   |
| 默认 route 没有 `done` marker        | client entry 未运行或过早失败。              |
| 在 `none` 页面期待 `done` 或 preload | 测试把默认 policy 信号套用到了错误模式。     |
| Hydration mismatch                   | SSR/client render 输出不确定。               |
| 默认 route 缺少 route preload        | render manifest 过旧，start 前需要 rebuild。 |

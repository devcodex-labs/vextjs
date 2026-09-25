# Hydration 验证

Hydration 验证必须遵循 route policy。默认 `full` route 与 `hydration: "none"` route 都是有效页面，但它们预期的浏览器信号有意不同。

## 使用正确的检查方式

以 [Hydration](./hydration) 中的两个 article 路由为对照，在已启用前端和 SSR 的应用根目录执行：

```bash
npm run build
npm start -- --port 3000
```

直接打开 `/article/interactive/intro` 与 `/article/intro`，分别验证下面的 full/none 条件。两者原始 HTML 都应含文章正文和 SEO title；前者点击后计数增加，后者保持 `Clicks: 0`，两者的普通 GET 表单和链接仍能工作。用浏览器开发工具检查 Console、Network、Elements 与 Performance；不能只看最终页面是否显示。验证结束后停止服务。

以下 full 检查以 SSR 正常完成为前提；关闭 SSR、`clientOnly: true` 或错误后的客户端 fallback 需另看 [CSR 空 shell 的当前限制](./csr-and-spa-fallback#空-shell-的当前限制)，不能因为 React 恢复显示就判为无错误通过。

## 默认 `full` route

默认 policy 的生产 smoke 应检查：

- 页面返回 SSR HTML
- JS、CSS 和其他 assets 返回 2xx
- 没有浏览器 console 或 page errors
- 存在 route-specific `modulepreload`
- marker 到达 `data-vext-hydration="done"`
- 存在名为 `vext:hydration` 的 Performance entry
- 同时启用 `frontend.build.diagnostics.sizeReport` 与 `performanceReport` 时，构建输出目录的 `size-report.json` 包含 route metrics；仅启用后者不保证写出该文件

## `hydration: "none"` route

`none` 页面应改为检查：

- 页面仍返回 SSR HTML、CSS 和 SEO metadata
- root 标记为 `data-vext-hydration="none"`
- 不输出 Vext browser entry、`__VEXT_DATA__` 或 `data-vext-route-preload`
- 普通 `<a>` 链接与普通 HTML `<form>` 使用普通 document navigation 或提交
- 测试不应期待 `done` marker、`vext:hydration` Performance entry、React 事件、Vext Form 增强、fetcher 或框架管理的客户端导航；Vext Form 渲染出的原生 form 仍遵循 action/method

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

这些信号用于测试和诊断，生产日志中应保持低噪音。`done` 表示根 boundary 的 effect 已执行，Performance entry 还依赖浏览器 API；两者不能替代错误检查和真实交互，也不证明所有异步内容已经完成。

## 常见失败

| 失败                                 | 可能原因                                                                |
| ------------------------------------ | ----------------------------------------------------------------------- |
| 默认 route 的 JS 404                 | asset public path 或 static mount 不一致。                              |
| 默认 route 没有 `done` marker        | client entry 未运行或过早失败。                                         |
| 在 `none` 页面期待 `done` 或 preload | 测试把默认 policy 信号套用到了错误模式。                                |
| Hydration mismatch                   | SSR/client 输出不一致，或空 shell 仍走 hydrateRoot；见 CSR 页当前限制。 |
| 默认 route 缺少 route preload        | render manifest 过旧，start 前需要 rebuild。                            |

## 维护本仓库文档时

在框架仓库运行 `npm run verify:docs-contract` 检查文档合同。它不启动应用，不证明浏览器行为；应用读者使用上面的 build/start 和浏览器流程，无需依赖仓库内部 consumer 命令。

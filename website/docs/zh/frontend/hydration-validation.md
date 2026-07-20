# Hydration 验证

Hydration 验证证明构建出的页面能在真实浏览器工作，而不只是静态产物存在。

## 验证内容

完整的前端生产 smoke 应检查：

- 页面返回 HTML
- JS/CSS/assets 返回 2xx
- 无浏览器 console errors
- 无 page errors
- 存在 route-specific `modulepreload`
- hydration marker 到达 `done`
- 存在 `performance.measure("vext:hydration")`
- 启用 `frontend.build.diagnostics.performanceReport` 时，`size-report.json` 包含 route metrics

## 浏览器探针

外部消费者项目提供探针：

```bash
npm --prefix E:\Worker\vext-test run verify:frontend-performance
```

它会构建应用，启动生产服务，用 Playwright 打开页面，记录网络失败，读取 DOM marker 和 Performance API，最后关闭服务。

## Runtime Signals

期望客户端信号：

```text
data-vext-hydration="done"
performance.measure("vext:hydration")
```

这些信号用于测试和诊断，生产日志中应保持低噪音。

## 常见失败

| 失败                  | 可能原因                                     |
| --------------------- | -------------------------------------------- |
| JS 404                | asset public path 或 static mount 不一致。   |
| 没有 hydration marker | client entry 未运行或过早失败。              |
| Hydration mismatch    | SSR/client render 输出不确定。               |
| 缺少 route preload    | render manifest 过旧，start 前需要 rebuild。 |

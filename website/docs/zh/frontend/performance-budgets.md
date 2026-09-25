# 性能预算

性能预算在构建时限制前端产物字节数。它不测量真实设备的 hydration 耗时、网络延迟或交互性能；这些仍需浏览器验证。以下以已启用前端的应用为前提。

## Size Report

`frontend.build.diagnostics.sizeReport` 默认开启。生产构建默认写入下列文件；自定义 outDir 时以实际目录为准，开发构建默认位于 `.vext/client`：

```text
dist/client/size-report.json
```

报告包含：

- raw size
- gzip size
- brotli size
- initial JS
- route initial JS
- app-owned assets
- 本地产物的分组与来源，以及路由记录中的 external URL 列表

顶层 `initialJs*` 选取 **raw JS 字节最大的页面** 的首载闭包及其 gzip/brotli 值，不是分别选每种压缩指标的最大值；闭包包含 browser entry 的静态依赖和该页面/layout 所需 chunk，在动态 import 处停止追踪其他延迟入口。每页的闭包请查看 `routes[]`，其 page 标识不等于具体业务 URL。

当前 `appOwnedInitialJsBrotliBytes` 统计本地输出 JS 闭包，包含打包进来的第三方代码，并非只统计业务源码。外部 runtime URL 不会被下载测量，远程依赖成本不包含在这些本地字节中。`total*` 基于 deploy manifest 选中的资源，改变 upload include/exclude 也会影响总量口径。

同时开启 `sizeReport` 和 `frontend.build.diagnostics.performanceReport` 后，文件保留路由级 initial JS 指标；后者默认也开启。关闭 performanceReport 时，SSR preload 所需 metadata 仍写入 `render-manifest.json`，但持久化报告不保留路由级字节指标。关闭报告输出不等于关闭预算：构建器先计算和检查预算，再决定写出哪些报告。

## 预算字段

```ts
// 合并到 src/config/default.ts，保留其他配置
export default {
  frontend: {
    enabled: true,
    build: {
      diagnostics: { sizeReport: true, performanceReport: true },
      budgets: {
        warnOnly: true,
        maxInitialJsBrotliBytes: 60_000,
        maxRouteInitialJsBrotliBytes: 80_000,
        maxAppOwnedInitialJsBrotliBytes: 40_000,
      },
    },
  },
};
```

数值只是演示阈值，应按实际报告制定。所有字节阈值默认 `0`（不启用）；`warnOnly` 默认 `false`，启用阈值后超限会使构建失败。上例显式使用告警模式，允许先观察基线。

| 字段                                                                      | 判定对象                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------- |
| `maxAssetBytes`                                                           | deploy manifest 中每个资源的 raw 字节           |
| `maxInitialJsBytes` / `maxInitialJsGzipBytes` / `maxInitialJsBrotliBytes` | 上述顶层首载指标                                |
| `maxRouteInitialJsBrotliBytes`                                            | 逐页检查首载 brotli；没有路由记录时退回顶层指标 |
| `maxAppOwnedInitialJsBrotliBytes`                                         | 顶层本地输出闭包的 brotli 指标                  |
| `maxTotalBytes`                                                           | deploy manifest 所选资源的 raw 总字节           |

压缩值由本地逐文件压缩计算，便于比较构建基线，不等于线上传输大小；框架不会因为计算了 brotli 指标就自动让服务器发送 Brotli 编码响应。启用逐页预算可避免只看 raw 最大页而遗漏另一个压缩后更大的页面。

## 修复预算失败

| 失败                  | 优先检查                                                   |
| --------------------- | ---------------------------------------------------------- |
| Initial JS 过大       | shared vendor chunk 和 app entry imports。                 |
| Route JS 过大         | 页面级 imports 与重型组件。                                |
| App-owned JS 过大     | 本地输出闭包，包括打包的第三方代码；检查能延后加载的模块。 |
| External runtime 缺失 | `externalRuntime` 映射和 CDN 可用性。                      |

## 推荐做法

产品快速变化时先用 warning 预算。Route baseline 稳定后，再在 release 分支改成阻断预算。

预算数字放在 config 中，而不是散落在 CI 脚本里，这样本地 build 和 CI 执行同一份契约。

## 验证预算

在应用根目录执行 `npm run build`，查看报告对应 page 和实际字节。告警模式超阈值应打印预算消息但成功完成；确认基线后将 `warnOnly` 改为 `false`，在测试配置中把一个已知非零指标的阈值调低，验证构建非零退出。失败时旧产物可能仍保留，不能把旧报告误认作失败候选的结果；根据错误中实际值定位，再恢复合理阈值重新构建。

最后按 [Hydration 验证](./hydration-validation)检查真实页面。外部 runtime 的网络成本与可达性按[代码拆分](./code-splitting)单独验证。

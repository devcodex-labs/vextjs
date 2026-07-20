# 性能预算

性能预算用于让 React hydration 路线可测、可控。

## Size Report

开启 `frontend.build.diagnostics.sizeReport` 后，Vext 会写入：

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
- external runtime groups

开启 `frontend.build.diagnostics.performanceReport` 后，报告还会包含路由级 initial JS 指标。关闭时，SSR route preload 所需 metadata 仍会写入 `render-manifest.json`，但构建报告不会保留路由级字节指标。

## 预算字段

```ts
frontend: {
  build: {
    budgets: {
      maxInitialJsBrotliBytes: 60_000,
      maxRouteInitialJsBrotliBytes: 80_000,
      maxAppOwnedInitialJsBrotliBytes: 40_000,
    },
  },
}
```

压缩后预算比 raw bytes 更接近真实传输成本。

## 修复预算失败

| 失败                  | 优先检查                                   |
| --------------------- | ------------------------------------------ |
| Initial JS 过大       | shared vendor chunk 和 app entry imports。 |
| Route JS 过大         | 页面级 imports 与重型组件。                |
| App-owned JS 过大     | 可在 hydration 后 lazy-load 的组件。       |
| External runtime 缺失 | `externalRuntime` 映射和 CDN 可用性。      |

## 推荐做法

产品快速变化时先用 warning 预算。Route baseline 稳定后，再在 release 分支改成阻断预算。

预算数字放在 config 中，而不是散落在 CI 脚本里，这样本地 build 和 CI 执行同一份契约。

# 渲染模式

Vext 支持混合全栈前端模型，同时避免服务端文件进入浏览器 bundle。

## 默认模式：SSR + Hydration

大多数页面应使用服务端渲染：

```text
route handler -> service data -> res.render() -> HTML -> hydration
```

首屏需要数据、SEO HTML、共享 layout 或鉴权判断时，优先使用该模式。

## Hydration 交互

SSR 后浏览器会 hydrate React tree。写入 document 的 props 和 locale messages 会被 client entry 复用。

需要排查 mismatch、测量 hydration 成本或优化首屏 JS 时，阅读 [Hydration](/zh/frontend/hydration)。

## 显式 CSR 子应用

client-router 子应用必须显式配置。只有需要浏览器 shell 的路径才配置 `frontend.spaFallback.scopes[]`。

```ts
frontend: {
  spaFallback: {
    scopes: [
      { basePath: "/app", page: "app/shell", ssr: false },
    ],
  },
}
```

适合高度交互的产品区域、后台控制台或嵌入式工具。它不是默认页面模型。

## Render Data 缓存

route response cache 可以缓存 `res.render()` 的 render payload：props、layoutData、messages、head 和 status。命中后，Vext 使用当前前端 manifest 重新渲染 HTML。

缓存 key、失效和 layoutData 规则见 [Render Data 与缓存](/zh/frontend/render-data-and-cache)。

## 如何选择

| 需求 | 推荐模式 |
|------|----------|
| 首屏需要服务端数据 | SSR + hydration |
| SEO 或公开内容 | SSR + hydration |
| 鉴权后台壳层 | SSR 入口，内部可局部 CSR |
| 高交互 client routing | 为该范围配置 `spaFallback.scopes[]` |
| 纯 API 服务 | 关闭 frontend |

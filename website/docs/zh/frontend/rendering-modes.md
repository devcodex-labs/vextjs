# 渲染模式

Vext 支持混合全栈前端模型，同时避免服务端文件进入浏览器 bundle。

## 默认模式：SSR + Hydration

大多数页面应使用服务端渲染：

```text
route handler -> service data -> res.render() -> HTML -> hydration
```

首屏需要数据、SEO HTML、共享 layout 或鉴权判断时，优先使用该模式。

默认的 `frontend.render.streaming: "buffered"` 路径使用 `renderToString`，并保留现有 fallback 行为。`frontend.render.timeoutMs` 会在同步 render 返回或抛错后检查。`fallback: "client"` 会返回客户端 shell；`fallback: "error"` 会把 SSR 错误交给正常错误链路。

## 可选 Streaming SSR

页面需要在延迟 boundary 完成前先发送 document shell 与 Suspense fallback 时，设置 `frontend.render.streaming: "auto"`：

```ts
export default {
  frontend: {
    render: {
      streaming: "auto",
      timeoutMs: 3000,
    },
  },
};
```

streaming 生命周期如下：

1. `res.render()` 登记页面渲染意图。发送首字节前，Vext 会冻结 status、headers、document head、nonce、initial assets 与 hydration payload。
2. 生成的 React renderer 启动 `renderToPipeableStream` 并等待 shell。
3. shell ready 后，Vext 先发送 document prefix，再 pipe React body，因此 Suspense fallback 可以早于延迟 boundary 到达客户端。
4. React 完成后，Vext 追加 document suffix 并关闭响应。

`frontend.render.timeoutMs` 会中止尚未完成的 streaming work。shell 前错误沿用现有错误响应链路；headers 或 body bytes 已发送后的错误会终止 stream，因为此时无法再替换 HTTP status 与 headers。客户端断开连接也会 abort React renderer。

Native、Hono、Fastify、Express、Koa 都支持该路径。它不包含 React Server Components、Server Functions 或 Server Actions、partial prerendering（PPR），也不引入 Webpack/Vite/Rollup/Rolldown 插件层；前端构建继续使用 esbuild。

## Streaming SSR 不等于 React Server Components

Streaming SSR 改善的是**何时发送 HTML**：路由可以在延迟 boundary 完成前先发送 document shell 和 Suspense
fallback。浏览器仍使用 Vext 路由拥有的 render payload 来 hydrate React tree。

[React Server Components](https://react.dev/reference/rsc/server-components)
是另一套 framework 与 bundler 模型，需要 server/client component 边界、server-component payload protocol，以及对关联
module graph 的框架支持。[Server
Functions](https://react.dev/reference/rsc/server-functions) 还要求 framework 为 client code 创建可调用的 server reference。
React 也明确说明，这些集成背后的 framework/bundler API 尚不具备普通 React API 同等的 minor-version 稳定性保证。

因此，Vext 有意保持当前契约更小且更明确：

- `src/routes/**` 拥有 URL 和 server data 边界。
- `res.render()` 拥有 HTML 生成、hydration data、headers 和 streaming lifecycle。
- `src/frontend/**` 保持为可知的 browser-safe graph，并由 esbuild 构建。
- route service、SSR、hydration、Suspense、Streaming SSR、static/revalidate freshness 和同一路由导航都可以使用，
  而不需要 Flight payload、`"use client"`/`"use server"` 分区或 action RPC contract。

这并不是说 RSC 不好，而是一个被支持的 release boundary：RSC 必须作为完整 framework contract，跨 development、
production artifact、cache semantics、security、browser runtime 和五个 adapter 一起评估。决策规则见
[前端边界与路线图](/zh/frontend/boundaries-and-roadmap)。

## 静态、再验证与 Client-only 页面

freshness 仍然是路由选项，不会创建第二套页面或路由 DSL。默认是 `mode: "dynamic"`。对已知路径使用 `mode: "static"` 和具体的 `staticParams`，可在构建期 materialize：

```ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/posts/:slug",
    {
      frontend: {
        mode: "static",
        staticParams: [{ slug: "hello" }, { slug: "release-notes" }],
        tags: ["posts"],
        staticBudget: { maxParams: 20, maxBytes: 2 * 1024 * 1024 },
      },
    },
    async (_req, res) => res.render("posts/detail"),
  );
});
```

对 persisted freshness entry 使用 `mode: "revalidate"` 和正数秒级 `revalidate` 间隔。Vext 会对并发刷新 single-flight、原子替换成功输出，并在刷新失败时保留 last-known-good 输出。`tags` 可用于显式 invalidation。`clientOnly: true` 保留 route、document、data 与 asset 行为，但有意不输出服务端 page body。这些策略不是 PPR。

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

| 需求                  | 推荐模式                            |
| --------------------- | ----------------------------------- |
| 首屏需要服务端数据    | buffered SSR，或可选 streaming SSR  |
| SEO 或公开内容        | buffered SSR，或可选 streaming SSR  |
| 鉴权后台壳层          | SSR 入口，内部可局部 CSR            |
| 高交互 client routing | 为该范围配置 `spaFallback.scopes[]` |
| 纯 API 服务           | 关闭 frontend                       |

# 渲染模式

Vext 支持混合全栈前端模型，同时避免服务端文件进入浏览器 bundle。

本页帮助已完成[全栈快速开始](/zh/frontend/getting-started)的项目选择渲染策略。以下模式均以 `frontend.enabled: true` 为前提；路由 URL 与页面文件的对应关系见[路由与页面](/zh/frontend/routing-and-pages)。

## 默认模式：SSR + Hydration

大多数页面应使用服务端渲染：

```text
route handler -> service data -> res.render() -> HTML -> hydration
```

首屏需要数据、SEO HTML、共享 layout 或鉴权判断时，优先使用该模式。

默认的 `frontend.render.streaming: "buffered"` 路径使用 `renderToString`，并保留现有 fallback 行为。`frontend.render.timeoutMs` 会在同步 render 返回或抛错后检查。`fallback: "client"` 会返回客户端 shell；`fallback: "error"` 会把 SSR 错误交给正常错误链路。

这是配置解析器的默认值；全栈脚手架显式使用 `streaming: "auto"`。同步渲染的 timeout 不是能够抢占 CPU 的硬超时。

## 可选 Streaming SSR

页面需要在延迟 boundary 完成前先发送 document shell 与 Suspense fallback 时，设置 `frontend.render.streaming: "auto"`：

```ts
export default {
  frontend: {
    enabled: true,
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

`frontend.render.timeoutMs` 会中止尚未完成的 streaming work。shell 前错误通过错误页渲染路径返回 HTML；headers 或 body bytes 已发送后的错误会终止 stream，因为此时无法再替换 HTTP status 与 headers。客户端断开连接也会 abort React renderer。

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

freshness 仍然是路由选项，不会创建第二套页面或路由 DSL。默认是 `mode: "dynamic"`。对公开的已知路径使用 `mode: "static"`、显式 `page` 和具体的 `staticParams`，可在构建期生成 HTML 与数据文件。创建下面两个文件：

```ts
// src/routes/posts.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/:slug",
    {
      validate: { param: { slug: "string" } },
      frontend: {
        mode: "static",
        page: "posts/detail",
        staticParams: [{ slug: "hello" }, { slug: "release-notes" }],
        tags: ["posts"],
        staticBudget: { maxParams: 20, maxBytes: 2097152 },
      },
    },
    (req, res) => res.render("posts/detail", { params: req.valid("param") }),
  );
});
```

```tsx
// src/frontend/pages/posts/detail.tsx
export default function PostPage(props: { params: { slug: string } }) {
  return <main>Post: {props.params.slug}</main>;
}
```

构建器直接以 `{ params }` 调用页面渲染器，不执行 route handler、认证中间件或 service 查询。`frontend.page` 指定静态生成目标，不能假定它会从任意 `res.render()` 调用中推断。若页面依赖 handler 注入的用户数据或数据库结果，应使用动态 SSR，或先把公开内容做成可由页面安全读取的构建输入。构建期产物与线上 route freshness 缓存是两条路径，不应把静态生成当作“提前请求整个业务接口”。

对运行时持久化的 freshness entry 使用 `mode: "revalidate"` 和正数秒级 `revalidate` 间隔。Vext 对并发刷新使用 single-flight、原子替换成功输出，并在刷新失败时保留 last-known-good 输出。该存储只复用公开 GET/HEAD 的 render payload，已认证或带 session 的请求绕过它。服务端可通过 `invalidateFrontendFreshness(rootDir, { tag })` 失效对应 tag；浏览器 `revalidate()` 则操作浏览器导航缓存，两者不要混用。缓存细节见 [Render Data 与缓存](/zh/frontend/render-data-and-cache)。

`clientOnly: true` 保留 route、document、data 与 asset 行为，但不输出服务端 page body。这些策略不是 PPR。当前浏览器入口仍对空 body 使用 `hydrateRoot`，可能报告 mismatch 后恢复渲染，不能作为无错误的 CSR 能力通过验收；适用范围也包括关闭 SSR 和 buffered client fallback。当前推荐保留 SSR，具体限制及对照验证见 [CSR 与 SPA Fallback](/zh/frontend/csr-and-spa-fallback#空-shell-的当前限制)。

## 纯服务端 HTML，不加载 Hydration

某个 SSR 页面只应发送 HTML 与 CSS、不加载 Vext/React 浏览器 runtime 时，使用既有路由策略：

下面是已有 `defineRoutes` 工厂内部的路由片段，假设 `src/frontend/pages/legal/terms.tsx` 已提供默认导出的页面组件；路径仍需遵循所在路由文件的前缀。

```ts
app.get(
  "/legal/terms",
  {
    frontend: {
      hydration: "none",
      seo: { title: "服务条款", description: "当前服务条款" },
    },
  },
  async (_req, res) => res.render("legal/terms"),
);
```

响应仍是完整 SSR document：保留页面 body、框架生成的 SEO、CSS 与 `_document.html` 中用户编写的 script，但省略 hydration data、Vext browser entry、React/Vext external-runtime import 和路由 JS preload。进入或离开该路由都使用完整 document 请求；static 模式只写 HTML，不生成 `__vext.page.json` sidecar。

`hydration: "none"` 要求 SSR，不能与 `clientOnly: true`、全局关闭 SSR 或单次 render 的 `ssr: false` 组合；当前策略也关闭流式输出。它是页面级策略，不是 Selective/Partial Hydration、Islands 架构或 PPR。

## Hydration 交互

SSR 后浏览器会 hydrate React tree。写入 document 的 props 和 locale messages 会被 client entry 复用。

需要排查 mismatch、测量 hydration 成本或优化首屏 JS 时，阅读 [Hydration](/zh/frontend/hydration)。

## 显式 CSR 子应用

client-router 子应用必须显式配置。只有需要浏览器 shell 的路径才配置 `frontend.spaFallback.scopes[]`。

在既有配置中合并以下字段，并先创建 `app/shell` 页面，完整流程见 [CSR 与 SPA Fallback](/zh/frontend/csr-and-spa-fallback)：

```ts
export default {
  frontend: {
    enabled: true,
    spaFallback: {
      scopes: [{ basePath: "/app", page: "app/shell", ssr: false }],
    },
  },
};
```

适合高度交互的产品区域、后台控制台或嵌入式工具。它不是默认页面模型。

## Render Data 缓存

route response cache 可以缓存 `res.render()` 的 render payload：props、layoutData、messages、head 和 status。命中后，Vext 使用当前前端 manifest 重新渲染 HTML。

缓存 key、失效和 layoutData 规则见 [Render Data 与缓存](/zh/frontend/render-data-and-cache)。

## 如何选择

| 需求                    | 推荐模式                            |
| ----------------------- | ----------------------------------- |
| 首屏需要服务端数据      | buffered SSR，或可选 streaming SSR  |
| SEO/公开内容且不需要 JS | SSR + `hydration: "none"`           |
| SEO/公开内容且需要交互  | buffered SSR，或可选 streaming SSR  |
| 鉴权后台壳层            | SSR 入口，内部可局部 CSR            |
| 高交互 client routing   | 为该范围配置 `spaFallback.scopes[]` |
| 纯 API 服务             | 关闭 frontend                       |

## 验证所选模式

本页静态示例执行 `npm run build` 后，检查默认输出目录 `dist/client/posts/hello/index.html` 和 `dist/client/posts/release-notes/index.html`：应分别包含对应 slug；`static-manifest.json` 应列出两条路径及其数据文件。缺少页面映射、缺少动态参数或超过 `staticBudget` 时应修正配置后重新构建。启动 `npm start -- --port 3000` 后，再验证 `/posts/hello` 的运行时输出；结束后停止服务。流式首字节、无 hydration 和 CSR 的不同观察方法分别见 [SSR](/zh/frontend/ssr)、[Hydration 验证](/zh/frontend/hydration-validation)与 [CSR](/zh/frontend/csr-and-spa-fallback)。

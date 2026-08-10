# 边界与路线图

本页区分当前前端目标和后续能力方向。

## 当前目标

当前 Vext 前端方向是：

- `src/frontend/**` 作为用户前端源码根
- `src/routes/**` 作为 URL 和服务端数据入口
- `res.render(page, props?, options?)`
- React 19 SSR + hydration
- 通过 `frontend.render.streaming: "auto"` 可选启用 Streaming SSR；默认仍为 `"buffered"`
- 通过 `Link`、`Form`、fetcher 与 revalidation 复用同一路由，并支持 history、公共 layout 持久化、scroll/focus 恢复和 document fallback
- 通过 `staticParams`、tags、single-flight、原子替换和 last-known-good recovery 提供 route-side static、revalidate 与 client-only freshness
- 嵌套 layout chain
- 默认错误页与 `renderError()`
- Vext JSCSS + CSS/CSS Modules
- `useVextI18n(locale?)` 前端多语言
- 开发期 Fast Refresh 与 render refresh
- esbuild-powered 生产构建
- route assets、代码拆分、size report、预算、deploy manifest、SRI、静态资源增量上传和本地图片/字体 media closure

## 版本边界

本专区描述当前 Vext 文档对应的前端能力。判断某个已安装包版本具体支持哪些前端功能时，以该版本 release notes 和 changelog 为准。

## API-only 项目

纯 API 项目仍是一等能力：

```bash
npx vextjs create my-api --template api --frontend none
```

也可以在配置中关闭：

```ts
export default {
  frontend: false,
};
```

## 外部前端适配

Vext 可以通过 `vextjs/frontend`、生成 API artifacts 和稳定 HTTP 边界支持外部前端框架。默认内置体验仍然是 Vext 自己管理的 full-stack React。

## 为什么 RSC 不是当前必需能力

React Server Components（RSC）不是 SSR、Suspense、SEO 或 streaming HTML 的同义词。Vext 已支持路由拥有的
server data、`res.render()`、React SSR + hydration，以及带 Suspense fallback 的可选
`frontend.render.streaming: "auto"`。这些能力已经覆盖本版本文档所定义的常规首屏 HTML、渐进渲染和可交互
browser runtime 路径。

RSC 引入的是另一套 framework-wide contract，而不是单个 component 功能：

1. 需要构建、版本化、缓存、失效，并与 browser entry 保持兼容的 server/client component graph 和 payload protocol。
2. development、Fast Refresh/HMR、production manifest、code splitting、deployment output 和 diagnostics 都必须理解这套
   graph 及其边界。
3. Server Functions / Server Actions 会增加可调用 server reference、mutation semantics、CSRF/auth/error 行为以及
   类 RPC transport 边界。
4. Native、Hono、Fastify、Express、Koa 都要能观察到同样行为，且不能削弱 Vext 的 route、adapter 或 HTTP contract。

[React RSC reference](https://react.dev/reference/rsc/server-components) 描述了这一独立的 server/component 环境；React
当前也建议 framework 作者在实现底层 bundler/framework API 时固定 React 版本或使用 Canary。这说明 RSC support
必须是 Vext 有意设计、可独立版本化的工作，不能从 React 19、SSR 或 `renderToPipeableStream` 的存在推断出来。

因此，当前不支持 RSC 是合理的产品与运维选择：保留一条 route-owned data path、一个可知的 browser-safe frontend
graph、稳定 HTTP semantics、esbuild pipeline 和更小的 deployment surface。团队并不会失去 SSR、hydration、Suspense、
streaming HTML、route-side freshness 或同一路由导航。未来若有 RSC 提案，必须在离开 non-goal 列表前定义其 payload、
cache、security、development、package、adapter 和 packed consumer acceptance contract。

## 后续方向

以下不属于首期承诺，但后续可独立评估：

- React Server Components
- Server Functions 与 Server Actions
- partial prerendering（PPR）
- 更深的外部前端框架适配

每个方向都需要独立需求、性能证据和兼容性复审，才能成为默认行为。

## 当前不做

- 把服务端 import 隐藏进浏览器 bundle
- 让页面文件自动创建路由
- 把全局 SPA fallback 当默认模式
- 默认把 SSR HTML 当静态资源上传
- 为静态资源上传把云厂商 SDK 放进 core
- 隐式抓取或代理远程图片，或下载远程字体
- 把 Streaming SSR 等同于 React Server Components、Server Functions、Server Actions 或 PPR
- 用 Webpack/Vite/Rollup/Rolldown 插件生态替换 esbuild 前端流水线
- 新增一套并行 loader/action route DSL 或函数 action RPC transport

---
role: specification
---

# 边界与路线图

本页规定当前前端的能力边界，并区分已实现、显式开启和待评估方向。适用于前端页面、服务端路由、构建和部署的维护者；操作步骤见[前端快速开始](/zh/frontend/getting-started)，问题定位见[排错](/zh/frontend/troubleshooting)。规则等级沿用[规范说明](/zh/specification/)。

## 当前能力

当前代码提供以下能力；是否生效还取决于具体配置与路由声明：

- 默认以 `src/frontend/**` 作为用户前端源码根，可由受支持的frontend配置调整
- `src/routes/**` 作为 URL 和服务端数据入口
- `res.render(page, props?, options?)`
- React 19 SSR + hydration
- 通过 `frontend.hydration: "none"` 提供路由级 SSR HTML，不加载 Vext/React hydration
- 通过 `frontend.seo` 提供框架级 SEO 元数据以及 build/runtime sitemap 和 robots
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

### 使用条件与不包含的能力

| 能力                          | 启用和使用条件                                                                         | 不应推断出的承诺                                              |
| ----------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| React SSR与hydration          | 启用前端、存在页面和render路由                                                         | 页面文件不会自动注册URL                                       |
| 无hydration文档               | 路由 `frontend.hydration: "none"`，要求SSR开启                                         | 不等于Islands或局部hydration；应用自加脚本不会自动移除        |
| Streaming SSR                 | 配置 `frontend.render.streaming: "auto"`，要求有效SSR与完整hydration模式；默认buffered | 不等于RSC/Server Actions；hydration:none走非streaming文档路径 |
| 同路由客户端导航              | 使用Link/Form及兼容的页面协议与layout                                                  | 不满足协议时可以退回document导航                              |
| static/revalidate/client-only | 路由声明和对应构建/运行产物                                                            | 不是任意响应自动缓存，也不保证跨进程共享内存                  |
| 图片/字体处理                 | 本地输入和明确的media/deploy配置                                                       | 不默认下载远程图片或字体                                      |

当前还需按以下已验证限制选择实现路径：

- [CSR 空 shell](./csr-and-spa-fallback#空-shell-的当前限制)的浏览器入口仍使用 hydrateRoot，可能报 mismatch 后恢复显示；不能作为无错误 CSR 验证通过，优先保留 shell SSR。
- [CSS Modules](./styles-and-assets#css-modules)在默认生产 SSR 与浏览器构建间存在 class 命名不一致问题；当前 SSR 页面优先用普通 CSS 或 JSCSS。
- [图片 import](./styles-and-assets#import-型资源)的 loader 只在浏览器构建侧配置；SSR 注册页面应使用 Public URL 或基于媒体清单的 Image，关闭运行时 SSR 不取消服务端 bundle 构建。

## 路由与浏览器职责

<a id="vext-arch-008"></a>

### VEXT-ARCH-008 [MUST] URL与服务端数据由路由显式拥有

页面和layout文件负责渲染；HTTP入口由 `src/routes/**` 注册，route handler通过 `res.render()` 绑定页面和数据。不能把页面目录发现等同于URL注册，也不能额外假定存在并行loader/action路由模型。外部前端通过明确的HTTP合同消费服务。

<a id="vext-arch-009"></a>

### VEXT-ARCH-009 [MUST NOT] 浏览器依赖不得包含服务端专属模块

数据库、文件系统、服务端配置和service入口的工作留在服务端消费者中；route向页面传递需要的数据。共享目录名称不会使Node-only代码自动成为browser-safe。构建边界检查是验证手段，不能替代对实际依赖和传输数据的检查。

<a id="vext-arch-010"></a>

### VEXT-ARCH-010 [MUST] 按实际渲染与部署模式验证交付

buffered、streaming、hydration:none和客户端导航分别验证对应的HTML、脚本、请求和回退行为。生产使用匹配构建的manifest与资源；启用资源上传不等于自动上传所有SSR页面，不能把只有静态资源的CDN当成服务端运行时。部署操作见[构建与部署](/zh/frontend/build-and-deploy)。

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

这表示合同与扩展入口可供集成，不代表框架已内置所有第三方前端运行时适配。每个具体适配仍需核对render、客户端路由、错误与部署合同。

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

以下不属于当前已实现能力或已承诺排期，只是可以独立评估的方向：

- React Server Components
- Server Functions 与 Server Actions
- partial prerendering（PPR）
- Selective/Partial Hydration 与 Islands 架构
- 更深的外部前端框架适配

每个方向都需要独立需求、性能证据和兼容性复审，才能成为默认行为。

<a id="vext-arch-011"></a>

### VEXT-ARCH-011 [MUST NOT] 不得将规划方向写成当前使用合同

发布说明、操作指南和机器可读文档必须区分已实现与候选方向；React或底层工具具有某项API，不代表Vext已提供相应端到端能力。新能力进入正式使用文档前，核对其配置、类型、实现、构建产物与消费者验证结果。

## 当前不做

- 把服务端 import 隐藏进浏览器 bundle
- 让页面文件自动创建路由
- 把全局 SPA fallback 当默认模式
- 默认把 SSR HTML 当静态资源上传
- 为静态资源上传把云厂商 SDK 放进 core
- 隐式抓取或代理远程图片，或下载远程字体
- 把 Streaming SSR 等同于 React Server Components、Server Functions、Server Actions 或 PPR
- 把页面级 `hydration: "none"` 描述成 Selective Hydration、Islands 或 PPR
- 用 Webpack/Vite/Rollup/Rolldown 插件生态替换 esbuild 前端流水线
- 新增一套并行 loader/action route DSL 或函数 action RPC transport

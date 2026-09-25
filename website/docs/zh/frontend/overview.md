# 前端总览

## 目录导航

- [Vext Frontend 是什么](#vext-frontend-是什么)
- [创建全栈项目](#创建全栈项目)
- [项目结构](#项目结构)
- [第一个页面](#第一个页面)
- [当前能力](#当前能力)
- [阅读路径](#阅读路径)

## Vext Frontend 是什么

Vext Frontend 是 Vext 内置的 React 19 全栈页面能力。URL 入口仍然由 `src/routes/**` 定义；route handler 准备服务端数据后，通过 `res.render()` 渲染 `src/frontend/pages/**` 中的页面。

当同一个项目需要提供 API、服务端页面和浏览器交互时，可以使用内置前端。一次页面请求的基本路径是：

```text
浏览器 GET / → 服务端 route → 准备 props → res.render("index", props)
              → React 服务端 HTML → 浏览器 hydration（启用时）
```

页面组件也会参与 SSR，因此在渲染阶段直接访问 `window` 等浏览器全局对象可能失败。数据库和上游调用由 route/service 完成；传给页面的数据会暴露给浏览器，应只包含页面需要的内容。

纯 API 项目使用 `--template api --frontend none`。

## 创建全栈项目

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

前提是已安装符合当前 Vext 包要求的 Node.js 与 npm，版本条件见[通用快速开始](/zh/guide/quick-start)。默认生成 TypeScript 全栈 React 项目，并自动执行 `npm install`；安装失败或使用了 `--skip-install` 时，进入项目后先运行 `npm install` 再启动。

按终端打印的地址访问首页，默认是 `http://localhost:3000/`。需要纯 API 项目时：

```bash
npx vextjs create my-api --template api --frontend none
```

## 项目结构

下面是默认 TypeScript 全栈模板的主要文件；完整配置、类型和生成物见[项目结构](/zh/frontend/project-structure)。

```text
src/
  config/
    default.ts
  routes/
    index.ts
  services/
    example.ts
  frontend/
    pages/
      index.tsx
      layout.tsx
      _document.html
      error/
        default.tsx
    components/
      AppShell.tsx
    styles/
      index.css
    locales/
      en-US.ts
public/
  vext-mark.svg
  favicon.svg
```

关键边界是物理目录：

- `src/routes/**` 和 `src/services/**` 运行在服务端。
- `src/frontend/pages/**` 和 `src/frontend/components/**` 是 UI 源码，按渲染模式参与 SSR 和浏览器构建；页面文件本身不注册 URL。
- 不要在前端文件中 import services、数据库客户端、密钥或 Node-only 模块。
- `public/**` 用于固定路径静态文件，前端构建会复制并记录到部署清单；清单不等于已上传到 CDN。
- `src/frontend/assets/**`、更多语言文件和业务页面可按需添加，不是默认模板已经提供的文件。

## 第一个页面

在刚创建的全栈项目中，用下面两段完整内容替换首页组件和首页路由。它们不依赖额外的业务 service；原路由中的示例 API 会随整文件替换移除，需要时请保留对应 handler。

```tsx
// src/frontend/pages/index.tsx
export default function HomePage(props: { greeting: string }) {
  return <main>{props.greeting}</main>;
}
```

在 route 中渲染：

```ts
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => {
    res.render("index", { greeting: "Hello from Vext" });
  });
});
```

保存后访问 `/`，应看到 `Hello from Vext`。请求返回 HTML，页面中没有这段文字时，先看终端错误，并检查前端配置已启用及 page id 是否匹配；完整操作见[快速开始](/zh/frontend/getting-started)。

`res.render(page, props?, options?)` 三个参数含义如下：

| 参数      | 含义                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `page`    | `src/frontend/pages/**` 下的页面 id，不含扩展名。`admin/dashboard.tsx` 对应 `"admin/dashboard"`。                                  |
| `props`   | JSON-safe 的页面数据；常规 hydration 模式下会写入文档并在浏览器复用，不传数据库连接、函数或私有配置。                              |
| `options` | 本次渲染选项，例如 `status`、`head`、`ssr`、`layout`、`layoutData`、`messages`、`nonce`；路由级 freshness/hydration 声明另见专题。 |

## 当前能力

以下是专题覆盖的能力及主要条件；这些条件不能仅凭“React 19”或“默认模板”互相推导：

| 能力                               | 主要条件与边界                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| SSR、hydration、layout 与错误页    | 启用前端并显式绑定 render 路由；页面目录不自动生成 URL                                   |
| Streaming SSR                      | 全局默认是 `buffered`；全栈模板显式设置 `streaming: "auto"`，无 hydration 模式有独立限制 |
| 前端多语言                         | 需开启前端 i18n 并提供字典；模板只提供 `en-US`，不会自动翻译                             |
| Fast Refresh、render refresh       | 开发期能力，各有配置和适用范围                                                           |
| 代码拆分、样式、静态资源、性能预算 | 由前端构建产生资源和报告，预算需明确设置                                                 |
| CDN 上传、hydration 验证           | 需要部署目标或可访问的运行站点等前提，创建项目不会自动完成这些操作                       |
| 同路由导航、静态生成与重新验证     | 需使用相应页面协议、路由声明和产物；不等于 RSC 或 Server Actions                         |

详细能力边界及后续候选方向见[边界与路线图](/zh/frontend/boundaries-and-roadmap)。资源、浏览器包和服务端产物必须来自匹配的构建；部署静态资源不会替代 Vext 服务端进程。

## 阅读路径

左侧导航就是主地图，按概念、任务和参考三层组织。

| 需求                                        | 从这里开始                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 第一次跑通页面                              | [快速开始](/zh/frontend/getting-started)                                                            |
| 理解 URL 与页面归属                         | [路由与页面](/zh/frontend/routing-and-pages)                                                        |
| 选择 SSR、Hydration 或 CSR                  | [渲染模式](/zh/frontend/rendering-modes)                                                            |
| 把 service 数据传给页面                     | [数据流](/zh/frontend/data-flow)                                                                    |
| 组织嵌套壳层                                | [Layout 与组件](/zh/frontend/layouts-and-components)                                                |
| 排查 SSR 输出                               | [SSR](/zh/frontend/ssr)                                                                             |
| 为带 variants 或 CSS variables 的组件写样式 | [Vext JSCSS](/zh/frontend/jscss)                                                                    |
| 排查浏览器 attach / mismatch                | [Hydration](/zh/frontend/hydration)                                                                 |
| 构建 client-router 子应用                   | [CSR 与 SPA Fallback](/zh/frontend/csr-and-spa-fallback)                                            |
| 缓存 render 数据                            | [Render Data 与缓存](/zh/frontend/render-data-and-cache)                                            |
| 优化开发反馈                                | [Fast Refresh](/zh/frontend/fast-refresh) 与 [Render Refresh](/zh/frontend/render-refresh)          |
| 发布前端资源                                | [构建与发布](/zh/frontend/build-and-deploy) 与 [静态资源与 CDN](/zh/frontend/static-assets-and-cdn) |
| 控制 JS 大小                                | [代码拆分](/zh/frontend/code-splitting) 与 [性能预算](/zh/frontend/performance-budgets)             |
| 验证生产 hydration                          | [Hydration 验证](/zh/frontend/hydration-validation)                                                 |
| 查找配置字段                                | [配置](/zh/frontend/configuration)                                                                  |
| 查看当前边界                                | [边界与路线图](/zh/frontend/boundaries-and-roadmap)                                                 |

[前端集成页](/zh/guide/frontend) 连接后端指南与前端专区，并保留旧版链接。

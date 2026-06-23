# 前端总览

## 目录导航

- [当前能力](#当前能力)
- [Vext Frontend 是什么](#vext-frontend-是什么)
- [创建全栈项目](#创建全栈项目)
- [项目结构](#项目结构)
- [第一个页面](#第一个页面)
- [阅读路径](#阅读路径)

## 当前能力

本前端指南描述 Vext 当前内置前端能力：route 驱动 React 19 页面、SSR、hydration、嵌套 layout、前端多语言、Fast Refresh、render refresh、代码拆分、静态资源、CDN 上传、性能预算和 hydration 验证。

## Vext Frontend 是什么

Vext Frontend 是 Vext 内置的 React 19 全栈页面能力。URL 入口仍然由 `src/routes/**` 定义；route handler 准备服务端数据后，通过 `res.render()` 渲染 `src/frontend/pages/**` 中的页面。

当你希望一个 Vext 项目同时拥有 API routes、services、SSR、hydration、前端资源构建和生产静态服务时，使用默认前端能力即可。

纯 API 项目使用 `--template api --frontend none`。

## 创建全栈项目

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

默认脚手架就是全栈 React 项目。需要纯 API 项目时：

```bash
npx vextjs create my-api --template api --frontend none
```

## 项目结构

```text
src/
  routes/
    index.ts
    admin/
      dashboard.ts
  services/
    user.service.ts
  frontend/
    pages/
      index.tsx
      layout.tsx
      error/
        default.tsx
    components/
      UserCard.tsx
    styles/
      card.style.ts
      dashboard.module.css
    assets/
      logo.png
    locales/
      en-US.ts
      zh-CN.ts
public/
  favicon.svg
```

关键边界是物理目录：

- `src/routes/**` 和 `src/services/**` 运行在服务端。
- `src/frontend/pages/**` 和 `src/frontend/components/**` 会进入浏览器构建。
- 不要在前端文件中 import services、数据库客户端、密钥或 Node-only 模块。
- `public/**` 会复制到前端输出目录，也会进入 deploy manifest。

## 第一个页面

创建页面：

```tsx
// src/frontend/pages/index.tsx
export default function HomePage(props: { greeting: string }) {
  return <main>{props.greeting}</main>;
}
```

在 route 中渲染：

```ts
// src/routes/index.ts
export default (app) => {
  app.get("/", {}, async (req, res) => {
    const greeting = await app.services.example.greeting("Vext");
    res.render("index", { greeting });
  });
};
```

`res.render(page, props?, options?)` 三个参数含义如下：

| 参数 | 含义 |
|------|------|
| `page` | `src/frontend/pages/**` 下的页面 id，不含扩展名。`admin/dashboard.tsx` 对应 `"admin/dashboard"`。 |
| `props` | 可 JSON 序列化的服务端数据，会写入 SSR 文档并在 hydration 时复用。 |
| `options` | 渲染选项，例如 `status`、`head`、`layoutData`、`messages`、`nonce` 或页面级行为。 |

## 阅读路径

左侧导航就是主地图，按概念、任务和参考三层组织。

| 需求 | 从这里开始 |
|------|------------|
| 第一次跑通页面 | [快速开始](/zh/frontend/getting-started) |
| 理解 URL 与页面归属 | [路由与页面](/zh/frontend/routing-and-pages) |
| 选择 SSR、Hydration 或 CSR | [渲染模式](/zh/frontend/rendering-modes) |
| 把 service 数据传给页面 | [数据流](/zh/frontend/data-flow) |
| 组织嵌套壳层 | [Layout 与组件](/zh/frontend/layouts-and-components) |
| 排查 SSR 输出 | [SSR](/zh/frontend/ssr) |
| 排查浏览器 attach / mismatch | [Hydration](/zh/frontend/hydration) |
| 构建 client-router 子应用 | [CSR 与 SPA Fallback](/zh/frontend/csr-and-spa-fallback) |
| 缓存 render 数据 | [Render Data 与缓存](/zh/frontend/render-data-and-cache) |
| 优化开发反馈 | [Fast Refresh](/zh/frontend/fast-refresh) 与 [Render Refresh](/zh/frontend/render-refresh) |
| 发布前端资源 | [构建与发布](/zh/frontend/build-and-deploy) 与 [静态资源与 CDN](/zh/frontend/static-assets-and-cdn) |
| 控制 JS 大小 | [代码拆分](/zh/frontend/code-splitting) 与 [性能预算](/zh/frontend/performance-budgets) |
| 验证生产 hydration | [Hydration 验证](/zh/frontend/hydration-validation) |
| 查找配置字段 | [配置](/zh/frontend/configuration) |
| 查看当前边界 | [边界与路线图](/zh/frontend/boundaries-and-roadmap) |

旧 [前端集成页](/zh/guide/frontend) 只作为历史链接兼容入口保留。

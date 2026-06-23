# 前端总览

## 目录导航

- [当前状态](#当前状态)
- [Vext Frontend 是什么](#vext-frontend-是什么)
- [创建全栈项目](#创建全栈项目)
- [项目结构](#项目结构)
- [第一个页面](#第一个页面)
- [下一步阅读](#下一步阅读)

## 当前状态

本前端指南描述的是 Vext 内置前端能力正在开发中的目标用户体验。在下一次稳定版本明确发布这些能力前，请把本文中的 API 和目录约定视为实现目标，而不是已发布稳定 API。

## Vext Frontend 是什么

Vext Frontend 是 Vext 内置的 React 19 全栈页面能力。它不是一个独立前端框架，也不是基于 Vite 的封装。URL 入口仍然由 `src/routes/**` 定义；route handler 准备服务端数据后，通过 `res.render()` 渲染 `src/frontend/pages/**` 中的页面。

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

## 下一步阅读

- [项目结构](/zh/frontend/project-structure)：页面、组件、layout、样式、资源、多语言和生成文件放在哪里。
- [页面与渲染](/zh/frontend/pages-and-rendering)：route 驱动渲染、`res.render()`、SSR、hydration 和 SPA fallback 边界。
- [数据与 API 调用](/zh/frontend/data-and-api)：service 数据、render props、render 缓存复用、客户端 API 调用和生成契约。
- [Layout 与组件](/zh/frontend/layouts-and-components)：嵌套 layout、layoutData、后台壳层、公共组件和 SSR 安全组件规则。
- [样式与资源](/zh/frontend/styles-and-assets)：CSS、CSS Modules、Vext JSCSS、静态文件、import 资源、public 文件和 CDN 地址。
- [多语言](/zh/frontend/i18n)：语言解析、前端词典、`useVextI18n(locale)`、切换语言和缓存响应头。
- [错误页与 Document](/zh/frontend/errors-and-document)：默认错误页、`renderError()`、`_document.html`、HTML token、head 注入和 CSP nonce。
- [开发工作流](/zh/frontend/dev-workflow)：React Fast Refresh、CSS 更新、route render 刷新、整页刷新和泄漏诊断。
- [构建、发布与性能](/zh/frontend/build-deploy-performance)：构建产物、代码拆分、CDN 上传、预算、route assets 和 hydration 验证。
- [配置](/zh/frontend/configuration)：实用 `frontend` 配置示例和字段说明。
- [排错](/zh/frontend/troubleshooting)：常见初始化、渲染、导入、资源、hydration 和性能问题。
- [旧前端集成页](/zh/guide/frontend)：为历史链接保留的兼容入口。

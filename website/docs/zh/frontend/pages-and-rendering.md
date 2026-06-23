# 页面与渲染

## 目录导航

- [页面文件](#页面文件)
- [在 route 中渲染](#在-route-中渲染)
- [Services 与服务端数据](#services-与服务端数据)
- [Layouts](#layouts)
- [公共组件](#公共组件)
- [多语言](#多语言)
- [错误页面](#错误页面)
- [HTML Document](#html-document)

## 页面文件

页面放在 `src/frontend/pages/**`。

```text
src/frontend/pages/
  index.tsx                 -> res.render("index")
  dashboard.tsx             -> res.render("dashboard")
  admin/
    dashboard.tsx           -> res.render("admin/dashboard")
  error/
    default.tsx             -> 默认错误页面
```

Vext 会在 dev 和 build 阶段生成页面 registry。用户不需要手写浏览器入口文件。

## 在 route 中渲染

route 定义方式与 API route 保持一致。区别只是 handler 调用 `res.render()`，而不是 `res.json()` 或 `res.text()`。

```ts
app.get("/dashboard", {}, async (req, res) => {
  const profile = await app.services.users.current(req);
  const stats = await app.services.dashboard.summary(profile.id);

  res.render(
    "dashboard",
    { profile, stats },
    {
      head: {
        title: "Dashboard",
        meta: [{ name: "description", content: "Team dashboard" }],
      },
    },
  );
});
```

服务端模块只留在 route handler 内。浏览器 bundle 只接收序列化后的 props。

## Services 与服务端数据

在 `src/routes/**` 中调用 services，不要在 `src/frontend/**` 中调用。

```ts
app.get("/admin", { cache: { ttl: 30_000 } }, async (req, res) => {
  const user = await app.services.auth.requireUser(req);
  const menu = await app.services.admin.menu(user.id);

  res.render("admin/dashboard", { user }, { layoutData: { menu } });
});
```

route 启用响应缓存时，`res.render()` 会缓存该 route 的 render payload。命中缓存后，Vext 仍会用当前 renderer 重新生成 HTML，因此 JS/CSS 继续保持 content hash 和 CDN 友好。

## Layouts

layout 是 `src/frontend/pages/**` 下命名为 `layout.tsx` 的普通 React 文件。

```text
src/frontend/pages/
  layout.tsx
  admin/
    layout.tsx
    dashboard.tsx
```

`admin/dashboard` 可以先套根 layout，再套 `admin/layout.tsx`。多个路由分支复用同一外壳时，把共享 UI 抽到 `src/frontend/components/**`。

服务端准备的 layout 数据通过 `options.layoutData` 传递：

```ts
res.render("admin/dashboard", { stats }, {
  layoutData: {
    user,
    menu,
    permissions,
  },
});
```

layout 组件通过 Vext 前端 runtime 读取 layout data。昂贵的 service 调用仍放在 route handler 中，不放在浏览器组件里。

## 公共组件

公共组件放在 `src/frontend/components/**`。

```tsx
// src/frontend/components/UserCard.tsx
export function UserCard(props: { name: string }) {
  return <section>{props.name}</section>;
}
```

示例和业务代码可以使用默认 alias：

```tsx
import { UserCard } from "@components/UserCard";
```

常用 alias 包括 `@frontend`、`@pages`、`@components`、`@styles`、`@assets`。

## 多语言

前端页面文案放在 `src/frontend/locales/**`，不同 locale 应保持相同对象结构。

```ts
// src/frontend/locales/zh-CN.ts
export default {
  dashboard: {
    title: "仪表盘",
  },
};
```

组件中使用对象访问：

```tsx
import { useVextI18n } from "vextjs/frontend";

export default function Dashboard() {
  const i18n = useVextI18n();
  return <h1>{i18n.dashboard.title}</h1>;
}
```

默认浏览器模式是 `frontend.i18n.clientLoad: "current"`，hydration 只加载 SSR 当前 locale。只有页面需要无刷新切换语言时，才使用 `"all"`。

## 错误页面

默认错误页面是：

```text
src/frontend/pages/error/default.tsx
```

可以显式渲染错误：

```ts
res.renderError(404);
res.renderError(500, "error/default");
res.renderError(error, "error/default", { props: { requestId } });
```

API 和 JSON 请求保持 JSON 错误语义。静态资源 404 不渲染 HTML 错误页。

## HTML Document

默认 document 模板是：

```text
src/frontend/pages/_document.html
```

使用 Vext document 占位符：

```html
<!doctype html>
<html lang="{vext.lang}">
  <head>
    {vext.head}
    {vext.styles}
  </head>
  <body>
    <div id="root">{vext.app}</div>
    {vext.scripts}
  </body>
</html>
```

route handler 通过 `res.render()` 传递页面数据；服务端 renderer 会把数据序列化到 document 中，浏览器 runtime 再 hydration 同一个页面。


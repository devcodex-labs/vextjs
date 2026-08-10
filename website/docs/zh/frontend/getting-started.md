# 快速开始

本页是使用内置前端能力把 Vext 全栈页面跑起来的最短路径。

## 创建应用

```bash
npx vextjs create my-app
cd my-app
npm install
npm run dev
```

默认脚手架是全栈项目：后端 routes、services、React 页面、样式、初始多语言文件，以及使用同一 V 几何的 `public/vext-mark.svg` / favicon 变体都在同一个项目里创建。可选资源与约定目录只会在其中有真实应用源码时按需添加。纯 API 项目仍然可以使用：

```bash
npx vextjs create my-api --template api --frontend none
```

## 打开第一个页面

第一个页面链路如下：

```text
GET / -> src/routes/index.ts -> res.render("index")
```

`src/frontend/pages/index.tsx` 是页面组件。它不会自动创建 URL；URL 由 route handler 决定。

## 默认 Launchpad

默认全栈模板提供 SSR Vext runtime launchpad，而不是空白 demo。它将「路由 → 服务 → `res.render()` → 浏览器运行时」作为可见运行时链路，greeting 和渲染时间仍来自真实服务端数据。`src/frontend/components/AppShell.tsx` 负责公共导航并引用透明的 `public/vext-mark.svg`；`public/favicon.svg` 是采用相同 V 几何的高对比变体。`src/frontend/styles/index.css` 负责 ink/cyan/green/amber 视觉 token，以及纯 CSS、遵守减少动态效果偏好的轻量动效。优先从这些文件开始修改；没有需要维护的生成 README 占位文件。

## 修改首页

```tsx
// src/frontend/pages/index.tsx
export default function HomePage(props: { greeting: string }) {
  return <main>{props.greeting}</main>;
}
```

```ts
// src/routes/index.ts
export default (app) => {
  app.get("/", {}, async (req, res) => {
    res.render("index", { greeting: "Hello from Vext" });
  });
};
```

## 添加页面

创建页面：

```tsx
// src/frontend/pages/admin/dashboard.tsx
export default function DashboardPage(props: { totalUsers: number }) {
  return <main>Total users: {props.totalUsers}</main>;
}
```

在 route 中渲染：

```ts
// src/routes/admin/dashboard.ts
export default (app) => {
  app.get("/admin/dashboard", {}, async (req, res) => {
    const totalUsers = await app.services.users.count();
    res.render("admin/dashboard", { totalUsers });
  });
};
```

## 添加组件

```tsx
// src/frontend/components/Stat.tsx
export function Stat(props: { label: string; value: number }) {
  return (
    <section>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </section>
  );
}
```

在前端文件中使用 alias：

```tsx
import { Stat } from "@components/Stat";
```

## 添加样式

可以使用普通 CSS、CSS Modules 或 Vext JSCSS。组件级动态样式可以使用 `vextjs/style`：

```ts
// src/frontend/styles/card.style.ts
import { style } from "vextjs/style";

export const card = style({
  padding: 16,
  borderRadius: 8,
});
```

需要第一次使用 recipe、variants、CSS variables 与构建产物时，阅读 [Vext JSCSS](/zh/frontend/jscss)。

## 失败时先检查

| 现象                         | 检查                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| page not found               | page id 是否和 `src/frontend/pages/**` 下的路径一致且不带扩展名。    |
| 浏览器 bundle 引入服务端文件 | service / database 调用应放回 `src/routes/**` 或 `src/services/**`。 |
| 样式没有更新                 | 检查 `frontend.dev.hot` 与 `frontend.dev.fastRefresh`。              |
| API 请求拿到 HTML            | 发送 `Accept: application/json`，并检查 `spaFallback.scopes[]`。     |

下一步阅读 [项目结构](/zh/frontend/project-structure) 与 [路由与页面](/zh/frontend/routing-and-pages)。

# 前端集成

Vext 前端集成用于把 HTTP route、service 数据、React 页面、SSR、hydration、React Fast Refresh、生产构建和静态资源服务放在同一个 Vext 项目里。默认前端能力面向 Vext 自身的 full-stack 使用方式，同时保留后端运行时的框架无关边界。

:::warning 开发中
本页描述的是正在开发中的前端集成目标体验，用于对齐后续实现和用户使用方式。当前稳定版本仍以已发布能力为准；实现完成前，请不要把本文中的 `src/frontend/pages/**`、`src/frontend/locales/**`、`res.render()`、`renderError()`、`frontend.i18n`、`useVextI18n()`、React Fast Refresh、SSR、layout chain 和自动入口能力当作已发布稳定 API。
:::

核心模型很简单：URL 仍然由 `src/routes/**` 定义；前端业务源码统一放在 `src/frontend/**`；页面组件放在 `src/frontend/pages/**`；前端页面文案放在 `src/frontend/locales/**`；route handler 需要页面响应时，直接调用 `res.render(page, props, options)`。服务端数据在 route 或 service 中准备好，再作为 props、layoutData 或 messages 传给页面，服务端代码不会被打进浏览器 bundle。开发时，React 页面、layout、公共组件和样式默认走 Fast Refresh 或 CSS hot update；route/service 等 render 相关服务端代码更新后，浏览器是否整页刷新由 `frontend.dev.renderRefresh` 控制。页面、layout 和公共组件可以使用 `@components`、`@styles`、`@assets` 等默认 alias；需要组件内样式时可以从 `vextjs/style` 使用 Vext JSCSS；需要多语言文案时使用 `vextjs/frontend` 暴露的 `useVextI18n(locale?)`，并以 `i18n.dashboard.title` 这类对象属性读取文案，这些能力都只指向前端源码边界。

## 目录导航

- [1. 什么时候使用 Vext Frontend](#1-什么时候使用-vext-frontend)
- [2. 创建并运行全栈项目](#2-创建并运行全栈项目)
- [3. 默认项目结构](#3-默认项目结构)
- [4. 添加页面文件](#4-添加页面文件)
- [5. 在 route 中渲染页面](#5-在-route-中渲染页面)
- [6. 使用 services 准备页面数据](#6-使用-services-准备页面数据)
- [7. 使用 layout 组织页面外壳](#7-使用-layout-组织页面外壳)
- [8. 公共组件](#8-公共组件)
- [9. 样式组织](#9-样式组织)
- [10. 图片和静态资源](#10-图片和静态资源)
- [11. 调用 Vext API](#11-调用-vext-api)
- [12. 页面多语言](#12-页面多语言)
- [13. 错误页面与 renderError](#13-错误页面与-rendererror)
- [14. HTML 模板](#14-html-模板)
- [15. 配置 frontend](#15-配置-frontend)
- [16. 开发、构建和生产启动](#16-开发构建和生产启动)
- [17. API-only 项目如何关闭前端](#17-api-only-项目如何关闭前端)
- [18. 常见问题](#18-常见问题)
- [19. 默认边界与后续能力](#19-默认边界与后续能力)

## 1. 什么时候使用 Vext Frontend

适合使用默认前端集成的场景：

- 你希望一个 Vext 项目同时提供 API、服务端页面和浏览器交互。
- 你希望 `src/routes/**` 同时承担 API route 和页面 route 的入口职责。
- 你希望 route handler 可以调用 `app.services` 准备 SSR 页面数据。
- 你希望页面组件、公共组件、样式、静态文件都有清晰的企业级默认目录。
- 你希望 `vext dev` 同时处理后端热更新、React Fast Refresh 和前端构建。
- 你希望 `vext build` 同时输出服务端产物和前端页面产物。

仍然只做 API 的项目，可以关闭内置前端。需要接入其他前端框架时，可以通过 Vext 后续开放的外接接口实现；Vext 默认文档优先说明 Vext full-stack React 路径。

## 2. 创建并运行全栈项目

创建默认 full-stack React 项目：

```bash
npx vextjs create my-app
cd my-app
npm install
npm run dev
```

默认端口是 `3000`。开发服务器 ready 后访问：

```text
http://localhost:3000/
```

默认首页链路是：

```text
GET / -> src/routes/index.ts -> res.render("index")
```

也就是说，页面 URL 不由 `src/frontend/pages/index.tsx` 自动产生，而是由 route handler 明确渲染。

## 3. 默认项目结构

默认 full-stack React 项目会生成：

```text
my-app/
├── public/
│   └── favicon.svg
├── src/
│   ├── frontend/
│   │   ├── pages/
│   │   │   ├── _document.html
│   │   │   ├── layout.tsx
│   │   │   ├── index.tsx
│   │   │   └── error/
│   │   │       ├── default.tsx
│   │   │       ├── 404.tsx
│   │   │       └── 500.tsx
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   └── AppShell.tsx
│   │   │   ├── error/
│   │   │   │   └── ErrorPanel.tsx
│   │   │   └── ui/
│   │   │       └── Button.tsx
│   │   ├── styles/
│   │   │   ├── index.css
│   │   │   └── card.style.ts
│   │   ├── assets/
│   │   │   └── logo.svg
│   │   └── locales/
│   │       ├── zh-CN.ts
│   │       └── en-US.ts
│   ├── routes/
│   │   └── index.ts
│   ├── services/
│   │   └── dashboard.ts
│   └── config/
│       ├── default.ts
│       ├── development.ts
│       └── production.ts
└── package.json
```

| 文件或目录                             | 用户应该怎么用                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/frontend/**`                      | 用户前端源码根目录。页面、组件、样式、打包资源都聚合在这里，避免和后端目录混杂。                                 |
| `src/frontend/pages/**`                | 页面组件、目录级 `layout.tsx`、`_document.html` 和错误页面目录。文件路径就是 `res.render(page)` 使用的 page id。 |
| `src/frontend/pages/error/default.tsx` | 默认错误页面。没有状态码专属错误页时使用。                                                                       |
| `src/frontend/pages/error/**`          | 状态码错误页面，例如 `error/404`、`error/500`。                                                                  |
| `src/frontend/components/**`           | 公共组件、布局组件、表单组件、错误页复用组件。                                                                   |
| `src/frontend/styles/**`               | 全局 CSS、主题变量、页面样式入口和 Vext JSCSS 文件。默认 CSS 入口是 `src/frontend/styles/index.css`。            |
| `src/frontend/assets/**`               | 由 TSX 或 CSS import 的图片、SVG、字体等资源。                                                                   |
| `src/frontend/locales/**`              | 前端页面、layout、公共组件和错误页使用的文案字典。不要把页面文案放进后端 `src/locales/**` 错误消息目录。         |
| `@components/*` 等 alias               | 面向前端源码的快捷导入，只解析到 `src/frontend/**` 内部，不指向 `src/routes/**` 或 `src/services/**`。           |
| `public/**`                            | 原样服务的公开静态文件，例如 favicon、robots、第三方验证文件。                                                   |
| `src/routes/**`                        | HTTP route。API 和页面 URL 都在这里定义。                                                                        |
| `src/services/**`                      | 服务端业务逻辑。route handler 调用 service 后把结果传给页面。                                                    |
| `src/config/**`                        | Vext 配置，包含 `frontend` 配置块。                                                                              |

用户不需要手动创建浏览器入口或 HTML shell。浏览器入口、页面 registry、layout registry、错误页 registry 和运行时代码由 Vext 自动生成到 `.vext/generated/frontend/`。

## 4. 添加页面文件

新增页面文件：

```text
src/frontend/pages/dashboard.tsx
```

页面组件使用普通 React 组件：

```tsx
type DashboardPageProps = {
  stats: {
    users: number;
    orders: number;
  };
};

export default function DashboardPage({ stats }: DashboardPageProps) {
  return (
    <main>
      <h1>Dashboard</h1>
      <dl>
        <dt>Users</dt>
        <dd>{stats.users}</dd>
        <dt>Orders</dt>
        <dd>{stats.orders}</dd>
      </dl>
    </main>
  );
}
```

page id 是 `src/frontend/pages/` 下的相对路径，去掉扩展名：

| 文件                                  | page id        |
| ------------------------------------- | -------------- |
| `src/frontend/pages/index.tsx`        | `index`        |
| `src/frontend/pages/dashboard.tsx`    | `dashboard`    |
| `src/frontend/pages/users/detail.tsx` | `users/detail` |
| `src/frontend/pages/error/404.tsx`    | `error/404`    |

创建页面文件不会自动创建 URL。你还需要在 `src/routes/**` 中调用 `res.render()`。

## 5. 在 route 中渲染页面

路由写法与普通 Vext route 保持一致，只是在 handler 里把 `res.json()` 换成 `res.render()`。

```ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/dashboard", async (_req, res) => {
    return res.render("dashboard", {
      stats: {
        users: 12,
        orders: 34,
      },
    });
  });
});
```

`res.render(page, props?, options?)` 的三个参数：

| 参数      | 必填 | 说明                                                                                                                                  |
| --------- | :--: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `page`    |  是  | `src/frontend/pages/**` 下的页面 id，不是 URL，也不是文件绝对路径。                                                                   |
| `props`   |  否  | 传给页面组件的数据，必须是 JSON-safe 数据。                                                                                           |
| `options` |  否  | 本次 HTML 响应选项，例如 `status`、`headers`、`title`、`description`、`head`、`nonce`、`locale`、`messages`、`layout`、`layoutData`。 |

带标题、状态码和响应头：

```ts
app.get("/welcome", async (_req, res) => {
  return res.render(
    "welcome",
    { name: "Vext" },
    {
      status: 200,
      title: "Welcome",
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
});
```

不要把页面渲染配置放进 route `options`。route `options` 继续只负责 `validate`、`middlewares`、`docs`、`override` 等后端路由声明；页面渲染发生在 handler 里。

页面 head 内容也从同一次 render 调用传入：

```ts
app.get("/posts/:slug", async (req, res) => {
  const post = await app.services.posts.findBySlug(req.params.slug);

  return res.render(
    "posts/detail",
    { post },
    {
      title: post.title,
      description: post.excerpt,
      head: {
        meta: [
          { property: "og:title", content: post.title },
          { property: "og:description", content: post.excerpt },
        ],
        links: [
          { rel: "canonical", href: `https://example.com/posts/${post.slug}` },
        ],
      },
    },
  );
});
```

`title`、`description`、`meta` 是常见页面的快捷字段。需要 Open Graph、canonical、preload 或自定义 script/link 属性时使用 `head`。如果项目使用 Content Security Policy，可以传入每次请求生成的 `nonce`；Vext 会把它应用到框架生成的数据脚本和入口脚本上。

## 6. 使用 services 准备页面数据

服务端数据放在 service 中，route handler 调用 service，然后把结果作为 props 传给页面。

```ts
// src/services/dashboard.ts
export default class DashboardService {
  async summary() {
    return {
      users: 12,
      orders: 34,
    };
  }
}
```

```ts
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/dashboard", async (_req, res) => {
    const stats = await app.services.dashboard.summary();
    return res.render("dashboard", { stats });
  });
});
```

```tsx
// src/frontend/pages/dashboard.tsx
export default function DashboardPage(props: {
  stats: { users: number; orders: number };
}) {
  return <div>{props.stats.users}</div>;
}
```

不要在 `src/frontend/pages/**` 或 `src/frontend/components/**` 中 import `src/services/**`。页面和组件会进入浏览器构建，service 只应该在服务端 route handler 中执行。

## 7. 使用 layout 组织页面外壳

默认 layout 文件放在 `src/frontend/pages/**` 目录中，文件名固定为 `layout.tsx`。Vext 会根据 page id 从 pages root 到页面所在目录收集所有存在的 `layout.tsx`，并在服务端渲染时按外层到内层自动包裹页面。任意子目录都可以有自己的 `layout.tsx`；没有 layout 的目录会被跳过。

例如：

```text
src/frontend/pages/layout.tsx
src/frontend/pages/admin/layout.tsx
src/frontend/pages/admin/settings/layout.tsx
src/frontend/pages/admin/settings/users/index.tsx
```

渲染 `admin/settings/users/index` 时，默认包裹顺序是：

```text
src/frontend/pages/layout.tsx
  -> src/frontend/pages/admin/layout.tsx
    -> src/frontend/pages/admin/settings/layout.tsx
      -> src/frontend/pages/admin/settings/users/index.tsx
```

根 layout 示例：

```tsx
// src/frontend/pages/layout.tsx
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header>Vext Admin</header>
      {children}
    </div>
  );
}
```

admin layout 可以接收 route handler 传入的 layoutData：

```tsx
// src/frontend/pages/admin/layout.tsx
import type { ReactNode } from "react";

type AdminLayoutData = {
  userName: string;
  menu: Array<{ label: string; href: string }>;
};

export default function AdminLayout({
  children,
  data,
}: {
  children: ReactNode;
  data?: AdminLayoutData;
}) {
  return (
    <div className="admin-shell">
      <aside>
        <strong>{data?.userName}</strong>
        {data?.menu.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </aside>
      <main>{children}</main>
    </div>
  );
}
```

route handler 中传入 layoutData：

```ts
app.get("/admin/users", async (_req, res) => {
  const users = await app.services.users.list();
  const session = await app.services.auth.currentSession();

  return res.render(
    "admin/users/index",
    { users },
    {
      layoutData: {
        "admin/layout": {
          userName: session.user.name,
          menu: [
            { label: "Users", href: "/admin/users" },
            { label: "Settings", href: "/admin/settings" },
          ],
        },
      },
    },
  );
});
```

layout 只负责 React 应用外壳，不返回 `<html>`、`<head>` 或 `<body>`。这些 HTML 文档结构属于 `_document.html`。如果某个页面不需要默认 layout，可以显式关闭：

```ts
return res.render("embed", props, { layout: false });
```

如果不同 route 或不同页面需要复用同一个外壳，推荐把公共外壳放在 `src/frontend/components/layout/**`，再由多个目录级 `layout.tsx` import：

```tsx
// src/frontend/pages/admin/layout.tsx
import { AdminShell } from "@components/layout/AdminShell";

export default function AdminLayout({ children, data }) {
  return <AdminShell user={data?.user}>{children}</AdminShell>;
}
```

少数场景需要跨目录复用完整 layout chain 时，可以在本次响应中显式指定：

```ts
return res.render("dashboard", props, {
  layout: ["layout", "admin/layout"],
});
```

`layout: true` 使用默认自动 chain；`layout: false` 关闭 layout；`layout: string | string[]` 会替换默认自动 chain，数组顺序就是外层到内层。错误页面默认也使用同一套 layout 规则，除非你在 `renderError` 选项中关闭 layout。

## 8. 公共组件

推荐把可复用 UI 放进 `src/frontend/components/**`：

```text
src/frontend/components/layout/AppShell.tsx
src/frontend/components/error/ErrorPanel.tsx
src/frontend/components/ui/Button.tsx
```

页面中直接 import：

```tsx
import { AppShell } from "@components/layout/AppShell";

export default function DashboardPage() {
  return (
    <AppShell>
      <h1>Dashboard</h1>
    </AppShell>
  );
}
```

`components` 是用户代码目录，不是 URL 路由目录。组件不会被自动暴露成页面，只有 `src/frontend/pages/**` 中被 `res.render()` 引用的页面会作为页面入口。

默认 alias：

| alias           | 指向                        |
| --------------- | --------------------------- |
| `@frontend/*`   | `src/frontend/*`            |
| `@pages/*`      | `src/frontend/pages/*`      |
| `@components/*` | `src/frontend/components/*` |
| `@styles/*`     | `src/frontend/styles/*`     |
| `@assets/*`     | `src/frontend/assets/*`     |

Vext 不默认提供 `@/* -> src/*`。这样可以避免前端页面误 import `src/services/**`、`src/routes/**` 或 `src/config/**`，导致服务端代码进入浏览器 bundle。自定义 alias 时也应该保持在 `src/frontend/**` 边界内。

## 9. 样式组织

默认全局样式入口：

```text
src/frontend/styles/index.css
```

Vext 会自动把它加入浏览器入口。常见内容：

```css
:root {
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  color: #172026;
  background: #f7f9fb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}
```

页面或组件也可以直接 import CSS：

```tsx
import "../styles/dashboard.css";

export default function DashboardPage() {
  return <main className="dashboard">Dashboard</main>;
}
```

CSS 会由 esbuild 打包成前端资源，Vext 在 HTML 模板中注入生成后的 CSS link。

如果你不想写大量 CSS 文件，可以使用默认内置的 Vext JSCSS。把样式放在 `src/frontend/**/*.style.ts`、`src/frontend/**/*.style.js` 或 `src/frontend/**/*.css.ts`，再从页面或组件 import className：

```ts
// src/frontend/styles/card.style.ts
import { createVar, recipe, setVar, style, vars } from "vextjs/style";

export const accent = createVar("accent", "#0f766e");

export const card = style(
  {
    color: accent,
    padding: 16,
    borderRadius: 8,
    "&:hover": {
      color: "tomato",
    },
    "@media (min-width: 768px)": {
      padding: 24,
    },
  },
  "card",
);

export const button = recipe({
  name: "button",
  base: {
    borderRadius: 6,
    fontWeight: 600,
  },
  variants: {
    tone: {
      primary: { backgroundColor: "black", color: "white" },
      muted: { backgroundColor: "#eef2f7", color: "#172026" },
    },
  },
  defaultVariants: { tone: "primary" },
});

export const dynamicAccent = vars(setVar(accent, "#2563eb"));
```

```tsx
// src/frontend/pages/dashboard.tsx
import { button, card, dynamicAccent } from "../styles/card.style";

export default function DashboardPage() {
  return (
    <main className={card} style={dynamicAccent}>
      <button className={button({ tone: "primary" })}>Save</button>
    </main>
  );
}
```

Vext JSCSS 的默认行为是构建期抽取静态 CSS，再通过 CSS variables 承载动态值。生产浏览器 bundle 不默认引入 Emotion 或 styled-components 这类 runtime CSS-in-JS 依赖。你仍然可以继续写普通 CSS；两者会一起进入最终 CSS asset，并由 `{vext.styles}` 注入页面。

## 10. 图片和静态资源

Vext 推荐两类资源放置方式：

| 放置位置                 | 适合内容                                    | 使用方式                                            |
| ------------------------ | ------------------------------------------- | --------------------------------------------------- |
| `public/**`              | favicon、robots、无需 hash 的公开图片或文件 | 直接用 `/favicon.svg`、`/brand/logo.png` 访问       |
| `src/frontend/assets/**` | 页面 import 的图片、SVG、字体等             | 在 TSX 或 CSS 中 import，由 esbuild 输出 hash asset |

`public/` 示例：

```text
public/logo.png
```

```tsx
export function HeaderLogo() {
  return <img src="/logo.png" alt="Logo" />;
}
```

`src/frontend/assets/` 示例：

```text
src/frontend/assets/hero.png
```

```tsx
import heroUrl from "../assets/hero.png";

export function HomeHero() {
  return <img src={heroUrl} alt="Home hero" />;
}
```

如果 TypeScript 提示图片模块类型缺失，可以在应用里补声明文件：

```ts
// src/frontend/assets.d.ts
declare module "*.png" {
  const src: string;
  export default src;
}
```

## 11. 调用 Vext API

需要首屏数据时，优先在 route handler 中调用 service，并通过 `res.render(page, props)` 传给页面。页面加载后的点击、筛选、分页、提交表单等浏览器交互，可以直接调用同项目内的 Vext API。

```tsx
type HelloResponse = {
  message: string;
};

export async function loadHello(): Promise<HelloResponse> {
  const response = await fetch("/api/hello", {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<HelloResponse>;
}
```

后续如果启用生成式 API client，文档会只展示生成后的导入方式，不要求用户手写 route contract。当前 `res.render()` 主线不依赖浏览器 API helper。

表单和 mutation 仍然遵守同一个服务端边界：

```tsx
import { useActionState } from "react";

type SaveProfileState = {
  error?: { message: string };
} | null;

async function saveProfile(
  _state: SaveProfileState,
  formData: FormData,
): Promise<SaveProfileState> {
  const response = await fetch("/api/profile", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body: formData,
  });

  return response.json() as Promise<SaveProfileState>;
}

export function ProfileForm() {
  const [state, action, pending] = useActionState(saveProfile, null);

  return (
    <form action={action}>
      <input name="displayName" />
      <button disabled={pending}>保存</button>
      {state?.error ? <p>{state.error.message}</p> : null}
    </form>
  );
}
```

这个表单调用的是普通 Vext API route。字段校验、鉴权、CSRF 或 same-origin 校验、幂等处理都放在 API route 或 middleware 中。本期 Vext 不把 Server Actions 或 route actions 加进默认 mutation 模型；Server Actions 属于后续专项能力。

## 12. 页面多语言

Vext 的多语言分两层：

| 层          | 放在哪里                                   | 用途                                                                                             |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 后端 locale | `config.locale`、`src/locales/**`          | API 错误、`app.throw()`、schema-dsl 校验消息、`Accept-Language` 匹配和 `requestContext.locale`。 |
| 前端 i18n   | `frontend.i18n`、`src/frontend/locales/**` | 页面、layout、公共组件、错误页文案、SSR 初始 messages、hydration 和 `<html lang>`。              |

也就是说，API 错误消息和页面文案不要混在同一个目录里。页面文案推荐放在：

```text
src/frontend/locales/zh-CN.ts
src/frontend/locales/en-US.ts
```

语言包导出 JSON-safe 对象：

```ts
// src/frontend/locales/zh-CN.ts
export default {
  nav: {
    dashboard: "控制台",
  },
  dashboard: {
    title: "团队概览",
    users: "用户",
    orders: "订单",
  },
} as const;
```

```ts
// src/frontend/locales/en-US.ts
export default {
  nav: {
    dashboard: "Dashboard",
  },
  dashboard: {
    title: "Team overview",
    users: "Users",
    orders: "Orders",
  },
} as const;
```

页面、layout、公共组件和错误页通过 `useVextI18n()` 读取当前语言对应的只读文案对象：

```tsx
import { useVextI18n } from "vextjs/frontend";

type DashboardPageProps = {
  stats: {
    users: number;
    orders: number;
  };
};

export default function DashboardPage({ stats }: DashboardPageProps) {
  const i18n = useVextI18n();

  return (
    <main>
      <h1>{i18n.dashboard.title}</h1>
      <dl>
        <dt>{i18n.dashboard.users}</dt>
        <dd>{stats.users}</dd>
        <dt>{i18n.dashboard.orders}</dt>
        <dd>{stats.orders}</dd>
      </dl>
    </main>
  );
}
```

默认 locale 文件会作为类型 shape 来源，其他 locale 在构建时需要保持同样的对象结构。这样编辑器能提示 `i18n.dashboard.title`，重命名和缺失属性也能更早暴露。需要显式读取某个语言时，可以传入 locale：

```tsx
const english = useVextI18n("en-US");
```

默认情况下，`res.render()` 继承当前请求的 `requestContext.locale`。这个值来自 `config.locale.supported` 和请求头 `Accept-Language`：

```ts
app.get("/dashboard", async (_req, res) => {
  const stats = await app.services.dashboard.summary();
  return res.render("dashboard", { stats });
});
```

需要覆盖单次 HTML 响应语言时，把 `locale` 放在 `res.render()` 第三个参数里：

```ts
return res.render(
  "dashboard",
  { stats },
  {
    locale: "en-US",
    title: "Dashboard",
  },
);
```

如果 route handler 临时生成了少量页面文案，可以用 `messages` 补充当前页面字典。`messages` 必须是 JSON-safe 数据，不能放函数、React 组件、数据库连接、service 实例或请求对象：

```ts
return res.render(
  "dashboard",
  { stats },
  {
    messages: {
      dashboard: {
        notice: "The report is being refreshed.",
      },
    },
  },
);
```

客户端语言切换首期推荐使用 reload 模式：用户选择语言后，写入 cookie、用户偏好 API、URL 前缀或其他服务端可识别的位置，然后重新请求 HTML。这样 SSR 和 hydration 会使用同一份 `locale` 与 `messages`，不需要在浏览器首次渲染时重新猜语言。React 组件里不要在点击事件中命令式调用 hook；更新 locale 来源后让页面重新渲染，`useVextI18n(locale?)` 会返回新的文案对象。

```tsx
export function LanguageSwitch() {
  return (
    <form method="post" action="/api/me/locale">
      <button name="locale" value="zh-CN">
        中文
      </button>
      <button name="locale" value="en-US">
        English
      </button>
    </form>
  );
}
```

当 HTML 内容受语言影响时，Vext 会按 `frontend.i18n.vary` 设置 `Vary: Accept-Language` 或等价 cache key，避免 CDN 或反向代理把不同语言的 HTML 缓存串掉。如果你使用 path prefix 或 cookie 作为语言来源，需要在生产缓存策略中把 locale 纳入缓存 key。

## 13. 错误页面与 renderError

Vext 默认查找这些错误页面：

```text
src/frontend/pages/error/default.tsx
src/frontend/pages/error/404.tsx
src/frontend/pages/error/500.tsx
```

404 页面示例：

```tsx
// src/frontend/pages/error/404.tsx
export default function NotFoundPage(props: {
  status: number;
  message: string;
  requestId: string;
}) {
  return (
    <main>
      <h1>Page not found</h1>
      <p>{props.message}</p>
      <small>{props.requestId}</small>
    </main>
  );
}
```

通用错误页示例：

```tsx
// src/frontend/pages/error/default.tsx
export default function ErrorPage(props: {
  status: number;
  code: number | string;
  message: string;
  requestId: string;
  details?: unknown;
}) {
  return (
    <main>
      <h1>{props.status}</h1>
      <p>{props.message}</p>
      <small>{props.requestId}</small>
    </main>
  );
}
```

在 handler 中主动渲染错误页：

```ts
app.get("/orders/:id", async (req, res) => {
  const order = await app.services.orders.findById(req.params.id);

  if (!order) {
    return res.renderError(404, { id: req.params.id });
  }

  return res.render("orders/detail", { order });
});
```

指定错误页面：

```ts
return res.renderError(404, "error/order-not-found");
```

同时传 details 和页面：

```ts
return res.renderError(
  404,
  { id: req.params.id },
  { page: "error/order-not-found" },
);
```

`renderError("error/404")` 不是合法用法。页面地址放第二参数或 `options.page`。

404 输出规则：

| 请求类型                                        | 输出                               |
| ----------------------------------------------- | ---------------------------------- |
| API/JSON 请求                                   | JSON 404。                         |
| handler 主动 `res.renderError(404)`             | HTML 错误页。                      |
| 浏览器访问未定义 HTML route                     | HTML 404 错误页。                  |
| 静态资源不存在                                  | 不渲染 HTML 错误页。               |
| 显式配置 `spaFallback.scopes[]` 且命中 fallback | 返回对应 scope 的 shell document。 |

默认推荐 route 中显式渲染页面，不依赖 SPA fallback 伪造页面路由。

## 14. HTML 模板

大多数项目不需要自定义 HTML 模板。需要添加全局 meta、第三方 script 或 body class 时，创建：

```text
src/frontend/pages/_document.html
```

模板示例：

```html
<!doctype html>
<html lang="{vext.lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    {vext.head} {vext.styles}
  </head>
  <body>
    {vext.root} {vext.data} {vext.entry}
  </body>
</html>
```

可用 token：

| Token           | 含义                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `{vext.head}`   | 来自 `res.render()` options 的 title、description、meta、canonical/preload link 等安全 head 内容。            |
| `{vext.styles}` | CSS `<link>` 标签。                                                                                           |
| `{vext.lang}`   | 当前 HTML 响应的 locale，用于 `<html lang>`。默认继承 `requestContext.locale`，也可由 `options.locale` 覆盖。 |
| `{vext.root}`   | React SSR HTML 挂载节点。                                                                                     |
| `{vext.data}`   | JSON-safe 页面 props、layoutData、locale 和初始 messages。Vext 写入页面前会转义序列化内容。                   |
| `{vext.entry}`  | 浏览器入口 script。                                                                                           |

服务端数据传递流程是：route handler 调用 `res.render("page-id", props, options)`；Vext 在服务端执行 SSR；`props`、`layoutData`、`locale` 和 `messages` 会被序列化并转义后写入 `{vext.data}`；浏览器入口读取同一份数据并 hydrate 到 `{vext.root}`。模板只支持这些 Vext 保留 token，不支持任意模板表达式。

如果使用 CSP，请在 `res.render()` 第三个参数中传入 `nonce`。同一个 nonce 会应用到 `{vext.data}`、`{vext.entry}` 和 Vext 生成的 script 标签。不要把用户输入直接写进 `_document.html`；应通过 `props`、`layoutData` 或 `head` 传递，让 Vext 做转义。

## 15. 配置 frontend

最短配置：

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 3000,
  adapter: "native",
  frontend: true,
};

export default config;
```

完整配置：

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 3000,
  adapter: "native",
  frontend: {
    enabled: true,
    framework: "react",
    root: "src/frontend",
    pages: {
      dir: "pages",
      extensions: [".tsx", ".jsx", ".ts", ".js"],
    },
    componentsDir: "components",
    styles: {
      entry: "styles/index.css",
    },
    assetsDir: "assets",
    publicDir: "public",
    publicPath: "/",
    dev: {
      hot: true,
      fastRefresh: true,
      transport: "sse",
      overlay: true,
      debounceMs: 50,
      renderRefresh: "prompt",
    },
    alias: {
      "@frontend": ".",
      "@pages": "pages",
      "@components": "components",
      "@styles": "styles",
      "@assets": "assets",
    },
    build: {
      client: {
        outDir: "dist/client",
        assetsDir: "assets",
        target: "es2022",
        minify: true,
        sourcemap: false,
        splitting: true,
        entryNames: "[name]-[hash]",
        chunkNames: "[name]-[hash]",
        assetNames: "[name]-[hash]",
        manifest: true,
      },
      server: {
        outFile: "dist/client/server/renderer.cjs",
        target: "node20",
        external: [],
      },
      assets: {
        inlineLimit: 0,
      },
      css: {
        modules: true,
      },
      diagnostics: {
        metafile: true,
        sizeReport: true,
        leakScan: true,
      },
    },
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      crossOrigin: "anonymous",
      integrity: false,
    },
    render: {
      ssr: true,
      fallback: "client",
      timeoutMs: 3000,
      layout: true,
    },
    errorPages: {
      default: "error/default",
      status: {
        404: "error/404",
        500: "error/500",
      },
    },
    i18n: {
      enabled: true,
      source: "locales",
      defaultLocale: "inherit",
      detect: ["accept-language"],
      inject: "used",
      clientSwitch: "reload",
      htmlLang: true,
      vary: true,
    },
    spaFallback: {
      scopes: [],
    },
  },
};

export default config;
```

配置项参考：

| 字段                                     | 默认值                                              | 用途                                                                                                       |
| ---------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `frontend`                               | `false`                                             | `true` 启用默认前端；`false` 关闭前端；对象形式可配置细节。                                                |
| `frontend.enabled`                       | `false`                                             | 是否启用内置前端构建、SSR 和静态服务。                                                                     |
| `frontend.framework`                     | `"react"`                                           | 默认 React。                                                                                               |
| `frontend.root`                          | `"src/frontend"`                                    | 用户前端源码根目录。                                                                                       |
| `frontend.pages.dir`                     | `"pages"`                                           | 页面目录，默认相对 `frontend.root` 解析。                                                                  |
| `frontend.pages.extensions`              | `[".tsx", ".jsx", ".ts", ".js"]`                    | 页面扫描扩展名。                                                                                           |
| `frontend.componentsDir`                 | `"components"`                                      | 公共组件目录，默认相对 `frontend.root` 解析。                                                              |
| `frontend.styles.entry`                  | `"styles/index.css"`                                | 全局样式入口，默认相对 `frontend.root` 解析。                                                              |
| `frontend.styles.jscss.enabled`          | `true`                                              | 是否启用 Vext JSCSS 扫描和构建期 CSS 抽取。                                                                |
| `frontend.styles.jscss.files`            | `["**/*.style.ts", "**/*.style.js", "**/*.css.ts"]` | 在 `frontend.root` 内扫描的 JSCSS 文件。                                                                   |
| `frontend.styles.jscss.runtimeAdapter`   | `"css-variables"`                                   | 动态样式运行时承载方式；默认只保留 CSS variables，不引入第三方 runtime CSS-in-JS。                         |
| `frontend.styles.jscss.dynamicVars`      | `true`                                              | 是否启用 `createVar()`、`setVar()` 和 `vars()` 这类动态变量辅助。                                          |
| `frontend.styles.jscss.recipes`          | `true`                                              | 是否启用 `recipe()` variants 辅助。                                                                        |
| `frontend.assetsDir`                     | `"assets"`                                          | import 型资源目录，默认相对 `frontend.root` 解析。                                                         |
| `frontend.publicDir`                     | `"public"`                                          | 原样复制的静态文件目录，默认相对项目根解析。                                                               |
| `frontend.publicPath`                    | `"/"`                                               | 前端资源公开路径前缀。                                                                                     |
| `frontend.dev.hot`                       | `true`                                              | 开发期启用前端热更新通道。关闭后前端变更退回 rebuild + reload。                                            |
| `frontend.dev.fastRefresh`               | `true`                                              | `framework: "react"` 时启用 React Fast Refresh。                                                           |
| `frontend.dev.transport`                 | `"sse"`                                             | Vext dev event bus 传输方式。首期使用 SSE，不要求用户配置 WebSocket 或 Vite。                              |
| `frontend.dev.overlay`                   | `true`                                              | 前端构建错误、Fast Refresh 错误和 render refresh 提示是否显示为 dev overlay。                              |
| `frontend.dev.debounceMs`                | `50`                                                | 开发期文件保存风暴的防抖时间。                                                                             |
| `frontend.dev.renderRefresh`             | `"prompt"`                                          | render 相关后端代码变更后的浏览器动作：`"prompt"` 提示刷新，`"auto"` 自动刷新，`"off"` 只记录事件。        |
| `frontend.alias`                         | 见默认 alias 表                                     | 前端源码快捷导入。默认只解析到 `frontend.root` 内部。                                                      |
| `frontend.build.client.outDir`           | `"dist/client"`                                     | 生产浏览器产物输出目录。                                                                                   |
| `frontend.build.client.assetsDir`        | `"assets"`                                          | JS、CSS、图片和字体等构建资源输出子目录。                                                                  |
| `frontend.build.client.target`           | `"es2022"`                                          | 浏览器构建目标。                                                                                           |
| `frontend.build.client.minify`           | `true`                                              | 生产浏览器构建是否压缩。                                                                                   |
| `frontend.build.client.sourcemap`        | `false`                                             | 生产浏览器构建是否输出 sourcemap。                                                                         |
| `frontend.build.client.splitting`        | `true`                                              | 是否允许页面和共享代码分包。                                                                               |
| `frontend.build.client.entryNames`       | `"[name]-[hash]"`                                   | 页面入口文件命名模板。                                                                                     |
| `frontend.build.client.chunkNames`       | `"[name]-[hash]"`                                   | 共享 chunk 命名模板。                                                                                      |
| `frontend.build.client.assetNames`       | `"[name]-[hash]"`                                   | 静态资源文件命名模板。                                                                                     |
| `frontend.build.client.manifest`         | `true`                                              | 是否输出浏览器 manifest。                                                                                  |
| `frontend.build.server.outFile`          | `"dist/client/server/renderer.cjs"`                 | SSR renderer 输出文件。                                                                                    |
| `frontend.build.server.external`         | `[]`                                                | server renderer 构建时外置的包。默认打包 React 运行时，避免部署时缺失渲染依赖。                            |
| `frontend.build.assets.inlineLimit`      | `0`                                                 | import 型资源是否内联；默认输出 hash 文件。                                                                |
| `frontend.build.css.modules`             | `true`                                              | 是否支持 CSS Modules 约定。Sass、Tailwind、PostCSS 属于后续插件/用户配置能力，未实现前不作为默认能力承诺。 |
| `frontend.build.diagnostics.metafile`    | `true`                                              | 输出 esbuild metafile，用于 manifest 和排查包体。                                                          |
| `frontend.build.diagnostics.sizeReport`  | `true`                                              | 输出 size report，方便检查页面和共享 chunk 大小。                                                          |
| `frontend.build.diagnostics.leakScan`    | `true`                                              | 扫描 browser graph，阻断 `src/routes/**`、`src/services/**`、`node:*` 等服务端输入。                       |
| `frontend.deploy.assetBaseUrl`           | `undefined`                                         | CDN 资源基础 URL。设置后，HTML 和 manifest 中的静态资源地址使用该前缀。                                    |
| `frontend.deploy.crossOrigin`            | `undefined`                                         | CDN script/link 的 crossorigin 策略。                                                                      |
| `frontend.deploy.integrity`              | `false`                                             | 是否为资源生成 integrity 信息；首期可先作为配置预留或后续能力。                                            |
| `frontend.render.ssr`                    | `true`                                              | 是否启用页面 SSR。                                                                                         |
| `frontend.render.fallback`               | `"client"`                                          | SSR 失败时是否降级到 client render。                                                                       |
| `frontend.render.timeoutMs`              | `3000`                                              | 单次 SSR 超时时间。                                                                                        |
| `frontend.render.layout`                 | `true`                                              | 是否启用默认 layout chain。也可以在单次 `res.render()` 中用 `options.layout` 覆盖。                        |
| `frontend.errorPages.default`            | `"error/default"`                                   | 默认错误页面。                                                                                             |
| `frontend.errorPages.status.404`         | `"error/404"`                                       | 404 错误页面。                                                                                             |
| `frontend.errorPages.status.500`         | `"error/500"`                                       | 500 错误页面。                                                                                             |
| `frontend.i18n.enabled`                  | `false`                                             | 是否启用前端页面文案层。后端 API 错误语言仍由 `config.locale` 负责。                                       |
| `frontend.i18n.source`                   | `"locales"`                                         | 前端页面文案目录，默认相对 `frontend.root` 解析为 `src/frontend/locales`。                                 |
| `frontend.i18n.defaultLocale`            | `"inherit"`                                         | 默认继承 `config.locale.default`；也可以指定为 `zh-CN`、`en-US` 等支持语言。                               |
| `frontend.i18n.detect`                   | `["accept-language"]`                               | 首期语言检测来源。后续可扩展 cookie、path prefix 或用户偏好，但必须明确优先级。                            |
| `frontend.i18n.inject`                   | `"used"`                                            | SSR 注入初始 messages 的范围。推荐只注入当前页面/layout 使用的属性路径。                                   |
| `frontend.i18n.clientSwitch`             | `"reload"`                                          | 客户端语言切换策略。首期推荐重新请求 HTML，保证 SSR 与 hydration 一致。                                    |
| `frontend.i18n.htmlLang`                 | `true`                                              | 是否把当前 locale 输出到 `{vext.lang}`。                                                                   |
| `frontend.i18n.vary`                     | `true`                                              | 语言影响 HTML 时是否追加 `Vary: Accept-Language` 或等价 cache key。                                        |
| `frontend.spaFallback.scopes`            | `[]`                                                | client-router 子应用 fallback 范围。默认空数组，不接管未知路径。                                           |
| `frontend.spaFallback.scopes[].basePath` | 无                                                  | 该 SPA 子应用接管的 URL 前缀，例如 `/admin/app`。                                                          |
| `frontend.spaFallback.scopes[].page`     | 无                                                  | fallback 返回的 page shell，例如 `admin/app/shell`，仍从 `src/frontend/pages/**` 查找。                    |
| `frontend.spaFallback.scopes[].ssr`      | `false`                                             | 是否对 shell 做 SSR。纯 client-router 子应用通常保持 `false`。                                             |
| `frontend.spaFallback.scopes[].exclude`  | `[]`                                                | 当前 scope 下仍不允许 fallback 的路径，例如 `/admin/api/**`。                                              |
| `frontend.spaFallback.scopes[].status`   | `200`                                               | fallback 命中时返回的 HTTP 状态。                                                                          |

### `spaFallback` 怎么理解

`frontend.spaFallback` 只适合一种情况：你的项目里有一块真正由浏览器端 router 接管的 SPA 子应用，用户直接访问或刷新 `/app/settings`、`/dashboard/users/1` 这类客户端路径时，服务端没有对应 Vext route，但你希望浏览器先拿到这个子应用的 shell document，再由客户端 router 决定显示哪个页面。

它不是 Vext pages 模式的默认路由方式。默认 full-stack pages 模式仍然是：在 `src/routes/**` 定义 URL，在 handler 中准备 service 数据，然后调用 `res.render(page, props, options)` 渲染 `src/frontend/pages/**`。如果页面需要 SSR、layoutData、i18n messages、head、render cache 或服务端鉴权结果，就应该使用 `res.render()`，不要依赖 SPA fallback。

开启 fallback 前要确认：

- 只接管 `GET` / `HEAD` 的浏览器 HTML 导航请求。
- API 请求必须发送 `Accept: application/json`，并且 API 前缀要放进对应 scope 的 `exclude`。
- `/api/**`、`/openapi.json`、`/docs/**`、静态资源、built assets、图片、字体、source map、manifest 都不应该被 fallback 接管。
- `res.renderError()`、HTML route 404、`res.render(page)` 找不到页面这类诊断场景不应该被 fallback 掩盖。
- fallback 命中时通常返回 200，因为后续由客户端 router 处理，不是服务端 404。
- 多个 scope 同时匹配时，最长 `basePath` 优先；显式 `src/routes/**` 永远优先于 fallback。

常见配置：

```ts
export default {
  frontend: {
    spaFallback: {
      scopes: [
        {
          basePath: "/admin/app",
          page: "admin/app/shell",
          ssr: false,
          exclude: ["/admin/api/**", "/admin/app/assets/**"],
          status: 200,
        },
      ],
    },
  },
};
```

如果你只是做普通 SSR 页面、admin 首屏、详情页、带权限的数据页，默认保持 `scopes: []` 更合适。Vext 不推荐用一个全局开关接管未知路径；SSR + SPA 混合项目应该按子应用显式配置 scope。

`spaFallback` 也不等于持久客户端 layout 导航。后续如果 Vext 支持类似 SSCR 的局部导航，它会在 layout 内接管链接、请求服务端数据并局部替换页面内容；这是单独的后续专项能力，不会通过 `spaFallback` 隐式开启。

`frontend.publicPath` 是应用内资源 URL 前缀。`frontend.deploy.assetBaseUrl` 是构建产物静态资源的 CDN 绝对前缀。`public/**` 文件保持稳定 URL；`src/frontend/assets/**` 文件会经过构建并输出 hash 文件名。按请求动态转换 CDN 资源 URL、图片优化和字体优化属于后续专项能力或插件能力。

## 16. 开发、构建和生产启动

开发：

```bash
npm run dev
```

修改以下目录会触发前端热更新或必要的重建：

```text
src/frontend/**
public/**
```

开发期有三类变化：

| 变化                                                                                  | 默认行为                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| React 页面、layout、公共组件                                                          | 通过 React Fast Refresh 更新，尽量保留当前页面状态。                                    |
| CSS、JSCSS 和可热更新样式资源                                                         | 通过 CSS hot update 更新，不默认整页刷新。                                              |
| `src/routes/**`、`src/services/**`、middleware 等影响 `res.render()` 数据的服务端代码 | 后端 soft reload 成功后通知浏览器；浏览器按 `frontend.dev.renderRefresh` 决定是否刷新。 |

`frontend.dev.renderRefresh` 的可选值：

| 值         | 行为                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `"prompt"` | 默认推荐。页面显示“服务端渲染已更新”的开发提示，点击后整页刷新。适合后台管理、表单、弹窗和正在调试的页面。          |
| `"auto"`   | 后端 render 相关代码 soft reload 成功后自动 `location.reload()`，适合希望每次服务端数据变化都立即重取 HTML 的项目。 |
| `"off"`    | 不提示、不自动刷新，只在控制台记录事件；下一次手动刷新、跳转或重新请求时看到新 HTML。                               |

`res.render()` 的正常请求调用不会触发浏览器刷新。刷新事件只来自源码保存后的前端编译结果或后端 reload 结果。前端语法错误或 Fast Refresh 编译错误会显示 dev overlay，旧页面继续可用；修复后再恢复更新。

有些文件不能安全热替换，例如 `_document.html`、render manifest schema、浏览器 runtime entry 或会改变 hydration 数据结构的改动。遇到这些情况，Vext 会整页刷新或显示强提示，而不是伪装成 Fast Refresh。

后端 API、配置、plugin、preload 等非 render 前端路径仍按原有后端重载策略处理。

构建：

```bash
npm run build
```

生产前端输出：

```text
dist/client/
├── assets/
├── server/
│   └── renderer.cjs
├── index.html
├── manifest.json
├── messages-manifest.json
├── render-manifest.json
└── size-report.json
```

构建时 Vext 会分别生成浏览器 bundle 和 server renderer bundle。浏览器 bundle 只允许从 `src/frontend/**`、`public/**` 和配置的前端安全根起图；server renderer 用于 SSR 页面和 layout。开启 `frontend.i18n` 时，构建还会扫描 `src/frontend/locales/**` 并输出 `messages-manifest.json`。开启默认 JSCSS 时，构建会先扫描 `*.style.ts`、`*.style.js` 和 `*.css.ts`，把 `vextjs/style` 注册的样式抽取成生成 CSS，再交给 esbuild 合并进最终 CSS asset。构建诊断会保留 metafile、manifest 和 size report，并扫描 alias 解析后的真实路径，防止 `src/routes/**`、`src/services/**`、`src/config/**`、`node:*`、`*.server.*` 被打进浏览器产物。`*.client.*` 在首期只作为浏览器专用文件，不应作为同步 SSR 组件使用。

`render-manifest.json` 记录 `vext start` 需要的 build id、页面、layout、错误页、资源、server renderer 路径和诊断信息。`messages-manifest.json` 记录可用 locale、默认 locale 对象 shape、页面 messages entry 和 build id。manifest schema、messages manifest 或 renderer 文件与运行时不匹配时，启动会 fail fast 并提示重新构建，而不是服务过期页面。

首期实现必须保留性能证据：API-only overhead、开发冷启动和重建、生产构建耗时、首次 SSR 渲染耗时、client JS 体积。没有可复现 benchmark 和对比对象时，不能宣称“最快”或“第一”。

生产启动：

```bash
npm start
```

`vext start` 只服务已经存在的生产前端产物。启用前端但缺少 `dist/client/index.html` 或 `dist/client/render-manifest.json` 时会 fail fast，并提示先执行 `vext build`。

发布静态资源到 CDN 时，推荐流程是：

1. 执行 `npm run build`。
2. 上传 `dist/client/assets/**` 到 CDN。
3. 在生产配置中设置 `frontend.deploy.assetBaseUrl`，例如 `https://cdn.example.com/my-app/`。
4. 服务器仍由 Vext 输出 HTML、SSR 内容和页面数据；JS、CSS、图片、字体等静态资源从 CDN 加载。

Vext core 首期只负责生成稳定资源路径和 manifest，不绑定 S3、OSS、Cloudflare 等上传 provider。上传动作建议放在 CI 或后续 deploy plugin 中。

## 17. API-only 项目如何关闭前端

新项目只需要 API 时：

```bash
npx vextjs create my-api --template api --frontend none
```

已有项目关闭内置前端：

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: false,
};

export default config;
```

或：

```ts
export default {
  frontend: {
    enabled: false,
  },
};
```

关闭后，Vext 不会扫描 `src/frontend/**`，不会生成前端入口，也不会服务 `public/**` 前端资源。

## 18. 常见问题

| 现象                                          | 处理方式                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面文件创建了，但是访问 404                  | 页面文件不会自动创建 URL。需要在 `src/routes/**` 中定义 route，并调用 `res.render("page-id")`。                                                                                     |
| `res.render("dashboard")` 提示 page not found | 检查是否存在 `src/frontend/pages/dashboard.tsx`；子目录页面需要写完整 page id，例如 `users/detail`。                                                                                |
| props 序列化失败                              | `props` 必须是 JSON-safe 数据。不要传 function、symbol、BigInt、循环引用、连接对象、Request、Response 或 Service 实例。                                                             |
| 页面中 import service 报错                    | 不要在 `src/frontend/pages/**` 或 `src/frontend/components/**` 中 import `src/services/**`。service 只在 route handler 中调用。                                                     |
| API 请求拿到 HTML                             | 确认 API 请求发送 `Accept: application/json`，并把 API 前缀加入对应 `frontend.spaFallback.scopes[].exclude`。默认 pages 模式不启用 SPA fallback。                                   |
| layout 没有拿到服务端数据                     | 在 route handler 的第三参数里传 `layoutData`，不要让 layout 直接 import service。                                                                                                   |
| 页面语言不对                                  | 检查 `config.locale.supported`、请求 `Accept-Language`、用户偏好 cookie/API，以及 `frontend.i18n.defaultLocale` 是否符合预期。                                                      |
| 页面文案属性缺失                              | 确认 `src/frontend/locales/<locale>.ts` 与默认 locale 保持同样对象结构；临时文案可以通过 `res.render(page, props, { messages })` 传入。                                             |
| 中英文 HTML 缓存串了                          | 确认 `frontend.i18n.vary=true`，或在 CDN / 反向代理缓存 key 中加入 locale、path prefix 或 cookie。                                                                                  |
| 静态资源 404                                  | `public/logo.png` 用 `/logo.png`；`src/frontend/assets/logo.png` 需要在 TSX/CSS 中 import。                                                                                         |
| hydration mismatch                            | 确保页面首次渲染只依赖 `props`、`layoutData`、`locale` 和初始 `messages`。不要在服务端和浏览器首次渲染生成不同的随机值、时间字符串、语言判断或环境相关内容。                        |
| head 标签重复                                 | 每次 render 尽量只传一个 title、一个 description 和一组稳定 canonical link。Vext 会对常见 head 片段去重，但 route 仍应提供清晰的真相源。                                            |
| CSP 阻止页面脚本                              | 在 middleware 或 route handler 中生成请求级 nonce，并通过 `res.render(page, props, { nonce })` 传入。                                                                               |
| 保存 React 组件后整页刷新                     | 检查 `frontend.dev.hot` 和 `frontend.dev.fastRefresh` 是否开启；如果该文件还有非组件导出、被 React tree 外部引用，或修改了关键 runtime/document 结构，Vext 会回退为提示或整页刷新。 |
| 修改 route/service 后页面没自动刷新           | 默认 `frontend.dev.renderRefresh` 是 `"prompt"`，请点击开发提示刷新；想自动刷新可设置为 `"auto"`，不想提示可设置为 `"off"`。                                                        |
| Fast Refresh 没保留组件状态                   | React 只在安全边界内保留 function component 和 Hooks state；class component、非组件导出或不安全 refresh signature 可能会 remount。                                                  |
| 想关闭前端                                    | 使用 `--template api --frontend none` 创建项目，或设置 `frontend: false`。                                                                                                          |

## 19. 默认边界与后续能力

这部分分三类：默认不走的路线、后续专项能力、已经支持或计划支持但不是那种方式。

### 不作为默认路线

- Vite 或 Vite HMR API；Vext 使用 esbuild 和自己的 dev event bus。
- `.tsx` 文件自动生成 HTTP route。
- 用户侧 Next/Remix 式 route tree DSL。
- loader/action 驱动的数据加载模型；Vext 默认让 `src/routes/**` handler 和 services 准备数据，再传给 `res.render()`。
- 默认引入 React Router、TanStack Start、Next、Astro 等前端路由/元框架。
- 默认引入 i18next、react-intl 或其他第三方 i18n 运行时。
- 把 `t("dashboard.title")` 作为主 API；Vext 的默认页面文案读取方式是 `const i18n = useVextI18n(locale?)` 后访问 `i18n.dashboard.title`。

### 后续专项能力

这些能力不是永久不做，但不会混进当前默认实现。后续要做时，需要单独确认需求、性能基线、包体影响、服务端/浏览器边界、安全模型和文档验收：

- React Server Components。
- Server Actions。
- streaming SSR。
- 持久客户端 layout 导航 / client-side partial navigation。
- 内置图片优化组件。
- 内置字体优化组件。
- 按请求动态转换 CDN 资源 URL。

### 已支持或计划支持，但不是那种方式

- layout：当前目标是 SSR layout chain 和 `layoutData`，不是 Next/Remix route tree。
- mutation：当前目标是普通 Vext API route + middleware/CSRF/same-origin/idempotency，Server Actions 后续再专项评估。
- CDN：当前目标是 `frontend.deploy.assetBaseUrl` 和构建 manifest，不是每个请求动态改写资源 URL。
- SPA fallback：只服务显式配置的 `spaFallback.scopes[]` client-router 子应用，不是默认 pages 路由机制，也不能掩盖 API 404、静态资源 404 或 page registry 错误。

需要页面时，在 `src/routes/**` 中定义 URL，并用 `res.render()` 渲染 `src/frontend/pages/**`。

下一步可继续阅读 [路由](/zh/guide/routing)、[服务层](/zh/guide/services)、[配置](/zh/guide/configuration)、[构建](/zh/guide/build) 和 [CLI 命令](/zh/guide/cli)。

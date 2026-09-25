# 快速开始

本页从默认 TypeScript 全栈模板出发，完成首页修改、新增页面、组件与样式接入，最后验证生产构建。前提是符合当前 Vext 要求的 Node.js 与 npm，版本条件见[通用快速开始](/zh/guide/quick-start)。

## 创建应用

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

`create` 默认自动安装依赖。若安装失败，或你指定了 `--skip-install`，先在 `my-app` 中运行 `npm install`，成功后再启动。默认项目包含服务端 routes/services、React 页面、样式和 `en-US` 前端词典；其他语言与资源按需添加。

纯 API 项目可以使用下面的命令，但它不会提供本页后续使用的前端文件：

```bash
npx vextjs create my-api --template api --frontend none
```

## 打开第一个页面

启动成功后，打开终端显示的地址，默认是 `http://localhost:3000/`。应看到模板首页；同一地址的 `/api/health` 返回状态数据。页面链路如下：

```text
GET / -> src/routes/index.ts -> res.render("index")
```

`src/frontend/pages/index.tsx` 是页面组件。它不会自动创建 URL；URL 由 route handler 决定。

## 默认 Launchpad

默认首页通过 route 调用 `example` service，把 greeting 和服务端生成的时间传给页面。主要文件分工如下：

| 文件                                                       | 修改内容                       |
| ---------------------------------------------------------- | ------------------------------ |
| `src/routes/index.ts`                                      | 首页 URL、数据和模板的示例 API |
| `src/frontend/pages/index.tsx`                             | 首页显示                       |
| `src/frontend/pages/layout.tsx`、`components/AppShell.tsx` | 公共布局和导航                 |
| `src/frontend/styles/index.css`                            | 模板样式                       |
| `src/frontend/locales/en-US.ts`                            | 前端文案                       |
| `public/vext-mark.svg`、`public/favicon.svg`               | 标识和站点图标                 |

这里的“Launchpad”只是默认应用首页的名称，不是额外的运行模式。

## 修改首页

将下面两个文件替换为所示内容。整文件替换会删除 `routes/index.ts` 原有的 `/api/hello`、`/api/health` 示例；已有业务项目只替换首页 handler，并保留其他路由。

```tsx
// src/frontend/pages/index.tsx
export default function HomePage(props: { greeting: string }) {
  return <main>{props.greeting}</main>;
}
```

```ts
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => {
    res.render("index", { greeting: "Hello from Vext" });
  });
});
```

保存后重新访问 `/`，应看到 `Hello from Vext`。如果开发界面提示刷新，按提示刷新；这一检查验证服务端 HTML，不要求先配置客户端路由。

## 添加页面

创建缺失的 `admin` 子目录，再添加下面两个文件。数字 `42` 是固定演示数据，不依赖尚未创建的数据库或 service：

```tsx
// src/frontend/pages/admin/dashboard.tsx
export default function DashboardPage(props: { totalUsers: number }) {
  return <main>Total users: {props.totalUsers}</main>;
}
```

在 route 中渲染：

```ts
// src/routes/admin/dashboard.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => {
    res.render("admin/dashboard", { totalUsers: 42 });
  });
});
```

访问 `/admin/dashboard` 应看到 `Total users: 42`。文件路径已经贡献 `/admin/dashboard` 前缀，所以 handler 注册 `/`；不要再次写完整 URL。page id 则是前端页面根下不带扩展名的相对路径。路由前缀规则见[路由指南](/zh/guide/routing)。

## 添加组件

新建一个展示组件：

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

然后将 dashboard 页面替换为下面的内容，实际使用该组件。`@components` 是默认前端 alias：

```tsx
// src/frontend/pages/admin/dashboard.tsx
import { Stat } from "@components/Stat";

export default function DashboardPage(props: { totalUsers: number }) {
  return <Stat label="Total users" value={props.totalUsers} />;
}
```

## 添加样式

这里用 Vext JSCSS 的 `style()` 定义一份静态卡片样式。普通 CSS 也可使用；CSS Modules 的默认生产 SSR 命名限制见[样式与资源](./styles-and-assets#css-modules)。

```ts
// src/frontend/styles/card.style.ts
import { style } from "vextjs/style";

export const card = style({
  padding: 16,
  borderRadius: 8,
});
```

再将组件替换为下面的内容，导入样式并把返回的类名应用到元素：

```tsx
// src/frontend/components/Stat.tsx
import { card } from "@styles/card.style";

export function Stat(props: { label: string; value: number }) {
  return (
    <section className={card}>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </section>
  );
}
```

重新打开 `/admin/dashboard`，仍应显示 `42` 和 `Total users`，卡片带有内边距和圆角。只定义样式文件而不导入和应用类名，不会让组件自动使用它。需要 variants、CSS variables 和抽取产物时，阅读 [Vext JSCSS](/zh/frontend/jscss)。

## 验证构建

在运行开发服务的终端按 Ctrl+C 停止开发服务，再执行：

```bash
npm run build
npm start -- --port 3000
```

默认 TypeScript 模板的 build 脚本包含类型检查，并构建服务端和前端产物。启动成功后检查：

1. `/` 返回 HTML，并显示 `Hello from Vext`。
2. `/admin/dashboard` 显示 `42` 和 `Total users`，样式正常。
3. 浏览器没有页面脚本或样式加载失败；查看终端是否有 render 错误。

这组静态示例不验证交互状态更新。需要交互时，继续按[Hydration](/zh/frontend/hydration)验证浏览器行为。完整发布和资源交付见[构建与发布](/zh/frontend/build-and-deploy)。验证后按 Ctrl+C 停止服务。

## 失败时先检查

| 现象                         | 检查                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| page not found               | page id 是否和 `src/frontend/pages/**` 下的路径一致且不带扩展名。                                                                       |
| 浏览器 bundle 引入服务端文件 | service / database 调用应放回 `src/routes/**` 或 `src/services/**`。                                                                    |
| 新页面 404                   | 检查 route 文件与文件前缀，确认新增文件后服务已经重新加载。                                                                             |
| 样式没有更新                 | 检查样式 import 和 className 是否实际使用，再检查开发日志、hot/Fast Refresh 配置。                                                      |
| API 请求拿到 HTML            | 先确认 API handler 仍存在且返回 JSON；如果使用 SPA fallback，再检查 scopes 和请求的 Accept。Accept 本身不会把显式 render 路由变成 API。 |
| 提示模块或类型不存在         | 确认在项目目录完成依赖安装；不要删掉模板的 tsconfig alias 配置。                                                                        |

下一步阅读 [项目结构](/zh/frontend/project-structure) 与 [路由与页面](/zh/frontend/routing-and-pages)。

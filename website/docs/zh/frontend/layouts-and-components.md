# Layout 与组件

本页接续[项目结构](/zh/frontend/project-structure)中的 `admin/dashboard` 页面：为它添加根布局、后台布局和可复用菜单。先掌握[路由与页面](/zh/frontend/routing-and-pages)的 `res.render` 调用方式。

## 目录导航

- [自动 Layout Chain](#自动-layout-chain)
- [显式选择 Layout](#显式选择-layout)
- [Layout Data 结构](#layout-data-结构)
- [可复用 Shell](#可复用-shell)
- [公共组件](#公共组件)
- [SSR-safe 组件](#ssr-safe-组件)

## 自动 Layout Chain

Vext layout 是页面目录中名为 `layout` 的组件文件，默认可以使用 `layout.tsx`。下面使用默认目录：

```text
src/frontend/pages/
  layout.tsx
  admin/
    layout.tsx
    dashboard.tsx
```

执行 `res.render("admin/dashboard")` 时，自动布局从外到内是根 layout、admin layout、页面。布局 ID 是相对页面根的目录：根布局为 `"."`，后台布局为 `"admin"`，不是 `"layout"` 或 `"admin/layout"`。

layout 适合稳定页面外壳：导航、侧边栏、账号菜单、面包屑、admin chrome。

## 显式选择 Layout

`res.render` 第三个参数中的 `options.layout` 控制本次布局。当前全局 `frontend.render.layout` 虽可配置，但渲染器尚未消费它；需要禁用布局时使用每次渲染的 `layout: false`。

| 值            | 含义                                                     |
| ------------- | -------------------------------------------------------- |
| `true` 或省略 | 使用自动目录 layout chain                                |
| `false`       | 当前 render 禁用 layout                                  |
| `string`      | 使用一个指定 layout                                      |
| `string[]`    | 选择一组布局，按注册表顺序应用，不按数组输入顺序重新排序 |

```ts
res.render("admin/dashboard", props, {
  layout: [".", "admin"],
});
```

当两个不同目录的 route 想复用同一个 shell，或错误页想使用极简 shell 时，用显式 layout。

上面是处理器内的选项片段，`props` 由业务提供。未注册的布局 ID 会被过滤，不会自动创建布局或报“布局不存在”；因此应检查最终页面是否真的包含预期外壳。

## Layout Data 结构

通过第三个 render 参数传递 layout 数据。以下代码替换已有 `admin/dashboard` 路由处理器中的渲染调用；数据在处理器内定义，实际业务可改为 service 返回值。

```ts
const stats = { totalUsers: 42 };
const user = { name: "Ada" };
const menu = [{ label: "Dashboard", href: "/admin/dashboard" }];
const permissions = { canRead: true };
res.render("admin/dashboard", stats, {
  layoutData: {
    ".": { user },
    admin: { menu, permissions },
  },
});
```

layout data 应保持小而可序列化。优先传 ID、标签、URL、权限布尔值，不要把原始 ORM record 直接塞进去。

布局组件通过 `props.data` 读取对应 ID 的数据，页面 props 不会自动合并进布局。例如根布局文件：

```tsx
// src/frontend/pages/layout.tsx
import type { ReactNode } from "react";

export default function RootLayout(props: {
  children?: ReactNode;
  data?: { user?: { name: string } };
}) {
  return (
    <div data-layout="root">
      <header>{props.data?.user?.name}</header>
      {props.children}
    </div>
  );
}
```

## 可复用 Shell

多个 layout 共享 UI 时，把 UI 抽到 `src/frontend/components/**`。

```tsx
// src/frontend/components/AdminShell.tsx
import type { ReactNode } from "react";

export function AdminShell(props: {
  menu: Array<{ label: string; href: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="admin-shell">
      <aside>
        {props.menu.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </aside>
      <main>{props.children}</main>
    </div>
  );
}
```

然后在 layout 中引用：

```tsx
// src/frontend/pages/admin/layout.tsx
import type { ReactNode } from "react";
import { AdminShell } from "@components/AdminShell";

export default function AdminLayout(props: {
  children?: ReactNode;
  data?: { menu?: Array<{ label: string; href: string }> };
}) {
  return (
    <AdminShell menu={props.data?.menu ?? []}>{props.children}</AdminShell>
  );
}
```

## 公共组件

公共组件必须是 browser-safe。它可以接收服务端准备的 props，但不能 import services 或 Node-only 模块。

```tsx
export function StatusBadge(props: { status: "open" | "closed" }) {
  return <span data-status={props.status}>{props.status}</span>;
}
```

只被单个页面使用的组件可以定义在同一个页面文件中；独立组件文件放在 `src/frontend/components/**`。页面目录会扫描匹配扩展名的文件作为页面，不应把它当作任意组件存放目录。

## SSR-safe 组件

启用 SSR 与 hydration 时，初始输出需要在服务端和浏览器保持一致：

- 不要在初始 render 中调用 `Date.now()`、`Math.random()` 或浏览器专属 API。
- 语言文案从 `useVextI18n()` 或服务端 props 读取。
- 请求相关数据从 props 或 `layoutData` 读取。
- 浏览器专属逻辑放到 `useEffect`。

这样可以保持 SSR HTML 与浏览器 hydration 一致。

## 验证布局

执行 `npm run build`，通过后执行 `npm start -- --port 3000`，访问 `/admin/dashboard`，检查根布局中的 `Ada`、后台菜单链接与原页面内容。再把该次 `res.render` 选项设为 `layout: false`，重新构建启动后确认外壳消失、页面内容保留；恢复选项并停止验证服务。菜单数据不显示时，先检查 `layoutData` 的键与布局的 `props.data`，再检查该布局是否被选中。

交互一致性另见 [Hydration 验证](/zh/frontend/hydration-validation)；服务端数据边界见[数据流](/zh/frontend/data-flow)。

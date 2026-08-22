# Layout 与组件

## 目录导航

- [自动 Layout Chain](#自动-layout-chain)
- [显式选择 Layout](#显式选择-layout)
- [Layout Data 结构](#layout-data-结构)
- [可复用 Shell](#可复用-shell)
- [公共组件](#公共组件)
- [SSR-safe 组件](#ssr-safe-组件)

## 自动 Layout Chain

Vext layout 是 `src/frontend/pages/**` 下命名为 `layout.tsx` 的 React 组件。

```text
src/frontend/pages/
  layout.tsx
  admin/
    layout.tsx
    dashboard.tsx
```

执行 `res.render("admin/dashboard")` 时，Vext 可以先应用根 layout，再应用 admin layout，最后渲染页面。

layout 适合稳定页面外壳：导航、侧边栏、账号菜单、面包屑、admin chrome。

## 显式选择 Layout

`options.layout` 控制 layout 行为。

| 值            | 含义                                     |
| ------------- | ---------------------------------------- |
| `true` 或省略 | 使用自动目录 layout chain                |
| `false`       | 当前 render 禁用 layout                  |
| `string`      | 使用一个指定 layout                      |
| `string[]`    | 按 outer 到 inner 的顺序使用指定 layouts |

```ts
res.render("admin/dashboard", props, {
  layout: ["layout", "admin/layout"],
});
```

当两个不同目录的 route 想复用同一个 shell，或错误页想使用极简 shell 时，用显式 layout。

## Layout Data 结构

通过第三个 render 参数传递 layout 数据。

```ts
res.render(
  "admin/dashboard",
  { stats },
  {
    layoutData: {
      root: { user },
      admin: { menu, permissions },
    },
  },
);
```

layout data 应保持小而可序列化。优先传 ID、标签、URL、权限布尔值，不要把原始 ORM record 直接塞进去。

## 可复用 Shell

多个 layout 共享 UI 时，把 UI 抽到 `src/frontend/components/**`。

```tsx
// src/frontend/components/AdminShell.tsx
export function AdminShell(props: {
  menu: Array<{ label: string; href: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell">
      <aside>
        {props.menu.map((item) => (
          <a href={item.href}>{item.label}</a>
        ))}
      </aside>
      <main>{props.children}</main>
    </div>
  );
}
```

然后在 layout 中引用：

```tsx
import { AdminShell } from "@components/AdminShell";

export default function AdminLayout(props: { children: React.ReactNode }) {
  return <AdminShell menu={[]}>{props.children}</AdminShell>;
}
```

## 公共组件

公共组件必须是 browser-safe。它可以接收服务端准备的 props，但不能 import services 或 Node-only 模块。

```tsx
export function StatusBadge(props: { status: "open" | "closed" }) {
  return <span data-status={props.status}>{props.status}</span>;
}
```

只被单个页面使用的组件可以靠近页面放；多处复用的 UI 放 `src/frontend/components/**`。

## SSR-safe 组件

第一次 render 会在服务端执行，然后浏览器 hydration。避免首屏输出不一致：

- 不要在初始 render 中调用 `Date.now()`、`Math.random()` 或浏览器专属 API。
- 语言文案从 `useVextI18n()` 或服务端 props 读取。
- 请求相关数据从 props 或 `layoutData` 读取。
- 浏览器专属逻辑放到 `useEffect`。

这样可以保持 SSR HTML 与浏览器 hydration 一致。

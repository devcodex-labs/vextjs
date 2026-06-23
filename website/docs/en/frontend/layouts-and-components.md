# Layouts and Components

## Table of Contents

- [Automatic Layout Chain](#automatic-layout-chain)
- [Explicit Layout Selection](#explicit-layout-selection)
- [Layout Data Shape](#layout-data-shape)
- [Reusable Shells](#reusable-shells)
- [Shared Components](#shared-components)
- [SSR-safe Components](#ssr-safe-components)

## Automatic Layout Chain

Vext layouts are React components named `layout.tsx` under `src/frontend/pages/**`.

```text
src/frontend/pages/
  layout.tsx
  admin/
    layout.tsx
    dashboard.tsx
```

For `res.render("admin/dashboard")`, Vext can apply the root layout and then the admin layout. The page is rendered inside that chain.

Use layouts for stable page shells: nav, sidebars, account menus, breadcrumbs, and admin chrome.

## Explicit Layout Selection

`options.layout` controls layout behavior.

| Value | Meaning |
|-------|---------|
| `true` or omitted | Use the automatic directory layout chain |
| `false` | Disable layouts for this render |
| `string` | Use one named layout |
| `string[]` | Use explicit layouts from outer to inner |

```ts
res.render("admin/dashboard", props, {
  layout: ["layout", "admin/layout"],
});
```

Use explicit layout selection when two routes in different directories share the same shell, or when an error page should use a minimal shell.

## Layout Data Shape

Pass layout data through the third render argument.

```ts
res.render("admin/dashboard", { stats }, {
  layoutData: {
    root: { user },
    admin: { menu, permissions },
  },
});
```

Keep layout data small and serializable. Prefer IDs, labels, URLs, and permission flags over raw ORM records.

## Reusable Shells

When several layouts share UI, move the UI to `src/frontend/components/**`.

```tsx
// src/frontend/components/AdminShell.tsx
export function AdminShell(props: {
  menu: Array<{ label: string; href: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell">
      <aside>{props.menu.map((item) => <a href={item.href}>{item.label}</a>)}</aside>
      <main>{props.children}</main>
    </div>
  );
}
```

Then import it from a layout:

```tsx
import { AdminShell } from "@components/AdminShell";

export default function AdminLayout(props: { children: React.ReactNode }) {
  return <AdminShell menu={[]}>{props.children}</AdminShell>;
}
```

## Shared Components

Shared components should be browser-safe. They may receive server-prepared props, but they should not import services or Node-only modules.

```tsx
export function StatusBadge(props: { status: "open" | "closed" }) {
  return <span data-status={props.status}>{props.status}</span>;
}
```

Put page-specific components near the page only if they are not shared. Put common UI in `src/frontend/components/**`.

## SSR-safe Components

The first render runs on the server and then hydrates in the browser. Avoid first-render differences:

- Do not call `Date.now()`, `Math.random()`, or browser-only APIs during initial render.
- Read language from `useVextI18n()` or server-provided props.
- Read request-specific data from props or `layoutData`.
- Move browser-only work into `useEffect`.

This keeps SSR HTML and browser hydration consistent.


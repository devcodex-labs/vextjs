# Layouts and Components

First complete [Add Another Page in the full-stack quick start](/frontend/getting-started#add-another-page) and confirm `/admin/dashboard` displays `Total users: 42`. It supplies the page file and HTTP route required here; Project Structure explains file responsibilities but does not provide this complete prerequisite. Continue here to add root and admin layouts and a reusable menu. See [Routing and Pages](/frontend/routing-and-pages) for `res.render` basics.

Create `components/AdminShell.tsx` and `pages/admin/layout.tsx` below. If root `pages/layout.tsx` already exists, replace it with the root layout example while retaining any required style imports. The root layout affects every page using automatic layouts; the admin layout affects pages in that directory. Keep the original `admin/dashboard.tsx` page and replace only the route's render call.

## Table of Contents

- [Automatic Layout Chain](#automatic-layout-chain)
- [Explicit Layout Selection](#explicit-layout-selection)
- [Layout Data Shape](#layout-data-shape)
- [Reusable Shells](#reusable-shells)
- [Shared Components](#shared-components)
- [SSR-safe Components](#ssr-safe-components)
- [Verify Layouts](#verify-layouts)

## Automatic Layout Chain

Vext layouts are components named `layout` under the page directory; `layout.tsx` is the default form used here.

```text
src/frontend/pages/
  layout.tsx
  admin/
    layout.tsx
    dashboard.tsx
```

For `res.render("admin/dashboard")`, the automatic chain runs from the root layout to the admin layout and then the page. Layout IDs are directories relative to the page root: `"."` for the root and `"admin"` for the admin layout, not `"layout"` or `"admin/layout"`.

Use layouts for stable page shells: nav, sidebars, account menus, breadcrumbs, and admin chrome.

## Explicit Layout Selection

The third `res.render` argument, `options.layout`, controls this render. Global `frontend.render.layout` can currently be configured, but the renderer does not consume it yet; use per-render `layout: false` to disable layouts.

| Value             | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `true` or omitted | Use the automatic directory layout chain                                   |
| `false`           | Disable layouts for this render                                            |
| `string`          | Use one named layout                                                       |
| `string[]`        | Select layouts applied in registry order, not reordered by the input array |

```ts
res.render("admin/dashboard", props, {
  layout: [".", "admin"],
});
```

Use explicit layout selection when two routes in different directories share the same shell, or when an error page should use a minimal shell.

The call above is an option snippet inside a handler; the application provides `props`. An unregistered layout ID is filtered out. It neither creates a layout nor reports “layout missing,” so inspect the final page to confirm the expected shell appears.

## Layout Data Shape

Pass layout data through the third render argument. This replaces the render call in the existing `admin/dashboard` handler; the handler defines these values locally, while a real application may obtain them from services.

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

Keep layout data small and serializable. Prefer IDs, labels, URLs, and permission flags over raw ORM records.

Each layout reads the data under its ID through `props.data`; page props are not merged into the layout automatically. For example, the root layout can be:

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

## Reusable Shells

When several layouts share UI, move the UI to `src/frontend/components/**`.

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

Then import it from a layout:

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

## Shared Components

Shared components should be browser-safe. They may receive server-prepared props, but they should not import services or Node-only modules.

```tsx
export function StatusBadge(props: { status: "open" | "closed" }) {
  return <span data-status={props.status}>{props.status}</span>;
}
```

A component used by only one page can live in that page file. Place a separate component file under `src/frontend/components/**`. The page directory scans files with matching extensions as pages; do not treat it as an arbitrary component directory.

## SSR-safe Components

The first render runs on the server and then hydrates in the browser. Avoid first-render differences:

- Do not call `Date.now()`, `Math.random()`, or browser-only APIs during initial render.
- Read language from `useVextI18n()` or server-provided props.
- Read request-specific data from props or `layoutData`.
- Move browser-only work into `useEffect`.

This keeps SSR HTML and browser hydration consistent.

## Verify Layouts

Run `npm run build`, then `npm start -- --port 3000` after success. Open `/admin/dashboard` and check for `Ada` in the root layout, the admin menu link, and the original page content. Set that `res.render` call to `layout: false`, rebuild and restart, then confirm the shells disappear but page content remains. Restore the option and stop the verification service. If menu data does not appear, check the `layoutData` key and layout `props.data`, then confirm that layout was selected.

For interaction consistency, see [Hydration Validation](/frontend/hydration-validation). See [Data Flow](/frontend/data-flow) for server data boundaries.

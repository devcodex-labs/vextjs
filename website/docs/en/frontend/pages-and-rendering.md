# Pages and Rendering

## Table of Contents

- [Page Files](#page-files)
- [Render from Routes](#render-from-routes)
- [Services and Server Data](#services-and-server-data)
- [Layouts](#layouts)
- [Shared Components](#shared-components)
- [I18n](#i18n)
- [Error Pages](#error-pages)
- [HTML Document](#html-document)

## Page Files

Pages live under `src/frontend/pages/**`.

```text
src/frontend/pages/
  index.tsx                 -> res.render("index")
  dashboard.tsx             -> res.render("dashboard")
  admin/
    dashboard.tsx           -> res.render("admin/dashboard")
  error/
    default.tsx             -> default error page
```

Vext generates the page registry during dev and build. You do not hand-write the browser entry file.

## Render from Routes

Routes keep the same shape as API routes. The only difference is that the handler calls `res.render()` instead of `res.json()` or `res.text()`.

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

Server-only modules stay inside the route handler. The browser bundle receives only the serialized props.

## Services and Server Data

Use services from `src/routes/**`, not from `src/frontend/**`.

```ts
app.get("/admin", { cache: { ttl: 30_000 } }, async (req, res) => {
  const user = await app.services.auth.requireUser(req);
  const menu = await app.services.admin.menu(user.id);

  res.render("admin/dashboard", { user }, { layoutData: { menu } });
});
```

When a route uses response cache, `res.render()` stores the render payload for that route. On a cache hit Vext still re-renders the HTML with the current frontend renderer, so static JS/CSS can remain content-hashed and CDN-friendly.

## Layouts

Layouts are regular React files named `layout.tsx` under `src/frontend/pages/**`.

```text
src/frontend/pages/
  layout.tsx
  admin/
    layout.tsx
    dashboard.tsx
```

For `admin/dashboard`, Vext can apply the root layout and then the nested admin layout. Shared layout UI should be extracted to `src/frontend/components/**` when multiple route branches need the same shell.

Use `options.layoutData` for server-prepared layout data:

```ts
res.render("admin/dashboard", { stats }, {
  layoutData: {
    user,
    menu,
    permissions,
  },
});
```

Layout components receive their layout data through the Vext frontend runtime. Keep expensive service calls in the route handler, not in browser components.

## Shared Components

Shared components live under `src/frontend/components/**`.

```tsx
// src/frontend/components/UserCard.tsx
export function UserCard(props: { name: string }) {
  return <section>{props.name}</section>;
}
```

Use the default aliases in examples and application code:

```tsx
import { UserCard } from "@components/UserCard";
```

Common aliases are `@frontend`, `@pages`, `@components`, `@styles`, and `@assets`.

## I18n

Frontend copy lives under `src/frontend/locales/**` and should keep the same object shape across locales.

```ts
// src/frontend/locales/en-US.ts
export default {
  dashboard: {
    title: "Dashboard",
  },
};
```

Use object access in components:

```tsx
import { useVextI18n } from "vextjs/frontend";

export default function Dashboard() {
  const i18n = useVextI18n();
  return <h1>{i18n.dashboard.title}</h1>;
}
```

The default browser mode is `frontend.i18n.clientLoad: "current"`, so hydration only loads the SSR locale. Use `"all"` only when a page needs no-reload locale switching.

## Error Pages

The default error page is:

```text
src/frontend/pages/error/default.tsx
```

You can render errors explicitly:

```ts
res.renderError(404);
res.renderError(500, "error/default");
res.renderError(error, "error/default", { props: { requestId } });
```

API and JSON requests keep JSON error semantics. Static asset 404s do not render the HTML error page.

## HTML Document

The default document template is:

```text
src/frontend/pages/_document.html
```

Use Vext document placeholders:

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

Route handlers pass page data through `res.render()`; the server renderer serializes it into the document and the browser runtime hydrates the same page.


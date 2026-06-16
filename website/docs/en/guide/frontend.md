# Frontend integration

Vext frontend integration is the in-development path for keeping HTTP routes, service data, React pages, SSR, hydration, React Fast Refresh, production builds, and static asset serving inside one Vext project. The default frontend path is designed for Vext full-stack usage, while the backend runtime contract remains framework-independent.

:::warning Under development
This page describes the target experience for the frontend integration that is still under development. It is meant to align implementation and user-facing usage. Until the feature is implemented and released, do not treat `src/frontend/pages/**`, `src/frontend/locales/**`, `res.render()`, `renderError()`, `frontend.i18n`, `useVextI18n()`, React Fast Refresh, SSR, layout chains, or automatic browser entry generation as stable published APIs.
:::

The core model is simple: URLs are still defined in `src/routes/**`; frontend source lives under `src/frontend/**`; page components live in `src/frontend/pages/**`; frontend page copy lives under `src/frontend/locales/**`; a route handler returns an HTML page by calling `res.render(page, props, options)`. Server data is prepared in the route handler or a service, then passed to the page as props, layoutData, or messages. Server-only code is not bundled into the browser output. During development, React pages, layouts, shared components, and styles use Fast Refresh or CSS hot updates by default; when route/service code that affects rendering changes, the browser action is controlled by `frontend.dev.renderRefresh`. Pages, layouts, and shared components can use default aliases such as `@components`, `@styles`, and `@assets`; when they need localized copy, they use `useVextI18n(locale?)` from `vextjs/frontend` and read object properties such as `i18n.dashboard.title`. These capabilities stay inside the frontend source boundary.

## Table of Contents

- [1. When to use Vext Frontend](#1-when-to-use-vext-frontend)
- [2. Create and run a full-stack project](#2-create-and-run-a-full-stack-project)
- [3. Default project structure](#3-default-project-structure)
- [4. Add page files](#4-add-page-files)
- [5. Render a page from a route](#5-render-a-page-from-a-route)
- [6. Use services to prepare page data](#6-use-services-to-prepare-page-data)
- [7. Use layouts for page shells](#7-use-layouts-for-page-shells)
- [8. Shared components](#8-shared-components)
- [9. Style organization](#9-style-organization)
- [10. Images and static assets](#10-images-and-static-assets)
- [11. Call Vext APIs](#11-call-vext-apis)
- [12. Page internationalization](#12-page-internationalization)
- [13. Error pages and renderError](#13-error-pages-and-rendererror)
- [14. HTML template](#14-html-template)
- [15. Configure frontend](#15-configure-frontend)
- [16. Develop, build, and start](#16-develop-build-and-start)
- [17. Disable frontend for API-only projects](#17-disable-frontend-for-api-only-projects)
- [18. Troubleshooting](#18-troubleshooting)
- [19. Default boundaries and future capabilities](#19-default-boundaries-and-future-capabilities)

## 1. When to use Vext Frontend

Use the default frontend integration when:

- You want one Vext project to provide APIs, server-rendered pages, and browser interactions.
- You want `src/routes/**` to be the entry point for both API routes and page routes.
- You want route handlers to call `app.services` before rendering SSR page data.
- You want clear enterprise-style default directories for pages, shared components, styles, and static assets.
- You want `vext dev` to handle backend reloads, React Fast Refresh, and frontend builds together.
- You want `vext build` to output both server artifacts and frontend page artifacts.

API-only projects can disable the built-in frontend. Projects that need another frontend framework can use future integration points, while this guide documents the default Vext full-stack React path.

## 2. Create and run a full-stack project

Create the default full-stack React project:

```bash
npx vextjs create my-app
cd my-app
npm install
npm run dev
```

The default port is `3000`. After the dev server is ready, open:

```text
http://localhost:3000/
```

The default home page flow is:

```text
GET / -> src/routes/index.ts -> res.render("index")
```

In other words, `src/frontend/pages/index.tsx` does not automatically create a URL. The route handler explicitly renders the page.

## 3. Default project structure

A default full-stack React project creates:

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
│   │   │   └── index.css
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

| File or directory | How to use it |
| --- | --- |
| `src/frontend/**` | User frontend source root. Pages, components, styles, and bundled assets stay here instead of mixing with server directories. |
| `src/frontend/pages/**` | Page components, directory-level `layout.tsx`, `_document.html`, and error pages. The relative file path is the page id passed to `res.render(page)`. |
| `src/frontend/pages/error/default.tsx` | Default error page used when no status-specific page exists. |
| `src/frontend/pages/error/**` | Status-specific error pages, such as `error/404` and `error/500`. |
| `src/frontend/components/**` | Shared components, layout components, form components, and reusable error UI. |
| `src/frontend/styles/**` | Global CSS, theme variables, and page style entries. The default entry is `src/frontend/styles/index.css`. |
| `src/frontend/assets/**` | Images, SVGs, fonts, and similar assets imported from TSX or CSS. |
| `src/frontend/locales/**` | Copy dictionaries for frontend pages, layouts, shared components, and error pages. Do not put page copy into the backend `src/locales/**` error-message directory. |
| `@components/*` and other aliases | Frontend-only import shortcuts. They resolve inside `src/frontend/**`, not into `src/routes/**` or `src/services/**`. |
| `public/**` | Static public files served as-is, such as favicons, robots files, and verification files. |
| `src/routes/**` | HTTP routes. API URLs and page URLs are both defined here. |
| `src/services/**` | Server-side business logic. Route handlers call services, then pass results to pages. |
| `src/config/**` | Vext configuration, including the `frontend` block. |

You do not create `src/client/main.tsx` or `src/client/index.html` for new projects. Vext generates the browser entry, page registry, layout registry, error page registry, and runtime code.

## 4. Add page files

Add a page file:

```text
src/frontend/pages/dashboard.tsx
```

A page is a normal React component:

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

The page id is the relative path under `src/frontend/pages/` without the extension:

| File | Page id |
| --- | --- |
| `src/frontend/pages/index.tsx` | `index` |
| `src/frontend/pages/dashboard.tsx` | `dashboard` |
| `src/frontend/pages/users/detail.tsx` | `users/detail` |
| `src/frontend/pages/error/404.tsx` | `error/404` |

Creating a page file does not create a URL. You still render it from `src/routes/**` with `res.render()`.

## 5. Render a page from a route

The route shape stays the same as normal Vext routes. In the handler, call `res.render()` instead of `res.json()`.

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

`res.render(page, props?, options?)` has three parameters:

| Parameter | Required | Description |
| --- | :---: | --- |
| `page` | Yes | A page id under `src/frontend/pages/**`. It is not a URL and not an absolute file path. |
| `props` | No | Data passed to the page component. It must be JSON-safe. |
| `options` | No | HTML response options for this render, such as `status`, `headers`, `title`, `description`, `head`, `nonce`, `locale`, `messages`, `layout`, and `layoutData`. |

With title, status, and headers:

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

Do not put page rendering configuration in route `options`. Route `options` continue to describe backend route behavior such as `validate`, `middlewares`, `docs`, and `override`; page rendering happens in the handler.

Set page head content from the same render call:

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

`title`, `description`, and `meta` are shortcuts for common pages. Use `head` when you need Open Graph tags, canonical links, preload links, or custom script/link attributes. If your app uses a Content Security Policy, pass a per-request `nonce`; Vext applies it to its generated data and entry scripts.

## 6. Use services to prepare page data

Put server data logic in services. A route handler calls the service, then passes the result to the page as props.

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

Do not import `src/services/**` from `src/frontend/pages/**` or `src/frontend/components/**`. Pages and components enter the browser build; services should only run inside server route handlers.

## 7. Use layouts for page shells

Default layout files live under `src/frontend/pages/**` and use the fixed file name `layout.tsx`. Vext collects every existing `layout.tsx` from the pages root down to the page directory, then wraps the page from outer to inner during server rendering. Any nested directory can have its own `layout.tsx`; directories without a layout are skipped.

For example:

```text
src/frontend/pages/layout.tsx
src/frontend/pages/admin/layout.tsx
src/frontend/pages/admin/settings/layout.tsx
src/frontend/pages/admin/settings/users/index.tsx
```

Rendering `admin/settings/users/index` uses this default wrapping order:

```text
src/frontend/pages/layout.tsx
  -> src/frontend/pages/admin/layout.tsx
    -> src/frontend/pages/admin/settings/layout.tsx
      -> src/frontend/pages/admin/settings/users/index.tsx
```

Root layout example:

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

An admin layout can receive layoutData from the route handler:

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

Pass layoutData from the route handler:

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

Layouts only return the React application shell. They do not return `<html>`, `<head>`, or `<body>`; those belong to `_document.html`. If a page should skip the default layout chain, disable it explicitly:

```ts
return res.render("embed", props, { layout: false });
```

When different routes or pages need the same shell, prefer putting the shared shell under `src/frontend/components/layout/**` and importing it from multiple directory layouts:

```tsx
// src/frontend/pages/admin/layout.tsx
import { AdminShell } from "@components/layout/AdminShell";

export default function AdminLayout({ children, data }) {
  return <AdminShell user={data?.user}>{children}</AdminShell>;
}
```

For the less common case where a route needs to reuse a full layout chain across directories, pass it explicitly for that response:

```ts
return res.render("dashboard", props, {
  layout: ["layout", "admin/layout"],
});
```

`layout: true` uses the automatic chain; `layout: false` disables layouts; `layout: string | string[]` replaces the automatic chain, and array order is outer to inner. Error pages use the same layout rules by default unless you disable layout in `renderError` options.

## 8. Shared components

Put reusable UI in `src/frontend/components/**`:

```text
src/frontend/components/layout/AppShell.tsx
src/frontend/components/error/ErrorPanel.tsx
src/frontend/components/ui/Button.tsx
```

Import shared components from pages:

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

`components` is a user code directory, not a URL routing directory. Components are not exposed as pages automatically; only pages under `src/frontend/pages/**` that are referenced by `res.render()` become page entries.

Default aliases:

| Alias | Target |
| --- | --- |
| `@frontend/*` | `src/frontend/*` |
| `@pages/*` | `src/frontend/pages/*` |
| `@components/*` | `src/frontend/components/*` |
| `@styles/*` | `src/frontend/styles/*` |
| `@assets/*` | `src/frontend/assets/*` |

Vext does not provide `@/* -> src/*` by default. This prevents frontend pages from accidentally importing `src/services/**`, `src/routes/**`, or `src/config/**` into the browser bundle. Custom aliases should also stay within the `src/frontend/**` boundary.

## 9. Style organization

The default global style entry is:

```text
src/frontend/styles/index.css
```

Vext includes it in the generated browser entry. A typical file looks like:

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

Pages or components can also import CSS directly:

```tsx
import "../styles/dashboard.css";

export default function DashboardPage() {
  return <main className="dashboard">Dashboard</main>;
}
```

CSS is bundled by esbuild into frontend assets, and Vext injects the generated CSS links into the HTML template.

## 10. Images and static assets

Vext recommends two asset locations:

| Location | Best for | How to reference |
| --- | --- | --- |
| `public/**` | Favicons, robots files, public images or files that should not be hashed | Use URLs such as `/favicon.svg` or `/brand/logo.png` |
| `src/frontend/assets/**` | Images, SVGs, and fonts imported by pages or CSS | Import from TSX or CSS; esbuild emits hashed assets |

`public/` example:

```text
public/logo.png
```

```tsx
export function HeaderLogo() {
  return <img src="/logo.png" alt="Logo" />;
}
```

`src/frontend/assets/` example:

```text
src/frontend/assets/hero.png
```

```tsx
import heroUrl from "../assets/hero.png";

export function HomeHero() {
  return <img src={heroUrl} alt="Home hero" />;
}
```

If TypeScript reports missing image module types, add a declaration file in your app:

```ts
// src/frontend/assets.d.ts
declare module "*.png" {
  const src: string;
  export default src;
}
```

## 11. Call Vext APIs

For first-screen data, prefer calling services in the route handler and passing data through `res.render(page, props)`. After the page has loaded, browser interactions such as clicks, filtering, pagination, and form submissions can call Vext APIs in the same project directly.

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

If generated API client support is enabled later, this guide should show the generated import path only. Users should not hand-write route contracts. The current `res.render()` path does not depend on a browser API helper.

For forms and mutations, keep the server boundary the same:

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
      <button disabled={pending}>Save</button>
      {state?.error ? <p>{state.error.message}</p> : null}
    </form>
  );
}
```

The form calls a normal Vext API route. Put validation, authorization, CSRF or same-origin checks, and idempotency handling in the API route or middleware. This version does not add Server Actions or route actions to the default mutation model; Server Actions are a future dedicated capability.

## 12. Page internationalization

Vext uses two i18n layers:

| Layer | Location | Purpose |
| --- | --- | --- |
| Backend locale | `config.locale`, `src/locales/**` | API errors, `app.throw()`, schema-dsl validation messages, `Accept-Language` matching, and `requestContext.locale`. |
| Frontend i18n | `frontend.i18n`, `src/frontend/locales/**` | Page, layout, shared component, and error page copy, SSR initial messages, hydration, and `<html lang>`. |

Keep API error messages and page copy in separate directories. Put page copy here:

```text
src/frontend/locales/zh-CN.ts
src/frontend/locales/en-US.ts
```

Locale files export JSON-safe objects:

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

Pages, layouts, shared components, and error pages read a readonly copy object for the current language with `useVextI18n()`:

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

The default locale file becomes the source of the generated message shape, and other locale files must keep the same object structure during build. This gives editors autocomplete for `i18n.dashboard.title` and surfaces missing copy earlier. To explicitly read another locale, pass it to the hook:

```tsx
const english = useVextI18n("en-US");
```

By default, `res.render()` inherits `requestContext.locale` for the current request. That value comes from `config.locale.supported` and the `Accept-Language` request header:

```ts
app.get("/dashboard", async (_req, res) => {
  const stats = await app.services.dashboard.summary();
  return res.render("dashboard", { stats });
});
```

To override the language for one HTML response, pass `locale` in the third `res.render()` argument:

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

If the route handler needs to add a small amount of page copy at render time, pass `messages`. Messages must be JSON-safe. Do not put functions, React components, database connections, service instances, or request objects in them:

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

For the first version, language switching should use a reload flow: after the user chooses a language, store it in a cookie, user preference API, URL prefix, or another server-visible location, then request HTML again. SSR and hydration will then use the same `locale` and `messages` instead of guessing language again in the browser. Do not call the hook imperatively inside a click handler; update the locale source and let React render again, then `useVextI18n(locale?)` returns the new copy object.

```tsx
export function LanguageSwitch() {
  return (
    <form method="post" action="/api/me/locale">
      <button name="locale" value="zh-CN">中文</button>
      <button name="locale" value="en-US">English</button>
    </form>
  );
}
```

When language changes the HTML output, Vext uses `frontend.i18n.vary` to set `Vary: Accept-Language` or an equivalent cache key. If you use path prefixes or cookies as the language source, include the locale in your production CDN or reverse-proxy cache key.

## 13. Error pages and renderError

Vext looks for these error pages by default:

```text
src/frontend/pages/error/default.tsx
src/frontend/pages/error/404.tsx
src/frontend/pages/error/500.tsx
```

404 page example:

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

Generic error page example:

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

Render an error page explicitly from a handler:

```ts
app.get("/orders/:id", async (req, res) => {
  const order = await app.services.orders.findById(req.params.id);

  if (!order) {
    return res.renderError(404, { id: req.params.id });
  }

  return res.render("orders/detail", { order });
});
```

Specify the error page:

```ts
return res.renderError(404, "error/order-not-found");
```

Pass details and the page at the same time:

```ts
return res.renderError(
  404,
  { id: req.params.id },
  { page: "error/order-not-found" },
);
```

`renderError("error/404")` is not valid usage. Put the page address in the second argument or in `options.page`.

404 response rules:

| Request type | Output |
| --- | --- |
| API/JSON request | JSON 404. |
| Handler calls `res.renderError(404)` | HTML error page. |
| Browser visits an undefined HTML route | HTML 404 error page. |
| Static asset is missing | Does not render an HTML error page. |
| `spaFallback.scopes[]` is explicitly configured and matched | Returns that scope's shell document. |

The default recommendation is to render pages explicitly from routes, not to emulate page routing through SPA fallback.

## 14. HTML template

Most projects do not need a custom HTML template. If you need global meta tags, third-party scripts, or body classes, create:

```text
src/frontend/pages/_document.html
```

Template example:

```html
<!doctype html>
<html lang="{vext.lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    {vext.head}
    {vext.styles}
  </head>
  <body>
    {vext.root}
    {vext.data}
    {vext.entry}
  </body>
</html>
```

Available tokens:

| Token | Meaning |
| --- | --- |
| `{vext.head}` | Title, description, meta, canonical/preload links, and other safe head content from `res.render()` options. |
| `{vext.styles}` | CSS `<link>` tags. |
| `{vext.lang}` | The locale for the current HTML response, used by `<html lang>`. It inherits `requestContext.locale` by default and can be overridden with `options.locale`. |
| `{vext.root}` | React SSR HTML mount node. |
| `{vext.data}` | JSON-safe page props, layout data, locale, and initial messages. Vext escapes the serialized payload before writing it into the page. |
| `{vext.entry}` | Browser entry script. |

The server data flow is: the route handler calls `res.render("page-id", props, options)`; Vext performs SSR on the server; `props`, `layoutData`, `locale`, and `messages` are serialized and escaped into `{vext.data}`; the browser entry reads the same data and hydrates into `{vext.root}`. The template only supports these reserved Vext tokens and does not evaluate arbitrary template expressions.

When you use CSP, pass `nonce` in the third render argument. The same nonce is applied to `{vext.data}`, `{vext.entry}`, and Vext-generated script tags. Do not place raw user input directly in `_document.html`; pass data through `props`, `layoutData`, or `head` so Vext can escape it.

## 15. Configure frontend

Minimal configuration:

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 3000,
  adapter: "native",
  frontend: true,
};

export default config;
```

Full configuration:

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
        outFile: "dist/client/server/renderer.mjs",
        target: "node20",
        format: "esm",
        external: ["react", "react-dom"],
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

Configuration reference:

| Field | Default | Purpose |
| --- | --- | --- |
| `frontend` | `false` | `true` enables default frontend; `false` disables frontend; object form configures details. |
| `frontend.enabled` | `false` | Enables built-in frontend build, SSR, and static serving. |
| `frontend.framework` | `"react"` | Default React frontend. |
| `frontend.root` | `"src/frontend"` | User frontend source root. |
| `frontend.pages.dir` | `"pages"` | Page directory, resolved relative to `frontend.root` by default. |
| `frontend.pages.extensions` | `[".tsx", ".jsx", ".ts", ".js"]` | Page scan extensions. |
| `frontend.componentsDir` | `"components"` | Shared component directory, resolved relative to `frontend.root` by default. |
| `frontend.styles.entry` | `"styles/index.css"` | Global style entry, resolved relative to `frontend.root` by default. |
| `frontend.assetsDir` | `"assets"` | Imported asset directory, resolved relative to `frontend.root` by default. |
| `frontend.publicDir` | `"public"` | Static files copied as-is, resolved relative to the project root by default. |
| `frontend.publicPath` | `"/"` | Public URL prefix for frontend assets. |
| `frontend.dev.hot` | `true` | Enables the development frontend hot-update channel. When disabled, frontend changes fall back to rebuild + reload. |
| `frontend.dev.fastRefresh` | `true` | Enables React Fast Refresh when `framework: "react"`. |
| `frontend.dev.transport` | `"sse"` | Transport for the Vext dev event bus. The first version uses SSE and does not require WebSocket or Vite configuration. |
| `frontend.dev.overlay` | `true` | Shows frontend build errors, Fast Refresh errors, and render refresh prompts in the dev overlay. |
| `frontend.dev.debounceMs` | `50` | Debounce window for development file-save storms. |
| `frontend.dev.renderRefresh` | `"prompt"` | Browser behavior after render-related backend code changes: `"prompt"` shows a refresh prompt, `"auto"` reloads automatically, and `"off"` only records the event. |
| `frontend.alias` | See the default alias table | Frontend import aliases. Defaults resolve only inside `frontend.root`. |
| `frontend.build.client.outDir` | `"dist/client"` | Production browser output directory. |
| `frontend.build.client.assetsDir` | `"assets"` | Output subdirectory for JS, CSS, images, fonts, and other built assets. |
| `frontend.build.client.target` | `"es2022"` | Browser build target. |
| `frontend.build.client.minify` | `true` | Minifies production browser builds. |
| `frontend.build.client.sourcemap` | `false` | Emits sourcemaps for production browser builds. |
| `frontend.build.client.splitting` | `true` | Allows page and shared-code splitting. |
| `frontend.build.client.entryNames` | `"[name]-[hash]"` | Page entry file naming template. |
| `frontend.build.client.chunkNames` | `"[name]-[hash]"` | Shared chunk naming template. |
| `frontend.build.client.assetNames` | `"[name]-[hash]"` | Static asset naming template. |
| `frontend.build.client.manifest` | `true` | Emits the browser manifest. |
| `frontend.build.server.outFile` | `"dist/client/server/renderer.mjs"` | SSR renderer output file. |
| `frontend.build.server.external` | `["react", "react-dom"]` | Packages externalized from the server renderer bundle. |
| `frontend.build.assets.inlineLimit` | `0` | Imported asset inline limit; default emits hashed files. |
| `frontend.build.css.modules` | `true` | Enables CSS Modules convention. Sass, Tailwind, and PostCSS are plugin/user-config capabilities until implemented as defaults. |
| `frontend.build.diagnostics.metafile` | `true` | Emits esbuild metafile for manifests and bundle debugging. |
| `frontend.build.diagnostics.sizeReport` | `true` | Emits size report for page and shared chunks. |
| `frontend.build.diagnostics.leakScan` | `true` | Scans the browser graph and blocks `src/routes/**`, `src/services/**`, `node:*`, and other server-only inputs. |
| `frontend.deploy.assetBaseUrl` | `undefined` | CDN asset base URL. When set, static asset URLs in HTML and manifests use this prefix. |
| `frontend.deploy.crossOrigin` | `undefined` | `crossorigin` policy for CDN script/link tags. |
| `frontend.deploy.integrity` | `false` | Whether to emit integrity metadata; initially this can remain reserved until implemented. |
| `frontend.render.ssr` | `true` | Enables page SSR. |
| `frontend.render.fallback` | `"client"` | Whether SSR failure falls back to client rendering. |
| `frontend.render.timeoutMs` | `3000` | Timeout for one SSR render. |
| `frontend.render.layout` | `true` | Enables the default layout chain. A single `res.render()` call can override it with `options.layout`. |
| `frontend.errorPages.default` | `"error/default"` | Default error page. |
| `frontend.errorPages.status.404` | `"error/404"` | 404 error page. |
| `frontend.errorPages.status.500` | `"error/500"` | 500 error page. |
| `frontend.i18n.enabled` | `false` | Enables the frontend page-copy layer. Backend API error language still belongs to `config.locale`. |
| `frontend.i18n.source` | `"locales"` | Frontend page-copy directory, resolved relative to `frontend.root` as `src/frontend/locales`. |
| `frontend.i18n.defaultLocale` | `"inherit"` | Inherits `config.locale.default` by default. You can also set a supported locale such as `zh-CN` or `en-US`. |
| `frontend.i18n.detect` | `["accept-language"]` | Language detection source for the first version. Cookie, path prefix, or user preference support can be added later with an explicit priority order. |
| `frontend.i18n.inject` | `"used"` | Scope for SSR initial messages. Prefer injecting only property paths used by the current page/layout. |
| `frontend.i18n.clientSwitch` | `"reload"` | Client language-switch strategy. The first version should request HTML again so SSR and hydration stay aligned. |
| `frontend.i18n.htmlLang` | `true` | Writes the current locale into `{vext.lang}`. |
| `frontend.i18n.vary` | `true` | Adds `Vary: Accept-Language` or an equivalent cache key when language affects HTML. |
| `frontend.spaFallback.scopes` | `[]` | Fallback scopes for client-router sub-apps. Empty by default, so unmatched paths are not handled. |
| `frontend.spaFallback.scopes[].basePath` | None | URL prefix handled by this SPA sub-app, such as `/admin/app`. |
| `frontend.spaFallback.scopes[].page` | None | Page shell returned by fallback, such as `admin/app/shell`, still resolved from `src/frontend/pages/**`. |
| `frontend.spaFallback.scopes[].ssr` | `false` | Whether to SSR the shell. Pure client-router sub-apps usually keep this `false`. |
| `frontend.spaFallback.scopes[].exclude` | `[]` | Paths inside the scope that must not be handled by fallback, such as `/admin/api/**`. |
| `frontend.spaFallback.scopes[].status` | `200` | HTTP status returned when fallback matches. |

### How to understand `spaFallback`

`frontend.spaFallback` is for one case only: part of your project is a true browser-router SPA. If a user opens or refreshes `/app/settings` or `/dashboard/users/1`, the Vext server has no matching route, but you still want the browser to receive that sub-app's shell document so the client router can decide which screen to show.

It is not the default routing model for Vext pages. The default full-stack pages model is still: define the URL in `src/routes/**`, prepare service data in the handler, then call `res.render(page, props, options)` to render `src/frontend/pages/**`. If a page needs SSR, layoutData, i18n messages, head tags, render cache, or server-side authorization results, use `res.render()` instead of SPA fallback.

Before enabling fallback, check that:

- It only handles `GET` / `HEAD` browser HTML navigation requests.
- API requests send `Accept: application/json`, and API prefixes are listed in the matching scope's `exclude`.
- `/api/**`, `/openapi.json`, `/docs/**`, static files, built assets, images, fonts, source maps, and manifests are not handled by fallback.
- `res.renderError()`, HTML route 404s, and `res.render(page)` page-not-found diagnostics are not hidden by fallback.
- A fallback hit usually returns 200 because the client router handles the route after the document loads; it is not a server-side 404.
- When multiple scopes match, the longest `basePath` wins. Explicit `src/routes/**` routes always win over fallback.

Common config:

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

If you are building normal SSR pages, an admin first screen, detail pages, or permissioned data pages, keep `scopes: []` by default. Vext does not recommend a single global switch that captures unknown paths; mixed SSR + SPA projects should configure explicit scopes for client-router sub-apps.

`spaFallback` is also not persistent client-side layout navigation. If Vext later supports an SSCR-like navigation mode, it will intercept links inside a layout, request server data, and replace only the page content. That is a separate future capability and is not enabled implicitly by `spaFallback`.

`frontend.publicPath` is the app-local URL prefix. `frontend.deploy.assetBaseUrl` is an absolute CDN prefix for built JS, CSS, images, and fonts. `public/**` files remain stable URL files; `src/frontend/assets/**` files go through the build pipeline and are emitted with hashed names. Request-specific asset URL transforms and image/font optimization components are future dedicated or plugin capabilities.

## 16. Develop, build, and start

Develop:

```bash
npm run dev
```

Changes under these directories trigger frontend hot updates or a required rebuild:

```text
src/frontend/**
public/**
```

Development changes fall into three groups:

| Change | Default behavior |
| --- | --- |
| React pages, layouts, and shared components | Update through React Fast Refresh and preserve current page state when React can safely do so. |
| CSS and hot-updatable style assets | Update through CSS hot updates without a full-page reload by default. |
| `src/routes/**`, `src/services/**`, middleware, and other server code that affects `res.render()` data | Notify the browser after backend soft reload succeeds; the browser follows `frontend.dev.renderRefresh`. |

`frontend.dev.renderRefresh` supports:

| Value | Behavior |
| --- | --- |
| `"prompt"` | Recommended default. Shows a development prompt that says the server render changed; click it to reload. This is better for admin pages, forms, dialogs, and active debugging. |
| `"auto"` | Automatically calls `location.reload()` after render-related backend code soft-reloads successfully. Use it when you want every server-data change to re-request HTML immediately. |
| `"off"` | Does not prompt or reload; it only records the event in the console. The next manual refresh, navigation, or request gets the new HTML. |

Normal `res.render()` calls during HTTP requests do not trigger browser refreshes. Refresh events come from source changes after frontend compilation or backend reload results. Frontend syntax errors or Fast Refresh compilation errors show the dev overlay while the previous page stays usable; after you fix the error, updates continue.

Some files cannot be safely hot-replaced, such as `_document.html`, the render manifest schema, browser runtime entry code, or changes that alter hydration payload shape. Vext will reload the page or show a strong prompt for those cases instead of pretending they are Fast Refresh updates.

Backend API, config, plugin, preload, and other non-render frontend paths keep the existing backend reload behavior.

Build:

```bash
npm run build
```

Production frontend output:

```text
dist/client/
├── assets/
├── server/
│   └── renderer.mjs
├── index.html
├── manifest.json
├── messages-manifest.json
├── render-manifest.json
└── size-report.json
```

Vext builds a browser bundle and a server renderer bundle separately. The browser bundle can only start from `src/frontend/**`, `public/**`, and configured frontend-safe roots; the server renderer is used for SSR pages and layouts. When `frontend.i18n` is enabled, the build also scans `src/frontend/locales/**` and emits `messages-manifest.json`. Build diagnostics keep the metafile, manifest, and size report, and scan alias-resolved real paths so `src/routes/**`, `src/services/**`, `src/config/**`, `node:*`, and `*.server.*` files do not enter browser output. Files named `*.client.*` are browser-only in the first version and should not be used as synchronous SSR components.

`render-manifest.json` records the build id, pages, layouts, error pages, assets, server renderer path, and diagnostics used by `vext start`. `messages-manifest.json` records available locales, the default locale object shape, page message entries, and the build id. If the manifest schema, messages manifest, or renderer file does not match the runtime, startup fails fast and asks you to rebuild instead of serving a stale page.

The first implementation must keep performance evidence for API-only overhead, development cold start and rebuild, production build time, first SSR render, and client JS size. Vext should not claim "fastest" or "first" without a reproducible benchmark and comparison target.

Start production:

```bash
npm start
```

`vext start` serves existing production frontend output only. When frontend is enabled but `dist/client/index.html` or `dist/client/render-manifest.json` is missing, startup fails fast and tells you to run `vext build` first.

To publish static assets to a CDN, the recommended flow is:

1. Run `npm run build`.
2. Upload `dist/client/assets/**` to the CDN.
3. Set `frontend.deploy.assetBaseUrl` in production config, for example `https://cdn.example.com/my-app/`.
4. Vext still renders HTML, SSR content, and page data from the server; JS, CSS, images, fonts, and other static assets load from the CDN.

The Vext core only generates stable asset paths and manifests in the first version. It does not bind S3, OSS, Cloudflare, or any other upload provider into core. Put uploads in CI or a future deploy plugin.

## 17. Disable frontend for API-only projects

Create a new API-only project:

```bash
npx vextjs create my-api --template api --frontend none
```

Disable frontend in an existing project:

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: false,
};

export default config;
```

Or:

```ts
export default {
  frontend: {
    enabled: false,
  },
};
```

When disabled, Vext does not scan `src/frontend/**`, generate a frontend entry, or serve `public/**` frontend assets.

## 18. Troubleshooting

| Symptom | What to do |
| --- | --- |
| A page file exists, but the URL returns 404 | Page files do not create URLs automatically. Define a route under `src/routes/**` and call `res.render("page-id")`. |
| `res.render("dashboard")` says page not found | Check that `src/frontend/pages/dashboard.tsx` exists. Nested pages need the full page id, such as `users/detail`. |
| Props serialization fails | `props` must be JSON-safe. Do not pass functions, symbols, BigInt values, circular objects, connections, Request, Response, or Service instances. |
| A page imports a service and fails | Do not import `src/services/**` from `src/frontend/pages/**` or `src/frontend/components/**`. Services run in route handlers only. |
| An API request receives HTML | Send `Accept: application/json` from API requests and add the API prefix to the matching `frontend.spaFallback.scopes[].exclude`. The default pages mode does not enable SPA fallback. |
| A layout does not receive server data | Pass `layoutData` in the third `res.render()` argument. Do not import services directly from layout components. |
| The page language is wrong | Check `config.locale.supported`, the request `Accept-Language`, user preference cookie/API, and `frontend.i18n.defaultLocale`. |
| A page-copy property is missing | Check that `src/frontend/locales/<locale>.ts` keeps the same object structure as the default locale. Temporary page copy can be passed with `res.render(page, props, { messages })`. |
| HTML cache mixes languages | Keep `frontend.i18n.vary=true`, or include locale, path prefix, or cookie in the CDN / reverse-proxy cache key. |
| Static asset returns 404 | Use `/logo.png` for `public/logo.png`; import `src/frontend/assets/logo.png` from TSX/CSS. |
| Hydration mismatch | Make the first render depend on `props`, `layoutData`, `locale`, and initial `messages`. Do not generate different random values, timestamps, language decisions, or environment-specific output on server and browser first render. |
| Head tags are duplicated | Prefer one `title`, one description, and stable canonical links per render. Vext deduplicates common head entries, but the route should still pass one clear source of truth. |
| CSP blocks the page script | Generate a request nonce in middleware or the route handler and pass it as `res.render(page, props, { nonce })`. |
| Saving a React component causes a full reload | Check that `frontend.dev.hot` and `frontend.dev.fastRefresh` are enabled. If the file has non-component exports, is imported outside the React tree, or changes critical runtime/document structure, Vext falls back to a prompt or full reload. |
| Route/service changes do not auto-refresh the page | The default `frontend.dev.renderRefresh` is `"prompt"`. Click the development prompt to reload. Set it to `"auto"` for automatic reloads or `"off"` to only log the event. |
| Fast Refresh does not preserve component state | React only preserves function component and Hooks state across safe refresh boundaries. Class components, non-component exports, or unsafe refresh signatures may remount. |
| You want to disable frontend | Create with `--template api --frontend none`, or set `frontend: false`. |

## 19. Default boundaries and future capabilities

This section separates three things: routes Vext does not take by default, future dedicated capabilities, and capabilities Vext supports or plans to support through a different model.

### Not the default route

- Vite or the Vite HMR API. Vext uses esbuild and its own dev event bus.
- `.tsx` files automatically becoming HTTP routes.
- User-facing Next/Remix-style route tree DSLs.
- Loader/action-driven data loading. Vext defaults to preparing data in `src/routes/**` handlers and services, then passing it to `res.render()`.
- Default dependencies on React Router, TanStack Start, Next, Astro, or other frontend routing/meta frameworks.
- A default dependency on i18next, react-intl, or another third-party i18n runtime.
- `t("dashboard.title")` as the primary API. Vext's default page-copy API is `const i18n = useVextI18n(locale?)` followed by object access such as `i18n.dashboard.title`.

### Future dedicated capabilities

These are not permanent exclusions, but they do not belong in the current default implementation. They need separate requirements, performance baselines, bundle impact review, server/browser boundary design, security model, and documentation acceptance before implementation:

- React Server Components.
- Server Actions.
- Streaming SSR.
- Persistent client-side layout navigation / client-side partial navigation.
- Built-in image optimization components.
- Built-in font optimization components.
- Request-specific CDN asset URL transforms.

### Supported or planned, but through a different model

- Layouts: the current target is SSR layout chains and `layoutData`, not a Next/Remix route tree.
- Mutations: the current target is normal Vext API routes plus middleware, CSRF, same-origin checks, and idempotency; Server Actions can be evaluated later as a dedicated capability.
- CDN: the current target is `frontend.deploy.assetBaseUrl` plus the build manifest, not per-request asset URL rewriting.
- SPA fallback: it only serves explicitly configured `spaFallback.scopes[]` client-router sub-apps. It is not the default pages routing model, and it must not hide API 404s, static asset 404s, or page registry errors.

When you need a page, define the URL in `src/routes/**` and render a page from `src/frontend/pages/**` with `res.render()`.

Next, review [Routing](/guide/routing), [Services](/guide/services), [Configuration](/guide/configuration), [Build](/guide/build), and [CLI Commands](/guide/cli).

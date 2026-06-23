# Getting Started

This page is the shortest path to a working Vext full-stack page with the built-in frontend capability.

## Create the App

```bash
npx vextjs create my-app
cd my-app
npm install
npm run dev
```

The default scaffold is full-stack: backend routes, services, React pages, styles, assets, locales, and public files are created in one project. API-only projects can still use:

```bash
npx vextjs create my-api --template api --frontend none
```

## Open the First Page

The first browser page follows this chain:

```text
GET / -> src/routes/index.ts -> res.render("index")
```

`src/frontend/pages/index.tsx` is the page component. It does not create a URL by itself; the route handler chooses when to render it.

## Change the Home Page

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

## Add Another Page

Create the page:

```tsx
// src/frontend/pages/admin/dashboard.tsx
export default function DashboardPage(props: { totalUsers: number }) {
  return <main>Total users: {props.totalUsers}</main>;
}
```

Render it from a route:

```ts
// src/routes/admin/dashboard.ts
export default (app) => {
  app.get("/admin/dashboard", {}, async (req, res) => {
    const totalUsers = await app.services.users.count();
    res.render("admin/dashboard", { totalUsers });
  });
};
```

## Add a Component

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

Use aliases from frontend files:

```tsx
import { Stat } from "@components/Stat";
```

## Add Styles

Use plain CSS, CSS Modules, or Vext JSCSS. Component-local dynamic styles can use `vextjs/style`:

```ts
// src/frontend/styles/card.style.ts
import { style } from "vextjs/style";

export const card = style({
  padding: 16,
  borderRadius: 8,
});
```

## If Something Fails

| Symptom | Check |
|---------|-------|
| Page not found | Confirm the page id matches `src/frontend/pages/**` without extension. |
| Browser bundle imports a server file | Move service/database work back into `src/routes/**` or `src/services/**`. |
| Styles do not update | Check `frontend.dev.hot` and `frontend.dev.fastRefresh`. |
| API request receives HTML | Send `Accept: application/json` and review `spaFallback.scopes[]`. |

Next, read [Project Structure](/frontend/project-structure) and [Routing and Pages](/frontend/routing-and-pages).

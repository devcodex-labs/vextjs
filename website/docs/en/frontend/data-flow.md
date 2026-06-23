# Data Flow

Frontend data in Vext starts on the server. Route handlers call services, prepare JSON-safe values, and pass them into `res.render()`.

## First-screen Data

```ts
export default (app) => {
  app.get("/dashboard", { cache: { ttl: 30_000 } }, async (req, res) => {
    const summary = await app.services.dashboard.summary(req.user.id);
    res.render("dashboard", {
      summary,
    });
  });
};
```

The page receives the same object during SSR and hydration:

```tsx
export default function DashboardPage(props: { summary: DashboardSummary }) {
  return <Dashboard summary={props.summary} />;
}
```

## Layout Data

Use `options.layoutData` for shell-level data such as navigation, user menus, workspace metadata, or admin permissions:

```ts
res.render("admin/dashboard", { metrics }, {
  layoutData: {
    user: req.user,
    nav: await app.services.nav.admin(req.user.id),
  },
});
```

Layouts do not import services directly. They consume data passed by the route handler.

## Locale Messages

Page copy comes from `src/frontend/locales/**` and optional render messages:

```ts
res.render("settings", props, {
  locale: req.locale,
  messages: {
    settings: { title: "Settings" },
  },
});
```

Client code reads a typed object:

```tsx
const i18n = useVextI18n(locale);
return <h1>{i18n.settings.title}</h1>;
```

## Client API Calls

After hydration, use plain `fetch` for normal API calls. Generated API client artifacts are available for tooling or external frontend adapters, but first-screen data should normally flow through `res.render()`.

## Cache Boundary

Cache render payloads with route response cache when the server data can be reused. Do not add a separate browser data cache until a page actually needs client-side refetching.

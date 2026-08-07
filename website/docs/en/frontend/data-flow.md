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
res.render(
  "admin/dashboard",
  { metrics },
  {
    layoutData: {
      user: req.user,
      nav: await app.services.nav.admin(req.user.id),
    },
  },
);
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

## Same-route Navigation

After hydration, Vext can request the same document route as a versioned page result. There is no second loader or action registration API: the route handler and its middleware, auth/session, CSRF, validation, cache, timeout, redirect, and error behavior remain authoritative.

The stable surface is `Link`, `Form`, `navigate`, `prefetch`, `revalidate`, `useNavigation`, `useFetcher`, and `useRouteData`.

```tsx
import {
  Form,
  Link,
  revalidate,
  useFetcher,
  useNavigation,
  useRouteData,
} from "vextjs/frontend";

export default function DashboardPage() {
  const data = useRouteData<{ summary: DashboardSummary }>();
  const navigation = useNavigation();
  const details = useFetcher<{ summary: DashboardSummary }>();

  return (
    <main>
      <h1>Dashboard</h1>
      <p data-state={navigation.phase}>{data?.summary.label}</p>
      <Link href="/reports" prefetch="click">
        Reports
      </Link>
      <Form action="/reports" method="post">
        <button type="submit">Create report</button>
      </Form>
      <button onClick={() => details.load("/reports?view=compact")}>
        Load compact data
      </button>
      <button onClick={() => revalidate()}>Refresh</button>
    </main>
  );
}
```

`Link` accepts `prefetch="none" | "click" | "visible"` and defaults to `"click"`. `Form` keeps a normal string `action` and HTTP method, so it still submits as a document request when JavaScript is unavailable. `useFetcher()` runs the same route without changing browser history.

## Navigation Lifecycle

`useNavigation()` reports `idle`, `loading`, `submitting`, `revalidating`, `error`, or `aborted`. A revalidation keeps the last-known-good page visible until the replacement commits. A newer navigation aborts the older request, equivalent GET requests are deduplicated, and `revalidate({ routeId, path, tags, keys })` can invalidate matching entries within the current locale and auth/session partition.

The browser requests `application/vnd.vext.page+json;v=1` only for enhanced navigation. Protocol, build id, permission, decode, or route-asset incompatibility falls back to exactly one document navigation. This envelope is an internal runtime protocol, not a user-implemented RPC format.

## Client API Calls and Cache Boundary

Use the generated typed API client or plain `fetch` for JSON API calls that are not page navigation. First-screen and page-navigation data should normally flow through `res.render()`. Vext's browser cache is partitioned by route, normalized URL, locale, auth/session identity, protocol, and contract digest; authenticated or `no-store` page results are not stored in the shared public cache.

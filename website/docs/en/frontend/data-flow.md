# Data Flow

Frontend data in Vext starts on the server. Route handlers call services, prepare JSON-safe values, and pass them into `res.render()`.

Following [Full-Stack Quick Start](/frontend/getting-started), this page uses the same `/dashboard` route for first-screen data, navigation, and local loading. Complete the [Layouts and Components](/frontend/layouts-and-components) example before adding layout data. Add business authentication using [Authentication and Security](/guide/security).

## First-screen Data

Create these two files. The example uses an in-memory summary so it can be verified directly. In real business code, call a registered service from the handler and select the fields returned to the browser.

```ts
// src/routes/dashboard.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", { validate: { query: { view: "string?" } } }, (req, res) => {
    const summary = {
      label: req.valid("query").view === "compact" ? "Compact" : "Dashboard",
      total: 42,
    };
    res.render("dashboard", { summary });
  });
});
```

After the app registers `auth()`, `auth: true` protects the route while `req.auth` carries the framework identity and claims. A user profile is application data: load it through your own service instead of assuming that Vext injects `req.user`.

The page receives the same serializable data during SSR and hydration:

```tsx
// src/frontend/pages/dashboard.tsx
type DashboardSummary = { label: string; total: number };

export default function DashboardPage(props: { summary: DashboardSummary }) {
  return (
    <main>
      {props.summary.label}: {props.summary.total}
    </main>
  );
}
```

## Layout Data

Put shell data such as navigation, user menus, and workspace information in `options.layoutData`. This replaces the render call in the `admin/dashboard` handler from the completed layout example. The layout IDs are root `.` and `admin`:

```ts
const user = { name: "Ada" };
const metrics = { totalUsers: 42 };
const nav = [{ label: "Dashboard", href: "/admin/dashboard" }];

res.render("admin/dashboard", metrics, {
  layoutData: {
    ".": { user },
    admin: { menu: nav },
  },
});
```

Layouts consume the object under their ID through `props.data`; they do not import services directly. Query real profile data by `req.auth.userId` in an authenticated handler. Navigation visibility affects UI only; the server must check permissions independently.

## Locale Messages

Page copy comes from `src/frontend/locales/**` and optional render messages. With frontend i18n enabled, a handler may explicitly supply the messages for this render. They replace the current messages object rather than recursively patching it. This can replace the dashboard render call above:

```ts
res.render(
  "dashboard",
  { summary },
  {
    locale: "en-US",
    messages: {
      settings: { title: "Settings" },
    },
  },
);
```

This component can read the messages in a page or layout. Its generic parameter is only a TypeScript declaration; configuration or render options must actually provide the messages. See [Frontend i18n](/frontend/i18n) for complete type generation and fallback rules.

```tsx
// src/frontend/components/SettingsTitle.tsx
import { useVextI18n } from "vextjs/frontend";

export function SettingsTitle() {
  const i18n = useVextI18n<{ settings: { title: string } }>();
  return <h1>{i18n.settings.title}</h1>;
}
```

## Same-route Navigation

After hydration, Vext can request the same document route as a versioned page result. There is no second loader or action registration API: the route handler and its middleware, auth/session, CSRF, validation, cache, timeout, redirect, and error behavior remain authoritative.

The stable surface is `Link`, `Form`, `navigate`, `prefetch`, `revalidate`, `useNavigation`, `useFetcher`, and `useRouteData`.

Keep the route above unchanged and replace its dashboard page with this interactive version. Links and forms still request `/dashboard`; the GET form demonstrates a query without requiring another mutation endpoint.

```tsx
// src/frontend/pages/dashboard.tsx (replaces the earlier page)
import {
  Form,
  Link,
  revalidate,
  useFetcher,
  useNavigation,
  useRouteData,
} from "vextjs/frontend";

type DashboardSummary = { label: string; total: number };
type DashboardProps = { summary: DashboardSummary };

export default function DashboardPage(props: DashboardProps) {
  const data = useRouteData<DashboardProps>() ?? props;
  const navigation = useNavigation();
  const details = useFetcher<{ summary: DashboardSummary }>();

  return (
    <main>
      <h1>Dashboard</h1>
      <p data-state={navigation.phase}>
        {data.summary.label}: {data.summary.total}
      </p>
      <Link href="/dashboard?view=full" prefetch="click">
        Full summary
      </Link>
      <Form action="/dashboard" method="get">
        <input type="hidden" name="view" value="compact" />
        <button type="submit">View compact summary</button>
      </Form>
      <button onClick={() => details.load("/dashboard?view=compact")}>
        Load summary
      </button>
      <p>{details.data?.summary.label}</p>
      <button onClick={() => revalidate()}>Refresh</button>
    </main>
  );
}
```

`useRouteData()` may return `undefined` on the server, where a browser runtime is not configured. Falling back to page props keeps first-screen content. `Link` accepts `prefetch="none" | "click" | "visible"` and defaults to `"click"`. `Form` retains a native form; this GET example still submits a document request with JavaScript disabled. A mutation form needs a handler for its method and must meet its auth, CSRF, and validation requirements. `useFetcher()` uses the same route without changing browser history.

## Navigation Lifecycle

`useNavigation()` reports `idle`, `loading`, `submitting`, `revalidating`, `error`, or `aborted`. A revalidation keeps the last-known-good page visible until the replacement commits. A newer navigation aborts the older request, equivalent GET requests are deduplicated, and `revalidate({ routeId, path, tags, keys })` can invalidate matching entries within the current locale and auth/session partition.

The browser requests `application/vnd.vext.page+json;v=1` only for enhanced navigation. Protocol, build id, permission, decode, or route-asset incompatibility falls back to exactly one document navigation. This envelope is an internal runtime protocol, not a user-implemented RPC format.

## Client API Calls and Cache Boundary

Use the generated typed API client or plain `fetch` for JSON API calls that are not page navigation. First-screen and page-navigation data should normally flow through `res.render()`. Vext's browser cache is partitioned by route, normalized URL, locale, auth/session identity, protocol, and contract digest; authenticated or `no-store` page results are not stored in the shared public cache.

## Verify Data Flow

Run `npm run build` and start `npm start -- --port 3000`. Direct access to `/dashboard` should show `Dashboard: 42`; `?view=compact` should show `Compact: 42`, including in the response source. With the interactive version, the GET form should switch to the compact summary; local loading should update its own result without changing the address; refresh should retain the current page until a new result arrives. Disable JavaScript and submit the GET form again to confirm a full page can still open. Stop the service afterward. See [Render Data and Cache](/frontend/render-data-and-cache) for cache policy and [API Client and Contracts](/frontend/api-client-and-contracts) for JSON APIs.

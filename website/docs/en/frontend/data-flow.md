# Data Flow

Frontend data in Vext starts on the server. Route handlers call services, prepare JSON-safe values, and pass them into `res.render()`.

Following [Full-Stack Quick Start](/frontend/getting-started), this page uses the same `/dashboard` route for first-screen data, navigation, and local loading. Complete the [Layouts and Components](/frontend/layouts-and-components) example before adding layout data. Add business authentication using [Authentication and Security](/guide/security).

Read by task: [First-screen Data](#first-screen-data) → [GET Navigation Example](#same-route-navigation) → [Navigation API Reference](#navigation-api) → [POST Write Form](#write-form). The generated browser entry configures the navigation runtime; application components use the public interfaces below.

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

## Navigation API Reference {#navigation-api}

Import these interfaces from `vextjs/frontend`. Components still produce native HTML during SSR; call programmatic navigation only in a browser initialized by the generated entry.

| Interface                 | Parameters, defaults, and results                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Link`                    | Requires `href`; `prefetch` is `"click"` (default), `"visible"`, or `"none"`. Supports `replace`, `preserveScroll`, and native anchor attributes. Modifier keys, non-left clicks, other targets, and cross-origin links keep native navigation.                                                                           |
| `Form`                    | `action` is optional; `method` defaults to `"post"` and `navigate` to `true`. Supports `replace`, `preserveScroll`, and native form attributes. `navigate={false}` forces native submission. Ordinary writes use URLSearchParams and multipart writes use FormData; CSRF tokens are not generated or added automatically. |
| `navigate(url, options?)` | `url: string \| URL`; returns `Promise<void>`. Success commits the page and history; read failure state through `useNavigation()`. Hash-only changes do not request the page again.                                                                                                                                       |
| `prefetch(url, options?)` | Returns a page result or `undefined`; only for same-origin GET, with no page or history change. Do not use it for writes. Failure, cancellation, cross-origin URLs, or data-saving conditions can skip it. The result is an internal page protocol that business code need not parse.                                     |
| `revalidate(target?)`     | Returns `Promise<void>`. Invalidates matching entries, then GETs the current page while preserving history and scroll. Keeps the previous page until the result is committed.                                                                                                                                             |
| `useNavigation()`         | Returns `{ phase, sequence, url, method, error? }`; see phase values below. Returns an idle snapshot during SSR or without a runtime.                                                                                                                                                                                     |
| `useRouteData<T>()`       | Returns current page props; may be `undefined` during SSR or without a runtime. The generic does not validate data; fall back to component props for the first screen.                                                                                                                                                    |
| `useFetcher<T>()`         | Returns `{ phase, data?, error?, load, submit }`. `load(url)` and `submit(url, options?)` return `Promise<T \| undefined>`. T describes props in a page result, rather than an arbitrary JSON API response.                                                                                                               |

Optional parameters differ by entry point:

| Options object         | Fields and behavior                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VextNavigateOptions`  | `replace?: boolean` replaces current history (default: append); `preserveScroll?: boolean` preserves position (default: restore by target hash/page); `state?: unknown` stores user state in history; `input?: "keyboard" \| "pointer" \| "programmatic" \| "popstate"` identifies the source and can be omitted by normal applications. |
| `VextPrefetchOptions`  | `signal?: AbortSignal` cancels this prefetch; `intent?: "click" \| "visible" \| "explicit"` describes intent but does not currently change request method or scheduling in the fetch path.                                                                                                                                               |
| `VextRevalidateTarget` | `routeId?: string`, `path?: string`, `tags?: string[]`, `keys?: string[]`; omitting target invalidates entries in the current partition, then reloads the current page. It does not directly call server-side `app.cache.invalidate()`.                                                                                                  |
| `VextSubmitOptions`    | `method?: string` (default: POST), `body?: RequestInit["body"]`, `headers?: HeadersInit`. It inherits navigation option types, but fetcher submission forwards only method/body/headers. Use neither replace nor state to control history for local results.                                                                             |

A successful page result from `fetcher.submit` updates that fetcher's data without replacing the entire page. Non-GET submissions also revalidate the current page, including failures returning `undefined`. Ordinary local loading does not change the address, but a redirect result starts page navigation and can change it. For a local submission that should stay on the page, return a page result with `res.render()` instead of a redirect.

Read page errors through `useNavigation().error` or `fetcher.error`. Page error objects provide `status`, optional `code`, and `requestId`; network errors may still be ordinary Error instances, so use property guards for additional fields. The package exports the `VextPageResultError` class, but the generated browser shim currently does not re-export it. Importing it as a runtime value for instanceof in pages fails the build. Type-only imports are erased and are unaffected.

Do not rely only on catching the returned Promise to identify success. Navigation errors are recorded in the snapshot, while fetcher errors usually return `undefined`. A 401/403 or incompatible protocol/build requires document navigation, so the error may not remain visible in the current component. Programmatic APIs and fetcher methods throw without a runtime; `Link`/`Form` retain native HTML behavior.

## POST Write Form {#write-form}

Create the following two new files in the full-stack template and merge the configuration into `src/config/default.ts`, retaining existing frontend settings. The example stores a display name per Session, with no database or identity authentication; real account updates also need separate authentication and authorization. Global Session must precede global CSRF; route-only Session does not provide that ordering.

```typescript
// src/config/default.ts (merge into existing configuration)
export default {
  frontend: { enabled: true },
  session: { enabled: true },
  csrf: { enabled: true, mode: "session" },
};
```

```typescript
// src/routes/preferences.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", { cache: false }, async (req, res) => {
    if (!req.session) return app.throw(500, "Session is not configured");
    const csrfToken = req.csrfToken();
    await req.session.save();
    res.render("preferences", {
      label: typeof req.session.label === "string" ? req.session.label : "Ada",
      csrfToken,
    });
  });

  app.post(
    "/",
    { cache: false, validate: { body: { label: "string:1-40!" } } },
    (req, res) => {
      if (!req.session) return app.throw(500, "Session is not configured");
      req.session.label = req.valid("body").label;
      res.redirect("/preferences", 303);
    },
  );
});
```

```tsx
// src/frontend/pages/preferences.tsx
import { Form, useNavigation, useRouteData } from "vextjs/frontend";

type PreferencesProps = { label: string; csrfToken: string };

export default function PreferencesPage(props: PreferencesProps) {
  const data = useRouteData<PreferencesProps>() ?? props;
  const navigation = useNavigation();
  const error = navigation.error;
  return (
    <main>
      <p id="saved-label">Saved: {data.label}</p>
      <Form action="/preferences">
        <input type="hidden" name="_csrf" value={data.csrfToken} />
        <label>
          Display name{" "}
          <input key={data.label} name="label" defaultValue={data.label} />
        </label>
        <button disabled={navigation.phase === "submitting"}>Save</button>
      </Form>
      {navigation.phase === "error" && (
        <p role="alert">
          {error && "status" in error ? `${String(error.status)}: ` : ""}
          {error?.message ?? "Request failed"}
        </p>
      )}
    </main>
  );
}
```

After obtaining the token in GET, save Session before placing the token in a hidden field. The full-stack template permits streaming SSR by default, and generating the token mutates Session; do not wait until streaming starts to save it. Browser submission also carries the associated Session Cookie. Form defaults to POST; the example has no hidden action registration or automatic token injection. Token responses must stay private and out of shared caches: this example disables route cache explicitly, and `req.csrfToken()` also sets no-store. See [Cookies and Sessions](/guide/cookies-session) for storage, production Cookies, and multi-instance configuration.

Run `npm run build -- --typecheck`, then `npm start -- --port 3000`, and open `/preferences`. Verify in order:

| Action                                     | Expected result                                                                                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change the name to Grace and submit        | After successful POST, return to the same route and display `Saved: Grace`; refreshing preserves the value in this session.                                                                          |
| Clear label and submit                     | The server returns 422, the error is displayed, and the saved value stays unchanged. The example omits HTML required to demonstrate this branch; client validation can supplement server validation. |
| Send POST with an invalid or missing token | HTTP 403 with CSRF_TOKEN_INVALID/CSRF_TOKEN_MISSING respectively; state stays unchanged. Check Network or an HTTP client, because enhanced navigation may fall back to document GET.                 |
| Disable JavaScript, reopen, and submit     | Native POST carries the hidden token, returns 303, then GETs the page with the new value.                                                                                                            |

To verify rejection with an HTTP client, first GET the page and retain the same Cookie, then send form-urlencoded label and `_csrf` to `/preferences`. A token without its session also fails. Do not disable production CSRF to reproduce success. Stop the server afterward; default in-memory Session is not shared across restarts or Workers.

## Navigation Lifecycle

`useNavigation()` reports `idle`, `loading`, `submitting`, `revalidating`, `error`, or `aborted`. A revalidation keeps the last-known-good page visible until the replacement commits. A newer navigation aborts the older request, equivalent GET requests are deduplicated, and `revalidate({ routeId, path, tags, keys })` can invalidate matching entries within the current locale and auth/session partition.

The browser requests `application/vnd.vext.page+json;v=1` only for enhanced navigation. Protocol, build id, permission, decode, or route-asset incompatibility falls back to exactly one document navigation. This envelope is an internal runtime protocol, not a user-implemented RPC format.

## Client API Calls and Cache Boundary

Use the generated typed API client or plain `fetch` for JSON API calls that are not page navigation. First-screen and page-navigation data should normally flow through `res.render()`. Vext's browser cache is partitioned by route, normalized URL, locale, auth/session identity, protocol, and contract digest; authenticated or `no-store` page results are not stored in the shared public cache.

## Verify Data Flow

Run `npm run build` and start `npm start -- --port 3000`. Direct access to `/dashboard` should show `Dashboard: 42`; `?view=compact` should show `Compact: 42`, including in the response source. With the interactive version, the GET form should switch to the compact summary; local loading should update its own result without changing the address; refresh should retain the current page until a new result arrives. Disable JavaScript and submit the GET form again to confirm a full page can still open. Stop the service afterward. See [Render Data and Cache](/frontend/render-data-and-cache) for cache policy and [API Client and Contracts](/frontend/api-client-and-contracts) for JSON APIs.

# Routing and Pages

Vext keeps URL ownership in `src/routes/**`. Page files are render targets, not automatic URL definitions.

In the TypeScript project created by [Full-Stack Quick Start](/frontend/getting-started), this page adds a user detail page while retaining the existing home page. It connects a URL, route handler, Page ID, and page props.

## Mental Model

```text
request URL
  -> src/routes/** handler
  -> app.services / business data
  -> res.render(page, props, options)
  -> src/frontend/pages/** page component
  -> HTML according to SSR/CSR settings, with optional browser hydration
```

Keep business services, databases, and authorization checks in the route handler. Select the data sent to the page explicitly; do not put server objects or sensitive fields directly into props.

## Page IDs

An ordinary page's ID is its extensionless path relative to `frontend.pages.dir`. In the default directory:

| File                                     | Page id           |
| ---------------------------------------- | ----------------- |
| `src/frontend/pages/index.tsx`           | `index`           |
| `src/frontend/pages/about.tsx`           | `about`           |
| `src/frontend/pages/admin/dashboard.tsx` | `admin/dashboard` |
| `src/frontend/pages/error/default.tsx`   | `error/default`   |

Layouts and `_document` are not registered as ordinary pages. Error pages are scanned separately and keep the `error/` ID prefix even when their directory is customized. See [Error Pages and Document](/frontend/errors-and-document) for error response selection.

## Rendering From a Route

Create the page file first:

```tsx
// src/frontend/pages/users/detail.tsx
export default function UserDetail(props: {
  user: { id: string; name: string };
}) {
  return (
    <main>
      User {props.user.id}: {props.user.name}
    </main>
  );
}
```

Then create the route. `users.ts` contributes the `/users` file prefix; the handler declares only `/:id`, giving final URL `/users/1`. Do not repeat `/users/:id` in the handler.

```ts
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", { validate: { param: { id: "string" } } }, (req, res) => {
    const user = { id: "1", name: "Ada" };
    if (req.valid("param").id !== user.id) app.throw(404, "User not found");
    res.render(
      "users/detail",
      { user },
      {
        head: {
          title: `${user.name} - Users`,
        },
      },
    );
  });
});
```

This uses in-memory data and needs no extra service. A real handler can query a service, check access, and pass only the required props. Route params do not automatically become page props.

`res.render(page, props?, options?)` means:

| Argument  | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `page`    | Page id under `src/frontend/pages/**`, without extension.               |
| `props`   | JSON-safe data prepared on the server and reused by hydration.          |
| `options` | Status, head, layout data, locale/messages, nonce, and render behavior. |

Props should be JSON-serializable; functions, circular references, and service instances do not belong in browser data. See [Context and Response API](/api/context) for complete options and per-render boundaries.

## Route Files Stay Server-only

This is a responsibility snippet inside a handler, assuming a registered `metrics` service and a `dashboard` page, not a standalone runnable route file:

```ts
// src/routes/dashboard.ts
const metrics = await app.services.metrics.summary();
res.render("dashboard", { metrics });
```

Do not do this:

```tsx
// src/frontend/pages/dashboard.tsx
import { db } from "../../services/db";
```

When `frontend.build.diagnostics.leakScan` is enabled, Vext reports the importer, import specifier, resolved path, and a plain-language fix.

## Verify the Page

Run `npm run build` in the project root, followed by `npm start -- --port 3000` when it passes. Stop an already running development service first to avoid a port conflict.

- `/users/1` should render successfully with `User 1: Ada` and page title `Ada - Users`.
- `/users/2` should return 404; the exact body depends on the project's error handling and error pages.
- `/users/users/1` must not match this route.

If the page is missing, check the Page ID in `res.render` against the page's relative file path. If the build cannot project the route, check that its `defineRoutes` declaration uses statically analyzable syntax. For a server-dependency leak, move data access back into the handler. Stop the service afterward. This verifies page routing and output; check interactive takeover separately with [Hydration Validation](/frontend/hydration-validation).

## Related Pages

- [SSR](/frontend/ssr)
- [Hydration](/frontend/hydration)
- [Render Data and Cache](/frontend/render-data-and-cache)
- [CSR and SPA Fallback](/frontend/csr-and-spa-fallback)

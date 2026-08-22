# Routing and Pages

Vext keeps URL ownership in `src/routes/**`. Page files are render targets, not automatic URL definitions.

## Mental Model

```text
request URL
  -> src/routes/** handler
  -> app.services / business data
  -> res.render(page, props, options)
  -> src/frontend/pages/** page component
  -> SSR HTML + browser hydration
```

This keeps service access on the server and keeps the browser graph limited to frontend files.

## Page IDs

Page ids are relative to `src/frontend/pages/**`:

| File                                     | Page id           |
| ---------------------------------------- | ----------------- |
| `src/frontend/pages/index.tsx`           | `index`           |
| `src/frontend/pages/about.tsx`           | `about`           |
| `src/frontend/pages/admin/dashboard.tsx` | `admin/dashboard` |
| `src/frontend/pages/error/default.tsx`   | `error/default`   |

## Rendering From a Route

```ts
export default (app) => {
  app.get("/users/:id", {}, async (req, res) => {
    const user = await app.services.users.get(req.params.id);
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
};
```

`res.render(page, props?, options?)` means:

| Argument  | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `page`    | Page id under `src/frontend/pages/**`, without extension.               |
| `props`   | JSON-safe data prepared on the server and reused by hydration.          |
| `options` | Status, head, layout data, locale/messages, nonce, and render behavior. |

## Route Files Stay Server-only

Do this:

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

## Related Pages

- [SSR](/frontend/ssr)
- [Hydration](/frontend/hydration)
- [Render Data and Cache](/frontend/render-data-and-cache)
- [CSR and SPA Fallback](/frontend/csr-and-spa-fallback)

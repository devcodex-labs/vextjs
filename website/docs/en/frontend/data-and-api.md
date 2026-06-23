# Data and API Calls

## Table of Contents

- [First-screen Data](#first-screen-data)
- [Route Cache for Render Data](#route-cache-for-render-data)
- [Layout Data](#layout-data)
- [Client-side API Calls](#client-side-api-calls)
- [Generated Contract Artifacts](#generated-contract-artifacts)
- [HTML vs JSON Requests](#html-vs-json-requests)

## First-screen Data

The default Vext model is server-prepared first-screen data. Fetch data in the route handler or a service, then pass JSON-safe data to the page.

```ts
app.get("/orders/:id", {}, async (req, res) => {
  const order = await app.services.orders.findById(req.params.id);

  if (!order) {
    return res.renderError(404, "error/order-not-found", {
      props: { id: req.params.id },
    });
  }

  res.render("orders/detail", { order }, {
    head: { title: `Order ${order.no}` },
  });
});
```

The browser bundle receives serialized props, not service functions.

## Route Cache for Render Data

`RouteOptions.cache` applies to render responses too. For JSON routes it stores the JSON body; for `res.render()` it stores the render payload.

```ts
app.get(
  "/dashboard",
  { cache: { ttl: 30_000, partitionKey: (req) => req.user?.id ?? "guest" } },
  async (req, res) => {
    const stats = await app.services.dashboard.stats(req.user?.id);
    res.render("dashboard", { stats });
  },
);
```

On a cache hit Vext re-renders HTML from the cached payload with the current frontend renderer. This keeps HTML generation aligned with the current manifest while avoiding repeated service work.

## Layout Data

Use `layoutData` for data needed by shells, menus, permissions, breadcrumbs, or admin navigation.

```ts
res.render("admin/dashboard", { stats }, {
  layoutData: {
    root: { user },
    admin: { menu, permissions },
  },
});
```

Layout data must be JSON-safe. Keep database access and permission checks in `src/routes/**` or `src/services/**`.

## Client-side API Calls

After hydration, components can call normal Vext API routes with `fetch`.

```tsx
async function saveProfile(input: ProfileInput) {
  const res = await fetch("/api/profile", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(`Save failed: ${res.status}`);
  }

  return res.json();
}
```

Send `Accept: application/json` for API calls. That prevents client requests from being treated as HTML navigation and keeps error responses in JSON shape.

## Generated Contract Artifacts

When `frontend.apiClient` is enabled, Vext writes these artifacts next to the frontend output:

```text
dist/client/
  client-contract.json
  api.generated.ts
```

Use them for tooling, type probes, or advanced external frontend integrations. Normal Vext pages do not need to hand-write a route contract for first-screen data because `res.render()` already passes typed props from the route handler.

The public frontend entry also exports:

```ts
import {
  createVextApiClient,
  VextApiError,
  isVextApiError,
} from "vextjs/frontend";
```

Use this helper only when you need a generated/typed client boundary or an external frontend adapter. Simple Vext pages can call their own API routes with plain `fetch`.

## HTML vs JSON Requests

Vext keeps API semantics before frontend fallback semantics.

| Request | Expected result |
|---------|-----------------|
| `Accept: text/html`, route calls `res.render()` | SSR HTML |
| `Accept: application/json`, API route | JSON |
| API route throws `app.throw(...)` | JSON error |
| HTML route calls `res.renderError(...)` | HTML error page |
| Static asset missing | Static 404, not HTML render |
| `spaFallback.scopes[]` matched by HTML navigation | Shell document for that explicit client-router sub-app |

If an API call receives HTML, check the `Accept` header and `frontend.spaFallback.scopes[].exclude`.


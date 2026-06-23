# Render Data and Cache

Render data is the server-prepared payload used to produce HTML and hydrate the page.

## What Is Render Data

For `res.render()`, render data can include:

- `props`
- `options.layoutData`
- `options.messages`
- `options.locale`
- `options.head`
- status and page id

It should be JSON-safe and free of database handles, request objects, secrets, or functions.

## Route Cache Reuse

Vext reuses the existing route response cache contract. For JSON responses the cached body is JSON. For rendered pages the cached entry is a render payload.

```ts
app.get("/reports", { cache: { ttl: 60_000 } }, async (req, res) => {
  const reports = await app.services.reports.list();
  res.render("reports/index", { reports });
});
```

On a cache hit, Vext re-renders HTML from the cached payload with the current frontend renderer and manifest.

## Layout Data

If multiple layouts need server data, collect that data in the route handler or a service and pass it through `layoutData`.

```ts
res.render("admin/users", { users }, {
  layoutData: {
    shell: await app.services.admin.shell(req.user.id),
    breadcrumbs: ["Admin", "Users"],
  },
});
```

This avoids hidden service calls from layout components and keeps cache keys visible at the route boundary.

## Cache Keys

Include every value that changes the rendered payload:

- path and query
- authenticated user or tenant
- locale
- feature flag or experiment
- data version

If HTML differs per locale, make sure response cache and CDN cache vary by locale.

## What Not to Cache

Do not cache render payloads that include per-request secrets, one-time tokens, or non-repeatable user state. Use `cache: false` or a short TTL for those routes.

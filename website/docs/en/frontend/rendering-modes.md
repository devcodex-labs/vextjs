# Rendering Modes

Vext supports a mixed full-stack frontend model without mixing server files into the browser bundle.

## Default: SSR plus Hydration

Most pages should use server rendering:

```text
route handler -> service data -> res.render() -> HTML -> hydration
```

Use this when the first screen needs data, SEO-friendly HTML, shared layouts, or authenticated server decisions.

## Hydrated Interactions

After SSR, the browser hydrates the React tree. The same props and locale messages written into the document are reused by the client entry.

Use [Hydration](/frontend/hydration) when you need to debug mismatches, measure hydration cost, or tune first-load JS.

## Scoped CSR Sub-apps

Client-router sub-apps are explicit. Configure `frontend.spaFallback.scopes[]` only for paths that should receive a browser shell.

```ts
frontend: {
  spaFallback: {
    scopes: [
      { basePath: "/app", page: "app/shell", ssr: false },
    ],
  },
}
```

Use this for highly interactive islands of the product, admin consoles with client routing, or embedded tools. It is not the default page model.

## Render Data Cache

Route response cache can cache the render payload for `res.render()`: props, layoutData, messages, head, and status. On a cache hit Vext re-renders HTML from that payload with the current frontend manifest.

Use [Render Data and Cache](/frontend/render-data-and-cache) for cache keys, invalidation, and layout data guidance.

## Choosing a Mode

| Need | Recommended mode |
|------|------------------|
| Server data on first screen | SSR + hydration |
| SEO or public content | SSR + hydration |
| Authenticated admin shell | SSR for entry, optional scoped CSR inside |
| Highly interactive client routing | `spaFallback.scopes[]` for that route range |
| API-only service | Disable frontend |

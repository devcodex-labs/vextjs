# Hydration

Hydration attaches the browser React tree to the HTML produced by SSR.

Hydration is the default for interactive pages. It can be disabled for one SSR
route without disabling the frontend application.

## What Is Reused

Vext writes the render payload into the document so the client entry can hydrate without repeating first-screen service calls:

- page id
- props
- layoutData
- locale and messages
- head metadata used for the initial route
- build id and route assets

## Avoid Mismatch

Keep SSR and browser output deterministic:

| Risk                                | Better approach                                         |
| ----------------------------------- | ------------------------------------------------------- |
| `Date.now()` in render output       | Pass a timestamp from the route handler.                |
| random ids in component render      | Generate stable ids before render or in effects.        |
| browser-only APIs during SSR        | Guard with effects or client-only branches.             |
| locale objects with different shape | Keep every locale file aligned with the default locale. |

## Hydration Markers

Vext exposes low-noise runtime markers for tests and diagnostics:

```text
data-vext-hydration="hydrating"
data-vext-hydration="done"
performance.measure("vext:hydration")
```

The browser does not need to print performance logs in production. Validation scripts read DOM and Performance API signals.

## Route Assets

The render manifest records initial JS/CSS for each route. SSR can inject route-specific `modulepreload` entries so hydration does not discover the page chunk late.

If production `vext start` sees an outdated manifest without route assets, it fails fast and asks for a rebuild.

## Opt out for One SSR Page

```ts
app.get(
  "/article/:slug",
  { frontend: { hydration: "none" } },
  async (req, res) => {
    const article = await app.services.articles.find(req.params.slug);
    res.render("article", { article }, { seo: { title: article.title } });
  },
);
```

Because hydration policy is projected into the build manifest, a
three-argument route must keep its route-options argument and
`RouteOptions.frontend` value as an `inline object literal`. Keep dynamic page
metadata in `res.render(..., { seo })`.

This route outputs server-rendered HTML, CSS, SEO, and user-authored document
scripts. It does not output `__VEXT_DATA__`, the Vext browser entry, React/Vext
external runtime imports, or route JS preloads. Vext also marks the document
with `data-vext-hydration="none"` for diagnostics.

Because no Vext browser runtime exists on this page, framework-managed same-
document navigation, forms, fetchers, and React event handlers are not active.
Use normal links/forms or user-authored standalone scripts. A later full
document navigation to a hydrated route restores normal hydration there.

This policy applies to the whole page. Vext does not currently hydrate only a
search box or comment area, and does not claim Selective/Partial Hydration,
Islands, React Server Components, or Partial Prerendering (PPR).

## Validation

Use the consumer validation route:

```bash
npm --prefix E:\Worker\vextjs-test run verify:frontend-performance
```

It checks real browser navigation, frontend resource status, route preload, hydration marker, and `size-report.json`.

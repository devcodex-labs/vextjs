# Error Pages and Document

## Table of Contents

- [Default Error Pages](#default-error-pages)
- [`renderError()`](#rendererror)
- [404 Arbitration](#404-arbitration)
- [HTML Document](#html-document)
- [Head and CSP Nonce](#head-and-csp-nonce)
- [Data Serialization](#data-serialization)

## Default Error Pages

Default error pages live under:

```text
src/frontend/pages/error/
  default.tsx
  404.tsx
  500.tsx
```

`error/default.tsx` is the fallback when a status-specific page is missing.

## `renderError()`

Use `res.renderError()` when the handler intentionally returns an HTML error page.

```ts
res.renderError(404);
res.renderError(404, { id: req.params.id });
res.renderError(404, "error/order-not-found");
res.renderError(error, "error/default", {
  props: { requestId: req.id },
  status: 500,
});
```

Put the page id in the second argument or in `options.page`. Do not use `renderError("error/404")` as the first argument.

## 404 Arbitration

Vext does not turn every 404 into the same HTML page. The output depends on request type and route ownership.

| Situation                                      | Result                   |
| ---------------------------------------------- | ------------------------ |
| API route missing or API request asks for JSON | JSON 404                 |
| Static asset missing                           | static 404               |
| Handler calls `res.renderError(404)`           | HTML error page          |
| HTML page id is missing                        | page registry diagnostic |
| `spaFallback.scopes[]` matches HTML navigation | configured shell page    |
| Unknown HTML navigation without fallback       | normal route 404         |

This keeps API clients and static assets from accidentally receiving application HTML.

## HTML Document

The default document file is:

```text
src/frontend/pages/_document.html
```

Use reserved Vext tokens:

```html
<!doctype html>
<html lang="{vext.lang}">
  <head>
    {vext.head} {vext.styles}
  </head>
  <body>
    <div id="root">{vext.app}</div>
    {vext.data} {vext.scripts}
  </body>
</html>
```

The template does not evaluate arbitrary expressions. Pass data through `props`, `layoutData`, `messages`, or `head`.

`{vext.lang}` is request-aware when `frontend.i18n.htmlLang` is enabled. `res.render(page, props, { locale })` updates the final `<html lang>` value during SSR; `htmlLang: false` removes Vext's generated lang marker.

## Head and CSP Nonce

Use `options.head` for title, meta, and link tags.

```ts
res.render("dashboard", props, {
  nonce: req.cspNonce,
  head: {
    title: "Dashboard",
    meta: [{ name: "description", content: "Team dashboard" }],
    links: [{ rel: "canonical", href: "https://example.com/dashboard" }],
  },
});
```

When `nonce` is provided, Vext applies it to generated script/data tags.

## Data Serialization

`props`, `layoutData`, `messages`, and render metadata must be JSON-safe. Do not pass functions, class instances, streams, database connections, or raw request objects.

Vext escapes serialized data before injecting it into `{vext.data}`. Put user input into data fields or head objects instead of writing it directly into `_document.html`.

# Error Pages and Document

In an existing [full-stack project](/frontend/getting-started) with frontend enabled, this page adds an HTML error page and changes the outer document template. Route exceptions, an intentionally rendered error, and an unmatched request enter through different paths; verify them separately.

## Table of Contents

- [Default Error Pages](#default-error-pages)
- [`renderError()`](#rendererror)
- [404 Arbitration](#404-arbitration)
- [HTML Document](#html-document)
- [Head and CSP Nonce](#head-and-csp-nonce)
- [Data Serialization](#data-serialization)
- [Verify the Result](#verify-the-result)

## Default Error Pages

Default error pages live under:

```text
src/frontend/pages/error/
  default.tsx
  404.tsx
  500.tsx
```

The first registered page wins in this order: explicitly selected page → `frontend.errorPages.status[status]` → `error/status` → `frontend.errorPages.default` → `error/default`. When none exists, the framework uses its built-in error document. A custom error-page directory still uses `error/` as the Page ID prefix.

A default page can be written as follows:

```tsx
// src/frontend/pages/error/default.tsx
export default function ErrorPage(props: {
  error: { status: number; message: string; requestId?: string };
}) {
  return (
    <main>
      <h1>{props.error.status}</h1>
      <p>{props.error.message}</p>
      <small>{props.error.requestId}</small>
    </main>
  );
}
```

## `renderError()`

Use `res.renderError()` when the handler intentionally returns an HTML error page.

```ts
// src/routes/errors.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/missing", {}, (_req, res) => {
    res.renderError(404, { details: { resource: "user" }, layout: false });
  });
});
```

These are other calls within a handler. `error` is an exception caught by the application. Choose the appropriate call; do not run them all for one response:

```ts
res.renderError(404);
res.renderError(404, { details: { id: "1" } });
res.renderError(404, "error/order-not-found");
res.renderError(error, "error/default", {
  props: { supportPath: "/help" },
});
```

Put the page id in the second argument or in `options.page`. Do not use `renderError("error/404")` as the first argument.

A string in the first argument is an error code. The second argument also accepts raw details, but an object with option keys such as `page`, `message`, or `props` is interpreted as options; prefer `{ details: ... }`. Status derives from the first argument or current response status. The current implementation does not override that derived status with `options.status`; pass `404` directly when you need 404. The page receives normalized `props.error`, merged with custom `options.props`. Custom props cannot overwrite the generated error.

## 404 Arbitration

Vext does not turn every 404 into the same HTML page. The output depends on request type and route ownership.

| Situation                                                                 | Result                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Default-excluded `/api` path or unknown request that does not accept HTML | Ordinary 404 handling                                                |
| Static asset missing                                                      | Static 404                                                           |
| Handler calls `res.renderError(404)`                                      | HTML error page                                                      |
| HTML page ID missing                                                      | Page registry diagnostic                                             |
| HTML navigation matches `spaFallback.scopes[]`                            | Configured shell page                                                |
| Unmatched GET/HEAD HTML navigation without an extension or exclusion      | Try the HTML 404 page, then ordinary 404 handling if rendering fails |

This table concerns unmatched requests and default exclusions. An exception from a matched handler does not automatically call `renderError` merely because an error-page file exists. SPA fallback exclusions affect arbitration; preserve API and asset paths when overriding the defaults. See [CSR and SPA Fallback](/frontend/csr-and-spa-fallback).

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
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    {vext.head} {vext.styles}
  </head>
  <body>
    {vext.root} {vext.data} {vext.entry}
  </body>
</html>
```

`{vext.root}` generates the root needed for SSR/hydration, `{vext.data}` the data node, `{vext.entry}` the entry script, `{vext.styles}` build styles, and `{vext.head}` external runtime tags. The renderer adds request-specific head content before `</head>`. `{vext.app}` and `{vext.scripts}` are unsupported. Keep each required node exactly once to avoid duplicated root/data/entry.

The template does not evaluate arbitrary expressions. Pass data through `props`, `layoutData`, `messages`, or `head`.

With frontend.i18n.htmlLang enabled, `{vext.lang}` uses the effective request locale with an explicit options.locale taking priority. The page envelope carries that locale and browser navigation updates `<html lang>`. htmlLang:false removes the generated marker; navigation caches still use the envelope locale.

## Head and CSP Nonce

Use `options.head` for title, meta, and link tags. `meta` is a map from names to content, not an array. This is a route-file snippet; `props` is prepared page data:

```ts
import { randomBytes } from "node:crypto";

// Generate a nonce for this response inside the handler.
const nonce = randomBytes(16).toString("base64");
res.render("dashboard", props, {
  nonce,
  head: {
    title: "Dashboard",
    meta: { description: "Team dashboard" },
    links: [{ rel: "canonical", href: "https://example.com/dashboard" }],
  },
});
```

When `nonce` is supplied, Vext applies it to script tags marked `data-vext-entry`, `data-vext-data`, or `data-vext-media` that lack a nonce. It does not set a CSP response header or add nonces to arbitrary handwritten scripts or JSON-LD in the template. If CSP is enabled, the application must configure the corresponding response policy with the same nonce.

## Data Serialization

`props`, `layoutData`, `messages`, and render metadata must be JSON-safe. Do not pass functions, class instances, streams, database connections, or raw request objects.

Vext escapes serialized data before injecting it into `{vext.data}`. Put user input into data fields or head objects instead of writing it directly into `_document.html`.

## Verify the Result

Run `npm run build`, then `npm start -- --port 3000`. Request `/errors/missing`: it should have status 404 and a body from the error page. Request a normal page and check that no `{vext.*}` string remains and that the root, data node, and entry script each appear once. Navigate to an unknown path as HTML and request `/api/missing` with JSON Accept to check the two 404 exits; `/assets/missing.js` must not return an app shell. Stop the service after verification. See [Error Handling](/guide/error-handling) for exception handling rules.

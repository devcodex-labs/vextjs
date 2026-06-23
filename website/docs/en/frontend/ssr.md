# SSR

Server-side rendering is the default Vext page path. The route handler owns the URL and prepares the data; the frontend page owns the React view.

## Server Chain

```text
src/routes/** -> services -> res.render() -> renderer -> _document.html
```

The renderer uses:

- page component from `src/frontend/pages/**`
- matching `layout.tsx` chain
- `src/frontend/pages/error/**` when rendering an error page
- locale messages from `src/frontend/locales/**`
- manifest assets from the current frontend build

## Example

```ts
export default (app) => {
  app.get("/reports/:id", {}, async (req, res) => {
    const report = await app.services.reports.get(req.params.id);

    res.render("reports/detail", { report }, {
      head: { title: report.title },
      layoutData: {
        section: "reports",
      },
    });
  });
};
```

## What Can Run on the Server

Route handlers can use:

- `app.services`
- database clients owned by services
- request context and auth state
- response cache settings
- server-only environment variables

Page components must not import those server-only modules. They receive JSON-safe data.

## HTML Document

`src/frontend/pages/_document.html` is the outer document template. It owns `{vext.head}`, `{vext.styles}`, `{vext.root}`, `{vext.data}`, and `{vext.entry}`. React layouts own the app shell inside the root.

## Status and Headers

Use render options for HTML status and head data:

```ts
res.render("not-ready", props, {
  status: 503,
  head: { title: "Service unavailable" },
});
```

For JSON/API errors, keep using the existing API error response path. HTML rendering should not intercept API semantics.

# SSR

Server-side rendering is the default Vext page path. The route handler owns the URL and prepares the data; the frontend page owns the React view.

In a project from [Full-Stack Quick Start](/frontend/getting-started), this page adds a report and checks that the HTTP response already contains its body. It requires `frontend.enabled: true` and SSR that has not been disabled globally, by route `clientOnly`, or by a per-render option.

## Server Chain

```text
src/routes/** -> services -> res.render() -> renderer -> _document.html
```

The renderer uses:

- page component from `src/frontend/pages/**`
- matching `layout.tsx` chain
- `src/frontend/pages/error/**` for `renderError()` or the framework HTML error-page path
- locale messages from `src/frontend/locales/**` when frontend i18n is enabled
- manifest assets from the current frontend build

## Example

Create these two files. Fixed report data makes the example runnable directly; put real database queries in a service called by the route.

```ts
// src/routes/reports.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", { validate: { param: { id: "string" } } }, (req, res) => {
    const report = { id: "1", title: "Monthly report", total: 42 };
    if (req.valid("param").id !== report.id) app.throw(404, "Report not found");

    res.render(
      "reports/detail",
      { report },
      {
        head: { title: report.title },
      },
    );
  });
});
```

```tsx
// src/frontend/pages/reports/detail.tsx
export default function ReportPage(props: {
  report: { id: string; title: string; total: number };
}) {
  return (
    <main>
      <h1>{props.report.title}</h1>
      <p>Total: {props.report.total}</p>
    </main>
  );
}
```

The final URL is `/reports/1`: `reports.ts` contributes the file prefix. The page ID is `reports/detail`. To pass data to an app shell, group `layoutData` by layout ID as explained in [Layouts and Components](/frontend/layouts-and-components).

## What Can Run on the Server

Route handlers can use:

- `app.services`
- database clients owned by services
- request context and auth state
- response cache settings
- server-only environment variables

Page components must not import those server-only modules. They receive JSON-safe data; explicitly select fields intended for the browser in the handler. Disabling SSR does not give a page permission to import server modules.

## HTML Document

`src/frontend/pages/_document.html` is the outer document template. It owns `{vext.head}`, `{vext.styles}`, `{vext.root}`, `{vext.data}`, and `{vext.entry}`. React layouts own the app shell inside the root.

## Status and Headers

HTML status, response headers, and document head are separate options. This handler snippet replaces the example's render call to show a prepared report while marking the response temporarily unavailable; `report` is the variable from above:

```ts
res.render(
  "reports/detail",
  { report },
  {
    status: 503,
    headers: { "Retry-After": "60" },
    head: { title: "Service unavailable" },
  },
);
```

For JSON/API errors, keep using the existing API error response path. HTML rendering should not intercept API semantics.

## Buffered and Streaming

The configuration parser defaults to `render.streaming: "buffered"`; the full-stack template explicitly sets `"auto"`. Buffered rendering is synchronous. Its `timeoutMs` is checked after return and cannot interrupt CPU-bound synchronous code. On failure, `render.fallback` either returns a client shell or delegates to error handling. Streaming may send a shell first, but it cannot change status or headers after bytes are sent; the initial payload and head must be determined before then. See [Rendering Modes](/frontend/rendering-modes) for the complete sequence and no-hydration limits.

## Verify SSR

Run `npm run build`, then `npm start -- --port 3000` after success. Inspect the HTTP body for `/reports/1`: it should already contain `Monthly report` and `Total: 42`, with a title from `head.title`, rather than only an empty root. `/reports/2` should return 404. To test the status option, rebuild and start again, then check 503 and `Retry-After: 60`; the page merely appearing is insufficient. Stop the service afterward.

If you get only a client shell, inspect `frontend.render.ssr`, route `clientOnly`, the per-render `ssr` option, and an SSR fallback after an error or timeout. HTTP 200 alone does not prove SSR succeeded. See [Hydration](/frontend/hydration) for browser takeover; a rendered body alone does not prove interaction works.

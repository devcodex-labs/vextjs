# CSR and SPA Fallback

The default Vext page model is SSR plus hydration. CSR fallback is scoped and explicit.

In an existing [full-stack project](/frontend/getting-started), this guide adds a client shell under `/app` and verifies that it does not take over requests outside its conditions. Vext delivers the shell; the application implements routing within it. Configuring a scope does not install or generate a client router.

## When to Use CSR

Use a client-router sub-app when a route range behaves like a browser application after the first shell:

- admin workbench
- editor or dashboard tools
- embedded product console
- complex client-side navigation under one path prefix

Keep ordinary content pages on SSR.

## Configure a Scope

Create the shell page first. This example displays the client path to confirm that the shell is running in the browser:

```tsx
// src/frontend/pages/app/shell.tsx
import { useEffect, useState } from "react";

export default function AppShellPage() {
  const [pathname, setPathname] = useState("");
  useEffect(() => setPathname(window.location.pathname), []);
  return (
    <main>
      <h1>Client workspace</h1>
      <p>{pathname || "Loading path..."}</p>
    </main>
  );
}
```

Merge this `frontend` configuration into `src/config/default.ts`, preserving the project's other settings:

```ts
export default {
  frontend: {
    enabled: true,
    spaFallback: {
      scopes: [
        {
          basePath: "/app",
          page: "app/shell",
          ssr: true,
          exclude: ["/app/api/**"],
        },
      ],
    },
  },
};
```

Object-form `scopes[]` defaults to an empty array, so omitting it does not take over unknown paths. The special shorthand `spaFallback: true`, however, creates a `/` scope with `index` as its shell page. It does not mean “enabled with no scope.” Disable fallback with `spaFallback: false` or `enabled: false` in the object form.

The main example retains SSR for the shell, after which the browser handles interaction and internal routing. Each client path does not need a separate server page.

### Empty-shell mounting behavior

`ssr: false` retains the document, assets, and page payload without server-rendered body content. The renderer records the actual mount mode: CSR, `clientOnly: true`, and buffered client fallback use `createRoot`; completed SSR uses `hydrateRoot`. An SSR component returning null still counts as completed SSR; the browser does not infer the mode from an empty root.

You can set this example to `ssr: false` to serve an empty shell. Verify the first screen, event updates, and an error-free Console. With SSR enabled, initial server and browser output must still agree; keep browser-only logic in effects.

## Request Matching

Fallback only applies when all of these are true:

- request path is inside a configured scope, matching by path segment (`/app` does not match `/apple`; the longest `basePath` wins on overlap)
- no explicit API or route handled the request
- no static asset matched
- the method is GET or HEAD and the decoded path has no extension
- the request accepts HTML; `text/html`, `*/*`, and an absent Accept header all count
- neither the global `spaFallback.exclude` nor the scope's `exclude` matches

An unknown path explicitly requesting JSON does not receive the shell. The default global exclusions are `/api/**`, `/openapi.json`, `/docs/**`, and `/_vext/docs/**`. A custom global array replaces these defaults, so preserve the exclusions your project needs. A scope exclusion only excludes that shell; it does not define an API. For example, `/app/api/missing` in this guide may still follow the ordinary HTML 404 error-page path. Register a real route and use matching request semantics to provide an API.

If the shell page is absent or rendering fails, the framework continues with other 404 handling. Do not mistake arbitrary returned HTML for a successful scope match. See [Errors and Document](/frontend/errors-and-document) for selection and error pages.

## Mixed SSR and CSR

A project can use both:

```text
/             -> SSR page
/pricing      -> SSR page
/admin        -> SSR entry
/admin/app/*  -> scoped CSR shell
/api/**       -> API routes
```

The important rule is that each client-router area has a deliberate base path and shell page.

## Verification Scope

Run `npm run build`, then start `npm start -- --port 3000` after the build succeeds:

- Navigate to `/app/projects` as HTML: status 200, with `Client workspace` and `Loading path...` already in the original HTML. After browser scripts load, the current path appears without a hydration mismatch in the console.
- Send `Accept: application/json` to `/app/projects`: expect a 404, not the shell.
- Request `/app/missing.js`, `/app/api/missing`, and `/api/missing`: none should match this shell.
- Request `/apple/projects`: it is outside `/app` and should return 404.

To reproduce the limitation above, change the scope to `ssr: false`, rebuild, and start again. The original root is empty; even if the browser recovers and displays the page, record the mismatch rather than declaring error-free success. Restore `ssr: true` and stop the service after verification. If an explicit route matches a test path, its result takes precedence; fallback only handles unmatched requests.

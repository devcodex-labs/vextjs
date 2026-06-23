# Code Splitting

Vext splits frontend code around pages, layouts, error pages, locales, and shared runtime chunks.

## Page Lazy Registry

Pages are loaded through a generated browser registry. This keeps the initial route from importing every page at startup.

```text
src/frontend/pages/admin/dashboard.tsx
  -> generated lazy entry
  -> route asset graph
```

## Layouts and Errors

Layouts and error pages are also part of the registry. A route preload can include the page, layout chain, shared CSS, and runtime chunks needed for the first render.

## Vendor Chunks

Shared runtime packages are grouped through Vext-managed vendor chunks. This avoids duplicating React/runtime code in every page chunk.

## External Runtime

Advanced deployments can mark browser dependencies as external and provide runtime URLs:

```ts
frontend: {
  build: {
    client: {
      external: ["react", "react-dom/client"],
      externalRuntime: {
        react: "https://cdn.example.com/react.js",
        "react-dom/client": "https://cdn.example.com/react-dom-client.js",
      },
    },
  },
}
```

React-related externals must provide mappings. Vext should fail fast instead of producing a browser bundle that cannot resolve imports.

## Route Assets

The render manifest maps routes to initial assets. SSR uses that graph to inject route-specific `modulepreload` instead of relying on late dynamic import discovery.

## When Budgets Fail

If a route initial chunk grows too large:

- check whether a heavy component should be imported later
- move admin-only dependencies out of public pages
- review route assets in `size-report.json`
- use external runtime only when your deployment can serve it reliably

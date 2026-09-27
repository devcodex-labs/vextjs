# Code Splitting

Vext splits frontend code around pages, layouts, error pages, locales, and shared runtime chunks.

Use this page to assess initial loading in an application with frontend enabled. Complete [Full-Stack Quick Start](./getting-started), build, and inspect the actual output. The default splitting settings are usually sufficient.

## Page Lazy Registry

Pages are loaded through a generated browser registry. This keeps the initial route from importing every page at startup.

```text
src/frontend/pages/admin/dashboard.tsx
  -> generated lazy entry
  -> route asset graph
```

## Default and opt-out behavior

`frontend.build.client.splitting` defaults to `true`. The generated page, layout, and error registry uses dynamic `import()` entries, so browser route code is split by default. Shared dependencies may be merged into chunks; one URL is not guaranteed to correspond to exactly one file. SSR with default hydration injects route-specific `modulepreload` for the first screen, improving its preload without making the registry eager. A `hydration: "none"` page emits no such JS preload.

Set `frontend.build.client.splitting: false` only when a deployment has a specific bundling compatibility or diagnostic reason. It disables client code splitting and can merge more route modules into the initial browser output; it is not a way to make lazy loading more reliable.

## Layouts and Errors

Layouts and error pages are also part of the registry. Route assets record the page, layout chain, shared CSS, and runtime chunks. JS uses modulepreload and CSS uses a stylesheet link. Delayed modules such as error pages load when needed.

## Vendor Chunks

`frontend.build.vendorChunks.enabled` is on by default. It creates vendor entries for configured packages, then esbuild splits shared dependencies. This often allows reuse of React/runtime chunks but does not promise fixed chunk filenames or sizes. Inspect the actual output dependency closure.

## External Runtime

Advanced deployments can mark browser dependencies as external and provide runtime URLs. This configuration shape is an example: replace every URL with a compatible browser ESM module and keep React, React DOM, and JSX runtime versions aligned. Retain default bundling until those resources exist.

```ts
export default {
  frontend: {
    enabled: true,
    build: {
      client: {
        external: [
          "react",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
        externalRuntime: {
          react: "https://cdn.example.com/react.mjs",
          "react-dom/client": "https://cdn.example.com/react-dom-client.mjs",
          "react/jsx-runtime": "https://cdn.example.com/react-jsx-runtime.mjs",
          "react/jsx-dev-runtime":
            "https://cdn.example.com/react-jsx-dev-runtime.mjs",
        },
      },
    },
  },
};
```

Merge it into `src/config/default.ts`. Vext checks mappings for React-related items in the explicit external list and writes mappings as import map/preload; a missing required mapping fails the build. It does not download CDN modules or verify their internal dependencies. Inspect all remaining bare imports in the real output, including package subpaths and dependencies inside remote modules, and supply mappings or resolvable URLs. A successful local build does not prove the CDN runtime works.

## Route Assets

The render manifest maps routes to initial assets. SSR uses that graph to inject route-specific `modulepreload` instead of relying on late dynamic import discovery.

## When Budgets Fail

If a route initial chunk grows too large:

- check whether a heavy component should be imported later
- move admin-only dependencies out of public pages
- inspect `size-report.json` route metrics with both `frontend.build.diagnostics.sizeReport` and `performanceReport` enabled
- use external runtime only when your deployment can serve it reliably

## Verify the Splitting Result

Run `npm run build` in the application root. Inspect `routeAssets` in default `dist/client/render-manifest.json` and `routes[]` in `size-report.json`, mapping a particular page to its initial JS closure; use the actual directory if outDir is customized. Start the app, open a page directly in a new tab, inspect JS/CSS and preloads in Network, then navigate to another page and inspect added assets. Preload, cache, and shared chunks affect request counts, so do not infer total bytes from the count alone.

When comparing `splitting: false`, rebuild after each change and use the new output, recording size and interaction. Restore the chosen setting and stop the service. See [Performance Budgets](./performance-budgets) for size accounting and [Hydration Validation](./hydration-validation) for browser behavior.

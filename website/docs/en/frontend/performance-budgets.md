# Performance Budgets

Performance budgets keep the React hydration path measurable.

## Size Report

When `frontend.build.diagnostics.sizeReport` is enabled, Vext writes:

```text
dist/client/size-report.json
```

The report includes:

- raw size
- gzip size
- brotli size
- initial JS
- route initial JS
- app-owned assets
- external runtime groups

When `frontend.build.diagnostics.performanceReport` is enabled, the report also includes route-level initial JS metrics. When it is disabled, SSR route preload metadata is still generated in `render-manifest.json`, but route-level byte metrics are omitted from build reports.

## Budget Fields

```ts
frontend: {
  build: {
    budgets: {
      maxInitialJsBrotliBytes: 60_000,
      maxRouteInitialJsBrotliBytes: 80_000,
      maxAppOwnedInitialJsBrotliBytes: 40_000,
    },
  },
}
```

Compressed budgets better reflect transfer cost than raw byte limits.

## Fixing a Budget Failure

| Failure                  | First check                                     |
| ------------------------ | ----------------------------------------------- |
| Initial JS too large     | Shared vendor chunk and app entry imports.      |
| Route JS too large       | Page-specific imports and heavy widgets.        |
| App-owned JS too large   | Components that can lazy-load after hydration.  |
| External runtime missing | `externalRuntime` mapping and CDN availability. |

## Recommended Practice

Start with warning budgets while a product is still moving fast. Turn them into blocking budgets for release branches once route baselines are stable.

Keep budget numbers in config, not in CI scripts, so local build and CI enforce the same contract.

# Performance Budgets

Performance budgets limit frontend artifact bytes during a build. They do not measure hydration time on a real device, network latency, or interaction performance; verify those in a browser. This page assumes frontend is enabled.

## Size Report

`frontend.build.diagnostics.sizeReport` is on by default. A production build writes this file in the default outDir; a custom outDir changes its location, and development output defaults to `.vext/client`:

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
- groups and origins for local output, plus external URL lists in route records

Top-level `initialJs*` chooses the first-load closure of the page with the **largest raw JS byte count**, then reports its gzip and brotli values. It does not choose a different maximum page for each compression metric. The closure includes static browser-entry dependencies and chunks needed by that page/layout, stopping at dynamic imports for other delayed entries. Inspect `routes[]` for each page; a page ID is not necessarily one business URL.

`appOwnedInitialJsBrotliBytes` currently counts local output JS, including bundled third-party code, not just application source. External runtime URLs are not downloaded or measured, so their remote cost is absent from these local bytes. `total*` covers assets selected by the deploy manifest; upload include/exclude changes that total.

When both `sizeReport` and `frontend.build.diagnostics.performanceReport` are enabled, the file retains route-level initial JS metrics; performanceReport also defaults on. When it is off, SSR preload metadata remains in `render-manifest.json`, but persisted route-level byte metrics are omitted. Disabling report output does not disable budgets: the builder computes and checks budgets before deciding which reports to write.

## Budget Fields

```ts
// Merge into src/config/default.ts, retaining other settings.
export default {
  frontend: {
    enabled: true,
    build: {
      diagnostics: { sizeReport: true, performanceReport: true },
      budgets: {
        warnOnly: true,
        maxInitialJsBrotliBytes: 60_000,
        maxRouteInitialJsBrotliBytes: 80_000,
        maxAppOwnedInitialJsBrotliBytes: 40_000,
      },
    },
  },
};
```

These numbers are example thresholds; choose values from the actual report. All byte thresholds default to `0` (disabled). `warnOnly` defaults to `false`, so exceeding an enabled threshold normally fails the build. The example enables warnings explicitly to observe a baseline first.

| Field                                                                     | What it evaluates                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `maxAssetBytes`                                                           | Raw bytes of each deploy-manifest asset                                                        |
| `maxInitialJsBytes` / `maxInitialJsGzipBytes` / `maxInitialJsBrotliBytes` | Top-level first-load metrics described above                                                   |
| `maxRouteInitialJsBrotliBytes`                                            | First-load brotli per page, falling back to the top-level metric if there are no route records |
| `maxAppOwnedInitialJsBrotliBytes`                                         | Brotli metric of the top-level local-output closure                                            |
| `maxTotalBytes`                                                           | Raw total of assets selected by the deploy manifest                                            |

Compressed values are calculated locally per file for comparing build baselines; they are not the actual transferred size. Computing brotli metrics does not make the server send Brotli-encoded responses automatically. A per-page budget can catch a page whose compressed size exceeds that of the page chosen by the raw top-level metric.

## Fixing a Budget Failure

| Failure                  | First check                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Initial JS too large     | Shared vendor chunk and app entry imports.                                                     |
| Route JS too large       | Page-specific imports and heavy widgets.                                                       |
| App-owned JS too large   | Local-output closure, including bundled third-party code; inspect modules that can load later. |
| External runtime missing | `externalRuntime` mapping and CDN availability.                                                |

## Recommended Practice

Start with warning budgets while a product is still moving fast. Turn them into blocking budgets for release branches once route baselines are stable.

Keep budget numbers in config, not in CI scripts, so local build and CI enforce the same contract.

## Verify a Budget

Run `npm run build` in the application root and inspect the report's page and actual bytes. In warning mode, exceeding a threshold should print a budget message while the build succeeds. After establishing a baseline, set `warnOnly: false` and lower a known nonzero metric in a test configuration to confirm the build exits nonzero. Old artifacts may remain after a failed build; do not mistake an old report for the failed candidate's output. Locate the actual value in the error, restore a reasonable threshold, and rebuild.

Finally use [Hydration Validation](./hydration-validation) on a real page. Verify network cost and reachability of external runtime resources separately using [Code Splitting](./code-splitting).

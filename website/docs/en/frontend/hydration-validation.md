# Hydration Validation

Hydration validation proves that the built page works in a real browser, not only in static build output.

## What to Validate

A complete frontend production smoke should check:

- page returns HTML
- JS/CSS/assets return 2xx
- no browser console errors
- no page errors
- route-specific `modulepreload` exists
- hydration marker reaches `done`
- `performance.measure("vext:hydration")` exists
- `size-report.json` contains route metrics when `frontend.build.diagnostics.performanceReport` is enabled

## Browser Probe

The external consumer project provides a probe:

```bash
npm --prefix E:\Worker\vext-test run verify:frontend-performance
```

It builds the app, starts a production server for the test, opens pages with Playwright, records network failures, reads DOM markers, reads Performance API entries, and closes the server.

## Runtime Signals

Expected client-side signals:

```text
data-vext-hydration="done"
performance.measure("vext:hydration")
```

These are intended for tests and diagnostics. They should stay quiet in production logs.

## Common Failures

| Failure               | Likely cause                                 |
| --------------------- | -------------------------------------------- |
| JS 404                | Asset public path or static mount mismatch.  |
| No hydration marker   | Client entry did not run or failed early.    |
| Hydration mismatch    | Non-deterministic SSR/client render output.  |
| Missing route preload | Stale render manifest; rebuild before start. |

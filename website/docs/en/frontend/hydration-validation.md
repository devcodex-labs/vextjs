# Hydration Validation

Hydration validation must follow the route policy. A default `full` route and a `hydration: "none"` route are both valid, but their expected browser signals are intentionally different.

## Run the right check

For this repository's documentation contract, run:

```bash
npm run verify:docs-contract
```

This command checks documentation consistency only; it does not start an application or prove browser behavior. For an application, use its supported build, start, and browser-test flow to visit one `full` route and one `none` route. Do not rely on a repository-internal consumer command.

## Default `full` route

A production smoke for the default policy should check:

- the page returns SSR HTML
- JS, CSS, and other assets return 2xx
- there are no browser console or page errors
- route-specific `modulepreload` exists
- the marker reaches `data-vext-hydration="done"`
- a Performance entry named `vext:hydration` exists
- `size-report.json` contains route metrics when `frontend.build.diagnostics.performanceReport` is enabled

## `hydration: "none"` route

A `none` page should instead check:

- the page still returns SSR HTML, CSS, and SEO metadata
- the root is marked `data-vext-hydration="none"`
- no Vext browser entry, `__VEXT_DATA__`, or `data-vext-route-preload` is emitted
- normal `<a>` links and normal HTML `<form>` elements use normal document navigation or submission
- the test does not expect the `done` marker, the `vext:hydration` Performance entry, React events, Vext Form, fetcher, or framework-managed client navigation

## Runtime Signals

Expected client-side signals for the default policy:

```text
data-vext-hydration="done"
performance.measure("vext:hydration")
```

For `hydration: "none"`, the intentional signal is:

```text
data-vext-hydration="none"
```

These are intended for tests and diagnostics. They should stay quiet in production logs.

## Common Failures

| Failure                                      | Likely cause                                                   |
| -------------------------------------------- | -------------------------------------------------------------- |
| JS 404 on a default route                    | Asset public path or static mount mismatch.                    |
| No `done` marker on a default route          | Client entry did not run or failed early.                      |
| Expecting `done` or preload on a `none` page | The test is applying default-policy signals to the wrong mode. |
| Hydration mismatch                           | Non-deterministic SSR/client render output.                    |
| Missing route preload on a default route     | Stale render manifest; rebuild before start.                   |

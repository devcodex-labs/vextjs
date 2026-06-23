# Hydration

Hydration attaches the browser React tree to the HTML produced by SSR.

## What Is Reused

Vext writes the render payload into the document so the client entry can hydrate without repeating first-screen service calls:

- page id
- props
- layoutData
- locale and messages
- head metadata used for the initial route
- build id and route assets

## Avoid Mismatch

Keep SSR and browser output deterministic:

| Risk | Better approach |
|------|-----------------|
| `Date.now()` in render output | Pass a timestamp from the route handler. |
| random ids in component render | Generate stable ids before render or in effects. |
| browser-only APIs during SSR | Guard with effects or client-only branches. |
| locale objects with different shape | Keep every locale file aligned with the default locale. |

## Hydration Markers

Vext exposes low-noise runtime markers for tests and diagnostics:

```text
data-vext-hydration="hydrating"
data-vext-hydration="done"
performance.measure("vext:hydration")
```

The browser does not need to print performance logs in production. Validation scripts read DOM and Performance API signals.

## Route Assets

The render manifest records initial JS/CSS for each route. SSR can inject route-specific `modulepreload` entries so hydration does not discover the page chunk late.

If production `vext start` sees an outdated manifest without route assets, it fails fast and asks for a rebuild.

## Validation

Use the consumer validation route:

```bash
npm --prefix E:\Worker\vext-test run verify:frontend-performance
```

It checks real browser navigation, frontend resource status, route preload, hydration marker, and `size-report.json`.

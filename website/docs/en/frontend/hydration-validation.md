# Hydration Validation

Hydration validation must follow the route policy. A default `full` route and a `hydration: "none"` route are both valid, but their expected browser signals are intentionally different.

## Run the right check

Using the two article routes from [Hydration](./hydration) as a comparison, run these commands in the root of an application with frontend and SSR enabled:

```bash
npm run build
npm start -- --port 3000
```

Open `/article/interactive/intro` and `/article/intro` directly and check the full/none conditions below. Both original HTML responses should contain the article body and SEO title. The interactive route's button should increment its count; the other stays at `Clicks: 0`. Native GET forms and links should work in both. Inspect Console, Network, Elements, and Performance in browser developer tools; the final page merely appearing is not enough. Stop the service afterward.

The following full-route checks assume SSR completed normally. If SSR is disabled, `clientOnly: true` is used, or an error causes client fallback, consult the [current empty-shell limitation](./csr-and-spa-fallback#current-limitation-of-an-empty-shell). React recovering the display does not mean the browser was error-free.

## Default `full` route

A production smoke for the default policy should check:

- the page returns SSR HTML
- JS, CSS, and other assets return 2xx
- there are no browser console or page errors
- route-specific `modulepreload` exists
- the marker reaches `data-vext-hydration="done"`
- a Performance entry named `vext:hydration` exists
- `size-report.json` in the build output contains route metrics when both `frontend.build.diagnostics.sizeReport` and `performanceReport` are enabled; the latter alone does not guarantee that file

## `hydration: "none"` route

A `none` page should instead check:

- the page still returns SSR HTML, CSS, and SEO metadata
- the root is marked `data-vext-hydration="none"`
- no Vext browser entry, `__VEXT_DATA__`, or `data-vext-route-preload` is emitted
- normal `<a>` links and normal HTML `<form>` elements use normal document navigation or submission
- the test does not expect the `done` marker, the `vext:hydration` Performance entry, React events, Vext Form enhancement, fetcher, or framework-managed client navigation; the native form rendered by Vext Form still follows its action/method

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

`done` means the root boundary's effect ran; a Performance entry also requires the browser Performance API. Neither replaces error and actual-interaction checks or proves all asynchronous content finished.

## Common Failures

| Failure                                      | Likely cause                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| JS 404 on a default route                    | Asset public path or static mount mismatch.                                                                        |
| No `done` marker on a default route          | Client entry did not run or failed early.                                                                          |
| Expecting `done` or preload on a `none` page | The test is applying default-policy signals to the wrong mode.                                                     |
| Hydration mismatch                           | SSR/client output differs, or an empty shell still uses `hydrateRoot`; see the current limitation on the CSR page. |
| Missing route preload on a default route     | Stale render manifest; rebuild before start.                                                                       |

## When Maintaining This Repository's Docs

Run `npm run verify:docs-contract` in the framework repository to check the documentation contract. It does not start an application or prove browser behavior. Application readers use the build/start and browser flow above, without a repository-internal consumer command.

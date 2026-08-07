# Unreleased

## Added

- Added same-route page-envelope negotiation and the generated browser navigation runtime. `vextjs/frontend` now exports `Link`, `Form`, `navigate`, `prefetch`, `revalidate`, `useNavigation`, `useFetcher`, and `useRouteData`, with persistent common layouts, last-known-good revalidation, history/scroll/focus recovery, and fail-safe document navigation.
- Added route-side frontend freshness through `RouteOptions.frontend`: dynamic, static, revalidate, `staticParams`, `clientOnly`, invalidation tags, bounded static output, filesystem single-flight, atomic replace, and last-known-good recovery.
- Added the local frontend media pipeline. `config.frontend.media`, `Image`, `defineFont`, and `defineImageLoader` generate and consume local responsive image variants and WOFF2 subsets, keep media in deploy/SRI closure, and reject implicit remote fetching.

## Compatibility

- Existing document routes, `res.render()`, middleware/security/validation/cache/timeout/error chains, and no-JavaScript forms remain authoritative. The page envelope is internal and does not introduce a loader/action DSL, Server Functions, RSC, PPR, or a new bundler plugin ecosystem; frontend builds continue to use esbuild.
- The media pipeline uses direct `sharp@0.35.3` and `subset-font@2.5.0` build-time dependencies only. It does not add a bundler plugin, cloud-provider SDK, remote image proxy, or remote font downloader.

Historical notes for the schema-dsl v3 / monsqlize 3.1 adaptation and close-out fixes shipped in `changelogs/v1.0.0.md`.

# Boundaries and Roadmap

This page separates current frontend targets from future capability tracks.

## Current Target

The current Vext frontend direction is:

- `src/frontend/**` as the user frontend source root
- `src/routes/**` as URL and server data entry
- `res.render(page, props?, options?)`
- React 19 SSR plus hydration
- nested layout chain
- default error pages and `renderError()`
- Vext JSCSS plus CSS/CSS Modules
- frontend i18n with `useVextI18n(locale?)`
- Fast Refresh and render refresh in development
- esbuild-powered production build
- route assets, code splitting, size reports, budgets, deploy manifest, SRI, and incremental static upload

## Version Boundary

This section documents the current frontend capability in the Vext documentation set. For an installed package version, use that version's release notes and changelog to check exactly which frontend features are available.

## API-only Projects

API-only projects remain first-class:

```bash
npx vextjs create my-api --template api --frontend none
```

Or disable frontend in config:

```ts
export default {
  frontend: false,
};
```

## External Frontend Adapters

Vext can expose contracts for external frontend frameworks through `vextjs/frontend`, generated API artifacts, and stable HTTP boundaries. The default integrated experience remains Vext-owned full-stack React.

## Future Tracks

These are not first-phase commitments, but can be evaluated later:

- React Server Components
- Server Actions
- streaming SSR
- persistent client layout navigation
- built-in image/font optimization components
- deeper external framework adapters

Each track needs separate requirements, performance evidence, and compatibility review before becoming default behavior.

## Current Non-goals

- hiding server imports in browser bundles
- making page files create routes automatically
- treating global SPA fallback as the default
- uploading SSR HTML as a static asset by default
- adding cloud-provider SDKs to core for asset upload

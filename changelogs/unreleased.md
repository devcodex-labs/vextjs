# Unreleased

## 2026-06-23

- **Config profile selection** Added `--config <name>` and `VEXT_CONFIG=<name>` as the official way to select `src/config/{profile}.ts` for `vext start`, `vext dev`, `vext build`, and `vext deploy assets`; `vext start` now forces production runtime `NODE_ENV` while keeping legacy custom `NODE_ENV` profile fallback with a migration warning.
- **Frontend documentation** Added the dedicated frontend documentation space with frontend-only navigation and updated the overview/status wording to describe current built-in frontend capabilities instead of an in-development target.

## 2026-06-22

- **React hydration performance** Added the B3 React hydration optimization path: frontend i18n now defaults to current-locale browser loading, route initial assets drive SSR `modulepreload`, size reports include raw/gzip/brotli and app-owned/external groups, compressed build budgets can fail CI, React external runtime mappings fail fast when incomplete, and `vext-test` includes a real-browser frontend performance probe.
- **Frontend enterprise build and deploy** Added page-level browser chunking, browser external import-map support, Vext-managed vendor chunks, deploy manifest generation, SRI injection, build budgets, asset inline/CSS Modules handling, filesystem/mock static asset upload adapters, `vext deploy assets`, `vext build --upload-assets`, and `vext-test` frontend deploy validation.

## 2026-06-18

- **Frontend dev events** Fixed `vext dev` startup and soft reload so the `/__vext/dev/events` SSE endpoint is registered as an internal route, preventing browser-side frontend dev runtime requests from falling through to JSON 404.

## 2026-06-17

- **Full-stack frontend rendering** Added the B1 React 19 page rendering path for Vext routes: `res.render()` / `res.renderError()`, `src/frontend/pages/**`, layout chain, default error pages, frontend i18n, Vext JSCSS via `vextjs/style`, scoped `spaFallback.scopes[]`, esbuild browser/server renderer output, React Fast Refresh dev events, render cache reuse, and the updated full-stack create template.
- **Dependency audit** Upgraded the test toolchain to `vitest@4.1.9` and `@vitest/coverage-v8@4.1.9`, clearing the transitive `vite -> esbuild@0.27.x` audit finding while keeping Vext's frontend build path on direct `esbuild@0.28.1`.

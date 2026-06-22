# Unreleased

## 2026-06-22

- **Frontend enterprise build and deploy** Added page-level browser chunking, browser external import-map support, Vext-managed vendor chunks, deploy manifest generation, SRI injection, build budgets, asset inline/CSS Modules handling, filesystem/mock static asset upload adapters, `vext deploy assets`, `vext build --upload-assets`, and `vext-test` frontend deploy validation.

## 2026-06-18

- **Frontend dev events** Fixed `vext dev` startup and soft reload so the `/__vext/dev/events` SSE endpoint is registered as an internal route, preventing browser-side frontend dev runtime requests from falling through to JSON 404.

## 2026-06-17

- **Full-stack frontend rendering** Added the B1 React 19 page rendering path for Vext routes: `res.render()` / `res.renderError()`, `src/frontend/pages/**`, layout chain, default error pages, frontend i18n, Vext JSCSS via `vextjs/style`, scoped `spaFallback.scopes[]`, esbuild browser/server renderer output, React Fast Refresh dev events, render cache reuse, and the updated full-stack create template.
- **Dependency audit** Upgraded the test toolchain to `vitest@4.1.9` and `@vitest/coverage-v8@4.1.9`, clearing the transitive `vite -> esbuild@0.27.x` audit finding while keeping Vext's frontend build path on direct `esbuild@0.28.1`.

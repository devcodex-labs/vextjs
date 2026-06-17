# Unreleased

## 2026-06-17

- **Full-stack frontend rendering** Added the B1 React 19 page rendering path for Vext routes: `res.render()` / `res.renderError()`, `src/frontend/pages/**`, layout chain, default error pages, frontend i18n, Vext JSCSS via `vextjs/style`, scoped `spaFallback.scopes[]`, esbuild browser/server renderer output, React Fast Refresh dev events, render cache reuse, and the updated full-stack create template.
- **Dependency audit** Upgraded the test toolchain to `vitest@4.1.9` and `@vitest/coverage-v8@4.1.9`, clearing the transitive `vite -> esbuild@0.27.x` audit finding while keeping Vext's frontend build path on direct `esbuild@0.28.1`.

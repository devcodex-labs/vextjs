# Dev Workflow

## Table of Contents

- [`vext dev`](#vext-dev)
- [Frontend Rebuild](#frontend-rebuild)
- [React Fast Refresh](#react-fast-refresh)
- [CSS Updates](#css-updates)
- [Render Refresh](#render-refresh)
- [Leak Scan Diagnostics](#leak-scan-diagnostics)
- [When a Full Reload Happens](#when-a-full-reload-happens)

## `vext dev`

In an application that completed [Full-Stack Quick Start](./getting-started) with `frontend.enabled`, `vext dev` starts the backend runtime and frontend development pipeline. Frontend output defaults to `.vext/client/`; use the configured directory when outDir is customized. Run this command in the application root. The framework source repository's npm script with the same name has a different purpose.

```bash
npm run dev
```

In dev mode Vext watches:

- `src/frontend/**`
- `public/**`
- route and service files that affect render data
- config files that affect frontend settings

## Frontend Rebuild

Frontend-only changes rebuild the browser output without restarting the backend process.

| Change                    | Expected action                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| page/component/layout     | frontend rebuild                                                                                       |
| `.module.css`             | frontend rebuild / CSS update                                                                          |
| JSCSS style file          | JSCSS extraction + CSS update                                                                          |
| `public/**`               | copy + frontend rebuild                                                                                |
| `src/frontend/locales/**` | frontend rebuild; whether an open page receives new data also depends on navigation or another request |

These rules apply to default directories; custom locations follow the resolved project configuration. Backend source such as `src/routes/**` and `src/services/**` uses soft reload, while initialization files such as configuration and plugins use cold restart. Server `src/locales/**` also differs from frontend locales. See [Hot Reload](/guide/hot-reload) for the complete classification.

## React Fast Refresh

React pages, layouts, and shared components use Fast Refresh when the module is refresh-safe.

Fast Refresh can fall back to a full browser reload when:

- module shape or export changes prevent React from retaining state
- the file changes document/runtime-critical behavior
- a new entry fails to load or the refresh runtime fails
- React cannot preserve component state safely

## CSS Updates

CSS-only updates should not restart the backend. Vext updates stylesheet links or rebuilds CSS assets depending on the source file type.

Use CSS Modules or JSCSS for component-local styles; use global CSS for base styles and tokens.

Vext takes the direct style-event path only when every file in the change consists of `.css`, `.pcss`, or `.postcss`. A TypeScript JSCSS change rebuilds and updates CSS but may also trigger Fast Refresh or a full reload. Do not promise a stylesheet-only replacement for it.

## Render Refresh

When backend route/service code changes data used by `res.render()`, Vext can notify the browser after backend soft reload.

```ts
export default {
  frontend: {
    enabled: true,
    dev: {
      renderRefresh: "prompt",
    },
  },
};
```

| Value      | Behavior                                                                            |
| ---------- | ----------------------------------------------------------------------------------- |
| `"prompt"` | Default overlay shows a refresh prompt; with overlay disabled, browser console does |
| `"auto"`   | Refresh automatically                                                               |
| `"off"`    | Do not publish a render-reload event or notify the browser proactively              |

Use `"prompt"` for admin or form-heavy pages where automatic reload might interrupt work.

## Leak Scan Diagnostics

`frontend.build.diagnostics.leakScan` is enabled by default. It blocks browser bundles from importing server-only modules.

Example mistake:

```tsx
import { db } from "../../services/db";
```

This import snippet illustrates a mistake. A Leak Scan hit fails the build; a full reload does not recover it. Move the service call back into `src/routes/**` and pass data through `res.render()`. See [Diagnostics and Leak Scan](./diagnostics-and-leak-scan) for coverage and limits.

## When a Full Reload Happens

A full browser reload is normal when Vext cannot safely preserve state.

Common triggers:

- a non-CSS rebuild with `hot: true` and `fastRefresh` disabled
- a new entry import or refresh execution fails
- route/service code changes render data and `renderRefresh="auto"`

After `_document.html` or a configuration boundary changes, perform a full refresh deliberately to inspect the new document and runtime. A component update cannot replace the whole HTML document; configuration may also cold-restart the backend. `hot: false` removes browser SSE/Refresh integration and requires manual refresh, rather than causing an automatic full reload every time.

If every component change causes full reload, check `frontend.dev.hot`, `frontend.dev.fastRefresh`, and whether the component imports server-only code. Set `frontend.dev.overlay: false` to keep SSE refresh behavior while suppressing browser overlay prompts.

## Verify One Change

Open a page with default hydration. Confirm Console has no errors and the `/__vext/dev/events` SSE connection works. Change visible component text and observe frontend rebuild and page update. For a CSS-only change, inspect the style update while the backend process stays running. Then change props supplied by a route and, after soft reload, manually refresh when prompted to confirm new data. Fix compilation errors before proceeding; an old page still displaying does not prove the new build succeeded.

A `hydration: "none"` page has no browser runtime to consume refresh notifications and must be refreshed manually. State retention is conditional and cannot replace output verification. Stop the development service afterward.

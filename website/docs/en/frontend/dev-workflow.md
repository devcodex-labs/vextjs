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

`vext dev` starts the backend runtime and the frontend development pipeline. Frontend output is written to `.vext/client/`.

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

| Change                | Expected action                            |
| --------------------- | ------------------------------------------ |
| page/component/layout | frontend rebuild                           |
| `.module.css`         | frontend rebuild / CSS update              |
| JSCSS style file      | JSCSS extraction + CSS update              |
| `public/**`           | copy + frontend rebuild                    |
| locale file           | registry rebuild and hydration data update |

## React Fast Refresh

React pages, layouts, and shared components use Fast Refresh when the module is refresh-safe.

Fast Refresh can fall back to a full browser reload when:

- the module exports non-component values used outside the React tree
- the file changes document/runtime-critical behavior
- the change crosses the server/client boundary
- React cannot preserve component state safely

## CSS Updates

CSS-only updates should not restart the backend. Vext updates stylesheet links or rebuilds CSS assets depending on the source file type.

Use CSS Modules or JSCSS for component-local styles; use global CSS for base styles and tokens.

## Render Refresh

When backend route/service code changes data used by `res.render()`, Vext can notify the browser after backend soft reload.

```ts
frontend: {
  dev: {
    renderRefresh: "prompt",
  },
}
```

| Value      | Behavior                         |
| ---------- | -------------------------------- |
| `"prompt"` | show a browser prompt to refresh |
| `"auto"`   | reload automatically             |
| `"off"`    | only log/record the event        |

Use `"prompt"` for admin or form-heavy pages where automatic reload might interrupt work.

## Leak Scan Diagnostics

`frontend.build.diagnostics.leakScan` is enabled by default. It blocks browser bundles from importing server-only modules.

Example mistake:

```tsx
import { db } from "../../services/db";
```

The friendly diagnostic should explain that the import crosses the physical boundary and suggest moving the service call back into `src/routes/**`, then passing data through `res.render()`.

## When a Full Reload Happens

A full browser reload is normal when Vext cannot safely preserve state.

Common triggers:

- `_document.html` changes
- generated entry shape changes
- route/service code changes render data and `renderRefresh="auto"`
- Fast Refresh rejects a module
- config changes rebuild frontend runtime boundaries

If every component change causes full reload, check `frontend.dev.hot`, `frontend.dev.fastRefresh`, and whether the component imports server-only code. Set `frontend.dev.overlay: false` to keep SSE refresh behavior while suppressing browser overlay prompts.

# Diagnostics and Leak Scan

Leak Scan protects the browser bundle from accidentally importing server-only modules.

## Default Behavior

```ts
export default {
  frontend: {
    build: {
      diagnostics: {
        leakScan: true,
      },
    },
  },
};
```

When enabled, Vext checks the frontend import graph before emitting browser output.

## Blocked Imports

Common blocked imports include:

- `src/routes/**`
- `src/services/**`
- `src/config/**`
- database clients
- Node built-ins such as `node:fs`
- files named `*.server.*`

## Friendly Error Shape

If a page imports a service directly:

```tsx
import { db } from "../../services/db";
```

Vext should report:

```text
VEXT_FRONTEND_BOUNDARY
Browser bundle imported a server-only module.
Importer: src/frontend/pages/dashboard.tsx
Import: ../../services/db
Resolved: src/services/db.ts
Reason: src/services/** belongs to the server graph.
Fix: call the service in src/routes/** and pass data with res.render().
```

The goal is to teach the physical boundary, not to expose a low-level bundler stack trace as the only clue.

## Fix Patterns

| Problem                      | Fix                                                  |
| ---------------------------- | ---------------------------------------------------- |
| Page imports a service       | Move call to route handler and pass props.           |
| Component imports config     | Pass public config via props or generated safe data. |
| Shared util imports `node:*` | Split into `*.server.ts` and browser-safe util.      |
| API helper returns HTML      | Check `Accept` header and SPA fallback scope.        |

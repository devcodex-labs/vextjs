# Diagnostics and Leak Scan

Leak Scan checks recognized server-side paths during a frontend build to prevent accidental imports into the browser bundle. Use this page to diagnose build failures in an app with frontend enabled. This is not a complete analyzer of arbitrary third-party packages, dynamic code, or sensitive content.

## Default Behavior

```ts
export default {
  frontend: {
    enabled: true,
    build: {
      diagnostics: {
        leakScan: true,
      },
    },
  },
};
```

`leakScan` is enabled by default. The builder checks recognized imports through a source precheck, an esbuild resolution plugin, and the build input metafile. A hit fails the build. Fix the dependency direction and rebuild; disabling the check does not make server code safe to run in a browser.

## Blocked Imports

Common blocked imports include:

- `src/routes/**`
- `src/services/**`
- `src/config/**`
- Node built-ins such as `node:fs`
- files named `*.server.*`

The server-directory check currently recognizes the three default paths above. It does not imply that custom directories or every backend path are recognized. There is no universal blacklist of database-client package names: detection depends on the imported path, Node dependencies, and bundler behavior. A passing scan also does not prove the whole bundle is free of server logic; review its browser dependencies and output.

## Friendly Error Shape

If a page directly imports an existing service, this fragment can reproduce the error. The use of `db` matters: an unused import may be removed by a tool.

```tsx
// src/frontend/pages/dashboard.tsx
import { db } from "../../services/db";
export default function DashboardPage() {
  return <pre>{JSON.stringify(db)}</pre>;
}
```

The core of the current error looks like this; paths and importer vary by project:

```text
[vextjs] Frontend boundary leak: browser bundle imported "src/services/db" (server-only directory src/services/**).
You crossed the frontend/backend physical boundary: browser entries, pages, and shared components cannot directly import src/routes/**, src/services/**, src/config/**, node:*, or *.server.*.
Read server data in a route handler / service call chain, then pass it to the page through res.render(page, props, options).
Importer: src/frontend/pages/dashboard.tsx
```

The message explains the physical boundary instead of showing only a low-level bundler error. It is not a public `VEXT_FRONTEND_BOUNDARY` error-code contract; integrations must not rely on that nonexistent code.

## Fix Patterns

| Problem                      | Fix                                                  |
| ---------------------------- | ---------------------------------------------------- |
| Page imports a service       | Move call to route handler and pass props.           |
| Component imports config     | Pass public config via props or generated safe data. |
| Shared util imports `node:*` | Split into `*.server.ts` and browser-safe util.      |
| API helper returns HTML      | Check `Accept` header and SPA fallback scope.        |

The final row diagnoses a runtime response, unlike the build-time Leak Scan. Check the actual API URL and response status too.

## Verify the Fix

Run `npm run build` in the app root. A boundary hit should fail and point to the actual file or importer. Move the service call into a route and pass JSON-serializable results to the page; see the complete [Data Flow](./data-flow) example. The next build should succeed. Visit the page and check its content and Console; merely deleting the error line is insufficient. An old page may remain visible during development, so also check the latest successful rebuild record.

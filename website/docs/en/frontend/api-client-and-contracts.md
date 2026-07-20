# API Client and Contracts

Vext pages do not need a generated API client for first-screen data. Use route handlers and `res.render()` for that.

## Primary Data Path

```text
route handler -> app.services -> res.render(page, props)
```

This path keeps service calls server-side and produces SSR HTML with hydration data.

## Generated Artifacts

When `frontend.apiClient` is enabled, Vext can emit:

```text
client-contract.json
api.generated.ts
```

These artifacts are useful for:

- external frontend adapters
- type probes
- client-side API calls after hydration
- documentation or tooling

## Contract Stability and Schemas

`client-contract.json` and `api.generated.ts` are deterministic for identical route manifests. The `generatedAt` field is a stable marker so generated artifacts can be compared in CI.

Contract schema references are currently emitted as `unknown` because the route manifest does not carry route validation or response schema metadata yet. Use the contract for route method, path, operation id, summary, and tags until schema metadata is added to the manifest.

## Public Entry

The frontend public entry exposes contract helpers:

```ts
import { createVextApiClient } from "vextjs/frontend";
```

Use them when you need a typed client boundary. Do not add them to simple pages just to read first-screen data.

## Plain Fetch Is Fine

For small client interactions after hydration:

```ts
await fetch("/api/preferences", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
```

Make sure client requests send the right `Accept` header so API calls are not treated as HTML navigation inside a SPA fallback scope.

## Boundary Rule

Generated client artifacts describe HTTP contracts. They do not make `src/services/**` browser-safe. Service modules remain server-only.

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
route-contract.json
api.generated.ts
```

These artifacts are useful for:

- external frontend adapters
- type probes
- client-side API calls after hydration
- documentation or tooling

## Contract Stability and Schemas

`client-contract.json` and `api.generated.ts` are deterministic for identical route manifests. The `generatedAt` field is a stable marker so generated artifacts can be compared in CI.

The runtime route manifest projects the existing `RouteOptions.validate` fields (`param`, `query`, `header`, `cookie`, and `body`) and canonical `RouteOptions.responses.<selector>.schema` into `VextSchemaIRV1`. The same closed response schema drives compiled wire serialization, OpenAPI, and static build indexing. `api.generated.ts` turns supported JSON-schema primitives, objects, arrays, enums, optional fields, and nullable fields into request and successful-response TypeScript types. Documentation-only `docs.responses.<selector>.schema` remains a compatibility fallback and does not enable runtime projection.

A missing runtime or documented response schema remains `unknown` and includes a diagnostic with the HTTP method, route path, source file when available, and stable route ID; Vext never guesses a response type. Exact status selectors take precedence over status families (`2xx`), followed by `default`; generated success types include exact and family 2xx contracts. HTML page routes rendered with `res.render()` are classified as frontend documents, so they do not produce an API-response-schema warning. `$ref` values are retained in the contract but currently emit `unknown` in generated TypeScript until a component-reference resolver is available. Cookie schemas are contract metadata only: browser fetch controls cookie transport and the generated client does not offer a writable `Cookie` header.

## Public Entry

The frontend public entry exposes contract helpers:

```ts
import { createVextApiClient } from "vextjs/frontend";
```

Use them when you need a typed client boundary. Do not add them to simple pages just to read first-screen data.

## Advanced Frontend Integrations

`vextjs/frontend` also exposes a small set of advanced integration APIs. They are for adapters, custom tooling, or bespoke browser bootstraps—not the default path for application pages.

- `defineFrontendAdapter()` is an identity helper for an implementation of `VextFrontendAdapter`.
- `VextBrowserRuntime` and `configureVextBrowserRuntime()` power Vext's generated browser entry. Regular applications should use the generated entry plus `Link`, `Form`, and navigation hooks instead of manually creating a runtime. A custom bootstrap must own one browser runtime for its environment.

For programmatic asset upload, see [Build and Deploy](./build-and-deploy#programmatic-upload-integration).

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

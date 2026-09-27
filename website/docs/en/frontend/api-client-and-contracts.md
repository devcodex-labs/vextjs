# API Client and Contracts

Vext pages do not need a generated API client for first-screen data. Use route handlers and `res.render()` for that.

## Primary Data Path

```text
route handler -> app.services -> res.render(page, props)
```

This path keeps service calls server-side and produces SSR HTML with hydration data.

## Generated Artifacts

In an existing [full-stack project](./getting-started) with `frontend.enabled`, `frontend.apiClient` is enabled by default. Set it explicitly to `false` to disable client contract output. Run `npm run build`; these files are written to `frontend.outDir` (`dist/client` in production and `.vext/client` in development by default):

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

These are build contract files. They are not automatically served as public static files and do not create a new server route. `api.generated.ts` exports `contract`, `VextGeneratedRouteTypes`, and `api`. Generate it before compiling a consumer; regenerate it after changing routes or schemas to avoid an obsolete contract.

### From a Route to a Client Call

Add this complete route to the existing project. `responses` describes the business `data` returned by `res.json()`; the framework handles the common response envelope:

```ts
// src/routes/api/greeting.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: { query: { name: "string:1-40?" } },
      responses: {
        200: {
          schema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
            additionalProperties: false,
          },
        },
      },
    },
    (req, res) => {
      const { name } = req.valid("query");
      res.json({ message: `Hello, ${name ?? "Vext"}!` });
    },
  );
});
```

After `npm run build`, create an independent consumer named `client-probe.ts` in the project root. This is a Node-side contract call example. Do not import the generated build output back into the current application's `src/frontend`; that would make source depend on its own build output. An external frontend project should include generated files in its own generation or synchronization step.

```ts
// client-probe.ts (project root; build first)
import { createVextApiClient, isVextApiError } from "vextjs/frontend";
import {
  contract,
  type VextGeneratedRouteTypes,
} from "./dist/client/api.generated.js";

const api = createVextApiClient<typeof contract, VextGeneratedRouteTypes>(
  contract,
  {
    baseUrl: "http://127.0.0.1:3000",
    headers: { Accept: "application/json" },
  },
);

try {
  const result = await api.GET("/api/greeting", { query: { name: "Vext" } });
  console.log(result.message);
} catch (error) {
  if (isVextApiError(error)) console.error(error.status, error.message);
  else throw error;
}
```

Run `npm start -- --port 3000`. In another terminal, compile and run the consumer with the template's TypeScript compiler:

```bash
npx tsc client-probe.ts --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck
node client-probe.js
```

Expect `Hello, Vext!`. Change `name` to 41 characters and recompile; it should enter the HTTP 422 validation-error branch. Stop the service when finished. Node requires an absolute `baseUrl`; a browser can use a same-origin relative URL. Adjust the generated import path if the production outDir has been overridden. The independent compile emits JS for the probe and imported generated module in their original directories; these are not new public resource entry points.

## Contract Stability and Schemas

`client-contract.json` and `api.generated.ts` are deterministic for identical route manifests. The `generatedAt` field is a stable marker so generated artifacts can be compared in CI.

The runtime route manifest projects the existing `RouteOptions.validate` fields (`param`, `query`, `header`, `cookie`, and `body`) and canonical `RouteOptions.responses.<selector>.schema` into `VextSchemaIRV1`. The same closed response schema drives compiled wire serialization, OpenAPI, and static build indexing. `api.generated.ts` turns supported JSON-schema primitives, objects, arrays, enums, optional fields, and nullable fields into request and successful-response TypeScript types. Documentation-only `docs.responses.<selector>.schema` remains a compatibility fallback and does not enable runtime projection.

A missing runtime or documented response schema remains `unknown` and includes a diagnostic with the HTTP method, route path, source file when available, and stable route ID; Vext never guesses a response type. Exact status selectors take precedence over status families (`2xx`), followed by `default`; generated success types include all schema-backed 2xx contracts as a union. No-body success responses such as `204` do not downgrade another schema-backed success response to `unknown`. HTML page routes rendered with `res.render()` are classified as frontend documents, so they do not produce an API-response-schema warning. `$ref` values are retained in the contract but currently emit `unknown` in generated TypeScript until a component-reference resolver is available. Cookie schemas are contract metadata only: browser fetch controls cookie transport and the generated client does not offer a writable `Cookie` header.

## Public Entry

The frontend public entry exposes contract helpers:

```ts
import { createVextApiClient } from "vextjs/frontend";
```

Use them when you need a typed client boundary. Do not add them to simple pages just to read first-screen data.

Methods are `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`, or `request(method, path, options)`. Request options include `params`, `query`, `body`, `headers`, and `signal`. Array query values repeat the key; null and undefined are skipped. Path parameters are encoded, but callers must supply required params. The helper performs no schema validation, and generated types are not a runtime validator.

### Returns and Errors

For ordinary successful JSON containing `code: 0` and `data`, the helper returns `data`; other JSON or text is returned according to the response. Non-2xx responses throw `VextApiError`, with `status`, `code`, `details`, `rawBody`, and the original `response`. Identify it with `isVextApiError()`; network and JSON parse errors remain their original errors.

Generated `HEAD()` and `request("HEAD", ...)` calls return `null` and are typed as `Promise<null>`. Responses with status 204/205 return `null`; 304 remains an HTTP error instead of a parse error from an absent JSON body. An ordinary empty body marked application/json or malformed JSON still raises a parse error. Other generated success types may not express a bodyless status, so handle an actual null when an API has multiple success statuses.

## Advanced Frontend Integrations

`vextjs/frontend` also exposes a small set of advanced integration APIs. They are for adapters, custom tooling, or bespoke browser bootstraps—not the default path for application pages.

- `defineFrontendAdapter()` is an identity helper for an implementation of `VextFrontendAdapter`; it does not install or start an adapter. Current configuration resolution still uses built-in React. Declaring an adapter alone does not mean another frontend framework is integrated. See [External Frontend Adapters](./boundaries-and-roadmap#external-frontend-adapters).
- `VextBrowserRuntime` and `configureVextBrowserRuntime()` power Vext's generated browser entry. Regular applications should use the generated entry plus `Link`, `Form`, and navigation hooks instead of manually creating a runtime. A custom bootstrap must own one browser runtime for its environment.

For programmatic asset upload, see [Build and Deploy](./build-and-deploy#programmatic-upload-integration).

## Plain Fetch Is Fine

The route above also works with plain fetch. This snippet runs in an event handler after hydration and needs no generated API client:

```ts
const response = await fetch("/api/greeting?name=Vext", {
  headers: { Accept: "application/json" },
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const envelope = await response.json();
console.log(envelope.data.message);
```

Plain fetch does not unwrap the response automatically. The helper also does not set Accept by default; send `application/json` explicitly, as above, so an unmatched API call inside a SPA fallback scope is not treated as HTML navigation. Configure authentication, cross-origin credentials, and retries as your application requires. Generated types do not imply those behaviors exist.

## Boundary Rule

Generated client artifacts describe HTTP contracts. They do not make `src/services/**` browser-safe. Service modules remain server-only.

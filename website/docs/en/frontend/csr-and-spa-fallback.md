# CSR and SPA Fallback

The default Vext page model is SSR plus hydration. CSR fallback is scoped and explicit.

## When to Use CSR

Use a client-router sub-app when a route range behaves like a browser application after the first shell:

- admin workbench
- editor or dashboard tools
- embedded product console
- complex client-side navigation under one path prefix

Keep ordinary content pages on SSR.

## Configure a Scope

```ts
export default {
  frontend: {
    spaFallback: {
      scopes: [
        {
          basePath: "/app",
          page: "app/shell",
          ssr: false,
          exclude: ["/app/api/**"],
        },
      ],
    },
  },
};
```

`scopes[]` defaults to an empty array. Nothing falls back unless you opt in.

When `ssr: false`, Vext returns the configured page as a client shell: the document, assets, and hydration payload are present, but the server-rendered page body is empty. Set `ssr: true` when the fallback shell should include server-rendered HTML.

## Request Matching

Fallback only applies when all of these are true:

- request path is inside a configured scope
- no explicit API or route handled the request
- no static asset matched
- the request accepts HTML
- the scope exclude list does not match

JSON and API requests should keep normal 404/error behavior.

## Mixed SSR and CSR

A project can use both:

```text
/             -> SSR page
/pricing      -> SSR page
/admin        -> SSR entry
/admin/app/*  -> scoped CSR shell
/api/**       -> API routes
```

The important rule is that each client-router area has a deliberate base path and shell page.

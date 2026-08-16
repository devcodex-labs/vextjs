# Build and Deploy

`vext build` compiles server output and frontend output in one command. This
page is the production delivery recipe; use [Frontend Configuration](./configuration)
for the field-by-field reference and [Static Assets and CDN](./static-assets-and-cdn)
for cache and media behavior.

## Output

When frontend is enabled, production output includes:

```text
dist/
  config/ routes/ services/ ...     # server files follow the source layout
  client/
    index.html
    assets/                         # browser JS, CSS, and imported files
    manifest.json
    render-manifest.json
    server/renderer.cjs             # default; configurable with build.server.outFile
    deploy-manifest.json
    messages-manifest.json
    media-manifest.json
    static-manifest.json
    size-report.json                # when build.diagnostics.sizeReport is enabled
    client-contract.json            # when apiClient is enabled (the default)
    route-contract.json             # when apiClient is enabled (the default)
    api.generated.ts                # when apiClient is enabled (the default)
```

Only `dist/client/` is a fixed frontend boundary. The backend compiler keeps
the application source layout under `dist/`; it does **not** create a fixed
top-level `dist/server/` directory. The SSR renderer lives under the frontend
output by default, so it can be described by `render-manifest.json` and be
validated with the client assets as one closure.

`messages-manifest.json`, `media-manifest.json`, and `static-manifest.json`
may be empty when the corresponding feature has no declared input. They are
still useful build evidence. `size-report.json` is deliberately omitted when
`frontend.build.diagnostics.sizeReport` is disabled. Source maps are also
configuration-dependent: browser production builds default to no source maps,
while the backend CLI compiler defaults to external source maps.

`vext start` serves the built client assets and uses `render-manifest.json` for
SSR. In production, startup fails before listening when `index.html`,
`render-manifest.json`, route asset metadata, or the referenced server renderer
is missing or invalid; run `vext build` again to regenerate the complete
closure.

## Choose a Delivery Shape

| Need                                  | Default / configuration                 | What changes                                                                    | Verify                                                             |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| One Node service owns HTML and assets | No `assetBaseUrl`                       | `vext start` serves `dist/client/**` from the same origin                       | Load a page and a hashed asset from the application origin         |
| A CDN owns immutable assets           | Absolute `frontend.deploy.assetBaseUrl` | Generated JS/CSS URLs point at the CDN; HTML and SSR remain on the Node runtime | Inspect generated HTML, then request the asset through the CDN URL |
| Incremental asset upload              | `frontend.deploy.upload.enabled: true`  | `deploy-manifest.json` drives content-hash-aware upload                         | Run the dry run before the real upload                             |

The default is intentionally the first row: a working full-stack service does
not require a CDN or an upload adapter.

## Build, Then Start

```bash
vext build
vext start
```

This is the complete same-origin production path. The build creates backend
JavaScript plus the frontend closure; the start command validates the closure
before it accepts traffic.

To upload static assets after build:

```bash
vext build --upload-assets
```

Or run upload separately:

```bash
vext deploy assets --dry-run
vext deploy assets
```

`vext deploy assets` accepts options only and rejects extra positional arguments. Options that require values must receive non-option values; for example, `--manifest --dry-run` and `--target-dir --dry-run` fail instead of treating the next flag as a path.

## Programmatic Upload Integration

Use `vext deploy assets` for ordinary deployments. Tooling that owns its own release orchestration can import `deployFrontendAssets` from `vextjs/frontend`; it uses the same deploy manifest and upload plan as the CLI, and requires a resolved frontend configuration plus the manifest path. Pass a custom upload adapter only when your tooling owns that cloud-provider integration.

## CDN and Incremental Upload

`deploy-manifest.json` records static assets that can be uploaded:

- JS and CSS assets
- imported images/fonts/media
- copied `public/**` files
- content type
- sha256
- SRI for eligible assets
- upload key and public URL

HTML is not uploaded by default because SSR still belongs to the server runtime.
Source maps are also excluded by default; keep them on the diagnostic path
unless a separate, deliberate source-map publication policy requires them.

## Safe Release Sequence

1. Set an absolute `frontend.deploy.assetBaseUrl` only when a CDN will serve
   the generated browser assets.
2. Keep `frontend.deploy.upload.stateFile` outside `frontend.outDir`; build
   cleanup must never erase the upload history.
3. Build once: `vext build`.
4. Review the exact upload set: `vext deploy assets --dry-run`.
5. Upload with `vext deploy assets`, then deploy the matching `dist/` Node
   runtime. Do not mix a new CDN manifest with an older server renderer.
6. Request an SSR page and one hashed asset. Confirm that generated asset URLs,
   cache headers, and (when configured) SRI are from the same release.

The built-in adapters are `filesystem` and `mock`. `filesystem` is useful for
staging a deploy tree; it is not a hidden CDN integration. A cloud provider
needs an explicit custom upload adapter—Vext does not install or assume a
bundler or cloud-plugin ecosystem for this path.

## Incremental Upload

The upload state file stores known sha256 values. Unchanged assets are skipped, so images and fonts are not uploaded again on every release.

Keep `stateFile` outside the frontend outDir because build output is normally cleaned.

## Configuration Example

```ts
frontend: {
  deploy: {
    assetBaseUrl: "https://cdn.example.com/my-app/",
    integrity: true,
    upload: {
      enabled: true,
      adapter: "filesystem",
      targetDir: ".vext/frontend-cdn",
      publicBaseUrl: "https://cdn.example.com/my-app/",
      prefix: "my-app",
      stateFile: ".vext/deploy/frontend-assets-state.json",
      exclude: ["**/*.map"],
    },
  },
}
```

`assetBaseUrl` must be an absolute URL. `publicBaseUrl` is the public address
reported by the upload plan, whereas `targetDir` is only a local destination
used by the built-in filesystem adapter. Add `include`, `exclude`, and
`concurrency` only when the default whole-manifest upload is not appropriate.

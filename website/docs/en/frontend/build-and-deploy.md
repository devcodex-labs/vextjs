# Build and Deploy

`vext build` compiles server output and frontend output in one command. This
page is the production delivery recipe; use [Frontend Configuration](./configuration)
for the field-by-field reference and [Static Assets and CDN](./static-assets-and-cdn)
for cache and media behavior.

## Output

Generated sources and final frontend assets commit in one transaction. Browser and server compilation, media, static pages, SEO, deploy metadata, and budgets all consume the current candidates before replacing the previous generation. Failures preserve old files; unrecorded files remain private. A later build with project ownership recovers interrupted commits. Replacement is atomic per file, so consumers use the completed build result as the consistency boundary. Upload runs after a successful build; upload failures do not roll back committed local assets. See the [build workflow](../guide/build).

Static HTTP serving and deployment upload use `public-manifest.json`, generated from public files, browser outputs, media, static pages, and SEO artifacts. Server renderer outputs, their source maps, and internal metadata remain private, including when `build.server.outFile` is customized. Files manually added to outDir after a build are not automatically public. Rebuild older output to generate the required public manifest. Upload validates this boundary before applying include/exclude patterns or invoking an adapter.

When frontend is enabled, production output includes:

```text
dist/
  config/ routes/ services/ ...     # server files follow the source layout
  client/
    index.html
    assets/                         # browser JS, CSS, and imported files
    manifest.json
    public-manifest.json            # shared public file list for HTTP and upload
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

This is the default layout. `vext build --outdir build` writes the backend to `build/` and, unless `frontend.outDir` is explicit, the frontend to `build/client/`. `vext start` selects the same output through the successful build record, or an explicit `--outdir`. Backend output follows the source layout without a fixed top-level `dist/server/`. The SSR renderer lives under the selected frontend output and is validated with its manifest and client assets.

`messages-manifest.json`, `media-manifest.json`, and `static-manifest.json`
may be empty when the corresponding feature has no declared input. They are
still useful build evidence. `size-report.json` is deliberately omitted when
`frontend.build.diagnostics.sizeReport` is disabled. Source maps are also
configuration-dependent: browser production builds default to no source maps,
while the backend CLI compiler defaults to external source maps.

`vext start` serves the built client assets and uses `render-manifest.json` for
SSR. In production, startup fails before listening when `index.html`,
`render-manifest.json`, `public-manifest.json`, route asset metadata, or the referenced server renderer
is missing or invalid; run `vext build` again to regenerate the complete
closure.

## Choose a Delivery Shape

Successful build records bind the backend identity and profile to the frontend public manifest's `buildId` and byte digest. Both public and render manifests must belong to the same recorded producer generation before the build location becomes ready. Generated deploy manifests carry that frontend `buildId`; uploads validate the generation and each asset's bytes. A manually supplied manifest without `buildId` proves asset integrity only, not build identity.

An explicit `frontend.outDir` or backend `--outdir` may select a separate output outside the service. Metadata uses canonical absolute references for external outputs and relative references for ordinary outputs. Source, other-service and runtime-state overlaps are rejected, and artifact filename case is preserved. Rebuild after moving an external output. Production dependencies must resolve from the actual output directory under Node's rules; Vext does not embed the development machine's dependency paths.

| Need                                  | Default / configuration                 | What changes                                                                    | Verify                                                             |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| One Node service owns HTML and assets | No `assetBaseUrl`                       | `vext start` serves declared public files from the same origin                  | Load a page and a hashed asset from the application origin         |
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

Standalone upload uses the same successful build location as `vext start`, including its recorded profile. Select explicitly with `--outdir` or `--config`. The default manifest comes from the resolved `frontend.outDir`, without assuming `dist/client`. `--json` returns `{ ok: true, result }` on success and `{ ok: false, error, result? }` on failure. Failures after upload begins retain per-asset results.

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

Upload state uses `schemaVersion: 2` at the same default path, `.vext/deploy/frontend-assets-state.json`. Each target stores confirmed sha256 values and byte counts; unchanged assets are skipped only for that target. Target identity includes the canonical service root, profile, adapter type, storage identity, and prefix. Filesystem targets use their canonical path. Changing target or profile uploads again; changing the public URL alone does not identify a different storage destination.

Custom adapters may provide a stable `targetIdentity` string, such as an account and bucket identifier, without credentials. Without it, uploads still work but cannot skip assets across runs. Return `{ uploaded: true }` from `upload(input)` only after remote success is confirmed; adapters can consume `input.signal`. A false result or thrown error is reported as `unconfirmed`.

`mock` is a reserved simulation adapter name. Its separate state partition reports `simulated`, never real `uploaded` counts. A dry run does not call the adapter or write target/state files. Unknown state formats fail explicitly and retain the original file; Vext does not guess their target identity.

One writer owns a state file or known storage target at a time. Partial failures and cancellation still atomically save confirmed successes; pending assets are not recorded as successful. Retry processes unconfirmed assets again. Remote uploads have no whole-operation rollback guarantee. Programmatic callers can inspect `FrontendDeployError.result` for per-asset results. External state changes are preserved and reported as conflicts; use the result to reconcile remote contents.

Different prefixes in the same known storage namespace are serialized too, preventing parent/child prefix overlap. This coordinates local writers, not writers on different machines. State reads are bounded to 64 MiB; oversized or unverifiable files fail without replacing the original bytes. With `--json`, argument and execution failures both produce one JSON line and a nonzero exit code.

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

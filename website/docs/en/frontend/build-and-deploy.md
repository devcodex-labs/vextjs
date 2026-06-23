# Build and Deploy

`vext build` compiles server output and frontend output in one command.

## Output

When frontend is enabled, production output includes:

```text
dist/
  server/
  client/
    index.html
    manifest.json
    render-manifest.json
    deploy-manifest.json
    size-report.json
    assets/
```

`vext start` serves the built client assets and uses `render-manifest.json` for SSR.

## Build Command

```bash
vext build
```

To upload static assets after build:

```bash
vext build --upload-assets
```

Or run upload separately:

```bash
vext deploy assets --dry-run
vext deploy assets
```

## Deploy Manifest

`deploy-manifest.json` records static assets that can be uploaded:

- JS and CSS assets
- imported images/fonts/media
- copied `public/**` files
- content type
- sha256
- SRI for eligible assets
- upload key and public URL

HTML is not uploaded by default because SSR still belongs to the server runtime.

## Incremental Upload

The upload state file stores known sha256 values. Unchanged assets are skipped, so images and fonts are not uploaded again on every release.

Keep `stateFile` outside the frontend outDir because build output is normally cleaned.

## Configuration

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

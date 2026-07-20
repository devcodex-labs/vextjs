# Static Assets and CDN

Vext has two static asset locations with different behavior.

## Asset Locations

| Location                 | Behavior                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `src/frontend/assets/**` | Imported by TSX/CSS and processed through the frontend asset graph. |
| `public/**`              | Copied as public files and addressed by URL.                        |

Use imported assets when a component owns the image, font, or media file. Use `public/**` for files that need fixed URLs such as `favicon.svg`, `robots.txt`, or externally referenced files.

## Imported Assets

```tsx
import logoUrl from "@assets/logo.png";

export function Logo() {
  return <img src={logoUrl} alt="Logo" />;
}
```

Production builds use content-hashed output so browsers and CDNs can cache aggressively.

The frontend static mount sends `ETag` and `Last-Modified` validators. Conditional `If-None-Match` and `If-Modified-Since` requests can return `304` without an entity body.

## Public Files

```text
public/favicon.svg -> /favicon.svg
public/docs/openapi.json -> /docs/openapi.json
```

Public files are included in the deploy manifest so release tooling can upload them with the rest of the frontend assets.

## CDN URL

Set `frontend.deploy.assetBaseUrl` when production assets are served from a CDN:

```ts
frontend: {
  deploy: {
    assetBaseUrl: "https://cdn.example.com/my-app/",
  },
}
```

This changes generated asset URLs. Upload is controlled separately by `frontend.deploy.upload`, `vext build --upload-assets`, or `vext deploy assets`.

## Incremental Upload

`deploy-manifest.json` plus sha256 state lets Vext skip unchanged images, fonts, JS, CSS, and public files. This is the default path for enterprise releases where large media files should not be re-uploaded every build.

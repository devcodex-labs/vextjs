# Static Assets and CDN

Vext has two static asset locations with different behavior.

This assumes a [full-stack project](./getting-started) with frontend enabled and default directories. Verify assets locally on the same origin before choosing a CDN. Supply real example images and fonts in the application and replace example domains with deployment addresses.

## Asset Locations

HTTP static access and upload use `public-manifest.json`; the output directory is not a public file tree. Server renderer outputs, their source maps, and internal metadata remain private under custom paths as well. HEAD reads no file content and preserves the GET representation's length, ETag, Last-Modified, and Content-Type.

| Location                 | Behavior                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `src/frontend/assets/**` | Imported by TSX/CSS and processed through the frontend asset graph. |
| `public/**`              | Copied as public files and addressed by URL.                        |

Use imported assets when a component owns the image, font, or media file. Use `public/**` for files that need fixed URLs such as `favicon.svg`, `robots.txt`, or externally referenced files.

## Imported Assets

Image and font imports are supported in both browser and SSR builds. SSR reuses the browser artifact URL, including data URLs within `inlineLimit` and configured `publicPath` or CDN prefixes.

Add a real `src/frontend/assets/logo.png`, then import it directly into a page or component:

```tsx
import logoUrl from "@assets/logo.png";

export function Logo() {
  return <img src={logoUrl} alt="Logo" />;
}
```

Production builds use content-hashed output so browsers and CDNs can cache aggressively. Content-hashed bundle assets are served with long-lived immutable cache headers.

`@assets` resolves to the configured assets directory. Independent output for this asset assumes the default `build.assets.inlineLimit: 0`; after enabling inlining, a small file can become a data URL with no separate HTTP file. Node static serving chooses cache headers from the actual path. Configure the matching policy on a CDN yourself.

The frontend static mount sends `ETag` and `Last-Modified` validators. Conditional `If-None-Match` and `If-Modified-Since` requests can return `304` without an entity body.

Static request paths are canonicalized before filesystem access. Absolute or encoded traversal paths are rejected, and a symbolic link that resolves outside the configured static root is never served.

## Public Files

```text
public/favicon.svg -> /favicon.svg
public/docs/openapi.json -> /docs/openapi.json
```

After registration in the public inventory, Public files can enter the deploy manifest under upload include/exclude settings. The example `/docs/openapi.json` is a manually supplied static file, not automatically generated OpenAPI. Avoid colliding with an existing API or docs-service URL.

Public files keep stable URLs, so the runtime serves them with revalidation headers by default:

```http
Cache-Control: no-cache, max-age=0, must-revalidate
```

Use imported assets for files that should receive immutable long-cache headers after content hashing. Source maps and non-hashed files are also served with revalidation headers.

## CDN URL

Set `frontend.deploy.assetBaseUrl` when production assets are served from a CDN:

```ts
export default {
  frontend: {
    enabled: true,
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
    },
  },
};
```

This changes generated asset URLs. Upload is controlled separately by `frontend.deploy.upload`, `vext build --upload-assets`, or `vext deploy assets`.

Merge this into `src/config/default.ts` while preserving other settings. Changing URLs neither uploads assets nor configures the CDN. See [Build and Deploy](./build-and-deploy) for upload targets, dry-run, and same-version release order. Verify CORS and response types against the real CDN for cross-origin scripts, SRI, and fonts.

## Incremental Upload

`deploy-manifest.json` plus sha256 state lets Vext skip confirmed, unchanged images, fonts, JS, CSS, and public files when the same storage target is known. A custom adapter without a stable target identity cannot skip across runs. A dry-run only produces a plan; it neither uploads nor records success state.

The deploy manifest is treated as untrusted input. Every asset path must be normalized, relative, unique, and contained by the frontend output in both lexical and realpath terms. Absolute/traversal entries, escaping symbolic links, duplicate upload keys, or size/sha256 drift stop planning and upload before any asset is transferred.

The built-in `filesystem` adapter identifies its target by the physical `targetDir + prefix` directory. Within the same service and profile, a parent directory plus a prefix shares target state with a directly configured child directory. Local writes coordinate by physical directory: identical or ancestor-overlapping targets cannot upload concurrently, while independent directories can. Directory links are canonicalized. Custom adapters identify their storage namespace through a stable `targetIdentity`. Backend builds, frontend commits, and uploads are separate operations, not one cross-stage atomic transaction.

After a local state hit, the planner also verifies the destination's current size and SHA-256. Another service/profile overwriting or deleting a file cannot cause a false skip. Reads are bounded by the asset's expected size; unverifiable paths or inconsistent reads abort planning. This adds local reads without assuming an undeclared remote inspection API on custom adapters.

## Local Media Pipeline

`config.frontend.media` controls local image and font build settings and budgets. The image pipeline scans avif/jpeg/jpg/png/webp under `frontend.assetsDir` (`src/frontend/assets` by default), including matching files that no page imports. SVG/GIF are outside this variants pipeline and can be used as ordinary assets. Fonts are declared separately through static descriptors in frontend source. Generated images and fonts are public resources that participate in content hashes, SRI, and upload plans; `media-manifest.json` itself is internal metadata, not a public static upload.

```ts
export default {
  frontend: {
    enabled: true,
    media: {
      maxBytes: 20 * 1024 * 1024,
      images: {
        widths: [320, 640, 960, 1280, 1600],
        formats: ["original", "webp", "avif"],
        quality: 75,
        maxInputPixels: 40_000_000,
        maxVariants: 24,
      },
      fonts: {
        maxBytes: 5 * 1024 * 1024,
      },
    },
  },
};
```

These limits are enforced at build time. `media.maxBytes` bounds the generated image/font bytes, excluding the manifest written afterward. `images.maxVariants` applies to the width/format combinations for one image, and `fonts.maxBytes` to one output font. An unreadable input, excessive decoded pixels or variants, or an exceeded budget fails the build.

### Images

First add a real `src/frontend/assets/hero.png` and rebuild, then use `Image` with a source path relative to `frontend.root`. It looks up variants through media context (from document data in the browser) and emits dimensions, `srcSet`, and `sizes`. An unregistered local image throws. Ordinary mode can emit a multi-format picture. Priority mode prefers WebP, marks the image eager/high-priority, and emits a corresponding React SSR preload. The current placeholder sets `data-vext-image-placeholder` with a gray background; it does not animate a blurred image into view.

```tsx
import { Image } from "vextjs/frontend";

export function Hero() {
  return (
    <Image
      src="assets/hero.png"
      alt="Product overview"
      width={960}
      height={540}
      sizes="(max-width: 768px) 100vw, 960px"
      priority
    />
  );
}
```

Vext never fetches or proxies a remote image. A remote `src` requires an
explicit `defineImageLoader({ allowlist, load })`; the loader owns the remote
URL and must return an absolute HTTP(S) URL.

The allowlist checks the original URL's hostname and also matches its subdomains. Loader output is only checked for HTTP(S) shape; the application must ensure the returned host remains appropriate. A remote image emits an `img` directly, without local variants, dimension probing, or image proxying.

### Fonts

Add an actual readable `src/frontend/assets/BrandSans.ttf`, then declare its descriptor in `src/frontend/fonts.ts`. `src` resolves relative to the declaring file and must remain inside the frontend root. The descriptor must be a static object literal, not request data or a computed function. `defineFont` requires a family and a real license identifier or application-owned license reference. The compiler emits a local WOFF2 subset; SSR generates `@font-face` from the manifest and deduplicates equivalent output.

```ts
// src/frontend/fonts.ts
import { defineFont } from "vextjs/frontend";

export const brandFont = defineFont({
  src: "./assets/BrandSans.ttf",
  family: "Brand Sans",
  weight: 400,
  display: "swap",
  preload: true,
  fallback: "system-ui",
  license: "OFL-1.1",
});
```

Replace the license value with this font's actual license. Without `subset`, only default printable ASCII is included; for Chinese or other characters, supply the required `subset` string and confirm the source font contains those glyphs. Generated `@font-face` does not apply the font to an element automatically; set `font-family: "Brand Sans", system-ui` in page or global CSS.

Remote font URLs are rejected. The local media worker has no CDN SDK, remote
font downloader, or bundler plugin layer.

## Verify Assets

Run `npm run build` in the application root and inspect real outputs in the public and media inventories, then run `npm start -- --port 3000`. Open a page referencing the assets and check actual image/font loading, Content-Type, cache headers, and conditional requests. File existence alone does not establish a working URL. For the media examples, inspect dimensions, `srcSet`, font glyphs, and budget failures. After CDN deployment, verify actual CDN URLs in a browser; a local dry-run cannot prove remote reachability. Stop the service afterward.

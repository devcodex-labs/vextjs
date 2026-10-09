# SEO, Sitemap, and Robots

Vext provides SEO as a framework capability for full-stack applications. It
merges application defaults, route metadata, and per-render metadata into the
server-rendered document, and can generate `sitemap.xml` and `robots.txt` at
build time or serve them at runtime.

Start by adding page metadata to a [full-stack app](./getting-started), then enable sitemap/robots as needed for deployment. Explicit route or render SEO can still produce metadata such as a title without global `frontend.seo`; only the absence of all SEO declarations preserves previous behavior. Explicit `frontend.seo.enabled: false` disables structured SEO while legacy `head` remains independent.

## Basic Configuration

Merge this into `src/config/default.ts`. A fixed `/about` entry verifies the complete path without an external content service:

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: {
    enabled: true,
    seo: {
      publicOrigin: process.env.PUBLIC_ORIGIN ?? "https://www.example.com",
      titleTemplate: "%s | Example",
      defaults: {
        description: "Example full-stack application",
        robots: ["index", "follow"],
        openGraph: {
          siteName: "Example",
          type: "website",
        },
        twitter: { card: "summary_large_image" },
      },
      sitemap: { entries: () => [{ pathname: "/about" }] },
      robots: {},
    },
  },
};

export default config;
```

`publicOrigin` is the deployment origin, not one fixed page URL. Vext combines
it with the current request pathname. For example, `/posts/hello` and
`/posts/release-notes` produce different canonical URLs even though they share
one `publicOrigin`.

Set `PUBLIC_ORIGIN` per environment when preview, staging, and production use
different domains. It must be an absolute HTTP(S) URL without user info, query,
or hash.

## Page-level Metadata

Static, JSON-safe metadata belongs on the existing route declaration. Its
finite static grammar treats inline objects as the simplest form and also
accepts same-file `const` bindings and TypeScript static wrappers. A route
options helper call is rejected because the index does not execute helper
bodies and cannot know their final metadata. Inline the final object or pass a
same-file `const`. Imported values, computed expressions, and interpolated
templates are not executed:

```ts
// src/routes/about.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      frontend: {
        hydration: "none",
        seo: {
          title: "About Us",
          canonical: "/about",
          openGraph: { type: "profile" },
        },
      },
    },
    (_req, res) => res.render("about"),
  );
});
```

```tsx
// src/frontend/pages/about.tsx
export default function AboutPage() {
  return (
    <main>
      <h1>About Us</h1>
      <p>About the Example app</p>
    </main>
  );
}
```

Run `npm run build` and confirm that the default `dist/client/sitemap.xml` contains `https://www.example.com/about` and `robots.txt` contains the sitemap URL. Start `npm start -- --port 3000` and request `/about`: raw HTML should contain `About Us | Example`, canonical, description, `og:type=profile`, and visible body. This no-hydration example should have no Vext hydration data or browser entry. Check that `/sitemap.xml` and `/robots.txt` return 200 and have the expected content, then stop the server.

The built-in static server and deploy manifest share the MIME mapping: sitemap responds as `application/xml; charset=utf-8`, and robots as `text/plain; charset=utf-8`. External static hosts/CDNs still need their own matching Content-Type configuration; verify the actual HTTP response.

The example origin is an output URL, not a domain that local verification must contact. Replace it for deployment. Build-mode files do not select a runtime Host. A title in HTML does not itself prove search-engine indexing.

Data-dependent metadata belongs in the third argument to `res.render()`. The following is an integration fragment inside a route registration callback: it requires an existing `posts` service, corresponding types, a `posts/detail` page, and a 404 response for a missing post. It is separate from the runnable about example above:

```ts
app.get(
  "/posts/:slug",
  { frontend: { seo: { openGraph: { type: "article" } } } },
  async (req, res) => {
    const post = await app.services.posts.find(req.params.slug);

    res.render(
      "posts/detail",
      { post },
      {
        seo: {
          title: post.title,
          description: post.summary,
          canonical: `/posts/${post.slug}`,
          openGraph: { images: [post.image] },
          jsonLd: post.articleJsonLd,
        },
      },
    );
  },
);
```

Merge order is `frontend.seo.defaults` → `RouteOptions.frontend.seo` →
`res.render(..., { seo })`. Canonical, alternate, and relative Open Graph URLs
require a declared origin. Canonical and sitemap values are absolute pathnames;
query strings and hashes are rejected so accidental duplicate URLs fail early.

Supported metadata includes title, description, robots directives, canonical,
Open Graph, Twitter cards, language alternates, and JSON-LD. Existing
`res.render(..., { head })` remains available; explicit legacy head fields are
merged after structured SEO for compatibility.

## Build-time Sitemap

`sitemap: {}` defaults to build mode. Successful static artifacts are included
automatically, and an entries provider can add dynamic paths known during the
build:

```ts
seo: {
  publicOrigin: "https://www.example.com",
  sitemap: {
    mode: "build",
    includeStatic: true,
    entries: async ({ signal }) => {
      const response = await fetch("https://cms.example.com/seo/posts", {
        signal,
      });
      if (!response.ok) throw new Error(`CMS HTTP ${response.status}`);
      const posts = (await response.json()) as Array<{
        slug: string;
        updatedAt: string;
      }>;
      return posts.map((post) => ({
        pathname: `/posts/${post.slug}`,
        lastmod: post.updatedAt,
        changefreq: "weekly" as const,
        priority: 0.7,
      }));
    },
  },
  robots: {},
}
```

Build mode requires `publicOrigin`. Output is written into the frontend build
closure and included in the deploy manifest with the correct XML/TXT content
types. Static routes with `frontend.seo.index: false` or a `noindex` robots
directive are excluded. More than `maxUrlsPerFile` entries produce a sitemap
index and numbered chunks; the limit defaults to 50,000.

The complete sitemap set also has independent budgets: `maxUrls` defaults to 100,000, `maxBytes` to 50 MiB of rendered UTF-8 output, and runtime `timeoutMs` to 5,000 ms. Generation stops and fails closed as soon as a budget is exceeded; the runtime deadline aborts the provider signal.

The provider receives only `{ mode, origin, originKey, signal }`; Vext does not
inject `app`, services, or `app.db` into configuration callbacks. Read dynamic
entries from a build-safe module or external content source, and honor the
abort signal.

Merge these `seo: { ... }` fragments into an enabled `frontend.seo` config. Replace the CMS address and validate real data; returning an entry does not create its route. `includeStatic` collects successful static pages, not every SSR route. Manage external I/O timeouts in a build provider; `timeoutMs` applies to the runtime deadline.

## Runtime Sitemap and Dynamic Domains

Use runtime mode when entries or the public domain must be selected per
request:

```ts
seo: {
  publicOrigin: "https://www.example.com",
  origins: {
    cn: "https://www.example.cn",
    docs: "https://docs.example.com",
  },
  sitemap: {
    mode: "runtime",
    entries: async ({ originKey, signal }) => {
      const response = await fetch(
        `https://cms.example.com/seo/paths?site=${originKey ?? "default"}`,
        { signal },
      );
      if (!response.ok) throw new Error(`CMS HTTP ${response.status}`);
      const paths = (await response.json()) as string[];
      return paths.map((pathname) => ({
        pathname,
        ...(originKey ? { originKey } : {}),
      }));
    },
  },
  robots: { mode: "runtime" },
}
```

For runtime sitemap/robots endpoints, the request `Host` must match `publicOrigin` or one entry in `origins`; an unknown host returns 404. This does not mean every ordinary page returns 404 for an unknown Host: its canonical comes from the configured `publicOrigin` or `seo.originKey`, never directly from the request Host. A route or render can select a finite named origin with `seo.originKey`; undeclared keys fail.

Configured origins are canonicalized for host comparison, including trailing dots and default ports, while any pathname base in `publicOrigin` is preserved in canonical, sitemap-index, chunk, and robots URLs. Runtime SEO endpoints support both `GET` and `HEAD`; `HEAD` returns the same status and headers without an entity body.

Runtime sitemap and robots responses use `Cache-Control: no-store`. Add an
explicit cache at your reverse proxy only after defining its host and refresh
policy.

To verify runtime mode locally, request the local port with a declared Host, for example `curl -i -H "Host: www.example.com" http://127.0.0.1:3000/sitemap.xml`. An undeclared Host should return 404; `curl -I` should show the same status and headers without a body. The basic build-mode configuration above does not provide these runtime behaviors.

## Robots

```ts
robots: {
  mode: "build",
  groups: [
    { userAgent: "*", allow: "/", disallow: ["/admin", "/preview"] },
    { userAgent: "ExampleBot", crawlDelay: 2 },
  ],
}
```

The path is `/robots.txt`. When sitemap is enabled, the generated robots file
also includes its URL. Runtime SEO endpoints fail startup if they conflict with
an existing user `GET` or `HEAD` route.

## SEO without Browser Hydration

SEO is applied before the document policy, so a route with
`frontend.hydration: "none"` keeps SSR HTML, CSS, canonical metadata, Open
Graph, JSON-LD, and user-authored document scripts while omitting the Vext and
React browser runtime. See [Hydration](/frontend/hydration) for the exact
boundary.

This is page-level server-only rendering. It is not Selective or Partial
Hydration, an Islands architecture, React Server Components, or Partial
Prerendering (PPR).

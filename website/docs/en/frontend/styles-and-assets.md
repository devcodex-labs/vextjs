# Styles and Assets

In a [full-stack project](./getting-started) with frontend enabled, use this page to choose and verify styling. Paths assume the default frontend root. First connect styles to an existing page and layout, then choose CSS Modules, JSCSS, and asset delivery as needed.

## Table of Contents

- [CSS Files](#css-files)
- [CSS Modules](#css-modules)
- [Vext JSCSS](#vext-jscss)
- [CSS Variables](#css-variables)
- [Imported Assets](#imported-assets)
- [Public Assets](#public-assets)
- [CDN URLs](#cdn-urls)

## CSS Files

Global CSS can live under `src/frontend/styles/**` and be imported by pages, layouts, or generated entries.

```css
/* src/frontend/styles/app.css */
:root {
  color-scheme: light dark;
}

body {
  margin: 0;
}
```

Use global CSS for reset, base typography, and design tokens. Component-local styles can use CSS Modules, plain CSS, or JSCSS.

A file's existence does not mean the browser loads it. With the root layout from [Layouts and Components](./layouts-and-components), add `import "../styles/app.css";` at the top of `src/frontend/pages/layout.tsx`, retaining its existing export and children. Alternatively, point the existing `frontend.styles.entry` to this file. Do not maintain two different global base stylesheets.

Vext does not compile Sass or SCSS source files. If a project needs Sass, compile it externally to CSS before Vext consumes it; first-class style sources are CSS, CSS Modules, and Vext JSCSS.

## CSS Modules

`.module.css` uses CSS Modules by default. The compiler creates one stable class mapping per source file and shares it between browser and SSR builds, with independently configurable minification. Identically named files in different directories stay scoped. `composes`, `:local`, `:global`, and CSS `@import` are supported.

The component below works in production SSR pages. Verify server DOM classes, selectors in public CSS, and actual browser computed styles. An error-free Console alone does not prove styling is correct.

```css
/* src/frontend/styles/card.module.css */
.card {
  border: 1px solid var(--border, #d1d5db);
  border-radius: 8px;
  padding: 16px;
}
```

```tsx
// src/frontend/components/Card.tsx
import type { ReactNode } from "react";
import styles from "@styles/card.module.css";

export function Card(props: { children: ReactNode }) {
  return <section className={styles.card}>{props.children}</section>;
}
```

A real page must import and render the component for it to participate. `@styles` resolves to the configured style directory. Keep `frontend.build.css.modules: true` for this class-map form and check server classes against browser rules under the limitation above.

TypeScript projects also need a module declaration, unless an equivalent already exists:

```ts
// src/frontend/styles.d.ts
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
```

## Vext JSCSS

JSCSS is Vext's built-in path for component-level variants, semantic CSS variables, and build-time CSS extraction. Start with the [Vext JSCSS tutorial](/frontend/jscss): it shows the supported `recipe()` rule shape, React `className` usage, build output, and the distinction between `setVar()` declarations and browser-side variable changes. The extractor writes CSS into the build output, so you do not need Emotion or styled-components as default runtime dependencies.

## CSS Variables

Use CSS variables when values need to be changed by theme, tenant, or runtime state.

```ts
// src/frontend/styles/panel.style.ts
import { createVar, setVar, style, vars } from "vextjs/style";

export const accent = createVar("accent");

export const panel = style({
  ...vars(setVar(accent, "#4f46e5")),
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: accent,
});
```

Use `panel` as an element's `className`. `setVar()` creates a declaration for extracted CSS; it does not update the DOM. Here the variable is declared on the panel element itself, so call `element.style.setProperty(accent.name, value)` on that element in a browser event or effect. Merely setting the same variable at the document root will not override the element's own declaration. For a global theme, define the variable at the root and let components inherit it before using `document.documentElement.style.setProperty`. Do not access the DOM during SSR or at style-module scope.

## Imported Assets

Supported image and font imports resolve to the same public URL in browser and SSR output. File assets use their browser-generated hash URL; assets within `inlineLimit` use a shared data URL. `publicPath` and `deploy.assetBaseUrl` apply consistently. Supported formats are PNG, JPEG, GIF, WebP, AVIF, SVG, ICO, WOFF/WOFF2, TTF, and EOT.

First add a real `src/frontend/assets/logo.png`, then import it directly into a page or component:

```tsx
import logoUrl from "@assets/logo.png";

export function Logo() {
  return <img src={logoUrl} alt="Company" />;
}
```

An asset included in a successful browser build may be inlined or emitted with a content hash, depending on configuration. Check this build's manifest and deployment inventory; do not treat an inlined asset as a separate upload file.

## Public Assets

Files under `public/**` keep URL-style access.

```text
public/
  favicon.svg
  robots.txt
  images/social-card.png
```

Use them as:

```tsx
<img src="/images/social-card.png" alt="" />
```

`public/**` files are copied and registered as public assets; include/exclude rules still affect upload plans. The URL above assumes default `publicPath: "/"`. A handwritten image URL does not automatically become a CDN URL when a CDN is configured.

## CDN URLs

Set `frontend.deploy.assetBaseUrl` when production assets are served from a CDN.

```ts
export default {
  frontend: {
    enabled: true,
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      crossOrigin: "anonymous",
      integrity: true,
    },
  },
};
```

`assetBaseUrl` affects generated asset URLs. Upload is controlled separately by `frontend.deploy.upload`, `vext build --upload-assets`, or `vext deploy assets`.

Replace the example domain with your actual CDN. First verify same-origin delivery, then configure a CDN. See [Static Assets and CDN](./static-assets-and-cdn) for upload and media limits.

## Verify Styles

Run `npm run build`, start `npm start -- --port 3000`, and open the styled page with and without JavaScript. Verify CSS selectors match server DOM classes and computed styles remain correct after hydration and an event update. For a dynamic variable, inspect the target element. Verify image/font URLs and any inline or CDN settings. Stop the service afterward.

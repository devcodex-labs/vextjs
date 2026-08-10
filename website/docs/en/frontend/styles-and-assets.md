# Styles and Assets

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

Use global CSS for reset, base typography, and design tokens. Prefer components or CSS Modules for local component styles.

Vext does not compile Sass or SCSS source files. If a project needs Sass, compile it externally to CSS before Vext consumes it; first-class style sources are CSS, CSS Modules, and Vext JSCSS.

## CSS Modules

CSS Modules are enabled for `.module.css`.

```css
/* src/frontend/styles/card.module.css */
.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}
```

```tsx
import styles from "@styles/card.module.css";

export function Card(props: { children: React.ReactNode }) {
  return <section className={styles.card}>{props.children}</section>;
}
```

## Vext JSCSS

JSCSS is Vext's built-in path for component-level variants, semantic CSS variables, and build-time CSS extraction. Start with the [Vext JSCSS tutorial](/frontend/jscss): it shows the supported `recipe()` rule shape, React `className` usage, build output, and the distinction between `setVar()` declarations and browser-side variable changes. The extractor writes CSS into the build output, so you do not need Emotion or styled-components as default runtime dependencies.

## CSS Variables

Use CSS variables when values need to be changed by theme, tenant, or runtime state.

```ts
import { createVar, setVar, style, vars } from "vextjs/style";

export const accent = createVar("accent");

export const panel = style({
  ...vars(setVar(accent, "#4f46e5")),
  borderColor: accent,
});
```

`setVar()` creates a declaration for extracted CSS; it does not update the DOM. Change a live browser value with `document.documentElement.style.setProperty(accent.name, value)` from browser code.

## Imported Assets

Imported assets go through esbuild and the Vext manifest.

```tsx
import logoUrl from "@assets/logo.png";

export function Logo() {
  return <img src={logoUrl} alt="Company" />;
}
```

Production builds content-hash imported assets and include them in `manifest.json` and `deploy-manifest.json`.

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

`public/**` files are copied into frontend output and included in deploy planning.

## CDN URLs

Set `frontend.deploy.assetBaseUrl` when production assets are served from a CDN.

```ts
export default {
  frontend: {
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      crossOrigin: "anonymous",
      integrity: true,
    },
  },
};
```

`assetBaseUrl` affects generated asset URLs. Upload is controlled separately by `frontend.deploy.upload`, `vext build --upload-assets`, or `vext deploy assets`.

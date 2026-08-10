# Vext JSCSS

## Table of Contents

- [When to use JSCSS](#when-to-use-jscss)
- [Build your first component style](#build-your-first-component-style)
- [How extraction reaches the browser](#how-extraction-reaches-the-browser)
- [Common styling tasks](#common-styling-tasks)
- [CSS variables: build-time declarations and browser changes](#css-variables-build-time-declarations-and-browser-changes)
- [Configuration choices](#configuration-choices)
- [Troubleshooting](#troubleshooting)

## When to use JSCSS

Vext JSCSS turns a TypeScript object into a generated CSS class at build time. Use it when a component needs named variants, semantic CSS variables, or nested rules while you still want the final browser to load CSS rather than a CSS-in-JS runtime.

Choose the smallest tool that fits the job:

| Need                                                                | Start with | Why                                                                  |
| ------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| Reset, typography, page-wide tokens                                 | CSS file   | One intentional global stylesheet is easiest to inspect.             |
| A component with fixed local rules                                  | CSS Module | The class map is simple and local.                                   |
| A component with variants, CSS variables, or generated nested rules | Vext JSCSS | A typed rule object becomes extracted CSS and a class-name function. |

Vext does not compile Sass or SCSS source files. If a team keeps Sass, compile it to CSS before Vext sees it. JSCSS is not a Sass replacement; it is the built-in path for typed, component-level generated CSS.

## Build your first component style

This is the recommended first path: define a named recipe in a `*.style.ts` file, then call the recipe from React's `className`.

### 1. Define the button recipe

Create `src/frontend/styles/button.style.ts`.

<!-- jscss-user-guide:button-style:start -->

```ts
import { createVar, recipe } from "vextjs/style";

const colorText = createVar("color-text", "#111827");
const colorPrimary = createVar("color-primary", "#2563eb");
const colorDanger = createVar("color-danger", "#dc2626");

export const button = recipe({
  name: "button",
  base: {
    borderRadius: 8,
    padding: "8px 12px",
    border: 0,
    color: colorText,
  },
  variants: {
    intent: {
      primary: { backgroundColor: colorPrimary },
      danger: { backgroundColor: colorDanger },
    },
  },
  defaultVariants: { intent: "primary" },
});
```

<!-- jscss-user-guide:button-style:end -->

`recipe()` accepts rule objects in `base` and `variants`. `style()` already returns a class-name string, so do **not** write `base: style({ ... })` or `primary: style({ ... })` inside a recipe. Give the recipe a `name` so generated classes are recognizable when you inspect HTML or CSS.

### 2. Use the recipe in a React component

Create `src/frontend/components/Button.tsx`.

<!-- jscss-user-guide:button-component:start -->

```tsx
import type { ReactNode } from "react";
import { button } from "../styles/button.style";

export function Button(props: {
  intent?: "primary" | "danger";
  children: ReactNode;
}) {
  return (
    <button className={button({ intent: props.intent ?? "primary" })}>
      {props.children}
    </button>
  );
}
```

<!-- jscss-user-guide:button-component:end -->

`button({ intent: "primary" })` returns the base class plus the matching variant class. The default variant means `button()` also produces a primary button when no selection is supplied.

### 3. Render it from a page

```tsx
import { Button } from "@components/Button";

export default function SettingsPage() {
  return <Button intent="danger">Delete project</Button>;
}
```

## How extraction reaches the browser

Run the normal production build:

```bash
npm run build
```

Vext discovers matching `*.style.ts`, `*.style.js`, and `*.css.ts` files under `src/frontend/**`, evaluates their declarations during the build, and writes the collected rules to generated JSCSS CSS. The generated browser entry references that CSS, and the final client asset manifest carries it into the rendered document.

You do not import an Emotion or styled-components runtime for this path. The `className` returned by `style()` or `recipe()` is the bridge from React to extracted CSS.

Keep a `*.style.ts` module declarative: it runs during a Node build step, so do not read `window`, `document`, request data, or server-only services at module scope.

## Common styling tasks

### Make one named class

Use `style()` when a component only needs one class.

```ts
import { style } from "vextjs/style";

export const card = style(
  {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "white",
  },
  { name: "card" },
);
```

Numbers become pixel values where CSS expects a length. Unitless properties such as `opacity`, `zIndex`, and `fontWeight` stay unitless.

### Add hover and media rules

Nested selectors use `&`; at-rules stay inside the same object.

```ts
export const card = style(
  {
    padding: 12,
    "&:hover": { transform: "translateY(-1px)" },
    "@media (min-width: 640px)": { padding: 16 },
  },
  { name: "card" },
);
```

### Choose a variant at render time

Use a recipe for a finite set of visual choices. Keep selection names meaningful to the component (`intent`, `size`, `state`) rather than mirroring raw CSS values.

```tsx
<Button intent={isDestructive ? "danger" : "primary"}>Save</Button>
```

## CSS variables: build-time declarations and browser changes

`createVar()` creates a semantic CSS custom-property reference. `setVar()` returns an object that can be placed in a JSCSS rule; it does not mutate the browser document by itself.

```ts
import { createVar, setVar, style, vars } from "vextjs/style";

export const accent = createVar("accent", "#4f46e5");

export const panel = style(
  {
    ...vars(setVar(accent, "#4f46e5")),
    borderColor: accent,
  },
  { name: "panel" },
);
```

The example above emits an initial declaration and `var(--vext-accent, #4f46e5)` in extracted CSS. For a value that must change after hydration, use the normal browser CSS API from an event handler or effect—not from a style module or SSR render:

```ts
document.documentElement.style.setProperty(accent.name, "#7c3aed");
```

## Configuration choices

JSCSS is enabled by default. Only change its settings when you have a specific delivery constraint:

| Setting                                | Default           | Choose it when                                                                                     |
| -------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `frontend.styles.jscss.enabled`        | `true`            | Set `false` only when the project does not use JSCSS sources.                                      |
| `frontend.styles.jscss.files`          | JSCSS file globs  | Extend it when your project intentionally uses another source suffix.                              |
| `frontend.styles.jscss.runtimeAdapter` | `"css-variables"` | Set `"none"` when CSS variables must resolve to their static fallbacks.                            |
| `frontend.styles.jscss.dynamicVars`    | `true`            | Set `false` when generated output must not include variable declarations or `var(...)` references. |
| `frontend.styles.jscss.recipes`        | `true`            | Set `false` when variant recipe classes are intentionally disabled.                                |

See [Frontend Configuration](/frontend/configuration) for the complete field reference and defaults.

## Troubleshooting

| Symptom                                    | Check                                                                                      | Recovery                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| No generated class CSS                     | The file is below `src/frontend/**` and matches `*.style.ts`, `*.style.js`, or `*.css.ts`. | Rename or move the file, then run `npm run build` again.                                |
| `string` is not assignable to a JSCSS rule | A `style()` result was nested inside `recipe().base` or `recipe().variants`.               | Pass raw rule objects to the recipe, as in the first example.                           |
| A theme change does nothing                | `setVar()` was treated as a DOM update.                                                    | Use `document.documentElement.style.setProperty(variable.name, value)` in browser code. |
| A style module fails during build          | The module reads browser globals or request/server state at module scope.                  | Keep it declarative; move browser work to an effect or event handler.                   |
| You need Sass syntax                       | Vext has no first-class Sass/SCSS compiler.                                                | Compile Sass externally to CSS, or use CSS Modules/JSCSS.                               |

Next: compare [Styles and Assets](/frontend/styles-and-assets) for the other supported styling paths, or read [Frontend Configuration](/frontend/configuration) when you need to tune JSCSS extraction.

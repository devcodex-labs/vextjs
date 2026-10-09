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

| Need                                                                | Start with                       | Why                                                                                                                                             |
| ------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Reset, typography, page-wide tokens                                 | CSS file                         | One intentional global stylesheet is easiest to inspect.                                                                                        |
| A component with fixed local rules                                  | CSS Modules, JSCSS, or plain CSS | CSS Modules share SSR/browser class names; static JSCSS can combine tokens and rules. See [Styles and Assets](./styles-and-assets#css-modules). |
| A component with variants, CSS variables, or generated nested rules | Vext JSCSS                       | A typed rule object becomes extracted CSS and a class-name function.                                                                            |

Vext does not compile Sass or SCSS source files. If a team keeps Sass, compile it to CSS before Vext sees it. JSCSS is not a Sass replacement; it is the built-in path for typed, component-level generated CSS.

## Build your first component style

In an application that has completed [Full-Stack Quick Start](./getting-started), define a named recipe in a `*.style.ts` file, then call it from React's `className`. The following example includes the style, component, page, and route; leave the default JSCSS setting enabled.

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
import { button } from "../styles/button.style.js";

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

Create the page and an explicit HTTP route. Relative TypeScript imports in the default NodeNext template use the `.js` extension; framework aliases retain the template's existing mapping.

```tsx
// src/frontend/pages/settings.tsx
import { Button } from "@components/Button";

export default function SettingsPage() {
  return <Button intent="danger">Delete project</Button>;
}
```

```ts
// src/routes/settings.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => res.render("settings"));
});
```

`/settings` should show the danger-styled button. This example demonstrates appearance only; the button has no delete behavior.

## How extraction reaches the browser

Run the normal production build:

```bash
npm run build
```

By default, Vext scans `**/*.style.ts`, `**/*.style.js`, and `**/*.css.ts` under `frontend.root` (`src/frontend` by default). During a Node build step it executes matching modules and their dependencies and writes their rules into generated JSCSS CSS. Scanning is not limited to files imported by a page. The generated browser entry references the CSS, and the client asset manifest carries it into the document. Customize the scan with `frontend.styles.jscss.files`.

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

This replaces the preceding style declaration and reuses that file's `style` import:

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

This is a component usage snippet: the application supplies `isDestructive` from props or state. Recipe selection currently resolves string keys; an unknown choice does not generate a new rule. Do not treat arbitrary runtime strings as declared variants or assume compile-time exhaustiveness over every variant name.

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

The example emits an initial declaration on the panel element and a `var(--vext-accent, #4f46e5)` reference. To change it after hydration, update that element from an event handler or effect. Here `element` is the panel HTMLElement and `accent` is imported from the style module:

```ts
element.style.setProperty(accent.name, "#7c3aed");
```

Do not access the DOM at style-module scope or during SSR rendering. Setting the same variable on the root alone does not override the panel's own declaration. For a global theme, define the variable on the root, let components inherit it, then change it with `document.documentElement.style.setProperty`. `createVar()` returns a variable descriptor: use it directly as a JSCSS property value, or use its `ref` when a string is needed. Do not interpolate the entire object into a CSS string.

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

| Symptom                                    | Check                                                                                                          | Recovery                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| No generated class CSS                     | The file is below `src/frontend/**` and matches `*.style.ts`, `*.style.js`, or `*.css.ts`.                     | Rename or move the file, then run `npm run build` again.                                                                                  |
| `string` is not assignable to a JSCSS rule | A `style()` result was nested inside `recipe().base` or `recipe().variants`.                                   | Pass raw rule objects to the recipe, as in the first example.                                                                             |
| A theme change does nothing                | `setVar()` was treated as a DOM update, or only the root was changed while the element declares its own value. | Call `setProperty` on the actual target element in a browser event/effect; first choose a single declaration location for a global theme. |
| A style module fails during build          | The module reads browser globals or request/server state at module scope.                                      | Keep it declarative; move browser work to an effect or event handler.                                                                     |
| You need Sass syntax                       | Vext has no first-class Sass/SCSS compiler.                                                                    | Compile Sass externally to plain CSS, or use JSCSS; [CSS Modules](./styles-and-assets#css-modules) also work for local styles.            |

Next: compare [Styles and Assets](/frontend/styles-and-assets) for the other supported styling paths, or read [Frontend Configuration](/frontend/configuration) when you need to tune JSCSS extraction.

## Verify the Example

After `npm run build` succeeds, run `npm start -- --port 3000` and open `/settings`. Check the class in SSR HTML, the corresponding rule in browser CSS, and the danger button's actual color. A class string alone does not prove the CSS was loaded. For variable updates, check the target element's computed style. A file outside the build scan is not turned into extracted CSS merely because `style()` is called at runtime. Stop the service when finished.

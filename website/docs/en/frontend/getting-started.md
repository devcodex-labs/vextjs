# Getting Started

Starting with the default TypeScript full-stack template, this page changes the home page, adds a page, connects a component and styles, then verifies a production build. Use a Node.js and npm version supported by the current Vext release; see [General Quick Start](/guide/quick-start) for version requirements.

## Create the App

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

`create` installs dependencies automatically by default. If installation fails or you used `--skip-install`, run `npm install` inside `my-app` successfully before starting it. The default project includes server routes/services, React pages, styles, and an `en-US` frontend dictionary. Add other languages and assets as needed.

You can create an API-only project, but it will not provide the frontend files used in the rest of this page:

```bash
npx vextjs create my-api --template api --frontend none
```

## Open the First Page

After startup, open the address printed in the terminal, `http://localhost:3000/` by default. The template home page should appear; `/api/health` on the same origin returns status data. The page follows this chain:

```text
GET / -> src/routes/index.ts -> res.render("index")
```

`src/frontend/pages/index.tsx` is the page component. It does not create a URL; the route handler determines the URL.

## The Generated Launchpad

The default home page calls the `example` service from its route and passes a greeting and server-generated time to the page. The main files are:

| File                                                       | What to change                           |
| ---------------------------------------------------------- | ---------------------------------------- |
| `src/routes/index.ts`                                      | Home URL, data, and template example API |
| `src/frontend/pages/index.tsx`                             | Home display                             |
| `src/frontend/pages/layout.tsx`, `components/AppShell.tsx` | Shared layout and navigation             |
| `src/frontend/styles/index.css`                            | Template styling                         |
| `src/frontend/locales/en-US.ts`                            | Frontend copy                            |
| `public/vext-mark.svg`, `public/favicon.svg`               | Brand mark and site icon                 |

“Launchpad” is just the default app home page's name, not another runtime mode.

## Change the Home Page

Replace the following two files with the shown content. Replacing the entire `routes/index.ts` removes its original `/api/hello` and `/api/health` examples. In an existing business project, change only the home handler and keep the other routes.

```tsx
// src/frontend/pages/index.tsx
export default function HomePage(props: { greeting: string }) {
  return <main>{props.greeting}</main>;
}
```

```ts
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => {
    res.render("index", { greeting: "Hello from Vext" });
  });
});
```

After saving, revisit `/`. You should see `Hello from Vext`. Refresh if the development UI prompts you. This checks server HTML and does not require a client router.

## Add Another Page

Create the missing `admin` subdirectory and the two files below. `42` is fixed demonstration data and does not depend on a database or service you have not created:

```tsx
// src/frontend/pages/admin/dashboard.tsx
export default function DashboardPage(props: { totalUsers: number }) {
  return <main>Total users: {props.totalUsers}</main>;
}
```

Render it from a route:

```ts
// src/routes/admin/dashboard.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => {
    res.render("admin/dashboard", { totalUsers: 42 });
  });
});
```

Opening `/admin/dashboard` should display `Total users: 42`. The route file already contributes the `/admin/dashboard` prefix, so the handler registers `/`; do not repeat the full URL. The page ID is the extensionless path relative to the frontend page root. See the [Routing guide](/guide/routing) for prefix rules.

## Add a Component

Create a display component:

```tsx
// src/frontend/components/Stat.tsx
export function Stat(props: { label: string; value: number }) {
  return (
    <section>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </section>
  );
}
```

Replace the dashboard page with the following content so it actually uses the component. `@components` is a default frontend alias:

```tsx
// src/frontend/pages/admin/dashboard.tsx
import { Stat } from "@components/Stat";

export default function DashboardPage(props: { totalUsers: number }) {
  return <Stat label="Total users" value={props.totalUsers} />;
}
```

## Add Styles

Here Vext JSCSS `style()` defines a static card style. Plain CSS and CSS Modules also work; see [Styles and Assets](./styles-and-assets#css-modules).

```ts
// src/frontend/styles/card.style.ts
import { style } from "vextjs/style";

export const card = style({
  padding: 16,
  borderRadius: 8,
});
```

Replace the component with this version, importing the style and applying its returned class name:

```tsx
// src/frontend/components/Stat.tsx
import { card } from "@styles/card.style";

export function Stat(props: { label: string; value: number }) {
  return (
    <section className={card}>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </section>
  );
}
```

Reopen `/admin/dashboard`. It should still display `42` and `Total users`, now with padding and rounded corners. Defining a style file without importing and applying its class does not style the component automatically.

For the first recipe, variants, CSS variables, and build output, follow [Vext JSCSS](/frontend/jscss).

## Verify the Build

Stop the development server with Ctrl+C, then run:

```bash
npm run build
npm start -- --port 3000
```

The default TypeScript template's build script includes type checking and builds server and frontend artifacts. After startup, verify:

1. `/` returns HTML with `Hello from Vext`.
2. `/admin/dashboard` shows `42` and `Total users` with the expected style.
3. Browser page scripts and styles load successfully, and the terminal reports no render error.

These static examples do not verify interactive state updates. For interaction, continue with [Hydration](/frontend/hydration) and verify browser behavior. See [Build and Deploy](/frontend/build-and-deploy) for full delivery. Stop the service with Ctrl+C after verification.

## If Something Fails

| Symptom                              | Check                                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page not found                       | Confirm the page id matches `src/frontend/pages/**` without extension.                                                                                            |
| Browser bundle imports a server file | Move service/database work back into `src/routes/**` or `src/services/**`.                                                                                        |
| New page returns 404                 | Check the route file and its prefix; confirm the server reloaded after adding it.                                                                                 |
| Styles do not update                 | Check that the style is imported and its className is used; then inspect dev logs and hot/Fast Refresh settings.                                                  |
| API request receives HTML            | Confirm the API handler still exists and returns JSON. If SPA fallback is used, check scopes and Accept. Accept cannot turn an explicit render route into an API. |
| Module or type is missing            | Confirm dependency installation succeeded in the project directory; retain the template's tsconfig aliases.                                                       |

Next, read [Project Structure](/frontend/project-structure) and [Routing and Pages](/frontend/routing-and-pages).

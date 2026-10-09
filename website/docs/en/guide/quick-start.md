# Quick start

:::tip Release and source scope
Published stable package: `v2.0.0`. This documentation is being revised against the current repository source, which may describe behavior not yet in that package. General install commands do not pin a version. After installing, run `npm ls vextjs` and check the matching release notes before relying on a version-specific feature. See [Versions and Migration](./introduction#versions-and-migration) for published packages, source snapshots, candidate installation, and upgrading from 1.x.
:::

Prerequisites: Node.js `^20.19.0 || >=22.12.0`, npm, and a writable project directory. Check with `node --version` and `npm --version`. The create commands below are alternatives; do not run them in sequence against the same target directory.

## Method 1: Use scaffolding (recommended)

VextJS provides the `vext create` command to create a runnable project. The default template proves the one-route model immediately: `/` renders React through `res.render()`, `/api/hello` returns JSON, and both use the generated example service. Choose API-only when no page runtime is needed.

```bash
# Create TypeScript full-stack project (default Native Adapter)
npx vextjs create my-app
```

Normal creation installs dependencies. If you use `--skip-install` or installation fails, run `npm install` in the generated directory before starting.

```bash
cd my-app
npm run dev
```

The default full-stack template serves an SSR starter at `http://localhost:3000` and API routes at `/api/hello` and `/api/health`. The API-only template serves `/` and `/health` and does not generate a React page. With OpenAPI enabled, visit `/docs` for the API documentation.

Acceptance: the full-stack home displays the starter, `GET /api/hello` returns 200 with greeting data, and `GET /api/health` returns 200 with `data.status: "ok"`. For API-only, check `/` and `/health`. Use the actual port printed at startup.

After verifying the default full-stack project in development, stop the dev server with Ctrl+C, then build and start production and revisit the home and two API routes:

```bash
npm run build
npm start -- --port 3000
```

This CLI override keeps production on the `localhost:3000` address used above. The scaffold's `production.ts` defaults to port `3001`; with plain `npm start`, use the port printed at startup.

### Other creation options

These commands are alternatives to the default creation. Choose one with a target directory that does not yet exist; enter `my-api` afterward if you choose API-only.

```bash

# Create and specify Adapter
npx vextjs create my-app --adapter hono

# Create JavaScript full-stack project
npx vextjs create my-app --js

# Create API-only project
npx vextjs create my-api --template api --frontend none

# Skip npm install
npx vextjs create my-app --skip-install
```

## Method 2: Manual creation

This is a complete minimal TypeScript API-only project. For React/SSR, prefer the full-stack template above or follow [Frontend Getting Started](/frontend/getting-started) to add dependencies, pages, document, styles, and render routes. Empty frontend directories do not create an accessible page.

### 1. Initialize project

```bash
mkdir my-app
cd my-app
npm init -y
npm install vextjs
npm install -D typescript@5 @types/node@20
```

### 2. Configure `package.json`

Merge these ESM settings and scripts into the package.json created above. Preserve the dependencies, devDependencies, and lockfile npm actually wrote. This fragment omits dependencies and does not require changing the installed version to a documentation-pinned value.

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "start": "vext start",
    "dev": "vext dev",
    "build": "vext build --typecheck"
  }
}
```

:::tip
VextJS requires `"type": "module"`, and the project uses the ESM module format.
:::

### 3. Create directory structure

Create `src/config` and `src/routes` in your editor; add `src/services` when using the optional service. In Bash:

```bash
mkdir -p src/config src/routes src/services
```

In PowerShell, use `New-Item -ItemType Directory -Force src/config,src/routes,src/services`. There is no need to precreate every optional directory.

Add `tsconfig.json` for independent type checking and the build's typecheck stage:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", ".vext/types/**/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 4. Write configuration

```typescript
// src/config/default.ts
export default {
  port: 3000,
  host: "0.0.0.0",
  logger: {
    level: "info",
  },
  openapi: {
    enabled: true,
  },
  frontend: { enabled: false },
};
```

For another Adapter such as Hono, install its package and merge the adapter field into the configuration above, preserving any OpenAPI and other settings you need:

```bash
npm install hono
```

```typescript
// src/config/default.ts
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

### 5. Write routing

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/hello
  app.get(
    "/api/hello",
    {
      docs: { summary: "Hello API" },
    },
    async (_req, res) => {
      res.json({ message: "Hello VextJS!" });
    },
  );

  // GET /api/health
  app.get(
    "/api/health",
    {
      docs: { summary: "Health Check" },
    },
    async (_req, res) => {
      res.json({
        status: "ok",
        uptime: process.uptime(),
      });
    },
  );
});
```

### 6. Write services (optional)

```typescript
// src/services/example.ts
export default class ExampleService {
  async getGreeting(name: string) {
    return { message: `Hello, ${name}!` };
  }
}
```

Use services in routes:

```typescript
// src/routes/greet.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/:name",
    {
      validate: {
        param: { name: "string!" },
      },
      docs: { summary: "Greeting Interface" },
    },
    async (req, res) => {
      const { name } = req.valid("param");
      const result = await app.services.example.getGreeting(name);
      res.json(result);
    },
  );
});
```

### 7. Start

```bash
# Development mode (hot reload)
npm run dev

# Production mode
npm run build
npm start
```

`dev` is a long-running command. Stop it after development verification before running build/start, or the port may be occupied. This TypeScript project needs a successful build before production startup. A pure-JavaScript API template may start from source and have no build script; follow its actual package scripts.

Verify the manual minimal project with these requests (use `curl.exe` in Windows PowerShell):

```bash
curl -i http://127.0.0.1:3000/api/hello
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/greet/Alice
```

The first two should return 200, with `data.message: "Hello VextJS!"` and `data.status: "ok"`. After adding the optional service and greet route, the third should return 200 with `data.message: "Hello, Alice!"`. The `greet` filename already contributes the `/greet` prefix; do not repeat it in the child path. Repeat the requests after production startup, and verify `/docs` and `/openapi.json` are accessible.

The manual API-only project has no `/` page, so a 404 at the root is expected from its route definitions. See [Frontend Getting Started](/frontend/getting-started) for complete SSR setup.

<a id="41-可选添加-srcconfigbootstrapts"></a>

## Optional: Startup configuration

If configuration must be fetched at startup and merged before `config` is frozen, add `src/config/bootstrap.ts`:

```typescript
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      async load({ configProfile, signal }) {
        const response = await fetch(
          `https://config.example.com/${configProfile}.json`,
          {
            signal,
          },
        );
        if (!response.ok)
          throw new Error(`Config request failed: ${response.status}`);
        return await response.json();
      },
    },
  ],
});
```

Appropriate uses include database configuration, Nacos startup configuration, and key patches. The URL above is a placeholder demonstrating a provider. Do not add it to the minimal project without a real service. Ordinary local configuration does not need a bootstrap provider. APM and OpenTelemetry require earlier `preload` execution instead.

## Project structure

The following is the default TypeScript full-stack scaffold structure. The manual API-only example uses only the configuration, routes, optional service, and project files created above; it does not generate these React assets:

```
my-app/
├── public/
│   ├── favicon.svg           # Contrast-safe V favicon variant
│   └── vext-mark.svg         # Transparent V mark used by AppShell
├── src/
│   ├── config/
│   │   ├── default.ts        # Shared configuration (port: 3000)
│   │   ├── development.ts    # Development profile
│   │   ├── production.ts     # Production profile
│   │   ├── local.ts          # Empty local override; ignored by Git
│   │   └── bootstrap.ts      # Tracked startup entry with providers: []
│   ├── frontend/
│   │   ├── components/AppShell.tsx # Shared React shell
│   │   ├── locales/en-US.ts  # Starter messages
│   │   ├── pages/            # React pages, layouts, document, and error page
│   │   └── styles/index.css  # Vext launchpad styles
│   ├── routes/index.ts       # URL handler and server data
│   ├── services/example.ts   # Service layer
│   └── types/
│       ├── generated/.gitkeep # Typegen output root (TS project)
│       ├── shared/greeting.d.ts # Shared service/frontend data type
│       └── frontend/home.d.ts # Home page props type
├── package.json
├── tsconfig.json
└── .gitignore
```

:::info Convention
Each role follows its own loader and configuration: routes/services/plugins have conventional entry points; middleware loads by mounted name; frontend/public require the frontend flow; ordinary shared directories are used through imports. The scaffold initially creates only directories with real starter content. Project-root `preload/` is a warned compatibility fallback only. See [Project Structure](/guide/project-structure). Route filenames map to URL prefixes:

| File path                      | URL prefix        |
| ------------------------------ | ----------------- |
| `src/routes/index.ts`          | `/`               |
| `src/routes/users.ts`          | `/users`          |
| `src/routes/admin/index.ts`    | `/admin`          |
| `src/routes/admin/settings.ts` | `/admin/settings` |

:::

The scaffold creates zero-effect `src/config/local.ts` and `src/config/bootstrap.ts`. `local.ts` starts as an empty `VextConfigOverride` and is excluded by `.gitignore`, so a fresh clone may omit it without affecting build or startup. `bootstrap.ts` starts with `providers: []`, is tracked normally, and can later register startup providers before the final CLI override. See [Project Structure](/guide/project-structure) for ownership of service types, runtime constants, and shared utilities.

The default full-stack template displays an SSR Vext runtime launchpad showing the route → service → SSR → browser runtime path. Its header links to both the official Vext Guide and the generated application's local `/docs`; a secondary action opens the Vext Guide. OpenAPI is enabled in both development and production. The template includes actual starter files, not a root or placeholder README. Generated user source defaults to English in TypeScript, JavaScript, full-stack, and API-only templates, except explicit locale resources. AppShell uses transparent `public/vext-mark.svg`; `public/favicon.svg` is a high-contrast variant with the same V geometry. Add optional convention directories only when their corresponding source is needed.

## Access OpenAPI documentation

The default `fullstack-react` template and this manual example enable `openapi.enabled: true`. The scaffolded API-only template does not enable OpenAPI by default; add it to `src/config/default.ts` before starting if needed. Enabled default endpoints:

- **Vext Docs Documentation**: `http://localhost:3000/docs`
- **OpenAPI JSON**: `http://localhost:3000/openapi.json`

## CLI command overview

| Command              | Description                                       |
| -------------------- | ------------------------------------------------- |
| `vext dev`           | Development mode, file monitoring + hot reloading |
| `vext start`         | Start production mode                             |
| `vext build`         | Build project (TypeScript → JavaScript)           |
| `vext create <name>` | Create a new project                              |
| `vext stop`          | Stop the Cluster process                          |
| `vext reload`        | Rolling restart Worker                            |
| `vext status`        | View Cluster running status                       |

## Development mode hot reload

`vext dev` provides a three-layer hot reload strategy and automatically selects the optimal method:

| Level                              | Trigger                                                         | Behavior                                | Speed                              |
| ---------------------------------- | --------------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| **Tier 1** — Route hot replacement | A route change that can be replaced safely                      | Replace the request handler             | Depends on compilation and loading |
| **Tier 2** — Partial reload        | Supported service or i18n change                                | Reload a service or switch a dictionary | Depends on dependency scope        |
| **Tier 3** — Cold restart          | Config/plugin changes or changes that cannot be safely reloaded | Restart the worker                      | Depends on startup cost            |

See [Hot Reload](/guide/hot-reload) for classification and fallback. Tier names do not promise fixed timing or uninterrupted execution for every change.

## Common startup issues

| Symptom                                 | Action                                                                            | Verify again                                   |
| --------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| `vext` or dependencies missing          | Confirm the project directory and run `npm install`                               | Run `npm run dev` again                        |
| Unsupported Node version                | Use a Node version satisfying the engines above                                   | Check `node --version`, then reinstall/start   |
| Port occupied                           | Stop the service you started earlier or change `port`                             | Request hello on the actual listening port     |
| Only `/greet/greet` matches             | The filename prefix and child path were duplicated                                | Use `/:name` here, then request `/greet/Alice` |
| Frontend output or dependencies missing | Check the template; keep API-only frontend disabled or complete SSR per its guide | Rebuild and verify the page                    |
| `start` cannot find output              | Build the TypeScript app with matching profile/outDir first                       | Repeat API checks after production startup     |

## Next step

- Understand [Project Structure](/guide/project-structure) conventions
- Configure the [Frontend guide](/frontend/overview)
- Learn the three-part definition of [routing](/guide/routing)
- Explore [middleware](/guide/middleware) and [plugins](/guide/plugins)
- View the [Configuration](/guide/configuration) options

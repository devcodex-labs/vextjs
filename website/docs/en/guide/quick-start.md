# Quick start

## Method 1: Use scaffolding (recommended)

VextJS provides the `vext create` command to quickly create a runnable project. The default template is a full-stack React app with Vext API routes:

```bash
# Create TypeScript full-stack project (default Native Adapter)
npx vextjs create my-app

# Create and specify Adapter
npx vextjs create my-app --adapter hono

# Create JavaScript full-stack project
npx vextjs create my-app --js

# Create API-only project
npx vextjs create my-api --template api --frontend none

# Skip npm install
npx vextjs create my-app --skip-install
```

After creation is complete:

```bash
cd my-app
npm run dev
```

Visit `http://localhost:3000` and you should see the React client. The backend API routes are available at `/api/hello` and `/api/health`.

## Method 2: Manual creation

### 1. Initialize project

```bash
mkdir my-app && cd my-app
npm init -y
npm install vextjs
```

### 2. Configure `package.json`

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "start": "vext start",
    "dev": "vext dev",
    "build": "vext build"
  },
  "dependencies": {
    "vextjs": "^1.0.0"
  }
}
```

:::tip
VextJS requires `"type": "module"`, and the project uses the ESM module format.
:::

### 3. Create directory structure

```bash
mkdir -p src/config src/routes src/services src/middlewares src/plugins src/locales src/types/generated src/frontend/pages/error src/frontend/components src/frontend/styles src/frontend/assets src/frontend/locales public preload
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
  frontend: {
    enabled: true,
    framework: "react",
    publicDir: "public",
    publicPath: "/",
    i18n: {
      enabled: true,
      defaultLocale: "en-US",
    },
  },
};
```

If you need to use other Adapters (such as Hono), first install the corresponding package and then configure:

```bash
npm install hono @hono/node-server
```

```typescript
// src/config/default.ts
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

### 4.1 Optional: Add `src/config/bootstrap.ts`

If some configuration must be read from the remote end during startup and needs to be merged before `config` is frozen, you can add `src/config/bootstrap.ts`:

```typescript
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      async load({ env, signal }) {
        const response = await fetch(`https://config.example.com/${env}.json`, {
          signal,
        });
        return await response.json();
      },
    },
  ],
});
```

Suitable for: database, Nacos startup configuration, key patch.

Not suitable for: `preload` scenarios such as APM / OpenTelemetry that need to be executed earlier.

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
    "/greet/:name",
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

Frontend pages live under `src/frontend/pages/**`. Vext generates the browser entry, page registry, layout registry, and HTML injection code automatically. For a manual project, create at least `src/frontend/pages/index.tsx`, `src/frontend/pages/_document.html`, and `src/frontend/styles/index.css`, or start from the default `vext create` template.

## Project structure

After scaffolding or manual creation, your project structure should look like this:

```
my-app/
├── public/
│ └── favicon.svg # Static asset copied into the frontend build
├── src/
│ ├── frontend/
│ │ ├── pages/
│ │ │ ├── _document.html
│ │ │ ├── index.tsx
│ │ │ ├── layout.tsx
│ │ │ └── error/
│ │ │   └── default.tsx
│ │ ├── components/
│ │ ├── styles/
│ │ │ └── index.css
│ │ ├── assets/
│ │ └── locales/
│ ├── config/
│ │ ├── default.ts #Default configuration
│ │ ├── bootstrap.example.ts # Remote configuration provider example during startup
│ │ ├── development.ts # Development environment coverage (optional)
│ │ ├── production.ts # Production environment coverage (optional)
│ │ └── local.example.ts # Local coverage example, copy it to local.ts and use it
│ ├── routes/
│ │ └── index.ts # Route definition
│ ├── services/
│ │ └── example.ts # Service layer
│ ├── middlewares/
│ │ └── README.md # Custom middleware placeholder description
│ ├── plugins/
│ │ └── README.md # Custom plug-in placeholder description
│ ├── locales/
│ │ └── README.md # i18n language pack placeholder description
│ └── types/
│ └── generated/
│ └── .gitkeep # typegen output directory placeholder (TS project)
├── preload/
│ └── README.md # Process-level preload script placeholder description
├── package.json
└── tsconfig.json # TypeScript configuration (TS project)
```

:::info Convention
VextJS will automatically scan `src/routes/`, `src/services/`, `src/config/`, `src/middlewares/`, `src/plugins/`, `src/locales/`, `src/frontend/`, `public/` and the project root `preload/` directory without manual registration. Route file names are mapped to URL prefixes:

| File path                      | URL prefix        |
| ------------------------------ | ----------------- |
| `src/routes/index.ts`          | `/`               |
| `src/routes/users.ts`          | `/users`          |
| `src/routes/admin/index.ts`    | `/admin`          |
| `src/routes/admin/settings.ts` | `/admin/settings` |

:::

`src/config/local.example.ts` and `src/config/bootstrap.example.ts` are sample files generated by the scaffolding. When you need to enable local overlay or startup provider, copy them as `local.ts` / `bootstrap.ts` respectively. If `src/config/bootstrap.ts` exists, it will be executed after `default/env/local` is merged and before CLI override, and the patch returned by the provider will be included in the final configuration link.

## Access OpenAPI documentation

After turning on `openapi.enabled: true` in the configuration, you can access it by starting the project:

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

| Level                                | Trigger Condition            | Behavior                                              | Speed                |
| ------------------------------------ | ---------------------------- | ----------------------------------------------------- | -------------------- |
| **Tier 1** — Hot routing replacement | Routing file changes         | Atomic replacement request handler, zero interruption | ⚡ Millisecond level |
| **Tier 2** — Service reload          | Service/i18n file changes    | Rebuild affected service instances                    | ⚡ Milliseconds      |
| **Tier 3** — Cold Reboot             | Configuration/Plugin Changes | Complete Reboot Process                               | 🔄 Seconds           |

## Next step

- Understand [Project Structure](/guide/project-structure) conventions
- Configure the [Frontend guide](/frontend/overview)
- Learn the three-part definition of [routing](/guide/routing)
- Explore [middleware](/guide/middleware) and [plugins](/guide/plugins)
- View the [Configuration](/guide/configuration) options

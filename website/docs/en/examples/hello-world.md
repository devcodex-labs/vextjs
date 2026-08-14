# HelloWorld

The simplest VextJS project to help you understand the basic structure and working of the framework.

## Complete project structure

```
hello-world/
  ├── src/
  │ ├── config/
  │ │ └── default.ts
  │ ├── routes/
  │ │ └── index.ts
  │ └── index.ts
  ├── package.json
  └── tsconfig.json
```

## 1. Initialize project

Use the `vext create` scaffolding to quickly create:

```bash
npx vextjs create hello-world
cd hello-world
pnpm install
```

Or create manually:

```bash
mkdir hello-world && cd hello-world
pnpm init
pnpm add vextjs
pnpm add -D typescript @types/node
```

## 2. Configuration file

### package.json

```json
{
  "name": "hello-world",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vext dev",
    "build": "vext build",
    "start": "vext start"
  },
  "dependencies": {
    "vextjs": "latest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

## 3. Configuration

```typescript
// src/config/default.ts
export default {
  port: 3000,
  adapter: "native",
  logger: {
    level: "debug",
    pretty: true,
  },
  cors: {
    enabled: true,
    origins: ["*"],
  },
};
```

:::tip
`adapter: 'native'` uses the built-in Native adapter (`http.createServer` + `route-core`) and has no third-party HTTP framework dependency. You can switch to `'hono'`, `'fastify'`, `'express'`, or `'koa'` without rewriting route business logic. Review the [current benchmarks](/benchmark) and test your workload before choosing.
:::

## 4. Routing

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET / → greeting interface
  app.get(
    "/",
    {
      docs: {
        summary: "Greeting interface",
      },
    },
    async (_req, res) => {
      res.json({ message: "Hello VextJS! 🚀" });
    },
  );

  // GET /health → health check
  app.get("/health", async (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // GET /echo → echo query parameters
  app.get(
    "/echo",
    {
      validate: {
        query: {
          message: "string?",
        },
      },
      docs: {
        summary: "echo interface",
        description: "Return the message in the query parameter as it is",
      },
    },
    async (req, res) => {
      const { message } = req.valid("query");
      res.json({
        echo: message ?? "no message provided",
        method: req.method,
        path: req.path,
        requestId: req.requestId,
        ip: req.ip,
      });
    },
  );

  // POST /greet → Greeting with parameter verification
  app.post(
    "/greet",
    {
      validate: {
        body: {
          name: "string:1-50",
          language: "enum:zh,en,ja?",
        },
      },
      docs: {
        summary: "Personalized greeting",
        description: "Return a greeting based on name and language",
        responses: {
          200: {
            description: "Greetings success",
            example: {
              greeting: "Hello, Alice!",
              language: "zh",
            },
          },
        },
      },
    },
    async (req, res) => {
      const { name, language = "zh" } = req.valid("body");

      const greetings: Record<string, string> = {
        zh: `Hello, ${name}!`,
        en: `Hello, ${name}!`,
        ja: `こんにちは, ${name}!`,
      };

      res.json({
        greeting: greetings[language],
        language,
      });
    },
  );
});
```

## 5. Entry file

```typescript
// src/index.ts
import { bootstrap } from "vextjs";

bootstrap().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
```

## 6. Run

### Development mode

```bash
pnpmdev
```

Development mode features:- Automatic hot reloading of file modifications (three-layer strategy: routing/service/configuration smart refresh)

- Beautify log output (built-in pretty format)
- Automatically enable OpenAPI documentation (visit `http://localhost:3000/docs`)

### Production mode

```bash
pnpm build
pnpm start
```

## 7. Verification

After startup, you can use `curl` or browser verification:

```bash
# Greeting interface
curl http://localhost:3000/
# → {"code":0,"data":{"message":"Hello VextJS! 🚀"},"requestId":"..."}

#HealthCheck
curl http://localhost:3000/health
# → {"code":0,"data":{"status":"ok","uptime":12.34,"timestamp":"..."},"requestId":"..."}

# Echo interface
curl "http://localhost:3000/echo?message=hello"
# → {"code":0,"data":{"echo":"hello","method":"GET","path":"/echo",...},"requestId":"..."}

#personalized greetings
curl -X POST http://localhost:3000/greet \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","language":"en"}'
# → {"code":0,"data":{"greeting":"Hello, Alice!","language":"en"},"requestId":"..."}

# Parameter verification test (422 is triggered when name is empty)
curl -X POST http://localhost:3000/greet \
  -H "Content-Type: application/json" \
  -d '{"name":""}'
# → 422 {"code":422,"message":"Validation failed","errors":[...],"requestId":"..."}
```

## 8. Response format description

VextJS enables **export wrapping** by default (`config.response.wrap: true`), and all `res.json()` responses will be automatically wrapped into a unified format:

**Successful response**:

```json
{
  "code": 0,
  "data": { "message": "Hello VextJS! 🚀" },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error response**:

```json
{
  "code": 422,
  "message": "Validation failed",
  "errors": [{ "field": "name", "message": "length must be between 1 and 50" }],
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

If packaging is not required (e.g. inter-microservice communication), it can be disabled in the configuration:

```typescript
// src/config/default.ts
export default {
  response: {
    wrap: false,
  },
};
```

## Key concepts review

| Concept          | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `defineRoutes`   | Route definition function, register the route in the callback                      |
| `bootstrap`      | Framework startup function, arranges the complete initialization process           |
| `validate`       | Declarative parameter validation (schema-dsl DSL syntax)                           |
| `req.valid()`    | Get the verified and type-converted data                                           |
| `res.json()`     | Returns a JSON response (automatic export wrapper)                                 |
| `docs`           | OpenAPI document configuration, automatically generate Vext Docs API documentation |
| Export packaging | Unified response format `{ code, data, requestId }`                                |

## Next step

- 📖 Read [Quick Start](/guide/quick-start) to learn more about the complete project construction process
- 📖 Read [CRUD API Examples](/examples/crud-api) to learn about database integration
- 📖 Read [Project Structure](/guide/project-structure) to understand the convention directory specification
- 📖 Read [Routing](/guide/routing) to learn more about the three-stage routing definition

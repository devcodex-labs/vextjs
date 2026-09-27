# Hello World

## Executable 2.x Reference

Run the repository's minimal example first to verify the service, HTTP, and
documentation entry points. Then read the TypeScript teaching variant if
needed. These are separate projects; do not mix their files.

The release contract for this page is the checked-in
[`examples/hello-world`](https://github.com/devcodex-labs/vextjs/tree/main/examples/hello-world)
project. It is a deliberately small JavaScript application with `checkJs`
typechecking, the Native adapter, explicit `rateLimit.enabled: false`, Vext
Docs, and exactly two routes: `GET /` and `GET /health`.

From the cloned repository root, first run `npm ci` and `npm run build`.
Then run the following contributor commands. To create a new application
instead, use the scaffolding path below:

```bash
cd examples/hello-world
npm install
npm run typecheck
npm run build
npm test
npm start
```

After startup, verify that `/` returns `data.message: "hello world"`,
`/health` returns `data.status: "ok"`, `/openapi.json` contains both business
routes, and `/docs` shows Vext Docs. An unknown path returns 404. Stop the
service after checking. The example
uses `"vextjs": "file:../.."` only inside this repository; generated and normal
consumer projects install the published `vextjs` package.

The repository example's source determines its files and endpoints. These
verification commands are for the reader to run; they do not claim an
installation, test, or publication was performed in this local session.

## Extended TypeScript Tutorial

The walkthrough below is a separate teaching variant. It demonstrates extra
validation and response APIs, but it is not the executable release fixture and
must not be used to infer that those extra routes exist in
`examples/hello-world`.

## Complete project structure

```
hello-world/
  ├── src/
  │ ├── config/
  │ │ └── default.ts
  │ ├── routes/
  │ │ └── index.ts
  ├── package.json
  └── tsconfig.json
```

## 1. Initialize project

Use the `vext create` scaffolding to quickly create:

```bash
npx vextjs create hello-world --template api --skip-install
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
    "typecheck": "tsc --noEmit",
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
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
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
  rateLimit: { enabled: false },
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
`adapter: 'native'` uses the built-in Native adapter (`http.createServer` +
`route-core`) and has no third-party HTTP framework dependency. To select
`'hono'`, `'fastify'`, `'express'`, or `'koa'`, first install its optional
peer dependency. Routes using the Vext public API can remain; see
[Adapters](/guide/adapters) for differences and [benchmarks](/benchmark)
for historical measurement methods.
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
          name: "string:1-50!",
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
              greeting: "你好, Alice!",
              language: "zh",
            },
          },
        },
      },
    },
    async (req, res) => {
      const { name, language = "zh" } = req.valid("body");

      const greetings: Record<string, string> = {
        zh: `你好, ${name}!`,
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

## 5. Startup entry

This example uses the `vext dev/build/start` scripts in `package.json`.
The CLI manages startup, so do not create `src/index.ts` or call
`bootstrap()` again. For programmatic startup and shutdown, see
[App lifecycle](/api/app); do not combine the two startup patterns.

## 6. Run

### Development mode

```bash
pnpm dev
```

Development mode features:

- File changes trigger reload; routes/Services and config changes follow
  different strategies. See [Hot reload](/guide/hot-reload).
- Readable logs use the built-in pretty formatter.
- This example explicitly enables OpenAPI docs at `http://localhost:3000/docs`.

### Production mode

```bash
pnpm typecheck
pnpm build
pnpm start
```

## 7. Verification

After startup, you can use `curl` or browser verification:

```bash
# Greeting interface
curl http://localhost:3000/
# → {"code":0,"data":{"message":"Hello VextJS! 🚀"},"requestId":"..."}

# Health check
curl http://localhost:3000/health
# → {"code":0,"data":{"status":"ok","uptime":12.34,"timestamp":"..."},"requestId":"..."}

# Echo interface
curl "http://localhost:3000/echo?message=hello"
# → {"code":0,"data":{"echo":"hello","method":"GET","path":"/echo",...},"requestId":"..."}

# Personalized greeting
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

VextJS enables **response wrapping** by default (`config.response.wrap:
true`). Successful JSON responses in this example use the unified format.
For bodyless status codes, explicit unwrapped responses, and the error path,
see [Request and response](/api/context).

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

Validator error messages may vary by language; check HTTP status, business
code, and `errors` structure first. A missing required `name` must also
return 422; do not test only an empty string.

If wrapping is unnecessary, merge this field into the existing config:

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

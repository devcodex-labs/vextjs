# OpenAPI Documentation

VextJS has built-in automatic generation of OpenAPI documentation. Based on route `validate` and `docs` configuration, the framework generates an OpenAPI 3.0 JSON document and serves the default `/docs` page with the Vext Docs Renderer. Third-party documentation tools should consume `/openapi.json` directly.

## Quick Start

### 1. Enable OpenAPI

Enable `openapi.enabled` in the configuration:

```typescript
// src/config/default.ts
export default {
  port: 3000,
  openapi: {
    enabled: true,
  },
};
```

### 2. Add document information to the route

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: {
        query: {
          page: "number:1-",
          limit: "number:1-100",
        },
      },
      docs: {
        summary: "Get user list",
        description: "Get all user information in pages",
      },
    },
    async (req, res) => {
      const { page = 1, limit = 20 } = req.valid("query");
      const users = await app.services.user.findAll({ page, limit });
      res.json(users);
    },
  );

  app.post(
    "/",
    {
      validate: {
        body: {
          name: "string:1-50!",
          email: "email!",
          age: "number:0-150?",
        },
      },
      middlewares: ["auth"],
      docs: {
        summary: "Create user",
      },
    },
    async (req, res) => {
      const data = req.valid("body");
      const user = await app.services.user.create(data);
      res.json(user, 201);
    },
  );
});
```

### 3. Access documents

After starting the project, visit the following address:

| Address | Description |
| -------------------------------------------------- | -------------------------------------------------- |
| `http://localhost:3000/docs` | Vext Docs interface (HTTP API, Pages, and services/utils/models/components/plugins/middlewares docs) |
| `http://localhost:3000/openapi.json` | OpenAPI JSON specification file |

The default Vext Docs UI keeps HTTP API, Pages, Services, Utils, Models, discovered Components, Plugins, and Middlewares as top-level sections. Active top-level sections can collapse and expand their current navigation tree. HTTP API and Pages use recursive navigation generated from OpenAPI path segments, keep stable resource segments such as `/api/v1/info` as categories, use each operation `summary` as the concrete leaf label with endpoint fallback, and weaken dynamic path parameters such as `{id}` instead of treating them as normal business categories. Response status codes are shown as horizontal tabs without repeated panel headings, local schema `$ref` values are expanded into real fields, and object schemas do not show artificial root rows. The desktop sidebar stays sticky while the content scrolls, can auto-size to visible navigation labels, supports persisted manual resizing, and built-in docs assets are version-tagged so browser cache does not hide renderer updates. The header separates search, UI controls, filters, and Authorize into clear rows, while the Overview workspace shows counts plus package startup/build/verification commands. Right-side API/code/model/plugin/middleware entries use a separated item shell so long pages remain scannable. Pages are detected from route handlers that call `res.render()` or `res.renderError()`, while Services / Utils / Components are generated from standard JSDoc without importing user code. Models are listed from recognizable model files even when no JSDoc is present; root-level models are shown directly under Models instead of under an artificial `root` group, and nested model files are grouped by source directory. The renderer statically reads supported model definition shapes to show registry key, name, collection, connection, schema fields, enums, options, indexes, methods, hooks, and usage without importing or executing model code. Plugins and middlewares are scanned from `src/plugins` and `src/middlewares` to show JSDoc, lifecycle/bootstrap metadata, app extensions, middleware type, route usage, and source links when they can be inferred from source text. Locales, Config, Styles, and Preload static source docs are optional advanced sources that can be enabled explicitly through `openapi.docs.code.*`; they are not part of the default top-level documentation surface. On local loopback docs pages, code docs entries can include an `Open source` link that redirects to `vscode://file/...`; the link is hidden for non-local access. Route-level `docs.tags` is deprecated and ignored with a warning; operation tags are inferred automatically from route path/source and are tucked into collapsed Metadata instead of being shown as primary badges. `x-tagGroups` is emitted only when `openapi.tagGroups` is explicitly configured as a raw OpenAPI vendor extension; the built-in docs navigation does not depend on it. When OpenAPI security schemes are present, the UI shows operation security badges and a global Authorize control that is merged into same-origin Try it out requests.

B26 adds built-in theme and density controls, a more useful Overview workspace, keyboard search shortcuts, category search filters, highlighted matches, desktop page outline, copy buttons for endpoints, links, responses, usage snippets, and source paths, plus deep links for navigation leaves. Middle dynamic path parameters remain visually weak but are preserved when they lead to stable child resources, so paths such as `/docs-nav/{id}/sdfs/sdfaf` keep their resource hierarchy.

B27 upgrades Try it out into a lightweight request console. Each operation can show a server selector and full URL preview with Copy URL, plus tabs for Params, Headers, Body, Auth, Samples, History, and Response. Structured query/header rows stay compact when empty and still support raw fallbacks; header rows are generated from OpenAPI `parameters[in=header]`, including `validate.header`. The Samples tab includes cURL, browser fetch, Node fetch, and Axios snippets, while the fixed Response tab keeps pretty/raw body modes and shows the actual request headers beside the response headers so you can verify what was sent. The Axios snippet is only text; Vext does not add Axios as a runtime dependency.

If you need to append organization-level extension fields after generation, you can use OpenAPI hooks. `OpenAPIGenerator.generate()` remains synchronized, and `openapi:afterGenerate` must also return patches synchronously:

```typescript
// src/plugins/openapi-extra.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "openapi-extra",
  setup(app) {
    app.hooks.on("openapi:afterGenerate", ({ document }) => ({
      document: {
        ...(document as Record<string, unknown>),
        "x-service-owner": "platform",
      },
    }));
  },
});
```

## Document configuration

### Global configuration

Configure OpenAPI global information in `config/default.ts`:

```typescript
// src/config/default.ts
export default {
  openapi: {
    enabled: true,
    title: "My App API",
    description: "My Application RESTful API Documentation",
    version: "1.0.0",

    //OpenAPI JSON path
    jsonPath: "/openapi.json",

    // Reverse proxy public path (configured when the proxy strips the prefix, see the "Customized Document Path" chapter for details)
    // jsonPublicPath: '/admin/openapi.json',

    // Vext Docs configuration
    docs: {
      path: "/docs",
      ui: {
        title: "My App API",
        defaultView: "overview",
        theme: "system",
        density: "comfortable",
      },
      code: {
        enabled: "auto",
        services: true,
        utils: true,
        models: true,
      },
    },

    // API server list
    servers: [
      { url: "http://localhost:3000", description: "Local development" },
      { url: "https://api.myapp.com", description: "Production environment" },
    ],

    // Tag definitions (describe global tags; the default docs page still navigates by path segment)
    tags: [
      { name: "User Management", description: "User CRUD Operation" },
      { name: "Order Management", description: "Order Related Interface" },
      { name: "System", description: "System-level interface" },
    ],

    // Security scheme definition
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      apiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },//Middleware name → security scheme mapping
    guardSecurityMap: {
      auth: "bearerAuth",
      "api-key": "apiKeyAuth",
    },

    //Contact information
    contact: {
      name: "API Support",
      email: "support@myapp.com",
      url: "https://myapp.com/support",
    },

    // license
    license: {
      name: "Apache-2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0",
    },
  },
};
```

Code docs scan `src/services`, `src/utils`, the configured models directory, `src/frontend/components`, `src/plugins`, and `src/middlewares` without importing or executing user code. Services, utils, and components require standard JSDoc on exported symbols. Models are listed from recognizable model files even without JSDoc, and JSDoc above the default export enriches the generated entry. Supported model definitions also expose schema fields, enums, options, indexes, methods, hooks, and a usage snippet in the default UI. Plugins expose inferred plugin name, dependencies, lifecycle hooks, global middleware registration, app extensions, and setup usage. Middlewares expose inferred middleware/factory type and route usage snippets. When `vext start` runs built output, Vext prefers `<project>/src` if source files are present so top-level JSDoc and local source links are preserved; if the source tree is not deployed, it falls back to the runtime directory.

### Routing level document configuration

Each route can configure its OpenAPI documentation information through `options.docs`:

```typescript
app.post('/users', {
  validate: { ... },
  docs: {
    //Interface summary (one sentence description)
    summary: 'Create user',

    // Detailed description (supports Markdown)
    description: 'Create a new user. \n\n**Note:** The email address must be unique. ',

    // Operation identifier (globally unique, automatically inferred by default)
    operationId: 'createUser',

    // Is it obsolete?
    deprecated: false,

    // Whether to hide from the document
    hidden: false,

    // Security scheme coverage
    security: [{ bearerAuth: [] }],

    // Custom response definition
    responses: {
      201: {
        description: 'Created successfully',
        schema: { id: 'string', name: 'string', email: 'email' },
      },
      409: {
        description: 'Email already exists',
      },
    },

    // Custom extension field (x- prefix)
    extensions: {
      'x-internal': true,
      'x-rate-limit': '10/min',
    },
  },
}, handler);
```

## docs Configuration details

### `summary` — interface summary

One sentence describing the interface function, displayed in the interface list of the document UI:

```typescript
docs: {
  summary: "Get user list";
}
```

### `description` — Detailed description

Detailed description of support for Markdown format is displayed when the interface is expanded:

```typescript
docs: {
  summary: 'Create user',
  description: `
Create a new user account.

**Prerequisites:**
- Requires administrator rights
- Email address must be unique

**Return value:**
- Returns the newly created user object on success
- Return 409 error when mailbox conflict occurs
  `,
}
```

### `tags` — deprecated operation tags

Route-level `docs.tags` is deprecated and ignored. Vext now infers one operation tag automatically from the route path, falling back to the source file only when needed:

```
/admin/check-role-test/override → Admin
/api/v1/info                  → API v1
/permission/roles/{id}        → Permission
```

If an existing route still sets `docs.tags`, Vext ignores that value and logs a deprecation warning. Remove the field from route definitions and rely on automatic path/source inference.

### `operationId` — operation identification

Globally unique operation identifier. If not specified, the framework automatically infers:

```
POST /users → operationId: 'createUsers'
GET /users → operationId: 'getUsers'
GET /users/:id → operationId: 'getUsersById'
PUT /users/:id → operationId: 'updateUsersById'
DELETE /users/:id → operationId: 'deleteUsersById'
```

```typescript
// Manually specify
docs: {
  operationId: "createNewUser";
}
```

### `hidden` — hide route

Routes you don't want to appear in the document (such as internal interfaces):

```typescript
app.get(
  "/internal/metrics",
  {
    docs: { hidden: true },
  },
  handler,
);

app.get(
  "/_health",
  {
    docs: { hidden: true },
  },
  handler,
);
```

### `deprecated` — Mark deprecated

Mark the interface as deprecated, and there will be a strikethrough and deprecation prompt in the document:

```typescript
app.get(
  "/v1/users",
  {
    docs: {
      summary: "Get user list (obsolete)",
      description: "Please use `/v2/users` instead",
      deprecated: true,
    },
  },
  handler,
);
```

### `security` — security solution

By default, the framework automatically infers the security scheme from the route's `middlewares`. Configure the mapping of middleware names to security schemes through `guardSecurityMap`:

```typescript
//config/default.ts
export default {
  openapi: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    guardSecurityMap: {
      auth: "bearerAuth", // middlewares contains 'auth' → mapped to bearerAuth
    },
  },
};
```

When routing uses `middlewares: ['auth']`, OpenAPI documents are automatically marked as requiring Bearer Token authentication.

Manual override:

```typescript
// No authentication required (even with auth middleware)
docs: {
  security: [];
}

//Specify a specific security scheme
docs: {
  security: [{ apiKeyAuth: [] }];
}
```

### `responses` — response definitions

Response document for custom routes. The key is the HTTP status code:

```typescript
docs: {
  responses: {
    200: {
      description: 'Successfully returned user list',
      schema: {
        id: 'string',
        name: 'string',
        email: 'email',
        role: 'admin|user',
      },
    },
    401: {
      description: 'Uncertified',
    },
    403: {
      description: 'Insufficient permissions',
    },
    500: {
      description: 'Server internal error',
    },
  },
}
```

Response `schema` uses the same DSL syntax as `validate`, automatically converted to JSON Schema.

#### Response example

```typescript
docs: {
  responses: {
    200: {
      description: 'User details',
      example: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'admin',
      },
    },
    404: {
      description: 'User does not exist',
      example: {
        code: 40001,
        message: 'User does not exist',
        requestId: 'xxx',
      },
    },
  },
}
```

#### Multiple response example

```typescript
docs: {
  responses: {
    200: {
      description: 'User details',
      examples: {
        admin: {
          summary: 'Administrator user',
          value: { id: '1', name: 'Admin', role: 'admin' },
        },
        regular: {
          summary: 'Ordinary user',
          value: { id: '2', name: 'User', role: 'user' },
        },
      },
    },
  },
}
```

#### Custom Content-Type

```typescript
docs: {
  responses: {
    200: {
      description: 'CSV export file',
      contentType: 'text/csv',
    },
  },
}
```

#### Response header

```typescript
docs: {
  responses: {
    200: {
      description: 'Success',
      headers: {
        'X-Total-Count': {
          description: 'Total number of records',
          schema: { type: 'integer' },
        },
        'X-Page': {
          description: 'Current page number',
          schema: { type: 'integer' },
        },
      },
    },
  },
}
```

## Automatic linkage between validate and document

The `validate` rule in the route is automatically mapped to the OpenAPI document, no need to write it again:

```typescript
app.get(
  "/users",
  {
    validate: {
      query: {
        page: "number:1-",
        limit: "number:1-100",
        status: "active|inactive|banned",
        keyword: "string?",
      },
    },
    docs: { summary: "Get user list" },
  },
  handler,
);
```

Automatically generated OpenAPI parameters:

| Parameters | Position | Type | Constraints |
| --------- | ----- | ------- | ------------------------------------------ |
| `page` | query | integer | minimum: 1 |
| `limit` | query | integer | minimum: 1, maximum: 100 |
| `status` | query | string | enum: ["active", "inactive", "banned"] |
| `keyword` | query | string | — |

Rules for `validate.body` are automatically mapped to `requestBody` (JSON schema):

```typescript
app.post(
  "/users",
  {
    validate: {
      body: {
        name: "string:1-50!",
        email: "email!",
        age: "number:0-150?",
      },
    },
  },
  handler,
);
```

Generated requestBody schema:

```json
{
  "type": "object",
  "required": ["name", "email"],
  "properties": {
    "name": { "type": "string", "minLength": 1, "maxLength": 50 },
    "email": { "type": "string", "format": "email" },
    "age": { "type": "number", "minimum": 0, "maximum": 150 }
  }
}
```

Field-level business descriptions can be written directly on DSL, and the generator will output it as `description` of OpenAPI schema:

```typescript
app.post(
  "/translate",
  {
    validate: {
      body: {
        content: "string:1-20000!".description(
          "Text to be translated, length 1-20000 characters",
        ),
        targetLanguages: [
          {
            code: "string:1-64!".description("target language code"),
          },
        ],
        format: "enum:plain_text,preserve_line_breaks".description("output format"),
      },
    },
  },
  handler,
);
```

The generated requestBody schema will contain:

```json
{
  "type": "object",
  "required": ["content"],
  "properties": {
    "content": {
      "type": "string",
      "minLength": 1,
      "maxLength": 20000,
      "description": "Text to be translated, length 1-20000 characters"
    },
    "format": {
      "type": "string",
      "enum": ["plain_text", "preserve_line_breaks"],
      "description": "Output format"
    }
  }
}
```

### File upload routing (multipart/form-data)

Use `RouteOptions.multipart.files` to declare the file upload route, and the generator automatically outputs `multipart/form-data` requestBody.

```typescript
app.post(
  "/upload/avatar",
  {
    middlewares: ["upload"],
    multipart: {
      files: {
        avatar: {
          description: "Avatar image (JPEG/PNG, maximum 5MB)",
          required: true,
        },
      },
    },
    docs: {
      summary: "Upload avatar",
    },
  },
  handler,
);
```

Generated OpenAPI snippet:

```json
{
  "requestBody": {
    "required": true,
    "content": {
      "multipart/form-data": {
        "schema": {
          "type": "object",
          "required": ["avatar"],
          "properties": {
            "avatar": {
              "type": "string",
              "format": "binary",
              "description": "Avatar image (JPEG/PNG, maximum 5MB)"
            }
          }
        }
      }
    }
  }
}
```

:::tip Relationship with validate.body
`multipart.files` and `validate.body` are mutually exclusive. When configured at the same time, `multipart.files` takes precedence.
:::

## Control by environment

It is recommended to enable documentation in the development environment and turn it off in the production environment:

```typescript
// src/config/default.ts
export default {
  openapi: {
    enabled: true,
    title: "My App API",
    docs: {
      path: "/docs",
      ui: {
        title: "My App API",
      },
    },
  },
};
```

```typescript
// src/config/production.ts
export default {
  openapi: {
    enabled: false, // Close the document in production environment
  },
};
```

If your production environment requires keeping API documentation (read-only reference):

```typescript
// src/config/production.ts
export default {
  openapi: {
    enabled: true,
    docs: {
      path: "/docs",
      access: {
        mode: "visibility-only",
      },
    },
  },
};
```

`visibility-only` keeps the public `/openapi.json` complete while the Vext Docs page, code docs, search data, and menu receive visibility-filtered data. Use `enforce` when hidden operations or code docs must also be removed from canonical docs data.

## Custom document path

Modify the registration paths of the two endpoints through `docs.path` and `jsonPath`. `docsPath` remains as a compatibility field, but new projects should prefer `docs.path`:

```typescript
export default {
  openapi: {
    enabled: true,
    docs: {
      path: "/api-docs", // Documentation: http://localhost:3000/api-docs
    },
    jsonPath: "/api/spec.json", // JSON: http://localhost:3000/api/spec.json
  },
};
```

### Reverse proxy path prefix scenario

When an application is deployed on a reverse proxy, it needs to be handled in two situations depending on whether the proxy **strips the prefix**.

#### Case 1: Proxy stripping prefix (`proxy_pass` with `/` at the end)

```

nginx
# Nginx: /admin/* → vext (strip /admin prefix)
location /admin/ {
    proxy_pass http://127.0.0.1:3000/;
}
```

At this time, the request path received by vext has removed `/admin`, and route registration does not need to change. But if the docs page still exposes `/openapi.json` as the public spec URL, the browser will request `https://example.com/openapi.json`, **losing the `/admin` prefix**, resulting in 404.

Use `jsonPublicPath` to tell the docs page to fetch the prefixed public address:

```typescript
// config/production.ts
export default {
  openapi: {
    enabled: true,
    // vext internal routing remains default
    jsonPath: "/openapi.json",
    docs: {
      path: "/docs",
    },
    // Tell Vext Docs to get the spec with the prefixed full path
    jsonPublicPath: "/admin/openapi.json",
  },
};
```

Request link:

```
Browser GET /admin/docs
  → Nginx strip /admin → vext GET /docs → return Vext Docs HTML
  → Vext Docs reads specPublicPath, fetch /admin/openapi.json
  → Nginx strip /admin → vext GET /openapi.json → return spec ✅
```

#### Scenario 2: Proxy transparent transmission prefix (`proxy_pass` does not have `/` at the end)

```

nginx
# Nginx:/admin/* → vext (retain /admin prefix transparent transmission)
location /admin/ {
    proxy_pass http://127.0.0.1:3000;
}
```

At this time, the request path received by vext still contains `/admin`, and the endpoint path needs to be configured synchronously. There is no need to configure `jsonPublicPath`:

```typescript
// config/production.ts
export default {
  openapi: {
    enabled: true,
    jsonPath: "/admin/openapi.json",
    docs: {
      path: "/admin/docs",
    },
  },
};
```

#### Comparison of two situations

| | Proxy stripping prefix | Proxy transparent transmission prefix |
| ------------------ | ----------------------------------------------- | ---------------------------------- |
| Nginx `proxy_pass` | `http://127.0.0.1:3000/` (with `/` at the end) | `http://127.0.0.1:3000` (without `/` at the end) |
| `jsonPath` | `/openapi.json` (default) | `/admin/openapi.json` |
| `docs.path` | `/docs` (default) | `/admin/docs` |
| `jsonPublicPath` | `/admin/openapi.json` (**must be configured**) | No configuration required |

### `servers` — document interaction address

`servers` is a metadata field written to the OpenAPI specification document itself, independent of the endpoint registration path. Documentation UIs and third-party tools can use it as the base address for interactive requests.

**Default behavior** (when not configured):

```json
{ "url": "/", "description": "Current server" }
```

The relative path `/` will automatically follow the domain name of the current page, and **the default value is sufficient in most cases**.

**Scenarios that require explicit configuration**:

- The documentation page and the API are not in the same domain (cross-domain)
- You want documentation UIs or third-party tools to expose environment switching

```typescript
export default {
  openapi: {
    enabled: true,
    servers: [
      { url: "https://sit-api.example.com/admin", description: "SIT environment" },
      { url: "https://api.example.com/admin", description: "Production environment" },
    ],
  },
};
```

After configuration, documentation UIs or tools that support `servers` can let users switch the target environment.

## Import external OpenAPI

The default Vext Docs page focuses on the OpenAPI document generated by the current application. To aggregate multiple external OpenAPI documents, use an external documentation platform or standalone UI outside Vext and point it at each service's `/openapi.json`. Vext does not expose a third-party docs renderer hook or install documentation UI packages.

## Integrate with third-party tools

### Export OpenAPI specification

Visit `http://localhost:3000/openapi.json` to get the complete OpenAPI 3.0 JSON file, which can be used for:

- **Postman** — import API collection
- **Insomnia** — Import API workspace
- **Code Generation** — Use `openapi-generator` to generate client SDK
- **API Gateway** — Import to Kong, AWS API Gateway, and more
- **Documentation Platform** — Import into Stoplight, ReadMe, and more

### Example: Generate TypeScript client

```bash
npx openapi-generator-cli generate \
  -i http://localhost:3000/openapi.json \
  -g typescript-fetch \
  -o ./generated/api-client
```

## Documentation Best Practices

### 1. Always provide `summary`

`summary` is the most important identifier of the interface in the document list and should be concise and clear:

```typescript
// ✅ OK summary
docs: {
  summary: "Get user list";
}
docs: {
  summary: "Create order";
}
docs: {
  summary: "Upload user avatar";
}

// ❌ bad summary
docs: {
  summary: "This interface is used to obtain list data of all users in the system";
} // too long
docs: {
  summary: "GET users";
} // no value
```

### 2. Use consistent tags

Use Chinese or English tags uniformly, and predefine the order and description in global `tags`:

```typescript
// ✅ Define uniformly in config
openapi: {
  tags: [
    { name: 'Authentication', description: 'Login, registration, Token management' },
    { name: 'User', description: 'User CRUD' },
    { name: 'Order', description: 'Order Management' },
    { name: 'System', description: 'Health check, configuration information' },
  ],
}
```

### 3. Add documentation for error responses

Common error codes should be described in `responses`:

```typescript
docs: {
  summary: 'Create user',
  responses: {
    201: { description: 'Created successfully' },
    400: { description: 'Incorrect request parameter' },
    401: { description: 'Uncertified' },
    409: { description: 'Mailbox already exists' },
    422: { description: 'Parameter verification failed' },
  },
}
```

### 4. Hide internal interfaces

Interfaces used internally by the framework or for operation and maintenance should be marked as `hidden`:

```typescript
// Health checks, indicators, debugging interfaces, etc.
app.get("/health", { docs: { hidden: true } }, handler);
app.get("/metrics", { docs: { hidden: true } }, handler);
app.get("/debug/config", { docs: { hidden: true } }, handler);
```

### 5. Make good use of `deprecated`

When iterating the API version, use `deprecated` instead of directly deleting the old interface:

```typescript
//v1 interface mark is obsolete
app.get(
  "/v1/users",
  {
    docs: {
      summary: "Get user list (v1)",
      deprecated: true,
      description: "This interface is deprecated, please use `GET /v2/users`",
    },
  },
  handler,
);

// v2 new interface
app.get(
  "/v2/users",
  {
    docs: {
      summary: "Get user list",
    },
  },
  handler,
);
```

## Multi-level directory example

VextJS's file routing supports multi-level nested directories, and each level of directory is automatically mapped to a URL path segment. The default Vext Docs page uses those OpenAPI path segments to build recursive API navigation, keeps stable resource-level segments as categories, and shows concrete operation leaves under that directory. Operation leaves prefer `docs.summary`; if no summary is configured, they fall back to the endpoint path. Dynamic path parameters such as `{id}` are treated as parameters rather than normal business directories. Operation tags are inferred automatically from the route path/source and shown as lightweight metadata badges; explicit `x-tagGroups` remains available only as vendor extension metadata.

### Directory structure

```bash
src/routes/
├── index.ts # → /
├── api/
│ └── v1/
│ ├── index.ts # → /api/v1
│ ├── users.ts # → /api/v1/users
│ ├── users/
│ │ └── [id]/
│ │ └── orders.ts # → /api/v1/users/:id/orders
│ └── admin/
│ ├── dashboard.ts # → /api/v1/admin/dashboard
│ └── users.ts # → /api/v1/admin/users
└── webhooks/
    └── stripe.ts # → /webhooks/stripe
```

### Path mapping comparison

| File path | URL prefix | Description |
| ------------------------------------ | -------------------------------- | -------------------------------- |
| `routes/index.ts` | `/` | Root route (health check) |
| `routes/api/v1/index.ts` | `/api/v1` | API version entry |
| `routes/api/v1/users.ts` | `/api/v1/users` | User public interface |
| `routes/api/v1/users/[id]/orders.ts` | `/api/v1/users/:id/orders` | User orders (dynamic parameter nesting) |
| `routes/api/v1/admin/dashboard.ts` | `/api/v1/admin/dashboard` | Management backend dashboard |
| `routes/api/v1/admin/users.ts` | `/api/v1/admin/users` | Management background user management |
| `routes/webhooks/stripe.ts` | `/webhooks/stripe` | Stripe callbacks |

### Global tags description

Predefine global tags only when you want to add descriptions for automatically inferred operation tags. Path segments remain the default navigation source:

```typescript
// src/config/default.ts
export default {
  port: 3000,
  openapi: {
    enabled: true,
    title: "My App API",
    version: "2.0.0",
    tags: [{ name: "API v1", description: "Version 1 API endpoints" }],
  },
};
```

### Each routing file

#### `routes/api/v1/users.ts` — User public interface

```typescript
// src/routes/api/v1/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/v1/users → User list
  app.get(
    "/",
    {
      validate: {
        query: {
          page: "number:1-",
          limit: "number:1-50",
          role: "admin|user?",
        },
      },
      docs: {
        summary: "Get user list",
      },
    },
    async (req, res) => {
      const filters = req.valid("query");
      const users = await app.services.user.findAll(filters);
      res.json(users);
    },
  );

  // GET /api/v1/users/:id → user details
  app.get(
    "/:id",
    {
      validate: { param: { id: "string!" } },
      docs: {
        summary: "Get user details",
        responses: {
          200: { description: "User information" },
          404: { description: "User does not exist" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);
      if (!user) app.throw(404, "user.not_found");
      res.json(user);
    },
  );
});
```

#### `routes/api/v1/users/[id]/orders.ts` — User orders (multi-level dynamic parameters)

```typescript
// src/routes/api/v1/users/[id]/orders.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/v1/users/:id/orders → the user’s order list
  app.get(
    "/",
    {
      validate: {
        param: { id: "string!" },
        query: {
          status: "pending|paid|shipped|completed?",
          limit: "number:1-100",
        },
      },
      docs: {
        summary: "Get user order list",
        description: "Get all orders of the specified user, support filtering by status.",
        responses: {
          200: { description: "Order List" },
          404: { description: "User does not exist" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const filters = req.valid("query");
      const orders = await app.services.order.findByUserId(id, filters);
      res.json(orders);
    },
  );

  // GET /api/v1/users/:id/orders/:orderId → order details
  app.get(
    "/:orderId",
    {
      validate: {
        param: { id: "string!", orderId: "string!" },
      },
      docs: {
        summary: "Get order details",
      },
    },
    async (req, res) => {
      const { id, orderId } = req.valid("param");
      const order = await app.services.order.findOne(id, orderId);
      if (!order) app.throw(404, "order.not_found");
      res.json(order);
    },
  );
});
```

#### `routes/api/v1/admin/dashboard.ts` — Management background

```typescript
// src/routes/api/v1/admin/dashboard.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/v1/admin/dashboard/stats → statistics
  app.get(
    "/stats",
    {
      middlewares: [
        "auth",
        { name: "check-role", options: { roles: ["admin"] } },
      ],
      docs: {
        summary: "Get dashboard statistics",
        responses: {
          200: {
            description: "statistics",
            example: {
              totalUsers: 1024,
              activeToday: 256,
              totalOrders: 8192,
              revenue: 99999.99,
            },
          },
          401: { description: "Not authenticated" },
          403: { description: "Insufficient permissions" },
        },
      },
    },
    async (_req, res) => {
      const stats = await app.services.dashboard.getStats();
      res.json(stats);
    },
  );
});
```

#### `routes/api/v1/admin/users.ts` — Management backend user management

```typescript
// src/routes/api/v1/admin/users.ts
import { defineRoutes } from "vextjs";export default defineRoutes((app) => {
  // GET /api/v1/admin/users → Administrator views all users
  app.get(
    "/",
    {
      middlewares: [
        "auth",
        { name: "check-role", options: { roles: ["admin"] } },
      ],
      validate: {
        query: {
          page: "number:1-",
          limit: "number:1-100",
          status: "active|banned|suspended?",
        },
      },
      docs: {
        summary: "Administrator views user list",
        description: "Exclusively for administrators, supports filtering by user status and returns complete user information.",
      },
    },
    async (req, res) => {
      const filters = req.valid("query");
      const users = await app.services.user.adminFindAll(filters);
      res.json(users);
    },
  );

  // PATCH /api/v1/admin/users/:id/ban → Ban user
  app.patch(
    "/:id/ban",
    {
      middlewares: [
        "auth",
        { name: "check-role", options: { roles: ["admin"] } },
      ],
      validate: {
        param: { id: "string!" },
        body: { reason: "string:1-500!" },
      },
      docs: {
        summary: "Ban user",
        responses: {
          200: { description: "Banned successfully" },
          404: { description: "User does not exist" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const { reason } = req.valid("body");
      await app.services.user.ban(id, reason);
      res.json({ success: true });
    },
  );
});
```

#### `routes/webhooks/stripe.ts` — Third-party callbacks

```typescript
// src/routes/webhooks/stripe.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // POST /webhooks/stripe → Stripe event callback
  app.post(
    "/",
    {
      validate: {
        header: { "stripe-signature": "string!" },
      },
      docs: {
        summary: "Stripe Webhook callback",
        description: "Receive notification of Stripe payment events. Requires signature verification.",
        responses: {
          200: { description: "Processed successfully" },
          400: { description: "Signature verification failed" },
        },
      },
    },
    async (req, res) => {
      const signature = req.valid("header")["stripe-signature"];
      await app.services.payment.handleStripeWebhook(req.body, signature);
      res.json({ received: true });
    },
  );
});
```

### Generated OpenAPI path

The above directory structure finally automatically generates the following OpenAPI paths. The default Vext Docs sidebar follows the path segments; tags remain operation metadata:

| OpenAPI Path | Method | Tag | Source File |
| --------------------------------------- | ----- | ----------- | --------------------------------------- |
| `/api/v1/users` | GET | v1/users | `api/v1/users.ts` |
| `/api/v1/users/{id}` | GET | v1/users | `api/v1/users.ts` |
| `/api/v1/users/{id}/orders` | GET | v1/userorders | `api/v1/users/[id]/orders.ts` |
| `/api/v1/users/{id}/orders/{orderId}` | GET | v1/userorders | `api/v1/users/[id]/orders.ts` |
| `/api/v1/admin/dashboard/stats` | GET | v1/admin backend | `api/v1/admin/dashboard.ts` |
| `/api/v1/admin/users` | GET | v1/admin backend | `api/v1/admin/users.ts` |
| `/api/v1/admin/users/{id}/ban` | PATCH | v1/admin backend | `api/v1/admin/users.ts` |
| `/webhooks/stripe` | POST | Webhook | `webhooks/stripe.ts` |

:::tip Best practices for multi-level directories

- **Use directory hierarchy to express URL structure**: `api/v1/admin/` is automatically mapped to `/api/v1/admin/` prefix, no manual splicing is required
- **Dynamic parameters use the `[param]` directory**: `users/[id]/orders.ts` automatically becomes `/users/:id/orders`, and the `param` verification in the file will appear in the OpenAPI document
- **automatic operation tags**: route-level `docs.tags` is deprecated and ignored; Vext infers operation tags from route path/source while the built-in docs page uses path segments for navigation
- **The file name is the route**: No need for `app.group()` or manual registration of routing prefixes, the directory structure is the routing structure
  :::

## Tag groups (x-tagGroups)

The `tags` of the OpenAPI 3.x specification are **one-dimensional flat lists** and do not natively support nesting levels. When there are a large number of routes, all tags can become flat and hard to browse in a docs sidebar.

VextJS passes through `x-tagGroups` only when you explicitly configure `openapi.tagGroups`. The built-in Vext Docs renderer uses OpenAPI path segments as its primary recursive sidebar navigation, so `x-tagGroups` is treated as raw OpenAPI vendor extension metadata rather than a Vext Docs navigation feature.

### Default behavior

VextJS does not generate `x-tagGroups` by default. The built-in Vext Docs renderer uses OpenAPI path segments as the source of truth for recursive navigation, so automatic tag grouping is unnecessary and can create misleading groups such as `General / Admin`.

Route-level `docs.tags` is deprecated and ignored. If another OpenAPI tool in your delivery chain needs `x-tagGroups`, explicitly specify `tagGroups` in the configuration and make sure the names match the automatically inferred operation tags or the global `openapi.tags` entries:

```typescript
// src/config/app.ts
export default {
  port: 3000,
  openapi: {
    enabled: true,
    title: "My API",
    version: "1.0.0",

    // Explicit vendor extension pass-through for OpenAPI tools
    tagGroups: [
      {
        name: "Public API",
        tags: ["API v1"],
      },
      {
        name: "Integration",
        tags: ["Webhooks"],
      },
    ],

    // Optional descriptions for automatically inferred operation tags.
    tags: [
      { name: "API v1", description: "Version 1 API endpoints" },
      { name: "Webhooks", description: "Third-party callbacks" },
    ],
  },
};
```

:::warning
`tagGroups` is emitted only when configured. Make sure every grouped tag name matches an operation tag or a global `tags` entry expected by the tool that consumes the OpenAPI document.
:::

### Effect comparison

| Default Vext Docs | Explicit x-tagGroups |
| :----------------------------------------------------------------: | :----------------------------------------------------------------: |
| Sidebar follows OpenAPI path segments | OpenAPI document includes explicit vendor extension metadata |
| `/api/v1/info` stays a resource category | **Public API** ▸ API v1 / **Integration** ▸ Webhooks |
| Tags remain operation metadata | Suitable only when a downstream OpenAPI tool explicitly consumes `x-tagGroups` |

### Compatibility with hot reload

In dev mode, soft reload automatically regenerates the OpenAPI spec. If `openapi.tagGroups` is configured, the explicit `x-tagGroups` block is emitted again:

1. Routing file changes → trigger hot reload
2. Create a new adapter instance
3. Reload routing + collect routing meta information
4. Regenerate OpenAPI spec (including explicit `x-tagGroups`, when configured)
5. Re-register the `/docs` and `/openapi.json` endpoints on the new adapter

No need to restart the dev server, refresh the document page to see the updated grouping.

## Complete example

```typescript
// src/routes/orders.ts
import { defineRoutes } from "vextjs";export default defineRoutes((app) => {
  // Get order list
  app.get(
    "/",
    {
      validate: {
        query: {
          page: "number:1-",
          limit: "number:1-50",
          status: "pending|paid|shipped|completed|cancelled",
          startDate: "date?",
          endDate: "date?",
        },
      },
      middlewares: ["auth"],
      docs: {
        summary: "Get order list",
        description: "Get the current user's order list in pages, supporting filtering by status and date range.",
        responses: {
          200: {
            description: "Order List",
            headers: {
              "X-Total-Count": {
                description: "Total number of orders",
                schema: { type: "integer" },
              },
            },
          },
        },
      },
    },
    async (req, res) => {
      const filters = req.valid("query");
      const orders = await app.services.order.findAll(filters);
      res.json(orders);
    },
  );

  //Create order
  app.post(
    "/",
    {
      validate: {
        body: {
          productId: "string!",
          quantity: "number:1-99!",
          shippingAddress: "string:1-200!",
          couponCode: "string?",
        },
      },
      middlewares: ["auth"],
      docs: {
        summary: "Create order",
        responses: {
          201: {
            description: "Order created successfully",
            example: {
              orderId: "ord_abc123",
              status: "pending",
              total: 99.99,
            },
          },
          400: { description: "Insufficient stock or invalid coupon" },
          401: { description: "Not authenticated" },
        },
      },
    },
    async (req, res) => {
      const data = req.valid("body");
      const order = await app.services.order.create(data);
      res.json(order, 201);
    },
  );

  // Cancel order
  app.post(
    "/:id/cancel",
    {
      validate: {
        param: { id: "string!" },
        body: { reason: "string:1-500?" },
      },
      middlewares: ["auth"],
      docs: {
        summary: "Cancel order",
        responses: {
          200: { description: "Cancellation successful" },
          400: { description: "Order status does not allow cancellation" },
          404: { description: "Order does not exist" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const { reason } = req.valid("body");
      await app.services.order.cancel(id, reason);
      res.json({ success: true });
    },
  );
});
```

## Next step

- Understand how the DSL syntax of [Parameter Validation](/guide/validation) maps to OpenAPI
- Learn the complete options of OpenAPI in [Configuration](/guide/configuration)
- See [Adapter Architecture](/guide/adapters) to understand the document behavior under different Adapters
- Discover how [Testing](/guide/testing) verifies the accuracy of API documentation

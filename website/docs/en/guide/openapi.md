# OpenAPI Documentation

VextJS has built-in automatic generation of OpenAPI documentation. Based on the `validate` and `docs` configuration of the route, the framework automatically generates the JSON document of the OpenAPI 3.0 specification and provides [Scalar API Reference](https://github.com/scalar/scalar) for online viewing and interactive debugging.

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
        tags: ["User Management"],
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
        tags: ["User Management"],
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
| `http://localhost:3000/docs` | Scalar API Reference documentation interface (including built-in Try it out) |
| `http://localhost:3000/openapi.json` | OpenAPI JSON specification file |

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

    // Scalar document path
    docsPath: "/docs",

    //OpenAPI JSON path
    jsonPath: "/openapi.json",

    // Reverse proxy public path (configured when the proxy strips the prefix, see the "Customized Document Path" chapter for details)
    // jsonPublicPath: '/admin/openapi.json',

    // Scalar API Reference configuration
    scalar: {
      theme: "default", // Theme: 'default' | 'moon' | 'purple' | 'solarized' | ...
      darkMode: false, // dark mode
      layout: "modern", // Layout: 'modern' (three columns) | 'classic' (two columns)
      favicon: "/favicon.svg", // Document page icon
    },

    // API server list
    servers: [
      { url: "http://localhost:3000", description: "Local development" },
      { url: "https://api.myapp.com", description: "Production environment" },
    ],

    // Tag definition (control grouping order and description)
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

    // Tag grouping (default inferred from route file path)
    tags: ['User Management'],

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

### `tags` — tag grouping

Controls the grouping of interfaces in the document. If not specified, the framework will automatically infer from the route file path:

```
src/routes/users.ts → default tag: 'users'
src/routes/admin/users.ts → default tag: 'admin'
```

```typescript
// Manually specified (overrides automatic inference)
docs: {
  tags: ["User Management", "Management Backstage"];
}
```

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
      tags: ["user"],
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
    scalar: {
      theme: "default",
      favicon: "/favicon.svg",
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
    scalar: {
      darkMode: false,
    },
  },
};
```

## Custom document path

Modify the registration paths of the two endpoints through `docsPath` and `jsonPath`:

```typescript
export default {
  openapi: {
    enabled: true,
    docsPath: "/api-docs", // Documentation: http://localhost:3000/api-docs
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

At this time, the request path received by vext has removed `/admin`, and the route registration does not need to be modified. But the spec URL in Scalar HTML is an absolute path (such as `/openapi.json`), and the browser will request `https://example.com/openapi.json`, **losing the `/admin` prefix**, resulting in 404.

You need to tell Scalar to use the prefixed public address via `jsonPublicPath`:

```typescript
// config/production.ts
export default {
  openapi: {
    enabled: true,
    // vext internal routing remains default
    jsonPath: "/openapi.json",
    docsPath: "/docs",
    // Tell Scalar HTML to get the spec with the prefixed full path
    jsonPublicPath: "/admin/openapi.json",
  },
};
```

Request link:

```
Browser GET /admin/docs
  → Nginx strip /admin → vext GET /docs → return Scalar HTML
  → Scalar reads jsonPublicPath, fetch /admin/openapi.json
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
    docsPath: "/admin/docs",
  },
};
```

#### Comparison of two situations

| | Proxy stripping prefix | Proxy transparent transmission prefix |
| ------------------ | ----------------------------------------------- | ---------------------------------- |
| Nginx `proxy_pass` | `http://127.0.0.1:3000/` (with `/` at the end) | `http://127.0.0.1:3000` (without `/` at the end) |
| `jsonPath` | `/openapi.json` (default) | `/admin/openapi.json` |
| `docsPath` | `/docs` (default) | `/admin/docs` |
| `jsonPublicPath` | `/admin/openapi.json` (**must be configured**) | No configuration required |

### `servers` — document interaction address`servers` is a metadata field written to the OpenAPI specification document itself, independent of the endpoint registration path. Its only purpose is to tell Scalar's "Try it out" function which base address to use when making requests.

**Default behavior** (when not configured):

```json
{ "url": "/", "description": "Current server" }
```

The relative path `/` will automatically follow the domain name of the current page, and **the default value is sufficient in most cases**.

**Scenarios that require explicit configuration**:

- The documentation page and the API are not in the same domain (cross-domain)
- Hope to provide a multi-environment switching drop-down box at the top of Scalar

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

After configuration, a server drop-down box appears at the top of Scalar, and users can manually switch the target environment.

## Import external OpenAPI

Scalar supports loading multiple OpenAPI documents simultaneously, displaying a switcher at the top of the documentation page. Configure via `scalar.sources`:

```typescript
export default {
  openapi: {
    enabled: true,
    scalar: {
      sources: [
        // The spec automatically generated by the framework will be injected as the first source (no need to add it manually)
        {
          title: "Partner API",
          url: "https://partner.example.com/openapi.json",
          slug: "partner",
        },
        {
          title: "Payment API",
          url: "https://pay.example.com/v1/openapi.json",
          slug: "payment",
        },
      ],
    },
  },
};
```

Each source supports the following fields:

| Field | Type | Description |
| --------- | -------- | ----------------------------------------------- |
| `title` | `string` | Document title (shown in switcher) |
| `url` | `string` | OpenAPI canonical URL (remote or local endpoint) |
| `content` | `string` | OpenAPI specification inline JSON string (alternative to `url`) |
| `slug` | `string` | URL slug identifier (e.g. `/docs#/slug`) |

:::tip automatic injection
When `sources` is configured, the `/openapi.json` automatically generated by the framework will be injected as the first source (unless the same path is already included in sources), without manual repeated declaration.
:::

Specs can also be provided inline via `content` (suitable for small/fixed specs):

```typescript
scalar: {
  sources: [
    {
      title: 'Mock API',
      content: JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Mock', version: '1.0.0' },
        paths: {},
      }),
      slug: 'mock',
    },
  ],
}
```

## Local asset automatic service (v0.3.0+)

Starting from **v0.3.0**, when `openapi.enabled: true`, the framework **forces** Scalar JS to be served locally and no longer relies on an external CDN. This solves the problem of white screen or slow loading in mainland China, intranet, and offline environments.

### Working principle

The framework automatically performs the following processes at startup:

```
1. Check whether @scalar/api-reference is installed
   ├─ Installed → Read local files and register GET /_vext/scalar.js route
   └─ Not installed → Detect package manager (pnpm/yarn/bun/npm) → Automatically install → Register route
```

The `<script src>` of the `/docs` page will automatically point to `/_vext/scalar.js` (the local route) instead of the CDN address.

### Manual preinstallation (recommended for production environment)

Automated installation relies on runtime network access and is not suitable for Docker/K8s read-only containers or CI/CD deployments. It is recommended to install it in advance during the build phase:

```bash
#npm
npm install @scalar/api-reference --no-save

#pnpm
pnpm add @scalar/api-reference

# yarn
yarn add @scalar/api-reference

# bun
bun add @scalar/api-reference
```

:::tip Best practices for production environments
Install `@scalar/api-reference` in advance in the dependency installation step in `Dockerfile` to avoid triggering network requests when the container starts:

```dockerfile
RUN npm install && npm install @scalar/api-reference --no-save
```

:::

:::warning Installation failed
If the automatic installation fails (e.g. without network access), the framework will throw an explicit error and prompt for a manual installation command without silently downgrading back to the CDN.
:::

### Use custom address (override local service)

If you have special needs (such as intranet CDN mirroring, version locking), you can explicitly specify the loading address through `scalar.cdnUrl`. After configuration, the framework **skips** local detection and installation and directly uses the address you provided:

```typescript
export default {
  openapi: {
    enabled: true,
    scalar: {
      // Lock a specific version (the framework will no longer automatically install local packages at this time)
      cdnUrl: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0",

      // Or use intranet CDN mirroring
      // cdnUrl: 'https://static.internal.com/libs/scalar-api-reference.js',
    },
  },
};
```

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
      tags: ["user v2"],
    },
  },
  handler,
);
```

## Multi-level directory example

VextJS's file routing supports multi-level nested directories, and each level of directory is automatically mapped to a URL path segment. With `tags` grouping, multi-level routes are automatically classified and displayed in the Scalar document page.

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

### Global tags definition

Predefine tags in the configuration, and Scalar documents will be displayed in groups by tags:

```typescript
// src/config/default.ts
export default {
  port: 3000,
  openapi: {
    enabled: true,
    title: "My App API",
    version: "2.0.0",
    tags: [
      { name: "v1/user", description: "User public interface" },
      { name: "v1/user order", description: "User associated order" },
      { name: "v1/Management Backend", description: "Administrator Private Interface" },
      { name: "Webhook", description: "Third-party callback" },
    ],
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
        tags: ["v1/user"],
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
        tags: ["v1/user"],
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
        tags: ["v1/user order"],
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
        tags: ["v1/user order"],
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
        tags: ["v1/administration background"],
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
        tags: ["v1/administration background"],
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
        tags: ["v1/administration background"],
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
        tags: ["Webhook"],
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

The above directory structure finally automatically generates the following OpenAPI path, which is displayed in groups by tags in the Scalar document:

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
- **tags unified management**: tags are predefined in the global configuration, each routing file is referenced through `docs.tags`, and Scalar documents are grouped by tags
- **The file name is the route**: No need for `app.group()` or manual registration of routing prefixes, the directory structure is the routing structure
  :::

## Tag groups (x-tagGroups)

The `tags` of the OpenAPI 3.x specification are **one-dimensional flat lists** and do not natively support nesting levels. When there are a large number of routes, all tags are tiled and juxtaposed in the sidebar of the Scalar document, making navigation inconvenient.

VextJS implements **two-level navigation** through [`x-tagGroups` extension supported by Scalar](https://github.com/scalar/scalar): multiple tags are classified into higher-level groups (groups) and displayed as collapsible grouping levels in the Scalar sidebar.

### Automatic inference (default behavior)

When routing files are spread across multiple top-level directories, the framework **automatically infers** `x-tagGroups`:

- Extract the **first-level directory name** after `routes/` of each route file as the group name (the first letter is capitalized)
- Files located directly under `routes/` are grouped into the **"General"** group
- Do not generate `x-tagGroups` if all routes are in the same group (avoid redundancy)

```
src/routes/
├── health.ts → Group: General
├── api/
│ ├── users.ts → Group: Api
│ └── orders.ts → Group: Api
├──admin/
│ ├── dashboard.ts → Group: Admin
│ └── users.ts → Group: Admin
└── webhooks/
    └── stripe.ts → Grouping: Webhooks
```

Generated `x-tagGroups`:

```json
{
  "x-tagGroups": [
    { "name": "Admin", "tags": ["admin-dashboard", "admin-users"] },
    { "name": "Api", "tags": ["api-orders", "api-users"] },
    { "name": "Webhooks", "tags": ["webhooks-stripe"] },
    { "name": "General", "tags": ["health"] }
  ]
}
```

:::tip
The groups are sorted alphabetically, with **General always coming last**. Tags within the same group are also sorted alphabetically and automatically deduplicated.
:::

### Manual configuration (overrides automatic inference)

If the automatically inferred groupings do not meet your needs, you can explicitly specify `tagGroups` in the configuration:

```typescript
// src/config/app.ts
export default {
  port: 3000,
  openapi: {
    enabled: true,
    title: "My API",
    version: "1.0.0",

    // Manually configure label grouping
    tagGroups: [
      {
        name: "User API",
        tags: ["users", "user-profile", "user-orders"],
      },
      {
        name: "Administration",
        tags: ["admin-dashboard", "admin-users"],
      },
      {
        name: "Integration",
        tags: ["webhooks"],
      },
    ],

    // tags definition (optional, provide description information)
    tags: [
      { name: "users", description: "User public interface" },
      { name: "user-profile", description: "user profile" },
      { name: "user-orders", description: "user-orders" },
      { name: "admin-dashboard", description: "Admin dashboard" },
      { name: "admin-users", description: "Administrative background user management" },
      { name: "webhooks", description: "Third-party callbacks" },
    ],
  },
};
```

:::warning
After `tagGroups` is configured, the framework no longer automatically infers it and uses user configuration directly. Please make sure that all tags are covered into at least one group, otherwise ungrouped tags may not be displayed in Scalar.
:::

### Effect comparison

| Without x-tagGroups | With x-tagGroups |
| :----------------------------------------------------------------: | :----------------------------------------------------------------: |
| All tags are tiled in the sidebar | tags are displayed collapsed by group |
| `users` / `admin-dashboard` / `orders` / `webhooks` parallel | **User API** ▸ users, orders / **Admin** ▸ admin-dashboard |
| Suitable for a small number of routes | Suitable for projects with a large number of routes |

### Compatibility with hot reload

In dev mode, soft reload will automatically regenerate `x-tagGroups`:

1. Routing file changes → trigger hot reload
2. Create a new adapter instance
3. Reload routing + collect routing meta information
4. Regenerate OpenAPI spec (including `x-tagGroups`)
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
        tags: ["Order"],
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
        tags: ["Order"],
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
        tags: ["Order"],
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
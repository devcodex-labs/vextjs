# Parameter validation

VextJS integrates [schema-dsl](https://github.com/devcodex-labs/schema-dsl) for **declarative parameter validation**. In route `options.validate`, use DSL strings or supported field schemas. The framework validates and converts inputs; when OpenAPI is enabled, it projects supported rules into documentation. Parameter validation does not provide authentication, authorization, or database uniqueness.

## Basic usage

Prerequisite: a TypeScript project with `dev`, `build`, and `start` scripts created from [Quick Start](/guide/quick-start). These configuration and route files form a standalone API example; merge them into an existing project as appropriate. It echoes validation results to show conversion and errors without a business service.

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: "native",
  frontend: { enabled: false },
} satisfies VextUserConfig;
```

Declare rules in the `validate` field of a three-part route:

```typescript
// src/routes/validation.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/users",
    {
      validate: {
        body: {
          name: "string:1-50!", // Required, length 1–50
          email: "email!", // Required email
          age: "number?", // Optional number
          role: "admin|user", // Enum
        },
      },
      docs: { summary: "Create a user" },
    },
    async (req, res) => {
      // Read the separate validated result; do not assume req.body is rewritten.
      const data = req.valid("body");
      res.json(data, 201);
    },
  );
  app.get(
    "/items/:id",
    {
      validate: {
        param: { id: "integer:1-!" },
        query: { active: "boolean?" },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const { active } = req.valid("query");
      res.json({ id, active });
    },
  );
});
```

Run `npm run dev`. When the ready message shows the listening address, send requests from another terminal:

```bash
curl -i -H "Content-Type: application/json" -d '{"name":"Bob","email":"bob@example.com","age":"42","role":"user"}' http://127.0.0.1:3000/validation/users
curl -i -H "Content-Type: application/json" -d '{"name":"Bob","email":"invalid"}' http://127.0.0.1:3000/validation/users
curl -i "http://127.0.0.1:3000/validation/items/42?active=true"
curl -i "http://127.0.0.1:3000/validation/items/nope?active=1"
curl -i "http://127.0.0.1:3000/validation/items/42?active=1"
```

Expected results, in order: 201 (`data.age` is number 42), 422 (invalid email), 200 (`data.id` is number 42 and `active` is true), 400 (path param fails first), and 422 (string `1` is not accepted as boolean). Valid JSON syntax does not imply valid fields. Malformed JSON is usually rejected earlier by the body parser with 400.

In Windows PowerShell, use `curl.exe` for GET. For JSON POST, avoid shell quoting differences with:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/validation/users' -ContentType 'application/json' -Body '{"name":"Bob","email":"bob@example.com","age":"42","role":"user"}'
```

Stop the dev server with Ctrl+C. Run `npm run build` and `npm start`, then repeat the requests to confirm the production behavior. If the port is busy, change the example configuration and request URL or stop your own old example process.

Later snippets without a file header are independent route fragments. Their `handler`, business services, and auth middleware must be supplied by your app; do not register every fragment unchanged in one app.

After validation passes, read converted data through `req.valid(location)`. Invalid path `param` returns HTTP 400; invalid `query`, `header`, `cookie`, or `body` returns HTTP 422 before the handler runs.

## Validation locations

`validate` supports five locations, corresponding to different data sources requested:

| Location | Data Source   | Description                              |
| -------- | ------------- | ---------------------------------------- |
| `param`  | `req.params`  | Path dynamic parameters (such as `/:id`) |
| `query`  | `req.query`   | URL query parameters (such as `?page=1`) |
| `header` | `req.headers` | Request headers                          |
| `cookie` | `req.cookies` | Parsed Cookie values                     |
| `body`   | `req.body`    | Request body (JSON/URL-encoded)          |

Validation runs in the order `param` → `query` → `header` → `cookie` → `body` and stops at the first failed location. Rules are compiled at route registration and reused for requests. Use lowercase header field names; `req.valid("header")` projects only declared fields and returns lowercase keys. A parsed cookie string is not proof of a valid cookie signature or login session.

```typescript
app.put(
  "/users/:id",
  {
    validate: {
      param: {
        id: "string!",
      },
      query: {
        fields: "string?", // Optional, specify the return field
      },
      header: {
        "x-api-version": "string?",
      },
      cookie: {
        sid: "string?",
      },
      body: {
        name: "string:1-50?",
        email: "email?",
      },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const cookies = req.valid("cookie");
    const body = req.valid("body");
    const user = await app.services.user.update(id, body);
    res.json(user);
  },
);
```

::::tip note
The singular `param` is used in `validate` (corresponding to the concept of path parameters), but the underlying data source is `req.params` (plural). The mapping has been done correctly inside the framework, you don’t need to worry about it.

If a dynamic path uses `:id` or `*path` without `validate.param`, OpenAPI still emits a `required: true` string path parameter for that segment so the path template remains valid. Declare `validate.param` when you need stricter type, length, or format constraints.
::::

<a id="dsl-syntax"></a>

## Detailed explanation of DSL syntax

schema-dsl uses concise string expressions to describe data types and constraints.

### Basic types

| DSL expression | Meaning       | Example values          |
| -------------- | ------------- | ----------------------- |
| `'string'`     | string        | `"hello"`               |
| `'number'`     | Number        | `42`, `3.14`            |
| `'integer'`    | Integer       | `1`, `42`               |
| `'boolean'`    | Boolean value | `true`, `false`         |
| `'email'`      | Email format  | `"user@example.com"`    |
| `'url'`        | URL format    | `"https://example.com"` |
| `'date'`       | Date string   | `"2026-01-15"`          |

### Required and optional

Add a `!` or `?` tag at the end of the type expression:

| Suffix    | Meaning            | Example                                |
| --------- | ------------------ | -------------------------------------- |
| `!`       | required           | `'string!'` — required string          |
| `?`       | Optional           | `'string?'` — optional string          |
| no suffix | optional (default) | `'string'` — equivalent to `'string?'` |

```typescript
validate: {
  body: {
    name: 'string!', // required
    nickname: 'string?', // optional
    bio: 'string', // optional (equivalent to 'string?')
  },
}
```

`!` requires the field to exist; it does not require a nonempty value. `"string!"` accepts an empty string. Use `"string:1-!"` when empty strings must fail. `?` allows omission but does not allow `null`; see field schemas below for explicit nullability. Optional fields do not receive business defaults automatically. Set pagination defaults in the handler or use a supported schema `default`.

### Range constraints

Use the `:min-max` syntax to specify a range:

#### String length

```typescript
"string:1-50"; // length 1 to 50
"string:1-50!"; // Required, length 1 to 50
"string:5-"; // Minimum length 5, no upper limit
"string:-100"; // Maximum length 100
```

#### Number range

```typescript
"number:1-100"; // Value range 1 to 100
"number:0-"; // minimum value 0 (non-negative number)
"number:1-"; // Minimum value 1; fractions are still allowed
"integer:1-"; // Minimum value 1 and requires an integer
"number:-999"; // Maximum value 999
"number:18-120!"; // required, range 18 to 120
```

### Enumeration value

Use `|` to separate enumeration options:

```typescript
"admin|user|guest"; // Enumeration: admin / user / guest
"draft|published|archived"; // Enumeration: draft / published / archived
"male|female|other"; // Enumeration: male / female / other
```

The bare `|` shorthand describes a string enum and projects as an OpenAPI `enum`. For numeric enums, use an explicit definition such as `enum:number:1|2|3`; do not conflate numeric and string enums.

### Combination example

```typescript
validate: {
  body: {
    //Basic type + required/optional
    username: 'string:3-30!', // Required string, length 3-30
    password: 'string:8-128!', // Required string, length 8-128
    email: 'email!', // required email
    website: 'url?', // optional URL
    age: 'number:0-150?', // optional number, range 0-150
    score: 'number:0-100', // optional number, range 0-100
    active: 'boolean!', // required Boolean value
    role: 'admin|editor|viewer', // enumeration
    birthday: 'date?', // optional date
  },
}
```

## Field-level JSON Schema and documentation consistency

A request location is a field map. Each field may use JSON Schema. This complete route demonstrates required arrays, explicit nullability, and defaults:

```typescript
// src/routes/shapes.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      validate: {
        body: {
          "label!": { type: "string", minLength: 2, maxLength: 20 },
          "tags!": { type: "array", minItems: 1, items: { type: "string" } },
          note: { type: ["string", "null"] },
          limit: { type: "integer", minimum: 1, default: 20 },
        },
      },
    },
    async (req, res) => {
      res.json(req.valid("body"));
    },
  );
});
```

POST `{"label":"ok","tags":["guide"],"note":null}` to `/shapes`: expect 200 and `data.limit` equal to 20. A missing or single-character label, or an empty tags array, returns 422. Here `"label!"` and `"tags!"` mark required fields in the field name; `required: ["field"]` applies to a JSON Schema object node and lists required child fields. For a simple string array, `array<string>` DSL also works. Do not use `["string"]` as an array shorthand.

The runtime compiler interprets bare field-level `type` and `enum`, and OpenAPI and typed clients project those field facts. A root field map may contain a business field named `type`. For a nested object with a `type` field, write `{ metadata: { type: { type: "string" }, label: "string!" } }` explicitly; `metadata.type: "string"` otherwise identifies the whole `metadata` as a raw schema type.

`?` allows omission only. To allow null, use `types:string|null` or `{ type: ["string", "null"] }`. Runtime validation, TypeScript inference, and static projection each need checking; success in one does not establish support in the others.

## Type conversion

The default engine converts supported types, especially URL parameters that arrive as strings. This table describes the current dependency; a custom validator may behave differently:

| declared type | original value | converted        |
| ------------- | -------------- | ---------------- |
| `'number'`    | `"42"`         | `42`             |
| `'number'`    | `"3.14"`       | `3.14`           |
| `'boolean'`   | `"true"`       | `true`           |
| `'boolean'`   | `"false"`      | `false`          |
| `'boolean'`   | `"1"`          | validation fails |
| `'boolean'`   | `"0"`          | validation fails |

```typescript
app.get(
  "/search",
  {
    validate: {
      query: {
        page: "number:1-", // ?page=3 → number 3 (not the string "3")
        limit: "number:1-100", // ?limit=20 → number 20
        active: "boolean", // ?active=true → boolean true
      },
    },
  },
  async (req, res) => {
    const { page, limit, active } = req.valid("query");
    // Supplied values convert to number/boolean; omitted optional fields may be undefined.
    res.json({ page, limit, active });
  },
);
```

## Read validated data

### `req.valid(location)`

Use `req.valid()` for validated, converted data. Only a declared location produces a result; an undeclared one returns `undefined`, as described below.

```typescript
app.post(
  "/orders",
  {
    validate: {
      body: {
        productId: "string!",
        quantity: "number:1-99!",
      },
      query: {
        coupon: "string?",
      },
    },
  },
  async (req, res) => {
    const body = req.valid("body"); // { productId: string, quantity: number }
    const query = req.valid("query"); // { coupon?: string }

    const order = await app.services.order.create(body, query.coupon);
    res.json(order, 201);
  },
);
```

### Boundary behavior

::::warning Notes

`req.valid(location)` has the following boundary behavior to be aware of:

1. **Called when `validate` is not configured**

   If the route is not configured with a `validate` field, calling `req.valid("body")` will return `undefined`. The framework won't throw an error, but you won't be able to get the data after the checksum typecast.

2. **location is not declared in `validate`**

   If only `body` is declared in `validate`, but `req.valid("query")` is called, `undefined` will also be returned. Only locations explicitly declared in `validate` will have validated data.

3. **The handler is not reached when validation fails**

   Before the handler runs, an invalid path `param` returns HTTP `400`, while an invalid `query`, `header`, `cookie`, or `body` returns HTTP `422`. Data read through `req.valid()` inside the handler has therefore passed validation.

4. **Passing validation does not remove every undeclared field**

   The default engine retains unknown fields. Validating `{ name: "string!" }` against `{ name: "Alice", extra: 42 }` still leaves `extra` in the result; headers have the separate projection behavior above. Explicitly select fields for business writes. If replacing the validator, check whether it retains, strips, or rejects unknown fields.

```typescript
//Boundary case example
app.get(
  "/items",
  {
    validate: {
      query: { page: "number:1-" },
      // body is not declared
    },
  },
  async (req, res) => {
    const query = req.valid("query"); // { page?: number }, verified
    const body = req.valid("body"); // undefined, not declared in validate
    const param = req.valid("param"); // undefined, not declared in validate
    res.json({ query });
  },
);

// The route of validate is not configured
app.get("/health", async (req, res) => {
  const body = req.valid("body"); // undefined, the route is not configured validate
  res.json({ status: "ok" });
});
```

**Best Practice**: Always ensure that the `location` of `req.valid(location)` is consistent with the location declared in `validate`.
::::

### Automatic route-schema inference

The handler is contextually typed from the same `validate` object used at
runtime. You do not need to duplicate that contract as a TypeScript interface:

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
  async (req, res) => {
    const data = req.valid("body");
    // data.name  — string
    // data.email — string
    // data.age   — number | undefined
    res.json(await app.services.user.create(data));
  },
);
```

Inference covers DSL strings, required/optional markers, nested objects, and recognizable field-level JSON Schema. Preserve literal types (for example with `as const`) when extracting a schema into a variable; widening to plain `string` loses field-specific inference. Static types alone do not prove runtime compilation or static projection supports the shape. Do not use `["string"]` or `[{ code: "string!" }]` as array shorthand; use explicit `{ type: "array", items: ... }` or supported array DSL. A chainable `schemaAdapter.compileField()` builder intentionally infers as `unknown`, because later dynamic mutations are not visible in its static type. The explicit form
`req.valid<ExternalBody>("body")` remains available as an escape hatch for
dynamic or externally supplied schemas; it overrides inference and therefore
must match the runtime contract maintained by the application.

## Validation error response

Validation failures use one structured error shape. Invalid path `param` data returns HTTP/code `400`; invalid `query`, `header`, `cookie`, or `body` data returns HTTP/code `422`. The following is a `422` example:

```json
{
  "code": 422,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "must be a valid email address"
    },
    {
      "field": "name",
      "message": "length must be between 1 and 50"
    }
  ],
  "requestId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

- `code`: 422 in this example; 400 for a path param error
- `message`: `"Validation failed"` for default route validation
- `errors`: field-level error array, including `field` (field name) and `message` (error description)
- `requestId`: the unique identifier of the current request

Validation errors are handled uniformly by the framework's global error handler, and you do not need to manually try-catch in routing.

The field messages above illustrate the shape. Actual wording depends on the validator and locale, and a custom error handler can change the response. Do not treat these English sentences as stable business error codes.

## Linkage with OpenAPI documentation

OpenAPI is disabled by default. To project this page's example, add `openapi: { enabled: true }` to the earlier configuration and restart. Supported `validate` rules project to `parameters` and `requestBody`. Business meaning, permission, and response contracts still need separate declarations:

```typescript
app.get(
  "/users",
  {
    validate: {
      query: {
        page: "number:1-",
        limit: "number:1-100",
        status: "active|inactive|banned",
      },
    },
    docs: { summary: "List users" },
  },
  handler,
);
```

With OpenAPI enabled, this route projects:

- `page`: query number, minimum 1
- `limit`: query number, minimum 1, maximum 100
- `status`: query string enum of `active`, `inactive`, and `banned`

The default endpoints, when enabled, are `/docs` and `/openapi.json`; see the [OpenAPI guide](/guide/openapi). If pagination requires integers, change `number` to `integer` and verify that fractional input fails.

For business descriptions, use the explicit builder without global side effects. Vext does not install a global String `.description()` method:

```typescript
// src/routes/translate.ts
import { defineRoutes, schemaAdapter } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      validate: {
        body: {
          content: schemaAdapter
            .compileField("string:1-20000!")
            .description("Text to translate, 1–20000 characters"),
          targetLanguages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  minLength: 1,
                  maxLength: 64,
                  description: "Target language code",
                },
              },
              required: ["code"],
            },
          },
          format: schemaAdapter
            .compileField("enum:plain_text,preserve_line_breaks")
            .description("Output format"),
        },
      },
      docs: { summary: "Validate a translation request" },
    },
    async (req, res) => {
      res.json(req.valid("body"));
    },
  );
});
```

This route echoes validation results; it does not call a translation service. POST JSON with `content` and `targetLanguages` to `/translate` to inspect descriptions and nested `code` constraints. Generated OpenAPI retains descriptions, `required`, `enum`, `minLength`, and `maxLength`. String DSL without a handwritten description receives a fallback description; raw JSON Schema fields need explicit business descriptions where appropriate.

Build-time projection recognizes `schemaAdapter` as a named import from `vextjs`, including aliases. The finite builder grammar is `compileField(<static string>)` with at most one `.description(<static string>)`. A complete builder may be stored in an unambiguous same-file `const` or resolved through analyzable source bindings. Dynamic arguments, other chains, unresolvable imports, and opaque Zod/Yup values fail with route context; not every import is unsupported.

`?` means optional, not nullable. Use `types:string|null` or raw `{ type: ["string", "null"] }` to allow null explicitly.

## Advanced usage

### Multi-position combination verification

The same route can verify multiple locations at the same time:

```typescript
app.put(
  "/users/:id/avatar",
  {
    validate: {
      param: { id: "string!" },
      header: { "content-type": "string!" },
      query: { size: "number:32-512?" },
      body: { url: "url!", alt: "string:0-200?" },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const { url, alt } = req.valid("body");
    const { size } = req.valid("query");

    await app.services.user.updateAvatar(id, { url, alt, size });
    res.json({ success: true });
  },
);
```

### Cooperate with routing-level middleware

The verification middleware is executed after the routing-level middleware and before the handler. This means:

```
Request → [global middleware] → [routing-level middleware: auth, check-role] → [validate verification] → [handler]
```

If an authentication middleware or guard rejects a request, it does not reach later schema validation. Merely extracting identity without requiring authentication does not reject anonymous requests. A cache hit or earlier middleware short-circuit also skips schema validation and the handler. The next example assumes `auth` and `check-role` are fully implemented and registered:

```typescript
app.post(
  "/admin/users",
  {
    middlewares: [
      "auth",
      { name: "check-role", options: { roles: ["admin"] } },
    ],
    validate: {
      body: {
        name: "string:1-50!",
        email: "email!",
        role: "admin|editor|viewer!",
      },
    },
  },
  handler,
);
```

### Route override current limiting rules

Beyond validation, `options.override` can adjust rate limiting, timeouts, and other route behavior. First enable the limiter globally: a route override does not install it, and the default IP key does not automatically isolate budgets by path. See [Rate Limiting](/guide/rate-limit) for full verification.

```typescript
app.post(
  "/login",
  {
    validate: {
      body: {
        email: "email!",
        password: "string:8-128!",
      },
    },
    override: {
      rateLimit: { max: 5, window: 60 }, // Maximum 5 times per minute (window unit: seconds)
    },
  },
  handler,
);

app.get(
  "/public/health",
  {
    override: {
      rateLimit: false, // Health check does not limit the flow
    },
  },
  handler,
);
```

## Reuse the verification engine in the service layer

For route entry parameters, `RouteOptions.validate` + `req.valid()` is preferred. If the service also needs to verify non-HTTP input, such as scheduled tasks, message queues, external callbacks, or internal DTOs, you can obtain the current global validation engine through `this.app.getValidator()`.

`getValidator()` returns the current synchronous `VextValidator`, backed by schema-dsl by default. Replace it before route registration and service schema compilation; already saved compiled functions do not update when `setValidator()` is called later. Throw `VextValidationError` to preserve field errors: through the HTTP error handler, it returns 422 with `errors`; direct Job or other callers receive an exception to handle themselves. An ordinary `Error` in the HTTP chain follows the unknown-error 500 path.

```typescript
import { VextValidationError, type VextApp, type VextValidator } from "vextjs";

const createUserSchema = {
  name: "string:1-50!",
  email: "email!",
};

export default class UserService {
  private validateCreateUser: ReturnType<VextValidator["compile"]>;

  constructor(private app: VextApp) {
    const validator = app.getValidator();
    this.validateCreateUser = validator.compile(createUserSchema);
  }

  async create(input: unknown) {
    const result = this.validateCreateUser(input);

    if (!result.valid) {
      throw new VextValidationError(result.errors ?? []);
    }

    const data = result.data as { name: string; email: string };
    // Continue executing business logic...
    return data;
  }
}
```

::::tip

Use `app.getValidator()` when validation behavior should be shared. A direct independent schema library bypasses framework replacement. If you need a separate engine, document its syntax, conversion, and error contract differences.

::::

## Replace verification engine

VextJS uses schema-dsl as the validation engine by default. If you prefer third-party verification libraries such as Zod and Yup, you can replace the built-in verification engine through plug-ins.

### Using Zod Example

This application adapter requires `npm install zod` and uses the public Zod 4 types. It translates only the listed string subset and falls back to the original engine for an entire schema if it finds any unsupported field. `z.looseObject()` preserves undeclared fields; see the [official Zod object docs](https://zod.dev/api#zlooseobject). Formatting, conversion, and error text can still differ between engines. The synchronous `VextValidator` cannot accept refinements or transforms that require async parsing.

```typescript
// src/plugins/zod-validator.ts
import { definePlugin } from "vextjs";
import type { VextValidator } from "vextjs";
import { z } from "zod";

export default definePlugin({
  name: "zod-validator",

  setup(app) {
    const originalValidator = app.getValidator();

    // Translate Vext's serializable route schema into the selected engine.
    // This application-owned example intentionally supports a small subset.
    const toZodField = (definition: unknown): z.ZodType | null => {
      if (definition === "string!") return z.string();
      if (definition === "string:1-50!") return z.string().min(1).max(50);
      if (definition === "email!") return z.string().email();
      if (definition === "string?") return z.string().optional();
      return null;
    };

    const zodValidator: VextValidator = {
      compile(schema) {
        const toVextResult = (result: ReturnType<z.ZodType["safeParse"]>) =>
          result.success
            ? { valid: true, data: result.data }
            : {
                valid: false,
                errors: result.error.issues.map((issue) => ({
                  field: issue.path.join("."),
                  message: issue.message,
                })),
              };

        const zodShape: Record<string, z.ZodType> = {};
        for (const [key, definition] of Object.entries(schema)) {
          const field = toZodField(definition);
          if (!field) return originalValidator.compile(schema);
          zodShape[key] = field;
        }
        const zodSchema = z.looseObject(zodShape);
        return (data) => toVextResult(zodSchema.safeParse(data));
      },
    };

    app.setValidator(zodValidator);
    app.logger.info("Zod validator plugin activated");
  },
});
```

`app.setValidator()` replaces runtime compilation. It does not widen the public type of `RouteOptions.validate` or change the static route-source grammar. Route declarations must keep using serializable Vext schema values (DSL strings, nested literals, or the canonical `schemaAdapter` builder); the adapter translates that contract to Zod or Yup internally. Do not place opaque third-party schema instances, including opaque Zod/Yup objects, in `RouteOptions.validate`. Build, Doctor, OpenAPI, and client contracts must project the route before plugin setup runs.

After installing and enabling the plugin, add a route that only uses its supported subset:

```typescript
// src/routes/zod-check.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    { validate: { body: { name: "string!", email: "email!" } } },
    async (req, res) => {
      res.json(req.valid("body"));
    },
  );
});
```

POST `{"name":"","email":"alice@example.com","extra":42}` to `/zod-check`: expect 200 with the empty `name` and `extra` retained. Missing `name` or an invalid email returns 422. Number and boolean rules in the basic example are outside this adapter's subset and should fall back to the original engine with its conversions. Then build and start the production app and repeat the HTTP checks. Compare only the promised subset; this example does not establish full equivalence between validators.

## Common patterns

### Pagination query

```typescript
app.get(
  "/posts",
  {
    validate: {
      query: {
        page: "integer:1-",
        limit: "integer:1-100",
        sort: "createdAt|updatedAt|title",
        order: "asc|desc",
      },
    },
  },
  async (req, res) => {
    const {
      page = 1,
      limit = 20,
      sort = "createdAt",
      order = "desc",
    } = req.valid("query");
    const posts = await app.services.post.findAll({ page, limit, sort, order });
    res.json(posts);
  },
);
```

### Search filter

```typescript
app.get(
  "/products",
  {
    validate: {
      query: {
        keyword: "string?",
        category: "string?",
        minPrice: "number:0-?",
        maxPrice: "number:0-?",
        inStock: "boolean?",
      },
    },
  },
  async (req, res) => {
    const filters = req.valid("query");
    const products = await app.services.product.search(filters);
    res.json(products);
  },
);
```

### User registration

```typescript
app.post(
  "/auth/register",
  {
    validate: {
      body: {
        username: "string:3-30!",
        email: "email!",
        password: "string:8-128!",
        confirmPassword: "string:8-128!",
      },
    },
    override: {
      rateLimit: { max: 3, window: 60 }, // Unit: seconds
    },
  },
  async (req, res) => {
    const data = req.valid("body");

    if (data.password !== data.confirmPassword) {
      app.throw(400, "Two passwords are inconsistent");
    }

    const user = await app.services.auth.register(data);
    res.json(user, 201);
  },
);
```

### File path parameters

This is a fragment inside the `defineRoutes` callback of `src/routes/files/[id].ts`. It requires an application file service that supplies `stream`, `name`, `contentType`, and `metadata`. The file prefix provides `/files/:id`:

```typescript
app.get(
  "/",
  {
    validate: {
      param: { id: "string!" },
      query: { download: "boolean?" },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const { download } = req.valid("query");

    const file = await app.services.file.findById(id);
    if (!file) app.throw(404, "file.not_found");

    if (download) {
      res.download(file.stream, file.name, file.contentType);
    } else {
      res.json(file.metadata);
    }
  },
);
```

## Best Practices

### 1. Always use `req.valid()` instead of `req.body`

Routes configured with `validate` should use `req.valid('body')` instead of directly accessing `req.body`:

```typescript
// ✅ Correct — use validated data
const data = req.valid("body");

// ❌ Avoid — type conversion skipped
const data = req.body;
```

`req.valid()` reads the validator's stored `result.data`. The framework does not assign it back to `req.body` or `req.query`. Whether an individual validator mutates input in place is engine behavior; do not assume the raw and validated objects are always identical or always different.

### 2. Reasonable use of required tags

Requiredness comes from the API contract, not the input location. Pagination query may be optional if the handler supplies defaults; core create fields are usually required, and a required header should be marked required too:

```typescript
validate: {
  query: {
    page: 'number:1-', // optional (paging has default value)
    keyword: 'string?', // optional (search keyword)
  },
  body: {
    name: 'string:1-50!', // required (must be provided when creating a resource)
    email: 'email!', // required
    bio: 'string:0-500?', // optional
  },
}
```

### 3. Verification rules are documents

Validation rules give the structural part of an input contract. A complete document also needs purpose, identity requirements, responses, errors, and business constraints. State field constraints precisely:

```typescript
// ✅ Precise constraints — clear documentation and validation
validate: {
  body: {
    username: 'string:3-30!', // 3-30 characters, required
    age: 'number:0-150?', // 0-150, optional
    role: 'admin|editor|viewer!', // Explicit enumeration
  },
}

// ❌ Broad constraints — insufficient documentation information
validate: {
  body: {
    username: 'string!', // No length constraint
    age: 'number?', // no range constraints
    role: 'string!', // Enumeration should be used
  },
}
```

### 4. Use `app.throw()` for custom validation in Handler

DSL syntax cannot cover all verification scenarios (such as cross-field verification, database uniqueness checking). For these scenarios, use `app.throw()` in the handler or service to throw manually:

```typescript
app.post(
  "/users",
  {
    validate: {
      body: { email: "email!", password: "string:8-128!" },
    },
  },
  async (req, res) => {
    const data = req.valid("body");

    // A pre-check improves the message; a database constraint still enforces concurrency safety.
    const existing = await app.services.user.findByEmail(data.email);
    if (existing) {
      app.throw(409, "Email has been registered", 10001);
    }

    const user = await app.services.user.create(data);
    res.json(user, 201);
  },
);
```

An application-level check before a write cannot guarantee uniqueness under concurrency. Handle a database uniqueness conflict too. Schema validation does not replace authorization, resource ownership, inventory, or payment eligibility; see the [Validation and Contracts Specification](/specification/validation-and-contracts).

## Troubleshooting and verification

| Symptom                                    | Check                                                            | Verify                                                      |
| ------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| 400 instead of 422                         | Path param failed first, or the body parser rejected JSON        | Send separate invalid param and invalid field requests      |
| Boolean `1` fails                          | Current engine does not convert string `1` or `0` to boolean     | Use `true` or `false`; verify the error path                |
| `req.valid()` is undefined                 | Is that location declared and has validation run?                | Check singular `param` and send a valid request             |
| Compilation or projection rejects a schema | Array shorthand, dynamic builder, or opaque third-party instance | Use supported static declarations; build and send a request |
| Custom engine differs from OpenAPI         | Conversion, requiredness, or unknown-field behavior changed      | Inspect generated contract and valid/invalid requests       |
| `string!` accepts an empty string          | Required means present, not nonempty                             | Use `string:1-!`; test missing, empty, and valid values     |
| Extra fields remain in results             | Default engine retains unknown fields                            | Send an extra field; inspect output and persistence input   |

## Next step

- Understand the global configuration related to verification in [Configuration](/guide/configuration)
- View [OpenAPI Documentation](/guide/openapi) how to link with verification rules
- Learn the complete usage of the three-stage expression in [Routing](/guide/routing)
- Explore [plugins](/guide/plugins) how to replace the validation engine

# Zod validation integration

This example shows how to use [Zod](https://zod.dev) to replace VextJS's built-in schema-dsl validation engine. By writing a Zod validation plug-in, you can directly use Zod schema in the `validate` configuration of the route to gain more powerful type inference and verification capabilities.

## Why choose Zod?

| Features                  | Built-in schema-dsl                            | Zod                                            |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Learning Curve            | Low (DSL String Syntax)                        | Medium (Chained API)                           |
| TypeScript type inference | ❌ None (no need to manually declare generics) | ✅ Automatic inference `z.infer<T>`            |
| Complex verification      | Basic type + range + enumeration               | Union type, recursion, transform, refine, etc. |
| Ecology                   | Exclusive to VextJS                            | Widely used, rich community ecology            |
| Package size              | 0 (framework built-in)                         | ~14KB (min+gzip)                               |

:::tip
If your project only requires simple parameter verification (string/number/enumeration/email, etc.), the built-in schema-dsl is enough. Zod is more suitable for scenarios that require complex verification logic, deep type inference, or where Zod is already used in the project.
:::

## Project structure

```
zod-validation/
  ├── src/
  │ ├── config/
  │ │ └── default.ts
  │ ├── plugins/
  │ │ └── zod-validator.ts ← Zod validation plug-in
  │ ├── routes/
  │ │ ├── index.ts
  │ │ └── users.ts
  │ ├── services/
  │ │ └── user.ts
  │ ├── schemas/ ← Zod schema definition
  │ │ └── user.ts
  │ └── index.ts
  ├── package.json
  └── tsconfig.json
```

## 1. Install dependencies

```bash
npx vextjs create zod-validation
cd zod-validation
pnpm add zod
```

## 2. Zod verification plug-in

The core idea: replace the built-in schema-dsl verification engine through `app.setValidator()`. The `VextValidator` interface requires the implementation of the `compile(schema)` method, which returns a validation function.

```typescript
// src/plugins/zod-validator.ts
import { definePlugin } from "vextjs";
import { z, ZodType } from "zod";

/**
 * Zod verification plug-in
 *
 * Replace the built-in schema-dsl validation engine so that the route validate configuration supports field-level Zod schema.
 *
 * How to use:
 * validate: {
 * body: userCreateSchema.shape, // Field-level Zod schema object
 * query: paginationSchema.shape,
 * }
 *
 * Verification process:
 * 1. compile(schema) receives the original schema object
 * 2. Check whether each field of the schema is a ZodType instance
 * 3. If it is Zod schema, use safeParse for verification
 * 4. If not (normal object), fall back to the original validator (schema-dsl compatible)
 */
export default definePlugin({
  name: "zod-validator",
  setup(app) {
    //Save the original validator for fallback
    const originalValidator = app.getValidator();

    app.setValidator({
      compile(schema: Record<string, unknown>) {
        // ── Determine whether the schema is Zod schema ──────────────────
        //
        // Each position of route validate (query/body/param/header) is an independent schema.
        // If a ZodType instance is passed in, use Zod verification.
        // Otherwise fall back to the original schema-dsl validator (to maintain backward compatibility).

        if (schema instanceof ZodType) {
          // ── Zod verification path ─────────────────────────────────
          const zodSchema = schema;

          return (data: unknown) => {
            const result = zodSchema.safeParse(data);

            if (result.success) {
              return {
                valid: true,
                data: result.data,
              };
            }

            //Convert Zod error format to VextJS standard format
            return {
              valid: false,
              errors: result.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
              })),
            };
          };
        }

        //──Check whether the field of the schema object contains a Zod instance─────────
        //
        //Support validate: { body: { name: z.string(), age: z.number() } }
        // This hybrid mode of "object field is Zod".
        // This writing method is consistent with the public type of RouteOptions.validate.

        const hasZodFields = Object.values(schema).some(
          (v) => v instanceof ZodType,
        );

        if (hasZodFields) {
          // Collect scattered Zod fields as z.object
          const shape: Record<string, ZodType> = {};
          for (const [key, value] of Object.entries(schema)) {
            if (value instanceof ZodType) {
              shape[key] = value;
            } else {
              //Non-Zod fields, wrapped as z.any()
              shape[key] = z.any();
            }
          }

          const objectSchema = z.object(shape);

          return (data: unknown) => {
            const result = objectSchema.safeParse(data);

            if (result.success) {
              return {
                valid: true,
                data: result.data,
              };
            }

            return {
              valid: false,
              errors: result.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
              })),
            };
          };
        }

        // ── Fallback to original schema-dsl validator ────────────────────
        return originalValidator.compile(schema);
      },
    });

    app.logger.info(
      "[zod-validator] Zod verification plug-in has been registered",
    );
  },
});
```

:::tip
This plugin is **backwards compatible** with schema-dsl. You can mix Zod schema and schema-dsl DSL strings in the same project. For non-Zod schema (such as `{ name: 'string:1-50' }`), the plug-in will automatically fall back to the built-in validation engine.
:::

## 3. Define Zod Schema

Centrally manage Zod schemas in the `src/schemas/` directory to facilitate reuse and maintenance.

```typescript
// src/schemas/user.ts
import { z } from "zod";

//── Basic field schema ────────────────────────────────────

/** User ID (path parameter) */
export const userIdParam = z.object({
  id: z.string().min(1, "ID cannot be empty"),
});

/** Pagination query parameters */
export const paginationQuery = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1, "The minimum page number is 1")
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100, "Maximum 100 items per page")
    .default(10),
  keyword: z.string().optional(),
});

// ── User CRUD schema ────────────────────────────────────

/** Create user */
export const createUserBody = z.object({
  name: z
    .string()
    .min(1, "The name cannot be empty")
    .max(50, "The name can be up to 50 characters")
    .trim(),
  email: z.string().email("Email format is invalid").toLowerCase(),
  age: z
    .number()
    .int("Age must be an integer")
    .min(0, "Age cannot be a negative number")
    .max(200, "Age cannot exceed 200")
    .optional(),
  role: z
    .enum(["admin", "user", "editor"], {
      errorMap: () => ({ message: "Role must be admin, user or editor" }),
    })
    .default("user"),
  tags: z
    .array(z.string().min(1).max(20))
    .max(10, "Maximum 10 tags")
    .optional(),
  profile: z
    .object({
      bio: z
        .string()
        .max(500, "The maximum length of the introduction is 500 characters")
        .optional(),
      avatar: z.string().url("The avatar must be a valid URL").optional(),
      website: z.string().url("The website must be a valid URL").optional(),
    })
    .optional(),
});

/** Update user (all fields optional) */
export const updateUserBody = createUserBody
  .partial() // All fields become optional
  .omit({ role: true }) // Do not allow role modification through the update interface
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field to be updated needs to be provided",
  });

/** Batch operation */
export const batchDeleteBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Select at least one user")
    .max(50, "A maximum of 50 items can be deleted at a time"),
});

//──Export inferred type ───────────────────────────────────────

/** Infer TypeScript types from Zod schema */
export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type PaginationInput = z.infer<typeof paginationQuery>;
export type BatchDeleteInput = z.infer<typeof batchDeleteBody>;
```

:::tip
**`z.coerce.number()`** is Zod's type cast, which will automatically convert the string `'10'` into the number `10`. This is particularly useful for query parameters (which are always strings), consistent with schema-dsl's automatic type conversion behavior.
:::

## 4. Configuration

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
  response: {
    wrap: true,
    hideInternalErrors: false,
  },
  openapi: {
    enabled: true,
    title: "Zod Validation Example",
    version: "1.0.0",
    description: "VextJS example using Zod for parameter validation",
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    guardSecurityMap: {
      auth: "bearerAuth",
    },
  },
  middlewares: [{ name: "auth" }],
};
```

## 5. Routing (using Zod Schema)

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";
import {
  userIdParam,
  paginationQuery,
  createUserBody,
  updateUserBody,
  batchDeleteBody,
} from "../schemas/user.js";
import type { CreateUserInput, UpdateUserInput } from "../schemas/user.js";

export default defineRoutes((app) => {
  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  // GET /users/list — paging query
  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  app.get(
    "/list",
    {
      validate: {
        query: paginationQuery, // ← Zod schema
      },
      docs: {
        summary: "User list",
        description:
          "Query the user list in pages, supporting fuzzy search by name or email.",
      },
    },
    async (req, res) => {
      // The data returned by req.valid() has passed Zod checksum transform
      // page/limit has been automatically converted from string to number (z.coerce.number())
      // keyword is string | undefined
      const { page, limit, keyword } = req.valid("query");

      const result = await app.services.user.findAll({ page, limit, keyword });
      res.json(result);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  // GET /users/:id — Query details
  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  app.get(
    "/:id",
    {
      validate: {
        param: userIdParam, // ← Zod schema
      },
      docs: {
        summary: "Get user details",
        responses: {
          200: { description: "Query successful" },
          404: { description: "User does not exist" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);

      if (!user) {
        app.throw(404, "User does not exist");
      }

      res.json(user);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  // POST /users — Create users
  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  app.post(
    "/",
    {
      validate: {
        body: createUserBody, // ← Zod schema
      },
      middlewares: ["auth"],
      docs: {
        summary: "Create user",
        description:
          "Create a new user. Supports complex nested structures such as tags and profiles.",
        responses: {
          201: {
            description: "Created successfully",
            example: {
              id: "4",
              name: "Diana",
              email: "diana@example.com",
              role: "user",
              tags: ["developer"],
              profile: { bio: "Hello!" },
            },
          },
          422: { description: "Parameter verification failed" },
          401: { description: "Not authenticated" },
          409: { description: "Email has been registered" },
        },
      },
    },
    async (req, res) => {
      // Zod is automatically:
      // - trim() the name
      // - toLowerCase() for email
      // - Set role default value 'user'
      // - Verified tags array length and element format
      // - Verified the URL format of the profile nested object
      const body = req.valid<CreateUserInput>("body");

      const user = await app.services.user.create(body);
      res.json(user, 201);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  // PUT /users/:id — update user
  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  app.put(
    "/:id",
    {
      validate: {
        param: userIdParam,
        body: updateUserBody, // ← partial() + refine()
      },
      middlewares: ["auth"],
      docs: {
        summary: "Update user",
        description:
          "Update user information. All fields are optional, but at least one field is required. Modification of roles is not allowed.",
        responses: {
          200: { description: "Update successful" },
          422: {
            description:
              "Parameter validation failed (or no fields were provided)",
          },
          401: { description: "Not authenticated" },
          404: { description: "User does not exist" },
          409: { description: "The mailbox is already used by another user" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      // updateUserBody uses .partial().omit({ role: true }).refine(...)
      // Zod ensures that there is at least one field and does not contain role
      const body = req.valid<UpdateUserInput>("body");

      const user = await app.services.user.update(id, body);
      res.json(user);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  // DELETE /users/:id — delete a user
  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  app.delete(
    "/:id",
    {
      validate: {
        param: userIdParam,
      },
      middlewares: ["auth"],
      docs: {
        summary: "Delete user",
        responses: {
          204: { description: "Delete successfully" },
          401: { description: "Not authenticated" },
          404: { description: "User does not exist" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      await app.services.user.delete(id);
      res.status(204).json(null);
    },
  );

  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  // POST /users/batch-delete — batch delete
  // ━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━
  app.post(
    "/batch-delete",
    {
      validate: {
        body: batchDeleteBody, // ← array verification
      },
      middlewares: ["auth"],
      docs: {
        summary: "Delete users in batches",
        description:
          "Delete multiple users in batches. Up to 50 users at a time.",
        responses: {
          200: { description: "Delete results in batches" },
          422: { description: "Parameter verification failed" },
          401: { description: "Not authenticated" },
        },
      },
    },
    async (req, res) => {
      const { ids } = req.valid("body");

      const results = {
        deleted: [] as string[],
        notFound: [] as string[],
      };

      for (const id of ids) {
        try {
          await app.services.user.delete(id);
          results.deleted.push(id);
        } catch {
          results.notFound.push(id);
        }
      }

      res.json(results);
    },
  );
});
```

## 6. Service layer

```typescript
// src/services/user.ts
import type { VextApp, VextLogger } from "vextjs";
import type { CreateUserInput, UpdateUserInput } from "../schemas/user.js";

interface User {
  id: string;
  name: string;
  email: string;
  age?: number;
  role: string;
  tags?: string[];
  profile?: {
    bio?: string;
    avatar?: string;
    website?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export default class UserService {
  private logger: VextLogger;
  private users: Map<string, User> = new Map();
  private nextId = 1;

  constructor(private app: VextApp) {
    this.logger = app.logger.child({ service: "UserService" });
    this.seed();
  }

  private seed(): void {
    const seedUsers: Partial<User>[] = [
      {
        name: "Alice",
        email: "alice@example.com",
        age: 28,
        role: "admin",
        tags: ["Administrator"],
      },
      { name: "Bob", email: "bob@example.com", age: 32, role: "user" },
      {
        name: "Charlie",
        email: "charlie@example.com",
        role: "editor",
        profile: { bio: "edit" },
      },
    ];

    for (const u of seedUsers) {
      const id = String(this.nextId++);
      const now = new Date().toISOString();
      this.users.set(id, { id, ...u, createdAt: now, updatedAt: now } as User);
    }
  }

  async findAll(options: { page: number; limit: number; keyword?: string }) {
    let allUsers = Array.from(this.users.values());

    if (options.keyword) {
      const kw = options.keyword.toLowerCase();
      allUsers = allUsers.filter(
        (u) =>
          u.name.toLowerCase().includes(kw) ||
          u.email.toLowerCase().includes(kw),
      );
    }

    const total = allUsers.length;
    const start = (options.page - 1) * options.limit;
    const items = allUsers.slice(start, start + options.limit);

    return {
      items,
      total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(total / options.limit),
    };
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async create(data: CreateUserInput): Promise<User> {
    // Email uniqueness check
    for (const user of this.users.values()) {
      if (user.email === data.email) {
        this.app.throw(409, "Email has been registered", 10001);
      }
    }

    const id = String(this.nextId++);
    const now = new Date().toISOString();

    const user: User = {
      ID,
      name: data.name,
      email: data.email,
      age: data.age,
      role: data.role,
      tags: data.tags,
      profile: data.profile,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(id, user);
    this.logger.info(
      { userId: id, email: data.email },
      "User created successfully",
    );
    return user;
  }

  async update(id: string, data: UpdateUserInput): Promise<User> {
    const user = this.users.get(id);
    if (!user) {
      this.app.throw(404, "User does not exist");
    }

    if (data.email && data.email !== user.email) {
      for (const u of this.users.values()) {
        if (u.email === data.email) {
          this.app.throw(
            409,
            "The mailbox is already used by another user",
            10002,
          );
        }
      }
    }

    const updated: User = {
      ...user,
      ...data,
      // Deep merge profile
      profile: data.profile
        ? { ...user.profile, ...data.profile }
        : user.profile,
      updatedAt: new Date().toISOString(),
    };

    this.users.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.users.has(id)) {
      this.app.throw(404, "User does not exist");
    }
    this.users.delete(id);
  }
}
```

## 7. Entry file

```typescript
// src/index.ts
import { bootstrap } from "vextjs";

bootstrap().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
```

## 8. Operation and verification

```bash
# Start development server
pnpmdev
```

### Test verification

```bash
# ✅ Normal creation (Zod automatically trim name + toLowerCase email)
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{
    "name": "Diana",
    "email": "Diana@EXAMPLE.COM",
    "age": 25,
    "tags": ["developer", "designer"],
    "profile": { "bio": "Full-stack Developer", "website": "https://diana.dev" }
  }'
# → 201
# name is trimmed to "Diana"
# email is toLowerCase to "diana@example.com"
# role is set to "user" by default# ❌ Nested object validation — profile.avatar non-URL
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{
    "name": "Eve",
    "email": "eve@example.com",
    "profile": { "avatar": "not-a-url" }
  }'
# → 422 {"errors":[{"field":"profile.avatar","message":"Avatar must be a valid URL"}]}

# ❌ Array length check — more than 10 tags
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{
    "name": "Eve",
    "email": "eve@example.com",
    "tags": ["1","2","3","4","5","6","7","8","9","10","11"]
  }'
# → 422 {"errors":[{"field":"tags","message":"Max 10 tags"}]}

# ❌ refine validation — no fields were provided when updating
curl -X PUT http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{}'
# → 422 {"errors":[{"field":"","message":"At least one field to be updated is required"}]}

# ❌ omit verification — attempt to modify role during update (removed by omit)
curl -X PUT http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"role": "admin", "name": "Alice Updated"}'
# → 200 but the role field is ignored (Zod strip unknown field), only name is updated

# ❌ Enumeration validation — invalid role value
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"name":"Frank","email":"frank@example.com","role":"superadmin"}'
# → 422 {"errors":[{"field":"role","message":"Role must be admin, user or editor"}]}

#✅ Query parameter automatic type conversion (z.coerce.number)
curl "http://localhost:3000/users/list?page=2&limit=5"
# → page automatically converts from the string "2" to the number 2

# ✅ Batch delete
curl -X POST http://localhost:3000/users/batch-delete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"ids": ["1", "2", "999"]}'
# → {"code":0,"data":{"deleted":["1","2"],"notFound":["999"]},...}
```

## Zod Advanced Tips

### Transform (data conversion)

```typescript
import { z } from "zod";

// Query parameters: comma separated string → array
const searchQuery = z.object({
  ids: z
    .string()
    .transform((val) => val.split(",").filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(1))
    .optional(),
  sort: z
    .string()
    .regex(/^[a-zA-Z]+:(asc|desc)$/, "Sort format: field:asc or field:desc")
    .transform((val) => {
      const [field, order] = val.split(":");
      return { field, order: order as "asc" | "desc" };
    })
    .optional(),
});

// use
app.get("/search", { validate: { query: searchQuery } }, async (req, res) => {
  const { ids, sort } = req.valid("query");
  // ids: string[] | undefined
  // sort: { field: string, order: 'asc' | 'desc' } | undefined
});
```

### Discriminated Union (discriminate union type)

```typescript
import { z } from "zod";

// Use different validation rules based on the type field
const notificationBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("email"),
    to: z.string().email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1),
  }),
  z.object({
    type: z.literal("sms"),
    phone: z.string().regex(/^\+?[\d\s-]{10,15}$/),
    message: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal("push"),
    deviceToken: z.string().min(1),
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(500),
  }),
]);

app.post("/notify", { validate: { body: notificationBody } }, handler);
```

### Preprocess (preprocessing)

```typescript
import { z } from "zod"; // Handle "true" / "false" string to boolean conversion (commonly used in query parameters)
const filterQuery = z
  .object({
    active: z.preprocess((val) => {
      if (val === "true") return true;
      if (val === "false") return false;
      return val;
    }, z.boolean().optional()),
    minAge: z.coerce.number().int().min(0).optional(),
    maxAge: z.coerce.number().int().max(200).optional(),
  })
  .refine(
    (data) => {
      if (data.minAge !== undefined && data.maxAge !== undefined) {
        return data.minAge <= data.maxAge;
      }
      return true;
    },
    {
      message: "minAge must be less than or equal to maxAge",
      path: ["minAge"],
    },
  );
```

### Reuse and combination

```typescript
import { z } from "zod";

//Basic schema
const addressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(50),
  state: z.string().min(1).max(50),
  zip: z.string().regex(/^\d{6}$/, "Zip code must be 6 digits"),
  country: z.string().min(1).max(50).default("China"),
});

// Use in combination
const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
        price: z.number().positive(),
      }),
    )
    .min(1, "At least one product is required"),
  shippingAddress: addressSchema,
  billingAddress: addressSchema.optional(), // Optional, reuse the same schema
  note: z.string().max(500).optional(),
});

//Infer type from existing schema
type Order = z.infer<typeof orderSchema>;
type Address = z.infer<typeof addressSchema>;
```

## Mixed with schema-dsl

The Zod plugin supports using Zod and schema-dsl simultaneously in the same project:

```typescript
// This route uses Zod
app.post(
  "/users",
  {
    validate: {
      body: createUserBody.shape, // ← field level Zod schema
      query: paginationQuery.shape, // ← field level Zod schema
    },
  },
  handler,
);

// This route uses schema-dsl (automatic fallback)
app.get(
  "/health",
  {
    validate: {
      query: {
        verbose: "boolean?", // ← schema-dsl string
      },
    },
  },
  handler,
);
```

The plug-in will automatically detect the schema type internally: when the field value is a Zod instance, the Zod verification path will be used, and for ordinary schema-dsl objects, the default verification path will be used.

## Key comparison

| scene                     | schema-dsl                       | Zod                                            |
| ------------------------- | -------------------------------- | ---------------------------------------------- |
| Simple field verification | `name: 'string:1-50'`            | `z.string().min(1).max(50)`                    |
| Optional fields           | `age: 'number?'`                 | `z.number().optional()`                        |
| Enumeration               | `role: 'enum:admin,user'`        | `z.enum(['admin', 'user'])`                    |
| Email                     | `email: 'email'`                 | `z.string().email()`                           |
| Nested objects            | ❌ Not supported                 | `z.object({ profile: z.object({...}) })`       |
| Array verification        | `tags: 'array'`                  | `z.array(z.string()).max(10)`                  |
| Union type                | ❌ Not supported                 | `z.union([...])` / `z.discriminatedUnion(...)` |
| Custom validation         | ❌ Not supported                 | `.refine()` / `.superRefine()`                 |
| Data conversion           | Type conversion only             | `.transform()` / `.preprocess()`               |
| Default value             | ❌ Not supported                 | `.default()`                                   |
| Type inference            | ❌ Needs to be declared manually | ✅ `z.infer<typeof schema>`                    |

## Next step

- 📖[Drizzle ORM Integration](/examples/drizzle-orm) — Access type-safe ORM
- 📖[Prisma ORM integration](/examples/prisma-orm) — Connect to Prisma database tools
- 📖[Parameter Validation](/guide/validation) — Learn more about built-in schema-dsl validation
- 📖 [Plugins](/guide/plugins) — Learn more about plugin development
- 📖 [Testing](/guide/testing) — Use createTestApp to test Zod validation

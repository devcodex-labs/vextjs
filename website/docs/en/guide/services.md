# Service layer

The service layer concentrates business logic. Put a default-exported service class in `src/services/`; the framework discovers and instantiates it, then attaches it to `app.services` for route handlers to use. This page starts with an example that needs no database, then covers naming, dependencies, and lifecycle.

## Design concept

```
Routing layer (routes) ← Parameter extraction + response return (thin layer)
   ↓
Services layer (services) ← Business logic (core)
   ↓
Data layer (models) ← Data access (provided through plugins)
```

- **Route handler** is only responsible for extracting parameters from the request, calling the service, and returning the response
- **Service layer** owns business use cases; avoid direct access to `req` / `res` so routes and Jobs can share it
- **Data layer** provided by plugins (such as database ORM), accessed through the `app` object

This layering enables:

- Business logic can be reused between different routes
- The service layer can be unit tested independently (not relying on HTTP)
- Switching the underlying Adapter does not affect the business code

These are recommended responsibilities, not framework-enforced restrictions on every cross-layer call. A service may still use `app.throw()` for HTTP errors; non-HTTP consumers must decide how to handle those exceptions. See [Architecture](/specification/architecture) and [Validation and contracts](/specification/validation-and-contracts).

## Basic writing method

### Service class

Each service file must default-export a class or another constructor that can be called with `new` and accepts `app`. A class is recommended. This runnable example returns mock data, verifies service injection and validation, and does not persist users.

Prerequisite: a TypeScript application from [Quick Start](/guide/quick-start) that runs with `npm run dev`. Merge this configuration into the starter application, then add the service and route files. Merge or replace existing files with the same names; do not declare duplicate default exports. The requests below use port 3000. If local configuration, the provider, or the CLI overrides it, check the actual listening port in [Configuration](/guide/configuration).

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default { port: 3000 } satisfies VextUserConfig;
```

```typescript
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  private app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  async findAll(options?: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = options ?? {};
    // Business logic...
    return {
      items: [],
      total: 0,
      page,
      limit,
    };
  }

  async findById(id: string) {
    // Business logic...
    const user = { id, name: "Alice", email: "alice@example.com" };
    return user;
  }

  async create(data: { name: string; email: string }) {
    this.app.logger.info({ data }, "Creating user");
    //Business logic...
    return { id: crypto.randomUUID(), ...data };
  }

  async update(id: string, data: Partial<{ name: string; email: string }>) {
    this.app.logger.info({ id, data }, "Updating user");
    return { id, ...data };
  }

  async delete(id: string) {
    this.app.logger.info({ id }, "Deleting user");
  }
}
```

### Use in a route

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    // Access the injected service instance through app.services
    const users = await app.services.user.findAll();
    res.json(users);
  });

  app.get(
    "/:id",
    {
      validate: { param: { id: "string!" } },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);
      if (!user) app.throw(404, "user.not_found");
      res.json(user);
    },
  );

  app.post(
    "/",
    {
      validate: {
        body: { name: "string:1-50!", email: "email!" },
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

Start `npm run dev`, then make these requests from another terminal. For Bash and other POSIX shells:

```bash
curl -i http://127.0.0.1:3000/users
curl -i http://127.0.0.1:3000/users/42
curl -i -H "Content-Type: application/json" -d '{"name":"Bob","email":"bob@example.com"}' http://127.0.0.1:3000/users
curl -i -H "Content-Type: application/json" -d '{"name":"Bob","email":"invalid"}' http://127.0.0.1:3000/users
```

On Windows PowerShell, use `Invoke-RestMethod` so older PowerShell versions do not alter JSON quotes passed to a native command:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/users
Invoke-RestMethod http://127.0.0.1:3000/users/42
Invoke-RestMethod http://127.0.0.1:3000/users -Method Post -ContentType 'application/json' -Body '{"name":"Bob","email":"bob@example.com"}'
try {
  Invoke-RestMethod http://127.0.0.1:3000/users -Method Post -ContentType 'application/json' -Body '{"name":"Bob","email":"invalid"}'
} catch {
  [int]$_.Exception.Response.StatusCode # Expected: 422
}
```

Expect, in order: 200 (`data.items` is empty, `page` is 1, `limit` is 20), 200 (`data.id` is the string `42`), 201 (`data.id` is a generated UUID), and 422 (field validation fails). This example allows unauthenticated requests. To require authentication, register the complete authentication middleware and Guard as described in [Security](/guide/security); copying an unregistered `auth` name is insufficient.

After checking development requests, stop the development server, run `npm run build` (including `--typecheck`) and `npm start` as configured in Quick Start, then repeat the requests. The list is still empty after creating a user because this example has no persistence.

Later sections show separate patterns and extensions. Replace or merge their `UserService` methods as needed; do not paste multiple default exports into one file.

## File naming and mapping

`service-loader` automatically mounts the service instance to the corresponding property of `app.services` according to the file path.

### Mapping rules

| File path                       | Access method                   | Description            |
| ------------------------------- | ------------------------------- | ---------------------- |
| `services/user.ts`              | `app.services.user`             | Flat naming            |
| `services/order.ts`             | `app.services.order`            | Flat naming            |
| `services/user-profile.ts`      | `app.services.userProfile`      | kebab-case → camelCase |
| `services/payment/stripe.ts`    | `app.services.payment.stripe`   | Nested namespaces      |
| `services/payment/alipay.ts`    | `app.services.payment.alipay`   | Nested namespaces      |
| `services/admin/user-manage.ts` | `app.services.admin.userManage` | Nesting + CamelCase    |

**Conversion Rules:**

1. The file path is relative to the `services/` directory, with the extension removed.
2. The file name is automatically converted from `kebab-case` to `camelCase`
3. Subdirectories are mapped to nested objects

`index` is an ordinary service key, unlike route index collapsing: `services/payment/index.ts` maps to `app.services.payment.index`. Every path segment participates in name conversion. Duplicate keys after conversion, or a key used both for a service and a directory namespace, cause a load-time conflict.

### Nested service example

```
src/services/
├── user.ts → app.services.user
├── order.ts → app.services.order
└── payment/
    ├── stripe.ts → app.services.payment.stripe
    └── wechat-pay.ts → app.services.payment.wechatPay
```

```typescript
// src/services/payment/stripe.ts
import type { VextApp } from "vextjs";

export default class StripeService {
  private app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  async createPayment(amount: number, currency: string) {
    this.app.logger.info({ amount, currency }, "Creating Stripe payment");
    // Stripe API calls...
    return { paymentId: "pi_xxx", status: "pending" };
  }

  async refund(paymentId: string) {
    this.app.logger.info({ paymentId }, "Refunding Stripe payment");
    return { refundId: "re_xxx", status: "refunded" };
  }
}
```

```typescript
// Use nested services in routes
app.post("/pay", {}, async (_req, res) => {
  const result = await app.services.payment.stripe.createPayment(100, "usd");
  res.json(result);
});
```

## Service Hooks

Vext installs lightweight wrappers for instance methods loaded into `app.services`. When the service hook is not registered, the call will go directly to the original method; after registering the hook, you can observe the before and after calls and errors:

Only ordinary methods on the prototype chain are wrapped. Constructors, instance arrow-function fields, getters, and setters are excluded. A `service:beforeCall` listener that throws prevents the original method from running; `afterCall` and `error` observers are dispatched safely and do not replace the method result.

```typescript
// src/plugins/service-observer.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "service-observer",
  setup(app) {
    app.hooks.on("service:beforeCall", ({ service, method }) => {
      app.logger.debug({ service, method }, "service call start");
    });

    app.hooks.on("service:error", ({ service, method, error }) => {
      app.logger.error({ service, method, err: error }, "service call failed");
    });
  },
});
```

`service:beforeCall`, `service:afterCall` and `service:error` are all synchronous hooks. Do not return Promise in these handlers; if asynchronous reporting is required, it is recommended to put it in a queue or use log transmission that does not block the main call.

## Inter-service calls

Services can call each other. Access `this.app.services` on demand **inside a method** rather than capturing another service in the constructor:

```typescript
// src/services/order.ts
import type { VextApp } from "vextjs";

export default class OrderService {
  private app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  async createOrder(
    userId: string,
    items: Array<{ productId: string; quantity: number }>,
  ) {
    // Call other services - deferred access through this.app.services
    const user = await this.app.services.user.findById(userId);
    if (!user) {
      this.app.throw(404, "user.not_found");
    }

    // Calculate price
    const total = await this.calculateTotal(items);

    // Call payment service
    const payment = await this.app.services.payment.stripe.createPayment(
      total,
      "usd",
    );

    return {
      orderId: crypto.randomUUID(),
      userId,
      items,
      total,
      paymentId: payment.paymentId,
      status: "created",
    };
  }

  private async calculateTotal(
    items: Array<{ productId: string; quantity: number }>,
  ) {
    //Business logic...
    return items.reduce((sum, item) => sum + item.quantity * 10, 0);
  }
}
```

::::warning avoid circular dependencies
`service-loader` and `vext doctor` share a bounded static dependency graph. A detected cycle between `ServiceA` and `ServiceB` fails startup. The first constructor parameter of the default export is the injected application, regardless of its name. Direct instance assignments, TypeScript parameter properties, and traceable local aliases are supported, including static string access to namespaced services.

Comments, strings, and unrelated local objects do not create dependencies. Dynamic service names, reassignment, inheritance, and untraceable origins report incomplete analysis. The runtime precheck warns and Doctor retains that incomplete status. A static graph does not prove that every runtime path is cycle-free, and analysis does not execute business code to fill its gaps.

**✅ Recommended** — Defer access until the method runs:

Deferred access addresses initialization order only. If A and B still call each other's methods, they may form a static cycle or runtime recursion. Change the dependency direction instead.

```typescript
export default class OrderService {
  constructor(private app: VextApp) {}

  async createOrder() {
    // ✅ The user service has been initialized when the method is called.
    const user = await this.app.services.user.findById("123");
  }
}
```

**❌ Wrong Practice** — Direct reference in the constructor:

```typescript
export default class OrderService {
  private userService: UserService;

  constructor(app: VextApp) {
    // ❌ When the constructor is executed, the user service may not have been initialized yet.
    this.userService = app.services.user;
  }
}
```

::::

## Use the capabilities provided by the plug-in

Capabilities injected by plugins via `app.extend()` are accessed in the service via `this.app`:

```typescript
// Assume that the redis plug-in has been injected via app.extend('redis', redis)
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  private app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  async findById(id: string) {
    //Check cache first
    const cached = await (this.app as any).redis.get(`user:${id}`);
    if (cached) return JSON.parse(cached) as { id: string; name: string };

    // Cache miss, check database
    const user = await this.queryDatabase(id);

    // write to cache
    if (user) {
      await (this.app as any).redis.set(`user:${id}`, JSON.stringify(user));
    }

    return user;
  }

  private async queryDatabase(id: string) {
    // Database query logic...
    return { id, name: "Alice" };
  }
}
```

::::tip type tip
Use `declare module` to extend the `VextApp` interface to get full type hints:

```typescript
// src/types/extensions.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextApp {
    redis: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string, ttl?: number): Promise<void>;
    };
  }
}
```

The extension gives `this.app.redis` IDE completion. Its declaration must match the client API that the plugin actually injects. This example describes an application contract; Redis SDKs do not all share this `set` signature or return type. A type declaration does not establish a runtime connection.
::::

## Use `app.throw()` to throw an error

Services may throw HTTP errors through `this.app.throw()`. When an HTTP request calls the service and lets the exception propagate, the framework catches it and produces a unified error response. A Job or another non-HTTP caller receives an exception, not an HTTP response:

- When you need to actively return `404`, `409`, `401` and other clear HTTP semantics, use `this.app.throw(...)`
- When field-level validation details need to be returned, `VextValidationError` is thrown
- When an unexpected exception occurs, you can directly `throw new Error("...")`, and the framework will uniformly convert it to 500

```typescript
export default class UserService {
  constructor(private app: VextApp) {}

  async findById(id: string) {
    const user = await this.queryDatabase(id);
    if (!user) {
      // Throw it directly in the service, and the framework will handle it uniformly
      this.app.throw(404, "user.not_found");
    }
    return user;
  }

  async create(data: { name: string; email: string }) {
    const existing = await this.findByEmail(data.email);
    if (existing) {
      this.app.throw(409, "Email has been registered", 10001);
    }
    //Create logic...
    return { id: crypto.randomUUID(), ...data };
  }

  private async queryDatabase(id: string) {
    return null; // simulation
  }

  private async findByEmail(email: string) {
    return null; // simulation
  }
}
```

If `throw new Error("...")` is directly inside the service, the framework will also catch it; this path represents an unknown runtime exception, rather than an actively designed HTTP error response. By default, the client will receive a safe `500 Internal Server Error`. In the development environment, the `stack` can be additionally exposed through `response.hideInternalErrors = false` to facilitate troubleshooting.

## Validate non-HTTP input in the service

Route inputs are declared through `RouteOptions.validate`, and the handler reads validated data with `req.valid()`. For non-HTTP inputs processed directly by a service, such as scheduled tasks, message queues, external callbacks, or other service calls, reuse the application's validation engine through `this.app.getValidator()`.

`getValidator()` returns the synchronous schema-dsl validator by default. A plugin may replace it with an adapter implementing `VextValidator`; a raw Zod or Yup instance cannot be assumed to have the same interface. This example compiles and stores a validation function in the constructor. Replace the engine before loading services: a later replacement does not recompile an already stored function.

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

  async createFromJob(input: unknown) {
    const result = this.validateCreateUser(input);

    if (!result.valid) {
      throw new VextValidationError(result.errors ?? []);
    }

    const data = result.data as { name: string; email: string };
    return this.create(data);
  }

  async create(data: { name: string; email: string }) {
    //Create logic...
    return { id: crypto.randomUUID(), ...data };
  }
}
```

::::tip

Use `app.getValidator()` for inputs that should follow the framework's shared validation contract. A separate schema library bypasses `app.setValidator()`; if you choose one deliberately, document its different syntax, error, and conversion semantics. Schema validation does not replace business checks such as inventory, eligibility, or uniqueness.

::::

## Use `app.logger` to record logs

Use `this.app.logger` for structured service logs. An HTTP call with an established request context can carry `requestId` through AsyncLocalStorage. Startup code, Jobs, and calls outside that context cannot assume an HTTP `requestId` exists:

```typescript
export default class PaymentService {
  constructor(private app: VextApp) {}

  async processPayment(orderId: string, amount: number) {
    this.app.logger.info({ orderId, amount }, "Processing payment");

    try {
      // Call external payment API...
      const result = { transactionId: "txn_xxx" };
      this.app.logger.info(
        { orderId, transactionId: result.transactionId },
        "Payment successful",
      );
      return result;
    } catch (err) {
      this.app.logger.error({ orderId, err }, "Payment failed");
      this.app.throw(500, "payment.failed");
    }
  }
}
```

## Loading order and life cycle

### Loading time

In the `bootstrap` startup process, `service-loader` is executed in the following stages:

```
1. config → load configuration
2. locales → load language pack
3. plugins → execute plugin setup()
4. middlewares → load configured middleware names
5. services → ⭐ Instantiate services (here)
6. routes → Register routes (app.services can be safely accessed in handler)
```

This means:

- ✅ `app.config` is accessible in the service constructor (loaded)
- ✅ `app.logger` can be accessed in the service constructor (already initialized)
- ✅ The ability to inject plugins can be accessed in the service constructor (the plugin has been setup)
- ⚠️ Pay attention to the order when accessing `app.services` in the service constructor (see the circular dependency chapter)
- ✅ All `app.services` can be safely accessed in the routing handler (all injections have been completed)

### Instantiation process

1. **Scanning** — Recursively discover `.ts` / `.mts` / `.cts` / `.js` / `.mjs` / `.cjs` service files, excluding auxiliary files as described below
2. **Sort** — Sort alphabetically by file path (to ensure deterministic loading order)
3. **Instantiation** — Create instances of `new ServiceClass(app)` one by one
4. **Mount** — Wrap service methods for Service Hooks, then attach the instance to its property on `app.services`
5. **Detection** — Perform circular dependency detection (optional, enabled by default)

When `createTestApp()` loads TS service sources directly, it uses the framework's compiler and native ESM execution without an additional TS loader. Loading a TS service again evaluates it again and creates a new instance. Its `import.meta.url` / `filename` / `dirname` identify the source file; owned temporary execution files are checked and cleaned before loading returns. Development and compiled production runtimes continue to use their respective compiled outputs and reload lifecycle.

### Exclusion rules

The following files will be automatically skipped:

- Test files: names containing `.test.` or `.spec.`
- Declaration files: `.d.ts`, `.d.mts`, `.d.cts`
- Files/directories starting with `_` or `.`
- Temporary execution files with `.__vext_compiled__` in the name

These exclusions do not mean arbitrary helper content belongs in the scanned directory. The current Service Loader has no dedicated exclusion branch for `node_modules` inside the service directory. Install dependencies at the project root and keep only service entry points in the service directory.

The `_` prefix skips automatic injection, but shared utilities and type dependencies should live outside the scan directory, according to their actual consumers:

```
src/
├── services/
│   ├── user.ts
│   └── order.ts
├── modules/shared/base-service.ts  # Shared base class when genuinely reused
└── types/server/services/order.ts   # Type-only contract shared by server code
```

## Service layer best practices

### 1. Keep the service layer HTTP-agnostic

The service layer should not directly operate on `req` / `res` objects. If you need to request contextual information (such as the current user), pass it in as a parameter:

```typescript
// ✅ Correct — parameters passed in
async createOrder(userId: string, items: OrderItem[]) {
  // ...
}

// ❌ Error — directly manipulate the request object
async createOrder(req: VextRequest, res: VextResponse) {
  // service should not be HTTP aware
}
```

### 2. Single responsibility

Each service corresponds to a business area. Avoid putting logic from different domains in the same service:

```
services/
├── user.ts # User management
├── order.ts # Order management
├── notification.ts # Notification service
└── payment/
    ├── stripe.ts # Stripe payment
    └── wechat-pay.ts # WeChat payment
```

### 3. Use base classes to share common logic

Use a base class when services genuinely share behavior; a plain function is often enough for stateless logic. This example places the base class outside the scan directory. Inheritance can make static dependency analysis incomplete, so check behavior with tests rather than treating unrecognized dependencies as absent:

```typescript
// src/modules/shared/base-service.ts
import type { VextApp } from "vextjs";

export abstract class BaseService {
  protected app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  protected async paginate<T>(
    queryFn: (offset: number, limit: number) => Promise<T[]>,
    countFn: () => Promise<number>,
    page: number,
    limit: number,
  ) {
    const offset = (page - 1) * limit;
    const [items, total] = await Promise.all([
      queryFn(offset, limit),
      countFn(),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
```

```typescript
// src/services/user.ts
import { BaseService } from "../modules/shared/base-service.js";

export default class UserService extends BaseService {
  async findAll(page = 1, limit = 20) {
    return this.paginate(
      (offset, limit) => this.queryUsers(offset, limit),
      () => this.countUsers(),
      page,
      limit,
    );
  }

  private async queryUsers(offset: number, limit: number) {
    return []; // Database query
  }

  private async countUsers() {
    return 0; // Count query
  }
}
```

### 4. TypeScript type declaration

Add a type declaration for `app.services` to get full IDE support:

It is recommended to use the generation command provided by the framework first:

```bash
npm exec -- vext typegen
```

This command will automatically generate the `VextServices` extension declaration in `.vext/types/services.generated.d.ts`, access the TypeScript project through `src/types/generated/index.d.ts`, and perform a round of tooling layer service dependency checking.

`vext dev` runs basic typegen during preflight to keep generated declarations in sync with current `services` and `plugins` definitions. For `--check`, `--write-manifest`, or independent CI control, run `vext typegen` explicitly.

If you also want to provide the service index, `app.extend()` aggregation results and dependency graph summary to the editor, CI or other tool chain for consumption, you can additionally execute:

```bash
npm exec -- vext typegen --write-manifest
```

The corresponding artifact is `.vext/manifest/services.json`.

You can keep a custom `.d.ts` file for a few advanced declarations. Generated and handwritten files are separate, but TypeScript merges their declarations. Properties with the same name must have compatible, identical types; do not duplicate generated properties with conflicting declarations. The following manual example assumes those service files exist and is unnecessary when their properties have already been generated.

```typescript
// src/types/services.d.ts
import type UserService from "../services/user.js";
import type OrderService from "../services/order.js";

declare module "vextjs" {
  interface VextServices {
    user: UserService;
    order: OrderService;
    payment: {
      stripe: import("../services/payment/stripe.js").default;
    };
  }
}
```

Once added, calls like `app.services.user.findById()` will get full method signature hints and type checking.

### Instance scope and resource shutdown

Each application load creates one instance per service, shared by that application's requests. Services are not instantiated per request. Do not store the current user, request object, or temporary request result in an instance field that concurrent requests can overwrite. Each worker has its own instances and memory state.

The framework does not automatically call a service method merely because it is named `close()` or `init()`. Resource owners must register cleanup needed at application shutdown through `app.onClose()`. Prefer plugins to own long-lived connections; a service borrowing a connection should avoid closing it twice.

Targeted service reload in development has a separate, optional `dispose()` convention. The old instance being replaced or removed has that method called and awaited; a thrown error is logged as a warning and reload continues. This does not mean application shutdown automatically calls `dispose()`. If a later load fails, restoring the old instance reference does not reverse resource cleanup that has already happened. Make cleanup repeatable and do not assume a restored reference restores connection state. See [Hot Reload](/guide/hot-reload).

### Troubleshooting and verification

| Symptom                                    | Check                                                                                                  | Verify again                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Service is `undefined`                     | Path key, default export, exclusion rules, and whether loading succeeded                               | Run the complete example on this page after startup |
| `Failed to instantiate service`            | Whether the default export supports `new` and whether the constructor accesses an unmounted dependency | Fix initialization and restart                      |
| Circular dependency or incomplete analysis | Dependency direction and dynamic access; do not hide a cycle with deferred calls                       | Rerun typegen/doctor and relevant business tests    |
| Stale IDE types                            | Whether `tsconfig` includes the generated entry and whether source changed                             | Run `vext typegen`, then independent type checking  |
| Data mixed across requests                 | Whether instance fields store request state                                                            | Call concurrently under different identities        |

## Next step

- Learn how [middleware](/guide/middleware) intercepts and handles requests
- Learn [plugins](/guide/plugins) how to extend framework capabilities
- See [Testing](/guide/testing) how to unit test the service layer

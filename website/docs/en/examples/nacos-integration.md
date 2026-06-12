# Nacos access example

This example demonstrates how to integrate [Nacos](https://nacos.io/) in VextJS to implement **service registration and discovery**, **dynamic configuration during runtime**, and **remote configuration patch during startup**.

VextJS provides the official Nacos plug-in [`vextjs-nacos`](https://www.npmjs.com/package/vextjs-nacos), which encapsulates the registration/discovery and runtime configuration subscription processes. For content that must take effect before the framework configuration is frozen (such as database configuration), the `bootstrap config provider` of `src/config/bootstrap.ts` should be used.

:::tip Recommended practices
Recommended to use in layers:

- **Service registration/discovery, dynamic switch during runtime**: directly use the official plug-in `vextjs-nacos`
- **Boot database/key/infrastructure configuration**: Use `src/config/bootstrap.ts` to pull Nacos configuration and return patch
  :::

## Preconditions

- Nacos Server 2.x (tested nacos@2.6.1)
- Node.js >= 20.19.0
- VextJS >= 0.3.2

## 1. Recommendation: Use the `vextjs-nacos` official plug-in

### 1. Installation

```bash
npm install vextjs-nacos
```

### 2. Configuration (`src/config/default.ts`)

```typescript
export default {
  port: 3000,
  adapter: "native",

  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
    namespace: process.env.NACOS_NAMESPACE ?? "public",
    // Required to enable Nacos for authentication (enabled by default in 2.x)
    username: process.env.NACOS_USERNAME,
    password: process.env.NACOS_PASSWORD,

    // Service registration (the current service is not registered by default)
    service: {
      name: "order-service",
      group: "DEFAULT_GROUP",
      ip: process.env.SERVICE_IP ?? "127.0.0.1",
      port: 3000,
      metadata: { version: "1.0.0", env: process.env.NODE_ENV ?? "dev" },
    },

    //Configuration center (not subscribed by default)
    config: {
      dataId: "order-service",
      group: "DEFAULT_GROUP",
    },

    //Multiple configurations are deeply merged in order (the latter takes precedence)
    configs: [
      { dataId: "order-service-base", group: "DEFAULT_GROUP" },
      { dataId: "order-service-prod", group: "DEFAULT_GROUP" },
    ],
  },
};
```

Description:

- `config` is suitable for single configuration scenarios
- `configs` is suitable for basic configuration + environment coverage configuration split
- When both exist at the same time, they will be merged in the order of `config -> configs[0] -> configs[1] ...`, with the latter taking precedence.

### 3. Register plug-in (src/plugins/nacos.ts)

```typescript
import { nacosPlugin } from "vextjs-nacos";
export default nacosPlugin(); // Automatically read app.config.nacos
```

Explicit parameter passing is also supported (overriding `app.config.nacos`):

```typescript
import { nacosPlugin } from "vextjs-nacos";
export default nacosPlugin({
  serverAddr: "127.0.0.1:8848",
  service: { name: "order-service", ip: "127.0.0.1", port: 3000 },
});
```

#### Dynamic port (recommended: consistent with app.config.port)

`service.port` in `config/default.ts` is a static value and the final merged port number cannot be read.
If the ports of each environment are different (such as sit: 10019 / prod: 20019), it is recommended to dynamically inject it in the plug-in:

```typescript
// src/plugins/nacos.ts
import { definePlugin } from "vextjs";
import { nacosPlugin } from "vextjs-nacos";

export default definePlugin({
  name: "nacos",

  async setup(app) {
    const nacosConfig = app.config.nacos as any;
    if (!nacosConfig) return;

    const inner = nacosPlugin({
      // Only override service.port, other fields inherit app.config.nacos
      ...(nacosConfig.service
        ? {
            service: {
              ...nacosConfig.service,
              ip: process.env.SERVICE_IP ?? "127.0.0.1",
              port: app.config.port,
            },
          }
        : {}),
    });

    await inner.setup(app);
  },
});
```

In this way, `service.port` in `config/default.ts` is only a type placeholder, and the actual registered port is determined by `app.config.port`.
Each environment only needs to set `port: 10019` in the corresponding config file, and nacos will automatically follow.

### 3.1 It is recommended to use `src/config/bootstrap.ts` for remote configuration during startup

If you want to pull the database configuration from Nacos before **MonSQLize is initialized**, do not put this step in a normal plug-in; it is recommended to use `createNacosBootstrapProvider()` provided by `vextjs-nacos` directly:

```typescript
import { defineBootstrapConfig } from "vextjs";
import { createNacosBootstrapProvider } from "vextjs-nacos";// src/config/bootstrap.ts
export default defineBootstrapConfig({
  providers: [
    createNacosBootstrapProvider({
      name: "nacos-config",
      serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
      namespace: process.env.NACOS_NAMESPACE ?? "public",
      username: process.env.NACOS_USERNAME,
      password: process.env.NACOS_PASSWORD,
      configs: [{ dataId: "config.json", group: "db-config" }],
    }),
  ],
});
```

Configuring the priority in this way will enter the official link: `default < env < local < provider < CLI`.

:::info current boundary
`createNacosBootstrapProvider()` is only responsible for batch pulling and deep merging of JSON object patches during the startup period, which is suitable for content such as databases, keys, and infrastructure configurations that "must take effect before the configuration is frozen."

This return value will enter the provider patch merge link of **`app.config` and will not automatically become `app.remoteConfig`.

It is **not responsible** for:

- Service registration
- Service discovery
- `app.nacos` mount
- `app.remoteConfig` injection and runtime subscription update

These runtime capabilities are still handled by `nacosPlugin()`.
:::

If you need:

- Service registration/service discovery
- Consistent `app.remoteConfig` behavior with plugins
- Continuous subscription updates after configuration changes

All should continue to be processed using `nacosPlugin()` in `src/plugins/nacos.ts` instead of completing it in the bootstrap phase.

#### 3.1.1 Can service discovery be done in `bootstrap.ts`?

By default ** cannot be used directly ** `app.nacos!.discover()`.

The reason is that `src/config/bootstrap.ts` runs before **Vext App is created**:

- There is no `app` at this time
- `nacosPlugin()` has not been executed yet
- Therefore `app.nacos` / `app.remoteConfig` does not exist

So the recommended bounds are:

- **Only configuration patch pulling is done during startup** → `createNacosBootstrapProvider()`
- **Runtime service registration/service discovery/configuration subscription** → `nacosPlugin()`

### 3.2 Continue to use `app.remoteConfig` for dynamic configuration during runtime

If the configuration only affects the runtime function switch, grayscale strategy, external API address, etc., and does not need to participate in `database` / `plugins` / `middlewares` initialization, you can directly use the configuration subscription capability of `vextjs-nacos`:

- After initial startup, the plug-in will pull the Nacos configuration and mount it to `app.remoteConfig`
- Subsequent configuration changes will automatically update `app.remoteConfig`
- No need to restart the service

Done. Plugin autocomplete:

- ✅ Register the current service instance to Nacos at startup
- ✅ Pull and subscribe to the configuration center to automatically update `app.remoteConfig`
- ✅ Follow LIFO order when closing: first `deregisterInstance` (stop traffic) → then `configClient.close()`
- ✅ TypeScript type auto-enhancement `app.nacos` / `app.remoteConfig` / `config.nacos`

### 4. Use service discovery

```typescript
// src/services/user.ts
export class UserService {
  constructor(private app: any) {}

  async getUser(userId: string) {
    // Discover user-service through Nacos (return only healthy instances + random load balancing)
    const baseURL = await this.app.nacos!.discover("user-service");

    const response = await this.app.fetch.get(`${baseURL}/api/users/${userId}`);

    if (!response.ok) {
      // ⚠️ The Service layer should not handle HTTP status codes directly (Architectural Constraint #3)
      // Throw a business exception and uniformly convert it into an HTTP response by the routing layer/middleware
      throw new Error(
        `Fetch user failed: ${userId} (status ${response.status})`,
      );
    }
    return response.json();
  }
}
```

For advanced load balancing strategies (weight/consistent hashing), you can directly use `app.nacos!.naming.selectInstances(...)` to call the nacos SDK native API.

### 5. Use remote configuration

```typescript
// src/routes/features.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/features/:key",
    {
      validate: { param: { key: "string!" } },
    },
    async (req, res) => {
      const { key } = req.valid("param");
      const features = (req.app.remoteConfig?.features ?? {}) as Record<
        string,
        boolean
      >;
      res.json({ feature: key, enabled: features[key] ?? false });
    },
  );
});
```

> Nacos configuration content must be legal JSON. When the configuration changes, `app.remoteConfig` will be automatically updated (no need to restart the service).
>
> In the routing handler, if you want to read such fields that may be replaced by `app.extend()` during runtime, it is recommended to use `req.app.remoteConfig` instead of the closure `app.remoteConfig`. The reason is that the closure `app` passed in `defineRoutes()` comes from the collector copy; when the plugin subsequently uses `app.extend("remoteConfig", nextValue)` to replace it with a new object, the old reference captured in the closure will not be automatically refreshed.

#### Multiple configuration runtime example

```typescript
// src/config/default.ts
export default {
  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
    namespace: process.env.NACOS_NAMESPACE ?? "public",
    configs: [
      { dataId: "features-base.json", group: "DEFAULT_GROUP" },
      {
        dataId: `features-${process.env.NODE_ENV ?? "development"}.json`,
        group: "DEFAULT_GROUP",
      },
    ],
  },
};
```

This approach is suitable for:

- Basic switches + environment coverage
- Common service configuration + tenant/region incremental configuration
- Hierarchical maintenance of grayscale parameters during runtime

---

## 2. Best Practices

### Service discovery cache (high-frequency calling scenario)

`discover()` queries Nacos every time. In high QPS scenarios, it is recommended to add local cache:

```typescript
const cache = new Map<string, { url: string; expireAt: number }>();

async function cachedDiscover(
  app: any,
  name: string,
  ttl = 30_000,
): Promise<string> {
  const c = cache.get(name);
  if (c && c.expireAt > Date.now()) return c.url;
  const url = await app.nacos!.discover(name);
  cache.set(name, { url, expireAt: Date.now() + ttl });
  return url;
}
```

> Nacos SDK's `subscribe` internally maintains a local cache of the instance list, so it is more efficient even without adding a layer cache. The main significance of local caching is to avoid the overhead of calling selectInstances every time discover is called.

### Health check endpoint

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/health", { override: { rateLimit: false } }, async (req, res) => {
    const checks: Record<string, string | number> = { status: "ok" };
    if (app.nacos) {
      try {
        const instances = await app.nacos.naming.selectInstances(
          app.config.nacos!.service!.name,
          "DEFAULT_GROUP",
          undefined,
          true,
        );
        checks.nacos = "connected";
        checks.instances = instances.length;
      } catch {
        checks.nacos = "disconnected";
      }
    }
    res.json(checks);
  });
});
```

### Nacos configuration data format

Use JSON when creating configurations in the console:

```json
{
  "features": { "newDashboard": true, "betaMode": false },
  "rateLimit": { "max": 100, "window": 60000 },
  "externalApis": { "paymentGateway": "https://pay.example.com/v2" }
}
```

After modification, the vext application will automatically receive the changes through subscription without restarting.

---

## 3. Next step

- 📦 [`vextjs-nacos` npm package](https://www.npmjs.com/package/vextjs-nacos) — Complete API documentation and change log
- 🔭 [OpenTelemetry access example](/examples/opentelemetry) — Full observability
- 🔌 [Plugin System](/guide/plugins) — `definePlugin()` Custom plugin
- 🌐 [app.fetch](/guide/fetch) — built-in HTTP client (timeouts/retries/requestId propagation)
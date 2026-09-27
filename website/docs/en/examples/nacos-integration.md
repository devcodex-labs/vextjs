# Nacos access example

This example demonstrates how to integrate [Nacos](https://nacos.io/) in VextJS to implement **service registration and discovery**, **dynamic configuration during runtime**, and **remote configuration patch during startup**.

VextJS provides the official Nacos plug-in [`@devcodex/nacos`](https://www.npmjs.com/package/@devcodex/nacos), which encapsulates the registration/discovery and runtime configuration subscription processes. For content that must take effect before the framework configuration is frozen (such as database configuration), the `bootstrap config provider` of `src/config/bootstrap.ts` should be used.

:::tip Recommended practices
Recommended to use in layers:

- **Service registration/discovery, dynamic switch during runtime**: directly use the official plug-in `@devcodex/nacos`
- **Boot database/key/infrastructure configuration**: Use `src/config/bootstrap.ts` to pull Nacos configuration and return patch
  :::

## Preconditions

- Prepare a Vext TypeScript API project with `dev`, `build`, and `start`
  scripts from [Quick Start](/guide/quick-start).
- The current framework requires Node.js **`^20.19.0 || >=22.12.0`**
- Prepare a reachable Nacos server and verify the namespace's actual ID,
  group, authentication, and client network. The plugin defaults to the
  public namespace; configure a different deployed ID explicitly.
- The plugin checked on 2026-09-25 was `@devcodex/nacos@0.2.10`. Its Vext
  peer range is `>=0.3.4`, and its internal JavaScript SDK is `nacos@2.6.3`.
  The SDK version is not the Nacos Server version. This page does not claim
  every server version has been verified. Check the
  [plugin release information](https://github.com/devcodex-labs/nacos) and
  your actual environment.

## 1. Recommendation: Use the `@devcodex/nacos` official plug-in

### 1. Installation

```bash
npm install @devcodex/nacos
```

### 2. Configuration (`src/config/default.ts`)

```typescript
export default {
  port: 3000,
  adapter: "native",

  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
    namespace: process.env.NACOS_NAMESPACE ?? "public",
    // Supply these if authentication is enabled on your server.
    username: process.env.NACOS_USERNAME,
    password: process.env.NACOS_PASSWORD,

    // Service registration (the current service is not registered by default)
    service: {
      name: "order-service",
      group: "DEFAULT_GROUP",
      ip: process.env.SERVICE_IP ?? "127.0.0.1",
      port: 3000,
      metadata: {
        version: "1.0.0",
        profile: process.env.VEXT_CONFIG ?? "default",
      },
    },

    //Configuration center (not subscribed by default)
    config: {
      dataId: "order-service",
      group: "DEFAULT_GROUP",
    },
  },
};
```

Description:

- `config` is suitable for single configuration scenarios
- `configs` is suitable for basic configuration + environment coverage configuration split
- When both exist, the merge order is `config -> configs[0] -> configs[1] ...`; later objects win, while arrays replace as a whole. This first example uses only `config`.
- Explicit plugin parameters and `app.config.nacos` merge shallowly; passing `service` replaces the entire service object.
- The server decides whether authentication is enabled. Do not infer a default from a "2.x" label; see the [Nacos authentication docs](https://nacos.io/en-us/docs/auth.html).

### 3. Register plug-in (src/plugins/nacos.ts)

```typescript
import { nacosPlugin } from "@devcodex/nacos";
export default nacosPlugin(); // Automatically read app.config.nacos
```

### 4. Read a feature flag

```typescript
// src/routes/features.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/:key",
    {
      validate: { param: { key: "string!" } },
    },
    async (req, res) => {
      const { key } = req.valid("param");
      const features = (req.app.remoteConfig?.features ?? {}) as Record<
        string,
        boolean
      >;
      res.json({ feature: key, enabled: features[key] === true });
    },
  );
});
```

Nacos config must be a JSON object. This route enables only a flag whose
value is strictly `true`; a wrong type does not count as enabled. The plugin
keeps the top-level `remoteConfig` object reference and updates its fields
in place. The property may not yet exist when the first pull fails, so read
it through `req.app` at request time with a default. A cached nested-object
reference is not guaranteed to refresh after an update.

### 5. Start and verify

In the Nacos console, create dataId `order-service` in the selected
namespace and `DEFAULT_GROUP` with this JSON:

```json
{ "features": { "newDashboard": true } }
```

From the application directory:

```bash
npm run dev
curl -i http://127.0.0.1:3000/features/newDashboard
```

Expect HTTP 200 and `data.enabled: true` in the default wrapper. Change the
remote field to `false`, wait for the subscription update log, and request
again; expect `false`. An unknown key defaults to `false`. The console should
show an `order-service` instance at port 3000. Stop dev and verify the
production path:

```bash
npm run build -- --typecheck
npm start
```

After stopping the app, confirm the instance is unregistered. A registered
service address must be reachable by consumers; `127.0.0.1` is only for a
local demonstration. Successful registration during startup does not mean
the HTTP listener is ready; arrange readiness and load-balancer draining in
deployment. Verify production config, authentication, and network access in
the actual Nacos environment.

## 2. Extended configuration and service discovery

### Explicit plugin options

Explicit parameter passing is also supported (overriding `app.config.nacos`):

```typescript
import { nacosPlugin } from "@devcodex/nacos";
export default nacosPlugin({
  serverAddr: "127.0.0.1:8848",
  service: { name: "order-service", ip: "127.0.0.1", port: 3000 },
});
```

### Dynamic port (consistent with app.config.port)

`service.port` in `config/default.ts` is a static value and the final merged port number cannot be read.
If the ports of each environment are different (such as sit: 10019 / prod: 20019), it is recommended to dynamically inject it in the plug-in:

```typescript
// src/plugins/nacos.ts
import { definePlugin } from "vextjs";
import { nacosPlugin, type NacosPluginOptions } from "@devcodex/nacos";

export default definePlugin({
  name: "nacos",

  async setup(app, context) {
    const nacosConfig = app.config.nacos as NacosPluginOptions | undefined;
    if (!nacosConfig) return;

    const inner = nacosPlugin({
      // Only override service.port, other fields inherit app.config.nacos
      ...(nacosConfig.service
        ? {
            service: {
              ...nacosConfig.service,
              port: app.config.port,
            },
          }
        : {}),
    });

    await inner.setup(app, context);
  },
});
```

In this way, `service.port` in `config/default.ts` is only a type placeholder, and the actual registered port is determined by `app.config.port`.
Each environment only needs to set `port: 10019` in the corresponding config file, and nacos will automatically follow.

### Use `src/config/bootstrap.ts` for startup remote config

If you want to pull the database configuration from Nacos before **MonSQLize is initialized**, do not put this step in a normal plug-in; it is recommended to use `createNacosBootstrapProvider()` provided by `@devcodex/nacos` directly:

```typescript
import { defineBootstrapConfig } from "vextjs";
import { createNacosBootstrapProvider } from "@devcodex/nacos";

// src/config/bootstrap.ts
export default defineBootstrapConfig({
  providers: [
    createNacosBootstrapProvider({
      name: "nacos-config",
      required: true,
      timeoutMs: 5000,
      serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
      namespace: process.env.NACOS_NAMESPACE ?? "public",
      username: process.env.NACOS_USERNAME,
      password: process.env.NACOS_PASSWORD,
      configs: [{ dataId: "config.json", group: "db-config" }],
    }),
  ],
});
```

Prepare `config.json` in the `db-config` group. Its root must directly use
the Vext config shape, such as `database`, without an extra `remoteConfig`
wrapper. The provider closes its client after pulling and does not keep a
subscription. With `required: true`, pull, parse, or timeout failures block
startup; an initial pull failure in the ordinary runtime plugin only logs
a warning. The priority is `default < config profile < local < provider <
CLI`, with local loaded only in development/test; see
[Configuration](/guide/configuration).

:::info current boundary
`createNacosBootstrapProvider()` is only responsible for batch pulling and deep merging of JSON object patches during the startup period, which is suitable for content such as databases, keys, and infrastructure configurations that "must take effect before the configuration is frozen."

The result enters the **`app.config` provider patch merge** and does not
automatically become `app.remoteConfig`.

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

#### Service discovery boundary during bootstrap

You cannot directly call `app.nacos!.discover()` there by default.

The reason is that `src/config/bootstrap.ts` runs before **Vext App is created**:

- There is no `app` at this time
- `nacosPlugin()` has not been executed yet
- Therefore `app.nacos` / `app.remoteConfig` does not exist

So the recommended bounds are:

- **Only configuration patch pulling is done during startup** → `createNacosBootstrapProvider()`
- **Runtime service registration/service discovery/configuration subscription** → `nacosPlugin()`

### Use `app.remoteConfig` for runtime configuration

If configuration affects only runtime feature flags, gradual rollout settings, or external API addresses, and is not needed to initialize `database`, `plugins`, or `middlewares`, use the configuration subscription provided by `@devcodex/nacos`:

- After initial startup, the plug-in will pull the Nacos configuration and mount it to `app.remoteConfig`
- Subsequent configuration changes will automatically update `app.remoteConfig`
- No need to restart the service

Actual behavior depends on what is configured:

- `enabled: false`, no `serverAddr`, or neither a config source nor a service
  skips initialization and does not mount related extensions.
- Configuring `service` creates the Naming Client, registers the instance,
  and mounts `app.nacos`. A config-only subscription cannot call `discover`.
- Configuring `config` or `configs` pulls and subscribes `app.remoteConfig`.
  Invalid JSON or non-object changes warn and keep that source's last valid
  version; empty content removes that source.
- With both enabled, close in LIFO order deregisters the instance and closes
  the Naming Client, then closes the Config Client. Deregistration failure
  logs a warning; a completed call does not prove the server confirmed it.
- Importing the package augments VextApp/VextConfig types but does not mean
  runtime initialization happened. `app.config` remains frozen; dynamic
  config does not rebuild the database or rate limit middleware.

### Use service discovery

```typescript
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  constructor(private app: VextApp) {}

  async getUser(userId: string) {
    // Discover user-service through Nacos (return only healthy instances + random load balancing)
    if (!this.app.nacos)
      throw new Error("Nacos service discovery is not configured");
    const baseURL = await this.app.nacos.discover("user-service");

    const response = await this.app.fetch.get(
      `${baseURL}/api/users/${encodeURIComponent(userId)}`,
    );

    if (!response.ok) {
      // Inspect the upstream response and let the caller decide this app's HTTP response.
      throw new Error(
        `Fetch user failed: ${userId} (status ${response.status})`,
      );
    }
    return response.json();
  }
}
```

This advanced Service assumes another `user-service` is registered and
offers `/api/users/:id`. An application route may call
`app.services.user.getUser(id)`. `discover` throws if no healthy instance
exists and returns an HTTP URL. `selectInstances` can return a list, but
the caller must implement weighting or consistent-hash selection.

### Multiple runtime configurations

```typescript
// src/config/default.ts
export default {
  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
    namespace: process.env.NACOS_NAMESPACE ?? "public",
    configs: [
      { dataId: "features-base.json", group: "DEFAULT_GROUP" },
      {
        dataId: `features-${process.env.VEXT_CONFIG ?? "development"}.json`,
        group: "DEFAULT_GROUP",
      },
    ],
  },
};
```

This approach is suitable for:

- Feature flags and environment-specific overrides
- Shared service settings with tenant or region overrides
- Gradual rollout settings updated during runtime

---

## 3. Runtime boundaries and troubleshooting

### Service discovery cache for frequent calls

`discover` calls the Naming Client's `selectInstances` each time.
Whether that reaches the network depends on the SDK's instance cache and
subscription state. Add an application cache only when measurement shows it
is needed. This single-app, default-group snippet demonstrates a TTL:

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

> Caching one URL pins traffic to one instance for the TTL and may keep
> calling a removed node. Clear and rediscover after failure. With multiple
> apps, namespaces, or groups, isolate caches and include those dimensions
> in their keys; do not share this name-only Map.

### Dependency diagnostic endpoint

This independent route checks the Nacos dependency. It does not replace the
framework's built-in `/health`:

```typescript
// src/routes/nacos-status.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", { override: { rateLimit: false } }, async (req, res) => {
    const nacos = req.app.nacos;
    const service = req.app.config.nacos?.service;
    if (!nacos || !service) {
      res.json({ status: "not-configured" }, 503);
      return;
    }
    try {
      const instances = await nacos.naming.selectInstances(
        service.name,
        service.group ?? "DEFAULT_GROUP",
        undefined,
        true,
      );
      res.json(
        {
          status: instances.length ? "ok" : "no-healthy-instance",
          instances: instances.length,
        },
        instances.length ? 200 : 503,
      );
    } catch {
      res.json({ status: "unavailable" }, 503);
    }
  });
});
```

Request `/nacos-status`; 503 means this example's dependency check failed.
The query may use the SDK cache, so 200 does not prove a real-time probe of
the Nacos server.

### Nacos config data format

Create JSON config in the console:

```json
{
  "features": { "newDashboard": true, "betaMode": false },
  "businessLimits": { "maxOrdersPerHour": 100 },
  "externalApis": { "paymentGateway": "https://pay.example.com/v2" }
}
```

Subscription updates only change `app.remoteConfig`. Application code
must read those values when used; they do not automatically change initialized
framework settings such as `app.config.rateLimit`.

| Problem                                      | Check and verify                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Not registered or no `app.nacos`             | Check `service`, `enabled`, `serverAddr`, and registration errors; restart and inspect console instances. |
| Flag always false                            | Check namespace ID, group, dataId, and JSON object; wait for an update log and request again.             |
| Database does not change after config update | An ordinary subscription does not rebuild infrastructure; use a bootstrap patch and restart.              |
| Discovery address unreachable                | Check `service.ip/port` and the consumer network; request the address from a consumer.                    |
| Instance remains after shutdown              | Inspect deregistration logs, Naming Client close, and server state; process exit alone is insufficient.   |

## 4. Next step

- [`@devcodex/nacos` npm package](https://www.npmjs.com/package/@devcodex/nacos) — API docs and changelog.
- [OpenTelemetry integration example](/examples/opentelemetry) — observability.
- [Plugin system](/guide/plugins) — custom `definePlugin()` extensions.
- [app.fetch](/guide/fetch) — built-in HTTP client, timeouts, retries, and request ID propagation.

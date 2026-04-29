# Nacos 接入示例

本示例演示如何在 VextJS 中集成 [Nacos](https://nacos.io/)，实现**服务注册与发现**、**运行期动态配置**，以及**启动期远程配置补丁**。

VextJS 提供官方 Nacos 插件 [`vextjs-nacos`](https://www.npmjs.com/package/vextjs-nacos)，封装了注册/发现与运行期配置订阅流程。对于必须在框架配置冻结前生效的内容（如数据库配置），应使用 `src/config/bootstrap.ts` 的 `bootstrap config provider`。

:::tip 推荐做法
推荐分层使用：

- **服务注册/发现、运行期动态开关**：直接使用官方插件 `vextjs-nacos`
- **启动期数据库/密钥/基础设施配置**：使用 `src/config/bootstrap.ts` 拉取 Nacos 配置并返回 patch
  :::

## 前置条件

- Nacos Server 2.x（已实测 nacos@2.6.1）
- Node.js >= 18
- VextJS >= 0.3.2

## 一、推荐：使用 `vextjs-nacos` 官方插件

### 1. 安装

```bash
npm install vextjs-nacos
```

### 2. 配置（`src/config/default.ts`）

```typescript
export default {
  port: 3000,
  adapter: "native",

  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
    namespace: process.env.NACOS_NAMESPACE ?? "public",
    // 开启鉴权的 Nacos（2.x 默认开启）必填
    username: process.env.NACOS_USERNAME,
    password: process.env.NACOS_PASSWORD,

    // 服务注册（缺省则不注册当前服务）
    service: {
      name: "order-service",
      group: "DEFAULT_GROUP",
      ip: process.env.SERVICE_IP ?? "127.0.0.1",
      port: 3000,
      metadata: { version: "1.0.0", env: process.env.NODE_ENV ?? "dev" },
    },

    // 配置中心（缺省则不订阅）
    config: {
      dataId: "order-service",
      group: "DEFAULT_GROUP",
    },

    // 多配置按顺序深合并（后者优先）
    configs: [
      { dataId: "order-service-base", group: "DEFAULT_GROUP" },
      { dataId: "order-service-prod", group: "DEFAULT_GROUP" },
    ],
  },
};
```

说明：

- `config` 适合单配置场景
- `configs` 适合基础配置 + 环境覆盖配置拆分
- 当两者同时存在时，会按 `config -> configs[0] -> configs[1] ...` 顺序合并，后者优先

### 3. 注册插件（src/plugins/nacos.ts）

```typescript
import { nacosPlugin } from "vextjs-nacos";
export default nacosPlugin(); // 自动读取 app.config.nacos
```

也支持显式传参（覆盖 `app.config.nacos`）：

```typescript
import { nacosPlugin } from "vextjs-nacos";
export default nacosPlugin({
  serverAddr: "127.0.0.1:8848",
  service: { name: "order-service", ip: "127.0.0.1", port: 3000 },
});
```

#### 动态端口（推荐：与 app.config.port 保持一致）

`config/default.ts` 中的 `service.port` 是静态值，无法读取最终合并后的端口号。
若各环境端口不同（如 sit: 10019 / prod: 20019），推荐在插件中动态注入：

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
      // 只覆盖 service.port，其余字段继承 app.config.nacos
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

这样 `config/default.ts` 里 `service.port` 仅作类型占位，实际注册端口由 `app.config.port` 决定，
各环境只需在对应 config 文件设置 `port: 10019`，nacos 自动跟随。

### 3.1 启动期远程配置推荐走 `src/config/bootstrap.ts`

如果你希望在 **MonSQLize 初始化之前** 就从 Nacos 拉取数据库配置，不要把这一步放在普通插件里；推荐直接使用 `vextjs-nacos` 提供的 `createNacosBootstrapProvider()`：

```typescript
import { defineBootstrapConfig } from "vextjs";
import { createNacosBootstrapProvider } from "vextjs-nacos";

// src/config/bootstrap.ts
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

这样配置优先级会进入正式链路：`default < env < local < provider < CLI`。

:::info 当前边界
`createNacosBootstrapProvider()` 只负责**启动期批量拉取并深合并 JSON 对象 patch**，适合数据库、密钥、基础设施配置这类“必须在配置冻结前生效”的内容。

这份返回值会进入 **`app.config` 的 provider patch 合并链路**，不会自动变成 `app.remoteConfig`。

它**不负责**：

- 服务注册
- 服务发现
- `app.nacos` 挂载
- `app.remoteConfig` 注入与运行期订阅更新

这些运行期能力仍然由 `nacosPlugin()` 负责。
:::

如果你需要：

- 服务注册 / 服务发现
- 与插件一致的 `app.remoteConfig` 行为
- 配置变更后的持续订阅更新

都应该继续在 `src/plugins/nacos.ts` 中使用 `nacosPlugin()` 处理，而不是在 bootstrap 阶段完成。

#### 3.1.1 `bootstrap.ts` 里能不能做服务发现？

默认**不能直接使用** `app.nacos!.discover()`。

原因是 `src/config/bootstrap.ts` 运行在 **Vext App 创建之前**：

- 此时还没有 `app`
- `nacosPlugin()` 也还没有执行
- 因而不存在 `app.nacos` / `app.remoteConfig`

所以推荐边界是：

- **启动期只做配置 patch 拉取** → `createNacosBootstrapProvider()`
- **运行期服务注册 / 服务发现 / 配置订阅** → `nacosPlugin()`

### 3.2 运行期动态配置继续使用 `app.remoteConfig`

如果配置只影响运行期功能开关、灰度策略、外部 API 地址等，不需要参与 `database` / `plugins` / `middlewares` 初始化，则直接使用 `vextjs-nacos` 的配置订阅能力即可：

- 初次启动后插件会拉取 Nacos 配置并挂载到 `app.remoteConfig`
- 后续配置变更会自动更新 `app.remoteConfig`
- 无需重启服务

完成。插件自动完成：

- ✅ 启动时注册当前服务实例到 Nacos
- ✅ 拉取并订阅配置中心，自动更新 `app.remoteConfig`
- ✅ 关闭时按 LIFO 顺序：先 `deregisterInstance`（停流量）→ 再 `configClient.close()`
- ✅ TypeScript 类型自动增强 `app.nacos` / `app.remoteConfig` / `config.nacos`

### 4. 使用服务发现

```typescript
// src/services/user.ts
export class UserService {
  constructor(private app: any) {}

  async getUser(userId: string) {
    // 通过 Nacos 发现 user-service（仅返回健康实例 + 随机负载均衡）
    const baseURL = await this.app.nacos!.discover("user-service");

    const response = await this.app.fetch.get(`${baseURL}/api/users/${userId}`);

    if (!response.ok) {
      // ⚠️ Service 层不应直接处理 HTTP 状态码（架构约束 #3）
      // 抛业务异常，由路由层/中间件统一转换为 HTTP 响应
      throw new Error(
        `Fetch user failed: ${userId} (status ${response.status})`,
      );
    }
    return response.json();
  }
}
```

如需高级负载均衡策略（权重 / 一致性哈希），可直接使用 `app.nacos!.naming.selectInstances(...)` 调用 nacos SDK 原生 API。

### 5. 使用远程配置

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

> Nacos 配置内容须为合法 JSON。配置变更时，`app.remoteConfig` 会自动更新（无需重启服务）。
>
> 在路由 handler 中若要读取这类**运行期可能被 `app.extend()` 替换引用**的字段，建议优先使用 `req.app.remoteConfig`，而不是闭包 `app.remoteConfig`。原因是 `defineRoutes()` 传入的闭包 `app` 来自 collector 拷贝；当插件后续用 `app.extend("remoteConfig", nextValue)` 替换为新对象时，闭包里捕获的旧引用不会自动刷新。

#### 多配置运行期示例

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

这种方式适合：

- 基础开关 + 环境覆盖
- 通用服务配置 + 租户/区域增量配置
- 运行期灰度参数分层维护

---

## 二、最佳实践

### 服务发现缓存（高频调用场景）

`discover()` 每次都查询 Nacos。高 QPS 场景建议加本地缓存：

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

> Nacos SDK 的 `subscribe` 内部已维护实例列表的本地缓存，所以即使不加上层缓存也已较高效。本地缓存的主要意义是**避免每次 discover 调用 selectInstances 的开销**。

### 健康检查端点

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

### Nacos 配置数据格式

控制台中创建配置时使用 JSON：

```json
{
  "features": { "newDashboard": true, "betaMode": false },
  "rateLimit": { "max": 100, "window": 60000 },
  "externalApis": { "paymentGateway": "https://pay.example.com/v2" }
}
```

修改后 vext 应用会通过订阅自动接收变更，无需重启。

---

## 三、下一步

- 📦 [`vextjs-nacos` npm 包](https://www.npmjs.com/package/vextjs-nacos) — 完整 API 文档与变更日志
- 🔭 [OpenTelemetry 接入示例](/examples/opentelemetry) — 完整可观测性
- 🔌 [插件系统](/guide/plugins) — `definePlugin()` 自定义插件
- 🌐 [app.fetch](/guide/fetch) — 内置 HTTP 客户端（超时/重试/requestId 传播）

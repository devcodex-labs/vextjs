# Nacos 接入示例

本示例演示如何在 VextJS 中集成 [Nacos](https://nacos.io/)，实现**服务注册与发现**和**动态配置管理**。

VextJS 提供官方 Nacos 插件 [`vextjs-nacos`](https://www.npmjs.com/package/vextjs-nacos)，封装了完整的注册/发现/配置订阅流程，**只需一行代码即可接入**。

:::tip 推荐做法
直接使用官方插件 `vextjs-nacos`。本文档同时保留"手动集成"章节供深入定制场景参考。
:::

## 前置条件

- Nacos Server 2.x（已实测 nacos@2.6.1）
- Node.js >= 18
- VextJS >= 0.2.0

## 一、推荐：使用 `vextjs-nacos` 官方插件

### 1. 安装

```bash
npm install vextjs-nacos
```

### 2. 配置（vext.config.ts / src/config/default.ts）

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
  },
};
```

### 3. 注册插件（src/plugins/nacos.ts）

```typescript
import { nacosPlugin } from "vextjs-nacos";
export default nacosPlugin();   // 自动读取 vext.config.ts 中的 nacos 配置
```

也支持显式传参（覆盖 vext.config.ts）：

```typescript
import { nacosPlugin } from "vextjs-nacos";
export default nacosPlugin({
  serverAddr: "127.0.0.1:8848",
  service: { name: "order-service", ip: "127.0.0.1", port: 3000 },
});
```

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
      throw new Error(`Fetch user failed: ${userId} (status ${response.status})`);
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
  app.get("/features/:key", {
    validate: { param: { key: "string!" } },
  }, async (req, res) => {
    const { key } = req.valid("param");
    const features = (app.remoteConfig?.features ?? {}) as Record<string, boolean>;
    res.json({ feature: key, enabled: features[key] ?? false });
  });
});
```

> Nacos 配置内容须为合法 JSON。配置变更时，`app.remoteConfig` 会自动更新（无需重启服务）。

### 6. 多环境部署（namespace 隔离）

```bash
# 开发
NACOS_SERVER_ADDR=dev-nacos:8848 NACOS_NAMESPACE=dev node dist/index.js

# 生产
NACOS_SERVER_ADDR=prod-nacos:8848 NACOS_NAMESPACE=prod node dist/index.js
```

---

## 二、手动集成（高级定制场景）

> ⚠️ 仅当推荐插件无法满足特殊需求时使用。手动集成需要注意以下 Nacos SDK 行为细节，否则容易踩坑。

### 已知 Nacos SDK 陷阱（基于 nacos@2.6.1 实证）

| 项 | 错误用法 | 正确用法 |
|----|---------|---------|
| `selectInstances` 参数 | `selectInstances(name, group, true)` 把 `true` 当 `clusters` | `selectInstances(name, group, undefined, true)` — 第3参 clusters，第4参 healthy |
| `NacosNamingClient.close()` | 调用 `naming.close()` 抛 `TypeError` | SDK 无此方法，仅 `deregisterInstance()` 即可 |
| `NacosConfigClient.ready()` | 等待 `await configClient.ready()` 抛错 | SDK 无此方法，构造后直接使用 |
| serverAddr 字段 | NamingClient 也用 `serverAddr` | NamingClient 用 `serverList`，ConfigClient 用 `serverAddr` |
| logger 字段 | 省略 logger 参数 | NamingClient `logger` 必填（`typeof console`）|
| Instance metadata | 直接传 `Instance` 类型 | nacos `Instance` 类型不完整，传入时需 `as any` 局部断言 |

### 手动插件实现（已修正所有上述问题）

```typescript
// src/plugins/nacos.ts
import { definePlugin } from "vextjs";
import { NacosNamingClient, NacosConfigClient } from "nacos";

export default definePlugin({
  name: "nacos",

  async setup(app) {
    const cfg = app.config.nacos;
    if (!cfg?.serverAddr) {
      app.logger.warn("[nacos] serverAddr missing, skipping");
      return;
    }
    const namespace = cfg.namespace ?? "public";

    // logger 桥接（一元 string 签名）
    const logger = {
      info:  (m: string) => app.logger.debug({ source: "nacos" }, m),
      warn:  (m: string) => app.logger.warn({ source: "nacos" }, m),
      error: (m: string) => app.logger.error({ source: "nacos" }, m),
      debug: (m: string) => app.logger.debug({ source: "nacos" }, m),
      log:   (m: string) => app.logger.debug({ source: "nacos" }, m),
    };

    // ── 配置中心（先注册 onClose → LIFO 后执行）─────
    if (cfg.config) {
      const configClient = new NacosConfigClient({
        serverAddr: cfg.serverAddr,    // ⚠️ ConfigClient 字段名 serverAddr
        namespace,
        username: cfg.username,
        password: cfg.password,
      });
      // ❌ 不要 await configClient.ready()（SDK 无此方法）

      const { dataId, group: cGroup = "DEFAULT_GROUP" } = cfg.config;
      const raw = await configClient.getConfig(dataId, cGroup);
      if (raw) {
        try { app.extend("remoteConfig", JSON.parse(raw)); }
        catch { app.logger.warn(`[nacos] Config parse failed: ${dataId}`); }
      }
      configClient.subscribe({ dataId, group: cGroup }, (content: unknown) => {
        if (typeof content !== "string") return;
        try { app.extend("remoteConfig", JSON.parse(content)); }
        catch { app.logger.warn(`[nacos] Updated config parse failed: ${dataId}`); }
      });
      app.onClose(() => configClient.close());
    }

    // ── 服务注册与发现（后注册 onClose → LIFO 先执行：先停流量）──
    if (cfg.service) {
      const { name, group, ip, port, metadata } = cfg.service;
      const groupName = group ?? "DEFAULT_GROUP";

      const namingClient = new NacosNamingClient({
        logger: logger as unknown as typeof console,  // SDK 类型要求 typeof console
        serverList: cfg.serverAddr,    // ⚠️ NamingClient 字段名 serverList
        namespace,
        username: cfg.username,
        password: cfg.password,
      });
      await namingClient.ready();

      // nacos Instance 类型不含 metadata 字段，as any 局部断言
      await namingClient.registerInstance(
        name, { ip, port, metadata } as any, groupName,
      );

      app.extend("nacos", {
        naming: namingClient,
        async discover(serviceName: string, g = "DEFAULT_GROUP") {
          const instances = await namingClient.selectInstances(
            serviceName, g,
            undefined,  // clusters: 不传（不要写 true！）
            true,       // healthy: 仅健康实例
          );
          if (!instances?.length) throw new Error(`No healthy instance: ${serviceName}`);
          const inst = instances[Math.floor(Math.random() * instances.length)];
          return `http://${inst.ip}:${inst.port}`;
        },
      });

      app.onClose(async () => {
        await namingClient.deregisterInstance(
          name, { ip, port } as any, groupName,
        );
        // ❌ 不要 namingClient.close()（SDK 无此方法）
      });
    }
  },
});
```

### 类型声明（手动集成需自行声明）

```typescript
// src/types/nacos.d.ts
import type { NacosNamingClient } from "nacos";

declare module "vextjs" {
  interface VextApp {
    nacos?: {
      naming: NacosNamingClient;
      discover(serviceName: string, group?: string): Promise<string>;
    };
    remoteConfig?: Record<string, unknown>;
  }
  interface VextConfig {
    nacos?: {
      serverAddr: string;
      namespace?: string;
      username?: string;
      password?: string;
      service?: { name: string; group?: string; ip: string; port: number; metadata?: Record<string, string> };
      config?: { dataId: string; group?: string };
    };
  }
}
```

> 使用 `vextjs-nacos` 时，类型声明已通过 `declare module` 内置在包中，**无需手动声明**。

---

## 三、最佳实践

### 服务发现缓存（高频调用场景）

`discover()` 每次都查询 Nacos。高 QPS 场景建议加本地缓存：

```typescript
const cache = new Map<string, { url: string; expireAt: number }>();

async function cachedDiscover(app: any, name: string, ttl = 30_000): Promise<string> {
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
          app.config.nacos!.service!.name, "DEFAULT_GROUP",
          undefined, true,
        );
        checks.nacos = "connected";
        checks.instances = instances.length;
      } catch { checks.nacos = "disconnected"; }
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

## 下一步

- 📦 [`vextjs-nacos` npm 包](https://www.npmjs.com/package/vextjs-nacos) — 完整 API 文档与变更日志
- 🔭 [OpenTelemetry 接入示例](/examples/opentelemetry) — 完整可观测性
- 🔌 [插件系统](/guide/plugins) — `definePlugin()` 自定义插件
- 🌐 [app.fetch](/guide/fetch) — 内置 HTTP 客户端（超时/重试/requestId 传播）


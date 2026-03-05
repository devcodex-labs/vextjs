# Nacos 接入示例

本示例演示如何在 VextJS 中集成 [Nacos](https://nacos.io/)，实现**服务注册与发现**和**动态配置管理**。Nacos 是阿里巴巴开源的服务发现和配置管理平台，广泛应用于微服务架构。

## 前置条件

- 运行中的 Nacos Server（推荐 2.x 版本）
- Node.js 18+
- VextJS 项目已初始化

## 安装依赖

```bash
npm install nacos
```

:::tip
`nacos` 是 Nacos 官方提供的 Node.js SDK，支持服务注册/发现和配置管理两大功能。
:::

## 项目结构

```
src/
├── plugins/
│   └── nacos.ts           # Nacos 插件（注册/发现 + 配置）
├── services/
│   └── user.ts            # 业务服务（演示服务发现调用）
├── routes/
│   └── users.ts           # 路由
└── vext.config.ts         # 配置文件
```

## 配置文件

```typescript
// vext.config.ts
export default {
  port: 3000,
  adapter: 'native',

  // 自定义 Nacos 配置（通过 app.config.nacos 访问）
  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR ?? '127.0.0.1:8848',
    namespace: process.env.NACOS_NAMESPACE ?? 'public',

    // 服务注册配置
    service: {
      name: 'order-service',
      group: 'DEFAULT_GROUP',
      ip: process.env.SERVICE_IP ?? '127.0.0.1',
      port: 3000,
      metadata: {
        version: '1.0.0',
        env: process.env.NODE_ENV ?? 'development',
      },
    },

    // 配置中心
    config: {
      dataId: 'order-service',
      group: 'DEFAULT_GROUP',
    },
  },
};
```

## 插件实现

### 完整 Nacos 插件

```typescript
// src/plugins/nacos.ts
import { definePlugin } from 'vextjs';
import { NacosNamingClient, NacosConfigClient } from 'nacos';

export default definePlugin({
  name: 'nacos',

  async setup(app) {
    const nacosConfig = app.config.nacos;
    if (!nacosConfig) {
      app.logger.warn('[nacos] No nacos config found, skipping');
      return;
    }

    // ── 1. 服务注册与发现 ─────────────────────────────────

    const namingClient = new NacosNamingClient({
      logger: createNacosLogger(app),
      serverList: nacosConfig.serverAddr,
      namespace: nacosConfig.namespace,
    });

    await namingClient.ready();
    app.logger.info('[nacos] Naming client connected');

    // 注册当前服务实例
    const { name, group, ip, port, metadata } = nacosConfig.service;
    await namingClient.registerInstance(name, {
      ip,
      port,
      metadata,
    }, group);

    app.logger.info(`[nacos] Service registered: ${name} (${ip}:${port})`);

    // 挂载到 app 上供全局使用
    app.extend('nacos', {
      naming: namingClient,

      /**
       * 发现服务实例（带负载均衡）
       * @param serviceName 目标服务名
       * @param group       分组（默认 DEFAULT_GROUP）
       * @returns 健康实例的 host:port
       */
      async discover(serviceName: string, group = 'DEFAULT_GROUP'): Promise<string> {
        const instances = await namingClient.selectInstances(
          serviceName,
          group,
          true,  // 仅返回健康实例
        );

        if (!instances || instances.length === 0) {
          throw new Error(`[nacos] No healthy instances for service: ${serviceName}`);
        }

        // 简单随机负载均衡
        const instance = instances[Math.floor(Math.random() * instances.length)];
        return `http://${instance.ip}:${instance.port}`;
      },
    });

    // ── 2. 配置中心 ───────────────────────────────────────

    if (nacosConfig.config) {
      const configClient = new NacosConfigClient({
        serverAddr: nacosConfig.serverAddr,
        namespace: nacosConfig.namespace,
      });

      await configClient.ready();
      app.logger.info('[nacos] Config client connected');

      // 获取初始配置
      const { dataId, group: configGroup } = nacosConfig.config;
      const rawConfig = await configClient.getConfig(dataId, configGroup);

      if (rawConfig) {
        try {
          const remoteConfig = JSON.parse(rawConfig);
          app.extend('remoteConfig', remoteConfig);
          app.logger.info(`[nacos] Remote config loaded: ${dataId}`);
        } catch {
          app.logger.warn(`[nacos] Failed to parse config as JSON: ${dataId}`);
        }
      }

      // 监听配置变更
      configClient.subscribe({ dataId, group: configGroup }, (content: string) => {
        try {
          const updatedConfig = JSON.parse(content);
          app.extend('remoteConfig', updatedConfig);
          app.logger.info(`[nacos] Remote config updated: ${dataId}`);
        } catch {
          app.logger.warn(`[nacos] Failed to parse updated config: ${dataId}`);
        }
      });

      // 优雅关闭
      app.onClose(async () => {
        app.logger.info('[nacos] Closing config client...');
        await configClient.close();
      });
    }

    // ── 3. 优雅关闭：注销服务 ────────────────────────────

    app.onClose(async () => {
      app.logger.info(`[nacos] Deregistering service: ${name}`);
      await namingClient.deregisterInstance(name, { ip, port }, group);
      await namingClient.close();
      app.logger.info('[nacos] Naming client closed');
    });
  },
});

/**
 * 将 Nacos SDK 日志桥接到 app.logger
 */
function createNacosLogger(app: any) {
  return {
    info(...args: any[]) { app.logger.debug({ source: 'nacos' }, ...args); },
    warn(...args: any[]) { app.logger.warn({ source: 'nacos' }, ...args); },
    error(...args: any[]) { app.logger.error({ source: 'nacos' }, ...args); },
    debug(...args: any[]) { app.logger.debug({ source: 'nacos' }, ...args); },
  };
}
```

### 类型声明

为了获得完整的 IDE 提示，在项目中添加类型声明：

```typescript
// src/types/nacos.d.ts
import type { NacosNamingClient } from 'nacos';

declare module 'vextjs' {
  interface VextApp {
    nacos: {
      naming: NacosNamingClient;
      discover(serviceName: string, group?: string): Promise<string>;
    };
    remoteConfig: Record<string, unknown>;
  }

  interface VextConfig {
    nacos?: {
      serverAddr: string;
      namespace?: string;
      service: {
        name: string;
        group?: string;
        ip: string;
        port: number;
        metadata?: Record<string, string>;
      };
      config?: {
        dataId: string;
        group?: string;
      };
    };
  }
}
```

## 使用示例

### 服务发现 + app.fetch 调用

结合 `app.fetch` 和 Nacos 服务发现，实现动态服务调用：

```typescript
// src/services/user.ts
export class UserService {
  constructor(private app: any) {}

  async getUser(userId: string) {
    // 通过 Nacos 发现 user-service 的地址
    const baseURL = await this.app.nacos.discover('user-service');

    // 使用 app.fetch 调用（自动传播 requestId）
    const response = await this.app.fetch.get(`${baseURL}/api/users/${userId}`);

    if (!response.ok) {
      this.app.throw(response.status, `Failed to fetch user: ${userId}`);
    }

    return response.json();
  }
}
```

### 使用 create() 工厂 + 服务发现

对于高频调用的下游服务，可以结合 `create()` 和服务发现来创建动态客户端：

```typescript
// src/plugins/service-clients.ts
import { definePlugin } from 'vextjs';

export default definePlugin({
  name: 'service-clients',
  dependencies: ['nacos'],

  async setup(app) {
    // 发现用户服务地址
    const userServiceURL = await app.nacos.discover('user-service');

    // 创建预配置的客户端
    const userClient = app.fetch.create({
      baseURL: userServiceURL,
      headers: {
        'x-caller': 'order-service',
      },
      timeout: 5000,
      retry: 2,
    });

    app.extend('userClient', userClient);
  },
});
```

### 读取远程配置

```typescript
// src/routes/config.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  // 获取远程配置（用于调试/管理）
  app.get('/admin/remote-config', {
    middlewares: ['auth'],
  }, async (req, res) => {
    res.json({
      config: app.remoteConfig,
      message: 'Remote config from Nacos',
    });
  });

  // 动态特性开关示例
  app.get('/features/:key', {
    validate: { param: { key: 'string!' } },
  }, async (req, res) => {
    const { key } = req.valid('param');
    const features = (app.remoteConfig?.features ?? {}) as Record<string, boolean>;
    const enabled = features[key] ?? false;

    res.json({ feature: key, enabled });
  });
});
```

### 健康检查端点

```typescript
// src/routes/health.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  app.get('/health', {
    override: { rateLimit: false },
  }, async (req, res) => {
    const checks: Record<string, string> = {
      status: 'ok',
      service: app.config.nacos?.service?.name ?? 'unknown',
    };

    // 检查 Nacos 连接状态
    try {
      const instances = await app.nacos.naming.selectInstances(
        app.config.nacos.service.name,
        'DEFAULT_GROUP',
        true,
      );
      checks.nacos = 'connected';
      checks.instances = String(instances.length);
    } catch {
      checks.nacos = 'disconnected';
    }

    res.json(checks);
  });
});
```

## Nacos 配置中心数据格式

在 Nacos 控制台中，创建配置时使用 JSON 格式：

```json
{
  "features": {
    "newDashboard": true,
    "betaMode": false,
    "maxUploadSize": 10485760
  },
  "rateLimit": {
    "max": 100,
    "window": 60000
  },
  "externalApis": {
    "paymentGateway": "https://pay.example.com/v2",
    "smsProvider": "https://sms.example.com"
  }
}
```

修改 Nacos 配置后，VextJS 会通过订阅自动接收变更，无需重启服务。

## 多环境部署

使用 Nacos namespace 隔离不同环境：

```bash
# 开发环境
NACOS_SERVER_ADDR=dev-nacos:8848 NACOS_NAMESPACE=dev node dist/index.js

# 测试环境
NACOS_SERVER_ADDR=test-nacos:8848 NACOS_NAMESPACE=test node dist/index.js

# 生产环境
NACOS_SERVER_ADDR=prod-nacos:8848 NACOS_NAMESPACE=prod node dist/index.js
```

## 最佳实践

### 1. 服务发现缓存

高频调用时避免每次都查询 Nacos，可以加入本地缓存：

```typescript
const instanceCache = new Map<string, { url: string; expireAt: number }>();

async function discoverWithCache(
  app: any,
  serviceName: string,
  ttl = 30000,
): Promise<string> {
  const cached = instanceCache.get(serviceName);
  if (cached && cached.expireAt > Date.now()) {
    return cached.url;
  }

  const url = await app.nacos.discover(serviceName);
  instanceCache.set(serviceName, { url, expireAt: Date.now() + ttl });
  return url;
}
```

### 2. 优雅处理服务不可用

```typescript
async function safeDiscover(app: any, serviceName: string): Promise<string | null> {
  try {
    return await app.nacos.discover(serviceName);
  } catch (err) {
    app.logger.error({ serviceName, error: (err as Error).message }, 'Service discovery failed');
    return null;
  }
}
```

### 3. 配置变更日志审计

```typescript
configClient.subscribe({ dataId, group: configGroup }, (content: string) => {
  const previous = JSON.stringify(app.remoteConfig);
  try {
    const updated = JSON.parse(content);
    app.logger.info({
      type: 'config-change',
      dataId,
      previous: previous.slice(0, 200),
      current: content.slice(0, 200),
    }, `[nacos] Config changed: ${dataId}`);
    app.extend('remoteConfig', updated);
  } catch {
    app.logger.warn(`[nacos] Invalid config format: ${dataId}`);
  }
});
```

## 下一步

- 了解 [app.fetch 内置 HTTP 客户端](/guide/fetch) 的超时、重试和 requestId 传播能力
- 查看 [OpenTelemetry 接入示例](/examples/opentelemetry) 实现完整的可观测性
- 学习 [插件](/guide/plugins) 系统如何通过 `definePlugin()` 扩展框架
- 探索 [Cluster 多进程](/guide/cluster) 部署以获得更高可用性
# Nacos 接入示例

本示例演示如何在 VextJS 中集成 [Nacos](https://nacos.io/)，实现**服务注册与发现**、**运行期动态配置**，以及**启动期远程配置补丁**。

VextJS 提供官方 Nacos 插件 [`@devcodex/nacos`](https://www.npmjs.com/package/@devcodex/nacos)，封装了注册/发现与运行期配置订阅流程。对于必须在框架配置冻结前生效的内容（如数据库配置），应使用 `src/config/bootstrap.ts` 的 `bootstrap config provider`。

:::tip 推荐做法
推荐分层使用：

- **服务注册/发现、运行期动态开关**：直接使用官方插件 `@devcodex/nacos`
- **启动期数据库/密钥/基础设施配置**：使用 `src/config/bootstrap.ts` 拉取 Nacos 配置并返回 patch
  :::

## 前置条件

- 先按[快速开始](/zh/guide/quick-start)准备 Vext TypeScript API 项目及 dev/build/start 命令。
- 当前框架要求 Node.js **`^20.19.0 || >=22.12.0`**。
- 准备可访问的 Nacos 服务端，确认 namespace 的实际 ID、分组、鉴权与客户端网络。插件默认 namespace 为 public；若部署使用其他 ID，应显式配置。
- 2026-09-25 核对的插件为 `@devcodex/nacos@0.2.10`，其 Vext peer 范围为 `>=0.3.4`，内部 JavaScript SDK 为 `nacos@2.6.3`；SDK 版本不是 Nacos Server 版本。此处不宣称所有服务端版本均经过验证，兼容性以[插件发布说明](https://github.com/devcodex-labs/nacos)与实际环境验证为准。

## 一、推荐：使用 `@devcodex/nacos` 官方插件

### 1. 安装

```bash
npm install @devcodex/nacos
```

### 2. 配置（`src/config/default.ts`）

```typescript
export default {
  port: 3000,
  adapter: "native",

  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
    namespace: process.env.NACOS_NAMESPACE ?? "public",
    // 服务端启用鉴权时填写；是否启用取决于部署配置
    username: process.env.NACOS_USERNAME,
    password: process.env.NACOS_PASSWORD,

    // 服务注册（缺省则不注册当前服务）
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

    // 配置中心（缺省则不订阅）
    config: {
      dataId: "order-service",
      group: "DEFAULT_GROUP",
    },
  },
};
```

说明：

- `config` 适合单配置场景
- `configs` 适合基础配置 + 环境覆盖配置拆分
- 两者同时存在时按 `config -> configs[0] -> configs[1] ...` 深合并，后者优先，数组整体替换；初次演示只使用 config。
- 显式插件参数与 app.config.nacos 是浅合并，传入 service 会替换整个 service 对象。
- 鉴权开关由服务端决定，不能由“2.x”推断默认开启，见[Nacos 鉴权文档](https://nacos.io/en-us/docs/auth.html)。

### 3. 注册插件（src/plugins/nacos.ts）

```typescript
import { nacosPlugin } from "@devcodex/nacos";
export default nacosPlugin(); // 自动读取 app.config.nacos
```

### 4. 读取功能开关

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

Nacos 配置必须是 JSON 对象。此处只接受字段值严格等于 true 的开关，错误类型不会被当作开启。当前插件保持 remoteConfig 顶层对象引用并原地更新字段；初次拉取失败时该属性可能尚不存在，因此请求时通过 req.app 读取并提供默认值。已缓存的嵌套对象引用不保证随更新刷新。

### 5. 启动并验证

先在 Nacos 控制台的对应 namespace / DEFAULT_GROUP 创建 dataId 为 order-service 的 JSON：

```json
{ "features": { "newDashboard": true } }
```

在应用目录运行：

```bash
npm run dev
curl -i http://127.0.0.1:3000/features/newDashboard
```

响应应为200，默认包装的 data.enabled 为 true。将远程字段改为 false，等待订阅更新日志后再次请求，应变为 false；未知 key 默认为 false。控制台应显示 order-service 的3000端口实例。停止开发服务后，再用生产路径复验：

```bash
npm run build -- --typecheck
npm start
```

停止应用后确认实例已注销。服务注册地址必须能被其他消费者访问；127.0.0.1 仅适合本机演示。启动前注册成功不代表 HTTP 已开始监听，readiness 和负载均衡摘流仍需部署层安排。生产配置、鉴权与网络连通性应在实际 Nacos 环境验证。

## 二、扩展配置与服务发现

### 显式插件参数

也支持显式传参（覆盖 `app.config.nacos`）：

```typescript
import { nacosPlugin } from "@devcodex/nacos";
export default nacosPlugin({
  serverAddr: "127.0.0.1:8848",
  service: { name: "order-service", ip: "127.0.0.1", port: 3000 },
});
```

### 动态端口（与 app.config.port 保持一致）

`config/default.ts` 中的 `service.port` 是静态值，无法读取最终合并后的端口号。
若各环境端口不同（如 sit: 10019 / prod: 20019），推荐在插件中动态注入：

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
      // 只覆盖 service.port，其余字段继承 app.config.nacos
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

这样 `config/default.ts` 里 `service.port` 仅作类型占位，实际注册端口由 `app.config.port` 决定，
各环境只需在对应 config 文件设置 `port: 10019`，nacos 自动跟随。

### 启动期远程配置推荐走 `src/config/bootstrap.ts`

如果你希望在 **MonSQLize 初始化之前** 就从 Nacos 拉取数据库配置，不要把这一步放在普通插件里；推荐直接使用 `@devcodex/nacos` 提供的 `createNacosBootstrapProvider()`：

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

在所列 db-config 分组准备 config.json，根对象应直接使用 Vext 配置结构，例如 database；不要再包一层 remoteConfig。provider 拉取后客户端会关闭，不会继续订阅。required:true 时拉取/解析失败或超时会阻止启动；普通运行插件的初次配置拉取失败则只记录警告。配置优先级是 `default < config profile < local < provider < CLI`，其中 local 仅 development/test 加载，详见[配置指南](/zh/guide/configuration)。

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

#### bootstrap 阶段的服务发现边界

默认**不能直接使用** `app.nacos!.discover()`。

原因是 `src/config/bootstrap.ts` 运行在 **Vext App 创建之前**：

- 此时还没有 `app`
- `nacosPlugin()` 也还没有执行
- 因而不存在 `app.nacos` / `app.remoteConfig`

所以推荐边界是：

- **启动期只做配置 patch 拉取** → `createNacosBootstrapProvider()`
- **运行期服务注册 / 服务发现 / 配置订阅** → `nacosPlugin()`

### 运行期动态配置继续使用 `app.remoteConfig`

如果配置只影响运行期功能开关、灰度策略、外部 API 地址等，不需要参与 `database` / `plugins` / `middlewares` 初始化，则直接使用 `@devcodex/nacos` 的配置订阅能力即可：

- 初次启动后插件会拉取 Nacos 配置并挂载到 `app.remoteConfig`
- 后续配置变更会自动更新 `app.remoteConfig`
- 无需重启服务

实际行为取决于启用项：

- enabled:false、无 serverAddr 或既无配置源也无 service 时跳过初始化，不挂载相关扩展。
- 配置 service 才创建 Naming Client、注册实例并挂载 app.nacos；只有配置订阅时不能使用 discover。
- 配置 config/configs 才拉取并订阅 app.remoteConfig；非法 JSON/非对象变更警告并保留该来源上一版，空内容移除该来源。
- 同时启用时，关闭按 LIFO 注销实例并关闭 Naming Client，再关闭 Config Client。注销失败会记录警告，不能把调用结束视为服务端已确认摘除。
- 包导入提供 VextApp/VextConfig 类型增强，不代表运行期已初始化。app.config 保持冻结，动态配置不会自动重建数据库或限流中间件。

### 使用服务发现

```typescript
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  constructor(private app: VextApp) {}

  async getUser(userId: string) {
    // 通过 Nacos 发现 user-service（仅返回健康实例 + 随机负载均衡）
    if (!this.app.nacos)
      throw new Error("Nacos service discovery is not configured");
    const baseURL = await this.app.nacos.discover("user-service");

    const response = await this.app.fetch.get(
      `${baseURL}/api/users/${encodeURIComponent(userId)}`,
    );

    if (!response.ok) {
      // 检查上游响应；抛业务异常，由调用方决定本应用的 HTTP 响应
      throw new Error(
        `Fetch user failed: ${userId} (status ${response.status})`,
      );
    }
    return response.json();
  }
}
```

该进阶 Service 假定另一个 user-service 已注册且提供 /api/users/:id；可由本应用路由调用 app.services.user.getUser(id)。discover 无健康实例时抛错，返回的 URL 使用 http。selectInstances 可以取得实例列表，但权重/一致性哈希选择仍需调用方实现。

### 多配置运行期示例

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

这种方式适合：

- 基础开关 + 环境覆盖
- 通用服务配置 + 租户/区域增量配置
- 运行期灰度参数分层维护

---

## 三、运行边界与排查

### 服务发现缓存（高频调用场景）

discover 每次调用 Naming Client 的 selectInstances；是否访问网络取决于 SDK 的实例缓存/订阅状态。只有测量出需要时才增加上层缓存。下面片段限定单应用、默认分组，用于演示 TTL：

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

> 缓存单个 URL 会暂时固定流量到同一实例，并可能继续访问已下线节点；失败时需要清除并重新发现。多应用、namespace 或 group 共存时，应隔离缓存并将这些维度纳入键，不能共享这里的 name-only Map。

### 依赖诊断端点

这个独立路径检查 Nacos 依赖，不覆盖框架自带 /health：

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

访问 /nacos-status；503 表示本例依赖检查未通过。实例查询可能使用 SDK 缓存，因此200不等于对 Nacos 服务端做了实时连通探测。

### Nacos 配置数据格式

控制台中创建配置时使用 JSON：

```json
{
  "features": { "newDashboard": true, "betaMode": false },
  "businessLimits": { "maxOrdersPerHour": 100 },
  "externalApis": { "paymentGateway": "https://pay.example.com/v2" }
}
```

订阅更新只改变 app.remoteConfig。业务代码需在使用时读取这些字段；它们不会自动改变 app.config.rateLimit 等已初始化框架设置。

| 问题                 | 检查与复验                                                            |
| -------------------- | --------------------------------------------------------------------- |
| 未注册/无 app.nacos  | 核对 service、enabled、serverAddr 和注册错误；重新启动后查控制台实例  |
| 开关始终 false       | 核对 namespace ID、group、dataId 与 JSON 对象；等待更新日志后重复请求 |
| 配置改了但数据库未变 | 普通订阅不重建基础设施；使用 bootstrap patch 并重启验证               |
| 发现地址不可达       | 核对 service.ip/port 与消费者网络；从消费者实际请求该地址             |
| 关闭后实例残留       | 检查注销日志、Naming Client 关闭及服务端状态；不能只看进程退出        |

---

## 四、下一步

- 📦 [`@devcodex/nacos` npm 包](https://www.npmjs.com/package/@devcodex/nacos) — 完整 API 文档与变更日志
- 🔭 [OpenTelemetry 接入示例](/zh/examples/opentelemetry) — 完整可观测性
- 🔌 [插件系统](/zh/guide/plugins) — `definePlugin()` 自定义插件
- 🌐 [app.fetch](/zh/guide/fetch) — 内置 HTTP 客户端（超时/重试/requestId 传播）

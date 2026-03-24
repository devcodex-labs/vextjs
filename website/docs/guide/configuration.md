# 配置

VextJS 采用 **三层配置合并** 机制，支持按环境覆盖配置，同时提供丰富的内置配置项覆盖框架行为。

## 配置加载机制

框架启动时，`config-loader` 按以下顺序加载配置文件并深度合并：

```
框架内置默认值 → default.ts → {NODE_ENV}.ts → local.ts
```

每一层都可以只声明需要覆盖的字段，未声明的字段从上一层继承。

### 配置文件

| 文件 | 用途 | 是否必须 |
|------|------|---------|
| `src/config/default.ts` | 所有环境的基础配置 | ✅ 必须 |
| `src/config/development.ts` | 开发环境覆盖（`NODE_ENV=development`） | 可选 |
| `src/config/production.ts` | 生产环境覆盖（`NODE_ENV=production`） | 可选 |
| `src/config/test.ts` | 测试环境覆盖（`NODE_ENV=test`） | 可选 |
| `src/config/local.ts` | 本地开发覆盖（应加入 `.gitignore`） | 可选 |

环境文件通过 `NODE_ENV` 环境变量自动匹配。未设置 `NODE_ENV` 时默认为 `development`。

### 合并规则

- **对象字段**：深度合并（deep merge），环境文件只需声明需要覆盖的字段
- **`middlewares` 数组**：智能 patch 策略——按 `name` 匹配并合并，而非简单替换整个数组
- **其他数组**：后层覆盖前层
- **最终结果**：深冻结（`deepFreeze`），运行时不可修改

### 配置文件格式

每个配置文件使用 `export default` 导出一个对象：

```typescript
// src/config/default.ts
export default {
  port: 3000,
  host: '0.0.0.0',
  logger: {
    level: 'info',
  },
  cors: {
    origins: ['*'],
  },
  openapi: {
    enabled: true,
  },
};
```

```typescript
// src/config/production.ts — 仅覆盖需要变更的字段
export default {
  logger: {
    level: 'warn',      // 生产环境减少日志输出
  },
  cors: {
    origins: ['https://myapp.com'],  // 生产环境限制来源
  },
  openapi: {
    enabled: false,      // 生产环境关闭文档
  },
};
```

```typescript
// src/config/local.ts — 本地开发特殊配置（不提交 Git）
export default {
  port: 8080,           // 本地使用其他端口
};
```

### Middlewares Patch 策略

`middlewares` 数组使用智能合并，按中间件 `name` 匹配：

```typescript
// src/config/default.ts
export default {
  middlewares: [
    'auth',
    { name: 'check-role', options: { roles: ['user'] } },
    { name: 'rate-limit-api', options: { max: 100 } },
  ],
};
```

```typescript
// src/config/development.ts
export default {
  middlewares: [
    // 只需声明要覆盖的中间件，其余保留
    { name: 'check-role', options: { roles: [] } },  // 开发环境不检查角色
    { name: 'rate-limit-api', options: { max: 10000 } }, // 放宽限流
  ],
};
```

合并后结果：

```typescript
middlewares: [
  'auth',                                              // 保留
  { name: 'check-role', options: { roles: [] } },       // 被覆盖
  { name: 'rate-limit-api', options: { max: 10000 } },  // 被覆盖
]
```

## 使用 Adapter

默认使用 Native Adapter（`http.createServer` + `find-my-way`）。要切换其他 Adapter，在配置中指定 `adapter` 字段：

```typescript
// src/config/default.ts — 使用 Hono Adapter
import { honoAdapter } from 'vextjs/adapters/hono';

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — 使用 Fastify Adapter
import { fastifyAdapter } from 'vextjs/adapters/fastify';

export default {
  adapter: fastifyAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — 使用 Express Adapter
import { expressAdapter } from 'vextjs/adapters/express';

export default {
  adapter: expressAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — 使用 Koa Adapter
import { koaAdapter } from 'vextjs/adapters/koa';

export default {
  adapter: koaAdapter(),
  port: 3000,
};
```

:::tip
不指定 `adapter` 时默认使用 Native Adapter，性能最高且零框架依赖。仅当需要使用特定框架的生态或特性时才切换。
:::

## 完整配置项参考

### 基础配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `port` | `number` | `3000` | HTTP 监听端口 |
| `host` | `string` | `'0.0.0.0'` | HTTP 监听地址 |
| `adapter` | `string \| Function \| VextAdapter` | `'native'` | 底层适配器 |
| `trustProxy` | `boolean` | `false` | 是否信任代理（影响 `req.ip` / `req.protocol`） |

```typescript
export default {
  port: 3000,
  host: '0.0.0.0',
  trustProxy: false,
};
```

### CORS 配置 (`cors`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cors.origins` | `string[]` | `['*']` | 允许的来源列表 |
| `cors.methods` | `string[]` | `['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']` | 允许的 HTTP 方法 |
| `cors.headers` | `string[]` | `['Content-Type','Authorization','X-Request-Id']` | 允许的请求头 |
| `cors.credentials` | `boolean` | `false` | 是否允许携带凭证 |

```typescript
export default {
  cors: {
    origins: ['https://myapp.com'],  // 生产环境限制来源（数组格式）
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
};
```

### 限流配置 (`rateLimit`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `rateLimit.enabled` | `boolean` | `true` | 是否启用全局限流 |
| `rateLimit.max` | `number` | `100` | 时间窗口内最大请求数 |
| `rateLimit.window` | `number` | `60` | 时间窗口（秒） |
| `rateLimit.message` | `string` | `'Too many requests'` | 限流响应消息 |
| `rateLimit.keyBy` | `string` | `'ip'` | 限流维度（`'ip'` / 自定义字段） |

```typescript
export default {
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60,          // 1 分钟（单位：秒）
    message: 'Too many requests, please try again later',
    keyBy: 'ip',
  },
};
```

:::tip 路由级限流覆盖
可以在路由的 `options.override.rateLimit` 中为特定路由覆盖限流配置：

```typescript
app.post('/login', {
  override: {
    rateLimit: { max: 5, window: 60 },  // 登录接口更严格（window 单位：秒）
  },
}, handler);

app.get('/health', {
  override: {
    rateLimit: false,  // 健康检查不限流
  },
}, handler);
```
:::

### 请求 ID 配置 (`requestId`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `requestId.enabled` | `boolean` | `true` | 是否启用请求 ID |
| `requestId.header` | `string` | `'x-request-id'` | 请求 ID 透传的 header 名称 |
| `requestId.generate` | `() => string` | `crypto.randomUUID` | 自定义 ID 生成函数 |

```typescript
export default {
  requestId: {
    enabled: true,
    header: 'x-request-id',
  },
};
```

当请求中携带 `X-Request-Id` 头时，框架会透传该 ID 而不是生成新的。适合微服务链路追踪。

### 日志配置 (`logger`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `logger.level` | `string` | `'info'` | 日志级别 |
| `logger.pretty` | `boolean` | 开发环境 `true` | 是否使用 pino-pretty 彩色格式化输出；生产环境默认关闭（输出 JSON） |
| `logger.prettySingleLine` | `boolean` | `true` | pino-pretty 模式下将额外字段以 JSON 内联形式压缩到消息同一行；`false` 恢复多行展开格式 |
| `logger.prettyIgnore` | `string` | `'pid,hostname,requestId'` | pino-pretty 模式下忽略的字段（逗号分隔）；默认隐藏 `requestId` 避免 mixin 注入字段展开为多行噪音 |

支持的日志级别（从低到高）：`'trace'` → `'debug'` → `'info'` → `'warn'` → `'error'` → `'fatal'` → `'silent'`

```typescript
export default {
  logger: {
    level: 'info',          // 生产环境建议 'warn'
    pretty: true,           // 开发环境开启彩色格式化（生产环境默认关闭）
    // prettySingleLine: true,              // 额外字段压缩到同行（默认）
    // prettyIgnore: 'pid,hostname,requestId',  // 默认隐藏字段
  },
};
```

VextJS 内置 [pino](https://github.com/pinojs/pino) 作为日志引擎，`pretty` 模式使用 `pino-pretty` 彩色格式化输出。完整的日志系统说明（Child Logger、存储方案、requestId 注入等）见 [日志文档](/guide/logger)。

### 优雅关闭配置 (`shutdown`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `shutdown.timeout` | `number` | `10` | 关闭超时（秒），超时后强制退出 |

```typescript
export default {
  shutdown: {
    timeout: 15,        // 15 秒超时（单位：秒）
  },
};
```

收到 `SIGTERM` / `SIGINT` 信号后，框架按注册的逆序执行所有 `onClose` 钩子（如关闭数据库连接），超时后强制退出。

### 响应配置 (`response`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `response.wrap` | `boolean` | `true` | 是否启用出口包装（`res.json(data)` 自动包装为 `{ code, data, requestId }`） |
| `response.hideInternalErrors` | `boolean` | `true` | 是否隐藏 500 错误详情（生产环境建议开启，不暴露 stack trace） |

```typescript
export default {
  response: {
    wrap: true,
    hideInternalErrors: true,
  },
};
```

启用 `wrap: true` 后，`res.json(data)` 的实际输出：

```json
{
  "code": 0,
  "data": { "name": "Alice" },
  "requestId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

设置 `wrap: false` 可关闭包装，`res.json(data)` 直接输出原始数据。

### Body Parser 配置 (`bodyParser`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `bodyParser.enabled` | `boolean` | `true` | 是否启用 body 解析 |
| `bodyParser.maxBodySize` | `string \| number` | `'1mb'` | 最大请求体大小 |

```typescript
export default {
  bodyParser: {
    enabled: true,
    maxBodySize: '5mb',  // 允许更大的请求体
  },
};
```

`maxBodySize` 支持字符串格式（`'1mb'`、`'500kb'`）和数字格式（字节数）。

### Access Log 配置 (`accessLog`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `accessLog.enabled` | `boolean` | `true` | 是否启用访问日志 |
| `accessLog.level` | `string` | `'info'` | 日志级别 |

```typescript
export default {
  accessLog: {
    enabled: true,
    level: 'info',
  },
};
```

启用后，每个请求完成时自动记录：

```
INFO  GET /api/users → 200 (12ms)
```

### OpenAPI 配置 (`openapi`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `openapi.enabled` | `boolean` | `false` | 是否启用 OpenAPI 文档 |
| `openapi.title` | `string` | `'API Documentation'` | 文档标题 |
| `openapi.description` | `string` | `''` | 文档描述 |
| `openapi.version` | `string` | `'1.0.0'` | API 版本号 |
| `openapi.docsPath` | `string` | `'/docs'` | Scalar 文档路径 |
| `openapi.jsonPath` | `string` | `'/openapi.json'` | OpenAPI JSON 端点路径（vext 内部路由注册路径） |
| `openapi.jsonPublicPath` | `string` | 同 `jsonPath` | Scalar HTML 中引用 spec 的公开路径。反向代理剥离前缀场景必填，详见[反向代理部署](/guide/openapi#反向代理路径前缀场景) |
| `openapi.scalar` | `object` | `{}` | Scalar API Reference UI 配置（主题、深色模式、布局、favicon 等） |
| `openapi.servers` | `Array` | `[]` | API 服务器列表 |
| `openapi.tags` | `Array` | `[]` | 标签定义 |
| `openapi.securitySchemes` | `object` | `{}` | 安全方案 |
| `openapi.contact` | `object` | `{}` | 联系方式 |
| `openapi.license` | `object` | `{}` | 许可证信息 |

```typescript
export default {
  openapi: {
    enabled: true,
    title: 'My App API',
    description: '我的应用 API 文档',
    version: '1.0.0',
    docsPath: '/docs',
    jsonPath: '/openapi.json',
    scalar: {
      theme: 'default',
      darkMode: false,
      layout: 'modern',
      favicon: '/favicon.svg',
    },
    servers: [
      { url: 'http://localhost:3000', description: '本地开发' },
      { url: 'https://api.myapp.com', description: '生产环境' },
    ],
    tags: [
      { name: '用户', description: '用户管理相关接口' },
      { name: '订单', description: '订单管理相关接口' },
    ],
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    contact: {
      name: 'API Support',
      email: 'support@myapp.com',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
};
```

### 请求上下文配置 (`requestContext`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `requestContext.enabled` | `boolean` | `true` | 是否启用 AsyncLocalStorage 请求上下文 |

```typescript
export default {
  requestContext: {
    enabled: true,
  },
};
```

:::warning 性能提示
禁用 `requestContext` 可提升约 3-8% RPS，但以下功能将失效：
- `app.logger` 自动携带 `requestId`
- `app.throw()` 自动解析请求 locale
- `app.fetch` 自动传播 `requestId`

仅在极致性能场景下考虑禁用。
:::

### Cluster 配置 (`cluster`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cluster.enabled` | `boolean` | `false` | 是否启用 Cluster 模式 |
| `cluster.workers` | `number \| string` | `'auto'` | Worker 数量（`'auto'` = CPU 核数） |
| `cluster.autoRestart` | `boolean` | `true` | Worker 崩溃时自动重启 |
| `cluster.maxRestarts` | `number` | `5` | 时间窗口内最大重启次数 |
| `cluster.restartWindow` | `number` | `60000` | 重启计数窗口（毫秒） |
| `cluster.restartBaseDelay` | `number` | `1000` | 重启基础延迟（毫秒） |
| `cluster.restartMaxDelay` | `number` | `30000` | 重启最大延迟（毫秒） |
| `cluster.healthCheck.enabled` | `boolean` | `true` | 是否启用 Worker 心跳检测 |
| `cluster.healthCheck.interval` | `number` | `15000` | 心跳探测间隔（毫秒） |
| `cluster.healthCheck.timeout` | `number` | `30000` | 心跳超时（毫秒） |
| `cluster.reload.workerDelay` | `number` | `2000` | 替换下一个 Worker 前的等待时间（毫秒） |
| `cluster.reload.readyTimeout` | `number` | `30000` | Worker 就绪超时（毫秒） |
| `cluster.reload.shutdownTimeout` | `number` | `10000` | Worker 关闭超时（毫秒） |
| `cluster.pidFile` | `string` | `'.vext.pid'` | PID 文件路径 |

```typescript
export default {
  cluster: {
    enabled: true,
    workers: 'auto',         // 自动检测 CPU 核数
    autoRestart: true,
    maxRestarts: 5,
    healthCheck: { enabled: true },
    reload: { workerDelay: 2000 },
  },
};
```

也可以通过环境变量 `VEXT_CLUSTER=1` 开启 Cluster 模式，无需修改配置文件。

### 中间件白名单 (`middlewares`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `middlewares` | `Array<string \| { name, options }>` | `[]` | 路由级中间件白名单 |

```typescript
export default {
  middlewares: [
    // 普通中间件 — 字符串声明
    'auth',
    'timing',

    // 工厂中间件 — 对象声明（附带默认参数）
    { name: 'check-role', options: { roles: ['user'] } },
    { name: 'cache-control', options: { maxAge: 3600 } },
  ],
};
```

只有在白名单中声明的中间件才能在路由的 `options.middlewares` 中被引用。

## 在代码中访问配置

### 路由中

```typescript
export default defineRoutes((app) => {
  app.get('/info', async (_req, res) => {
    res.json({
      port: app.config.port,
      env: process.env.NODE_ENV,
      openapi: app.config.openapi.enabled,
    });
  });
});
```

### 服务中

```typescript
export default class MyService {
  constructor(private app: VextApp) {}

  getApiBaseUrl() {
    const { host, port } = this.app.config;
    return `http://${host}:${port}`;
  }
}
```

### 插件中

```typescript
export default definePlugin({
  name: 'my-plugin',
  setup(app) {
    const myConfig = app.config.myPlugin ?? { enabled: false };
    if (!myConfig.enabled) return;
    // ...
  },
});
```

:::tip 配置只读
`app.config` 在启动后被深冻结（`deepFreeze`），任何修改尝试都会抛出 `TypeError`。这确保配置在运行时不被意外修改。
:::

## 自定义配置字段

`VextConfig` 接口允许扩展自定义字段。插件和业务代码可以在配置中添加任意字段：

```typescript
// src/config/default.ts
export default {
  port: 3000,

  // 自定义字段
  redis: {
    url: 'redis://localhost:6379',
    db: 0,
  },
  mailer: {
    smtp: 'smtp://localhost:1025',
    from: 'noreply@myapp.com',
  },
};
```

配合 `declare module` 获得类型提示：

```typescript
// src/types/config.d.ts
declare module 'vextjs' {
  interface VextConfig {
    redis?: {
      url: string;
      db?: number;
    };
    mailer?: {
      smtp: string;
      from: string;
    };
  }
}
```

## 环境变量

除了配置文件，部分设置也可以通过环境变量控制：

| 环境变量 | 说明 |
|---------|------|
| `NODE_ENV` | 决定加载哪个环境配置文件（`development` / `production` / `test`） |
| `PORT` | 可在 `default.ts` 中引用 `process.env.PORT` |
| `VEXT_CLUSTER` | 设为 `1` 时启用 Cluster 模式 |

```typescript
// src/config/default.ts — 使用环境变量
export default {
  port: Number(process.env.PORT) || 3000,
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
```

:::warning 安全提示
敏感信息（如数据库密码、API Key）不要硬编码在配置文件中。推荐：
- 使用环境变量：`process.env.DB_PASSWORD`
- 使用 `local.ts`（已加入 `.gitignore`）存放本地开发的敏感配置
:::

## 配置校验

`config-loader` 在合并完成后会执行 Fail Fast 校验，检查以下内容：

- `port` 必须是 1-65535 范围内的正整数
- `adapter` 必须是已知的内置标识或合法的 adapter 对象/函数
- `middlewares` 数组中每个元素必须是字符串或 `{ name: string }` 对象
- `rateLimit.max` 必须是正整数
- `rateLimit.window` 必须是正整数
- `logger.level` 必须是合法的日志级别
- `shutdown.timeout` 必须是正整数
- `cluster.workers` 必须是正整数或 `'auto'` / `'auto-1'`

如果校验失败，框架会在启动时立即报错并给出清晰的错误信息，避免配置错误在运行时才暴露。

## 完整示例

```typescript
// src/config/default.ts
export default {
  port: Number(process.env.PORT) || 3000,
  host: '0.0.0.0',
  adapter: 'native',
  trustProxy: false,

  logger: {
    level: 'info',
  },

  cors: {
    origins: ['*'],
    credentials: false,
  },

  rateLimit: {
    enabled: true,
    max: 100,
    window: 60,          // 单位：秒
    keyBy: 'ip',
  },

  requestId: {
    enabled: true,
    header: 'x-request-id',
  },

  bodyParser: {
    enabled: true,
    maxBodySize: '1mb',
  },

  accessLog: {
    enabled: true,
    level: 'info',
  },

  response: {
    wrap: true,
    hideInternalErrors: true,
  },

  shutdown: {
    timeout: 10,        // 单位：秒
  },

  requestContext: {
    enabled: true,
  },

  openapi: {
    enabled: true,
    title: 'My App API',
    version: '1.0.0',
  },

  middlewares: [
    'auth',
    { name: 'check-role', options: { roles: ['user'] } },
  ],

  // 自定义配置
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
};
```

```typescript
// src/config/production.ts
export default {
  logger: { level: 'warn' },
  cors: { origins: ['https://myapp.com'], credentials: true },
  openapi: { enabled: false },
  accessLog: { level: 'warn' },
  cluster: {
    enabled: true,
    workers: 'auto',
  },
};
```

```typescript
// src/config/local.ts — 不提交到 Git
export default {
  port: 8080,
  redis: {
    url: 'redis://localhost:6380',
  },
};
```

## 下一步

- 了解 [Adapter 架构](/guide/adapters) 的详细配置和切换方法
- 学习 [中间件](/guide/middleware) 白名单的配置方式
- 查看 [OpenAPI 文档](/guide/openapi) 的高级配置
- 探索 [Cluster 多进程](/guide/cluster) 的配置选项
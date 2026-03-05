# 日志 (Logger)

VextJS 基于 [pino](https://github.com/pinojs/pino) 提供高性能结构化日志，通过 `app.logger` 在框架的任意位置使用。内置 requestId 自动注入、child logger、pretty/JSON 双模式等企业级能力。

## 基本用法

`app.logger` 在路由、服务、插件和中间件中均可直接使用：

```typescript
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  app.get('/users', async (req, res) => {
    app.logger.info('获取用户列表');
    app.logger.debug({ page: 1, limit: 20 }, '查询参数');

    const users = await app.services.user.findAll();
    app.logger.info({ count: users.length }, '查询完成');

    res.json(users);
  });
});
```

## 日志级别

VextJS 支持 6 个日志级别，按严重程度从低到高排列：

| 级别 | 方法 | 说明 | 典型场景 |
|------|------|------|----------|
| `debug` | `app.logger.debug()` | 调试信息 | 变量值、SQL 查询、详细流程 |
| `info` | `app.logger.info()` | 一般信息 | 服务启动、请求处理、业务事件 |
| `warn` | `app.logger.warn()` | 警告 | 性能下降、弃用 API、重试 |
| `error` | `app.logger.error()` | 错误 | 异常、失败的操作 |
| `fatal` | `app.logger.fatal()` | 致命错误 | 应用无法继续运行 |

### 配置日志级别

```typescript
// src/config/default.ts
export default {
  logger: {
    level: 'debug',  // 开发环境输出所有级别
  },
};
```

```typescript
// src/config/production.ts
export default {
  logger: {
    level: 'info',   // 生产环境只输出 info 及以上
  },
};
```

设置某个级别后，**低于该级别的日志不会输出**。例如 `level: 'info'` 时，`debug()` 调用会被静默忽略（零开销）。

## 结构化日志

pino 的核心理念是**结构化日志**——每条日志都是一个 JSON 对象，便于机器解析和查询。

### 调用签名

```typescript
// 纯消息
app.logger.info('服务启动');

// 对象 + 消息（推荐）
app.logger.info({ port: 3000, adapter: 'native' }, '服务启动');

// 对象（无消息）
app.logger.info({ event: 'startup', port: 3000 });
```

:::tip 推荐写法
始终使用 `logger.info(object, message)` 的形式——结构化字段便于日志系统索引和过滤，消息便于人类阅读。
:::

### JSON 输出格式

生产环境（`NODE_ENV=production`）下，日志输出为 JSON 格式：

```json
{"level":30,"time":"2026-03-05T14:23:05.123Z","requestId":"abc-123","msg":"→ GET /api/users 200 45ms"}
{"level":30,"time":"2026-03-05T14:23:05.200Z","requestId":"abc-123","service":"UserService","msg":"查询完成","count":42}
```

### Pretty 输出格式

开发环境（默认）下使用 pino-pretty，输出彩色格式化日志：

```
[2026-03-05 14:23:05.123] INFO  服务启动
    port: 3000
    adapter: "native"
[2026-03-05 14:23:05.200] DEBUG 查询参数
    requestId: "abc-123"
    page: 1
    limit: 20
```

### 配置 Pretty 模式

```typescript
// src/config/default.ts
export default {
  logger: {
    level: 'debug',
    pretty: true,     // 开发环境使用 pretty 格式（默认行为）
  },
};
```

```typescript
// src/config/production.ts
export default {
  logger: {
    level: 'info',
    pretty: false,    // 生产环境使用 JSON 格式（默认行为）
  },
};
```

`pretty` 默认值取决于 `NODE_ENV`：
- `NODE_ENV !== 'production'` → `pretty: true`
- `NODE_ENV === 'production'` → `pretty: false`

## requestId 自动注入

这是 VextJS 日志系统最重要的特性之一。**无需手动传入 requestId**，所有日志自动携带当前请求的 requestId。

### 工作原理

```
请求进入 → requestId 中间件生成 ID → 写入 requestContext（AsyncLocalStorage）
                                              ↓
app.logger.info('xxx')  ←  pino mixin 钩子自动读取 requestId
                                              ↓
输出: {"requestId":"abc-123","msg":"xxx"}
```

pino 的 `mixin` 钩子在每条日志写入前调用，从 `requestContext`（基于 `AsyncLocalStorage`）中读取当前请求的 `requestId` 并附加到日志字段。这意味着：

- **handler 中的日志**：自动携带 requestId ✅
- **service 中的日志**：自动携带 requestId ✅
- **中间件中的日志**：自动携带 requestId ✅
- **启动阶段的日志**：无 requestId（非请求上下文）✅

```typescript
// 不需要这样做 ❌
app.logger.info({ requestId: req.requestId }, '处理请求');

// 直接这样就行 ✅
app.logger.info('处理请求');
// 输出自动包含 requestId
```

### 性能优化

mixin 钩子在每条日志写入时都会调用。VextJS 做了两项优化：

1. **预分配空对象常量**：非请求上下文（如启动日志）不创建新对象，复用常量减少 GC
2. **ALS 禁用检测**：当 AsyncLocalStorage 被禁用时，跳过 `getStore()` 调用

## Child Logger

`child()` 方法创建子 logger，子 logger 继承父 logger 的所有配置（级别、格式、mixin），并额外携带指定的绑定字段：

```typescript
// 创建带 service 字段的子 logger
const serviceLogger = app.logger.child({ service: 'UserService' });

serviceLogger.info('初始化完成');
// 输出: {"service":"UserService","msg":"初始化完成"}

serviceLogger.info({ userId: '123' }, '查询用户');
// 输出: {"service":"UserService","userId":"123","msg":"查询用户"}
```

### 在 Service 中使用

推荐在 Service 构造函数中创建 child logger：

```typescript
export class UserService {
  private logger;

  constructor(private app: any) {
    // 创建带 service 标识的子 logger
    this.logger = app.logger.child({ service: 'UserService' });
  }

  async findById(userId: string) {
    this.logger.debug({ userId }, '查询用户');

    const user = await this.app.db.collection('users').findOne({ _id: userId });

    if (!user) {
      this.logger.warn({ userId }, '用户不存在');
      this.app.throw(404, '用户不存在');
    }

    this.logger.info({ userId, event: 'user.found' }, '用户查询成功');
    return user;
  }
}
```

输出示例：

```json
{"level":20,"time":"...","requestId":"abc-123","service":"UserService","userId":"u-001","msg":"查询用户"}
{"level":30,"time":"...","requestId":"abc-123","service":"UserService","userId":"u-001","event":"user.found","msg":"用户查询成功"}
```

### 嵌套 Child Logger

child logger 可以嵌套创建，字段会累积：

```typescript
const dbLogger = app.logger.child({ module: 'database' });
const queryLogger = dbLogger.child({ collection: 'users' });

queryLogger.debug('执行查询');
// 输出: {"module":"database","collection":"users","msg":"执行查询"}
```

## 错误日志

### 记录 Error 对象

pino 自动序列化 Error 对象（保留 message、stack、name）：

```typescript
try {
  await someOperation();
} catch (err) {
  app.logger.error({ err }, '操作失败');
  // pino 会自动序列化 Error:
  // {"err":{"type":"Error","message":"xxx","stack":"..."},"msg":"操作失败"}
}
```

:::warning 注意
将 Error 对象放在第一个参数的 `err` 字段中（pino 的约定），而不是直接传 Error：

```typescript
// ✅ 正确
app.logger.error({ err: error }, '操作失败');

// ❌ 避免 — pino 无法正确序列化
app.logger.error(error, '操作失败');
```
:::

### 记录错误上下文

```typescript
async function processPayment(orderId: string, amount: number) {
  try {
    const result = await paymentGateway.charge(amount);
    app.logger.info({ orderId, amount, chargeId: result.id }, '支付成功');
    return result;
  } catch (err) {
    app.logger.error(
      { err, orderId, amount, gateway: 'stripe' },
      '支付失败',
    );
    throw err;
  }
}
```

## 自定义 Transport

pino 支持通过 transport 将日志输出到不同目标（文件、远程服务等）。

### 输出到文件

```typescript
// src/config/production.ts
export default {
  logger: {
    level: 'info',
    pretty: false,
    // 注意：pino transport 配置需要在创建 logger 之前设置
    // 推荐在生产环境中通过外部工具（如 PM2、Docker）管理日志输出
  },
};
```

生产环境中，推荐使用外部日志收集而不是 pino 内置 transport：

| 方案 | 说明 |
|------|------|
| **PM2** | 配置 `error_file` / `out_file`，自动收集 stdout/stderr |
| **Docker** | 使用 Docker logging driver（json-file / loki / fluentd） |
| **Kubernetes** | stdout → Node 日志 → Fluentd / Loki 自动采集 |
| **systemd** | journal 自动记录 stdout |

### 多目标输出（开发环境）

在开发环境中，可以同时输出 pretty 日志和 JSON 日志文件：

```typescript
import pino from 'pino';

// 这是高级用法，通常不需要
const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l' },
      level: 'debug',
    },
    {
      target: 'pino/file',
      options: { destination: './logs/app.log', mkdir: true },
      level: 'info',
    },
  ],
});
```

## 日志与 OpenTelemetry

结合 OpenTelemetry，可以在日志中自动注入 `trace_id` 和 `span_id`，实现日志与链路追踪的关联：

```typescript
// src/config/production.ts
import { trace } from '@opentelemetry/api';

export default {
  logger: {
    level: 'info',
    // pino mixin 可以叠加多个数据源
    // VextJS 内置 mixin 已注入 requestId
    // 以下示例展示如何额外注入 trace context
  },
};
```

详见 [OpenTelemetry 接入示例](/examples/opentelemetry) 中的日志关联章节。

## VextLogger 接口

```typescript
interface VextLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
  child(bindings: Record<string, unknown>): VextLogger;
}
```

`VextLogger` 是对 pino 的接口适配。你可以在类型声明中使用这个接口：

```typescript
import type { VextLogger } from 'vextjs';

class PaymentService {
  private logger: VextLogger;

  constructor(app: VextApp) {
    this.logger = app.logger.child({ service: 'PaymentService' });
  }
}
```

## 配置参考

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `logger.level` | `string` | `'info'` | 日志级别：`'debug'` / `'info'` / `'warn'` / `'error'` / `'fatal'` |
| `logger.pretty` | `boolean` | `NODE_ENV !== 'production'` | 是否使用 pino-pretty 彩色格式化输出 |

## 最佳实践

### 1. 使用结构化字段而非字符串拼接

```typescript
// ✅ 结构化字段 — 可索引、可过滤
app.logger.info({ userId, action: 'login', ip: req.ip }, '用户登录');

// ❌ 字符串拼接 — 难以解析和过滤
app.logger.info(`用户 ${userId} 从 ${req.ip} 登录`);
```

### 2. 为每个 Service 创建 Child Logger

```typescript
// ✅ 推荐 — 日志自动携带 service 标识
this.logger = app.logger.child({ service: 'OrderService' });

// ❌ 避免 — 每条日志都要手动加 service
app.logger.info({ service: 'OrderService', ... }, 'xxx');
```

### 3. 不要在日志中输出敏感信息

```typescript
// ✅ 安全
app.logger.info({ userId, action: 'password_change' }, '密码已修改');

// ❌ 危险 — 密码泄漏到日志
app.logger.info({ userId, newPassword }, '密码已修改');

// ❌ 危险 — token 泄漏到日志
app.logger.debug({ token: req.headers.authorization }, '认证信息');
```

### 4. 合理使用日志级别

```typescript
// debug — 详细调试信息（生产环境不输出）
app.logger.debug({ sql: query, params }, '执行数据库查询');

// info — 重要业务事件
app.logger.info({ orderId, total }, '订单创建成功');

// warn — 需要关注但不影响运行
app.logger.warn({ retryCount: 3, url }, '请求重试');

// error — 出错了
app.logger.error({ err, orderId }, '支付处理失败');

// fatal — 应用无法继续运行
app.logger.fatal({ err }, '数据库连接断开，无法恢复');
```

### 5. 在生产环境使用 JSON 格式

JSON 日志是日志收集系统（ELK、Loki、Datadog 等）的标准输入格式。确保生产环境 `pretty: false`（默认行为）。

## 下一步

- 了解 [部署与生产环境](/guide/deployment) 中的日志收集方案
- 查看 [OpenTelemetry 接入](/examples/opentelemetry) 实现日志与链路追踪关联
- 学习 [中间件](/guide/middleware) 如何在请求生命周期中产生日志
- 探索 [配置](/guide/configuration) 中的环境配置覆盖机制
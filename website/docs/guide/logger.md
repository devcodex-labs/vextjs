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

## 日志存储与收集

生产环境中有多种方式将日志持久化存储和收集分析。下面从简到繁介绍各种方案。

### 方案概览

| 方案 | 复杂度 | 适用场景 | 说明 |
|------|:------:|---------|------|
| **PM2 文件收集** | ⭐ | 单机部署 | PM2 自动收集 stdout/stderr 到文件 |
| **pino-roll 日志轮转** | ⭐⭐ | 单机 / 需要自动切割 | pino 内置 transport，按大小/时间自动轮转 |
| **pino/file 文件输出** | ⭐ | 简单文件写入 | pino 内置，直接写入指定文件 |
| **Filebeat → ELK** | ⭐⭐⭐ | 中大型项目 | 文件采集 → Elasticsearch → Kibana |
| **pino-elasticsearch 直连** | ⭐⭐⭐ | 中大型项目 | 直接写入 Elasticsearch，无需中间件 |
| **Docker → Loki** | ⭐⭐ | 容器化部署 | Docker logging driver 推送到 Loki |
| **stdout → Cloud 原生** | ⭐ | K8s / Cloud Run / ECS | 平台自动采集 stdout |

### 推荐日志目录结构

```
project/
├── logs/                    # .gitignore 中排除
│   ├── app.log              # 当前应用日志
│   ├── app.1.log            # 轮转后的历史日志
│   ├── app.2.log
│   ├── error.log            # 仅 error 及以上级别
│   └── access.log           # 访问日志（可选）
├── src/
└── dist/
```

:::warning
确保 `.gitignore` 中包含 `logs/` 目录，不要将日志文件提交到版本库。
:::

---

### 方案一：pino/file 简单文件输出

最基础的文件写入方案，适合小型项目或开发环境：

```typescript
import pino from 'pino';

const transport = pino.transport({
  target: 'pino/file',
  options: {
    destination: './logs/app.log',
    mkdir: true,    // 自动创建 logs/ 目录
  },
});

// 在 VextJS 中，可以通过插件在 logger 创建后替换
// 或在 src/index.ts 启动前配置
```

缺点：文件会无限增长，没有自动轮转。适合搭配外部轮转工具（如 `logrotate`）使用。

---

### 方案二：pino-roll 日志轮转（推荐单机方案）

[pino-roll](https://github.com/feugy/pino-roll) 是 pino 官方推荐的日志轮转 transport，支持按文件大小和时间间隔自动切割。

#### 安装

```bash
npm install pino-roll
```

#### 按文件大小轮转

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
  target: 'pino-roll',
  options: {
    file: './logs/app.log',     // 日志文件路径
    size: '10m',                // 单个文件最大 10MB
    limit: {
      count: 10,                // 最多保留 10 个历史文件
    },
    mkdir: true,                // 自动创建目录
  },
}));
```

轮转后的文件命名：`app.1.log`、`app.2.log`、...

#### 按时间间隔轮转

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
  target: 'pino-roll',
  options: {
    file: './logs/app.log',
    frequency: 'daily',          // 每天轮转一次（也支持 'hourly'）
    dateFormat: 'yyyy-MM-dd',    // 历史文件名中的日期格式
    limit: {
      count: 30,                 // 保留最近 30 天
    },
    mkdir: true,
  },
}));
```

轮转后的文件命名：`app.2026-03-05.log`、`app.2026-03-04.log`、...

#### 同时按大小 + 时间轮转

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
  target: 'pino-roll',
  options: {
    file: './logs/app.log',
    frequency: 'daily',
    size: '50m',                 // 单日内超过 50MB 也会切割
    dateFormat: 'yyyy-MM-dd',
    limit: {
      count: 30,
    },
    mkdir: true,
  },
}));
```

#### 多目标：控制台 + 文件轮转

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
  targets: [
    // 控制台 pretty 输出（开发体验）
    {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l' },
      level: 'debug',
    },
    // 文件轮转（所有级别）
    {
      target: 'pino-roll',
      options: {
        file: './logs/app.log',
        size: '10m',
        limit: { count: 10 },
        mkdir: true,
      },
      level: 'info',
    },
    // 错误日志单独文件
    {
      target: 'pino-roll',
      options: {
        file: './logs/error.log',
        size: '10m',
        limit: { count: 20 },
        mkdir: true,
      },
      level: 'error',
    },
  ],
}));
```

---

### 方案三：系统级 logrotate（Linux）

如果使用 PM2 或 systemd 管理进程，可以用系统自带的 `logrotate` 管理日志轮转：

```bash
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

| 选项 | 说明 |
|------|------|
| `daily` | 每天轮转 |
| `rotate 30` | 保留 30 个历史文件 |
| `compress` | 历史文件 gzip 压缩 |
| `delaycompress` | 最近一个文件不压缩（便于查看） |
| `copytruncate` | 复制后截断（不中断进程写入） |

---

### 方案四：Filebeat → Elasticsearch → Kibana (ELK)

完整的 ELK 日志分析管线。适合需要全文搜索、聚合分析、可视化面板的中大型项目。

#### 架构

```
VextJS (JSON stdout)
  → PM2 (写入文件)
    → Filebeat (采集文件)
      → Elasticsearch (存储 + 索引)
        → Kibana (可视化 + 查询)
```

#### 步骤 1：PM2 输出到文件

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'myapp',
    script: 'dist/index.js',
    env: { NODE_ENV: 'production' },
    error_file: '/var/log/myapp/error.log',
    out_file: '/var/log/myapp/app.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    merge_logs: true,
  }],
};
```

#### 步骤 2：Filebeat 采集

```yaml
# /etc/filebeat/filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/myapp/app.log
    json.keys_under_root: true      # JSON 字段提升到顶层
    json.overwrite_keys: true       # 覆盖同名字段
    json.add_error_key: true        # JSON 解析失败时添加 error 字段
    fields:
      app: myapp
      env: production
    fields_under_root: true

  - type: log
    enabled: true
    paths:
      - /var/log/myapp/error.log
    json.keys_under_root: true
    json.overwrite_keys: true
    fields:
      app: myapp
      env: production
      log_type: error
    fields_under_root: true

output.elasticsearch:
  hosts: ['http://elasticsearch:9200']
  index: 'myapp-%{+yyyy.MM.dd}'
  username: '${ELASTIC_USER}'
  password: '${ELASTIC_PASSWORD}'

# 索引模板（可选，优化映射）
setup.template.name: 'myapp'
setup.template.pattern: 'myapp-*'
setup.template.settings:
  index.number_of_shards: 1
  index.number_of_replicas: 0
```

#### 步骤 3：Kibana 索引模式

1. 打开 Kibana → Stack Management → Index Patterns
2. 创建索引模式：`myapp-*`
3. 时间字段选择 `time`（pino 的 ISO 时间戳）
4. 在 Discover 中即可搜索日志

常用查询：
- 按 requestId 追踪：`requestId: "abc-123"`
- 按错误级别过滤：`level: 50`（pino level 50 = error）
- 按服务过滤：`service: "UserService"`

---

### 方案五：pino-elasticsearch 直连

[pino-elasticsearch](https://github.com/pinojs/pino-elasticsearch) 是 pino 官方的 Elasticsearch transport，无需 Filebeat 中间层，直接从 Node.js 进程写入 ES。

#### 安装

```bash
npm install pino-elasticsearch
```

#### 配置

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
  target: 'pino-elasticsearch',
  options: {
    index: 'myapp',              // 索引名前缀（自动追加日期）
    node: 'http://localhost:9200',
    esVersion: 8,                // Elasticsearch 版本
    flushBytes: 1000,            // 缓冲区达到 1000 字节后批量写入
    flushInterval: 5000,         // 或每 5 秒写入一次
    auth: {
      username: process.env.ELASTIC_USER,
      password: process.env.ELASTIC_PASSWORD,
    },
    // 可选：自定义索引名（按天分割）
    'op.type': 'create',
  },
}));
```

#### 多目标：控制台 + ES

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: { colorize: true },
      level: 'debug',
    },
    {
      target: 'pino-elasticsearch',
      options: {
        index: 'myapp',
        node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
        esVersion: 8,
        flushBytes: 1000,
        flushInterval: 5000,
      },
      level: 'info',
    },
  ],
}));
```

:::tip pino-elasticsearch vs Filebeat
- **pino-elasticsearch**：部署简单，无需额外进程；但如果 ES 不可用，日志会丢失
- **Filebeat**：先落盘再采集，ES 宕机时日志不丢失；需要额外部署 Filebeat

生产环境推荐 Filebeat 方案（更可靠），开发/测试环境可用 pino-elasticsearch（更简单）。
:::

---

### 方案六：Docker → Loki

容器化部署时，使用 Docker logging driver 直接推送到 Grafana Loki：

```yaml
# docker-compose.yml
services:
  app:
    build: .
    logging:
      driver: loki
      options:
        loki-url: 'http://loki:3100/loki/api/v1/push'
        loki-batch-size: '400'
        loki-retries: '3'
        loki-external-labels: 'app=myapp,env=production'
```

在 Grafana 中添加 Loki 数据源即可查询日志：
- 按 requestId 查询：`{app="myapp"} |= "abc-123"`
- 按 JSON 字段过滤：`{app="myapp"} | json | level >= 50`

---

### 方案七：stdout → Cloud 原生

在 Kubernetes / AWS ECS / Google Cloud Run 等平台中，直接输出到 stdout，由平台自动采集：

```bash
# 不需要额外配置，JSON 日志直接输出到 stdout
NODE_ENV=production node dist/index.js
```

| 平台 | 日志采集方式 |
|------|-------------|
| **Kubernetes** | stdout → kubelet → Fluentd / Fluent Bit / Loki → 存储 |
| **AWS ECS** | stdout → CloudWatch Logs |
| **Google Cloud Run** | stdout → Cloud Logging |
| **Azure Container Apps** | stdout → Azure Monitor |

这是最简单也最推荐的云原生方案——**不做任何日志配置**，让平台处理一切。

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
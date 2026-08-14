# 日志 (Logger)

VextJS 内置零 runtime dependency 的 Vext logger kernel，通过 `app.logger` 在框架的任意位置使用。默认提供结构化 JSON、pretty/JSON 双模式、pretty level 彩色输出、requestId 自动注入、child logger、运行时级别控制和极简日志脱敏等能力。

## 基本用法

`app.logger` 在路由、服务、插件和中间件中均可直接使用：

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/users", async (req, res) => {
    app.logger.info("获取用户列表");
    app.logger.debug({ page: 1, limit: 20 }, "查询参数");

    const users = await app.services.user.findAll();
    app.logger.info({ count: users.length }, "查询完成");

    res.json(users);
  });
});
```

## 日志级别

`app.logger` 公开 6 个常用方法，按严重程度从低到高排列：

| 级别    | 方法                 | 说明     | 典型场景                     |
| ------- | -------------------- | -------- | ---------------------------- |
| `trace` | `app.logger.trace()` | 最细粒度 | 临时排障、非常详细的路径信息 |
| `debug` | `app.logger.debug()` | 调试信息 | 变量值、SQL 查询、详细流程   |
| `info`  | `app.logger.info()`  | 一般信息 | 服务启动、请求处理、业务事件 |
| `warn`  | `app.logger.warn()`  | 警告     | 性能下降、弃用 API、重试     |
| `error` | `app.logger.error()` | 错误     | 异常、失败的操作             |
| `fatal` | `app.logger.fatal()` | 致命错误 | 应用无法继续运行             |

`logger.level` 接受 `trace` 和 `silent` 作为阈值配置：`trace` 会放开所有日志方法，`silent` 会关闭全部输出。

### 配置日志级别

```typescript
// src/config/default.ts
export default {
  logger: {
    level: "debug", // 开发环境输出所有级别
  },
};
```

```typescript
// src/config/production.ts
export default {
  logger: {
    level: "info", // 生产环境只输出 info 及以上
  },
};
```

设置某个级别后，**低于该级别的日志不会输出**。例如 `level: 'info'` 时，`debug()` 调用会被 logger 阈值过滤，不生成日志记录。

### 运行时调整日志级别

默认 logger 支持在运行时调整后续日志阈值，适合线上临时排障：

```typescript
app.logger.getLevel(); // "info"
app.logger.setLevel("debug");
app.logger.debug({ orderId }, "debug detail");
app.logger.setLevel("warn");
```

- `setLevel()` 只影响后续日志，不回溯历史日志。
- 已创建的 child logger 与父 logger 共享当前 runtime level。
- 不支持 `app.logger.level = "debug"` 这种可写属性兼容；请使用 `setLevel()`。
- 非法 level 会抛出明确错误，不会静默降级。

## 生命周期日志分层

除了常规 `logger.level` 外，VextJS 还提供 `logger.lifecycleLevel`，专门控制框架自己的**启动 / 加载 / 热重载**系统日志：

```typescript
export default {
  logger: {
    level: "info",
    lifecycleLevel: "concise", // "concise" | "verbose"
  },
};
```

- `concise`（默认）：仅输出初始化开始、聚合加载数量、ready、cold restart / hot reload 单行结果
- `verbose`：额外输出逐插件 / 逐服务 / watcher 文件列表 / reload 分阶段耗时

也可以通过环境变量或 CLI 覆盖：

```bash
VEXT_LIFECYCLE_LEVEL=verbose vext start
VEXT_VERBOSE_LIFECYCLE=1 vext dev
```

## 结构化日志

Vext logger 的核心理念是**结构化日志**——每条日志都是一个 JSON 对象，便于机器解析和查询。

### 调用签名

```typescript
// 纯消息
app.logger.info("服务启动");

// 对象 + 消息（推荐）
app.logger.info({ port: 3000, adapter: "native" }, "服务启动");

// 对象（无消息）
app.logger.info({ event: "startup", port: 3000 });
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

开发环境（默认）下使用内置 pretty formatter，输出便于阅读的格式化日志。默认启用单行模式（`prettySingleLine: true`），结构化字段以 JSON 形式内联附加在消息末尾：

```
[2026-03-05 14:23:05.123] INFO: 服务启动 {"port":3000,"adapter":"native"}
[2026-03-05 14:23:05.200] DEBUG: 查询参数 {"page":1,"limit":20}
[2026-03-05 14:23:05.300] INFO: Seed data loaded {"count":3,"service":"UserService"}
```

如果设置 `prettySingleLine: false`，则使用多行展开格式：

```
[2026-03-05 14:23:05.123] INFO  服务启动
    port: 3000
    adapter: "native"
[2026-03-05 14:23:05.200] DEBUG 查询参数
    page: 1
    limit: 20
```

> **注意**：`requestId` 默认被内置 pretty formatter 的 `ignore` 列表排除（`prettyIgnore` 配置项），不会在 pretty 模式下输出。这使开发日志更紧凑。`requestId` 仍然存在于生产环境的 JSON 输出中。如需在 pretty 模式下显示 requestId，可通过 `prettyIgnore` 配置项移除它（见下方配置说明）。

TTY 终端中，pretty formatter 默认会为 `trace` / `debug` / `info` / `warn` / `error` / `fatal` 的 level label 添加固定 ANSI 颜色，便于开发期扫读。颜色只包裹 level label，不影响 message、URL、extras、redaction 替换值或 JSON 输出。

### 配置 Pretty 模式

```typescript
// src/config/default.ts
export default {
  logger: {
    level: "debug",
    pretty: true, // 开发环境使用 pretty 格式（默认行为）
    prettyColor: "auto", // TTY 中自动给 level label 加色
  },
};
```

```typescript
// src/config/production.ts
export default {
  logger: {
    level: "info",
    pretty: false, // 生产环境使用 JSON 格式（默认行为）
  },
};
```

`pretty` 默认值取决于 `NODE_ENV`：

- `NODE_ENV !== 'production'` → `pretty: true`
- `NODE_ENV === 'production'` → `pretty: false`

### 彩色 Pretty Level {#pretty-color}

`prettyColor` 只影响 pretty 文本输出，支持三种模式：

| 值         | 行为                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"auto"`   | 默认值。TTY 中启用；`FORCE_COLOR=1` 强制启用且优先于 `NO_COLOR`；`FORCE_COLOR=0`、未设置 `FORCE_COLOR` 时的 `NO_COLOR`、`TERM=dumb` 或非 TTY 禁用 |
| `"always"` | pretty 模式下强制输出 ANSI，常用于本地手动观察或自动化验证                                                                                        |
| `"never"`  | 禁用 pretty ANSI                                                                                                                                  |

```typescript
// src/config/development.ts
export default {
  logger: {
    pretty: true,
    prettyColor: "auto",
  },
};
```

生产 JSON 日志不会输出 ANSI，即使设置了 `prettyColor: "always"`，只要 `pretty: false` 仍然会保持纯 JSON。
在 `npm run dev`、CI 或重定向日志中需要强制观察颜色时，可使用 `FORCE_COLOR=1`。

### 单行 vs 多行格式 {#pretty-single-line}

通过 `prettySingleLine` 配置项可以控制内置 pretty formatter 在开发模式下的结构化字段展示方式。默认值为 `true`（单行模式）。

```typescript
// src/config/default.ts — 默认行为（单行输出）
export default {
  logger: {
    pretty: true,
    // prettySingleLine 默认值: true
    // 输出: [14:23:05] INFO: Seed data loaded {"count":3,"service":"UserService"}
  },
};
```

如果偏好多行展开格式，可以设置为 `false`：

```typescript
// src/config/development.ts — 多行展开
export default {
  logger: {
    pretty: true,
    prettySingleLine: false,
    // 输出:
    // [14:23:05] INFO  Seed data loaded
    //     count: 3
    //     service: "UserService"
  },
};
```

> **注意**：`prettySingleLine` 仅影响 pretty 模式（开发环境）。生产环境的 JSON 输出格式不受影响。

### 自定义 Pretty 忽略字段 {#pretty-ignore}

通过 `prettyIgnore` 配置项可以控制内置 pretty formatter 在开发模式下隐藏哪些结构化字段。默认值为 `"pid,hostname,requestId"`，即隐藏进程 ID、主机名和请求 ID，避免开发日志中出现不必要的字段噪音。

```typescript
// src/config/default.ts — 默认行为（requestId 被隐藏）
export default {
  logger: {
    pretty: true,
    // prettyIgnore 默认值: "pid,hostname,requestId"
  },
};
```

如果需要在 pretty 模式下**显示** requestId（例如调试请求链路时），可以将其从 ignore 列表中移除：

```typescript
// src/config/development.ts — 显示 requestId
export default {
  logger: {
    pretty: true,
    prettyIgnore: "pid,hostname", // 不再忽略 requestId
  },
};
```

也可以添加额外的忽略字段：

```typescript
// 隐藏 requestId + 自定义字段
export default {
  logger: {
    prettyIgnore: "pid,hostname,requestId,traceId,spanId",
  },
};
```

> **注意**：`prettyIgnore` 仅影响 pretty 模式（开发环境）。生产环境的 JSON 输出始终包含所有字段（包括 `requestId`），确保日志收集系统能完整解析。

## 日志脱敏

默认 logger 提供默认关闭的极简 redaction，用于在写入 stdout 前替换结构化日志字段：

```typescript
// src/config/production.ts
export default {
  logger: {
    level: "info",
    redactKeys: ["password", "token"],
    redactPaths: ["user.email", "headers.authorization", "users.0.secret"],
    redactValue: "[Redacted]",
  },
};
```

效果：

```typescript
app.logger.info(
  {
    user: { email: "ada@example.com", password: "secret" },
    headers: { authorization: "Bearer token" },
  },
  "login",
);
```

输出中的 `user.email`、`password` 和 `headers.authorization` 会被替换为 `"[Redacted]"`。

边界：

- `redactKeys` 是任意层级 exact key 匹配。
- `redactPaths` 是 dot notation exact path，支持数组数字下标。
- 脱敏发生在 pretty/JSON 输出前，两种格式保持一致。
- 脱敏不会修改调用方传入的原始对象。
- 顶层 `level` 是日志协议字段，不会被 redaction 改写。
- 不支持 wildcard、glob、regex、bracket notation、remove 或 function censor。

### 自定义 Pretty 输出 {#custom-pretty-output}

VextJS 默认不暴露 `messageFormat` 模板配置。大多数开发场景可以直接用 `prettySingleLine` 和 `prettyIgnore` 控制输出紧凑度：

- `prettySingleLine: true`：额外字段以 JSON 内联在消息同一行
- `prettySingleLine: false`：额外字段多行展开
- `prettyIgnore`：隐藏开发日志中暂时不关心的结构化字段

如果需要把日志同步到外部系统或完全接管格式化逻辑，推荐通过 `app.setLogger()` 在插件中包装当前 logger。这样不会影响框架默认 JSON 字段、requestId 注入和 child logger 行为。

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "custom-log-format",
  setup(app) {
    app.setLogger((original) => ({
      ...original,
      info(...args: unknown[]) {
        // 可在这里转发到外部 SDK，或生成额外的人类可读日志。
        original.info(...args);
      },
      child: (bindings) => original.child(bindings),
    }));
  },
});
```

## requestId 自动注入

这是 VextJS 日志系统最重要的特性之一。**无需手动传入 requestId**，所有日志自动携带当前请求的 requestId。

### 工作原理

```
请求进入 → requestId 中间件生成 ID → 写入 requestContext（AsyncLocalStorage）
                                              ↓
app.logger.info('xxx')  ←  logger mixin 自动读取 requestId
                                              ↓
输出: {"requestId":"abc-123","msg":"xxx"}
```

Vext logger 的 `mixin` 在每条日志写入前调用，从 `requestContext`（基于 `AsyncLocalStorage`）中读取当前请求的 `requestId` 并附加到日志字段。这意味着：

- **handler 中的日志**：自动携带 requestId ✅
- **service 中的日志**：自动携带 requestId ✅
- **中间件中的日志**：自动携带 requestId ✅
- **启动阶段的日志**：无 requestId（非请求上下文）✅

```typescript
// 不需要这样做 ❌
app.logger.info({ requestId: req.requestId }, "处理请求");

// 直接这样就行 ✅
app.logger.info("处理请求");
// 输出自动包含 requestId
```

### 性能优化

Vext logger 的请求字段注入走同步 provider 链路，并在无请求上下文或未配置用户 `mixin` 时直接跳过对应合并步骤。VextJS 做了两项优化：

1. **空上下文快速返回**：启动阶段、后台任务等非请求上下文不会生成 `requestId` / `trace_id` / `span_id` 字段
2. **ALS 禁用检测**：当 AsyncLocalStorage 被禁用时，跳过 `getStore()` 调用

## Child Logger

`child()` 方法创建子 logger，子 logger 继承父 logger 的所有配置（级别、格式、mixin），并额外携带指定的绑定字段：

```typescript
// 创建带 service 字段的子 logger
const serviceLogger = app.logger.child({ service: "UserService" });

serviceLogger.info("初始化完成");
// 输出: {"service":"UserService","msg":"初始化完成"}

serviceLogger.info({ userId: "123" }, "查询用户");
// 输出: {"service":"UserService","userId":"123","msg":"查询用户"}
```

### 在 Service 中使用

推荐在 Service 构造函数中创建 child logger：

```typescript
export class UserService {
  private logger;

  constructor(private app: any) {
    // 创建带 service 标识的子 logger
    this.logger = app.logger.child({ service: "UserService" });
  }

  async findById(userId: string) {
    this.logger.debug({ userId }, "查询用户");

    const user = await this.app.db.collection("users").findOne({ _id: userId });

    if (!user) {
      this.logger.warn({ userId }, "用户不存在");
      this.app.throw(404, "用户不存在");
    }

    this.logger.info({ userId, event: "user.found" }, "用户查询成功");
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
const dbLogger = app.logger.child({ module: "database" });
const queryLogger = dbLogger.child({ collection: "users" });

queryLogger.debug("执行查询");
// 输出: {"module":"database","collection":"users","msg":"执行查询"}
```

## 错误日志

### 记录 Error 对象

Vext logger 自动序列化 Error 对象（保留 message、stack、name）：

```typescript
try {
  await someOperation();
} catch (err) {
  app.logger.error({ err }, "操作失败");
  // Vext logger 会自动序列化 Error:
  // {"err":{"type":"Error","message":"xxx","stack":"..."},"msg":"操作失败"}
}
```

:::tip Error 调用方式
直传 Error 和 `{ err }` 字段都受支持。需要附加业务上下文时，推荐使用 `{ err, ...context }`：

```typescript
// ✅ 直传 Error
app.logger.error(error, "操作失败");

// ✅ 添加业务上下文
app.logger.error({ err: error }, "操作失败");
```

:::

### 记录错误上下文

```typescript
async function processPayment(orderId: string, amount: number) {
  try {
    const result = await paymentGateway.charge(amount);
    app.logger.info({ orderId, amount, chargeId: result.id }, "支付成功");
    return result;
  } catch (err) {
    app.logger.error({ err, orderId, amount, gateway: "stripe" }, "支付失败");
    throw err;
  }
}
```

## 扩展 Logger：setLogger()

`app.setLogger(wrapper)` 是插件专用的 API，允许你在不替换默认 logger kernel 的情况下，对所有日志方法进行包装——常见用途是将框架日志**同时转发**到外部系统（OTel Logs、Sentry、云日志平台等）。

### 函数签名

```typescript
setLogger(wrapper: (original: VextRuntimeLogger) => VextLoggerLike): void;
```

`wrapper` 接收当前完整运行时 logger（默认 Vext logger 或上一个 wrapper 归一化后的结果），返回完整或部分 `VextLoggerLike` 实现。未返回的方法会回退到原始 logger。可以在新实现中：

- 调用外部 SDK 上报日志
- 过滤或采样某些级别
- 注入全局字段

### 典型用法：桥接到 OpenTelemetry Logs

当你使用 `@devcodex/opentelemetry` 插件时，它会在 `setup()` 中调用 `app.setLogger()` 自动将 `app.logger` 的所有调用转发到 OTel Logs SDK，无需额外配置：

```typescript
// src/plugins/otel.ts
import { opentelemetryPlugin } from "@devcodex/opentelemetry/vextjs";

export default opentelemetryPlugin({
  endpoint: "grpc://collector:4317",
  protocol: "grpc",
  logs: {
    bridgeAppLogger: true, // 默认 true（endpoint 有效时自动开启）
    globalAttributes: {
      "app.version": "1.2.0",
    },
  },
});
// → app.logger.info("xxx") 同时上报到 OTel Collector + 输出到 stdout
```

### 自定义 Logger 扩展示例

```typescript
import { definePlugin } from "vextjs";
import type { VextLogger } from "vextjs";

export default definePlugin({
  name: "sentry-logger",
  setup(app) {
    app.setLogger((original) => ({
      ...original,
      error(...args: unknown[]) {
        // 上报 error 级别日志到 Sentry
        const msg =
          typeof args[0] === "string" ? args[0] : String(args[1] ?? "");
        Sentry.captureMessage(msg, "error");
        // 默认 logger 输出不变
        (original.error as (...a: unknown[]) => void)(...args);
      },
      // child logger 保持原逻辑
      child: (bindings) => original.child(bindings),
    }));
  },
});
```

:::tip 与 setThrow 模式一致
`setLogger` 采用与 `setThrow` 完全相同的 wrapper 模式：接收原始实现，返回包装后的实现。这意味着：

- 可以多次调用（每次包裹上一次的结果）
- wrapper 未覆盖的方法会保留默认 logger 功能（requestId 注入、pretty 格式、child logger 与运行时日志级别控制）
- 包装函数中抛出的异常不会影响原始 logger
  :::

:::warning child logger 回退与桥接
当 wrapper 未返回 `child()` 时，child logger 会回退到原始 logger。如需子 logger 也桥接，请在 wrapper 中返回 `child()` 并在该方法内包装子 logger。
:::

---

## 日志存储与收集

生产环境推荐让 VextJS 输出结构化 JSON 到 stdout/stderr，再由进程管理器、容器平台或日志 Agent 负责持久化、轮转和上报。这样应用进程不需要额外日志 transport 依赖，也能保持日志管线可替换。

### 方案概览

| 方案                       | 复杂度 | 适用场景              | 说明                                |
| -------------------------- | :----: | --------------------- | ----------------------------------- |
| **stdout → Cloud 原生**    |   ⭐   | K8s / Cloud Run / ECS | 平台自动采集 stdout                 |
| **PM2 / systemd 文件收集** |   ⭐   | 单机部署              | 进程管理器收集 stdout/stderr 到文件 |
| **logrotate**              |  ⭐⭐  | 单机 / 需要自动切割   | 系统级日志轮转，应用无需感知        |
| **Filebeat → ELK**         | ⭐⭐⭐ | 中大型项目            | 文件采集 → Elasticsearch → Kibana   |
| **Docker → Loki**          |  ⭐⭐  | 容器化部署            | Docker logging driver 或 Agent 推送 |
| **app.setLogger 桥接**     | ⭐⭐⭐ | 需要 SDK 直连         | 插件包装 logger，同步转发到外部 SDK |

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

### 方案一：stdout → Cloud 原生

在 Kubernetes / AWS ECS / Google Cloud Run 等平台中，直接输出到 stdout，由平台自动采集：

```bash
# 不需要额外配置，JSON 日志直接输出到 stdout
vext start
```

| 平台                     | 日志采集方式                                          |
| ------------------------ | ----------------------------------------------------- |
| **Kubernetes**           | stdout → kubelet → Fluentd / Fluent Bit / Loki → 存储 |
| **AWS ECS**              | stdout → CloudWatch Logs                              |
| **Google Cloud Run**     | stdout → Cloud Logging                                |
| **Azure Container Apps** | stdout → Azure Monitor                                |

这是最简单也最推荐的云原生方案——**不做任何日志配置**，让平台处理一切。

---

### 方案二：PM2 / systemd 文件收集

单机部署时，可以让进程管理器把 stdout/stderr 写入文件，再配合 `logrotate` 轮转。

#### PM2 示例

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "myapp",
      script: "node_modules/vextjs/dist/cli/index.js",
      args: "start",
      error_file: "/var/log/myapp/error.log",
      out_file: "/var/log/myapp/app.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      merge_logs: true,
    },
  ],
};
```

#### systemd 示例

```ini
# /etc/systemd/system/myapp.service
[Service]
ExecStart=/usr/bin/npm start
WorkingDirectory=/srv/myapp
StandardOutput=append:/var/log/myapp/app.log
StandardError=append:/var/log/myapp/error.log
Restart=always
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

| 选项            | 说明                           |
| --------------- | ------------------------------ |
| `daily`         | 每天轮转                       |
| `rotate 30`     | 保留 30 个历史文件             |
| `compress`      | 历史文件 gzip 压缩             |
| `delaycompress` | 最近一个文件不压缩（便于查看） |
| `copytruncate`  | 复制后截断（不中断进程写入）   |

---

### 方案四：Filebeat → Elasticsearch → Kibana (ELK)

完整的 ELK 日志分析管线。适合需要全文搜索、聚合分析、可视化面板的中大型项目。

#### 架构

```
VextJS (JSON stdout)
  → PM2 / systemd / container runtime (写入或暴露日志流)
    → Filebeat / Fluent Bit (采集)
      → Elasticsearch (存储 + 索引)
        → Kibana (可视化 + 查询)
```

#### Filebeat 采集

```yaml
# /etc/filebeat/filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/myapp/app.log
    json.keys_under_root: true # JSON 字段提升到顶层
    json.overwrite_keys: true # 覆盖同名字段
    json.add_error_key: true # JSON 解析失败时添加 error 字段
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
  hosts: ["http://elasticsearch:9200"]
  index: "myapp-%{+yyyy.MM.dd}"
  username: "${ELASTIC_USER}"
  password: "${ELASTIC_PASSWORD}"

# 索引模板（可选，优化映射）
setup.template.name: "myapp"
setup.template.pattern: "myapp-*"
setup.template.settings:
  index.number_of_shards: 1
  index.number_of_replicas: 0
```

#### Kibana 索引模式

1. 打开 Kibana → Stack Management → Index Patterns
2. 创建索引模式：`myapp-*`
3. 时间字段选择 `time`（Vext logger 的 ISO 时间戳）
4. 在 Discover 中即可搜索日志

常用查询：

- 按 requestId 追踪：`requestId: "abc-123"`
- 按错误级别过滤：`level: 50`（Vext logger level 50 = error）
- 按服务过滤：`service: "UserService"`

---

### 方案五：Docker → Loki

容器化部署时，使用 Docker logging driver 直接推送到 Grafana Loki：

```yaml
# docker-compose.yml
services:
  app:
    build: .
    logging:
      driver: loki
      options:
        loki-url: "http://loki:3100/loki/api/v1/push"
        loki-batch-size: "400"
        loki-retries: "3"
        loki-external-labels: "app=myapp,env=production"
```

在 Grafana 中添加 Loki 数据源即可查询日志：

- 按 requestId 查询：`{app="myapp"} |= "abc-123"`
- 按 JSON 字段过滤：`{app="myapp"} | json | level >= 50`

---

### 方案六：app.setLogger 桥接外部 SDK

如果必须在应用内同步调用外部日志 SDK，可以通过 `app.setLogger()` 包装当前 logger。该方式适合插件封装，默认 logger 仍继续输出到 stdout。

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "cloud-logger-bridge",
  setup(app) {
    app.setLogger((original) => ({
      ...original,
      info(...args: unknown[]) {
        cloudLogger.write("info", args);
        original.info(...args);
      },
      error(...args: unknown[]) {
        cloudLogger.write("error", args);
        original.error(...args);
      },
      child: (bindings) => original.child(bindings),
    }));
  },
});
```

这不是默认 logger 的替换机制，而是插件层的转发桥。后续如需官方 OTel Logs、Sentry、Loki/ELK 插件，可以在这个 wrapper 契约上继续扩展。

## 日志与 OpenTelemetry

结合 OpenTelemetry，可以在日志中自动注入 `trace_id` 和 `span_id`，实现日志与链路追踪的关联：

```typescript
// src/config/production.ts
import { trace } from "@opentelemetry/api";

export default {
  logger: {
    level: "info",
    mixin() {
      const span = trace.getActiveSpan();
      if (!span?.isRecording()) return {};
      const ctx = span.spanContext();
      return {
        trace_id: ctx.traceId, // 注入到每条日志的 trace_id 字段（OTEL 语义约定）
        span_id: ctx.spanId, // 注入到每条日志的 span_id 字段
      };
    },
  },
};
```

**工作原理**：

- `mixin()` 在每条日志写入前被调用，返回值会与框架内置字段合并注入
- `requestId` 是框架保护字段，不可被用户 mixin 覆盖；`trace_id` / `span_id` 等其他字段按用户 mixin 优先
- 未配置 `mixin` 时，不会执行用户 mixin 调用，默认请求字段注入行为保持不变
- 框架不依赖 `@opentelemetry/api`，该包由用户在 tracing 初始化时引入

**与 F-03（ALS 自动注入）的关系**：如果你在 tracing 中间件中向 `requestContext` 写入了 `traceId` / `spanId`，框架内置 mixin 会自动将其注入日志——无需配置 `mixin` 选项。`mixin` 配置适用于需要**直接从 OTEL Context API 实时读取**当前活跃 Span 的场景。

详见 [OpenTelemetry 接入示例](/examples/opentelemetry) 中的日志关联章节。

## VextLogger 接口

```typescript
interface VextLogger {
  trace(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
  getLevel():
    | "trace"
    | "debug"
    | "info"
    | "warn"
    | "error"
    | "fatal"
    | "silent";
  setLevel(
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent",
  ): void;
  child(bindings: Record<string, unknown>): VextLogger;
}
```

`VextLogger` 是框架公开的日志接口。你可以在类型声明中使用这个接口：

```typescript
import type { VextLogger } from "vextjs";

class PaymentService {
  private logger: VextLogger;

  constructor(app: VextApp) {
    this.logger = app.logger.child({ service: "PaymentService" });
  }
}
```

## 与 Pino 的能力差异

Vext 内置 logger 的目标是覆盖框架默认日志所需的稳定子集，并移除默认安装路径中的 logger runtime dependency。它不是 Pino 的完整兼容层，也不会把 Pino 的所有扩展点搬进 core。

| Pino 能力                          | Vext 当前状态                                                        | 推荐扩展路径                                              |
| ---------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| `logger.trace()` 公开方法          | 已支持                                                               | N/A                                                       |
| 运行时修改日志级别                 | 已支持 `getLevel()` / `setLevel()`；不支持可写 `logger.level` 属性   | 如需采样/复杂策略可用 `app.setLogger()` 包装              |
| custom levels / level formatter    | 未支持自定义级别或重命名 `level` 字段                                | 外部日志系统侧映射 numeric level                          |
| `redact` 路径脱敏                  | 已支持 exact key/path 子集                                           | wildcard/remove/censor function 可在 wrapper/Agent 侧处理 |
| serializers / stdSerializers       | 仅内置 Error 与 JSON-safe 序列化                                     | 业务字段预处理或 wrapper 中处理                           |
| `messageKey` / `errorKey`          | 固定使用 `msg` / `err` 语义                                          | 日志采集侧映射字段                                        |
| `transport` / multistream / file   | 不内置 worker transport、多目标或文件写入                            | stdout → Agent/平台采集，或 `app.setLogger()` 桥接        |
| pino-pretty 完整选项               | 仅支持内置 pretty、`prettyColor`、`prettyIgnore`、`prettySingleLine` | 开发期可接外部 formatter 或自定义 wrapper                 |
| browser API                        | 未支持浏览器 logger                                                  | Vext 是 Node.js 服务端框架，浏览器侧另选方案              |
| `hooks.logMethod` / merge strategy | 未暴露日志调用 hook 或 mixin 合并策略                                | 用 `app.setLogger()` 包装公开方法                         |

这些缺口不会影响 Vext 默认框架日志、access log、requestId/trace 字段注入、child logger、Error 序列化和 stdout-first 收集。后续若需要官方 OTel Logs、Sentry、Loki/ELK 插件，应优先基于 `app.setLogger()` 和外部 Agent 扩展，而不是把 transport 体系内置回 core。

## 配置参考

| 配置项                    | 类型       | 默认值                      | 说明                                                                                           |
| ------------------------- | ---------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `logger.level`            | `string`   | `'info'`                    | 日志阈值：`'trace'` / `'debug'` / `'info'` / `'warn'` / `'error'` / `'fatal'` / `'silent'`     |
| `logger.lifecycleLevel`   | `string`   | `'concise'`                 | 框架生命周期日志详细程度：`'concise'` / `'verbose'`                                            |
| `logger.pretty`           | `boolean`  | `NODE_ENV !== 'production'` | 是否使用内置 pretty formatter 输出可读格式                                                     |
| `logger.prettyColor`      | `string`   | `'auto'`                    | pretty 模式下是否给 level label 添加 ANSI：`'auto'` / `'always'` / `'never'`                   |
| `logger.prettyIgnore`     | `string`   | `'pid,hostname,requestId'`  | pretty 模式下忽略的字段（逗号分隔）。默认隐藏 `requestId` 避免多行噪音，生产 JSON 输出不受影响 |
| `logger.prettySingleLine` | `boolean`  | `true`                      | pretty 模式下是否将额外字段以 JSON 内联形式压缩到消息同一行。设为 `false` 使用多行展开格式     |
| `logger.redactKeys`       | `string[]` | `[]`                        | 按任意层级 exact key 脱敏结构化日志字段                                                        |
| `logger.redactPaths`      | `string[]` | `[]`                        | 按 dot notation exact path 脱敏结构化日志字段                                                  |
| `logger.redactValue`      | `string`   | `'[Redacted]'`              | 脱敏替换值                                                                                     |
| `logger.mixin`            | `function` | `undefined`                 | 同步返回自定义结构化字段；`requestId` 不可被覆盖，`trace_id` / `span_id` 可由用户字段覆盖      |

## 最佳实践

### 1. 使用结构化字段而非字符串拼接

```typescript
// ✅ 结构化字段 — 可索引、可过滤
app.logger.info({ userId, action: "login", ip: req.ip }, "用户登录");

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
app.logger.info({ userId, action: "password_change" }, "密码已修改");

// ❌ 危险 — 密码泄漏到日志
app.logger.info({ userId, newPassword }, "密码已修改");

// ❌ 危险 — token 泄漏到日志
app.logger.debug({ token: req.headers.authorization }, "认证信息");
```

### 4. 合理使用日志级别

```typescript
// debug — 详细调试信息（生产环境不输出）
app.logger.debug({ sql: query, params }, "执行数据库查询");

// info — 重要业务事件
app.logger.info({ orderId, total }, "订单创建成功");

// warn — 需要关注但不影响运行
app.logger.warn({ retryCount: 3, url }, "请求重试");

// error — 出错了
app.logger.error({ err, orderId }, "支付处理失败");

// fatal — 应用无法继续运行
app.logger.fatal({ err }, "数据库连接断开，无法恢复");
```

### 5. 在生产环境使用 JSON 格式

JSON 日志是日志收集系统（ELK、Loki、Datadog 等）的标准输入格式。确保生产环境 `pretty: false`（默认行为）。

## 下一步

- 了解 [部署与生产环境](/guide/deployment) 中的日志收集方案
- 查看 [OpenTelemetry 接入](/examples/opentelemetry) 实现日志与链路追踪关联
- 学习 [中间件](/guide/middleware) 如何在请求生命周期中产生日志
- 探索 [配置](/guide/configuration) 中的环境配置覆盖机制

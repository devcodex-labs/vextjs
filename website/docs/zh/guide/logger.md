# 日志 (Logger)

通过 `app.logger` 记录结构化业务日志，使用 child logger 标识 Service，并与请求 ID 关联。内置实现支持 JSON/pretty 输出、六级日志、运行时阈值、Error 序列化和可选字段脱敏；默认日志内核不依赖第三方日志包。

先完成下面的请求流程，再按需要调整格式或接入采集系统。本页其余 API 调用片段均放在已取得 `app: VextApp` 的路由或插件中；配置片段应合并到现有配置，不要逐段替换整个文件。

## 基本用法

前置：已有[快速开始](/zh/guide/quick-start)中的 TypeScript API-only 项目。保留 package.json、tsconfig.json 和启动脚本，合并配置并新增 Service 与路由：

```typescript
// src/config/default.ts
export default {
  host: "127.0.0.1",
  port: 3000,
  frontend: { enabled: false },
  logger: { level: "debug", pretty: false },
};
```

```typescript
// src/services/log-demo.ts
import type { VextApp, VextRuntimeLogger } from "vextjs";

export default class LogDemoService {
  private readonly logger: VextRuntimeLogger;

  constructor(app: VextApp) {
    this.logger = app.logger.child({ service: "LogDemoService" });
  }

  list() {
    this.logger.debug({ count: 2 }, "query started");
    const users = [{ id: "u-1" }, { id: "u-2" }];
    this.logger.info({ count: users.length }, "query completed");
    return users;
  }
}
```

```typescript
// src/routes/log-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/users", async (req, res) => {
    app.logger.trace("hidden at debug threshold");
    res.json(app.services.logDemo.list());
  });
  app.get("/error", async (_req, res) => {
    const err = new Error("demonstration error");
    app.logger.error({ err, operation: "demo" }, "caught example");
    // 记录日志不会自动设置 HTTP 状态或抛出异常
    res.json({ logged: true });
  });
});
```

运行 `npm run dev` 后，在另一个终端访问：

```bash
curl -H "x-request-id: log-demo-1" http://127.0.0.1:3000/log-demo/users
curl -H "x-request-id: log-demo-2" http://127.0.0.1:3000/log-demo/error
```

Windows PowerShell 可用 `curl.exe`。第一项返回 200 与两个用户，JSON 日志有 level 20/30、service=LogDemoService、requestId=log-demo-1；trace 被 debug 阈值过滤。第二项返回 200 与 `data.logged: true`，并输出 level 50、requestId=log-demo-2 和 err 的 type/message/name/stack。

停止 dev，执行 `npm run build`、`npm start`，重复两项请求；结束后 Ctrl+C 停止服务。将配置 level 改为 info 后重启，debug 应消失，info/error 保留。生产输出建议明确设 `pretty: false`，应用 JSON 日志与 CLI 启动提示可能同处一个输出流，采集时需区分。

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
    level: "debug", // 输出 debug 及以上；trace 仍被过滤
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
app.logger.getLevel(); // 当前阈值；本页完整示例初始为 "debug"
app.logger.setLevel("debug");
app.logger.debug({ orderId: "order-demo" }, "debug detail");
app.logger.setLevel("warn");
```

- `setLevel()` 只影响后续日志，不回溯历史日志。
- 已创建的 child logger 与父 logger 共享当前 runtime level。
- 不支持 `app.logger.level = "debug"` 这种可写属性兼容；请使用 `setLevel()`。
- 使用表中支持的级别；非法值不属于公开契约。
- `fatal()` 只记录 level 60，不会自行退出进程或执行优雅关闭。

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
VEXT_LIFECYCLE_LEVEL=verbose npm start
VEXT_VERBOSE_LIFECYCLE=1 npm run dev
```

上面是 Bash 写法；PowerShell 可用 `$env:VEXT_LIFECYCLE_LEVEL="verbose"` 后运行 `npm start`，结束后移除该临时环境变量。CLI 的 `--verbose` 也可启用详细输出。生命周期日志详细程度不等于业务日志阈值；部分 CLI 启动提示由独立输出入口生成，不保证都被 `logger.level` 过滤。

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

未显式覆盖 pretty 时，生产环境（`NODE_ENV=production`）使用 JSON。以下是省略 pid/hostname 的两条 JSON Lines，不是一个包含两个对象的 JSON 文件：

```jsonl
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
[2026-03-05 14:23:05.123] INFO: 服务启动
    port: 3000
    adapter: "native"
[2026-03-05 14:23:05.200] DEBUG: 查询参数
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
    // [14:23:05] INFO: Seed data loaded
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
    prettyIgnore: "pid,hostname,requestId,trace_id,span_id",
  },
};
```

> `prettyIgnore` 只控制 pretty 的额外字段显示，不改变 JSON 内容；JSON 中仍只包含本次实际产生的字段，受级别过滤和脱敏规则影响，没有请求作用域时也可能没有 requestId。

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
- 不会扫描消息字符串内部的密码或 token；拼入 msg/err.message 的内容只有在对应整个字段被配置替换时才会被遮盖。prettyIgnore 只是显示隐藏，不代替脱敏。

### 自定义 Pretty 输出 {#custom-pretty-output}

默认 logger 不提供 messageFormat 模板选项。优先组合 prettySingleLine、prettyIgnore 和 prettyColor；完全自定义格式或转发时使用后文的 setLogger 包装器。

调用 original 才会继续执行默认输出路径。仅返回自定义 info/error 方法不会自动获得默认序列化、级别过滤或脱敏，包装器作者应明确哪些行为仍交给 original。

## requestId 自动注入

默认 logger 在启用请求上下文且当前链有非空 requestId 时自动关联 ID。启动日志、独立任务或关闭 requestContext 后的日志不保证有 ID；pretty 默认还会隐藏其显示。

### 工作原理

```
请求进入 → requestId 中间件生成 ID → 写入 requestContext（AsyncLocalStorage）
                                              ↓
app.logger.info('xxx')  ←  logger mixin 自动读取 requestId
                                              ↓
输出: {"requestId":"abc-123","msg":"xxx"}
```

通过阈值检查后，默认 logger 读取当前 requestContext，再合并用户 mixin 和调用参数。handler、中间件与 Service 只要仍在该请求链中就可共享 ID。

```typescript
app.logger.info("处理请求");
```

当前字段合并顺序是 child bindings → 上下文字段 → 用户 mixin → 单次调用对象；同名普通字段以后者为准。顶层 level/time/msg 不接收结构化对象的同名覆盖。

requestId 的特殊保护仅阻止 **mixin** 覆盖/伪造它；单次调用对象仍能覆盖 requestId，无 ALS 时 child bindings 中也可保留该字段。不要手动设置冲突的 requestId 并期望框架必定改回真实值。详见[请求上下文](/zh/guide/request-context)。

### 性能优化

低于阈值的默认日志调用不执行序列化和 mixin；但调用前构造参数的 JavaScript 表达式已经执行。用户 mixin 必须同步且成本可控，返回 Promise 或抛错会被忽略，并至多尝试警告一次（警告仍受日志阈值影响）。

配置 `requestContext.enabled: false` 会让默认 logger 跳过 ALS 读取；普通 `getStore()` 返回 undefined 时则省略上下文字段。手动 run 中的后台任务仍可能有关联字段。

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

前面的 LogDemoService 已提供完整用法：构造时只绑定静态 service 字段，方法执行时由 logger 读取当前请求上下文，不把某次请求的 store 缓存到成员变量。

不同 child 的顶层 bindings 独立，嵌套 child 的同名字段以后创建者为准；绑定值中的嵌套对象仍可能共享引用，运行时 level controller 也共享。包装器安装前已经保存的 logger 引用不会自动变成新的包装器，应在插件 setup 阶段安装，再加载 Service。

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

Error 可直接传给 error/fatal，也可放在结构化字段中。内置序列化保留 type、message、name、stack；自定义附加字段及 cause 链不会自动完整展开。

```typescript
const err = new Error("example failure");
app.logger.error(err, "操作失败");
app.logger.error({ err, operation: "demo" }, "操作失败");
```

普通 BigInt 转为字符串、循环引用标为 `[Circular]`；对象里的 undefined/function/symbol 不写入，数组中相应位置为 null。日期转换为 ISO。它是日志序列化器，不是任意业务对象的完整存储格式。

### 记录错误上下文

下面的函数明确接收业务操作；由调用方提供 app 和已实现的支付接口，日志行为不会吞掉支付异常：

```typescript
import type { VextApp } from "vextjs";

export async function processPayment(
  app: VextApp,
  charge: (amount: number) => Promise<{ id: string }>,
  orderId: string,
  amount: number,
) {
  try {
    const result = await charge(amount);
    app.logger.info({ orderId, amount, chargeId: result.id }, "支付成功");
    return result;
  } catch (err) {
    app.logger.error({ err, orderId, amount }, "支付失败");
    throw err;
  }
}
```

## 扩展 Logger：setLogger()

在插件 setup 中调用 `app.setLogger(wrapper)`，包装当前 app.logger。它可返回部分方法，未覆盖方法回退到原 logger；多次调用按顺序包裹前一次结果。

### 函数签名

```typescript
import type { VextApp } from "vextjs";

type SetLogger = VextApp["setLogger"];
// (wrapper: (original: VextRuntimeLogger) => VextLoggerLike) => void
```

wrapper 工厂必须同步返回普通对象，所提供的日志成员必须是函数。工厂抛错/结果不合法会让安装失败；**日志方法自己抛出的异常也会向调用方传播**，框架不自动捕获这些异常。

### 自定义 Logger 扩展示例

在上方完整项目新增以下插件，重启后再请求两个接口。这是无需外部 SDK 的完整包装器示例；使用部分方法并省略 child，让框架对新建的 child 重新应用工厂：

```typescript
// src/plugins/logger-bridge.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "logger-bridge",
  setup(app) {
    let calls = 0;
    app.setLogger((original) => ({
      info(...args: unknown[]) {
        calls++;
        (original.info as (...values: unknown[]) => void)(...args);
      },
    }));
    app.onClose(() => {
      app.logger.info({ bridgeInfoCalls: calls }, "logger bridge closing");
    });
  },
});
```

预期：业务 info 仍包含 LogDemoService 和请求 ID，未覆盖的 debug/error 仍可输出；停止时有 bridgeInfoCalls。该计数包括经过包装器的框架 info，不能当作 HTTP 请求数。

### child logger 回退与桥接

省略 child 时，setLogger 的工厂会针对原始 child 再执行，保留其 bindings 并继续包装。工厂因此可能执行多次，不要在工厂里创建连接或注册重复关闭钩子。

显式返回 `child: bindings => original.child(bindings)` 会直接返回未桥接的 child；需要自定义 child 时应包装该 child。若 child 工厂失败，归一化逻辑可退回原始 child。此容错不延伸到普通 info/error 方法。

### 典型用法：桥接到 OpenTelemetry Logs

外部 SDK 的初始化、endpoint、认证、异步队列和关闭刷出由对应集成负责。先按[OpenTelemetry 示例](/zh/examples/opentelemetry)准备运行环境，再实现 wrapper 的转发逻辑；仅调用 setLogger 不会启动 Collector，也不会自动上报。

转发发生在 original 处理之前时，拿到的是原始参数：默认 logger 的阈值、脱敏及格式化不自动作用于 SDK。应在插件中处理转发失败、过滤和字段策略；异步写入不能让同步日志方法遗留未处理的 Promise 拒绝。用 app.onClose 收尾 SDK，默认 logger 的关闭不会替它 flush。

## 日志存储与收集

默认 logger 的所有级别（包括 error/fatal）均写 stdout。进程异常、CLI 或其他库还可能写 stderr；进程管理器通常按流收集，不能把 stderr 文件直接视为「所有 error 级别日志」。

以下保留常见采集路径，属于部署适配示例，依赖各自已安装的组件、权限与网络。持久化、轮转和远端送达需要在实际环境验证，不由 VextJS logger 自动保证。

### 方案概览

| 方案                       | 复杂度 | 适用场景              | 说明                                |
| -------------------------- | :----: | --------------------- | ----------------------------------- |
| **stdout → Cloud 原生**    |   ⭐   | K8s / Cloud Run / ECS | 按平台配置采集 stdout               |
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
│   ├── stderr.log           # stderr 流；不等于 error 级别日志
│   └── access.log           # 仅在采集端另行配置分流时存在
├── src/
└── dist/
```

:::warning
确保 `.gitignore` 中包含 `logs/` 目录，不要将日志文件提交到版本库。
:::

---

### 方案一：stdout → Cloud 原生

VextJS 只输出日志；持久化与查询能力取决于部署平台的日志配置：

| 平台                 | 接入条件                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes           | 容器运行时捕获输出；集群级存储/检索另配采集组件，见[日志架构](https://kubernetes.io/docs/concepts/cluster-administration/logging/)                 |
| AWS ECS              | 为 task 配置 awslogs 等 driver 和相应权限，见[ECS CloudWatch 接入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html) |
| Google Cloud Run     | 容器输出可进入 Cloud Logging，查看与筛选见[Cloud Run 日志](https://docs.cloud.google.com/run/docs/logging)                                         |
| Azure Container Apps | 按环境配置日志目标并查看 console logs，见[应用日志](https://learn.microsoft.com/en-us/azure/container-apps/logging)                                |

验证时发起带明确 requestId 的请求，并在目标平台查到同一条业务日志；本地 stdout 有输出不等于远端采集成功。

### 方案二：PM2 / systemd 文件收集

下面是 Linux 部署片段，需先安装对应进程管理器、完成项目构建，并确保目录存在且运行账户有写权限。Windows 使用 PM2 时替换日志路径；systemd 片段不适用于 Windows。

#### PM2 示例

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "myapp",
      cwd: "/srv/myapp",
      script: "node_modules/vextjs/dist/cli/index.js",
      args: "start",
      error_file: "/var/log/myapp/stderr.log",
      out_file: "/var/log/myapp/app.log",
      env: { NODE_ENV: "production" },
      merge_logs: true,
    },
  ],
};
```

PM2 的 out_file/error_file 按 stdout/stderr 分流。为保持应用 JSON 行，不添加 log_date_format/time 前缀；详见 [PM2 日志配置](https://pm2.keymetrics.io/docs/usage/log-management/)。

#### systemd 示例

```ini
# /etc/systemd/system/myapp.service
[Service]
ExecStart=/usr/bin/node /srv/myapp/node_modules/vextjs/dist/cli/index.js start
WorkingDirectory=/srv/myapp
Environment=NODE_ENV=production
StandardOutput=append:/var/log/myapp/app.log
StandardError=append:/var/log/myapp/stderr.log
Restart=always
```

使用支持 append 输出模式的 systemd，按实际 Node 路径、服务账户和目录权限调整；此处只有 Service 段，不是完整安装/启用步骤。输出语义见 [systemd 官方文档源](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml)。启动后用本页请求确认 app.log 内出现业务 JSON，并检查管理器状态与 stderr。

---

### 方案三：系统级 logrotate（Linux）

已安装 logrotate 并由定时机制调用时，可配置文件轮转。下面的 copytruncate 适用于无法协调写入者重新打开文件的场景，但复制与截断之间可能丢失少量日志，不提供无损保证，见[官方说明](https://github.com/logrotate/logrotate/blob/main/logrotate.8.in)：

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

| 选项            | 说明                                 |
| --------------- | ------------------------------------ |
| `daily`         | 每天轮转                             |
| `rotate 30`     | 保留 30 个历史文件                   |
| `compress`      | 历史文件 gzip 压缩                   |
| `delaycompress` | 最近一个文件不压缩（便于查看）       |
| `copytruncate`  | 复制后截断；并发写入窗口可能丢失日志 |

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

旧 `type: log` 在 Filebeat 7.16 弃用、9.0 禁用，参见[官方迁移说明](https://www.elastic.co/docs/reference/beats/filebeat/filebeat-input-log)。新配置使用 filestream 和 ndjson parser；下方仅是已有 Filebeat 配置的 input 段，output 的地址、认证、TLS、索引/数据流策略按部署环境设置。

```yaml
# 合并到 /etc/filebeat/filebeat.yml
filebeat.inputs:
  - type: filestream
    id: myapp-json
    enabled: true
    paths:
      - /var/log/myapp/app.log
    parsers:
      - ndjson:
          target: vext
          add_error_key: true
    fields:
      app: myapp
      env: production
```

`target: vext` 避免应用字段与采集器元数据冲突。此 parser 要求每条记录为单行 JSON；混入 CLI 文本时会标注解析错误，容器封装还需先解析外层，见[filestream parser 文档](https://www.elastic.co/docs/reference/beats/filebeat/filebeat-input-filestream)。

先运行 Filebeat 自带 `test config` 和 `test output`，再发起本页请求确认实际索引中有 `vext.requestId`、`vext.level`。配置检查通过不代表日志已成功入库；轮转后的文件匹配与去重也需按采集器版本配置。

#### Kibana 索引模式

在 Kibana 为实际写入的索引或数据流建立 [Data View](https://www.elastic.co/docs/explore-analyze/find-and-organize/data-views/create-data-view)，使用与采集映射一致的时间字段；Vext 的 `time` 是 ISO 字符串，若选择它作为时间字段，先在 Elasticsearch 映射中配置为 date。不要把 Filebeat 接收时间自动等同于业务事件时间。

上面选择将应用字段放在 `vext` 下，查询对应改为 `vext.requestId: "log-demo-1"`、`vext.level >= 50`、`vext.service: "LogDemoService"`。若采用别的 target/mapping，查询字段也需同步调整。

### 方案五：Docker → Loki

先在 Docker 主机安装 Loki driver，并准备主机/driver 可访问的 Loki 地址，再配置服务。Compose 服务名 `loki` 不保证能从 driver 所在网络解析；下面使用的 `127.0.0.1:3100` 假设该端口已在 Docker 主机发布。选项和安装前置见[官方 driver 文档](https://grafana.com/docs/loki/latest/send-data/docker-driver/configuration/)。

```yaml
# docker-compose.yml
services:
  app:
    build: .
    logging:
      driver: loki
      options:
        loki-url: "http://127.0.0.1:3100/loki/api/v1/push"
        loki-batch-size: "400000"
        loki-retries: "3"
        loki-external-labels: "app=myapp,env=production"
```

部署前检查 Compose 配置，部署后确认 driver 无发送错误并且 Loki 收到日志；再在已配置 Loki 数据源的 Grafana 查询。batch-size 单位是字节，有限重试不保证送达：

- 按 requestId 查询：`{app="myapp"} |= "abc-123"`
- 按 JSON 字段过滤：`{app="myapp"} | json | level >= 50`

---

### 方案六：app.setLogger 桥接外部 SDK

复用前文包装器模式。SDK 写入器是项目提供的依赖，应在插件 setup 创建一次，在 app.onClose 关闭；包装器工厂只绑定方法。先验证默认 stdout，再检查外部 SDK 的成功/失败、子 logger、过滤和脱敏，最后验证关闭时队列排空。

本页没有提供某个云 SDK 的安装和凭证配置；这些由所选集成文档负责。不要把未定义的 cloudLogger/Sentry 对象当成 VextJS 内置能力。

## 日志与 OpenTelemetry

已配置 tracing SDK 时，可使用同步 mixin 读取当前活跃 span；也可在正确的请求链把字段写入 requestContext，见[请求上下文](/zh/guide/request-context)。

以下是类型完整的配置工厂，`readActiveSpan` 由已经初始化的 SDK 适配器提供。此函数只生成日志配置，不创建 tracing SDK 或 span：

```typescript
import type { VextLoggerConfig } from "vextjs";

export function tracingLoggerConfig(
  readActiveSpan: () => { traceId: string; spanId: string } | undefined,
): VextLoggerConfig {
  return {
    level: "info",
    pretty: false,
    mixin() {
      const span = readActiveSpan();
      return span ? { trace_id: span.traceId, span_id: span.spanId } : {};
    },
  };
}
```

将返回值合并进 config.logger；未采样的 trace 是否仍需日志关联由 SDK 适配器决定，不必将 isRecording 当成唯一条件。mixin 可覆盖 ALS 的 trace_id/span_id，但不能覆盖 requestId；单次日志对象字段优先级更高。完整 SDK 接入继续看[OpenTelemetry 示例](/zh/examples/opentelemetry)。

## VextLogger 接口

公开类型从 `vextjs` 导入，避免复制一份容易失真的接口：

| 类型                | 用途                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| `VextLogger`        | 兼容插件的基础接口；trace/getLevel/setLevel 为可选，child 返回 VextLogger |
| `VextRuntimeLogger` | app.logger 保证的完整接口；上述三个方法必需，child 返回完整运行时接口     |
| `VextLoggerLike`    | setLogger 工厂返回的部分实现，等价于 `Partial<VextLogger>`                |
| `VextLoggerConfig`  | logger 配置字段                                                           |

完整类型用法已见 LogDemoService。公开 app.logger 没有可写 level 属性或公开 flush/close 方法；默认内核收尾由应用生命周期管理，SDK 自有资源仍需插件关闭钩子。

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

上述比较用于确定 Vext 当前边界；Pino 的完整选项以其[官方 API](https://github.com/pinojs/pino/blob/main/docs/api.md)为准。需要额外传输或格式化时，可通过 wrapper 或采集端接入，并分别验证外部路径的行为。

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

例如 `app.logger.info({ userId: "u-1", action: "login" }, "用户登录")`，便于按字段查询；msg 留作描述。错误对象使用 err 字段，不要只拼接错误字符串而丢失堆栈。

### 2. 为每个 Service 创建 Child Logger

参考完整示例，在构造时绑定 service，调用时传业务字段。运行时上下文每次重新读取，避免将单个请求的身份绑定到长期共享 logger。

### 3. 不要在日志中输出敏感信息

按项目的数据策略选择记录字段；如需脱敏，显式配置并验证 JSON、pretty 和外部桥接各条输出路径。内置 redaction 默认关闭，不能依赖字段名自动遮盖。

### 4. 合理使用日志级别

debug 是否输出由当前阈值决定，生产也可以显式开启。error/fatal 都不会自动抛错或终止；需要改变请求结果或关闭进程时调用相应业务/生命周期机制。

### 5. 在生产环境使用 JSON 格式

明确 `pretty: false`，并在采集端解析 JSON；不要在 JSON 行前再拼接时间前缀。CLI 提示和第三方 stdout 内容可能不是 JSON，应配置独立解析或保留解析失败事件。

## 常见问题

| 现象                            | 检查方向                                                     |
| ------------------------------- | ------------------------------------------------------------ |
| debug/trace 没输出              | 当前 getLevel() 阈值；debug 不包含 trace，child 与父共享阈值 |
| requestId 看不到                | prettyIgnore、上下文开关和调用链；手动参数是否覆盖           |
| error.log 没有 app.logger.error | 默认所有级别写 stdout；stderr 文件不按 numeric level 分流    |
| 包装后 child 没有转发           | 是否显式返回了 original.child；是否缓存了安装前的 logger     |
| 日志方法引发请求失败            | wrapper/SDK 是否抛错；普通日志方法没有统一容错               |
| Filebeat JSON 解析失败          | pretty、PM2时间前缀、CLI文本、容器外层封装、输入类型及parser |
| 有 trace_id 却没有 trace        | 字段关联不等于 SDK 已采样、创建span或成功导出                |

## 下一步

- [请求上下文](/zh/guide/request-context)：核对 ID、语言和 tracing 字段的来源。
- [Access Log API](/zh/api/access-log)：配置请求访问日志。
- [部署与生产环境](/zh/guide/deployment)：选择运行与采集方式。
- [OpenTelemetry 接入](/zh/examples/opentelemetry)：准备 SDK 和 Collector。
- [配置](/zh/guide/configuration)：理解环境覆盖和配置校验。

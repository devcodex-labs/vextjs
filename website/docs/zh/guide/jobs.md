# 定时任务 Jobs

Jobs 用于随应用运行的 Cron 定时任务，例如清理过期数据、生成日报或同步业务数据。任务文件负责计划，Service 负责业务；启动应用后，框架自动发现任务并等待未来计划点。

默认启用。一个应用进程和一个内置 Cluster 都无需 Redis；多个独立应用需要共同协调时，再显式配置共享 Jobs Redis。Jobs 不提供任务队列、自动重试、停机补跑或启动立即执行。

## 创建第一个任务

前提：已有能正常启动的 VextJS 应用。在默认目录创建：

```typescript
// src/jobs/heartbeat.ts
import { defineJob } from "vextjs";

export default defineJob({
  cron: "*/5 * * * * *",
  handler({ scheduledAt, logger }) {
    logger.info({ scheduledAt }, "Heartbeat job executed");
  },
});
```

只需必填的 `cron` 和 `handler`，无需补写全局 Jobs 配置。

1. 执行项目已有的开发命令，例如 `npm run dev`。
2. 等待必要初始化完成，检查 Jobs 日志中的 discovered、enabled 数量和协调模式。
3. 等待下一个 5 秒计划点，查看 `Heartbeat job executed` 和框架完成日志。

这里的六字段 Cron 包含秒。任务不会启动即执行；`scheduledAt` 是计划时间，实际开始可能稍晚。HTTP 已监听不等于 Jobs 已激活或 handler 已执行。构建后使用项目已有的 `npm run build`、`npm start`，框架从构建输出发现相应任务。

开发环境也会运行任务；不希望开发机执行业务时，使用后文的[环境开关](#按环境启停与全局配置)。

## 调用 Service 与协作取消

Job 可以直接调用已就绪的 `app.services`。下面两份文件演示完整的 Service 接入，不依赖外部接口或数据库：

```typescript
// src/services/order.ts
import type { VextApp } from "vextjs";

export default class OrderService {
  constructor(private app: VextApp) {}

  async cleanup(signal: AbortSignal) {
    signal.throwIfAborted();
    this.app.logger.info("Order cleanup service invoked");
  }
}
```

这个演示 Service **只记录调用成功，不会删除订单**。在真实项目中，用已有 `order.cleanup()` 的业务实现替换它；数据库操作、事务和业务幂等由 Service 负责。

先按[服务类型生成](/zh/guide/services)执行 `npm exec -- vext typegen`，确保项目生成的类型包含 `app.services.order`，再创建：

```typescript
// src/jobs/order/cleanup.ts
import { defineJob } from "vextjs";

export default defineJob({
  cron: "0 3 * * *",
  timezone: "Asia/Shanghai",
  async handler({ app, signal, scheduledAt, logger }) {
    await app.services.order.cleanup(signal);
    logger.info({ scheduledAt }, "Order cleanup invocation completed");
  },
});
```

此任务每天上海时间 03:00 调用 Service。首次运行仍等待未来计划点；验证接入时可暂用 `*/5 * * * * *`，观察两条业务日志后改回业务计划。

入口检查一次 `signal` 只能取消尚未开始的工作。长任务应在循环及异步步骤之间持续检查，把 `signal` 传给支持取消的 I/O；驱动不支持时使用其原生取消能力。框架无法强行中断忽略取消的函数，也不能撤销已经发生的副作用。

## Job 完整配置

<a id="job-options"></a>

| 字段          | 类型       | 必填 | 默认值                           | 用途与何时配置                                                        |
| ------------- | ---------- | ---- | -------------------------------- | --------------------------------------------------------------------- |
| `name`        | `string`   | 否   | 任务相对路径推导                 | 稳定任务标识；需要 Redis 协调的任务建议显式设置，避免移动文件改变身份 |
| `description` | `string`   | 否   | 无                               | 业务用途描述，也是文档摘要/描述的回退                                 |
| `tags`        | `string[]` | 否   | 无                               | 文档分类和检索，与 `docs.tags` 合并去重                               |
| `docs`        | `object`   | 否   | 无                               | 文档元数据，见下表；不影响调度                                        |
| `enabled`     | `boolean`  | 否   | `true`                           | 单任务开关；关闭后仍导入模块、校验定义并检查重名                      |
| `cron`        | `string`   | 是   | 无                               | 显式 Cron 计划，支持 5/6/7 字段及下述宏；没有默认表达式               |
| `timezone`    | `string`   | 否   | `jobs.timezone` 或 `UTC`         | 任务业务时区，必须是有效 IANA 时区                                    |
| `leaseTtl`    | `number`   | 否   | `jobs.redis.leaseTtl` 或 `30000` | Redis 租约毫秒数，安全整数且至少 `1000`；Local/IPC 中不使用但仍校验   |
| `handler`     | `function` | 是   | 无                               | 同步或异步业务入口，返回值不保存；异常记录后等待未来周期，不自动重试  |

<a id="job-docs"></a>

| 字段               | 类型       | 默认值 | 文档用途                                             |
| ------------------ | ---------- | ------ | ---------------------------------------------------- |
| `docs.summary`     | `string`   | 无     | 摘要回退值，JSDoc 摘要优先                           |
| `docs.description` | `string`   | 无     | 文档描述，优先于顶层 `description`，JSDoc 描述仍优先 |
| `docs.tags`        | `string[]` | 无     | 与顶层 `tags` 和 `jobs` 分类合并去重                 |

例如，以下是**替换上面任务文件**的完整配置，不是在同一文件追加第二个 Job。它依赖已注册的 `order` Service：

```typescript
// src/jobs/order/cleanup.ts
import { defineJob } from "vextjs";

export default defineJob({
  name: "order.cleanup",
  description: "清理过期订单",
  tags: ["orders"],
  docs: {
    summary: "订单定期清理",
    description: "调用 order Service 的清理业务",
    tags: ["maintenance"],
  },
  enabled: true,
  cron: "0 3 * * *",
  timezone: "Asia/Shanghai",
  leaseTtl: 60_000,
  async handler({ app, signal }) {
    await app.services.order.cleanup(signal);
  },
});
```

`leaseTtl` 不是 handler 超时：Redis 模式执行期间会续租，任务可以运行超过 TTL。任务级值覆盖全局 Redis TTL；只在需要区别于默认租约策略时设置。

### handler 上下文

<a id="job-context"></a>

| 字段          | 含义与用法                                                                      |
| ------------- | ------------------------------------------------------------------------------- |
| `app`         | 已就绪的应用，访问 `app.services` 和插件扩展；没有 HTTP 的 `req/res` 或当前用户 |
| `name`        | 加载后有效任务名，可用于日志或业务标识                                          |
| `scheduledAt` | 当前计划点的 `Date`，不是实际开始时间；可用于延迟监控或业务幂等键               |
| `signal`      | 应用关闭、协调失效等情况下请求协作取消；长任务持续检查                          |
| `logger`      | 应用 logger；框架还会独立记录任务状态和耗时                                     |

## cron 与时区

### cron 表达式

| 格式   | 字段顺序                     | 示例与含义                                                |
| ------ | ---------------------------- | --------------------------------------------------------- |
| 五字段 | 分、时、日、月、星期         | `0 3 * * *`：每天 03:00；`*/5 * * * *`：每五分钟          |
| 每分钟 | 五字段                       | `* * * * *`：每分钟第 0 秒                                |
| 六字段 | 秒、分、时、日、月、星期     | `*/5 * * * * *`：每五秒；`0 */5 * * * *`：每五分钟第 0 秒 |
| 七字段 | 秒、分、时、日、月、星期、年 | `0 0 9 1 1 * 2027`：2027 年 1 月 1 日 09:00               |
| 工作日 | 五字段，星期 1–5             | `0 9 * * 1-5`：周一至周五 09:00                           |

支持 `@yearly`、`@annually`、`@monthly`、`@weekly`、`@daily`、`@midnight`、`@hourly`；`@daily` 表示有效时区的每天午夜。日历扩展由所安装 Croner 解析，例如 `0 0 L * *`（每月最后一天）、`0 0 1W * *`（最接近每月 1 日的工作日）、`0 9 * * MON#2`（每月第二个周一）。工作日表达式不包含节假日日历。

**日期与星期同时填写时，默认 OR。** `0 0 1 * MON` 匹配每月 1 日或周一；`0 0 1 * +MON` 使用显式 `+` 表示同时满足。以 UTC 的 2026 年 1 月 2 日为起点，前者下次为 1 月 5 日，后者为 6 月 1 日。

时区优先级为 **Job.timezone > jobs.timezone > UTC**。`Asia/Shanghai` 的 09:00 对应 UTC 01:00；日志 ISO 时间中的 `Z` 表示 UTC。

夏令时可能使本地时刻缺失或重复，实际计划由所用 Croner 计算。当前依赖中，纽约 `30 1 * * *` 从 `2026-11-01T05:29:59Z` 计算得到 `05:30Z`，下一点为次日 `06:30Z`，不会当日再执行第二次 01:30。春季 `30 2 * * *` 从 `2026-03-07T08:00Z` 计算得到次日 `07:30Z`（当地 03:30），从 `2026-03-08T07:00Z` 计算则得到次日 `06:30Z`。涉及 DST 的业务应验证地区、起点和边界日期；需要固定绝对时间可选 UTC。

### 计划类别与未来点

只接受 Cron 字符串，拒绝 `interval`、Date 和 ISO 一次性日期，不提供毫秒固定间隔。启用任务在准备和实际激活时都必须有严格未来点；有限年份计划执行完最后一点后自然停止。关闭任务仍校验 Cron 语法，但无需未来点。

例如每分钟任务在 12:00:20 就绪，等待 12:01:00；正好在 12:01:00 就绪则等待 12:02:00。已经注册的 12:01 点稍晚到 12:01:02、仍未跨下一窗口时可执行；跨周期则跳过。启动、重启、故障恢复和 onReady 等待期间经过的历史点均不补跑。

## 发现、导出与名称

任务目录只需要真实的任务文件，例如：

```text
src/jobs/
├── heartbeat.ts          → heartbeat
└── order/
    ├── cleanup.ts        → order.cleanup
    └── daily-summary.ts  → order.daily-summary
```

默认递归扫描 `.ts/.js/.mjs/.cjs/.mts/.cts`。每个选中文件恰有一个默认 `defineJob()`；普通 helper、类型、常量可以共存，业务辅助模块通常放在任务目录外。

忽略规则单独说明：下划线开头的**文件名**、声明文件、`.test/.spec` 模块不会被选中；下划线目录本身不自动忽略，`.tsx/.jsx` 也不在默认包含范围。

显式 `name` 优先，否则按相对任务目录的路径去扩展名、去末尾 `/index`、把路径分隔符转为点；根 `index.ts` 名为 `index`，`order/index.ts` 名为 `order`。不会把 kebab-case 转为 camelCase。名称允许 ASCII 字母、数字及 `_ . : -`，必须非空、全局唯一；关闭定义也参与重名检查。

<a id="允许与拒绝的声明样例"></a>

一个文件不能通过多个命名 Job 注册多个任务，也不能返回任务数组或用工厂隐藏默认声明。普通辅助导出允许。JavaScript/ESM 同样默认导出；CommonJS 使用等价形式：

```javascript
// src/jobs/heartbeat.cjs — 用于 CommonJS 项目，不与上面的 TS 文件并存
const { defineJob } = require("vextjs");
module.exports = defineJob({
  cron: "*/5 * * * * *",
  handler({ logger }) {
    logger.info("Heartbeat job executed");
  },
});
```

有限的相对默认转导出、默认别名及其他精确声明约束见 [API 的定义规则](/zh/api/jobs#定义规则)。业务放在 handler 中，不要在模块顶层执行业务或私建定时器。

### 自定义目录与过滤

把配置片段合并到已有 `src/config/default.ts`：

```typescript
export default {
  jobs: {
    dir: "tasks",
    include: ["**/*.{ts,js,mjs,cjs,mts,cts}"],
    exclude: ["experiments/**"],
  },
};
```

`dir` 相对 `src`，此例发现 `src/tasks/**`，构建后对应输出根下的 `tasks`。不要写 `src/tasks`、绝对路径或 `..`。`include` **替换**默认包含，`exclude` 在内置忽略上**追加**排除。它们匹配实际文件名，不会把 `**/*.ts` 自动改成生产的 `.js`；需要同时匹配源码与输出时包含两者。`include: []` 不发现任务。

## 按环境启停与全局配置

<a id="jobs-options"></a>

| 参数            | 类型       | 默认值                             | 配置作用                                                |
| --------------- | ---------- | ---------------------------------- | ------------------------------------------------------- |
| `jobs.enabled`  | `boolean`  | `true`                             | 关闭整个应用的任务发现和调度；配置结构仍校验            |
| `jobs.dir`      | `string`   | `"jobs"`                           | 相对 `src` 的目录，递归扫描；不能越出项目边界           |
| `jobs.include`  | `string[]` | `["**/*.{ts,js,mjs,cjs,mts,cts}"]` | 替换默认匹配，兼顾生产输出扩展；空数组无任务            |
| `jobs.exclude`  | `string[]` | `[]`                               | 追加排除，无法重新纳入内置忽略文件                      |
| `jobs.timezone` | `string`   | `"UTC"`                            | 多数任务共用的有效 IANA 时区，单任务可覆盖              |
| `jobs.redis`    | `object`   | 不配置                             | 显式开启共享 Redis 协调；未配置时按部署方式用 Local/IPC |

完整配置可以写成下面的**配置片段**，合并到项目现有配置；通常只需设置与默认值不同的字段：

```typescript
// src/config/default.ts
export default {
  jobs: {
    enabled: true,
    dir: "jobs",
    include: ["**/*.{ts,js,mjs,cjs,mts,cts}"],
    exclude: ["experiments/**"],
    timezone: "Asia/Shanghai",
  },
};
```

开发机整体关闭：

```typescript
// src/config/development.ts
export default { jobs: { enabled: false } };
```

只关闭一个任务，在其定义中设置 `enabled: false`。全局关闭跳过任务发现和模块导入；单任务关闭仍导入、校验定义、TTL 和名称。两者都不跳过配置合法性校验。配置按现有 [profile 合并规则](/zh/guide/configuration)生效，开发覆盖不会自动关闭生产任务。

## 选择部署方式

| 部署方式                               | 最少配置                                  | 协调范围                                           |
| -------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| 一个应用进程                           | 不配置 Redis                              | 当前进程内，同名任务不重叠                         |
| 一个内置 Cluster                       | 配置 `cluster` 即可                       | 当前 Master 管理的 Worker 自动通过 Master IPC 协调 |
| 多个独立进程、PM2 应用、容器或多机副本 | 需要共享协调时，每副本显式配置 Jobs Redis | 同一 Redis 目标、有效前缀及任务身份                |

例如一个内置 Cluster 开启 4 个 Worker：

```typescript
// src/config/production.ts — 合并到现有配置
export default {
  cluster: { enabled: true, workers: 4 },
  jobs: { timezone: "Asia/Shanghai" },
};
```

不需要 Redis、Worker ID 或内部 IPC 配置。所有 Worker 完成必要初始化，Master 核对实际就绪集合的任务定义后，逐个激活 Jobs；每个 Worker 获得激活后才允许调度。Master 收齐有效激活确认后报告整体就绪，单个已激活 Worker 可能更早注册 Timer。任务清单不一致或启动失败时按错误排查，不会降级为各 Worker 独立执行。

### 多个独立副本共享 Redis

多个容器各自运行一个内置 Cluster，仍属于多个独立应用，需要共享协调时使用 Redis。把以下片段合并到每个副本的配置：

```typescript
// src/config/production.ts
export default {
  jobs: {
    redis: { url: process.env.VEXT_REDIS_URL },
  },
};
```

在各副本启动环境中设置指向同一实际共享服务的 `VEXT_REDIS_URL`，例如 `redis://redis.internal:6379/0`；`redis.internal` 是示意主机名，替换为实际地址。`127.0.0.1` 仅适合同一台机器的测试，不能表示不同主机共用 Redis。框架不因存在环境变量就自动开启 Redis；需要显式 `jobs.redis` 对象。已有环境 URL 时，也可使用：

```typescript
export default { jobs: { redis: {} } };
```

<a id="redis-options"></a>

| 参数                   | 类型             | 默认值/优先级                       | 配置作用与适用情况                                         |
| ---------------------- | ---------------- | ----------------------------------- | ---------------------------------------------------------- |
| `jobs.redis.client`    | ioredis 兼容对象 | 无，优先于地址                      | 接入调用方管理的客户端；调用方负责连接选项、错误处理和关闭 |
| `jobs.redis.url`       | `string`         | 无，高于 `uri` 与环境变量           | 常用 Redis URL；Jobs 创建并关闭连接                        |
| `jobs.redis.uri`       | `string`         | 无，低于 `url`                      | URL 别名，通常只填一种                                     |
| `jobs.redis.namespace` | `string`         | 根据项目包名、profile、运行模式生成 | 同一应用副本通常省略；共用 Redis 的不同业务需隔离时设置    |
| `jobs.redis.keyPrefix` | `string`         | 根据 namespace 生成                 | 完整逻辑前缀覆盖，优先于 namespace；通常不必填写           |
| `jobs.redis.leaseTtl`  | `number`         | `30000` 毫秒                        | Redis 默认运行租约，可由任务覆盖；安全整数且至少 `1000`    |

连接优先级为 **client > url > uri > VEXT_REDIS_URL > REDIS_URL**。无效 `client` 不回退 URL；显式空 `url` 不会继续取环境变量。有启用任务但没有可用 Redis 地址/客户端，或连接初始化失败时拒绝启动。

默认 namespace 组合包名、`VEXT_CONFIG`（缺省 `default`）和 `NODE_ENV`（缺省 `production`），标准 CLI 提供 profile/运行模式；默认逻辑前缀为 `vext:<namespace>:job:`。自动值适合同一应用的普通副本，不需要到处配置。不同包名、profile 或运行模式默认隔离；如果有意让不同项目共享任务协调，可显式设置同一 namespace：

```typescript
// 两个应用均需设置相同的真实 Redis 地址及稳定任务名/定义
export default {
  jobs: {
    redis: {
      url: process.env.VEXT_REDIS_URL,
      namespace: "billing-production",
      leaseTtl: 30_000,
    },
  },
};
```

同一协调域中的副本须保持 Redis 目标、有效前缀、任务名、Cron、有效时区和 TTL 一致。移动任务文件、改变任务名/namespace/keyPrefix 会改变身份，混合部署可能两边都执行。Jobs 不自动复用 cache、Session 或限流的 Redis 配置。传入客户端、Redis Cluster、权限和旧键运维见[进阶部署](/zh/guide/deployment#jobs-使用已有客户端或-redis-cluster)。

### 调整单个任务的租约

有效租约优先级为 **Job.leaseTtl > jobs.redis.leaseTtl > 30000 ms**。在已有任务定义中设置 `leaseTtl: 60_000` 即覆盖上例全局的 30 秒；未设置的任务继续继承。无需为调整 TTL 修改任务名或 Redis 前缀。

执行期间自动续租，长任务不必将 TTL 设成全部执行时长。Local/IPC 模式不使用 Redis TTL，但仍要求字段合法。TTL 不能用来强制结束任务；`shutdown.timeout` 是**秒**，表示整个应用共享的关闭预算，也不是每个 Job 各自的执行超时。

## 重叠、失败与关闭

| 情况                            | 框架行为与业务处理                                                         |
| ------------------------------- | -------------------------------------------------------------------------- |
| 上次同名任务未结束              | 跳过本次点，不排队；其他任务仍可并行                                       |
| handler 抛异常                  | 记录失败，后续未来周期继续；不自动重试                                     |
| 跨周期延迟、停机                | 跳过旧点，只考虑未来点，不补跑                                             |
| Redis 申请资格失败              | 跳过该点，不降级；未失租的健康实例可尝试未来点                             |
| Redis 续租失败、过晚或到期      | 该 Worker 停止全部新任务、请求取消并关闭/替换；重连不恢复原 Worker 的资格  |
| 应用关闭                        | 先停止触发与新准入，再请求取消、在共享预算内等待，最后清理协调器及业务依赖 |
| 内置 Cluster 的 Master 通道丢失 | 停止新任务并请求取消、关闭，不退回 Local                                   |

同一健康协调域里，同名任务同一计划点最多取得一次执行资格。取得资格后崩溃可能漏掉这次工作，快速完成或租约过期不会把已消费点变成可重新执行的任务。内置 IPC 状态不跨新的 Master 持久化；网络分区、Redis 状态丢失或业务忽略取消也不能保证副作用恰好一次。关键业务使用唯一键、事务等幂等措施；可靠投递、历史和进度由业务存储或独立队列承担。

存在启用 Jobs 时，必要 `onReady` 失败会阻止启动并清理，避免任务调用未就绪依赖；无启用 Jobs 时保持原有日志隔离。观察性的 `app:ready` 回调不等同于必要初始化。开发中任务文件及已加载的相关依赖改变会冷重启，旧调度器先关闭，自定义任务目录也遵循此规则。

## 查看任务文档

应用已开启项目文档时，启动后直接访问 `/docs` 的 Jobs 分组；Jobs 文档源默认开启，不用再配置 `openapi.docs.code.jobs: true`。扫描范围默认逐字段继承 `jobs.dir/include/exclude`。

只关闭 Jobs 文档，将以下片段合并到现有配置：

```typescript
export default {
  openapi: { docs: { code: { jobs: false } } },
};
```

可选地改变文档扫描目录，不改变实际任务发现或执行资格：

```typescript
export default {
  openapi: {
    docs: { code: { jobs: { dir: "documented-jobs" } } },
  },
};
```

这个例子仅覆盖文档 `dir`，`include/exclude` 仍分别继承运行时配置。禁用任务可以展示，动态未知值保留未知，静态条目始终不证明已启动、已连接或已执行（`runtimeVerified: false`）。

摘要依次取 JSDoc 摘要、`docs.summary`、`docs.description`、`description`、默认摘要；描述取 JSDoc 描述、`docs.description`、`description`。标签合并顶层 `tags`、`docs.tags` 和 `jobs`。MCP 检查及 Recipe 同样只提供静态证据，生成任务必须显式提供 Cron；MCP 不运行 handler 或启动定时器。完整文档源字段见 [API](/zh/api/jobs#任务文档配置)。

## 测试与观察

测试调度逻辑时，使用受控时钟而非等待真实时间：

```typescript
import assert from "node:assert/strict";
import { defineJob } from "vextjs";
import { createTestJobScheduler } from "vextjs/testing";

let executions = 0;
const scheduler = await createTestJobScheduler({
  now: new Date("2026-01-01T00:00:00Z"),
  jobs: {
    heartbeat: defineJob({
      cron: "* * * * * *",
      handler() {
        executions += 1;
      },
    }),
  },
});
try {
  await scheduler.tick(new Date("2026-01-01T00:00:01Z"));
  assert.equal(executions, 1);
} finally {
  await scheduler.close();
}
```

helper 显式接收定义和初始时钟，只通过 `tick()` 驱动，不扫描项目任务、不创建真实 Timer；普通 `createTestApp()` 也不自动加载 Jobs。完整选项见[测试 API](/zh/api/testing-api#createtestjobscheduler)。

然后用项目实际启动方式验证至少一个未来计划点。一个内置 Cluster 的 IPC 需要真实 Master/Worker 验证；独立副本共享 Redis 需要真实 Redis 集成验证，helper 不能替代它们。用真实 Redis 时使用真实计划时间，不用 1970 年的受控时钟申请资格。

启动日志包含发现/启用/禁用数量和 mode；执行日志包含 name、scheduledAt、PID/Worker、startedAt、duration、status 和 skipReason。`nextRunAt` 只是按当前配置计算的下一计划时间，不承诺必然执行。Redis 时钟偏差诊断给出 RTT 与偏差区间，不会修改系统时钟；各副本仍应保持时钟同步。

## 故障排查

| 现象                             | 检查与处理                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------- |
| 没有发现任务                     | 检查 `jobs.enabled`、相对 `src` 的目录、include/exclude 和生产实际扩展名      |
| 任务发现但一直未运行             | 检查单任务开关、Cron/时区、是否尚未到未来点、必要初始化和 Worker 激活错误     |
| 单个内置 Cluster 要求填写 Redis  | Jobs 本身不要求；核对是否显式设置了 `jobs.redis` 或实际存在多个独立应用       |
| 独立副本重复执行                 | 检查共享 Redis/有效前缀、稳定任务名、profile/运行模式，以及是否存在混合旧定义 |
| 长任务某些点没有执行             | 同名重叠会跳过；TTL 自动续租，不是任务执行时限                                |
| Redis 故障后 Worker 不再接受任务 | 若已失租，应完成关闭/替换或重启；单纯重连不恢复原资格                         |
| 静态 Docs/MCP 只有 unknown       | 简化为可识别默认定义，检查依赖与动态字段；不要把静态未知解释成实际失败或成功  |
| 改了 Job 却仍运行旧逻辑          | 确认开发冷重启完成；生产重新构建并按实际部署方式替换进程                      |

进一步查阅 [API](/zh/api/jobs)、[执行契约](/zh/specification/jobs)、[部署](/zh/guide/deployment)和[测试](/zh/guide/testing#测试-jobs)。

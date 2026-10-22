# 定时任务 Jobs

Jobs 用于随应用运行的定时工作，例如清理过期数据、刷新统计、同步业务数据。你在任务目录创建文件，写明 Cron，再在 handler 中调用已有 Service；不需要单独启动调度器。

默认启用，单个应用进程和一个内置 Cluster 都无需 Redis。多个独立应用副本需要共同协调时，再配置共享 Redis。Jobs 不提供任务队列、自动重试、停机补跑或启动立即执行。

本页按创建、业务调用、配置、部署和排错介绍使用方式。完整字段见 [Jobs API](/zh/api/jobs)，执行保证与限制见[定时任务契约](/zh/specification/jobs)。

## 创建第一个任务

前提：已有能正常启动的 VextJS 应用。在默认目录创建文件：

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

只需必填的 `cron` 和 `handler`，无需新增全局 Jobs 配置。此例用于确认调度已运行；生产业务放在后文的 Service。

1. 使用应用已有的开发启动脚本，例如已经定义 dev 脚本时执行 `npm run dev`。
2. 等待应用完成必要初始化，查看 Jobs 激活信息中的 discovered、enabled 数量。
3. 等待下一个 5 秒计划点，查看 `Heartbeat job executed` 与框架执行结果日志。

这里的六字段 Cron 包含秒。任务等待**下一个未来点**，不会启动即执行；`scheduledAt` 表示计划时间，不是 handler 实际开始时间。启动失败时先修正报错，不以 HTTP 可访问代替任务已就绪。

开发环境也会执行任务。如果不希望开发机运行真实业务任务，使用[按环境启停](#按环境启停与全局配置)中的全局开关。构建后按应用已有的 build/start 脚本运行，任务目录映射到构建输出根。

## 发现、导出与名称

默认目录与名称示例：

```text
src/jobs/
├── heartbeat.ts            → heartbeat
├── cleanup.mjs             → cleanup
├── _helpers.ts             → 忽略
├── types.d.ts              → 忽略
├── cleanup.test.ts         → 忽略
├── _internal/task.ts       → _internal.task（目录不被忽略）
└── billing/
    ├── close-invoice.ts    → billing.close-invoice
    └── index.ts           → billing
```

默认扫描 `.ts/.js/.mjs/.cjs/.mts/.cts`，忽略下划线开头的**文件名**、声明文件及 `.test/.spec` 文件；默认不扫描 `.tsx/.jsx`。名称按相对任务目录的文件路径去扩展名、去末尾 `/index`、把 `/` 转为 `.`；根 `index.ts` 对应 `index`。它不会像 Service 那样把 kebab-case 转为 camelCase。

每个选中文件仅导出一个默认任务；普通 helper、类型和常量可以共存：

```typescript
// src/jobs/billing/index.ts
import { defineJob } from "vextjs";

export default defineJob({ cron: "* * * * *", handler() {} });
export function helper(value: number) {
  return value + 1;
}
```

以上名称为 `billing`。`name` 覆盖推导名称，允许 ASCII 字母、数字与 `_ . : -`，必须非空且全局唯一；关闭的定义也参与冲突检查。为需要 Redis 协调的业务设置稳定名称，可避免移动文件改变身份。其他任务使用独立文件。

JavaScript/ESM 使用相同导出方式；原生 CommonJS 可写成：

```javascript
// src/jobs/cleanup.cjs
const { defineJob } = require("vextjs");
module.exports = defineJob({ cron: "* * * * *", handler() {} });
// 普通本地 helper 可以共存；exports.daily = defineJob(...) 会被拒绝。
```

允许项目源码内的有限相对默认转导出，入口和被引用的定义文件都需要符合声明规则：

```typescript
// src/jobs/report.ts
export { default } from "../job-definitions/report.js";
```

```typescript
// src/job-definitions/report.ts
import { defineJob } from "vextjs";

export default defineJob({ cron: "0 9 * * *", handler() {} });
```

定义文件位于任务发现目录外，因此不会被重复当作独立任务。依赖缺失、循环引用或越出允许的项目源码范围时，应修正声明后重新启动；不要用动态导出或工厂隐藏任务来源。

每个被选中的文件恰有一个默认 `defineJob()`；普通对象、仅命名导出、数组及不透明默认工厂拒绝启动。把纯辅助模块放在 Jobs 目录外或用 `_helpers.ts`。`enabled: false` 仍校验字段、TTL、任务声明数量和重名，只免除调度与未来点要求。全局 `jobs.enabled: false` 跳过发现。业务调用放在handler中，避免导入任务文件时就执行业务；不要另外创建自己的定时器。

### 允许与拒绝的声明样例

允许动态字段，前提是默认任务声明形式明确。下面是一个完整文件，缺省环境变量时每分钟执行：

```typescript
// src/jobs/report.ts
import { defineJob as task } from "vextjs";

const report = task({
  cron: process.env.REPORT_CRON ?? "* * * * *",
  handler({ logger }) {
    logger.info("Report job executed");
  },
});
const alias = report;
export default alias;
```

SDK namespace 调用也允许，例如下面这个独立文件：

```typescript
// src/jobs/heartbeat.ts
import * as sdk from "vextjs";

export default sdk.defineJob({
  cron: "*/5 * * * * *",
  handler() {},
});
```

以下每个代码块是**独立的拒绝例**，不要合并到同一文件。拒绝与普通动态字段不同：它们使默认声明形式不明确，或者出现额外任务声明。

工厂返回任务不属于允许的默认声明形式：

```typescript
// src/jobs/factory.ts — 拒绝
import { defineJob } from "vextjs";

function makeJob() {
  return defineJob({ cron: "* * * * *", handler() {} });
}
export default makeJob();
```

同一任务再作命名导出会被拒绝；普通命名 helper 仍然允许：

```typescript
// src/jobs/alias.ts — 拒绝
import { defineJob } from "vextjs";

const job = defineJob({ cron: "* * * * *", handler() {} });
export { job };
export default job;
```

未调用函数中的第二处 SDK 声明也会计数：

```typescript
// src/jobs/extra.ts — 拒绝
import { defineJob } from "vextjs";

export default defineJob({ cron: "* * * * *", handler() {} });
function unused() {
  return defineJob({ cron: "* * * * *", handler() {} });
}
```

条件选择默认任务、数组、普通对象、named-only Job、用户 getter/Proxy 及后续改变导出也不支持。推荐始终采用直接默认声明或上述不可变别名，把变化保留在 cron、enabled 等字段值中。字段值仍会在启动时校验。

### 自定义目录与过滤

```typescript
// 合并到 src/config/default.ts
import type { VextUserConfig } from "vextjs";
export default {
  jobs: {
    dir: "tasks",
    include: ["**/*.{ts,js,mts,mjs,cts,cjs}"],
    exclude: ["experiments/**"],
    timezone: "UTC",
  },
} satisfies VextUserConfig;
```

`dir: "tasks"` 对应 `src/tasks`，生产映射为编译根下的 `tasks`，例如 `dist/tasks`。不要加 `src/` 前缀、绝对路径或 `..`。`include` 替换默认规则，`exclude` 追加到内置忽略规则；匹配基准为任务目录。`include: []` 表示不发现任务。

**过滤器匹配实际文件，不随编译自动转换。** `include: ["**/*.ts"]` 能发现源码，却会漏掉构建后的 `task.js`。使用 `**/*.{ts,js}` 等包含实际输出扩展的规则，或保留默认值；部署前检查实际构建输出。

## 调用 Service 与协作取消

下面示例定期遍历多个远端端点，更新当前进程的 Service 内存快照。外部接口约定为 JSON `{ "status": "..." }`；启动前设置 `STATUS_ENDPOINTS` 为以逗号分隔的实际 URL。这个快照不会在重启后保留，也不会自动共享给其他 Worker。生产业务需要共享或持久化结果时，在 Service 内接入项目自己的数据层，Job 只负责调用该 Service。

```typescript
// src/services/remote-status.ts
import type { VextApp } from "vextjs";

export default class RemoteStatusService {
  private latest = new Map<string, string>();
  constructor(private app: VextApp) {}

  async refresh(signal: AbortSignal) {
    const endpoints = (process.env.STATUS_ENDPOINTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!endpoints.length) throw new Error("Set STATUS_ENDPOINTS");
    for (const endpoint of endpoints) {
      signal.throwIfAborted();
      const response = await fetch(endpoint, { signal });
      if (!response.ok) throw new Error(`Status HTTP ${response.status}`);
      const result: unknown = await response.json();
      signal.throwIfAborted();
      if (
        !result ||
        typeof result !== "object" ||
        !("status" in result) ||
        typeof result.status !== "string"
      ) {
        throw new Error("Invalid status response");
      }
      this.latest.set(endpoint, result.status);
    }
    this.app.logger.info(
      { count: this.latest.size },
      "Remote statuses refreshed",
    );
    return this.latest.size;
  }

  snapshot() {
    return Object.fromEntries(this.latest);
  }
}
```

按[服务类型生成](/zh/guide/services)运行 `npm exec -- vext typegen`，使 `app.services.remoteStatus` 获得项目生成的类型，再添加：

```typescript
// src/jobs/refresh-status.ts
import { defineJob } from "vextjs";

export default defineJob({
  name: "refresh-status",
  cron: "* * * * *",
  async handler({ app, signal, scheduledAt, logger }) {
    const count = await app.services.remoteStatus.refresh(signal);
    logger.info({ count, scheduledAt }, "Status refresh completed");
  },
});
```

Job 上下文包含 `app/name/scheduledAt/signal/logger`，没有 `req/res` 或当前用户。`scheduledAt` 是计划点而非实际开始时间；返回值不会形成运行记录。HTTP 路由也可复用这个 Service，但需要由路由处理请求参数及响应。

单个端点请求失败会结束本轮，已经更新的快照不会回滚；下一未来周期重新遍历端点，没有自动重试。示例返回当前缓存条目数，不代表一次原子批量更新。需要事务、检查点或逐项失败记录时，应由业务Service实现。

**入口检查一次 signal 不能让整个长任务支持取消。** 在批处理循环中持续检查，把 signal 传给支持它的网络/流式 I/O，并在异步步骤后检查。驱动不支持取消时应使用其原生取消/超时能力或缩小工作批次；框架无法强行中断忽略 signal 的函数。重要副作用应以业务唯一键或事务实现幂等，不将 Redis 调度去重等同业务幂等。

## cron 与时区

### cron 表达式

```typescript
import { defineJob } from "vextjs";
export default defineJob({
  name: "daily-summary",
  cron: "0 9 * * *",
  timezone: "Asia/Shanghai",
  async handler({ scheduledAt, signal, logger }) {
    signal.throwIfAborted();
    logger.info({ scheduledAt }, "daily summary");
  },
});
```

| 格式   | 字段顺序                     | 例子                                                         |
| ------ | ---------------------------- | ------------------------------------------------------------ |
| 五字段 | 分、时、日、月、星期         | `0 9 * * *`：每天 09:00                                      |
| 六字段 | 秒、分、时、日、月、星期     | `0 */5 * * * *`：每五分钟第 0 秒；`*/30 * * * * *`：每半分钟 |
| 七字段 | 秒、分、时、日、月、星期、年 | `0 0 9 1 1 * 2027`：2027年1月1日09:00                        |
| 工作日 | 五字段，星期 1–5             | `0 9 * * 1-5`：周一至周五 09:00                              |

五字段没有秒；七字段最后一项是年份。支持 `@yearly`、`@annually`、`@monthly`、`@weekly`、`@daily`、`@midnight`、`@hourly`；例如 `@daily` 表示所用时区每天午夜。范围、列表、步长等合法扩展由当前 Croner 解析，不能把一次性 ISO 时间当作 Cron。

常用日历扩展包括 `0 0 L * *`（每月最后一天午夜）、`0 0 1W * *`（靠近每月1日的工作日）、`0 9 * * MON#2`（每月第二个周一09:00）。这些表达式仍按有效时区计算；发布前核对下一计划点，避免把工作日规则当成节假日日历。

**同时填写日期和星期时，默认按 OR 匹配。** `0 0 1 * MON` 是每月1日或每周一的午夜；如果只想在“恰逢周一的每月1日”执行，使用 `0 0 1 * +MON`，以 `+` 明确 AND。以UTC、2026年1月2日为计算起点，前者下次为1月5日，后者为6月1日；不要把普通星期字段误读成同时满足。

cron 由 Croner 解析；完整扩展语法以所安装 Croner 版本为准。时区优先级为 **任务 `timezone` > `jobs.timezone` > `UTC`**，必须是有效 IANA 时区。`Asia/Shanghai` 的 09:00 对应 UTC 01:00；日志中的 ISO 时间含 `Z`，应按时区换算。

夏令时会产生不存在或重复的本地时间，由 Croner 计算。当前依赖下，在 `America/New_York` 为 `30 1 * * *` 从 `2026-11-01T05:29:59Z` 计算得到 `05:30Z`，再从该点计算得到次日 `06:30Z`，不是当日重复的第二次 01:30。春季缺失时间也受计算起点影响：`30 2 * * *` 从 `2026-03-07T08:00Z` 得到次日 `07:30Z`（当地 03:30），而从 `2026-03-08T07:00Z` 计算则得到次日 `06:30Z`。需要稳定绝对时间时选 UTC；涉及本地时间的业务应为所用地区和边界日期验证计划点，不能假定每个自然日都恰好一次。

### 计划类别与未来点

只接受五、六、七字段 Cron，或 `@yearly/@annually/@monthly/@weekly/@daily/@midnight/@hourly`。拒绝 interval、Date 和 ISO 日期字符串。七字段可使用固定年份；启用任务在准备与实际激活时都要有严格未来点，最后一个计划点执行后自然停止。关闭的任务仍须语法合法。

例如每分钟 Cron 在 12:00:20 就绪后等待 12:01:00，正好在 12:01:00 就绪则等待 12:02:00。已注册的 12:01 触发稍晚到 12:01:02、未跨下一周期时可以执行；跨周期则跳过。启动、重启和停机恢复只选择未来点；onReady 期间经过的点不补跑。

## 按环境启停与全局配置

全局配置写在已有配置文件的 jobs 属性中。默认值适合标准目录；通常只需要补充业务时区：

```typescript
// src/config/default.ts — 合并到已有配置
export default { jobs: { timezone: "Asia/Shanghai" } };
```

| 参数          | 默认值            | 何时设置                      |
| ------------- | ----------------- | ----------------------------- |
| jobs.enabled  | true              | 整个应用不运行任务            |
| jobs.dir      | jobs              | 改变任务源码目录，路径相对src |
| jobs.include  | 六种JS/TS模块扩展 | 缩小发现范围，需兼顾生产扩展  |
| jobs.exclude  | []                | 追加排除文件或目录            |
| jobs.timezone | UTC               | 设置多数任务共用的业务时区    |
| jobs.redis    | 不配置            | 让独立应用副本共享协调        |

开发环境也会运行任务。整体关闭的配置：

```typescript
// src/config/development.ts — 合并到已有配置
export default { jobs: { enabled: false } };
```

全局关闭跳过任务发现和导入，配置结构仍需合法。单个 Job 的 `enabled:false` 只关闭该任务的调度，仍加载和校验定义、名称及声明形式；如果目的是避免导入某个文件，应调整发现范围。

当前生效值按项目配置合并决定，见[配置](/zh/guide/configuration)。不要把开发覆盖误认为生产开关；普通开发任务修改及已加载依赖变化会冷重启以应用新定义。

## 选择部署方式

| 部署方式                      | 最少需要的配置                  | 协调范围                              |
| ----------------------------- | ------------------------------- | ------------------------------------- |
| 单个应用进程                  | 无需 Redis                      | 当前进程内，同名任务不重叠            |
| 一个内置 Cluster              | 配置 cluster 即可，无需 Redis   | 同一个内置 Cluster 的 Worker 自动协调 |
| 多个独立进程、PM2、容器或多机 | 每个副本显式配置共享 Jobs Redis | 同一 Redis 协调域和任务身份           |

一个内置 Cluster 的生产配置：

```typescript
// src/config/production.ts — 合并到已有配置
export default {
  cluster: { enabled: true, workers: 2 },
  jobs: { timezone: "Asia/Shanghai" },
};
```

不需要为 Jobs 填写 Worker ID、内部通信或仲裁参数。多个容器各自运行一个内置 Cluster，仍然是多个独立应用，应采用下面的共享 Redis 配置。

### 多个独立副本共享 Redis

```typescript
// src/config/production.ts — 每个副本使用同一协调配置
export default {
  jobs: {
    timezone: "Asia/Shanghai",
    redis: {
      url: "redis://127.0.0.1:6379/0",
      namespace: "billing-production",
    },
  },
};
```

前提是 Redis 已部署且每个副本都能访问同一目标。127.0.0.1 只适用于本机示例；跨主机或容器时换成各副本实际可访问的共享地址。各副本保持任务名、Cron、时区、TTL 和有效前缀一致。

仅设置 Redis 环境变量不会开启 Jobs Redis。若已有 `VEXT_REDIS_URL` 或 `REDIS_URL`，可用 `jobs: { redis: {} }` 显式启用。提供的 client 优先于 url，其后为 uri、VEXT_REDIS_URL、REDIS_URL；显式空 url 不会继续回退。完整字段与错误条件见 [Redis 配置参考](/zh/api/jobs#redis-配置)。

默认 namespace 根据包名、配置 profile 和运行模式自动生成，相同应用副本通常不必手填。额外业务隔离时设置 namespace；非空 keyPrefix 则完整覆盖生成前缀。改任务名或前缀会改变协调身份，滚动发布期间应保持一致。

普通接入优先用 URL。已有客户端及 Redis Cluster 的资源管理见[部署](/zh/guide/deployment)，参数和关闭归属见 [Jobs API](/zh/api/jobs#redis-配置)。

### 调整单个任务的租约

通常保留默认值即可。有效值为 **任务 leaseTtl > jobs.redis.leaseTtl > 30000 毫秒**；必须是安全整数且至少 1000。只有 Redis 模式使用，但其他模式和 disabled 任务也会校验字段。

```typescript
// src/jobs/heartbeat.ts
import { defineJob } from "vextjs";

export default defineJob({
  cron: "*/5 * * * * *",
  leaseTtl: 60_000,
  handler({ logger }) {
    logger.info("Heartbeat job executed");
  },
});
```

此任务仍每5秒到一个计划点，Redis 租约为60秒；正常运行会续租，任务可以执行超过60秒。TTL不是执行频率、业务超时或自动重试设置。无特殊需求时不要为每个任务重复填写。

```typescript
// src/config/production.ts — 全局默认和关闭预算示例
export default {
  jobs: {
    redis: {
      url: "redis://127.0.0.1:6379/0",
      namespace: "billing-production",
      leaseTtl: 30_000,
    },
  },
  shutdown: { timeout: 20 },
};
```

`leaseTtl` 的单位是毫秒，`shutdown.timeout` 的单位是秒；后者是整个应用关闭流水线共用的预算，不是每个任务各等20秒，也不能强行终止忽略取消的业务代码。

## 重叠、失败与关闭

| 情况                          | 行为                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| 同任务上次未结束              | 跳过本次点，不排队；不同任务可并行                                         |
| handler 抛异常                | 记录 `scheduled job failed`，下一未来周期继续，不自动重试                  |
| 事件循环阻塞跨周期 / 应用停机 | 跳过已错过的点，不补跑                                                     |
| Redis领取执行资格失败         | 跳过当前点，不降级各自执行；未失租时下一未来周期可再申请                   |
| 租约续期失败/过晚/过期        | 该Worker停止新任务、请求取消并关闭或替换；重连不会恢复原资格               |
| 应用关闭                      | 先停止新触发，再请求取消，在 `shutdown.timeout` 总预算内等待，然后清理依赖 |

取得触发资格后崩溃可能丢失当次任务。网络分区、Redis 状态丢失或 handler 忽略取消都不能保证业务副作用恰好一次；需要可靠投递的业务使用专门的队列模块。执行历史、告警或进度由业务存储/监控实现，handler 返回值不持久化。

修改任务文件会使开发进程冷重启，旧定时器先关闭。已加载的任务依赖发生变化时，软重载会升级为冷重启，重新加载处理器；自定义目录也遵循此行为。

## 查看任务文档

如果应用已开启项目文档，启动后可在 `/docs` 查看 Jobs 条目。默认扫描范围逐字段继承 `jobs.dir/include/exclude`，不必重复配置；显式文档字段仅覆盖对应扫描项。

只关闭任务文档，可把下面内容合并到已有配置：

```typescript
// src/config/default.ts
export default {
  openapi: { docs: { code: { jobs: false } } },
};
```

这不会停止实际任务。需要停止任务时使用 `jobs.enabled` 或单个任务的 `enabled`。disabled 定义也可以出现在文档中，无法静态读取的动态值保留未知；看到条目不代表任务正在运行或执行过。

任务描述、标签及 `docs.summary/description/tags` 的完整字段、展示优先级和文档来源配置见 [API 参考](/zh/api/jobs#任务文档配置)。

## 测试与观察

普通 `createTestApp()` 不自动加载 src/jobs；应用在 NODE_ENV=test 时也不创建真实任务定时器。测试业务逻辑可以直接调用 Service；测试计划点和重叠规则则显式传入定义及受控时钟：

```typescript
import { defineJob } from "vextjs";
import { createTestJobScheduler } from "vextjs/testing";

let runs = 0;
const scheduler = await createTestJobScheduler({
  services: false,
  middlewares: false,
  now: new Date(0),
  jobs: {
    sample: defineJob({
      cron: "* * * * * *",
      handler() {
        runs++;
      },
    }),
  },
});
try {
  await scheduler.tick(new Date(1000));
  await scheduler.tick(new Date(1000));
  if (runs !== 1) throw new Error("Unexpected duplicate trigger");
} finally {
  await scheduler.close();
}
```

helper 使用真实调度/重叠规则，但不扫描项目目录、不创建真实定时器，也不证明实际多进程部署已协调。完整选项见[测试 API](/zh/api/testing-api#createtestjobscheduler)。

在实际应用中，先确认 Jobs 激活，再观察至少一个未来点。日志中的 `name`、`scheduledAt`、`nextRunAt` 分别帮助识别任务、本次计划点和下一计划点；下一点不代表届时一定执行成功。检查业务结果时同时查看 Service 的成功/失败日志。

框架日志还包含当前协调模式、进程/Worker、startedAt实际开始时间、durationMs耗时及开始/完成/失败/跳过状态。用实际开始时间与scheduledAt比较可观察延迟；发现clock-skew诊断时同步宿主时钟，框架不会自动校时。

上线前按实际部署方式验证：单进程观察一次完整执行；内置 Cluster 在多个 Worker 下检查同名同点资格及滚动行为；独立副本用同一 Redis 和定义检查共享协调。受控测试中的1970年时间只适用于测试时钟，不能用于真实 Redis 时间验收。

## 故障排查

| 症状                     | 首先检查                                             | 处理方式                                  |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------- |
| 启动后没有立即执行       | 下一个未来计划点                                     | 等待计划点；没有启动立即运行开关          |
| 到时间没有业务日志       | Jobs是否激活、discovered/enabled、日志级别           | 核对开关和文件范围；日志过滤不等于未运行  |
| 开发能运行，生产没有任务 | 实际产物目录、扩展和profile                          | 部署正确产物，include兼顾输出扩展         |
| 启动报定义错误           | 报错文件、Cron/时区、handler及默认声明               | 修正后重启；disabled不是定义免检          |
| 报任务重名               | 显式名和路径推导名，包含disabled定义                 | 消除冲突；helper移出发现范围              |
| 执行时间相差8小时        | 是否使用UTC、Job是否覆盖全局时区                     | 设置业务IANA时区，不只改服务器时区        |
| 某周期被跳过             | 同名上次是否结束、是否错过窗口                       | 优化业务批次或调整Cron；不排队、不补跑    |
| 内置Cluster任务未就绪    | Worker启动错误、定义/配置一致性、必要初始化          | 修复原因恢复就绪，不用加Redis掩盖启动失败 |
| 多个独立副本各自执行     | 是否显式开启Jobs Redis，共享目标/前缀/任务名是否一致 | 统一有效配置和定义，保持时钟同步          |
| Redis启动失败            | client/地址优先级、连接与权限                        | 修复后重启；不会自动降级为每个副本各跑    |
| Redis重连后不再启动任务  | 是否已经失租并取消或关闭                             | 恢复或替换实例；重连不自动恢复原实例资格  |
| onReady失败后任务不运行  | 必要Service或插件初始化错误                          | 有启用任务时修复初始化后重启              |
| 停机时任务未立刻停止     | 业务是否持续消费signal、共享关闭预算                 | 使用可取消I/O及业务幂等；无法强停任意JS   |
| 文档有条目但任务未执行   | 静态扫描范围、开关和实际运行日志                     | 文档存在不证明已经启动或执行              |
| 辅助依赖更新未生效       | 是否确实触发冷重启                                   | 核对开发重启日志，必要时重新启动应用      |

继续查阅 [Jobs API](/zh/api/jobs)中的完整参数与错误条件，或[定时任务契约](/zh/specification/jobs)中的执行保证。

# 定时任务 Jobs

Jobs 用于随应用启动的定时工作，例如清理过期数据、刷新统计、定期同步业务数据。把业务放在 Service，Job 负责按计划调用；它复用已经就绪的应用、插件和 `app.services`。

每个任务选择 **cron 或固定间隔**。无需单独启动调度器或 Worker；启动后只等待未来触发点，不提供任务队列、自动重试、停机补跑或启动立即执行。完整字段参考见 [Jobs API](/zh/api/jobs)，行为规则见[定时任务契约](/zh/specification/jobs)。

## 创建第一个任务

前提：已有能通过项目脚本启动的 Vext 应用。在 `src/jobs/heartbeat.ts` 创建：

```typescript
import { defineJob } from "vextjs";

export default defineJob({
  name: "heartbeat",
  interval: 60000,
  async handler({ name, scheduledAt, signal, logger }) {
    signal.throwIfAborted();
    logger.info({ name, scheduledAt }, "heartbeat");
  },
});
```

使用项目已有的 `npm run dev`，或执行项目构建脚本后 `npx vext start`。插件、服务、路由和 ready 阶段完成后，任务从下一个整分钟边界开始执行。框架日志包含 `job`、`scheduledAt` 与完成耗时；没有任务文件时不会建立调度资源。

开发环境也会自动调度。若开发机不应执行业务任务，将 `jobs: { enabled: false }` 合并到实际选择的开发 profile；`--config`、local 配置和 provider 的覆盖顺序见[配置](/zh/guide/configuration)。

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

可以在一个文件导出多个任务：

```typescript
// src/jobs/billing/index.ts
import { defineJob } from "vextjs";

export default defineJob({ interval: 60000, handler() {} });
export const daily = defineJob({ cron: "0 9 * * *", handler() {} });
```

以上名称分别是 `billing`、`billing.daily`。`name` 覆盖推导名称，允许 ASCII 字母、数字与 `_ . : -`，必须非空且全局唯一；关闭的定义也参与名称冲突检查。建议为需要 Redis 协调的业务显式设置稳定名称，避免移动文件改变身份。

JavaScript/ESM 使用相同导出方式；原生 CommonJS 可写成：

```javascript
// src/jobs/cleanup.cjs
const { defineJob } = require("vextjs");
module.exports = defineJob({ interval: 60000, handler() {} });
// 多任务也可使用 exports.daily = defineJob(...)
```

相对模块的默认或命名转导出可被运行时加载；静态 Docs/MCP 可以解析同一声明源码根内的安全 ESM 转导出，无法解析的包装函数、`export *`、动态 CommonJS 转导出或越界依赖会标记证据不完整。不要把“静态未解析”解释成“没有可运行任务”。

每个被选中的文件必须至少导出一个 `defineJob()`；普通对象或只有工具函数的文件会导致启动错误。把辅助模块放在 Jobs 目录外，或使用 `_helpers.ts` 等被忽略的文件名。`enabled: false` 只关闭该任务的调度，模块仍导入、定义仍校验；顶层不要发起业务调用或创建独立定时器。全局 `jobs.enabled: false` 才跳过整个任务目录的发现。

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

**过滤器匹配实际文件，不随编译自动转换。** `include: ["**/*.ts"]` 能发现源码，却会漏掉构建后的 `task.js`。使用 `**/*.{ts,js}` 等包含实际输出扩展的规则，或保留默认值；MCP 在生产目标看到明显的源码扩展过滤时会提示，但仍需检查构建输出。

## cron、interval 与时区

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

| 格式   | 字段顺序                 | 例子                                                         |
| ------ | ------------------------ | ------------------------------------------------------------ |
| 五字段 | 分、时、日、月、星期     | `0 9 * * *`：每天 09:00                                      |
| 六字段 | 秒、分、时、日、月、星期 | `0 */5 * * * *`：每五分钟第 0 秒；`*/30 * * * * *`：每半分钟 |
| 工作日 | 五字段，星期 1–5         | `0 9 * * 1-5`：周一至周五 09:00                              |

cron 由 Croner 解析；完整扩展语法以所安装 Croner 版本为准。时区优先级为 **任务 `timezone` > `jobs.timezone` > `UTC`**，必须是有效 IANA 时区。`Asia/Shanghai` 的 09:00 对应 UTC 01:00；日志中的 ISO 时间含 `Z`，应按时区换算。

夏令时会产生不存在或重复的本地时间，由 Croner 计算。当前依赖下，在 `America/New_York` 为 `30 1 * * *` 从 `2026-11-01T05:29:59Z` 计算得到 `05:30Z`，再从该点计算得到次日 `06:30Z`，不是当日重复的第二次 01:30。春季缺失时间也受计算起点影响：`30 2 * * *` 从 `2026-03-07T08:00Z` 得到次日 `07:30Z`（当地 03:30），而从 `2026-03-08T07:00Z` 计算则得到次日 `06:30Z`。需要稳定绝对时间时选 UTC；涉及本地时间的业务应为所用地区和边界日期验证计划点，不能假定每个自然日都恰好一次。

### 固定间隔

`interval` 单位为毫秒，必须是正安全整数；不能同时提供 `cron`，也不能提供任务级 `timezone`。下一触发点公式是：

```text
(Math.floor(currentTimeMs / interval) + 1) * interval
```

例如 `interval: 60000`，应用在 12:00:20 就绪，则等待 12:01:00；即使正好在 12:01:00 就绪，也只等 12:02:00。不会立即执行，也不是从就绪时间每隔 60 秒。副本使用相同间隔和同步时钟才能得到相同计划点。

某个已注册的 12:01 触发稍晚到 12:01:02、仍未跨过下一周期时可以执行；如果事件循环到 12:02 或更晚才恢复，旧点被跳过，直接安排未来点。启动、重启或停机恢复也只选择未来点。无效 cron/时区、互斥调度错误，以及启用任务没有可表示的未来触发点都会在启动阶段报错。

## 调用 Service 与协作取消

下面示例定期读取远端状态，更新 Service 内存快照。外部接口约定为 JSON `{ "status": "..." }`；`STATUS_ENDPOINTS` 是以逗号分隔的 URL。需要持久化时，在 Service 内接入项目自己的数据层，Job 定义不增加数据库接口。

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
  interval: 60000,
  async handler({ app, signal, scheduledAt, logger }) {
    const count = await app.services.remoteStatus.refresh(signal);
    logger.info({ count, scheduledAt }, "Status refresh completed");
  },
});
```

Job 上下文包含 `app/name/scheduledAt/signal/logger`，没有 `req/res` 或当前用户。`scheduledAt` 是计划点而非实际开始时间；返回值不会形成运行记录。HTTP 路由也可复用这个 Service，但需要由路由处理请求参数及响应。

**入口检查一次 signal 不能让整个长任务支持取消。** 在批处理循环中持续检查，把 signal 传给支持它的网络/流式 I/O，并在异步步骤后检查。驱动不支持取消时应使用其原生取消/超时能力或缩小工作批次；框架无法强行中断忽略 signal 的函数。重要副作用应以业务唯一键或事务实现幂等，不将 Redis 调度去重等同业务幂等。

## Cluster 与多副本

| 部署方式                       | Jobs Redis 配置           | 使用者需要做什么                                                                 |
| ------------------------------ | ------------------------- | -------------------------------------------------------------------------------- |
| 单应用进程                     | 可不配                    | 进程内防重叠；若要与其他副本协调，配置共享 Redis                                 |
| 内置应用 Cluster，存在启用任务 | 必须                      | 缺配置时启动报错；各 Worker 使用同一目标、namespace、任务名及调度                |
| 内置 Cluster，无任务或全部关闭 | 不要求                    | 不建立 Jobs Redis 连接；配置结构仍应有效                                         |
| PM2/多个独立进程/容器/多机     | 应显式配置                | 框架无法自动识别外部副本，不配置则每个进程独立执行                               |
| 单机或多机连接 Redis Cluster   | 使用兼容的 Cluster client | “应用 Cluster”与“Redis Cluster”是两件事；后者解决 Redis 分片，不自动开启应用协调 |

最小的环境变量配置：

```typescript
import type { VextUserConfig } from "vextjs";
export default {
  cluster: { enabled: true, workers: 2 },
  jobs: { redis: {} },
} satisfies VextUserConfig;
```

在启动环境设置 `VEXT_REDIS_URL=redis://127.0.0.1:6379`，或在 `redis.url` 填 URL。没有 `jobs.redis` 对象时，仅有环境变量不会开启协调。连接优先级为有效 `client` > `url` > `uri` > `VEXT_REDIS_URL` > `REDIS_URL`；URL 使用空值合并，显式空字符串不会回退。具体字段与约束见 [API 配置表](/zh/api/jobs#vextjobsconfig)。

### 自动 namespace

**相同应用副本无需到处配置 namespace。** 默认逻辑前缀为：

```text
vext:<归一化包名>:<VEXT_CONFIG 或 default>:<NODE_ENV 或 production>:job:
```

标准 CLI 设置所选 profile 和运行模式。包名 `my-app`、profile `production`、模式 `production` 得到 `vext:my-app:production:production:job:`。自动值不含 PID、随机数或部署路径。

副本须共享 Redis、包名、profile、运行模式、任务名称与调度，并保持时钟同步。只有额外隔离时才设 `namespace`，例如同包名的两个独立业务部署；`keyPrefix` 可覆盖整个逻辑前缀且优先于 namespace。不可读包名回退为 `vextjs-app`；不同应用共用该回退值时需显式隔离。Jobs 不复用缓存、Session 或限流模块的连接配置。

### 传入 client 与 Redis Cluster

客户端必须提供兼容 ioredis 的 `ping()`、`eval(script, keyCount, ...args)`。URL 创建的连接由 Jobs 在结束时关闭；传入 client 的配置、错误事件和关闭由调用者负责。

配置在插件运行前已冻结，不能在 `setup` 中修改 `app.config.jobs`。下面在静态配置里构造 lazy client（不主动连接），再由插件从最终配置取得实例并注册清理。Bootstrap provider 只接受 JSON-like patch，不能用它返回客户端实例。

```typescript
// src/config/default.ts
import { Redis } from "ioredis";
import type { VextUserConfig } from "vextjs";

const url = process.env.VEXT_REDIS_URL;
if (!url) throw new Error("Set VEXT_REDIS_URL");
const client = new Redis(url, { lazyConnect: true });
client.on("error", () => {
  /* 接入项目监控，避免记录凭据 */
});
export default { jobs: { redis: { client } } } satisfies VextUserConfig;
```

```typescript
// src/plugins/jobs-redis.ts
import { definePlugin } from "vextjs";
import { Redis, Cluster } from "ioredis";

export default definePlugin({
  name: "jobs-redis",
  setup(app) {
    const client = app.config.jobs?.redis?.client;
    if (!(client instanceof Redis) && !(client instanceof Cluster)) {
      throw new Error("Configure a managed Jobs Redis client");
    }
    app.onClose(() => {
      client.disconnect();
    });
  },
});
```

分片 Redis Cluster 使用同样的资源管理流程，在配置中改为导入 `Cluster` 并替换 client 创建语句：

```typescript
import { Cluster } from "ioredis";

const client = new Cluster(
  [
    { host: "redis-node-1", port: 6379 },
    { host: "redis-node-2", port: 6379 },
  ],
  {
    lazyConnect: true,
    redisOptions: {
      /* TLS/认证等 */
    },
  },
);
```

这里展示资源接入顺序，具体插件挂载与生命周期见[插件](/zh/guide/plugins)。没有 client 接入需求时优先用 URL，减少手动资源管理。不要给 ioredis 自身配置一个会再次变换 Jobs EVAL key 的 `keyPrefix`；隔离使用 `jobs.redis.namespace/keyPrefix`。

Redis 初始化检查 PING 与 Lua EVAL；运行脚本还需要 TIME、GET、SET、EXISTS、PEXPIRE、DEL 等命令与对应 key 权限。启动探测成功不能证明复杂 ACL、TLS、Sentinel 或故障转移全都已验证，应在实际目标做部署验收。Redis Cluster 的同任务 marker/running 键使用同一 hash slot。

### 租约、触发标记与运维

`leaseTtl` 默认 30000 毫秒、最小 1000；运行中约每 TTL/3 续期，不是任务超时，也无需按业务全程时长设置。运行结束按 owner 释放租约；续租失败请求取消。Redis 不可用时跳过当前点，不降级为本地执行；恢复后只等未来点。Redis 使用服务器时间判断触发点是否已到达、是否过期，应用时钟偏差会造成拒绝或遗漏。

默认逻辑前缀与**实际 key**不同：

```text
{<sha256 of logical-prefix + NUL + job-name>}:<logical-prefix><encoded-job-name>:last
{<same hash>}:<logical-prefix><encoded-job-name>:running
```

`last` 每任务只保留最近接受的触发时间，没有 TTL；`running` 是带 TTL 的运行租约。运行结束或进程崩溃不会清除 `last`，所以快任务不会被同点重复领取，也不会在恢复后补跑。没有内置任务历史库或清理命令。

排查时不能用 `SCAN MATCH vext:...*`，因为 key 以 `{hash}:` 开头。可在确认 namespace 后使用包含内部 hash tag 的匹配模式；Redis Cluster 需要分别扫描各主节点。避免线上使用 `KEYS`。

停用任务的 `last` 可能残留。只有在确认所有旧副本与旧任务均停止后，才通过自己的运维流程清理准确的旧任务键；不要删仍在协调的 key。改任务名、namespace 或 keyPrefix 会成为新的协调身份；混合部署旧/新身份可能各自触发，发布应保持定义一致。删除 Redis 状态会丢失去重证据，不能承诺副作用恰好一次。

## 重叠、失败与关闭

| 情况                          | 行为                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| 同任务上次未结束              | 跳过本次点，不排队；不同任务可并行                                                        |
| handler 抛异常                | 记录 `scheduled job failed`，下一未来周期继续，不自动重试                                 |
| 事件循环阻塞跨周期 / 应用停机 | 跳过已错过的点，不补跑                                                                    |
| Redis claim 出错              | 记录协调不可用，不降级本地；下一未来周期再尝试协调                                        |
| 租约续期失败                  | 记录 `scheduled job lease unavailable; cancellation requested` 并 abort handler 的 signal |
| 应用关闭                      | 先停止新触发，再请求取消，在 `shutdown.timeout` 总预算内等待，然后清理依赖                |

取得触发资格后崩溃可能丢失当次任务。网络分区、Redis 状态丢失或 handler 忽略取消都不能保证业务副作用恰好一次；需要可靠投递的业务使用专门的队列模块。执行历史、告警或进度由业务存储/监控实现，handler 返回值不持久化。

修改任务文件会使开发进程冷重启，旧定时器先关闭。已加载的任务依赖发生变化时，软重载会升级为冷重启，重新加载处理器；自定义目录也遵循此行为。

## 文档与 MCP

### 生成项目 Jobs 文档

把以下配置合并到现有 OpenAPI 配置：

```typescript
export default {
  jobs: { dir: "tasks", exclude: ["experiments/**"] },
  openapi: { docs: { code: { jobs: true } } },
};
```

`true` 默认继承 `jobs.dir/include/exclude`，因此上述 Docs 扫描 `src/tasks`。需要独立文档选取时可写 `jobs: { dir: "documented-tasks", include: ["**/*.{ts,js}"], exclude: [] }` 到 `openapi.docs.code.jobs`，每个显式字段分别覆盖对应默认值；这不会改变运行时调度。`false` 只关闭该文档源。关闭的定义仍可出现在 Docs 中。

```typescript
import { defineJob } from "vextjs";

/**
 * 刷新远端状态摘要。
 *
 * 供运营页面查询；单个端点更新以实际成功读取为准。
 */
export default defineJob({
  name: "refresh-status",
  interval: 60000,
  description: "周期读取远端状态",
  tags: ["operations"],
  docs: {
    summary: "远端状态同步",
    description: "调用 remoteStatus Service",
    tags: ["maintenance"],
  },
  async handler({ app, signal }) {
    await app.services.remoteStatus.refresh(signal);
  },
});
```

摘要优先级是 JSDoc 摘要 > `docs.summary` > `docs.description` > `description` > 生成的默认摘要；描述是 JSDoc 描述 > `docs.description` > `description`。标签合并定义 `tags`、`docs.tags` 与 `jobs` 并去重。转导出条目保留发现文件及真实定义位置。

启动后打开项目 `/docs`（若修改了 path 则使用对应地址），选择 Jobs 分类。详情展示名称、cron、interval 毫秒单位、声明/有效 cron 时区、开关、解析状态；支持按调度字段搜索。未知字段显示未知，不能用推导名称冒充动态实际名称，也不能把未知开关解释为默认启用。

静态工具识别来自 `vextjs` 的 `defineJob` import/require 及别名；读取明确字面量和可证明不可变的常量，在已声明源码根内解析安全 ESM 导入/转导出。动态调用、包装函数、不可解析展开、可变绑定、循环/越界依赖等保留部分证据和原因，不通过执行业务模块来补齐。文档源覆盖了什么，与运行时发现了什么、是否正在执行，是三个不同问题。

### 使用 MCP 检查

通过已连接的宿主调用 `vext_project_inspect`，选择 `section: "jobs"`；通过 `vext_capability_check` 查询 `capability: "C34"`，再使用 `vext_project_check` 的 `profile: "standard"`、`configTarget: "production"` 检查生产目标，必要时用 `all` 比较开发与生产。

结果区分框架支持、项目声明状态、静态缺失证据及启动前提。无任务或关闭的项目不报告为 Jobs 已启用；已知 Cluster 缺 Redis、无效定义/时区和重复名称给出诊断。`runtimeVerified: false` 表示工具没有启动应用、连接 Redis 或执行 handler。随后由宿主运行构建、真实启动和测试验证，不能把源码完整或 Docs 列表当作运行证明。

## 测试与验收

普通 `createTestApp()` 不自动加载或运行 `src/jobs`；正常应用路径下 `NODE_ENV=test` 也禁用真实 Jobs 定时器。用 helper 显式提供定义和时钟：

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
      interval: 1000,
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

helper 使用真实调度/重叠规则，但不扫描任务、不注册真实定时器。完整选项见[测试 API](/zh/api/testing-api#createtestjobscheduler)。建议按以下层次验收：

| 验证层次          | 检查内容                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| 手动 tick         | 相同点只执行一次；跨周期不补跑；异常后下一周期继续；长 handler 与下一次 tick 重叠时跳过                           |
| 取消/close        | 用可控 Promise 保持 handler 在途，确认收到 signal 并退出；关闭后新 tick 不执行；保持依赖直到 handler 结束         |
| 真实应用启动      | `NODE_ENV` 不是 `test`，确认 ready 后才触发；不能只等待固定 sleep 就认为注册成功，观察 handler 与框架日志         |
| 源码/构建产物     | 按项目脚本开发启动与构建后启动，检查自定义目录、过滤规则及默认/命名导出名称一致                                   |
| 实际 Redis 多实例 | 两个真实副本同一计划点只有一个接受；快任务不会再次领取；长任务续租；关闭与 Redis 故障行为；不能用 mock 替代此证据 |
| Node 原生模块     | 验证所用 Node 的 ESM/CJS 默认及命名导出；原生 Node 与测试转换器的模块命名空间可能不同                             |

宿主执行项目现有测试与构建命令，再在隔离环境真实启动；至少观察一个未来触发点和 `scheduled job completed` 日志，确认含计划时间，关闭后不再新增触发。多副本验收使用共享 Redis 与相同身份；Redis 依据真实服务器时间拒绝远古/未来测试点，不要用 `new Date(1000)` 验收真实 Redis。

## 故障排查

| 症状                      | 常见原因                                                         | 检查动作                                                                    |
| ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 启动报定义/名称错误       | 无 `defineJob` 导出、无效 cron/interval/时区、重名（含关闭定义） | 按文件与字段报错修正；工具模块移出 Jobs 或使用下划线文件名                  |
| Cluster 启动缺 Redis      | 有启用任务但无 `jobs.redis`                                      | 配共享 Redis，或明确关闭调度；仅设 URL 环境变量不够                         |
| Redis 初始化失败          | 目标空、连接/认证/PING/EVAL 不可用                               | 核对 client/URL 优先级与启动目标，验收 Lua 命令权限；日志不打印凭据         |
| 项目启动了却未执行        | 全局/单任务关闭、未到未来点、NODE_ENV=test、文件不在选取范围     | 检查最终 profile、开关、实际目录、glob 和计划时区                           |
| 开发可用，生产无任务      | include 仅 `.ts` 或编译未复制任务                                | 检查构建根任务文件；包含输出扩展，保留实际文件 glob 语义                    |
| 多个副本各自执行          | 未开 Redis、目标/namespace/name/调度不同、状态丢失               | 对照有效配置及版本，保持时钟同步；检查是否混用旧/新身份                     |
| 某些周期被跳过            | 上次仍运行、事件循环延迟、Redis 不可用或时钟偏差                 | 对照 scheduledAt、耗时与 skip/协调日志，优化业务批次或调整周期              |
| 续租失败后任务仍运行      | handler 没有协作取消或 I/O 不可中断                              | 循环检查 signal，使用支持 AbortSignal 的 I/O 或驱动原生取消                 |
| 关闭等待超时              | 在途任务未响应取消、依赖等待过长                                 | 检查关闭日志与业务 I/O，遵守应用总关闭预算；无强行中断保证                  |
| 任务辅助依赖更新未生效    | 未被加载的依赖或自定义加载方式不在依赖图                         | 确认冷重启日志；对真实依赖变更做开发验收，必要时重启                        |
| 自定义目录没有 Docs 条目  | Docs Jobs 源关闭、显式 Docs override 不同、扫描受限              | 开启文档源；核对继承/覆盖与解析提示；列表不是运行状态                       |
| MCP 返回 partial/未知名称 | 动态字段、包装、可变/越界依赖未被静态证明                        | 查看缺失证据，简化可读声明；由宿主验证实际启动，不执行 handler 来“补元数据” |

# 任务与 Jobs

Vext Jobs 提供框架级后台任务、内置定时调度和 worker 运行时。Job 是 `src/jobs/**` 下的普通模块，通过 `defineJob({ handler })` 导出。HTTP 启动不会自动执行 Job；只有 `vext job ...`、测试工具或显式读取 Job registry 的工具才会加载 Job。

## 目录结构

```text
src/
  jobs/
    billing/close-invoice.ts
    emails/send-welcome.ts
```

`src/jobs/**` 是默认约定，不是强制规范。服务使用其他目录时可配置 `config.jobs.dir`。在 monorepo 中，每个 service root 拥有独立 registry，因此不同服务可以使用相同 Job 名称而不互相冲突。

## 配置入口

Job 配置写在 `src/config/default.ts`、`src/config/production.ts` 或通过 `--config <profile>` 选择的 profile 中。HTTP 配置和 Job 配置共享同一个 Vext app 生命周期，但运行进程是分开的：`vext start` 负责 HTTP，`vext job scheduler` 负责到点生成任务，`vext job worker` 负责消费队列。

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  jobs: {
    dir: "jobs",
    store: { type: "file", dir: ".vext/jobs" },
    scheduler: {
      mode: "enqueue",
      timezone: "Asia/Shanghai",
      lease: { enabled: true, ttl: 30_000, renewInterval: 10_000 },
    },
    worker: {
      concurrency: 4,
      pollInterval: 1000,
      lease: { ttl: 30_000, renewInterval: 10_000 },
    },
    defaults: {
      timeout: 30_000,
      retry: { attempts: 3, delay: 1000, backoff: "exponential" },
      concurrency: 1,
    },
  },
};

export default config;
```

`config.jobs.dir` 相对 `src/` 解析；`store.dir` 相对项目根解析。多个基于 VextJS 的服务同时运行时，每个服务应使用自己的项目根或独立 `store.dir`，避免不同服务共享 `.vext/jobs` 后互相看到对方的 run record。需要跨服务统一调度时，应显式接入自定义数据库/队列 store，并把 Job 名称设计成带服务前缀的全局唯一名称。

## 定义 Job

```ts
import { defineJob } from "vextjs";

export default defineJob<{ invoiceId: string }, { closed: boolean }>({
  name: "billing.closeInvoice",
  description: "关闭逾期账单。",
  tags: ["billing"],
  schedule: {
    cron: "0 */5 * * * *",
    timezone: "Asia/Shanghai",
    singleton: true,
  },
  queue: {
    priority: 10,
  },
  timeout: 30_000,
  retry: { attempts: 3, delay: 1000, backoff: "exponential" },
  handler: async ({ app, payload, logger, signal }) => {
    const invoice = await app.services.billing.close(payload.invoiceId, {
      signal,
    });
    logger.info({ invoiceId: payload.invoiceId }, "invoice closed");
    return { closed: invoice.closed };
  },
});
```

handler 可访问 `app`、`payload`、`logger`、`signal`、`attempt`、`runId` 和归一化后的 Job 定义。它可以使用 services、models、`app.fetch`、i18n、logger、config 和插件扩展，但不会收到 HTTP 请求或响应对象。长耗时任务应把 `signal` 继续传给数据库、fetch、队列或内部循环，方便超时和优雅关闭中断。

## 定时任务

Job 可以通过 `schedule` 声明内置定时调度：

```ts
export default defineJob({
  name: "reports.dailySummary",
  schedule: {
    cron: "0 0 8 * * *",
    timezone: "Asia/Shanghai",
    misfirePolicy: "skip",
    singleton: true,
  },
  handler: async ({ app, signal }) => {
    await app.services.reports.sendDailySummary({ signal });
  },
});
```

`cron` 使用秒级 cron 表达式，`timezone` 默认继承 `config.jobs.scheduler.timezone`。也可以使用 `interval`：

```ts
defineJob({
  name: "metrics.flush",
  schedule: {
    interval: 30_000,
    misfirePolicy: "fire-once",
  },
  handler: async ({ app }) => app.services.metrics.flush(),
});
```

| 字段            | 用途                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `cron`          | 按 cron 表达式触发，适合日报、账单、清理任务                          |
| `interval`      | 按毫秒间隔触发，适合轮询和 flush                                      |
| `timezone`      | cron 时区，例如 `Asia/Shanghai`                                       |
| `misfirePolicy` | scheduler 暂停或错过 tick 后如何补偿：`skip`、`fire-once`、`catch-up` |
| `maxCatchUp`    | `catch-up` 最大补偿次数                                               |
| `jitter`        | 到点后随机延迟，避免多任务同时打爆依赖                                |
| `singleton`     | 为 schedule run 生成幂等键，避免同一时间点重复入队                    |

## CLI 运行

```bash
vext job list
vext job inspect billing.closeInvoice
vext job run billing.closeInvoice --payload '{"invoiceId":"i_1"}'
vext job enqueue billing.closeInvoice --payload '{"invoiceId":"i_1"}'
vext job scheduler
vext job worker
vext job runs --limit 20
vext job status <runId>
```

`--json` 输出机器可读 JSON，`--config <profile>` 选择配置 profile，`--outdir <dir>` 指定构建目录，`--source` 可在已有有效构建时仍读取源码。

`vext job run` 会立即执行一次 Job 并写入 run record。`vext job enqueue` 只创建 pending run，等待 worker 领取。`vext job scheduler` 启动内置 scheduler，扫描带 `schedule` 的 Job 并创建 due run。`vext job worker` 轮询 store 中的 pending run，领取后执行。

## 触发方式怎么选

| 方式        | 入口                                                | 适用场景                              | 注意事项                                               |
| ----------- | --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| 手动执行    | `vext job run <name>`                               | 运维补偿、一次性脚本、本地调试        | 立即执行，不等待 worker；仍会写入 run record           |
| 手动入队    | `vext job enqueue <name>`                           | 需要异步执行、削峰、排队的业务动作    | 需要至少一个 `vext job worker` 消费队列                |
| 定时 inline | `vext job scheduler` + `scheduler.mode = "inline"`  | 小项目、单进程、低频任务              | scheduler 自己执行 handler；不适合重任务或多实例高可用 |
| 定时入队    | `vext job scheduler` + `scheduler.mode = "enqueue"` | 企业部署、可扩缩 worker、需要队列隔离 | 推荐生产默认；scheduler 只生成 run，worker 执行        |
| 测试执行    | `createTestJobRunner()`                             | 单元测试、服务 mock、payload 校验     | 使用测试 app，不启动 HTTP 端口                         |

生产环境优先选择“定时入队”：scheduler 副本负责计算 due time，worker 副本负责消耗 run。这样可以独立扩缩 worker，也可以在重任务卡住时保持 scheduler 轻量。

## Store 与运行记录

默认 store 是 `file`，位置为 `.vext/jobs`。它会保存 scheduler lease、worker heartbeat、run record、run lease、trigger、payload、status、attempts、duration、result 和 error 摘要。

`memory` store 适合测试和本地演示，进程退出后数据丢失。`file` store 适合同机多进程和单机部署；如果多个容器共享同一个持久卷，也可以用于简单多实例。`redis` 是内置分布式 store，适合跨进程或跨节点的 scheduler/worker 共享 run record 与租约。可配置 `jobs.store: { type: "redis", url: "redis://127.0.0.1:6379" }`；只有确认通过 `VEXT_REDIS_URL`/`REDIS_URL` 提供 Redis 目标时才使用 `jobs.store: "auto"`。Vext 默认根据包名、配置 profile、运行模式和模块生成 Redis key 前缀；只有多个服务需要显式共享或隔离 key 时才设置 `namespace` 或 `keyPrefix`。严格 exactly-once 或更高吞吐队列仍建议接入自定义 runner、BullMQ、数据库或云队列。

## 运行时边界

- `vext start` 和 HTTP cluster worker 默认不执行 Job，避免每个 HTTP worker 都触发同一任务。
- Scheduler 由 `vext job scheduler` 显式启动；多个 scheduler 同时存在时，只有拿到 scheduler lease 的实例会创建 due run。
- Worker 由 `vext job worker` 显式启动；多个 worker 可并行运行，通过 run lease 避免同一 run 被重复执行。Worker 会同时遵守 `jobs.worker.concurrency` 全局并发和单个 Job 的 `concurrency` / `jobs.defaults.concurrency` 上限。
- HTTP rolling restart 不会自动重启 Job scheduler/worker，部署系统应分别管理 HTTP、scheduler 和 worker。
- Job runtime 关闭时会走与 HTTP 启动一致的 `app.onClose()` 生命周期，释放数据库、插件和日志资源。

推荐生产拓扑：

```text
HTTP 服务:
  vext start

定时调度:
  vext job scheduler

任务执行:
  vext job worker
```

小项目可以只运行 `vext job scheduler`，并使用默认 `scheduler.mode = "inline"` 到点直接执行。企业部署建议使用 `scheduler.mode = "enqueue"`，由一个或多个 worker 执行。

## 多进程、Cluster 与部署注意

HTTP cluster 的职责是处理入站 HTTP 流量，不负责 Job。不要在每个 HTTP worker 中自行启动 scheduler，否则会重复创建任务。单机生产可使用 systemd、PM2、Docker Compose 分别管理 HTTP、scheduler、worker。Kubernetes 建议拆成三个 Deployment，scheduler 副本数可以大于 1，但所有副本必须共享同一 store，依靠 lease 选出实际调度者。

Job handler 仍应按业务幂等设计。框架能避免同一 run 被多个 worker 同时领取，但无法替业务系统保证外部副作用只发生一次，例如支付、发券、发邮件和调用第三方 API。此类任务应使用业务唯一键、数据库唯一索引或外部服务幂等键。

### 部署模板

单机 systemd / PM2 / Docker Compose 可拆成三个进程：

```bash
# HTTP
vext start

# Scheduler，企业部署建议 enqueue
vext job scheduler --config production

# Worker，可按 CPU、IO 和依赖限流水平扩缩
vext job worker --config production
```

Kubernetes 推荐三个 Deployment：

```text
vext-http      replicas: N   command: vext start
vext-scheduler replicas: 1+  command: vext job scheduler --config production
vext-worker    replicas: M   command: vext job worker --config production
```

`scheduler` 可以有多个副本做高可用，但它们必须共享同一个 store，且 `jobs.scheduler.lease.enabled` 应保持开启。`worker` 可以横向扩容，扩容前需要确认外部依赖的连接池、API 限流、数据库锁和 Job 自身幂等策略能承受并发。`file` store 只适合同机或共享卷；跨节点高可用和高吞吐场景应使用自定义数据库/Redis/队列 store。

## 测试

单元测试可使用 `vextjs/testing` 的 `createTestJobRunner`：

```ts
import { defineJob } from "vextjs";
import { createTestJobRunner } from "vextjs/testing";

const runner = await createTestJobRunner({
  services: false,
  mockServices: {
    billing: { close: async () => ({ closed: true }) },
  },
  jobs: {
    "billing.closeInvoice": defineJob({
      handler: async ({ app }) => app.services.billing.close(),
    }),
  },
});

const result = await runner.run("billing.closeInvoice");
await runner.close();
```

## Docs source

启用 `openapi.docs.code.jobs` 后，Vext Docs 会扫描 `src/jobs/**`。Job 文档包含名称、源文件、tags、timeout、retry、concurrency、schedule、queue、payload schema 是否存在以及 `vext job run` 用法。这些机器可读条目也是 MCP tools 和 recipes 的事实来源。

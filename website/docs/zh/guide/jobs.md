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

## Store 与运行记录

默认 store 是 `file`，位置为 `.vext/jobs`。它会保存 scheduler lease、worker heartbeat、run record、run lease、trigger、payload、status、attempts、duration、result 和 error 摘要。

`memory` store 适合测试和本地演示，进程退出后数据丢失。`file` store 适合同机多进程和单机部署；如果多个容器共享同一个持久卷，也可以用于简单多实例。跨机器生产、严格 exactly-once 或高吞吐队列建议通过自定义 store/runner 接数据库、Redis、BullMQ 或云队列。

## 运行时边界

- `vext start` 和 HTTP cluster worker 默认不执行 Job，避免每个 HTTP worker 都触发同一任务。
- Scheduler 由 `vext job scheduler` 显式启动；多个 scheduler 同时存在时，只有拿到 scheduler lease 的实例会创建 due run。
- Worker 由 `vext job worker` 显式启动；多个 worker 可并行运行，通过 run lease 避免同一 run 被重复执行。
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

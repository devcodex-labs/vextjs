# Jobs API

## `defineJob(definition)`

创建可被 `vext job`、测试工具、Vext Docs 和 MCP 工具发现的 Job 定义。

```ts
import { defineJob } from "vextjs";

export default defineJob({
  name: "emails.sendWelcome",
  description: "发送欢迎邮件。",
  tags: ["email"],
  schedule: {
    cron: "0 */5 * * * *",
    timezone: "Asia/Shanghai",
    singleton: true,
  },
  queue: { priority: 5 },
  timeout: 10_000,
  retry: { attempts: 3, delay: 500, backoff: "exponential" },
  handler: async ({ app, payload }) => {
    await app.services.email.sendWelcome(payload);
  },
});
```

`name` 是可选字段。不声明时，Vext 会根据文件路径推导 Job 名称，例如 `src/jobs/billing/close.ts` 会成为 `billing.close`。

## 核心类型

| 类型                   | 用途                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| `VextJobDefinition`    | `defineJob` 返回的归一化 Job 定义。                                               |
| `VextJobContext`       | handler 上下文，包含 `app`、`payload`、`logger`、`signal`、`attempt` 和 `runId`。 |
| `VextJobRegistry`      | CLI、testing、docs 和 MCP 使用的只读 registry。                                   |
| `VextJobRunnerAdapter` | 外部队列或 runner 的扩展合同。                                                    |
| `VextJobRunRecord`     | store 中保存的运行记录，包含 trigger、status、attempts、duration 和错误摘要。     |
| `VextJobStore`         | scheduler、worker 与 CLI 共享运行状态的 store 合同。                              |
| `VextJobRunResult`     | `runJob` 和测试 helper 返回的执行结果。                                           |
| `VextJobsConfig`       | `config.jobs` 配置形态。                                                          |

## `bootstrapJobRuntime(options)`

启动 headless Job runtime。它会加载 config、i18n、内置数据库插件、用户插件、services、Job registry 和 Job store，但不会解析 HTTP adapter、注册路由或监听端口。

## `runJob(app, registry, name, options)`

通过 inline runner 执行一个 Job。Job 声明 `payload` schema 时，会复用 app validator 做 payload 校验。底层 `runJob()` 不直接创建 store run record；CLI 和 `bootstrapJobRuntime()` 返回的 runtime 会在执行前后写入 store。

## `startJobScheduler(runtime, options)`

启动内置 scheduler。它会筛选带 `schedule` 的 Job，按 cron 或 interval 计算 due time，获取 scheduler lease，然后创建 run record。`config.jobs.scheduler.mode = "inline"` 时到点直接执行；`"enqueue"` 时只入队，由 worker 执行。

Scheduler lease 通过 `jobs.scheduler.lease.ttl` 控制持有时间，通过 `jobs.scheduler.lease.renewInterval` 控制续期间隔。未拿到 lease 的 scheduler 不会推进自身调度窗口，因此后续获得 lease 后仍能按 `misfirePolicy` 处理错过的 tick。

## `startJobWorker(runtime, options)`

启动 worker 轮询循环。worker 会 heartbeat、claim pending run、执行 Job，并把 success、failed、timeout 或 cancelled 写回 store。多个 worker 可以并行运行，run lease 会避免同一个 run 被两个 worker 同时执行。

Worker 认领 run 时会同时检查全局并发和单 Job 并发：全局上限来自 `jobs.worker.concurrency`，单 Job 上限来自 `defineJob({ concurrency })`，未声明时使用 `jobs.defaults.concurrency`，最低为 `1`。

## `createJobStore(options)`

根据 `config.jobs.store` 创建内置 store。`memory` 适合测试；`file` 是默认持久化 store，默认目录 `.vext/jobs`，适合同机多进程和单机部署。`redis` 会打开 Redis-backed store，用于 run record、scheduler lease、worker heartbeat、run claim、运行租约续期和 owner 校验完成。`auto` 只在 `VEXT_REDIS_URL` 或 `REDIS_URL` 存在时可用；没有 Redis 目标会 fail fast。

## 测试 API

`vextjs/testing` 导出 `createTestJobRunner(options)`。它会创建测试 app，注册传入的 Job 定义，并提供 `run(name, options)` 与 `close()`。

## Job 定义字段

| 字段             | 类型                      | 默认值                             | 说明                                   |
| ---------------- | ------------------------- | ---------------------------------- | -------------------------------------- |
| `name`           | `string`                  | 由文件路径推导                     | Job 名称，同一 service root 内必须唯一 |
| `description`    | `string`                  | `undefined`                        | 文档说明                               |
| `tags`           | `string[]`                | `undefined`                        | 文档和筛选标签                         |
| `docs`           | `object`                  | `undefined`                        | 面向 Vext Docs / MCP 的说明补充        |
| `payload`        | `Record<string, unknown>` | `undefined`                        | schema-dsl payload 校验                |
| `schedule`       | `VextJobScheduleConfig`   | `undefined`                        | 内置 scheduler 配置                    |
| `queue`          | `VextJobQueueConfig`      | `undefined`                        | 入队优先级等队列元数据                 |
| `timeout`        | `number`                  | `config.jobs.defaults.timeout`     | 单次执行超时，单位毫秒                 |
| `retry`          | `false &#124; object`     | `config.jobs.defaults.retry`       | 重试次数、延迟和退避策略               |
| `concurrency`    | `number`                  | `config.jobs.defaults.concurrency` | 单 Job 并发上限，供 worker/runner 使用 |
| `idempotencyKey` | `string &#124; function`  | `undefined`                        | 手动/入队任务的业务幂等键              |
| `handler`        | `function`                | 必填                               | Job 执行函数                           |

## Schedule 字段

| 字段            | 类型                                          | 默认值                                | 说明                                    |
| --------------- | --------------------------------------------- | ------------------------------------- | --------------------------------------- |
| `enabled`       | `boolean`                                     | `true`                                | 是否启用该 Job 的定时调度               |
| `cron`          | `string`                                      | `undefined`                           | 秒级 cron 表达式                        |
| `interval`      | `number`                                      | `undefined`                           | 毫秒间隔；不能与 `cron` 同时配置        |
| `timezone`      | `string`                                      | `config.jobs.scheduler.timezone`      | cron 时区                               |
| `startAt`       | `string &#124; Date`                          | `undefined`                           | 起始时间                                |
| `endAt`         | `string &#124; Date`                          | `undefined`                           | 结束时间                                |
| `misfirePolicy` | `'skip' &#124; 'fire-once' &#124; 'catch-up'` | `config.jobs.scheduler.misfirePolicy` | 错过 tick 后如何补偿                    |
| `maxCatchUp`    | `number`                                      | `config.jobs.scheduler.maxCatchUp`    | 最大补偿次数                            |
| `jitter`        | `number`                                      | `config.jobs.scheduler.jitter`        | 到点后的随机延迟毫秒数                  |
| `singleton`     | `boolean`                                     | `false`                               | 同一 scheduled fire time 只允许一个 run |

## 配置

```ts
export default {
  jobs: {
    enabled: true,
    dir: "jobs",
    include: ["**/*.{ts,js,mjs,cjs,mts,cts}"],
    exclude: ["**/*.test.*", "**/*.spec.*"],
    runner: "inline",
    store: {
      type: "file",
      dir: ".vext/jobs",
    },
    scheduler: {
      enabled: true,
      mode: "inline",
      tickInterval: 1000,
      timezone: "UTC",
      misfirePolicy: "skip",
      maxCatchUp: 10,
      jitter: 0,
      lease: {
        enabled: true,
        ttl: 30000,
        renewInterval: 10000,
      },
    },
    worker: {
      enabled: true,
      concurrency: 4,
      shutdownTimeout: 10000,
      pollInterval: 1000,
      heartbeatInterval: 10000,
      lease: { ttl: 30000, renewInterval: 10000 },
    },
    defaults: {
      timeout: 30000,
      retry: { attempts: 1, delay: 0, backoff: "fixed" },
      concurrency: 1,
    },
  },
};
```

| 字段                                 | 默认值         | 说明                                                   |
| ------------------------------------ | -------------- | ------------------------------------------------------ |
| `jobs.enabled`                       | `true`         | 是否允许 Job 发现                                      |
| `jobs.dir`                           | `'jobs'`       | 相对 `src/` 的 Job 目录                                |
| `jobs.store.type`                    | `'file'`       | `memory`、`file`、`redis` 或 `auto`                    |
| `jobs.store.url` / `uri`             | `undefined`    | `redis` store 的连接地址                               |
| `jobs.store.namespace` / `keyPrefix` | 自动生成       | Redis key 隔离；默认按项目/profile/runtime/module 生成 |
| `jobs.store.dir`                     | `'.vext/jobs'` | file store 数据目录，相对项目根                        |
| `jobs.scheduler.mode`                | `'inline'`     | `inline` 到点直接执行，`enqueue` 只入队                |
| `jobs.scheduler.tickInterval`        | `1000`         | scheduler tick 间隔，毫秒                              |
| `jobs.scheduler.lease.ttl`           | `30000`        | scheduler lease 过期时间                               |
| `jobs.scheduler.lease.renewInterval` | `10000`        | scheduler lease 续期间隔，需小于等于 TTL               |
| `jobs.worker.concurrency`            | `4`            | worker 全局并发                                        |
| `jobs.worker.pollInterval`           | `1000`         | worker 轮询间隔，毫秒                                  |
| `jobs.worker.shutdownTimeout`        | `10000`        | 关闭时等待 running job 的时间                          |
| `jobs.worker.lease.renewInterval`    | `10000`        | run lease 续期间隔，需小于等于 TTL                     |
| `jobs.defaults`                      | 见示例         | Job 未声明 timeout/retry/concurrency 时的默认值        |
| `jobs.defaults.concurrency`          | `1`            | 单 Job 默认并发上限；worker 会按 Job 名称分别限制      |

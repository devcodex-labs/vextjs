# 任务与 Jobs

Vext Jobs 提供后台任务、定时调度和 worker 运行时。通过 `defineJob({ handler })` 声明任务，再明确选择手动运行、入队或定时调度。普通 HTTP 启动不会执行 Job，也不会启动 scheduler/worker。本页先完成一个任务的执行与结果验证，再介绍业务复用和部署。

## 先运行一个任务

前置条件：已完成[快速开始](/zh/guide/quick-start)的 TypeScript 项目，已安装 `vextjs`，package.json 使用 `"type": "module"`，具有 tsconfig 和 `build` 脚本。以下命令均在该项目根目录执行；无需启动 HTTP 服务。需要单独演练时先按快速开始创建新的 API-only 项目。

### 1. 创建配置与任务文件

在编辑器中创建 `src/jobs`。将以下配置合入现有 `src/config/default.ts`，保留其他需要的配置。示例使用本地 File Store，不需要数据库或 Redis；若现有项目启用了外部插件，应先确认它们的连接配置。

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  frontend: { enabled: false },
  logger: { level: "warn" },
  jobs: {
    store: { type: "file", dir: ".vext/jobs" },
    scheduler: { mode: "enqueue" },
    worker: { concurrency: 2 },
  },
} satisfies VextUserConfig;
```

```typescript
// src/jobs/greet.ts
import { defineJob } from "vextjs";

export default defineJob<{ name: string }, { message: string }>({
  name: "greet",
  payload: { name: "string!" },
  retry: false,
  handler: ({ payload, signal }) => {
    signal.throwIfAborted();
    return { message: `Hello, ${payload.name}!` };
  },
});
```

在项目根创建输入文件 `greet.payload.json`：

```json
{ "name": "Vext" }
```

### 2. 执行并查看结果

```bash
npx vext job list --source
npx vext job inspect greet --source --json
npx vext job run greet --source --payload-file greet.payload.json --json
npx vext job runs --source --limit 5 --json
```

list 应包含 `greet`；inspect 的 `hasPayloadSchema` 为 `true`；run 返回 `status: "success"`、`attempts: 1` 和 `result.message: "Hello, Vext!"`。runs 中能找到对应的运行记录。复制结果中的真实 `runId`，替换下方占位符后查询：

```bash
npx vext job status <runId> --source --json
```

另建 `invalid.payload.json`，内容为 `{}`，再执行相同 run 命令并改用这个文件。预期 `status: "failed"`、非空 `error`，进程退出码为 1；这证明缺失 name 被运行时 Schema 拒绝。TypeScript 泛型不会代替运行时输入校验。输入恢复后重新运行，应再次成功。

### 3. 入队，再由 worker 消费

```bash
npx vext job enqueue greet --source --payload-file greet.payload.json --json
```

返回记录的状态为 `queued`。在第二个终端、同一项目根启动：

```bash
npx vext job worker --source
```

回到第一个终端，用 enqueue 返回的 `id` 执行 status。等待轮询后应变为 `success`，结果仍是同一问候语。确认完成后在 worker 终端按 Ctrl+C 停止。入队不校验 payload；输入错误要到实际执行时才变成失败记录。

### 4. 验证构建产物

```bash
npm run build
npx vext job run greet --payload-file greet.payload.json --json
```

TypeScript 项目存在有效构建时，不带 `--source` 的 Job CLI 使用构建目录中的任务，结果应与源码运行一致。后续修改任务后重新 build，或在本地显式加 `--source`。Job CLI 当前始终以 production 模式加载配置；`--source` 只选择源码，不选择 development 配置。包括 list/inspect 在内的命令都会初始化插件和服务，可能连接它们配置的外部资源。

## 目录结构

```text
src/
  jobs/
    billing/close-invoice.ts
    emails/send-welcome.ts
```

`src/jobs/**` 是默认约定，不是强制规范。服务使用其他目录时可配置 `config.jobs.dir`。在 monorepo 中，每个 service root 拥有独立 registry，因此不同服务可以使用相同 Job 名称而不互相冲突。

默认发现 `.ts/.js/.mjs/.cjs/.mts/.cts` 文件，排除文件名以 `_` 开头的模块、`.d.ts`、`.test.*` 和 `.spec.*`；额外范围由 `jobs.include/exclude` 指定。被扫描的模块必须至少导出一个 `defineJob()` 值，可默认或具名导出；辅助模块放在扫描范围外。

显式 `name` 优先，否则 `billing/close-invoice.ts` 的默认导出推导为 `billing.close-invoice`，具名导出再追加 `.导出名`；`billing/index.ts` 推导为 `billing`。同一 registry 的名称冲突会阻止启动。显式名称只允许英文字母、数字、`_`、`.`、`:`、`-`，不能直接使用中文名称。

## 配置入口

Job 配置写在 `src/config/default.ts`、`src/config/production.ts` 或通过 `--config <profile>` 选择的 profile 中。Job runtime 复用配置、插件、服务等初始化能力，但没有普通 HTTP 启动的完整生命周期：不监听路由，也不触发 HTTP 的 onReady。各进程分别初始化自己的 app 和连接，`vext start`、`vext job scheduler`、`vext job worker` 的资源不能假定共享。

下面是需要调整重试、租约和并发时可合并到 default.ts 的配置片段；它把最大尝试次数改为 3，覆盖框架默认的 1 次。

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

默认 scheduler 为 inline、tickInterval 为 1000ms、时区为 UTC；默认 worker 总并发 4、轮询 1000ms，每个 Job 的进程内并发默认 1。单次尝试 timeout 默认 30000ms。Job 自身的 timeout/retry/concurrency 优先于 `jobs.defaults`。完整字段见 [Jobs API](/zh/api/jobs)。

`jobs.enabled: false` 停止加载任务，`schedule.enabled: false` 排除某个任务的自动调度。类型中存在的 `jobs.runner`、`scheduler.enabled`、`worker.enabled`、`worker.heartbeatInterval` 和 `queue.enabled` 当前未被对应执行流程用作切换开关；不要靠这些字段阻止显式 run/enqueue 或停止已启动进程。worker 在轮询循环中写 heartbeat。

## 定义 Job

下面是业务组合片段，文件可放在 `src/jobs/billing/close-invoice.ts`。它依赖应用已实现的 `billing` Service：`close(invoiceId, { signal })` 返回包含 `closed: boolean` 的结果；先按[服务指南](/zh/guide/services)实现接口并生成服务类型。若尚无账单业务，使用前面的 greet 示例即可。

```ts
import { defineJob } from "vextjs";

export default defineJob<{ invoiceId: string }, { closed: boolean }>({
  name: "billing.closeInvoice",
  payload: { invoiceId: "string!" },
  description: "关闭逾期账单。",
  tags: ["billing"],
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

这个例子适合 `vext job run`、`vext job enqueue` 或业务代码显式入队，因为它需要 `invoiceId`。内置 scheduler 创建 scheduled run 时不会自动携带业务 payload；定时任务应在 handler 内部推导待处理数据，或把到点逻辑拆成“扫描待处理记录并逐条入队”的 Job。

handler 可访问 `app`、`payload`、`logger`、`signal`、`attempt`、`runId` 和 Job 定义。它可以使用已初始化的 services、`app.db`、`app.fetch`、i18n、logger、config 和插件扩展，但不会收到 HTTP 请求或响应对象。长耗时任务应在入口/循环检查 signal，并传给明确支持取消的 I/O；不能假定所有数据库方法都接受 signal。

timeout 按每次尝试计时，只发送协作式取消信号，仍等待 handler 结束。停止 worker 的循环信号不会自动传给已领取 handler。`retry.attempts` 包含第一次执行；重试不回滚副作用，非法 payload 也会重新校验并消耗次数。状态和幂等边界见[任务与调度规范](/zh/specification/jobs#vext-job-005)。

## 定时任务

在前面的示例项目中新增完整文件，无需业务 Service：

```typescript
// src/jobs/heartbeat.ts
import { defineJob } from "vextjs";

export default defineJob({
  name: "heartbeat",
  schedule: {
    interval: 5_000,
    startAt: new Date(),
    misfirePolicy: "skip",
    singleton: true,
  },
  handler: () => ({ checkedAt: new Date().toISOString() }),
});
```

先运行 `npx vext job scheduler --source`，等待至少 5 秒后按 Ctrl+C 停止。执行 `npx vext job runs --source --json`，应找到 jobName 为 heartbeat、trigger 为 schedule、status 为 queued 的记录。再启动 `npx vext job worker --source`，用另一个终端查询原记录，确认变成 success 后停止 worker。这两步分别验证“到点入队”和“消费执行”；enqueue 模式少启动 worker 会一直 queued。

持续运行时 scheduler 与 worker 需要同时在线，并验证实际 Store 的并发与故障处理。startAt 在模块加载时确定，本例用于单 scheduler 演示；重启会重新确定起点。

interval 使用毫秒，需要稳定时间起点。改为 `30_000` 可设置 30 秒周期；多副本应使用一致且接近实际启用时间的固定起点，避免各进程生成不同周期。当前未指定 startAt 时每轮以 previousTick 为起点：interval 大于 tick 间隔可能一直不触发，不能省略起点或把它当作持久化计时器。

cron 用来表达日历计划，与 interval 二选一。下面是替换上述 schedule 字段的语法片段，六字段包含秒，表示 Asia/Shanghai 每天 08:00：

```ts
const schedule = {
  cron: "0 0 8 * * *",
  timezone: "Asia/Shanghai",
};
```

timezone 默认继承 `jobs.scheduler.timezone`。当前 cron 到期计算与所用 Croner 的秒边界处理存在不匹配：默认 1 秒轮询可能漏掉到期点；`skip/fire-once` 也不能保证选到窗口中最新的一次。不要仅凭表达式合法就依赖自动执行，先在实际部署环境验证触发和漏跑。本页首次调度流程使用上面的带起点 interval；日历任务需要评估修复或外部调度后再用于关键业务。

| 字段            | 用途                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `cron`          | 按 cron 表达式触发，适合日报、账单、清理任务                          |
| `interval`      | 按毫秒间隔触发，适合轮询和 flush                                      |
| `enabled`       | false 时跳过自动调度，不禁止手动执行                                  |
| `startAt/endAt` | 调度时间范围；interval 的 startAt 同时提供周期起点                    |
| `timezone`      | cron 时区，例如 `Asia/Shanghai`                                       |
| `misfirePolicy` | scheduler 暂停或错过 tick 后如何补偿：`skip`、`fire-once`、`catch-up` |
| `maxCatchUp`    | `catch-up` 最大补偿次数                                               |
| `jitter`        | 到点后随机延迟，避免多任务同时打爆依赖                                |
| `singleton`     | 为 schedule run 生成幂等键，避免同一时间点重复入队                    |

当前实现边界：`skip` 与 `fire-once` 都在进程内的 `previousTick` 窗口选择一次到期触发，重启不保证补齐全部停机时间。jitter 只调整记录的 `runAt`，inline 不会等待未来时间，Memory/File Store 可能因此拒绝领取；需要随机延迟时使用 enqueue + worker。详细约束见[任务与调度规范](/zh/specification/jobs#vext-job-003)。

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

以上为已安装 CLI 的命令速查；本地安装可在每条命令前加 `npx`。billing 示例要求已实现对应任务，`<runId>` 需替换为真实 ID。`--json` 输出命令结果 JSON，但插件/框架日志可能另行输出，不保证整个 stdout 可直接 JSON.parse。`--config <profile>` 选择配置 profile，`--outdir <dir>` 指定构建目录，`--source` 可在已有有效构建时仍读取源码。run/enqueue 均接受 `--payload-file <path>`；跨 Shell 使用输入文件可避免 JSON 引号转义差异。

`vext job run` 领取并执行任务，可按重试配置进行多次尝试，最终写入运行记录；非 success 结果退出码为 1。enqueue 创建 `queued` 记录，worker 轮询到期记录并执行。scheduler 根据 schedule 计算到期任务，再按 inline/enqueue 选择执行方式。CLI 没有 `--once` 选项；单轮程序接口见 [Jobs API](/zh/api/jobs)。

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

`memory` 适合进程内测试，退出丢失；两个CLI进程各有自己的内存，不能用它连接独立的 enqueue 与 worker。`file` 依靠同一目录的文件及目录锁协调，容器共享卷还必须验证底层锁/重命名语义。`redis` 用于跨进程/节点共享记录和租约，可配置 `jobs.store: { type: "redis", url: "redis://127.0.0.1:6379" }`，地址应替换为实际部署目标。`auto` 仍选择 Redis，缺少目标会报错，不会自动退回 File；目标可由 client、url/uri 或 `VEXT_REDIS_URL`/`REDIS_URL` 提供。

默认 Redis key 前缀包含项目包名、配置 profile、运行模式和模块；scheduler/worker 必须使用一致的目标和前缀才能看到同一队列。不同服务需要独立前缀，显式 `keyPrefix` 会改变默认隔离。内置 Store 的 payload/result 应为 JSON 可序列化值，运行记录没有自动保留期或清理 API，生产环境需规划容量管理。URL 创建的 Redis 连接随 Store 关闭，外部传入的 client 由调用方管理。自定义 Store 通过 `bootstrapJobRuntime({ store })` 注入，任意 `store.type` 字符串不会自动加载自定义适配器。

File Store 写盘、锁或重命名失败会向上抛错，worker/scheduler可能退出，并没有持续自动恢复保证。出现 `EPERM`、锁超时或队列停止推进时，先检查进程是否仍存活、目录权限与文件占用，再恢复进程并核对未完成记录；不要仅凭曾出现 ready 就认为任务仍在消费。

同任务的相同非空 idempotencyKey 会复用非 failed/cancelled 的记录，包括 success/timeout；相同 run ID 也会复用。复用不表示 `runtime.run()` 直接返回上次成功结果，已完成记录可能无法再次领取。singleton 只参与对应到期时间的去重，不保证同一 Job 的不同周期绝不重叠。

三个内置 store 都要求 `completeRun()` 只能由当前 running 记录的非空 owner 完成。完成会清除 run lease；缺失、queued、terminal、owner 不匹配或重复完成都会返回 `false`，并保持已有记录不变。租约过期后如果新 owner 已接管并完成，旧 owner 的迟到结果不会覆盖终态。这个保护只保证 store 中的最终记录不被旧 owner 覆写，不等于外部副作用严格执行一次；支付、发券、发邮件等仍需要业务唯一键、数据库唯一索引或第三方幂等键。

## 运行时边界

- `vext start` 和 HTTP cluster worker 默认不执行 Job，避免每个 HTTP worker 都触发同一任务。
- Scheduler 由 `vext job scheduler` 显式启动；开启 scheduler lease 且共享同一 Store 时，通过租约协调调度者。inline 长任务会阻塞后续调度和循环续租，应验证失租后的恢复。
- Worker 由 `vext job worker` 显式启动；共享 Store 的 run lease 协调领取，过期接管仍可能与忽略取消信号的旧 handler 重叠。每个 worker 遵守总并发和单个 Job 的进程内上限；直接并发调用 runtime.run 不受 worker 的这些上限约束。
- HTTP rolling restart 不会自动重启 Job scheduler/worker，部署系统应分别管理 HTTP、scheduler 和 worker。
- Job runtime 关闭时先调用 Store.close，再调用应用关闭流程；这不保证在途 handler 已排空。当前 CLI 收到停止信号会单独调用 runtime.close，worker的等待期限不会自动延后这次关闭，见[关闭边界](/zh/specification/jobs#vext-job-005)。

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

HTTP cluster 处理入站 HTTP 流量，不负责 Job。不要因启动 HTTP worker 就额外启动 scheduler；调度进程应独立管理并配置共享 Store/lease。单机可使用 systemd、PM2、Docker Compose 分别管理 HTTP、scheduler、worker。Kubernetes 可拆成三个 Deployment，scheduler 多副本须共享同一 Store 并验证租约接管行为。

Job handler 仍应按业务幂等设计。租约协调不能保证外部副作用只发生一次，例如支付、发券、发邮件和调用第三方 API。此类任务应使用业务唯一键、数据库唯一索引或外部服务幂等键，并处理“副作用已成功、完成记录尚未保存”的故障窗口。

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

`scheduler` 可以有多个副本做高可用，但它们必须共享同一个 store，且 `jobs.scheduler.lease.enabled` 应保持开启。`worker` 可以横向扩容，扩容前需要确认外部依赖的连接池、API 限流、数据库锁和 Job 自身幂等策略能承受并发。`file` store 只适合同机或共享卷；跨节点高可用应使用 Redis 或自定义数据库/队列 store。更高吞吐的队列系统仍不能替代业务幂等设计。

## 测试

单元测试可使用 `vextjs/testing` 的 `createTestJobRunner`。在前面的项目根创建 `test-greet.mjs`，用 `node test-greet.mjs` 执行；通过时退出码为0，断言失败则非0：

```js
// test-greet.mjs
import assert from "node:assert/strict";
import { defineJob } from "vextjs";
import { createTestJobRunner } from "vextjs/testing";

const runner = await createTestJobRunner({
  services: false,
  jobs: {
    greet: defineJob({
      payload: { name: "string!" },
      handler: ({ payload }) => ({ message: `Hello, ${payload.name}!` }),
    }),
  },
});

try {
  const result = await runner.run("greet", { payload: { name: "Vext" } });
  assert.equal(result.status, "success");
  assert.deepEqual(result.result, { message: "Hello, Vext!" });
  const invalid = await runner.run("greet", { payload: {} });
  assert.equal(invalid.status, "failed");
} finally {
  await runner.close();
}
```

需要隔离 Service 时可传 `mockServices`，方式见[测试指南](/zh/guide/testing)。这个 helper 验证执行层和输入校验，不创建持久化运行记录、不测试 worker/scheduler 租约。部署验收还需覆盖重试副作用、并发领取、失租、关闭超时和实际 Store 故障，不能只看单元测试成功。

## 常见问题

| 现象                        | 判断与处理                                                           | 恢复验证                                              |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| list 找不到任务或执行旧代码 | 检查扫描目录、导出和排除规则；TS项目用 --source 对比构建目录         | list/inspect 显示当前源文件；重新build后结果一致      |
| enqueue成功但始终queued     | 确认worker启动，且项目根/profile/Store/Redis前缀相同；排除两份memory | status出现running或success，检查error而非只看入队输出 |
| 定时任务没有触发            | 检查scheduler、schedule.enabled、时间范围；interval须明确起点        | runs中出现对应jobName与schedule触发记录               |
| run提示cannot be claimed    | 检查记录是否已终结、正被领取或尚未到runAt；检查幂等键和inline jitter | 核对原记录；修正触发策略后创建符合业务幂等的新任务    |
| timeout后仍有工作           | 超时仅中止signal，handler/I/O必须配合；进程停止不等于副作用回滚      | 测试取消传递、最终记录和外部结果                      |

## Docs source

启用 `openapi.docs.code.jobs` 后，Vext Docs 默认从 `src/jobs` 静态提取 Job 文档；修改 `jobs.dir` 时还需核对 Docs source 自己的 dir 配置。条目可包含名称、源文件、tags、timeout、concurrency、部分 schedule/queue、payload Schema 是否存在以及运行用法。

当前提取基于源码文本/JSDoc，不能完整求值动态配置，也不提取 retry 的完整运行合同；具名导出或计算名称需与 `vext job list/inspect` 的实际 registry 核对。MCP/生成配方有各自的分析入口，不能把静态文档条目当作已执行或已部署的证明。相关入口见 [MCP 代码生成](/zh/guide/mcp-generation)；任务约束见[任务与调度规范](/zh/specification/jobs)。

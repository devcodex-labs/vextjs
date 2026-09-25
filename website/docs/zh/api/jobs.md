# Jobs API

本页查阅 Job 定义、执行、调度、Store 和测试接口。除测试工具来自 `vextjs/testing`，下列函数均由 `vextjs` 主入口导出。首次执行和完整命令见[任务指南](/zh/guide/jobs)，行为约束见[任务与调度规范](/zh/specification/jobs)。

| 层次       | 入口                                   | 负责什么                                      |
| ---------- | -------------------------------------- | --------------------------------------------- |
| 定义与发现 | defineJob、loadJobs、createJobRegistry | 描述任务、扫描模块、建立名称索引              |
| 执行       | runJob、createJobRunner                | 输入校验、handler、重试与取消；不保存运行记录 |
| 应用运行时 | bootstrapJobRuntime                    | 初始化依赖，组合Store领取/续租/完成           |
| 调度与消费 | startJobScheduler、startJobWorker      | 生成到期记录或领取队列；须显式启动            |

参数表的“默认值”指正常应用配置合并后的有效默认。`defineJob()` 不会把所有默认配置复制进定义对象；直接构造低层 app/registry 时须自己提供所需配置。

## `defineJob(definition)`

签名：`defineJob<TPayload = unknown, TResult = unknown>(definition: VextJobDefinitionInput<TPayload, TResult>): VextJobDefinition<TPayload, TResult>`。

创建带识别标记的浅冻结定义，不执行handler、不入队。非法handler、名称、字段形态或互斥schedule会同步抛出Error；payload DSL在运行时编译，不以定义创建成功作为输入合同已验证的证明。静态Docs/MCP提取也不等于执行此函数。

以下可作为独立任务文件`src/jobs/greet.ts`：

```ts
import { defineJob } from "vextjs";

export default defineJob<{ name: string }, { message: string }>({
  name: "greet",
  description: "返回问候语。",
  tags: ["example"],
  payload: { name: "string!" },
  queue: { priority: 5 },
  timeout: 10_000,
  retry: { attempts: 3, delay: 500, backoff: "exponential" },
  handler: ({ payload }) => ({ message: `Hello, ${payload.name}!` }),
});
```

`name` 是可选字段。不声明时，Vext 会根据文件路径推导 Job 名称，例如 `src/jobs/billing/close.ts` 会成为 `billing.close`。

`isVextJobDefinition(value: unknown): value is VextJobDefinition` 只检查对象标记与handler函数，不重新校验所有字段。浅冻结不代表嵌套schedule/payload/retry对象不可变。

带必填业务 payload 的 Job 应通过 `vext job run`、`vext job enqueue` 或业务代码显式入队。内置 scheduler 创建 scheduled run 时不会自动携带 payload；定时 Job 应在 handler 中自行查询待处理数据，或只把扫描任务定时化。

## 核心类型

| 类型                   | 用途                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `VextJobDefinition`    | defineJob返回的任务定义；泛型描述payload/result，不生成运行时Schema。         |
| `VextJobContext`       | handler上下文，包含app/job/payload/logger/signal/attempt/runId。              |
| `VextJobRegistry`      | 名称索引，提供list/get/has/toJSON；没有增删API，但返回对象不是深冻结副本。    |
| `VextJobRunnerAdapter` | 导出的扩展类型；当前没有通过jobs.runner自动注册/加载实现的机制。              |
| `VextJobRunRecord`     | store 中保存的运行记录，包含 trigger、status、attempts、duration 和错误摘要。 |
| `VextJobStore`         | scheduler、worker 与 CLI 共享运行状态的 store 合同。                          |
| `VextJobRunResult`     | `runJob` 和测试 helper 返回的执行结果。                                       |
| `VextJobsConfig`       | `config.jobs` 配置形态。                                                      |

VextJobRunnerAdapter类型含name、start(runtime)，可选stop()和enqueue(name,payload,options)；start接收的VextJobWorkerRuntime含app/registry/store/run/close/signal。这是供显式集成使用的类型合同，当前运行时没有自动实例化它的注册表。

### 发现与Registry

| 函数                                                         | 参数与返回                                                                | 边界                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `loadJobs(options)`                                          | `{rootDir, srcDir, config?: VextJobsConfig}` → `Promise<VextLoadedJob[]>` | enabled=false返回空；导入模块会执行顶层代码；导入失败或没有Job导出时抛VextJobDefinitionError |
| `resolveJobsDirectory(sourceBase, directory?, projectRoot?)` | 字符串路径，directory默认jobs → `string`                                  | 有projectRoot时按项目目录合同映射源码/构建目录；不创建目录                                   |
| `createJobRegistry(jobs)`                                    | `VextLoadedJob[]` → `VextJobRegistry`                                     | 重名抛VextJobDuplicateNameError；list按名称排序、返回新数组，成员引用仍共享                  |

`VextLoadedJob` 包含name、definition、sourceFile、sourcePath和exportName。registry.get不存在时返回undefined，has返回boolean；toJSON只投影元数据，不包含handler，hasPayloadSchema仅表示定义存在payload字段。发现规则和推导名见[目录结构](/zh/guide/jobs#目录结构)。

### handler上下文

| 字段    | 类型/语义                                                        |
| ------- | ---------------------------------------------------------------- |
| app     | 当前Job应用实例；没有HTTP请求或响应上下文                        |
| job     | 当前Job定义；推导名位于registry，job.name可能仍为undefined       |
| payload | TPayload；有Schema时为校验结果数据，无Schema时为原输入           |
| signal  | 每次尝试的AbortSignal，关联超时和调用方取消；须由handler/I/O配合 |
| attempt | 从1开始的当前尝试序号                                            |
| runId   | 本次执行ID；重试共用同一ID                                       |
| logger  | 应用logger的子logger，附带job名称与runId                         |

## `bootstrapJobRuntime(options)`

启动 headless Job runtime。它会加载 config、i18n、内置数据库插件、用户插件、services、Job registry 和 Job store，但不会解析 HTTP adapter、注册路由或监听端口。

签名：`bootstrapJobRuntime(options?: BootstrapJobRuntimeOptions): Promise<VextJobRuntime>`。数据库插件按配置决定是否加载；不会触发HTTP onReady。

| options       | 默认值           | 用途                                                 |
| ------------- | ---------------- | ---------------------------------------------------- |
| rootDir       | process.cwd()    | 项目根                                               |
| built         | false            | true时从构建目录加载；程序API不会自行检测有效dist    |
| outDir        | 项目构建位置     | 自定义构建输出路径                                   |
| configProfile | undefined        | 配置profile，独立于mode                              |
| mode          | production       | production/development/test；CLI固定production       |
| store         | 按jobs.store创建 | 注入VextJobStore；runtime调用其init及close（若提供） |

| runtime成员               | 签名/返回                                                          | 语义                                                                    |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| app/config/registry/store | 对应应用、配置、索引与Store                                        | 配置已完成归一化/冻结                                                   |
| enqueue                   | `(name, options?) → Promise<VextJobRunRecord>`                     | 校验名称存在后入队，不校验业务payload                                   |
| run                       | `(name, options?) → Promise<VextJobRunResult>`                     | 创建或复用记录、领取、续租、执行、提交结果                              |
| listRuns                  | `(options?: VextJobListRunsOptions) → Promise<VextJobRunRecord[]>` | 可按jobName/status过滤及limit截取；内置Store默认limit50，CLI runs默认20 |
| getRun                    | `(runId: string) → Promise<VextJobRunRecord \| undefined>`         | 查询，不存在返回undefined                                               |
| close                     | `() → Promise<void>`                                               | 先Store.close，再应用shutdown；须在任务停止/完成后由调用方安排          |

使用已有指南中的greet任务时，可在项目根新建`run-greet.mjs`，执行`node run-greet.mjs`；默认从src加载production配置：

```js
// run-greet.mjs
import { bootstrapJobRuntime } from "vextjs";

const runtime = await bootstrapJobRuntime({ rootDir: process.cwd() });
try {
  const result = await runtime.run("greet", { payload: { name: "Vext" } });
  console.log(result.status, result.result);
  if (result.status !== "success") process.exitCode = 1;
} finally {
  await runtime.close();
}
```

正常结果为success与问候对象。未知任务、领取失败或Store异常会拒绝Promise；普通handler失败通常作为result.status返回。run的handler返回与Store接受完成是两件事，失去owner时完成可能被拒绝并记录警告。close不是排空接口；Store.close抛错时当前实现不会继续应用shutdown，调用方需处理失败与资源回收。初始化过程失败也不能假定已打开的外部资源全部回滚。

## `runJob(app, registry, name, options)`

通过 inline runner 执行一个 Job。Job 声明 `payload` schema 时，会复用 app validator 做 payload 校验。底层 `runJob()` 不直接创建 store run record；CLI 和 `bootstrapJobRuntime()` 返回的 runtime 会在执行前后写入 store。

签名：`runJob(app: VextApp, registry: VextJobRegistry, name: string, options?: VextJobRunOptions): Promise<VextJobRunResult>`。`createJobRunner({ app, registry })` 返回`{ run(name, options?) }`，只是绑定前两个参数；它不初始化应用、不加worker并发限制，也不取得run lease。

### 运行选项

| VextJobRunOptions字段 | 类型                    | 适用边界                                                |
| --------------------- | ----------------------- | ------------------------------------------------------- |
| payload               | unknown                 | 泛型不校验此入口；Runner按Job声明的Schema逐次校验       |
| signal                | AbortSignal             | run时关联取消；enqueue不保存signal                      |
| runId                 | string                  | 低层Runner默认UUID；runtime用作记录ID，已有记录会复用   |
| trigger               | manual/schedule/enqueue | 记录来源；runtime.run默认manual、enqueue默认enqueue     |
| scheduledAt           | Date/string             | 记录的计划时间，不等于设置未来runAt                     |
| idempotencyKey        | string                  | runtime选项优先于Job定义，Store去重；低层Runner不处理   |
| ownerId               | string                  | 内部已领取路径使用；业务通常省略，不用于绕过Store所有权 |

`runtime.enqueue()`没有runAt选项；需要指定未来可领取时间时使用Store.enqueueRun的runAt并承担低层合同。scheduledAt只是元数据。runtime.run通过runId复用记录时仍须选择相同任务，不要把一个Job的记录ID交给另一Job。

### 结果、错误与取消

`VextJobRunResult<TResult>` 包含jobName、runId、status、attempts、durationMs，以及可选result/error。durationMs包括本次调用的尝试和重试等待；记录中的error为字符串摘要，Runner结果的error为原生对象/包装错误。查询记录还有queued/running，执行结果只有以下四种状态：

| status    | 当前判断                                        |
| --------- | ----------------------------------------------- |
| success   | handler正常返回且signal未中止                   |
| cancelled | signal已中止，但handler正常返回；仍可能含result |
| timeout   | signal已中止且执行抛错，也可能源于调用方取消    |
| failed    | 最终错误且signal未中止                          |

timeout按每次尝试计时，不强制终止handler；预先中止signal也不保证不进入handler。payload每次尝试重新校验，null/undefined输入在有Schema时以空对象校验。retry.attempts包括首次执行，retry=false只尝试1次；delay为数值时支持fixed/exponential，指数为`2 ** (attempt - 1)`，函数delay收到失败的attempt和error，不再叠加指数。

Job声明的retry对象整体优先于jobs.defaults.retry，不逐字段继承。函数delay可用于defineJob；尽管配置类型复用同一retry类型，当前应用配置校验只接受数字形式的jobs.defaults.retry.delay，不能把函数放进该配置字段。

payload失败结果带VextJobPayloadValidationError及errors；普通执行错误包装为VextJobExecutionError（jobName/runId/cause）。未知任务和重试delay函数自身抛错等路径仍可能直接reject。VextJobShutdownError虽已导出，当前关闭流程不会自动把所有关闭失败包装成它。

## `startJobScheduler(runtime, options)`

签名：`startJobScheduler(runtime: VextJobRuntime, options?: StartJobSchedulerOptions): Promise<void>`。先处理scheduler lease，再筛选有效schedule并计算到期时间、创建记录。`config.jobs.scheduler.mode = "inline"` 时直接执行并等待；`"enqueue"` 时只入队，由worker执行。

Scheduler lease 通过 `jobs.scheduler.lease.ttl` 控制持有时间，通过 `jobs.scheduler.lease.renewInterval` 控制续期间隔。未拿到 lease 时不推进进程内窗口；游标不持久保存，不能据此承诺重启补齐。interval起点、cron秒边界与jitter限制见[任务与调度规范](/zh/specification/jobs#vext-job-003)。

options支持`ownerId`、`signal`与`once`；once只进行一次调度循环。直接调用`tickJobScheduler()`不代替scheduler lease协调。

ownerId省略时生成包含PID与UUID的标识；signal用于停止循环，once默认false。轮询、Store或inline执行错误可以使Promise拒绝；续租在循环内进行，长任务会拖延续租。租约与停止的详细边界见规范，不承诺异常路径一定释放租约。

### 调度计算与单次tick

| 入口                                  | 参数与返回                                                                                         | 限制                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `tickJobScheduler(runtime, options?)` | options含ownerId/now/previousTick → `Promise<number>`                                              | 返回处理的到期次数，不一定是新增记录数；不取得scheduler lease                                               |
| `resolveJobDueTimes(options)`         | schedule必填，now/previousTick/defaultTimezone/defaultMisfirePolicy/defaultMaxCatchUp可选 → Date[] | 纯到期计算，不执行；enabled=false或当前时间超出范围返回空；窗口及cron/interval限制仍适用                    |
| `getNextJobRunTime(options)`          | schedule必填，from/defaultTimezone可选 → Date或undefined                                           | 预测下一次；无有效schedule或enabled=false返回undefined；不保证应用startAt/endAt的全部范围限制，不代表已调度 |

scheduled run没有业务payload，ID由任务名和到期时间组成；jitter调整runAt，singleton增加相同时间点的幂等键，不是整个Job的跨周期互斥锁。

## `startJobWorker(runtime, options)`

启动 worker 轮询循环。worker 会 heartbeat、领取到期queued记录、执行Job并写回结果。run lease协调所有权，过期接管可能与忽略取消信号的旧handler重叠，不能保证副作用只执行一次。

签名：`startJobWorker(runtime: VextJobRuntime, options?: StartJobWorkerOptions): Promise<void>`。ownerId省略时生成PID/UUID标识，once默认false。正常返回表示循环及有期限等待结束，不保证所有外部工作均结束；领取、心跳等Store错误可使Promise拒绝。

options支持`ownerId`、`signal`与`once`；once完成一轮按当前容量领取后等待，不保证排空整个队列。signal用于停止循环，不自动取消已领取handler。shutdownTimeout限定等待期限；CLI资源关闭顺序见[关闭边界](/zh/specification/jobs#vext-job-005)。

Worker 认领 run 时会同时检查当前 worker 进程内并发和单 Job 并发：进程内上限来自 `jobs.worker.concurrency`，单 Job 上限来自 `defineJob({ concurrency })`，未声明时使用 `jobs.defaults.concurrency`，最低为 `1`。

## `createJobStore(options)`

根据 `config.jobs.store` 创建内置 store。`memory` 为进程内状态；`file` 默认持久化到`.vext/jobs`，共享使用须验证文件系统锁/重命名与错误处理。`redis`用于共享记录和租约。`auto`仍选择Redis，目标可由client、url/uri或`VEXT_REDIS_URL`/`REDIS_URL`提供；缺目标会报错，不回退File。

签名：`createJobStore(options: CreateJobStoreOptions): VextJobStore`，options包含必填rootDir，以及可选config（VextJobsConfig，不是整个VextConfig）、configProfile、runtimeMode。工厂不自动await store.init；bootstrapJobRuntime负责调用。未知type抛错，自定义实现通过bootstrap的store参数注入。

| 直接工厂                       | options                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| createMemoryJobStore(options?) | 可选now: () => Date；进程退出丢失                                                                  |
| createFileJobStore(options)    | 必填rootDir，可选dir/now；dir相对rootDir，默认.vext/jobs                                           |
| createRedisJobStore(options?)  | 可选rootDir/configProfile/runtimeMode/now及client/url/uri/namespace/keyPrefix；必须能解析Redis目标 |

Redis URL优先级为url→uri→VEXT_REDIS_URL→REDIS_URL，外部client优先使用；自行创建的客户端由Store.close关闭，外部client不关闭。使用同一目标且前缀一致才能共享队列。File/Redis记录不会自动过期清理，输入/结果应可JSON序列化；文件锁/写盘或Redis连接错误按实际调用抛出，不提供统一的自动恢复保证。

### Store合同与运行记录

| 方法                                      | 参数与返回                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| init/close（可选）                        | `() → void或Promise<void>`                                             |
| acquireSchedulerLease/renewSchedulerLease | `(ownerId, ttl, now?) → Promise<boolean>`                              |
| releaseSchedulerLease                     | `(ownerId) → Promise<void>`                                            |
| enqueueRun                                | `(input: VextJobStoreEnqueueInput) → Promise<VextJobRunRecord>`        |
| claimNextRun                              | `({ownerId, now?, leaseTtl?, jobNames?}) → Promise<record或undefined>` |
| claimRun                                  | `(runId, {ownerId, now?, leaseTtl?}) → Promise<record或undefined>`     |
| renewRunLease                             | `(runId, ownerId, leaseTtl, now?) → Promise<boolean>`                  |
| completeRun                               | `(runId, patch, {ownerId}?) → Promise<boolean>`                        |
| getRun/listRuns                           | 查询同runtime对应方法；list过滤jobName/status/limit                    |
| heartbeatWorker                           | `(ownerId, now?) → Promise<void>`                                      |

Store还有只读type字符串。enqueueRun的必填项为jobName和trigger；可选id、payload、runAt、scheduledAt、priority、idempotencyKey、source。它不检查registry或payload Schema。completeRun的patch可写status、attempts、durationMs、finishedAt、result、error、updatedAt；业务通常应使用runtime而非直接拼装终态。

VextJobRunRecord包括id/jobName/status/trigger、runAt/createdAt/updatedAt、attempts；可选payload/priority、scheduledAt/startedAt/finishedAt/durationMs、result/error、leaseOwner/leaseUntil、idempotencyKey/source。时间戳为字符串，状态含queued/running及四种执行结果。内置Store的listRuns按createdAt倒序，默认limit50；不提供分页游标或删除/保留期API。

同ID会复用原记录；同任务非空idempotencyKey会复用非failed/cancelled记录（包括success/timeout）。复用不能保证再次runtime.run可领取，更不等于缓存返回上次结果。Memory/File的claimRun会检查未来runAt，当前Redis的直接claimRun没有同样的未来时间等待保证；普通worker经claimNextRun领取，不能把两接口互换。

内置 store 的 `completeRun(runId, patch, { ownerId })` 只接受当前 running 记录的非空 owner。完成后会清除 lease；缺失、queued、terminal、owner 不匹配或重复完成返回 `false`，不会覆盖已有终态。handler 本身仍按至少一次执行设计，外部副作用需要业务幂等。

## 测试 API

`vextjs/testing` 导出 `createTestJobRunner(options)`。它会创建测试 app，注册传入的 Job 定义，并提供 `run(name, options)` 与 `close()`。

签名：`createTestJobRunner(options: CreateTestJobRunnerOptions): Promise<TestJobRunner>`。jobs必填，类型为名称→定义的对象或定义数组；数组无name时使用job1/job2等名称，对象优先使用定义自带name。其他选项沿用CreateTestAppOptions并排除routes；框架强制routes=false。

返回app、registry、run与close。此helper使用传入的定义，不扫描src/jobs、不写运行记录或测试Store租约。可用services=false配合mockServices隔离业务依赖，完成后finally close。完整正负断言例见[任务指南测试段](/zh/guide/jobs#测试)。

## Job 定义字段

| 字段             | 类型                      | 默认值                             | 说明                                   |
| ---------------- | ------------------------- | ---------------------------------- | -------------------------------------- |
| `name`           | `string`                  | 由文件路径推导                     | Job 名称，同一 service root 内必须唯一 |
| `description`    | `string`                  | `undefined`                        | 文档说明                               |
| `tags`           | `string[]`                | `undefined`                        | 文档和筛选标签                         |
| `docs`           | `object`                  | `undefined`                        | 面向 Vext Docs / MCP 的说明补充        |
| `payload`        | `Record<string, unknown>` | `undefined`                        | 应用当前Validator校验，默认schema-dsl  |
| `schedule`       | `VextJobScheduleConfig`   | `undefined`                        | 内置 scheduler 配置                    |
| `queue`          | `VextJobQueueConfig`      | `undefined`                        | 入队优先级等队列元数据                 |
| `timeout`        | `number`                  | `config.jobs.defaults.timeout`     | 单次尝试超时，毫秒；协作式取消         |
| `retry`          | `false \| object`         | `config.jobs.defaults.retry`       | 重试次数、延迟和退避策略               |
| `concurrency`    | `number`                  | `config.jobs.defaults.concurrency` | 单worker内Job并发上限；不限制直接run   |
| `idempotencyKey` | `string \| function`      | `undefined`                        | 手动/入队任务的业务幂等键              |
| `handler`        | `function`                | 必填                               | Job 执行函数                           |

docs包含可选summary/description/tags，仅作为元数据。queue包含可选priority和enabled；priority为非负整数（数值越高越优先，仍受Store候选范围影响），enabled当前未被运行流程用作阻止入队开关。idempotencyKey函数接收`{ jobName, payload }`，可返回string/undefined/null；它不替代业务唯一约束。字段不适用时应省略，不用timeout=0或concurrency=0表达关闭（defineJob会拒绝）。

## Schedule 字段

| 字段            | 类型                                  | 默认值                                | 说明                                    |
| --------------- | ------------------------------------- | ------------------------------------- | --------------------------------------- |
| `enabled`       | `boolean`                             | `true`                                | 是否启用该 Job 的定时调度               |
| `cron`          | `string`                              | `undefined`                           | 秒级 cron 表达式                        |
| `interval`      | `number`                              | `undefined`                           | 毫秒间隔；不能与 `cron` 同时配置        |
| `timezone`      | `string`                              | `config.jobs.scheduler.timezone`      | cron 时区                               |
| `startAt`       | `string \| Date`                      | `undefined`                           | 起始时间                                |
| `endAt`         | `string \| Date`                      | `undefined`                           | 结束时间                                |
| `misfirePolicy` | `'skip' \| 'fire-once' \| 'catch-up'` | `config.jobs.scheduler.misfirePolicy` | 错过 tick 后如何补偿                    |
| `maxCatchUp`    | `number`                              | `config.jobs.scheduler.maxCatchUp`    | 最大补偿次数                            |
| `jitter`        | `number`                              | `config.jobs.scheduler.jitter`        | 到点后的随机延迟毫秒数                  |
| `singleton`     | `boolean`                             | `false`                               | 同一 scheduled fire time 只允许一个 run |

## 配置

以下为合入`src/config/default.ts`的配置参考。runner、scheduler.enabled、worker.enabled和worker.heartbeatInterval目前只有类型/配置校验，没有在对应执行循环中发挥切换/独立心跳作用；设置enabled=true也不会随HTTP自动启动任务。用显式命令启动进程，用signal/进程管理停止，用jobs.enabled控制加载、schedule.enabled控制某任务调度。

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

| 字段                                 | 默认值                 | 说明                                                     |
| ------------------------------------ | ---------------------- | -------------------------------------------------------- |
| `jobs.enabled`                       | `true`                 | 是否允许 Job 发现                                        |
| `jobs.dir`                           | `'jobs'`               | 相对 `src/` 的 Job 目录                                  |
| `jobs.include`                       | 默认六类源码扩展名glob | 替换发现范围；任务导出规则仍适用                         |
| `jobs.exclude`                       | 无额外项               | 追加到内置下划线文件/声明文件/test/spec排除规则          |
| `jobs.runner`                        | `'inline'`             | 当前不自动选择或加载runner                               |
| `jobs.store.type`                    | `'file'`               | `memory`、`file`、`redis` 或 `auto`                      |
| `jobs.store.url` / `uri`             | `undefined`            | `redis` store 的连接地址                                 |
| `jobs.store.client`                  | undefined              | 外部Redis兼容客户端，优先于URL；连接生命周期由提供方管理 |
| `jobs.store.namespace` / `keyPrefix` | 自动生成               | Redis key 隔离；默认按项目/profile/runtime/module 生成   |
| `jobs.store.dir`                     | `'.vext/jobs'`         | file store 数据目录，相对项目根                          |
| `jobs.scheduler.mode`                | `'inline'`             | `inline` 到点直接执行，`enqueue` 只入队                  |
| `jobs.scheduler.enabled`             | true                   | 当前不作为startJobScheduler的执行开关                    |
| `jobs.scheduler.tickInterval`        | `1000`                 | scheduler tick 间隔，毫秒                                |
| `jobs.scheduler.timezone`            | UTC                    | Job未设置时的cron时区                                    |
| `jobs.scheduler.misfirePolicy`       | skip                   | 进程内窗口策略，实际边界见规范003                        |
| `jobs.scheduler.maxCatchUp`          | 10                     | 默认补跑上限                                             |
| `jobs.scheduler.jitter`              | 0                      | 默认随机延迟上界，毫秒；inline限制见规范003              |
| `jobs.scheduler.lease.enabled`       | true                   | false跳过scheduler lease协调                             |
| `jobs.scheduler.lease.ttl`           | `30000`                | scheduler lease 过期时间                                 |
| `jobs.scheduler.lease.renewInterval` | `10000`                | 循环中续租间隔，运行时取与TTL的较小值；应给足续租余量    |
| `jobs.worker.enabled`                | true                   | 当前不作为startJobWorker的执行开关                       |
| `jobs.worker.concurrency`            | `4`                    | 单个 worker 进程内并发                                   |
| `jobs.worker.pollInterval`           | `1000`                 | worker 轮询间隔，毫秒                                    |
| `jobs.worker.shutdownTimeout`        | `10000`                | worker循环结束后的等待上限；不取消handler或延后CLI关闭   |
| `jobs.worker.heartbeatInterval`      | 10000                  | 当前未用作独立心跳周期，实际在worker轮询循环写入         |
| `jobs.worker.lease.ttl`              | 30000                  | run lease持有时间，毫秒                                  |
| `jobs.worker.lease.renewInterval`    | `10000`                | run续租计时器间隔，运行时取与TTL的较小值                 |
| `jobs.defaults`                      | 见示例                 | Job 未声明 timeout/retry/concurrency 时的默认值          |
| `jobs.defaults.concurrency`          | `1`                    | 单 Job 默认并发上限；worker 会按 Job 名称分别限制        |

调度/worker的数值时间单位均为毫秒；应用配置校验要求tick/poll/shutdown/lease和并发等为正整数，jitter为非负整数。字段合法不代表外部Store可连接、cron可靠触发或业务幂等已成立。详细操作、实际实现限制和恢复观察见[任务指南](/zh/guide/jobs)。

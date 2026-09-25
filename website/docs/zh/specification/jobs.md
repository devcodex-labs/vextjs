# 任务与调度规范

本页规定 Job 定义、执行、调度、队列及运行记录的边界。完整命令和配置见[任务与 Jobs](/zh/guide/jobs)，类型与接口见 [Jobs API](/zh/api/jobs)。

## 定义和执行入口

<a id="vext-job-001"></a>

### VEXT-JOB-001 [MUST] 使用任务入口加载和运行 Job

Job 通过 `defineJob()` 声明，由默认 `src/jobs` 或 `config.jobs.dir` 指定目录发现。支持默认导出或具名导出的 Job；同一注册表中的任务名称必须唯一。

普通 HTTP 启动不会自动运行这些任务，也不会因为存在 `schedule` 字段就启动 scheduler。使用 `vext job run`、`vext job enqueue`、`vext job scheduler`、`vext job worker` 或对应程序接口明确选择执行方式。Job runtime 初始化任务需要的配置、插件、服务及 Store，不启动普通 HTTP 路由监听。

`runJob()` / `createJobRunner()` 是执行层，不自动写 Store 记录或取得 run lease；`bootstrapJobRuntime()` 返回的 `runtime.run()` 才组合入队记录、领取、续租与完成。`createTestJobRunner()` 主要验证执行层，不能用它的成功结果代替持久化/多 worker 验证。

CLI 即使执行 list/inspect 也会初始化 Job runtime，可能打开配置中的外部连接。命令当前按 production 模式加载配置；`--source` 改变源码/构建产物选择，不把运行模式切换为 development。执行前应明确项目根、profile、实际 Store 与依赖目标。

handler 接收 `app`、`job`、`payload`、`signal`、`attempt`、`runId` 和 `logger`。它没有 HTTP 请求和响应上下文，业务复用宜通过 Service 或显式函数完成。

<a id="vext-job-002"></a>

### VEXT-JOB-002 [MUST] payload 校验与业务结果分别处理

声明 `payload` Schema 时，Runner 在执行 handler 前使用应用当前 Validator 校验输入；未声明时不自动补充结构约束。校验失败属于任务运行失败，不能套用 HTTP 的 400/422 响应承诺。

`runtime.enqueue()` 不在入队时执行 payload Schema 校验；queued 不表示输入有效。重试时每次执行都会重新校验，非法 payload 也可能消耗配置的尝试次数。默认 scheduler 不自动提供业务 payload，依赖必填输入的任务应由业务显式入队，或改为在定时 handler 中扫描待处理数据。

校验通过仍须判断授权、业务状态、并发约束和外部副作用。任务返回的结果、运行状态与最终存储记录各有含义，监控不能只看 handler 返回了一个值。

## 调度、队列与存储

<a id="vext-job-003"></a>

### VEXT-JOB-003 [MUST] 明确区分调度器、执行器与共享 Store

Scheduler 根据 cron/interval 计算到期时间。默认 `inline` 模式由 scheduler 直接运行；`enqueue` 模式写入待执行记录，由显式启动的 worker 领取。遗漏 worker 时，入队成功不代表任务已经执行。

多个 scheduler 需要共享相同 Store，并使用 scheduler lease 协调；关闭 lease 会改变多副本行为。任务 schedule 的时区、补跑策略（`skip` / `fire-once` / `catch-up`）、`maxCatchUp` 和 jitter 应按实际部署核对，不能仅测试正常单次触发。

当前补跑只基于进程内的 `previousTick` 窗口，不持久保存停机前的调度游标；重启不保证补齐整个停机期间。`skip` 和 `fire-once` 当前都从该窗口选择一次到期触发，不能把 `skip` 描述为“丢弃所有错过的执行”。`catch-up` 受 `maxCatchUp` 限制。

当前 interval 未指定 startAt 时以每次 previousTick 重新作为起点；interval 大于轮询间隔可能持续没有到期任务。需要 interval 时显式提供稳定起点并验证实际周期，多副本使用同一起点。当前 cron 到期计算与所用 Croner 的秒边界处理不匹配，默认1秒tick可能漏触发；其返回次序还使skip/fire-once不保证选到窗口最新一次。不能仅因 defineJob 接受配置就认为周期行为已经验证，关键日历任务须先评估这些边界。

inline 模式会等待任务返回后再继续调度，scheduler lease 的续租也在循环中进行；长任务可能延迟其他任务和续租。需要持续调度时，优先采用 enqueue + worker，并验证失租与恢复。jitter 只调整记录的 `runAt`，inline 不会自动等待未来时间：Memory/File Store 可能拒绝领取该记录；需要随机延迟时使用 enqueue 模式及 worker，不能宣称所有模式都可靠延迟执行。

| Store            | 当前边界                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `memory`         | 进程内状态，退出丢失；适合测试与演示                                                     |
| `file`（默认）   | 默认 `.vext/jobs`，依赖同一文件存储及其锁语义                                            |
| `redis` / `auto` | 需要明确 Redis 目标与一致的键前缀；`auto` 不能在缺目标时假定可用                         |
| 自定义           | 通过程序 runtime API 提供符合 Store 合同的实现；任意 `store.type` 字符串不会自动加载插件 |

跨主机部署应使用已验证的共享存储方案；不能因两个进程都配置 `file` 就认为它们共享了运行记录。

内置 Store 以 JSON 记录 payload 和结果，应用应提供可序列化值；记录没有自动保留期或清理策略，需安排容量管理。File Store 的目录锁和重命名依赖底层文件系统语义，不等于通用分布式事务。由 Redis URL 创建的客户端随 Store 关闭，外部传入的 client 由提供方管理；注入自定义 Store 时，runtime.close() 仍会调用其 close（若提供）。

<a id="vext-job-004"></a>

### VEXT-JOB-004 [MUST] 区分进程并发限制与租约所有权

Worker 的 `jobs.worker.concurrency` 控制该 worker 的总并发，Job 的 `concurrency` 或 `jobs.defaults.concurrency` 控制该 worker 内的单任务并发。它们不直接表示整个集群的并发总量。

该限额由 worker 的领取循环实现，不会自动限制多个直接调用 `runtime.run()` / `runJob()` 的并发。需要跨进程总额度时，应单独实现并验证协调策略。

Store 通过 run lease 协调领取；runtime 续租并在失去所有权时发送取消信号。租约不能停止已发生的外部副作用，也不能强制终止忽略信号的 handler，因此不能将其描述为严格只执行一次。

三个内置 Store 的 `completeRun()` 要求记录当前处于 running 且 owner 匹配。queued、已结束、缺失 owner、错误 owner 或重复完成返回 `false` 并保留原记录。旧 owner 的迟到完成不能覆盖新 owner 的终态；runtime 对被拒绝的完成记录警告，handler 返回结果不等于完成记录已被接受。

## 超时、重试与幂等

<a id="vext-job-005"></a>

### VEXT-JOB-005 [MUST] 将超时视为协作式取消信号

Job `timeout` 使用毫秒，每次尝试分别建立计时器，不是包含所有重试的整次运行总期限。达到时间后 Runner 中止传给 handler 的 `signal`，但仍等待 handler 返回或抛出；不会强杀 JavaScript 函数。handler 应把 signal 传给支持取消的 I/O，并在入口和长循环中检查取消；调用前 signal 已中止也不保证 Runner 完全不进入 handler。

当前结果判定中，signal 已中止而 handler 正常返回时为 `cancelled`，中止后抛出时为 `timeout`；这个状态也可能来自调用方取消，不能仅凭名称推断唯一原因。未取消的最终异常为 `failed`。

Worker 停止领取后只在 `shutdownTimeout` 期限内等待进行中的任务；其停止循环信号不会自动成为每个已领取 handler 的取消信号。应用不能将 worker 退出视为所有外部工作已停止，应验证任务自己的取消、连接关闭和业务恢复路径。

上面的等待期限是 `startJobWorker()` 的返回行为。当前 CLI 收到停止信号会另外调用 `runtime.close()`，没有先等待所有 handler 完成再关 Store 的保证。程序化接入应明确“停止领取→等待或取消任务→关闭资源”的顺序，并处理超期任务；不能把普通 HTTP 的关闭流程完整套用为 Job 的排空承诺。

<a id="vext-job-006"></a>

### VEXT-JOB-006 [SHOULD] 为重试与重复投递设计业务幂等

`retry.attempts` 是包括首次执行的最大尝试次数；`retry: false` 只尝试一次。重试 delay 使用毫秒，可采用固定、指数或函数计算，具体次数与参数由任务定义或 `jobs.defaults` 决定。

运行记录的 `idempotencyKey` 与调度 `singleton` 帮助 Store 去重，不能代替业务幂等。支付、发券、发送消息等副作用应使用业务唯一键、持久化约束或外部系统支持的幂等机制，并考虑“副作用成功但完成记录尚未提交”的故障窗口。

内置 Store 对相同 run ID 会复用已有记录；同任务的相同非空 idempotencyKey 会复用非 failed/cancelled 的记录，包括 success 和 timeout。复用记录不等于可以再次领取，也不等于再次 `runtime.run()` 会直接返回上次结果。调度 run ID 本身包含任务名和到期时间，`singleton` 不是“该任务跨所有到期时间只允许一个执行者”的全局互斥开关。

即使任务最终失败或租约被接管，已成功的副作用也不会自动回滚。重试前须明确哪些步骤可重复，哪些需要补偿或查询结果。

## 验证任务能力

验证应包含名称冲突、payload 非法、成功/失败/取消、重试次数、存储去重、并发领取、续租丢失、迟到完成和关闭超时。调度还应覆盖时区与补跑；生产多节点 Store 需要实际部署验证，内存测试不能代表 Redis 或共享文件系统的全部故障语义。

首次运行和完整测试示例见[任务指南](/zh/guide/jobs)。资源所有权见[安全与资源规范](/zh/specification/security-and-resources)。

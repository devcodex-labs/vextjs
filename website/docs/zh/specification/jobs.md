# 定时任务契约

<a id="vext-job-001"></a>

### VEXT-JOB-001 [MUST] 应用启动集成

`src/jobs` 中的有限默认 `defineJob()` 随应用启动发现；配置、名称、cron、时区、声明形状和必要 Redis 连通性在 HTTP 监听前校验。启用 Job 的必要 onReady 失败必须拒绝启动并清理；无启用 Job 保留日志隔离。Local 在就绪后激活。所有内置 Cluster 模式先由 Master 核对实际 ready 集合与清单并发送激活；Worker 收到匹配激活后启动未来 Timer 并 ACK。Master 收齐有效 ACK、复核成员未变后才报告 Jobs 整体就绪，appReady 与 JobsActive 分开。ACK 丢失不回滚已激活 Worker 的既有副作用；失败关闭新准入，已停止的 Worker 必须拒绝迟到激活。

<a id="vext-job-002"></a>

### VEXT-JOB-002 [MUST] 调度定义

每个定义必须提供 Cron 字符串，接受五/六/七字段或批准宏，拒绝 interval、Date/ISO；时区为任务 > 全局 > UTC。默认启用，关闭不执行。单任务关闭仍校验字段、TTL、声明基数和名称，不要求未来点；全局关闭跳过发现但仍校验配置。启用任务在 prepare 和 activation 均须有未来点；最后一个点执行后 next=null 正常停止。

<a id="vext-job-003"></a>

### VEXT-JOB-003 [MUST] 执行与重叠

启动只选择严格未来点。已注册触发稍晚但未跨下一周期时可执行，跨周期跳过。所有协调模式都消耗同点、旧点和 busy 点，不排队；Master 以 Croner successor 游标验证计划窗口，不用 worker 自报时间推进高水位。

同任务重叠跳过；不同任务可并行。handler 的异常被日志记录，不影响下一周期或 HTTP 服务；返回值不持久化。

<a id="vext-job-004"></a>

### VEXT-JOB-004 [MUST] 多副本配置

自动选择单应用 Local、无 Redis 的可信内置 Cluster Master IPC、已配置 Redis 的共享域。Master 使用真实 Worker 对象映射 slot/generation，实际握手建立 masterEpoch 身份；环境变量和 cluster.isWorker 不单独授信，不因握手失败降级 Local。所有内置 Cluster 模式（含 Redis）在初始 fork 尝试结束后比较实际 ready 集合的清单并等待激活 ACK；成员变化重新验证或失败关闭。外部独立副本显式共享 Redis 和定义；自动 namespace 来自包名、profile 和运行模式。

<a id="vext-job-005"></a>

### VEXT-JOB-005 [MUST] 触发去重

Redis 原子脚本用每任务最后触发时间和租约协调，标记在完成及租约过期后保留。Master IPC 使用 CLAIM→OFFER→ACCEPT→PERMIT，提交后才发最终许可；send 回调不证明授予或执行。最后一次 await 后同步复核身份、准入 epoch、窗口和许可，随即进入 handler。迟到消息不复活已放弃申请；同点、旧点和重叠点均被消耗。

<a id="vext-job-006"></a>

### VEXT-JOB-006 [MUST] 运行租约

有效 TTL 为 Job leaseTtl > 全局 Redis leaseTtl > 30000 毫秒，安全整数且至少 1000；仅 Redis 使用。每句柄约 TTL/3 续租，操作预算 min(2000,TTL/3)，保守有效期从发送前单调时钟计起；续租返回后同时检查旧有效期与操作截止。续租/释放检查 owner，同任务键同 hash slot。URL 连接由 Jobs 拥有，传入 client 不由 Jobs 关闭。普通 drain 关闭新准入但保持 Held 续租直到任务结算或共享关闭截止。

<a id="vext-job-007"></a>

### VEXT-JOB-007 [MUST] Redis 故障

Redis 错误不降级 Local。续租失败、迟到、过期或保守期限耗尽使本 Worker 永久 LeaseLost：关闭全部新准入、取消 pending、Abort 在途并进入关闭/替换。重连不复活资格。Redis 服务器时间拒绝未到或跨周期申请；跨独立应用及网络分区不承诺业务恰好一次。

<a id="vext-job-008"></a>

### VEXT-JOB-008 [MUST] 功能范围

不提供任务队列、优先级、payload 入队、自动重试、停机补跑或启动立即执行。取得资格后崩溃可能丢失当次执行；需要可靠投递时使用专用队列模块。

<a id="vext-job-009"></a>

### VEXT-JOB-009 [MUST] 关闭与副作用

关闭共享一个应用绝对截止：停新准入/Timer、Abort、预算内等待结算、关闭 coordinator，再清理依赖。未结算 Redis 任务不提前 DEL；IPC 已提交运行跨 slot/drain/超时保留，直到精确 settled/never-started 或实际 exit。滚动替换先验证候选清单，再取得旧代关闭新准入的精确回执或实际 exit，最后切 slot 并激活新代；drain 回执不等于 handler 已停止，SIGKILL 请求不等于 exit。

<a id="vext-job-010"></a>

### VEXT-JOB-010 [MUST] 测试与开发

`createTestApp` 不自动调度真实任务；`createTestJobScheduler` 在运行必要 onReady 前准备并挂载 scheduler，prepare/activation/tick 共用受控时钟，仅显式 tick，无真实 Timer 或扫描。开发任务及已加载默认转导出依赖变更均冷重启，冷热加载采用相同声明门禁。

<a id="vext-job-011"></a>

### VEXT-JOB-011 [MUST] 发现与文档选取

运行时选取六种 JS/TS 扩展，忽略下划线文件名、声明和测试文件，保留下划线目录。include 匹配实际文件并替换默认，exclude 追加内置忽略，不改写扩展。每个选中文件恰有一个默认 SDK Job；普通 helper/类型/常量允许，SDK 声明基数包含未执行分支与函数。允许有限不可变默认别名、CJS module.exports、相对默认转导出；拒绝 opaque 默认工厂、多声明、Job-valued named alias、用户 getter/Proxy 或晚变更导出。每个转导出壳及最终定义源均校验。完整编译投影须经结构证明，不能仅凭 marker 授信。

框架加载/构建在任何优化前校验选中原始文件及有限默认闭包，同次输入/集合漂移不提交产物。无 src 部署只证明当前 emitted-input，不推断优化前历史声明，不要求部署源码或新增永久来源清单。

Docs Jobs 源默认继承 jobs.dir/include/exclude，每个显式 Docs 字段可覆盖对应默认值；文档覆盖不改变调度选取，关闭定义也可被文档展示。

<a id="vext-job-012"></a>

### VEXT-JOB-012 [MUST] 静态证据与项目状态

静态工具使用相同有限声明事实；moduleShapeState/declarationCardinality 与 fieldStates 独立，分别展示 known/unsupported/unknown 和理由。已知字段不等于形状有效，缺图/循环/越界/超预算保留 unknown。未知实际名称不冒用路径推导名；不 eval 配置、模块、getter 或 handler。

框架支持 Jobs 不代表项目已启用。空/关闭项目及未知配置保持保守状态和理由，按所选开发/生产配置检查。展示有效时区、Redis TTL、预计协调模式与 source-input/emitted-input 边界；真实握手、激活、连接和执行始终 runtimeVerified=false，须独立宿主验收。

接口见 [Jobs API](/zh/api/jobs)，部署与业务示例见[定时任务指南](/zh/guide/jobs)。

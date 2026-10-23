# 定时任务契约

本页说明使用者可以依赖的前提、行为和限制。接入与配置见[指南](/zh/guide/jobs)，精确字段见[API](/zh/api/jobs)。

## 运行与执行保证

<a id="vext-job-001"></a>

### VEXT-JOB-001 [MUST] 应用启动集成

配置、名称、Cron、时区、声明形式和必要的 Redis 连通性在启动阶段校验。有启用 Jobs 时，必要 onReady 失败会阻止并清理启动；无启用 Jobs 保持原有日志隔离，观察性的 app:ready 通知不等同于必要初始化。Local 在必要就绪完成后激活。

所有内置 Cluster 模式中，Master 先完成 Worker 启动尝试，再检查实际就绪集合的任务清单；Worker 收到有效激活后才注册未来 Timer，并回复确认。Master 收齐有效激活确认且复核成员后报告 Jobs 整体就绪。单个已激活 Worker 可能更早开始调度，不存在全部 ACK 后第二次统一放行；后续协调失败不能回滚已发生的副作用。未激活、停止或激活超时的 Worker 不得因迟到消息恢复资格。部分启动失败遵循现有容量策略，不把失败 Worker 计入实际就绪集合；无有效 Worker 不得报告成功。

<a id="vext-job-002"></a>

### VEXT-JOB-002 [MUST] 调度定义

每个定义显式提供合法 5/6/7 字段 Cron 或支持的宏，不接受 interval、Date 或 ISO 一次性日期。时区为任务 timezone > jobs.timezone > UTC；日期与星期默认 OR、显式 +星期为 AND，日历扩展与 DST 遵循所用 Croner。

默认启用。禁用定义仍校验字段、声明、TTL 和名称，但无需未来点；全局关闭跳过发现，配置结构仍校验。启用任务在准备和激活时需要严格未来点；有限年份计划执行完最后一点后正常停止。

<a id="vext-job-003"></a>

### VEXT-JOB-003 [MUST] 执行与重叠

启动、重启和恢复仅选择严格未来点，不立即执行或补跑。已注册计划点稍有延迟但未跨下一窗口时可执行，跨周期跳过。相同、旧的或忙碌时跳过的点不会排队重放。

同名任务上次未结束时跳过本次点，不同任务可并行。handler 异常记录失败，后续未来周期继续，不因业务异常中止 HTTP 服务；返回值不持久化。日志区分计划时间、实际开始、耗时、模式、PID/Worker、结果及跳过原因；nextRunAt 仅为计划诊断，不承诺实际成功执行。

<a id="vext-job-004"></a>

### VEXT-JOB-004 [MUST] 多副本配置

未配置 jobs.redis 时，一个应用在进程内协调，一个可信 VextJS 内置 Cluster 在当前 Master 的 Worker 范围通过 IPC 协调，无需 Redis。普通进程环境或 cluster.isWorker 不自动赋予内置协调身份；已声明内置协调但可信连接失败时拒绝准入，不回退 Local。

多个独立应用、PM2 进程、容器或主机不会自动发现彼此；需要共享协调时显式配置相同 Redis 目标、有效前缀和一致任务定义。显式 jobs.redis 对象才启用 Redis，环境 URL 本身不启用。所有内置模式核对初始实际就绪集合的有效名称、开关、Cron、时区、模式及关键配置；Redis 模式包括可确定目标、前缀、TTL。文档元数据不影响清单；不透明 client 的真实目标及独立应用间一致性仍需部署者验证。无任务或全部关闭时不创建多余 Timer、Jobs Redis 连接或额外任务通道。

<a id="vext-job-005"></a>

### VEXT-JOB-005 [MUST] 触发去重

在健康协调域内，同名任务同一计划点最多取得一次执行资格。快速结束、租约过期或执行进程崩溃不使已消费点重新可领；响应丢失、过期或迟到许可也不允许重复或重新激活。仅发出授权消息不代表业务执行完成，未得到有效许可的 Worker 不执行。

取得资格后、业务完成前崩溃可能丢失本次工作。该保证是调度资格去重，不是业务成功一次；网络分区、Redis 状态丢失或忽略取消时，业务需以幂等保护副作用。

<a id="vext-job-006"></a>

### VEXT-JOB-006 [MUST] 运行租约

Redis 有效 TTL 为 Job.leaseTtl > jobs.redis.leaseTtl > 30000 毫秒，必须是至少 1000 的安全整数；各副本同名任务保持一致。Local/IPC 不使用 Redis TTL，但仍校验字段。TTL 不改变任务身份。

运行期间按该任务 TTL 续租，TTL 不是业务超时，长任务可运行超过它。续租和释放只处理自己的所有权；普通关闭/滚动退出的在途工作在结束或共享关闭截止前维持租约。URL 自建连接由 Jobs 关闭，传入 client 由调用方管理；Redis Cluster 的任务相关键处于同一哈希槽。

<a id="vext-job-007"></a>

### VEXT-JOB-007 [MUST] Redis 故障

启动时必要 Redis 不可用则失败，不降级本地执行。普通申请资格失败或过晚时跳过该点，未失租且健康的实例可尝试未来点。续租失败、过晚或有效期耗尽时，该 Worker 关闭全部新准入，取消 pending claim、请求在途任务协作取消并关闭/替换；重连不能恢复其资格。

Redis 服务器时间判定计划窗口；副本保持时钟同步，偏差只记录诊断、不自动校时。恢复仅考虑未来点，不补跑；取消不能强行停止任意业务或撤销副作用。

<a id="vext-job-008"></a>

### VEXT-JOB-008 [MUST] 功能范围

Jobs 只提供随应用启动的 Cron 任务，不提供 interval、队列、payload 入队、优先级、自动重试、停机补跑、启动立即执行、run-now、运行历史存储、独立 Worker Threads 或管理后台。未知字段不能开启这些能力。

可靠投递、进度和历史由独立队列或业务存储/监控承担；框架不承诺业务 Exactly Once 或跨独立 Master 的持久协调。

<a id="vext-job-009"></a>

### VEXT-JOB-009 [MUST] 关闭与副作用

关闭先停新触发/准入、请求取消，再按 shutdown.timeout 的整个应用共享预算等待，最后清理协调器及依赖。该配置以秒计，不是每个 Job 的独立等待时长；重复关闭不创建新的工作。忽略 signal 的函数无法强停，已完成副作用不回滚。

滚动替换先校验候选，候选冲突拒绝替换并保留旧 Worker；关闭旧 Worker 新准入后才允许新 Worker 进入。IPC 中，drain 或断连不等于旧 handler 停止，只有精确结算或确认进程退出才释放相应在途所有权，已消费点仍保留。Master 通道断开后停止新任务、取消并关闭，不退回 Local；IPC 状态不跨新的 Master 持久化。

<a id="vext-job-010"></a>

### VEXT-JOB-010 [MUST] 测试与开发

普通 createTestApp 不扫描或运行项目 Jobs。createTestJobScheduler 在必要 onReady 前准备显式定义及受控时钟，只由 tick 驱动，不扫描任务文件、不创建真实 Timer，也不要求 Redis 才能测试 Local 计划规则。

开发默认运行任务，任务文件或已加载相关依赖变化会冷重启，旧调度器先关闭；自定义目录同样生效。使用 development profile 可关闭开发任务。helper 不替代真实 Master/Worker、Redis、崩溃和滚动替换验证。

<a id="vext-job-011"></a>

### VEXT-JOB-011 [MUST] 发现与文档选取

默认递归选择 ts/js/mjs/cjs/mts/cts 模块，忽略下划线文件名、声明和 test/spec 文件，下划线目录本身不忽略。include 替换默认匹配，exclude 追加内置忽略，匹配真实扩展，不自动转换生产扩展；目录不越出项目边界。

每个选中文件恰有一个有限默认 SDK Job。普通 helper/类型/常量、动态字段、可识别默认别名、CommonJS module.exports 和项目源码内有限默认转导出允许；工厂/条件默认、额外 SDK 声明（含未调用位置）、Job 命名别名、用户 getter/Proxy 或晚变更导出拒绝。显式 name 优先，否则按相对路径推导，不改变 camelCase；关闭定义也检查重名。构建优化前验证，生产不强制携带 src。任务模块顶层不应主动执行业务或另建 Timer；有限声明校验不是通用副作用沙箱。

<a id="vext-job-012"></a>

### VEXT-JOB-012 [MUST] 静态证据与项目状态

项目 Docs 开启后，Jobs 来源默认启用，逐字段继承 jobs.dir/include/exclude。openapi.docs.code.jobs 的显式覆盖只改变文档扫描；关闭该来源不停止任务，disabled 定义仍可展示。

静态扫描不执行用户配置、任务模块、getter 或 handler 补齐动态值。未知/部分证据保留原因，不用推导标签冒充未知的真实动态名称。MCP Recipe 生成显式 Cron、一文件一个默认 Job，并支持任务级 TTL；静态检查识别预期协调模式，但 runtimeVerified: false 不证明实际就绪、连接或执行。中文、英文、API、Recipe 与能力描述须一致。

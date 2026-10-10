# 定时任务契约

<a id="vext-job-001"></a>

### VEXT-JOB-001 [MUST] 应用启动集成

`src/jobs` 中的 `defineJob()` 随应用启动发现；配置、名称、cron、时区和 Redis 连通性在 HTTP 监听前校验。插件、服务及 ready 阶段全部完成后才注册未来定时器。

<a id="vext-job-002"></a>

### VEXT-JOB-002 [MUST] 调度定义

每个定义提供且只提供 cron 或 interval；默认启用。interval 按 Unix epoch 对齐，cron 时区默认 UTC。全局或任务级关闭后不执行。单任务关闭仍会导入并校验定义、参与名称唯一性检查；全局关闭跳过发现，但不绕过配置结构校验。cron/interval 的未来点必须可表示，启用任务无未来点时拒绝启动。

<a id="vext-job-003"></a>

### VEXT-JOB-003 [MUST] 执行与重叠

启动只选择严格未来点；interval 以 Unix epoch 为原点。已注册触发稍晚但未跨下一周期时可执行，跨周期跳过。

同任务重叠跳过；不同任务可并行。handler 的异常被日志记录，不影响下一周期或 HTTP 服务；返回值不持久化。

<a id="vext-job-004"></a>

### VEXT-JOB-004 [MUST] 多副本配置

内置 Cluster 有启用任务时必须配置共享 Redis；空目录或全部关闭不要求 Redis。外部多副本由使用者显式配置共享 Redis 和相同任务定义；namespace 根据包名、profile 和运行模式自动生成，相同副本无需手填。额外隔离时才覆盖 namespace / keyPrefix。

<a id="vext-job-005"></a>

### VEXT-JOB-005 [MUST] 触发去重

Redis 原子脚本用每任务的最后触发时间和运行租约协调。触发时间标记在任务结束及租约过期后保留；相同或更早触发点不能再次获得资格。重叠触发点也被消耗，不延迟排队。

<a id="vext-job-006"></a>

### VEXT-JOB-006 [MUST] 运行租约

长任务按 leaseTtl/3 自动续租；续租与释放均检查 owner。Redis Cluster 的同任务键使用相同 hash slot。URL 连接由 Jobs 拥有，传入 client 由使用者拥有。

<a id="vext-job-007"></a>

### VEXT-JOB-007 [MUST] Redis 故障

Redis 错误跳过当前触发，不降级为本地执行。续租失败请求取消；恢复后只处理未来周期。Redis 服务器时间拒绝尚未到达或已跨下一周期的申请。

<a id="vext-job-008"></a>

### VEXT-JOB-008 [MUST] 功能范围

不提供任务队列、优先级、payload 入队、自动重试、停机补跑或启动立即执行。取得资格后崩溃可能丢失当次执行；需要可靠投递时使用专用队列模块。

<a id="vext-job-009"></a>

### VEXT-JOB-009 [MUST] 关闭与副作用

关闭先停止新触发，再 abort 在途任务，并在应用总关闭预算内等待，随后释放依赖。取消需要 handler 协作；网络分区、Redis 状态丢失或忽略 signal 时不保证副作用恰好一次。

<a id="vext-job-010"></a>

### VEXT-JOB-010 [MUST] 测试与开发

`createTestApp` 不自动调度真实任务；`createTestJobScheduler` 只通过显式 tick 使用相同调度规则。开发环境任务变更冷重启，不叠加旧定时器。

<a id="vext-job-011"></a>

### VEXT-JOB-011 [MUST] 发现与文档选取

运行时默认选取六种 JS/TS 模块扩展，忽略下划线文件名、声明及测试文件，不忽略下划线目录。include 匹配真实扫描文件并替换默认包含规则，exclude 追加内置忽略；不自动把源码扩展转换为输出扩展。每个选中文件必须导出 defineJob 值，导出名称推导和显式名称由加载器确定。

Docs Jobs 源默认继承 jobs.dir/include/exclude，每个显式 Docs 字段可覆盖对应默认值；文档覆盖不改变调度选取，关闭定义也可被文档展示。

<a id="vext-job-012"></a>

### VEXT-JOB-012 [MUST] 静态证据与项目状态

静态工具只认定有 vextjs 工厂绑定来源的定义，在声明源码根内解析安全 ESM 导入及转导出；未声明、已知和未知字段必须区分。未知实际名称不使用路径推导值冒充；动态包装、循环、越界等无法解析时报告缺失证据。静态解析不执行业务模块或 handler。

框架支持 Jobs 不代表项目已启用。空项目、关闭项目、缺 Redis 的活跃 Cluster 与未知配置需要保守状态及理由；生产/开发目标按选定配置检查。静态工具的配置声明和诊断不证明真实启动、连接或执行，必须保留 runtimeVerified=false 的边界。

接口见 [Jobs API](/zh/api/jobs)，部署与业务示例见[定时任务指南](/zh/guide/jobs)。

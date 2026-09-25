# 数据访问规范

本页规定 VextJS 内置 MonSQLize 集成的入口、模型与数据一致性边界。连接配置和完整用法见[数据库指南](/zh/guide/database)，HTTP 响应缓存见[缓存指南](/zh/guide/cache)。

## 数据库入口和所有权

<a id="vext-data-001"></a>

### VEXT-DATA-001 [MUST] 仅在数据库初始化成功后使用 app.db

内置数据库插件按 `config.database` 条件启用：未配置、`null` 或空对象不会初始化数据库。配置存在且非空并不代表一定有效；连接或模型加载失败仍可能终止启动。

初始化成功后，`app.db` 是同一个原始 MonSQLize 实例，保留上游实例能力；Vext 在其上提供只读 `client` 等窄兼容行为。不要再依赖旧的独立 `app.monsqlize` 别名或假设 `app.db` 是缩减的 Repository 包装。

内置数据库先于用户插件加载，用户插件 `setup()` 可以使用已成功初始化的 `app.db`；未启用数据库的项目必须处理入口不存在的情况。框架在关闭时释放本应用模型注册和数据库连接，不要在每个 HTTP 请求结束时关闭共享实例。应用自己创建的其他数据库客户端仍由应用负责释放。

这里描述的是应用 bootstrap 的内置生命周期。`createTestApp()` 不自动读取项目配置或初始化内置数据库；验证数据库集成时应实际启动对应 CLI 应用，或显式准备连接与测试替身，并说明验证范围。手动调用上游 `Model.define()` 的注册项不自动纳入 Vext 的加载、热重载和 ownership 计划。

## Collection、Model 与命名

<a id="vext-data-002"></a>

### VEXT-DATA-002 [MUST] 区分真实集合名与模型注册键

`app.db.collection(name)` 使用真实集合名访问 Collection；`app.db.model(key)` 查找已经注册的模型。两种入口不能仅凭名字相似互相替代。

| 模型源文件                         | 默认 primary 注册键                          | 默认连接推断                      |
| ---------------------------------- | -------------------------------------------- | --------------------------------- |
| `src/models/user.ts`               | `collection` → `name` → `User`，按先有值选择 | 不添加目录连接信息                |
| `src/models/billing/invoice.ts`    | `BillingInvoice`                             | `database: "billing"`             |
| `src/models/cn/billing/invoice.ts` | `CnBillingInvoice`                           | `pool: "cn", database: "billing"` |

一至二级目录的 primary 注册键来自完整相对路径；显式 `collection` / `name` 决定集合名，未设置时使用原始文件名（如 `invoice`）。`key` 可以增加精确别名，但不改 primary 注册键。显式 `connection` 整体优先，目录不会继续补齐或覆盖它的字段。超过两级目录的定义不属于此加载合同。

模型目录由 `database.models.dir` 配置，自动注册还受 `autoRegister` 控制。默认 `validation: "strict"` 会在导入或定义不合法时失败；显式 `lenient` 可跳过部分不合法文件，但不会允许注册键冲突。模型先形成完整计划再注册，不能依赖一个失败的扫描已经留下部分可用模型。

具体定义形式、共享模型包、别名和类型见[模型指南](/zh/guide/database#model-定义)。

<a id="vext-data-003"></a>

### VEXT-DATA-003 [SHOULD] 按所需模型行为选择数据访问入口

需要模型定义的校验、hooks、软删除或其他模型行为时，使用对应 Model API，并验证实际启用选项。原始 Collection 操作不能自动获得某个 Model 的全部约束或生命周期。不要在同一业务中随意混用两种入口后假定行为相同。

Vext 不强制 Repository 层，也不禁止 route 直接访问数据库。多个入口需要共享业务规则、事务与错误映射时，宜由 Service 或明确的数据访问模块集中组织。输入 Schema 与持久化约束的区别见[校验规范](/zh/specification/validation-and-contracts#vext-contract-001)。

列表与分页应核对真实返回合同：`findPage(options)` 读取 `items/pageInfo/totals`，`findAndCount(query, options)` 读取 `data/total`。不要先读取固定数量再在内存中筛选、计数或切片。页码与 limit 需有整数和范围约束；游标需有效且沿用相同过滤与稳定排序。查询与计数也不自动成为同一事务快照。

## 多库与事务

<a id="vext-data-004"></a>

### VEXT-DATA-004 [MUST] 显式核实连接池、数据库与模型作用域

`use(dbName)` 选择数据库 scope，`pool(poolName)` 选择连接池 scope；它们不会把短名称自动改写成 Vext 的目录 primary 注册键。模型查找仍须使用正确的 key；需要精确指定模型及数据库/连接池时，可以使用上游 `scopedModel()` 合同。

模型的显式连接信息、目录推断与调用方 scope 是不同来源。跨库或跨池业务必须核对实际目标，不得把“能通过同一个 app.db 访问”解释成“所有操作自动属于同一事务”。连接池配置和 scope 示例见[数据库指南](/zh/guide/database)。

<a id="vext-data-005"></a>

### VEXT-DATA-005 [SHOULD] 在业务边界显式建立事务与并发约束

涉及多个写入的一致性要求时，按当前 MonSQLize 和数据库部署能力选择事务或原子操作。使用 `withTransaction()` 时，需要让相应查询/写入携带该事务的 `session`；普通查询不会因处于同一个 JavaScript 回调中就自动拥有事务语义。

事务支持和限制取决于数据库部署与驱动，不应由 Vext 文档承诺跨任意连接池的全局原子性。事务重试可能重复执行回调，回调中的外部支付、消息发送等副作用应有独立的幂等或提交后处理设计。

唯一性、并发扣减和状态转换须使用相应持久化约束；“先查后写”本身不能保证并发安全。捕获数据库错误时应保留可判定原因，再由应用映射为合适的业务和 HTTP 错误。

声明唯一索引不等于索引已建立。当前 Model 的索引选项 `unique` 与 `key` 同级；依赖唯一约束的应用应确认实际索引和重复/并发写入结果。需要在启动时等待索引就绪的流程，可显式等待 `ensureIndexes({ throwOnError: true })`。热重载定义或重启进程都不能代替对存量索引冲突的处理。

## 缓存与一致性

<a id="vext-data-006"></a>

### VEXT-DATA-006 [MUST] 区分数据库查询缓存与 HTTP 响应缓存

| 缓存               | 所属合同                                   | 应核对的内容                                           |
| ------------------ | ------------------------------------------ | ------------------------------------------------------ |
| MonSQLize 查询缓存 | `database.cache` 及查询/写入选项           | 查询是否启用缓存、写入失效策略、事务行为、跨实例一致性 |
| HTTP 响应缓存      | `config.cache`、Route `cache`、`app.cache` | 响应键、身份隔离、TTL、标签失效、共享或广播配置        |

数据库写入不会因此自动失效所有 Vext HTTP 响应缓存。业务更新成功后，对应缓存若使用标签，应显式调用 `app.cache.invalidate(tag)` 或采取应用已验证的失效方式。不得将数据库提交与响应缓存失效描述为一个原子事务。

当前 MonSQLize 查询缓存按需启用，写入失效需对应选项。由 MonSQLize 事务管理器建立、且写入显式传入其 session 的事务，可记录失效意图并在成功提交后处理；直接使用原始 MongoClient 创建 session 不自动获得同一缓存协调机制。分布式缓存失效仍有失败与传播边界，不能据此保证全局强一致读。对严格实时性要求的业务，应选择适当读策略并验证失败场景。

不同缓存 API 的 TTL 单位必须逐项确认：Vext 响应缓存及当前数据库查询 `cache`、`cache.memory.ttl`、`cache.redis.ttl` 使用毫秒；Session Store 的 `ttlSeconds` 使用秒。还须核对 Vext 到上游的配置转发默认值，不能只根据字段名或类型注释推断运行值。

`findPage()` 的总数缓存与查询缓存是不同路径；`cache: 0` 不能代表强制重新计数。缓存存储已配置也不代表查询已启用缓存，`memory.enabled: false` 在当前转发实现中不保证关闭上游 L1。具体行为和可验证用法见[数据库指南](/zh/guide/database#分页总数与缓存)及其缓存配置章节。

## 验证和排查

排查顺序为：数据库启用与连接错误 → 模型扫描路径和注册键 → 实际 pool/database → Model 与 Collection 的选择 → session 传递 → 写入结果与两类缓存失效。测试按实际启用能力覆盖成功与失败初始化、非法模型/键冲突和写入拒绝；使用事务时验证回滚，启用缓存时验证过期与失效，多实例部署时验证跨实例可见性。

先确认验证 profile 已被显式选择并进入运行产物。开发模式可读取的 `config/test.ts` 会被生产构建排除；需要验证构建产物时，采用可交付的独立 profile，不能把配置回落后的连接结果当成目标环境通过。每项结论只覆盖实际启用并测试的能力。

Vext 集成测试与模拟连接测试不能证明任意生产 MongoDB 拓扑或所有上游扩展能力都成立。项目应按自己安装的 MonSQLize 版本与部署运行相应集成测试；包版本范围、锁文件解析版本和实际安装版本分开记录。

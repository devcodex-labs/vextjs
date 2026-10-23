# 定时任务 API

本页提供公开签名、字段约束和错误边界。创建、配置、部署和排错的完整操作见[定时任务指南](/zh/guide/jobs)，执行保证见[定时任务契约](/zh/specification/jobs)。

## defineJob

从框架公开入口导入所需函数和类型：

```typescript
import { defineJob, isVextJobDefinition } from "vextjs";
import type {
  VextApp,
  VextJobDefinition,
  VextJobDefinitionInput,
  VextJobHandler,
  VextJobContext,
  VextJobDocsConfig,
  VextJobsConfig,
} from "vextjs";
```

以下是签名参考，不是需要复制到任务文件的类型声明：

```typescript reference
declare function defineJob(input: VextJobDefinitionInput): VextJobDefinition;
declare function isVextJobDefinition(
  value: unknown,
): value is VextJobDefinition;

type VextJobDefinitionInput = {
  name?: string;
  description?: string;
  tags?: string[];
  docs?: VextJobDocsConfig;
  enabled?: boolean;
  cron: string;
  timezone?: string;
  leaseTtl?: number;
  handler: VextJobHandler;
};
type VextJobHandler = (ctx: VextJobContext) => unknown | Promise<unknown>;
interface VextJobContext {
  app: VextApp;
  name: string;
  scheduledAt: Date;
  signal: AbortSignal;
  logger: VextApp["logger"];
}
interface VextJobDocsConfig {
  summary?: string;
  description?: string;
  tags?: string[];
}
```

<a id="job-options"></a>

| 字段          | 类型                | 必填 | 默认值                           | 校验和结果                                                                                         |
| ------------- | ------------------- | ---- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `name`        | `string`            | 否   | 默认任务文件的相对路径推导       | 非空 ASCII 字母、数字及 `_ . : -`；包括关闭定义在内，加载后的名称必须唯一                          |
| `description` | `string`            | 否   | 无                               | 业务描述与文档回退值，不影响调度                                                                   |
| `tags`        | `string[]`          | 否   | 无                               | 文档标签；每项必须是字符串                                                                         |
| `docs`        | `VextJobDocsConfig` | 否   | 无                               | 文档元数据对象，不能是 null 或数组；字段见[任务文档配置](#任务文档配置)                            |
| `enabled`     | `boolean`           | 否   | `true`                           | false 不调度，但模块仍导入，定义及名称仍校验                                                       |
| `cron`        | `string`            | 是   | 无                               | 合法非空 5/6/7 字段 Cron 或支持的宏；Date、ISO 日期、interval 拒绝                                 |
| `timezone`    | `string`            | 否   | `jobs.timezone` 或 `UTC`         | 非空有效 IANA 时区，Job.timezone > jobs.timezone > UTC                                             |
| `leaseTtl`    | `number`            | 否   | `jobs.redis.leaseTtl` 或 `30000` | 安全整数毫秒且至少 `1000`；Job.leaseTtl > jobs.redis.leaseTtl > 30000 ms；Local/IPC 不使用但仍校验 |
| `handler`     | `VextJobHandler`    | 是   | 无                               | 函数，可返回任意值或 Promise；结果不保存，异常记录，无自动重试                                     |

`defineJob()` 同步验证并返回带框架识别标记的任务定义，冻结顶层对象；不是对 `docs/tags` 的深冻结。未知顶层字段或显式无效值不会被默认值掩盖。`isVextJobDefinition()` 只作定义类型识别，不证明模块加载、静态声明合法、应用就绪或任务已执行。

### handler 上下文

<a id="job-context"></a>

| 字段          | 类型                | 契约                                                                 |
| ------------- | ------------------- | -------------------------------------------------------------------- |
| `app`         | `VextApp`           | 已就绪应用及其 Service/插件；不注入 HTTP 请求、响应或当前用户        |
| `name`        | `string`            | 加载后的有效名称                                                     |
| `scheduledAt` | `Date`              | 计划点，不是实际开始时间；可用于业务幂等或延迟监控                   |
| `signal`      | `AbortSignal`       | 关闭、协调失效等情况下请求协作取消；业务需持续检查并传给支持它的 I/O |
| `logger`      | `VextApp["logger"]` | 当前应用日志；框架另行输出计划时间、实际开始、状态与耗时             |

## 定义规则

默认递归发现 `src/jobs` 下 `.ts/.js/.mjs/.cjs/.mts/.cts` 模块。每个选中文件恰有一个有限的默认 SDK Job，CommonJS 等价为 `module.exports`。普通 helper、类型与常量导出允许，不能把命名 Job 当作新增任务注册入口。

允许可识别的默认别名、动态字段，以及项目源码范围内有限的相对默认转导出；入口和被引用定义都要满足规则。工厂/条件默认形式、数组、仅命名 Job、额外 SDK 声明（包括未调用的位置）、Job 命名别名、用户 getter/Proxy 或后续改变导出均不受支持。这里是有限声明规则，不是任意 JavaScript 副作用沙箱；禁止在任务模块顶层主动执行业务或另建 Timer。

显式 `name` 优先，否则由任务相对路径去扩展名、去末尾 `/index` 并转点分名，不改变 camelCase。禁用定义也参与重名检查。全局关闭跳过发现；单任务关闭仍检查字段、声明数量、TTL 与名称，只免除执行和未来点要求。

构建在优化前检查声明；生产可以只部署正确的构建产物，无需为了 Jobs 额外部署 `src`。精确扫描与目录示例见[发现规则](/zh/guide/jobs#发现导出与名称)。

## VextJobsConfig

写入已有 `src/config/default.ts` 或所选 profile 的 `jobs` 字段，遵循正常[配置合并顺序](/zh/guide/configuration)。以下全部可选：

<a id="jobs-options"></a>

| 字段            | 类型       | 默认值                             | 约束                                                                                |
| --------------- | ---------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `jobs.enabled`  | `boolean`  | `true`                             | false 跳过发现和调度，不跳过配置结构校验                                            |
| `jobs.dir`      | `string`   | `"jobs"`                           | 相对 src 的项目目录；禁止绝对路径、`..` 或越界；生产映射到构建根，例如 dist/jobs    |
| `jobs.include`  | `string[]` | `["**/*.{ts,js,mjs,cjs,mts,cts}"]` | 替换默认包含规则，匹配实际文件；[] 无任务，不转换编译扩展                           |
| `jobs.exclude`  | `string[]` | `[]`                               | 追加内置忽略；不能重新纳入下划线文件名、声明和 test/spec 模块，下划线目录本身不忽略 |
| `jobs.timezone` | `string`   | `"UTC"`                            | 有效 IANA 时区，被单任务覆盖                                                        |
| `jobs.redis`    | `object`   | 不配置                             | 配置对象显式启用 Redis 协调；无启用任务不建立 Jobs Redis 连接                       |

未知配置字段拒绝。目录和数组等结构在全局关闭时仍须合法；全局关闭和单任务关闭的导入差异见上文。

## Redis 配置

单进程或单个内置 Cluster 无需 Redis。独立应用需要共享协调时配置 `jobs.redis`；只有环境变量而没有这个对象，不启用 Redis。

<a id="redis-options"></a>

| 字段                   | 类型                          | 默认值/优先级                   | 约束与资源所有权                                                                    |
| ---------------------- | ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| `jobs.redis.client`    | `unknown`（ioredis 兼容对象） | 无；优先于地址                  | 具备兼容 ping/eval 能力；调用方负责连接选项、错误处理和关闭，Jobs 不关闭借入 client |
| `jobs.redis.url`       | `string`                      | 无；高于 uri/环境               | Jobs 创建并管理连接；显式空 URL 不继续回退                                          |
| `jobs.redis.uri`       | `string`                      | 无；低于 url                    | 地址别名，通常只填一种                                                              |
| `jobs.redis.namespace` | `string`                      | 包名、profile、运行模式自动组合 | 同域副本通常省略；显式值规范化后用于隔离                                            |
| `jobs.redis.keyPrefix` | `string`                      | 根据 namespace 生成             | 非空显式值覆盖逻辑前缀；去首尾空白、补末尾冒号；空白值按未覆盖处理                  |
| `jobs.redis.leaseTtl`  | `number`                      | `30000` 毫秒                    | 安全整数且至少 `1000`，由 Job.leaseTtl 覆盖，不是 handler 超时                      |

连接优先级为 **client > url > uri > VEXT_REDIS_URL > REDIS_URL**。无效 client（包括 null）不会回退 URL；地址按省略值回退，显式空 url 不回退。有启用任务时，连接或必要脚本能力初始化失败会拒绝启动；无启用任务不建立或检查多余连接，但配置结构和 TTL 仍校验。

默认 namespace 由项目包名、`VEXT_CONFIG`（缺省 default）和 `NODE_ENV`（缺省 production）生成；包名不可读回退 `vextjs-app`。默认逻辑前缀为 `vext:<namespace>:job:`。namespace 去开头 `@`、将路径分隔符转点、将不支持字符转连字符、合并连续分隔符并去首尾分隔符；例如 `@team/my-app:production:production` 变为 `team.my-app:production:production`。规范化后为空则使用 `vextjs-app`。空白 keyPrefix 不会覆盖显式或自动 namespace。

共享域需保持 Redis 目标、有效前缀、任务名和定义一致；改变名称/前缀会改变身份，TTL 不参与身份。Jobs 不借用 cache、Session 或限流的 Redis 配置。运行期间按每个 Job 的有效 TTL 续租；同名任务各副本保持一致 TTL。`shutdown.timeout` 以秒计，是整个应用共享的关闭预算。

## 任务文档配置

<a id="job-docs"></a>

| 字段               | 类型       | 默认值 | 展示规则                                                                       |
| ------------------ | ---------- | ------ | ------------------------------------------------------------------------------ |
| `docs.summary`     | `string`   | 无     | JSDoc 摘要优先，其后依次 docs.summary、docs.description、description、默认摘要 |
| `docs.description` | `string`   | 无     | JSDoc 描述优先，其后 docs.description、顶层 description                        |
| `docs.tags`        | `string[]` | 无     | 与顶层 tags 和 jobs 分类合并去重                                               |

### 项目文档来源

以下配置只影响静态文档，不影响任务发现、执行资格或实际调度：

| 参数                             | 类型                   | 默认值                       | 作用                                             |
| -------------------------------- | ---------------------- | ---------------------------- | ------------------------------------------------ |
| `openapi.docs.code.jobs`         | boolean 或对象         | true                         | 受整体 Docs 设置约束，false 只关闭 Jobs 文档来源 |
| `openapi.docs.code.jobs.enabled` | boolean                | true                         | 对象形式的来源开关                               |
| `openapi.docs.code.jobs.dir`     | string                 | 继承 jobs.dir                | 只覆盖文档目录                                   |
| `openapi.docs.code.jobs.include` | string[]               | 继承 jobs.include 或默认规则 | 只覆盖文档包含，[] 无匹配                        |
| `openapi.docs.code.jobs.exclude` | string[]               | 继承 jobs.exclude 或 []      | 只覆盖文档排除，内置忽略仍有效                   |
| `openapi.docs.code.jobs.title`   | string（通用来源类型） | Jobs 来源不使用              | 不依赖此字段重命名 Jobs 分组或任务标题           |

`dir/include/exclude` **分别继承、分别覆盖**；`openapi.docs.code.enabled: false` 关闭整体代码文档，但不停止任务。disabled 定义可以展示；无法静态证明的值保留 unknown/partial，`runtimeVerified: false` 不代表任务已启动或执行。默认查看步骤和可选覆盖见[指南](/zh/guide/jobs#查看任务文档)。

## 错误与执行边界

| 触发条件                                  | 错误/可观察结果与处理                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| defineJob 字段、Cron、时区或 handler 非法 | 同步抛 VextJobDefinitionError；按字段修正，禁用定义也需合法                                     |
| 加载名称冲突                              | 抛 VextJobDuplicateNameError，含关闭定义；修改显式或推导名称                                    |
| 模块声明不支持或启用任务无未来点          | 准备/激活阶段拒绝；修正文件、Cron 或定义形式                                                    |
| 必要 onReady 失败                         | 有启用 Jobs 时拒绝并清理启动；无启用 Jobs 保持原有日志隔离，观察 app:ready 回调另按安全通知处理 |
| 内置 Cluster 未激活或清单冲突             | 未获激活的 Worker 不执行；初始冲突阻止激活，候选冲突拒绝替换并保留旧 Worker                     |
| Redis 初始化不可用                        | 启动拒绝，不降级 Local                                                                          |
| handler 异常、重叠或过期窗口              | 异常记录；重叠/旧点跳过，无重试、排队或补跑                                                     |
| Redis 失租                                | 该 Worker 关闭全部新准入，Abort 在途任务并关闭/替换；重连不恢复资格                             |
| 关闭                                      | 先停新任务、请求取消、共享预算等待，再清理协调器和依赖；无法强行中断任意 JS                     |

执行资格去重不是业务副作用 Exactly Once。网络分区、状态丢失和忽略取消仍需业务幂等；详见[行为契约](/zh/specification/jobs)。

## 测试入口

`createTestJobScheduler`、`CreateTestJobSchedulerOptions`、`TestJobScheduler` 从 `vextjs/testing` 导入。helper 显式接收定义和受控时钟，不扫描文件或创建真实 Timer；普通 createTestApp 不自动加载 Jobs。见[测试 API](/zh/api/testing-api#createtestjobscheduler)及[指南](/zh/guide/jobs#测试与观察)。

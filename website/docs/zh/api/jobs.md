# 定时任务 API

Jobs在必要初始化与任务就绪条件满足后自动调度。完整流程、部署与故障排查见[定时任务指南](/zh/guide/jobs)，行为约束见[定时任务契约](/zh/specification/jobs)。本页是配置与定义字段的完整参考。

## defineJob

下面列出公开签名与类型。创建实际任务的完整代码见[指南](/zh/guide/jobs#创建第一个任务)；应用只需导入要使用的函数或类型。

```typescript
import { defineJob, isVextJobDefinition } from "vextjs";
import type {
  VextJobDefinition,
  VextJobDefinitionInput,
  VextJobHandler,
  VextJobContext,
  VextJobDocsConfig,
  VextJobsConfig,
} from "vextjs";

function defineJob(input: VextJobDefinitionInput): VextJobDefinition;
function isVextJobDefinition(value: unknown): value is VextJobDefinition;

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

| 定义字段           | 类型 / 默认值                        | 约束与用途                                                                                                             |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `name`             | `string` / 任务文件相对路径推导      | 非空，允许 ASCII 字母、数字及 `_ . : -`；加载的名称全局唯一，包括关闭的任务。建议显式设置稳定名称以保持 Redis 协调身份 |
| `description`      | `string` / 无                        | 描述业务用途；作为 Docs 描述与摘要的回退，不影响调度                                                                   |
| `tags`             | `string[]` / 无                      | 文档检索标签；与 `docs.tags` 合并去重，并添加 `jobs`                                                                   |
| `docs`             | `VextJobDocsConfig` / 无             | 文档元数据对象；不改变调度                                                                                             |
| `docs.summary`     | `string` / 无                        | 摘要回退值；JSDoc 摘要优先                                                                                             |
| `docs.description` | `string` / 无                        | 优先于定义的 `description`，JSDoc 描述仍优先                                                                           |
| `docs.tags`        | `string[]` / 无                      | 与定义标签合并                                                                                                         |
| `enabled`          | `boolean` / `true`                   | 单任务关闭后不调度，模块仍导入，定义仍校验，名称仍参与冲突检查                                                         |
| `cron`             | `string` / 必填                      | 非空，五、六或七字段 Cron 或批准宏，由 Croner 校验；不接受 Date/ISO 日期字符串或 interval                              |
| `leaseTtl`         | `number` / 全局 Redis TTL 或 `30000` | 安全整数毫秒，至少 `1000`；只影响 Redis 运行租约，不改变计划点或任务身份；单进程/内置无Redis协调中不生效，但仍校验     |
| `timezone`         | `string` / 全局时区或 `UTC`          | 非空有效 IANA 时区，任务值优先于 `jobs.timezone`                                                                       |
| `handler`          | `VextJobHandler` / 必填              | 函数，可同步或异步；返回值不保存，异常记录日志，不自动重试                                                             |

未声明的可选字段可采用默认值；显式无效值不会采用默认值。即使 `enabled: false`，定义也必须包含合法调度和 handler。未知顶层字段会报错。`defineJob()` 校验并冻结顶层对象，返回带内部识别标记的定义；不能用普通对象冒充。冻结不是对嵌套 `docs`/`tags` 的深冻结。

### handler 上下文

| 字段          | 含义                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| `app`         | 已就绪的应用，可访问插件扩展与 `app.services`；不是 HTTP 请求上下文                   |
| `name`        | 加载后的有效任务名称                                                                  |
| `scheduledAt` | 计划触发点的 `Date`，不是实际开始时间；可用于业务幂等键或监控延迟                     |
| `signal`      | 应用关闭或 Redis 租约续期失败时请求协作取消；handler 必须持续检查并传给支持取消的 I/O |
| `logger`      | 当前应用的 logger；框架的执行日志另外记录任务名、计划时间和耗时                       |

## VextJobsConfig

写入已有配置的 jobs 字段，例如 src/config/default.ts，按项目[配置合并顺序](/zh/guide/configuration)决定有效值。以下均为可选项。

| 参数            | 类型     | 默认值                             | 用途、选择与约束                                                                                        |
| --------------- | -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `jobs.enabled`  | boolean  | true                               | 整体关闭任务发现与调度；配置结构仍需合法                                                                |
| `jobs.dir`      | string   | jobs                               | 相对src的任务目录；tasks对应src/tasks及构建根下的tasks。不要加src前缀；绝对路径、..段或越出项目范围拒绝 |
| `jobs.include`  | string[] | `["**/*.{ts,js,mjs,cjs,mts,cts}"]` | 替换默认包含规则，相对任务目录匹配实际文件；[]不发现任务，不自动转换编译扩展                            |
| `jobs.exclude`  | string[] | []                                 | 追加排除；内置忽略的下划线文件、声明和test/spec模块不能重新纳入；下划线目录本身不忽略                   |
| `jobs.timezone` | string   | UTC                                | 全局业务IANA时区，被单任务timezone覆盖；无效值拒绝                                                      |
| `jobs.redis`    | object   | 不配置                             | 独立应用共享协调时配置；单进程或单个内置Cluster可省略。无启用任务不建立Jobs Redis连接                   |

未知全局字段拒绝。全局 enabled:false 不导入任务模块，单Job enabled:false 仍导入并校验定义；两者都不是绕过配置合法性校验的方法。目录及扩展规则也用于开发和构建后启动，详见[指南](/zh/guide/jobs#自定义目录与过滤)。

## Redis 配置

写入 jobs.redis。通常只需要url；已有环境URL时用空对象显式启用。单个内置Cluster无需Redis，外部独立副本未配置共享Redis时各自执行。

| 参数        | 类型            | 默认值/优先级                       | 用途与限制                                                                                                |
| ----------- | --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `client`    | ioredis兼容对象 | 无；优先于地址                      | 支持ping()及兼容的eval(script,keyCount,...args)；调用方负责连接选项、错误处理和关闭，Jobs不关闭传入client |
| `url`       | string          | 无；优先于uri/环境变量              | 普通接入推荐；Jobs创建并管理该连接；无效连接启动失败，不降级                                              |
| `uri`       | string          | 无；低于url                         | 地址别名；通常只填url或uri之一                                                                            |
| `namespace` | string          | 包名、配置profile、运行模式自动生成 | 相同应用副本通常省略；共用Redis的独立业务需额外隔离时填写                                                 |
| `keyPrefix` | string          | 根据namespace生成                   | 非空显式值覆盖整个逻辑前缀；去首尾空白并补末尾冒号。通常优先用namespace                                   |
| `leaseTtl`  | number          | 30000毫秒，被Job.leaseTtl覆盖       | 安全整数且>=1000；控制Redis租约，不是调度间隔或handler超时                                                |

连接选择为 **client > url > uri > VEXT_REDIS_URL > REDIS_URL**。不兼容的client对象不会回退到URL；client:null非法。地址按省略值回退，显式空url不会继续取uri或环境变量，在需要连接时失败。

仅有环境变量但没有jobs.redis对象，不启用Redis。无启用任务时不检查不必要的连接，但配置结构、字段类型及TTL仍需合法。有启用任务时初始化检查连接和必要能力，失败拒绝启动。

默认逻辑前缀为 vext:&lt;namespace&gt;:job:。自动namespace由项目包名、VEXT_CONFIG（缺省default）和NODE_ENV（缺省production）组成；标准CLI提供所选profile和运行模式。不可读包名回退vextjs-app。

namespace规范化会去掉开头@，把路径分隔符转为点，其他不支持字符转为连字符，合并连续分隔符并去首尾分隔符；例如 @team/my-app:production:production 得到 team.my-app:production:production。显式namespace规范化后为空则使用vextjs-app。空白keyPrefix视作未覆盖，继续使用显式namespace或自动namespace，不是一律回到自动值。

同一个共享协调域需保持Redis目标、有效前缀、任务名及定义一致；改变名称或前缀会改变协调身份。Jobs不借用缓存、Session或限流的Redis配置。

有效TTL为 Job.leaseTtl > jobs.redis.leaseTtl > 30000毫秒。运行中会续租，长任务不必将TTL设成整个执行时长；同名任务各副本应使用一致TTL。单进程/内置无Redis协调不用TTL，但也校验其合法性。shutdown.timeout是秒，表示整个应用共享关闭预算，不能与毫秒TTL混用。

## 任务文档配置

Job自身的description、tags和docs子字段见上面的定义表。项目任务文档来源使用以下配置，均不影响实际调度：

| 参数                             | 类型                       | 默认值                             | 作用与限制                                              |
| -------------------------------- | -------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `openapi.docs.code.jobs`         | boolean或对象              | true                               | 启用Jobs文档来源；还受整体Docs设置约束，false只关闭文档 |
| `openapi.docs.code.jobs.enabled` | boolean                    | true                               | 对象形式的来源开关                                      |
| `openapi.docs.code.jobs.dir`     | string                     | 继承运行配置jobs.dir               | 显式值仅覆盖文档目录                                    |
| `openapi.docs.code.jobs.include` | string[]                   | 继承运行配置jobs.include或默认规则 | 显式值仅覆盖文档包含规则，[]无匹配                      |
| `openapi.docs.code.jobs.exclude` | string[]                   | 继承运行配置jobs.exclude或[]       | 显式值仅覆盖文档排除，内置忽略仍有效                    |
| `openapi.docs.code.jobs.title`   | string（通用来源类型提供） | 当前Jobs来源不使用                 | 不用于修改Jobs分组或任务条目标题；不要依赖该字段改名    |

dir/include/exclude**分别继承、分别覆盖**；只覆盖include不会丢失运行配置的dir。openapi.docs.code.enabled:false关闭整体代码文档，同样不停止任务。

摘要优先级为对应JSDoc摘要 > docs.summary > docs.description > description > 默认摘要；描述为JSDoc描述 > docs.description > description。顶层tags、docs.tags与jobs分类合并去重。这些字段只帮助阅读和检索，不改变任务身份或执行资格。

disabled定义可以展示。静态无法读取的动态值显示未知，任务列表不证明应用已启动、连接成功或任务执行过。查看方式见[指南](/zh/guide/jobs#查看任务文档)。

## 错误与执行边界

| 情况                                                   | 结果与处理                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| 定义无效、非法Cron/时区、没有handler或不允许的默认声明 | 拒绝加载/启动；按报错文件和字段修正                                        |
| 名称冲突                                               | 包含disabled任务在内拒绝重名，消除显式名或路径推导名冲突                   |
| 启用任务没有可表示的未来点                             | 准备或实际激活时拒绝；合法disabled任务无需未来点                           |
| 必要onReady失败                                        | 有启用任务时拒绝启动并清理；没有启用任务时保持原有日志隔离                 |
| 内置Cluster未完成必要就绪或任务配置不一致              | 不开放任务执行；修复启动原因，不自动各自执行                               |
| Redis初始化失败                                        | 拒绝启动，不降级；修复连接、权限或client能力                               |
| handler抛异常                                          | 记录失败，后续未来周期继续；无自动重试                                     |
| 同名任务重叠或错过执行窗口                             | 跳过，不排队或补跑                                                         |
| Redis失租                                              | 停止该Worker新任务、请求取消并关闭/替换；重连不恢复原资格                  |
| 应用关闭                                               | 停止新触发、请求取消，在共享shutdown.timeout预算内等待；无法强行中断任意JS |

定义错误使用VextJobDefinitionError，名称冲突使用VextJobDuplicateNameError；配置或连接失败按相应错误报告。每个选中文件只有一个有限默认Job；普通helper/类型/常量、动态字段、不可变别名和有限相对默认转导出允许。工厂/条件默认形式、额外SDK声明、Job命名别名、用户getter/Proxy及晚变更导出拒绝。完整独立样例见[指南](/zh/guide/jobs#允许与拒绝的声明样例)。

框架检查构建优化前的声明，部署可以只带正确构建产物；不要求为Jobs额外部署src。不能从优化后的产物证明不可得的原始历史。执行资格去重不等于业务副作用恰好一次，业务仍需幂等。完整保证见[行为契约](/zh/specification/jobs)。

## 测试入口

createTestJobScheduler、CreateTestJobSchedulerOptions、TestJobScheduler从vextjs/testing导入。helper显式接收定义和受控时钟，不扫描项目、不创建真实定时器；普通createTestApp也不自动加载Jobs。详见[测试 API](/zh/api/testing-api#createtestjobscheduler)和[测试与观察](/zh/guide/jobs#测试与观察)。

# 定时任务 API

Jobs 在应用就绪后自动调度导出的任务。完整流程、部署与故障排查见[定时任务指南](/zh/guide/jobs)，行为约束见[定时任务契约](/zh/specification/jobs)。本页是配置与定义字段的完整参考。

## defineJob

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
  handler: VextJobHandler;
} & (
  | { cron: string; interval?: never; timezone?: string }
  | { interval: number; cron?: never; timezone?: never }
);

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

| 定义字段           | 类型 / 默认值               | 约束与用途                                                                                                             |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`             | `string` / 文件与导出名推导 | 非空，允许 ASCII 字母、数字及 `_ . : -`；加载的名称全局唯一，包括关闭的任务。建议显式设置稳定名称以保持 Redis 协调身份 |
| `description`      | `string` / 无               | 描述业务用途；作为 Docs 描述与摘要的回退，不影响调度                                                                   |
| `tags`             | `string[]` / 无             | 文档检索标签；与 `docs.tags` 合并去重，并添加 `jobs`                                                                   |
| `docs`             | `VextJobDocsConfig` / 无    | 文档元数据对象；不改变调度                                                                                             |
| `docs.summary`     | `string` / 无               | 摘要回退值；JSDoc 摘要优先                                                                                             |
| `docs.description` | `string` / 无               | 优先于定义的 `description`，JSDoc 描述仍优先                                                                           |
| `docs.tags`        | `string[]` / 无             | 与定义标签合并                                                                                                         |
| `enabled`          | `boolean` / `true`          | 单任务关闭后不调度，模块仍导入，定义仍校验，名称仍参与冲突检查                                                         |
| `cron`             | `string` / 无               | 与 `interval` 必须且只能提供一个；非空，由 Croner 解析，常用五字段与带秒的六字段格式见指南                             |
| `interval`         | `number` / 无               | 与 `cron` 互斥；正安全整数，单位毫秒，按 Unix epoch 对齐；不是从启动时间开始计时                                       |
| `timezone`         | `string` / 全局时区或 `UTC` | 仅 cron 可填写；非空有效 IANA 时区，任务值优先于 `jobs.timezone`                                                       |
| `handler`          | `VextJobHandler` / 必填     | 函数，可同步或异步；返回值不保存，异常记录日志，不自动重试                                                             |

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

在 `src/config/default.ts` 或所选 profile 配置的 `jobs` 字段中填写。配置结构在应用启动时校验，调度发现和 Redis 初始化在 HTTP 监听前完成；[配置合并顺序](/zh/guide/configuration)仍适用。

```typescript
interface VextJobsConfig {
  enabled?: boolean;
  dir?: string;
  include?: string[];
  exclude?: string[];
  timezone?: string;
  redis?: {
    url?: string;
    uri?: string;
    client?: unknown;
    namespace?: string;
    keyPrefix?: string;
    leaseTtl?: number;
  };
}
```

| 配置字段          | 类型 / 默认值                                   | 作用、优先级与约束                                                                                                                                         |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobs.enabled`    | `boolean` / `true`                              | 全局关闭时跳过任务发现与调度；应用仍校验配置结构，不会因此接受无效 `jobs` 配置                                                                             |
| `jobs.dir`        | `string` / `"jobs"`                             | 相对 `src` 的项目角色路径；`tasks` 对应 `src/tasks`。禁止绝对路径、`..` 和路径越界；不要写 `src/tasks`。构建运行时映射到对应编译根，如 `dist/tasks`        |
| `jobs.include`    | `string[]` / `["**/*.{ts,js,mjs,cjs,mts,cts}"]` | 替换默认包含规则；glob 相对任务目录，匹配实际文件，不自动把 `.ts` 改为 `.js`；空数组不发现任务。生产过滤应同时包含编译后的扩展名                           |
| `jobs.exclude`    | `string[]` / `[]`                               | 追加到内置忽略规则；不能重新启用下划线文件、声明文件、测试文件。下划线目录本身不被忽略                                                                     |
| `jobs.timezone`   | `string` / `"UTC"`                              | 非空有效 IANA 时区；仅作为未声明任务时区的 cron 默认值，不改变 interval 对齐；优先级为任务 > 全局 > UTC                                                    |
| `jobs.redis`      | 配置对象 / 未启用                               | 不配置时使用进程内调度；存在启用任务的内置应用 Cluster 必须配置，否则拒绝启动。外部进程/容器/多机副本也应显式配置；没有启用任务时不建立 Jobs Redis 连接    |
| `redis.client`    | ioredis 兼容对象 / 无                           | 有效客户端优先于 URL，需 `ping()` 和 `eval(script, keyCount, ...args)`，且支持所用 Lua 命令；调用者负责连接选项、错误处理和关闭，Jobs 不关闭传入 client    |
| `redis.url`       | `string` / 无                                   | 未传有效 client 时首先选择；其后依次是 `uri`、`VEXT_REDIS_URL`、`REDIS_URL`。使用空值合并而非真假回退，显式 `""` 会阻止继续回退并导致目标错误              |
| `redis.uri`       | `string` / 无                                   | URL 别名，优先级低于 `url`；`undefined` 才继续使用环境 URL；`null` 不属于有效配置类型                                                                      |
| `redis.namespace` | `string` / 自动生成                             | 自动值由项目包名、`VEXT_CONFIG`（默认 `default`）、`NODE_ENV`（默认 `production`）拼接并归一化；相同副本无需手填，仅额外业务隔离时覆盖                     |
| `redis.keyPrefix` | `string` / 无                                   | 非空值覆盖完整逻辑前缀，优先于 namespace；去首尾空白，缺末尾 `:` 时追加；空白值回退自动 namespace。它不是实际 Redis key 的起始部分，实际 key 另有 hash tag |
| `redis.leaseTtl`  | `number` / `30000`                              | 毫秒，安全整数且至少 `1000`；运行中约每 TTL/3 续期。与调度间隔、handler 超时、应用关闭预算不同；长任务无需把 TTL 设为整个运行时长                          |

namespace 归一化会去掉开头 `@`，把 `/`、`\` 转为 `.`，把其他不支持字符替换为 `-`，合并连续分隔符并去首尾分隔符；允许字母、数字与 `_ . : -`。例如 `@team/my-app:production:production` 得到 `team.my-app:production:production`。无法读取有效包名时使用 `vextjs-app`；归一化结果为空也回退为 `vextjs-app`。不同应用共用 Redis 时应核对归一化后是否相同。

默认逻辑前缀为 `vext:<namespace>:job:`。实际 key 结构、残留触发标记与 Redis Cluster 部署见[多副本指南](/zh/guide/jobs#cluster-与多副本)。Jobs 不借用 Session、缓存或限流的 Redis 配置。只有环境 URL 但没有 `jobs.redis` 对象时不会启用协调；可使用 `redis: {}` 配合环境变量。

## 文档源

`openapi.docs.code.jobs: true` 默认继承 `jobs.dir/include/exclude`；显式 Docs 字段分别覆盖相应字段，`false` 仅关闭文档扫描。定义被关闭仍可生成文档。声明时区、全局时区回退、开关与静态解析状态会显示在项目 Docs 的 Jobs 分类中；这些信息不是运行状态。具体配置、JSDoc 优先级、静态解析边界见[文档与 MCP](/zh/guide/jobs#文档与-mcp)。

## 错误与执行边界

- `VextJobDefinitionError`：定义无效、导入失败、任务文件没有 `defineJob()` 导出或没有可表示的未来触发点。
- `VextJobDuplicateNameError`：加载名称冲突，包括关闭的定义。
- 配置错误及活跃 Cluster 缺 Redis：启动拒绝，检查报错中的字段路径。
- 配置 Redis 的活跃任务：初始化验证连接、PING 与 Lua EVAL；失败时拒绝启动。
- 同任务重叠跳过；失败只记录日志；没有队列、自动重试、停机补跑或启动立即执行。
- 关闭在 `shutdown.timeout` 的总预算内等待并请求取消，不能强行中断忽略 signal 的函数。
- Redis 健康共享状态下协调同一触发点；不保证业务副作用恰好一次。

## 测试入口

`createTestJobScheduler`、`CreateTestJobSchedulerOptions`、`TestJobScheduler` 从 `vextjs/testing` 导入；`tick(Date)` 使用真实调度规则但不创建真实定时器、不扫描项目任务。普通 `createTestApp` 也不自动加载 Jobs。详见[测试 API](/zh/api/testing-api#createtestjobscheduler)与[验收和排查](/zh/guide/jobs#测试与验收)。

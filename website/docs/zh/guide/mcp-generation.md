# MCP 代码生成与依赖知识

Vext MCP 提供项目事实、生成候选和检查流程。宿主负责应用文件、执行命令并验证业务。`ready` 表示候选可进入宿主审查；`scaffold: true` 表示骨架，不能据此宣布业务完成。安装或导出 Skill 也不能证明宿主已实际调用 MCP。

## 一次开发的顺序

1. 调用 `vext_project_inspect`，取得当前项目身份、目录、配置和依赖事实；检查覆盖是否完整。
2. 用 `vext_knowledge_search` 查需要的依赖和框架能力。核对知识适用版本、配置前提及限制。
3. 将用户规范归一为 `policyPatch`；调用 `vext_generate_changes`，提供实际用例、输入、输出和目标。
4. 审查 ChangeSet 的文件、`scaffold`、`prerequisites`、`requiredHostSteps`。调用 `vext_validate_changes` 校验同一身份下的候选。
5. 宿主应用 create-only 文件；已有文件的接入和配置修改由宿主按实际内容增量完成。项目变化后重新 inspect，不能使用过期身份。
6. 执行项目已有的类型检查、定向测试、格式检查、构建及实际运行验证，记录命令、退出码和行为证据。最后停止本次验证启动的服务并清理临时产物。

MCP JSON 分析结果使用 `schemaVersion: 2`；workspace/dev.mcp 配置格式仍为 1。声明范围、内容身份、加载实现身份和运行实例状态是不同事实，不能相互替代。

## 目录默认值与用户覆盖

目录按职责选择，不因目录在建议表里就创建空目录。`server` 表示只能在后端使用的边界，`services` 表示该边界内的服务契约；默认完整路径是 `src/types/server/services/`，不是把所有 service 类型直接堆在 `server/`。

| 角色                                       | 默认位置                                               | 使用方式                                                 |
| ------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------- |
| routes / services                          | `src/routes/` / `src/services/`                        | 框架自动加载；路由调用实际 service key                   |
| models                                     | `src/models/`                                          | 模型 loader；子目录具有 database/pool 语义               |
| service-types                              | `src/types/server/services/`                           | service 输入/输出契约，TS import type 或 JS JSDoc import |
| server-model-types                         | `src/types/server/models/`                             | 领域持久化文档；查询方法类型使用原生泛型                 |
| shared-types / frontend-types              | `src/types/shared/` / `src/types/frontend/`            | 按实际消费端 import；不向浏览器泄露后端类型/模块         |
| schemas / validators                       | `src/schemas/` / `src/validators/`                     | 显式 import；文件存在不表示校验已接入                    |
| server-utils / shared-utils                | `src/utils/server/` / `src/utils/shared/`              | 无状态复用；不依靠 app 自动注入                          |
| mock-data / mock-scenarios / mock-adapters | `mocks/data/` / `mocks/scenarios/` / `mocks/adapters/` | 数据、场景、接入分开；只从指定开发/测试入口使用          |
| fixtures / seeds                           | `test/fixtures/` / `scripts/seeds/`                    | 测试输入与显式种子；GET 不隐式写库                       |
| frontend pages / components / layouts      | `src/frontend/pages/` / `components/` / `layouts/`     | page/layout 自动入口与普通可复用组件分开                 |
| locales / frontend-locales                 | `src/locales/` / `src/frontend/locales/`               | `<module>/<submodule>/<locale>.json`                     |
| public                                     | `public/`                                              | 静态文件；不把源码或私有数据放入公开目录                 |
| generated-types / storage                  | `src/types/generated/` / `storage/`                    | 派生产物或运行数据，不作为普通业务候选输出               |

最终路径以 `vext_project_inspect` 返回的有效角色为准。已有且无歧义的 `src/mocks`、`tests` 等布局可沿用；明确配置和角色覆盖优先。覆写父角色会影响未单独覆写的子角色。

例如，项目要求 service 类型直接位于 `src/types/service/` 时，可通过本次调用的 `policyPatch.roles` 或 workspace `policyDefaults.roles` 指定：

```json
{
  "outputLanguage": "zh",
  "commentLanguage": "zh",
  "roles": { "service-types": "src/types/service" }
}
```

此对象是 policyPatch 内容，不是完整 Tool 请求或 workspace 文件。别名 `server-service-types` 指向同一角色，不能同时给别名和标准名配置冲突路径。

自定义 service/route 位置不会改变运行时 loader。需要时，候选同时生成实际加载目录内的 re-export 入口；不能把业务实现挪走后假定框架会扫描新位置。feature 架构可以把实现放在 `src/modules/<feature>/`，仍保留必要的加载入口。

monorepo 只读取当前服务与声明且验证过的共享源码。models 的 `models/<database>/<file>` 和 `models/<pool>/<database>/<file>` 不是普通业务分类；共享模型包共享定义，各应用持有自己的连接。固定项目根外的文件不会因共享声明就获得任意写入权限。

## Service、类型与公共方法

route 保留 HTTP 校验、权限、响应契约及用例调用。service 保留业务编排；model 保留持久化 schema/hooks/index。复用的纯转换放 utils，有领域规则的公共校验放 validators。

不按 `function` 数量判错。回调、单次使用的短逻辑、service 私有方法或局部函数可以保留；跨路由公共 helper 不放在自动加载的路由文件，不为一行直观表达式强制套函数。简单内部结果可推断，无实际复用不强制新建类型文件。

TS 项目生成 TS/TSX；JS 项目生成 JS/JSX 和必要 JSDoc 契约。目标目录混合 JS/TS 时要求明确 `options.language`。类型规则、文件命名和用户架构不能覆盖框架实际加载边界。

注释解释用例、权限、幂等、事务、缓存失败、时间单位等非显然语义。`commentLanguage` 显式设置优先，`auto` 结合项目已有注释与输出语言；宿主应把当前用户意图传为策略。静态 JSON formatter/.editorconfig 参数参与生成；动态 formatter 配置不在 MCP 中执行，由宿主运行项目 formatter。

路由与页面 Recipe 接受 JSON-safe 的 `routeOptions`，以及顶层 `auth`、`middlewares`、`cache`、`docs`、`operationId`、`security`、`access`。显式 `false`、空数组和 `null` 会被保留；函数鉴权、运行时 store/client 或动态 check 不能序列化进 MCP options，必须由宿主在代码中接入或引用已有模块。受保护页面和 admin API 应在读取数据前声明路由鉴权或中间件边界。

backend locale 用于错误 key，默认形态包含 `code`、`message` 和 HTTP status 语义；frontend locale 用于用户可见文案、动作和状态。mock 数据、场景和 adapter 分别放在 mock-data/mock-scenarios/mock-adapters，不写进 service 当内置种子。

## 17 条 Recipe 的输入和接入

每条 Recipe 有独立 options schema，见 `vext://catalog/recipes`。未知字段或冲突参数会拒绝，不会默默忽略。以下是职责摘要，完整字段由当前安装包返回。

| Recipe                    | 主要输入                                                              | 产物与必须完成的接入                                                                                   |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| RCP-01 api-route          | method/path、RouteOptions、validate/responses、handler 或现有 service | 路由；自定义结果必须提供 responses                                                                     |
| RCP-02 api-module         | serviceMethod、input/output、body、RouteOptions、validate/responses   | 实际调用生成 service；输入默认经 `req.valid("body")` 传递                                              |
| RCP-03 page-route         | page/path、props、RouteOptions                                        | render 路由与对应页面；只传可序列化且获准输出的数据                                                    |
| RCP-04 page-and-api       | page/path、props、apiPath、routeOptions/apiRouteOptions               | 页面实际请求生成 API，含 loading/error/取消逻辑                                                        |
| RCP-05 service            | body、input/output 或 parameters/imports                              | 用例及必要类型；声明输入时需给处理该输入的 body                                                        |
| RCP-06 model              | collection/key、schema/document、indexes/connection                   | 原生 VextModelDefinition；数据库由应用配置，不在导入期连接                                             |
| RCP-07 middleware         | body、factory/options                                                 | handler 或参数工厂；须在配置或路由显式挂载                                                             |
| RCP-08 plugin             | setup/onReady/onClose、dependencies                                   | 生命周期；只关闭自己创建的资源                                                                         |
| RCP-09 locale             | target、module/submodule、locale/messages                             | 模块语言文件；实际读取并核对其他语言缺键                                                               |
| RCP-10 test               | target/exportName、kind、cases                                        | 调用真实导出函数的 unit/integration 测试；至少两个不同预期/边界                                        |
| RCP-11 type-contract      | target、fields                                                        | 消费者拥有的类型；复杂已有契约按需复用                                                                 |
| RCP-12 utility            | description/body、parameters/returnType、target                       | 真实纯操作；信息不足不生成 identity 占位包装                                                           |
| RCP-13 frontend-component | title                                                                 | 展示组件骨架；业务交互、样式及 i18n 按实际需求补齐                                                     |
| RCP-14 frontend-layout    | page、reusable                                                        | 渲染 children；可复用布局须由真实页面入口引用                                                          |
| RCP-15 reusable-schema    | fields、usage/consumer                                                | 合法 DSL/字段 schema；实际绑定请求、响应或 Job payload                                                 |
| RCP-16 mock-scenario      | data、scenarios、target                                               | 数据与场景分开；选择已有 adapter，不默认安装 mock 库                                                   |
| RCP-17 job-handler        | payload、handler、queue/schedule、retry/timeout                       | queue 必须为对象；cron 校验不启动 timer；scheduler 不传业务 payload；部署需实际 worker/scheduler/store |

`api-module` 始终调用本次生成的 service，不能同时指定其他 service 或覆盖 handler。使用自由 parameters 时必须给对应 serviceArgs；显式 input 默认需要 validate.body。独立 `api-route` 的 serviceArgs/serviceMethod 必须对应实际 service。

Recipe 是有明确范围的候选生成器。RCP-10 不自动生成完整浏览器 E2E，RCP-13 不猜测业务交互，RCP-16 不猜测第三方 mock adapter。缺少必要信息返回 `incomplete`，不支持的组合返回 `unsupported`；宿主仍需完成声明的集成步骤及业务验证。

`vext_project_check` 和 `vext_validate_changes` 接受 `configTarget: "development" | "production" | "all"`。涉及 Redis、rateLimit、session、Job、cache 或生产启动差异时应指定目标；`all` 会同时检查开发和生产静态配置。`vext_capability_check` 会分别返回 catalog 原始状态、框架支持、MCP 覆盖和当前项目状态；`partial`、`planned`、`unknown` 或 `unverified` 不能被提升为 supported。

## 依赖知识的版本与证据

知识随框架编译进入安装包，不在用户启动时联网抓“最新文档”。知识命中区分以下事实：

| 字段                                     | 含义                                                     |
| ---------------------------------------- | -------------------------------------------------------- |
| dependency.declaredRange                 | 当前加载框架 manifest 的声明范围                         |
| dependency.reviewedVersions / reviewedOn | 此知识审查对应的精确版本及日期                           |
| dependency.applicability.owners          | 分开列服务与框架 owner 的声明范围、实际安装版本及适用性  |
| reviewed-version                         | 命中知识审查版本；仍需运行验证                           |
| version-mismatch / unverified            | 版本不同或无法解析；先核对精确版本官方资料               |
| evidence / examples / verification       | 官方来源、包内参考文件、直接参与类型检查的示例及测试索引 |

知识覆盖 schema-dsl、monSQLize、response-cache-kit、cache-hub、flex-rate-limit、esbuild、croner、ioredis、React/ReactDOM、MCP SDK 和 Oxc。第三方完整手册与框架已验证接缝分开；高级能力未验证时不能标成已通过。官方网页主分支也不能代替已安装版本的声明与源码。

数据库示例优先 `app.db.model<Document>(key)` 和原生 `findPage({ query, ... })`。`findPage` 返回 `items/pageInfo`，`findAndCount` 返回 `data/total`；详见[数据库](./database)。响应缓存、数据库缓存、限流、Job、session 各自拥有配置和生命周期，Redis 配置存在不代表所有模块已启用或已连通。

`domain` 使用与项目检查相同的领域及别名（例如 database→models），并与 kinds/ids 共同筛选；未知领域返回参数错误。`locale` 返回对应语言的检索说明，正文保留随包中英文与 API 原文，`localization.status: partial` 明确表示未提供逐条完整翻译；不把原文伪装成已本地化内容。

任何需求、配置、目录、依赖或公开 API 变化，都要评估并同步知识、Recipe、检查规则、文档与相应消费者测试。若无需修改，应记录未受影响的依据；不能只更新依赖版本字符串。

## 确认宿主实际采用了 MCP

在服务根运行 `vext mcp sync --root . --check --skill --json`，检查 `adoption` 的配置、launcher 和 Skill 文件状态。Codex 继续使用用户级 MCP 配置，项目 Skill 位于 `.agents/skills/vextjs/SKILL.md`。Skill 含 YAML name/description；自定义内容不会被自动覆盖。需要主动替换旧导出时，先审阅文件，再显式执行 `vext mcp skill write --output .agents/skills/vextjs/SKILL.md --force`。

配置读回匹配、Skill 元数据正确，只证明文件状态。TOML 检查明确为受管块文本匹配，不代表整份 TOML 已由宿主解析。Skill discovery、connection 与 taskUsage 仍为 unverified，直到宿主提供实际发现和调用证据。通过宿主调用 `vext_project_inspect`，比对 rootDir、projectId 和 `implementation.loadedDigest`；在本次验收记录保留 Tool 调用、候选 SHA、宿主命令和结果。不能从文件存在反推模型已使用 MCP，也不能据此断言之前未启用。

框架构建在 `dist/.implementation.json` 写入完成标记。MCP 固定加载时摘要；磁盘清单变化返回 restart-required，构建中/缺失/损坏返回 unverified，不能继续给出可应用候选。维护框架时 `npm run build` 生成 ESM+CJS；`build:esm` 和 `dev`（watch）只生成 ESM，`build:cjs` 要求已有与源码对应的 ESM。需要完整本地安装行为时使用 build。直接运行 tsc 不发布完整实现清单。

CLI `sourceBuild` 检查仅在框架源码存在时比较构建输入，源码改动未 build 会提示 build-required。生产安装包不要求有 src。日常 MCP 请求只读取小清单；它是受管构建的身份记录，不是对手工篡改 dist 的完整性审计。重建后在宿主重新连接，再读取 Tool 的加载摘要；框架不会终止宿主进程。

## 多服务与多进程运行信息

每个启动 owner（开发进程、web、cluster 主进程、独立 Job worker/scheduler）持有随机 instanceId，在 `.vext/runtime/snapshots/<instanceId>.json` 写 schemaVersion=2 的记录。不同服务按真实 root/projectId 隔离；同一服务内多个角色/启动实例分别保留。开发进程重启子 worker 时追加 ready/reload 事件，不清空同一 owner 的历史。cluster 的 workers 由其主进程聚合。

`vext_runtime_inspect({ section: "summary" })` 返回可分页实例摘要；使用返回的 instanceId 查询该实例的 summary/workers/reloads/events。未选实例时事件与 worker 项带 instanceId。游标绑定项目、section、实例选择和快照内容；过期游标应丢弃并重新读取首页。

单次最多遍历 200 个目录项、读取每文件 1 MiB、累计 8 MiB；events/reloads/workers 各保留最近 200/100/200 项。展示另有响应预算，缩小 limit 不会把不完整采集变成完整。越界链接、非法 schema、归属不一致、读写变化或超限会返回 invalid/partial 和原因；不返回原始日志。

快照的 updatedAt 不是心跳：liveness 保持 unverified。sourceRevision 只有来源契约一致且实际提供时才比较；当前启动入口未持有与 MCP 全部输入同域的摘要，因此保留 null/unverified，不为诊断追加全量源码扫描。文件存在不能证明服务活着，文件缺失也不能证明它已停止。

同一 owner 的更新按序合并，随机临时文件在成功/失败后清理。正常关闭写 stopped；启动时仅清理同项目、已 stopped 至少 24 小时且 PID 已不存在的记录，最多检查 200 项。未知归属、未知存活或非正常退出记录保留；达到上限时由宿主确认实际进程后手动清理对应文件。旧 `.vext/runtime/snapshot.json` 仅返回 legacy/unverified 提示，不参与 v2 证据判定。MCP 仍不启动/重启/停止业务服务，也不执行 Job。

## 默认请求校验与响应 Schema 的区别

默认 `RouteOptions.validate.body/query/param` 和 `app.getValidator().compile()` 接收 DSL 字段表，例如 `{ "title!": { type: "string" }, featured: "boolean?" }`。不要把完整的 `{ type: "object", properties: ..., required: [...] }` 直接放在该位置；它会被解释成名为 `type`、`properties` 等的字段。`responses[status].schema` 是另一个入口，支持完整 JSON Schema。

MCP 遇到这种明显的根对象混用会要求补充或改正输入；项目检查会提示复核。项目显式替换 validator 时，应以该 validator 的真实请求测试为准。默认校验有类型转换能力；严格 JSON 布尔值、额外字段和空白业务规则可放在请求前置中间件与 `validators`，不要为此改变整个应用的 query 转换行为。

## 本次业务消费者补充的边界

- Job 提供 payload 字段表时，Recipe 同时生成运行 schema 与推导类型，默认位于 `src/schemas/<name>-payload.ts` 和 `src/types/server/jobs/<name>.ts`；Job 引用它们。JS 使用 JSDoc，`job-types` 角色及上级目录可由用户策略覆盖。无 payload 时不创建空类型。
- 内置 scheduler 创建 scheduled run 时不携带业务 payload。带必填 payload 的 Job 应由宿主显式 `run/enqueue`，或让 scheduled handler 自行查询待处理数据；内置 store 的 `completeRun()` 只允许当前 running owner 完成并清理 lease，迟到或重复 completion 不覆盖终态。
- API 字段级 `{ type: "boolean" }`、`{ enum: ["draft", "published"] }` 要与真实运行校验一致，不能转换成带有 type/enum 子字段的对象。整个请求位置仍是 DSL 字段表；完整根 JSON Schema 不可与它混淆。
- 退出或 401 应清除 token、旧存储键、列表和编辑状态；保存已提交而刷新失败要单独呈现。SSR 图片可能早于 hydration 失败，挂载后还需检查原生图片的 complete/naturalWidth。
- 构建成功后才消费实际生成的 API client；源码不能凭空导入未生成文件。真实消费者包含 TS/JS、HTTP、OpenAPI、客户端类型与浏览器，不能用静态候选通过替代这些证据。

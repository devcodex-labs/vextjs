import type { DependencyKnowledgeEntry } from "./contracts.js";
import { MONSQLIZE_KNOWLEDGE } from "./database.js";
import { VALIDATION_KNOWLEDGE_EXAMPLES } from "./validation.js";

function entry(
  id: string,
  packageName: string,
  version: string,
  summary: string,
  officialUrl: string,
  entryPoints: string[],
  prerequisites: string[],
  guidance: string[],
  limitations: string[],
): DependencyKnowledgeEntry {
  return {
    id,
    summary,
    dependency: {
      packageName,
      reviewedVersions: [version],
      reviewedOn: "2026-09-15",
      evidence: {
        officialUrls: [officialUrl],
        installedPackageFiles: ["README.md", "package.json"],
      },
      entryPoints,
      prerequisites,
      guidance,
      limitations,
      examples: VALIDATION_KNOWLEDGE_EXAMPLES[id] ?? [],
    },
  };
}

/** 随发布更新并进入 catalog digest；联网最新文档不能替代当前安装版本的契约。 */
export const DEPENDENCY_KNOWLEDGE: DependencyKnowledgeEntry[] = [
  entry(
    "K01",
    "schema-dsl",
    "3.0.4",
    "Vext 请求、响应、Job payload 校验和 OpenAPI schema 的默认 DSL 引擎。",
    "https://github.com/devcodex-labs/schema-dsl",
    [
      "RouteOptions.validate/responses",
      "app.getValidator().compile(schema)",
      "schemaAdapter",
      "defineJob({ payload })",
    ],
    [
      "先确认当前 app validator 是否由插件替换；请求、模型和响应 schema 分别承担输入、持久化与输出契约。",
    ],
    [
      "路由通过 validate 校验后消费 req.valid；公共 schema 放 schemas，跨入口业务校验通过 app.getValidator()，不要在每条路由堆 readString/readTags/isRecord 重复解析逻辑。",
      "业务 validator.compile(schema) 返回校验函数，调用结果含 valid/data/errors。框架内部通过 schemaAdapter 访问默认 DSL，不让业务直接导入第三方实例绕过全局替换。",
      "PATCH 使用独立可选字段 schema，区分未传、null、空数组；只有确实修改的字段进入更新操作。schema 验证不代替权限检查或数据库唯一约束。",
      "responses 描述业务输出；按框架实际响应包裹与 OpenAPI 生成结果核对，不能只写描述字符串或用任意对象遮盖 DTO。JSON Schema 与 DSL 编译后的输出需要分别验证。",
      "复用 schema 与 locale key；locales 按功能模块/子模块组织。不要把依赖的全局默认语言或 schema 缓存误认为跨应用隔离已经验证。",
    ],
    [
      "类型推断不证明自定义 validator、异步业务校验和所有 OpenAPI 关键字等价；宿主运行正反输入、响应与文档测试。",
    ],
  ),
  entry(
    "K02",
    "response-cache-kit",
    "1.2.2",
    "路由响应缓存与 app.cache 控制面；失效、TTL 和身份分区有各自契约。",
    "https://github.com/devcodex-labs/response-cache-kit",
    [
      "RouteOptions.cache",
      "config.cache.cacheHub",
      "app.cache.invalidate(tag)",
    ],
    ["识别请求方法、授权状态、缓存 key/namespace、数据变更后的失效路径。"],
    [
      "Vext 路由 cache 和默认 TTL 以毫秒计，通常经 app.cache 控制面使用底层缓存；不要从 cookie/session 的秒数复制值。",
      "公开内容和认证内容必须按当前缓存契约隔离；草稿、个人数据不能落入公开列表/详情缓存。partitionKey 和标签都需覆盖实际查询、身份与语言。",
      "写入 DB 成功后再失效关联列表、详情和统计标签。失效失败不会回滚已提交数据；明确日志/重试和响应语义，避免用户重复提交。",
      "cacheHub Redis/MultiLevel 属于响应缓存 owner，关闭和清理由创建者负责，只操作自身 namespace；不能 FLUSHDB 或清除其他模块 key。",
    ],
    [
      "仅存在 Redis 配置不证明失效跨实例传播、缓存命中或授权分区正确；需真实 Redis 与多实例测试。",
    ],
  ),
  entry(
    "K03",
    "flex-rate-limit",
    "2.2.5",
    "全局与路由限流的原生策略、共享计数和替换接口。",
    "https://github.com/devcodex-labs/flex-rate-limit",
    ["config.rateLimit", "RouteOptions.rateLimit", "app.setRateLimiter()"],
    [
      "选择 memory 或 rateLimit.store Redis；Redis 模式必须解析到实际 target，缺失 URL 不能被当成内存降级。",
    ],
    [
      "内存计数属于单进程；多进程/cluster 要共享原子计数 store。只配置其他模块的 Redis 不自动启用 rateLimit Redis。",
      "windowMs 等带 Ms 字段单位为毫秒；框架 config 的公开字段与第三方构造参数分别按各自类型使用，不把 RedisStore 构造器直接塞进声明式配置。",
      "全局与路由覆盖、keyBy、enabled、message 及代理 IP 信任规则要一起检查；按用户限流必须先取得可信身份。",
      "上游 RedisStore/CacheHubStore 有原子操作与生命周期要求；使用替换 limiter 时保留 Vext key 和结果契约，已注入的外部客户端不因单个模块关闭而被误关闭。",
    ],
    [
      "MCP 静态分析不会证明 Redis 连通性、原子计数或限流算法正确；由宿主测试阈值、窗口恢复、两实例共享和 store 故障。",
    ],
  ),
  entry(
    "K04",
    "esbuild",
    "0.28.2",
    "Vext 编译与热重载使用的构建器；构建成功不等于类型或运行验收通过。",
    "https://esbuild.github.io/api/",
    ["vext build", "vext dev", "createTestApp", "项目实际 typecheck/test 脚本"],
    [
      "使用当前 packageManager 与 scripts；后端、前端、preload 和测试入口分别遵循框架配置。",
    ],
    [
      "esbuild 转译 TypeScript 不执行 TypeScript 类型检查；必须另跑项目 typecheck，不能仅凭编译完成宣布代码可用。",
      "后端包依赖与模块边界由 Vext 构建器处理，不默认捆绑所有依赖或修改 ESM/CJS 导入规则；JS 项目不能生成只有 TS 能解析的类型语法。",
      "dev 构建、生产 build 和测试 services:true 编译属于不同消费者；热更新成功不能替代生产入口和 shutdown 验证。",
    ],
    ["MCP 只给宿主命令和候选，不自行启动 watcher、编译用户配置或运行构建。"],
  ),
  MONSQLIZE_KNOWLEDGE,
  entry(
    "K06",
    "cache-hub",
    "2.2.4",
    "响应缓存与可选 session cache adapter 的存储接口，不是全框架统一 Redis。",
    "https://github.com/vextjs/cacheHub",
    [
      "config.cache.cacheHub",
      "createCacheSessionStore(cache, options)",
      "cache-hub/redis",
    ],
    [
      "cacheLike 需提供 get/set/del；session adapter 的创建、prefix 和 close 应有明确 owner。",
    ],
    [
      "createCacheSessionStore 接收 cacheLike，不把 session 默认为 app.cache 响应缓存，也不自动借用 jobs 或 rateLimit 的连接。默认前缀 vext:session: 需要结合实际应用隔离；跨进程应共享稳定前缀，不按 PID 随机生成。",
      "session store 的 ttlSeconds 是秒，adapter 转成毫秒传给 cache.set；业务调用底层 CacheHub TTL 为毫秒。由已有适配器转换一次，不能手动再乘除。",
      "session 数据必须可序列化为对象；过期、touch、delete、异常和 serializer 都需要测试。close 仅在创建者拥有资源时显式绑定。",
      "memory/MultiLevel 的本地 L1 不自动保证多实例 session 实时一致；会话撤销和滑动续期应验证实际后端行为。mock/fixture 数据不混入生产 session 或 service。",
    ],
    ["创建 adapter 不等于 Redis 已连接；MCP 不实例化第三方客户端。"],
  ),
  entry(
    "K07",
    "croner",
    "10.0.1",
    "Job cron 解析与 scheduler 时间计算；调度和任务执行为独立职责。",
    "https://github.com/hexagon/croner",
    [
      "defineJob({ schedule, queue, handler })",
      "config.jobs.scheduler",
      "vext job scheduler",
      "vext job worker",
    ],
    [
      "按 jobs 配置选择实际 store、scheduler mode、worker 数量和部署身份；共享 Redis target/prefix 在所有参与进程保持一致。",
    ],
    [
      "HTTP 服务启动不会自动运行 scheduler；宿主或部署平台显式启动 scheduler/worker。单独存在 Job 文件不能证明定时任务已启用。每个 worker 进程遵守自己的 jobs.worker.concurrency，横向扩容后的总并发由部署副本数决定。",
      "schedule 使用 cron 或 interval，timezone 明确处理 DST；queue 为对象，不是队列名称字符串。内置 scheduler 创建 scheduled run 时不提供业务 payload；带必填 payload 的工作应手动/显式入队，或让定时 handler 自行查询待处理数据。",
      "定义的 payload 是 DSL 字段表；MCP 将其保留为 schemas 中的单一真相，用 InferVextValidation 推导 types/server/jobs 契约，TS 泛型和 JS JSDoc 消费同一字段表。启动前验证无效 cron、时间范围、retry/timeout 和 shutdown。",
      "共享 scheduler lease 限制同一计划重复入队；run lease 限制并发领取，内置 store 完成时要求当前 running owner 且完成后清除 lease。迟到或重复 completion 返回 false，不覆盖终态；handler 仍必须幂等，业务唯一键和重试/租约过期的副作用需要验证。",
      "memory/file 的多机共享能力与 Redis 不等价；不要根据同一台机器测试结果推断跨主机排他。",
    ],
    [
      "MCP 不执行 handler 或创建 timer；静态 schedule 合法不代表部署调度和故障恢复已通过。",
    ],
  ),
  entry(
    "K08",
    "ioredis",
    "5.11.1",
    "Job、限流及可选缓存/session 各自使用的 Redis 客户端能力与所有权。",
    "https://github.com/luin/ioredis",
    [
      "config.jobs.store",
      "config.rateLimit.store",
      "config.cache.cacheHub",
      "session store plugin",
    ],
    [
      "按实际模块配置解析 Redis URL/target 和稳定应用标识；不能因某处存在 REDIS_URL 就推断所有模块已启用。",
    ],
    [
      "模块各自负责连接、key 前缀和关闭，不增加隐式统一 Redis singleton。前缀隔离应用/环境/模块，但同一应用的协作 worker/scheduler 必须一致；随机进程前缀会破坏协调。Job Redis store 的 run claim、lease renewal 和 completeRun 通过 Lua 原子脚本保护。",
      "连接重试、离线队列、命令超时、Cluster hash slot 和 Lua 原子性按实际部署核对；GET 后 SET 不是原子锁。",
      "删除、扫描、清理只限当前 owner namespace；关闭只处理自己创建的连接。客户端包存在、URL 静态可见和真实连通性分别报告。",
    ],
    [
      "无自动连库/连 Redis 的 MCP Tool；读到配置也不能宣称跨进程锁、session 撤销或限流共享已通过。",
    ],
  ),
  entry(
    "K09",
    "@modelcontextprotocol/server",
    "2.0.0",
    "随框架分发的 MCP stdio 协议；宿主采用、候选生成和执行证据分开。",
    "https://github.com/modelcontextprotocol/typescript-sdk",
    [
      "vext mcp",
      "vext mcp sync",
      "7 Tools / 11 Resources / 4 Prompts / 17 Recipes",
    ],
    [
      "固定服务根与 loaded implementation identity；宿主启用并实际调用 MCP 后才能声称已采用。",
    ],
    [
      "SDK v2 server 包与旧 @modelcontextprotocol/sdk 的导入表面不同，不能复制 v1 transport/context 示例。",
      "宿主执行文件应用、启动、重启、测试、构建与部署；MCP 返回事实、候选、规则和流程，不接受任意 cwd/root/shell。",
      "Skill 导出或配置同步成功不等于宿主已加载，更不等于任务已调用 MCP。Tools-only 和 Skill 路径都要 inspect→knowledge→generate/validate→host verification。",
      "取消信号和分页不应改变分析总判定；unknown/incomplete 不能投影为通过。协议 JSON schemaVersion 与 npm 框架版本是不同身份。",
    ],
    [
      "MCP 不强迫宿主遵循每条建议，不保证业务正确或所有宿主版本兼容；实际调用和运行结果须提供证据。",
    ],
  ),
  entry(
    "K10",
    "react",
    "19.2.7",
    "Vext frontend 的页面、layout、SSR/hydration 与浏览器交互边界。",
    "https://react.dev/reference/react",
    ["src/frontend/pages", "vextjs/frontend", "res.render", "React hooks"],
    [
      "确认 config.frontend、React/ReactDOM 安装版本和项目页面入口；浏览器不能导入 server model/service。",
    ],
    [
      "页面、layout 和 API 必须接通实际数据流；layout 渲染 children，表单提供 loading/error/empty 状态并在成功后更新相关列表/统计。",
      "SSR 不读取浏览器 token 或 localStorage；草稿权限在服务端检查，禁止把管理端数据序列化到公开 HTML。避免将密钥传进页面 props。",
      "时间、locale 与随机内容必须保持服务端首屏和客户端首次渲染一致。请求中断、重复提交、图片失败、标签和键盘访问用浏览器 E2E 验证。",
      "退出/401 应清除 token、旧存储键、数据和编辑表单；旧请求不得恢复已退出的状态。提交已成功但列表刷新失败要单独提示。SSR 图片可能在 hydration 前失败，除 onError 外应检查挂载时 complete/naturalWidth；通过真实失败资源验证回退。",
      "本知识还需配合实际 react-dom 版本；MCP 使用项目有效目录与样式/i18n 规范，不强制导入未生成的 typed client。",
    ],
    [
      "静态 JSX 合法不证明 hydration、交互和无障碍正确；Recipes 的 scaffold 不能当成完整业务页面。",
    ],
  ),
  entry(
    "K12",
    "react-dom",
    "19.2.7",
    "ReactDOM 的服务端输出与浏览器 hydration；与 React 版本及 Vext frontend 产物一起验收。",
    "https://react.dev/reference/react-dom",
    ["res.render", "Vext frontend SSR/hydration"],
    ["检查 React 和 ReactDOM 的实际版本、构建资产与服务端页面入口。"],
    [
      "服务端只序列化允许公开的页面 props；首屏 HTML、locale、时间格式和客户端初始值必须一致。",
      "页面脚本加载失败、路由错误、请求中断、hydration 和交互需浏览器验证；不把 TSX 编译成功当作页面通过。",
    ],
    [
      "不让业务代码绕过 Vext 自建第二套 SSR/hydration 入口；具体 ReactDOM API 按对应版本官方文档处理。",
    ],
  ),
  entry(
    "K11",
    "oxc-parser",
    "0.149.0",
    "共享源码事实层的 AST 解析，不执行用户模块。",
    "https://github.com/oxc-project/oxc",
    ["tooling/source-view", "StaticModuleGraph", "parseSourceSyntax"],
    ["共享 sealed SourceView、精确文件类型和可解析预算；动态值保留 unknown。"],
    [
      "JavaScript/JSX 与 TypeScript AST 有差异，解析成功不能替代 TypeScript 类型检查。不要用 function 数量、单行长度或正则名称猜测业务是否正确。",
      "静态常量、导入和 re-export 只在可证明的模块图内解析；不得执行用户配置来补全 unknown，也不能把解析失败当作空目录。",
    ],
    [
      "不提供通用 JavaScript 求值器；反射、动态模块与不可证明调用链明确输出覆盖不足。",
    ],
  ),
];

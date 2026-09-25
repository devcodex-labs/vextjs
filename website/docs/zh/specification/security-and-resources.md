# 安全与资源规范

本页规定认证、授权、Session、CSRF、安全响应头、限流、响应缓存与上传资源的职责，以及长期资源的生命周期和隔离合同。先确定访问保护，再核对状态、执行位置和资源预算。配置字段参考[配置 API](/zh/api/config)，完整路由合同参考[路由定义](/zh/api/route-definition)。

首次接入使用[认证与安全](/zh/guide/security)的完整流程；本页的规范级别描述应用应遵循的约束，不表示框架会自动执行所有要求。

## 身份与访问保护

<a id="vext-sec-001"></a>

### VEXT-SEC-001 [MUST] 将身份识别和路由授权显式连接

`createAuthMiddleware()` 调用应用提供的 `verify()`，把认证结果写入 `req.auth`。它负责识别请求身份，不会仅因缺少凭据就自动保护所有路由。应用需要在路由设置 `auth` 或执行自己的访问控制。

`auth: true` 要求已认证身份；对象形式可声明 roles、scopes、permissions 和 `check`。默认 `required: true`、`mode: "any"`；`mode` 用于同类要求中的匹配，不能把它理解为“角色、scope、权限与 check 任意一类通过即可”。`required: false` 但仍有非空 roles/scopes/permissions 或 `check` 时，匿名请求仍须被拒绝；空数组不构成授权要求。

正常 Guard 路径中，缺少或无效身份返回 401，已认证但未获授权返回 403。`verify`、`can` 或 `check` 抛错属于 500 错误路径；仅提供 `assert` 判断权限时，其抛错会被视为拒绝并返回 403。`auth: false` 不创建 Guard，但不能撤销其他全局或前置中间件已经执行的访问保护。

框架默认匿名上下文不是登录功能；`verify()` 如何验证凭据、如何查询用户和计算权限由应用提供。客户端提交的角色或用户标识不能未经可信验证就作为授权事实。现有完整集成见[权限核心认证示例](/zh/examples/permission-core-auth)。

<a id="vext-sec-002"></a>

### VEXT-SEC-002 [MUST NOT] 不得把文档声明、输入校验或 CORS 当作授权

`docs.security` 描述 OpenAPI 安全需求，不执行身份识别或权限检查。输入 Schema 通过只证明数据符合所声明合同。CORS 控制浏览器的跨域读取行为，不能作为服务端对象访问授权。

访问某条记录时，仍须在可信身份基础上验证对象归属或资源权限。需要资源上下文的权限判断应由真实业务数据决定，见[校验与业务边界](/zh/specification/validation-and-contracts#vext-contract-001)。

## Session、CSRF 与响应头

<a id="vext-sec-003"></a>

### VEXT-SEC-003 [MUST] 按各机制的启用条件配置保护

| 机制             | 普通框架启动的启用条件与边界                                                            |
| ---------------- | --------------------------------------------------------------------------------------- |
| Session          | 全局 `session.enabled: true`，或支持的路由 `session` 覆盖；也可显式注册 Session 中间件  |
| CSRF             | 全局 `csrf.enabled: true` 或显式注册中间件；路由 `csrf: false` 可跳过已注册的 CSRF 检查 |
| Security Headers | 配置 `securityHeaders.enabled: true` 启用全局处理；手动工厂的默认启用语义需按其接口核对 |
| Rate Limit       | 全局 `rateLimit.enabled: true` 后注册内置限流；仅写路由覆盖不会自行启用全局限流         |

这些机制默认是否启用、路由覆盖能力和手动中间件行为各不相同，不能由一个 `enabled` 字段推断全部机制。Session 已由全局配置注册时，不应再无意重复注册同一功能。

当前普通启动的 Session、CSRF、Security Headers 和 Rate Limit 均默认关闭。启用某一项不会自动启用其他项；手动工厂与测试 helper 的默认值也不能当作普通启动的最终配置。

CSRF 的自动模式优先使用可用的 Session，否则需要签名 Cookie 的 secret；缺少两者会触发配置错误。CSRF token、Origin/Fetch Metadata 检查和认证保护分别处理不同问题，路由跳过应有明确用途并测试拒绝场景。

内置全局 Session 和插件全局中间件在全局 CSRF 前执行，路由 Session 在其后；因此只开启路由 Session 不能为更早的全局 CSRF 自动提供 Session 后端。路由 `csrf: true` 也不会自行注册全局保护。涉及 token、写请求和跳过规则时，按实际链序验证，不能只看最终 handler 能否读取 Session。

Session/CSRF Cookie 配置中的 `secure: "auto"` 依赖框架识别的请求协议；普通 `res.cookie()` 的 `secure` 只接受布尔值。代理部署必须核对协议与信任配置。Cookie 属性和 Session 存储行为详见[Cookies 与 Sessions](/zh/guide/cookies-session)。安全头应同时检查成功、错误、404 和缓存响应，手动中间件不代表所有旁路会自动获得相同头。

<a id="vext-sec-004"></a>

### VEXT-SEC-004 [SHOULD] 在实际执行位置核对限流键与跨进程状态

内置全局限流先于插件全局中间件和路由 Guard 执行。依赖身份的 key 必须在限流执行时可用，不能假定后续认证中间件已经填充身份。

默认内存存储属于当前进程；多 worker 或多实例需要按实际部署选择共享存储与一致的命名空间。窗口参数的单位、路由覆盖、自定义 limiter 和存储错误行为均须按实际配置核验，不能将每进程额度描述为集群总额度。

`keyBy: "user"` 使用当时的 `req.user.id`，缺失时回退 IP，不会自动使用 `req.auth.subject`。当前内置算法/Store 检查异常可能记录错误后放行；不能将该策略用于承诺“存储故障时必定拒绝”。自定义 limiter 抛错、返回拒绝，以及 Redis 初始化缺少目标是不同路径，详见[请求限流](/zh/guide/rate-limit#存储故障与放行策略)。

<a id="vext-sec-005"></a>

### VEXT-SEC-005 [SHOULD] 响应缓存按访问身份和数据差异划分

路由 Auth Guard 在响应缓存之前执行，但授权通过不代表不同用户可以共享同一响应。返回用户专属数据时，应禁用缓存或选择充分区分用户、租户、权限及必要请求维度的键，并验证不会跨身份命中。

包含 Session 或 CSRF token 的响应不能仅根据 URL 判断是否可共享。当前 `allowCookieCache: false` 不保证绕过已有缓存；响应不写入存储也不保证不参与并发合并。`private` / `no-store` / `Set-Cookie` 不能作为阻止请求间共享的唯一措施。会话写入、私有数据或必须每次执行的请求，应在进入缓存前使用 `cache: false` 或明确的 `condition` 排除，见[响应缓存的并发边界](/zh/guide/cache#并发回源)。

服务端 `partitionKey` 不控制浏览器、代理或 CDN 的缓存。确需按可信身份分区的查询，还应核对实际 HTTP 缓存头及部署策略；不能把默认 `public` 响应头当作个性化内容的合理策略。

## 资源创建与释放

<a id="vext-resource-001"></a>

### VEXT-RESOURCE-001 [SHOULD] 给每个长期资源确定创建者与关闭职责

插件创建的连接、订阅、定时器和文件句柄应有配对的失败清理与关闭路径。插件可使用 `onClose` 或 `app.onClose()`，关闭回调按注册逆序调用；存在关闭期限，不能承诺任意挂起任务都会执行完成。

插件 `setup(app, context)` 的第二个参数提供 `context.signal`，应把取消信号传给支持它的 I/O 并在失败时清理已创建资源。插件对象的 `onClose` 只在 setup 成功后注册，不能依靠它收拾 setup 中途失败留下的连接。框架撤销受控扩展或结束等待，不会替应用取消所有外部副作用，详见[插件生命周期](/zh/guide/plugins)。

资源被多个功能复用时，明确谁能关闭底层客户端。框架创建的限流 Redis 客户端由其运行时管理，传入的外部客户端仍由调用方负责；Session Store 的 close 行为遵循 Store 合同，`createCacheSessionStore()` 仅在显式提供 close 回调时释放底层资源。不要凭“传入了一个客户端”就假设所有集成都使用相同所有权语义。

<a id="vext-resource-002"></a>

### VEXT-RESOURCE-002 [MUST] 扩展名称和存储命名空间遵循所属合同

`app.extend()` 不能覆盖已有 app 属性或保留名称。自定义缓存客户端不能占用内置 `app.cache`；数据库、会话、限流和 HTTP 响应缓存也不能因为使用同一个 Redis 就共享未隔离的键空间。

多个实例需要共享某种状态时，显式对齐该模块的 namespace/prefix；不同应用、环境或用途需要隔离时显式区分。命名相同不代表数据结构兼容，命名不同也不会自动完成跨实例同步。

隔离方法必须按所属模块选择：Session adapter 的默认前缀不会自动包含环境；限流可由项目/profile/运行模式生成前缀；响应缓存 namespace 固定为 `vext-route-cache`，没有公开的 `config.cache.namespace`。共享 Redis 时不能虚构一个通用 namespace 配置解决所有模块隔离。跨实例响应缓存失效还需核对 distributed 的独立连接和广播范围，见[缓存配置与失效](/zh/guide/cache#lease-与-distributed)。

<a id="vext-resource-003"></a>

### VEXT-RESOURCE-003 [SHOULD] 在接收上传前确定资源预算和解析位置

内置 multipart 先读取完整表单到内存，再产生文件 buffer；它不提供流式落盘或外部存储。总请求体、文件数量和单文件大小限制分别承担不同职责，应同时配置并验证超限响应，不能只检查 handler 中的文件大小。

全局 body parser 早于全局限流、路由认证和 Guard；路由上传解析也被插入到用户路由中间件与 Guard 前。需要在接收大请求体前拒绝的场景，应在更早的入口层实现对应策略。全局已解析时，路由上传中间件只会复用结果并检查路由限制，不能撤销已经发生的读取。

MIME 来源于客户端声明，`allowedMimeTypes` 不证明文件内容可信；持久化时由业务选择名称、路径和存储系统。大文件或流式场景应明确使用自定义解析及其关闭/失败清理策略，操作与413/415复验见[文件上传](/zh/guide/uploads)。

## 验证要点

至少覆盖匿名、无效凭据、已认证但无权限、正常授权、Provider 异常；再覆盖 Session/CSRF 的实际启用和跳过、安全头错误路径、跨身份缓存、匿名填充后Cookie请求、不可存储响应的并发请求、限流额度和存储失败。上传验证包含大小/数量/MIME拒绝及解析位置；资源验证包含初始化中途失败、正常关闭、重复关闭及共享客户端归属。

这些检查面向应用实际配置。规范规则本身不会替项目自动安装认证 Provider、配置生产存储或实现对象级授权。

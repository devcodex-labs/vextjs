# 构建与运行规范

本页规定应用从本地验证到生产运行的边界。具体命令见 [CLI](/zh/guide/cli)、[构建](/zh/guide/build)、[部署](/zh/guide/deployment)，前端交付见[前端构建与发布](/zh/frontend/build-and-deploy)。

## 检查、测试与构建

<a id="vext-ops-001"></a>

### VEXT-OPS-001 [SHOULD] 分别验证类型、行为和可部署产物

类型检查、测试、构建和实际启动各自证明不同内容。TypeScript 编译通过不代表接口行为正确；构建通过也不代表数据库、外部服务、代理配置或生产权限可用。

TypeScript 应用的 `vext build` 会先刷新生成声明与路由 manifest，再编译后端；`--typecheck` 显式启用项目本地 TypeScript 检查。默认不执行这项类型检查，不能把普通 build 成功记录为 typecheck 已通过。

项目测试应覆盖输入错误、授权失败、依赖异常和资源关闭等真实行为。`vextjs/testing` 的内存请求适合快速验证，仍需按交付环境补真实 HTTP、所选 Adapter 和启用的前端浏览器验证，见[测试指南](/zh/guide/testing)。

## 生产模式与配置

<a id="vext-ops-002"></a>

### VEXT-OPS-002 [MUST] 区分运行模式、配置 profile 与构建时替换

`vext start` 使用 production 运行模式。选择配置 profile 的优先级是 `--config` 高于 `VEXT_CONFIG`，无显式选择时按命令默认；旧的非标准 `NODE_ENV` profile 仅保留带警告的兼容行为。

`vext build` 的后端生产编译会静态替换用户源码中的 `process.env.NODE_ENV`。运行时切换 profile 不会恢复已经被构建裁剪的环境分支。把需要运行时变化的配置通过真实配置入口提供，不能假定改变环境变量会重写编译产物。

配置合并、provider 和 local 文件的适用条件见[配置指南](/zh/guide/configuration)。不要把开发环境存在的 local 覆盖当成生产必然加载的配置。

<a id="vext-ops-003"></a>

### VEXT-OPS-003 [MUST] 从有效且匹配的构建输出启动

TypeScript 后端生产启动要求有效构建产物；缺失或失效时应重新构建，`vext start` 不回退到 TypeScript 源码执行。JavaScript 源模式按实际后端源码与构建身份判定，不因单独存在 `tsconfig.json` 就变成已编译模式。

构建输出选择依据为显式 `--outdir` / `VEXT_BUILD_OUTDIR`、成功构建记录、默认 `dist`。构建位置和 buildId 等元数据参与启动验证，不应只复制几个 `.js` 文件或手改元数据来冒充完整成功构建。

`--clean` 按记录的产物归属清理旧输出；不要把上传、导出或其他用户持久数据放进受构建管理的输出目录。自定义输出不得与源码、测试、依赖、Git 或 `.vext` 元数据目录重叠。

## 前端和部署产物

<a id="vext-ops-004"></a>

### VEXT-OPS-004 [MUST] 交付启用功能需要的完整运行产物

启用前端时，浏览器资源、SSR renderer、相关 manifest 和后端构建需保持相互匹配；生产启动会检查前端产物，不能以浏览器资源上传成功代替完整应用可启动。

前端公开资源与服务端 renderer 分属不同交付用途。CDN 上传、publicPath、完整性校验和缓存更新应按前端部署合同配置；不能将所有构建文件都当作公开静态资源上传。

验证应检查实际页面、资源请求、SSR/hydration、API 请求和错误页。仅检查首页 HTTP 200，不能证明动态页面和后续导航正常。外部依赖仍需在部署环境可解析；后端逐文件编译不意味着所有 npm 依赖都已经打进一个 bundle。

## 多进程与关闭

<a id="vext-ops-005"></a>

### VEXT-OPS-005 [SHOULD] 根据状态归属设计多 worker 部署

Cluster 的每个 worker 拥有自己的进程内状态。Session、限流、缓存和 Job Store 是否共享，取决于其具体存储与命名空间；开启 cluster 不会自动把内存状态转换成共享状态。

扩容前核对数据库连接池、外部请求额度、任务并发和资源容量。HTTP、scheduler 和任务 worker 使用各自运行入口，不能通过增加 HTTP worker 数量来启动或管理 Job。见 [Cluster](/zh/guide/cluster)及[任务规范](/zh/specification/jobs)。

<a id="vext-ops-006"></a>

### VEXT-OPS-006 [SHOULD] 验证就绪、健康与有界关闭

端口监听、ready 回调完成、关键依赖可用和业务健康是不同状态。应用应明确自身健康检查合同并验证部署平台的探针路径，不能假定任意项目天然存在某个健康路由。

HTTP 关闭流程包括停止接收连接/等待请求、按逆序调用关闭回调和释放框架资源，并受总关闭期限约束。超过期限不表示所有清理工作已经完成；应用应使关闭回调可结束，并核对部署平台的终止宽限时间。

测试 helper 需要调用自己的 close；程序启动的任务 runtime 也需要关闭。测试模式和真实进程的信号行为有差异，不能用一次内存测试推导生产 SIGTERM 行为已经通过。资源职责见[安全与资源规范](/zh/specification/security-and-resources#vext-resource-001)。

## 交付验证记录

每次交付应记录实际代码和配置版本、依赖安装结果、执行命令与退出码、测试环境、产物位置及实际启动结果。区分源码检查、模拟测试、真实依赖集成和生产环境验证；未运行的项目不能记为通过。

框架仓库的维护脚本属于仓库自身，应用只应调用本项目已经定义的 scripts 或公开 `vext` CLI。具体发布平台、容器与代理示例由部署指南提供，本页不要求每个应用采用同一套运维工具。

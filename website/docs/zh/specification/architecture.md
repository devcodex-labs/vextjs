# 架构与职责规范

本页规定 VextJS 应用各部分的职责和实际加载边界，适用于当前框架的开发、生产和测试入口。目录组织建议使用 `SHOULD`；加载合同使用 `MUST`。建议不等于运行时会自动检查全部业务代码。

首次建项目请先阅读[项目结构](/zh/guide/project-structure)。HTTP 注册、请求处理和路由选项的规则由 [HTTP 与路由规范](/zh/specification/http-and-routing)定义。

## 各部分负责什么

| 部分             | 职责                                                            | 调用或加载方式                                                   |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Route            | 声明 HTTP 方法、路径、校验和响应合同；在 handler 中组织请求处理 | `defineRoutes()` 同步注册，handler 在请求时执行                  |
| Service          | 可复用业务用例、数据访问组合和业务判断                          | Loader 实例化默认导出构造函数，挂载 `app.services`               |
| Model / 数据访问 | 持久化读写、索引及事务等数据一致性职责                          | 配置数据库后使用 `app.db`；Model 由数据库集成加载                |
| Schema           | 描述输入/输出的数据形状和格式                                   | 普通 import；输入由 `validate`，JSON 输出由 `responses` 合同消费 |
| 业务校验函数     | 支付资格、状态转换等业务判断                                    | 由业务代码显式调用；没有独立的 Domain Validator 自动注入系统     |
| Middleware       | 请求生命周期内的横切处理                                        | 插件注册全局中间件，或配置声明后由 Route 引用                    |
| Plugin           | 初始化扩展、资源及其生命周期                                    | `definePlugin()`；按依赖顺序执行 `setup()`                       |
| Job              | 独立于 HTTP 的任务入口及任务运行合同                            | `defineJob()`；使用任务 CLI 或任务测试入口加载                   |
| Frontend         | 页面、布局、交互和浏览器资源                                    | 前端构建与 renderer；页面 URL 由 Route 与 `res.render()` 绑定    |
| Config           | 启动选项、资源配置及环境差异                                    | 启动配置合并、provider 求值和最终配置校验                        |

## 自动加载与目录配置

<a id="vext-arch-001"></a>

### VEXT-ARCH-001 [MUST] 自动加载入口必须符合实际 Loader 合同

普通 CLI 启动从项目 `src` 或已解析的构建输出目录中加载配置和后端入口。以下源路径是应用源码的默认位置；构建后由对应产物提供运行入口。

| 源角色     | 默认源路径        | 当前公开的路径配置                                            |
| ---------- | ----------------- | ------------------------------------------------------------- |
| 配置       | `src/config`      | profile 选择配置文件；不等于重命名配置目录                    |
| 路由       | `src/routes`      | 没有 `config.routesDir`                                       |
| 服务       | `src/services`    | 没有 `config.servicesDir`                                     |
| 用户插件   | `src/plugins`     | 没有 `config.pluginsDir`                                      |
| 路由中间件 | `src/middlewares` | 没有 `config.middlewaresDir`；`config.middlewares` 是声明列表 |
| 数据模型   | `src/models`      | `config.database.models.dir`，受数据库启用条件约束            |
| Job        | `src/jobs`        | `config.jobs.dir`                                             |
| 后端语言包 | `src/locales`     | `config.locale.directory`                                     |
| 前端       | `src/frontend`    | `config.frontend.root`、`pages.dir` 等前端路径选项            |

可以把业务实现放到项目自定目录，再由受支持的入口显式导入和委托。修改工具中的目录描述或创建同名文件夹，不会改变运行时 Loader。各入口的扩展名、排除规则、导出形式和路径解析应分别按对应指南检查，不能用一套扫描规则推断全部角色。

关联指南：[项目结构](/zh/guide/project-structure)、[配置](/zh/guide/configuration)、[前端配置](/zh/frontend/configuration)、[Jobs](/zh/guide/jobs)。

<a id="vext-arch-002"></a>

### VEXT-ARCH-002 [SHOULD] 普通模块按消费者组织并显式导入

`schemas`、`validators`、`modules`、`utils`、`constants` 和应用自有 `types` 是项目组织方式，不会自动生成 `app.schemas`、`app.validators` 或模块注册。

单个用例的辅助函数与类型可放在所属业务附近；有真实共享消费者时再抽取公共模块。不要为了满足目录树创建没有职责的空层。自动扫描的 service 目录应承载服务入口，共享常量和纯类型宜放在扫描目录之外。

## 业务组合与初始化时机

<a id="vext-arch-003"></a>

### VEXT-ARCH-003 [SHOULD] 路由处理传输合同，服务组织可复用业务

Route 负责从请求获得数据、选择 HTTP 响应和声明接口合同；多入口共用的业务用例宜由 Service 或显式业务函数承担。HTTP handler 和 Job 可以调用同一业务用例，不应通过模拟 HTTP 请求复用内部业务。

框架没有禁止 handler 直接访问数据库，也不会强制创建 Repository 层。是否抽取数据访问模块取决于真实复用、事务边界与维护需要；Model、service 和缓存各自承担的职责须明确。

输入 Schema 通过不代表用户已授权、业务状态允许或数据库唯一性已满足。`VextValidator` 是 Schema 编译/验证接口，不能据其名称推导出自动执行的业务校验系统。具体使用见[参数校验](/zh/guide/validation)与[数据库](/zh/guide/database)。

<a id="vext-arch-004"></a>

### VEXT-ARCH-004 [MUST] 初始化代码必须遵守资源与服务的可用时机

普通 HTTP 启动先解析配置、创建应用和 Adapter，加载语言包及条件启用的内置数据库插件，再初始化用户插件、路由中间件、服务和路由。HTTP 开始监听后执行 ready 回调。开发入口有构建与重载步骤，不能把这个依赖顺序误读为所有入口完全相同的内部步骤。

- 用户插件 `setup()` 执行时业务服务尚未注入；此时不得依赖 `app.services` 中的业务实例已存在。
- Service 构造时其他 Service 可能尚未实例化。构造函数宜保存 `app`，在业务方法中访问依赖，避免将文件遍历顺序作为初始化合同。
- 延迟访问解决初始化时机问题，不会自动消除服务之间的循环依赖。框架检测能够静态确定的依赖环；动态访问的分析可能不完整，不应把未报告环视为依赖一定正确。
- Route 工厂只同步注册；异步工作放在 handler 或适当生命周期中，详见 [HTTP 工厂规则](/zh/specification/http-and-routing#vext-http-002)。

关联参考：[服务层](/zh/guide/services)、[插件](/zh/guide/plugins)、[运行时 Hooks](/zh/guide/hooks)。

<a id="vext-arch-005"></a>

### VEXT-ARCH-005 [SHOULD] 资源由创建者管理并在生命周期中释放

插件创建的连接、订阅和定时器宜通过 `onClose` 或 `app.onClose()` 配套释放；内置数据库由框架集成管理关闭。不要在普通共享 Schema、类型模块或每次请求的 handler 顶层隐式建立长期连接。

扩展通过 `app.extend()` 暴露，避免占用已有框架属性；例如内置 `app.cache` 是响应缓存接口，自定义缓存客户端应采用独立名称。启动失败、关闭和重载行为仍须按相关资源的具体实现验证，不能只验证正常请求。

## HTTP、任务与前端的边界

<a id="vext-arch-006"></a>

### VEXT-ARCH-006 [MUST] 任务运行与页面渲染使用各自的显式入口

创建 `src/jobs` 文件不会让普通 HTTP 启动自动执行或调度任务。任务执行、调度、队列 worker 和存储需按 [Jobs 指南](/zh/guide/jobs)选择与配置；任务 handler 的上下文不是 HTTP `req` / `res`。

前端 page 文件供 renderer 发现和构建，不会独立注册后端 URL。页面路由通过 `src/routes` 中的 handler 调用 `res.render()`；特殊 SPA fallback 由其显式配置控制。SSR、浏览器 hydration 和 API 请求分别遵循各自的生命周期，见[页面与渲染](/zh/frontend/pages-and-rendering)。

<a id="vext-arch-007"></a>

### VEXT-ARCH-007 [SHOULD] 共享模块保持浏览器与服务端依赖边界

前后端共享的数据类型可以放在共同模块，浏览器需要使用的运行时 Schema 或常量也可显式共享，但不得因此带入数据库实例、服务器配置或 Node 专用依赖。目录名含 `shared` 不会自动消除这些依赖。

前端 API client 消费接口合同，服务端业务模块继续由后端入口调用。构建产物、生成声明和客户端合同应由工具生成，不能作为业务逻辑的另一份手工真相源。具体生成和诊断入口见[API Client 与契约](/zh/frontend/api-client-and-contracts)及[诊断与泄漏扫描](/zh/frontend/diagnostics-and-leak-scan)。

## 检查一个项目时

依次确认入口能被 Loader 发现、导出符合对应合同、初始化阶段没有读取尚未就绪的依赖、请求与任务调用正确的业务入口、资源可关闭、前端构建没有越过服务端边界。发现问题时先检查实际配置与错误信息，再核对对应指南；不能仅凭目录树判断应用运行正确。

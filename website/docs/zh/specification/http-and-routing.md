# HTTP 与路由规范

本页说明路由模块如何被加载、哪些声明能被运行时和静态工具共同识别，以及请求处理各层的职责。具体操作见 [路由指南](/zh/guide/routing)，参数和类型见 [路由定义 API](/zh/api/route-definition)。

## 适用范围

这些规则适用于路由目录（默认 `src/routes/`）中由 router loader 加载的业务路由，以及 Doctor、路由 manifest 等静态消费者。`MUST` / `MUST NOT` 表示必须满足的路由合同；`SHOULD` 表示推荐实践。静态工具能够解析的声明范围与 JavaScript 能够执行的表达式范围不同。

路由层负责声明 HTTP 方法、路径、输入/输出契约和请求处理入口；中间件处理请求横切逻辑，service 承担业务操作。校验、认证、授权和业务状态检查分别执行，不能互相替代。

## 路由模块

<a id="vext-http-001"></a>

### VEXT-HTTP-001 [MUST] 路由模块必须提供受支持的默认导出

被加载的路由模块必须默认导出 `defineRoutes(...)` 返回的 `RouteDefinition`。静态工具还要求该默认导出能够沿源码绑定解析到从 `vextjs` 导入的 `defineRoutes` 调用。

支持直接默认导出、先赋值再默认导出，以及能够完整解析的默认重导出。重导出时 URL 前缀仍由路由目录中的入口文件决定，声明内容在实际定义模块的上下文中解析。缺失默认导出、目标无法解析或通过不透明 helper 创建定义都会导致诊断；不能把所有重导出一概判为不支持。

<a id="vext-http-002"></a>

### VEXT-HTTP-002 [MUST] 路由工厂必须在加载时同步收集路由

factory 必须是同步、非 generator 的箭头函数或 function expression，具有一个普通标识符参数和 `{ ... }` 块体。可以内联，也可以引用静态工具能够解析到这类函数的绑定，例如 `const register = (app) => { ... }; defineRoutes(register)`。

HTTP 注册必须是 factory 块体内的直接顶层语句，使用 `app.method(path, handler)` 或 `app.method(path, options, handler)`。不支持在条件、循环、嵌套 helper 中注册，也不支持方括号访问、解构或提取 HTTP 方法。factory 不能是 `async`，不能返回 Promise、thenable 或其他非 `undefined` 值；handler 可以是 `async`。

调用 `defineRoutes()` 时只创建定义并检查工厂形态；loader 取得应用实例后才执行 factory、收集路由并准备注册。收集结束后注册入口关闭；收集失败会清空本次路由记录，不保留部分结果。

<a id="vext-http-003"></a>

### VEXT-HTTP-003 [SHOULD] 处理器应使用已校验并归一化的数据

路由声明 `validate` 后，handler 应从对应的 `req.valid("param" | "query" | "header" | "cookie" | "body")` 读取校验结果，以使用类型转换等归一化后的数据。`req.query` 等原始入口仍然可访问，框架不会禁止读取它们，也不会因为泛型标注而增加运行时校验。

自动校验位于路由级中间件之后、handler 之前。中间件在 `next()` 前不能假定路由校验已经完成；未声明校验的位置也不能当作已校验数据。路径参数校验失败返回 HTTP 400；query、header、cookie 与 body 校验失败返回 HTTP 422。

<a id="vext-http-004"></a>

### VEXT-HTTP-004 [MUST] 路由级中间件必须使用已声明名称

路由选项中的 `middlewares` 使用配置白名单中已声明的名称，形式为字符串或 `{ name, options }`，不能直接放入函数。loader 在注册路由前检查引用；未声明名称会使加载失败。

自定义中间件按数组顺序执行，之后才进入路由 `auth` guard、缓存等后续步骤；启用的路由 timeout/CORS/Session/multipart 包装可能位于它们之前。`auth` 声明不会自动实现凭据认证，自定义认证中间件需要在 guard 前建立 `req.auth`。完整使用流程见 [中间件指南](/zh/guide/middleware)。

<a id="vext-http-005"></a>

### VEXT-HTTP-005 [MUST NOT] 业务代码不得绕过路由定义生命周期直接注册 HTTP 方法

业务路由必须在 `defineRoutes()` factory 内声明，使 loader 能收集、校验并按文件前缀注册到 adapter。不得在异步回调或请求 handler 中继续使用 factory 的 HTTP 注册入口；收集结束后该入口已关闭。不要手工调用 `RouteDefinition.register()` 或操作 adapter 来绕过这个流程。

factory 的 `app` 是以真实应用为能力来源的 facade。请求处理中可以继续访问 `app.services`、`app.config` 等能力；这不代表仍可注册路由，也不表示框架把应用属性复制成静态快照。

<a id="vext-http-006"></a>

### VEXT-HTTP-006 [SHOULD] 输入校验与授权、业务约束应分别实现

`validate` 检查声明位置的数据形状和值，并保存校验结果。业务层仍应检查资源是否存在、当前用户是否有操作权限、状态是否允许变更；数据库唯一性和并发约束应由相应的数据操作保证。不能因为 schema 验证通过就判定请求已获授权，或认为数据库写入一定成功。

<a id="vext-http-007"></a>

### VEXT-HTTP-007 [MUST] 路由的规范化方法与完整路径不能重复

完整路径由入口文件前缀与声明子路径拼接，`index` 文件省略文件名，`[id]` 段转换为 `:id`。同一 HTTP 方法下，路径大小写或尾斜杠不同仍可能构成重复，loader 会在 adapter 注册前拒绝。

静态索引还会拒绝不同路由入口映射到相同文件前缀，例如 `users.ts` 与 `users/index.ts` 并存，即使两者的方法或子路径不同。应合并到一个入口，或调整文件路径，使运行时注册与构建索引都通过。文件发现支持 `.ts`、`.js`、`.mjs`；`.cjs` 路由源会被明确拒绝，不能作为受支持示例。

## 响应、文档与覆盖配置

<a id="vext-http-008"></a>

### VEXT-HTTP-008 [SHOULD] JSON 响应应把运行时 Schema 与文档说明分别声明

需要响应序列化合同时，应在顶层 `responses` 声明业务数据 Schema，把描述、示例和响应头等说明放在 `docs.responses`。同一规范化状态 selector 不得在两处重复声明 Schema，路由注册会拒绝冲突。`docs.responses.schema` 是文档兼容入口，不能代替顶层运行时合同。

顶层 Schema 在注册时编译，在 JSON 输出中按最终状态以精确状态、状态族、`default` 的顺序选择；它处理传给 `res.json()` 的业务数据，统一响应包裹由框架负责。未声明字段会被移除，缺少 required 值会在提交字节前失败。HEAD、精确 204、raw JSON、text、redirect、file/download、stream 和 render/SSR 不走这条 JSON 序列化路径；不能将此合同推及所有响应方式。细节见 [运行时响应 Schema](/zh/api/route-definition#运行时响应-schema)。

<a id="vext-http-009"></a>

### VEXT-HTTP-009 [MUST NOT] OpenAPI 元数据不得作为运行时访问保护

`docs.security` 只描述 OpenAPI 安全要求，不执行认证或授权；`docs.hidden` 只隐藏文档条目，不阻止请求访问。需要保护路由时，应先用认证中间件建立 `req.auth`，再通过路由 `auth` guard 或明确的业务权限逻辑检查访问。

OpenAPI 安全描述按显式 `docs.security`、路由 `auth`、旧中间件映射顺序解析；这条文档优先级不改变运行时 guard。`operationId` 无论显式声明还是自动生成，都必须在生成的 OpenAPI 中唯一，冲突会失败。具体字段与默认值见 [OpenAPI 文档配置](/zh/api/route-definition#docs)。

<a id="vext-http-010"></a>

### VEXT-HTTP-010 [MUST] 路由覆盖必须遵守各配置项的启用条件与单位

`override` 按配置项覆盖，不能视为通用的功能启用开关。内置限流先由全局 `rateLimit.enabled: true` 注册；`override.rateLimit` 才能调整该路由参数，`false` 跳过限流。其 `window` 单位为秒；用户自定义的工厂中间件拥有自己的 options 合同，不能与内置限流混用。

路由顶层 `timeout` 优先于兼容字段 `override.timeout`：正整数以毫秒启用请求期限，`false` 显式关闭路由超时。`override.maxBodySize` 用于请求体大小，`override.cors` 用于路由 CORS；Session、CSRF、Security Headers 与 multipart 各有独立选项和启用条件，不从 `override` 推断。逐项合同见 [override](/zh/api/route-definition#override) 及同页的选项表。

## 主题归属与使用边界

本页承载路由声明、加载、输入/响应合同、middleware/auth、OpenAPI 与覆盖配置的规则；handler 负责连接 HTTP 输入输出，业务操作与不变量由 service 等业务层实现。文件映射、从空路由得到成功响应以及业务组合方式见路由指南；所有参数和默认值由路由定义 API 承担；错误定位由错误处理页承担。规范等级表达合同或建议，不表示每条规则都已有自动检测器。

## 关联阅读

- [路由](/zh/guide/routing)：文件路由、处理器与完整示例。
- [中间件](/zh/guide/middleware)：洋葱模型、工厂与配置。
- [错误处理](/zh/guide/error-handling)：HTTP 错误与校验错误排查。
- [路由定义](/zh/api/route-definition)：`defineRoutes`、Route Options 与类型参考。

# 校验与数据契约规范

本页定义输入校验、类型、JSON 响应合同与业务约束之间的边界。编写路由的操作步骤见[参数校验](/zh/guide/validation)，全部路由选项见[路由定义参考](/zh/api/route-definition)。

## 校验不能替代哪些判断

<a id="vext-contract-001"></a>

### VEXT-CONTRACT-001 [MUST NOT] 不得把 Schema 校验当作授权、业务不变量或数据库约束

Schema 和 `VextValidator` 判断数据是否符合声明的结构与格式。校验通过不表示调用者有权限，也不表示库存充足、状态转换合法、记录不存在或数据库唯一约束已满足。

| 问题                               | 应由谁决定                                     |
| ---------------------------------- | ---------------------------------------------- |
| 输入字段、类型、长度和格式是否合法 | 输入 Schema 与当前校验引擎                     |
| 当前用户是谁、能否访问接口或对象   | Auth Provider / Guard 与应用授权逻辑           |
| 订单能否支付、当前状态能否转换     | Service 或显式业务规则函数                     |
| 并发写入能否保持唯一性、一致性     | 数据库约束、原子操作或相应事务设计             |
| 输出 JSON 对外暴露什么数据         | Handler 返回值与 `RouteOptions.responses` 合同 |

例如“先查询邮箱不存在，再插入用户”仍可能在并发请求下发生竞争；输入校验和一次查询不能替代持久化层约束。授权和业务校验可能在多个入口被调用，不能只依赖 HTTP 路由的 `validate`。

`src/validators` 只是可选的普通模块目录，没有 `app.validators` 自动注入。`app.getValidator()` 返回 Schema 校验引擎，不会自动发现或执行该目录。见[架构职责](/zh/specification/architecture)。

## 输入合同的生效条件

<a id="vext-contract-002"></a>

### VEXT-CONTRACT-002 [MUST] 在支持的位置声明运行时校验

路由使用 `validate.param`、`validate.query`、`validate.header`、`validate.cookie` 和 `validate.body` 声明输入；`param` 是单数。只有实际声明的输入位置才编译和执行校验。

路由注册时编译每个位置的 Schema，请求进入校验中间件时依次执行 `param → query → header → cookie → body`，遇到第一个失败的位置立即停止，不进入后续 handler。路径参数错误返回 HTTP 400，其余上述位置返回 HTTP 422；错误响应的格式与内容协商见[错误处理](/zh/guide/error-handling)。语法无效的 Schema 可能在注册时失败，不是一次普通的请求参数错误。

响应缓存命中或前置中间件提前结束请求时，不会再执行后续校验与 handler。响应缓存位于路由中间件和 Auth Guard 之后、校验之前；缓存键与访问保护需按[响应缓存指南](/zh/guide/cache)单独设计。

TypeScript 接口、类型断言和 OpenAPI 说明不会自行增加运行时校验。Body 解析也不是业务校验；请求体大小、Content-Type 等解析失败可能先于 Schema 校验发生。

<a id="vext-contract-003"></a>

### VEXT-CONTRACT-003 [SHOULD] 业务处理使用校验后的数据并核实转换语义

已声明输入位置通过校验后，从 `req.valid(location)` 读取结果。它返回存储的校验后数据，可能包含类型转换；不能假定与原始 `req.query`、`req.body` 完全相同。对于 `header`，框架还会仅保留 Schema 声明的字段，并将键转为小写；声明 header 字段时应使用小写键。

未声明或尚未执行校验的位置返回 `undefined`；未经验证的数据不能仅靠一次类型断言标为可信。路由中间件先于 Schema 校验执行，因此需要参数的前置中间件应自行处理原始输入，不能假定 `req.valid()` 已准备好。

字段 required/optional、额外字段、转换和默认值等语义须由使用的 Schema 及引擎决定，不能把某个自定义引擎的行为套到所有接口。保留合法的 `false`、`0` 和空字符串，避免用 `result.data || 原始输入` 回退而丢失校验结果。

## 静态类型与可复用 Schema

<a id="vext-contract-004"></a>

### VEXT-CONTRACT-004 [SHOULD] 类型和文档从同一份运行时合同表达

可复用 Schema 通过普通 import 引入路由或显式校验代码。当前路由类型可从支持的 DSL 字符串、嵌套对象和字段级 JSON Schema 推导 `req.valid()` 的数据形状；动态 builder 无法静态恢复时会推导为 `unknown`。类型层能推导单元素数组简写，不等于运行编译和静态投影支持它：当前路由应使用显式 `{ type: "array", items: ... }` 或受支持的数组 DSL，并同时通过类型、投影与行为验证。

显式 `req.valid<T>()` 会覆盖自动推导，但不会修改运行时 Schema；维护者须保证两者一致。类型声明只负责编译期约束，不会运行数据库查询或执行授权。

共享到浏览器的 Schema 和类型必须遵守[前后端依赖边界](/zh/specification/architecture#vext-arch-007)。不要在共享 Schema 模块顶层初始化数据库、读取服务端专用配置或产生其他启动副作用。

## 替换校验引擎

<a id="vext-contract-005"></a>

### VEXT-CONTRACT-005 [MUST] 自定义校验引擎实现同步编译与结果合同

`app.setValidator()` 接收符合 `VextValidator` 的对象：`compile(schema)` 返回同步校验函数，函数返回 `valid`、可选的 `errors: { field, message }[]` 和 `data`。成功时提供希望 handler 读取的 `data`；失败时提供可解释的字段错误。

路由在注册时获取当前引擎并保存编译后的函数。需要替换引擎时，应在路由加载前的插件初始化阶段设置；注册后替换不会让既有路由自动重新编译。异步授权、数据库查询或外部请求应放到对应业务生命周期，不得伪装成这个同步校验返回值。

自定义引擎还须明确接受何种 Schema，并检查 OpenAPI 和客户端生成是否仍能理解这些声明。替换输入引擎不会自动替换响应序列化器，也不会把任意第三方 Schema 转换成 OpenAPI。具体接入示例见[替换校验引擎](/zh/guide/validation#替换校验引擎)。

当前公开 `RouteOptions.validate` 的各位置接受字段映射，字段类型为 `VextSchemaField`；`VextValidator.compile` 的参数类型为 `Record<string, unknown>`。`setValidator()` 不会扩展这些 TypeScript 类型，也不会改变构建期静态提取器。不能仅凭引擎在 JavaScript 中能识别 Zod 等对象，就把直接传入第三方 Schema 的路由写成已受支持的 TypeScript 用法。使用同一份受支持的声明格式翻译到替换引擎时，也须验证 required、额外字段、转换与错误语义。

## 响应合同与接口文档

<a id="vext-contract-006"></a>

### VEXT-CONTRACT-006 [MUST] JSON 运行时响应 Schema 使用 responses 声明

需要运行时 JSON 响应合同的接口使用 `RouteOptions.responses`；选择器支持精确状态码、状态码族和 `default`。同一选择器不能同时在 `responses` 和 `docs.responses` 重复声明 Schema。

`docs.responses` 的历史 Schema 兼容只用于文档，不能据此声称运行时字段投影已经生效。文本、文件、流、重定向、页面渲染等响应以及 HEAD、204 不应被当作普通 JSON 序列化路径。具体选择顺序、旁路和错误语义见[路由定义参考](/zh/api/route-definition)及 [HTTP 响应规则](/zh/specification/http-and-routing#vext-http-008)。

OpenAPI 的接口说明与 `docs.security` 也不执行访问控制；服务端仍需真实认证与授权。

## 验证合同是否成立

至少覆盖有效输入、缺失/非法输入、校验结果的实际类型、未声明位置、错误状态码，以及授权与业务拒绝场景。接口还应检查实际输出与公开 Schema 一致。自定义引擎和共享 Schema 的变更需要同时复查运行时请求、TypeScript 使用方和 OpenAPI/客户端结果。

依赖版本分别记录包的兼容范围、锁文件实际解析版本和应用实际安装版本。不能把框架的依赖范围写成所有消费者已经安装同一版本；具体项目以其锁文件与安装结果验证。

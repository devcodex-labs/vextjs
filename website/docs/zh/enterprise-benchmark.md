# Framework-native 产品栈 API 基准测试

本页比较同一个 API 契约的三条有文档依据的生产实现路径：VextJS + Native
Adapter、原生 Fastify，以及由 Fastify 承载的 NestJS。它是
[Vext Adapter Matrix](/zh/benchmark) 的独立补充，不是所有框架的总榜单。

## 当前发布状态

此前的企业级工作负载套件已经删除。它使用了人为延迟注入，不能建立足够可比
的产品栈契约，因此其数值不再作为参考保留。

替代套件为 `framework-native-product-stack-enterprise-api`。其
`linux-x64-v1` 协议当前仍是 `pilot-required`，因此下方没有发布正式跨框架
数值。本地 smoke 或 pilot 只证明实现与契约正确，不能引用；只有完成干净 Linux
x64 资格 pilot、完成评审并接受协议后，才允许产生正式结果。

## 为什么不是裸性能测试

裸 HTTP 或路由测试适合回答“最短请求路径有多快”。它会刻意移除关联 ID、认证、
授权、校验、结构化日志、服务组合、错误投影、安全响应头和外部依赖处理。

但这不是本页要回答的问题。在生产环境中，这些能力就是请求路径的一部分，不能
为了某个目标更快而悄悄关闭。本套件固定它们的可观察契约，同时允许各框架采用
文档化或推荐的生产集成方式。因此这是贴近生产形态的对比，不是“某框架永远更快”
的证明。

当问题是“同一个 Vext 应用应选择哪个 Adapter”时，请使用
[Adapter Matrix](/zh/benchmark)；它只替换 Adapter，是 Vext 内部最公平的比较。
裸路径诊断只用于单个栈的维护分析，绝不与本页产品栈结果混合或排名。

## 公平性契约

每个目标均实现 `POST /api/users/:userId/orders` 和相同的五个工作负载。runner
先证明可观察契约，再开始吞吐测量。

| 共同要求   | 固定的契约                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 请求关联   | `x-request-id`、tenant 和 trace 值必须进入成功/错误包体及受控出站请求。                                    |
| 认证与授权 | 有效签名 JWT 创建订单；缺失 JWT 返回 401；有效但只读的 JWT 返回 403。                                      |
| 校验       | 已认证但 `quantity` 非法时返回 422，且写入仓储之前失败。                                                   |
| 成功语义   | 201 响应包含相同的业务订单、定价校验和、金额和安全响应头。                                                 |
| 副作用     | 成功恰好一次内存仓储写入；所有失败均不能写入。                                                             |
| 结构化日志 | 每个目标通过自身正常的结构化日志路径写入进程内 discard sink，终端或磁盘 I/O 不会主导比较。                 |
| 外部 I/O   | 外部成功工作负载会向受控本地 quote sidecar 发起一次真实 TCP/HTTP 请求；它不被表述为数据库或 Redis 替代品。 |
| 负向探针   | 错误 method、错误 content type 和畸形 JWT 必须被拒绝且不能写入；它们是契约探针，不进入性能工作负载。       |

三种实现刻意采用各自框架原生的生产路径：

| 能力       | VextJS + Native Adapter                          | Fastify                    | NestJS + Fastify                                                           |
| ---------- | ------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------- |
| 请求上下文 | Vext request ID 与内置 AsyncLocalStorage context | `@fastify/request-context` | Nest AsyncLocalStorage middleware recipe                                   |
| JWT 与权限 | Vext `auth()` + `jose` 验签 + 路由权限           | `@fastify/jwt` route hook  | `@nestjs/jwt` + `CanActivate` guard                                        |
| 校验       | Vext 编译后的 route validation                   | Fastify route JSON Schema  | `ValidationPipe`、DTO decorators、`class-validator` 和 `class-transformer` |
| 服务组合   | 启动时加载的 Vext services                       | 启动时组合的 closures      | Provider 构造函数注入                                                      |
| 安全响应头 | Vext `securityHeaders: basic`                    | `@fastify/helmet`          | Fastify host 上的 `@fastify/helmet`                                        |

这里的“官方实现”是指有文档依据的推荐生产路径，不是机械地限定为第一方 npm
包。只要框架或维护者文档推荐，受维护的生态集成同样有效。正式 artifact 会记录
实际执行的实现清单和精确版本。

## 工作负载

| ID                      | 预期状态 | 实际执行内容                                                                                                      |
| ----------------------- | -------: | ----------------------------------------------------------------------------------------------------------------- |
| `success-cpu`           |      201 | JWT 验证、授权、请求上下文、校验、controller/service 组合、确定性小型定价计算、仓储写入、安全响应头和结构化日志。 |
| `success-external-http` |      201 | 同一链路，额外包含一次受控的出站 HTTP quote 请求。                                                                |
| `validation-422`        |      422 | 有效 JWT 与权限后拒绝非法 body；不产生业务写入。                                                                  |
| `authentication-401`    |      401 | 缺失 JWT，在授权、校验和业务处理之前拒绝。                                                                        |
| `authorization-403`     |      403 | 有效 JWT 但无订单写权限，在校验和业务处理之前拒绝。                                                               |

## 正确性先于吞吐

Conformance 阶段打开仅测试用的观测，验证每个目标的状态、响应头、关联字段、
预期副作用、真实 quote-sidecar 调用和框架原生能力执行。然后对版本化的规范化
语义投影执行 SHA-256 比较。

语义哈希刻意**不**比较原始响应字节。JSON 空白、键顺序、框架特有序列化细节和
生成的仓储 ID 都不是公平性要求；会被规范化并参与哈希的是状态、媒体类型、必要
安全响应头、关联字段、业务订单语义、错误类别和被拒绝字段集合。

上述证明通过后，runner 才会重启新的 targets 和 quote sidecar，并关闭每请求测试
计数器。吞吐测量不会包含测试计数更新。runner 按轮次轮转目标顺序，拒绝 HTTP
错误、超时或意外状态分布，记录 P50/P97.5/P99，并应用协议 CV 门槛。

## 正式协议与复现

候选 `linux-x64-v1` 协议固定为 50 connections、pipelining 1、10 秒预热、30 秒
测量、7 轮轮转和 RPS CV 最大 15%。正式运行还要求：

- 资格 pilot 后协议状态被接受；
- Linux x64 上的干净源码 provenance；
- 显式声明且互不重叠的 load-generator / target CPU 集；
- `package.json`、lockfile、实际安装树和 npm `latest` 的精确版本一致；
- 五个工作负载与三个负向探针均通过 conformance。

```bash
# 构建一次；在任意支持主机执行快速实现/契约 smoke。
npm run build
npm run test:bench:enterprise -- --smoke

# 本地 pilot 只产生验证证据，绝不成为站点数据。
npm run test:bench:enterprise -- --pilot

# 协议接受后，在 Linux x64 运行固定正式形状。
taskset -c 4-7 node test/benchmark/framework-native/run-framework-native-suite.mjs \
  --formal --load-cpus 4-7 --target-cpus 0-3

# 将已接受的正式 artifact 投影到本页，或检查本页没有漂移。
npm run generate:enterprise-benchmark-docs
npm run verify:enterprise-benchmark-docs
```

文档生成器不会投影非可引用 artifact。正式结果产生后，本页会直接包含精确框架版本、
源码身份、环境、语义哈希、汇总与所有轮次样本；不会再跳转 GitHub 或独立结果页。

<!-- framework-native-results:start -->

## 已接受的正式结果

尚未发布已接受的正式 artifact。

<!-- framework-native-results:end -->

## 解读边界

- 本结果不对全部 Node.js 框架进行排名，也不能预测每一种生产应用。
- 受控 quote sidecar 验证真实的出站 HTTP 行为，并不模拟数据库、Redis、网络拓扑或供应商服务延迟。
- 只有相同正式协议和记录环境下的 artifact 才可互相比较。
- Raw/native-core 测量仍可用于内部维护诊断，但它们不能回答本页的产品栈问题，也绝不进入本页表格。

# Framework-native 产品栈 API 基准测试

本页比较同一个 API 契约的三条有文档依据的生产实现路径：VextJS + Native
Adapter、原生 Fastify，以及由 Fastify 承载的 NestJS。它是
[Vext Adapter Matrix](/zh/benchmark) 的独立补充，不是所有框架的总榜单。

## 当前发布状态

此前的企业级工作负载套件已经删除。它使用了人为延迟注入，不能建立足够可比
的产品栈契约，因此其数值不再作为参考保留。

替代套件为 `framework-native-enterprise-api-windows-v2`。它使用面向当前
Windows 主机的已接受 `windows-x64-v2` 协议，但在干净提交候选通过主机资格、全部
162 个 timed samples 和独立 artifact validator 之前，页面不会发布正式跨框架数值。
本地 smoke 或 pilot 只证明实现行为，刻意不可引用。

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

每个目标均实现 `POST /api/users/:userId/orders` 和相同的六个 timed workload。runner
先证明可观察契约，再开始吞吐测量。

| 共同要求   | 固定的契约                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 请求关联   | `x-request-id`、tenant 和 trace 值必须进入成功/错误包体及受控出站请求。                                                                          |
| 认证与授权 | 有效签名 JWT 创建订单；缺失 JWT 返回 401；有效但只读的 JWT 返回 403。                                                                            |
| 校验       | 已认证但 `quantity` 非法时返回 422，且写入仓储之前失败。                                                                                         |
| 成功语义   | 201 响应包含相同的业务订单、定价校验和、金额和安全响应头。                                                                                       |
| 副作用     | 成功恰好一次内存仓储写入；所有失败均不能写入。                                                                                                   |
| 结构化日志 | 每个目标通过自身正常路径写入完成 access event 到被排空的本地 stdout pipe；runner 在测量期不解析、不计数日志。                                    |
| 外部 I/O   | 两个外部成功工作负载均会向受控本地 quote sidecar 发起一次真实 TCP/HTTP 请求，名义延迟分别为 20 ms / 40 ms；它不被表述为数据库或 Redis 替代品。   |
| 负向探针   | 错误 method、错误 content type、内部错误、畸形 JWT、unknown field 和 decimal coercion 必须被拒绝且不能写入；它们是契约探针，不进入性能工作负载。 |

三种实现刻意采用各自框架原生的生产路径：

| 能力              | VextJS + Native Adapter                                         | Fastify                                       | NestJS + Fastify                                                           |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| 请求上下文        | Vext request ID 与内置 AsyncLocalStorage context                | `@fastify/request-context`                    | Nest AsyncLocalStorage middleware recipe                                   |
| JWT 与权限        | Vext `auth()` + `jose` 验签 + 路由权限                          | `@fastify/jwt` route hook                     | `@nestjs/jwt` + `CanActivate` guard                                        |
| 校验              | Vext route validation + 公开 strict `app.setValidator()` plugin | 启用严格 Ajv 选项的 Fastify route JSON Schema | `ValidationPipe`、DTO decorators、`class-validator` 和 `class-transformer` |
| 服务组合          | 启动时加载的 Vext services                                      | 启动时组合的 closures                         | Provider 构造函数注入                                                      |
| 错误/access event | 公开 Vext error lifecycle hook + 正常 access log                | Error handler + `onResponse`                  | Nest exception filter + Fastify `onResponse`                               |
| 安全响应头        | Vext `securityHeaders: basic`                                   | `@fastify/helmet`                             | Fastify host 上的 `@fastify/helmet`                                        |

这里的“官方实现”是指有文档依据的推荐生产路径，不是机械地限定为第一方 npm
包。只要框架或维护者文档推荐，受维护的生态集成同样有效。正式 artifact 会记录
实际执行的实现清单和精确版本。

## 工作负载

| ID      | 预期状态 | 实际执行内容                                                                                             |
| ------- | -------: | -------------------------------------------------------------------------------------------------------- |
| `EW-01` |      201 | 认证成功：JWT、授权、context、严格校验、service/repository、确定性 CPU 定价、安全头与完成 access event。 |
| `EW-02` |      201 | 同一链路，附加一次名义 20 ms 的真实本地 HTTP quote；实际 P50/P95/P99 受门禁约束。                        |
| `EW-03` |      201 | 同一链路，附加一次名义 40 ms 的真实本地 HTTP quote；实际 P50/P95/P99 受门禁约束。                        |
| `EW-04` |      422 | 已认证的严格校验失败，发生在业务 read/write 之前。                                                       |
| `EW-05` |      401 | 缺失 JWT，在授权、校验或业务处理之前拒绝。                                                               |
| `EW-06` |      403 | 有效只读 JWT，在校验或业务处理之前拒绝。                                                                 |

## 正确性先于吞吐

Conformance 阶段打开仅测试用的观测，验证每个目标的状态、响应头、关联字段、
预期副作用、真实 quote-sidecar 调用和框架原生能力执行。然后对版本化的规范化
语义投影执行 SHA-256 比较。

语义哈希刻意**不**比较原始响应字节。JSON 空白、键顺序、框架特有序列化细节、
生成的仓储 ID，以及每请求变化的 ID/trace 都不是公平性要求；会被规范化并参与
哈希的是状态、媒体类型、必要安全响应头、业务订单语义、错误类别和被拒绝字段集合。
request、tenant、trace 的关联会在哈希前逐项与请求头核对；hash 只记录该稳定不变量，
而不记录会变化的标识符值。

上述证明通过后，runner 才会启动新的 measurement-only target、sidecar 与 load
process。timed process 不包含 observer、control route、应用内 sampler 或每请求测试
计数器。load process 使用 Autocannon 文档化的 `setupRequest` factory，在隔离的 load
CPU role 上生成确定性的唯一请求 ID。runner 记录 P50/P95/P99、状态分布、CPU time、
Windows Working Set、sidecar 延迟分布和 child-process affinity 回读。

应用初始化之前，每个新的 sidecar、target 与 load process 都先停在 IPC 的 pre-start
handshake。runner 先证明 IPC PID 就是自有 child、设置并回读其角色 CPU affinity，再按
固定 sidecar → target → load 顺序释放启动。该过程发生在语义探针、warmup 和 timed window
之前。任何身份、affinity 或启动失配都会使整份 raw run 失败；runner 不会重试或拼接单个
sample。

每个 fresh target 在 warmup 前还会收到一次未计时的语义探针。该探针直接命中实际
measurement fixture，其 canonical hash 必须与该 workload 已记录的跨框架 conformance
hash 相同，避免 measurement fixture 只保持相同 HTTP status 却发生无声语义漂移。

## 正式协议与复现

已接受的 `windows-x64-v2` 协议固定为 50 connections、pipelining 1、10 秒预热、
30 秒测量和 9 个配对平衡 block（共 162 个 timed sample）。每个 target/workload 的
RPS CV 必须 ≤15%。正式运行还要求：

- 干净已提交的 Windows x64 候选及精确安装依赖版本；
- 连续 60 秒主机资格检查、交流电/无电池、非 Power Saver，以及 `load`、`target`、
  `dependency`、`control` 四个不重叠物理核心角色各自背景 CPU ≤10%；
- 对每个 owned child 的 pre-start PID/affinity handshake，以及 warmup 前与 measurement 后的 affinity 回读；
- 每个 target measurement window 的 load CPU 必须 ≤85%；另以相同 factory 的 no-op
  ceiling 证明每个工作负载至少有最高 target RPS 的 2 倍余量。ceiling 自身的 load CPU
  会被记录且可饱和，因为它测量的是 generator capacity，而不是 target measurement 的瓶颈；
- 真实 20 ms / 40 ms sidecar 校准门禁，两个实际 P50 的差值至少 8 ms；以及
- 六个 timed workload 和六个负向探针全部 semantic conformance，通过后由独立 validator
  重算全部 gate 与固定 seed 的 10,000 次配对 block bootstrap。

```bash
# 构建一次；在 Windows 执行 focused、不可引用的实现 smoke。
npm run build
npm run test:bench:enterprise -- --smoke --sample-limit 3

# 完整 pilot 只产生验证证据，绝不成为站点数据。
npm run test:bench:enterprise -- --pilot

# 仅在干净已提交的 Windows 候选上：先产生 raw evidence，
# 再独立验收并投影到本页。
npm run test:bench:enterprise -- --formal --output test/benchmark/.artifacts/framework-native-v2-raw.json
node test/benchmark/framework-native/v2/validate-artifact.mjs \
  --input test/benchmark/.artifacts/framework-native-v2-raw.json \
  --output test/benchmark/.artifacts/framework-native-v2-accepted.json

# 将已接受的正式 artifact 投影到本页，或检查本页没有漂移。
npm run generate:enterprise-benchmark-docs
npm run verify:enterprise-benchmark-docs
```

文档生成器不会投影非可引用 artifact。正式结果产生后，本页会直接包含精确框架版本、
源码身份、Windows qualification、语义哈希、配对不确定性、headroom 与每个 sample；
不会再跳转 GitHub 或独立结果页。

<!-- framework-native-results:start -->

## 已接受的 Windows 正式结果

尚未发布通过独立验收的 Windows 正式 artifact。smoke 和 pilot 观察值刻意不作为基准结果展示。

<!-- framework-native-results:end -->

## 解读边界

- 本结果不对全部 Node.js 框架进行排名，也不能预测每一种生产应用。
- 受控 quote sidecar 验证真实的出站 HTTP 行为；其名义 20 ms / 40 ms 延迟并不模拟数据库、Redis、网络拓扑或供应商服务延迟。
- Windows process affinity 能降低干扰，但不等于物理核心独占；结果严格限于记录的合格主机。
- 只有相同正式协议和记录环境下的 artifact 才可互相比较。
- Raw/native-core 测量仍可用于内部维护诊断，但它们不能回答本页的产品栈问题，也绝不进入本页表格。

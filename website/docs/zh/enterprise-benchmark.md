# 企业级工作负载基准测试

本页是 [Vext Adapter Matrix](/zh/benchmark) 的跨技术栈、生产形态补充。它在同一 API 语义下对比 Vext Native、原生 Fastify，以及运行在同一 Fastify 版本之上的 Nest；它刻意**不是**一个“框架总榜”。

## 为什么不做裸跑排名

裸 HTTP 或路由测试对维护者很有价值：它回答的是最短路径能跑多快。为了得到该答案，它会移除请求关联、鉴权、校验、结构化日志、服务组合、错误处理和仓储边界；而这些恰好是生产中选择框架时真正要承担的能力。

本测试固定对外 API 契约，让每个技术栈使用自己的正常机制。Vext 使用正式 bootstrap、请求上下文、鉴权中间件和路由权限守卫、注册期编译的路由校验、服务加载器、access log、安全响应头及 Native adapter。Fastify 使用 hooks、JSON Schema 校验、启动期服务组合和 Pino 日志。Nest 通过 `new FastifyAdapter(raw)` 接收根 Fastify 实例，再使用 Nest provider、Guard、Pipe、Interceptor 与异常 Filter；runner 会记录两个 host 版本并拒绝版本不一致的结果。

因此，这个测试比裸吞吐更能支持生产决策；但它绝不表示某个框架在所有情形都更快。若问题是“该选哪个 Vext adapter”，请看 [Adapter Matrix](/zh/benchmark)；若问题是“这三套技术栈在同一生产形态 API 契约下表现如何”，请看本页。

## 范围与公平性契约

| 各目标保持一致                                                                         | 允许自然不同                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `POST /api/users/:userId/orders`、JSON body、Bearer 鉴权、request/tenant/trace headers | 内部 middleware 数量和依赖图                                   |
| 201 成功响应；401 缺少鉴权；403 无权限；422 body 非法；method/content type 被拒绝      | 校验与错误序列化实现                                           |
| 成功恰好写入一次仓储；失败零写入；reset 与 telemetry 端点                              | DI 模型：Vext service loader、Fastify 启动组合或 Nest provider |
| 请求关联、安全响应头、结构化日志、延迟注入与资源 telemetry                             | 各框架的 API 形式                                              |

测试负载有意保持小而不“裸”：每条请求都覆盖请求上下文、鉴权和授权、校验、服务组合、结构化日志、安全响应头、内存仓储边界以及响应/错误处理。每个目标都会发出同类结构化日志事件，但都写入 discard sink，避免主机控制台或磁盘 I/O 主导框架对比。1 ms 和 5 ms 是确定性的非阻塞延迟注入，不宣称代表真实数据库或 Redis。

Hono 有意推迟到第二阶段。当前仓库尚没有已验证的 Hono 校验与服务组合架构，无法在不引入临时替代品的前提下满足本页契约；现在强行加入反而会降低公平性，而不是提高完整性。

### 目标运行时版本

当前固定实现使用 VextJS **1.0.1**、Fastify **5.12.0**、Nest `@nestjs/common` / `@nestjs/core` / `@nestjs/platform-fastify` **11.2.1**、`reflect-metadata` **0.2.2**、`rxjs` **7.8.2** 与 Autocannon **8.0.0**。runner 会在运行前将每个 benchmark 依赖与 npm `latest` 核对，证明原生 Fastify 与 Nest host 都报告该精确 Fastify 版本，并在每份可接受的正式结果中列出全部精确版本。

## 工作负载

| ID                    | 请求结果 | 覆盖内容                                           |
| --------------------- | -------- | -------------------------------------------------- |
| `success-cpu`         | 201      | 完整成功路径：确定性的轻量定价计算和一次仓储写入。 |
| `success-latency-1ms` | 201      | 同一成功路径，额外注入 1 ms 非阻塞延迟。           |
| `success-latency-5ms` | 201      | 同一成功路径，额外注入 5 ms 非阻塞延迟。           |
| `validation-failure`  | 422      | 已鉴权但 body 非法，在仓储写入前被拒绝。           |

<!-- enterprise-results:start -->

## 当前正式结果

尚未发布可接受的正式 artifact。Windows 本地运行和 pilot 运行可用于验证实现，但本页不会将它们伪装为公开基准数据。

可接受结果必须来自干净的 Vext 源码、Linux x64、由 pilot 冻结的当前 LTS Node.js 主版本、已核验的精确最新依赖、50 connections / pipelining 1、至少 10 秒预热和 30 秒测量、至少 7 轮轮转、经 pilot 冻结的 CV 门禁、零错误/超时/意外状态响应，并且 load generator 与 target 使用不重叠 CPU 集（或不同主机）。

<!-- enterprise-results:end -->

## 正式协议

正式 runner 只有在以下条件全部满足时，才会生成可引用 artifact：

- 源码工作区干净，并在 artifact 中记录 revision；
- 主机为 Linux x64，合格 pilot 会冻结其当前 LTS Node.js 主版本，runner 会核验 runner 与每个 target 的实际 CPU 亲和性；
- 每个目标包都与运行当日核验的 npm `latest` 精确版本一致；
- 开始压测前，所有目标均通过同一套语义 conformance；
- 协议由已审阅的 pilot 冻结，然后使用 50 connections、pipelining 1、至少 10 秒预热、每次至少 30 秒测量、至少 7 轮轮转；
- 每个工作负载记录 RPS、P50/P95/P99、错误、超时、状态分布、CPU 时间、每 1K 请求 CPU、RSS、峰值 RSS、精确版本和 provenance。

完整样本会生成在本页中英文结果块内；不会被替换为只跳转 GitHub 或单独 results 页的链接。

## 复现

本地运行仅用于实现验证：

```bash
npm ci
npm run build
npm run test:bench:enterprise -- --pilot
```

当合格的 Linux x64 pilot 已经评审，并将 Node.js 主版本和 CV 门禁明确冻结到 `test/benchmark/enterprise/protocols/linux-x64-v1.json` 后，使用隔离 CPU 集运行正式套件：

```bash
taskset -c 4-7 node test/benchmark/enterprise/run-enterprise-suite.mjs \
  --formal --load-cpus 4-7 --target-cpus 0-3

npm run generate:enterprise-benchmark-docs
npm run verify:enterprise-benchmark-docs
```

生成器会拒绝本地、pilot、脏源码、不完整、不稳定或非 Linux artifact，避免把方便取得的本地数字悄悄变成文档证据。

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

此结果于 **2026-08-15T12:56:22.655Z** 生成，来自干净源码 `@8bd3c7b67ebda3e79507fb43ad752c53e856884d`。它是一个可引用的 Linux x64 正式样本；每个数字都是 7 轮的 RPS 中位数。

| 工作负载                                      | Vext Native RPS 中位数 | Vext Native P99 中位数 | Vext Native CPU / 1K 中位数 | Fastify RPS 中位数 | Fastify P99 中位数 | Fastify CPU / 1K 中位数 | Nest + Fastify RPS 中位数 | Nest + Fastify P99 中位数 | Nest + Fastify CPU / 1K 中位数 |
| --------------------------------------------- | ---------------------- | ---------------------- | --------------------------- | ------------------ | ------------------ | ----------------------- | ------------------------- | ------------------------- | ------------------------------ |
| Success: CPU-bound service composition        | 5,668.54               | 16 ms                  | 185,861.2 μs                | 8,167.07           | 13 ms              | 134,770.04 μs           | 6,355.6                   | 14 ms                     | 174,272.3 μs                   |
| Success: 1 ms deterministic latency injection | 6,941.07               | 15 ms                  | 158,362.71 μs               | 12,692             | 11 ms              | 91,564.35 μs            | 8,815.47                  | 14 ms                     | 137,658.45 μs                  |
| Success: 5 ms deterministic latency injection | 6,590.94               | 12 ms                  | 156,094.93 μs               | 7,634.8            | 11 ms              | 96,381.37 μs            | 7,215.47                  | 12 ms                     | 145,223.76 μs                  |
| Failure: invalid request body                 | 3,844.07               | 25 ms                  | 279,561.39 μs               | 7,142.27           | 16 ms              | 154,430.77 μs           | 5,382.54                  | 17 ms                     | 210,455.83 μs                  |

### 运行身份与协议

| 字段       | 值                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 源码       | `@8bd3c7b67ebda3e79507fb43ad752c53e856884d`（clean）                                                                                     |
| 平台       | linux x64                                                                                                                                |
| Node.js    | v24.19.0                                                                                                                                 |
| 协议       | linux-x64-v1; Node 24.x；30s × 7 轮；50 connections；pipelining 1；10s 预热；CV ≤ 10%                                                    |
| CPU 隔离   | load=4-7; target=0-3                                                                                                                     |
| 资格 pilot | 2026-08-15T09:31:59.150Z；Node 24.x；观察到最大 CV 6.51%；批准 CV ≤ 10%                                                                  |
| 版本       | Vext 1.0.1; Fastify 5.12.0; Nest common/core/platform-fastify 11.2.1/11.2.1/11.2.1; reflect-metadata 0.2.2; rxjs 7.8.2; Autocannon 8.0.0 |

### 完整逐轮样本

每个逐轮样本的请求数、状态分布、延迟、CPU 与 RSS 都在本页；本页不会把完整证据转移到 GitHub 或另一个 results 页面。

| 工作负载                                      | 目标           | 轮次 | RPS       | 完成 / 已处理请求 | P50 / P97.5 / P99 | 状态分布    | CPU / 1K      | RSS / 峰值 RSS          |
| --------------------------------------------- | -------------- | ---- | --------- | ----------------- | ----------------- | ----------- | ------------- | ----------------------- |
| Success: CPU-bound service composition        | Vext Native    | 1    | 5,668.54  | 170,047 / 170,097 | 8 / 15 / 17 ms    | 201: 170047 | 185,861.2 μs  | 285.45 MiB / 285.73 MiB |
| Success: CPU-bound service composition        | Vext Native    | 2    | 6,137.87  | 184,129 / 184,179 | 7 / 12 / 15 ms    | 201: 184129 | 171,411.32 μs | 277.88 MiB / 277.88 MiB |
| Success: CPU-bound service composition        | Vext Native    | 3    | 5,998.8   | 179,942 / 179,992 | 7 / 13 / 15 ms    | 201: 179942 | 175,270.6 μs  | 278.38 MiB / 278.38 MiB |
| Success: CPU-bound service composition        | Vext Native    | 4    | 5,869.6   | 176,078 / 176,128 | 8 / 13 / 16 ms    | 201: 176078 | 179,139.3 μs  | 278.88 MiB / 278.88 MiB |
| Success: CPU-bound service composition        | Vext Native    | 5    | 5,616.8   | 168,492 / 168,542 | 8 / 14 / 16 ms    | 201: 168492 | 191,305.25 μs | 224.13 MiB / 224.13 MiB |
| Success: CPU-bound service composition        | Vext Native    | 6    | 5,658.94  | 169,754 / 169,804 | 8 / 14 / 16 ms    | 201: 169754 | 189,894.9 μs  | 225.63 MiB / 225.63 MiB |
| Success: CPU-bound service composition        | Vext Native    | 7    | 5,645.6   | 169,356 / 169,406 | 8 / 15 / 17 ms    | 201: 169356 | 189,959.56 μs | 225.63 MiB / 225.63 MiB |
| Success: CPU-bound service composition        | Fastify        | 1    | 8,436.27  | 253,042 / 253,092 | 5 / 12 / 13 ms    | 201: 253042 | 130,402.41 μs | 231.87 MiB / 231.87 MiB |
| Success: CPU-bound service composition        | Fastify        | 2    | 8,522.27  | 255,655 / 255,705 | 5 / 12 / 13 ms    | 201: 255655 | 128,973.28 μs | 232.06 MiB / 232.12 MiB |
| Success: CPU-bound service composition        | Fastify        | 3    | 7,840.87  | 235,212 / 235,262 | 5 / 13 / 15 ms    | 201: 235212 | 139,083.37 μs | 232.04 MiB / 232.04 MiB |
| Success: CPU-bound service composition        | Fastify        | 4    | 8,109.14  | 243,260 / 243,310 | 5 / 12 / 14 ms    | 201: 243260 | 134,770.04 μs | 232.04 MiB / 232.04 MiB |
| Success: CPU-bound service composition        | Fastify        | 5    | 8,224.47  | 246,708 / 246,758 | 5 / 12 / 13 ms    | 201: 246708 | 132,871.97 μs | 246.29 MiB / 246.29 MiB |
| Success: CPU-bound service composition        | Fastify        | 6    | 8,083.27  | 242,503 / 242,553 | 5 / 11 / 13 ms    | 201: 242503 | 136,685.27 μs | 206.8 MiB / 206.8 MiB   |
| Success: CPU-bound service composition        | Fastify        | 7    | 8,167.07  | 245,010 / 245,060 | 5 / 11 / 13 ms    | 201: 245010 | 134,782.8 μs  | 206.64 MiB / 206.64 MiB |
| Success: CPU-bound service composition        | Nest + Fastify | 1    | 6,355.6   | 190,663 / 190,713 | 7 / 14 / 15 ms    | 201: 190663 | 174,272.3 μs  | 277.14 MiB / 277.14 MiB |
| Success: CPU-bound service composition        | Nest + Fastify | 2    | 6,637.6   | 199,119 / 199,169 | 7 / 13 / 14 ms    | 201: 199119 | 167,092.18 μs | 277.14 MiB / 277.14 MiB |
| Success: CPU-bound service composition        | Nest + Fastify | 3    | 6,621.07  | 198,617 / 198,667 | 7 / 13 / 14 ms    | 201: 198617 | 167,426.39 μs | 277.14 MiB / 277.14 MiB |
| Success: CPU-bound service composition        | Nest + Fastify | 4    | 6,364.94  | 190,932 / 190,982 | 7 / 13 / 15 ms    | 201: 190932 | 173,922.4 μs  | 270.33 MiB / 270.33 MiB |
| Success: CPU-bound service composition        | Nest + Fastify | 5    | 6,223.47  | 186,688 / 186,738 | 7 / 14 / 15 ms    | 201: 186688 | 177,514.82 μs | 270.58 MiB / 270.58 MiB |
| Success: CPU-bound service composition        | Nest + Fastify | 6    | 6,281.87  | 188,449 / 188,499 | 7 / 14 / 14 ms    | 201: 188449 | 175,893.98 μs | 270.58 MiB / 270.58 MiB |
| Success: CPU-bound service composition        | Nest + Fastify | 7    | 6,350.27  | 190,505 / 190,555 | 7 / 13 / 14 ms    | 201: 190505 | 179,996.48 μs | 222.22 MiB / 222.25 MiB |
| Success: 1 ms deterministic latency injection | Vext Native    | 1    | 6,507.07  | 195,194 / 195,244 | 6 / 14 / 16 ms    | 201: 195194 | 168,498.69 μs | 236.49 MiB / 236.49 MiB |
| Success: 1 ms deterministic latency injection | Vext Native    | 2    | 6,504.14  | 195,111 / 195,161 | 6 / 14 / 16 ms    | 201: 195111 | 168,078.24 μs | 242.49 MiB / 242.49 MiB |
| Success: 1 ms deterministic latency injection | Vext Native    | 3    | 6,941.07  | 208,220 / 208,270 | 6 / 13 / 15 ms    | 201: 208220 | 158,362.71 μs | 242.74 MiB / 242.74 MiB |
| Success: 1 ms deterministic latency injection | Vext Native    | 4    | 6,455.04  | 193,631 / 193,681 | 6 / 16 / 19 ms    | 201: 193631 | 169,267.34 μs | 243.37 MiB / 243.37 MiB |
| Success: 1 ms deterministic latency injection | Vext Native    | 5    | 7,164.94  | 214,936 / 214,986 | 5 / 13 / 15 ms    | 201: 214936 | 153,540.9 μs  | 243.49 MiB / 243.49 MiB |
| Success: 1 ms deterministic latency injection | Vext Native    | 6    | 7,028.27  | 210,836 / 210,886 | 6 / 13 / 15 ms    | 201: 210836 | 156,530.66 μs | 243.49 MiB / 243.49 MiB |
| Success: 1 ms deterministic latency injection | Vext Native    | 7    | 7,204.94  | 216,139 / 216,189 | 5 / 13 / 15 ms    | 201: 216139 | 152,818.68 μs | 243.49 MiB / 243.49 MiB |
| Success: 1 ms deterministic latency injection | Fastify        | 1    | 12,048.54 | 361,440 / 361,490 | 3 / 9 / 11 ms     | 201: 361440 | 96,037.88 μs  | 226.66 MiB / 226.66 MiB |
| Success: 1 ms deterministic latency injection | Fastify        | 2    | 11,826.94 | 354,785 / 354,835 | 3 / 10 / 12 ms    | 201: 354785 | 97,858.9 μs   | 228.15 MiB / 228.28 MiB |
| Success: 1 ms deterministic latency injection | Fastify        | 3    | 12,692    | 380,744 / 380,794 | 3 / 9 / 11 ms     | 201: 380744 | 91,564.35 μs  | 228.4 MiB / 228.4 MiB   |
| Success: 1 ms deterministic latency injection | Fastify        | 4    | 12,678.4  | 380,349 / 380,399 | 3 / 8 / 11 ms     | 201: 380349 | 91,780.94 μs  | 228.4 MiB / 228.4 MiB   |
| Success: 1 ms deterministic latency injection | Fastify        | 5    | 12,795.74 | 383,869 / 383,919 | 3 / 8 / 11 ms     | 201: 383869 | 91,004.87 μs  | 228.16 MiB / 228.16 MiB |
| Success: 1 ms deterministic latency injection | Fastify        | 6    | 12,922.14 | 387,627 / 387,677 | 3 / 8 / 11 ms     | 201: 387627 | 90,032.08 μs  | 228.16 MiB / 228.16 MiB |
| Success: 1 ms deterministic latency injection | Fastify        | 7    | 12,970.67 | 389,110 / 389,160 | 3 / 9 / 11 ms     | 201: 389110 | 88,575.62 μs  | 252.41 MiB / 252.41 MiB |
| Success: 1 ms deterministic latency injection | Nest + Fastify | 1    | 8,165.94  | 244,958 / 245,008 | 5 / 12 / 15 ms    | 201: 244958 | 147,117.78 μs | 239.8 MiB / 239.8 MiB   |
| Success: 1 ms deterministic latency injection | Nest + Fastify | 2    | 8,149.94  | 244,488 / 244,538 | 5 / 13 / 15 ms    | 201: 244488 | 147,569.57 μs | 240.05 MiB / 240.05 MiB |
| Success: 1 ms deterministic latency injection | Nest + Fastify | 3    | 8,644     | 259,323 / 259,373 | 4 / 11 / 14 ms    | 201: 259323 | 140,133.78 μs | 240.05 MiB / 240.05 MiB |
| Success: 1 ms deterministic latency injection | Nest + Fastify | 4    | 8,835.47  | 265,048 / 265,098 | 4 / 11 / 14 ms    | 201: 265048 | 137,343.64 μs | 240.05 MiB / 240.05 MiB |
| Success: 1 ms deterministic latency injection | Nest + Fastify | 5    | 8,815.47  | 264,442 / 264,492 | 4 / 11 / 14 ms    | 201: 264442 | 137,658.45 μs | 240.32 MiB / 240.32 MiB |
| Success: 1 ms deterministic latency injection | Nest + Fastify | 6    | 8,848.8   | 265,456 / 265,506 | 4 / 11 / 14 ms    | 201: 265456 | 137,170.47 μs | 240.32 MiB / 240.32 MiB |
| Success: 1 ms deterministic latency injection | Nest + Fastify | 7    | 8,882.94  | 266,473 / 266,523 | 4 / 11 / 14 ms    | 201: 266473 | 136,768.38 μs | 240.32 MiB / 240.32 MiB |
| Success: 5 ms deterministic latency injection | Vext Native    | 1    | 6,600.14  | 197,994 / 198,044 | 7 / 10 / 12 ms    | 201: 197994 | 155,961.72 μs | 243.49 MiB / 243.49 MiB |
| Success: 5 ms deterministic latency injection | Vext Native    | 2    | 6,569.34  | 197,063 / 197,113 | 7 / 11 / 12 ms    | 201: 197063 | 157,083.03 μs | 243.49 MiB / 243.49 MiB |
| Success: 5 ms deterministic latency injection | Vext Native    | 3    | 6,528.54  | 195,839 / 195,889 | 7 / 11 / 12 ms    | 201: 195839 | 158,147.97 μs | 243.49 MiB / 243.49 MiB |
| Success: 5 ms deterministic latency injection | Vext Native    | 4    | 6,590.94  | 197,716 / 197,766 | 7 / 10 / 12 ms    | 201: 197716 | 156,094.93 μs | 243.49 MiB / 243.49 MiB |
| Success: 5 ms deterministic latency injection | Vext Native    | 5    | 6,588.54  | 197,640 / 197,690 | 7 / 10 / 12 ms    | 201: 197640 | 156,350.87 μs | 243.49 MiB / 243.49 MiB |
| Success: 5 ms deterministic latency injection | Vext Native    | 6    | 6,623.6   | 198,689 / 198,739 | 7 / 10 / 12 ms    | 201: 198689 | 154,933.45 μs | 243.49 MiB / 243.49 MiB |
| Success: 5 ms deterministic latency injection | Vext Native    | 7    | 6,594.4   | 197,820 / 197,870 | 7 / 10 / 12 ms    | 201: 197820 | 155,712.48 μs | 243.62 MiB / 243.62 MiB |
| Success: 5 ms deterministic latency injection | Fastify        | 1    | 7,636.14  | 229,082 / 229,132 | 6 / 9 / 11 ms     | 201: 229082 | 95,745.82 μs  | 252.66 MiB / 252.66 MiB |
| Success: 5 ms deterministic latency injection | Fastify        | 2    | 7,629.34  | 228,855 / 228,905 | 6 / 9 / 11 ms     | 201: 228855 | 96,311.04 μs  | 252.66 MiB / 252.66 MiB |
| Success: 5 ms deterministic latency injection | Fastify        | 3    | 7,610.54  | 228,302 / 228,352 | 6 / 9 / 12 ms     | 201: 228302 | 96,850.67 μs  | 232.01 MiB / 232.01 MiB |
| Success: 5 ms deterministic latency injection | Fastify        | 4    | 7,634.8   | 229,035 / 229,085 | 6 / 9 / 11 ms     | 201: 229035 | 96,339.77 μs  | 237.82 MiB / 237.82 MiB |
| Success: 5 ms deterministic latency injection | Fastify        | 5    | 7,636.54  | 229,092 / 229,142 | 6 / 9 / 11 ms     | 201: 229092 | 96,381.37 μs  | 246.57 MiB / 246.57 MiB |
| Success: 5 ms deterministic latency injection | Fastify        | 6    | 7,641.6   | 229,233 / 229,283 | 6 / 9 / 11 ms     | 201: 229233 | 97,284.57 μs  | 215.38 MiB / 215.38 MiB |
| Success: 5 ms deterministic latency injection | Fastify        | 7    | 7,625.2   | 228,743 / 228,793 | 6 / 9 / 11 ms     | 201: 228743 | 100,272.91 μs | 225.15 MiB / 225.15 MiB |
| Success: 5 ms deterministic latency injection | Nest + Fastify | 1    | 7,215.47  | 216,445 / 216,495 | 6 / 11 / 12 ms    | 201: 216445 | 145,899.2 μs  | 240.32 MiB / 240.32 MiB |
| Success: 5 ms deterministic latency injection | Nest + Fastify | 2    | 7,212.8   | 216,365 / 216,415 | 6 / 10 / 12 ms    | 201: 216365 | 144,266.07 μs | 240.32 MiB / 240.32 MiB |
| Success: 5 ms deterministic latency injection | Nest + Fastify | 3    | 7,248.27  | 217,429 / 217,479 | 6 / 10 / 12 ms    | 201: 217429 | 144,336.86 μs | 240.32 MiB / 240.32 MiB |
| Success: 5 ms deterministic latency injection | Nest + Fastify | 4    | 7,247.6   | 217,418 / 217,468 | 6 / 11 / 12 ms    | 201: 217418 | 144,630.99 μs | 240.32 MiB / 240.32 MiB |
| Success: 5 ms deterministic latency injection | Nest + Fastify | 5    | 7,220.14  | 216,586 / 216,636 | 6 / 11 / 12 ms    | 201: 216586 | 145,223.76 μs | 240.32 MiB / 240.32 MiB |
| Success: 5 ms deterministic latency injection | Nest + Fastify | 6    | 7,214     | 216,410 / 216,460 | 6 / 11 / 12 ms    | 201: 216410 | 145,307.73 μs | 240.32 MiB / 240.32 MiB |
| Success: 5 ms deterministic latency injection | Nest + Fastify | 7    | 7,018     | 210,526 / 210,576 | 6 / 12 / 14 ms    | 201: 210526 | 154,249.88 μs | 240.32 MiB / 240.32 MiB |
| Failure: invalid request body                 | Vext Native    | 1    | 4,018.37  | 120,537 / 120,587 | 11 / 19 / 23 ms   | 422: 120537 | 267,394.34 μs | 243.84 MiB / 243.84 MiB |
| Failure: invalid request body                 | Vext Native    | 2    | 3,892.44  | 116,760 / 116,810 | 12 / 20 / 23 ms   | 422: 116760 | 276,002.63 μs | 243.84 MiB / 243.84 MiB |
| Failure: invalid request body                 | Vext Native    | 3    | 4,037.34  | 121,110 / 121,160 | 11 / 19 / 23 ms   | 422: 121110 | 266,307.43 μs | 243.84 MiB / 243.84 MiB |
| Failure: invalid request body                 | Vext Native    | 4    | 3,679.17  | 110,359 / 110,409 | 12 / 22 / 25 ms   | 422: 110359 | 291,626.33 μs | 243.84 MiB / 243.84 MiB |
| Failure: invalid request body                 | Vext Native    | 5    | 3,844.07  | 115,309 / 115,359 | 12 / 22 / 25 ms   | 422: 115309 | 279,561.39 μs | 243.84 MiB / 243.84 MiB |
| Failure: invalid request body                 | Vext Native    | 6    | 3,732.27  | 111,954 / 112,004 | 12 / 23 / 27 ms   | 422: 111954 | 287,937.16 μs | 243.84 MiB / 243.84 MiB |
| Failure: invalid request body                 | Vext Native    | 7    | 3,745.84  | 112,362 / 112,412 | 12 / 23 / 28 ms   | 422: 112362 | 286,130.47 μs | 243.84 MiB / 243.84 MiB |
| Failure: invalid request body                 | Fastify        | 1    | 7,192.94  | 215,776 / 215,826 | 6 / 13 / 15 ms    | 422: 215776 | 153,303.67 μs | 231.85 MiB / 231.85 MiB |
| Failure: invalid request body                 | Fastify        | 2    | 7,206.54  | 216,183 / 216,233 | 6 / 13 / 15 ms    | 422: 216183 | 153,245.65 μs | 232.05 MiB / 232.05 MiB |
| Failure: invalid request body                 | Fastify        | 3    | 7,142.27  | 214,252 / 214,302 | 6 / 13 / 16 ms    | 422: 214252 | 154,430.77 μs | 232.05 MiB / 232.05 MiB |
| Failure: invalid request body                 | Fastify        | 4    | 6,884.94  | 206,545 / 206,595 | 6 / 14 / 16 ms    | 422: 206545 | 160,238.72 μs | 232.05 MiB / 232.05 MiB |
| Failure: invalid request body                 | Fastify        | 5    | 6,991.6   | 209,723 / 209,773 | 6 / 14 / 16 ms    | 422: 209723 | 157,867.75 μs | 232.15 MiB / 232.3 MiB  |
| Failure: invalid request body                 | Fastify        | 6    | 7,303.2   | 219,078 / 219,128 | 6 / 13 / 15 ms    | 422: 219078 | 151,343.06 μs | 232.4 MiB / 232.4 MiB   |
| Failure: invalid request body                 | Fastify        | 7    | 7,012.54  | 210,359 / 210,409 | 6 / 14 / 16 ms    | 422: 210359 | 156,963.06 μs | 232.29 MiB / 232.54 MiB |
| Failure: invalid request body                 | Nest + Fastify | 1    | 5,618.14  | 168,523 / 168,573 | 8 / 15 / 16 ms    | 422: 168523 | 201,355.23 μs | 240.27 MiB / 241.26 MiB |
| Failure: invalid request body                 | Nest + Fastify | 2    | 5,402.8   | 162,059 / 162,109 | 8 / 15 / 17 ms    | 422: 162059 | 208,957.31 μs | 240.89 MiB / 240.89 MiB |
| Failure: invalid request body                 | Nest + Fastify | 3    | 5,382.54  | 161,471 / 161,521 | 8 / 16 / 17 ms    | 422: 161471 | 210,455.83 μs | 240.63 MiB / 240.89 MiB |
| Failure: invalid request body                 | Nest + Fastify | 4    | 4,955.87  | 148,661 / 148,711 | 9 / 17 / 20 ms    | 422: 148661 | 226,383.49 μs | 240.23 MiB / 240.23 MiB |
| Failure: invalid request body                 | Nest + Fastify | 5    | 5,785.47  | 173,553 / 173,603 | 8 / 14 / 16 ms    | 422: 173553 | 195,209.9 μs  | 240.23 MiB / 240.23 MiB |
| Failure: invalid request body                 | Nest + Fastify | 6    | 5,341.34  | 160,231 / 160,281 | 8 / 17 / 19 ms    | 422: 160231 | 211,810.65 μs | 240.84 MiB / 241.33 MiB |
| Failure: invalid request body                 | Nest + Fastify | 7    | 5,134.64  | 154,025 / 154,075 | 8 / 17 / 20 ms    | 422: 154025 | 219,116.59 μs | 240.84 MiB / 240.84 MiB |

<!-- enterprise-results:end -->

<!-- enterprise-raw-diagnostics:start -->

## 裸路径诊断参考（非生产排名）

这一组数据是与上方正式结果绑定的最短路径维护诊断：源码 commit、Node.js、Linux 平台、CPU 型号、内存与 Vext / Fastify / Autocannon 版本完全一致，记录时间相差不超过 24 小时。它故意使用短路径 API，不复刻上方生产形态 API；因此只用于解释路由与组合开销，不能与正式结果相减、合并或作为生产选型排名。

### 诊断身份与协议

| 字段     | 值                                                             |
| -------- | -------------------------------------------------------------- |
| 诊断来源 | `detached@8bd3c7b67ebda3e79507fb43ad752c53e856884d`（clean）   |
| 诊断协议 | 10s × 5 轮；50 connections；pipelining 10；5s 预热；CV ≤ 15%   |
| 版本     | Vext 1.0.1; Fastify 5.12.0; route-core 0.0.7; Autocannon 8.0.0 |

### 诊断汇总

| 诊断场景     | Raw Native RPS 中位数 / CV | Raw Fastify RPS 中位数 / CV | Vext Native Core RPS 中位数 / CV | Vext Native Normal RPS 中位数 / CV |
| ------------ | -------------------------- | --------------------------- | -------------------------------- | ---------------------------------- |
| JSON 响应    | 30,768.73 / 13.73%         | 28,976.73 / 13.83%          | 30,541.6 / 4.26%                 | 28,825.46 / 3.91%                  |
| 路由参数     | 34,214.55 / 12.47%         | 31,856 / 8.45%              | 28,348.8 / 2.8%                  | 26,438.55 / 7.78%                  |
| 处理器业务链 | 29,352 / 8.06%             | 28,601.6 / 10.62%           | 24,361.46 / 5.19%                | 23,839.28 / 10.06%                 |
| 真实中间件链 | 31,360.73 / 11.89%         | 31,073.46 / 11.1%           | N/A                              | 22,490.91 / 5.76%                  |

### 完整逐轮诊断样本

每一轮裸路径样本也直接留在本页。`Vext Native Core` 在真实中间件链场景显示 `N/A`，因为这个私有 direct harness 按设计不注册 route middleware；这不是零成本，也不是漏测。

| 诊断场景     | 目标               | 轮次 | RPS       | 请求数  | P50 / P99  | 错误 / 超时 / 非 2xx | 吞吐          |
| ------------ | ------------------ | ---- | --------- | ------- | ---------- | -------------------- | ------------- |
| JSON 响应    | Raw Native         | 1    | 35,136.81 | 351,341 | 15 / 24 ms | 0 / 0 / 0            | 6,851,379.2   |
| JSON 响应    | Raw Native         | 2    | 33,673.6  | 336,702 | 16 / 35 ms | 0 / 0 / 0            | 6,565,478.4   |
| JSON 响应    | Raw Native         | 3    | 25,377.6  | 253,802 | 17 / 48 ms | 0 / 0 / 0            | 4,949,094.41  |
| JSON 响应    | Raw Native         | 4    | 30,768.73 | 338,451 | 12 / 27 ms | 0 / 0 / 0            | 5,999,336.73  |
| JSON 响应    | Raw Native         | 5    | 25,188.8  | 251,892 | 18 / 37 ms | 0 / 0 / 0            | 4,911,923.2   |
| JSON 响应    | Raw Fastify        | 1    | 33,717.6  | 337,182 | 16 / 25 ms | 0 / 0 / 0            | 6,608,486.4   |
| JSON 响应    | Raw Fastify        | 2    | 36,704    | 367,062 | 15 / 22 ms | 0 / 0 / 0            | 7,194,214.4   |
| JSON 响应    | Raw Fastify        | 3    | 25,888.73 | 284,770 | 15 / 35 ms | 0 / 0 / 0            | 5,074,478.55  |
| JSON 响应    | Raw Fastify        | 4    | 28,976.73 | 318,751 | 13 / 30 ms | 0 / 0 / 0            | 5,679,476.37  |
| JSON 响应    | Raw Fastify        | 5    | 26,517.1  | 291,711 | 14 / 38 ms | 0 / 0 / 0            | 5,198,010.19  |
| JSON 响应    | Vext Native Core   | 1    | 30,610.19 | 336,690 | 17 / 35 ms | 0 / 0 / 0            | 5,968,430.55  |
| JSON 响应    | Vext Native Core   | 2    | 27,558.55 | 303,134 | 19 / 36 ms | 0 / 0 / 0            | 5,374,138.19  |
| JSON 响应    | Vext Native Core   | 3    | 29,232.73 | 321,559 | 17 / 35 ms | 0 / 0 / 0            | 5,699,584     |
| JSON 响应    | Vext Native Core   | 4    | 30,541.6  | 305,401 | 17 / 33 ms | 0 / 0 / 0            | 5,955,993.6   |
| JSON 响应    | Vext Native Core   | 5    | 31,021.6  | 310,206 | 17 / 32 ms | 0 / 0 / 0            | 6,048,972.8   |
| JSON 响应    | Vext Native Normal | 1    | 27,648.73 | 304,135 | 19 / 36 ms | 0 / 0 / 0            | 5,391,266.91  |
| JSON 响应    | Vext Native Normal | 2    | 28,825.46 | 317,090 | 18 / 35 ms | 0 / 0 / 0            | 5,621,387.64  |
| JSON 响应    | Vext Native Normal | 3    | 29,254.4  | 292,560 | 18 / 34 ms | 0 / 0 / 0            | 5,704,908.8   |
| JSON 响应    | Vext Native Normal | 4    | 30,708.8  | 307,100 | 17 / 31 ms | 0 / 0 / 0            | 5,988,352     |
| JSON 响应    | Vext Native Normal | 5    | 27,712.73 | 304,832 | 18 / 41 ms | 0 / 0 / 0            | 5,403,554.91  |
| 路由参数     | Raw Native         | 1    | 38,128    | 381,301 | 15 / 21 ms | 0 / 0 / 0            | 7,549,747.2   |
| 路由参数     | Raw Native         | 2    | 37,424.81 | 374,260 | 15 / 25 ms | 0 / 0 / 0            | 7,410,483.2   |
| 路由参数     | Raw Native         | 3    | 32,584.8  | 325,795 | 16 / 33 ms | 0 / 0 / 0            | 6,451,200     |
| 路由参数     | Raw Native         | 4    | 34,214.55 | 376,368 | 16 / 28 ms | 0 / 0 / 0            | 6,774,597.82  |
| 路由参数     | Raw Native         | 5    | 26,381.82 | 290,174 | 16 / 34 ms | 0 / 0 / 0            | 5,223,703.28  |
| 路由参数     | Raw Fastify        | 1    | 36,085.1  | 396,959 | 15 / 30 ms | 0 / 0 / 0            | 7,181,218.91  |
| 路由参数     | Raw Fastify        | 2    | 33,568    | 369,166 | 16 / 27 ms | 0 / 0 / 0            | 6,678,155.64  |
| 路由参数     | Raw Fastify        | 3    | 31,065.6  | 310,635 | 17 / 29 ms | 0 / 0 / 0            | 6,182,092.8   |
| 路由参数     | Raw Fastify        | 4    | 31,856    | 350,438 | 17 / 30 ms | 0 / 0 / 0            | 6,340,049.46  |
| 路由参数     | Raw Fastify        | 5    | 27,904.8  | 279,052 | 17 / 38 ms | 0 / 0 / 0            | 5,552,947.2   |
| 路由参数     | Vext Native Core   | 1    | 29,721.46 | 326,934 | 18 / 36 ms | 0 / 0 / 0            | 5,884,648.73  |
| 路由参数     | Vext Native Core   | 2    | 28,753.6  | 287,523 | 18 / 35 ms | 0 / 0 / 0            | 5,693,030.4   |
| 路由参数     | Vext Native Core   | 3    | 27,433.6  | 274,319 | 18 / 39 ms | 0 / 0 / 0            | 5,431,705.6   |
| 路由参数     | Vext Native Core   | 4    | 27,795.64 | 305,774 | 18 / 40 ms | 0 / 0 / 0            | 5,503,720.73  |
| 路由参数     | Vext Native Core   | 5    | 28,348.8  | 283,488 | 18 / 41 ms | 0 / 0 / 0            | 5,613,568     |
| 路由参数     | Vext Native Normal | 1    | 30,418.19 | 334,620 | 18 / 32 ms | 0 / 0 / 0            | 6,023,168     |
| 路由参数     | Vext Native Normal | 2    | 26,438.55 | 290,826 | 19 / 40 ms | 0 / 0 / 0            | 5,235,246.55  |
| 路由参数     | Vext Native Normal | 3    | 25,156.4  | 251,536 | 19 / 59 ms | 0 / 0 / 0            | 4,980,531.2   |
| 路由参数     | Vext Native Normal | 4    | 26,083.2  | 260,833 | 19 / 39 ms | 0 / 0 / 0            | 5,164,646.41  |
| 路由参数     | Vext Native Normal | 5    | 29,942.55 | 329,393 | 18 / 32 ms | 0 / 0 / 0            | 5,929,704.73  |
| 处理器业务链 | Raw Native         | 1    | 29,930.19 | 329,195 | 18 / 36 ms | 0 / 0 / 0            | 10,504,564.37 |
| 处理器业务链 | Raw Native         | 2    | 26,501.1  | 291,499 | 20 / 41 ms | 0 / 0 / 0            | 9,301,643.64  |
| 处理器业务链 | Raw Native         | 3    | 29,352    | 322,846 | 19 / 32 ms | 0 / 0 / 0            | 10,301,626.19 |
| 处理器业务链 | Raw Native         | 4    | 32,658.19 | 359,278 | 18 / 23 ms | 0 / 0 / 0            | 11,465,448.73 |
| 处理器业务链 | Raw Native         | 5    | 26,422.55 | 290,644 | 14 / 31 ms | 0 / 0 / 0            | 9,272,971.64  |
| 处理器业务链 | Raw Fastify        | 1    | 26,585.46 | 292,449 | 20 / 35 ms | 0 / 0 / 0            | 9,358,056.73  |
| 处理器业务链 | Raw Fastify        | 2    | 29,417.6  | 294,159 | 18 / 30 ms | 0 / 0 / 0            | 10,353,868.81 |
| 处理器业务链 | Raw Fastify        | 3    | 32,895.28 | 361,776 | 17 / 25 ms | 0 / 0 / 0            | 11,577,157.82 |
| 处理器业务链 | Raw Fastify        | 4    | 28,601.6  | 286,004 | 19 / 32 ms | 0 / 0 / 0            | 10,065,510.4  |
| 处理器业务链 | Raw Fastify        | 5    | 23,865.46 | 262,537 | 16 / 37 ms | 0 / 0 / 0            | 8,400,523.64  |
| 处理器业务链 | Vext Native Core   | 1    | 24,361.46 | 267,979 | 21 / 40 ms | 0 / 0 / 0            | 8,550,772.37  |
| 处理器业务链 | Vext Native Core   | 2    | 24,054.55 | 264,608 | 22 / 39 ms | 0 / 0 / 0            | 8,442,786.91  |
| 处理器业务链 | Vext Native Core   | 3    | 22,712    | 227,124 | 22 / 48 ms | 0 / 0 / 0            | 7,970,816     |
| 处理器业务链 | Vext Native Core   | 4    | 26,524.8  | 265,250 | 21 / 34 ms | 0 / 0 / 0            | 9,311,027.2   |
| 处理器业务链 | Vext Native Core   | 5    | 25,331.2  | 253,280 | 21 / 38 ms | 0 / 0 / 0            | 8,890,982.4   |
| 处理器业务链 | Vext Native Normal | 1    | 24,242.19 | 266,638 | 22 / 38 ms | 0 / 0 / 0            | 8,507,950.55  |
| 处理器业务链 | Vext Native Normal | 2    | 23,359.28 | 256,946 | 23 / 39 ms | 0 / 0 / 0            | 8,198,888.73  |
| 处理器业务链 | Vext Native Normal | 3    | 18,297.2  | 182,956 | 27 / 58 ms | 0 / 0 / 0            | 6,422,118.4   |
| 处理器业务链 | Vext Native Normal | 4    | 24,416.73 | 268,551 | 22 / 39 ms | 0 / 0 / 0            | 8,568,459.64  |
| 处理器业务链 | Vext Native Normal | 5    | 23,839.28 | 262,240 | 23 / 41 ms | 0 / 0 / 0            | 8,366,824.73  |
| 真实中间件链 | Raw Native         | 1    | 31,360.73 | 344,956 | 18 / 28 ms | 0 / 0 / 0            | 9,720,552.73  |
| 真实中间件链 | Raw Native         | 2    | 31,723.2  | 317,249 | 18 / 24 ms | 0 / 0 / 0            | 9,835,315.2   |
| 真实中间件链 | Raw Native         | 3    | 29,296    | 292,964 | 19 / 27 ms | 0 / 0 / 0            | 9,080,832     |
| 真实中间件链 | Raw Native         | 4    | 32,063.28 | 352,670 | 18 / 24 ms | 0 / 0 / 0            | 9,938,013.1   |
| 真实中间件链 | Raw Native         | 5    | 22,700.8  | 227,007 | 17 / 41 ms | 0 / 0 / 0            | 7,036,928     |
| 真实中间件链 | Raw Fastify        | 1    | 31,073.46 | 341,826 | 18 / 27 ms | 0 / 0 / 0            | 9,664,698.19  |
| 真实中间件链 | Raw Fastify        | 2    | 30,881.46 | 339,640 | 18 / 37 ms | 0 / 0 / 0            | 9,601,954.91  |
| 真实中间件链 | Raw Fastify        | 3    | 33,772.81 | 337,652 | 17 / 21 ms | 0 / 0 / 0            | 10,500,505.6  |
| 真实中间件链 | Raw Fastify        | 4    | 31,266.4  | 312,659 | 18 / 26 ms | 0 / 0 / 0            | 9,723,084.81  |
| 真实中间件链 | Raw Fastify        | 5    | 23,807.28 | 261,865 | 16 / 35 ms | 0 / 0 / 0            | 7,403,520     |
| 真实中间件链 | Vext Native Normal | 1    | 20,668.8  | 206,684 | 25 / 48 ms | 0 / 0 / 0            | 6,406,963.2   |
| 真实中间件链 | Vext Native Normal | 2    | 22,490.91 | 247,351 | 23 / 43 ms | 0 / 0 / 0            | 6,970,461.1   |
| 真实中间件链 | Vext Native Normal | 3    | 23,930.91 | 263,242 | 22 / 40 ms | 0 / 0 / 0            | 7,419,531.64  |
| 真实中间件链 | Vext Native Normal | 4    | 22,317.82 | 245,492 | 24 / 43 ms | 0 / 0 / 0            | 6,918,702.55  |
| 真实中间件链 | Vext Native Normal | 5    | 24,361.46 | 267,962 | 23 / 37 ms | 0 / 0 / 0            | 7,551,348.37  |

<!-- enterprise-raw-diagnostics:end -->

## 正式协议

正式 runner 只有在以下条件全部满足时，才会生成可引用 artifact：

- 源码工作区干净，并在 artifact 中记录 revision；
- 主机为 Linux x64，资格 pilot 使用与正式运行相同的冻结工作负载，记录 Node.js 主版本并提出 CV 门槛，runner 会核验 runner 与每个 target 的实际 CPU 亲和性；
- 每个目标包都与运行当日核验的 npm `latest` 精确版本一致；
- 开始压测前，所有目标均通过同一套语义 conformance；
- 协议由已审阅的 pilot 冻结，然后使用 50 connections、pipelining 1、至少 10 秒预热、每次至少 30 秒测量、至少 7 轮轮转；
- 每个工作负载记录 RPS、P50/P97.5/P99、错误、超时、状态分布、CPU 时间、每 1K 请求 CPU、RSS、峰值 RSS、精确版本和 provenance。

Autocannon 8 原生报告的是 P50、P97.5 和 P99，而不是 P95。套件直接公布该 P97.5 值，不会伪造 P95 估算值。

完整正式样本以及匹配的裸路径诊断样本都会生成在本站中英文页面内；不会被替换为只跳转 GitHub 或单独 results 页的链接。

## 复现

快速本地运行仅用于实现验证：

```bash
npm ci
npm run build
npm run test:bench:enterprise -- --pilot
```

在实际 Linux x64 主机上，用与正式运行相同的工作负载形状、干净源码和不重叠 CPU 集运行资格 pilot：

```bash
taskset -c 4-7 node test/benchmark/enterprise/run-enterprise-suite.mjs \
  --qualification-pilot --load-cpus 4-7 --target-cpus 0-3
```

评审该 artifact 后，将它记录的 Node.js 主版本和批准的 CV 门槛明确冻结到 `test/benchmark/enterprise/protocols/linux-x64-v1.json`。之后才运行正式套件和与之匹配的裸路径诊断：

```bash
taskset -c 4-7 node test/benchmark/enterprise/run-enterprise-suite.mjs \
  --formal --load-cpus 4-7 --target-cpus 0-3

node --expose-gc --max-old-space-size=512 test/benchmark/run-native-fairness.mjs \
  --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 \
  --rounds 5 --max-cv 15 --process-priority 0 --handler-mode sync \
  --require-complete-matrix

npm run generate:enterprise-benchmark-docs
npm run verify:enterprise-benchmark-docs
```

生成器会拒绝本地、快速 pilot、资格 pilot、脏源码、不完整、不稳定、非 Linux 或不匹配的裸路径诊断 artifact。这既避免把方便取得的本地数字悄悄变成文档证据，也让可复现的最短路径参考位于生产形态结论旁边，而不是混进结论本身。

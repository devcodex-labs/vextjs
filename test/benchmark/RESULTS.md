# Vext Native 基准公平性报告

> UTC: 2026-08-13T10:09:41.631Z
> 源码: main@80ac6c187becd4a04be23b3a6855c8884c5f92b3 (dirty)
> 候选差异 SHA-256: cc9bb4aa0501c21665c4e5883a70f8ca277fb8343ad2224719d72060c9e5f046
> Runner: `test/benchmark/run-native-fairness.mjs`
> 参数: duration=10s, connections=50, pipelining=10, warmup=5s, rounds=5

## 口径

- Raw Native 与 Raw Fastify 对齐为同步 handler、预序列化 JSON body 与 route-only middleware-chain。
- Vext Native Core 是 benchmark 私有 direct harness：无 bootstrap global middleware，参测 route registration chain 必须为 1。
- Vext Native Normal 使用正式 bootstrap + router-loader；frontend disabled 后保留的两个 global 生命周期节点是 authContext 与 requestHook。普通 route registration chain=2（routeMatched + handler），middleware-chain=5（routeMatched + 3 route middleware + handler）。
- Core 不测试 middleware-chain，避免将 route middleware 成本混入最短路径。

## 汇总

| 场景         | Raw Native RPS | Raw Fastify RPS | Vext Core RPS | Vext Normal RPS | Core vs Raw Native | Normal vs Raw Native |
| ------------ | -------------: | --------------: | ------------: | --------------: | -----------------: | -------------------: |
| JSON 响应    |         30,440 |          26,104 |      23,270.4 |       22,137.82 |            -23.55% |              -27.27% |
| 路由参数     |         24,832 |       28,594.91 |     24,031.28 |        16,611.6 |             -3.22% |              -33.10% |
| 处理器业务链 |      23,314.19 |        26,062.4 |     19,971.28 |        19,559.2 |            -14.34% |              -16.11% |
| 真实中间件链 |       22,302.4 |          21,852 |             — |          21,160 |                  — |               -5.12% |

## 多轮样本

| 场景             | 目标               | RPS samples                                          |    Median |      Mean |    CV |  P50 |   P99 |
| ---------------- | ------------------ | ---------------------------------------------------- | --------: | --------: | ----: | ---: | ----: |
| json             | Raw Native         | 33,800.73, 32,149.6, 30,440, 29,152.8, 26,176        |    30,440 | 30,343.83 |  8.6% | 14ms |  78ms |
| json             | Raw Fastify        | 25,592, 26,104, 23,662.4, 28,745.6, 26,117.1         |    26,104 | 26,044.22 |  6.2% | 16ms |  98ms |
| json             | Vext Native Core   | 24,673.6, 23,006.4, 24,303.28, 23,270.4, 21,971.64   |  23,270.4 | 23,445.06 |  4.1% | 18ms | 100ms |
| json             | Vext Native Normal | 25,244.8, 22,137.82, 19,442.8, 18,890.8, 23,446.55   | 22,137.82 | 21,832.55 | 11.0% | 19ms |  75ms |
| params           | Raw Native         | 27,523.2, 29,732.8, 20,436.8, 23,928, 24,832         |    24,832 | 25,290.56 | 12.5% | 17ms |  95ms |
| params           | Raw Fastify        | 28,594.91, 32,272.73, 28,562.91, 27,622.4, 28,917.82 | 28,594.91 | 29,194.15 |  5.5% | 14ms | 102ms |
| params           | Vext Native Core   | 25,896, 24,031.28, 22,968, 22,592, 27,072.73         | 24,031.28 |    24,512 |  7.0% | 18ms |  70ms |
| params           | Vext Native Normal | 19,170.8, 18,213.82, 7,724.6, 6,982.4, 16,611.6      |  16,611.6 | 13,740.64 | 38.5% | 27ms |  75ms |
| chain            | Raw Native         | 23,290.8, 25,481.46, 23,314.19, 23,064, 24,425.46    | 23,314.19 | 23,915.18 |  3.8% | 18ms |  97ms |
| chain            | Raw Fastify        | 21,598.8, 26,324.8, 27,532.8, 26,062.4, 25,992       |  26,062.4 | 25,502.16 |  8.0% | 17ms |  87ms |
| chain            | Vext Native Core   | 19,971.28, 16,070.4, 21,617.6, 22,079.28, 19,746     | 19,971.28 | 19,896.91 | 10.6% | 21ms |  77ms |
| chain            | Vext Native Normal | 15,013.4, 21,576, 20,905.6, 18,994.41, 19,559.2      |  19,559.2 | 19,209.72 | 11.9% | 22ms |  60ms |
| middleware-chain | Raw Native         | 20,104.41, 22,792, 21,667.28, 23,699.2, 22,302.4     |  22,302.4 | 22,113.06 |  5.4% | 19ms |  98ms |
| middleware-chain | Raw Fastify        | 21,884.8, 20,634, 28,457.46, 21,852, 21,672          |    21,852 | 22,900.05 | 12.3% | 17ms | 131ms |
| middleware-chain | Vext Native Core   | N/A                                                  |       N/A |       N/A |   N/A |  N/A |   N/A |
| middleware-chain | Vext Native Normal | 21,662.4, 22,035.64, 20,232, 19,118.91, 21,160       |    21,160 | 20,841.79 |  5.1% | 21ms |  54ms |

## Chain telemetry

| 场景             | 模式   | global middleware | route registration chain | 状态     |
| ---------------- | ------ | ----------------: | -----------------------: | -------- |
| json             | core   |                 0 |                        1 | asserted |
| json             | normal |                 2 |                        2 | asserted |
| params           | core   |                 0 |                        1 | asserted |
| params           | normal |                 2 |                        2 | asserted |
| chain            | core   |                 0 |                        1 | asserted |
| chain            | normal |                 2 |                        2 | asserted |
| middleware-chain | normal |                 2 |                        5 | asserted |

## 环境

- Node.js: v20.20.2
- Platform: win32 x64
- CPU: Intel(R) Core(TM) i7-9700 CPU @ 3.00GHz
- Memory: 32 GiB

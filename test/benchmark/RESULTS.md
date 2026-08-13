# Vext Native 基准公平性报告

> UTC: 2026-08-13T15:35:05.568Z
> 源码: main@cea18d760592b790d602f61f343e8d71c4a35735 (clean)
> 候选差异 SHA-256: clean
> Runner: `test/benchmark/run-native-fairness.mjs`
> 参数: duration=10s, connections=50, pipelining=10, warmup=5s, rounds=5

> Handler mode: sync
> 锁定版本: Vext 1.0.1; Fastify 5.11.3; Hono 4.13.2; @hono/node-server 2.1.0; Express 5.2.1; Koa 3.2.1; @koa/router 15.7.0; route-core 0.0.7; Autocannon 8.0.0

## 口径

- `/json`、`/params`、`/chain` 与 `/health` 的四个受测对象均使用上方声明的 handler mode；Raw Fastify 在 async mode 按其公开契约返回 `reply`。
- `/middleware-chain` 保留各框架真实的 route-level middleware 调度，不用于推断 direct handler mode 的差异。
- Vext Native Core 是 benchmark 私有 direct harness：无 bootstrap global middleware，参测 route registration chain 必须为 1。
- Vext Native Normal 使用正式 bootstrap + router-loader；在 `requestContext=false` 且 frontend disabled 时，authContext 不注册，唯一全局生命周期节点为 requestHook。普通 route registration chain=2（routeMatched + handler），middleware-chain=5（routeMatched + 3 route middleware + handler）。
- Core 不测试 middleware-chain，避免将 route middleware 成本混入最短路径。

## 汇总

| 场景         | Raw Native RPS | Raw Fastify RPS | Vext Core RPS | Vext Normal RPS | Core vs Raw Native | Normal vs Raw Native |
| ------------ | -------------: | --------------: | ------------: | --------------: | -----------------: | -------------------: |
| JSON 响应    |      35,282.91 |       33,725.82 |     30,298.91 |        29,691.2 |            -14.13% |              -15.85% |
| 路由参数     |      34,072.73 |       33,205.82 |     28,611.64 |       28,066.19 |            -16.03% |              -17.63% |
| 处理器业务链 |      29,725.82 |          32,240 |        24,376 |       25,244.37 |            -18.00% |              -15.08% |
| 真实中间件链 |      28,906.91 |       28,108.37 |             — |        24,741.1 |                  — |              -14.41% |

## 多轮样本

| 场景             | 目标               | RPS samples                                           |    Median |      Mean |   CV |  P50 |  P99 |
| ---------------- | ------------------ | ----------------------------------------------------- | --------: | --------: | ---: | ---: | ---: |
| json             | Raw Native         | 33,199.28, 34,516.37, 35,620.37, 35,821.1, 35,282.91  | 35,282.91 | 34,888.01 | 2.7% | 12ms | 83ms |
| json             | Raw Fastify        | 34,674.91, 33,725.82, 32,559.28, 33,703.28, 33,912.73 | 33,725.82 |  33,715.2 | 2.0% | 13ms | 83ms |
| json             | Vext Native Core   | 30,427.2, 30,298.91, 29,227.2, 30,505.6, 30,070.4     | 30,298.91 | 30,105.86 | 1.5% | 15ms | 64ms |
| json             | Vext Native Normal | 29,691.2, 29,800, 28,988.8, 28,920, 30,090.91         |  29,691.2 | 29,498.18 | 1.6% | 15ms | 64ms |
| params           | Raw Native         | 34,122.4, 33,124.37, 34,072.73, 34,089.6, 34,069.82   | 34,072.73 | 33,895.78 | 1.1% | 13ms | 71ms |
| params           | Raw Fastify        | 35,157.1, 33,026.4, 33,119.2, 34,062.4, 33,205.82     | 33,205.82 | 33,714.18 | 2.4% | 13ms | 86ms |
| params           | Vext Native Core   | 28,544.73, 29,154.19, 28,596.8, 28,611.64, 29,953.6   | 28,611.64 | 28,972.19 | 1.9% | 15ms | 63ms |
| params           | Vext Native Normal | 28,626.19, 27,602.19, 28,066.19, 27,448, 28,268.37    | 28,066.19 | 28,002.19 | 1.5% | 16ms | 54ms |
| chain            | Raw Native         | 28,565.1, 29,725.82, 29,215.28, 30,052.8, 30,533.1    | 29,725.82 | 29,618.42 | 2.3% | 15ms | 83ms |
| chain            | Raw Fastify        | 32,311.28, 31,701.1, 32,311.28, 32,240, 31,673.46     |    32,240 | 32,047.42 | 0.9% | 14ms | 76ms |
| chain            | Vext Native Core   | 24,376, 25,285.1, 23,032, 25,126.55, 23,904.73        |    24,376 | 24,344.88 | 3.4% | 18ms | 63ms |
| chain            | Vext Native Normal | 23,336, 25,315.64, 25,328.73, 25,113.46, 25,244.37    | 25,244.37 | 24,867.64 | 3.1% | 18ms | 36ms |
| middleware-chain | Raw Native         | 28,653.82, 29,093.1, 28,435.2, 28,906.91, 29,144      | 28,906.91 | 28,846.61 | 0.9% | 16ms | 70ms |
| middleware-chain | Raw Fastify        | 30,393.6, 29,072.73, 25,164.37, 27,342.4, 28,108.37   | 28,108.37 | 28,016.29 | 6.3% | 16ms | 86ms |
| middleware-chain | Vext Native Core   | N/A                                                   |       N/A |       N/A |  N/A |  N/A |  N/A |
| middleware-chain | Vext Native Normal | 23,981.82, 24,741.1, 24,498.19, 24,787.2, 24,976      |  24,741.1 | 24,596.86 | 1.4% | 19ms | 42ms |

## Chain telemetry

| 场景             | 模式   | global middleware | route registration chain | 状态     |
| ---------------- | ------ | ----------------: | -----------------------: | -------- |
| json             | core   |                 0 |                        1 | asserted |
| json             | normal |                 1 |                        2 | asserted |
| params           | core   |                 0 |                        1 | asserted |
| params           | normal |                 1 |                        2 | asserted |
| chain            | core   |                 0 |                        1 | asserted |
| chain            | normal |                 1 |                        2 | asserted |
| middleware-chain | normal |                 1 |                        5 | asserted |

## 环境

- Node.js: v20.20.2
- Platform: win32 x64
- CPU: Intel(R) Core(TM) i7-9700 CPU @ 3.00GHz
- Memory: 32 GiB

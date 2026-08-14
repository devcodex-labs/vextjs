# Vext Native 基准公平性报告

> UTC: 2026-08-14T02:41:58.283Z
> 源码: main@e1901aa7e2ab07e01283e8f85dfad414be3235b6 (dirty)
> 候选差异 SHA-256: 5a6422172cd5488d2b95f886dfb1ec74404a96141f427ecc28e02c1d149727bc
> Runner: `test/benchmark/run-native-fairness.mjs`
> 参数: duration=10s, connections=50, pipelining=10, warmup=5s, rounds=5

> 目标调度: round-interleaved-rotating; max CV=15%

> Handler mode: sync
> Requested process priority: -14
> 锁定版本: Vext 1.0.1; Fastify 5.12.0; Hono 4.13.2; @hono/node-server 2.1.1; Express 5.2.1; Koa 3.2.1; @koa/router 15.7.0; route-core 0.0.7; Autocannon 8.0.0

> npm latest 校验: 2026-08-14T02:41:58.049Z against https://registry.npmjs.org

## 口径

- `/json`、`/params`、`/chain` 与 `/health` 的四个受测对象均使用上方声明的 handler mode；Raw Fastify 在 async mode 按其公开契约返回 `reply`。
- `/middleware-chain` 保留各框架真实的 route-level middleware 调度，不用于推断 direct handler mode 的差异。
- 每轮在 Raw Native、Raw Fastify、Vext Core、Vext Normal 之间轮转起始目标，避免同一目标连续跑完全部轮次造成时间漂移偏差。
- Vext Native Core 是 benchmark 私有 direct harness：无 bootstrap global middleware，参测 route registration chain 必须为 1。
- Vext Native Normal 使用正式 bootstrap + router-loader；在 `requestContext=false` 且 frontend disabled 时，authContext 不注册，唯一全局生命周期节点为 requestHook。普通 route registration chain=2（routeMatched + handler），middleware-chain=5（routeMatched + 3 route middleware + handler）。
- Core 不注册 route middleware chain，因此该场景显示 `N/A`；这表示不适用，不是漏测或零成本。

## 汇总

| 场景         | Raw Native RPS | Raw Fastify RPS | Vext Core RPS | Vext Normal RPS | Core vs Raw Native | Normal vs Raw Native |
| ------------ | -------------: | --------------: | ------------: | --------------: | -----------------: | -------------------: |
| JSON 响应    |      26,444.37 |       28,857.46 |      22,899.2 |          22,880 |            -13.41% |              -13.48% |
| 路由参数     |      25,894.55 |       27,785.46 |      23,740.8 |       22,828.37 |             -8.32% |              -11.84% |
| 处理器业务链 |      24,090.91 |       24,614.55 |     20,730.91 |        19,723.2 |            -13.95% |              -18.13% |
| 真实中间件链 |       24,053.1 |       24,985.46 |           N/A |       19,775.64 |                N/A |              -17.78% |

## 多轮样本

| 场景             | 目标               | RPS samples                                           |    Median |      Mean |    CV |  P50 |  P99 |
| ---------------- | ------------------ | ----------------------------------------------------- | --------: | --------: | ----: | ---: | ---: |
| json             | Raw Native         | 30,686.55, 23,928, 26,444.37, 25,562.91, 27,689.46    | 26,444.37 | 26,862.26 |  8.5% | 17ms | 27ms |
| json             | Raw Fastify        | 32,098.19, 32,970.19, 28,857.46, 26,719.28, 24,908.37 | 28,857.46 |  29,110.7 | 10.6% | 16ms | 23ms |
| json             | Vext Native Core   | 22,899.2, 21,601.6, 21,048, 23,859.64, 23,312.73      |  22,899.2 | 22,544.23 |  4.7% | 21ms | 33ms |
| json             | Vext Native Normal | 21,117.82, 21,704, 22,880, 23,017.46, 23,186.19       |    22,880 | 22,381.09 |  3.7% | 20ms | 85ms |
| params           | Raw Native         | 33,857.46, 23,525.1, 24,335.28, 25,894.55, 26,762.91  | 25,894.55 | 26,875.06 | 13.7% | 17ms | 94ms |
| params           | Raw Fastify        | 32,264, 26,495.28, 27,785.46, 26,413.82, 27,882.91    | 27,785.46 | 28,168.29 |  7.6% | 17ms | 31ms |
| params           | Vext Native Core   | 23,740.8, 23,253.1, 18,993.6, 24,025.46, 23,840.73    |  23,740.8 | 22,770.74 |  8.4% | 19ms | 33ms |
| params           | Vext Native Normal | 22,828.37, 20,449.6, 18,594.55, 23,422.4, 23,680.73   | 22,828.37 | 21,795.13 |  9.0% | 20ms | 30ms |
| chain            | Raw Native         | 29,286.55, 23,587.2, 24,090.91, 21,210.91, 24,214.55  | 24,090.91 | 24,478.02 | 10.8% | 19ms | 29ms |
| chain            | Raw Fastify        | 31,543.28, 30,970.91, 24,614.55, 23,382.55, 24,195.64 | 24,614.55 | 26,941.39 | 13.2% | 19ms | 31ms |
| chain            | Vext Native Core   | 21,802.91, 20,313.46, 20,808, 19,862.41, 20,730.91    | 20,730.91 | 20,703.54 |  3.1% | 23ms | 32ms |
| chain            | Vext Native Normal | 21,002.91, 19,874.19, 19,723.2, 19,593.46, 19,326.8   |  19,723.2 | 19,904.11 |  2.9% | 24ms | 33ms |
| middleware-chain | Raw Native         | 27,432, 24,765.82, 21,599.28, 20,028.37, 24,053.1     |  24,053.1 | 23,575.71 | 10.9% | 20ms | 27ms |
| middleware-chain | Raw Fastify        | 28,178.19, 29,129.46, 23,251.64, 21,816, 24,985.46    | 24,985.46 | 25,472.15 | 11.0% | 19ms | 25ms |
| middleware-chain | Vext Native Core   | N/A                                                   |       N/A |       N/A |   N/A |  N/A |  N/A |
| middleware-chain | Vext Native Normal | 18,522.91, 21,213.82, 20,390.55, 19,170.19, 19,775.64 | 19,775.64 | 19,814.62 |  4.7% | 24ms | 34ms |

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
- Process priority: -14

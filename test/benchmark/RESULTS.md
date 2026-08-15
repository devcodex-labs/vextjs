# Vext Adapter Matrix Benchmark

> **Audience**: Vext users choosing an HTTP adapter for the same application.
> **UTC**: 2026-08-15T00:07:37.413Z
> **Formal result**: yes (clean source required)
> **Source**: main@772d3eab9f3826a55526deaf2ad6b1c128bda446 (clean)
> **Candidate SHA-256**: clean
> **Candidate scope**: excludes this report and JSON artifacts; includes all other tracked and untracked source changes.
> **Runner**: `test/benchmark/run-adapter-matrix.mjs`
> **Protocol**: duration=10s, connections=50, pipelining=10, warmup=5s, rounds=7, handler=sync
> **Scheduling**: round-interleaved-rotating; max CV=20%

## Why this comparison

The measured decision is **which Vext adapter to use while the Vext application stays the same**. Every target uses the same routes, Normal configuration, middleware fixture, handler mode, HTTP contract, process priority, and load protocol. Only the adapter changes. Raw framework and Vext Core measurements answer maintainer diagnostics and are intentionally not used for this user-facing table.

## Results

| Scenario               | Native RPS |  Hono RPS | Fastify RPS | Express RPS |   Koa RPS |
| ---------------------- | ---------: | --------: | ----------: | ----------: | --------: |
| JSON response          |  25,085.82 | 11,158.19 |   22,191.28 |    7,651.82 | 19,017.46 |
| Route parameters       |   24,773.1 |    10,652 |   21,961.46 |    7,554.37 | 18,678.55 |
| Handler business chain |  21,802.91 |     9,387 |    18,865.6 |     7,155.2 | 16,527.64 |
| Route middleware chain |  21,584.73 |     9,383 |    18,729.1 |    7,137.64 | 16,219.64 |

## Per-scenario statistics

| Scenario         | Adapter | RPS samples                                                              |    Median |  P50 |  P99 | Errors |   CV |
| ---------------- | ------- | ------------------------------------------------------------------------ | --------: | ---: | ---: | -----: | ---: |
| json             | Native  | 25,688, 25,085.82, 25,208, 25,256, 24,720, 24,908.37, 24,882.19          | 25,085.82 | 19ms | 25ms |      0 | 1.2% |
| json             | Hono    | 11,269.46, 11,145.6, 11,156, 11,209.1, 11,214.4, 10,998.4, 11,158.19     | 11,158.19 | 43ms | 71ms |      0 | 0.7% |
| json             | Fastify | 22,609.6, 22,004.8, 22,227.64, 22,191.28, 21,988.8, 22,170.91, 22,329.6  | 22,191.28 | 22ms | 27ms |      0 | 0.9% |
| json             | Express | 7,668.8, 7,657.64, 7,635.6, 7,651.82, 7,677.64, 7,610.37, 7,636.19       |  7,651.82 | 64ms | 78ms |      0 | 0.3% |
| json             | Koa     | 19,080, 19,008.73, 19,257.46, 18,901.1, 19,017.46, 18,864, 19,206.55     | 19,017.46 | 25ms | 32ms |      0 | 0.7% |
| params           | Native  | 24,690.19, 24,688, 24,938.91, 25,001.46, 24,773.1, 24,784.73, 24,419.64  |  24,773.1 | 19ms | 26ms |      0 | 0.7% |
| params           | Hono    | 10,735.64, 10,555.28, 10,652, 10,564.73, 10,725.46, 10,541.46, 10,668.73 |    10,652 | 46ms | 77ms |      0 | 0.7% |
| params           | Fastify | 21,961.46, 21,808, 21,654.4, 22,191.28, 22,123.2, 22,031.28, 21,868.8    | 21,961.46 | 22ms | 28ms |      0 | 0.8% |
| params           | Express | 7,572.8, 7,572.91, 7,518, 7,554.37, 7,507.82, 7,567.46, 7,553.28         |  7,554.37 | 65ms | 86ms |      0 | 0.3% |
| params           | Koa     | 18,960.41, 18,535.64, 18,687.28, 18,348, 18,707.64, 18,625.2, 18,678.55  | 18,678.55 | 25ms | 31ms |      0 | 0.9% |
| chain            | Native  | 21,933.82, 22,182.4, 22,205.82, 21,493.1, 21,670.55, 21,802.91, 21,582.4 | 21,802.91 | 22ms | 28ms |      0 | 1.2% |
| chain            | Hono    | 9,404.21, 9,437, 9,313.8, 9,495.4, 9,276.21, 9,331.46, 9,387             |     9,387 | 52ms | 88ms |      0 | 0.8% |
| chain            | Fastify | 18,973.82, 18,865.6, 19,245.82, 18,819.2, 19,152, 18,590, 18,853.2       |  18,865.6 | 25ms | 31ms |      0 | 1.1% |
| chain            | Express | 7,130.73, 7,159.1, 7,150.8, 7,152.4, 7,194.4, 7,155.2, 7,164.4           |   7,155.2 | 69ms | 91ms |      0 | 0.2% |
| chain            | Koa     | 16,711.6, 16,630.8, 16,662.8, 16,527.64, 16,469.6, 16,524, 16,351.64     | 16,527.64 | 29ms | 38ms |      0 | 0.7% |
| middleware-chain | Native  | 21,670.55, 21,548.37, 21,654.4, 21,584.73, 21,545.46, 21,513.6, 21,957.1 | 21,584.73 | 22ms | 28ms |      0 | 0.6% |
| middleware-chain | Hono    | 9,401.4, 9,203.4, 9,389.64, 9,204.21, 9,397.4, 9,224.21, 9,383           |     9,383 | 51ms | 88ms |      0 | 1.0% |
| middleware-chain | Fastify | 18,635.28, 18,576.41, 18,729.1, 18,825.46, 18,776, 18,462.91, 18,806.55  |  18,729.1 | 25ms | 32ms |      0 | 0.7% |
| middleware-chain | Express | 7,418.4, 7,117.64, 7,137.64, 7,159.46, 7,114, 7,156.4, 7,126             |  7,137.64 | 69ms | 90ms |      0 | 1.4% |
| middleware-chain | Koa     | 16,374.91, 16,171.28, 16,281.1, 16,132, 16,358.19, 16,219.64, 16,080     | 16,219.64 | 29ms | 40ms |      0 | 0.6% |

## Normal chain telemetry

| Scenario         | Adapter | Global middleware | Route registration chain | Status   |
| ---------------- | ------- | ----------------: | -----------------------: | -------- |
| json             | Native  |                 1 |                        2 | asserted |
| json             | Hono    |                 1 |                        2 | asserted |
| json             | Fastify |                 1 |                        2 | asserted |
| json             | Express |                 1 |                        2 | asserted |
| json             | Koa     |                 1 |                        2 | asserted |
| params           | Native  |                 1 |                        2 | asserted |
| params           | Hono    |                 1 |                        2 | asserted |
| params           | Fastify |                 1 |                        2 | asserted |
| params           | Express |                 1 |                        2 | asserted |
| params           | Koa     |                 1 |                        2 | asserted |
| chain            | Native  |                 1 |                        2 | asserted |
| chain            | Hono    |                 1 |                        2 | asserted |
| chain            | Fastify |                 1 |                        2 | asserted |
| chain            | Express |                 1 |                        2 | asserted |
| chain            | Koa     |                 1 |                        2 | asserted |
| middleware-chain | Native  |                 1 |                        5 | asserted |
| middleware-chain | Hono    |                 1 |                        5 | asserted |
| middleware-chain | Fastify |                 1 |                        5 | asserted |
| middleware-chain | Express |                 1 |                        5 | asserted |
| middleware-chain | Koa     |                 1 |                        5 | asserted |

## Validity and limits

- All five targets are alive before a scenario is measured. Each round rotates its first target; the median is reported and a CV over the declared threshold rejects the artifact.
- The fixture explicitly disables optional request features not used by these GET scenarios. This is a light Normal Vext workload, not an all-features production workload or a database/I/O benchmark.
- Results rank no overall winner across different scenarios. Use the numbers with your required integrations, migration constraints, P95/P99, and a representative production workload.
- Latest dependency versions are verified against the npm registry before the run; the exact locked versions and source identity are recorded below.

## Environment

- Node.js: v20.20.2
- Platform: win32 x64
- CPU: Intel(R) Core(TM) i7-9700 CPU @ 3.00GHz
- Memory: 32 GiB
- Process priority: 0
- Dependencies: Vext 1.0.1; Hono 4.13.2; @hono/node-server 2.1.1; Fastify 5.12.0; Express 5.2.1; Koa 3.2.1; @koa/router 15.7.0; Autocannon 8.0.0
- npm latest verification: 2026-08-14T23:36:04.874Z against https://registry.npmjs.org

# Vext Adapter Matrix Benchmark

> **Audience**: Vext users choosing an HTTP adapter for the same application.
> **UTC**: 2026-08-14T16:03:33.389Z
> **Source**: main@9bbc314785bf9085643cabea1978bf05f7a176fa (dirty)
> **Candidate SHA-256**: 4c12a8838117a1bb869b39dd6d4b03b5844d8434263e3768a7ef4be0be9a5302
> **Candidate scope**: excludes this report and JSON artifacts; includes all other tracked and untracked source changes.
> **Runner**: `test/benchmark/run-adapter-matrix.mjs`
> **Protocol**: duration=10s, connections=50, pipelining=10, warmup=5s, rounds=7, handler=sync
> **Scheduling**: round-interleaved-rotating; max CV=20%

## Why this comparison

The measured decision is **which Vext adapter to use while the Vext application stays the same**. Every target uses the same routes, Normal configuration, middleware fixture, handler mode, HTTP contract, process priority, and load protocol. Only the adapter changes. Raw framework and Vext Core measurements answer maintainer diagnostics and are intentionally not used for this user-facing table.

## Results

| Scenario               | Native RPS |  Hono RPS | Fastify RPS | Express RPS |  Koa RPS |
| ---------------------- | ---------: | --------: | ----------: | ----------: | -------: |
| JSON response          |  24,508.37 |  10,690.4 |    21,445.1 |    7,276.91 | 18,247.6 |
| Route parameters       |     23,992 | 10,274.55 |   21,120.73 |    7,246.73 | 17,918.8 |
| Handler business chain |   21,566.4 |  9,282.37 |   19,086.41 |    7,064.91 | 16,466.8 |
| Route middleware chain |   21,243.2 |  9,258.73 |      18,536 |       7,062 |   15,972 |

## Per-scenario statistics

| Scenario         | Adapter | RPS samples                                                                |    Median |  P50 |  P99 | Errors |   CV |
| ---------------- | ------- | -------------------------------------------------------------------------- | --------: | ---: | ---: | -----: | ---: |
| json             | Native  | 24,508.37, 24,569.46, 24,497.6, 24,230.55, 24,329.46, 24,669.82, 24,666.91 | 24,508.37 | 19ms | 31ms |      0 | 0.6% |
| json             | Hono    | 10,578.4, 10,590.91, 10,701.46, 10,509.46, 10,690.4, 10,994.4, 10,996      |  10,690.4 | 45ms | 71ms |      0 | 1.7% |
| json             | Fastify | 21,291.2, 21,338.91, 21,445.1, 21,421.82, 21,478.55, 21,571.64, 21,715.2   |  21,445.1 | 22ms | 29ms |      0 | 0.6% |
| json             | Express | 7,263.1, 7,314.73, 7,186.8, 7,276.91, 7,412.4, 7,139.82, 7,606             |  7,276.91 | 67ms | 84ms |      0 | 2.0% |
| json             | Koa     | 18,449.82, 17,810.8, 18,409.82, 18,071.64, 17,781.82, 18,247.6, 18,575.28  |  18,247.6 | 26ms | 36ms |      0 | 1.6% |
| params           | Native  | 24,095.28, 23,992, 23,414.4, 23,873.6, 23,906.19, 24,049.6, 24,257.6       |    23,992 | 19ms | 27ms |      0 | 1.0% |
| params           | Hono    | 10,496.8, 10,323.21, 10,193.1, 10,199.64, 10,274.55, 10,137.6, 10,441.1    | 10,274.55 | 47ms | 72ms |      0 | 1.2% |
| params           | Fastify | 21,081.6, 20,864.73, 21,365.1, 21,073.6, 21,452.8, 21,360, 21,120.73       | 21,120.73 | 22ms | 34ms |      0 | 0.9% |
| params           | Express | 7,372, 7,212.19, 7,246.73, 7,160.4, 7,102.4, 7,249.2, 7,395.46             |  7,246.73 | 67ms | 95ms |      0 | 1.4% |
| params           | Koa     | 18,408.41, 17,824.41, 18,206.8, 17,918.8, 17,835.2, 17,696.41, 18,695.6    |  17,918.8 | 27ms | 36ms |      0 | 1.9% |
| chain            | Native  | 22,124.37, 21,365.1, 22,111.28, 21,496, 21,464, 21,566.4, 21,789.82        |  21,566.4 | 22ms | 28ms |      0 | 1.3% |
| chain            | Hono    | 9,602.21, 9,235.1, 9,481, 9,379.4, 9,165, 9,282.37, 8,945.4                |  9,282.37 | 52ms | 83ms |      0 | 2.1% |
| chain            | Fastify | 19,283.64, 19,000, 19,308.37, 18,758.41, 18,579.64, 19,320, 19,086.41      | 19,086.41 | 25ms | 32ms |      0 | 1.4% |
| chain            | Express | 7,057.6, 6,980.91, 7,163.2, 7,080.4, 7,017.6, 7,064.91, 7,155.2            |  7,064.91 | 69ms | 87ms |      0 | 0.9% |
| chain            | Koa     | 16,554.8, 15,991.2, 16,428, 16,033.6, 16,595.28, 16,466.8, 16,466.8        |  16,466.8 | 29ms | 41ms |      0 | 1.4% |
| middleware-chain | Native  | 21,014.55, 21,628.37, 21,243.2, 21,171.64, 20,969.46, 21,290.91, 21,262.4  |  21,243.2 | 22ms | 29ms |      0 | 0.9% |
| middleware-chain | Hono    | 9,267.1, 9,397.28, 9,345.8, 9,258.73, 9,146.6, 9,047, 9,121.64             |  9,258.73 | 52ms | 85ms |      0 | 1.3% |
| middleware-chain | Fastify | 18,285.46, 18,740.8, 18,720.37, 18,305.82, 18,562, 18,536, 18,206.19       |    18,536 | 25ms | 34ms |      0 | 1.1% |
| middleware-chain | Express | 7,225.64, 7,074, 7,062, 6,859.1, 7,071.2, 6,955.6, 6,994                   |     7,062 | 70ms | 89ms |      0 | 1.5% |
| middleware-chain | Koa     | 15,860.4, 15,785.82, 16,022, 15,649.82, 15,972, 16,024, 16,137.82          |    15,972 | 30ms | 42ms |      0 | 1.0% |

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
- Dependencies: Vext 1.0.1; Hono 4.13.2; Fastify 5.12.0; Express 5.2.1; Koa 3.2.1; @koa/router 15.7.0; Autocannon 8.0.0
- npm latest verification: 2026-08-14T15:32:13.294Z against https://registry.npmjs.org

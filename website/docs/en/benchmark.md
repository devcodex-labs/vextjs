# Performance benchmarks

These benchmarks help you choose a Vext HTTP adapter. They keep the Vext application fixed and compare the five supported adapters under the same light Normal workload. They are an input to adapter selection—not a substitute for load-testing your application with its real middleware, authentication, logging, database access, and deployment topology.

## At a glance

- **This is an adapter comparison, not a cross-framework league table.** Each row runs the same Vext routes, Normal bootstrap, handler mode, HTTP contract, middleware fixture, and load protocol; only the adapter changes.
- **Native has the highest throughput in this host and workload.** That is a local observation, not a claim that it is universally best.
- **Fastify and Koa are the next fastest adapters in this sample; Hono and Express trade throughput for their own programming and ecosystem choices.** Use the detailed CV and latency data before treating small differences as meaningful.
- **Choose for integration and migration needs first, then reproduce with your workload.** Native is the dependency-light default. Select Fastify, Express, Koa, or Hono when their ecosystem is the better fit.

<!-- benchmark-results:start -->

## Current results

This formal run was recorded at **2026-08-15T00:07:37.413Z** from clean Vext source `main@772d3eab9f3826a55526deaf2ad6b1c128bda446` (Vext 1.0.1; Node.js v20.20.2). Every value is the median requests per second from **7** rounds; higher is better for that scenario.

| Scenario               |    Native |      Hono |   Fastify |  Express |       Koa |
| ---------------------- | --------: | --------: | --------: | -------: | --------: |
| JSON response          | 25,085.82 | 11,158.19 | 22,191.28 | 7,651.82 | 19,017.46 |
| Route parameters       |  24,773.1 |    10,652 | 21,961.46 | 7,554.37 | 18,678.55 |
| Handler business chain | 21,802.91 |     9,387 |  18,865.6 |  7,155.2 | 16,527.64 |
| Route middleware chain | 21,584.73 |     9,383 |  18,729.1 | 7,137.64 | 16,219.64 |

All 20 adapter/scenario measurements completed with zero errors, timeouts, and non-2xx responses. Per-scenario CV ranged from 0.2%–1.4%. The full per-round sample, P50/P99, exact versions, provenance, and route-lifecycle telemetry appear below on this page.

<!-- benchmark-results:end -->

## Why this comparison

The user-facing choice is **which Vext adapter to use**, so every target runs the same Vext Normal application. The routes, `defineRoutes()` loading, route matching, request/response objects, middleware fixture, handler mode, response contract, process priority, and Autocannon protocol are fixed. Only the adapter changes.

The fixture deliberately turns off optional request features that these GET scenarios do not use: access logging, generated request IDs, CORS, rate limiting, response wrapping, body parsing, request context, session, CSRF, security headers, frontend rendering, and application logging. It retains the Normal bootstrap and route lifecycle. This makes the comparison focused and repeatable; it is not an all-features production or database/I/O benchmark.

Raw-framework and shortest-path measurements remain maintainer diagnostics. They answer a different question and are intentionally not used to rank adapters on this page.

### Choosing an adapter

| Need                                                    | Suggested starting point | Check before committing                                                                                    |
| ------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| A new project with fewer HTTP framework dependencies    | Native (default)         | Measure the real workload against your latency and throughput targets                                      |
| A requirement for Fastify-related capabilities          | Fastify                  | Vext middleware and native framework middleware have different signatures; verify the integration boundary |
| An Express or Koa migration and existing team expertise | Matching adapter         | Validate how existing middleware will be adapted instead of choosing by overhead percentage alone          |
| Hono or Web Standards style in a Node.js service        | Hono                     | This is a Node.js adapter, not an Edge-runtime guarantee; measure any bridge-sensitive workload            |

See the [Adapter guide](/guide/adapters) for installation and configuration details.

## Methodology

| Item         | Current formal sample                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Environment  | Node.js 20.20.2, Windows x64, Intel i7-9700, 32 GiB RAM                                                                  |
| Load         | 50 connections, pipelining 10, 10 seconds per measurement                                                                |
| Stability    | 5-second warmup, median of 7 rounds, rotating round order, CV ≤ 20%                                                      |
| Processes    | The runner and measured child processes use the same normal priority, 0                                                  |
| Dependencies | Fastify 5.12.0, Hono 4.13.2, `@hono/node-server` 2.1.1, Express 5.2.1, Koa 3.2.1, `@koa/router` 15.7.0, Autocannon 8.0.0 |

Before a formal run, the runner checks these dependencies against npm `latest` for that date. It refuses citable output when versions or source identity drift, or when any response is non-2xx, a connection fails or times out, a result is missing, or the CV gate fails. Targets are interleaved by round to reduce time drift that would otherwise consistently favor one implementation.

<!-- benchmark-details:start -->

<!-- Generated by npm run generate:benchmark-docs; do not edit manually. -->

## Full formal sample

This complete formal sample is generated from the same artifact as the current-result summary above. It remains on this page so the conclusion, method, and every measurement can be reviewed together.

### Run identity

| Field             | Value                                                                            |
| ----------------- | -------------------------------------------------------------------------------- |
| Recorded at (UTC) | 2026-08-15T00:07:37.413Z                                                         |
| Source revision   | `main@772d3eab9f3826a55526deaf2ad6b1c128bda446`                                  |
| Source state      | clean (required for formal publication)                                          |
| Vext              | 1.0.1                                                                            |
| Node.js           | v20.20.2                                                                         |
| Protocol          | 10s × 7 rounds; 50 connections; pipelining 10; 5s warmup; sync handler; CV ≤ 20% |

### Scenarios

| Path                | Scenario               | What it exercises                                           |
| ------------------- | ---------------------- | ----------------------------------------------------------- |
| `/json`             | JSON response          | Route matching and JSON serialization.                      |
| `/users/42`         | Route parameters       | Dynamic route matching and parameter extraction.            |
| `/chain`            | Handler business chain | Three layers of handler business logic and a JSON response. |
| `/middleware-chain` | Route middleware chain | Three route-level middleware layers and a JSON response.    |

### Every measured sample

| Scenario               | Adapter | RPS samples (every round)                                                |    Median |   P50 |   P99 | Errors / timeouts / non-2xx |   CV |
| ---------------------- | ------- | ------------------------------------------------------------------------ | --------: | ----: | ----: | --------------------------: | ---: |
| JSON response          | Native  | 25,688, 25,085.82, 25,208, 25,256, 24,720, 24,908.37, 24,882.19          | 25,085.82 | 19 ms | 25 ms |                   0 / 0 / 0 | 1.2% |
| JSON response          | Hono    | 11,269.46, 11,145.6, 11,156, 11,209.1, 11,214.4, 10,998.4, 11,158.19     | 11,158.19 | 43 ms | 71 ms |                   0 / 0 / 0 | 0.7% |
| JSON response          | Fastify | 22,609.6, 22,004.8, 22,227.64, 22,191.28, 21,988.8, 22,170.91, 22,329.6  | 22,191.28 | 22 ms | 27 ms |                   0 / 0 / 0 | 0.9% |
| JSON response          | Express | 7,668.8, 7,657.64, 7,635.6, 7,651.82, 7,677.64, 7,610.37, 7,636.19       |  7,651.82 | 64 ms | 78 ms |                   0 / 0 / 0 | 0.3% |
| JSON response          | Koa     | 19,080, 19,008.73, 19,257.46, 18,901.1, 19,017.46, 18,864, 19,206.55     | 19,017.46 | 25 ms | 32 ms |                   0 / 0 / 0 | 0.7% |
| Route parameters       | Native  | 24,690.19, 24,688, 24,938.91, 25,001.46, 24,773.1, 24,784.73, 24,419.64  |  24,773.1 | 19 ms | 26 ms |                   0 / 0 / 0 | 0.7% |
| Route parameters       | Hono    | 10,735.64, 10,555.28, 10,652, 10,564.73, 10,725.46, 10,541.46, 10,668.73 |    10,652 | 46 ms | 77 ms |                   0 / 0 / 0 | 0.7% |
| Route parameters       | Fastify | 21,961.46, 21,808, 21,654.4, 22,191.28, 22,123.2, 22,031.28, 21,868.8    | 21,961.46 | 22 ms | 28 ms |                   0 / 0 / 0 | 0.8% |
| Route parameters       | Express | 7,572.8, 7,572.91, 7,518, 7,554.37, 7,507.82, 7,567.46, 7,553.28         |  7,554.37 | 65 ms | 86 ms |                   0 / 0 / 0 | 0.3% |
| Route parameters       | Koa     | 18,960.41, 18,535.64, 18,687.28, 18,348, 18,707.64, 18,625.2, 18,678.55  | 18,678.55 | 25 ms | 31 ms |                   0 / 0 / 0 | 0.9% |
| Handler business chain | Native  | 21,933.82, 22,182.4, 22,205.82, 21,493.1, 21,670.55, 21,802.91, 21,582.4 | 21,802.91 | 22 ms | 28 ms |                   0 / 0 / 0 | 1.2% |
| Handler business chain | Hono    | 9,404.21, 9,437, 9,313.8, 9,495.4, 9,276.21, 9,331.46, 9,387             |     9,387 | 52 ms | 88 ms |                   0 / 0 / 0 | 0.8% |
| Handler business chain | Fastify | 18,973.82, 18,865.6, 19,245.82, 18,819.2, 19,152, 18,590, 18,853.2       |  18,865.6 | 25 ms | 31 ms |                   0 / 0 / 0 | 1.1% |
| Handler business chain | Express | 7,130.73, 7,159.1, 7,150.8, 7,152.4, 7,194.4, 7,155.2, 7,164.4           |   7,155.2 | 69 ms | 91 ms |                   0 / 0 / 0 | 0.2% |
| Handler business chain | Koa     | 16,711.6, 16,630.8, 16,662.8, 16,527.64, 16,469.6, 16,524, 16,351.64     | 16,527.64 | 29 ms | 38 ms |                   0 / 0 / 0 | 0.7% |
| Route middleware chain | Native  | 21,670.55, 21,548.37, 21,654.4, 21,584.73, 21,545.46, 21,513.6, 21,957.1 | 21,584.73 | 22 ms | 28 ms |                   0 / 0 / 0 | 0.6% |
| Route middleware chain | Hono    | 9,401.4, 9,203.4, 9,389.64, 9,204.21, 9,397.4, 9,224.21, 9,383           |     9,383 | 51 ms | 88 ms |                   0 / 0 / 0 | 1.0% |
| Route middleware chain | Fastify | 18,635.28, 18,576.41, 18,729.1, 18,825.46, 18,776, 18,462.91, 18,806.55  |  18,729.1 | 25 ms | 32 ms |                   0 / 0 / 0 | 0.7% |
| Route middleware chain | Express | 7,418.4, 7,117.64, 7,137.64, 7,159.46, 7,114, 7,156.4, 7,126             |  7,137.64 | 69 ms | 90 ms |                   0 / 0 / 0 | 1.4% |
| Route middleware chain | Koa     | 16,374.91, 16,171.28, 16,281.1, 16,132, 16,358.19, 16,219.64, 16,080     | 16,219.64 | 29 ms | 40 ms |                   0 / 0 / 0 | 0.6% |

### Normal route-lifecycle telemetry

| Scenario               | Adapter | Global middleware | Route registration chain | Status   |
| ---------------------- | ------- | ----------------: | -----------------------: | -------- |
| JSON response          | Native  |                 1 |                        2 | asserted |
| JSON response          | Hono    |                 1 |                        2 | asserted |
| JSON response          | Fastify |                 1 |                        2 | asserted |
| JSON response          | Express |                 1 |                        2 | asserted |
| JSON response          | Koa     |                 1 |                        2 | asserted |
| Route parameters       | Native  |                 1 |                        2 | asserted |
| Route parameters       | Hono    |                 1 |                        2 | asserted |
| Route parameters       | Fastify |                 1 |                        2 | asserted |
| Route parameters       | Express |                 1 |                        2 | asserted |
| Route parameters       | Koa     |                 1 |                        2 | asserted |
| Handler business chain | Native  |                 1 |                        2 | asserted |
| Handler business chain | Hono    |                 1 |                        2 | asserted |
| Handler business chain | Fastify |                 1 |                        2 | asserted |
| Handler business chain | Express |                 1 |                        2 | asserted |
| Handler business chain | Koa     |                 1 |                        2 | asserted |
| Route middleware chain | Native  |                 1 |                        5 | asserted |
| Route middleware chain | Hono    |                 1 |                        5 | asserted |
| Route middleware chain | Fastify |                 1 |                        5 | asserted |
| Route middleware chain | Express |                 1 |                        5 | asserted |
| Route middleware chain | Koa     |                 1 |                        5 | asserted |

### Exact environment and versions

| Item                    | Exact value                                           |
| ----------------------- | ----------------------------------------------------- |
| Platform                | win32 x64                                             |
| CPU                     | Intel(R) Core(TM) i7-9700 CPU @ 3.00GHz               |
| Memory                  | 32 GiB                                                |
| Process priority        | 0                                                     |
| Vext                    | 1.0.1                                                 |
| Hono                    | 4.13.2                                                |
| @hono/node-server       | 2.1.1                                                 |
| Fastify                 | 5.12.0                                                |
| Express                 | 5.2.1                                                 |
| Koa                     | 3.2.1                                                 |
| @koa/router             | 15.7.0                                                |
| Autocannon              | 8.0.0                                                 |
| npm latest verification | 2026-08-14T23:36:04.874Z (https://registry.npmjs.org) |

<!-- benchmark-details:end -->

## Reproduce the results

Install the lockfile and confirm that the benchmark dependencies still match npm `latest`:

```bash
npm ci
npm run verify:benchmark-deps
```

Run the public adapter comparison with the same protocol used on this page:

```bash
node --expose-gc --max-old-space-size=512 test/benchmark/run-adapter-matrix.mjs --formal --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 7 --max-cv 20 --process-priority 0 --handler-mode sync
```

This sample uses synchronous handlers. If your platform or permissions require a different priority, choose an available value and treat the result as a new environment baseline rather than comparing absolute numbers with this page.

The runner uses the local Autocannon **programmatic API** and starts and stops its targets automatically. This page includes every sample, P50/P99, exact versions, provenance, and route-lifecycle telemetry. See the [benchmark README](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md) for all runner options and artifact merge rules.

### Test your application

A framework microbenchmark answers only “what does the core HTTP path cost?” Before production, run a workload that includes at least:

1. your authentication, logging, response wrapping, and middleware;
2. real or controlled substitutes for databases, caches, and external APIs;
3. warmup, multiple rounds, throughput, P95/P99 latency, error rate, and resource use;
4. the production Node.js version, process count, container limits, and reverse proxy.

## Limitations

- The current results come from one Windows host; they do not represent Linux, containers, or cloud platforms.
- These are small HTTP microbenchmarks. They do not measure developer experience, plugin quality, maintainability, or complete business latency.
- Do not combine absolute values from different dates, machines, dependency versions, handler modes, or load protocols into one ranking.
- The table compares Vext adapters only. Raw and shortest-path diagnostics are maintained separately and are not user-facing adapter rankings.

## Related links

- [Benchmark reproduction guide](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md)
- [Adapter selection and configuration](/guide/adapters)
- [Production deployment](/guide/deployment)
- [Configuration reference](/api/config)

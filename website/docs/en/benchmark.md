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

All 20 adapter/scenario measurements completed with zero errors, timeouts, and non-2xx responses. Per-scenario CV ranged from 0.2%–1.4%. [Read the full in-document results and every sample](/benchmark/results.html), including P50/P99, exact versions, provenance, and route-lifecycle telemetry.

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

The runner uses the local Autocannon **programmatic API** and starts and stops its targets automatically. The [full in-document results](/benchmark/results.html) include every sample, P50/P99, exact versions, provenance, and route-lifecycle telemetry. See the [benchmark README](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md) for all runner options and artifact merge rules.

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

- [Results and all samples](/benchmark/results.html)
- [Benchmark reproduction guide](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md)
- [Adapter selection and configuration](/guide/adapters)
- [Production deployment](/guide/deployment)
- [Configuration reference](/api/config)

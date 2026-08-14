# Performance benchmarks

These benchmarks show the framework overhead of VextJS on small HTTP workloads and compare Native with Fastify under matching scenarios. Use them as an initial input to framework and adapter selection—not as a substitute for load-testing your application with its real middleware, authentication, logging, database access, and deployment topology.

## At a glance

- **There is no overall winner across every scenario.** Raw Fastify leads all four synchronous-handler scenarios. With asynchronous handlers, Raw Native leads JSON, route parameters, and the handler business chain, while Raw Fastify leads the route-middleware chain.
- **Vext Native Normal represents the supported framework path.** In the synchronous group it trails Raw Native by 11.8%–18.1% and Raw Fastify by 17.8%–20.8%. The corresponding asynchronous ranges are 17.2%–32.0% and 20.0%–30.5%.
- **The results do not mean “Fastify is always fastest” or “Vext ranks second.”** The leader changes with the workload, handler shape, and underlying adapter.
- **Choose an adapter for capabilities and migration cost first.** Native is the default path with no third-party HTTP framework dependency. Choose Fastify, Express, Koa, or Hono when you need their specific integration surface, then measure your own workload.

## Current results

The following results were collected on **August 14, 2026**. Every value is the median requests per second from five rounds; higher is better for that specific scenario.

### Synchronous handlers

| Scenario               | Raw Native | Raw Fastify | Vext Native Normal |
| ---------------------- | ---------: | ----------: | -----------------: |
| JSON                   |     26,444 |      28,857 |             22,880 |
| Route parameters       |     25,895 |      27,785 |             22,828 |
| Handler business chain |     24,091 |      24,615 |             19,723 |
| Route middleware chain |     24,053 |      24,985 |             19,776 |

### Asynchronous handlers

| Scenario               | Raw Native | Raw Fastify | Vext Native Normal |
| ---------------------- | ---------: | ----------: | -----------------: |
| JSON                   |     33,351 |      28,782 |             22,856 |
| Route parameters       |     34,193 |      32,300 |             23,244 |
| Handler business chain |     30,088 |      26,185 |             20,940 |
| Route middleware chain |     25,236 |      30,085 |             20,903 |

The synchronous and asynchronous groups were sampled at different times. Compare implementations within each table; do not use absolute values across the two tables to claim that one handler style is faster.

See the [raw results](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/RESULTS.md) for all rounds, CV, P50/P99 latency, source identity, and lifecycle telemetry.

## What the gap includes

`Raw Native` and `Raw Fastify` use their underlying APIs directly. `Vext Native Normal` uses Vext's production bootstrap, router loader, route matching, request/response objects, and lifecycle. To align the core workload, the fixture disables optional request features that are not required by the scenarios:

- access logging, request IDs, CORS, and rate limiting;
- response wrapping, body parsing, and request context;
- session, CSRF, security headers, and frontend support, which are disabled by default or explicitly disabled in the fixture;
- application logging, which is set to `silent`.

The Normal-versus-Raw gap therefore reflects Vext routing, request/response abstraction, and lifecycle cost in this reduced workload. It is neither an all-features production result nor a complete application benchmark with I/O.

### Why Core shows `N/A` in the raw report

Core is an internal diagnostic entry used to isolate Vext's shortest execution path. It bypasses the production bootstrap and is not a runtime mode users can select.

| Core diagnostic scenario | Sync | Async |
| ------------------------ | ---: | ----: |
| Route middleware chain   |  N/A |   N/A |

`N/A` means “not applicable.” Core does not register a route middleware chain, so that scenario cannot run there. It is neither missing data nor a zero-cost measurement. Use Normal when evaluating Vext as a product.

## Adapter comparison

The table below reports Vext throughput relative to each adapter's matching Raw implementation under one protocol. A negative value means Vext was lower in that pair. It measures the **combined Vext-and-adapter overhead**; rows are not an overall framework ranking.

| Adapter |   JSON | Route parameters | Handler business chain | Route middleware chain |
| ------- | -----: | ---------------: | ---------------------: | ---------------------: |
| Native  | -31.6% |           -29.6% |                 -29.4% |                 -27.6% |
| Fastify | -43.0% |           -41.7% |                 -38.3% |                 -39.1% |
| Express |  -9.4% |            -2.6% |                  -7.4% |                 -12.7% |
| Koa     | -31.4% |           -33.3% |                 -37.4% |                 -34.2% |
| Hono    | -69.1% |           -68.6% |                 -67.0% |                 -67.9% |

Express having a smaller percentage gap does not mean it has the highest absolute throughput; every percentage depends on its own Raw baseline. The Hono gap includes Vext's `node:http` bridge: Raw Hono uses the official `@hono/node-server`, while the Vext Hono adapter depends only on `hono`. Both are supported public paths, but they do not use the same server wrapper.

### Choosing an adapter

| Need                                                    | Suggested starting point | Check before committing                                                                                    |
| ------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| A new project with fewer HTTP framework dependencies    | Native (default)         | Measure the real workload against your latency and throughput targets                                      |
| A requirement for Fastify-related capabilities          | Fastify                  | Vext middleware and native framework middleware have different signatures; verify the integration boundary |
| An Express or Koa migration and existing team expertise | Matching adapter         | Validate how existing middleware will be adapted instead of choosing by overhead percentage alone          |
| Hono or Web Standards style in a Node.js service        | Hono                     | This is a Node.js adapter, not an Edge-runtime guarantee; the current bridge overhead is substantial       |

See the [Adapter guide](/guide/adapters) for installation and configuration details.

## Methodology

| Item         | Current formal sample                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Environment  | Node.js 20.20.2, Windows x64, Intel i7-9700, 32 GiB RAM                                                                  |
| Load         | 50 connections, pipelining 10, 10 seconds per round                                                                      |
| Stability    | 5-second warmup, median of 5 rounds, round-interleaved targets, CV ≤ 15%                                                 |
| Processes    | The runner and measured child processes use the same priority, -14                                                       |
| Dependencies | Fastify 5.12.0, Hono 4.13.2, `@hono/node-server` 2.1.1, Express 5.2.1, Koa 3.2.1, `@koa/router` 15.7.0, Autocannon 8.0.0 |

Before a formal run, the runner checks these dependencies against npm `latest` for that date. It refuses citable output when versions or source identity drift, or when any response is non-2xx, a connection fails or times out, a result is missing, or the CV gate fails. Targets are interleaved by round to reduce time drift that would otherwise consistently favor one implementation.

## Reproduce the results

Install the lockfile and confirm that the benchmark dependencies still match npm `latest`:

```bash
npm ci
npm run verify:benchmark-deps
```

Run the synchronous primary comparison with the same protocol used on this page:

```bash
node --expose-gc --max-old-space-size=512 test/benchmark/run-native-fairness.mjs --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5 --max-cv 15 --process-priority -14 --handler-mode sync
```

Change the final option to `--handler-mode async` for the asynchronous group. `--process-priority -14` is part of this Windows sample. If your platform or permissions do not support it, choose an available value and treat the result as a new environment baseline rather than comparing the absolute number with this page.

The runner uses the local Autocannon **programmatic API** and starts and stops its targets automatically. See the [benchmark README](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md) for all options, the adapter-matrix command, and artifact merge rules.

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
- The adapter matrix and the Native/Fastify primary comparison answer different questions: one observes combined adapter overhead, while the other provides a stricter scenario-matched comparison.

## Related links

- [Raw results and all samples](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/RESULTS.md)
- [Benchmark reproduction guide](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md)
- [Adapter selection and configuration](/guide/adapters)
- [Production deployment](/guide/deployment)
- [Configuration reference](/api/config)

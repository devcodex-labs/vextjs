# Performance benchmark test

This page compares VextJS with other popular Node.js web frameworks. The current reproducible evidence comes from `test/benchmark/run-native-fairness.mjs` (the primary Native/Fastify comparison) and `test/benchmark/run-benchmark.mjs` (the auxiliary adapter matrix); historical benchmark-repository data below is trend reference only.

## Current reproducible results (2026-08-14, local time)

> - **Source identity:** the formal reports record `main@e1901aa7e2ab07e01283e8f85dfad414be3235b6`, the dirty-worktree state, and a candidate-diff SHA-256; post-run documentation edits are not presented as the measured source commit
> - **Protocol:** 10 seconds / 50 connections / pipelining 10 / 5-second warmup / median of 5 rounds / round-interleaved targets / CV ≤ 15%
> - **Environment:** Node.js 20.20.2, win32 x64, Intel i7-9700, 32 GiB RAM, process priority -14 for the runner and every measured child
> - **Locked dependency versions:** Fastify 5.12.0, Hono 4.13.2, `@hono/node-server` 2.1.1, Express 5.2.1, Koa 3.2.1, `@koa/router` 15.7.0, and Autocannon 8.0.0 (checked against npm `latest` by the runner before the formal runs)

These measurements replace the 2026-01-15 figures below as the current reference. The [primary raw report](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/RESULTS.md) contains the five samples, CV, latency, and chain telemetry.

### Primary Native and Fastify comparison

All figures are median req/s. **Core** is a private shortest-path harness and does not run bootstrap. **Normal** runs the production bootstrap and router-loader while disabling optional request features for parity. With `requestContext=false`, Normal does not register `authContext`; with `frontend.enabled=false`, it does not register a noop middleware. A normal direct route therefore retains only the global `requestHook` lifecycle node.

| Synchronous handler scenario | Raw Native | Raw Fastify | Vext Native Core | Vext Native Normal |
| ---------------------------- | ---------: | ----------: | ---------------: | -----------------: |
| JSON                         |     26,444 |      28,857 |           22,899 |             22,880 |
| Route parameters             |     25,895 |      27,785 |           23,741 |             22,828 |
| Handler business chain       |     24,091 |      24,615 |           20,731 |             19,723 |
| Route middleware chain       |     24,053 |      24,985 |              N/A |             19,776 |

| Asynchronous handler scenario | Raw Native | Raw Fastify | Vext Native Core | Vext Native Normal |
| ----------------------------- | ---------: | ----------: | ---------------: | -----------------: |
| JSON                          |     33,351 |      28,782 |           24,620 |             22,856 |
| Route parameters              |     34,193 |      32,300 |           23,969 |             23,244 |
| Handler business chain        |     30,088 |      26,185 |           21,537 |             20,940 |
| Route middleware chain        |     25,236 |      30,085 |              N/A |             20,903 |

`N/A` is intentional: Core does not register a route middleware chain, so this scenario is not applicable. It is neither missing data nor a zero-cost measurement.

The result is not “Fastify is always faster” or “Vext is second.” In the synchronous group Raw Fastify leads or is close in all four scenarios; in the asynchronous group Raw Native leads the first three while Raw Fastify leads the real middleware chain. Vext Native Normal trails Raw Native by 11.8%–18.1% and Raw Fastify by 17.8%–20.9% in the synchronous group; the asynchronous ranges are 17.2%–32.0% and 20.0%–30.5%. Sync and async were sampled at different times, so their absolute values support within-group comparisons only and do not prove one handler mode is faster. The remaining gap is visible routing, request/response, and lifecycle cost—not an end-to-end production throughput promise.

### Latest five-adapter matrix

The table below shows Vext overhead against each adapter's corresponding Raw implementation under the same protocol (negative means lower Vext throughput). It is an adapter-overhead view, not a global Raw-framework ranking.

| Adapter |   JSON | Route parameters | Handler business chain | Route middleware chain |
| ------- | -----: | ---------------: | ---------------------: | ---------------------: |
| Native  | -31.6% |           -29.6% |                 -29.4% |                 -27.6% |
| Fastify | -43.0% |           -41.7% |                 -38.3% |                 -39.1% |
| Express |  -9.4% |            -2.6% |                  -7.4% |                 -12.7% |
| Koa     | -31.4% |           -33.3% |                 -37.4% |                 -34.2% |
| Hono    | -69.1% |           -68.6% |                 -67.0% |                 -67.9% |

The Hono gap is a separate adapter optimization track and is not folded into the Native/Fastify fairness conclusion. Raw Hono uses the official `@hono/node-server` Node entry, while Vext Hono requires only `hono` and uses Vext's own `node:http` bridge; both are public execution paths, but the gap therefore includes bridge implementation cost. Production decisions should be based on benchmarks that include the application's real middleware, auth, logging, serialization, I/O, and deployment environment.

## Comparative caliber description (please read first)

The current repo-local benchmark measures the throughput comparison under the same scenario, the same stress test parameters, and the same functional load as possible, rather than a direct comparison of the "default out-of-box full-featured configuration".

- **Raw (naked running)**: directly use the native API of the underlying framework to implement the same test scenario
- **Vext**: The same scene is launched through Vext, but in order to make a fair comparison with Raw, non-essential default capabilities will be turned off, and only the adapter/routing layer core overhead will be retained.
- **chain**: historical compatibility scenario, indicating handler inline business logic chain
- **middleware-chain**: the real route-level middleware chain, which will enter the adapter's middleware chain executor

In the current benchmark, the Vext side will close or tighten the following non-core default capabilities:

- `accessLog`
- `requestId`
- `cors`
- `rateLimit`
- `response.wrap`
- `bodyParser`
- `requestContext`
- Changed log level to `silent`

> ⚠️ This means: The data on this page is closer to the comparison result of "framework core path/adapter layer", rather than the final throughput commitment when all built-in capabilities are turned on in the default production configuration.
>
> If you want to evaluate real business scenarios, please re-stress test based on your own middleware, logs, authentication, response packaging, database access and deployment environment.

## Historical environment (2026-01-15, trend reference only)

> Every section below used a different machine, dependency set, and load protocol. Do not compare it directly with the current results above or use it to claim a current framework ranking.

| Project                    | Specifications                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| **CPU**                    | Intel Core i9-13900K (24 cores / 32 threads)                                                  |
| **Memory**                 | 64 GB DDR5-5600                                                                               |
| **Operating System**       | Ubuntu 22.04 LTS                                                                              |
| **Node.js**                | v22.12.0                                                                                      |
| **Test Tools**             | [autocannon](https://github.com/mcollina/autocannon) v8.0.0 (called via `npm exec --package`) |
| **Concurrent Connections** | 100                                                                                           |
| **Duration**               | 30 seconds                                                                                    |
| **Warm-up**                | 5 seconds (not included in statistics)                                                        |

> ⚠️ **Note**: Performance benchmark test results are greatly affected by the test environment, load mode and code implementation. It is recommended to run the benchmark on your own hardware for the most accurate results.

---

## Hello World Benchmark

The simplest routing scenario: return a fixed string response, without any business logic, and test the original throughput of the framework.

### Test code

::: code-tabs
@tab VextJS

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (req, res) => {
    res.json({ message: "Hello, World!" });
  });
});
```

@tab Fastify

```javascript
const fastify = require("fastify")();

fastify.get("/", async () => {
  return { message: "Hello, World!" };
});

fastify.listen({ port: 3000 });
```

@tab Express

```javascript
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.json({ message: "Hello, World!" });
});

app.listen(3000);
```

@tab Hono (Node)

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => c.json({ message: "Hello, World!" }));

serve({ fetch: app.fetch, port: 3000 });
```

:::

### Results

| frames              | requests/second (avg) | latency p50 | latency p95 | latency p99 | throughput |
| ------------------- | :-------------------: | :---------: | :---------: | :---------: | :--------: |
| **VextJS** (Native) |      **98,421**       |   0.9 ms    |   1.8 ms    |   3.2 ms    | 18.2 MB/s  |
| VextJS (Fastify)    |        87,653         |   1.1 ms    |   2.1 ms    |   3.8 ms    | 16.2 MB/s  |
| VextJS (Hono)       |        72,841         |   1.3 ms    |   2.5 ms    |   4.4 ms    | 13.5 MB/s  |
| Fastify v5          |        85,320         |   1.1 ms    |   2.2 ms    |   3.9 ms    | 15.8 MB/s  |
| Hono v4 (Node)      |        68,412         |   1.4 ms    |   2.7 ms    |   4.9 ms    | 12.7 MB/s  |
| Express v5          |        18,934         |   4.9 ms    |   9.8 ms    |   17.2 ms   |  3.5 MB/s  |
| Koa v2              |        24,716         |   3.8 ms    |   7.6 ms    |   13.4 ms   |  4.6 MB/s  |
| NestJS (Express)    |        16,821         |   5.5 ms    |   11.2 ms   |   19.8 ms   |  3.1 MB/s  |
| NestJS (Fastify)    |        79,234         |   1.2 ms    |   2.3 ms    |   4.1 ms    | 14.7 MB/s  |

> Historical data source: [benchmark warehouse](https://github.com/vextjs/benchmarks), tested on 2026-01-15. To reproduce the current version's results, run `test/benchmark/run-benchmark.mjs` in this repository.

---

## JSON Serialization Baseline

Test the performance of returning JSON responses containing nested objects, close to real API scenarios.

### Response structure

```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "createdAt": "2026-01-15T08:00:00.000Z",
  "profile": {
    "avatar": "https://example.com/avatar.png",
    "bio": "Software Engineer",
    "location": "Shanghai, China"
  },
  "roles": ["user", "admin"],
  "metadata": {
    "loginCount": 42,
    "lastLogin": "2026-01-14T20:30:00.000Z"
  }
}
```

### Results

| frames              | requests/second (avg) | latency p50 | latency p95 | latency p99 |
| ------------------- | :-------------------: | :---------: | :---------: | :---------: |
| **VextJS** (Native) |      **91,247**       |   1.0 ms    |   2.0 ms    |   3.5 ms    |
| VextJS (Fastify)    |        81,334         |   1.1 ms    |   2.3 ms    |   4.0 ms    |
| VextJS (Hono)       |        67,523         |   1.4 ms    |   2.8 ms    |   4.9 ms    |
| Fastify v5          |        79,876         |   1.2 ms    |   2.4 ms    |   4.2 ms    |
| Hono v4 (Node)      |        62,103         |   1.5 ms    |   3.0 ms    |   5.3 ms    |
| Express v5          |        16,782         |   5.6 ms    |   11.3 ms   |   19.9 ms   |
| NestJS (Fastify)    |        73,910         |   1.3 ms    |   2.6 ms    |   4.6 ms    |

---

## Parameter verification benchmark

Test the performance overhead of request parameter verification during route processing. VextJS uses the built-in schema-dsl verification, and other frameworks use zod or joi.

### Test scenario

POST request, Body contains 10 fields, including strings, numbers, enumerations and nested objects.

| Frame                            | Requests/sec (avg) | Delay p50 | Delay p95 | Validation library  |
| -------------------------------- | :----------------: | :-------: | :-------: | :-----------------: |
| **VextJS** (Native + schema-dsl) |     **84,312**     |  1.1 ms   |  2.2 ms   | Built-in schema-dsl |
| VextJS (Fastify + schema-dsl)    |       74,891       |  1.2 ms   |  2.5 ms   | Built-in schema-dsl |
| Fastify v5 (ajv)                 |       78,234       |  1.2 ms   |  2.4 ms   |       ajv v8        |
| Fastify v5 (zod)                 |       51,823       |  1.8 ms   |  3.7 ms   |       zod v3        |
| Express + zod                    |       12,341       |  7.6 ms   |  15.3 ms  |       zod v3        |
| NestJS (class-validator)         |       42,156       |  2.2 ms   |  4.4 ms   |   class-validator   |

> VextJS's schema-dsl is compiled based on ajv and has verification performance close to native ajv while providing a more concise DSL syntax.

---

## Middleware chain benchmark

Test the final routing processing performance after five layers of middleware, and simulate middleware overlay scenarios such as authentication, logging, and current limiting in real applications.

### Middleware configuration

5 layers of middleware:

1. Request ID injection
2. Request logging (memory buffer, do not write to disk)
3. JWT verification (skip signature verification, only parse)
4. Current limit check (memory counter)
5. Response header injection

| Framework           | Requests/sec (avg) | Less middleware overhead | Latency p99 |
| ------------------- | :----------------: | :----------------------: | :---------: |
| **VextJS** (Native) |     **79,834**     |          -18.9%          |   4.1 ms    |
| VextJS (Fastify)    |       57,221       |          -21.5%          |   5.6 ms    |
| Fastify v5          |       68,901       |          -19.2%          |   4.8 ms    |
| Express v5          |       13,421       |          -29.1%          |   22.4 ms   |
| Koa v2              |       18,934       |          -23.4%          |   18.1 ms   |

---

## Adapter comparison

VextJS supports multiple underlying HTTP adapters. Performance differences mainly come from the underlying HTTP implementation:

| Adapter            | Requests/second (Hello World, history) | Features                                                                 | Applicable scenarios               |
| ------------------ | :------------------------------------: | ------------------------------------------------------------------------ | ---------------------------------- |
| `native` (default) |                ~98,000                 | Zero external HTTP framework dependencies, Node native http + route-core | Recommended, highest performance   |
| `fastify`          |                ~87,000                 | High performance + rich ecosystem                                        | Requires Fastify plug-in ecosystem |
| `hono`             |                ~72,000                 | Web Standards API, ultra-lightweight                                     | Full stack / edge runtime          |
| `express`          |                ~18,000                 | The largest middleware ecosystem                                         | Migrate existing Express projects  |
| `koa`              |                ~24,000                 | Lightweight and elegant                                                  | Small and medium-sized projects    |
| `node-cluster`     |               ~340,000\*               | Multi-process, linear scaling                                            | Multi-core CPU server              |

> `*` Cluster data is the aggregate throughput of 8-core workers (single process × 8 near linear expansion).
> Note: The uWS (uWebSockets.js) adapter is not yet built-in and is listed as a future plan (roadmap).

### Adapter performance visualization

```
98,421 req/s
87,653 req/s
Hono 72,841 req/s
Koa ██████████ 24,716 req/s
Express ████████ 18,934 req/s
```

---

## Cluster mode baseline

Test the throughput comparison between VextJS Cluster mode and single-process mode in a multi-core environment:

| Mode                    | Number of Workers | Requests/sec | CPU Utilization | Memory |
| ----------------------- | :---------------: | :----------: | :-------------: | :----: |
| Single Process (Native) |         1         |    98,421    |       12%       | 48 MB  |
| Cluster × 2             |         2         |   192,834    |       24%       | 96 MB  |
| Cluster × 4             |         4         |   381,201    |       47%       | 192 MB |
| Cluster × 8             |         8         |   743,892    |       91%       | 384 MB |
| Cluster × 16            |        16         |   891,234    |       98%       | 768 MB |

> Above 8 cores, affected by CPU scheduling overhead, the expansion efficiency decreases slightly, but it is still close to linear expansion.

---

## Memory benchmark

Memory usage when the framework is unloaded (only HTTP server is started, no request processing):

| Framework           | Startup memory | After 100,000 requests | GC pressure |
| ------------------- | :------------: | :--------------------: | :---------: |
| **VextJS** (Native) |   **18 MB**    |         22 MB          |     Low     |
| VextJS (Hono)       |     24 MB      |         28 MB          |     Low     |
| VextJS (Fastify)    |     31 MB      |         38 MB          |     Low     |
| Fastify v5          |     29 MB      |         36 MB          |     Low     |
| Express v5          |     42 MB      |         58 MB          |   Medium    |
| NestJS (Express)    |     86 MB      |         112 MB         |   Medium    |
| NestJS (Fastify)    |     71 MB      |         94 MB          | Low-Medium  |

---

## Startup time

Time from process startup to when the first request can be responded to (cold start):

| Framework           | Cold start time | Hot reload time |
| ------------------- | :-------------: | :-------------: |
| **VextJS** (Native) |    **42 ms**    |     180 ms      |
| VextJS (Fastify)    |      68 ms      |     210 ms      |
| Fastify v5          |      61 ms      |        —        |
| Express v5          |      38 ms      |        —        |
| NestJS              |    1,240 ms     |        —        |

> VextJS hot reload time includes the complete process of esbuild incremental compilation + worker replacement. The actual hot reload perceived delay is about 200 ms.

---

## How to run the benchmark yourself

### Run the benchmark in the current warehouse

```bash
npm ci
npm run verify:benchmark-deps
node --expose-gc --max-old-space-size=512 test/benchmark/run-native-fairness.mjs --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5 --max-cv 15 --process-priority 0 --handler-mode sync
```

The formal Windows samples on this page used `--process-priority -14`. Use that value on another platform only when Node.js is permitted to set it; the runner verifies the actual value and fails explicitly when unsupported.

### Run a single framework

```bash
# Only tests VextJS (Native)
npm run test:bench -- --framework native --scenario all --rounds 5

# Only test VextJS (Fastify)
npm run test:bench -- --framework fastify --scenario all --rounds 5

# Only test the real route-level middleware chain
npm run test:bench -- --scenario middleware-chain --rounds 5
```

### Manual testing using autocannon

Autocannon 8.0.0 is a locked development dependency. The benchmark runners call its local programmatic API and automatically start and stop each target; they do not invoke `npm exec` during every sample. There is normally no need to start a server manually.

If you need to perform a separate stress test on a started local service, you can directly run:

```bash
# run autocannon
npx --yes --package=autocannon@8.0.0 autocannon -c 100 -d 30 -p 10 http://localhost:3000/
```

### Configuration instructions

The current benchmark is configured through CLI parameters, and `bench.config.ts` does not exist:

| Parameter                   | Default                     | Description                                              |
| --------------------------- | --------------------------- | -------------------------------------------------------- |
| `--duration`                | `15`                        | Measurement duration in seconds                          |
| `--connections`             | `50`                        | Concurrent connections                                   |
| `--pipelining`              | `10`                        | HTTP pipeline depth                                      |
| `--warmup`                  | `5`                         | Warmup seconds                                           |
| `--rounds`                  | `1`                         | Rounds; use 5 or 7 before release                        |
| `--max-cv`                  | `15`                        | Reject a citable report if any multi-round CV exceeds it |
| `--process-priority`        | `0`                         | Runner and measured-child priority (-20..19)             |
| `--scenario`                | `all`                       | `json` / `params` / `chain` / `middleware-chain` / `all` |
| `--framework`               | Five Vext adapters          | Comma-separated framework filter                         |
| `--output`                  | `test/benchmark/RESULTS.md` | Report output path                                       |
| `--results-json`            | —                           | Save complete raw samples                                |
| `--from-results-json`       | —                           | Merge complete artifacts with identical provenance       |
| `--require-complete-matrix` | `false`                     | Require all scenarios or the full 5×4 adapter matrix     |

---

## Conclusion

- The current cited evidence is the 2026-08-14 five-round measurement at the top of this page and its linked raw report; all lower figures are historical reference only.
- Raw Native and Raw Fastify each lead in some scenarios and handler modes, so the data does not support a universal speed ranking.
- Vext Native Normal has no disabled `authContext` or frontend noop middleware left in its request chain. Its remaining gap is primarily visible framework-runtime cost.
- The Hono adapter gap is materially higher than the others and is tracked as a separate optimization direction rather than hidden inside the Native/Fastify conclusion.

### Performance recommendations

| Scenario                                                            | Recommended configuration                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Extreme performance (cloud native, single-machine high concurrency) | `adapter: 'native'` + Cluster × number of CPU cores                    |
| Production environment (general)                                    | `adapter: 'native'` or `'fastify'` + Cluster × (number of CPU cores-1) |
| Lightweight deployment (container/edge)                             | `adapter: 'native'`, single process, zero framework dependencies       |
| Full stack/edge runtime                                             | `adapter: 'hono'`, compatible with Web Standards API                   |
| Development environment                                             | `adapter: 'native'` (default), hot reloading is the fastest            |

---

## Related links

- [current benchmark source and raw reports](https://github.com/devcodex-labs/vextjs/tree/main/test/benchmark) — reproducible commands, test code, and latest raw data
- [Adapter Architecture](/guide/adapters) — Understand the technical implementation of each Adapter
- [Cluster multi-process](/guide/cluster) — How to configure and use Cluster mode
- [Configuration Item](/api/config) — `adapter` configuration field details

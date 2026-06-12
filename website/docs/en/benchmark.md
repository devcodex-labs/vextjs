# Performance benchmark test

This page shows performance benchmark data comparing VextJS with other popular Node.js web frameworks. The reproducible benchmark of the current version is subject to `test/benchmark/run-benchmark.mjs` in the warehouse; the historical benchmark warehouse data on the page is only for trend reference.

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

## Test environment

| Project | Specifications |
| ------------ | --------------------------------------------------------------- |
| **CPU** | Intel Core i9-13900K (24 cores / 32 threads) |
| **Memory** | 64 GB DDR5-5600 |
| **Operating System** | Ubuntu 22.04 LTS |
| **Node.js** | v22.12.0 |
| **Test Tools** | [autocannon](https://github.com/mcollina/autocannon) v8.0.0 (called via `npm exec --package`) |
| **Concurrent Connections** | 100 |
| **Duration** | 30 seconds |
| **Warm-up** | 5 seconds (not included in statistics) |

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

| frames | requests/second (avg) | latency p50 | latency p95 | latency p99 | throughput |
| ------------------- | :-----------: | :-------: | :-------: | :-------: | :-------: |
| **VextJS** (Native) | **98,421** | 0.9 ms | 1.8 ms | 3.2 ms | 18.2 MB/s |
| VextJS (Fastify) | 87,653 | 1.1 ms | 2.1 ms | 3.8 ms | 16.2 MB/s |
| VextJS (Hono) | 72,841 | 1.3 ms | 2.5 ms | 4.4 ms | 13.5 MB/s |
| Fastify v5 | 85,320 | 1.1 ms | 2.2 ms | 3.9 ms | 15.8 MB/s |
| Hono v4 (Node) | 68,412 | 1.4 ms | 2.7 ms | 4.9 ms | 12.7 MB/s |
| Express v5 | 18,934 | 4.9 ms | 9.8 ms | 17.2 ms | 3.5 MB/s |
| Koa v2 | 24,716 | 3.8 ms | 7.6 ms | 13.4 ms | 4.6 MB/s |
| NestJS (Express) | 16,821 | 5.5 ms | 11.2 ms | 19.8 ms | 3.1 MB/s |
| NestJS (Fastify) | 79,234 | 1.2 ms | 2.3 ms | 4.1 ms | 14.7 MB/s |> Historical data source: [benchmark warehouse](https://github.com/vextjs/benchmarks), tested on 2026-01-15. To reproduce the actual test of the current version, please give priority to running this warehouse `test/benchmark/run-benchmark.mjs`.

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

| frames | requests/second (avg) | latency p50 | latency p95 | latency p99 |
| ------------------- | :-----------: | :------: | :------: | :------: |
| **VextJS** (Native) | **91,247** | 1.0 ms | 2.0 ms | 3.5 ms |
| VextJS (Fastify) | 81,334 | 1.1 ms | 2.3 ms | 4.0 ms |
| VextJS (Hono) | 67,523 | 1.4 ms | 2.8 ms | 4.9 ms |
| Fastify v5 | 79,876 | 1.2 ms | 2.4 ms | 4.2 ms |
| Hono v4 (Node) | 62,103 | 1.5 ms | 3.0 ms | 5.3 ms |
| Express v5 | 16,782 | 5.6 ms | 11.3 ms | 19.9 ms |
| NestJS (Fastify) | 73,910 | 1.3 ms | 2.6 ms | 4.6 ms |

---

## Parameter verification benchmark

Test the performance overhead of request parameter verification during route processing. VextJS uses the built-in schema-dsl verification, and other frameworks use zod or joi.

### Test scenario

POST request, Body contains 10 fields, including strings, numbers, enumerations and nested objects.

| Frame | Requests/sec (avg) | Delay p50 | Delay p95 | Validation library |
| -------------------------------- | :-----------: | :------: | :------: | :-------------: |
| **VextJS** (Native + schema-dsl) | **84,312** | 1.1 ms | 2.2 ms | Built-in schema-dsl |
| VextJS (Fastify + schema-dsl) | 74,891 | 1.2 ms | 2.5 ms | Built-in schema-dsl |
| Fastify v5 (ajv) | 78,234 | 1.2 ms | 2.4 ms | ajv v8 |
| Fastify v5 (zod) | 51,823 | 1.8 ms | 3.7 ms | zod v3 |
| Express + zod | 12,341 | 7.6 ms | 15.3 ms | zod v3 |
| NestJS (class-validator) | 42,156 | 2.2 ms | 4.4 ms | class-validator |

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

| Framework | Requests/sec (avg) | Less middleware overhead | Latency p99 |
| ------------------- | :-----------: | :-----------: | :------: |
| **VextJS** (Native) | **79,834** | -18.9% | 4.1 ms |
| VextJS (Fastify) | 57,221 | -21.5% | 5.6 ms |
| Fastify v5 | 68,901 | -19.2% | 4.8 ms |
| Express v5 | 13,421 | -29.1% | 22.4 ms |
| Koa v2 | 18,934 | -23.4% | 18.1 ms |

---

## Adapter comparison

VextJS supports a variety of underlying HTTP Adapters. The performance difference mainly comes from the underlying HTTP implementation:| Adapter | Requests/second (Hello World, history) | Features | Applicable scenarios |
|----------------| :---------------------------------: | -------------------------------------------------- | ---------------------------------- |
| `native` (default) | ~98,000 | Zero external HTTP framework dependencies, Node native http + route-core | Recommended, highest performance |
| `fastify` | ~87,000 | High performance + rich ecosystem | Requires Fastify plug-in ecosystem |
| `hono` | ~72,000 | Web Standards API, ultra-lightweight | Full stack / edge runtime |
| `express` | ~18,000 | The largest middleware ecosystem | Migrate existing Express projects |
| `koa` | ~24,000 | Lightweight and elegant | Small and medium-sized projects |
| `node-cluster` | ~340,000\* | Multi-process, linear scaling | Multi-core CPU server |

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

| Mode | Number of Workers | Requests/sec | CPU Utilization | Memory |
| --------------- | :-------: | :-----: | :--------: | :----: |
| Single Process (Native) | 1 | 98,421 | 12% | 48 MB |
| Cluster × 2 | 2 | 192,834 | 24% | 96 MB |
| Cluster × 4 | 4 | 381,201 | 47% | 192 MB |
| Cluster × 8 | 8 | 743,892 | 91% | 384 MB |
| Cluster × 16 | 16 | 891,234 | 98% | 768 MB |

> Above 8 cores, affected by CPU scheduling overhead, the expansion efficiency decreases slightly, but it is still close to linear expansion.

---

## Memory benchmark

Memory usage when the framework is unloaded (only HTTP server is started, no request processing):

| Framework | Startup memory | After 100,000 requests | GC pressure |
| ------------------- | :-------: | :----------: | :------: |
| **VextJS** (Native) | **18 MB** | 22 MB | Low |
| VextJS (Hono) | 24 MB | 28 MB | Low |
| VextJS (Fastify) | 31 MB | 38 MB | Low |
| Fastify v5 | 29 MB | 36 MB | Low |
| Express v5 | 42 MB | 58 MB | Medium |
| NestJS (Express) | 86 MB | 112 MB | Medium |
| NestJS (Fastify) | 71 MB | 94 MB | Low-Medium |

---

## Startup time

Time from process startup to when the first request can be responded to (cold start):

| Framework | Cold start time | Hot reload time |
| ------------------- | :--------: | :--------: |
| **VextJS** (Native) | **42 ms** | 180 ms |
| VextJS (Fastify) | 68 ms | 210 ms |
| Fastify v5 | 61 ms | — |
| Express v5 | 38 ms | — |
| NestJS | 1,240 ms | — |

> VextJS hot reload time includes the complete process of esbuild incremental compilation + worker replacement. The actual hot reload perceived delay is about 200 ms.

---

## How to run the benchmark yourself

### Run the benchmark in the current warehouse

```bash
npm install
npm run test:bench -- --scenario all --rounds 5
```

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

The benchmark runner of the current warehouse will automatically start/stop the test server and call autocannon through `npm exec --package=autocannon@8.0.0`. There is usually no need to start the server manually.

If you need to perform a separate stress test on a started local service, you can directly run:

```bash
# run autocannon
npx --yes --package=autocannon@8.0.0 autocannon -c 100 -d 30 -p 10 http://localhost:3000/
```

### Configuration instructions

The current benchmark is configured through CLI parameters, and `bench.config.ts` does not exist:

| Parameters | Default value | Description |
| --- | --- | --- |
| `--duration` | `15` | The number of seconds the stress test lasts |
| `--connections` | `50` | Number of concurrent connections |
| `--pipelining` | `10` | HTTP pipeline depth |
| `--warmup` | `5` | Warmup seconds |
| `--rounds` | `1` | Rounds; PR / pre-release suggestion 5 or 7 |
| `--scenario` | `all` | `json` / `params` / `chain` / `middleware-chain` / `all` |
| `--framework` | All | Framework filtering, comma separated |
| `--output` | `test/benchmark/RESULTS.md` | Report output path |

---

## Conclusion

- **Highest throughput in history**: VextJS + Native Adapter, reaching about **98,000 req/s** in the historical Hello World scenario on 2026-01-15, turning on Cluster mode can break through **700,000 req/s** (8 cores)
- **Minimum memory**: VextJS + Native Adapter, only **18 MB** when empty, suitable for resource-constrained environments
- **Fastest startup**: VextJS + Native Adapter, cold startup about **42 ms**, hot reload about **180 ms**
- **Verification performance**: The built-in schema-dsl is compiled based on ajv, the verification overhead is extremely low, and it is close to the native ajv performance
- **Scalability**: Close to linear expansion in Cluster mode, 8 cores can achieve approximately 7.6× throughput improvement

### Performance recommendations

| Scenario | Recommended configuration |
|-----------------------------|----------------------------------------------------------------|
| Extreme performance (cloud native, single-machine high concurrency) | `adapter: 'native'` + Cluster × number of CPU cores |
| Production environment (general) | `adapter: 'native'` or `'fastify'` + Cluster × (number of CPU cores-1) |
| Lightweight deployment (container/edge) | `adapter: 'native'`, single process, zero framework dependencies |
| Full stack/edge runtime | `adapter: 'hono'`, compatible with Web Standards API |
| Development environment | `adapter: 'native'` (default), hot reloading is the fastest |

---

## Related links

- [benchmarks repository](https://github.com/vextjs/benchmarks) — complete test code and historical data
- [Adapter Architecture](/guide/adapters) — Understand the technical implementation of each Adapter
- [Cluster multi-process](/guide/cluster) — How to configure and use Cluster mode
- [Configuration Item](/api/config) — `adapter` configuration field details
# Framework-native product-stack API benchmark

This page compares three documented production paths for the same API contract:
VextJS with its Native adapter, direct Fastify, and NestJS hosted by Fastify.
It is a separate companion to the [Vext Adapter Matrix](/benchmark), not a
universal framework ranking.

## Current publication status

The earlier Enterprise workload suite has been removed. It used artificial
latency injection and did not establish a sufficiently comparable product-stack
contract, so its numbers are not retained as a reference.

The replacement suite is `framework-native-enterprise-api-windows-v2`. Its
accepted `windows-x64-v2` protocol is designed for this Windows host, but no
formal cross-framework number is published until a clean committed candidate
passes host qualification, all 162 timed samples, and an independent artifact
validator. A local smoke or pilot proves implementation behavior only and is
intentionally non-citable.

## Why this is not a bare-performance benchmark

A bare HTTP or routing benchmark is useful when the question is: “what is the
shortest route path?” It intentionally removes correlation, authentication,
authorization, validation, structured logging, service composition, error
projection, response security headers, and external dependency handling.

That is not the question this page answers. In production, those capabilities
are part of the request path and must not be silently disabled for one target.
This suite holds their observable contract constant while allowing each framework
to use its documented or recommended production integration. It is therefore a
production-shaped comparison, not proof that one framework is always faster.

Use the [Adapter Matrix](/benchmark) for the fair Vext-specific choice — one
Vext application with only its adapter changed. Use bare-path diagnostics only
as maintenance evidence for an individual stack; they are not mixed with or
ranked against this product-stack result.

## Fairness contract

Every target implements `POST /api/users/:userId/orders` and the same six
timed workloads. The runner proves the observable contract before it measures
rate.

| Shared requirement               | Contract held constant                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correlation                      | `x-request-id`, tenant, and trace values propagate into the success/error envelope and the controlled outbound request.                                                                |
| Authentication and authorization | A valid signed JWT creates an order; a missing JWT returns 401; a valid read-only JWT returns 403.                                                                                     |
| Validation                       | An authenticated invalid `quantity` returns 422 before a repository write.                                                                                                             |
| Success semantics                | A 201 response has the same business order, pricing checksum, totals, and response security headers.                                                                                   |
| Side effects                     | Exactly one in-memory repository write for a success; no write for every failure.                                                                                                      |
| Structured logging               | Each target emits its normal completed access event to a drained local stdout pipe. The runner neither parses nor counts those logs during measurement.                                |
| External I/O                     | Two external-success workloads make one real TCP/HTTP request to an owned local quote sidecar with nominal 20 ms or 40 ms delay. It is not a database or Redis substitute.             |
| Negative probes                  | Wrong method, wrong content type, internal error, malformed JWT, unknown field, and decimal coercion must reject without a write. They are conformance probes, not measured workloads. |

The three target implementations are intentionally framework-native:

| Capability          | VextJS + Native Adapter                                              | Fastify                                           | NestJS + Fastify                                                            |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| Request context     | Vext request ID and built-in AsyncLocalStorage context               | `@fastify/request-context`                        | Nest AsyncLocalStorage middleware recipe                                    |
| JWT and permission  | Vext `auth()` plus `jose` verification and route permission          | `@fastify/jwt` route hook                         | `@nestjs/jwt` in a `CanActivate` guard                                      |
| Validation          | Vext route validation with public strict `app.setValidator()` plugin | Fastify route JSON Schema with strict Ajv options | `ValidationPipe`, DTO decorators, `class-validator` and `class-transformer` |
| Service composition | Startup-loaded Vext services                                         | Startup-composed closures                         | Provider constructor injection                                              |
| Error/access event  | Public Vext error lifecycle hook plus normal access log              | Error handler plus `onResponse`                   | Nest exception filter plus Fastify `onResponse`                             |
| Security headers    | Vext `securityHeaders: basic`                                        | `@fastify/helmet`                                 | `@fastify/helmet` on the Fastify host                                       |

“Official implementation” here means a documented or recommended production
path. It does not artificially restrict a framework to first-party npm package
ownership: maintained ecosystem integrations are valid when their maintainer or
framework documentation recommends them. The accepted artifact records the exact
implementation manifest and versions that were actually executed.

## Workloads

| ID      | Expected status | What runs                                                                                                                                                               |
| ------- | --------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EW-01` |             201 | Authenticated success with JWT, authorization, context, strict validation, service/repository, deterministic CPU pricing, security headers, and completed access event. |
| `EW-02` |             201 | The same path plus one real local HTTP quote with nominal 20 ms delay; actual P50/P95/P99 are gated.                                                                    |
| `EW-03` |             201 | The same path plus one real local HTTP quote with nominal 40 ms delay; actual P50/P95/P99 are gated.                                                                    |
| `EW-04` |             422 | Authenticated strict validation failure before business read/write.                                                                                                     |
| `EW-05` |             401 | Missing JWT rejection before authorization, validation, or business handling.                                                                                           |
| `EW-06` |             403 | Valid read-only JWT rejection before validation or business handling.                                                                                                   |

## Correctness before throughput

Conformance runs with test-only observation enabled. It verifies response status,
headers, correlation, expected side effects, the real quote-sidecar call, and
framework-native capability execution for every target. It then compares a
versioned canonical semantic projection using SHA-256.

The semantic hash deliberately does **not** compare raw response bytes. JSON
whitespace, key order, framework-specific serialization details, generated
repository IDs, and per-request IDs/traces are not a fairness requirement.
Status, media type, required security headers, business order semantics, error
kind, and rejected-field set are canonicalized and hashed. Request, tenant, and
trace correlation are verified against the request headers before hashing; the
hash records that stable invariant rather than volatile identifier values.

Only after that proof passes does the runner start fresh measurement-only target,
sidecar, and load processes. The timed process contains no observer, control
route, application sampler, or per-request test counter. The load process uses
Autocannon's documented `setupRequest` factory to generate deterministic unique
request IDs on the isolated load CPU role. The runner records P50/P95/P99,
status distributions, CPU time, Windows Working Set, sidecar delay distribution,
and child-process affinity readback.

Before application startup, each fresh sidecar, target, and load process stops
at an IPC pre-start handshake. The runner proves that the IPC PID is the owned
child, applies and reads back its role CPU affinity, then releases the processes
in fixed sidecar → target → load order. This happens before semantic probing,
warmup, and the timed window. Any identity, affinity, or startup mismatch fails
the entire raw run; the runner never retries or stitches an individual sample.

Before every fresh target's warmup, the runner sends one untimed semantic probe
to that exact measurement fixture. Its canonical hash must match the recorded
cross-framework conformance hash for the workload, preventing a measurement
fixture from silently drifting while only preserving the same HTTP status.

## Formal protocol and reproducibility

The accepted `windows-x64-v2` protocol fixes 50 connections, pipelining 1, a
10-second warmup, a 30-second measurement window, and nine paired balanced
blocks (162 timed samples). Each target/workload must have RPS CV ≤15%. A formal
run additionally requires:

- a clean committed Windows x64 candidate and exact installed dependency versions;
- a 60-second host qualification, AC/no-battery status, non-Power-Saver plan,
  and four non-overlapping physical-core roles (`load`, `target`, `dependency`,
  `control`) each with background CPU ≤10%;
- a pre-start PID/affinity handshake for every owned child, plus affinity
  readback before warmup and after measurement;
- load CPU ≤85% in every target measurement window; plus same-factory no-op
  ceiling headroom of at least 2× the highest target RPS for every workload.
  The ceiling's own load CPU is recorded and may saturate: it measures generator
  capacity, not a target-measurement bottleneck;
- real 20 ms and 40 ms sidecar calibration gates, including at least 8 ms
  measured P50 separation; and
- semantic conformance for six timed workloads and six negative probes, followed
  by an independent validator that recomputes every gate and a fixed-seed,
  10,000-iteration paired block bootstrap.

```bash
# Build once; a focused non-citable implementation smoke on Windows.
npm run build
npm run test:bench:enterprise -- --smoke --sample-limit 3

# A full pilot is evidence only and never becomes documentation data.
npm run test:bench:enterprise -- --pilot

# Only from a clean committed Windows candidate: create raw evidence,
# independently validate it, then project accepted data into this same page.
npm run test:bench:enterprise -- --formal --output test/benchmark/.artifacts/framework-native-v2-raw.json
node test/benchmark/framework-native/v2/validate-artifact.mjs \
  --input test/benchmark/.artifacts/framework-native-v2-raw.json \
  --output test/benchmark/.artifacts/framework-native-v2-accepted.json

# Project an accepted formal artifact into this same page, or verify it has not drifted.
npm run generate:enterprise-benchmark-docs
npm run verify:enterprise-benchmark-docs
```

The documentation generator does not project a non-citable artifact. When an
accepted formal run exists, this page contains exact framework versions, source
identity, Windows qualification, semantic hashes, paired uncertainty, headroom,
and every sample — no GitHub-only handoff and no separate results page.

<!-- framework-native-results:start -->

## Accepted Windows result

This block is generated only from the independent validator's accepted artifact. It contains the complete sample set on this page; the JSON artifacts are audit evidence, not a second results destination.

### Artifact identity and environment

| Accepted UTC             | Source                                             | Host                                                                             | Role CPU sets                                 |
| ------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| 2026-08-16T09:41:45.059Z | `150ac6c3e217f030c0546c7cc3e6e50e977ae10b` (clean) | win32/x64; Node v20.20.2; Intel(R) Core(TM) i7-9700 CPU @ 3.00GHz; 32,630.92 MiB | load: 2; target: 3; dependency: 4; control: 5 |

| Raw-run SHA-256                                                    | Accepted artifact SHA-256                                          | Protocol                                                                        | Selected physical cores                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `6291f75e81b6e6cff269e8b52240d829addd3fded4f4f8e08a2387dea62685e1` | `f52a740ef9e355dda7a04e5382f7bf19f71a35aeaa0bc93a23ed7a6aca6cd454` | windows-x64-v2; 50 connections; pipelining 1; 10s warmup; 30s measure; 9 blocks | load=core-2 (2); target=core-3 (3); dependency=core-4 (4); control=core-5 (5) |

### Executed versions

| Package                  | Version |
| ------------------------ | ------- |
| vextjs                   | 1.0.1   |
| fastify                  | 5.12.0  |
| autocannon               | 8.0.0   |
| @fastify/helmet          | 13.1.0  |
| @fastify/jwt             | 10.2.2  |
| @fastify/request-context | 7.0.0   |
| @nestjs/common           | 11.2.1  |
| @nestjs/core             | 11.2.1  |
| @nestjs/jwt              | 11.0.2  |
| @nestjs/platform-fastify | 11.2.1  |
| class-transformer        | 0.5.1   |
| class-validator          | 0.15.1  |
| jose                     | 6.2.9   |
| reflect-metadata         | 0.2.2   |
| rxjs                     | 7.8.2   |

### Semantic conformance fingerprints

The hashes below are canonical semantic projections. They intentionally do not compare raw serialized bytes, JSON key order, whitespace, generated order IDs, or volatile request/trace IDs; correlation is asserted before canonicalization.

| ID    | Workload                                         | Algorithm           | Canonical semantic hash                                            |
| ----- | ------------------------------------------------ | ------------------- | ------------------------------------------------------------------ |
| EW-01 | Authenticated success — CPU path                 | sha256-c14n-json-v1 | `4eff48f7bfe43bc752ebb40aa732fb2657574e8133500f00dc2c663e0787f0c6` |
| EW-02 | Authenticated success — nominal 20 ms HTTP quote | sha256-c14n-json-v1 | `42e832e94e54c2c0d28ee6bb8aac1be081eed2133cdee22c4006324ec40bff39` |
| EW-03 | Authenticated success — nominal 40 ms HTTP quote | sha256-c14n-json-v1 | `42e832e94e54c2c0d28ee6bb8aac1be081eed2133cdee22c4006324ec40bff39` |
| EW-04 | Authenticated validation failure                 | sha256-c14n-json-v1 | `fe8c1dea0b27a68b04b9da5da6bf51a2d91a97be279016dcc95ed7d25e182260` |
| EW-05 | Authentication failure                           | sha256-c14n-json-v1 | `d956c575fb1bb29f1c10c187f92a7c9549f189cf824ac49bbb89f8815e89117b` |
| EW-06 | Authorization failure                            | sha256-c14n-json-v1 | `22165ed2a6b3099fcf20aaf4adebadb03e1e52f26923b83d5712d8d7754f8d29` |

### Per-workload summary

| Workload | Target                  | Median RPS | Mean RPS | RPS CV |   P50 |   P95 |    P99 | Target CPU / 1K | Working / peak set      |
| -------- | ----------------------- | ---------: | -------: | -----: | ----: | ----: | -----: | --------------: | ----------------------- |
| EW-01    | VextJS + Native Adapter |   3,310.68 | 3,307.98 |  0.42% | 14 ms | 18 ms |  22 ms |   299,623.56 μs | 143.63 MiB / 156.12 MiB |
| EW-01    | Fastify                 |   3,635.39 | 3,643.01 |  0.89% | 12 ms | 19 ms |  40 ms |      274,525 μs | 125.73 MiB / 130.93 MiB |
| EW-01    | NestJS + Fastify        |   1,088.87 | 1,087.94 |  0.49% | 44 ms | 51 ms |  74 ms |   916,415.27 μs | 148.12 MiB / 163.89 MiB |
| EW-02    | VextJS + Native Adapter |   1,171.54 | 1,174.17 |   0.8% | 41 ms | 55 ms |  96 ms |   833,126.42 μs | 213.5 MiB / 220.1 MiB   |
| EW-02    | Fastify                 |      1,217 | 1,215.53 |  0.31% | 39 ms | 70 ms |  82 ms |   820,775.12 μs | 172.01 MiB / 174.29 MiB |
| EW-02    | NestJS + Fastify        |     674.91 |   674.21 |  1.14% | 71 ms | 96 ms | 131 ms | 1,478,789.15 μs | 216.17 MiB / 217.73 MiB |
| EW-03    | VextJS + Native Adapter |     775.49 |   774.58 |  0.76% | 63 ms | 79 ms | 102 ms |   809,193.62 μs | 215.66 MiB / 222.3 MiB  |
| EW-03    | Fastify                 |     987.11 |   987.07 |  0.45% | 49 ms | 62 ms |  84 ms |   760,265.42 μs | 183.96 MiB / 186.78 MiB |
| EW-03    | NestJS + Fastify        |     672.48 |    671.6 |  0.64% | 72 ms | 91 ms | 124 ms | 1,481,547.85 μs | 217.02 MiB / 218.92 MiB |
| EW-04    | VextJS + Native Adapter |   2,416.87 | 2,418.45 |  0.39% | 20 ms | 23 ms |  31 ms |   410,292.91 μs | 138.89 MiB / 149.82 MiB |
| EW-04    | Fastify                 |   3,338.82 | 3,340.77 |  0.38% | 13 ms | 20 ms |  41 ms |   298,159.64 μs | 116.98 MiB / 128.09 MiB |
| EW-04    | NestJS + Fastify        |   1,063.13 | 1,059.99 |  0.81% | 46 ms | 51 ms |  74 ms |   938,971.74 μs | 144.67 MiB / 162.2 MiB  |
| EW-05    | VextJS + Native Adapter |   4,819.73 | 4,821.15 |  0.53% |  9 ms | 13 ms |  15 ms |   206,836.93 μs | 116.35 MiB / 143.95 MiB |
| EW-05    | Fastify                 |   4,235.61 | 4,233.49 |  0.62% | 10 ms | 18 ms |  40 ms |   235,781.83 μs | 114.08 MiB / 127.57 MiB |
| EW-05    | NestJS + Fastify        |   4,145.82 |  4,120.3 |  1.48% | 11 ms | 18 ms |  37 ms |   241,252.13 μs | 130.76 MiB / 158.62 MiB |
| EW-06    | VextJS + Native Adapter |   3,252.25 | 3,257.51 |   0.4% | 14 ms | 18 ms |  22 ms |   304,410.11 μs | 132.67 MiB / 148.96 MiB |
| EW-06    | Fastify                 |   4,062.03 | 4,050.96 |  1.12% | 10 ms | 20 ms |  39 ms |   245,291.63 μs | 116.63 MiB / 129.39 MiB |
| EW-06    | NestJS + Fastify        |   1,143.55 | 1,142.15 |  0.47% | 42 ms | 49 ms |  69 ms |      872,455 μs | 135.96 MiB / 161.82 MiB |

### Paired block uncertainty

The interval is a paired, block-aware percentile bootstrap (10,000 iterations, fixed seed). A conclusion is only “reliable difference” outside the pre-registered ±5% band, “practical tie” wholly inside it, otherwise inconclusive.

| Workload | Left / right               | Median ratio | 95% ratio interval | 95% RPS difference interval | Pre-registered conclusion |
| -------- | -------------------------- | -----------: | ------------------ | --------------------------- | ------------------------- |
| EW-01    | vext-native / fastify      |       0.9107 | 0.9028 – 0.9157    | -354.71 – -304.85           | reliable difference       |
| EW-01    | vext-native / nest-fastify |       3.0405 | 3.0215 – 3.0531    | 2,202.98 – 2,231.93         | reliable difference       |
| EW-01    | fastify / nest-fastify     |       3.3387 | 3.3231 – 3.3668    | 2,527.22 – 2,581.85         | reliable difference       |
| EW-02    | vext-native / fastify      |       0.9626 | 0.9569 – 0.9729    | -52.47 – -32.92             | practical tie             |
| EW-02    | vext-native / nest-fastify |       1.7359 | 1.7142 – 1.7558    | 485.57 – 510.07             | reliable difference       |
| EW-02    | fastify / nest-fastify     |       1.8032 | 1.7911 – 1.8066    | 535.27 – 543.78             | reliable difference       |
| EW-03    | vext-native / fastify      |       0.7856 | 0.7787 – 0.7901    | -218.44 – -206.78           | reliable difference       |
| EW-03    | vext-native / nest-fastify |       1.1532 | 1.1449 – 1.1618    | 97.3 – 108.41               | reliable difference       |
| EW-03    | fastify / nest-fastify     |       1.4679 | 1.462 – 1.4771     | 311.46 – 319.52             | reliable difference       |
| EW-04    | vext-native / fastify      |       0.7239 | 0.7201 – 0.7279    | -939.59 – -907.26           | reliable difference       |
| EW-04    | vext-native / nest-fastify |       2.2734 | 2.2676 – 2.2849    | 1,349.37 – 1,362.28         | reliable difference       |
| EW-04    | fastify / nest-fastify     |       3.1406 | 3.1301 – 3.1621    | 2,264.58 – 2,291.14         | reliable difference       |
| EW-05    | vext-native / fastify      |       1.1379 | 1.1332 – 1.1455    | 564.6 – 615.37              | reliable difference       |
| EW-05    | vext-native / nest-fastify |       1.1626 | 1.158 – 1.1736     | 655.08 – 715.24             | reliable difference       |
| EW-05    | fastify / nest-fastify     |       1.0217 | 1.0195 – 1.0286    | 80.77 – 117.72              | practical tie             |
| EW-06    | vext-native / fastify      |       0.8006 | 0.7996 – 0.8048    | -817.52 – -787.93           | reliable difference       |
| EW-06    | vext-native / nest-fastify |        2.844 | 2.8387 – 2.87      | 2,104.3 – 2,129.22          | reliable difference       |
| EW-06    | fastify / nest-fastify     |       3.5521 | 3.5292 – 3.5741    | 2,892.31 – 2,938.93         | reliable difference       |

### Complete formal samples

| Block | Workload | Target       | Target position |      RPS | P50 ms | P95 ms | P99 ms | Requests | Statuses    | Load CPU | Target CPU / 1K | Working set | Actual sidecar P50 / P95 / P99 |
| ----: | -------- | ------------ | --------------: | -------: | -----: | -----: | -----: | -------: | ----------- | -------: | --------------: | ----------- | ------------------------------ |
|     1 | EW-01    | vext-native  |               1 |  3,322.8 |     14 |     18 |     22 |   99,850 | 201: 99850  |   32.44% |   299,355.28 μs | 149.48 MiB  | —                              |
|     1 | EW-01    | fastify      |               2 | 3,709.86 |     12 |     19 |     40 |  111,370 | 201: 111370 |   38.21% |   266,145.51 μs | 127.29 MiB  | —                              |
|     1 | EW-01    | nest-fastify |               3 | 1,090.87 |     44 |     50 |     73 |   32,737 | 201: 32737  |   12.65% |   914,962.43 μs | 161.79 MiB  | —                              |
|     1 | EW-02    | vext-native  |               1 | 1,168.17 |     41 |     55 |     96 |   35,162 | 201: 35162  |   11.63% |   836,307.66 μs | 213.48 MiB  | 21.53 / 29.39 / 32.91 ms       |
|     1 | EW-02    | fastify      |               2 | 1,212.07 |     39 |     70 |     82 |   36,447 | 201: 36447  |   14.13% |    821,826.9 μs | 169.25 MiB  | 20.21 / 26.51 / 30.76 ms       |
|     1 | EW-02    | nest-fastify |               3 |   676.65 |     71 |     95 |    134 |   20,340 | 201: 20340  |    8.26% | 1,477,999.02 μs | 216.17 MiB  | 20.26 / 24.65 / 28.92 ms       |
|     1 | EW-03    | vext-native  |               1 |   763.15 |     64 |     80 |     98 |   23,009 | 201: 23009  |    9.17% |   882,127.65 μs | 214.3 MiB   | 43.86 / 52.78 / 54.63 ms       |
|     1 | EW-03    | fastify      |               2 |   987.11 |     49 |     62 |     82 |   29,722 | 201: 29722  |   11.16% |   769,631.92 μs | 181.56 MiB  | 40.77 / 48.28 / 52.47 ms       |
|     1 | EW-03    | nest-fastify |               3 |   671.38 |     73 |     90 |    123 |   20,195 | 201: 20195  |    8.83% | 1,482,421.39 μs | 216.88 MiB  | 40.27 / 44.98 / 49.18 ms       |
|     1 | EW-04    | vext-native  |               1 | 2,415.68 |     20 |     23 |     35 |   72,567 | 422: 72567  |   21.22% |    412,765.1 μs | 144.7 MiB   | —                              |
|     1 | EW-04    | fastify      |               2 | 3,327.58 |     13 |     20 |     41 |   99,894 | 422: 99894  |   35.39% |   299,536.26 μs | 115.5 MiB   | —                              |
|     1 | EW-04    | nest-fastify |               3 | 1,063.13 |     46 |     51 |     74 |   31,915 | 422: 31915  |    12.7% |   939,507.28 μs | 154.32 MiB  | —                              |
|     1 | EW-05    | vext-native  |               1 |  4,815.5 |      9 |     14 |     15 |  144,513 | 401: 144513 |    36.6% |   206,836.93 μs | 116.46 MiB  | —                              |
|     1 | EW-05    | fastify      |               2 | 4,234.77 |     10 |     18 |     41 |  127,170 | 401: 127170 |   36.62% |   235,781.83 μs | 113.16 MiB  | —                              |
|     1 | EW-05    | nest-fastify |               3 | 4,119.31 |     11 |     18 |     36 |  123,744 | 401: 123744 |   35.73% |   241,804.65 μs | 131.55 MiB  | —                              |
|     1 | EW-06    | vext-native  |               1 | 3,247.94 |     14 |     18 |     23 |   97,568 | 403: 97568  |    25.9% |   304,595.26 μs | 120.02 MiB  | —                              |
|     1 | EW-06    | fastify      |               2 | 4,035.86 |     11 |     20 |     40 |  121,197 | 403: 121197 |   36.84% |   246,886.27 μs | 116.36 MiB  | —                              |
|     1 | EW-06    | nest-fastify |               3 | 1,143.55 |     42 |     49 |     72 |   34,318 | 403: 34318  |   13.74% |   871,900.31 μs | 135.96 MiB  | —                              |
|     2 | EW-02    | fastify      |               1 | 1,209.08 |     39 |     71 |     82 |   36,369 | 201: 36369  |   13.45% |   824,019.08 μs | 172.32 MiB  | 20.19 / 26.57 / 30.64 ms       |
|     2 | EW-02    | nest-fastify |               2 |   674.61 |     71 |     94 |    131 |   20,299 | 201: 20299  |       8% | 1,481,754.03 μs | 215.8 MiB   | 20.25 / 24.62 / 28.36 ms       |
|     2 | EW-02    | vext-native  |               3 | 1,171.54 |     41 |     55 |     98 |   35,240 | 201: 35240  |   11.06% |   833,126.42 μs | 213.97 MiB  | 21.63 / 29.58 / 33.2 ms        |
|     2 | EW-03    | fastify      |               1 |   990.89 |     48 |     62 |     83 |   29,816 | 201: 29816  |   13.81% |   810,701.47 μs | 184.1 MiB   | 40.76 / 47.97 / 52.12 ms       |
|     2 | EW-03    | nest-fastify |               2 |   670.07 |     72 |     91 |    125 |   20,149 | 201: 20149  |     9.3% | 1,487,356.69 μs | 217.89 MiB  | 40.27 / 45.2 / 49.38 ms        |
|     2 | EW-03    | vext-native  |               3 |   768.68 |     63 |     79 |    108 |   23,168 | 201: 23168  |    7.62% |   775,584.86 μs | 212.9 MiB   | 43.9 / 52.53 / 54.52 ms        |
|     2 | EW-04    | fastify      |               1 | 3,327.71 |     13 |     21 |     41 |   99,931 | 422: 99931  |   37.25% |   299,112.64 μs | 118.15 MiB  | —                              |
|     2 | EW-04    | nest-fastify |               2 | 1,063.45 |     46 |     51 |     74 |   31,914 | 422: 31914  |   13.38% |   934,151.16 μs | 135.54 MiB  | —                              |
|     2 | EW-04    | vext-native  |               3 | 2,423.24 |     20 |     23 |     28 |   72,794 | 422: 72794  |   22.78% |   408,472.88 μs | 142.56 MiB  | —                              |
|     2 | EW-05    | fastify      |               1 | 4,235.61 |     10 |     18 |     40 |  127,153 | 401: 127153 |   36.23% |   234,953.17 μs | 113.46 MiB  | —                              |
|     2 | EW-05    | nest-fastify |               2 | 4,145.82 |     10 |     18 |     37 |  124,416 | 401: 124416 |   36.54% |   241,252.13 μs | 130.76 MiB  | —                              |
|     2 | EW-05    | vext-native  |               3 | 4,834.54 |      9 |     13 |     15 |  145,133 | 401: 145133 |   38.57% |   206,060.99 μs | 116.35 MiB  | —                              |
|     2 | EW-06    | fastify      |               1 | 4,057.31 |     11 |     20 |     39 |  121,841 | 403: 121841 |   36.99% |   245,196.61 μs | 116.45 MiB  | —                              |
|     2 | EW-06    | nest-fastify |               2 | 1,139.49 |     42 |     49 |     72 |   34,196 | 403: 34196  |   12.76% |   875,924.82 μs | 148.77 MiB  | —                              |
|     2 | EW-06    | vext-native  |               3 | 3,238.88 |     14 |     18 |     23 |   97,393 | 403: 97393  |   27.28% |   306,426.03 μs | 135.26 MiB  | —                              |
|     2 | EW-01    | fastify      |               1 | 3,615.52 |     12 |     19 |     39 |  108,538 | 201: 108538 |   37.88% |   275,105.26 μs | 125.98 MiB  | —                              |
|     2 | EW-01    | nest-fastify |               2 |  1,088.3 |     44 |     50 |     74 |   32,660 | 201: 32660  |   13.85% |   919,511.64 μs | 148.12 MiB  | —                              |
|     2 | EW-01    | vext-native  |               3 | 3,319.49 |     14 |     18 |     22 |   99,784 | 201: 99784  |   28.12% |   299,553.29 μs | 145.21 MiB  | —                              |
|     3 | EW-03    | nest-fastify |               1 |   676.89 |     72 |     89 |    122 |   20,354 | 201: 20354  |    8.31% |  1,479,285.4 μs | 218.07 MiB  | 40.26 / 45.05 / 49.2 ms        |
|     3 | EW-03    | vext-native  |               2 |   773.66 |     63 |     79 |    102 |   23,318 | 201: 23318  |    7.72% |   850,335.58 μs | 216.98 MiB  | 43.57 / 52.48 / 54.51 ms       |
|     3 | EW-03    | fastify      |               3 |   991.06 |     48 |     62 |     83 |   29,821 | 201: 29821  |   11.16% |   760,265.42 μs | 184.75 MiB  | 40.8 / 48.26 / 52.52 ms        |
|     3 | EW-04    | nest-fastify |               1 | 1,066.71 |     45 |     51 |     74 |   32,012 | 422: 32012  |   12.44% |   938,124.77 μs | 138.53 MiB  | —                              |
|     3 | EW-04    | vext-native  |               2 | 2,412.82 |     20 |     23 |     30 |   72,481 | 422: 72481  |   22.88% |   411,961.41 μs | 141.13 MiB  | —                              |
|     3 | EW-04    | fastify      |               3 | 3,342.06 |     13 |     20 |     41 |  100,362 | 422: 100362 |   36.32% |   297,672.43 μs | 117.94 MiB  | —                              |
|     3 | EW-05    | nest-fastify |               1 | 4,146.89 |     11 |     18 |     36 |  124,531 | 401: 124531 |   35.74% |   240,401.99 μs | 130.96 MiB  | —                              |
|     3 | EW-05    | vext-native  |               2 | 4,801.97 |      9 |     14 |     15 |  144,107 | 401: 144107 |   35.66% |   207,961.79 μs | 116.04 MiB  | —                              |
|     3 | EW-05    | fastify      |               3 | 4,220.12 |     10 |     18 |     40 |  126,688 | 401: 126688 |   35.34% |   236,308.88 μs | 114.92 MiB  | —                              |
|     3 | EW-06    | nest-fastify |               1 | 1,147.42 |     42 |     49 |     69 |   34,434 | 403: 34434  |   12.65% |   866,240.49 μs | 137.06 MiB  | —                              |
|     3 | EW-06    | vext-native  |               2 | 3,252.25 |     14 |     18 |     22 |   97,730 | 403: 97730  |   27.14% |   304,410.11 μs | 135.22 MiB  | —                              |
|     3 | EW-06    | fastify      |               3 | 3,939.22 |     11 |     20 |     39 |  118,216 | 403: 118216 |   35.04% |   252,715.37 μs | 117.13 MiB  | —                              |
|     3 | EW-01    | nest-fastify |               1 |  1,095.2 |     44 |     50 |     73 |   32,867 | 201: 32867  |   12.81% |   908,491.04 μs | 147.41 MiB  | —                              |
|     3 | EW-01    | vext-native  |               2 | 3,293.68 |     14 |     18 |     23 |   99,008 | 201: 99008  |   28.32% |   301,112.03 μs | 138.16 MiB  | —                              |
|     3 | EW-01    | fastify      |               3 | 3,672.72 |     12 |     19 |     40 |  110,255 | 201: 110255 |   36.22% |   270,821.05 μs | 125.73 MiB  | —                              |
|     3 | EW-02    | nest-fastify |               1 |   655.15 |     72 |    111 |    136 |   19,707 | 201: 19707  |    7.64% | 1,521,508.85 μs | 215.41 MiB  | 20.26 / 24.6 / 28.31 ms        |
|     3 | EW-02    | vext-native  |               2 | 1,177.15 |     41 |     54 |     94 |   35,397 | 201: 35397  |   12.68% |   833,845.38 μs | 210.62 MiB  | 21.64 / 29.32 / 32.73 ms       |
|     3 | EW-02    | fastify      |               3 | 1,214.96 |     39 |     70 |     83 |   36,546 | 201: 36546  |   14.96% |   820,028.18 μs | 171.52 MiB  | 20.25 / 26.48 / 30.58 ms       |
|     4 | EW-04    | vext-native  |               1 | 2,416.87 |     20 |     23 |     35 |   72,627 | 422: 72627  |   23.03% |   410,272.69 μs | 133.38 MiB  | —                              |
|     4 | EW-04    | fastify      |               2 | 3,356.46 |     13 |     20 |     41 |  100,761 | 422: 100761 |   36.59% |   296,493.68 μs | 117.79 MiB  | —                              |
|     4 | EW-04    | nest-fastify |               3 | 1,065.32 |     45 |     51 |     74 |   31,981 | 422: 31981  |   12.08% |   936,102.69 μs | 148.56 MiB  | —                              |
|     4 | EW-05    | vext-native  |               1 | 4,834.12 |      9 |     13 |     15 |  145,072 | 401: 145072 |   37.07% |   205,824.52 μs | 114.29 MiB  | —                              |
|     4 | EW-05    | fastify      |               2 | 4,235.91 |     10 |     18 |     40 |  127,162 | 401: 127162 |   34.92% |   235,796.66 μs | 114.32 MiB  | —                              |
|     4 | EW-05    | nest-fastify |               3 | 4,149.07 |     10 |     18 |     36 |  124,555 | 401: 124555 |    35.7% |   240,606.56 μs | 130.46 MiB  | —                              |
|     4 | EW-06    | vext-native  |               1 | 3,278.68 |     14 |     18 |     22 |   98,590 | 403: 98590  |   25.77% |   302,071.71 μs | 136.75 MiB  | —                              |
|     4 | EW-06    | fastify      |               2 | 4,083.88 |     10 |     20 |     39 |  122,598 | 403: 122598 |   36.22% |   244,064.95 μs | 116.18 MiB  | —                              |
|     4 | EW-06    | nest-fastify |               3 | 1,144.95 |     42 |     49 |     67 |   34,360 | 403: 34360  |   12.91% |   871,744.03 μs | 149.02 MiB  | —                              |
|     4 | EW-01    | vext-native  |               1 | 3,310.68 |     14 |     18 |     22 |   99,552 | 201: 99552  |    27.9% |   299,623.56 μs | 139.96 MiB  | —                              |
|     4 | EW-01    | fastify      |               2 | 3,599.03 |     12 |     19 |     40 |  108,007 | 201: 108007 |   39.57% |   277,325.78 μs | 124.74 MiB  | —                              |
|     4 | EW-01    | nest-fastify |               3 | 1,080.41 |     44 |     51 |     77 |   32,423 | 201: 32423  |   13.17% |   923,341.46 μs | 157.86 MiB  | —                              |
|     4 | EW-02    | vext-native  |               1 | 1,184.98 |     40 |     54 |     98 |   35,656 | 201: 35656  |    12.1% |   826,473.81 μs | 214.07 MiB  | 21.58 / 29.22 / 32.82 ms       |
|     4 | EW-02    | fastify      |               2 | 1,220.65 |     39 |     70 |     81 |   36,717 | 201: 36717  |   14.03% |   817,485.77 μs | 171.46 MiB  | 20.22 / 26.54 / 30.83 ms       |
|     4 | EW-02    | nest-fastify |               3 |   672.51 |     71 |     96 |    129 |   20,229 | 201: 20229  |       8% | 1,486,881.46 μs | 215.58 MiB  | 20.26 / 24.55 / 28.36 ms       |
|     4 | EW-03    | vext-native  |               1 |   779.52 |     63 |     79 |     99 |   23,479 | 201: 23479  |    7.32% |   795,924.02 μs | 215.34 MiB  | 43.72 / 52.45 / 54.45 ms       |
|     4 | EW-03    | fastify      |               2 |   977.38 |     49 |     64 |     84 |   29,429 | 201: 29429  |    9.96% |   767,206.67 μs | 181.19 MiB  | 40.81 / 48.46 / 52.75 ms       |
|     4 | EW-03    | nest-fastify |               3 |    673.8 |     72 |     93 |    124 |   20,268 | 201: 20268  |    8.99% |  1,469,372.9 μs | 216.26 MiB  | 40.27 / 45.1 / 49.57 ms        |
|     5 | EW-05    | fastify      |               1 | 4,236.64 |     10 |     19 |     41 |  127,184 | 401: 127184 |   37.48% |   234,773.05 μs | 112.13 MiB  | —                              |
|     5 | EW-05    | nest-fastify |               2 | 4,163.78 |     10 |     18 |     37 |  124,955 | 401: 124955 |   35.71% |   238,961.03 μs | 133.03 MiB  | —                              |
|     5 | EW-05    | vext-native  |               3 | 4,852.02 |      9 |     13 |     15 |  145,609 | 401: 145609 |   37.49% |    205,709.3 μs | 117.96 MiB  | —                              |
|     5 | EW-06    | fastify      |               1 | 4,071.13 |     10 |     20 |     39 |  122,256 | 403: 122256 |   37.41% |    244,747.7 μs | 117.13 MiB  | —                              |
|     5 | EW-06    | nest-fastify |               2 | 1,135.68 |     42 |     50 |     72 |   34,093 | 403: 34093  |    12.7% |   878,112.81 μs | 135.43 MiB  | —                              |
|     5 | EW-06    | vext-native  |               3 | 3,264.89 |     14 |     18 |     22 |   98,110 | 403: 98110  |   28.59% |   302,434.77 μs | 132.34 MiB  | —                              |
|     5 | EW-01    | fastify      |               1 | 3,630.07 |     12 |     19 |     40 |  109,011 | 201: 109011 |   36.32% |   274,914.92 μs | 126.07 MiB  | —                              |
|     5 | EW-01    | nest-fastify |               2 | 1,089.77 |     44 |     51 |     73 |   32,704 | 201: 32704  |   13.02% |   913,496.82 μs | 150.36 MiB  | —                              |
|     5 | EW-01    | vext-native  |               3 | 3,288.42 |     14 |     18 |     22 |   98,850 | 201: 98850  |   27.34% |   300,802.98 μs | 141.55 MiB  | —                              |
|     5 | EW-02    | fastify      |               1 |    1,217 |     39 |     70 |     83 |   36,583 | 201: 36583  |   13.88% |   814,073.48 μs | 172.95 MiB  | 20.22 / 26.62 / 30.9 ms        |
|     5 | EW-02    | nest-fastify |               2 |   674.64 |     71 |     98 |    130 |   20,300 | 201: 20300  |    7.11% | 1,483,220.44 μs | 215.64 MiB  | 20.26 / 24.56 / 28.51 ms       |
|     5 | EW-02    | vext-native  |               3 |  1,169.7 |     41 |     55 |     92 |   35,173 | 201: 35173  |   11.48% |   830,715.32 μs | 213.5 MiB   | 21.64 / 29.18 / 32.86 ms       |
|     5 | EW-03    | fastify      |               1 |   991.37 |     48 |     62 |     84 |   29,850 | 201: 29850  |   11.36% |   727,596.31 μs | 183.96 MiB  | 40.79 / 47.96 / 52.03 ms       |
|     5 | EW-03    | nest-fastify |               2 |   672.92 |     72 |     91 |    126 |   20,228 | 201: 20228  |    8.21% | 1,481,547.85 μs | 217.98 MiB  | 40.26 / 45.3 / 49.63 ms        |
|     5 | EW-03    | vext-native  |               3 |   775.49 |     63 |     79 |    103 |   23,381 | 201: 23381  |    6.95% |   835,347.08 μs | 217.71 MiB  | 43.85 / 52.39 / 54.52 ms       |
|     5 | EW-04    | fastify      |               1 | 3,362.33 |     13 |     20 |     41 |  100,937 | 422: 100937 |   35.65% |    296,286.3 μs | 117.34 MiB  | —                              |
|     5 | EW-04    | nest-fastify |               2 | 1,058.99 |     46 |     52 |     75 |   31,791 | 422: 31791  |   12.65% |   942,188.83 μs | 154.22 MiB  | —                              |
|     5 | EW-04    | vext-native  |               3 | 2,403.63 |     20 |     23 |     31 |   72,277 | 422: 72277  |   22.71% |   413,772.71 μs | 137.64 MiB  | —                              |
|     6 | EW-06    | nest-fastify |               1 | 1,143.64 |     42 |     49 |     69 |   34,332 | 403: 34332  |   13.79% |      872,455 μs | 151.77 MiB  | —                              |
|     6 | EW-06    | vext-native  |               2 | 3,246.44 |     14 |     18 |     22 |   97,523 | 403: 97523  |   27.25% |   306,658.43 μs | 132.67 MiB  | —                              |
|     6 | EW-06    | fastify      |               3 | 4,062.03 |     10 |     20 |     38 |  121,942 | 403: 121942 |   36.38% |   245,506.06 μs | 117.69 MiB  | —                              |
|     6 | EW-01    | nest-fastify |               1 | 1,091.47 |     44 |     51 |     74 |   32,755 | 201: 32755  |   11.92% |   915,413.68 μs | 146.41 MiB  | —                              |
|     6 | EW-01    | vext-native  |               2 | 3,315.54 |     14 |     18 |     23 |   99,665 | 201: 99665  |   29.31% |   298,029.65 μs | 139.32 MiB  | —                              |
|     6 | EW-01    | fastify      |               3 | 3,648.39 |     12 |     19 |     40 |  109,561 | 201: 109561 |   36.94% |   271,966.07 μs | 125.4 MiB   | —                              |
|     6 | EW-02    | nest-fastify |               1 |   678.13 |     71 |     96 |    131 |   20,432 | 201: 20432  |    8.61% | 1,469,049.77 μs | 217.88 MiB  | 20.26 / 24.46 / 28.36 ms       |
|     6 | EW-02    | vext-native  |               2 |    1,179 |     41 |     53 |     92 |   35,476 | 201: 35476  |   10.75% |    829,345.9 μs | 216.3 MiB   | 21.52 / 29.09 / 32.76 ms       |
|     6 | EW-02    | fastify      |               3 | 1,211.91 |     39 |     71 |     82 |   36,418 | 201: 36418  |   14.14% |   824,626.56 μs | 172.01 MiB  | 20.2 / 26.65 / 31.13 ms        |
|     6 | EW-03    | nest-fastify |               1 |   672.48 |     72 |     91 |    122 |   20,235 | 201: 20235  |    7.43% | 1,480,263.16 μs | 216.78 MiB  | 40.27 / 45.13 / 49.46 ms       |
|     6 | EW-03    | vext-native  |               2 |   775.84 |     63 |     79 |    101 |   23,345 | 201: 23345  |     6.8% |   809,193.62 μs | 215.05 MiB  | 43.75 / 52.58 / 54.39 ms       |
|     6 | EW-03    | fastify      |               3 |   988.87 |     49 |     62 |     84 |   29,765 | 201: 29765  |   12.93% |   807,366.03 μs | 185.16 MiB  | 40.8 / 48.3 / 52.39 ms         |
|     6 | EW-04    | nest-fastify |               1 | 1,064.98 |     45 |     52 |     74 |   31,960 | 422: 31960  |    12.7% |   937,695.56 μs | 144.67 MiB  | —                              |
|     6 | EW-04    | vext-native  |               2 | 2,427.24 |     20 |     23 |     29 |   72,890 | 422: 72890  |   22.74% |   410,292.91 μs | 146.34 MiB  | —                              |
|     6 | EW-04    | fastify      |               3 |  3,334.5 |     13 |     20 |     41 |  100,135 | 422: 100135 |   37.35% |   299,283.47 μs | 116.06 MiB  | —                              |
|     6 | EW-05    | nest-fastify |               1 | 4,131.26 |     11 |     18 |     37 |  124,103 | 401: 124103 |   35.78% |   241,734.69 μs | 129.34 MiB  | —                              |
|     6 | EW-05    | vext-native  |               2 | 4,778.14 |      9 |     13 |     15 |  143,392 | 401: 143392 |   35.98% |   208,889.79 μs | 138.51 MiB  | —                              |
|     6 | EW-05    | fastify      |               3 | 4,227.66 |     10 |     19 |     40 |  126,872 | 401: 126872 |   36.65% |   235,966.17 μs | 113.41 MiB  | —                              |
|     7 | EW-01    | vext-native  |               1 | 3,292.75 |     14 |     18 |     22 |   98,980 | 201: 98980  |   28.69% |   301,670.79 μs | 145.3 MiB   | —                              |
|     7 | EW-01    | fastify      |               2 | 3,635.39 |     12 |     19 |     40 |  109,098 | 201: 109098 |   35.87% |   274,552.47 μs | 125.77 MiB  | —                              |
|     7 | EW-01    | nest-fastify |               3 | 1,078.55 |     45 |     51 |     76 |   32,378 | 201: 32378  |   12.91% |   926,555.07 μs | 146.05 MiB  | —                              |
|     7 | EW-02    | vext-native  |               1 | 1,190.16 |     40 |     53 |     99 |   35,812 | 201: 35812  |   11.58% |   831,599.74 μs | 213.12 MiB  | 21.51 / 29.2 / 33.06 ms        |
|     7 | EW-02    | fastify      |               2 | 1,217.46 |     39 |     71 |     81 |   36,609 | 201: 36609  |   13.04% |   821,177.85 μs | 172.19 MiB  | 20.23 / 26.74 / 31.1 ms        |
|     7 | EW-02    | nest-fastify |               3 |   674.91 |     71 |     96 |    132 |   20,308 | 201: 20308  |    8.15% | 1,478,789.15 μs | 217.18 MiB  | 20.25 / 24.78 / 29.04 ms       |
|     7 | EW-03    | vext-native  |               1 |   773.77 |     63 |     78 |    112 |   23,329 | 201: 23329  |       7% |   780,278.84 μs | 221.47 MiB  | 43.78 / 52.49 / 54.34 ms       |
|     7 | EW-03    | fastify      |               2 |   984.82 |     49 |     63 |     84 |   29,643 | 201: 29643  |    10.8% |   735,312.72 μs | 177.73 MiB  | 40.78 / 48.29 / 52.37 ms       |
|     7 | EW-03    | nest-fastify |               3 |   663.45 |     73 |     96 |    128 |   19,983 | 201: 19983  |    7.52% |    1,502,058 μs | 217.02 MiB  | 40.27 / 45.04 / 49.22 ms       |
|     7 | EW-04    | vext-native  |               1 | 2,417.61 |     20 |     23 |     28 |   72,625 | 422: 72625  |   22.72% |   410,283.99 μs | 136.44 MiB  | —                              |
|     7 | EW-04    | fastify      |               2 | 3,338.82 |     13 |     20 |     42 |  100,198 | 422: 100198 |   35.76% |   298,159.64 μs | 116.32 MiB  | —                              |
|     7 | EW-04    | nest-fastify |               3 |  1,058.1 |     46 |     52 |     75 |   31,764 | 422: 31764  |   12.39% |   942,989.71 μs | 137.06 MiB  | —                              |
|     7 | EW-05    | vext-native  |               1 | 4,819.73 |      9 |     13 |     15 |  144,640 | 401: 144640 |   37.48% |   206,871.37 μs | 114.49 MiB  | —                              |
|     7 | EW-05    | fastify      |               2 | 4,288.27 |     10 |     18 |     40 |  128,734 | 401: 128734 |   35.91% |    231,946.3 μs | 114.63 MiB  | —                              |
|     7 | EW-05    | nest-fastify |               3 | 3,962.93 |     11 |     18 |     37 |  118,967 | 401: 118967 |   34.61% |   250,988.72 μs | 129.73 MiB  | —                              |
|     7 | EW-06    | vext-native  |               1 | 3,266.36 |     14 |     18 |     23 |   98,154 | 403: 98154  |   27.82% |   302,617.57 μs | 140.75 MiB  | —                              |
|     7 | EW-06    | fastify      |               2 | 4,091.01 |     10 |     20 |     39 |  122,853 | 403: 122853 |   36.27% |    244,067.1 μs | 118.06 MiB  | —                              |
|     7 | EW-06    | nest-fastify |               3 | 1,150.77 |     42 |     49 |     67 |   34,546 | 403: 34546  |   13.48% |   868,407.34 μs | 135.48 MiB  | —                              |
|     8 | EW-02    | fastify      |               1 | 1,218.69 |     39 |     70 |     82 |   36,646 | 201: 36646  |   14.13% |   820,775.12 μs | 172.36 MiB  | 20.2 / 26.71 / 30.95 ms        |
|     8 | EW-02    | nest-fastify |               2 |   681.42 |     70 |     95 |    130 |   20,497 | 201: 20497  |    9.45% | 1,465,915.74 μs | 216.64 MiB  | 20.25 / 24.61 / 28.69 ms       |
|     8 | EW-02    | vext-native  |               3 | 1,165.46 |     41 |     56 |     95 |   35,057 | 201: 35057  |   11.58% |   834,355.48 μs | 213.09 MiB  | 21.73 / 29.4 / 32.98 ms        |
|     8 | EW-03    | fastify      |               1 |   985.26 |     49 |     63 |     81 |   29,607 | 201: 29607  |   11.38% |   740,956.53 μs | 184.27 MiB  | 40.83 / 48.39 / 52.61 ms       |
|     8 | EW-03    | nest-fastify |               2 |   667.01 |     73 |     92 |    124 |   20,077 | 201: 20077  |    8.62% | 1,500,473.18 μs | 215.75 MiB  | 40.26 / 45.18 / 49.25 ms       |
|     8 | EW-03    | vext-native  |               3 |   778.48 |     63 |     79 |    110 |   23,479 | 201: 23479  |    6.89% |   823,209.04 μs | 220.06 MiB  | 43.71 / 52.71 / 54.59 ms       |
|     8 | EW-04    | fastify      |               1 | 3,348.63 |     13 |     20 |     41 |  100,526 | 422: 100526 |   37.79% |   297,653.09 μs | 116.98 MiB  | —                              |
|     8 | EW-04    | nest-fastify |               2 | 1,060.96 |     46 |     51 |     75 |   31,850 | 422: 31850  |   12.54% |   938,971.74 μs | 159.96 MiB  | —                              |
|     8 | EW-04    | vext-native  |               3 | 2,436.51 |     20 |     23 |     34 |   73,217 | 422: 73217  |   24.18% |   408,033.65 μs | 132.49 MiB  | —                              |
|     8 | EW-05    | fastify      |               1 | 4,237.36 |     10 |     18 |     40 |  127,248 | 401: 127248 |   34.91% |   234,409.38 μs | 114.08 MiB  | —                              |
|     8 | EW-05    | nest-fastify |               2 | 4,146.64 |     10 |     18 |     36 |  124,482 | 401: 124482 |   35.39% |   239,994.54 μs | 132.96 MiB  | —                              |
|     8 | EW-05    | vext-native  |               3 |  4,798.9 |      9 |     13 |     15 |  144,015 | 401: 144015 |   36.18% |   207,226.68 μs | 115.34 MiB  | —                              |
|     8 | EW-06    | fastify      |               1 |  4,048.4 |     11 |     20 |     38 |  121,614 | 403: 121614 |   35.42% |   246,296.68 μs | 116.09 MiB  | —                              |
|     8 | EW-06    | nest-fastify |               2 | 1,134.79 |     42 |     50 |     68 |   34,055 | 403: 34055  |   13.38% |   879,092.64 μs | 135.69 MiB  | —                              |
|     8 | EW-06    | vext-native  |               3 | 3,251.85 |     14 |     18 |     23 |   97,718 | 403: 97718  |   26.67% |   304,927.19 μs | 129.94 MiB  | —                              |
|     8 | EW-01    | fastify      |               1 | 3,630.23 |     12 |     19 |     40 |  109,052 | 201: 109052 |   35.16% |      274,525 μs | 125.54 MiB  | —                              |
|     8 | EW-01    | nest-fastify |               2 | 1,088.87 |     44 |     50 |     75 |   32,677 | 201: 32677  |   12.39% |   918,076.93 μs | 161.4 MiB   | —                              |
|     8 | EW-01    | vext-native  |               3 | 3,324.41 |     14 |     18 |     22 |   99,965 | 201: 99965  |   29.15% |   298,385.68 μs | 147.93 MiB  | —                              |
|     9 | EW-03    | nest-fastify |               1 |    676.4 |     72 |     89 |    124 |   20,346 | 201: 20346  |     9.4% | 1,473,723.34 μs | 218.04 MiB  | 40.27 / 44.96 / 48.91 ms       |
|     9 | EW-03    | vext-native  |               2 |   782.68 |     63 |     78 |     95 |   23,582 | 201: 23582  |    7.05% |   788,472.14 μs | 215.66 MiB  | 43.69 / 52.34 / 54.29 ms       |
|     9 | EW-03    | fastify      |               3 |   986.83 |     49 |     63 |     84 |   29,674 | 201: 29674  |   10.03% |   679,782.81 μs | 179.16 MiB  | 40.84 / 48.43 / 52.51 ms       |
|     9 | EW-04    | nest-fastify |               1 | 1,038.32 |     47 |     52 |     75 |   31,160 | 422: 31160  |   11.77% |    961,769.9 μs | 137.11 MiB  | —                              |
|     9 | EW-04    | vext-native  |               2 | 2,412.49 |     20 |     23 |     31 |   72,447 | 422: 72447  |   22.26% |   412,370.42 μs | 138.89 MiB  | —                              |
|     9 | EW-04    | fastify      |               3 | 3,328.85 |     13 |     20 |     41 |   99,932 | 422: 99932  |   37.47% |      299,266 μs | 115.99 MiB  | —                              |
|     9 | EW-05    | nest-fastify |               1 | 4,117.05 |     11 |     18 |     37 |  123,635 | 401: 123635 |   36.58% |   242,144.21 μs | 130.54 MiB  | —                              |
|     9 | EW-05    | vext-native  |               2 | 4,855.42 |      9 |     13 |     15 |  145,711 | 401: 145711 |    37.9% |    205,243.6 μs | 116.7 MiB   | —                              |
|     9 | EW-05    | fastify      |               3 | 4,185.11 |     10 |     19 |     41 |  125,595 | 401: 125595 |    36.6% |    238,738.6 μs | 115.96 MiB  | —                              |
|     9 | EW-06    | nest-fastify |               1 | 1,139.05 |     42 |     49 |     69 |   34,183 | 403: 34183  |   14.11% |   876,257.94 μs | 135.59 MiB  | —                              |
|     9 | EW-06    | vext-native  |               2 | 3,270.36 |     14 |     18 |     22 |   98,307 | 403: 98307  |   27.08% |   303,577.06 μs | 128.39 MiB  | —                              |
|     9 | EW-06    | fastify      |               3 | 4,069.82 |     10 |     19 |     38 |  122,176 | 403: 122176 |   35.81% |   245,291.63 μs | 116.63 MiB  | —                              |
|     9 | EW-01    | nest-fastify |               1 |    1,088 |     44 |     51 |     78 |   32,651 | 201: 32651  |   12.65% |   916,415.27 μs | 144.08 MiB  | —                              |
|     9 | EW-01    | vext-native  |               2 | 3,304.09 |     14 |     18 |     22 |   99,321 | 201: 99321  |   28.64% |   299,691.15 μs | 143.63 MiB  | —                              |
|     9 | EW-01    | fastify      |               3 | 3,645.89 |     12 |     19 |     39 |  109,486 | 201: 109486 |   36.73% |   273,294.07 μs | 125.64 MiB  | —                              |
|     9 | EW-02    | nest-fastify |               1 |   679.89 |     71 |     96 |    132 |   20,451 | 201: 20451  |    8.16% | 1,469,977.02 μs | 217.35 MiB  | 20.25 / 24.58 / 28.84 ms       |
|     9 | EW-02    | vext-native  |               2 | 1,161.33 |     41 |     56 |     96 |   34,956 | 201: 34956  |   11.37% |   834,531.27 μs | 213.79 MiB  | 21.77 / 29.54 / 33.17 ms       |
|     9 | EW-02    | fastify      |               3 | 1,217.93 |     39 |     69 |     82 |   36,623 | 201: 36623  |    13.4% |   818,730.72 μs | 170.68 MiB  | 20.23 / 26.68 / 30.91 ms       |

### Load-generator headroom calibration

| Workload | No-op RPS | No-op / max target | Load CPU | P50 / P95 / P99 |
| -------- | --------: | -----------------: | -------: | --------------- |
| EW-01    | 16,020.41 |             4.318× |   99.76% | 3 / 4 / 4 ms    |
| EW-02    | 16,080.83 |            13.174× |   99.67% | 3 / 4 / 4 ms    |
| EW-03    | 16,187.02 |            16.328× |   99.63% | 3 / 4 / 4 ms    |
| EW-04    | 16,526.86 |             4.915× |   99.11% | 3 / 4 / 4 ms    |
| EW-05    | 16,630.29 |             3.425× |   99.58% | 3 / 3 / 4 ms    |
| EW-06    |  15,853.5 |             3.875× |   99.12% | 3 / 4 / 4 ms    |

<!-- framework-native-results:end -->

## Interpretation limits

- These results do not rank every Node.js framework or predict every production
  application.
- The controlled quote sidecar validates real outbound HTTP behavior; its
  nominal 20 ms/40 ms delay is not a model of a database, Redis, network
  topology, or vendor-service latency.
- Windows process affinity reduces interference but is not physical-core
  exclusivity. The result is explicitly limited to the recorded qualified host.
- Compare only artifacts with the same formal protocol and recorded environment.
- Raw/native-core measurements remain useful internal diagnostics, but they do
  not answer this page's product-stack question and are never merged into its
  table.

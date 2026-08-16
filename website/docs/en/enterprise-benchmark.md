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

No independently accepted Windows formal artifact has been published. Smoke and pilot observations are deliberately not shown as benchmark results.

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

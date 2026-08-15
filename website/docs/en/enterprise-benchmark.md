# Framework-native product-stack API benchmark

This page compares three documented production paths for the same API contract:
VextJS with its Native adapter, direct Fastify, and NestJS hosted by Fastify.
It is a separate companion to the [Vext Adapter Matrix](/benchmark), not a
universal framework ranking.

## Current publication status

The earlier Enterprise workload suite has been removed. It used artificial
latency injection and did not establish a sufficiently comparable product-stack
contract, so its numbers are not retained as a reference.

The replacement suite is implemented as `framework-native-product-stack-enterprise-api`.
Its `linux-x64-v1` protocol is currently `pilot-required`; therefore no formal
cross-framework number is published below. A local smoke or pilot proves the
implementation and conformance only. It is intentionally non-citable until a
clean Linux x64 qualification pilot is reviewed and the protocol is accepted.

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

Every target implements `POST /api/users/:userId/orders` and the same five
workloads. The runner proves the observable contract before it measures rate.

| Shared requirement               | Contract held constant                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correlation                      | `x-request-id`, tenant, and trace values propagate into the success/error envelope and the controlled outbound request.                                        |
| Authentication and authorization | A valid signed JWT creates an order; a missing JWT returns 401; a valid read-only JWT returns 403.                                                             |
| Validation                       | An authenticated invalid `quantity` returns 422 before a repository write.                                                                                     |
| Success semantics                | A 201 response has the same business order, pricing checksum, totals, and response security headers.                                                           |
| Side effects                     | Exactly one in-memory repository write for a success; no write for every failure.                                                                              |
| Structured logging               | Each target emits its normal structured event to an in-process discard sink, so terminal or disk I/O does not decide the comparison.                           |
| External I/O                     | The external-success workload makes one real TCP/HTTP request to an owned local quote sidecar. The sidecar is not presented as a database or Redis substitute. |
| Negative probes                  | Wrong method, wrong content type, and malformed JWT must all reject and produce no write. They are conformance probes, not measured workloads.                 |

The three target implementations are intentionally framework-native:

| Capability          | VextJS + Native Adapter                                     | Fastify                    | NestJS + Fastify                                                            |
| ------------------- | ----------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| Request context     | Vext request ID and built-in AsyncLocalStorage context      | `@fastify/request-context` | Nest AsyncLocalStorage middleware recipe                                    |
| JWT and permission  | Vext `auth()` plus `jose` verification and route permission | `@fastify/jwt` route hook  | `@nestjs/jwt` in a `CanActivate` guard                                      |
| Validation          | Vext compiled route validation                              | Fastify route JSON Schema  | `ValidationPipe`, DTO decorators, `class-validator` and `class-transformer` |
| Service composition | Startup-loaded Vext services                                | Startup-composed closures  | Provider constructor injection                                              |
| Security headers    | Vext `securityHeaders: basic`                               | `@fastify/helmet`          | `@fastify/helmet` on the Fastify host                                       |

“Official implementation” here means a documented or recommended production
path. It does not artificially restrict a framework to first-party npm package
ownership: maintained ecosystem integrations are valid when their maintainer or
framework documentation recommends them. The accepted artifact records the exact
implementation manifest and versions that were actually executed.

## Workloads

| ID                      | Expected status | What runs                                                                                                                                                                                   |
| ----------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `success-cpu`           |             201 | JWT verification, authorization, request context, validation, controller/service composition, small deterministic pricing work, repository write, response headers, and structured logging. |
| `success-external-http` |             201 | The same path plus one controlled outbound HTTP quote request.                                                                                                                              |
| `validation-422`        |             422 | Valid JWT and permission followed by rejected body validation; no business write.                                                                                                           |
| `authentication-401`    |             401 | Missing JWT rejection before authorization, validation, or business handling.                                                                                                               |
| `authorization-403`     |             403 | Valid JWT without the order-write role rejected before validation or business handling.                                                                                                     |

## Correctness before throughput

Conformance runs with test-only observation enabled. It verifies response status,
headers, correlation, expected side effects, the real quote-sidecar call, and
framework-native capability execution for every target. It then compares a
versioned canonical semantic projection using SHA-256.

The semantic hash deliberately does **not** compare raw response bytes. JSON
whitespace, key order, framework-specific serialization details, and generated
repository IDs are not a fairness requirement. Status, media type, required
security headers, correlation, business order semantics, error kind, and rejected
field set are canonicalized and hashed instead.

Only after that proof passes does the runner restart fresh targets and the quote
sidecar with per-request test telemetry disabled. Rate measurement cannot contain
test counter updates. The runner rotates target order each round, rejects HTTP
errors/timeouts/unexpected status distributions, records P50/P97.5/P99, and
applies the protocol CV gate.

## Formal protocol and reproducibility

The candidate `linux-x64-v1` protocol fixes 50 connections, pipelining 1, a
10-second warmup, a 30-second measurement window, seven rotated rounds, and a
maximum RPS CV of 15%. A formal run additionally requires:

- accepted protocol status after a qualification pilot;
- clean source provenance on Linux x64;
- explicitly declared, non-overlapping load-generator and target CPU sets;
- exact installed versions matching `package.json`, lockfile, and npm `latest`;
- conformance pass for all five workloads and three negative probes.

```bash
# Build once; a fast implementation/conformance smoke on any supported host.
npm run build
npm run test:bench:enterprise -- --smoke

# A local pilot is evidence only and never becomes documentation data.
npm run test:bench:enterprise -- --pilot

# After protocol acceptance, run the fixed formal shape on Linux x64.
taskset -c 4-7 node test/benchmark/framework-native/run-framework-native-suite.mjs \
  --formal --load-cpus 4-7 --target-cpus 0-3

# Project an accepted formal artifact into this same page, or verify it has not drifted.
npm run generate:enterprise-benchmark-docs
npm run verify:enterprise-benchmark-docs
```

The documentation generator does not project a non-citable artifact. When an accepted
formal run exists, this page will contain its exact framework versions, source
identity, environment, semantic hashes, summary, and every round sample — no
GitHub-only handoff and no separate results page.

<!-- framework-native-results:start -->

## Accepted formal result

No accepted formal artifact has been published yet.

<!-- framework-native-results:end -->

## Interpretation limits

- These results do not rank every Node.js framework or predict every production
  application.
- The controlled quote sidecar validates real outbound HTTP behavior; it does
  not model a database, Redis, network topology, or vendor service latency.
- Compare only artifacts with the same formal protocol and recorded environment.
- Raw/native-core measurements remain useful internal diagnostics, but they do
  not answer this page's product-stack question and are never merged into its
  table.

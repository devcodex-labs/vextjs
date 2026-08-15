# Enterprise workload benchmark

This page is the cross-stack, production-shaped companion to the [Vext Adapter Matrix](/benchmark). It compares equivalent API semantics across Vext Native, direct Fastify, and Nest hosted by the same Fastify version. It is deliberately **not** a universal framework league table.

## Why this is not a raw benchmark

Raw HTTP or routing measurements are valuable maintenance diagnostics: they answer how fast the shortest possible route is. They deliberately remove request correlation, authentication, validation, structured logging, service composition, error handling, and a repository boundary. Those are precisely the capabilities that make a production framework choice meaningful.

This suite instead holds the externally observable API contract constant and lets each stack use its normal mechanisms. Vext uses its formal bootstrap, request context, auth middleware and route guard, compiled route validation, service loader, access log, security headers, and Native adapter. Fastify uses its hooks, JSON Schema validation, service composition, and Pino logging. Nest receives the root Fastify instance through `new FastifyAdapter(raw)`, then adds Nest providers, Guard, Pipes, Interceptor, and exception Filter; the runner records both host versions and rejects a mismatch.

The result is more useful for a production decision than bare throughput, but it must not be read as a claim that one framework is universally faster. Use the [Adapter Matrix](/benchmark) when the question is “which Vext adapter should I choose?” Use this page when the question is “how do these three stacks behave under the same production-shaped API contract?”

## Scope and fairness contract

| Constant across targets                                                                                       | What may differ naturally                                                     |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/users/:userId/orders`, JSON body, bearer authentication, request/tenant/trace headers              | Internal middleware count and dependency graph                                |
| 201 success envelope; 401 missing auth; 403 denied permission; 422 invalid body; rejected method/content type | Validation and error-serialization implementation                             |
| Exactly one repository write on success; no write on failure; reset and telemetry endpoints                   | DI model: Vext service loader, Fastify startup composition, or Nest providers |
| Request correlation, security headers, structured logging, latency injection, resource telemetry              | Framework-specific API shape                                                  |

The workloads are intentionally small but not “bare”: each one exercises a request context, authentication and authorization, validation, service composition, structured logging, security headers, an in-memory repository boundary, and response/error handling. Each target emits the same kind of structured log event to a discard sink, so host console or disk I/O cannot dominate a framework comparison. The 1 ms and 5 ms cases are deterministic non-blocking latency injection, not claims about a real database or Redis server.

Hono is intentionally deferred to Phase 2. This repository does not yet have an evidenced Hono validation and service-composition architecture that could meet the contract without a temporary substitute; adding one now would make the comparison less fair, not more complete.

### Target runtime versions

The currently pinned implementation uses VextJS **1.0.1**, Fastify **5.12.0**, Nest `@nestjs/common` / `@nestjs/core` / `@nestjs/platform-fastify` **11.2.1**, `reflect-metadata` **0.2.2**, `rxjs` **7.8.2**, and Autocannon **8.0.0**. The runner checks each benchmark dependency against npm `latest` before it runs, proves that the direct Fastify and Nest hosts report that exact Fastify version, and repeats all exact versions in every accepted formal result.

## Workloads

| ID                    | Request outcome | What it exercises                                                                     |
| --------------------- | --------------- | ------------------------------------------------------------------------------------- |
| `success-cpu`         | 201             | Complete success path with deterministic small pricing work and one repository write. |
| `success-latency-1ms` | 201             | The same success path plus 1 ms non-blocking latency injection.                       |
| `success-latency-5ms` | 201             | The same success path plus 5 ms non-blocking latency injection.                       |
| `validation-failure`  | 422             | Authenticated invalid body rejected before a repository write.                        |

<!-- enterprise-results:start -->

## Current formal results

No accepted formal artifact has been published yet. Windows local runs and pilot runs are useful for implementation verification, but this page does not present them as public benchmark data.

An accepted result requires a clean Vext source revision, Linux x64, a pilot-frozen current-LTS Node.js major, exact current dependencies, 50 connections with pipelining 1, at least 10 seconds of warmup and 30 seconds of measurement across at least 7 rotating rounds, a pilot-frozen CV gate, zero errors/timeouts/unexpected status responses, and non-overlapping load-generator and target CPU sets (or separate hosts).

<!-- enterprise-results:end -->

<!-- enterprise-raw-diagnostics:start -->

## Raw-path diagnostic reference (not a production ranking)

No raw-path diagnostic artifact matching a formal result has been published yet. It will appear on this page only when the clean commit, Node.js, Linux platform, CPU model, memory, and key versions match and both artifacts were recorded within 24 hours; historical or Windows-local numbers are never mixed in.

<!-- enterprise-raw-diagnostics:end -->

## Formal protocol

The formal runner refuses to create a citable artifact unless all of the following are true:

- the source worktree is clean and the artifact records its revision;
- the host is Linux x64, a qualifying pilot records the Node.js major and proposes the CV gate using the same frozen workload shape, and the runner verifies the runner and every target's effective CPU affinity;
- all target packages match the npm `latest` versions verified for the run;
- all targets complete the same semantic conformance suite before load begins;
- the protocol is frozen from a reviewed pilot, then uses 50 connections, pipelining 1, at least 10 seconds of warmup, at least 30 seconds per measurement, and at least 7 rotating rounds;
- every workload records RPS, P50/P95/P99, errors, timeouts, status distribution, CPU time, CPU per 1K requests, RSS, peak RSS, exact versions, and provenance.

The full formal sample and any matching raw-path diagnostic samples are generated into this page in both languages. They are intentionally never replaced by a GitHub-only link or a separate results page.

## Reproduce

Quick local runs are implementation checks only:

```bash
npm ci
npm run build
npm run test:bench:enterprise -- --pilot
```

Run a qualification pilot on the actual Linux x64 host with the same workload shape, clean source, and non-overlapping CPU sets that the formal run will use:

```bash
taskset -c 4-7 node test/benchmark/enterprise/run-enterprise-suite.mjs \
  --qualification-pilot --load-cpus 4-7 --target-cpus 0-3
```

Review that artifact, then explicitly freeze its Node.js major and approved CV gate in `test/benchmark/enterprise/protocols/linux-x64-v1.json`. Only then run the formal suite and its matching raw-path diagnostic:

```bash
taskset -c 4-7 node test/benchmark/enterprise/run-enterprise-suite.mjs \
  --formal --load-cpus 4-7 --target-cpus 0-3

node --expose-gc --max-old-space-size=512 test/benchmark/run-native-fairness.mjs \
  --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 \
  --rounds 5 --max-cv 15 --process-priority 0 --handler-mode sync \
  --require-complete-matrix

npm run generate:enterprise-benchmark-docs
npm run verify:enterprise-benchmark-docs
```

The generator rejects local, quick-pilot, qualification-pilot, dirty-source, incomplete, unstable, non-Linux, or mismatched raw diagnostics. This prevents a convenient local number from silently becoming documentation evidence, while keeping a reproducible shortest-path reference beside—not inside—the production-shaped conclusion.

import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { assertObservedSideEffects } from "./observation.mjs";
import {
  CONFORMANCE_ONLY_PROBES,
  FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION,
  FRAMEWORK_NATIVE_V2_SUITE_ID,
  TARGETS,
  TIMED_WORKLOADS,
  createBenchmarkTokens,
  createProbeRequest,
  createRequest,
  expectedSideEffects,
  semanticResponseHash,
} from "./contract.mjs";
import {
  findAvailablePort,
  requestJson,
  requestProcessMessage,
  sleep,
  startOwnedProcess,
  stopOwnedProcess,
} from "./process-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../../../..");
const targetEntries = Object.freeze({
  "vext-native": join(__dirname, "targets", "vext-native-conformance.mjs"),
  fastify: join(__dirname, "targets", "fastify-conformance.mjs"),
  "nest-fastify": join(__dirname, "targets", "nest-fastify-conformance.mjs"),
});
const sidecarEntry = join(__dirname, "quote-sidecar.mjs");

function assert(condition, message) {
  if (!condition)
    throw new Error(`Framework-native v2 conformance failure: ${message}`);
}

function isAddressCollision(error) {
  return String(error?.message ?? error).includes("EADDRINUSE");
}

async function startTarget(target, externalUrl) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findAvailablePort();
    try {
      return await startOwnedProcess({
        entry: targetEntries[target.id],
        label: `${target.id} conformance target`,
        cwd: projectRoot,
        env: { PORT: String(port), BENCHMARK_EXTERNAL_URL: externalUrl },
        readyTimeoutMs: 30_000,
      });
    } catch (error) {
      lastError = error;
      if (!isAddressCollision(error)) throw error;
    }
  }
  throw lastError;
}

async function snapshotAfterLogs(target) {
  // Pino/adapter completion is asynchronous relative to fetch completion.
  await sleep(30);
  const message = await requestProcessMessage(target, "snapshot");
  return message.observer;
}

function requestUrl(target) {
  return `http://127.0.0.1:${target.ready.port}/api/users/10001/orders`;
}

async function runCase({ target, testCase, tokens }) {
  const requestId = `conformance-${testCase.id}`;
  const request =
    testCase.kind === "timed"
      ? createRequest(testCase.expectation, tokens, requestId)
      : createProbeRequest(testCase.expectation, tokens, requestId);
  await requestProcessMessage(target, "reset");
  const response = await requestJson(requestUrl(target), request);
  const semantic = semanticResponseHash(
    response,
    request,
    testCase.expectation,
  );
  const observer = await snapshotAfterLogs(target);
  const sideEffects = assertObservedSideEffects(observer, {
    requestId,
    expected: expectedSideEffects(testCase.expectation),
    expectedStatus: testCase.expectation.expectedStatus,
  });
  return { algorithm: semantic.algorithm, hash: semantic.hash, sideEffects };
}

function countEvents(observer, kind) {
  return Number(observer.counts?.[kind] ?? 0);
}

async function runConcurrentDistinctIds({ target, tokens }) {
  const workload = TIMED_WORKLOADS[0];
  const requests = Array.from({ length: 20 }, (_unused, index) =>
    createRequest(workload, tokens, `concurrency-${index + 1}`),
  );
  await requestProcessMessage(target, "reset");
  const responses = await Promise.all(
    requests.map((request) => requestJson(requestUrl(target), request)),
  );
  for (const [index, response] of responses.entries()) {
    semanticResponseHash(response, requests[index], workload);
  }
  const observer = await snapshotAfterLogs(target);
  assert(
    countEvents(observer, "repositoryRead") === requests.length,
    `${target.label} concurrent read count is not ${requests.length}`,
  );
  assert(
    countEvents(observer, "repositoryWrite") === requests.length,
    `${target.label} concurrent write count is not ${requests.length}`,
  );
  assert(
    countEvents(observer, "quote") === 0,
    `${target.label} CPU concurrent batch unexpectedly called quote service`,
  );
  const accessLogs = observer.events.filter(
    (event) => event.kind === "accessLog" && event.statusCode === 201,
  );
  assert(
    accessLogs.length === requests.length,
    `${target.label} concurrent batch access logs are incomplete`,
  );
  const ids = new Set(accessLogs.map((event) => event.requestId));
  assert(
    ids.size === requests.length,
    `${target.label} concurrent batch lost request-id correlation`,
  );
}

async function runDuplicateRequestIdProbe({ target, tokens }) {
  const workload = TIMED_WORKLOADS[0];
  const requestId = "duplicate-request-id";
  const requests = ["a", "b"].map((suffix) => {
    const request = createRequest(workload, tokens, requestId);
    request.headers["x-tenant-id"] = `duplicate-tenant-${suffix}`;
    request.headers["x-trace-id"] = `duplicate-trace-${suffix}`;
    return request;
  });
  await requestProcessMessage(target, "reset");
  const responses = await Promise.all(
    requests.map((request) => requestJson(requestUrl(target), request)),
  );
  for (const [index, response] of responses.entries()) {
    semanticResponseHash(response, requests[index], workload);
    assert(
      response.body?.meta?.tenantId === requests[index].headers["x-tenant-id"],
      `${target.label} leaked tenant context for duplicate request IDs`,
    );
    assert(
      response.body?.meta?.traceId === requests[index].headers["x-trace-id"],
      `${target.label} leaked trace context for duplicate request IDs`,
    );
  }
  const orderIds = responses.map((response) => response.body?.data?.order?.id);
  assert(
    new Set(orderIds).size === requests.length,
    `${target.label} duplicate request IDs reused one order result`,
  );
  const observer = await snapshotAfterLogs(target);
  assert(
    countEvents(observer, "repositoryRead") === requests.length &&
      countEvents(observer, "repositoryWrite") === requests.length,
    `${target.label} duplicate request IDs lost business side effects`,
  );
  const accessLogs = observer.events.filter(
    (event) => event.kind === "accessLog" && event.requestId === requestId,
  );
  assert(
    accessLogs.length === requests.length,
    `${target.label} duplicate request IDs lost access-log events`,
  );
}

async function verifySidecarDelay(nominalDelayMs) {
  let sidecar;
  try {
    sidecar = await startOwnedProcess({
      entry: sidecarEntry,
      label: `quote sidecar ${nominalDelayMs}ms qualification`,
      cwd: projectRoot,
      env: { PORT: "0", BENCHMARK_QUOTE_DELAY_MS: String(nominalDelayMs) },
    });
    const request = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "QUALIFICATION-SKU", quantity: 1 },
    };
    const endpoint = `http://127.0.0.1:${sidecar.ready.port}/quote`;
    for (let index = 0; index < 64; index += 1) {
      const response = await requestJson(endpoint, request);
      assert(
        response.status === 200,
        `quote sidecar ${nominalDelayMs}ms returned HTTP ${response.status}`,
      );
    }
    const snapshot = await requestProcessMessage(sidecar, "snapshot");
    const actual = snapshot.sidecar?.actualDelayMs;
    assert(
      snapshot.sidecar?.samples === 64,
      `quote sidecar ${nominalDelayMs}ms lost samples`,
    );
    assert(
      actual?.p50 >= nominalDelayMs * 0.75,
      `quote sidecar ${nominalDelayMs}ms p50 under-ran`,
    );
    assert(
      actual?.p95 <= nominalDelayMs + 30,
      `quote sidecar ${nominalDelayMs}ms p95 exceeded gate`,
    );
    assert(
      actual?.p99 <= nominalDelayMs + 60,
      `quote sidecar ${nominalDelayMs}ms p99 exceeded gate`,
    );
    return snapshot.sidecar;
  } finally {
    await stopOwnedProcess(sidecar);
  }
}

async function runTargetConformance({ target, sidecarUrl, tokens }) {
  let owned;
  try {
    owned = await startTarget(target, sidecarUrl);
    const cases = [
      ...TIMED_WORKLOADS.map((expectation) => ({
        kind: "timed",
        expectation,
        id: expectation.id,
      })),
      ...CONFORMANCE_ONLY_PROBES.map((expectation) => ({
        kind: "probe",
        expectation,
        id: expectation.id,
      })),
    ];
    const hashes = {};
    for (const testCase of cases) {
      hashes[testCase.id] = await runCase({ target: owned, testCase, tokens });
    }
    await runConcurrentDistinctIds({ target: owned, tokens });
    await runDuplicateRequestIdProbe({ target: owned, tokens });
    return hashes;
  } finally {
    await stopOwnedProcess(owned);
  }
}

function assertCrossTargetHashes(results) {
  const allCaseIds = [
    ...TIMED_WORKLOADS.map((workload) => workload.id),
    ...CONFORMANCE_ONLY_PROBES.map((probe) => probe.id),
  ];
  for (const caseId of allCaseIds) {
    const hashes = new Set(
      TARGETS.map((target) => results[target.id][caseId].hash),
    );
    assert(
      hashes.size === 1,
      `${caseId} canonical semantic hashes differ by target`,
    );
  }
}

export async function runConformance() {
  const sidecarDelays = {
    "20ms": await verifySidecarDelay(20),
    "40ms": await verifySidecarDelay(40),
  };
  assert(
    sidecarDelays["40ms"].actualDelayMs.p50 -
      sidecarDelays["20ms"].actualDelayMs.p50 >=
      8,
    "quote sidecar 20ms/40ms modes are not distinguishable on this Windows host",
  );
  const tokens = await createBenchmarkTokens();
  let sidecar;
  try {
    sidecar = await startOwnedProcess({
      entry: sidecarEntry,
      label: "conformance quote sidecar",
      cwd: projectRoot,
      env: { PORT: "0", BENCHMARK_QUOTE_DELAY_MS: "0" },
    });
    const sidecarUrl = `http://127.0.0.1:${sidecar.ready.port}`;
    const results = {};
    for (const target of TARGETS) {
      results[target.id] = await runTargetConformance({
        target,
        sidecarUrl,
        tokens,
      });
    }
    assertCrossTargetHashes(results);
    const semanticHashes = Object.fromEntries(
      TIMED_WORKLOADS.map((workload) => [
        workload.id,
        {
          algorithm: results[TARGETS[0].id][workload.id].algorithm,
          hash: results[TARGETS[0].id][workload.id].hash,
        },
      ]),
    );
    return {
      suite: FRAMEWORK_NATIVE_V2_SUITE_ID,
      protocolVersion: FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION,
      status: "PASS",
      sidecarDelays,
      semanticHashing: {
        canonicalized: true,
        rawSerializedBytesCompared: false,
        workloads: semanticHashes,
      },
      targets: results,
    };
  } finally {
    await stopOwnedProcess(sidecar);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runConformance()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

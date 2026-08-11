import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  getResponseSerializerDiagnostics,
  prepareRouteResponseSerializers,
  resetResponseSerializerStateForTesting,
  stringifyRouteResponse,
} from "../../dist/lib/response-serializer.js";

const iterations = Number(
  process.env.VEXT_RESPONSE_BENCH_ITERATIONS ?? 100_000,
);
assert.ok(Number.isInteger(iterations) && iterations > 0);

resetResponseSerializerStateForTesting();
const options = {
  responses: {
    200: {
      schema: {
        id: "integer!",
        name: "string!",
        profile: { active: "boolean!", label: "string!" },
      },
    },
  },
};
const serializers = prepareRouteResponseSerializers(options, {
  method: "GET",
  path: "/benchmark",
  sourceFile: "scripts/validation/benchmark-response-serialization.mjs",
});
assert.ok(serializers);
assert.deepEqual(getResponseSerializerDiagnostics(), {
  routeOptionsCompiled: 1,
  serializerFunctionsCompiled: 2,
});

const payload = {
  code: 0,
  data: {
    id: 42,
    name: "Ada",
    ignored: "projected",
    profile: { active: true, label: "runtime", secret: "projected" },
  },
  requestId: "bench-request",
  internal: "projected",
};

for (let index = 0; index < 5_000; index += 1) {
  stringifyRouteResponse(serializers, 200, payload, true);
  JSON.stringify(payload);
}

const compiledStart = performance.now();
let compiledBytes = 0;
for (let index = 0; index < iterations; index += 1) {
  compiledBytes += stringifyRouteResponse(
    serializers,
    200,
    payload,
    true,
  ).length;
}
const compiledMs = performance.now() - compiledStart;

const baselineStart = performance.now();
let baselineBytes = 0;
for (let index = 0; index < iterations; index += 1) {
  baselineBytes += JSON.stringify(payload).length;
}
const baselineMs = performance.now() - baselineStart;

const output = stringifyRouteResponse(serializers, 200, payload, true);
assert.deepEqual(JSON.parse(output), {
  code: 0,
  data: {
    id: 42,
    name: "Ada",
    profile: { active: true, label: "runtime" },
  },
  requestId: "bench-request",
});

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      benchmark: "compiled-route-response-serialization",
      iterations,
      registration: getResponseSerializerDiagnostics(),
      compiled: {
        totalMs: Number(compiledMs.toFixed(3)),
        operationsPerSecond: Math.round((iterations / compiledMs) * 1_000),
        bytes: compiledBytes,
      },
      jsonStringifyBaseline: {
        totalMs: Number(baselineMs.toFixed(3)),
        operationsPerSecond: Math.round((iterations / baselineMs) * 1_000),
        bytes: baselineBytes,
      },
    },
    null,
    2,
  ),
);

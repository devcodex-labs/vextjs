import assert from "node:assert/strict";

import {
  CONFORMANCE_ONLY_PROBES,
  REQUIRED_SECURITY_HEADERS,
  TARGETS,
  TIMED_WORKLOADS,
  createRequest,
  getTimedWorkload,
  projectSemanticResponse,
} from "./contract.mjs";
import { roundMetric } from "./artifact-utils.mjs";
import {
  WINDOWS_V2_PROTOCOL,
  createBalancedBlockSchedule,
  scheduleMeasurements,
} from "./protocol.mjs";
import {
  validateCalibration,
  validateConformance,
  validateHostQualification,
  validateSample,
} from "./validate-artifact.mjs";
import { selectRoleCores } from "./windows-affinity.mjs";

const protocol = WINDOWS_V2_PROTOCOL;
const roleCpuSets = { load: "0", target: "1", dependency: "2", control: "3" };
const semantic = {
  algorithm: "sha256-c14n-json-v1",
  hash: "a".repeat(64),
};
const descriptors = scheduleMeasurements(createBalancedBlockSchedule());

function validationHeaders(requestId) {
  return {
    "content-type": "application/json",
    "x-request-id": requestId,
    ...REQUIRED_SECURITY_HEADERS,
  };
}

function affinity(pid, cpuSet) {
  return [{ pid, cpuSet }];
}

function preStartedProcess(pid, port) {
  const processRecord = {
    pid,
    awaitingStart: { pid },
    ready: { pid },
  };
  if (port !== undefined) {
    processRecord.port = port;
    processRecord.ready.port = port;
  }
  return processRecord;
}

function validMeasurement(descriptor) {
  const workload = TIMED_WORKLOADS.find(
    (entry) => entry.id === descriptor.workloadId,
  );
  const completedRequests = 300;
  const durationSeconds = 30;
  return {
    ...descriptor,
    target: {
      ...preStartedProcess(101, 41101),
      affinityBefore: affinity(101, roleCpuSets.target),
    },
    sidecar: {
      ...preStartedProcess(102, 41102),
      affinityBefore: affinity(102, roleCpuSets.dependency),
      snapshot:
        workload.quoteDelayMs === 0
          ? { nominalDelayMs: 0, samples: 0, actualDelayMs: {} }
          : {
              nominalDelayMs: workload.quoteDelayMs,
              samples: 300,
              actualDelayMs: {
                p50: workload.quoteDelayMs + 5,
                p95: workload.quoteDelayMs + 10,
                p99: workload.quoteDelayMs + 15,
              },
            },
    },
    load: {
      ...preStartedProcess(103),
      affinityBefore: affinity(103, roleCpuSets.load),
      cpuUtilizationPercent: 50,
    },
    measurementTargetSemantic: semantic,
    affinityAfter: {
      target: affinity(101, roleCpuSets.target),
      sidecar: affinity(102, roleCpuSets.dependency),
      load: affinity(103, roleCpuSets.load),
    },
    measurement: {
      completedRequests,
      rps: roundMetric(completedRequests / durationSeconds),
      latency: { samples: completedRequests, p50: 2, p95: 5, p99: 8 },
      statusCounts: { [String(workload.expectedStatus)]: completedRequests },
      requestFactory: {
        mode: "autocannon-requests-setupRequest",
        prefix: `${protocol.id}-b${descriptor.block}-${descriptor.targetId}-${descriptor.workloadId}-measure`,
        generatedRequestIds: completedRequests + 2,
      },
      requestErrors: 0,
      autocannon: { durationSeconds, errors: 0, timeouts: 0, resets: 0 },
    },
    cleanup: [
      { exitCode: 0, signalCode: null },
      { exitCode: 0, signalCode: null },
      { exitCode: 0, signalCode: null },
    ],
  };
}

function validCalibration(workload) {
  const completedRequests = 900;
  const durationSeconds = 30;
  return {
    workloadId: workload.id,
    completedRequests,
    rps: roundMetric(completedRequests / durationSeconds),
    latency: { samples: completedRequests, p50: 1, p95: 3, p99: 5 },
    statusCounts: { 201: completedRequests },
    requestFactory: {
      mode: "autocannon-requests-setupRequest",
      prefix: `${protocol.id}-headroom-${workload.id}-measure`,
      generatedRequestIds: completedRequests + 1,
    },
    requestErrors: 0,
    autocannon: { durationSeconds, errors: 0, timeouts: 0, resets: 0 },
    target: {
      ...preStartedProcess(201, 41201),
      affinityBefore: affinity(201, roleCpuSets.target),
    },
    load: {
      ...preStartedProcess(202),
      affinityBefore: affinity(202, roleCpuSets.load),
      cpuUtilizationPercent: 50,
    },
    affinityAfter: {
      target: affinity(201, roleCpuSets.target),
      load: affinity(202, roleCpuSets.load),
    },
    cleanup: [
      { exitCode: 0, signalCode: null },
      { exitCode: 0, signalCode: null },
    ],
  };
}

function validHostQualification() {
  const host = {
    logicalCpuCount: 8,
    powerPlan: "Balanced",
    physicalCores: [0, 1, 2, 3].map((cpu) => ({
      id: `core-${cpu}`,
      group: 0,
      logicalCpus: [cpu],
    })),
  };
  const background = {
    cpus: [0, 1, 2, 3].map((cpu) => ({ cpu, average: 1, max: 2, samples: 60 })),
  };
  const selection = selectRoleCores(host, background);
  return {
    status: "PASS",
    reasons: [],
    host,
    background,
    roleCpuSets,
    roleBackground: Object.fromEntries(
      Object.entries(roleCpuSets).map(([role, cpuSet]) => [
        role,
        {
          maxLogicalCpuAverage: 1,
          details: [{ cpu: Number(cpuSet), average: 1 }],
        },
      ]),
    ),
    roleSelection: {
      method:
        "all-safe-physical-cores-sampled; lowest-background-average-then-logical-cpu-selected",
      candidates: selection.candidates,
    },
    policy: { backgroundSeconds: 60, maxBackgroundPercent: 10 },
  };
}

function validConformance() {
  const testIds = [
    ...TIMED_WORKLOADS.map((entry) => entry.id),
    ...CONFORMANCE_ONLY_PROBES.map((entry) => entry.id),
  ];
  return {
    suite: "framework-native-enterprise-api-windows-v2",
    protocolVersion: 4,
    status: "PASS",
    semanticHashing: {
      canonicalized: true,
      rawSerializedBytesCompared: false,
      workloads: Object.fromEntries(
        TIMED_WORKLOADS.map((workload) => [workload.id, semantic]),
      ),
    },
    sidecarDelays: {
      "20ms": {
        nominalDelayMs: 20,
        samples: 64,
        actualDelayMs: { p50: 25, p95: 30, p99: 35 },
      },
      "40ms": {
        nominalDelayMs: 40,
        samples: 64,
        actualDelayMs: { p50: 45, p95: 50, p99: 55 },
      },
    },
    targets: Object.fromEntries(
      TARGETS.map((target) => [
        target.id,
        Object.fromEntries(testIds.map((id) => [id, { hash: "a".repeat(64) }])),
      ]),
    ),
  };
}

const cpuDescriptor = descriptors.find((entry) => entry.workloadId === "EW-01");
const ioDescriptor = descriptors.find((entry) => entry.workloadId === "EW-02");
assert.deepEqual(
  validateSample(
    validMeasurement(cpuDescriptor),
    cpuDescriptor,
    roleCpuSets,
    protocol,
    semantic,
  ),
  [],
);
assert.ok(
  validateSample(
    {
      ...validMeasurement(cpuDescriptor),
      measurement: {
        ...validMeasurement(cpuDescriptor).measurement,
        statusCounts: { 500: 300 },
      },
    },
    cpuDescriptor,
    roleCpuSets,
    protocol,
    semantic,
  ).length > 0,
  "unexpected status distribution must fail",
);
assert.ok(
  validateSample(
    {
      ...validMeasurement(ioDescriptor),
      sidecar: {
        ...validMeasurement(ioDescriptor).sidecar,
        snapshot: {
          nominalDelayMs: 20,
          samples: 300,
          actualDelayMs: { p50: 1, p95: 2, p99: 3 },
        },
      },
    },
    ioDescriptor,
    roleCpuSets,
    protocol,
    semantic,
  ).length > 0,
  "under-running sidecar delay must fail",
);
assert.ok(
  validateSample(
    {
      ...validMeasurement(cpuDescriptor),
      measurementTargetSemantic: { ...semantic, hash: "b".repeat(64) },
    },
    cpuDescriptor,
    roleCpuSets,
    protocol,
    semantic,
  ).length > 0,
  "measurement-target semantic divergence must fail",
);
assert.ok(
  validateSample(
    {
      ...validMeasurement(cpuDescriptor),
      target: {
        ...validMeasurement(cpuDescriptor).target,
        awaitingStart: { pid: 999 },
      },
    },
    cpuDescriptor,
    roleCpuSets,
    protocol,
    semantic,
  ).length > 0,
  "mismatched pre-start target PID must fail",
);
assert.ok(
  validateSample(
    {
      ...validMeasurement(cpuDescriptor),
      sidecar: {
        ...validMeasurement(cpuDescriptor).sidecar,
        ready: { pid: 102, port: 49999 },
      },
    },
    cpuDescriptor,
    roleCpuSets,
    protocol,
    semantic,
  ).length > 0,
  "pre-start sidecar port mismatch must fail",
);
assert.deepEqual(
  validateCalibration(
    validCalibration(TIMED_WORKLOADS[0]),
    TIMED_WORKLOADS[0],
    roleCpuSets,
    protocol,
    10,
  ),
  [],
);
assert.deepEqual(
  validateCalibration(
    {
      ...validCalibration(TIMED_WORKLOADS[0]),
      load: {
        ...validCalibration(TIMED_WORKLOADS[0]).load,
        cpuUtilizationPercent: 99.9,
      },
    },
    TIMED_WORKLOADS[0],
    roleCpuSets,
    protocol,
    10,
  ),
  [],
  "a saturated no-op ceiling records CPU but is not a target-measurement failure",
);
assert.ok(
  validateCalibration(
    { ...validCalibration(TIMED_WORKLOADS[0]), rps: 15 },
    TIMED_WORKLOADS[0],
    roleCpuSets,
    protocol,
    10,
  ).length > 0,
  "insufficient no-op headroom must fail",
);
assert.ok(
  validateCalibration(
    {
      ...validCalibration(TIMED_WORKLOADS[0]),
      load: {
        ...validCalibration(TIMED_WORKLOADS[0]).load,
        ready: { pid: 999 },
      },
    },
    TIMED_WORKLOADS[0],
    roleCpuSets,
    protocol,
    10,
  ).length > 0,
  "calibration pre-start load PID mismatch must fail",
);
assert.deepEqual(
  validateHostQualification(validHostQualification(), protocol).issues,
  [],
);
assert.ok(
  validateHostQualification(
    {
      ...validHostQualification(),
      roleCpuSets: { ...roleCpuSets, target: "0" },
    },
    protocol,
  ).issues.length > 0,
  "overlapping/incorrect role CPU selection must fail",
);
assert.deepEqual(validateConformance(validConformance(), protocol), []);
assert.ok(
  validateConformance(
    {
      ...validConformance(),
      sidecarDelays: {
        ...validConformance().sidecarDelays,
        "40ms": {
          nominalDelayMs: 40,
          samples: 64,
          actualDelayMs: { p50: 25, p95: 50, p99: 55 },
        },
      },
    },
    protocol,
  ).length > 0,
  "indistinguishable sidecar modes must fail",
);

const validationRequest = createRequest(
  getTimedWorkload("EW-04"),
  { valid: "validation-token", forbidden: "forbidden-token" },
  "validation-field-contract",
);
const vextValidationProjection = projectSemanticResponse(
  {
    status: 422,
    headers: validationHeaders(validationRequest.headers["x-request-id"]),
    body: {
      code: 422,
      requestId: validationRequest.headers["x-request-id"],
      errors: [{ field: "quantity", message: "must be positive" }],
    },
  },
  validationRequest,
  getTimedWorkload("EW-04"),
);
const fastifyValidationProjection = projectSemanticResponse(
  {
    status: 422,
    headers: validationHeaders(validationRequest.headers["x-request-id"]),
    body: {
      error: { code: "VALIDATION_FAILED", fields: ["quantity"] },
      meta: { requestId: validationRequest.headers["x-request-id"] },
    },
  },
  validationRequest,
  getTimedWorkload("EW-04"),
);
assert.deepEqual(
  vextValidationProjection,
  fastifyValidationProjection,
  "validation fields must canonicalize equivalent framework envelopes",
);
assert.throws(
  () =>
    projectSemanticResponse(
      {
        status: 422,
        headers: validationHeaders(validationRequest.headers["x-request-id"]),
        body: {
          error: { code: "VALIDATION_FAILED", fields: ["unexpected"] },
          meta: { requestId: validationRequest.headers["x-request-id"] },
        },
      },
      validationRequest,
      getTimedWorkload("EW-04"),
    ),
  /expected rejected fields/u,
  "wrong rejected field set must fail semantic conformance",
);

console.log("framework-native v2 validator negative fixtures: PASS");

import { TARGETS, TIMED_WORKLOADS } from "./contract.mjs";

export const WINDOWS_V2_PROTOCOL = Object.freeze({
  id: "windows-x64-v2",
  revision: 3,
  status: "accepted",
  requiredPlatform: "win32",
  requiredArch: "x64",
  connections: 50,
  pipelining: 1,
  warmupSeconds: 10,
  measurementSeconds: 30,
  blocks: 9,
  maxCvPercent: 15,
  bootstrap: {
    seed: "FNB-20260816-v1",
    iterations: 10_000,
    confidenceLevel: 0.95,
    practicalRatioBand: [0.95, 1.05],
  },
  load: {
    maximumCpuPercent: 85,
    minimumNoopHeadroomRatio: 2,
  },
  sidecar: {
    nominalDelayMs: [20, 40],
    minimumP50Ratio: 0.75,
    maximumP95ExcessMs: 30,
    maximumP99ExcessMs: 60,
    minimumDistinctP50GapMs: 8,
  },
  hostQualification: {
    backgroundSeconds: 60,
    maximumBackgroundPercent: 10,
  },
});

const TARGET_ORDERS = Object.freeze([
  ["vext-native", "fastify", "nest-fastify"],
  ["fastify", "nest-fastify", "vext-native"],
  ["nest-fastify", "vext-native", "fastify"],
]);

function assertTargetOrder(order) {
  const expected = new Set(TARGETS.map((target) => target.id));
  if (
    !Array.isArray(order) ||
    order.length !== expected.size ||
    new Set(order).size !== expected.size ||
    order.some((id) => !expected.has(id))
  ) {
    throw new Error(`Invalid target order: ${JSON.stringify(order)}`);
  }
}

export function createBalancedBlockSchedule(
  blocks = WINDOWS_V2_PROTOCOL.blocks,
) {
  if (
    !Number.isInteger(blocks) ||
    blocks <= 0 ||
    blocks % TARGET_ORDERS.length !== 0
  ) {
    throw new Error(
      `blocks must be a positive multiple of ${TARGET_ORDERS.length}; received ${String(blocks)}`,
    );
  }
  const workloads = TIMED_WORKLOADS.map((workload) => workload.id);
  return Array.from({ length: blocks }, (_unused, index) => {
    const targetOrder = [...TARGET_ORDERS[index % TARGET_ORDERS.length]];
    assertTargetOrder(targetOrder);
    const workloadOffset = index % workloads.length;
    return {
      block: index + 1,
      targetOrder,
      workloadOrder: [
        ...workloads.slice(workloadOffset),
        ...workloads.slice(0, workloadOffset),
      ],
    };
  });
}

export function scheduleMeasurements(schedule) {
  const targets = new Set(TARGETS.map((target) => target.id));
  const workloads = new Set(TIMED_WORKLOADS.map((workload) => workload.id));
  const measurements = [];
  let sequence = 0;
  for (const block of schedule) {
    if (!Number.isInteger(block?.block) || block.block <= 0) {
      throw new Error("Schedule block is missing a positive block number");
    }
    assertTargetOrder(block.targetOrder);
    if (
      !Array.isArray(block.workloadOrder) ||
      block.workloadOrder.length !== workloads.size ||
      new Set(block.workloadOrder).size !== workloads.size ||
      block.workloadOrder.some((id) => !workloads.has(id))
    ) {
      throw new Error(`Invalid workload order for block ${block.block}`);
    }
    for (const workloadId of block.workloadOrder) {
      for (const targetId of block.targetOrder) {
        measurements.push({
          id: `b${block.block}-${workloadId}-${targetId}`,
          sequence: ++sequence,
          block: block.block,
          workloadId,
          targetId,
          targetPosition: block.targetOrder.indexOf(targetId) + 1,
          workloadPosition: block.workloadOrder.indexOf(workloadId) + 1,
        });
      }
    }
  }
  return measurements;
}

export function protocolForMode(mode) {
  if (mode === "formal") return WINDOWS_V2_PROTOCOL;
  if (mode === "pilot") {
    return {
      ...WINDOWS_V2_PROTOCOL,
      id: `${WINDOWS_V2_PROTOCOL.id}-pilot`,
      status: "non-citable",
      warmupSeconds: 3,
      measurementSeconds: 5,
      blocks: 3,
      hostQualification: {
        ...WINDOWS_V2_PROTOCOL.hostQualification,
        backgroundSeconds: 2,
      },
    };
  }
  if (mode === "smoke") {
    return {
      ...WINDOWS_V2_PROTOCOL,
      id: `${WINDOWS_V2_PROTOCOL.id}-smoke`,
      status: "non-citable",
      warmupSeconds: 1,
      measurementSeconds: 2,
      blocks: 3,
      hostQualification: {
        ...WINDOWS_V2_PROTOCOL.hostQualification,
        backgroundSeconds: 1,
      },
    };
  }
  throw new Error(`Unknown benchmark mode: ${String(mode)}`);
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

export function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]),
    );
  }
  return value;
}

function finite(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must contain at least one finite value`);
  }
  const parsed = values.map(Number);
  if (parsed.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} contains a non-finite value`);
  }
  return parsed;
}

export function average(values) {
  const parsed = finite(values, "average values");
  return parsed.reduce((total, value) => total + value, 0) / parsed.length;
}

export function median(values) {
  const sorted = [...finite(values, "median values")].sort(
    (left, right) => left - right,
  );
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

export function percentile(values, percentileValue) {
  const sorted = [...finite(values, "percentile values")].sort(
    (left, right) => left - right,
  );
  if (
    !Number.isFinite(percentileValue) ||
    percentileValue < 0 ||
    percentileValue > 100
  ) {
    throw new Error(`Invalid percentile: ${String(percentileValue)}`);
  }
  const index = Math.max(
    0,
    Math.min(
      sorted.length - 1,
      Math.ceil((percentileValue / 100) * sorted.length) - 1,
    ),
  );
  return sorted[index];
}

export function sampleStandardDeviation(values) {
  const parsed = finite(values, "standard deviation values");
  if (parsed.length < 2) return 0;
  const mean = average(parsed);
  return Math.sqrt(
    parsed.reduce((total, value) => total + (value - mean) ** 2, 0) /
      (parsed.length - 1),
  );
}

export function coefficientOfVariationPercent(values) {
  const mean = average(values);
  if (mean === 0) return 0;
  return (sampleStandardDeviation(values) / mean) * 100;
}

export function summarizeRps(values) {
  const parsed = finite(values, "RPS samples");
  return {
    median: median(parsed),
    mean: average(parsed),
    min: Math.min(...parsed),
    max: Math.max(...parsed),
    cvPercent: coefficientOfVariationPercent(parsed),
  };
}

function seedToUint32(seed) {
  let value = 2_166_136_261;
  for (const character of String(seed)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

export function createSeededRandom(seed) {
  let state = seedToUint32(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pairedBlockBootstrap({
  leftByBlock,
  rightByBlock,
  seed,
  iterations,
  practicalRatioBand,
}) {
  const left = new Map(
    leftByBlock.map((entry) => [Number(entry.block), Number(entry.rps)]),
  );
  const right = new Map(
    rightByBlock.map((entry) => [Number(entry.block), Number(entry.rps)]),
  );
  const blocks = [...left.keys()].sort((a, b) => a - b);
  if (
    blocks.length === 0 ||
    blocks.length !== right.size ||
    blocks.some((block) => !right.has(block)) ||
    [...left.values(), ...right.values()].some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  ) {
    throw new Error(
      "Paired bootstrap requires matching positive RPS values for every block",
    );
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("Bootstrap iterations must be a positive integer");
  }
  const random = createSeededRandom(seed);
  const ratios = [];
  const differences = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const leftValues = [];
    const rightValues = [];
    for (let draw = 0; draw < blocks.length; draw += 1) {
      const block = blocks[Math.floor(random() * blocks.length)];
      leftValues.push(left.get(block));
      rightValues.push(right.get(block));
    }
    const leftMedian = median(leftValues);
    const rightMedian = median(rightValues);
    ratios.push(leftMedian / rightMedian);
    differences.push(leftMedian - rightMedian);
  }
  const ratioInterval = {
    lower: percentile(ratios, 2.5),
    upper: percentile(ratios, 97.5),
  };
  const differenceInterval = {
    lower: percentile(differences, 2.5),
    upper: percentile(differences, 97.5),
  };
  const [lowBand, highBand] = practicalRatioBand;
  let conclusion = "inconclusive";
  if (ratioInterval.lower > highBand || ratioInterval.upper < lowBand) {
    conclusion = "reliable-difference";
  } else if (
    ratioInterval.lower >= lowBand &&
    ratioInterval.upper <= highBand
  ) {
    conclusion = "practical-tie";
  }
  return {
    pointEstimate: {
      ratio: median([...left.values()]) / median([...right.values()]),
      differenceRps: median([...left.values()]) - median([...right.values()]),
    },
    ratioInterval,
    differenceInterval,
    conclusion,
    seed,
    iterations,
    pairedBlocks: blocks,
  };
}

export function roundMetric(value, decimalPlaces = 3) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** decimalPlaces;
  return Math.round(Number(value) * factor) / factor;
}

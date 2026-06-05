import type { VextErrorDetails, VextJsonValue } from "../types/errors.js";

const MAX_DEPTH = 8;

export function sanitizeErrorDetails(
  details: unknown,
): VextErrorDetails | undefined {
  const seen = new WeakSet<object>();
  const value = sanitizeValue(details, seen, 0);

  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.length > 0 ? value : undefined;
  }
  if (isPlainJsonObject(value)) {
    return Object.keys(value).length > 0 ? value : undefined;
  }

  return { value };
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): VextJsonValue | undefined {
  if (value === undefined || typeof value === "function") {
    return undefined;
  }
  if (typeof value === "symbol") {
    return String(value);
  }
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (depth >= MAX_DEPTH) {
    return "[MaxDepth]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, depth + 1) ?? null);
  }

  const output: Record<string, VextJsonValue> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizeValue(child, seen, depth + 1);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }
  return output;
}

function isPlainJsonObject(
  value: VextJsonValue,
): value is Record<string, VextJsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import { createHash } from "node:crypto";

export const CANONICAL_JSON_VERSION = "c14n-json-v1";
export const SEMANTIC_HASH_ALGORITHM = "sha256";

/**
 * Canonicalize JSON *values*, not serialized bytes. Object keys are sorted
 * lexicographically, arrays retain their meaningful order, and -0 normalizes
 * to 0. Unsupported JavaScript values fail closed so a response cannot gain a
 * misleadingly stable hash through JSON.stringify omissions.
 */
export function canonicalizeJson(value, path = "$", seen = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Non-finite number at ${path} is not JSON semantic data`,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`Circular array at ${path}`);
    seen.add(value);
    const result = value.map((entry, index) =>
      canonicalizeJson(entry, `${path}[${index}]`, seen),
    );
    seen.delete(value);
    return result;
  }
  if (typeof value === "object" && value !== null) {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(`Only plain JSON objects are supported at ${path}`);
    }
    if (seen.has(value)) throw new TypeError(`Circular object at ${path}`);
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalizeJson(value[key], `${path}.${key}`, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError(
    `Unsupported JSON semantic value at ${path}: ${typeof value}`,
  );
}

export function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalizeJson(value));
}

export function semanticHash(value) {
  return createHash(SEMANTIC_HASH_ALGORITHM)
    .update(canonicalJsonStringify(value), "utf8")
    .digest("hex");
}

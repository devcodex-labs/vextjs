import type { LogRecord, LoggerRedactionOptions } from "./types.js";

const PATH_SEPARATOR = "\u001f";
const RESERVED_TOP_LEVEL_KEYS = new Set(["level"]);

export interface CompiledRedactionOptions {
  active: boolean;
  keys: Set<string>;
  paths: Set<string>;
  value: string;
}

export function compileRedactionOptions(
  options: LoggerRedactionOptions | undefined,
): CompiledRedactionOptions {
  const keys = new Set(normalizeList(options?.keys));
  const paths = new Set(
    normalizeList(options?.paths)
      .map((path) => path.split(".").map((part) => part.trim()))
      .filter((parts) => parts.length > 0 && parts.every(Boolean))
      .map((parts) => parts.join(PATH_SEPARATOR)),
  );
  const value = options?.value ?? "[Redacted]";

  return {
    active: keys.size > 0 || paths.size > 0,
    keys,
    paths,
    value,
  };
}

export function redactRecord(
  record: LogRecord,
  options: CompiledRedactionOptions,
): LogRecord {
  if (!options.active) {
    return record;
  }
  return redactObject(record, [], options, new WeakMap<object, unknown>());
}

function redactValue(
  value: unknown,
  path: string[],
  options: CompiledRedactionOptions,
  seen: WeakMap<object, unknown>,
): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const cached = seen.get(value);
  if (cached) {
    return cached;
  }

  if (Array.isArray(value)) {
    const next: unknown[] = [];
    seen.set(value, next);
    for (let index = 0; index < value.length; index++) {
      const itemPath = [...path, String(index)];
      next[index] = shouldRedactPath(itemPath, options)
        ? options.value
        : redactValue(value[index], itemPath, options, seen);
    }
    return next;
  }

  return redactObject(value as LogRecord, path, options, seen);
}

function redactObject(
  record: LogRecord,
  path: string[],
  options: CompiledRedactionOptions,
  seen: WeakMap<object, unknown>,
): LogRecord {
  const next: LogRecord = {};
  seen.set(record, next);

  for (const key of Object.keys(record)) {
    const keyPath = [...path, key];
    const isReservedTopLevel =
      path.length === 0 && RESERVED_TOP_LEVEL_KEYS.has(key);
    next[key] =
      !isReservedTopLevel &&
      (options.keys.has(key) || shouldRedactPath(keyPath, options))
        ? options.value
        : redactValue(record[key], keyPath, options, seen);
  }

  return next;
}

function shouldRedactPath(
  path: string[],
  options: CompiledRedactionOptions,
): boolean {
  return options.paths.has(path.join(PATH_SEPARATOR));
}

function normalizeList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

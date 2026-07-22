const RESERVED = new Set(["level", "time", "msg"]);
const SIMPLE_STRING_PATTERN = /^[\u0020-\u0021\u0023-\u005b\u005d-\u007e]*$/;
const SHAPE_CACHE_LIMIT = 128;
const shapeCache = new Map<string, readonly ShapeEntry[]>();

interface ShapeEntry {
  key: string;
  quotedKey: string;
}

export function quote(value: string): string {
  return SIMPLE_STRING_PATTERN.test(value)
    ? `"${value}"`
    : JSON.stringify(value);
}

export function appendRecordString(
  line: string,
  record: Record<string, unknown> | undefined,
): string {
  if (!record) {
    return line;
  }

  let next = line;
  const shape = getShape(record);
  if (!shape) {
    return `${next},"value":${quote("[Unserializable]")}`;
  }
  for (const entry of shape) {
    let value: unknown;
    try {
      value = record[entry.key];
    } catch {
      value = "[Unserializable]";
    }
    if (value === undefined) {
      continue;
    }

    const serialized = serializeValue(value);
    if (serialized !== undefined) {
      next += `,${entry.quotedKey}:${serialized}`;
    }
  }
  return next;
}

export function serializeValue(value: unknown): string | undefined {
  switch (typeof value) {
    case "string":
      return quote(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return quote(value.toString());
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "object":
      if (value === null) {
        return "null";
      }
      if (value instanceof Date) {
        return quote(value.toISOString());
      }
      if (value instanceof Error) {
        return serializeError(value);
      }
      return serializeObject(value, new WeakSet<object>());
  }
}

export function serializeError(error: Error): string {
  let line = `{"type":${quote(error.constructor.name)},"message":${quote(error.message)}`;

  if (error.name) {
    line += `,"name":${quote(error.name)}`;
  }
  if (error.stack) {
    line += `,"stack":${quote(error.stack)}`;
  }

  return `${line}}`;
}

export function toJsonRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!RESERVED.has(key) && record[key] !== undefined) {
      normalized[key] = normalizeValue(record[key], new WeakSet<object>());
    }
  }
  return normalized;
}

function normalizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }
  if (typeof value !== "object") {
    return value;
  }

  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return normalizeError(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const normalizedArray = value.map(
      (item) => normalizeValue(item, seen) ?? null,
    );
    seen.delete(value);
    return normalizedArray;
  }
  const normalizedObject = normalizeObject(value, seen);
  seen.delete(value);
  return normalizedObject;
}

function normalizeError(error: Error): Record<string, unknown> {
  return {
    type: error.constructor.name,
    message: error.message,
    ...(error.name ? { name: error.name } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
  };
}

function normalizeObject(
  value: object,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  const keys = safeEnumerableKeys(record);
  if (!keys) {
    return { value: "[Unserializable]" };
  }
  for (const key of keys) {
    let raw: unknown;
    try {
      raw = record[key];
    } catch {
      normalized[key] = "[Unserializable]";
      continue;
    }
    const next = normalizeValue(raw, seen);
    if (next !== undefined) {
      normalized[key] = next;
    }
  }
  return normalized;
}

function serializeObject(value: object, seen: WeakSet<object>): string {
  if (seen.has(value)) {
    return quote("[Circular]");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const serializedArray = serializeArray(value, seen);
    seen.delete(value);
    return serializedArray;
  }

  let line = "{";
  let needsComma = false;
  const record = value as Record<string, unknown>;
  const shape = getShape(record);
  if (!shape) {
    seen.delete(value);
    return quote("[Unserializable]");
  }

  for (const entry of shape) {
    let raw: unknown;
    try {
      raw = record[entry.key];
    } catch {
      raw = "[Unserializable]";
    }
    const serialized = serializeNestedValue(raw, seen, false);
    if (serialized !== undefined) {
      if (needsComma) {
        line += ",";
      }
      line += `${entry.quotedKey}:${serialized}`;
      needsComma = true;
    }
  }

  const serializedObject = `${line}}`;
  seen.delete(value);
  return serializedObject;
}

function serializeArray(values: unknown[], seen: WeakSet<object>): string {
  let line = "[";
  for (let index = 0; index < values.length; index++) {
    if (index > 0) {
      line += ",";
    }
    line += serializeNestedValue(values[index], seen, true);
  }
  return `${line}]`;
}

function serializeNestedValue(
  value: unknown,
  seen: WeakSet<object>,
  inArray: boolean,
): string | undefined {
  switch (typeof value) {
    case "string":
      return quote(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return quote(value.toString());
    case "undefined":
    case "function":
    case "symbol":
      return inArray ? "null" : undefined;
    case "object":
      if (value === null) {
        return "null";
      }
      if (value instanceof Date) {
        return quote(value.toISOString());
      }
      if (value instanceof Error) {
        return serializeError(value);
      }
      return serializeObject(value, seen);
  }
}

function getShape(
  record: Record<string, unknown>,
): readonly ShapeEntry[] | null {
  const keys = safeEnumerableKeys(record);
  if (!keys) {
    return null;
  }
  const cacheKey = keys.join("\u001f");
  const cached = shapeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const entries = keys
    .filter((key) => !RESERVED.has(key))
    .map((key) => ({
      key,
      quotedKey: quote(key),
    }));

  if (shapeCache.size >= SHAPE_CACHE_LIMIT) {
    shapeCache.clear();
  }
  shapeCache.set(cacheKey, entries);
  return entries;
}

function safeEnumerableKeys(record: object): string[] | null {
  try {
    return Reflect.ownKeys(record).filter(
      (key): key is string =>
        typeof key === "string" &&
        Object.prototype.propertyIsEnumerable.call(record, key),
    );
  } catch {
    return null;
  }
}

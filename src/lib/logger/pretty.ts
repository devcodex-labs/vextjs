import type {
  LogRecord,
  PrettyFormatterOptions,
  RuntimeLogLevel,
} from "./types.js";
import { formatPrettyTime } from "./timestamp.js";
import { toJsonRecord } from "./utils-json.js";

const DEFAULT_IGNORE = "pid,hostname,requestId";

export function formatPrettyRecord(
  record: LogRecord,
  levelName: RuntimeLogLevel,
  options: PrettyFormatterOptions | undefined,
): string {
  const ignored = parseIgnore(options?.ignore ?? DEFAULT_IGNORE);
  const singleLine = options?.singleLine !== false;
  const message = typeof record.msg === "string" ? record.msg : "";
  const extras = extractExtras(record, ignored);
  const prefix = `[${formatPrettyTime(record.time)}] ${levelName.toUpperCase()}: ${message}`;

  if (Object.keys(extras).length === 0) {
    return `${prefix}\n`;
  }

  if (singleLine) {
    return `${prefix} ${JSON.stringify(extras)}\n`;
  }

  const details = Object.entries(extras)
    .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `${prefix}\n${details}\n`;
}

function parseIgnore(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean),
  );
}

function extractExtras(
  record: LogRecord,
  ignored: Set<string>,
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (
      key === "level" ||
      key === "time" ||
      key === "msg" ||
      ignored.has(key)
    ) {
      continue;
    }
    extras[key] = record[key];
  }
  return toJsonRecord(extras);
}

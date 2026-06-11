import type {
  LogRecord,
  PrettyFormatterOptions,
  RuntimeLogLevel,
} from "./types.js";
import { formatPrettyTime } from "./timestamp.js";
import { toJsonRecord } from "./utils-json.js";

const DEFAULT_IGNORE = "pid,hostname,requestId";
const ANSI_RESET = "\x1b[0m";
const LEVEL_COLORS: Record<RuntimeLogLevel, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
};

export function formatPrettyRecord(
  record: LogRecord,
  levelName: RuntimeLogLevel,
  options: PrettyFormatterOptions | undefined,
): string {
  const ignored = parseIgnore(options?.ignore ?? DEFAULT_IGNORE);
  const singleLine = options?.singleLine !== false;
  const message = typeof record.msg === "string" ? record.msg : "";
  const extras = extractExtras(record, ignored);
  const levelLabel = formatLevelLabel(levelName, options?.color === true);
  const prefix = `[${formatPrettyTime(record.time)}] ${levelLabel}: ${message}`;

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

function formatLevelLabel(levelName: RuntimeLogLevel, color: boolean): string {
  const label = levelName.toUpperCase();
  if (!color) {
    return label;
  }
  return `${LEVEL_COLORS[levelName]}${label}${ANSI_RESET}`;
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

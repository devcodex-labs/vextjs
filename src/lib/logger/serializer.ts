import { format } from "node:util";
import type { LogRecord, RuntimeLogLevel, TimestampMode } from "./types.js";
import { LEVEL_VALUES } from "./levels.js";
import { appendTimestampString } from "./timestamp.js";
import { appendRecordString, quote, toJsonRecord } from "./utils-json.js";

const RESERVED_RECORD_KEYS = new Set(["level", "time", "msg"]);

export interface NormalizedLogArgs {
  record?: LogRecord;
  message?: string;
}

export interface BaseRecordOptions {
  timestamp: TimestampMode;
  pid: number;
  hostname: string;
  bindings: LogRecord;
  context?: LogRecord;
  mixin?: LogRecord;
}

export function normalizeLogArgs(args: unknown[]): NormalizedLogArgs {
  if (args.length === 0) {
    return {};
  }

  const [first, second, ...rest] = args;

  if (typeof first === "string") {
    if (isLogRecord(second) && rest.length === 0) {
      return { record: second, message: first };
    }
    if (args.length === 2 && second === undefined) {
      return { message: first };
    }
    return {
      message: args.length > 1 ? format(first, ...args.slice(1)) : first,
    };
  }

  if (first instanceof Error) {
    return {
      record: { err: first },
      message:
        typeof second === "string" ? format(second, ...rest) : first.message,
    };
  }

  if (isLogRecord(first)) {
    return {
      record: first,
      message: typeof second === "string" ? format(second, ...rest) : undefined,
    };
  }

  return {
    message: first instanceof Date ? first.toISOString() : String(first),
  };
}

export function buildLogRecord(
  levelName: RuntimeLogLevel,
  args: NormalizedLogArgs,
  options: BaseRecordOptions,
): LogRecord {
  let line = `{"level":${LEVEL_VALUES[levelName]}`;
  line = appendTimestampString(line, options.timestamp);
  line += `,"pid":${options.pid}`;
  line += `,"hostname":${quote(options.hostname)}`;
  line = appendRecordString(line, options.bindings);
  line = appendRecordString(line, options.context);
  line = appendRecordString(line, options.mixin);
  line = appendRecordString(line, args.record);
  if (args.message !== undefined) {
    line += `,"msg":${quote(args.message)}`;
  }
  line += "}";
  return JSON.parse(line) as LogRecord;
}

export function serializeJsonRecord(record: LogRecord): string {
  let line = `{"level":${record.level}`;
  if (record.time !== undefined) {
    line += `,"time":${quote(String(record.time))}`;
  }
  if (record.pid !== undefined) {
    const pid =
      typeof record.pid === "number" && Number.isFinite(record.pid)
        ? String(record.pid)
        : quote(String(record.pid));
    line += `,"pid":${pid}`;
  }
  if (record.hostname !== undefined) {
    line += `,"hostname":${quote(String(record.hostname))}`;
  }

  const extras: LogRecord = {};
  for (const key of Object.keys(record)) {
    if (!RESERVED_RECORD_KEYS.has(key) && key !== "pid" && key !== "hostname") {
      extras[key] = record[key];
    }
  }
  line = appendRecordString(line, toJsonRecord(extras));

  if (record.msg !== undefined) {
    line += `,"msg":${quote(String(record.msg))}`;
  }
  return `${line}}\n`;
}

function isRecord(value: unknown): value is LogRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLogRecord(value: unknown): value is LogRecord {
  return (
    isRecord(value) && !(value instanceof Date) && !(value instanceof Error)
  );
}

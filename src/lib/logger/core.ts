import { hostname as getHostname } from "node:os";
import { isLevelEnabled, levelValue, normalizeLevel } from "./levels.js";
import { formatPrettyRecord } from "./pretty.js";
import {
  buildLogRecord,
  normalizeLogArgs,
  serializeJsonRecord,
} from "./serializer.js";
import type {
  CompiledLoggerCoreOptions,
  LoggerCore,
  LoggerCoreOptions,
  LogRecord,
  RuntimeLogLevel,
} from "./types.js";

const METHODS: RuntimeLogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

export function createLoggerCore(options: LoggerCoreOptions): LoggerCore {
  return new VextLoggerCore({
    ...options,
    level: normalizeLevel(options.level),
    bindings: options.bindings ?? {},
    timestamp: options.timestamp ?? "iso",
    format: options.format ?? "json",
    pid: options.pid ?? process.pid,
    hostname: options.hostname ?? getHostname(),
  });
}

class VextLoggerCore implements LoggerCore {
  readonly level: CompiledLoggerCoreOptions["level"];
  private readonly levelValue: number;
  private closed = false;

  constructor(private readonly options: CompiledLoggerCoreOptions) {
    this.level = options.level;
    this.levelValue = levelValue(options.level);

    for (const method of METHODS) {
      this[method] = isLevelEnabled(this.levelValue, method)
        ? (...args: unknown[]) => this.write(method, args)
        : noop;
    }
  }

  trace(..._args: unknown[]): void {}
  debug(..._args: unknown[]): void {}
  info(..._args: unknown[]): void {}
  warn(..._args: unknown[]): void {}
  error(..._args: unknown[]): void {}
  fatal(..._args: unknown[]): void {}

  isLevelEnabled(level: RuntimeLogLevel | "silent"): boolean {
    return isLevelEnabled(this.levelValue, level);
  }

  child(bindings: LogRecord): LoggerCore {
    return new VextLoggerCore({
      ...this.options,
      bindings: { ...this.options.bindings, ...bindings },
    });
  }

  async flush(): Promise<void> {
    await this.options.sink.flush?.();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.flush();
    await this.options.sink.close?.();
  }

  private write(level: RuntimeLogLevel, args: unknown[]): void {
    if (this.closed) {
      return;
    }

    const normalized = normalizeLogArgs(args);
    const context = this.safeProvider(this.options.contextProvider);
    const mixin = this.safeProvider(this.options.mixin);
    const mergedMixin = protectRequestId(context, mixin);
    const record = buildLogRecord(level, normalized, {
      timestamp: this.options.timestamp,
      pid: this.options.pid,
      hostname: this.options.hostname,
      bindings: this.options.bindings,
      context,
      mixin: mergedMixin,
    });

    this.options.sink.write(
      this.options.format === "pretty"
        ? formatPrettyRecord(record, level, this.options.pretty)
        : serializeJsonRecord(record),
    );
  }

  private safeProvider(
    provider: (() => LogRecord | void) | undefined,
  ): LogRecord | undefined {
    if (!provider) {
      return undefined;
    }
    try {
      const value = provider();
      return isRecord(value) && !isPromiseLike(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
}

function protectRequestId(
  context: LogRecord | undefined,
  mixin: LogRecord | undefined,
): LogRecord | undefined {
  const merged = { ...(mixin ?? {}) };
  if (context?.requestId !== undefined) {
    delete merged.requestId;
    return merged;
  }
  delete merged.requestId;
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function isRecord(value: unknown): value is LogRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromiseLike(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function",
  );
}

function noop(): void {}

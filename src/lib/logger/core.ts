import { hostname as getHostname } from "node:os";
import {
  assertLogLevel,
  isLevelEnabled,
  levelValue,
  normalizeLevel,
} from "./levels.js";
import { formatPrettyRecord } from "./pretty.js";
import {
  compileRedactionOptions,
  redactRecord,
  type CompiledRedactionOptions,
} from "./redaction.js";
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

type RuntimeCompiledLoggerCoreOptions = Omit<
  CompiledLoggerCoreOptions,
  "redaction"
> & {
  redaction: CompiledRedactionOptions;
};

export function createLoggerCore(options: LoggerCoreOptions): LoggerCore {
  const level = normalizeLevel(options.level);
  return new VextLoggerCore({
    ...options,
    level,
    levelController: {
      level,
      value: levelValue(level),
    },
    bindings: options.bindings ?? {},
    timestamp: options.timestamp ?? "iso",
    format: options.format ?? "json",
    pid: options.pid ?? process.pid,
    hostname: options.hostname ?? getHostname(),
    redaction: compileRedactionOptions(options.redaction),
  });
}

class VextLoggerCore implements LoggerCore {
  private closed = false;

  constructor(private readonly options: RuntimeCompiledLoggerCoreOptions) {}

  get level(): CompiledLoggerCoreOptions["level"] {
    return this.options.levelController.level;
  }

  trace(...args: unknown[]): void {
    this.write("trace", args);
  }

  debug(...args: unknown[]): void {
    this.write("debug", args);
  }

  info(...args: unknown[]): void {
    this.write("info", args);
  }

  warn(...args: unknown[]): void {
    this.write("warn", args);
  }

  error(...args: unknown[]): void {
    this.write("error", args);
  }

  fatal(...args: unknown[]): void {
    this.write("fatal", args);
  }

  getLevel(): CompiledLoggerCoreOptions["level"] {
    return this.options.levelController.level;
  }

  setLevel(level: CompiledLoggerCoreOptions["level"]): void {
    assertLogLevel(level);
    this.options.levelController.level = level;
    this.options.levelController.value = levelValue(level);
  }

  isLevelEnabled(level: RuntimeLogLevel | "silent"): boolean {
    return isLevelEnabled(this.options.levelController.value, level);
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
    if (this.closed || !this.isLevelEnabled(level)) {
      return;
    }

    const normalized = normalizeLogArgs(args);
    const context = this.safeProvider(this.options.contextProvider);
    const mixin = this.safeProvider(this.options.mixin);
    const mergedMixin = protectRequestId(context, mixin);
    const record = redactRecord(
      buildLogRecord(level, normalized, {
        timestamp: this.options.timestamp,
        pid: this.options.pid,
        hostname: this.options.hostname,
        bindings: this.options.bindings,
        context,
        mixin: mergedMixin,
      }),
      this.options.redaction,
    );

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

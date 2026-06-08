export type LogLevelName =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

export type RuntimeLogLevel = Exclude<LogLevelName, "silent">;

export type TimestampMode = "iso" | "epoch" | "none";

export type LogRecord = Record<string, unknown>;

export interface LogSink {
  write(line: string): void;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface PrettyFormatterOptions {
  ignore?: string;
  singleLine?: boolean;
}

export interface LoggerRedactionOptions {
  keys?: string[];
  paths?: string[];
  value?: string;
}

export interface LevelController {
  level: LogLevelName;
  value: number;
}

export interface LoggerCoreOptions {
  level?: LogLevelName;
  sink: LogSink;
  bindings?: LogRecord;
  timestamp?: TimestampMode;
  format?: "json" | "pretty";
  pretty?: PrettyFormatterOptions;
  pid?: number;
  hostname?: string;
  contextProvider?: () => LogRecord | void;
  mixin?: () => LogRecord | void;
  redaction?: LoggerRedactionOptions;
}

export interface CompiledLoggerCoreOptions {
  level: LogLevelName;
  levelController: LevelController;
  sink: LogSink;
  bindings: LogRecord;
  timestamp: TimestampMode;
  format: "json" | "pretty";
  pretty?: PrettyFormatterOptions;
  pid: number;
  hostname: string;
  contextProvider?: () => LogRecord | void;
  mixin?: () => LogRecord | void;
}

export interface LoggerLifecycle {
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface LoggerCore extends LoggerLifecycle {
  readonly level: LogLevelName;
  child(bindings: LogRecord): LoggerCore;
  getLevel(): LogLevelName;
  setLevel(level: LogLevelName): void;
  isLevelEnabled(level: LogLevelName): boolean;
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
}
